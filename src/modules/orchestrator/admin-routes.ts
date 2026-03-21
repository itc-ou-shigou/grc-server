import { Router } from "express";
import type { Express, Request, Response } from "express";
import pino from "pino";
import type { GrcConfig } from "../../config.js";
import { createAuthMiddleware } from "../../shared/middleware/auth.js";
import { createAdminAuthMiddleware } from "../../shared/middleware/admin-auth.js";
import { asyncHandler } from "../../shared/middleware/error-handler.js";
import { orchestratorService } from "./service.js";
import { sessionTracker } from "./session-tracker.js";
import { clawTeamBridge } from "./clawteam-bridge.js";

const logger = pino({ name: "admin:orchestrator" });

export async function registerAdmin(app: Express, config: GrcConfig): Promise<void> {
  const router = Router();
  const requireAuth = createAuthMiddleware(config, true);
  const requireAdmin = createAdminAuthMiddleware(config);

  // GET /admin/orchestrator/status - Overall orchestrator status
  router.get(
    "/status",
    requireAuth,
    requireAdmin,
    asyncHandler(async (_req: Request, res: Response) => {
      const clawteamAvailable = await clawTeamBridge.isAvailable();
      const activeSessions = sessionTracker.getActiveSessionCount();
      const enabled = process.env.GRC_CLAWTEAM_ENABLED === "true";

      res.json({
        ok: true,
        status: {
          enabled,
          clawteamAvailable,
          activeSessions,
          maxSessions: parseInt(process.env.GRC_SWARM_MAX_SESSIONS ?? "3", 10),
          maxAgents: parseInt(process.env.GRC_SWARM_MAX_AGENTS ?? "15", 10),
          complexityThreshold: parseInt(process.env.GRC_SWARM_COMPLEXITY_THRESHOLD ?? "60", 10),
          pollIntervalMs: parseInt(process.env.GRC_SWARM_POLL_INTERVAL_MS ?? "15000", 10),
        },
      });
    }),
  );

  // GET /admin/orchestrator/sessions - List all sessions
  router.get(
    "/sessions",
    requireAuth,
    requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const status = req.query.status as string | undefined;
      const sessions = await orchestratorService.listSessions(undefined, status);
      res.json({ ok: true, sessions });
    }),
  );

  // POST /admin/orchestrator/sessions/:id/abort - Force abort session
  router.post(
    "/sessions/:id/abort",
    requireAuth,
    requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      await orchestratorService.abortSession(req.params.id as string);
      res.json({ ok: true, message: "Session aborted by admin" });
    }),
  );

  app.use("/api/v1/admin/orchestrator", router);
  logger.info("Orchestrator admin routes registered");
}
