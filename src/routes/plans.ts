
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

const router = Router();

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidLimit(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

function formatPlan(row: any) {
  return {
    id: row.id,
    name: row.name,
    planType: row.plan_type,
    isPredefined: row.is_predefined,
    monthlyAllowance: row.monthly_allowance,
    maxUnitsPerRequest: row.max_units_per_request,
  };
}

// Public predefined plans
router.get(
  "/",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const type = req.query.type;

      if (
        type !== undefined &&
        type !== "ACCOUNT" &&
        type !== "USER"
      ) {
        res.status(400).json({
          error: "type must be ACCOUNT or USER",
        });
        return;
      }

      const result = await pool.query(
        `
        SELECT
          p.id, p.name, p.plan_type, p.is_predefined,
          r.monthly_allowance::TEXT AS monthly_allowance,
          r.max_units_per_request::TEXT AS max_units_per_request
        FROM plans p
        JOIN plan_rules r ON r.plan_id = p.id
        WHERE p.is_predefined = TRUE
          AND ($1::TEXT IS NULL OR p.plan_type = $1)
        ORDER BY p.plan_type, p.name
        `,
        [type ?? null]
      );

      res.json({ plans: result.rows.map(formatPlan) });
    } catch (error) {
      next(error);
    }
  }
);

// Plans available to authenticated account
router.get(
  "/mine",
  authenticateApiKey,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const result = await pool.query(
        `
        SELECT
          p.id, p.name, p.plan_type, p.is_predefined,
          r.monthly_allowance::TEXT AS monthly_allowance,
          r.max_units_per_request::TEXT AS max_units_per_request
        FROM plans p
        JOIN plan_rules r ON r.plan_id = p.id
        WHERE p.is_predefined = TRUE
           OR p.owner_account_id = $1
        ORDER BY p.plan_type, p.name
        `,
        [req.accountId]
      );

      res.json({ plans: result.rows.map(formatPlan) });
    } catch (error) {
      next(error);
    }
  }
);

// Create custom plan
router.post(
  "/",
  authenticateApiKey,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const {
        name,
        planType,
        monthlyAllowance,
        maxUnitsPerRequest,
      } = req.body ?? {};

      if (
        typeof name !== "string" ||
        name.trim().length === 0 ||
        name.trim().length > 100
      ) {
        res.status(400).json({ error: "Invalid plan name" });
        return;
      }

      if (planType !== "ACCOUNT" && planType !== "USER") {
        res.status(400).json({
          error: "planType must be ACCOUNT or USER",
        });
        return;
      }

      if (
        !isValidLimit(monthlyAllowance) ||
        !isValidLimit(maxUnitsPerRequest) ||
        maxUnitsPerRequest === 0
      ) {
        res.status(400).json({
          error: "Limits must be valid non-negative integers; maxUnitsPerRequest must be positive",
        });
        return;
      }

      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        const planResult = await client.query(
          `
          INSERT INTO plans (
            owner_account_id,
            name,
            plan_type,
            is_predefined
          )
          VALUES ($1, $2, $3, FALSE)
          RETURNING id
          `,
          [req.accountId, name.trim(), planType]
        );

        const planId = planResult.rows[0].id;

        await client.query(
          `
          INSERT INTO plan_rules (
            plan_id,
            monthly_allowance,
            max_units_per_request
          )
          VALUES ($1, $2, $3)
          `,
          [planId, monthlyAllowance, maxUnitsPerRequest]
        );

        await client.query("COMMIT");

        res.status(201).json({
          message: "Custom plan created",
          plan: {
            id: planId,
            name: name.trim(),
            planType,
            isPredefined: false,
            monthlyAllowance: String(monthlyAllowance),
            maxUnitsPerRequest: String(maxUnitsPerRequest),
          },
        });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      next(error);
    }
  }
);

// Update custom plan
router.patch(
  "/:id",
  authenticateApiKey,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const planId = req.params.id;

    if (typeof planId !== "string" || !UUID_REGEX.test(planId)) {
      res.status(400).json({ error: "Invalid plan ID" });
      return;
    }

    const body = req.body ?? {};
    const allowedFields = [
      "name",
      "monthlyAllowance",
      "maxUnitsPerRequest",
    ];

    if (
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).length === 0 ||
      Object.keys(body).some((key) => !allowedFields.includes(key))
    ) {
      res.status(400).json({
        error: "Only name and plan limits can be updated",
      });
      return;
    }

    if (
      (body.name !== undefined &&
        (typeof body.name !== "string" ||
          body.name.trim().length === 0 ||
          body.name.trim().length > 100)) ||
      (body.monthlyAllowance !== undefined &&
        !isValidLimit(body.monthlyAllowance)) ||
      (body.maxUnitsPerRequest !== undefined &&
        (!isValidLimit(body.maxUnitsPerRequest) ||
          body.maxUnitsPerRequest === 0))
    ) {
      res.status(400).json({ error: "Invalid plan data" });
      return;
    }

    let client;

    try {
      client = await pool.connect();
      await client.query("BEGIN");

      // Serialize with consumption and plan assignment.
      await client.query(
        "SELECT id FROM accounts WHERE id = $1 FOR UPDATE",
        [req.accountId]
      );

      const existing = await client.query(
        `
        SELECT p.id
        FROM plans p
        WHERE p.id = $1
          AND p.owner_account_id = $2
          AND p.is_predefined = FALSE
        FOR UPDATE
        `,
        [planId, req.accountId]
      );

      if (existing.rowCount === 0) {
        await client.query("ROLLBACK");
        res.status(404).json({
          error: "Custom plan not found",
        });
        return;
      }

      const updated = await client.query(
        `
        UPDATE plans p
        SET name = COALESCE($1::VARCHAR, p.name)
        WHERE p.id = $2
        RETURNING p.id, p.name, p.plan_type
        `,
        [body.name === undefined ? null : body.name.trim(), planId]
      );

      const rules = await client.query(
        `
        UPDATE plan_rules
        SET
          monthly_allowance =
            COALESCE($1::BIGINT, monthly_allowance),
          max_units_per_request =
            COALESCE($2::BIGINT, max_units_per_request)
        WHERE plan_id = $3
        RETURNING
          monthly_allowance::TEXT AS monthly_allowance,
          max_units_per_request::TEXT AS max_units_per_request
        `,
        [
          body.monthlyAllowance ?? null,
          body.maxUnitsPerRequest ?? null,
          planId,
        ]
      );

      await client.query("COMMIT");

      res.json({
        message: "Custom plan updated",
        plan: {
          id: updated.rows[0].id,
          name: updated.rows[0].name,
          planType: updated.rows[0].plan_type,
          monthlyAllowance: rules.rows[0].monthly_allowance,
          maxUnitsPerRequest: rules.rows[0].max_units_per_request,
        },
      });
    } catch (error) {
      if (client) await client.query("ROLLBACK");
      next(error);
    } finally {
      client?.release();
    }
  }
);

export default router;
