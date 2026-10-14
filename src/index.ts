import express, {
  NextFunction,
  Request,
  Response,
} from "express";

import { pool } from "./db/pool";

import accountsRouter from "./routes/accounts";
import usersRouter from "./routes/users";
import plansRouter from "./routes/plans";
import swaggerRouter from "./swagger";

const app = express();

const PORT = Number(process.env.PORT ?? 3000);

app.use(express.json());

// Swagger documentation
app.use("/api-docs", swaggerRouter);

// Health check
app.get(
  "/health",
  async (_req: Request, res: Response) => {
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
  }
);

// API routes
app.use("/accounts", accountsRouter);
app.use("/users", usersRouter);
app.use("/plans", plansRouter);

// Unknown endpoints
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    error: "Endpoint not found",
  });
});

// Application error handler
app.use(
  (
    error: Error & { status?: number },
    _req: Request,
    res: Response,
    _next: NextFunction
  ) => {
    if (
      error instanceof SyntaxError &&
      error.status === 400
    ) {
      res.status(400).json({
        error: "Invalid JSON request body",
      });
      return;
    }

    console.error("Application error:", error);

    res.status(500).json({
      error: "Internal server error",
    });
  }
);

const server = app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

let shuttingDown = false;

function shutdown(): void {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  console.log("Shutting down...");

  server.close(() => {
    pool
      .end()
      .then(() => {
        process.exitCode = 0;
      })
      .catch((error) => {
        console.error("Shutdown failed:", error);
        process.exitCode = 1;
      });
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);