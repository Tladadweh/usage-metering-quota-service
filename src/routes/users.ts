
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

router.post(
  "/",
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { externalUserId, planId } = req.body ?? {};

      if (
        typeof externalUserId !== "string" ||
        !externalUserId.trim() ||
        externalUserId.trim().length > 100
      ) {
        res.status(400).json({ error: "Invalid externalUserId" });
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
          AND plan_type = 'USER'
          AND (
            is_predefined = TRUE
            OR owner_account_id = $2
          )
        `,
        [planId, req.accountId]
      );

      if (plan.rowCount === 0) {
        res.status(400).json({ error: "Invalid user plan" });
        return;
      }

      const result = await pool.query(
        `
        INSERT INTO users (account_id, external_user_id, plan_id)
        VALUES ($1, $2, $3)
        RETURNING id, account_id, external_user_id, plan_id, created_at
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

router.get(
  "/",
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const result = await pool.query(
        `
        SELECT u.id, u.external_user_id, u.created_at,
               p.id AS plan_id, p.name AS plan_name
        FROM users u
        JOIN plans p ON p.id = u.plan_id
        WHERE u.account_id = $1
        ORDER BY u.created_at, u.id
        `,
        [req.accountId]
      );

      res.json({
        users: result.rows.map((user) => ({
          id: user.id,
          externalUserId: user.external_user_id,
          createdAt: user.created_at,
          plan: { id: user.plan_id, name: user.plan_name },
        })),
      });
    } catch (error) {
      next(error);
    }
  }
);

// Change a user's plan
router.put(
  "/:id/plan",
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const userId = req.params.id;
    const { planId } = req.body ?? {};

    if (
      typeof userId !== "string" ||
      !UUID_REGEX.test(userId) ||
      typeof planId !== "string" ||
      !UUID_REGEX.test(planId)
    ) {
      res.status(400).json({ error: "Invalid user ID or planId" });
      return;
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      await client.query(
        "SELECT id FROM accounts WHERE id = $1 FOR UPDATE",
        [req.accountId]
      );

      const user = await client.query(
        `
        SELECT id FROM users
        WHERE id = $1 AND account_id = $2
        FOR UPDATE
        `,
        [userId, req.accountId]
      );

      if (user.rowCount === 0) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "User not found" });
        return;
      }

      const plan = await client.query(
        `
        SELECT id FROM plans
        WHERE id = $1
          AND plan_type = 'USER'
          AND (
            is_predefined = TRUE
            OR owner_account_id = $2
          )
        `,
        [planId, req.accountId]
      );

      if (plan.rowCount === 0) {
        await client.query("ROLLBACK");
        res.status(400).json({ error: "Invalid user plan" });
        return;
      }

      await client.query(
        `
        UPDATE users
        SET plan_id = $1
        WHERE id = $2 AND account_id = $3
        `,
        [planId, userId, req.accountId]
      );

      await client.query("COMMIT");

      res.json({
        message: "User plan changed successfully",
        userId,
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

router.get(
  "/:id",
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.params.id;

      if (typeof userId !== "string" || !UUID_REGEX.test(userId)) {
        res.status(400).json({ error: "Invalid user ID" });
        return;
      }

      const result = await pool.query(
        `
        SELECT u.id, u.external_user_id, u.created_at,
               p.id AS plan_id, p.name AS plan_name,
               r.monthly_allowance::TEXT AS monthly_allowance,
               r.max_units_per_request::TEXT AS max_units_per_request
        FROM users u
        JOIN plans p ON p.id = u.plan_id
        JOIN plan_rules r ON r.plan_id = p.id
        WHERE u.id = $1 AND u.account_id = $2
        `,
        [userId, req.accountId]
      );

      if (result.rowCount === 0) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      const user = result.rows[0];

      res.json({
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
