/**
 * Platform Module — Drizzle ORM Schema
 *
 * Maps to the `platform_values` table defined in 001_initial.sql.
 * Stores platform-wide values/culture content (Markdown) shared across all WinClaw clients.
 */

import {
  mysqlTable,
  char,
  varchar,
  text,
  timestamp,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

// ── Platform Values Table ────────────────────────

export const platformValues = mysqlTable("platform_values", {
  id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
  content: text("content").notNull().default(""),
  contentHash: varchar("content_hash", { length: 64 }).notNull().default(""),
  updatedBy: char("updated_by", { length: 36 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});
