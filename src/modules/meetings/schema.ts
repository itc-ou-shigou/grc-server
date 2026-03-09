/**
 * Drizzle ORM Schema — Meetings Module (MySQL)
 *
 * Maps to the SQL tables:
 *   meeting_sessions, meeting_participants, meeting_transcript, meeting_auto_triggers
 *
 * Provides multi-agent meeting management for the A2A Protocol.
 */

import {
  mysqlTable,
  char,
  varchar,
  int,
  bigint,
  json,
  timestamp,
  text,
  mysqlEnum,
  boolean,
  serial,
  index,
  uniqueIndex,
} from "drizzle-orm/mysql-core";

// ── Meeting Sessions ────────────────────────────

export const meetingSessionsTable = mysqlTable(
  "meeting_sessions",
  {
    id: char("id", { length: 36 }).primaryKey().notNull(),
    title: varchar("title", { length: 500 }).notNull(),
    type: mysqlEnum("type", ["discussion", "review", "brainstorm", "decision"])
      .notNull()
      .default("discussion"),
    status: mysqlEnum("status", ["scheduled", "active", "paused", "concluded", "cancelled"])
      .notNull()
      .default("scheduled"),
    initiatorType: mysqlEnum("initiator_type", ["human", "agent"])
      .notNull()
      .default("human"),
    initiationReason: text("initiation_reason"),
    facilitatorNodeId: varchar("facilitator_node_id", { length: 255 }).notNull(),
    contextId: char("context_id", { length: 36 }).notNull(),
    sharedContext: text("shared_context"),
    turnPolicy: varchar("turn_policy", { length: 50 })
      .notNull()
      .default("facilitator-directed"),
    maxDurationMinutes: int("max_duration_minutes").notNull().default(60),
    agenda: json("agenda"),
    decisions: json("decisions"),
    actionItems: json("action_items"),
    summary: text("summary"),
    scheduledAt: timestamp("scheduled_at"),
    startedAt: timestamp("started_at"),
    endedAt: timestamp("ended_at"),
    createdBy: varchar("created_by", { length: 255 }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  (table) => [
    index("idx_ms_status").on(table.status),
    index("idx_ms_scheduled").on(table.scheduledAt),
    index("idx_ms_initiator").on(table.initiatorType),
    index("idx_ms_context").on(table.contextId),
    index("idx_ms_created").on(table.createdAt),
  ],
);

// ── Meeting Participants ────────────────────────

export const meetingParticipantsTable = mysqlTable(
  "meeting_participants",
  {
    id: serial("id").primaryKey(),
    sessionId: char("session_id", { length: 36 }).notNull(),
    nodeId: varchar("node_id", { length: 255 }).notNull(),
    roleId: varchar("role_id", { length: 100 }).notNull(),
    displayName: varchar("display_name", { length: 255 }).notNull(),
    status: mysqlEnum("status", ["invited", "joined", "speaking", "left"])
      .notNull()
      .default("invited"),
    invitedAt: timestamp("invited_at").notNull().defaultNow(),
    joinedAt: timestamp("joined_at"),
    leftAt: timestamp("left_at"),
  },
  (table) => [
    uniqueIndex("uk_mp_session_node").on(table.sessionId, table.nodeId),
    index("idx_mp_session").on(table.sessionId),
    index("idx_mp_node").on(table.nodeId),
  ],
);

// ── Meeting Transcript ──────────────────────────

export const meetingTranscriptTable = mysqlTable(
  "meeting_transcript",
  {
    id: serial("id").primaryKey(),
    sessionId: char("session_id", { length: 36 }).notNull(),
    speakerNodeId: varchar("speaker_node_id", { length: 255 }).notNull(),
    speakerRole: varchar("speaker_role", { length: 100 }).notNull(),
    content: text("content").notNull(),
    type: mysqlEnum("type", [
      "statement", "question", "answer", "proposal",
      "objection", "agreement", "system",
    ])
      .notNull()
      .default("statement"),
    replyToId: bigint("reply_to_id", { mode: "number" }),
    agendaItemIndex: int("agenda_item_index"),
    metadata: json("metadata"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_mt_session_time").on(table.sessionId, table.createdAt),
    index("idx_mt_speaker").on(table.speakerNodeId),
  ],
);

// ── Meeting Auto Triggers ───────────────────────

export const meetingAutoTriggersTable = mysqlTable(
  "meeting_auto_triggers",
  {
    id: char("id", { length: 36 }).primaryKey().notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    event: varchar("event", { length: 255 }).notNull(),
    enabled: boolean("enabled").notNull().default(true),
    facilitatorRole: varchar("facilitator_role", { length: 100 }).notNull(),
    meetingTemplate: json("meeting_template").notNull(),
    lastTriggeredAt: timestamp("last_triggered_at"),
    triggerCount: int("trigger_count").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  (table) => [
    index("idx_mat_event").on(table.event),
    index("idx_mat_enabled").on(table.enabled),
  ],
);
