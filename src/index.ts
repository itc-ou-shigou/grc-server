/**
 * GRC Server — Express Application Entry Point
 *
 * Modular Monolith: All modules share this Express instance.
 * Modules are loaded dynamically based on environment config.
 */

import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import pino from "pino";

import { loadConfig } from "./config.js";
import { initDatabase, closeDatabase } from "./shared/db/connection.js";
import { loadModules } from "./module-loader.js";
import { requestLogger } from "./shared/middleware/request-logger.js";
import { errorHandler } from "./shared/middleware/error-handler.js";

const logger = pino({ name: "grc-server" });

async function main() {
  // ── Load Configuration ────────────────────────────
  const config = loadConfig();
  logger.info(
    { port: config.port, env: config.nodeEnv },
    "Starting GRC server",
  );

  // ── Initialize Database ───────────────────────────
  await initDatabase(config.database.url);

  // ── Create Express App ────────────────────────────
  const app = express();

  // Global middleware
  app.use(helmet());
  app.use(
    cors({
      origin: config.nodeEnv === "production"
        ? ["https://grc.winclawhub.ai", "https://admin.winclawhub.ai"]
        : true,
      credentials: true,
    }),
  );
  app.use((req, res, next) => {
    express.json({ limit: "10mb" })(req, res, (err) => {
      if (err) {
        return res.status(400).json({
          error: "bad_request",
          message: "Invalid JSON in request body",
        });
      }
      next();
    });
  });
  app.use(express.urlencoded({ extended: true }));
  app.use(requestLogger);

  // ── Health Check (before modules) ─────────────────
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      service: "grc-server",
      version: process.env.npm_package_version ?? "0.1.0",
      timestamp: new Date().toISOString(),
    });
  });

  // ── Load Modules Dynamically ──────────────────────
  const loaded = await loadModules(app, config);
  logger.info({ modules: loaded }, "Modules loaded");

  // ── 404 Handler (before error handler) ─────────────
  app.use((_req, res) => {
    res.status(404).json({
      error: "not_found",
      message: "Endpoint not found",
    });
  });

  // ── Global Error Handler (must be last) ───────────
  app.use(errorHandler);

  // ── Start Server ──────────────────────────────────
  const server = app.listen(config.port, () => {
    logger.info(
      { port: config.port, modules: loaded },
      `GRC server listening on port ${config.port}`,
    );
  });

  // ── Graceful Shutdown ─────────────────────────────
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutting down gracefully");
    server.close(async () => {
      await closeDatabase();
      logger.info("Server stopped");
      process.exit(0);
    });

    // Force exit after 10s
    setTimeout(() => {
      logger.error("Forced shutdown after timeout");
      process.exit(1);
    }, 10_000);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  logger.fatal({ err }, "Failed to start GRC server");
  process.exit(1);
});
