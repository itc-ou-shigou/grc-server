/**
 * Tasks Module — Admin Routes
 *
 * Provides admin-only management endpoints for tasks, expense approvals,
 * and task statistics.
 * All routes require JWT authentication + admin role.
 */

import { Router } from "express";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { eq, sql, and, inArray, gte } from "drizzle-orm";
import pino from "pino";
import type { GrcConfig } from "../../config.js";
import { createAuthMiddleware } from "../../shared/middleware/auth.js";
import { createAdminAuthMiddleware } from "../../shared/middleware/admin-auth.js";
import { asyncHandler, NotFoundError, BadRequestError } from "../../shared/middleware/error-handler.js";
import { getDb } from "../../shared/db/connection.js";
import { uuidSchema, paginationSchema } from "../../shared/utils/validators.js";
import { tasksTable, taskCommentsTable, taskProgressLogTable } from "./schema.js";
import { TasksService } from "./service.js";
import { a2aRelayQueueTable } from "../relay/schema.js";
import { communityTopicsTable } from "../community/schema.js";
import { calculateMeetingKPIs } from "../meetings/meeting-kpi.js";
import { CampaignService } from "../community/campaign-service.js";
import { PipelineService } from "../community/pipeline-service.js";
import { RoadmapService } from "../community/roadmap-service.js";
import { KpiService } from "../community/kpi-service.js";

const logger = pino({ name: "admin:tasks" });

// ── Zod Schemas ─────────────────────────────────

const taskListQuerySchema = paginationSchema.extend({
  status: z.string().optional(),
  priority: z.string().optional(),
  category: z.string().optional(),
  assigned_role_id: z.string().optional(),
  assigned_node_id: z.string().optional(),
  assigned_by: z.string().optional(),
});

const createTaskSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().nullable().optional(),
  category: z.enum(["strategic", "operational", "administrative", "expense"]).nullable().optional(),
  priority: z.enum(["critical", "high", "medium", "low"]).optional(),
  status: z.enum([
    "draft", "pending", "in_progress", "blocked",
    "review", "approved", "completed", "cancelled",
  ]).optional(),
  assigned_role_id: z.string().max(50).nullable().optional(),
  assigned_node_id: z.string().max(255).nullable().optional(),
  assigned_by: z.string().max(255).nullable().optional(),
  deadline: z.string().datetime().nullable().optional(),
  depends_on: z.array(z.string()).nullable().optional(),
  collaborators: z.array(z.string()).nullable().optional(),
  deliverables: z.array(z.string()).nullable().optional(),
  notes: z.string().nullable().optional(),
  expense_amount: z.string().max(30).nullable().optional(),
  expense_currency: z.string().max(10).nullable().optional(),
  // Expense details (支払い先・目的情報)
  vendor_name: z.string().max(255).nullable().optional(),
  vendor_type: z.enum(["supplier", "contractor", "subscription", "other"]).nullable().optional(),
  product_service: z.string().max(500).nullable().optional(),
  expense_description: z.string().nullable().optional(),
  payment_method: z.enum(["bank_transfer", "credit_card", "cash", "other"]).nullable().optional(),
  // Bank details
  bank_name: z.string().max(255).nullable().optional(),
  bank_branch: z.string().max(255).nullable().optional(),
  bank_account_type: z.enum(["ordinary", "checking"]).nullable().optional(),
  bank_account_number: z.string().max(100).nullable().optional(),
  bank_account_name: z.string().max(255).nullable().optional(),
  // Invoice info
  invoice_number: z.string().max(100).nullable().optional(),
  invoice_date: z.string().datetime().nullable().optional(),
  due_date: z.string().datetime().nullable().optional(),
  // Business justification
  business_purpose: z.string().nullable().optional(),
  expected_roi: z.string().nullable().optional(),
});

const updateTaskSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().optional(),
  category: z.enum(["strategic", "operational", "administrative", "expense"]).optional(),
  priority: z.enum(["critical", "high", "medium", "low"]).optional(),
  assigned_role_id: z.string().max(50).optional(),
  assigned_node_id: z.string().max(255).optional(),
  assigned_by: z.string().max(255).optional(),
  deadline: z.string().datetime().nullable().optional(),
  depends_on: z.array(z.string()).optional(),
  collaborators: z.array(z.string()).optional(),
  deliverables: z.array(z.string()).optional(),
  notes: z.string().optional(),
  expense_amount: z.string().max(30).optional(),
  expense_currency: z.string().max(10).optional(),
  // Expense details
  vendor_name: z.string().max(255).optional(),
  vendor_type: z.enum(["supplier", "contractor", "subscription", "other"]).optional(),
  product_service: z.string().max(500).optional(),
  expense_description: z.string().optional(),
  payment_method: z.enum(["bank_transfer", "credit_card", "cash", "other"]).optional(),
  bank_name: z.string().max(255).optional(),
  bank_branch: z.string().max(255).optional(),
  bank_account_type: z.enum(["ordinary", "checking"]).optional(),
  bank_account_number: z.string().max(100).optional(),
  bank_account_name: z.string().max(255).optional(),
  invoice_number: z.string().max(100).optional(),
  invoice_date: z.string().datetime().nullable().optional(),
  due_date: z.string().datetime().nullable().optional(),
  business_purpose: z.string().optional(),
  expected_roi: z.string().optional(),
  result_summary: z.string().optional(),
  result_data: z.record(z.unknown()).optional(),
  version: z.number().int().min(1),
});

const changeStatusSchema = z.object({
  status: z.enum([
    "draft", "pending", "in_progress", "blocked",
    "review", "approved", "completed", "cancelled",
  ]),
});

const commentSchema = z.object({
  content: z.string().min(1),
});

const rejectExpenseSchema = z.object({
  reason: z.string().optional(),
});

// ── Campaign Zod Schemas ────────────────────────

const campaignListQuerySchema = paginationSchema.extend({
  status: z.string().optional(),
  start_from: z.string().optional(),
  start_to: z.string().optional(),
});

const createCampaignSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().nullable().optional(),
  start_date: z.string().datetime(),
  end_date: z.string().datetime().nullable().optional(),
  status: z.enum(["draft", "planned", "active", "completed", "cancelled"]).optional(),
  owner_id: z.string().max(100).nullable().optional(),
  owner_role: z.string().max(50).nullable().optional(),
  channel: z.string().max(50).nullable().optional(),
  budget: z.string().max(30).nullable().optional(),
  kpi_target: z.string().max(200).nullable().optional(),
});

const updateCampaignSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().nullable().optional(),
  start_date: z.string().datetime().optional(),
  end_date: z.string().datetime().nullable().optional(),
  status: z.enum(["draft", "planned", "active", "completed", "cancelled"]).optional(),
  owner_id: z.string().max(100).nullable().optional(),
  owner_role: z.string().max(50).nullable().optional(),
  channel: z.string().max(50).nullable().optional(),
  budget: z.string().max(30).nullable().optional(),
  kpi_target: z.string().max(200).nullable().optional(),
});

// ── Pipeline Zod Schemas ────────────────────────

const pipelineListQuerySchema = paginationSchema.extend({
  stage: z.string().optional(),
  owner_id: z.string().optional(),
});

const createDealSchema = z.object({
  company_name: z.string().min(1).max(200),
  contact_name: z.string().max(100).nullable().optional(),
  deal_title: z.string().min(1).max(200),
  stage: z.enum(["lead", "qualified", "proposal", "negotiation", "closed_won", "closed_lost"]).optional(),
  deal_value: z.string().max(30).nullable().optional(),
  currency: z.string().max(3).optional(),
  probability: z.number().int().min(0).max(100).optional(),
  expected_close_date: z.string().datetime().nullable().optional(),
  owner_id: z.string().max(100).nullable().optional(),
  owner_role: z.string().max(50).nullable().optional(),
  notes: z.string().nullable().optional(),
});

const updateDealSchema = z.object({
  company_name: z.string().min(1).max(200).optional(),
  contact_name: z.string().max(100).nullable().optional(),
  deal_title: z.string().min(1).max(200).optional(),
  stage: z.enum(["lead", "qualified", "proposal", "negotiation", "closed_won", "closed_lost"]).optional(),
  deal_value: z.string().max(30).nullable().optional(),
  currency: z.string().max(3).optional(),
  probability: z.number().int().min(0).max(100).optional(),
  expected_close_date: z.string().datetime().nullable().optional(),
  owner_id: z.string().max(100).nullable().optional(),
  owner_role: z.string().max(50).nullable().optional(),
  notes: z.string().nullable().optional(),
});

