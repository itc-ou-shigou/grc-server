/**
 * Strategy Module — A2A Protocol Routes
 *
 * Agent-facing endpoints for querying and managing company strategy.
 * Nodes can retrieve role-appropriate strategy summaries and department details.
 *
 * CEO-role endpoints allow the CEO agent to update strategy, deploy to all
 * agents, manage KPIs, and adjust department budgets (with +/-20% guardrail).
 */

import { Router } from "express";
import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import pino from "pino";
import type { GrcConfig } from "../../config.js";
import { createAuthMiddleware } from "../../shared/middleware/auth.js";
import {
  asyncHandler,
  BadRequestError,
  NotFoundError,
} from "../../shared/middleware/error-handler.js";
import { nodeIdSchema, paginationSchema } from "../../shared/utils/validators.js";
import { getDb } from "../../shared/db/connection.js";
import { nodesTable } from "../evolution/schema.js";
import { eq } from "drizzle-orm";
import { StrategyService } from "./service.js";

const logger = pino({ name: "module:strategy" });

// ── Request Validation Schemas ──────────────────

const strategySummaryQuerySchema = z.object({
  node_id: nodeIdSchema,
});

const departmentParamSchema = z.object({
  dept: z.string().min(1).max(100),
});

const a2aUpdateStrategySchema = z.object({
  company_name: z.string().optional(),
  industry: z.string().optional(),
  employee_count: z.number().int().optional(),
  annual_revenue_target: z.string().optional(),
  fiscal_year_start: z.string().optional(),
  fiscal_year_end: z.string().optional(),
  currency: z.string().max(10).optional(),
  language: z.string().max(50).optional(),
  timezone: z.string().max(50).optional(),
  company_mission: z.string().optional(),
  company_vision: z.string().optional(),
  company_values: z.string().optional(),
  short_term_objectives: z.unknown().optional(),
  mid_term_objectives: z.unknown().optional(),
  long_term_objectives: z.unknown().optional(),
  department_budgets: z.unknown().optional(),
  department_kpis: z.unknown().optional(),
  strategic_priorities: z.unknown().optional(),
});

const a2aDeploySchema = z.object({
  reason: z.string().optional(),
});

const a2aUpdateKpisSchema = z.object({
  kpis: z.record(z.unknown()),
});

const a2aUpdateBudgetsSchema = z.object({
  budgets: z.record(z.unknown()),
  force: z.boolean().optional().default(false),
});

// ── Budget Change Limit ─────────────────────────

const BUDGET_CHANGE_LIMIT = 0.20; // +/-20%

/**
 * Validate that no department budget changes by more than +/-20%.
 * Returns an object with { valid, violations } where violations lists
 * departments that exceed the limit.
 */
function validateBudgetChanges(
  currentBudgets: Record<string, unknown>,
  newBudgets: Record<string, unknown>,
): { valid: boolean; violations: Array<{ dept: string; currentAmount: number; newAmount: number; changePercent: number }> } {
  const violations: Array<{ dept: string; currentAmount: number; newAmount: number; changePercent: number }> = [];

  for (const dept of Object.keys(newBudgets)) {
    const currentEntry = currentBudgets[dept];
    const newEntry = newBudgets[dept];

    // Extract numeric amount from budget entry (supports both flat numbers and objects with "amount" / "total")
    const currentAmount = extractBudgetAmount(currentEntry);
    const newAmount = extractBudgetAmount(newEntry);

    // Skip validation if either side has no numeric amount (new department, etc.)
    if (currentAmount === null || newAmount === null) continue;
    if (currentAmount === 0) continue; // cannot compute percentage change from zero

    const changePercent = Math.abs((newAmount - currentAmount) / currentAmount);
    if (changePercent > BUDGET_CHANGE_LIMIT) {
      violations.push({
        dept,
        currentAmount,
        newAmount,
        changePercent: Math.round(changePercent * 100),
      });
    }
  }

  return { valid: violations.length === 0, violations };
}

