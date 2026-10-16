
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

router.use(authenticateApiKey);

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Scope = "ACCOUNT" | "USER";
type Rule = "MAX_PER_REQUEST" | "MONTHLY_ALLOWANCE";

interface Decision {
  accepted: boolean;
  rejectionScope: Scope | null;
  rejectionRule: Rule | null;
}

function evaluateQuota(
  units: bigint,
  accountUsed: bigint,
  userUsed: bigint,
  accountMonthly: bigint,
  accountMax: bigint,
  userMonthly: bigint,
  userMax: bigint
): Decision {
  if (units > accountMax) {
    return {
      accepted: false,
      rejectionScope: "ACCOUNT",
      rejectionRule: "MAX_PER_REQUEST",
    };
  }

  if (units > userMax) {
    return {
      accepted: false,
      rejectionScope: "USER",
      rejectionRule: "MAX_PER_REQUEST",
    };
  }

  if (accountUsed + units > accountMonthly) {
    return {
      accepted: false,
      rejectionScope: "ACCOUNT",
      rejectionRule: "MONTHLY_ALLOWANCE",
    };
  }

  if (userUsed + units > userMonthly) {
    return {
      accepted: false,
      rejectionScope: "USER",
      rejectionRule: "MONTHLY_ALLOWANCE",
    };
  }

  return {
    accepted: true,
    rejectionScope: null,
    rejectionRule: null,
  };
}

