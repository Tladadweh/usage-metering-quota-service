import { Pool } from "pg";

export const pool = new Pool({
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 5432),
  database: process.env.DB_NAME ?? "quota_db",
  user: process.env.DB_USER ?? "quota_app",
  password: process.env.DB_PASSWORD,
  max: 10,
  connectionTimeoutMillis: 5000,
});

pool.on("error", (error) => {
  console.error("Unexpected PostgreSQL pool error:", error);
});