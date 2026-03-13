/**
 * Strategy Service — Business logic for the Strategy module.
 *
 * Handles company strategy CRUD, revision history, deployment cascade,
 * department budgets/KPIs, and template variable injection.
 */

import { v4 as uuidv4 } from "uuid";
import { eq, desc, sql } from "drizzle-orm";
import pino from "pino";
import { getDb } from "../../shared/db/connection.js";
import {
  companyStrategyTable,
  companyStrategyHistoryTable,
} from "./schema.js";
import { nodesTable } from "../evolution/schema.js";
import { roleTemplatesTable } from "../roles/schema.js";
import {
  NotFoundError,
} from "../../shared/middleware/error-handler.js";

import { nodeConfigSSE } from "../evolution/node-config-sse.js";

// Roles that receive full strategy access (all objectives, budgets, KPIs)
const FULL_ACCESS_ROLES = new Set(["ceo", "executive", "strategic-planner"]);

const logger = pino({ name: "module:strategy:service" });

// ── Default Strategy Skeleton ───────────────────

const DEFAULT_STRATEGY = {
  companyMission: "",
  companyVision: "",
  companyValues: "",
  shortTermObjectives: [],
  midTermObjectives: [],
  longTermObjectives: [],
  departmentBudgets: {},
  departmentKpis: {},
  strategicPriorities: [],
};

// ── StrategyService ─────────────────────────────

export class StrategyService {
  /**
   * Get current strategy (single row), create default if none exists.
   */
  async getStrategy(): Promise<Record<string, unknown>> {
    const db = getDb();

    const rows = await db
      .select()
      .from(companyStrategyTable)
      .limit(1);

    if (rows.length > 0) {
      return rows[0] as unknown as Record<string, unknown>;
    }

    // Create default strategy
    const id = uuidv4();
    await db.insert(companyStrategyTable).values({
      id,
      ...DEFAULT_STRATEGY,
      revision: 1,
      updatedBy: "system",
    });

    const created = await db
      .select()
      .from(companyStrategyTable)
      .where(eq(companyStrategyTable.id, id))
      .limit(1);

    logger.info("Default strategy created");

    return created[0] as unknown as Record<string, unknown>;
  }

  /**
   * Update strategy, increment revision, save snapshot to history.
   */
  async updateStrategy(
    data: Partial<{
      companyMission: string;
      companyVision: string;
      companyValues: string;
      shortTermObjectives: unknown;
      midTermObjectives: unknown;
      longTermObjectives: unknown;
      departmentBudgets: unknown;
      departmentKpis: unknown;
      strategicPriorities: unknown;
    }>,
    updatedBy: string,
  ): Promise<Record<string, unknown>> {
    const db = getDb();

    // Get current strategy (or create default)
    const current = await this.getStrategy();
    const strategyId = current.id as string;
    const currentRevision = (current.revision as number) ?? 1;
    const newRevision = currentRevision + 1;

    // Detect changed fields
    const changedFields: string[] = [];
    for (const key of Object.keys(data) as Array<keyof typeof data>) {
      if (data[key] !== undefined) {
        changedFields.push(key);
      }
    }

    // Save current state as history snapshot before update
    await db.insert(companyStrategyHistoryTable).values({
      strategyId,
      revision: currentRevision,
      snapshot: current,
      changedBy: updatedBy,
      changeSummary: `Updated fields: ${changedFields.join(", ")}`,
      changedFields,
    });

    // Build update set
    const updateSet: Record<string, unknown> = {
      revision: newRevision,
      updatedBy,
    };

    if (data.companyMission !== undefined) updateSet.companyMission = data.companyMission;
    if (data.companyVision !== undefined) updateSet.companyVision = data.companyVision;
    if (data.companyValues !== undefined) updateSet.companyValues = data.companyValues;
    if (data.shortTermObjectives !== undefined) updateSet.shortTermObjectives = data.shortTermObjectives;
    if (data.midTermObjectives !== undefined) updateSet.midTermObjectives = data.midTermObjectives;
    if (data.longTermObjectives !== undefined) updateSet.longTermObjectives = data.longTermObjectives;
    if (data.departmentBudgets !== undefined) updateSet.departmentBudgets = data.departmentBudgets;
    if (data.departmentKpis !== undefined) updateSet.departmentKpis = data.departmentKpis;
    if (data.strategicPriorities !== undefined) updateSet.strategicPriorities = data.strategicPriorities;

    await db
      .update(companyStrategyTable)
      .set(updateSet as typeof companyStrategyTable.$inferInsert)
      .where(eq(companyStrategyTable.id, strategyId));

    logger.info(
      { strategyId, revision: newRevision, changedFields, updatedBy },
      "Strategy updated",
    );

    // Return updated row
    const updated = await db
      .select()
      .from(companyStrategyTable)
      .where(eq(companyStrategyTable.id, strategyId))
      .limit(1);

    return updated[0] as unknown as Record<string, unknown>;
  }

