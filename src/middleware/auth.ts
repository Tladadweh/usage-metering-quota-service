import { NextFunction, Request, Response } from "express";

import { pool } from "../db/pool";
import { hashApiKey } from "../services/apiKeys";

export interface AuthenticatedRequest extends Request {
  accountId?: string;
}

export async function authenticateApiKey(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const apiKey = req.header("X-API-Key");

    if (!apiKey) {
      res.status(401).json({
        error: "API key is required",
      });
      return;
    }

    if (!/^[a-f0-9]{64}$/.test(apiKey)) {
      res.status(401).json({
        error: "Invalid API key",
      });
      return;
    }

    const apiKeyHash = hashApiKey(apiKey);

    const result = await pool.query<{ id: string }>(
      `
      SELECT id
      FROM accounts
      WHERE api_key_hash = $1
      `,
      [apiKeyHash]
    );

    if (result.rowCount === 0) {
      res.status(401).json({
        error: "Invalid API key",
      });
      return;
    }

    req.accountId = result.rows[0].id;

    next();
  } catch (error) {
    next(error);
  }
}