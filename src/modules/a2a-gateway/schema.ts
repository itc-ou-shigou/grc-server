/**
 * Drizzle ORM Schema — A2A Gateway Module (MySQL)
 *
 * Maps to the SQL table:
 *   agent_cards
 *
 * Provides Agent Card registry for A2A Protocol peer discovery.
 */

import {
  mysqlTable,
  char,
  varchar,
  json,
  timestamp,
  mysqlEnum,
  index,
} from "drizzle-orm/mysql-core";

// ── Agent Cards Registry ────────────────────────

export const agentCardsTable = mysqlTable(
  "agent_cards",
  {
    nodeId: char("node_id", { length: 36 }).primaryKey().notNull(),
    agentCard: json("agent_card").notNull(),
    skills: json("skills"),
    capabilities: json("capabilities"),
    lastSeenAt: timestamp("last_seen_at"),
    status: mysqlEnum("status", ["online", "offline", "busy"])
      .notNull()
      .default("offline"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  (table) => [
    index("idx_agent_status").on(table.status),
    index("idx_agent_last_seen").on(table.lastSeenAt),
  ],
);
