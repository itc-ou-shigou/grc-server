/**
 * Roles Service — Role template CRUD, assignment, and config resolution
 *
 * Manages role templates for WinClaw agent identity configuration.
 * Handles template variable substitution and node-level config resolution.
 */

import { v4 as uuidv4 } from "uuid";
import { eq, desc, sql, and, like, isNotNull, gte } from "drizzle-orm";
import pino from "pino";
import { getDb } from "../../shared/db/connection.js";
import { roleTemplatesTable, nodesTable } from "./schema.js";
import {
  BadRequestError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
} from "../../shared/middleware/error-handler.js";

import { nodeConfigSSE } from "../evolution/node-config-sse.js";
import { CompanyContextGenerator } from "./context-generator.js";

const logger = pino({ name: "module:roles:service" });

// ── MD field names (DB column names -> camelCase mapping) ──

const MD_FIELDS = [
  "agentsMd",
  "soulMd",
  "identityMd",
  "userMd",
  "toolsMd",
  "heartbeatMd",
  "bootstrapMd",
  "tasksMd",
] as const;

const MD_FILE_MAP: Record<string, (typeof MD_FIELDS)[number]> = {
  "AGENTS.md": "agentsMd",
  "SOUL.md": "soulMd",
  "IDENTITY.md": "identityMd",
  "USER.md": "userMd",
  "TOOLS.md": "toolsMd",
  "HEARTBEAT.md": "heartbeatMd",
  "BOOTSTRAP.md": "bootstrapMd",
  "TASKS.md": "tasksMd",
};

// ── Roles Service ────────────────────────────────

export class RolesService {
  /**
   * List role templates with pagination and optional filters.
   */
  async listTemplates(opts: {
    page: number;
    limit: number;
    industry?: string;
    department?: string;
    mode?: string;
  }): Promise<{ templates: Record<string, unknown>[]; total: number }> {
    const db = getDb();
    const offset = (opts.page - 1) * opts.limit;

    // Build where conditions
    const conditions = [];
    if (opts.industry) {
      conditions.push(like(roleTemplatesTable.industry, `%${opts.industry}%`));
    }
    if (opts.department) {
      conditions.push(like(roleTemplatesTable.department, `%${opts.department}%`));
    }
    if (opts.mode) {
      conditions.push(eq(roleTemplatesTable.mode, opts.mode as "autonomous" | "copilot"));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, totalResult] = await Promise.all([
      db
        .select()
        .from(roleTemplatesTable)
        .where(whereClause)
        .orderBy(desc(roleTemplatesTable.createdAt))
        .limit(opts.limit)
        .offset(offset),
      db
        .select({ count: sql<number>`COUNT(*)` })
        .from(roleTemplatesTable)
        .where(whereClause),
    ]);

    const total = Number(totalResult[0]?.count ?? 0);

    return {
      templates: rows as unknown as Record<string, unknown>[],
      total,
    };
  }

  /**
   * Get a single role template by ID.
   */
  async getTemplate(id: string): Promise<Record<string, unknown>> {
    const db = getDb();

    const rows = await db
      .select()
      .from(roleTemplatesTable)
      .where(eq(roleTemplatesTable.id, id))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundError("Role template");
    }