function extractBudgetAmount(entry: unknown): number | null {
  if (typeof entry === "number") return entry;
  if (typeof entry === "object" && entry !== null) {
    const obj = entry as Record<string, unknown>;
    const val = obj.amount ?? obj.total ?? obj.budget;
    if (typeof val === "number") return val;
    if (typeof val === "string") {
      const parsed = parseFloat(val);
      return isNaN(parsed) ? null : parsed;
    }
  }
  return null;
}

// ── CEO Role Middleware ─────────────────────────

/**
 * Middleware that enforces CEO role.
 * Looks up the authenticated user's node_id in the nodes table,
 * then checks if the node's role_id is "ceo".
 * Returns 403 if the node does not have the CEO role.
 */
function requireCeoRole() {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      return res.status(401).json({
        error: "authentication_required",
        message: "Authentication is required for this endpoint",
      });
    }

    // Resolve node_id: prefer the explicit node_id from JWT, fall back to sub
    const nodeId = req.auth.node_id ?? req.auth.sub;
    if (!nodeId) {
      return res.status(403).json({
        error: "forbidden",
        message: "Cannot determine node identity for CEO role check",
      });
    }

    try {
      const db = getDb();
      const nodeRows = await db
        .select({ roleId: nodesTable.roleId })
        .from(nodesTable)
        .where(eq(nodesTable.nodeId, nodeId))
        .limit(1);

      if (nodeRows.length === 0) {
        return res.status(403).json({
          error: "forbidden",
          message: "Node not found — CEO role required",
        });
      }

      const roleId = nodeRows[0].roleId;
      if (roleId !== "ceo") {
        logger.warn(
          { nodeId, roleId },
          "Non-CEO node attempted CEO-only strategy operation",
        );
        return res.status(403).json({
          error: "forbidden",
          message: `CEO role required. Current role: ${roleId ?? "none"}`,
        });
      }

      // Attach resolved node_id for downstream handlers
      (req as Record<string, unknown>)._ceoNodeId = nodeId;
      return next();
    } catch (err) {
      logger.error({ err, nodeId }, "Error checking CEO role");
      return res.status(500).json({
        error: "internal_error",
        message: "Failed to verify CEO role",
      });
    }
  };
}

// ── Auto Audit Helper ───────────────────────────

/**
 * Post a strategy change notification to the community announcements channel.
 * Fire-and-forget — errors are logged but do not block the response.
 */
async function postStrategyAudit(
  ceoNodeId: string,
  action: string,
  details: string,
  revision?: number | string,
): Promise<void> {
  try {
    const { getCommunityService } = await import("../community/service.js");
    const { communityChannelsTable } = await import("../community/schema.js");
    const { eq: eqOp } = await import("drizzle-orm");
    const db = getDb();
    const cs = getCommunityService();

    const [ch] = await db
      .select({ id: communityChannelsTable.id })
      .from(communityChannelsTable)
      .where(eqOp(communityChannelsTable.name, "announcements"))
      .limit(1);

    if (ch) {
      await cs.createPost({
        authorNodeId: ceoNodeId,
        channelId: ch.id,
        postType: "alert" as import("../../shared/interfaces/community.interface.js").PostType,
        title: `[CEO Strategy ${action}] rev ${revision ?? "?"}`,
        contextData: {
          body: `CEO agent (${ceoNodeId}) performed strategy ${action.toLowerCase()}.\n\n${details}`,
          tags: ["strategy-update", "ceo-action", "auto-generated"],
          auto_generated: true,
        },
      });
    }
  } catch {
    logger.warn({ ceoNodeId, action }, "Failed to post strategy audit to community");
  }
}

// ── Module Registration ─────────────────────────

