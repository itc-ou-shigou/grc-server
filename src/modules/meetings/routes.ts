/**
 * Meetings Module — A2A Protocol Routes (Agent-Facing)
 *
 * Endpoints for agents to create, join, and participate in meetings.
 * All routes are under /a2a/meetings/*.
 */

import { Router } from "express";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import pino from "pino";
import type { GrcConfig } from "../../config.js";
import { createAuthMiddleware } from "../../shared/middleware/auth.js";
import { asyncHandler } from "../../shared/middleware/error-handler.js";
import { rateLimitMiddleware } from "../../shared/middleware/rate-limit.js";
import { uuidSchema } from "../../shared/utils/validators.js";
import { MeetingService } from "./service.js";
import { sseManager } from "./sse-manager.js";

const logger = pino({ name: "module:meetings" });

// ── Request Validation Schemas ──────────────────

const createMeetingSchema = z.object({
  title: z.string().min(1).max(500),
  type: z.enum(["discussion", "review", "brainstorm", "decision"]).optional(),
  initiator_type: z.enum(["human", "agent"]).optional(),
  initiation_reason: z.string().optional(),
  facilitator_node_id: z.string().min(1),
  context_id: z.string().optional(),
  shared_context: z.string().optional(),
  turn_policy: z.string().max(50).optional(),
  max_duration_minutes: z.number().int().min(1).max(1440).optional(),
  agenda: z.array(z.record(z.unknown())).optional(),
  scheduled_at: z.string().datetime().optional(),
  created_by: z.string().min(1),
  participants: z
    .array(
      z.object({
        node_id: z.string().min(1),
        role_id: z.string().min(1),
        display_name: z.string().min(1),
      }),
    )
    .optional(),
});

const joinMeetingSchema = z.object({
  node_id: z.string().min(1),
  role_id: z.string().min(1),
  display_name: z.string().min(1),
});

const leaveMeetingSchema = z.object({
  node_id: z.string().min(1),
});