router.post(
  "/",
  async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => {
    const { userId, units, requestId } = req.body ?? {};

    if (
      typeof userId !== "string" ||
      !UUID_REGEX.test(userId)
    ) {
      res.status(400).json({ error: "Invalid userId" });
      return;
    }

    if (
      typeof units !== "number" ||
      !Number.isSafeInteger(units) ||
      units <= 0
    ) {
      res.status(400).json({
        error: "units must be a positive safe integer",
      });
      return;
    }

    if (
      typeof requestId !== "string" ||
      requestId.length === 0 ||
      requestId.length > 100
    ) {
      res.status(400).json({ error: "Invalid requestId" });
      return;
    }

    // UUIDs are case-insensitive in PostgreSQL.
    const normalizedUserId = userId.toLowerCase();

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // Serialize consumption within the account.
      await client.query(
        `
        SELECT id
        FROM accounts
        WHERE id = $1
        FOR UPDATE
        `,
        [req.accountId]
      );

      // Idempotency check, inside the transaction.
      const existing = await client.query(
        `
        SELECT
          user_id,
          units::TEXT AS units,
          accepted,
          rejection_scope,
          rejection_rule
        FROM consumption_requests
        WHERE account_id = $1 AND request_id = $2
        `,
        [req.accountId, requestId]
      );

      if (existing.rowCount !== 0) {
        const previous = existing.rows[0];

        if (
          previous.user_id !== normalizedUserId ||
          previous.units !== String(units)
        ) {
          await client.query("ROLLBACK");

          res.status(409).json({
            error: "requestId was already used with different data",
          });
          return;
        }

        await client.query("COMMIT");

        res.json({
          requestId,
          accepted: previous.accepted,
          rejectionScope: previous.rejection_scope,
          rejectionRule: previous.rejection_rule,
          replayed: true,
        });
        return;
      }

      // Verify the user belongs to this account.
      const userResult = await client.query(
        `
        SELECT
          u.id,
          ar.monthly_allowance::TEXT AS account_monthly,
          ar.max_units_per_request::TEXT AS account_max,
          ur.monthly_allowance::TEXT AS user_monthly,
          ur.max_units_per_request::TEXT AS user_max
        FROM users u
        JOIN accounts a ON a.id = u.account_id
        JOIN plan_rules ar ON ar.plan_id = a.plan_id
        JOIN plan_rules ur ON ur.plan_id = u.plan_id
        WHERE u.id = $1 AND u.account_id = $2
        `,
        [normalizedUserId, req.accountId]
      );

      if (userResult.rowCount === 0) {
        await client.query("ROLLBACK");

        res.status(404).json({ error: "User not found" });
        return;
      }

      // Capture one database timestamp AFTER acquiring the
      // account lock. Use it for both the usage month and
      // the stored decision timestamp.
      const timeResult = await client.query(
        `
        SELECT
          captured.occurred_at,
          DATE_TRUNC(
            'month',
            captured.occurred_at AT TIME ZONE 'UTC'
          )::DATE AS month_start
        FROM (
          SELECT clock_timestamp() AS occurred_at
        ) AS captured
        `
      );

      const occurredAt = timeResult.rows[0].occurred_at;
      const monthStart = timeResult.rows[0].month_start;

      // Read current account and user usage.
      const usageResult = await client.query(
        `
        SELECT
          COALESCE(
            MAX(consumed_units) FILTER (WHERE user_id IS NULL),
            0
          )::TEXT AS account_used,
          COALESCE(
            MAX(consumed_units) FILTER (WHERE user_id = $2),
            0
          )::TEXT AS user_used
        FROM usage_counters
        WHERE account_id = $1
          AND month_start = $3
        `,
        [req.accountId, normalizedUserId, monthStart]
      );

      const limits = userResult.rows[0];
      const usage = usageResult.rows[0];

      const requestedUnits = BigInt(units);
      const accountUsed = BigInt(usage.account_used);
      const userUsed = BigInt(usage.user_used);
      const accountMonthly = BigInt(limits.account_monthly);
      const userMonthly = BigInt(limits.user_monthly);

      const decision = evaluateQuota(
        requestedUnits,
        accountUsed,
        userUsed,
        accountMonthly,
        BigInt(limits.account_max),
        userMonthly,
        BigInt(limits.user_max)
      );

      if (decision.accepted) {
        // Update shared account counter.
        await client.query(
          `
          INSERT INTO usage_counters (
            account_id,
            user_id,
            month_start,
            consumed_units
          )
          VALUES ($1, NULL, $2, $3)
          ON CONFLICT (account_id, month_start)
            WHERE user_id IS NULL
          DO UPDATE SET
            consumed_units =
              usage_counters.consumed_units + EXCLUDED.consumed_units
          `,
          [req.accountId, monthStart, String(units)]
        );

        // Update independent user counter.
        await client.query(
          `
          INSERT INTO usage_counters (
            account_id,
            user_id,
            month_start,
            consumed_units
          )
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (account_id, user_id, month_start)
            WHERE user_id IS NOT NULL
          DO UPDATE SET
            consumed_units =
              usage_counters.consumed_units + EXCLUDED.consumed_units
          `,
          [
            req.accountId,
            normalizedUserId,
            monthStart,
            String(units),
          ]
        );
      }

      // Record accepted and rejected decisions with the
      // same timestamp used to determine the UTC month.
      await client.query(
        `
        INSERT INTO consumption_requests (
          account_id,
          user_id,
          request_id,
          units,
          accepted,
          rejection_scope,
          rejection_rule,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `,
        [
          req.accountId,
          normalizedUserId,
          requestId,
          String(units),
          decision.accepted,
          decision.rejectionScope,
          decision.rejectionRule,
          occurredAt,
        ]
      );

      await client.query("COMMIT");

      const newAccountUsed =
        accountUsed +
        (decision.accepted ? requestedUnits : 0n);

      const newUserUsed =
        userUsed +
        (decision.accepted ? requestedUnits : 0n);

      res.json({
        requestId,
        accepted: decision.accepted,
        rejectionScope: decision.rejectionScope,
        rejectionRule: decision.rejectionRule,
        replayed: false,
        usage: {
          account: {
            consumed: newAccountUsed.toString(),
            remaining: (
              accountMonthly > newAccountUsed
                ? accountMonthly - newAccountUsed
                : 0n
            ).toString(),
          },
          user: {
            consumed: newUserUsed.toString(),
            remaining: (
              userMonthly > newUserUsed
                ? userMonthly - newUserUsed
                : 0n
            ).toString(),
          },
        },
      });
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Rollback failed:", rollbackError);
      }

      next(error);
    } finally {
      client.release();
    }
  }
);

export default router;
