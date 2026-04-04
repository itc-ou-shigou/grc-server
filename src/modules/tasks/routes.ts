/**
 * Tasks Module — A2A Protocol Routes (Agent-Facing)
 *
 * Endpoints for agents to query and update their assigned tasks.
 * All routes are under /a2a/tasks/*.
 */

import { Router } from "express";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import pino from "pino";
import type { GrcConfig } from "../../config.js";
import { createAuthMiddleware } from "../../shared/middleware/auth.js";
import { asyncHandler, BadRequestError } from "../../shared/middleware/error-handler.js";
import { rateLimitMiddleware } from "../../shared/middleware/rate-limit.js";
import { TasksService } from "./service.js";
import { ScheduledReviewNotifier } from "./scheduled-review.js";
import { CampaignService } from "../community/campaign-service.js";
import { PipelineService } from "../community/pipeline-service.js";
import { RoadmapService } from "../community/roadmap-service.js";
import { KpiService } from "../community/kpi-service.js";
import { paginationSchema } from "../../shared/utils/validators.js";

const logger = pino({ name: "module:tasks" });

// ── Request Validation Schemas ──────────────────

const nudgeTaskSchema = z.object({
  task_code: z.string().min(1).max(50),
  nudger_node_id: z.string().min(1).max(255),
  nudger_role_id: z.string().min(1).max(50),
  message: z.string().max(1000).optional(),
  escalation_level: z.enum(["gentle", "urgent", "escalate"]).default("gentle"),
});

const taskUpdateSchema = z.object({
  task_id: z.string().uuid(),
  node_id: z.string().min(1),
  status: z.string().optional(),
  result_summary: z.string().optional(),
  result_data: z.record(z.unknown()).optional(),
});

const taskCommentSchema = z.object({
  task_id: z.string().uuid(),
  node_id: z.string().min(1),
  content: z.string().min(1),
});

