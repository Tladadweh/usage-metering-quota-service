import { Router, Request, Response, NextFunction } from "express";

import { pool } from "../db/pool";

const router = Router();

// List predefined plans
router.get(
  "/",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rawType = req.query.type;

      if (
        rawType !== undefined &&
        rawType !== "ACCOUNT" &&
        rawType !== "USER"
      ) {
        res.status(400).json({
          error: "type must be ACCOUNT or USER",
        });
        return;
      }

      const result = await pool.query(
        `
        SELECT
          p.id,
          p.name,
          p.plan_type,
          p.is_predefined,
          r.monthly_allowance::TEXT AS monthly_allowance,
          r.max_units_per_request::TEXT
            AS max_units_per_request
        FROM plans p
        JOIN plan_rules r ON r.plan_id = p.id
        WHERE p.is_predefined = TRUE
          AND (
            $1::TEXT IS NULL
            OR p.plan_type = $1
          )
        ORDER BY p.plan_type, p.name
        `,
        [rawType ?? null]
      );

      res.status(200).json({
        plans: result.rows.map((plan) => ({
          id: plan.id,
          name: plan.name,
          planType: plan.plan_type,
          isPredefined: plan.is_predefined,
          monthlyAllowance: plan.monthly_allowance,
          maxUnitsPerRequest: plan.max_units_per_request,
        })),
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;