// ── Route Registration ──────────────────────────

export async function registerAdmin(app: Express, config: GrcConfig) {
  const router = Router();
  const requireAuth = createAuthMiddleware(config);
  const requireAdmin = createAdminAuthMiddleware(config);
  const service = new TasksService();

  // ── GET /tasks — List all tasks (paginated, filterable) ──

  router.get(
    "/tasks",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const query = taskListQuerySchema.parse(req.query);

      const result = await service.listTasks({
        page: query.page,
        limit: query.limit,
        status: query.status,
        priority: query.priority,
        category: query.category,
        assignedRoleId: query.assigned_role_id,
        assignedNodeId: query.assigned_node_id,
        assignedBy: query.assigned_by,
      });

      res.json(result);
    }),
  );

  // ── GET /tasks/stats — Task statistics ──

  router.get(
    "/tasks/stats",
    requireAuth, requireAdmin,
    asyncHandler(async (_req: Request, res: Response) => {
      const stats = await service.getTaskStats();

      res.json(stats);
    }),
  );

  // ── GET /tasks/expenses — Expense approval queue ──

  router.get(
    "/tasks/expenses",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const query = paginationSchema.parse(req.query);

      const result = await service.getExpenseQueue({
        page: query.page,
        limit: query.limit,
      });

      res.json(result);
    }),
  );

  // ── GET /tasks/:id — Get task detail ──

  router.get(
    "/tasks/:id",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const id = uuidSchema.parse(req.params.id);
      const result = await service.getTask(id);
      const { progressLog, comments, ...task } = result;

      res.json({ task, progress: progressLog, comments });
    }),
  );

  // ── POST /tasks — Create task ──

  router.post(
    "/tasks",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const body = createTaskSchema.parse(req.body);
      const admin = req.auth?.sub ?? "admin";

      const task = await service.createTask({
        title: body.title,
        description: body.description ?? undefined,
        category: body.category ?? undefined,
        priority: body.priority,
        status: body.status,
        assignedRoleId: body.assigned_role_id ?? undefined,
        assignedNodeId: body.assigned_node_id ?? undefined,
        assignedBy: body.assigned_by ?? admin,
        deadline: body.deadline ? new Date(body.deadline) : undefined,
        dependsOn: body.depends_on,
        collaborators: body.collaborators,
        deliverables: body.deliverables,
        notes: body.notes ?? undefined,
        expenseAmount: body.expense_amount ?? undefined,
        expenseCurrency: body.expense_currency ?? undefined,
        // Expense details
        vendorName: body.vendor_name ?? undefined,
        vendorType: body.vendor_type ?? undefined,
        productService: body.product_service ?? undefined,
        expenseDescription: body.expense_description ?? undefined,
        paymentMethod: body.payment_method ?? undefined,
        bankName: body.bank_name ?? undefined,
        bankBranch: body.bank_branch ?? undefined,
        bankAccountType: body.bank_account_type ?? undefined,
        bankAccountNumber: body.bank_account_number ?? undefined,
        bankAccountName: body.bank_account_name ?? undefined,
        invoiceNumber: body.invoice_number ?? undefined,
        invoiceDate: body.invoice_date ? new Date(body.invoice_date) : undefined,
        dueDate: body.due_date ? new Date(body.due_date) : undefined,
        businessPurpose: body.business_purpose ?? undefined,
        expectedRoi: body.expected_roi ?? undefined,
      });

      res.status(201).json({ data: task });
    }),
  );

  // ── PUT /tasks/:id — Update task ──

  router.put(
    "/tasks/:id",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const id = uuidSchema.parse(req.params.id);
      const body = updateTaskSchema.parse(req.body);
      const admin = req.auth?.sub ?? "admin";

      const task = await service.updateTask(
        id,
        {
          title: body.title,
          description: body.description,
          category: body.category,
          priority: body.priority,
          assignedRoleId: body.assigned_role_id,
          assignedNodeId: body.assigned_node_id,
          assignedBy: body.assigned_by,
          deadline: body.deadline !== undefined
            ? (body.deadline !== null ? new Date(body.deadline) : null)
            : undefined,
          dependsOn: body.depends_on,
          collaborators: body.collaborators,
          deliverables: body.deliverables,
          notes: body.notes,
          expenseAmount: body.expense_amount,
          expenseCurrency: body.expense_currency,
          // Expense details
          vendorName: body.vendor_name,
          vendorType: body.vendor_type,
          productService: body.product_service,
          expenseDescription: body.expense_description,
          paymentMethod: body.payment_method,
          bankName: body.bank_name,
          bankBranch: body.bank_branch,
          bankAccountType: body.bank_account_type,
          bankAccountNumber: body.bank_account_number,
          bankAccountName: body.bank_account_name,
          invoiceNumber: body.invoice_number,
          invoiceDate: body.invoice_date !== undefined
            ? (body.invoice_date !== null ? new Date(body.invoice_date) : undefined)
            : undefined,
          dueDate: body.due_date !== undefined
            ? (body.due_date !== null ? new Date(body.due_date) : undefined)
            : undefined,
          businessPurpose: body.business_purpose,
          expectedRoi: body.expected_roi,
          resultSummary: body.result_summary,
          resultData: body.result_data,
          version: body.version,
        },
        admin,
      );

      res.json({ data: task });
    }),
  );

  // ── PUT /tasks/:id/status — Change task status ──

  router.put(
    "/tasks/:id/status",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const id = uuidSchema.parse(req.params.id);
      const body = changeStatusSchema.parse(req.body);
      const admin = req.auth?.sub ?? "admin";

      const task = await service.changeStatus(id, body.status, admin);

      res.json({ data: task });
    }),
  );

  // ── POST /tasks/:id/comment — Add admin comment ──

  router.post(
    "/tasks/:id/comment",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const id = uuidSchema.parse(req.params.id);
      const body = commentSchema.parse(req.body);
      const admin = req.auth?.sub ?? "admin";

      const comment = await service.addComment(id, admin, body.content);

      res.status(201).json({ data: comment });
    }),
  );

  // ── POST /tasks/:id/expense/approve — Approve expense ──

  router.post(
    "/tasks/:id/expense/approve",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const id = uuidSchema.parse(req.params.id);
      const admin = req.auth?.sub ?? "admin";

      const task = await service.approveExpense(id, admin);

      res.json({ data: task });
    }),
  );

  // ── POST /tasks/:id/expense/pay — Mark expense as paid ──

  router.post(
    "/tasks/:id/expense/pay",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const id = uuidSchema.parse(req.params.id);
      const admin = req.auth?.sub ?? "admin";

      const task = await service.markExpensePaid(id, admin);

      res.json({ data: task });
    }),
  );

  // ── POST /tasks/:id/expense/reject — Reject expense ──

  router.post(
    "/tasks/:id/expense/reject",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const id = uuidSchema.parse(req.params.id);
      const body = rejectExpenseSchema.parse(req.body);
      const admin = req.auth?.sub ?? "admin";

      const task = await service.rejectExpense(id, admin, body.reason);

      res.json({ data: task });
    }),
  );

  // ── DELETE /tasks/:id — Delete task (only draft/cancelled) ──

  router.delete(
    "/tasks/:id",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const id = uuidSchema.parse(req.params.id);
      const db = getDb();

      const rows = await db
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.id, id))
        .limit(1);

      if (rows.length === 0) {
        throw new NotFoundError("Task");
      }

      const task = rows[0];

      // Delete related records first to avoid FK constraint violations
      await db.delete(taskCommentsTable).where(eq(taskCommentsTable.taskId, id));
      await db.delete(taskProgressLogTable).where(eq(taskProgressLogTable.taskId, id));
      await db.delete(tasksTable).where(eq(tasksTable.id, id));

      logger.info(
        { taskId: id, taskCode: task.taskCode, admin: req.auth?.sub },
        "Task deleted by admin",
      );

      res.json({ ok: true, deleted: id });
    }),
  );

  // ── GET /notifications/summary — Unified notification counts across modules ──

  router.get(
    "/notifications/summary",
    requireAuth, requireAdmin,
    asyncHandler(async (_req: Request, res: Response) => {
      const db = getDb();

      const twentyFourHoursAgo = new Date();
      twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

      const [relayResult, tasksResult, communityResult] = await Promise.all([
        // Count queued relay messages
        db
          .select({ count: sql<number>`COUNT(*)` })
          .from(a2aRelayQueueTable)
          .where(eq(a2aRelayQueueTable.status, "queued")),

        // Count pending/in_progress tasks
        db
          .select({ count: sql<number>`COUNT(*)` })
          .from(tasksTable)
          .where(
            inArray(tasksTable.status, ["pending", "in_progress"]),
          ),

        // Count community topics created in the last 24 hours
        db
          .select({ count: sql<number>`COUNT(*)` })
          .from(communityTopicsTable)
          .where(gte(communityTopicsTable.createdAt, twentyFourHoursAgo)),
      ]);

      const relayPending = Number(relayResult[0]?.count ?? 0);
      const tasksPending = Number(tasksResult[0]?.count ?? 0);
      const communityUnread = Number(communityResult[0]?.count ?? 0);

      res.json({
        relay_pending: relayPending,
        tasks_pending: tasksPending,
        community_unread: communityUnread,
        total: relayPending + tasksPending + communityUnread,
      });
    }),
  );

  // ── POST /tasks/resend-pending — Re-send SSE task_assigned for all pending tasks ──
  router.post(
    "/tasks/resend-pending",
    requireAuth, requireAdmin,
    asyncHandler(async (_req: Request, res: Response) => {
      const service = new TasksService();
      const results = await service.resendPendingTaskEvents();
      res.json({ ok: true, ...results });
    }),
  );

  // ── GET /meetings/kpi — Meeting KPI rankings ──

  router.get(
    "/meetings/kpi",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const range = (req.query.range as string) || "week";

      const now = new Date();
      let startDate: Date;

      if (range === "month") {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      } else {
        // Default: current week (Monday start)
        const day = now.getDay();
        const diff = day === 0 ? 6 : day - 1; // Monday = 0
        startDate = new Date(now);
        startDate.setDate(now.getDate() - diff);
        startDate.setHours(0, 0, 0, 0);
      }

      const kpis = await calculateMeetingKPIs(startDate, now);

      res.json({
        range,
        startDate: startDate.toISOString(),
        endDate: now.toISOString(),
        data: kpis,
      });
    }),
  );

  // ═══════════════════════════════════════════════
  // Campaign Calendar Endpoints
  // ═══════════════════════════════════════════════

  const campaignService = new CampaignService();

  // ── GET /campaigns — List campaigns (paginated, date-filterable) ──

  router.get(
    "/campaigns",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const query = campaignListQuerySchema.parse(req.query);

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

  // ── POST /campaigns — Create campaign ──

  router.post(
    "/campaigns",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const body = createCampaignSchema.parse(req.body);

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

  // ── PUT /campaigns/:id — Update campaign ──

  router.put(
    "/campaigns/:id",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const id = uuidSchema.parse(req.params.id);
      const body = updateCampaignSchema.parse(req.body);

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

  // ── DELETE /campaigns/:id — Delete campaign ──

  router.delete(
    "/campaigns/:id",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const id = uuidSchema.parse(req.params.id);
      await campaignService.delete(id);

      logger.info({ campaignId: id, admin: req.auth?.sub }, "Campaign deleted by admin");
      res.json({ ok: true, deleted: id });
    }),
  );

  // ═══════════════════════════════════════════════
  // Sales Pipeline Endpoints
  // ═══════════════════════════════════════════════

  const pipelineService = new PipelineService();

  // ── GET /pipeline/summary — Stage counts + weighted value ──
  // NOTE: Must be registered BEFORE /pipeline/:id to avoid route collision

  router.get(
    "/pipeline/summary",
    requireAuth, requireAdmin,
    asyncHandler(async (_req: Request, res: Response) => {
      const summary = await pipelineService.getSummary();
      res.json({ data: summary });
    }),
  );

  // ── GET /pipeline — List deals (paginated, stage-filterable) ──

  router.get(
    "/pipeline",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const query = pipelineListQuerySchema.parse(req.query);

      const result = await pipelineService.list({
        page: query.page,
        limit: query.limit,
        stage: query.stage,
        ownerId: query.owner_id,
      });

      res.json(result);
    }),
  );

  // ── POST /pipeline — Create deal ──

  router.post(
    "/pipeline",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const body = createDealSchema.parse(req.body);

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

  // ── PUT /pipeline/:id — Update deal ──

  router.put(
    "/pipeline/:id",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const id = uuidSchema.parse(req.params.id);
      const body = updateDealSchema.parse(req.body);

      const deal = await pipelineService.update(id, {
        companyName: body.company_name,
        contactName: body.contact_name ?? undefined,
        dealTitle: body.deal_title,
        stage: body.stage,
        dealValue: body.deal_value ?? undefined,
        currency: body.currency,
        probability: body.probability,
        expectedCloseDate: body.expected_close_date !== undefined
          ? (body.expected_close_date !== null ? new Date(body.expected_close_date) : null)
          : undefined,
        ownerId: body.owner_id ?? undefined,
        ownerRole: body.owner_role ?? undefined,
        notes: body.notes ?? undefined,
      });

      res.json({ data: deal });
    }),
  );

  // ── DELETE /pipeline/:id — Delete deal ──

  router.delete(
    "/pipeline/:id",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const id = uuidSchema.parse(req.params.id);
      await pipelineService.delete(id);

      logger.info({ dealId: id, admin: req.auth?.sub }, "Pipeline deal deleted by admin");
      res.json({ ok: true, deleted: id });
    }),
  );

  // ────────────────────────────────────────────────
  //  Roadmap (Impl-4)
  // ────────────────────────────────────────────────

  const roadmapService = new RoadmapService();

  const roadmapListQuerySchema = paginationSchema.extend({
    phase: z.enum(["now", "next", "later", "done"]).optional(),
    priority: z.enum(["must", "should", "could", "wont"]).optional(),
    category: z.string().optional(),
  });

  const createRoadmapSchema = z.object({
    title: z.string().min(1).max(200),
    description: z.string().nullable().optional(),
    phase: z.enum(["now", "next", "later", "done"]).optional(),
    priority: z.enum(["must", "should", "could", "wont"]).optional(),
    category: z.string().max(50).nullable().optional(),
    start_date: z.string().datetime().nullable().optional(),
    end_date: z.string().datetime().nullable().optional(),
    progress: z.number().int().min(0).max(100).optional(),
    owner_id: z.string().max(100).nullable().optional(),
    owner_role: z.string().max(50).nullable().optional(),
    linked_task_ids: z.string().nullable().optional(),
  });

  const updateRoadmapSchema = z.object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().nullable().optional(),
    phase: z.enum(["now", "next", "later", "done"]).optional(),
    priority: z.enum(["must", "should", "could", "wont"]).optional(),
    category: z.string().max(50).nullable().optional(),
    start_date: z.string().datetime().nullable().optional(),
    end_date: z.string().datetime().nullable().optional(),
    progress: z.number().int().min(0).max(100).optional(),
    owner_id: z.string().max(100).nullable().optional(),
    owner_role: z.string().max(50).nullable().optional(),
    linked_task_ids: z.string().nullable().optional(),
  });

  // GET /roadmap — List roadmap items
  router.get(
    "/roadmap",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const query = roadmapListQuerySchema.parse(req.query);
      const result = await roadmapService.list({
        page: query.page,
        limit: query.limit,
        phase: query.phase,
        priority: query.priority,
        category: query.category,
      });
      res.json(result);
    }),
  );

  // POST /roadmap — Create roadmap item
  router.post(
    "/roadmap",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const body = createRoadmapSchema.parse(req.body);
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

  // PUT /roadmap/:id — Update roadmap item
  router.put(
    "/roadmap/:id",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const id = uuidSchema.parse(req.params.id);
      const body = updateRoadmapSchema.parse(req.body);
      const item = await roadmapService.update(id, {
        title: body.title,
        description: body.description,
        phase: body.phase,
        priority: body.priority,
        category: body.category,
        startDate: body.start_date !== undefined
          ? (body.start_date !== null ? new Date(body.start_date) : null)
          : undefined,
        endDate: body.end_date !== undefined
          ? (body.end_date !== null ? new Date(body.end_date) : null)
          : undefined,
        progress: body.progress,
        ownerId: body.owner_id,
        ownerRole: body.owner_role,
        linkedTaskIds: body.linked_task_ids,
      });
      res.json({ data: item });
    }),
  );

  // DELETE /roadmap/:id — Delete roadmap item
  router.delete(
    "/roadmap/:id",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const id = uuidSchema.parse(req.params.id);
      const result = await roadmapService.delete(id);
      res.json(result);
    }),
  );

  // ────────────────────────────────────────────────
  //  KPIs (Impl-4)
  // ────────────────────────────────────────────────

  const kpiService = new KpiService();

  const createKpiSchema = z.object({
    name: z.string().min(1).max(100),
    description: z.string().nullable().optional(),
    category: z.string().max(50).nullable().optional(),
    unit: z.string().max(20).nullable().optional(),
    target_value: z.string().max(30).nullable().optional(),
    target_period: z.enum(["daily", "weekly", "monthly", "quarterly", "yearly"]).optional(),
    owner_role: z.string().max(50).nullable().optional(),
  });

  const updateKpiSchema = z.object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().nullable().optional(),
    category: z.string().max(50).nullable().optional(),
    unit: z.string().max(20).nullable().optional(),
    target_value: z.string().max(30).nullable().optional(),
    target_period: z.enum(["daily", "weekly", "monthly", "quarterly", "yearly"]).optional(),
    owner_role: z.string().max(50).nullable().optional(),
  });

  const recordKpiValueSchema = z.object({
    value: z.string().min(1).max(30),
    recorded_by: z.string().max(100).optional(),
    notes: z.string().optional(),
  });

  const kpiHistoryQuerySchema = z.object({
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
  });

  // GET /kpis/dashboard — All KPIs + achievement rates (must be before /kpis/:id)
  router.get(
    "/kpis/dashboard",
    requireAuth, requireAdmin,
    asyncHandler(async (_req: Request, res: Response) => {
      const dashboard = await kpiService.getDashboard();
      res.json({ data: dashboard });
    }),
  );

  // GET /kpis — List KPI definitions
  router.get(
    "/kpis",
    requireAuth, requireAdmin,
    asyncHandler(async (_req: Request, res: Response) => {
      const definitions = await kpiService.listDefinitions();
      res.json({ data: definitions });
    }),
  );

  // POST /kpis — Create KPI definition
  router.post(
    "/kpis",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const body = createKpiSchema.parse(req.body);
      const definition = await kpiService.createDefinition({
        name: body.name,
        description: body.description ?? undefined,
        category: body.category ?? undefined,
        unit: body.unit ?? undefined,
        targetValue: body.target_value ?? undefined,
        targetPeriod: body.target_period,
        ownerRole: body.owner_role ?? undefined,
      });
      res.status(201).json({ data: definition });
    }),
  );

  // PUT /kpis/:id — Update KPI definition
  router.put(
    "/kpis/:id",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const id = uuidSchema.parse(req.params.id);
      const body = updateKpiSchema.parse(req.body);
      const definition = await kpiService.updateDefinition(id, {
        name: body.name,
        description: body.description,
        category: body.category,
        unit: body.unit,
        targetValue: body.target_value,
        targetPeriod: body.target_period,
        ownerRole: body.owner_role,
      });
      res.json({ data: definition });
    }),
  );

  // POST /kpis/:id/record — Record a KPI value
  router.post(
    "/kpis/:id/record",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const id = uuidSchema.parse(req.params.id);
      const body = recordKpiValueSchema.parse(req.body);
      const admin = req.auth?.sub ?? "admin";
      const record = await kpiService.recordValue(
        id,
        body.value,
        body.recorded_by ?? admin,
        body.notes,
      );
      res.status(201).json({ data: record });
    }),
  );

  // GET /kpis/:id/history — KPI history with optional date range
  router.get(
    "/kpis/:id/history",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const id = uuidSchema.parse(req.params.id);
      const query = kpiHistoryQuerySchema.parse(req.query);
      const result = await kpiService.getHistory(
        id,
        query.from ? new Date(query.from) : undefined,
        query.to ? new Date(query.to) : undefined,
      );
      res.json({ data: result });
    }),
  );

  // ── Mount ─────────────────────────────────────

  app.use("/api/v1/admin", router);
  logger.info("Tasks admin routes registered");
}