const agentCreateTaskSchema = z.object({
  creator_role_id: z.string().min(1).max(50),
  creator_node_id: z.string().min(1).max(255),
  title: z.string().min(1).max(500),
  description: z.string().optional(),
  category: z.enum(["strategic", "operational", "administrative", "expense"]).optional(),
  priority: z.enum(["critical", "high", "medium", "low"]).optional(),
  target_role_id: z.string().max(50).optional(),
  target_node_id: z.string().max(255).optional(),
  trigger_type: z.enum(["heartbeat", "task_chain", "strategy", "meeting", "escalation"]),
  trigger_source: z.string().optional(),
  expense_amount: z.string().max(30).optional(),
  expense_currency: z.string().max(10).optional(),
  deadline: z.string().datetime().optional(),
  deliverables: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

// ── Module Registration ─────────────────────────

export async function register(app: Express, config: GrcConfig): Promise<void> {
  const router = Router();
  const service = new TasksService();
  const authRequired = createAuthMiddleware(config, true);

  // ────────────────────────────────────────────
  // GET /a2a/tasks/mine?node_id=xxx — Get tasks for this node
  // ────────────────────────────────────────────
  router.get(
    "/mine",
    authRequired,
    asyncHandler(async (req: Request, res: Response) => {
      const nodeId = z.string().min(1).parse(req.query.node_id);
      const tasks = await service.getTasksForNode(nodeId);

      res.json({
        ok: true,
        tasks,
        count: tasks.length,
      });
    }),
  );

  // ────────────────────────────────────────────
  // GET /a2a/tasks/pending?node_id=xxx&role_id=yyy — Get actionable tasks for this node
  // ────────────────────────────────────────────
  router.get(
    "/pending",
    authRequired,
    asyncHandler(async (req: Request, res: Response) => {
      const nodeId = z.string().min(1).parse(req.query.node_id);
      const roleId = req.query.role_id
        ? z.string().min(1).parse(req.query.role_id)
        : undefined;

      const tasks = await service.getPendingTasksForNode(nodeId, roleId);

      res.json({
        ok: true,
        tasks,
        count: tasks.length,
      });
    }),
  );

  // ────────────────────────────────────────────
  // POST /a2a/tasks/update — Update task status/result from agent
  // ────────────────────────────────────────────
  router.post(
    "/update",
    authRequired,
    asyncHandler(async (req: Request, res: Response) => {
      const body = taskUpdateSchema.parse(req.body);

      // Verify the requesting node is either the assignee or the creator
      const task = await service.getTask(body.task_id);
      let isAssignee = task.assignedNodeId === body.node_id;
      const isCreator = task.creatorNodeId === body.node_id;

      // Role-based assignment: if no specific node assigned, check if node's role matches
      if (!isAssignee && !task.assignedNodeId && task.assignedRoleId) {
        const nodeRole = await service.getNodeRoleId(body.node_id);
        if (nodeRole && nodeRole === task.assignedRoleId) {
          isAssignee = true;
        }
      }

      if (!isAssignee && !isCreator) {
        throw new BadRequestError(
          "Task is not assigned to or created by this node",
        );
      }

      // Scope check: creator can only accept/reject (review phase operations)
      // assignee can update status and results (execution phase operations)
      if (!isAssignee && isCreator && body.status) {
        const creatorAllowedStatuses = ["approved", "completed", "in_progress"];
        if (!creatorAllowedStatuses.includes(body.status)) {
          throw new BadRequestError(
            `Creator node can only set status to: ${creatorAllowedStatuses.join(", ")}`,
          );
        }
      }

      // Self-review prevention: if the same node is both creator and assignee,
      // it cannot approve its own work — must be reviewed by a superior (e.g., CEO).
      // Exception: if the node is the assignee due to review handoff (creator assigned
      // the task to another role/node, and it was reassigned back to creator for review),
      // then approval is allowed — the creator is acting as reviewer, not self-reviewing.
      if (isAssignee && isCreator && body.status === "approved" && task.status === "review") {
        // Check if this is a review handoff (task was assigned to a different role originally)
        const isReviewHandoff = task.assignedRoleId && task.assignedRoleId !== await service.getNodeRoleId(body.node_id);
        if (!isReviewHandoff) {
          throw new BadRequestError(
            "Self-review not allowed: you cannot approve a task you created and executed. " +
            "A superior (e.g., CEO) must review and approve this task.",
          );
        }
      }

      // Change status if provided
      if (body.status) {
        await service.changeStatus(body.task_id, body.status, body.node_id);
      }

      // Update result data if provided
      if (body.result_summary !== undefined || body.result_data !== undefined) {
        // Re-fetch task to get current version after potential status change
        const current = body.status ? await service.getTask(body.task_id) : task;
        await service.updateTask(
          body.task_id,
          {
            resultSummary: body.result_summary,
            resultData: body.result_data,
            version: current.version,
          },
          body.node_id,
        );
      }

      // Fetch the final state
      const updated = await service.getTask(body.task_id);

      res.json({
        ok: true,
        task: updated,
      });
    }),
  );

  // ────────────────────────────────────────────
  // POST /a2a/tasks/comment — Add comment from agent
  // ────────────────────────────────────────────
  router.post(
    "/comment",
    authRequired,
    asyncHandler(async (req: Request, res: Response) => {
      const body = taskCommentSchema.parse(req.body);

      const comment = await service.addComment(
        body.task_id,
        body.node_id,
        body.content,
      );

      res.json({
        ok: true,
        comment,
      });
    }),
  );

  // ────────────────────────────────────────────
  // POST /a2a/tasks/create — Agent autonomous task creation
  // ────────────────────────────────────────────
  router.post(
    "/create",
    authRequired,
    asyncHandler(async (req: Request, res: Response) => {
      const body = agentCreateTaskSchema.parse(req.body);

      const result = await service.createAgentTask({
        creatorRoleId: body.creator_role_id,
        creatorNodeId: body.creator_node_id,
        title: body.title,
        description: body.description,
        category: body.category,
        priority: body.priority,
        targetRoleId: body.target_role_id,
        targetNodeId: body.target_node_id,
        triggerType: body.trigger_type,
        triggerSource: body.trigger_source,
        expenseAmount: body.expense_amount,
        expenseCurrency: body.expense_currency,
        deadline: body.deadline,
        deliverables: body.deliverables,
        notes: body.notes,
      });

      res.status(201).json({
        ok: true,
        task: result.task,
        policy_applied: result.policy_applied,
      });
    }),
  );

  // ────────────────────────────────────────────
  // POST /a2a/tasks/batch — Batch create multiple tasks
  // ────────────────────────────────────────────
  const batchCreateTaskSchema = z.object({
    creator_role_id: z.string().min(1).max(50),
    creator_node_id: z.string().min(1).max(255),
    trigger_type: z.enum([
      "heartbeat",
      "task_chain",
      "strategy",
      "meeting",
      "escalation",
    ]),
    trigger_source: z.string().optional(),
    tasks: z
      .array(
        z.object({
          title: z.string().min(1).max(500),
          description: z.string().optional(),
          category: z
            .enum(["strategic", "operational", "administrative", "expense"])
            .optional(),
          priority: z.enum(["critical", "high", "medium", "low"]).optional(),
          target_role_id: z.string().max(50).optional(),
          target_node_id: z.string().max(255).optional(),
          expense_amount: z.string().max(30).optional(),
          expense_currency: z.string().max(10).optional(),
          deadline: z.string().datetime().optional(),
          deliverables: z.array(z.string()).optional(),
          notes: z.string().optional(),
        }),
      )
      .min(1)
      .max(20),
  });

  router.post(
    "/batch",
    authRequired,
    rateLimitMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const body = batchCreateTaskSchema.parse(req.body);

      const result = await service.createAgentTaskBatch({
        creatorRoleId: body.creator_role_id,
        creatorNodeId: body.creator_node_id,
        triggerType: body.trigger_type,
        triggerSource: body.trigger_source,
        tasks: body.tasks.map((t) => ({
          title: t.title,
          description: t.description,
          category: t.category,
          priority: t.priority,
          targetRoleId: t.target_role_id,
          targetNodeId: t.target_node_id,
          expenseAmount: t.expense_amount,
          expenseCurrency: t.expense_currency,
          deadline: t.deadline,
          deliverables: t.deliverables,
          notes: t.notes,
        })),
      });

      const status = result.summary.failed === result.summary.total ? 400 : 201;
      res.status(status).json({ ok: result.summary.created > 0, ...result });
    }),
  );

  // ────────────────────────────────────────────
  // POST /a2a/tasks/nudge — Send a reminder/nudge about a pending task
  // ────────────────────────────────────────────
  router.post(
    "/nudge",
    authRequired,
    rateLimitMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const body = nudgeTaskSchema.parse(req.body);

      const result = await service.nudgeTask({
        taskCode: body.task_code,
        nudgerNodeId: body.nudger_node_id,
        nudgerRoleId: body.nudger_role_id,
        message: body.message,
        escalationLevel: body.escalation_level,
      });

      res.json({ ok: true, ...result });
    }),
  );

  // ═══════════════════════════════════════════════
  // Business API — Campaigns (A2A, API key accessible)
  // ═══════════════════════════════════════════════

  const campaignService = new CampaignService();

  const campaignCreateSchema = z.object({
    title: z.string().min(1).max(200),
    description: z.string().nullable().optional(),
    start_date: z.string(),
    end_date: z.string().nullable().optional(),
    status: z.enum(["draft", "planned", "active", "completed", "cancelled"]).optional(),
    owner_id: z.string().max(100).nullable().optional(),
    owner_role: z.string().max(50).nullable().optional(),
    channel: z.string().max(50).nullable().optional(),
    budget: z.string().max(30).nullable().optional(),
    kpi_target: z.string().max(200).nullable().optional(),
  });

  const campaignUpdateSchema = campaignCreateSchema.partial();

  // GET /a2a/tasks/campaigns — List campaigns
  router.get(
    "/campaigns",
    authRequired,
    asyncHandler(async (req: Request, res: Response) => {
      const query = paginationSchema.extend({
        status: z.string().optional(),
        start_from: z.string().optional(),
        start_to: z.string().optional(),
      }).parse(req.query);

      const result = await campaignService.list({
        page: query.page,
        limit: query.limit,
        status: query.status,
        startFrom: query.start_from,
        startTo: query.start_to,
      });
      res.json(result);
    }),
  );

  // POST /a2a/tasks/campaigns — Create campaign
  router.post(
    "/campaigns",
    authRequired,
    asyncHandler(async (req: Request, res: Response) => {
      const body = campaignCreateSchema.parse(req.body);
      const campaign = await campaignService.create({
        title: body.title,
        description: body.description ?? undefined,
        startDate: new Date(body.start_date),
        endDate: body.end_date ? new Date(body.end_date) : undefined,
        status: body.status,
        ownerId: body.owner_id ?? undefined,
        ownerRole: body.owner_role ?? undefined,
        channel: body.channel ?? undefined,
        budget: body.budget ?? undefined,
        kpiTarget: body.kpi_target ?? undefined,
      });
      res.status(201).json({ data: campaign });
    }),
  );

  // PUT /a2a/tasks/campaigns/:id — Update campaign
  router.put(
    "/campaigns/:id",
    authRequired,
    asyncHandler(async (req: Request, res: Response) => {
      const id = req.params.id as string;
      const body = campaignUpdateSchema.parse(req.body);
      const campaign = await campaignService.update(id, {
        title: body.title,
        description: body.description ?? undefined,
        startDate: body.start_date ? new Date(body.start_date) : undefined,
        endDate: body.end_date !== undefined
          ? (body.end_date !== null ? new Date(body.end_date) : null)
          : undefined,
        status: body.status,
        ownerId: body.owner_id ?? undefined,
        ownerRole: body.owner_role ?? undefined,
        channel: body.channel ?? undefined,
        budget: body.budget ?? undefined,
        kpiTarget: body.kpi_target ?? undefined,
      });
      res.json({ data: campaign });
    }),
  );

  // DELETE /a2a/tasks/campaigns/:id — Delete campaign
  router.delete(
    "/campaigns/:id",
    authRequired,
    asyncHandler(async (req: Request, res: Response) => {
      await campaignService.delete(req.params.id as string);
      res.json({ ok: true, deleted: req.params.id });
    }),
  );

  // ═══════════════════════════════════════════════
  // Business API — Sales Pipeline (A2A, API key accessible)
  // ═══════════════════════════════════════════════

  const pipelineService = new PipelineService();

  const dealCreateSchema = z.object({
    company_name: z.string().min(1).max(200),
    contact_name: z.string().max(100).nullable().optional(),
    deal_title: z.string().min(1).max(200),
    stage: z.enum(["lead", "qualified", "proposal", "negotiation", "closed_won", "closed_lost"]).optional(),
    deal_value: z.string().max(30).nullable().optional(),
    currency: z.string().max(3).optional(),
    probability: z.number().int().min(0).max(100).optional(),
    expected_close_date: z.string().nullable().optional(),
    owner_id: z.string().max(100).nullable().optional(),
    owner_role: z.string().max(50).nullable().optional(),
    notes: z.string().nullable().optional(),
  });

  const dealUpdateSchema = dealCreateSchema.partial();

  // GET /a2a/tasks/pipeline — List deals
  router.get(
    "/pipeline",
    authRequired,
    asyncHandler(async (req: Request, res: Response) => {
      const query = paginationSchema.extend({
        stage: z.string().optional(),
        owner_id: z.string().optional(),
      }).parse(req.query);
      const result = await pipelineService.list({
        page: query.page,
        limit: query.limit,
        stage: query.stage,
        ownerId: query.owner_id,
      });
      res.json(result);
    }),
  );

  // GET /a2a/tasks/pipeline/summary — Pipeline summary
  router.get(
    "/pipeline/summary",
    authRequired,
    asyncHandler(async (_req: Request, res: Response) => {
      const summary = await pipelineService.getSummary();
      res.json({ data: summary });
    }),
  );

  // POST /a2a/tasks/pipeline — Create deal
  router.post(
    "/pipeline",
    authRequired,
    asyncHandler(async (req: Request, res: Response) => {
      const body = dealCreateSchema.parse(req.body);
      const deal = await pipelineService.create({
        companyName: body.company_name,
        contactName: body.contact_name ?? undefined,
        dealTitle: body.deal_title,
        stage: body.stage,
        dealValue: body.deal_value ?? undefined,
        currency: body.currency,
        probability: body.probability,
        expectedCloseDate: body.expected_close_date ? new Date(body.expected_close_date) : undefined,
        ownerId: body.owner_id ?? undefined,
        ownerRole: body.owner_role ?? undefined,
        notes: body.notes ?? undefined,
      });
      res.status(201).json({ data: deal });
    }),
  );

  // PUT /a2a/tasks/pipeline/:id — Update deal
  router.put(
    "/pipeline/:id",
    authRequired,
    asyncHandler(async (req: Request, res: Response) => {
      const id = req.params.id as string;
      const body = dealUpdateSchema.parse(req.body);
      const deal = await pipelineService.update(id, {
        companyName: body.company_name,
        contactName: body.contact_name ?? undefined,
        dealTitle: body.deal_title,
        stage: body.stage,
        dealValue: body.deal_value ?? undefined,
        currency: body.currency,
        probability: body.probability,
        expectedCloseDate: body.expected_close_date !== undefined
          ? (body.expected_close_date !== null ? new Date(body.expected_close_date) : undefined)
          : undefined,
        ownerId: body.owner_id ?? undefined,
        ownerRole: body.owner_role ?? undefined,
        notes: body.notes ?? undefined,
      });
      res.json({ data: deal });
    }),
  );

  // DELETE /a2a/tasks/pipeline/:id — Delete deal
  router.delete(
    "/pipeline/:id",
    authRequired,
    asyncHandler(async (req: Request, res: Response) => {
      await pipelineService.delete(req.params.id as string);
      res.json({ ok: true, deleted: req.params.id });
    }),
  );

  // ═══════════════════════════════════════════════
  // Business API — Roadmap (A2A, API key accessible)
  // ═══════════════════════════════════════════════

  const roadmapService = new RoadmapService();

  const roadmapCreateSchema = z.object({
    title: z.string().min(1).max(300),
    description: z.string().nullable().optional(),
    phase: z.enum(["now", "next", "later", "done"]).optional(),
    priority: z.enum(["must", "should", "could", "wont"]).optional(),
    category: z.string().nullable().optional(),
    start_date: z.string().nullable().optional(),
    end_date: z.string().nullable().optional(),
    progress: z.number().int().min(0).max(100).optional(),
    owner_id: z.string().nullable().optional(),
    owner_role: z.string().max(50).nullable().optional(),
    linked_task_ids: z.string().nullable().optional(),
  });

  const roadmapUpdateSchema = roadmapCreateSchema.partial();

  // GET /a2a/tasks/roadmap — List roadmap items
  router.get(
    "/roadmap",
    authRequired,
    asyncHandler(async (req: Request, res: Response) => {
      const query = paginationSchema.extend({
        phase: z.string().optional(),
        priority: z.string().optional(),
        category: z.string().optional(),
      }).parse(req.query);
      const result = await roadmapService.list({
        page: query.page,
        limit: query.limit,
        phase: query.phase as string | undefined,
        priority: query.priority as string | undefined,
        category: query.category as string | undefined,
      });
      res.json(result);
    }),
  );

  // POST /a2a/tasks/roadmap — Create roadmap item
  router.post(
    "/roadmap",
    authRequired,
    asyncHandler(async (req: Request, res: Response) => {
      const body = roadmapCreateSchema.parse(req.body);
      const item = await roadmapService.create({
        title: body.title,
        description: body.description ?? undefined,
        phase: body.phase,
        priority: body.priority,
        category: body.category ?? undefined,
        startDate: body.start_date ? new Date(body.start_date) : undefined,
        endDate: body.end_date ? new Date(body.end_date) : undefined,
        progress: body.progress,
        ownerId: body.owner_id ?? undefined,
        ownerRole: body.owner_role ?? undefined,
        linkedTaskIds: body.linked_task_ids ?? undefined,
      });
      res.status(201).json({ data: item });
    }),
  );

  // PUT /a2a/tasks/roadmap/:id — Update roadmap item
  router.put(
    "/roadmap/:id",
    authRequired,
    asyncHandler(async (req: Request, res: Response) => {
      const id = req.params.id as string;
      const body = roadmapUpdateSchema.parse(req.body);
      const item = await roadmapService.update(id, {
        title: body.title,
        description: body.description ?? undefined,
        phase: body.phase,
        priority: body.priority,
        category: body.category ?? undefined,
        startDate: body.start_date ? new Date(body.start_date) : undefined,
        endDate: body.end_date ? new Date(body.end_date) : undefined,
        progress: body.progress,
        ownerId: body.owner_id ?? undefined,
        ownerRole: body.owner_role ?? undefined,
        linkedTaskIds: body.linked_task_ids ?? undefined,
      });
      res.json({ data: item });
    }),
  );

  // DELETE /a2a/tasks/roadmap/:id — Delete roadmap item
  router.delete(
    "/roadmap/:id",
    authRequired,
    asyncHandler(async (req: Request, res: Response) => {
      await roadmapService.delete(req.params.id as string);
      res.json({ ok: true, deleted: req.params.id });
    }),
  );

  // ═══════════════════════════════════════════════
  // Business API — KPIs (A2A, API key accessible)
  // ═══════════════════════════════════════════════

  const kpiService = new KpiService();

  const kpiCreateSchema = z.object({
    name: z.string().min(1).max(200),
    description: z.string().nullable().optional(),
    category: z.string().nullable().optional(),
    unit: z.string().max(30).nullable().optional(),
    target_value: z.string().max(30).nullable().optional(),
    target_period: z.enum(["daily", "weekly", "monthly", "quarterly", "yearly"]).optional(),
    owner_role: z.string().max(50).nullable().optional(),
  });

  const kpiUpdateSchema = kpiCreateSchema.partial();

  const kpiRecordSchema = z.object({
    value: z.string().min(1).max(30),
    recorded_by: z.string().max(100).optional(),
    notes: z.string().max(500).nullable().optional(),
  });

  // GET /a2a/tasks/kpis — List KPI definitions
  router.get(
    "/kpis",
    authRequired,
    asyncHandler(async (_req: Request, res: Response) => {
      const result = await kpiService.listDefinitions();
      res.json({ data: result });
    }),
  );

  // GET /a2a/tasks/kpis/dashboard — KPI dashboard
  router.get(
    "/kpis/dashboard",
    authRequired,
    asyncHandler(async (_req: Request, res: Response) => {
      const dashboard = await kpiService.getDashboard();
      res.json({ data: dashboard });
    }),
  );

  // POST /a2a/tasks/kpis — Create KPI definition
  router.post(
    "/kpis",
    authRequired,
    asyncHandler(async (req: Request, res: Response) => {
      const body = kpiCreateSchema.parse(req.body);
      const kpi = await kpiService.createDefinition({
        name: body.name,
        description: body.description ?? undefined,
        category: body.category ?? undefined,
        unit: body.unit ?? undefined,
        targetValue: body.target_value ?? undefined,
        targetPeriod: body.target_period,
        ownerRole: body.owner_role ?? undefined,
      });
      res.status(201).json({ data: kpi });
    }),
  );

  // PUT /a2a/tasks/kpis/:id — Update KPI definition
  router.put(
    "/kpis/:id",
    authRequired,
    asyncHandler(async (req: Request, res: Response) => {
      const id = req.params.id as string;
      const body = kpiUpdateSchema.parse(req.body);
      const kpi = await kpiService.updateDefinition(id, {
        name: body.name,
        description: body.description ?? undefined,
        category: body.category ?? undefined,
        unit: body.unit ?? undefined,
        targetValue: body.target_value ?? undefined,
        targetPeriod: body.target_period,
        ownerRole: body.owner_role ?? undefined,
      });
      res.json({ data: kpi });
    }),
  );

  // POST /a2a/tasks/kpis/:id/record — Record KPI value
  router.post(
    "/kpis/:id/record",
    authRequired,
    asyncHandler(async (req: Request, res: Response) => {
      const id = req.params.id as string;
      const body = kpiRecordSchema.parse(req.body);
      const record = await kpiService.recordValue(
        id,
        body.value,
        body.recorded_by,
        body.notes ?? undefined,
      );
      res.status(201).json({ data: record });
    }),
  );

  // GET /a2a/tasks/kpis/:id/history — KPI history
  router.get(
    "/kpis/:id/history",
    authRequired,
    asyncHandler(async (req: Request, res: Response) => {
      const id = req.params.id as string;
      const result = await kpiService.getHistory(id);
      res.json({ data: result });
    }),
  );

  // ── Mount router under /a2a/tasks prefix ───
  app.use("/a2a/tasks", router);

  // ── Start weekly review notifier ──────────────
  const reviewNotifier = new ScheduledReviewNotifier();
  reviewNotifier.start();

  logger.info("Tasks module registered — 7 A2A + 18 business API endpoints active");
}
