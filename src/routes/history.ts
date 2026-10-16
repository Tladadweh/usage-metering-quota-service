
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
  monthBounds,
} from "../utils/month";

const router = Router();

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  
router.use(authenticateApiKey);

function parsePositiveInteger(
  value: unknown,
  defaultValue: number,
  max: number
): number | null {
  if (value === undefined) {
    return defaultValue;
  }

  if (
    typeof value !== "string" ||
    !/^[1-9]\d*$/.test(value)
  ) {
    return null;
  }

  const number = Number(value);

  if (!Number.isSafeInteger(number) || number > max) {
    return null;
  }

  return number;
}

// Retrieve request history.
router.get(
  "/",
  async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const month = parseMonth(req.query.month);
      const page = parsePositiveInteger(
        req.query.page,
        1,
        1000000
      );
      const limit = parsePositiveInteger(
        req.query.limit,
        20,
        100
      );

      if (month === null) {
        res.status(400).json({
          error: "month must have format YYYY-MM",
        });
        return;
      }

      if (page === null || limit === null) {
        res.status(400).json({
          error: "page must be 1-1000000 and limit must be 1-100",
        });
        return;
      }

      const rawUserId = req.query.userId;

      if (
        rawUserId !== undefined &&
        (
          typeof rawUserId !== "string" ||
          !UUID_REGEX.test(rawUserId)
        )
      ) {
        res.status(400).json({
          error: "Invalid userId",
        });
        return;
      }

      const userId = rawUserId ?? null;

      if (userId !== null) {
        const user = await pool.query(
          `
          SELECT id
          FROM users
          WHERE id = $1
            AND account_id = $2
          `,
          [userId, req.accountId]
        );

        if (user.rowCount === 0) {
          res.status(404).json({
            error: "User not found",
          });
          return;
        }
      }

      const { start, end } = monthBounds(month);
      const offset = (page - 1) * limit;

      const params = [
        req.accountId,
        start,
        end,
        userId,
      ];

      // Count records using explicit UTC month bounds.
      const countResult = await pool.query(
        `
        SELECT COUNT(*)::TEXT AS total
        FROM consumption_requests
        WHERE account_id = $1
          AND created_at >=
            ($2::DATE::TIMESTAMP AT TIME ZONE 'UTC')
          AND created_at <
            ($3::DATE::TIMESTAMP AT TIME ZONE 'UTC')
          AND (
            $4::UUID IS NULL
            OR user_id = $4::UUID
          )
        `,
        params
      );

      // Use exactly the same UTC month bounds
      // when fetching paginated records.
      const result = await pool.query(
        `
        SELECT
          id,
          user_id,
          request_id,
          units::TEXT AS units,
          accepted,
          rejection_scope,
          rejection_rule,
          created_at
        FROM consumption_requests
        WHERE account_id = $1
          AND created_at >=
            ($2::DATE::TIMESTAMP AT TIME ZONE 'UTC')
          AND created_at <
            ($3::DATE::TIMESTAMP AT TIME ZONE 'UTC')
          AND (
            $4::UUID IS NULL
            OR user_id = $4::UUID
          )
        ORDER BY created_at DESC, id DESC
        LIMIT $5 OFFSET $6
        `,
        [...params, limit, offset]
      );

      const total = Number(countResult.rows[0].total);

      res.json({
        month,
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        requests: result.rows.map((row) => ({
          id: row.id,
          userId: row.user_id,
          requestId: row.request_id,
          units: row.units,
          accepted: row.accepted,
          rejectionScope: row.rejection_scope,
          rejectionRule: row.rejection_rule,
          createdAt: row.created_at,
        })),
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
