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
import { nodeConfigSSE } from "../evolution/node-config-sse.js";

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
  // GET /a2a/agents/roster — Agent-facing roster with online status
  // (Must be before /:nodeId to avoid Express matching conflicts)
  // ────────────────────────────────────────────
  router.get(
    "/agents/roster",
    authRequired,
    asyncHandler(async (req: Request, res: Response) => {
      const agents = await service.listAgentCards();
      const sseConnectedIds = nodeConfigSSE.getConnectedNodeIds();

      const roster = agents.map((a) => ({
        node_id: a.nodeId,
        status: a.status,
        sse_connected: sseConnectedIds.includes(a.nodeId),
        last_seen_at: a.lastSeenAt,
        role_id: (a as Record<string, unknown>).roleId as string ?? ((a.agentCard as Record<string, unknown>)?.role_id as string) ?? null,
        display_name:
          (a as Record<string, unknown>).employeeName as string ??
          ((a.agentCard as Record<string, unknown>)?.display_name as string) ??
          ((a.agentCard as Record<string, unknown>)?.name as string) ??
          a.nodeId,
        employee_id: (a as Record<string, unknown>).employeeId as string ?? ((a.agentCard as Record<string, unknown>)?.employee_id as string) ?? null,
      }));

      res.json({
        ok: true,
        roster,
        summary: {
          total: roster.length,
          online: roster.filter((r) => r.status === "online").length,
          sse_connected: roster.filter((r) => r.sse_connected).length,
          offline: roster.filter((r) => r.status === "offline").length,
          busy: roster.filter((r) => r.status === "busy").length,
        },
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

  logger.info("A2A Gateway module registered — 5 A2A endpoints active");
}
