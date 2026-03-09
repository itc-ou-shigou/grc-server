/**
 * Meetings Service — Business Logic
 *
 * Handles meeting CRUD, participant management, transcript recording,
 * SSE broadcasting, auto-trigger management, and statistics.
 */

import { v4 as uuidv4 } from "uuid";
import { eq, desc, sql, and, asc } from "drizzle-orm";
import pino from "pino";
import { getDb } from "../../shared/db/connection.js";
import {
  meetingSessionsTable,
  meetingParticipantsTable,
  meetingTranscriptTable,
  meetingAutoTriggersTable,
} from "./schema.js";
import {
  BadRequestError,
  NotFoundError,
} from "../../shared/middleware/error-handler.js";
import { sseManager } from "./sse-manager.js";

const logger = pino({ name: "module:meetings:service" });

// ── MeetingService ──────────────────────────────

export class MeetingService {
  // ── Session CRUD ────────────────────────────

  async createMeeting(data: {
    title: string;
    type?: string;
    initiatorType?: string;
    initiationReason?: string;
    facilitatorNodeId: string;
    contextId?: string;
    sharedContext?: string;
    turnPolicy?: string;
    maxDurationMinutes?: number;
    agenda?: unknown;
    scheduledAt?: Date;
    createdBy: string;
    participants?: Array<{
      nodeId: string;
      roleId: string;
      displayName: string;
    }>;
  }) {
    const db = getDb();
    const id = uuidv4();
    const contextId = data.contextId ?? uuidv4();

    await db.insert(meetingSessionsTable).values({
      id,
      title: data.title,
      type: (data.type ?? "discussion") as "discussion" | "review" | "brainstorm" | "decision",
      status: "scheduled",
      initiatorType: (data.initiatorType ?? "human") as "human" | "agent",
      initiationReason: data.initiationReason ?? null,
      facilitatorNodeId: data.facilitatorNodeId,
      contextId,
      sharedContext: data.sharedContext ?? null,
      turnPolicy: data.turnPolicy ?? "facilitator-directed",
      maxDurationMinutes: data.maxDurationMinutes ?? 60,
      agenda: data.agenda ?? null,
      decisions: null,
      actionItems: null,
      summary: null,
      scheduledAt: data.scheduledAt ?? null,
      createdBy: data.createdBy,
    });

    // Insert participants if provided
    if (data.participants && data.participants.length > 0) {
      await db.insert(meetingParticipantsTable).values(
        data.participants.map((p) => ({
          sessionId: id,
          nodeId: p.nodeId,
          roleId: p.roleId,
          displayName: p.displayName,
          status: "invited" as const,
        })),
      );
    }

    logger.info({ sessionId: id, title: data.title }, "Meeting created");

    return this.getMeeting(id);
  }

  async getMeeting(id: string) {
    const db = getDb();

    const rows = await db
      .select()
      .from(meetingSessionsTable)
      .where(eq(meetingSessionsTable.id, id))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundError("Meeting");
    }

    const participants = await db
      .select()
      .from(meetingParticipantsTable)
      .where(eq(meetingParticipantsTable.sessionId, id));

