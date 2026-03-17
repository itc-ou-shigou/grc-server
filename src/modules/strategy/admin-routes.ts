/**
 * Strategy Module — Admin Routes
 *
 * Provides admin-only management endpoints for company strategy,
 * revision history, deployment cascade, and department budgets/KPIs.
 * All routes require JWT authentication + admin role.
 */

import { Router } from "express";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import pino from "pino";
import type { GrcConfig } from "../../config.js";
import { createAuthMiddleware } from "../../shared/middleware/auth.js";
import { createAdminAuthMiddleware } from "../../shared/middleware/admin-auth.js";
import { asyncHandler } from "../../shared/middleware/error-handler.js";
import { paginationSchema } from "../../shared/utils/validators.js";
import { StrategyService } from "./service.js";
import { chatCompletionJson } from "../../shared/llm/client.js";
import { buildStrategyGenerationPrompt } from "../../shared/llm/prompts.js";

const logger = pino({ name: "admin:strategy" });

// ── Zod Schemas ─────────────────────────────────

const updateStrategySchema = z.object({
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

const deployStrategySchema = z.object({
  updated_by: z.string().min(1).optional(),
});

const revisionParamSchema = z.object({
  rev: z.coerce.number().int().min(1),
});

const diffParamSchema = z.object({
  r1: z.coerce.number().int().min(1),
  r2: z.coerce.number().int().min(1),
});

const deptParamSchema = z.object({
  dept: z.string().min(1).max(100),
});

const generatePreviewSchema = z.object({
  industry: z.string().min(1).max(200),
  company_info: z.string().min(1).max(5000),
  mode: z.enum(["new", "update"]).default("new"),
  update_instruction: z.string().max(3000).optional(),
});

// ── Route Registration ──────────────────────────

export async function registerAdmin(app: Express, config: GrcConfig) {
  const router = Router();
  const service = new StrategyService();
  const requireAuth = createAuthMiddleware(config);
  const requireAdmin = createAdminAuthMiddleware(config);

  // ── GET /strategy — Get current strategy ──

  router.get(
    "/strategy",
    requireAuth, requireAdmin,
    asyncHandler(async (_req: Request, res: Response) => {
      const strategy = await service.getStrategy();

      res.json({ data: strategy });
    }),
  );

  // ── PUT /strategy — Update strategy ──

  router.put(
    "/strategy",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const body = updateStrategySchema.parse(req.body);
      const updatedBy = req.auth?.sub ?? "admin";

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

      const updated = await service.updateStrategy(data, updatedBy);

      logger.info({ admin: updatedBy }, "Strategy updated by admin");

      // Auto-post strategy update to community
      try {
        const { getCommunityService } = await import("../community/service.js");
        const { communityChannelsTable } = await import("../community/schema.js");
        const { getDb } = await import("../../shared/db/connection.js");
        const { eq: eqOp } = await import("drizzle-orm");
        const db = getDb();
        const cs = getCommunityService();
        const [ch] = await db
          .select({ id: communityChannelsTable.id })
          .from(communityChannelsTable)
          .where(eqOp(communityChannelsTable.name, "announcements"))
          .limit(1);
        if (ch) {
          const changedFields = Object.keys(data).join(", ");
          await cs.createPost({
            authorNodeId: updatedBy,
            channelId: ch.id,
            postType: "alert" as import("../../shared/interfaces/community.interface.js").PostType,
            title: `[Strategy Update] Company strategy has been updated (rev ${(updated as Record<string, unknown>).revision ?? "?"})`,
            contextData: {
              body: `The company strategy has been updated. Please review the latest version.\n\n**Changed fields**: ${changedFields}\n\nAll agents will receive updated context variables automatically.`,
              tags: ["strategy-update", "auto-generated"],
              auto_generated: true,
            },
          });
        }
      } catch { /* fire-and-forget */ }

      res.json({ data: updated });
    }),
  );

  // ── POST /strategy/deploy — Deploy to all agents (cascade) ──

  router.post(
    "/strategy/deploy",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const body = deployStrategySchema.parse(req.body);
      const updatedBy = body.updated_by ?? req.auth?.sub ?? "admin";

      const result = await service.deployStrategy(updatedBy);

      logger.info(
        { admin: updatedBy, nodesUpdated: result.nodesUpdated, revision: result.revision },
        "Strategy deployed by admin",
      );

      res.json({
        ok: true,
        nodes_updated: result.nodesUpdated,
        revision: result.revision,
      });
    }),
  );

  // ── POST /strategy/generate-preview — AI strategy generation ──

  router.post(
    "/strategy/generate-preview",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const body = generatePreviewSchema.parse(req.body);

      logger.info(
        { mode: body.mode, industry: body.industry, admin: req.auth?.sub },
        "Generating AI strategy preview",
      );

      // If update mode, fetch existing strategy for context
      let existingStrategy: Record<string, unknown> | undefined;
      if (body.mode === "update") {
        try {
          const current = await service.getStrategy();
          existingStrategy = current as Record<string, unknown>;
        } catch {
          // No existing strategy, proceed as new
        }
      }

      const messages = buildStrategyGenerationPrompt({
        industry: body.industry,
        companyInfo: body.company_info,
        mode: body.mode,
        updateInstruction: body.update_instruction,
        existingStrategy,
      });

      const result = await chatCompletionJson<Record<string, unknown>>(
        { messages, temperature: 0.7 },
      );

      res.json(result);
    }),
  );

  // ── GET /strategy/history — Revision history ──

  router.get(
    "/strategy/history",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const query = paginationSchema.parse(req.query);
      const result = await service.getHistory({
        page: query.page,
        limit: query.limit,
      });

      res.json(result);
    }),
  );

  // ── GET /strategy/history/:rev — Specific revision ──

  router.get(
    "/strategy/history/:rev",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const { rev } = revisionParamSchema.parse(req.params);
      const revision = await service.getHistoryRevision(rev);

      res.json({ data: revision });
    }),
  );

  // ── GET /strategy/diff/:r1/:r2 — Compare revisions ──

  router.get(
    "/strategy/diff/:r1/:r2",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const { r1, r2 } = diffParamSchema.parse(req.params);
      const diff = await service.getDiff(r1, r2);

      res.json({ data: diff });
    }),
  );

  // ── GET /strategy/budgets — All department budgets ──

  router.get(
    "/strategy/budgets",
    requireAuth, requireAdmin,
    asyncHandler(async (_req: Request, res: Response) => {
      const budgets = await service.getBudgets();

      res.json({ data: budgets });
    }),
  );

  // ── PUT /strategy/budgets/:dept — Update department budget ──

  router.put(
    "/strategy/budgets/:dept",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const { dept } = deptParamSchema.parse(req.params);
      const updatedBy = req.auth?.sub ?? "admin";
      const budgetData = req.body;

      const budgets = await service.updateBudgets(dept, budgetData, updatedBy);

      logger.info({ admin: updatedBy, department: dept }, "Department budget updated");

      res.json({ data: budgets });
    }),
  );

  // ── GET /strategy/kpis — All department KPIs ──

  router.get(
    "/strategy/kpis",
    requireAuth, requireAdmin,
    asyncHandler(async (_req: Request, res: Response) => {
      const kpis = await service.getKpis();

      res.json({ data: kpis });
    }),
  );

  // ── PUT /strategy/kpis/:dept — Update department KPIs ──

  router.put(
    "/strategy/kpis/:dept",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const { dept } = deptParamSchema.parse(req.params);
      const updatedBy = req.auth?.sub ?? "admin";
      const kpiData = req.body;

      const kpis = await service.updateKpis(dept, kpiData, updatedBy);

      logger.info({ admin: updatedBy, department: dept }, "Department KPIs updated");

      res.json({ data: kpis });
    }),
  );

  // ── Mount ─────────────────────────────────────

  app.use("/api/v1/admin", router);
  logger.info("Strategy admin routes registered");
}
