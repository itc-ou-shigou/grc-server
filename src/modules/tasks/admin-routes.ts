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
import { eq } from "drizzle-orm";
import pino from "pino";
import type { GrcConfig } from "../../config.js";
import { createAuthMiddleware } from "../../shared/middleware/auth.js";
import { createAdminAuthMiddleware } from "../../shared/middleware/admin-auth.js";
import { asyncHandler, NotFoundError, BadRequestError } from "../../shared/middleware/error-handler.js";
import { getDb } from "../../shared/db/connection.js";
import { uuidSchema, paginationSchema } from "../../shared/utils/validators.js";
import { tasksTable } from "./schema.js";
import { TasksService } from "./service.js";

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
  description: z.string().optional(),
  category: z.enum(["strategic", "operational", "administrative", "expense"]).optional(),
  priority: z.enum(["critical", "high", "medium", "low"]).optional(),
  status: z.enum([
    "draft", "pending", "in_progress", "blocked",
    "review", "approved", "completed", "cancelled",
  ]).optional(),
  assigned_role_id: z.string().max(50).optional(),
  assigned_node_id: z.string().max(255).optional(),
  assigned_by: z.string().max(255).optional(),
  deadline: z.string().datetime().optional(),
  depends_on: z.array(z.string()).optional(),
  collaborators: z.array(z.string()).optional(),
  deliverables: z.array(z.string()).optional(),
  notes: z.string().optional(),
  expense_amount: z.string().max(30).optional(),
  expense_currency: z.string().max(10).optional(),
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
        description: body.description,
        category: body.category,
        priority: body.priority,
        status: body.status,
        assignedRoleId: body.assigned_role_id,
        assignedNodeId: body.assigned_node_id,
        assignedBy: body.assigned_by ?? admin,
        deadline: body.deadline ? new Date(body.deadline) : undefined,
        dependsOn: body.depends_on,
        collaborators: body.collaborators,
        deliverables: body.deliverables,
        notes: body.notes,
        expenseAmount: body.expense_amount,
        expenseCurrency: body.expense_currency,
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
      if (task.status !== "draft" && task.status !== "cancelled") {
        throw new BadRequestError(
          `Cannot delete task with status '${task.status}'. Only draft or cancelled tasks can be deleted.`,
        );
      }

      await db.delete(tasksTable).where(eq(tasksTable.id, id));

      logger.info(
        { taskId: id, taskCode: task.taskCode, admin: req.auth?.sub },
        "Task deleted by admin",
      );

      res.json({ ok: true, deleted: id });
    }),
  );

  // ── Mount ─────────────────────────────────────

  app.use("/api/v1/admin", router);
  logger.info("Tasks admin routes registered");
}
