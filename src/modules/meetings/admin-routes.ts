/**
 * Meetings Module — Admin Routes
 *
 * Provides admin-only management endpoints for meetings, triggers,
 * and meeting statistics.
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
  BadRequestError,
} from "../../shared/middleware/error-handler.js";
import { uuidSchema, paginationSchema } from "../../shared/utils/validators.js";
import { MeetingService } from "./service.js";

const logger = pino({ name: "admin:meetings" });

// ── Zod Schemas ─────────────────────────────────

const meetingListQuerySchema = paginationSchema.extend({
  status: z
    .enum(["scheduled", "active", "paused", "concluded", "cancelled"])
    .optional(),
  type: z
    .enum(["discussion", "review", "brainstorm", "decision"])
    .optional(),
  initiator_type: z.enum(["human", "agent"]).optional(),
});

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

const adminStatusSchema = z.object({
  status: z.enum(["active", "paused", "concluded", "cancelled"]),
});

const adminMessageSchema = z.object({
  content: z.string().min(1),
  speaker_role: z.string().min(1).default("admin"),
});

const endMeetingSchema = z.object({
  summary: z.string().optional(),
  decisions: z.array(z.record(z.unknown())).optional(),
  action_items: z.array(z.record(z.unknown())).optional(),
});

const createTriggerSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  event: z.string().min(1).max(255),
  enabled: z.boolean().optional(),
  facilitator_role: z.string().min(1).max(100),
  meeting_template: z.record(z.unknown()),
});

const updateTriggerSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  event: z.string().min(1).max(255).optional(),
  enabled: z.boolean().optional(),
  facilitator_role: z.string().min(1).max(100).optional(),
  meeting_template: z.record(z.unknown()).optional(),
});

// ── Route Registration ──────────────────────────

export async function registerAdmin(app: Express, config: GrcConfig) {
  const router = Router();
  const requireAuth = createAuthMiddleware(config);
  const requireAdmin = createAdminAuthMiddleware(config);
  const service = new MeetingService();

  // ── GET /a2a/meetings/stats — Meeting statistics (BEFORE :id) ──
  router.get(
    "/a2a/meetings/stats",
    requireAuth,
    requireAdmin,
    asyncHandler(async (_req: Request, res: Response) => {
      const stats = await service.getMeetingStats();
      res.json({ stats });
    }),
  );

  // ── POST /a2a/meetings — Admin create meeting ──
  router.post(
    "/a2a/meetings",
    requireAuth,
    requireAdmin,
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
      logger.info({ sessionId: meeting.id, admin: req.auth?.sub }, "Meeting created by admin");
      res.status(201).json({ ok: true, data: meeting });
    }),
  );

  // ── GET /a2a/meetings — List all meetings (paginated, filterable) ──
  router.get(
    "/a2a/meetings",
    requireAuth,
    requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const query = meetingListQuerySchema.parse(req.query);
      const result = await service.listMeetings({
        page: query.page,
        limit: query.limit,
        status: query.status,
        type: query.type,
        initiatorType: query.initiator_type,
      });
      res.json(result);
    }),
  );

  // ── GET /a2a/meetings/:id — Meeting detail with transcript ──
  router.get(
    "/a2a/meetings/:id",
    requireAuth,
    requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const id = uuidSchema.parse(req.params.id);
      const meeting = await service.getMeeting(id);
      const transcript = await service.getTranscript(id);
      res.json({ data: { ...meeting, transcript } });
    }),
  );

  // ── PUT /a2a/meetings/:id/status — Generic status change ──
  router.put(
    "/a2a/meetings/:id/status",
    requireAuth,
    requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const id = uuidSchema.parse(req.params.id);
      const body = adminStatusSchema.parse(req.body);
      const meeting = await service.getMeeting(id);

      // Validate transitions
      if (body.status === "active") {
        if (meeting.status === "scheduled") {
          const started = await service.startMeeting(id);
          return res.json({ data: started });
        }
        if (meeting.status !== "paused") {
          throw new BadRequestError(
            `Cannot set meeting to active from status '${meeting.status}'.`,
          );
        }
        const resumed = await service.updateMeetingStatus(id, "active");
        return res.json({ data: resumed });
      }

      if (body.status === "paused") {
        if (meeting.status !== "active") {
          throw new BadRequestError(
            `Cannot pause meeting with status '${meeting.status}'.`,
          );
        }
        const paused = await service.updateMeetingStatus(id, "paused");
        return res.json({ data: paused });
      }

      if (body.status === "concluded") {
        if (meeting.status !== "active" && meeting.status !== "paused") {
          throw new BadRequestError(
            `Cannot conclude meeting with status '${meeting.status}'.`,
          );
        }
        const ended = await service.endMeeting(id);
        logger.info({ sessionId: id, admin: req.auth?.sub }, "Meeting ended via status change");
        return res.json({ data: ended });
      }

      if (body.status === "cancelled") {
        const cancelled = await service.updateMeetingStatus(id, "cancelled");
        return res.json({ data: cancelled });
      }

      throw new BadRequestError(`Unsupported status transition to '${body.status}'.`);
    }),
  );

  // ── POST /a2a/meetings/:id/pause — Pause meeting ──
  router.post(
    "/a2a/meetings/:id/pause",
    requireAuth,
    requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const id = uuidSchema.parse(req.params.id);
      const meeting = await service.getMeeting(id);
      if (meeting.status !== "active") {
        throw new BadRequestError(
          `Cannot pause meeting with status '${meeting.status}'. Only active meetings can be paused.`,
        );
      }
      const updated = await service.updateMeetingStatus(id, "paused");
      res.json({ data: updated });
    }),
  );

  // ── POST /a2a/meetings/:id/resume — Resume meeting ──
  router.post(
    "/a2a/meetings/:id/resume",
    requireAuth,
    requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const id = uuidSchema.parse(req.params.id);
      const meeting = await service.getMeeting(id);
      if (meeting.status !== "paused") {
        throw new BadRequestError(
          `Cannot resume meeting with status '${meeting.status}'. Only paused meetings can be resumed.`,
        );
      }
      const updated = await service.updateMeetingStatus(id, "active");
      res.json({ data: updated });
    }),
  );

  // ── POST /a2a/meetings/:id/end — Force end meeting ──
  router.post(
    "/a2a/meetings/:id/end",
    requireAuth,
    requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const id = uuidSchema.parse(req.params.id);
      const body = endMeetingSchema.parse(req.body);
      const meeting = await service.endMeeting(id, body.summary, body.decisions, body.action_items);
      logger.info({ sessionId: id, admin: req.auth?.sub }, "Meeting force-ended by admin");
      res.json({ data: meeting });
    }),
  );

  // ── POST /a2a/meetings/:id/message — Admin intervention message ──
  router.post(
    "/a2a/meetings/:id/message",
    requireAuth,
    requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const id = uuidSchema.parse(req.params.id);
      const body = adminMessageSchema.parse(req.body);
      const admin = req.auth?.sub ?? "admin";

      const meeting = await service.getMeeting(id);
      if (meeting.status !== "active" && meeting.status !== "paused") {
        throw new BadRequestError(
          `Cannot send messages to meeting with status '${meeting.status}'.`,
        );
      }

      const entry = await service.addSystemMessage({
        sessionId: id,
        speakerNodeId: admin,
        speakerRole: body.speaker_role,
        content: body.content,
      });

      logger.info({ sessionId: id, admin }, "Admin intervention message sent");
      res.status(201).json({ data: entry });
    }),
  );

  // ── DELETE /a2a/meetings/:id — Delete meeting ──
  router.delete(
    "/a2a/meetings/:id",
    requireAuth,
    requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const id = uuidSchema.parse(req.params.id);
      await service.deleteMeeting(id);
      logger.info({ sessionId: id, admin: req.auth?.sub }, "Meeting deleted by admin");
      res.json({ ok: true, deleted: id });
    }),
  );

  // ── GET /a2a/triggers — List all triggers ──
  router.get(
    "/a2a/triggers",
    requireAuth,
    requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const query = paginationSchema.parse(req.query);
      const triggers = await service.listTriggers();
      const start = (query.page - 1) * query.limit;
      const paged = triggers.slice(start, start + query.limit);
      res.json({
        data: paged,
        pagination: {
          page: query.page,
          limit: query.limit,
          total: triggers.length,
          totalPages: Math.ceil(triggers.length / query.limit),
        },
      });
    }),
  );

  // ── POST /a2a/triggers — Create trigger ──
  router.post(
    "/a2a/triggers",
    requireAuth,
    requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const body = createTriggerSchema.parse(req.body);
      const trigger = await service.createTrigger({
        name: body.name,
        description: body.description,
        event: body.event,
        enabled: body.enabled,
        facilitatorRole: body.facilitator_role,
        meetingTemplate: body.meeting_template,
      });
      res.status(201).json({ data: trigger });
    }),
  );

  // ── PUT /a2a/triggers/:id — Update trigger ──
  router.put(
    "/a2a/triggers/:id",
    requireAuth,
    requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const id = uuidSchema.parse(req.params.id);
      const body = updateTriggerSchema.parse(req.body);
      const trigger = await service.updateTrigger(id, {
        name: body.name,
        description: body.description,
        event: body.event,
        enabled: body.enabled,
        facilitatorRole: body.facilitator_role,
        meetingTemplate: body.meeting_template,
      });
      res.json({ data: trigger });
    }),
  );

  // ── DELETE /a2a/triggers/:id — Delete trigger ──
  router.delete(
    "/a2a/triggers/:id",
    requireAuth,
    requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const id = uuidSchema.parse(req.params.id);
      const result = await service.deleteTrigger(id);
      logger.info({ triggerId: id, admin: req.auth?.sub }, "Trigger deleted by admin");
      res.json({ ok: true, deleted: result.deleted });
    }),
  );

  // ── Mount ─────────────────────────────────────
  app.use("/api/v1/admin", router);
  logger.info("Meetings admin routes registered");
}
