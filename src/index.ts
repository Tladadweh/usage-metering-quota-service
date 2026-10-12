import express, { Request, Response } from "express";
import { Pool } from "pg";

const app = express();

const PORT = Number(process.env.PORT ?? 3000);

const pool = new Pool({
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 5432),
  database: process.env.DB_NAME ?? "quota_db",
  user: process.env.DB_USER ?? "quota_app",
  password: process.env.DB_PASSWORD,
  max: 10,
  connectionTimeoutMillis: 5000,
});

app.use(express.json());

app.get("/health", async (_req: Request, res: Response) => {
  try {
    await pool.query("SELECT 1");

    res.status(200).json({
      status: "ok",
      database: "connected",
    });
  } catch (error) {
    console.error("Database health check failed:", error);

    res.status(503).json({
      status: "error",
      database: "disconnected",
    });
  }
});

const server = app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

async function shutdown(): Promise<void> {
  console.log("Shutting down...");

  server.close(async () => {
    try {
      await pool.end();
      process.exit(0);
    } catch (error) {
      console.error("Shutdown failed:", error);
      process.exit(1);
    }
  });
}

process.on("SIGINT", () => {
  void shutdown();
});

process.on("SIGTERM", () => {
  void shutdown();
});