  /**
   * Deploy strategy cascade:
   * 1. Fetch current strategy from company_strategy
   * 2. Get all nodes with a roleId (dedicated column)
   * 3. For each node:
   *    a. Fetch the role template's original userMd from role_templates
   *    b. Apply static assignment variables (employee_name, node_id, etc.)
   *    c. Apply strategy variables (company_mission, department_budget, etc.)
   *    d. Write result to resolvedUserMd column (dedicated column on nodes)
   *    e. Increment configRevision on the node
   *    f. Push config update via SSE if node is connected
   *
   * Note: Task creation is handled autonomously by the CEO agent via
   * the grc_task tool during heartbeat runs, not by this method.
   */
  async deployStrategy(updatedBy: string): Promise<{
    nodesUpdated: number;
    revision: number;
  }> {
    const db = getDb();

    // 1. Get current strategy
    const strategy = await this.getStrategy();
    const revision = strategy.revision as number;

    // 2. Get all nodes that have a role assigned (dedicated column)
    const nodesWithRoles = await db
      .select()
      .from(nodesTable)
      .where(sql`${nodesTable.roleId} IS NOT NULL`);

    // Pre-fetch all role templates that are referenced, keyed by id
    const roleIds = [...new Set(nodesWithRoles.map((n) => n.roleId!))];
    const roleTemplateMap = new Map<string, typeof roleTemplatesTable.$inferSelect>();

    if (roleIds.length > 0) {
      const templates = await db
        .select()
        .from(roleTemplatesTable);
      for (const t of templates) {
        roleTemplateMap.set(t.id, t);
      }
    }

    let nodesUpdated = 0;

    for (const node of nodesWithRoles) {
      const roleId = node.roleId!;
      const template = roleTemplateMap.get(roleId);
      if (!template) {
        logger.warn({ nodeId: node.nodeId, roleId }, "Role template not found, skipping");
        continue;
      }

      // 3a. Start with the original USER.md template from role_templates
      let userMd = template.userMd;

      // 3b. Apply static assignment variables (employee_name, node_id, etc.)
      const assignmentVars = (node.assignmentVariables as Record<string, string>) ?? {};
      userMd = this._resolveTemplate(userMd, assignmentVars);

      // 3c. Determine department from template, then build and apply strategy variables
      const department = template.department ?? undefined;
      const strategyVars = this.buildStrategyVariables(strategy, roleId, department);
      userMd = this._resolveTemplate(userMd, strategyVars);

      // 3d-e. Write resolvedUserMd and increment configRevision (dedicated columns)
      const newNodeRevision = node.configRevision + 1;
      await db
        .update(nodesTable)
        .set({
          resolvedUserMd: userMd,
          configRevision: newNodeRevision,
        })
        .where(eq(nodesTable.nodeId, node.nodeId));

      nodesUpdated++;

      // 3f. Push config update to node via SSE (if connected) so it syncs immediately
      if (nodeConfigSSE.isNodeConnected(node.nodeId)) {
        nodeConfigSSE.pushToNode(node.nodeId, {
          revision: newNodeRevision,
          reason: "strategy_deploy",
        });
        logger.info(
          { nodeId: node.nodeId, revision: newNodeRevision },
          "Strategy deploy SSE push sent to node",
        );
      }
    }

    logger.info(
      { revision, nodesUpdated, updatedBy },
      "Strategy deployed to all nodes",
    );

    return { nodesUpdated, revision };
  }