export async function register(app: Express, config: GrcConfig): Promise<void> {
  const router = Router();
  const service = new StrategyService();
  const authOptional = createAuthMiddleware(config, false);
  const authRequired = createAuthMiddleware(config, true);
  const ceoOnly = requireCeoRole();

  // ════════════════════════════════════════════════
  //  Existing A2A Endpoints (read-only, any node)
  // ════════════════════════════════════════════════

  // ────────────────────────────────────────────
  // GET /a2a/strategy/summary — Get strategy summary (role-appropriate)
  // ────────────────────────────────────────────
  router.get(
    "/strategy/summary",
    authOptional,
    asyncHandler(async (req: Request, res: Response) => {
      const query = strategySummaryQuerySchema.parse(req.query);
      const db = getDb();

      // Look up the node to determine its role
      const nodeRows = await db
        .select()
        .from(nodesTable)
        .where(eq(nodesTable.nodeId, query.node_id))
        .limit(1);

      if (nodeRows.length === 0) {
        throw new NotFoundError("Node");
      }

      const node = nodeRows[0];
      const caps = (node.capabilities as Record<string, unknown>) ?? {};
      const roleId = (caps.role_id as string) ?? "unknown";

      // Get current strategy
      const strategy = await service.getStrategy();

      // Build role-appropriate response
      const isCeo =
        roleId.toLowerCase() === "ceo" || roleId.toLowerCase() === "executive";

      if (isCeo) {
        // CEO gets full strategy
        res.json({
          ok: true,
          node_id: query.node_id,
          role_id: roleId,
          scope: "full",
          strategy: {
            mission: strategy.companyMission,
            vision: strategy.companyVision,
            values: strategy.companyValues,
            short_term_objectives: strategy.shortTermObjectives,
            mid_term_objectives: strategy.midTermObjectives,
            long_term_objectives: strategy.longTermObjectives,
            department_budgets: strategy.departmentBudgets,
            department_kpis: strategy.departmentKpis,
            strategic_priorities: strategy.strategicPriorities,
            revision: strategy.revision,
          },
        });
      } else {
        // Departments get summary
        const budgets = (strategy.departmentBudgets as Record<string, unknown>) ?? {};
        const kpis = (strategy.departmentKpis as Record<string, unknown>) ?? {};

        res.json({
          ok: true,
          node_id: query.node_id,
          role_id: roleId,
          scope: "department",
          strategy: {
            mission: strategy.companyMission,
            vision: strategy.companyVision,
            strategic_priorities: strategy.strategicPriorities,
            department_budget: budgets[roleId] ?? null,
            department_kpis: kpis[roleId] ?? null,
            revision: strategy.revision,
          },
        });
      }

      logger.debug(
        { nodeId: query.node_id, roleId, scope: isCeo ? "full" : "department" },
        "Strategy summary served",
      );
    }),
  );

  // ────────────────────────────────────────────
  // GET /a2a/strategy/department/:dept — Get department budget + KPIs
  // ────────────────────────────────────────────
  router.get(
    "/strategy/department/:dept",
    authOptional,
    asyncHandler(async (req: Request, res: Response) => {
      const { dept } = departmentParamSchema.parse(req.params);

      const strategy = await service.getStrategy();
      const budgets = (strategy.departmentBudgets as Record<string, unknown>) ?? {};
      const kpis = (strategy.departmentKpis as Record<string, unknown>) ?? {};

      res.json({
        ok: true,
        department: dept,
        budget: budgets[dept] ?? null,
        kpis: kpis[dept] ?? null,
        revision: strategy.revision,
      });
    }),
  );

  // ════════════════════════════════════════════════
  //  New CEO Strategy A2A Endpoints
  // ════════════════════════════════════════════════

  // ────────────────────────────────────────────
  // GET /a2a/strategy — Read current strategy (any authenticated node)
  // ────────────────────────────────────────────
  router.get(
    "/strategy",
    authRequired,
    asyncHandler(async (_req: Request, res: Response) => {
      const strategy = await service.getStrategy();
      res.json({ ok: true, data: strategy });
    }),
  );

  // ────────────────────────────────────────────
  // PUT /a2a/strategy — Update strategy (CEO role only)
  // ────────────────────────────────────────────
  router.put(
    "/strategy",
    authRequired,
    ceoOnly,
    asyncHandler(async (req: Request, res: Response) => {
      const body = a2aUpdateStrategySchema.parse(req.body);
      const ceoNodeId = (req as Record<string, unknown>)._ceoNodeId as string;

      // Map snake_case request body to camelCase service params
      const data: Record<string, unknown> = {};
      if (body.company_name !== undefined) data.companyName = body.company_name;
      if (body.industry !== undefined) data.industry = body.industry;
      if (body.employee_count !== undefined) data.employeeCount = body.employee_count;
      if (body.annual_revenue_target !== undefined) data.annualRevenueTarget = body.annual_revenue_target;
      if (body.fiscal_year_start !== undefined) data.fiscalYearStart = body.fiscal_year_start;
      if (body.fiscal_year_end !== undefined) data.fiscalYearEnd = body.fiscal_year_end;
      if (body.currency !== undefined) data.currency = body.currency;
      if (body.language !== undefined) data.language = body.language;
      if (body.timezone !== undefined) data.timezone = body.timezone;
      if (body.company_mission !== undefined) data.companyMission = body.company_mission;
      if (body.company_vision !== undefined) data.companyVision = body.company_vision;
      if (body.company_values !== undefined) data.companyValues = body.company_values;
      if (body.short_term_objectives !== undefined) data.shortTermObjectives = body.short_term_objectives;
      if (body.mid_term_objectives !== undefined) data.midTermObjectives = body.mid_term_objectives;
      if (body.long_term_objectives !== undefined) data.longTermObjectives = body.long_term_objectives;
      if (body.department_budgets !== undefined) data.departmentBudgets = body.department_budgets;
      if (body.department_kpis !== undefined) data.departmentKpis = body.department_kpis;
      if (body.strategic_priorities !== undefined) data.strategicPriorities = body.strategic_priorities;

      const updated = await service.updateStrategy(data, ceoNodeId);
      const changedFields = Object.keys(data).join(", ");

      logger.info({ ceoNodeId, changedFields, revision: updated.revision }, "Strategy updated by CEO agent");

      // Auto audit: post to community + log
      postStrategyAudit(
        ceoNodeId,
        "Update",
        `**Changed fields**: ${changedFields}`,
        updated.revision as number,
      );

      res.json({ ok: true, data: updated });
    }),
  );

  // ────────────────────────────────────────────
  // POST /a2a/strategy/deploy — Deploy to all agents (CEO role only)
  // ────────────────────────────────────────────
  router.post(
    "/strategy/deploy",
    authRequired,
    ceoOnly,
    asyncHandler(async (req: Request, res: Response) => {
      const body = a2aDeploySchema.parse(req.body);
      const ceoNodeId = (req as Record<string, unknown>)._ceoNodeId as string;

      const result = await service.deployStrategy(ceoNodeId);

      logger.info(
        { ceoNodeId, nodesUpdated: result.nodesUpdated, revision: result.revision },
        "Strategy deployed by CEO agent",
      );

      // Auto audit
      postStrategyAudit(
        ceoNodeId,
        "Deploy",
        `Deployed to **${result.nodesUpdated}** agents.${body.reason ? `\n\n**Reason**: ${body.reason}` : ""}`,
        result.revision,
      );

      res.json({
        ok: true,
        nodes_updated: result.nodesUpdated,
        revision: result.revision,
      });
    }),
  );

  // ────────────────────────────────────────────
  // GET /a2a/strategy/kpis — Read KPIs (any authenticated node)
  // ────────────────────────────────────────────
  router.get(
    "/strategy/kpis",
    authRequired,
    asyncHandler(async (_req: Request, res: Response) => {
      const kpis = await service.getKpis();
      res.json({ ok: true, data: kpis });
    }),
  );

  // ────────────────────────────────────────────
  // PUT /a2a/strategy/kpis — Update KPIs (CEO role only)
  // ────────────────────────────────────────────
  router.put(
    "/strategy/kpis",
    authRequired,
    ceoOnly,
    asyncHandler(async (req: Request, res: Response) => {
      const body = a2aUpdateKpisSchema.parse(req.body);
      const ceoNodeId = (req as Record<string, unknown>)._ceoNodeId as string;

      // Update each department's KPIs
      const strategy = await service.getStrategy();
      const currentKpis = (strategy.departmentKpis as Record<string, unknown>) ?? {};
      const mergedKpis = { ...currentKpis, ...body.kpis };

      const updated = await service.updateStrategy(
        { departmentKpis: mergedKpis },
        ceoNodeId,
      );

      const departments = Object.keys(body.kpis).join(", ");
      logger.info({ ceoNodeId, departments }, "KPIs updated by CEO agent");

      // Auto audit
      postStrategyAudit(
        ceoNodeId,
        "KPI Update",
        `Updated KPIs for departments: ${departments}`,
        updated.revision as number,
      );

      res.json({
        ok: true,
        data: (updated.departmentKpis as Record<string, unknown>) ?? {},
      });
    }),
  );

  // ────────────────────────────────────────────
  // GET /a2a/strategy/budgets — Read department budgets (any authenticated node)
  // ────────────────────────────────────────────
  router.get(
    "/strategy/budgets",
    authRequired,
    asyncHandler(async (_req: Request, res: Response) => {
      const budgets = await service.getBudgets();
      res.json({ ok: true, data: budgets });
    }),
  );

  // ────────────────────────────────────────────
  // PUT /a2a/strategy/budgets — Update department budgets (CEO role only, +/-20% limit)
  // ────────────────────────────────────────────
  router.put(
    "/strategy/budgets",
    authRequired,
    ceoOnly,
    asyncHandler(async (req: Request, res: Response) => {
      const body = a2aUpdateBudgetsSchema.parse(req.body);
      const ceoNodeId = (req as Record<string, unknown>)._ceoNodeId as string;

      // Get current budgets for comparison
      const currentBudgets = await service.getBudgets();

      // Validate +/-20% change limit unless force flag is set
      const { valid, violations } = validateBudgetChanges(
        currentBudgets,
        body.budgets as Record<string, unknown>,
      );

      if (!valid && !body.force) {
        throw new BadRequestError(
          `Budget change exceeds +/-20% limit for department(s): ${violations
            .map((v) => `${v.dept} (${v.changePercent}% change)`)
            .join(", ")}. Set "force: true" to override.`,
        );
      }

      if (!valid && body.force) {
        logger.warn(
          { ceoNodeId, violations },
          "CEO agent used force override for budget change exceeding +/-20% limit",
        );
      }

      // Merge new budgets into existing
      const mergedBudgets = { ...currentBudgets, ...(body.budgets as Record<string, unknown>) };
      const updated = await service.updateStrategy(
        { departmentBudgets: mergedBudgets },
        ceoNodeId,
      );

      const departments = Object.keys(body.budgets).join(", ");
      const forceNote = (!valid && body.force)
        ? `\n\n**WARNING**: Force override used. Violations: ${violations.map((v) => `${v.dept} (${v.changePercent}%)`).join(", ")}`
        : "";

      logger.info({ ceoNodeId, departments, force: body.force }, "Budgets updated by CEO agent");

      // Auto audit
      postStrategyAudit(
        ceoNodeId,
        "Budget Update",
        `Updated budgets for departments: ${departments}${forceNote}`,
        updated.revision as number,
      );

      res.json({
        ok: true,
        data: (updated.departmentBudgets as Record<string, unknown>) ?? {},
        force_used: !valid && body.force,
      });
    }),
  );

  // ────────────────────────────────────────────
  // GET /a2a/strategy/history — View change history (any authenticated node)
  // ────────────────────────────────────────────
  router.get(
    "/strategy/history",
    authRequired,
    asyncHandler(async (req: Request, res: Response) => {
      const query = paginationSchema.parse(req.query);
      const result = await service.getHistory({
        page: query.page,
        limit: query.limit,
      });

      res.json({ ok: true, ...result });
    }),
  );

  // ── Mount router under /a2a prefix ────────
  app.use("/a2a", router);

  logger.info("Strategy module registered — 10 A2A endpoints active (2 existing + 8 CEO strategy)");
}
