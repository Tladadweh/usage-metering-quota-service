import { Router, Request, Response, NextFunction } from "express";

import { pool } from "../db/pool";
import {
  authenticateApiKey,
  AuthenticatedRequest,
} from "../middleware/auth";
import {
  generateApiKey,
  hashApiKey,
} from "../services/apiKeys";

const router = Router();

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Create a new account
router.post(
  "/",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name, planId } = req.body ?? {};

      if (
        typeof name !== "string" ||
        name.trim().length === 0 ||
        name.trim().length > 100
      ) {
        res.status(400).json({
          error: "Account name must be between 1 and 100 characters",
        });
        return;
      }

      if (
        typeof planId !== "string" ||
        !UUID_REGEX.test(planId)
      ) {
        res.status(400).json({
          error: "A valid planId is required",
        });
        return;
      }

      const planResult = await pool.query(
        `
        SELECT id
        FROM plans
        WHERE id = $1
          AND plan_type = 'ACCOUNT'
          AND is_predefined = TRUE
        `,
        [planId]
      );

      if (planResult.rowCount === 0) {
        res.status(400).json({
          error: "Invalid account plan",
        });
        return;
      }

      const apiKey = generateApiKey();
      const apiKeyHash = hashApiKey(apiKey);

      const result = await pool.query<{
        id: string;
        name: string;
        plan_id: string;
        created_at: Date;
      }>(
        `
        INSERT INTO accounts (
          name,
          api_key_hash,
          plan_id
        )
        VALUES ($1, $2, $3)
        RETURNING
          id,
          name,
          plan_id,
          created_at
        `,
        [name.trim(), apiKeyHash, planId]
      );

      const account = result.rows[0];

      res.status(201).json({
        message: "Account created successfully",
        account: {
          id: account.id,
          name: account.name,
          planId: account.plan_id,
          createdAt: account.created_at,
        },
        apiKey,
      });
    } catch (error) {
      next(error);
    }
  }
);

// Get the authenticated account
router.get(
  "/me",
  authenticateApiKey,
  async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const result = await pool.query(
        `
        SELECT
          a.id,
          a.name,
          a.created_at,
          p.id AS plan_id,
          p.name AS plan_name,
          r.monthly_allowance::TEXT AS monthly_allowance,
          r.max_units_per_request::TEXT
            AS max_units_per_request
        FROM accounts a
        JOIN plans p ON p.id = a.plan_id
        JOIN plan_rules r ON r.plan_id = p.id
        WHERE a.id = $1
        `,
        [req.accountId]
      );

      if (result.rowCount === 0) {
        res.status(404).json({
          error: "Account not found",
        });
        return;
      }

      const account = result.rows[0];

      res.status(200).json({
        account: {
          id: account.id,
          name: account.name,
          createdAt: account.created_at,
          plan: {
            id: account.plan_id,
            name: account.plan_name,
            monthlyAllowance: account.monthly_allowance,
            maxUnitsPerRequest: account.max_units_per_request,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;