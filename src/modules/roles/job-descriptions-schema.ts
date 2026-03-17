/**
 * Drizzle ORM Schema — Role Job Descriptions (MySQL)
 *
 * Maps to the SQL table:
 *   role_job_descriptions
 *
 * Stores structured job description data for each role,
 * used by A2A collaboration to understand role boundaries and expertise.
 */

import {
  mysqlTable,
  varchar,
  text,
  json,
  int,
  timestamp,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

// ── Role Job Descriptions ──────────────────────────

export const roleJobDescriptionsTable = mysqlTable(
  "role_job_descriptions",
  {
    id: int("id").autoincrement().primaryKey(),
    roleId: varchar("role_id", { length: 50 }).notNull().unique(),
    displayName: varchar("display_name", { length: 100 }).notNull(),
    summary: text("summary").notNull(),
    responsibilities: text("responsibilities").notNull(),
    expertise: json("expertise"), // string[]
    reportsTo: varchar("reports_to", { length: 50 }),
    collaboration: json("collaboration"), // Record<string, string>
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
);
