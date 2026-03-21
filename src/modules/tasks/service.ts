/**
 * Tasks Service — Business logic for the Tasks module.
 *
 * Handles task CRUD, status transitions (state machine), expense approval,
 * progress logging, and statistics aggregation.
 */

import { v4 as uuidv4 } from "uuid";
import { eq, desc, sql, and, or, like, gte, isNotNull, isNull, inArray } from "drizzle-orm";
import pino from "pino";
import { getDb } from "../../shared/db/connection.js";
import {
  tasksTable,
  taskProgressLogTable,
  taskCommentsTable,
} from "./schema.js";
import { nodesTable } from "../evolution/schema.js";
import {
  BadRequestError,
  NotFoundError,
  ConflictError,
} from "../../shared/middleware/error-handler.js";
import {
  AGENT_TASK_POLICIES,
  type AgentTaskPolicy,
} from "./agent-task-policy.js";
import {
  nodeConfigSSE,
  type TaskSSEEvent,
} from "../evolution/node-config-sse.js";
import { orchestratorService } from "../orchestrator/service.js";

const logger = pino({ name: "module:tasks:service" });

// ── Valid State Transitions ─────────────────────

const VALID_TRANSITIONS: Record<string, string[]> = {
  draft: ["pending"],
  pending: ["in_progress", "cancelled"],
  in_progress: ["blocked", "review", "completed"],
  blocked: ["in_progress", "cancelled"],
  review: ["approved", "in_progress"],
  approved: ["completed"],
};

// ── Task Code Prefixes ──────────────────────────

const ROLE_PREFIX_MAP: Record<string, string> = {
  marketing: "MKT",
  sales: "SLS",
  engineering: "ENG",
  hr: "HR",
  finance: "FIN",
  operations: "OPS",
  legal: "LGL",
  support: "SUP",
  design: "DSN",
  product: "PRD",
  executive: "EXC",
  admin: "ADM",
};

// ── TasksService ────────────────────────────────

export class TasksService {
  /**
   * Push a task_assigned SSE event to the appropriate node(s).
   * If assignedNodeId is set, push to that specific node.
   * Otherwise, resolve assignedRoleId → all connected nodes with that role.
   */
  private async pushTaskAssignedEvent(
    task: {
      id: string;
      taskCode: string;
      title: string;
      priority: string;
      category: string | null;
      status: string;
      description: string | null;
      deliverables: unknown;
      assignedRoleId: string | null;
      assignedNodeId: string | null;
      creatorNodeId: string | null;
    },
    overrideStatus?: string,
  ): Promise<void> {
    const sseEvent: TaskSSEEvent = {
      event_type: "task_assigned",
      task_id: task.id,
      task_code: task.taskCode,
      title: task.title,
      priority: task.priority,
      category: task.category ?? "operational",
      status: overrideStatus ?? task.status,
      description: task.description ?? undefined,
      deliverables: task.deliverables as string[] | undefined,
      assigned_role_id: task.assignedRoleId ?? undefined,
      creator_node_id: task.creatorNodeId ?? undefined,
    };

    if (task.assignedNodeId) {
      // Direct node assignment — push to that node
      nodeConfigSSE.pushTaskEvent(task.assignedNodeId, sseEvent);
      logger.info(
        { taskId: task.id, nodeId: task.assignedNodeId },
        "SSE task_assigned pushed to assigned node",
      );
    } else if (task.assignedRoleId) {
      // Role-based assignment — find connected nodes with this role and push to all
      const db = getDb();
      const connectedNodeIds = nodeConfigSSE.getConnectedNodeIds();
      if (connectedNodeIds.length === 0) return;

      const nodesWithRole = await db
        .select({ nodeId: nodesTable.nodeId })
        .from(nodesTable)
        .where(
          and(
            eq(nodesTable.roleId, task.assignedRoleId),
            inArray(nodesTable.nodeId, connectedNodeIds),
          ),
        );

      for (const node of nodesWithRole) {
        nodeConfigSSE.pushTaskEvent(node.nodeId, sseEvent);
      }

      if (nodesWithRole.length > 0) {
        logger.info(
          { taskId: task.id, roleId: task.assignedRoleId, nodeCount: nodesWithRole.length },
          "SSE task_assigned pushed to nodes by role",
        );
      }
    }
  }

  /**
   * Get the roleId of a node by its nodeId.
   */
  async getNodeRoleId(nodeId: string): Promise<string | null> {
    const db = getDb();
    const rows = await db
      .select({ roleId: nodesTable.roleId })
      .from(nodesTable)
      .where(eq(nodesTable.nodeId, nodeId))
      .limit(1);
    return rows[0]?.roleId ?? null;
  }

  /**
   * Generate a task code like "MKT-001" based on the assigned role.
   */
  async generateTaskCode(roleId?: string): Promise<string> {
    const db = getDb();
    const prefix = (roleId && ROLE_PREFIX_MAP[roleId.toLowerCase()]) || "TSK";

    // Find the highest existing task code with this prefix
    const rows = await db
      .select({ taskCode: tasksTable.taskCode })
      .from(tasksTable)
      .where(sql`${tasksTable.taskCode} LIKE ${prefix + "-%"}`)
      .orderBy(desc(tasksTable.taskCode))
      .limit(1);

    let nextNum = 1;
    if (rows.length > 0) {
      const lastCode = rows[0].taskCode;
      const numPart = lastCode.split("-")[1];
      if (numPart) {
        nextNum = parseInt(numPart, 10) + 1;
      }
    }

    return `${prefix}-${String(nextNum).padStart(3, "0")}`;
  }

  /**
   * List tasks with pagination and optional filters.
   */
  async listTasks(opts: {
    page: number;
    limit: number;
    status?: string;
    priority?: string;
    assignedRoleId?: string;
    assignedNodeId?: string;
    category?: string;
    assignedBy?: string;
  }) {
    const db = getDb();
    const offset = (opts.page - 1) * opts.limit;

    const conditions = [];
    if (opts.status) conditions.push(eq(tasksTable.status, opts.status as (typeof tasksTable.status.enumValues)[number]));
    if (opts.priority) conditions.push(eq(tasksTable.priority, opts.priority as (typeof tasksTable.priority.enumValues)[number]));
    if (opts.assignedRoleId) conditions.push(eq(tasksTable.assignedRoleId, opts.assignedRoleId));
    if (opts.assignedNodeId) conditions.push(eq(tasksTable.assignedNodeId, opts.assignedNodeId));
    if (opts.category) conditions.push(eq(tasksTable.category, opts.category));
    if (opts.assignedBy) conditions.push(like(tasksTable.assignedBy, `${opts.assignedBy}%`));
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, totalResult] = await Promise.all([
      db
        .select()
        .from(tasksTable)
        .where(whereClause)
        .orderBy(desc(tasksTable.createdAt))
        .limit(opts.limit)
        .offset(offset),
      db
        .select({ count: sql<number>`COUNT(*)` })
        .from(tasksTable)
        .where(whereClause),
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
   * Get a single task with its progress log and comments.
   */
  async getTask(id: string) {
    const db = getDb();

    const rows = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, id))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundError("Task");
    }

    const [progressLog, comments] = await Promise.all([
      db
        .select()
        .from(taskProgressLogTable)
        .where(eq(taskProgressLogTable.taskId, id))
        .orderBy(desc(taskProgressLogTable.createdAt)),
      db
        .select()
        .from(taskCommentsTable)
        .where(eq(taskCommentsTable.taskId, id))
        .orderBy(desc(taskCommentsTable.createdAt)),
    ]);

