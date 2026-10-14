
import {
  Router,
  Request,
  Response,
  NextFunction,
} from "express";

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

// Register account
router.post(
  "/",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name, planId } = req.body ?? {};

      if (
        typeof name !== "string" ||
        !name.trim() ||
        name.trim().length > 100
      ) {
        res.status(400).json({ error: "Invalid account name" });
        return;
      }

      if (typeof planId !== "string" || !UUID_REGEX.test(planId)) {
        res.status(400).json({ error: "Invalid planId" });
        return;
      }

      const plan = await pool.query(
        `
        SELECT id FROM plans
        WHERE id = $1
          AND plan_type = 'ACCOUNT'
          AND is_predefined = TRUE
        `,
        [planId]
      );

      if (plan.rowCount === 0) {
        res.status(400).json({ error: "Invalid account plan" });
        return;
      }

      const apiKey = generateApiKey();

      const result = await pool.query(
        `
        INSERT INTO accounts (name, api_key_hash, plan_id)
        VALUES ($1, $2, $3)
        RETURNING id, name, plan_id, created_at
        `,
        [name.trim(), hashApiKey(apiKey), planId]
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

// Authenticated account details
router.get(
  "/me",
  authenticateApiKey,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const result = await pool.query(
        `
        SELECT
          a.id, a.name, a.created_at,
          p.id AS plan_id,
          p.name AS plan_name,
          r.monthly_allowance::TEXT AS monthly_allowance,
          r.max_units_per_request::TEXT AS max_units_per_request
        FROM accounts a
        JOIN plans p ON p.id = a.plan_id
        JOIN plan_rules r ON r.plan_id = p.id
        WHERE a.id = $1
        `,
        [req.accountId]
      );

      if (result.rowCount === 0) {
        res.status(404).json({ error: "Account not found" });
        return;
      }

      const account = result.rows[0];

      res.json({
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

// Change account plan
router.put(
  "/plan",
  authenticateApiKey,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const { planId } = req.body ?? {};

    if (typeof planId !== "string" || !UUID_REGEX.test(planId)) {
      res.status(400).json({ error: "Invalid planId" });
      return;
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // Same lock used by consumption engine.
      await client.query(
        "SELECT id FROM accounts WHERE id = $1 FOR UPDATE",
        [req.accountId]
      );

      const plan = await client.query(
        `
        SELECT p.id
        FROM plans p
        WHERE p.id = $1
          AND p.plan_type = 'ACCOUNT'
          AND (
            p.is_predefined = TRUE
            OR p.owner_account_id = $2
          )
        `,
        [planId, req.accountId]
      );

      if (plan.rowCount === 0) {
        await client.query("ROLLBACK");
        res.status(400).json({ error: "Invalid account plan" });
        return;
      }

      await client.query(
        "UPDATE accounts SET plan_id = $1 WHERE id = $2",
        [planId, req.accountId]
      );

      await client.query("COMMIT");

      res.json({
        message: "Account plan changed successfully",
        planId,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      next(error);
    } finally {
      client.release();
    }
  }
);

export default router;
