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
import fs from "node:fs";
import path from "node:path";

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
    express.json({ limit: "1mb" })(req, res, (err) => {
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

  // ── Module Status API (before module loading) ────
  app.get("/api/v1/admin/modules/status", (_req, res) => {
    res.json({
      modules: config.modules,
    });
  });

  // ── Module Toggle API — update .env and respond ──
  const ENV_KEY_MAP: Record<string, string> = {
    auth: "GRC_MODULE_AUTH",
    clawhub: "GRC_MODULE_CLAWHUB",
    evolution: "GRC_MODULE_EVOLUTION",
    update: "GRC_MODULE_UPDATE",
    telemetry: "GRC_MODULE_TELEMETRY",
    community: "GRC_MODULE_COMMUNITY",
    platform: "GRC_MODULE_PLATFORM",
    roles: "GRC_MODULE_ROLES",
    tasks: "GRC_MODULE_TASKS",
    relay: "GRC_MODULE_RELAY",
    strategy: "GRC_MODULE_STRATEGY",
    "a2a-gateway": "GRC_MODULE_A2A_GATEWAY",
    meetings: "GRC_MODULE_MEETINGS",
    "model-keys": "GRC_MODULE_MODEL_KEYS",
  };

  app.patch("/api/v1/admin/modules", (req, res) => {
    const updates = req.body as Record<string, boolean>;
    if (!updates || typeof updates !== "object") {
      return res.status(400).json({ error: "bad_request", message: "Body must be an object of module toggles" });
    }

    // Resolve .env path (project root)
    const envPath = path.resolve(
      path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")),
      "..",
      ".env",
    );

    try {
      let envContent = "";
      try {
        envContent = fs.readFileSync(envPath, "utf-8");
      } catch {
        // .env doesn't exist yet — will create
      }

      for (const [moduleKey, enabled] of Object.entries(updates)) {
        const envKey = ENV_KEY_MAP[moduleKey];
        if (!envKey) continue;

        const val = enabled ? "true" : "false";
        const regex = new RegExp(`^${envKey}=.*$`, "m");
        if (regex.test(envContent)) {
          envContent = envContent.replace(regex, `${envKey}=${val}`);
        } else {
          // Append the new key
          envContent = envContent.trimEnd() + `\n${envKey}=${val}\n`;
        }
      }

      fs.writeFileSync(envPath, envContent, "utf-8");
      logger.info({ updates }, "Module toggles saved to .env");
      return res.json({ success: true, message: "Saved. Restart server to apply." });
    } catch (err) {
      logger.error({ err }, "Failed to update .env");
      return res.status(500).json({ error: "internal", message: "Failed to save configuration" });
    }
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

  // ── Weekly Digest Cron (Friday 18:00 JST = 09:00 UTC) ──
  try {
    const cron = await import("node-cron");
    const { generateWeeklyDigest } = await import("./modules/community/weekly-digest.js");
    cron.default.schedule("0 9 * * 5", () => {
      generateWeeklyDigest().catch((err) =>
        logger.warn({ err }, "Weekly digest cron failed"),
      );
    });
    logger.info("Weekly digest cron scheduled (Fridays 09:00 UTC / 18:00 JST)");
  } catch (err) {
    logger.warn({ err }, "Failed to register weekly digest cron — node-cron may not be installed");
  }

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
