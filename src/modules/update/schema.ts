/**
 * Update Gateway Module — Drizzle ORM Schema
 *
 * Maps to the `client_releases` and `update_reports` tables defined in 001_initial.sql.
 */

import {
  mysqlTable,
  char,
  varchar,
  text,
  timestamp,
  int,
  tinyint,
  index,
  uniqueIndex,
} from "drizzle-orm/mysql-core";

// ── Client Releases Table ───────────────────────

export const clientReleases = mysqlTable(
  "client_releases",
  {
    id: char("id", { length: 36 }).primaryKey().notNull(),
    version: varchar("version", { length: 50 }).notNull(),
    channel: varchar("channel", { length: 20 }).notNull().default("stable"),
    platform: varchar("platform", { length: 20 }).notNull(),
    changelog: text("changelog"),
    downloadUrl: varchar("download_url", { length: 500 }).notNull(),
    sizeBytes: int("size_bytes").notNull(),
    checksumSha256: varchar("checksum_sha256", { length: 64 }),
    minUpgradeVersion: varchar("min_upgrade_version", { length: 50 }),
    isCritical: tinyint("is_critical").notNull().default(0),
    publishedAt: timestamp("published_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("uk_version_platform_channel").on(
      table.version,
      table.platform,
      table.channel,
    ),
    index("idx_channel_platform").on(table.channel, table.platform),
  ],
);

// ── Update Reports Table ────────────────────────

export const updateReports = mysqlTable(
  "update_reports",
  {
    id: char("id", { length: 36 }).primaryKey().notNull(),
    nodeId: varchar("node_id", { length: 255 }),
    fromVersion: varchar("from_version", { length: 50 }),
    toVersion: varchar("to_version", { length: 50 }),
    platform: varchar("platform", { length: 20 }),
    status: varchar("status", { length: 20 }).notNull().default("success"),
    errorMessage: text("error_message"),
    durationMs: int("duration_ms"),
    reportedAt: timestamp("reported_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_node_id").on(table.nodeId),
    index("idx_to_version").on(table.toVersion),
    index("idx_reported_at").on(table.reportedAt),
  ],
);
