
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
import {
  parseMonth,
  monthStart,
  remaining,
} from "../utils/month";

const router = Router();

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.use(authenticateApiKey);

// Account usage for a UTC month.
router.get(
  "/account",
  async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const month = parseMonth(req.query.month);

      if (month === null) {
        res.status(400).json({
          error: "month must have format YYYY-MM",
        });
        return;
      }

      const result = await pool.query(
        `
        SELECT
          a.id,
          a.name,
          p.id AS plan_id,
          p.name AS plan_name,
          r.monthly_allowance::TEXT AS monthly_allowance,
          r.max_units_per_request::TEXT AS max_units_per_request,
          COALESCE(c.consumed_units, 0)::TEXT AS consumed
        FROM accounts a
        JOIN plans p ON p.id = a.plan_id
        JOIN plan_rules r ON r.plan_id = p.id
        LEFT JOIN usage_counters c
          ON c.account_id = a.id
         AND c.user_id IS NULL
         AND c.month_start = $2::DATE
        WHERE a.id = $1
        `,
        [req.accountId, monthStart(month)]
      );

      if (result.rowCount === 0) {
        res.status(404).json({
          error: "Account not found",
        });
        return;
      }

      const account = result.rows[0];

      res.json({
        month,
        account: {
          id: account.id,
          name: account.name,
          plan: {
            id: account.plan_id,
            name: account.plan_name,
            monthlyAllowance: account.monthly_allowance,
            maxUnitsPerRequest: account.max_units_per_request,
          },
          usage: {
            consumed: account.consumed,
            remaining: remaining(
              account.monthly_allowance,
              account.consumed
            ),
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// User usage for a UTC month.
router.get(
  "/users/:id",
  async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const userId = req.params.id;
      const month = parseMonth(req.query.month);

      if (
        typeof userId !== "string" ||
        !UUID_REGEX.test(userId)
      ) {
        res.status(400).json({
          error: "Invalid user ID",
        });
        return;
      }

      if (month === null) {
        res.status(400).json({
          error: "month must have format YYYY-MM",
        });
        return;
      }

      const result = await pool.query(
        `
        SELECT
          u.id,
          u.external_user_id,
          p.id AS plan_id,
          p.name AS plan_name,
          r.monthly_allowance::TEXT AS monthly_allowance,
          r.max_units_per_request::TEXT AS max_units_per_request,
          COALESCE(c.consumed_units, 0)::TEXT AS consumed
        FROM users u
        JOIN plans p ON p.id = u.plan_id
        JOIN plan_rules r ON r.plan_id = p.id
        LEFT JOIN usage_counters c
          ON c.account_id = u.account_id
         AND c.user_id = u.id
         AND c.month_start = $3::DATE
        WHERE u.id = $1
          AND u.account_id = $2
        `,
        [userId, req.accountId, monthStart(month)]
      );

      if (result.rowCount === 0) {
        res.status(404).json({
          error: "User not found",
        });
        return;
      }

      const user = result.rows[0];

      res.json({
        month,
        user: {
          id: user.id,
          externalUserId: user.external_user_id,
          plan: {
            id: user.plan_id,
            name: user.plan_name,
            monthlyAllowance: user.monthly_allowance,
            maxUnitsPerRequest: user.max_units_per_request,
          },
          usage: {
            consumed: user.consumed,
            remaining: remaining(
              user.monthly_allowance,
              user.consumed
            ),
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