const sendMessageSchema = z.object({
  speaker_node_id: z.string().min(1),
  speaker_role: z.string().min(1),
  content: z.string().min(1).max(50000),
  type: z
    .enum(["statement", "question", "answer", "proposal", "objection", "agreement", "system"])
    .optional(),
  reply_to_id: z.number().int().optional(),
  agenda_item_index: z.number().int().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const closeMeetingSchema = z.object({
  summary: z.string().optional(),
  decisions: z.array(z.record(z.unknown())).optional(),
  action_items: z.array(z.record(z.unknown())).optional(),
});

// ── Module Registration ─────────────────────────

export async function register(app: Express, config: GrcConfig): Promise<void> {
  const router = Router();
  const service = new MeetingService();
  const authRequired = createAuthMiddleware(config, true);

  // ────────────────────────────────────────────
  // POST /a2a/meetings/quick — Quick meeting creation with minimal params
  // (Must be before /:sessionId to avoid Express matching conflicts)
  // ────────────────────────────────────────────
  const quickMeetingSchema = z.object({
    title: z.string().min(1).max(500),
    facilitator_node_id: z.string().min(1),
    created_by: z.string().min(1),
    participant_roles: z.array(z.string()).optional(),
    participant_node_ids: z.array(z.string()).optional(),
    agenda_text: z.string().optional(),
    type: z.enum(["discussion", "review", "brainstorm", "decision"]).default("discussion"),
    auto_start: z.boolean().default(true),
    max_duration_minutes: z.number().int().min(1).max(1440).default(30),
  });

  router.post(
    "/quick",
    authRequired,
    rateLimitMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const body = quickMeetingSchema.parse(req.body);

      // Resolve participant_roles to actual nodes
      let participants: Array<{ nodeId: string; roleId: string; displayName: string }> = [];

      if (body.participant_roles && body.participant_roles.length > 0) {
        // Dynamic import to avoid circular deps
        const { getNodesByRoles } = await import("../evolution/role-resolver.js");
        const resolved = await getNodesByRoles(body.participant_roles);
        participants = resolved.map((n) => ({
          nodeId: n.nodeId,
          roleId: n.roleId ?? "unknown",
          displayName: n.employeeName ?? n.roleId ?? n.nodeId,
        }));
      }

      if (body.participant_node_ids && body.participant_node_ids.length > 0) {
        for (const nid of body.participant_node_ids) {
          if (!participants.some((p) => p.nodeId === nid)) {
            participants.push({ nodeId: nid, roleId: "unknown", displayName: nid });
          }
        }
      }

      // Convert plain text agenda to structured array
      let agenda: Array<Record<string, unknown>> | undefined;
      if (body.agenda_text) {
        agenda = body.agenda_text
          .split("\n")
          .filter((line) => line.trim())
          .map((line, i) => ({
            index: i,
            topic: line.trim(),
            duration_minutes: null,
          }));
      }

      // Create meeting
      const meeting = await service.createMeeting({
        title: body.title,
        type: body.type,
        initiatorType: "agent",
        facilitatorNodeId: body.facilitator_node_id,
        maxDurationMinutes: body.max_duration_minutes,
        agenda,
        createdBy: body.created_by,
        participants: participants.length > 0 ? participants : undefined,
      });

      // Auto-start if requested
      let finalMeeting = meeting;
      if (body.auto_start && meeting.status === "scheduled") {
        finalMeeting = { ...meeting, ...(await service.startMeeting(meeting.id)) };
      }

      res.status(201).json({
        ok: true,
        meeting: finalMeeting,
        notifications_sent: participants.length,
        quick_links: {
          meeting_url: `/a2a/meetings/${meeting.id}`,
          message_url: `/a2a/meetings/${meeting.id}/message`,
          stream_url: `/a2a/meetings/${meeting.id}/stream`,
          close_url: `/a2a/meetings/${meeting.id}/close`,
        },
      });
    }),
  );

  // POST /a2a/meetings — Create a new meeting
  router.post(
    "/",
    authRequired,
    rateLimitMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const body = createMeetingSchema.parse(req.body);

      const meeting = await service.createMeeting({
        title: body.title,
        type: body.type,
        initiatorType: body.initiator_type,
        initiationReason: body.initiation_reason,
        facilitatorNodeId: body.facilitator_node_id,
        contextId: body.context_id,
        sharedContext: body.shared_context,
        turnPolicy: body.turn_policy,
        maxDurationMinutes: body.max_duration_minutes,
        agenda: body.agenda,
        scheduledAt: body.scheduled_at ? new Date(body.scheduled_at) : undefined,
        createdBy: body.created_by,
        participants: body.participants?.map((p) => ({
          nodeId: p.node_id,
          roleId: p.role_id,
          displayName: p.display_name,
        })),
      });

      res.status(201).json({ ok: true, data: meeting });
    }),
  );

  // GET /a2a/meetings/:sessionId — Get meeting state
  router.get(
    "/:sessionId",
    authRequired,
    asyncHandler(async (req: Request, res: Response) => {
      const sessionId = uuidSchema.parse(req.params.sessionId);
      const meeting = await service.getMeeting(sessionId);
      res.json({ ok: true, data: meeting });
    }),
  );

  // POST /a2a/meetings/:sessionId/start — Start meeting
  router.post(
    "/:sessionId/start",
    authRequired,
    asyncHandler(async (req: Request, res: Response) => {
      const sessionId = uuidSchema.parse(req.params.sessionId);
      const meeting = await service.startMeeting(sessionId);
      res.json({ ok: true, data: meeting });
    }),
  );

  // POST /a2a/meetings/:sessionId/join — Join meeting
  router.post(
    "/:sessionId/join",
    authRequired,
    asyncHandler(async (req: Request, res: Response) => {
      const sessionId = uuidSchema.parse(req.params.sessionId);
      const body = joinMeetingSchema.parse(req.body);
      const participant = await service.joinMeeting(
        sessionId,
        body.node_id,
        body.role_id,
        body.display_name,
      );
      res.json({ ok: true, data: participant });
    }),
  );

  // POST /a2a/meetings/:sessionId/leave — Leave meeting
  router.post(
    "/:sessionId/leave",
    authRequired,
    asyncHandler(async (req: Request, res: Response) => {
      const sessionId = uuidSchema.parse(req.params.sessionId);
      const body = leaveMeetingSchema.parse(req.body);
      const participant = await service.leaveMeeting(sessionId, body.node_id);
      res.json({ ok: true, data: participant });
    }),
  );

  // POST /a2a/meetings/:sessionId/message — Send message
  router.post(
    "/:sessionId/message",
    authRequired,
    asyncHandler(async (req: Request, res: Response) => {
      const sessionId = uuidSchema.parse(req.params.sessionId);
      const body = sendMessageSchema.parse(req.body);
      const entry = await service.addTranscriptEntry({
        sessionId,
        speakerNodeId: body.speaker_node_id,
        speakerRole: body.speaker_role,
        content: body.content,
        type: body.type,
        replyToId: body.reply_to_id,
        agendaItemIndex: body.agenda_item_index,
        metadata: body.metadata,
      });
      res.status(201).json({ ok: true, data: entry });
    }),
  );

  // GET /a2a/meetings/:sessionId/transcript — Get transcript
  router.get(
    "/:sessionId/transcript",
    authRequired,
    asyncHandler(async (req: Request, res: Response) => {
      const sessionId = uuidSchema.parse(req.params.sessionId);
      const entries = await service.getTranscript(sessionId);
      res.json({ ok: true, data: entries, count: entries.length });
    }),
  );

  // GET /a2a/meetings/:sessionId/stream — SSE stream
  router.get(
    "/:sessionId/stream",
    authRequired,
    asyncHandler(async (req: Request, res: Response) => {
      const sessionId = uuidSchema.parse(req.params.sessionId);
      // Verify meeting exists
      await service.getMeeting(sessionId);

      // Set up SSE headers
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });

      // Send initial connection event
      res.write(
        `event: connected\ndata: ${JSON.stringify({
          sessionId,
          connectedAt: new Date().toISOString(),
        })}\n\n`,
      );

      // Register this connection
      sseManager.addConnection(sessionId, res);

      // Handle client disconnect
      req.on("close", () => {
        sseManager.removeConnection(sessionId, res);
      });
    }),
  );

  // POST /a2a/meetings/:sessionId/close — Close/end meeting
  router.post(
    "/:sessionId/close",
    authRequired,
    asyncHandler(async (req: Request, res: Response) => {
      const sessionId = uuidSchema.parse(req.params.sessionId);
      const body = closeMeetingSchema.parse(req.body);
      const meeting = await service.endMeeting(
        sessionId,
        body.summary,
        body.decisions,
        body.action_items,
      );

      // Auto-post meeting summary to community
      try {
        const { getCommunityService } = await import("../community/service.js");
        const { communityChannelsTable } = await import("../community/schema.js");
        const { getDb } = await import("../../shared/db/connection.js");
        const { eq: eqOp } = await import("drizzle-orm");
        const db = getDb();
        const communityService = getCommunityService();
        const [ch] = await db
          .select({ id: communityChannelsTable.id })
          .from(communityChannelsTable)
          .where(eqOp(communityChannelsTable.name, "announcements"))
          .limit(1);
        if (ch) {
          const decisions = body.decisions?.map((d: Record<string, unknown>) => `- ${d.decision ?? d.text ?? JSON.stringify(d)}`).join("\n") ?? "";
          const actions = body.action_items?.map((a: Record<string, unknown>) => `- ${a.action ?? a.text ?? JSON.stringify(a)}`).join("\n") ?? "";
          const bodyText = [
            `## Meeting Summary`,
            body.summary ?? "",
            decisions ? `\n### Decisions\n${decisions}` : "",
            actions ? `\n### Action Items\n${actions}` : "",
          ].filter(Boolean).join("\n");

          await communityService.createPost({
            authorNodeId: req.auth?.sub ?? "system",
            channelId: ch.id,
            postType: "experience" as import("../../shared/interfaces/community.interface.js").PostType,
            title: `[Meeting Report] ${(meeting as Record<string, unknown>).title ?? sessionId}`,
            contextData: { body: bodyText, tags: ["meeting-summary", "auto-generated"], auto_generated: true },
          });
        }
      } catch { /* fire-and-forget */ }

      res.json({ ok: true, data: meeting });
    }),
  );

  // ── Mount router under /a2a/meetings prefix ───
  app.use("/a2a/meetings", router);

  logger.info("Meetings module registered — 8 A2A endpoints active");
}
