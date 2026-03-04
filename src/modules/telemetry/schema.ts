/**
 * Telemetry Module — Drizzle ORM Schema
 *
 * Maps to the `telemetry_reports` table defined in 001_initial.sql.
 */

import {
  mysqlTable,
  char,
  varchar,
  int,
  date,
  timestamp,
  json,
  index,
  uniqueIndex,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

// ── Telemetry Reports Table ─────────────────────

export const telemetryReports = mysqlTable(
  "telemetry_reports",
  {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    nodeId: varchar("node_id", { length: 255 }).notNull(),
    anonymousId: varchar("anonymous_id", { length: 255 }),
    reportDate: date("report_date").notNull(),
    skillCalls: json("skill_calls"),
    geneUsage: json("gene_usage"),
    capsuleUsage: json("capsule_usage"),
    platform: varchar("platform", { length: 50 }),
    winclawVersion: varchar("winclaw_version", { length: 50 }),
    sessionCount: int("session_count").notNull().default(0),
    activeMinutes: int("active_minutes").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("uk_node_report_date").on(table.nodeId, table.reportDate),
    index("idx_report_date").on(table.reportDate),
  ],
);
