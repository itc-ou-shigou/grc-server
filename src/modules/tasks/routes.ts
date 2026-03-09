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
import { TasksService } from "./service.js";

const logger = pino({ name: "module:tasks" });

// ── Request Validation Schemas ──────────────────

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
  // POST /a2a/tasks/update — Update task status/result from agent
  // ────────────────────────────────────────────
  router.post(
    "/update",
    authRequired,
    asyncHandler(async (req: Request, res: Response) => {
      const body = taskUpdateSchema.parse(req.body);

      // Verify the task is assigned to this node
      const task = await service.getTask(body.task_id);
      if (task.assignedNodeId !== body.node_id) {
        throw new BadRequestError(
          "Task is not assigned to this node",
        );
      }

      // Change status if provided
      if (body.status) {
        await service.changeStatus(body.task_id, body.status, body.node_id);
      }

      // Update result data if provided
      if (body.result_summary !== undefined || body.result_data !== undefined) {
        await service.updateTask(
          body.task_id,
          {
            resultSummary: body.result_summary,
            resultData: body.result_data,
            version: task.version,
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

  // ── Mount router under /a2a/tasks prefix ───
  app.use("/a2a/tasks", router);

  logger.info("Tasks module registered — 4 A2A endpoints active");
}
