/**
 * Relay Module — A2A Protocol Routes
 *
 * Endpoints for inter-node messaging via the Agent-to-Agent relay queue.
 * Nodes send messages, poll their inbox, and acknowledge receipt.
 */

import { Router } from "express";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { eq, and, sql } from "drizzle-orm";
import pino from "pino";
import type { GrcConfig } from "../../config.js";
import { createAuthMiddleware } from "../../shared/middleware/auth.js";
import {
  asyncHandler,
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from "../../shared/middleware/error-handler.js";
import { rateLimitMiddleware } from "../../shared/middleware/rate-limit.js";
import { nodeIdSchema } from "../../shared/utils/validators.js";
import { getDb } from "../../shared/db/connection.js";
import { a2aRelayQueueTable } from "./schema.js";
import { nodeConfigSSE } from "../evolution/node-config-sse.js";
import type { RelaySSEEvent } from "../evolution/node-config-sse.js";

const logger = pino({ name: "module:relay" });

// ── Request Validation Schemas ──────────────────

const relaySendSchema = z.object({
  from_node_id: nodeIdSchema,
  to_node_id: nodeIdSchema,
  message_type: z
    .enum(["text", "task_assignment", "directive", "report", "query"])
    .default("text"),
  subject: z.string().max(500).optional(),
  payload: z.record(z.unknown()),
  priority: z.enum(["critical", "high", "normal", "low"]).default("normal"),
  expires_at: z.string().datetime().optional(),
});

const relayInboxQuerySchema = z.object({
  node_id: nodeIdSchema,
  status: z.enum(["queued", "delivered", "acknowledged", "expired", "failed"]).default("queued"),
});

const relayAckSchema = z.object({
  message_id: z.string().uuid(),
  node_id: nodeIdSchema,
});

// ── Module Registration ─────────────────────────

export async function register(app: Express, config: GrcConfig): Promise<void> {
  const router = Router();
  const authOptional = createAuthMiddleware(config, false);
  const authRequired = createAuthMiddleware(config, true);

  // ────────────────────────────────────────────
  // POST /a2a/relay/send — Send message to another node
  // ────────────────────────────────────────────
  router.post(
    "/relay/send",
    authRequired,
    rateLimitMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const body = relaySendSchema.parse(req.body);
      const db = getDb();

      const id = uuidv4();

      await db.insert(a2aRelayQueueTable).values({
        id,
        fromNodeId: body.from_node_id,
        toNodeId: body.to_node_id,
        messageType: body.message_type,
        subject: body.subject ?? null,
        payload: body.payload,
        priority: body.priority,
        status: "queued",
        expiresAt: body.expires_at ? new Date(body.expires_at) : null,
      });

      // SSE instant push if target node is online
      let deliveredViaSSE = false;
      if (nodeConfigSSE.isNodeConnected(body.to_node_id)) {
        const sseEvent: RelaySSEEvent = {
          event_type: "relay_message",
          message_id: id,
          from_node_id: body.from_node_id,
          message_type: body.message_type,
          subject: body.subject,
          payload: body.payload,
          priority: body.priority,
          created_at: new Date().toISOString(),
        };

        deliveredViaSSE = nodeConfigSSE.pushRelayEvent(body.to_node_id, sseEvent);

        if (deliveredViaSSE) {
          await db
            .update(a2aRelayQueueTable)
            .set({ status: "delivered", deliveredAt: new Date() })
            .where(eq(a2aRelayQueueTable.id, id));
        }
      }

      logger.debug(
        { id, from: body.from_node_id, to: body.to_node_id, type: body.message_type, sseDelivered: deliveredViaSSE },
        "Relay message queued",
      );

      // Auto-post high-priority messages to community for visibility
      if (body.priority === "high") {
        try {
          const { getCommunityService } = await import("../community/service.js");
          const { communityChannelsTable } = await import("../community/schema.js");
          const communityService = getCommunityService();
          const [ch] = await db
            .select({ id: communityChannelsTable.id })
            .from(communityChannelsTable)
            .where(eq(communityChannelsTable.name, "announcements"))
            .limit(1);
          if (ch) {
            await communityService.createPost({
              authorNodeId: body.from_node_id,
              channelId: ch.id,
              postType: "alert" as import("../../shared/interfaces/community.interface.js").PostType,
              title: `[Important] ${body.subject ?? "High-priority message"}`,
              contextData: {
                body: `**From**: ${body.from_node_id.slice(0, 16)}...\n**To**: ${body.to_node_id.slice(0, 16)}...\n**Type**: ${body.message_type}\n\n_[内容は機密のため省略]_`,
                tags: ["auto-relay", "high-priority"],
                auto_generated: true,
              },
            });
          }
        } catch { /* fire-and-forget */ }
      }

      res.status(201).json({
        ok: true,
        message_id: id,
        status: deliveredViaSSE ? "delivered" : "queued",
        delivered_via_sse: deliveredViaSSE,
      });
    }),
  );

  // ────────────────────────────────────────────
  // GET /a2a/relay/inbox — Get pending messages for node
  // Also marks queued messages as 'delivered'
  // ────────────────────────────────────────────
  router.get(
    "/relay/inbox",
    authOptional,
    asyncHandler(async (req: Request, res: Response) => {
      const query = relayInboxQuerySchema.parse(req.query);
      const db = getDb();

      // Fetch messages matching status for this node
      const messages = await db
        .select()
        .from(a2aRelayQueueTable)
        .where(
          and(
            eq(a2aRelayQueueTable.toNodeId, query.node_id),
            eq(a2aRelayQueueTable.status, query.status),
          ),
        )
        .orderBy(
          sql`CASE ${a2aRelayQueueTable.priority} WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 ELSE 4 END`,
          a2aRelayQueueTable.createdAt,
        );

      // If fetching queued messages, mark them as delivered
      if (query.status === "queued" && messages.length > 0) {
        const messageIds = messages.map((m) => m.id);
        await db
          .update(a2aRelayQueueTable)
          .set({
            status: "delivered",
            deliveredAt: new Date(),
          })
          .where(
            and(
              eq(a2aRelayQueueTable.toNodeId, query.node_id),
              eq(a2aRelayQueueTable.status, "queued"),
            ),
          );
      }

      logger.debug(
        { nodeId: query.node_id, count: messages.length },
        "Inbox polled",
      );

      res.json({
        ok: true,
        node_id: query.node_id,
        messages,
        count: messages.length,
      });
    }),
  );

  // ────────────────────────────────────────────
  // POST /a2a/relay/ack — Acknowledge message receipt
  // ────────────────────────────────────────────
  router.post(
    "/relay/ack",
    authRequired,
    asyncHandler(async (req: Request, res: Response) => {
      const body = relayAckSchema.parse(req.body);
      const db = getDb();

      // Verify message exists and belongs to this node
      const rows = await db
        .select()
        .from(a2aRelayQueueTable)
        .where(
          and(
            eq(a2aRelayQueueTable.id, body.message_id),
            eq(a2aRelayQueueTable.toNodeId, body.node_id),
          ),
        )
        .limit(1);

      if (rows.length === 0) {
        throw new NotFoundError("Message");
      }

      const message = rows[0];

      if (message.status === "acknowledged") {
        return res.json({
          ok: true,
          message_id: body.message_id,
          status: "acknowledged",
          already_acknowledged: true,
        });
      }

      await db
        .update(a2aRelayQueueTable)
        .set({
          status: "acknowledged",
          acknowledgedAt: new Date(),
        })
        .where(eq(a2aRelayQueueTable.id, body.message_id));

      // Notify sender that message was read
      if (message.fromNodeId) {
        if (nodeConfigSSE.isNodeConnected(message.fromNodeId)) {
          nodeConfigSSE.pushRelayEvent(message.fromNodeId, {
            event_type: "message_read",
            message_id: body.message_id,
            read_by: body.node_id,
            read_at: new Date().toISOString(),
          });
        }
      }

      logger.debug(
        { messageId: body.message_id, nodeId: body.node_id },
        "Message acknowledged",
      );

      res.json({
        ok: true,
        message_id: body.message_id,
        status: "acknowledged",
      });
    }),
  );

  // ────────────────────────────────────────────
  // POST /a2a/relay/escalate — Escalate message priority (admin/ceo only)
  // ────────────────────────────────────────────
  const relayEscalateSchema = z.object({
    message_id: z.string().uuid(),
    new_priority: z.enum(["critical", "high"]),
    reason: z.string().max(1000).optional(),
  });

  router.post(
    "/relay/escalate",
    authRequired,
    asyncHandler(async (req: Request, res: Response) => {
      // Only admin or ceo role can escalate
      const callerRole = req.auth?.role as string | undefined;
      if (callerRole !== "admin" && callerRole !== "ceo") {
        throw new ForbiddenError("Only admin or ceo role can escalate message priority");
      }

      const body = relayEscalateSchema.parse(req.body);
      const db = getDb();

      // Fetch the message
      const rows = await db
        .select()
        .from(a2aRelayQueueTable)
        .where(eq(a2aRelayQueueTable.id, body.message_id))
        .limit(1);

      if (rows.length === 0) {
        throw new NotFoundError("Message");
      }

      const message = rows[0];
      const previousPriority = message.priority;

      // Update priority in DB
      await db
        .update(a2aRelayQueueTable)
        .set({ priority: body.new_priority })
        .where(eq(a2aRelayQueueTable.id, body.message_id));

      // Push SSE notification to the target node
      if (nodeConfigSSE.isNodeConnected(message.toNodeId)) {
        nodeConfigSSE.pushRelayEvent(message.toNodeId, {
          event_type: "priority_escalated",
          message_id: body.message_id,
          from_node_id: message.fromNodeId,
          priority: previousPriority,
          new_priority: body.new_priority,
          reason: body.reason,
        });
      }

      logger.info(
        {
          messageId: body.message_id,
          from: previousPriority,
          to: body.new_priority,
          escalatedBy: req.auth?.sub,
        },
        "Message priority escalated",
      );

      res.json({
        ok: true,
        message_id: body.message_id,
        previous_priority: previousPriority,
        new_priority: body.new_priority,
        reason: body.reason ?? null,
      });
    }),
  );

  // ────────────────────────────────────────────
  // POST /a2a/relay/broadcast — Send message to all agents or filtered by role
  // ────────────────────────────────────────────
  const relayBroadcastSchema = z.object({
    from_node_id: nodeIdSchema,
    message_type: z
      .enum(["text", "directive", "report", "broadcast"])
      .default("broadcast"),
    subject: z.string().max(500),
    payload: z.record(z.unknown()),
    priority: z.enum(["critical", "high", "normal", "low"]).default("normal"),
    target_roles: z.array(z.string()).optional(),
    exclude_self: z.boolean().default(true),
  });

  router.post(
    "/relay/broadcast",
    authRequired,
    rateLimitMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const body = relayBroadcastSchema.parse(req.body);
      const db = getDb();

      // Get all agent cards to find target nodes
      const { AgentCardService } = await import("../a2a-gateway/service.js");
      const agentService = new AgentCardService();
      const allAgents = await agentService.listAgentCards();

      let targets = allAgents;

      // Filter by roles if specified
      if (body.target_roles && body.target_roles.length > 0) {
        targets = targets.filter((a) => {
          const roleId = (a.agentCard as Record<string, unknown>)?.role_id as string | undefined;
          return roleId && body.target_roles!.includes(roleId);
        });
      }

      // Exclude sender
      if (body.exclude_self) {
        targets = targets.filter((a) => a.nodeId !== body.from_node_id);
      }

      // Send to each target via relay queue + SSE
      const results: Array<{
        node_id: string;
        message_id: string;
        delivered_via_sse: boolean;
      }> = [];

      for (const target of targets) {
        const msgId = uuidv4();
        const now = new Date();

        await db.insert(a2aRelayQueueTable).values({
          id: msgId,
          fromNodeId: body.from_node_id,
          toNodeId: target.nodeId,
          messageType: body.message_type,
          subject: body.subject,
          payload: body.payload,
          priority: body.priority,
          status: "queued",
          expiresAt: null,
        });

        // Try SSE push
        let deliveredViaSSE = false;
        const { nodeConfigSSE } = await import("../evolution/node-config-sse.js");
        if (nodeConfigSSE.isNodeConnected(target.nodeId)) {
          deliveredViaSSE = nodeConfigSSE.pushRelayEvent(target.nodeId, {
            event_type: "relay_message",
            message_id: msgId,
            from_node_id: body.from_node_id,
            message_type: body.message_type,
            subject: body.subject,
            payload: body.payload,
            priority: body.priority,
            created_at: now.toISOString(),
          });

          if (deliveredViaSSE) {
            await db
              .update(a2aRelayQueueTable)
              .set({ status: "delivered", deliveredAt: now })
              .where(eq(a2aRelayQueueTable.id, msgId));
          }
        }

        results.push({
          node_id: target.nodeId,
          message_id: msgId,
          delivered_via_sse: deliveredViaSSE,
        });
      }

      res.status(201).json({
        ok: true,
        broadcast_summary: {
          total_recipients: results.length,
          delivered_immediately: results.filter((r) => r.delivered_via_sse).length,
          queued_for_later: results.filter((r) => !r.delivered_via_sse).length,
        },
        results,
      });
    }),
  );

  // ────────────────────────────────────────────
  // GET /a2a/relay/status/:messageId — Get delivery status of a message
  // ────────────────────────────────────────────
  router.get(
    "/relay/status/:messageId",
    authRequired,
    asyncHandler(async (req: Request, res: Response) => {
      const messageId = z.string().uuid().parse(req.params.messageId);
      const db = getDb();

      const rows = await db
        .select()
        .from(a2aRelayQueueTable)
        .where(eq(a2aRelayQueueTable.id, messageId))
        .limit(1);

      if (rows.length === 0) {
        throw new NotFoundError("Message");
      }

      const msg = rows[0];

      res.json({
        ok: true,
        message_id: msg.id,
        status: msg.status,
        from_node_id: msg.fromNodeId,
        to_node_id: msg.toNodeId,
        message_type: msg.messageType,
        priority: msg.priority,
        timeline: {
          queued_at: msg.createdAt,
          delivered_at: msg.deliveredAt,
          acknowledged_at: msg.acknowledgedAt,
          expires_at: msg.expiresAt,
        },
        recipient_sse_connected: nodeConfigSSE.isNodeConnected(msg.toNodeId),
      });
    }),
  );

  // ── Mount router under /a2a prefix ────────
  app.use("/a2a", router);

  logger.info("Relay module registered — 6 A2A endpoints active");
}
