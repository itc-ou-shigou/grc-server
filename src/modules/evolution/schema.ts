/**
 * Drizzle ORM Schema — Evolution Pool tables (MySQL)
 *
 * Maps to the SQL tables defined in 001_initial.sql:
 *   nodes, genes, capsules, asset_reports, evolution_events
 */

import {
  mysqlTable,
  mysqlEnum,
  mediumtext,
  boolean,
  char,
  varchar,
  int,
  float,
  tinyint,
  json,
  timestamp,
  text,
  datetime,
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
    employeeId: varchar("employee_id", { length: 100 }),
    employeeName: varchar("employee_name", { length: 255 }),
    employeeEmail: varchar("employee_email", { length: 255 }),
    // ── Role assignment fields (006_nodes_role.sql) ──
    roleId: varchar("role_id", { length: 50 }),
    roleMode: mysqlEnum("role_mode", ["autonomous", "copilot"]),
    configRevision: int("config_revision").notNull().default(0),
    configAppliedRevision: int("config_applied_revision").notNull().default(0),
    assignmentVariables: json("assignment_variables"),
    configOverrides: json("config_overrides"),
    resolvedAgentsMd: mediumtext("resolved_agents_md"),
    resolvedSoulMd: mediumtext("resolved_soul_md"),
    resolvedIdentityMd: mediumtext("resolved_identity_md"),
    resolvedUserMd: mediumtext("resolved_user_md"),
    resolvedToolsMd: mediumtext("resolved_tools_md"),
    resolvedHeartbeatMd: mediumtext("resolved_heartbeat_md"),
    resolvedBootstrapMd: mediumtext("resolved_bootstrap_md"),
    resolvedTasksMd: mediumtext("resolved_tasks_md"),
    // ── Key assignment fields (010_ai_model_keys.sql) ──
    primaryKeyId: char("primary_key_id", { length: 36 }),
    auxiliaryKeyId: char("auxiliary_key_id", { length: 36 }),
    keyConfigJson: json("key_config_json"),
    // ── API Key authorization fields (032_node_api_key.sql) ──
    apiKeyId: char("api_key_id", { length: 36 }),
    apiKeyAuthorized: boolean("api_key_authorized").notNull().default(false),
    githubToken: text("github_token"),
    // ── Node provisioning fields (014_node_provisioning.sql) ──
    provisioningMode: mysqlEnum("provisioning_mode", ["local_docker", "daytona_sandbox"]),
    containerId: varchar("container_id", { length: 255 }),
    sandboxId: varchar("sandbox_id", { length: 255 }),
    gatewayUrl: varchar("gateway_url", { length: 500 }),
    gatewayPort: int("gateway_port"),
    workspacePath: varchar("workspace_path", { length: 500 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  (table) => [
    uniqueIndex("uk_node_id").on(table.nodeId),
    index("idx_user_id").on(table.userId),
    index("idx_last_heartbeat").on(table.lastHeartbeat),
    index("idx_role_id").on(table.roleId),
    index("idx_config_revision").on(table.configRevision),
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
    contentHash: varchar("content_hash", { length: 2000 }),
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
    contentHash: varchar("content_hash", { length: 2000 }),
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

// ── Asset Votes ─────────────────────────────────

export const assetVotesTable = mysqlTable("asset_votes", {
  id: char("id", { length: 36 }).primaryKey(),
  assetId: char("asset_id", { length: 36 }).notNull(),
  assetType: mysqlEnum("asset_type", ["gene", "capsule"]).notNull(),
  voterNodeId: varchar("voter_node_id", { length: 255 }).notNull(),
  vote: mysqlEnum("vote", ["upvote", "downvote"]).notNull(),
  reason: text("reason"),
  createdAt: datetime("created_at").default(sql`NOW()`),
}, (table) => [
  uniqueIndex("uk_asset_voter").on(table.assetId, table.voterNodeId),
  index("idx_asset_id").on(table.assetId),
]);
