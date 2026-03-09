/**
 * A2A Gateway Module — Admin Routes
 *
 * Provides admin-only management endpoints for the Agent Card registry.
 * All routes require JWT authentication + admin role.
 */

import { Router } from "express";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import pino from "pino";
import type { GrcConfig } from "../../config.js";
import { createAuthMiddleware } from "../../shared/middleware/auth.js";
import { createAdminAuthMiddleware } from "../../shared/middleware/admin-auth.js";
import {
  asyncHandler,
} from "../../shared/middleware/error-handler.js";
import { nodeIdSchema } from "../../shared/utils/validators.js";
import { AgentCardService } from "./service.js";

const logger = pino({ name: "admin:a2a-gateway" });

// ── Zod Schemas ─────────────────────────────────

const agentListQuerySchema = z.object({
  status: z.enum(["online", "offline", "busy"]).optional(),
});

const setStatusSchema = z.object({
  status: z.enum(["online", "offline", "busy"]),
});

// ── Route Registration ──────────────────────────

export async function registerAdmin(app: Express, config: GrcConfig) {
  const router = Router();
  const requireAuth = createAuthMiddleware(config);
  const requireAdmin = createAdminAuthMiddleware(config);
  const service = new AgentCardService();

  // ── GET /a2a/agents/stats — Agent statistics ──

  router.get(
    "/a2a/agents/stats",
    requireAuth,
    requireAdmin,
    asyncHandler(async (_req: Request, res: Response) => {
      const stats = await service.getStats();

      res.json({ stats });
    }),
  );

  // ── GET /a2a/agents — List all agent cards ──

  router.get(
    "/a2a/agents",
    requireAuth,
    requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const query = agentListQuerySchema.parse(req.query);

      const agents = await service.listAgentCards({
        status: query.status,
      });

      res.json({
        data: agents,
        count: agents.length,
      });
    }),
  );

  // ── GET /a2a/agents/:nodeId — Agent Card detail ──

  router.get(
    "/a2a/agents/:nodeId",
    requireAuth,
    requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const nodeId = nodeIdSchema.parse(req.params.nodeId);

      const card = await service.getAgentCard(nodeId);

      res.json({ data: card });
    }),
  );

  // ── PUT /a2a/agents/:nodeId/status — Set agent status ──

  router.put(
    "/a2a/agents/:nodeId/status",
    requireAuth,
    requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const nodeId = nodeIdSchema.parse(req.params.nodeId);
      const body = setStatusSchema.parse(req.body);

      const result = await service.setStatus(nodeId, body.status);

      logger.info(
        { nodeId, status: body.status, admin: req.auth?.sub },
        "Agent status updated by admin",
      );

      res.json({ data: result });
    }),
  );

  // ── DELETE /a2a/agents/:nodeId — Delete agent card ──

  router.delete(
    "/a2a/agents/:nodeId",
    requireAuth,
    requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const nodeId = nodeIdSchema.parse(req.params.nodeId);

      const result = await service.deleteAgentCard(nodeId);

      logger.info(
        { nodeId, admin: req.auth?.sub },
        "Agent card deleted by admin",
      );

      res.json({ ok: true, deleted: result.deleted });
    }),
  );

  // ── POST /a2a/agents/cleanup — Mark stale agents offline ──

  router.post(
    "/a2a/agents/cleanup",
    requireAuth,
    requireAdmin,
    asyncHandler(async (_req: Request, res: Response) => {
      await service.markStaleOffline();

      logger.info("Stale agents cleanup completed");

      res.json({ ok: true, cleaned: true });
    }),
  );

  // ── Mount ─────────────────────────────────────

  app.use("/api/v1/admin", router);
  logger.info("A2A Gateway admin routes registered");
}