  /**
   * Get paginated revision history.
   */
  async getHistory(opts: { page: number; limit: number }) {
    const db = getDb();
    const offset = (opts.page - 1) * opts.limit;

    const [rows, totalResult] = await Promise.all([
      db
        .select()
        .from(companyStrategyHistoryTable)
        .orderBy(desc(companyStrategyHistoryTable.revision))
        .limit(opts.limit)
        .offset(offset),
      db
        .select({ count: sql<number>`COUNT(*)` })
        .from(companyStrategyHistoryTable),
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

  /**
   * Get specific revision snapshot.
   */
  async getHistoryRevision(revision: number): Promise<Record<string, unknown>> {
    const db = getDb();

    const rows = await db
      .select()
      .from(companyStrategyHistoryTable)
      .where(eq(companyStrategyHistoryTable.revision, revision))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundError("Strategy revision");
    }

    return rows[0] as unknown as Record<string, unknown>;
  }

  /**
   * Compare two revisions and return a diff summary.
   */
  async getDiff(
    rev1: number,
    rev2: number,
  ): Promise<{
    rev1: number;
    rev2: number;
    snapshot1: unknown;
    snapshot2: unknown;
    changedFields: string[];
  }> {
    const db = getDb();

    const [rows1, rows2] = await Promise.all([
      db
        .select()
        .from(companyStrategyHistoryTable)
        .where(eq(companyStrategyHistoryTable.revision, rev1))
        .limit(1),
      db
        .select()
        .from(companyStrategyHistoryTable)
        .where(eq(companyStrategyHistoryTable.revision, rev2))
        .limit(1),
    ]);

    if (rows1.length === 0) throw new NotFoundError(`Strategy revision ${rev1}`);
    if (rows2.length === 0) throw new NotFoundError(`Strategy revision ${rev2}`);

    const snap1 = rows1[0].snapshot as Record<string, unknown>;
    const snap2 = rows2[0].snapshot as Record<string, unknown>;

    // Detect fields that differ between snapshots
    const allKeys = new Set([...Object.keys(snap1), ...Object.keys(snap2)]);
    const changedFields: string[] = [];

    for (const key of allKeys) {
      if (JSON.stringify(snap1[key]) !== JSON.stringify(snap2[key])) {
        changedFields.push(key);
      }
    }

    return {
      rev1,
      rev2,
      snapshot1: snap1,
      snapshot2: snap2,
      changedFields,
    };
  }

  /**
   * Get department budgets from current strategy.
   */
  async getBudgets(): Promise<Record<string, unknown>> {
    const strategy = await this.getStrategy();
    return (strategy.departmentBudgets as Record<string, unknown>) ?? {};
  }

  /**
   * Update a single department's budget within the strategy.
   */
  async updateBudgets(
    dept: string,
    budgetData: unknown,
    updatedBy: string,
  ): Promise<Record<string, unknown>> {
    const strategy = await this.getStrategy();
    const budgets = (strategy.departmentBudgets as Record<string, unknown>) ?? {};
    budgets[dept] = budgetData;

    const updated = await this.updateStrategy(
      { departmentBudgets: budgets },
      updatedBy,
    );

    return (updated.departmentBudgets as Record<string, unknown>) ?? {};
  }

  /**
   * Get department KPIs from current strategy.
   */
  async getKpis(): Promise<Record<string, unknown>> {
    const strategy = await this.getStrategy();
    return (strategy.departmentKpis as Record<string, unknown>) ?? {};
  }

  /**
   * Update a single department's KPIs within the strategy.
   */
  async updateKpis(
    dept: string,
    kpiData: unknown,
    updatedBy: string,
  ): Promise<Record<string, unknown>> {
    const strategy = await this.getStrategy();
    const kpis = (strategy.departmentKpis as Record<string, unknown>) ?? {};
    kpis[dept] = kpiData;

    const updated = await this.updateStrategy(
      { departmentKpis: kpis },
      updatedBy,
    );

    return (updated.departmentKpis as Record<string, unknown>) ?? {};
  }

  /**
   * Build template variables from strategy for a given role.
   * Full-access roles (ceo, executive, strategic-planner) get all strategy
   * details. Department roles get mission, values, their own budget/KPIs,
   * and current quarter goals.
   *
   * @param strategy  Pre-fetched strategy row from company_strategy table
   * @param roleId    The role id of the node being rendered
   * @param department  Optional department name for budget/KPI lookup
   */
  buildStrategyVariables(
    strategy: Record<string, unknown>,
    roleId: string,
    department?: string,
  ): Record<string, string> {
    return this._buildStrategyVarsSync(strategy, roleId, department);
  }

  /**
   * Internal: build strategy variables synchronously from a pre-fetched strategy.
   * Produces actual formatted content suitable for USER.md template injection.
   */
  private _buildStrategyVarsSync(
    strategy: Record<string, unknown>,
    roleId: string,
    department?: string,
  ): Record<string, string> {
    const isFullAccess = FULL_ACCESS_ROLES.has(roleId.toLowerCase());

    const vars: Record<string, string> = {};

    // ── Common variables (all roles) ──────────────────
    vars.company_mission = (strategy.companyMission as string) || "(not set)";
    vars.company_values = (strategy.companyValues as string) || "(not set)";
    vars.strategy_revision = String(strategy.revision ?? 1);
    vars.current_quarter_goals = this._formatObjectivesList(
      strategy.shortTermObjectives,
      "Current Quarter Goals",
    );

    if (isFullAccess) {
      // ── Full-access variables ─────────────────────
      vars.company_vision = (strategy.companyVision as string) || "(not set)";
      vars.company_strategy_summary = this._formatStrategySummary(strategy);
      vars.annual_targets = this._formatObjectivesList(
        strategy.midTermObjectives,
        "Annual Targets",
      );
      vars.long_term_vision = this._formatObjectivesList(
        strategy.longTermObjectives,
        "Long-Term Vision",
      );
      vars.strategic_priorities = this._formatPrioritiesList(
        strategy.strategicPriorities,
      );
    } else {
      // ── Department-scoped variables ───────────────
      const dept = department ?? roleId;
      vars.department_budget = this._formatDepartmentBudget(
        strategy.departmentBudgets,
        dept,
      );
      vars.department_kpis = this._formatDepartmentKpis(
        strategy.departmentKpis,
        dept,
      );
    }

    return vars;
  }

  // ── Formatting helpers ──────────────────────────────

  /**
   * Format an objectives array (short/mid/long-term) as a markdown list.
   */
  private _formatObjectivesList(
    objectives: unknown,
    heading: string,
  ): string {
    if (!objectives || !Array.isArray(objectives) || objectives.length === 0) {
      return `No ${heading.toLowerCase()} defined.`;
    }
    const lines = objectives.map((obj, i) => {
      if (typeof obj === "string") return `${i + 1}. ${obj}`;
      if (typeof obj === "object" && obj !== null) {
        const o = obj as Record<string, unknown>;
        const title = o.title ?? o.name ?? o.objective ?? o.goal ?? JSON.stringify(o);
        const detail = o.description ?? o.details ?? o.metric ?? "";
        return detail
          ? `${i + 1}. **${title}** - ${detail}`
          : `${i + 1}. ${title}`;
      }
      return `${i + 1}. ${String(obj)}`;
    });
    return lines.join("\n");
  }

  /**
   * Format strategic priorities as a markdown list.
   */
  private _formatPrioritiesList(priorities: unknown): string {
    if (!priorities || !Array.isArray(priorities) || priorities.length === 0) {
      return "No strategic priorities defined.";
    }
    return priorities
      .map((p, i) => {
        if (typeof p === "string") return `${i + 1}. ${p}`;
        if (typeof p === "object" && p !== null) {
          const o = p as Record<string, unknown>;
          return `${i + 1}. ${o.title ?? o.name ?? o.priority ?? JSON.stringify(o)}`;
        }
        return `${i + 1}. ${String(p)}`;
      })
      .join("\n");
  }

  /**
   * Build a high-level strategy summary combining all objective tiers.
   */
  private _formatStrategySummary(strategy: Record<string, unknown>): string {
    const sections: string[] = [];
    const mission = (strategy.companyMission as string) || "";
    if (mission) sections.push(`**Mission:** ${mission}`);
    const vision = (strategy.companyVision as string) || "";
    if (vision) sections.push(`**Vision:** ${vision}`);

    const shortCount = Array.isArray(strategy.shortTermObjectives)
      ? strategy.shortTermObjectives.length : 0;
    const midCount = Array.isArray(strategy.midTermObjectives)
      ? strategy.midTermObjectives.length : 0;
    const longCount = Array.isArray(strategy.longTermObjectives)
      ? strategy.longTermObjectives.length : 0;

    sections.push(
      `**Objectives:** ${shortCount} short-term, ${midCount} mid-term, ${longCount} long-term`,
    );

    const priorityCount = Array.isArray(strategy.strategicPriorities)
      ? strategy.strategicPriorities.length : 0;
    if (priorityCount > 0) {
      sections.push(`**Strategic Priorities:** ${priorityCount} active`);
    }

    return sections.join("\n");
  }

  /**
   * Format a single department's budget as readable text.
   */
  private _formatDepartmentBudget(
    budgets: unknown,
    department: string,
  ): string {
    if (!budgets || typeof budgets !== "object") {
      return "No budget information available.";
    }
    const budgetMap = budgets as Record<string, unknown>;
    // Try exact match, then case-insensitive
    const key = Object.keys(budgetMap).find(
      (k) => k === department || k.toLowerCase() === department.toLowerCase(),
    );
    if (!key) return `No budget defined for ${department}.`;
    const data = budgetMap[key];
    if (typeof data === "string" || typeof data === "number") {
      return String(data);
    }
    if (typeof data === "object" && data !== null) {
      const obj = data as Record<string, unknown>;
      return Object.entries(obj)
        .map(([k, v]) => `- **${k}:** ${v}`)
        .join("\n");
    }
    return String(data);
  }

  /**
   * Format a single department's KPIs as readable text.
   */
  private _formatDepartmentKpis(
    kpis: unknown,
    department: string,
  ): string {
    if (!kpis || typeof kpis !== "object") {
      return "No KPI information available.";
    }
    const kpiMap = kpis as Record<string, unknown>;
    const key = Object.keys(kpiMap).find(
      (k) => k === department || k.toLowerCase() === department.toLowerCase(),
    );
    if (!key) return `No KPIs defined for ${department}.`;
    const data = kpiMap[key];
    if (typeof data === "string") return data;
    if (Array.isArray(data)) {
      return data
        .map((item, i) => {
          if (typeof item === "string") return `${i + 1}. ${item}`;
          if (typeof item === "object" && item !== null) {
            const o = item as Record<string, unknown>;
            const name = o.name ?? o.kpi ?? o.metric ?? "";
            const target = o.target ?? o.value ?? "";
            return target
              ? `${i + 1}. **${name}** (target: ${target})`
              : `${i + 1}. ${name}`;
          }
          return `${i + 1}. ${String(item)}`;
        })
        .join("\n");
    }
    if (typeof data === "object" && data !== null) {
      const obj = data as Record<string, unknown>;
      return Object.entries(obj)
        .map(([k, v]) => `- **${k}:** ${v}`)
        .join("\n");
    }
    return String(data);
  }

  /**
   * Resolve ${variable_name} placeholders in a template string.
   * Unmatched placeholders are left as-is so subsequent passes can resolve them.
   */
  private _resolveTemplate(
    template: string,
    vars: Record<string, string>,
  ): string {
    return template.replace(/\$\{(\w+)\}/g, (match, key: string) => {
      return vars[key] ?? match;
    });
  }
}
