import {
  Router,
  Response,
  NextFunction,
} from "express";

import { pool } from "../db/pool";

import {
  authenticateApiKey,
  AuthenticatedRequest,
} from "../middleware/auth";

const router = Router();

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.use(authenticateApiKey);

// Create a user
router.post(
  "/",
  async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { externalUserId, planId } = req.body ?? {};

      if (
        typeof externalUserId !== "string" ||
        externalUserId.trim().length === 0 ||
        externalUserId.trim().length > 100
      ) {
        res.status(400).json({
          error: "externalUserId must be between 1 and 100 characters",
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
          AND plan_type = 'USER'
          AND (
            is_predefined = TRUE
            OR owner_account_id = $2
          )
        `,
        [planId, req.accountId]
      );

      if (planResult.rowCount === 0) {
        res.status(400).json({
          error: "Invalid user plan",
        });
        return;
      }

      const result = await pool.query<{
        id: string;
        account_id: string;
        external_user_id: string;
        plan_id: string;
        created_at: Date;
      }>(
        `
        INSERT INTO users (
          account_id,
          external_user_id,
          plan_id
        )
        VALUES ($1, $2, $3)
        RETURNING
          id,
          account_id,
          external_user_id,
          plan_id,
          created_at
        `,
        [req.accountId, externalUserId.trim(), planId]
      );

      const user = result.rows[0];

      res.status(201).json({
        message: "User created successfully",
        user: {
          id: user.id,
          accountId: user.account_id,
          externalUserId: user.external_user_id,
          planId: user.plan_id,
          createdAt: user.created_at,
        },
      });
    } catch (error) {
      const dbError = error as { code?: string };

      if (dbError.code === "23505") {
        res.status(409).json({
          error: "A user with this externalUserId already exists",
        });
        return;
      }

      next(error);
    }
  }
);

// List users belonging to the authenticated account
router.get(
  "/",
  async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const result = await pool.query(
        `
        SELECT
          u.id,
          u.external_user_id,
          u.created_at,
          p.id AS plan_id,
          p.name AS plan_name
        FROM users u
        JOIN plans p ON p.id = u.plan_id
        WHERE u.account_id = $1
        ORDER BY u.created_at, u.id
        `,
        [req.accountId]
      );

      res.status(200).json({
        users: result.rows.map((user) => ({
          id: user.id,
          externalUserId: user.external_user_id,
          createdAt: user.created_at,
          plan: {
            id: user.plan_id,
            name: user.plan_name,
          },
        })),
      });
    } catch (error) {
      next(error);
    }
  }
);

// Get a specific user belonging to the account
router.get(
  "/:id",
  async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const userId = req.params.id;

      if (
        typeof userId !== "string" ||
        !UUID_REGEX.test(userId)
      ) {
        res.status(400).json({
          error: "Invalid user ID",
        });
        return;
      }

      const result = await pool.query(
        `
        SELECT
          u.id,
          u.external_user_id,
          u.created_at,
          p.id AS plan_id,
          p.name AS plan_name,
          r.monthly_allowance::TEXT AS monthly_allowance,
          r.max_units_per_request::TEXT
            AS max_units_per_request
        FROM users u
        JOIN plans p ON p.id = u.plan_id
        JOIN plan_rules r ON r.plan_id = p.id
        WHERE u.id = $1
          AND u.account_id = $2
        `,
        [userId, req.accountId]
      );

      if (result.rowCount === 0) {
        res.status(404).json({
          error: "User not found",
        });
        return;
      }

      const user = result.rows[0];

      res.status(200).json({
        user: {
          id: user.id,
          externalUserId: user.external_user_id,
          createdAt: user.created_at,
          plan: {
            id: user.plan_id,
            name: user.plan_name,
            monthlyAllowance: user.monthly_allowance,
            maxUnitsPerRequest: user.max_units_per_request,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;