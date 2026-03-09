/**
 * A2A Gateway Module — Agent-Facing Routes
 *
 * Endpoints for agents to register Agent Cards, send heartbeats,
 * and discover other agents.
 * All routes are under /a2a/*.
 */

import { Router } from "express";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import pino from "pino";
import type { GrcConfig } from "../../config.js";
import { createAuthMiddleware } from "../../shared/middleware/auth.js";
import {
  asyncHandler,
} from "../../shared/middleware/error-handler.js";
import { rateLimitMiddleware } from "../../shared/middleware/rate-limit.js";
import { nodeIdSchema } from "../../shared/utils/validators.js";
import { AgentCardService } from "./service.js";

const logger = pino({ name: "module:a2a-gateway" });

// ── Request Validation Schemas ──────────────────

const registerAgentCardSchema = z.object({
  node_id: nodeIdSchema,
  agent_card: z.record(z.unknown()),
  skills: z.array(z.record(z.unknown())).optional(),
  capabilities: z.record(z.unknown()).optional(),
});

const heartbeatSchema = z.object({
  node_id: nodeIdSchema,
});

const listAgentsQuerySchema = z.object({
  status: z.enum(["online", "offline", "busy"]).optional(),
});

// ── Module Registration ─────────────────────────

export async function register(app: Express, config: GrcConfig): Promise<void> {
  const router = Router();
  const service = new AgentCardService();
  const authOptional = createAuthMiddleware(config, false);
  const authRequired = createAuthMiddleware(config, true);

  // ────────────────────────────────────────────
  // POST /a2a/agents/register — Register/update Agent Card
  // ────────────────────────────────────────────
  router.post(
    "/agents/register",
    authRequired,
    rateLimitMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const body = registerAgentCardSchema.parse(req.body);

      const card = await service.upsertAgentCard({
        nodeId: body.node_id,
        agentCard: body.agent_card,
        skills: body.skills,
        capabilities: body.capabilities,
      });

      logger.debug({ nodeId: body.node_id }, "Agent card registered via A2A");

      res.status(200).json({ ok: true, data: card });
    }),
  );

  // ────────────────────────────────────────────
  // POST /a2a/agents/heartbeat — Update heartbeat
  // ────────────────────────────────────────────
  router.post(
    "/agents/heartbeat",
    authRequired,
    asyncHandler(async (req: Request, res: Response) => {
      const body = heartbeatSchema.parse(req.body);

      const result = await service.heartbeat(body.node_id);

      res.json({ ok: true, data: result });
    }),
  );

  // ────────────────────────────────────────────
  // GET /a2a/agents — List all agents (with optional status filter)
  // ────────────────────────────────────────────
  router.get(
    "/agents",
    authOptional,
    asyncHandler(async (req: Request, res: Response) => {
      const query = listAgentsQuerySchema.parse(req.query);

      const agents = await service.listAgentCards({
        status: query.status,
      });

      res.json({
        ok: true,
        data: agents,
        count: agents.length,
      });
    }),
  );

  // ────────────────────────────────────────────
  // GET /a2a/agents/:nodeId — Get specific Agent Card
  // ────────────────────────────────────────────
  router.get(
    "/agents/:nodeId",
    authOptional,
    asyncHandler(async (req: Request, res: Response) => {
      const nodeId = nodeIdSchema.parse(req.params.nodeId);

      const card = await service.getAgentCard(nodeId);

      res.json({ ok: true, data: card });
    }),
  );

  // ── Mount router under /a2a prefix ────────
  app.use("/a2a", router);

  logger.info("A2A Gateway module registered — 4 A2A endpoints active");
}
