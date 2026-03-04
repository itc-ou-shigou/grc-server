/**
 * Drizzle ORM Schema — Evolution Pool tables (MySQL)
 *
 * Maps to the SQL tables defined in 001_initial.sql:
 *   nodes, genes, capsules, asset_reports, evolution_events
 */

import {
  mysqlTable,
  char,
  varchar,
  int,
  float,
  tinyint,
  json,
  timestamp,
  text,
  uniqueIndex,
  index,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

// ── Nodes ────────────────────────────────────────

export const nodesTable = mysqlTable(
  "nodes",
  {
    id: char("id", { length: 36 }).primaryKey().notNull(),
    nodeId: varchar("node_id", { length: 255 }).notNull(),
    userId: char("user_id", { length: 36 }),
    displayName: varchar("display_name", { length: 255 }),
    platform: varchar("platform", { length: 50 }),
    winclawVersion: varchar("winclaw_version", { length: 50 }),
    lastHeartbeat: timestamp("last_heartbeat"),
    capabilities: json("capabilities"),
    geneCount: int("gene_count").notNull().default(0),
    capsuleCount: int("capsule_count").notNull().default(0),
    envFingerprint: varchar("env_fingerprint", { length: 255 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  (table) => [
    uniqueIndex("uk_node_id").on(table.nodeId),
    index("idx_user_id").on(table.userId),
    index("idx_last_heartbeat").on(table.lastHeartbeat),
  ],
);

// ── Genes ────────────────────────────────────────

export const genesTable = mysqlTable(
  "genes",
  {
    id: char("id", { length: 36 }).primaryKey().notNull(),
    assetId: varchar("asset_id", { length: 255 }).notNull(),
    nodeId: varchar("node_id", { length: 255 }),
    userId: char("user_id", { length: 36 }),
    category: varchar("category", { length: 50 }),
    signalsMatch: json("signals_match"),
    strategy: json("strategy"),
    constraintsData: json("constraints_data"),
    validation: json("validation"),
    contentHash: varchar("content_hash", { length: 64 }),
    signature: varchar("signature", { length: 255 }),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    useCount: int("use_count").notNull().default(0),
    failCount: int("fail_count").notNull().default(0),
    successRate: float("success_rate").notNull().default(0),
    chainId: varchar("chain_id", { length: 255 }),
    schemaVersion: int("schema_version").notNull().default(1),
    safetyScore: float("safety_score"),
    promotedAt: timestamp("promoted_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  (table) => [
    uniqueIndex("uk_asset_id").on(table.assetId),
    index("idx_status").on(table.status),
    index("idx_node_id").on(table.nodeId),
    index("idx_content_hash").on(table.contentHash),
    index("idx_use_count").on(table.useCount),
  ],
);

// ── Capsules ─────────────────────────────────────

export const capsulesTable = mysqlTable(
  "capsules",
  {
    id: char("id", { length: 36 }).primaryKey().notNull(),
    assetId: varchar("asset_id", { length: 255 }).notNull(),
    geneAssetId: varchar("gene_asset_id", { length: 255 }),
    nodeId: varchar("node_id", { length: 255 }),
    userId: char("user_id", { length: 36 }),
    contentHash: varchar("content_hash", { length: 64 }),
    triggerData: json("trigger_data"),
    summary: text("summary"),
    signature: varchar("signature", { length: 255 }),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    useCount: int("use_count").notNull().default(0),
    confidence: float("confidence"),
    successStreak: int("success_streak").notNull().default(0),
    successRate: float("success_rate").notNull().default(0),
    chainId: varchar("chain_id", { length: 255 }),
    schemaVersion: int("schema_version").notNull().default(1),
    safetyScore: float("safety_score"),
    promotedAt: timestamp("promoted_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  (table) => [
    uniqueIndex("capsules_uk_asset_id").on(table.assetId),
    index("capsules_idx_status").on(table.status),
    index("capsules_idx_node_id").on(table.nodeId),
  ],
);

// ── Asset Reports ────────────────────────────────

export const assetReportsTable = mysqlTable(
  "asset_reports",
  {
    id: char("id", { length: 36 }).primaryKey().notNull(),
    assetId: varchar("asset_id", { length: 255 }).notNull(),
    assetType: varchar("asset_type", { length: 20 }).notNull(),
    reporterNodeId: varchar("reporter_node_id", { length: 255 }).notNull(),
    reporterUserId: char("reporter_user_id", { length: 36 }),
    reportType: varchar("report_type", { length: 20 }).notNull(),
    details: json("details"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_asset_id").on(table.assetId),
    index("idx_reporter").on(table.reporterNodeId),
  ],
);

// ── Evolution Events ─────────────────────────────

export const evolutionEventsTable = mysqlTable(
  "evolution_events",
  {
    id: char("id", { length: 36 }).primaryKey().notNull(),
    eventType: varchar("event_type", { length: 30 }).notNull(),
    assetId: varchar("asset_id", { length: 255 }),
    assetType: varchar("asset_type", { length: 10 }),
    nodeId: varchar("node_id", { length: 255 }),
    userId: char("user_id", { length: 36 }),
    details: json("details"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("events_idx_asset_id").on(table.assetId),
    index("idx_event_type").on(table.eventType),
    index("events_idx_created_at").on(table.createdAt),
  ],
);