    return {
      ...rows[0],
      progressLog,
      comments,
    };
  }

  /**
   * Create a new task with auto-generated task code.
   */
  async createTask(data: {
    title: string;
    description?: string;
    category?: string;
    priority?: string;
    status?: string;
    assignedRoleId?: string;
    assignedNodeId?: string;
    assignedBy?: string;
    creatorNodeId?: string;
    deadline?: Date;
    dependsOn?: unknown;
    collaborators?: unknown;
    deliverables?: unknown;
    notes?: string;
    expenseAmount?: string;
    expenseCurrency?: string;
    // Expense details
    vendorName?: string;
    vendorType?: string;
    productService?: string;
    expenseDescription?: string;
    paymentMethod?: string;
    bankName?: string;
    bankBranch?: string;
    bankAccountType?: string;
    bankAccountNumber?: string;
    bankAccountName?: string;
    invoiceNumber?: string;
    invoiceDate?: Date;
    dueDate?: Date;
    businessPurpose?: string;
    expectedRoi?: string;
  }) {
    const db = getDb();
    const id = uuidv4();
    const taskCode = await this.generateTaskCode(data.assignedRoleId);

    // If expense amount is provided, set expenseApproved to 0 (pending)
    const expenseApproved =
      data.expenseAmount != null && data.expenseAmount !== ""
        ? 0
        : null;

    await db.insert(tasksTable).values({
      id,
      taskCode,
      title: data.title,
      description: data.description ?? null,
      category: data.category ?? null,
      priority: (data.priority ?? "medium") as (typeof tasksTable.priority.enumValues)[number],
      status: (data.status ?? "pending") as (typeof tasksTable.status.enumValues)[number],
      assignedRoleId: data.assignedRoleId ?? null,
      assignedNodeId: data.assignedNodeId ?? null,
      assignedBy: data.assignedBy ?? null,
      creatorNodeId: data.creatorNodeId ?? null,
      deadline: data.deadline ?? null,
      dependsOn: data.dependsOn ?? null,
      collaborators: data.collaborators ?? null,
      deliverables: data.deliverables ?? null,
      notes: data.notes ?? null,
      expenseAmount: data.expenseAmount ?? null,
      expenseCurrency: data.expenseCurrency ?? null,
      expenseApproved,
      // Expense details
      vendorName: data.vendorName ?? null,
      vendorType: data.vendorType ?? null,
      productService: data.productService ?? null,
      expenseDescription: data.expenseDescription ?? null,
      paymentMethod: data.paymentMethod ?? null,
      bankName: data.bankName ?? null,
      bankBranch: data.bankBranch ?? null,
      bankAccountType: data.bankAccountType ?? null,
      bankAccountNumber: data.bankAccountNumber ?? null,
      bankAccountName: data.bankAccountName ?? null,
      invoiceNumber: data.invoiceNumber ?? null,
      invoiceDate: data.invoiceDate ?? null,
      dueDate: data.dueDate ?? null,
      businessPurpose: data.businessPurpose ?? null,
      expectedRoi: data.expectedRoi ?? null,
      version: 1,
    });

    // Log creation in progress log
    await db.insert(taskProgressLogTable).values({
      taskId: id,
      actor: data.assignedBy ?? "system",
      action: "created",
      fromStatus: null,
      toStatus: data.status ?? "pending",
      details: null,
    });

    logger.info({ taskId: id, taskCode }, "Task created");

    const created = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, id))
      .limit(1);

    const createdTask = created[0];

    // SSE: Notify assignee(s) when task is created as "pending"
    if (createdTask && (data.status ?? "pending") === "pending") {
      await this.pushTaskAssignedEvent(createdTask);
    }

    return createdTask;
  }

  /**
   * Update a task with optimistic locking (version check).
   */
  async updateTask(
    id: string,
    data: {
      title?: string;
      description?: string;
      category?: string;
      priority?: string;
      assignedRoleId?: string;
      assignedNodeId?: string;
      assignedBy?: string;
      deadline?: Date | null;
      dependsOn?: unknown;
      collaborators?: unknown;
      deliverables?: unknown;
      notes?: string;
      expenseAmount?: string;
      expenseCurrency?: string;
      // Expense details
      vendorName?: string;
      vendorType?: string;
      productService?: string;
      expenseDescription?: string;
      paymentMethod?: string;
      bankName?: string;
      bankBranch?: string;
      bankAccountType?: string;
      bankAccountNumber?: string;
      bankAccountName?: string;
      invoiceNumber?: string;
      invoiceDate?: Date;
      dueDate?: Date;
      businessPurpose?: string;
      expectedRoi?: string;
      resultSummary?: string;
      resultData?: unknown;
      version: number;
    },
    actor: string,
  ) {
    const db = getDb();

    // Fetch current task for version check
    const current = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, id))
      .limit(1);

    if (current.length === 0) {
      throw new NotFoundError("Task");
    }

    if (current[0].version !== data.version) {
      throw new ConflictError(
        `Version conflict: expected ${data.version}, current is ${current[0].version}`,
      );
    }

    const updateSet: Record<string, unknown> = {
      version: current[0].version + 1,
    };

    if (data.title !== undefined) updateSet.title = data.title;
    if (data.description !== undefined) updateSet.description = data.description;
    if (data.category !== undefined) updateSet.category = data.category;
    if (data.priority !== undefined) updateSet.priority = data.priority;
    if (data.assignedRoleId !== undefined) updateSet.assignedRoleId = data.assignedRoleId;
    if (data.assignedNodeId !== undefined) updateSet.assignedNodeId = data.assignedNodeId;
    if (data.assignedBy !== undefined) updateSet.assignedBy = data.assignedBy;
    if (data.deadline !== undefined) updateSet.deadline = data.deadline;
    if (data.dependsOn !== undefined) updateSet.dependsOn = data.dependsOn;
    if (data.collaborators !== undefined) updateSet.collaborators = data.collaborators;
    if (data.deliverables !== undefined) updateSet.deliverables = data.deliverables;
    if (data.notes !== undefined) updateSet.notes = data.notes;
    if (data.expenseAmount !== undefined) updateSet.expenseAmount = data.expenseAmount;
    if (data.expenseCurrency !== undefined) updateSet.expenseCurrency = data.expenseCurrency;
    if (data.resultSummary !== undefined) updateSet.resultSummary = data.resultSummary;
    if (data.resultData !== undefined) updateSet.resultData = data.resultData;
    // Expense details
    if (data.vendorName !== undefined) updateSet.vendorName = data.vendorName;
    if (data.vendorType !== undefined) updateSet.vendorType = data.vendorType;
    if (data.productService !== undefined) updateSet.productService = data.productService;
    if (data.expenseDescription !== undefined) updateSet.expenseDescription = data.expenseDescription;
    if (data.paymentMethod !== undefined) updateSet.paymentMethod = data.paymentMethod;
    if (data.bankName !== undefined) updateSet.bankName = data.bankName;
    if (data.bankBranch !== undefined) updateSet.bankBranch = data.bankBranch;
    if (data.bankAccountType !== undefined) updateSet.bankAccountType = data.bankAccountType;
    if (data.bankAccountNumber !== undefined) updateSet.bankAccountNumber = data.bankAccountNumber;
    if (data.bankAccountName !== undefined) updateSet.bankAccountName = data.bankAccountName;
    if (data.invoiceNumber !== undefined) updateSet.invoiceNumber = data.invoiceNumber;
    if (data.invoiceDate !== undefined) updateSet.invoiceDate = data.invoiceDate;
    if (data.dueDate !== undefined) updateSet.dueDate = data.dueDate;
    if (data.businessPurpose !== undefined) updateSet.businessPurpose = data.businessPurpose;
    if (data.expectedRoi !== undefined) updateSet.expectedRoi = data.expectedRoi;

    await db
      .update(tasksTable)
      .set(updateSet as typeof tasksTable.$inferInsert)
      .where(
        and(
          eq(tasksTable.id, id),
          eq(tasksTable.version, data.version),
        ),
      );

    // Log the update
    await db.insert(taskProgressLogTable).values({
      taskId: id,
      actor,
      action: "updated",
      fromStatus: null,
      toStatus: null,
      details: { fields: Object.keys(updateSet).filter((k) => k !== "version") },
    });

    logger.info({ taskId: id, actor }, "Task updated");

    const updated = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, id))
      .limit(1);

    return updated[0];
  }

  /**
   * Change task status with state machine validation.
   */
  async changeStatus(id: string, newStatus: string, actor: string) {
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
    const currentStatus = task.status;
    const allowed = VALID_TRANSITIONS[currentStatus];

    if (!allowed || !allowed.includes(newStatus)) {
      throw new BadRequestError(
        `Invalid status transition: ${currentStatus} -> ${newStatus}. ` +
          `Allowed transitions from '${currentStatus}': ${(allowed ?? []).join(", ") || "none"}`,
      );
    }

    // Guard: cannot complete a task with an unpaid approved expense
    if (newStatus === "completed" && task.expenseAmount !== null) {
      if (task.expenseApproved === 0) {
        throw new BadRequestError(
          "Cannot complete task: expense is still pending approval",
        );
      }
      if (task.expenseApproved === 2) {
        throw new BadRequestError(
          "Cannot complete task: expense was rejected",
        );
      }
      if (task.expenseApproved === 1 && task.expensePaid !== 1) {
        throw new BadRequestError(
          "Cannot complete task: expense is approved but not yet paid",
        );
      }
    }

    const updateSet: Record<string, unknown> = {
      status: newStatus,
      version: task.version + 1,
    };

    // Set completedAt when transitioning to completed
    if (newStatus === "completed") {
      updateSet.completedAt = new Date();
    }

    // ── Review handoff: reassign to reviewer ─────────────────
    // When a task enters "review", assign it to the reviewer so they can
    // discover it via /a2a/tasks/mine and /a2a/tasks/pending.
    // For self-created tasks (assignee == creator), the reviewer is the CEO.
    // For creator-assigned tasks, the reviewer is the original creator.
    let originalAssigneeNodeId: string | null = null;
    if (newStatus === "review") {
      originalAssigneeNodeId = task.assignedNodeId;
      const assigneeIsCreator =
        task.creatorNodeId && actor === task.creatorNodeId;

      if (assigneeIsCreator) {
        // Self-created task → escalate to CEO
        const ceoNodes = await db
          .select({ nodeId: nodesTable.nodeId })
          .from(nodesTable)
          .where(eq(nodesTable.roleId, "ceo"))
          .limit(1);
        if (ceoNodes.length > 0) {
          updateSet.assignedNodeId = ceoNodes[0].nodeId;
          logger.info(
            { taskId: id, from: originalAssigneeNodeId, to: ceoNodes[0].nodeId },
            "Review handoff: reassigned to CEO",
          );
        }
      } else if (task.creatorNodeId) {
        // Normal task → hand back to creator for review
        updateSet.assignedNodeId = task.creatorNodeId;
        logger.info(
          { taskId: id, from: originalAssigneeNodeId, to: task.creatorNodeId },
          "Review handoff: reassigned to creator",
        );
      }
    }

    // ── Post-review: reassign back to original assignee ──────
    // When approved (review → approved) or sent back (review → in_progress),
    // restore the original assignee so they can continue or close out.
    if (
      (newStatus === "approved" || newStatus === "in_progress") &&
      currentStatus === "review" &&
      task.creatorNodeId &&
      task.assignedNodeId !== actor
    ) {
      // The actor doing the review is now the assignedNodeId; restore to original.
      // We find the original assignee from the progress log.
      const handoffLog = await db
        .select({ details: taskProgressLogTable.details })
        .from(taskProgressLogTable)
        .where(
          and(
            eq(taskProgressLogTable.taskId, id),
            eq(taskProgressLogTable.action, "review_handoff"),
          ),
        )
        .orderBy(desc(taskProgressLogTable.createdAt))
        .limit(1);

      const prevAssignee =
        (handoffLog[0]?.details as any)?.originalAssigneeNodeId ?? null;
      if (prevAssignee) {
        updateSet.assignedNodeId = prevAssignee;
        logger.info(
          { taskId: id, restoredTo: prevAssignee },
          "Post-review: restored original assignee",
        );
      }
    }

    // Orchestrator hook: evaluate multi-agent execution
    if (newStatus === "in_progress" && currentStatus === "pending") {
      try {
        const decision = await orchestratorService.evaluateTask({
          id: task.id,
          title: task.title,
          description: task.description,
          category: task.category,
          priority: task.priority,
          dependsOn: task.dependsOn,
          deliverables: task.deliverables,
          notes: task.notes,
          assignedNodeId: task.assignedNodeId,
        });

        if (decision.useMultiAgent) {
          const sessionId = await orchestratorService.spawnSwarm(
            { id: task.id, title: task.title, description: task.description },
            decision,
          );
          logger.info({ taskId: id, sessionId, template: decision.template }, "Task escalated to multi-agent swarm");
          // Continue with normal status update - task will be in_progress, session tracker handles the rest
        }
      } catch (err) {
        logger.warn({ taskId: id, err }, "Orchestrator evaluation failed, continuing with single-agent");
        // Graceful degradation - continue with normal execution
      }
    }

    const updateResult = await db
      .update(tasksTable)
      .set(updateSet as typeof tasksTable.$inferInsert)
      .where(and(eq(tasksTable.id, id), eq(tasksTable.version, task.version)));

    // Optimistic lock check: if no rows were affected, another process modified the task
    const affectedRows = (updateResult as any)[0]?.affectedRows ?? (updateResult as any).changes ?? 1;
    if (affectedRows === 0) {
      throw new ConflictError(
        `Optimistic lock failed for task ${id}: expected version ${task.version}. Refresh and retry.`,
      );
    }

    // Log the status transition
    await db.insert(taskProgressLogTable).values({
      taskId: id,
      actor,
      action: "status_change",
      fromStatus: currentStatus,
      toStatus: newStatus,
      details: null,
    });

    // Log review handoff for later restoration
    if (newStatus === "review" && originalAssigneeNodeId) {
      await db.insert(taskProgressLogTable).values({
        taskId: id,
        actor,
        action: "review_handoff",
        fromStatus: currentStatus,
        toStatus: newStatus,
        details: {
          originalAssigneeNodeId,
          newAssigneeNodeId: updateSet.assignedNodeId ?? task.assignedNodeId,
        },
      });
    }

    logger.info(
      { taskId: id, from: currentStatus, to: newStatus, actor },
      "Task status changed",
    );

    // ── SSE Notifications ────────────────────────────────────
    // task_assigned: draft → pending triggers notification to the assignee node(s)
    if (newStatus === "pending") {
      await this.pushTaskAssignedEvent(task, newStatus);
    }

    // task_completed: any → review triggers notification to reviewer
    if (newStatus === "review") {
      const sseEvent: TaskSSEEvent = {
        event_type: "task_completed",
        task_id: task.id,
        task_code: task.taskCode,
        title: task.title,
        priority: task.priority,
        category: task.category ?? "operational",
        status: newStatus,
        result_summary: task.resultSummary ?? undefined,
      };

      // Determine reviewer: if creator is also the assignee (self-created task),
      // escalate review to CEO node instead
      const assigneeIsCreator =
        task.creatorNodeId && actor === task.creatorNodeId;

      if (assigneeIsCreator) {
        // Self-created task: find CEO node for review
        const ceoNodes = await db
          .select({ nodeId: nodesTable.nodeId })
          .from(nodesTable)
          .where(eq(nodesTable.roleId, "ceo"));

        if (ceoNodes.length > 0) {
          for (const ceo of ceoNodes) {
            sseEvent.creator_role_id = task.assignedRoleId ?? undefined;
            nodeConfigSSE.pushTaskEvent(ceo.nodeId, sseEvent);
          }
          logger.info(
            { taskId: task.id, taskCode: task.taskCode, ceoCount: ceoNodes.length },
            "Self-created task review escalated to CEO",
          );
        } else {
          logger.warn(
            { taskId: task.id, taskCode: task.taskCode },
            "Self-created task needs review but no CEO node found",
          );
        }
      } else if (task.creatorNodeId) {
        // Normal case: notify the creator
        nodeConfigSSE.pushTaskEvent(task.creatorNodeId, sseEvent);
      }
    }

    // task_feedback: review → in_progress triggers rejection/rework notification to the assignee node(s)
    if (newStatus === "in_progress" && currentStatus === "review") {
      // Fetch the most recent comment for feedback content
      const recentComments = await db
        .select({ content: taskCommentsTable.content })
        .from(taskCommentsTable)
        .where(eq(taskCommentsTable.taskId, id))
        .orderBy(desc(taskCommentsTable.createdAt))
        .limit(1);
      const latestComment = recentComments[0]?.content ?? undefined;

      const feedbackEvent: TaskSSEEvent = {
        event_type: "task_feedback",
        task_id: task.id,
        task_code: task.taskCode,
        title: task.title,
        priority: task.priority,
        category: task.category ?? "operational",
        status: newStatus,
        feedback: latestComment,
      };

      if (task.assignedNodeId) {
        nodeConfigSSE.pushTaskEvent(task.assignedNodeId, feedbackEvent);
      } else if (task.assignedRoleId) {
        // Resolve role → connected nodes
        const connectedNodeIds = nodeConfigSSE.getConnectedNodeIds();
        if (connectedNodeIds.length > 0) {
          const nodesWithRole = await db
            .select({ nodeId: nodesTable.nodeId })
            .from(nodesTable)
            .where(
              and(
                eq(nodesTable.roleId, task.assignedRoleId),
                inArray(nodesTable.nodeId, connectedNodeIds),
              ),
            );
          for (const node of nodesWithRole) {
            nodeConfigSSE.pushTaskEvent(node.nodeId, feedbackEvent);
          }
        }
      }
    }

    // task_approved: review → approved triggers notification to the original executor
    if (newStatus === "approved" && currentStatus === "review") {
      // Find the original assignee from the review handoff log
      const handoffLog = await db
        .select({ details: taskProgressLogTable.details })
        .from(taskProgressLogTable)
        .where(
          and(
            eq(taskProgressLogTable.taskId, id),
            eq(taskProgressLogTable.action, "review_handoff"),
          ),
        )
        .orderBy(desc(taskProgressLogTable.createdAt))
        .limit(1);

      const originalAssignee =
        (handoffLog[0]?.details as any)?.originalAssigneeNodeId ?? null;

      const approvedEvent: TaskSSEEvent = {
        event_type: "task_approved",
        task_id: task.id,
        task_code: task.taskCode,
        title: task.title,
        priority: task.priority,
        category: task.category ?? "operational",
        status: newStatus,
        description: `Task approved by reviewer.`,
      };

      if (originalAssignee) {
        nodeConfigSSE.pushTaskEvent(originalAssignee, approvedEvent);
        logger.info(
          { taskId: task.id, taskCode: task.taskCode, originalAssignee },
          "Task approved — notification sent to original executor",
        );
      } else if (task.assignedRoleId) {
        // Fallback: push to all nodes with the assigned role
        const connectedNodeIds = nodeConfigSSE.getConnectedNodeIds();
        if (connectedNodeIds.length > 0) {
          const nodesWithRole = await db
            .select({ nodeId: nodesTable.nodeId })
            .from(nodesTable)
            .where(
              and(
                eq(nodesTable.roleId, task.assignedRoleId),
                inArray(nodesTable.nodeId, connectedNodeIds),
              ),
            );
          for (const node of nodesWithRole) {
            nodeConfigSSE.pushTaskEvent(node.nodeId, approvedEvent);
          }
        }
      }
    }

    // task_feedback: also update originalAssigneeNodeId in feedback event for review → in_progress
    // (the existing feedback code at line ~664 uses task.assignedNodeId which may now be the reviewer)
    if (newStatus === "in_progress" && currentStatus === "review" && originalAssigneeNodeId === null) {
      // If we reach here from the existing feedback block above, the assignedNodeId was already
      // changed to the reviewer. Look up original assignee from handoff log.
      const handoffLog2 = await db
        .select({ details: taskProgressLogTable.details })
        .from(taskProgressLogTable)
        .where(
          and(
            eq(taskProgressLogTable.taskId, id),
            eq(taskProgressLogTable.action, "review_handoff"),
          ),
        )
        .orderBy(desc(taskProgressLogTable.createdAt))
        .limit(1);
      const origAssignee =
        (handoffLog2[0]?.details as any)?.originalAssigneeNodeId ?? null;
      if (origAssignee) {
        // Re-push feedback to original executor (may have been sent to reviewer above)
        const feedbackEvent2: TaskSSEEvent = {
          event_type: "task_feedback",
          task_id: task.id,
          task_code: task.taskCode,
          title: task.title,
          priority: task.priority,
          category: task.category ?? "operational",
          status: newStatus,
        };
        nodeConfigSSE.pushTaskEvent(origAssignee, feedbackEvent2);
      }
    }

    // ── Auto-dispatch next pending task when a task completes ──
    if (newStatus === "completed" && task.assignedRoleId) {
      const nextPending = await db
        .select()
        .from(tasksTable)
        .where(
          and(
            eq(tasksTable.assignedRoleId, task.assignedRoleId),
            eq(tasksTable.status, "pending"),
          ),
        )
        .orderBy(desc(tasksTable.priority))
        .limit(1);

      if (nextPending.length > 0) {
        const next = nextPending[0];
        logger.info(
          { completedTask: task.taskCode, nextTask: next.taskCode, roleId: task.assignedRoleId },
          "Auto-dispatching next pending task after completion",
        );
        await this.pushTaskAssignedEvent(next);
      }
    }
    // ── Auto-post to community on task completion ─────────────
    if (newStatus === "completed") {
      try {
        const { getCommunityService } = await import("../community/service.js");
        const { communityChannelsTable } = await import("../community/schema.js");

        const communityService = getCommunityService();

        // Find the task-updates channel
        const channelRows = await db
          .select({ id: communityChannelsTable.id })
          .from(communityChannelsTable)
          .where(eq(communityChannelsTable.name, "task-updates"))
          .limit(1);

        if (channelRows.length > 0) {
          const channelId = channelRows[0].id;
          const authorNodeId = task.assignedNodeId ?? actor;

          const bodyLines = [
            `## ${task.taskCode}: ${task.title}`,
            "",
            task.description ? `**説明:** ${task.description}` : "",
            task.resultSummary ? `**結果:** ${task.resultSummary}` : "",
            "",
            `**カテゴリ:** ${task.category ?? "general"} | **優先度:** ${task.priority}`,
            task.assignedRoleId ? `**担当:** ${task.assignedRoleId}` : "",
          ]
            .filter(Boolean)
            .join("\n");

          const autoPost = await communityService.createPost({
            authorNodeId,
            channelId,
            postType: "experience" as import("../../shared/interfaces/community.interface.js").PostType,
            title: `【タスク完了】${task.taskCode}: ${task.title}`,
            contextData: {
              body: bodyLines,
              tags: ["task-completion", task.category ?? "general"],
              auto_generated: true,
              task_id: task.id,
              task_code: task.taskCode,
            },
          });

          // Broadcast to all connected nodes
          nodeConfigSSE.broadcastCommunityEvent({
            event_type: "community_new_post",
            post_id: autoPost.id,
            title: autoPost.title,
            channel: "task-updates",
            author_node_id: authorNodeId,
            post_type: "experience",
            body_preview: bodyLines.slice(0, 200),
            created_at: new Date().toISOString(),
          });

          logger.info(
            { taskId: task.id, postId: autoPost.id },
            "Auto-posted task completion to community",
          );
        }
      } catch (err) {
        logger.warn({ taskId: id, err }, "Failed to auto-post task completion to community");
      }

      // Auto-publish gene to Evolution Pool
      try {
        const { AutoPublishService } = await import("../evolution/auto-publish.js");
        const { EvolutionService } = await import("../evolution/service.js");
        const autoPublish = new AutoPublishService(new EvolutionService());
        await autoPublish.onTaskCompleted({
          id: task.id,
          taskCode: task.taskCode,
          title: task.title,
          category: task.category,
          assignedNodeId: task.assignedNodeId,
          assignedRoleId: task.assignedRoleId,
          deliverables: task.deliverables,
          resultSummary: task.resultSummary,
        });
      } catch (err) {
        logger.warn({ taskId: id, err }, "Auto-publish gene on task completion failed (non-fatal)");
      }

      // Suggest capsule creation to the completing agent via SSE
      try {
        const targetNodeId = task.assignedNodeId ?? actor;
        if (nodeConfigSSE.isNodeConnected(targetNodeId)) {
          nodeConfigSSE.pushTaskEvent(targetNodeId, {
            event_type: "task_completed",
            task_id: task.id,
            task_code: task.taskCode,
            title: task.title,
            priority: task.priority,
            category: task.category ?? "operational",
            status: "completed",
            description: `Task completed! If your solution is reusable, create an Evolution capsule: POST /a2a/publish with asset_type="capsule", asset_id="capsule-${task.assignedRoleId ?? "general"}-${task.taskCode}", and describe your solution in the payload.`,
          });
        }
      } catch { /* fire-and-forget */ }
    }
    // ── End SSE Notifications ─────────────────────────────────

    const updated = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, id))
      .limit(1);

    return updated[0];
  }

  /**
   * Add a comment to a task.
   */
  async addComment(taskId: string, author: string, content: string) {
    const db = getDb();

    // Verify task exists
    const rows = await db
      .select({ id: tasksTable.id })
      .from(tasksTable)
      .where(eq(tasksTable.id, taskId))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundError("Task");
    }

    const id = uuidv4();
    await db.insert(taskCommentsTable).values({
      id,
      taskId,
      author,
      content,
    });

    logger.info({ taskId, commentId: id, author }, "Comment added");

    const created = await db
      .select()
      .from(taskCommentsTable)
      .where(eq(taskCommentsTable.id, id))
      .limit(1);

    return created[0];
  }

  /**
   * Get the progress log for a task.
   */
  async getTaskProgress(taskId: string) {
    const db = getDb();

    const rows = await db
      .select()
      .from(taskProgressLogTable)
      .where(eq(taskProgressLogTable.taskId, taskId))
      .orderBy(desc(taskProgressLogTable.createdAt));

    return rows;
  }

  /**
   * Approve an expense task.
   */
  async approveExpense(taskId: string, approvedBy: string) {
    const db = getDb();

    const rows = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, taskId))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundError("Task");
    }

    const task = rows[0];

    if (task.expenseApproved === null) {
      throw new BadRequestError("This task is not an expense task");
    }

    if (task.expenseApproved === 1) {
      throw new BadRequestError("Expense is already approved");
    }

    await db
      .update(tasksTable)
      .set({
        expenseApproved: 1,
        expenseApprovedBy: approvedBy,
        expenseApprovedAt: new Date(),
        version: task.version + 1,
      })
      .where(eq(tasksTable.id, taskId));

    // Log the approval
    await db.insert(taskProgressLogTable).values({
      taskId,
      actor: approvedBy,
      action: "expense_approved",
      fromStatus: null,
      toStatus: null,
      details: { amount: task.expenseAmount, currency: task.expenseCurrency },
    });

    logger.info({ taskId, approvedBy }, "Expense approved");

    // ── SSE Notification: Notify assignee/creator that expense has been approved ──
    const sseEvent: TaskSSEEvent = {
      event_type: "expense_approved",
      task_id: taskId,
      task_code: task.taskCode,
      title: task.title,
      amount: task.expenseAmount,
      currency: task.expenseCurrency,
      approved_by: approvedBy,
      approved_at: new Date().toISOString(),
      creator_role_id: task.assignedRoleId ?? undefined,
    };

    // Notify the assigned node
    if (task.assignedNodeId) {
      nodeConfigSSE.pushTaskEvent(task.assignedNodeId, sseEvent);
      logger.info({ taskId, nodeId: task.assignedNodeId }, "SSE expense_approved pushed to assigned node");
    } else if (task.assignedRoleId) {
      // Role-based assignment — find connected nodes with this role and push to all
      const connectedNodeIds = nodeConfigSSE.getConnectedNodeIds();
      if (connectedNodeIds.length > 0) {
        const nodesWithRole = await db
          .select({ nodeId: nodesTable.nodeId })
          .from(nodesTable)
          .where(
            and(
              eq(nodesTable.roleId, task.assignedRoleId),
              inArray(nodesTable.nodeId, connectedNodeIds),
            ),
          );
        for (const node of nodesWithRole) {
          nodeConfigSSE.pushTaskEvent(node.nodeId, sseEvent);
        }
        if (nodesWithRole.length > 0) {
          logger.info(
            { taskId, roleId: task.assignedRoleId, nodeCount: nodesWithRole.length },
            "SSE expense_approved pushed to nodes by role",
          );
        }
      }
    }

    // Also notify the creator if different from assignee
    if (task.creatorNodeId && task.creatorNodeId !== task.assignedNodeId) {
      nodeConfigSSE.pushTaskEvent(task.creatorNodeId, sseEvent);
      logger.info({ taskId, creatorNodeId: task.creatorNodeId }, "SSE expense_approved pushed to creator node");
    }

    const updated = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, taskId))
      .limit(1);

    return updated[0];
  }

  /**
   * Reject an expense task.
   */
  async rejectExpense(taskId: string, rejectedBy: string, reason?: string) {
    const db = getDb();

    const rows = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, taskId))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundError("Task");
    }

    const task = rows[0];

    if (task.expenseApproved === null) {
      throw new BadRequestError("This task is not an expense task");
    }

    if (task.expenseApproved === 2) {
      throw new BadRequestError("Expense is already rejected");
    }

    // Set expense_approved = 2 (rejected)
    await db
      .update(tasksTable)
      .set({
        expenseApproved: 2,
        expenseApprovedBy: rejectedBy,
        expenseApprovedAt: new Date(),
        version: task.version + 1,
      })
      .where(eq(tasksTable.id, taskId));

    // Log the rejection
    await db.insert(taskProgressLogTable).values({
      taskId,
      actor: rejectedBy,
      action: "expense_rejected",
      fromStatus: null,
      toStatus: null,
      details: {
        amount: task.expenseAmount,
        currency: task.expenseCurrency,
        reason: reason ?? null,
      },
    });

    logger.info({ taskId, rejectedBy, reason }, "Expense rejected");

    // ── SSE Notification: Notify assignee/creator that expense has been rejected ──
    const sseEvent: TaskSSEEvent = {
      event_type: "expense_rejected",
      task_id: taskId,
      task_code: task.taskCode,
      title: task.title,
      amount: task.expenseAmount,
      currency: task.expenseCurrency,
      rejected_by: rejectedBy,
      rejected_at: new Date().toISOString(),
      reason: reason ?? undefined,
      creator_role_id: task.assignedRoleId ?? undefined,
    };

    // Notify the assigned node
    if (task.assignedNodeId) {
      nodeConfigSSE.pushTaskEvent(task.assignedNodeId, sseEvent);
      logger.info({ taskId, nodeId: task.assignedNodeId }, "SSE expense_rejected pushed to assigned node");
    } else if (task.assignedRoleId) {
      // Role-based assignment — find connected nodes with this role and push to all
      const connectedNodeIds = nodeConfigSSE.getConnectedNodeIds();
      if (connectedNodeIds.length > 0) {
        const nodesWithRole = await db
          .select({ nodeId: nodesTable.nodeId })
          .from(nodesTable)
          .where(
            and(
              eq(nodesTable.roleId, task.assignedRoleId),
              inArray(nodesTable.nodeId, connectedNodeIds),
            ),
          );
        for (const node of nodesWithRole) {
          nodeConfigSSE.pushTaskEvent(node.nodeId, sseEvent);
        }
        if (nodesWithRole.length > 0) {
          logger.info(
            { taskId, roleId: task.assignedRoleId, nodeCount: nodesWithRole.length },
            "SSE expense_rejected pushed to nodes by role",
          );
        }
      }
    }

    // Also notify the creator if different from assignee
    if (task.creatorNodeId && task.creatorNodeId !== task.assignedNodeId) {
      nodeConfigSSE.pushTaskEvent(task.creatorNodeId, sseEvent);
      logger.info({ taskId, creatorNodeId: task.creatorNodeId }, "SSE expense_rejected pushed to creator node");
    }

    const updated = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, taskId))
      .limit(1);

    return updated[0];
  }

  /**
   * Mark an approved expense as paid.
   * Expense must be approved (expenseApproved === 1) before it can be paid.
   */
  async markExpensePaid(taskId: string, paidBy: string) {
    const db = getDb();

    const rows = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, taskId))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundError("Task");
    }

    const task = rows[0];

    if (task.expenseApproved === null) {
      throw new BadRequestError("This task is not an expense task");
    }

    if (task.expenseApproved !== 1) {
      throw new BadRequestError(
        "Expense must be approved before it can be marked as paid",
      );
    }

    if (task.expensePaid === 1) {
      throw new BadRequestError("Expense is already marked as paid");
    }

    await db
      .update(tasksTable)
      .set({
        expensePaid: 1,
        expensePaidBy: paidBy,
        expensePaidAt: new Date(),
        version: task.version + 1,
      })
      .where(eq(tasksTable.id, taskId));

    // Log the payment
    await db.insert(taskProgressLogTable).values({
      taskId,
      actor: paidBy,
      action: "expense_paid",
      fromStatus: null,
      toStatus: null,
      details: { amount: task.expenseAmount, currency: task.expenseCurrency },
    });

    logger.info({ taskId, paidBy }, "Expense marked as paid");

    // ── SSE Notification: Notify assignee/creator that expense has been paid ──
    const sseEvent: TaskSSEEvent = {
      event_type: "expense_paid",
      task_id: taskId,
      task_code: task.taskCode,
      title: task.title,
      amount: task.expenseAmount,
      currency: task.expenseCurrency,
      paid_by: paidBy,
      paid_at: new Date().toISOString(),
      creator_role_id: task.assignedRoleId ?? undefined,
    };

    // Notify the assigned node
    if (task.assignedNodeId) {
      nodeConfigSSE.pushTaskEvent(task.assignedNodeId, sseEvent);
      logger.info({ taskId, nodeId: task.assignedNodeId }, "SSE expense_paid pushed to assigned node");
    } else if (task.assignedRoleId) {
      // Role-based assignment — find connected nodes with this role and push to all
      const connectedNodeIds = nodeConfigSSE.getConnectedNodeIds();
      if (connectedNodeIds.length > 0) {
        const nodesWithRole = await db
          .select({ nodeId: nodesTable.nodeId })
          .from(nodesTable)
          .where(
            and(
              eq(nodesTable.roleId, task.assignedRoleId),
              inArray(nodesTable.nodeId, connectedNodeIds),
            ),
          );
        for (const node of nodesWithRole) {
          nodeConfigSSE.pushTaskEvent(node.nodeId, sseEvent);
        }
        if (nodesWithRole.length > 0) {
          logger.info(
            { taskId, roleId: task.assignedRoleId, nodeCount: nodesWithRole.length },
            "SSE expense_paid pushed to nodes by role",
          );
        }
      }
    }

    // Also notify the creator if different from assignee
    if (task.creatorNodeId && task.creatorNodeId !== task.assignedNodeId) {
      nodeConfigSSE.pushTaskEvent(task.creatorNodeId, sseEvent);
      logger.info({ taskId, creatorNodeId: task.creatorNodeId }, "SSE expense_paid pushed to creator node");
    }

    const updated = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, taskId))
      .limit(1);

    return updated[0];
  }

  /**
   * Get the expense queue — all tasks that have an expense amount set.
   * Includes pending (0), approved (1), rejected (2), and paid items.
   */
  async getExpenseQueue(opts: { page: number; limit: number }) {
    const db = getDb();
    const offset = (opts.page - 1) * opts.limit;

    const whereClause = isNotNull(tasksTable.expenseAmount);

    const [rows, totalResult] = await Promise.all([
      db
        .select()
        .from(tasksTable)
        .where(whereClause)
        .orderBy(desc(tasksTable.createdAt))
        .limit(opts.limit)
        .offset(offset),
      db
        .select({ count: sql<number>`COUNT(*)` })
        .from(tasksTable)
        .where(whereClause),
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
   * Get task statistics: counts by status, priority, and category.
   */
  async getTaskStats() {
    const db = getDb();

    const [byStatus, byPriority, byCategory, totalResult, completedResult, avgResult, pendingExpResult] = await Promise.all([
      db
        .select({
          status: tasksTable.status,
          count: sql<number>`COUNT(*)`,
        })
        .from(tasksTable)
        .groupBy(tasksTable.status),
      db
        .select({
          priority: tasksTable.priority,
          count: sql<number>`COUNT(*)`,
        })
        .from(tasksTable)
        .groupBy(tasksTable.priority),
      db
        .select({
          category: tasksTable.category,
          count: sql<number>`COUNT(*)`,
        })
        .from(tasksTable)
        .groupBy(tasksTable.category),
      db
        .select({ count: sql<number>`COUNT(*)` })
        .from(tasksTable),
      db
        .select({ count: sql<number>`COUNT(*)` })
        .from(tasksTable)
        .where(eq(tasksTable.status, "completed")),
      db
        .select({
          avgDays: sql<number>`AVG(DATEDIFF(completed_at, created_at))`,
        })
        .from(tasksTable)
        .where(eq(tasksTable.status, "completed")),
      db
        .select({ count: sql<number>`COUNT(*)` })
        .from(tasksTable)
        .where(
          sql`${tasksTable.expenseAmount} IS NOT NULL AND ${tasksTable.expenseApproved} IS NULL`,
        ),
    ]);

    const total = totalResult[0]?.count ?? 0;
    const completed = completedResult[0]?.count ?? 0;

    return {
      total,
      completionRate: total > 0 ? completed / total : 0,
      avgCompletionDays: Number(avgResult[0]?.avgDays) || 0,
      pendingExpenses: pendingExpResult[0]?.count ?? 0,
      byStatus: byStatus.reduce(
        (acc, row) => {
          acc[row.status] = row.count;
          return acc;
        },
        {} as Record<string, number>,
      ),
      byPriority: byPriority.reduce(
        (acc, row) => {
          acc[row.priority] = row.count;
          return acc;
        },
        {} as Record<string, number>,
      ),
      byCategory: byCategory.reduce(
        (acc, row) => {
          const key = row.category ?? "uncategorized";
          acc[key] = row.count;
          return acc;
        },
        {} as Record<string, number>,
      ),
    };
  }

  /**
   * Get tasks assigned to a specific node.
   */
  async getTasksForNode(nodeId: string) {
    const db = getDb();

    const rows = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.assignedNodeId, nodeId))
      .orderBy(desc(tasksTable.createdAt));

    return rows;
  }

  /**
   * Get actionable (pending/in_progress/blocked) tasks for a node.
   *
   * Matches on assignedNodeId first; if roleId is also provided, also matches
   * tasks assigned by role only (assignedNodeId IS NULL but assignedRoleId matches).
   */
  async getPendingTasksForNode(nodeId: string, roleId?: string) {
    const db = getDb();

    const activeStatuses = ["pending", "in_progress", "blocked", "review"] as (typeof tasksTable.status.enumValues)[number][];
    const statusCondition = inArray(tasksTable.status, activeStatuses);

    let assignmentCondition;
    if (roleId) {
      assignmentCondition = or(
        eq(tasksTable.assignedNodeId, nodeId),
        and(
          eq(tasksTable.assignedRoleId, roleId),
          isNull(tasksTable.assignedNodeId),
        ),
      );
    } else {
      assignmentCondition = eq(tasksTable.assignedNodeId, nodeId);
    }

    const rows = await db
      .select()
      .from(tasksTable)
      .where(and(assignmentCondition, statusCondition))
      .orderBy(desc(tasksTable.createdAt));

    return rows;
  }

  // ── Agent Autonomous Task Creation ────────────────

  /**
   * Count tasks created by a specific agent today.
   */
  async countAgentTasksToday(roleId: string, nodeId: string): Promise<number> {
    const db = getDb();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const rows = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(tasksTable)
      .where(
        and(
          like(tasksTable.assignedBy, `agent:${roleId}:${nodeId}%`),
          gte(tasksTable.createdAt, today),
        ),
      );

    return rows[0]?.count ?? 0;
  }

  /**
   * Count tasks created by a specific agent in the last hour.
   */
  async countAgentTasksLastHour(roleId: string, nodeId: string): Promise<number> {
    const db = getDb();
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const rows = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(tasksTable)
      .where(
        and(
          like(tasksTable.assignedBy, `agent:${roleId}:${nodeId}%`),
          gte(tasksTable.createdAt, oneHourAgo),
        ),
      );

    return rows[0]?.count ?? 0;
  }

  /**
   * Find duplicate task (same title + assignee within 24h).
   */
  async findDuplicateTask(
    title: string,
    assignedRoleId: string,
  ): Promise<boolean> {
    const db = getDb();
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const rows = await db
      .select({ id: tasksTable.id })
      .from(tasksTable)
      .where(
        and(
          eq(tasksTable.title, title),
          eq(tasksTable.assignedRoleId, assignedRoleId),
          gte(tasksTable.createdAt, oneDayAgo),
        ),
      )
      .limit(1);

    return rows.length > 0;
  }

  /**
   * Create a task autonomously from an agent, enforcing policy limits.
   *
   * Flow:
   * 1. Policy lookup for the creating agent's role
   * 2. Rate limit check (daily + hourly)
   * 3. Category validation
   * 4. Delegation check (can this role create tasks for target role?)
   * 5. Expense limit check
   * 6. Duplicate detection
   * 7. Task creation (with requiresApproval → draft status)
   * 8. Audit log entry
   */
  async createAgentTask(params: {
    creatorRoleId: string;
    creatorNodeId: string;
    title: string;
    description?: string;
    category?: string;
    priority?: string;
    targetRoleId?: string;
    targetNodeId?: string;
    triggerType: string;
    triggerSource?: string;
    expenseAmount?: string;
    expenseCurrency?: string;
    deadline?: string;
    deliverables?: string[];
    notes?: string;
  }) {
    const policy: AgentTaskPolicy =
      AGENT_TASK_POLICIES[params.creatorRoleId] ??
      AGENT_TASK_POLICIES._default;

    // 1. Can create tasks?
    if (!policy.canCreateTasks) {
      throw new BadRequestError(
        `Role '${params.creatorRoleId}' is not allowed to create tasks`,
      );
    }

    // 2. Rate limit: daily
    const todayCount = await this.countAgentTasksToday(
      params.creatorRoleId,
      params.creatorNodeId,
    );
    if (todayCount >= policy.maxTasksPerDay) {
      throw new BadRequestError(
        `Daily task limit reached (${policy.maxTasksPerDay}/day) for role '${params.creatorRoleId}'`,
      );
    }

    // 3. Rate limit: hourly
    const hourCount = await this.countAgentTasksLastHour(
      params.creatorRoleId,
      params.creatorNodeId,
    );
    if (hourCount >= policy.maxTasksPerHour) {
      throw new BadRequestError(
        `Hourly task limit reached (${policy.maxTasksPerHour}/hr) for role '${params.creatorRoleId}'`,
      );
    }

    // 4. Category validation
    const category = params.category ?? "operational";
    if (!policy.allowedCategories.includes(category)) {
      throw new BadRequestError(
        `Role '${params.creatorRoleId}' cannot create '${category}' tasks. Allowed: ${policy.allowedCategories.join(", ")}`,
      );
    }

    // 5. Delegation check
    const targetRole = params.targetRoleId ?? params.creatorRoleId;
    if (targetRole !== params.creatorRoleId) {
      const canDelegate =
        policy.canDelegateToRoles.includes("*") ||
        policy.canDelegateToRoles.includes(targetRole);
      if (!canDelegate) {
        throw new BadRequestError(
          `Role '${params.creatorRoleId}' cannot delegate tasks to '${targetRole}'. Allowed: ${policy.canDelegateToRoles.join(", ") || "none"}`,
        );
      }
    }

    // 6. Expense limit check
    if (params.expenseAmount) {
      const amount = parseFloat(params.expenseAmount);
      if (policy.maxExpenseAmount !== null && amount > policy.maxExpenseAmount) {
        throw new BadRequestError(
          `Expense amount ${amount} exceeds limit ${policy.maxExpenseAmount} for role '${params.creatorRoleId}'`,
        );
      }
    }

    // 7. Duplicate detection
    const isDuplicate = await this.findDuplicateTask(
      params.title,
      targetRole,
    );
    if (isDuplicate) {
      throw new BadRequestError(
        `Duplicate task detected: a task with title '${params.title}' was already created for role '${targetRole}' within the last 24h`,
      );
    }

    // 8. Create the task
    const assignedBy = `agent:${params.creatorRoleId}:${params.creatorNodeId}`;
    const status = policy.requiresApproval ? "draft" : "pending";

    const task = await this.createTask({
      title: params.title,
      description: params.description,
      category,
      priority: params.priority ?? "medium",
      status,
      assignedRoleId: targetRole,
      assignedNodeId: params.targetNodeId,
      assignedBy,
      creatorNodeId: params.creatorNodeId,
      deadline: params.deadline ? new Date(params.deadline) : undefined,
      deliverables: params.deliverables,
      notes: params.notes
        ? `[trigger:${params.triggerType}] ${params.notes}`
        : `[trigger:${params.triggerType}]${params.triggerSource ? ` source:${params.triggerSource}` : ""}`,
      expenseAmount: params.expenseAmount,
      expenseCurrency: params.expenseCurrency,
    });

    logger.info(
      {
        taskId: task.id,
        taskCode: task.taskCode,
        creatorRole: params.creatorRoleId,
        creatorNode: params.creatorNodeId,
        targetRole,
        triggerType: params.triggerType,
        requiresApproval: policy.requiresApproval,
      },
      "Agent task created autonomously",
    );

    return {
      task,
      policy_applied: {
        requires_approval: policy.requiresApproval,
        daily_remaining: policy.maxTasksPerDay - todayCount - 1,
        hourly_remaining: policy.maxTasksPerHour - hourCount - 1,
      },
    };
  }

  /**
   * Batch create multiple tasks at once.
   * Rate limit checks the total batch size upfront.
   * Individual tasks may fail (duplicate detection, etc.) — partial success is allowed.
   */
  async createAgentTaskBatch(params: {
    creatorRoleId: string;
    creatorNodeId: string;
    triggerType: string;
    triggerSource?: string;
    tasks: Array<{
      title: string;
      description?: string;
      category?: string;
      priority?: string;
      targetRoleId?: string;
      targetNodeId?: string;
      expenseAmount?: string;
      expenseCurrency?: string;
      deadline?: string;
      deliverables?: string[];
      notes?: string;
    }>;
  }) {
    const policy: AgentTaskPolicy =
      AGENT_TASK_POLICIES[params.creatorRoleId] ??
      AGENT_TASK_POLICIES._default;

    if (!policy.canCreateTasks) {
      throw new BadRequestError(
        `Role '${params.creatorRoleId}' is not allowed to create tasks`,
      );
    }

    // Upfront rate limit check for entire batch
    const hourCount = await this.countAgentTasksLastHour(
      params.creatorRoleId,
      params.creatorNodeId,
    );
    if (hourCount + params.tasks.length > policy.maxTasksPerHour) {
      throw new BadRequestError(
        `Batch of ${params.tasks.length} tasks would exceed hourly limit ` +
        `(${hourCount}/${policy.maxTasksPerHour} used). Reduce batch size or wait.`,
      );
    }

    const todayCount = await this.countAgentTasksToday(
      params.creatorRoleId,
      params.creatorNodeId,
    );
    if (todayCount + params.tasks.length > policy.maxTasksPerDay) {
      throw new BadRequestError(
        `Batch of ${params.tasks.length} tasks would exceed daily limit ` +
        `(${todayCount}/${policy.maxTasksPerDay} used).`,
      );
    }

    // Create tasks individually (allow partial success)
    const results: Array<{
      index: number;
      ok: boolean;
      task?: Record<string, unknown>;
      error?: string;
    }> = [];

    for (const [index, taskDef] of params.tasks.entries()) {
      try {
        const { task } = await this.createAgentTask({
          creatorRoleId: params.creatorRoleId,
          creatorNodeId: params.creatorNodeId,
          triggerType: params.triggerType,
          triggerSource: params.triggerSource,
          title: taskDef.title,
          description: taskDef.description,
          category: taskDef.category,
          priority: taskDef.priority,
          targetRoleId: taskDef.targetRoleId,
          targetNodeId: taskDef.targetNodeId,
          expenseAmount: taskDef.expenseAmount,
          expenseCurrency: taskDef.expenseCurrency,
          deadline: taskDef.deadline,
          deliverables: taskDef.deliverables,
          notes: taskDef.notes,
        });
        results.push({ index, ok: true, task: task as unknown as Record<string, unknown> });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({ index, ok: false, error: message });
      }
    }

    const created = results.filter((r) => r.ok).length;

    return {
      results,
      summary: {
        total: params.tasks.length,
        created,
        failed: params.tasks.length - created,
      },
      policy_applied: {
        daily_remaining: policy.maxTasksPerDay - todayCount - created,
        hourly_remaining: policy.maxTasksPerHour - hourCount - created,
      },
    };
  }

  /**
   * Send a nudge/reminder for a pending task.
   * Notifies the assignee via SSE + relay queue.
   * If escalation_level is "escalate", also notifies CEO.
   */
  async nudgeTask(params: {
    taskCode: string;
    nudgerNodeId: string;
    nudgerRoleId: string;
    message?: string;
    escalationLevel: "gentle" | "urgent" | "escalate";
  }): Promise<{
    nudged: boolean;
    escalation_level: string;
    task_code: string;
    notified_nodes: string[];
  }> {
    // Find the task by taskCode
    const db = getDb();
    const rows = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.taskCode, params.taskCode))
      .limit(1);

    if (rows.length === 0) {
      throw new BadRequestError(`Task with code '${params.taskCode}' not found`);
    }
    const task = rows[0];

    // Cannot nudge completed/cancelled tasks
    const terminalStatuses = ["completed", "approved", "cancelled"];
    if (terminalStatuses.includes(task.status)) {
      throw new BadRequestError(
        `Cannot nudge a task with status '${task.status}'`,
      );
    }

    const notifiedNodes: string[] = [];

    // Notify assignee via SSE
    const targetNodeId = task.assignedNodeId ?? task.creatorNodeId;
    if (targetNodeId) {
      const nudgeContent =
        `[NUDGE:${params.escalationLevel}] ${params.message || "Please prioritize this task."}`;

      // Push task event via SSE
      const pushed = nodeConfigSSE.pushTaskEvent(targetNodeId, {
        event_type: "task_feedback",
        task_id: task.id,
        task_code: task.taskCode,
        title: task.title,
        priority: params.escalationLevel === "escalate" ? "critical" : task.priority,
        category: task.category ?? "operational",
        status: task.status,
        feedback: nudgeContent,
        creator_node_id: params.nudgerNodeId,
        creator_role_id: params.nudgerRoleId,
      });

      if (pushed) {
        notifiedNodes.push(targetNodeId);
      }

      // Also send via relay queue for guaranteed delivery
      const { a2aRelayQueueTable } = await import("../relay/schema.js");

      const msgId = uuidv4();
      await db.insert(a2aRelayQueueTable).values({
        id: msgId,
        fromNodeId: params.nudgerNodeId,
        toNodeId: targetNodeId,
        messageType: "directive",
        subject: `Task nudge: ${task.title} (${task.taskCode})`,
        payload: {
          action: "task_nudge",
          task_code: task.taskCode,
          task_id: task.id,
          escalation_level: params.escalationLevel,
          message: params.message,
          nudged_by_role: params.nudgerRoleId,
          nudged_by_node: params.nudgerNodeId,
        },
        priority: params.escalationLevel === "escalate" ? "critical" : "high",
        status: pushed ? "delivered" : "queued",
        deliveredAt: pushed ? new Date() : null,
        expiresAt: null,
      });
    }

    // If escalation level is "escalate", notify CEO nodes
    if (params.escalationLevel === "escalate") {
      try {
        const { getNodesByRoles } = await import("../evolution/role-resolver.js");
        const ceoNodes = await getNodesByRoles(["ceo"]);

        for (const ceo of ceoNodes) {
          nodeConfigSSE.pushTaskEvent(ceo.nodeId, {
            event_type: "task_feedback",
            task_id: task.id,
            task_code: task.taskCode,
            title: `[ESCALATION] ${task.title}`,
            priority: "critical",
            category: task.category ?? "operational",
            status: task.status,
            feedback: `Escalated by ${params.nudgerRoleId}: ${params.message || "Requires attention"}`,
            creator_node_id: params.nudgerNodeId,
            creator_role_id: params.nudgerRoleId,
          });
          notifiedNodes.push(ceo.nodeId);
        }
      } catch {
        // role-resolver might not find CEO nodes — non-fatal
        logger.warn("Could not find CEO nodes for escalation notification");
      }
    }

    logger.info(
      {
        taskCode: params.taskCode,
        escalationLevel: params.escalationLevel,
        nudger: params.nudgerRoleId,
        notifiedCount: notifiedNodes.length,
      },
      "Task nudged",
    );

    return {
      nudged: true,
      escalation_level: params.escalationLevel,
      task_code: params.taskCode,
      notified_nodes: notifiedNodes,
    };
  }

  /**
   * Re-send SSE task_assigned events for all pending tasks.
   * Useful after server restart or when SSE events were missed.
   * Also auto-approves draft tasks (draft → pending) so they can be picked up.
   */
  async resendPendingTaskEvents(): Promise<{
    approved: number;
    notified: number;
    tasks: string[];
  }> {
    const db = getDb();

    // 1. Auto-approve draft tasks → pending
    const draftTasks = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.status, "draft"));

    let approved = 0;
    for (const task of draftTasks) {
      await this.changeStatus(task.id, "pending", "system:auto-approve");
      approved++;
    }

    // 2. Get all pending tasks and re-send SSE events
    const pendingTasks = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.status, "pending"));

    let notified = 0;
    const taskCodes: string[] = [];

    for (const task of pendingTasks) {
      await this.pushTaskAssignedEvent(task);
      notified++;
      taskCodes.push(task.taskCode);
    }

    logger.info(
      { approved, notified, taskCodes },
      "Resent SSE task_assigned events for pending tasks",
    );

    return { approved, notified, tasks: taskCodes };
  }
}