    return { ...rows[0], participants };
  }

  async listMeetings(opts: {
    page: number;
    limit: number;
    status?: string;
    type?: string;
    initiatorType?: string;
  }) {
    const db = getDb();
    const offset = (opts.page - 1) * opts.limit;

    const conditions = [];
    if (opts.status) {
      conditions.push(
        eq(meetingSessionsTable.status, opts.status as "scheduled" | "active" | "paused" | "concluded" | "cancelled"),
      );
    }
    if (opts.type) {
      conditions.push(
        eq(meetingSessionsTable.type, opts.type as "discussion" | "review" | "brainstorm" | "decision"),
      );
    }
    if (opts.initiatorType) {
      conditions.push(
        eq(meetingSessionsTable.initiatorType, opts.initiatorType as "human" | "agent"),
      );
    }
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, totalResult] = await Promise.all([
      db
        .select()
        .from(meetingSessionsTable)
        .where(whereClause)
        .orderBy(desc(meetingSessionsTable.createdAt))
        .limit(opts.limit)
        .offset(offset),
      db
        .select({ count: sql<number>`COUNT(*)` })
        .from(meetingSessionsTable)
        .where(whereClause),
    ]);

    const total = totalResult[0]?.count ?? 0;

    return {
      data: rows,
      pagination: {
        page: opts.page,
        limit: opts.limit,
        total,
        totalPages: Math.ceil(total / opts.limit),
      },
    };
  }

  async updateMeetingStatus(id: string, status: string) {
    const db = getDb();

    const rows = await db
      .select()
      .from(meetingSessionsTable)
      .where(eq(meetingSessionsTable.id, id))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundError("Meeting");
    }

    await db
      .update(meetingSessionsTable)
      .set({ status: status as "scheduled" | "active" | "paused" | "concluded" | "cancelled" })
      .where(eq(meetingSessionsTable.id, id));

    logger.info({ sessionId: id, status }, "Meeting status updated");
    sseManager.broadcast(id, "status_changed", { sessionId: id, status });

    const updated = await db
      .select()
      .from(meetingSessionsTable)
      .where(eq(meetingSessionsTable.id, id))
      .limit(1);

    return updated[0];
  }

  async startMeeting(id: string) {
    const db = getDb();

    const rows = await db
      .select()
      .from(meetingSessionsTable)
      .where(eq(meetingSessionsTable.id, id))
      .limit(1);

    if (rows.length === 0) throw new NotFoundError("Meeting");

    if (rows[0].status !== "scheduled") {
      throw new BadRequestError(
        `Cannot start meeting with status '${rows[0].status}'. Only scheduled meetings can be started.`,
      );
    }

    const now = new Date();
    await db
      .update(meetingSessionsTable)
      .set({ status: "active", startedAt: now })
      .where(eq(meetingSessionsTable.id, id));

    logger.info({ sessionId: id }, "Meeting started");
    sseManager.broadcast(id, "meeting_started", { sessionId: id, startedAt: now.toISOString() });

    const updated = await db
      .select()
      .from(meetingSessionsTable)
      .where(eq(meetingSessionsTable.id, id))
      .limit(1);

    return updated[0];
  }

  async endMeeting(id: string, summary?: string, decisions?: unknown, actionItems?: unknown) {
    const db = getDb();

    const rows = await db
      .select()
      .from(meetingSessionsTable)
      .where(eq(meetingSessionsTable.id, id))
      .limit(1);

    if (rows.length === 0) throw new NotFoundError("Meeting");

    if (rows[0].status !== "active" && rows[0].status !== "paused") {
      throw new BadRequestError(
        `Cannot end meeting with status '${rows[0].status}'. Only active or paused meetings can be ended.`,
      );
    }

    const now = new Date();
    await db
      .update(meetingSessionsTable)
      .set({
        status: "concluded",
        endedAt: now,
        summary: summary ?? null,
        decisions: decisions ?? null,
        actionItems: actionItems ?? null,
      })
      .where(eq(meetingSessionsTable.id, id));

    logger.info({ sessionId: id }, "Meeting ended");
    sseManager.broadcast(id, "meeting_ended", { sessionId: id, endedAt: now.toISOString(), summary: summary ?? null });

    const updated = await db
      .select()
      .from(meetingSessionsTable)
      .where(eq(meetingSessionsTable.id, id))
      .limit(1);

    return updated[0];
  }

  async deleteMeeting(id: string) {
    const db = getDb();

    const rows = await db
      .select()
      .from(meetingSessionsTable)
      .where(eq(meetingSessionsTable.id, id))
      .limit(1);

    if (rows.length === 0) throw new NotFoundError("Meeting");

    // Delete transcript entries, participants, then the meeting itself
    await db
      .delete(meetingTranscriptTable)
      .where(eq(meetingTranscriptTable.sessionId, id));

    await db
      .delete(meetingParticipantsTable)
      .where(eq(meetingParticipantsTable.sessionId, id));

    await db
      .delete(meetingSessionsTable)
      .where(eq(meetingSessionsTable.id, id));

    logger.info({ sessionId: id }, "Meeting deleted");
    return { deleted: id };
  }

  // ── Participants ────────────────────────────

  async joinMeeting(sessionId: string, nodeId: string, roleId: string, displayName: string) {
    const db = getDb();

    const meetingRows = await db
      .select()
      .from(meetingSessionsTable)
      .where(eq(meetingSessionsTable.id, sessionId))
      .limit(1);

    if (meetingRows.length === 0) throw new NotFoundError("Meeting");

    if (meetingRows[0].status !== "scheduled" && meetingRows[0].status !== "active") {
      throw new BadRequestError(`Cannot join meeting with status '${meetingRows[0].status}'.`);
    }

    const existing = await db
      .select()
      .from(meetingParticipantsTable)
      .where(
        and(
          eq(meetingParticipantsTable.sessionId, sessionId),
          eq(meetingParticipantsTable.nodeId, nodeId),
        ),
      )
      .limit(1);

    const now = new Date();

    if (existing.length > 0) {
      await db
        .update(meetingParticipantsTable)
        .set({ status: "joined", joinedAt: now, leftAt: null })
        .where(
          and(
            eq(meetingParticipantsTable.sessionId, sessionId),
            eq(meetingParticipantsTable.nodeId, nodeId),
          ),
        );
    } else {
      await db.insert(meetingParticipantsTable).values({
        sessionId,
        nodeId,
        roleId,
        displayName,
        status: "joined",
        joinedAt: now,
      });
    }

    logger.info({ sessionId, nodeId, displayName }, "Participant joined meeting");
    sseManager.broadcast(sessionId, "participant_joined", {
      sessionId, nodeId, roleId, displayName, joinedAt: now.toISOString(),
    });

    const updated = await db
      .select()
      .from(meetingParticipantsTable)
      .where(
        and(
          eq(meetingParticipantsTable.sessionId, sessionId),
          eq(meetingParticipantsTable.nodeId, nodeId),
        ),
      )
      .limit(1);

    return updated[0];
  }

  async leaveMeeting(sessionId: string, nodeId: string) {
    const db = getDb();

    const rows = await db
      .select()
      .from(meetingParticipantsTable)
      .where(
        and(
          eq(meetingParticipantsTable.sessionId, sessionId),
          eq(meetingParticipantsTable.nodeId, nodeId),
        ),
      )
      .limit(1);

    if (rows.length === 0) throw new NotFoundError("Participant");

    const now = new Date();
    await db
      .update(meetingParticipantsTable)
      .set({ status: "left", leftAt: now })
      .where(
        and(
          eq(meetingParticipantsTable.sessionId, sessionId),
          eq(meetingParticipantsTable.nodeId, nodeId),
        ),
      );

    logger.info({ sessionId, nodeId }, "Participant left meeting");
    sseManager.broadcast(sessionId, "participant_left", { sessionId, nodeId, leftAt: now.toISOString() });

    const updated = await db
      .select()
      .from(meetingParticipantsTable)
      .where(
        and(
          eq(meetingParticipantsTable.sessionId, sessionId),
          eq(meetingParticipantsTable.nodeId, nodeId),
        ),
      )
      .limit(1);

    return updated[0];
  }

  // ── Transcript ──────────────────────────────

  async addTranscriptEntry(data: {
    sessionId: string;
    speakerNodeId: string;
    speakerRole: string;
    content: string;
    type?: string;
    replyToId?: number;
    agendaItemIndex?: number;
    metadata?: unknown;
  }) {
    const db = getDb();

    const meetingRows = await db
      .select()
      .from(meetingSessionsTable)
      .where(eq(meetingSessionsTable.id, data.sessionId))
      .limit(1);

    if (meetingRows.length === 0) throw new NotFoundError("Meeting");

    if (meetingRows[0].status !== "active") {
      throw new BadRequestError(
        `Cannot add messages to meeting with status '${meetingRows[0].status}'. Meeting must be active.`,
      );
    }

    await db.insert(meetingTranscriptTable).values({
      sessionId: data.sessionId,
      speakerNodeId: data.speakerNodeId,
      speakerRole: data.speakerRole,
      content: data.content,
      type: (data.type ?? "statement") as "statement" | "question" | "answer" | "proposal" | "objection" | "agreement" | "system",
      replyToId: data.replyToId ?? null,
      agendaItemIndex: data.agendaItemIndex ?? null,
      metadata: data.metadata ?? null,
    });

    const inserted = await db
      .select()
      .from(meetingTranscriptTable)
      .where(eq(meetingTranscriptTable.sessionId, data.sessionId))
      .orderBy(desc(meetingTranscriptTable.id))
      .limit(1);

    const entry = inserted[0];

    logger.info({ sessionId: data.sessionId, entryId: entry.id }, "Transcript entry added");
    sseManager.broadcast(data.sessionId, "message", entry);

    return entry;
  }

  /**
   * Add a system/admin message bypassing the active-only check (for admin intervention during paused state).
   */
  async addSystemMessage(data: {
    sessionId: string;
    speakerNodeId: string;
    speakerRole: string;
    content: string;
  }) {
    const db = getDb();

    await db.insert(meetingTranscriptTable).values({
      sessionId: data.sessionId,
      speakerNodeId: data.speakerNodeId,
      speakerRole: data.speakerRole,
      content: data.content,
      type: "system",
    });

    const inserted = await db
      .select()
      .from(meetingTranscriptTable)
      .where(eq(meetingTranscriptTable.sessionId, data.sessionId))
      .orderBy(desc(meetingTranscriptTable.id))
      .limit(1);

    const entry = inserted[0];

    sseManager.broadcast(data.sessionId, "admin_message", entry);

    return entry;
  }

  async getTranscript(sessionId: string) {
    const db = getDb();

    const meetingRows = await db
      .select({ id: meetingSessionsTable.id })
      .from(meetingSessionsTable)
      .where(eq(meetingSessionsTable.id, sessionId))
      .limit(1);

    if (meetingRows.length === 0) throw new NotFoundError("Meeting");

    return db
      .select()
      .from(meetingTranscriptTable)
      .where(eq(meetingTranscriptTable.sessionId, sessionId))
      .orderBy(asc(meetingTranscriptTable.createdAt));
  }

  // ── Statistics ──────────────────────────────

  async getMeetingStats() {
    const db = getDb();

    const [totalResult, byStatus, byType, byInitiatorType] = await Promise.all([
      db.select({ count: sql<number>`COUNT(*)` }).from(meetingSessionsTable),
      db
        .select({ status: meetingSessionsTable.status, count: sql<number>`COUNT(*)` })
        .from(meetingSessionsTable)
        .groupBy(meetingSessionsTable.status),
      db
        .select({ type: meetingSessionsTable.type, count: sql<number>`COUNT(*)` })
        .from(meetingSessionsTable)
        .groupBy(meetingSessionsTable.type),
      db
        .select({ initiatorType: meetingSessionsTable.initiatorType, count: sql<number>`COUNT(*)` })
        .from(meetingSessionsTable)
        .groupBy(meetingSessionsTable.initiatorType),
    ]);

    return {
      total: totalResult[0]?.count ?? 0,
      byStatus: byStatus.reduce((acc, row) => { acc[row.status] = row.count; return acc; }, {} as Record<string, number>),
      byType: byType.reduce((acc, row) => { acc[row.type] = row.count; return acc; }, {} as Record<string, number>),
      byInitiatorType: byInitiatorType.reduce((acc, row) => { acc[row.initiatorType] = row.count; return acc; }, {} as Record<string, number>),
    };
  }

  // ── Auto Triggers ───────────────────────────

  async createTrigger(data: {
    name: string;
    description?: string;
    event: string;
    enabled?: boolean;
    facilitatorRole: string;
    meetingTemplate: unknown;
  }) {
    const db = getDb();
    const id = uuidv4();

    await db.insert(meetingAutoTriggersTable).values({
      id,
      name: data.name,
      description: data.description ?? null,
      event: data.event,
      enabled: data.enabled !== false,
      facilitatorRole: data.facilitatorRole,
      meetingTemplate: data.meetingTemplate,
      triggerCount: 0,
    });

    logger.info({ triggerId: id, name: data.name, event: data.event }, "Trigger created");

    const created = await db
      .select()
      .from(meetingAutoTriggersTable)
      .where(eq(meetingAutoTriggersTable.id, id))
      .limit(1);

    return created[0];
  }

  async listTriggers() {
    const db = getDb();
    return db
      .select()
      .from(meetingAutoTriggersTable)
      .orderBy(desc(meetingAutoTriggersTable.createdAt));
  }

  async updateTrigger(id: string, data: {
    name?: string;
    description?: string;
    event?: string;
    enabled?: boolean;
    facilitatorRole?: string;
    meetingTemplate?: unknown;
  }) {
    const db = getDb();

    const rows = await db
      .select()
      .from(meetingAutoTriggersTable)
      .where(eq(meetingAutoTriggersTable.id, id))
      .limit(1);

    if (rows.length === 0) throw new NotFoundError("Trigger");

    const updateSet: Record<string, unknown> = {};
    if (data.name !== undefined) updateSet.name = data.name;
    if (data.description !== undefined) updateSet.description = data.description;
    if (data.event !== undefined) updateSet.event = data.event;
    if (data.enabled !== undefined) updateSet.enabled = data.enabled;
    if (data.facilitatorRole !== undefined) updateSet.facilitatorRole = data.facilitatorRole;
    if (data.meetingTemplate !== undefined) updateSet.meetingTemplate = data.meetingTemplate;

    if (Object.keys(updateSet).length > 0) {
      await db
        .update(meetingAutoTriggersTable)
        .set(updateSet as typeof meetingAutoTriggersTable.$inferInsert)
        .where(eq(meetingAutoTriggersTable.id, id));
    }

    logger.info({ triggerId: id }, "Trigger updated");

    const updated = await db
      .select()
      .from(meetingAutoTriggersTable)
      .where(eq(meetingAutoTriggersTable.id, id))
      .limit(1);

    return updated[0];
  }

  async deleteTrigger(id: string) {
    const db = getDb();

    const rows = await db
      .select()
      .from(meetingAutoTriggersTable)
      .where(eq(meetingAutoTriggersTable.id, id))
      .limit(1);

    if (rows.length === 0) throw new NotFoundError("Trigger");

    await db.delete(meetingAutoTriggersTable).where(eq(meetingAutoTriggersTable.id, id));

    logger.info({ triggerId: id }, "Trigger deleted");

    return { deleted: id };
  }
}