    return rows[0] as unknown as Record<string, unknown>;
  }

  /**
   * Create a new role template.
   */
  async createTemplate(data: {
    id: string;
    name: string;
    emoji?: string;
    description?: string;
    department?: string;
    industry?: string;
    mode?: "autonomous" | "copilot";
    isBuiltin?: number;
    agentsMd: string;
    soulMd: string;
    identityMd: string;
    userMd: string;
    toolsMd: string;
    heartbeatMd: string;
    bootstrapMd: string;
    tasksMd: string;
  }): Promise<Record<string, unknown>> {
    const db = getDb();

    try {
      await db.insert(roleTemplatesTable).values({
        id: data.id,
        name: data.name,
        emoji: data.emoji ?? null,
        description: data.description ?? null,
        department: data.department ?? null,
        industry: data.industry ?? null,
        mode: data.mode ?? "autonomous",
        isBuiltin: data.isBuiltin ?? 0,
        agentsMd: data.agentsMd,
        soulMd: data.soulMd,
        identityMd: data.identityMd,
        userMd: data.userMd,
        toolsMd: data.toolsMd,
        heartbeatMd: data.heartbeatMd,
        bootstrapMd: data.bootstrapMd,
        tasksMd: data.tasksMd,
      });
    } catch (err: unknown) {
      const error = err as { code?: string };
      if (error.code === "ER_DUP_ENTRY") {
        throw new ConflictError(`Role template with id '${data.id}' already exists`);
      }
      throw err;
    }

    logger.info({ templateId: data.id }, "Role template created");

    const created = await db
      .select()
      .from(roleTemplatesTable)
      .where(eq(roleTemplatesTable.id, data.id))
      .limit(1);

    return created[0] as unknown as Record<string, unknown>;
  }

  /**
   * Update an existing role template.
   * Cannot delete builtin templates, but can update them.
   */
  async updateTemplate(
    id: string,
    data: Partial<{
      name: string;
      emoji: string;
      description: string;
      department: string;
      industry: string;
      mode: "autonomous" | "copilot";
      agentsMd: string;
      soulMd: string;
      identityMd: string;
      userMd: string;
      toolsMd: string;
      heartbeatMd: string;
      bootstrapMd: string;
      tasksMd: string;
    }>,
  ): Promise<Record<string, unknown>> {
    const db = getDb();

    // Check exists
    const existing = await db
      .select()
      .from(roleTemplatesTable)
      .where(eq(roleTemplatesTable.id, id))
      .limit(1);

    if (existing.length === 0) {
      throw new NotFoundError("Role template");
    }

    // Build update set — only include fields that are provided
    const updateSet: Record<string, unknown> = {};
    if (data.name !== undefined) updateSet.name = data.name;
    if (data.emoji !== undefined) updateSet.emoji = data.emoji;
    if (data.description !== undefined) updateSet.description = data.description;
    if (data.department !== undefined) updateSet.department = data.department;
    if (data.industry !== undefined) updateSet.industry = data.industry;
    if (data.mode !== undefined) updateSet.mode = data.mode;
    if (data.agentsMd !== undefined) updateSet.agentsMd = data.agentsMd;
    if (data.soulMd !== undefined) updateSet.soulMd = data.soulMd;
    if (data.identityMd !== undefined) updateSet.identityMd = data.identityMd;
    if (data.userMd !== undefined) updateSet.userMd = data.userMd;
    if (data.toolsMd !== undefined) updateSet.toolsMd = data.toolsMd;
    if (data.heartbeatMd !== undefined) updateSet.heartbeatMd = data.heartbeatMd;
    if (data.bootstrapMd !== undefined) updateSet.bootstrapMd = data.bootstrapMd;
    if (data.tasksMd !== undefined) updateSet.tasksMd = data.tasksMd;

    if (Object.keys(updateSet).length === 0) {
      throw new BadRequestError("No fields to update");
    }

    await db
      .update(roleTemplatesTable)
      .set(updateSet as typeof roleTemplatesTable.$inferInsert)
      .where(eq(roleTemplatesTable.id, id));

    logger.info({ templateId: id }, "Role template updated");

    const updated = await db
      .select()
      .from(roleTemplatesTable)
      .where(eq(roleTemplatesTable.id, id))
      .limit(1);

    return updated[0] as unknown as Record<string, unknown>;
  }

  /**
   * Delete a role template. Builtin templates cannot be deleted.
   */
  async deleteTemplate(id: string): Promise<void> {
    const db = getDb();

    const existing = await db
      .select()
      .from(roleTemplatesTable)
      .where(eq(roleTemplatesTable.id, id))
      .limit(1);

    if (existing.length === 0) {
      throw new NotFoundError("Role template");
    }

    if (existing[0]!.isBuiltin === 1) {
      throw new ForbiddenError("Cannot delete a builtin role template");
    }

    await db
      .delete(roleTemplatesTable)
      .where(eq(roleTemplatesTable.id, id));

    logger.info({ templateId: id }, "Role template deleted");
  }

  /**
   * Clone a role template with a new ID and name.
   */
  async cloneTemplate(
    id: string,
    newId: string,
    newName: string,
  ): Promise<Record<string, unknown>> {
    const db = getDb();

    const existing = await db
      .select()
      .from(roleTemplatesTable)
      .where(eq(roleTemplatesTable.id, id))
      .limit(1);

    if (existing.length === 0) {
      throw new NotFoundError("Role template");
    }

    const source = existing[0]!;

    try {
      await db.insert(roleTemplatesTable).values({
        id: newId,
        name: newName,
        emoji: source.emoji,
        description: source.description,
        department: source.department,
        industry: source.industry,
        mode: source.mode,
        isBuiltin: 0, // clones are never builtin
        agentsMd: source.agentsMd,
        soulMd: source.soulMd,
        identityMd: source.identityMd,
        userMd: source.userMd,
        toolsMd: source.toolsMd,
        heartbeatMd: source.heartbeatMd,
        bootstrapMd: source.bootstrapMd,
        tasksMd: source.tasksMd,
      });
    } catch (err: unknown) {
      const error = err as { code?: string };
      if (error.code === "ER_DUP_ENTRY") {
        throw new ConflictError(`Role template with id '${newId}' already exists`);
      }
      throw err;
    }

    logger.info({ sourceId: id, newId, newName }, "Role template cloned");

    const cloned = await db
      .select()
      .from(roleTemplatesTable)
      .where(eq(roleTemplatesTable.id, newId))
      .limit(1);

    return cloned[0] as unknown as Record<string, unknown>;
  }

  /**
   * Assign a role to a node. Resolves template variables and stores
   * the resolved config files on the node. Increments config_revision.
   */
  async assignRoleToNode(
    nodeId: string,
    roleId: string,
    variables: Record<string, string>,
    overrides?: Record<string, string>,
    modeOverride?: "autonomous" | "copilot",
  ): Promise<Record<string, unknown>> {
    const db = getDb();

    // Verify node exists
    const nodeRows = await db
      .select()
      .from(nodesTable)
      .where(eq(nodesTable.nodeId, nodeId))
      .limit(1);

    if (nodeRows.length === 0) {
      throw new NotFoundError("Node");
    }

    // Verify template exists
    const templateRows = await db
      .select()
      .from(roleTemplatesTable)
      .where(eq(roleTemplatesTable.id, roleId))
      .limit(1);

    if (templateRows.length === 0) {
      throw new NotFoundError("Role template");
    }

    const template = templateRows[0]!;
    const node = nodeRows[0]!;

    // Auto-fill base variables from node DB record if not provided by caller
    const baseVars: Record<string, string> = {
      employee_id: node.employeeId || "",
      employee_name: node.employeeName || "",
      employee_email: node.employeeEmail || "",
      role_id: roleId,
    };

    // Auto-fill company profile variables from company_strategy table
    try {
      const [strategyRows] = await (db as any).execute(
        sql`SELECT * FROM company_strategy ORDER BY updated_at DESC LIMIT 1`,
      );
      const strategy = strategyRows?.[0];
      if (strategy) {
        baseVars.company_name = strategy.company_name || "";
        baseVars.industry = strategy.industry || "";
        baseVars.employee_count = String(strategy.employee_count || "");
        baseVars.annual_revenue_target = strategy.annual_revenue_target || "";
        baseVars.fiscal_year_start = strategy.fiscal_year_start || "";
        baseVars.fiscal_year_end = strategy.fiscal_year_end || "";
        baseVars.currency = strategy.currency || "";
        baseVars.language = strategy.language || "";
        baseVars.timezone = strategy.timezone || "";
        baseVars.company_mission = strategy.company_mission || "";
        baseVars.company_vision = strategy.company_vision || "";
        baseVars.company_values = strategy.company_values || "";
        baseVars.human_name = "橋本 透";
        baseVars.human_title = "CEO";

        // Parse JSON fields
        const priorities = strategy.strategic_priorities;
        baseVars.strategic_priorities = Array.isArray(priorities)
          ? priorities.join(", ")
          : typeof priorities === "string" ? priorities : "";

        const deptBudgets = strategy.department_budgets;
        if (deptBudgets && typeof deptBudgets === "object") {
          // Map role to department budget key
          const budgetKeyMap: Record<string, string> = {
            marketing: "marketing", finance: "finance", sales: "sales",
            "engineering-lead": "engineering", "customer-support": "support",
            hr: "hr", "strategic-planner": "strategy", "product-manager": "engineering",
          };
          const budgetKey = budgetKeyMap[roleId];
          const dept = budgetKey ? (deptBudgets as Record<string, any>)[budgetKey] : undefined;
          baseVars.department_budget = dept?.annual || "";
          baseVars.budget_limit = dept?.annual || "";
        }

        const deptKpis = strategy.department_kpis;
        if (deptKpis && typeof deptKpis === "object") {
          const kpiKeyMap: Record<string, string> = {
            marketing: "marketing", finance: "finance", sales: "sales",
            "engineering-lead": "engineering", "customer-support": "support",
            hr: "hr", "strategic-planner": "strategy", "product-manager": "engineering",
          };
          const kpiKey = kpiKeyMap[roleId];
          const kpis = kpiKey ? (deptKpis as Record<string, any>)[kpiKey] : undefined;
          baseVars.department_kpis = Array.isArray(kpis)
            ? kpis.filter((k: any) => k.name).map((k: any) => `- ${k.name}: ${k.target}`).join("\n")
            : "";
        }

        // Long-term vision
        const longTerm = strategy.long_term_objectives;
        if (longTerm?.milestones) {
          baseVars.long_term_vision = longTerm.milestones
            .map((m: any) => `Year ${m.year}: ${m.description}`)
            .join("\n");
        }

        // Short-term goals for current_quarter_goals
        const shortTerm = strategy.short_term_objectives;
        if (Array.isArray(shortTerm) && shortTerm[0]) {
          baseVars.current_quarter_goals = shortTerm[0].goals?.join("\n- ") || "";
          baseVars.annual_targets = shortTerm
            .map((q: any) => `${q.quarter}: ${q.goals?.[0] || ""}`)
            .join("\n");
        }

        baseVars.strategy_revision = String(strategy.revision || "");
        baseVars.company_strategy_summary = `${strategy.company_mission || ""}\nPriorities: ${baseVars.strategic_priorities}`;
      }
    } catch (err) {
      logger.warn({ err }, "Failed to load company strategy for variable resolution");
    }

    // Caller-provided variables override auto-filled ones
    Object.assign(baseVars, variables);

    // Generate company context variables (roster, org_chart, etc.)
    try {
      const contextGen = new CompanyContextGenerator(
        db as unknown as import("drizzle-orm/mysql2").MySql2Database,
      );
      const contextVars = await contextGen.generateAllContextVariables(roleId);
      Object.assign(baseVars, contextVars);
    } catch (err) {
      logger.warn({ err }, "Failed to generate company context during role assignment");
    }

    // Resolve template variables
    const resolved = this.resolveTemplateVariables(
      template as unknown as Record<string, unknown>,
      baseVars,
    );

    // Apply overrides if provided (override specific resolved files)
    if (overrides) {
      for (const [fileName, content] of Object.entries(overrides)) {
        const fieldKey = MD_FILE_MAP[fileName];
        if (fieldKey) {
          resolved[fieldKey] = content;
        }
      }
    }

    // Use timestamp-based revision to guarantee it's always larger than any stale container state
    const currentRevision = node.configRevision ?? 0;
    const newRevision = Math.max(currentRevision + 1, Math.floor(Date.now() / 1000));

    // Update node with role assignment using dedicated columns
    await db
      .update(nodesTable)
      .set({
        roleId: roleId,
        roleMode: modeOverride ?? template.mode,
        configRevision: newRevision,
        assignmentVariables: baseVars,
        configOverrides: overrides ?? null,
        resolvedAgentsMd: resolved.agentsMd,
        resolvedSoulMd: resolved.soulMd,
        resolvedIdentityMd: resolved.identityMd,
        resolvedUserMd: resolved.userMd,
        resolvedToolsMd: resolved.toolsMd,
        resolvedHeartbeatMd: resolved.heartbeatMd,
        resolvedBootstrapMd: resolved.bootstrapMd,
        resolvedTasksMd: resolved.tasksMd,
      })
      .where(eq(nodesTable.nodeId, nodeId));

    logger.info(
      { nodeId, roleId, revision: newRevision },
      "Role assigned to node",
    );

    // Push config update to node via SSE (if connected)
    if (nodeConfigSSE.isNodeConnected(nodeId)) {
      const fullConfig = await this.getNodeConfig(nodeId);
      nodeConfigSSE.pushToNode(nodeId, {
        revision: newRevision,
        reason: "role_assignment",
        config: {
          role_id: fullConfig.roleId,
          role_mode: fullConfig.roleMode,
          files: fullConfig.files,
          key_config: fullConfig.key_config,
        },
      });
    }

    // Propagate updated roster to all other nodes
    this.propagateCompanyContext("role_assignment").catch(err =>
      logger.warn({ err }, "Failed to propagate context after role assignment")
    );

    // Auto-post new member announcement if this is a new role assignment
    if (!node.roleId || node.roleId !== roleId) {
      try {
        // Note: import would be circular — use dynamic import from community module instead
        const { getCommunityService: getCS } = await import("../community/service.js");
        const { communityChannelsTable } = await import("../community/schema.js");
        const cs = getCS();
        const [ch] = await db
          .select({ id: communityChannelsTable.id })
          .from(communityChannelsTable)
          .where(eq(communityChannelsTable.name, "announcements"))
          .limit(1);
        if (ch) {
          const empName = baseVars.employee_name || node.employeeName || "Unknown";
          await cs.createPost({
            authorNodeId: nodeId,
            channelId: ch.id,
            postType: "discussion" as import("../../shared/interfaces/community.interface.js").PostType,
            title: `[New Member] ${empName} has joined as ${roleId}`,
            contextData: {
              body: `A new AI employee has joined the team.\n\n- **Name**: ${empName}\n- **Role**: ${roleId}\n- **Employee ID**: ${baseVars.employee_id || ""}\n\nWelcome aboard!`,
              tags: ["new-member", "auto-generated"],
              auto_generated: true,
            },
          });
        }
      } catch { /* fire-and-forget */ }
    }

    const updated = await db
      .select()
      .from(nodesTable)
      .where(eq(nodesTable.nodeId, nodeId))
      .limit(1);

    return updated[0] as unknown as Record<string, unknown>;
  }

  /**
   * Unassign role from a node. Clears resolved config fields.
   */
  async unassignRoleFromNode(nodeId: string): Promise<Record<string, unknown>> {
    const db = getDb();

    const nodeRows = await db
      .select()
      .from(nodesTable)
      .where(eq(nodesTable.nodeId, nodeId))
      .limit(1);

    if (nodeRows.length === 0) {
      throw new NotFoundError("Node");
    }

    const node = nodeRows[0]!;
    const currentRevision = node.configRevision ?? 0;
    // Use timestamp-based revision to guarantee it exceeds any stale container revision
    // (MySQL→SQLite migration left some containers with revision 3000+ while GRC DB reset to ~20)
    const nextRevision = Math.max(currentRevision + 1, Math.floor(Date.now() / 1000));

    // Clear role-related dedicated columns, increment revision
    await db
      .update(nodesTable)
      .set({
        roleId: null,
        roleMode: null,
        configRevision: nextRevision,
        assignmentVariables: null,
        configOverrides: null,
        resolvedAgentsMd: null,
        resolvedSoulMd: null,
        resolvedIdentityMd: null,
        resolvedUserMd: null,
        resolvedToolsMd: null,
        resolvedHeartbeatMd: null,
        resolvedBootstrapMd: null,
        resolvedTasksMd: null,
      })
      .where(eq(nodesTable.nodeId, nodeId));

    logger.info({ nodeId }, "Role unassigned from node");

    // Push config update to node via SSE (if connected)
    if (nodeConfigSSE.isNodeConnected(nodeId)) {
      nodeConfigSSE.pushToNode(nodeId, {
        revision: nextRevision,
        reason: "role_unassignment",
        config: {
          role_id: null,
          role_mode: null,
          files: {},
          key_config: null,
        },
      });
    }

    // Propagate updated roster to all other nodes (employee removed from roster)
    this.propagateCompanyContext("role_unassignment").catch(err =>
      logger.warn({ err }, "Failed to propagate context after role unassignment")
    );

    const updated = await db
      .select()
      .from(nodesTable)
      .where(eq(nodesTable.nodeId, nodeId))
      .limit(1);

    return updated[0] as unknown as Record<string, unknown>;
  }

  /**
   * Get the resolved config files for a node (used by /a2a/config/pull).
   */
  async getNodeConfig(nodeId: string): Promise<{
    revision: number;
    roleId: string | null;
    roleMode: string | null;
    files: Record<string, string>;
    key_config: {
      primary: { provider: string; model: string; apiKey: string; baseUrl?: string } | null;
      auxiliary: { provider: string; model: string; apiKey: string; baseUrl?: string } | null;
    } | null;
  }> {
    const db = getDb();

    const nodeRows = await db
      .select()
      .from(nodesTable)
      .where(eq(nodesTable.nodeId, nodeId))
      .limit(1);

    if (nodeRows.length === 0) {
      throw new NotFoundError("Node");
    }

    const node = nodeRows[0]!;

    // Map from file names to dedicated resolved_*_md columns
    const resolvedColumnMap: Record<string, string | null> = {
      "AGENTS.md": node.resolvedAgentsMd,
      "SOUL.md": node.resolvedSoulMd,
      "IDENTITY.md": node.resolvedIdentityMd,
      "USER.md": node.resolvedUserMd,
      "TOOLS.md": node.resolvedToolsMd,
      "HEARTBEAT.md": node.resolvedHeartbeatMd,
      "BOOTSTRAP.md": node.resolvedBootstrapMd,
      "TASKS.md": node.resolvedTasksMd,
    };

    const files: Record<string, string> = {};
    for (const [fileName, value] of Object.entries(resolvedColumnMap)) {
      if (value) {
        files[fileName] = value;
      }
    }

    // Parse key_config_json (stored as JSON on node)
    let keyConfig = null;
    if (node.keyConfigJson) {
      try {
        keyConfig =
          typeof node.keyConfigJson === "string"
            ? JSON.parse(node.keyConfigJson)
            : node.keyConfigJson;
      } catch {
        // ignore parse errors
      }
    }

    return {
      revision: node.configRevision ?? 0,
      roleId: node.roleId ?? null,
      roleMode: node.roleMode ?? null,
      files,
      key_config: keyConfig as {
        primary: { provider: string; model: string; apiKey: string; baseUrl?: string } | null;
        auxiliary: { provider: string; model: string; apiKey: string; baseUrl?: string } | null;
      } | null,
    };
  }

  /**
   * Update a single resolved config file on a node.
   */
  async updateNodeConfigFile(
    nodeId: string,
    fileName: string,
    content: string,
  ): Promise<void> {
    const db = getDb();

    const fieldKey = MD_FILE_MAP[fileName];
    if (!fieldKey) {
      throw new BadRequestError(
        `Invalid config file name '${fileName}'. Valid names: ${Object.keys(MD_FILE_MAP).join(", ")}`,
      );
    }

    const nodeRows = await db
      .select()
      .from(nodesTable)
      .where(eq(nodesTable.nodeId, nodeId))
      .limit(1);

    if (nodeRows.length === 0) {
      throw new NotFoundError("Node");
    }

    const node = nodeRows[0]!;
    const currentRevision = node.configRevision ?? 0;
    const newRevision = currentRevision + 1;

    // Map fieldKey (camelCase) to the dedicated Drizzle column name
    const columnMap: Record<string, keyof typeof nodesTable.$inferInsert> = {
      agentsMd: "resolvedAgentsMd",
      soulMd: "resolvedSoulMd",
      identityMd: "resolvedIdentityMd",
      userMd: "resolvedUserMd",
      toolsMd: "resolvedToolsMd",
      heartbeatMd: "resolvedHeartbeatMd",
      bootstrapMd: "resolvedBootstrapMd",
      tasksMd: "resolvedTasksMd",
    };

    const columnName = columnMap[fieldKey];
    if (!columnName) {
      throw new BadRequestError(`Unknown field key '${fieldKey}'`);
    }

    await db
      .update(nodesTable)
      .set({
        [columnName]: content,
        configRevision: newRevision,
      } as Partial<typeof nodesTable.$inferInsert>)
      .where(eq(nodesTable.nodeId, nodeId));

    logger.info({ nodeId, fileName, revision: newRevision }, "Node config file updated");

    // Push config update to node via SSE (if connected)
    if (nodeConfigSSE.isNodeConnected(nodeId)) {
      const fullConfig = await this.getNodeConfig(nodeId);
      nodeConfigSSE.pushToNode(nodeId, {
        revision: newRevision,
        reason: "config_file_update",
        config: {
          role_id: fullConfig.roleId,
          role_mode: fullConfig.roleMode,
          files: fullConfig.files,
          key_config: fullConfig.key_config,
        },
      });
    }
  }

  /**
   * Replace ${var} placeholders in all 8 MD fields with provided variable values.
   *
   * Supported variables:
   *   ${employee_id}, ${employee_name}, ${employee_email},
   *   ${company_name}, ${industry}, ${department},
   *   ${annual_revenue_target}, ${fiscal_year}, ${team_size},
   *   and any custom variables passed in the variables map.
   */
  resolveTemplateVariables(
    template: Record<string, unknown>,
    variables: Record<string, string>,
  ): Record<string, string> {
    const resolved: Record<string, string> = {};

    for (const field of MD_FIELDS) {
      let content = (template[field] as string) ?? "";

      // Replace all ${key} patterns with values from the variables map
      content = content.replace(/\$\{([^}]+)\}/g, (match, key: string) => {
        const trimmedKey = key.trim();
        if (trimmedKey in variables) {
          return variables[trimmedKey];
        }
        // Leave unresolved variables as-is for debugging visibility
        return match;
      });

      resolved[field] = content;
    }

    return resolved;
  }

  /**
   * Re-resolve company context variables for all active nodes and push updates.
   * Called when the roster changes (new employee, role change, departure).
   *
   * @param reason - Why context is being propagated (for logging)
   */
  async propagateCompanyContext(reason: string): Promise<{ updatedCount: number }> {
    const db = getDb();
    const contextGen = new CompanyContextGenerator(
      db as unknown as import("drizzle-orm/mysql2").MySql2Database,
    );

    // 1. Get all active nodes with roles assigned (heartbeat within 24h)
    const activeNodes = await db
      .select()
      .from(nodesTable)
      .where(
        and(
          isNotNull(nodesTable.roleId),
          gte(nodesTable.lastHeartbeat, new Date(Date.now() - 24 * 60 * 60 * 1000))
        )
      );

    let updatedCount = 0;

    for (const node of activeNodes) {
      if (!node.roleId) continue;

      // 2. Get the role template
      const [template] = await db
        .select()
        .from(roleTemplatesTable)
        .where(eq(roleTemplatesTable.id, node.roleId));

      if (!template) continue;

      // 3. Generate context variables for this node's role
      const contextVars = await contextGen.generateAllContextVariables(node.roleId);

      // 4. Build full variables map (existing assignment vars + new context vars)
      const assignmentVars = (node.assignmentVariables as Record<string, string>) || {};
      const allVars: Record<string, string> = {
        ...assignmentVars,
        employee_id: node.employeeId || "",
        employee_name: node.employeeName || "",
        employee_email: node.employeeEmail || "",
        role_id: node.roleId,
        ...contextVars,
      };

      // 4b. Load company strategy variables
      try {
        const [stratRows] = await (db as any).execute(
          sql`SELECT * FROM company_strategy ORDER BY updated_at DESC LIMIT 1`,
        );
        const s = stratRows?.[0];
        if (s) {
          allVars.company_name = s.company_name || "";
          allVars.industry = s.industry || "";
          allVars.employee_count = String(s.employee_count || "");
          allVars.annual_revenue_target = s.annual_revenue_target || "";
          allVars.fiscal_year_start = s.fiscal_year_start || "";
          allVars.fiscal_year_end = s.fiscal_year_end || "";
          allVars.currency = s.currency || "";
          allVars.language = s.language || "";
          allVars.timezone = s.timezone || "";
          allVars.company_mission = s.company_mission || "";
          allVars.company_vision = s.company_vision || "";
          allVars.company_values = s.company_values || "";
          allVars.human_name = "橋本 透";
          allVars.human_title = "CEO";
          const priorities = s.strategic_priorities;
          allVars.strategic_priorities = Array.isArray(priorities) ? priorities.join(", ") : "";
          allVars.strategy_revision = String(s.revision || "");
        }
      } catch { /* company_strategy may not exist */ }

      // 5. Re-resolve the agentsMd template
      const resolvedAgentsMd = this.resolveTemplateVariables(
        { agentsMd: template.agentsMd || "" },
        allVars,
      ).agentsMd || "";

      // 6. Update only agentsMd and increment revision
      await db
        .update(nodesTable)
        .set({
          resolvedAgentsMd: resolvedAgentsMd,
          configRevision: sql`CASE WHEN config_revision + 1 > ${Math.floor(Date.now() / 1000)} THEN config_revision + 1 ELSE ${Math.floor(Date.now() / 1000)} END`,
        })
        .where(eq(nodesTable.nodeId, node.nodeId));

      // 7. Push SSE config update
      const updatedNode = await this.getNodeConfig(node.nodeId);
      if (updatedNode) {
        nodeConfigSSE.pushToNode(node.nodeId, {
          revision: updatedNode.revision,
          reason: `context_propagation:${reason}`,
          config: {
            role_id: updatedNode.roleId,
            role_mode: updatedNode.roleMode,
            files: updatedNode.files,
            key_config: updatedNode.key_config,
          },
        });
      }

      updatedCount++;
    }

    logger.info({ reason, updatedCount }, "Company context propagated to all active nodes");
    return { updatedCount };
  }
}
