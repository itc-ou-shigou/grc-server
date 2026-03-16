/**
 * Drizzle ORM Schema — Strategy Module (MySQL)
 *
 * Maps to the SQL tables:
 *   company_strategy          — single-row current strategy
 *   company_strategy_history  — append-only revision history
 */

import {
  mysqlTable,
  char,
  varchar,
  int,
  json,
  text,
  timestamp,
  serial,
  index,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

// ── Company Strategy (single-row = current strategy) ─

export const companyStrategyTable = mysqlTable(
  "company_strategy",
  {
    id: char("id", { length: 36 }).primaryKey().notNull(),
    companyName: varchar("company_name", { length: 255 }),
    industry: varchar("industry", { length: 255 }),
    employeeCount: int("employee_count"),
    annualRevenueTarget: varchar("annual_revenue_target", { length: 100 }),
    fiscalYearStart: varchar("fiscal_year_start", { length: 50 }),
    fiscalYearEnd: varchar("fiscal_year_end", { length: 50 }),
    currency: varchar("currency", { length: 10 }).default("JPY"),
    language: varchar("language", { length: 50 }).default("ja"),
    timezone: varchar("timezone", { length: 50 }).default("Asia/Tokyo"),
    companyMission: text("company_mission"),
    companyVision: text("company_vision"),
    companyValues: text("company_values"),
    shortTermObjectives: json("short_term_objectives"),
    midTermObjectives: json("mid_term_objectives"),
    longTermObjectives: json("long_term_objectives"),
    departmentBudgets: json("department_budgets"),
    departmentKpis: json("department_kpis"),
    strategicPriorities: json("strategic_priorities"),
    revision: int("revision").notNull().default(1),
    updatedBy: varchar("updated_by", { length: 255 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
);

// ── Company Strategy History (append-only) ──────

export const companyStrategyHistoryTable = mysqlTable(
  "company_strategy_history",
  {
    id: serial("id").primaryKey(),
    strategyId: char("strategy_id", { length: 36 }).notNull(),
    revision: int("revision").notNull(),
    snapshot: json("snapshot").notNull(),
    changedBy: varchar("changed_by", { length: 255 }),
    changeSummary: text("change_summary"),
    changedFields: json("changed_fields"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_strategy_id").on(table.strategyId),
    index("idx_revision").on(table.revision),
    index("idx_created_at").on(table.createdAt),
  ],
);
