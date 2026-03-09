/**
 * Tasks Service — Business logic for the Tasks module.
 *
 * Handles task CRUD, status transitions (state machine), expense approval,
 * progress logging, and statistics aggregation.
 */

import { v4 as uuidv4 } from "uuid";
import { eq, desc, sql, and, like, gte } from "drizzle-orm";
import pino from "pino";
import { getDb } from "../../shared/db/connection.js";
import {
  tasksTable,
  taskProgressLogTable,
  taskCommentsTable,
} from "./schema.js";
import {
  BadRequestError,
  NotFoundError,
  ConflictError,
} from "../../shared/middleware/error-handler.js";
import {
  AGENT_TASK_POLICIES,
  type AgentTaskPolicy,
} from "./agent-task-policy.js";

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
    deadline?: Date;
    dependsOn?: unknown;
    collaborators?: unknown;
    deliverables?: unknown;
    notes?: string;
    expenseAmount?: string;
    expenseCurrency?: string;
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
      deadline: data.deadline ?? null,
      dependsOn: data.dependsOn ?? null,
      collaborators: data.collaborators ?? null,
      deliverables: data.deliverables ?? null,
      notes: data.notes ?? null,
      expenseAmount: data.expenseAmount ?? null,
      expenseCurrency: data.expenseCurrency ?? null,
      expenseApproved,
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

    return created[0];
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

    const updateSet: Record<string, unknown> = {
      status: newStatus,
      version: task.version + 1,
    };

    // Set completedAt when transitioning to completed
    if (newStatus === "completed") {
      updateSet.completedAt = new Date();
    }

    await db
      .update(tasksTable)
      .set(updateSet as typeof tasksTable.$inferInsert)
      .where(eq(tasksTable.id, id));

    // Log the status transition
    await db.insert(taskProgressLogTable).values({
      taskId: id,
      actor,
      action: "status_change",
      fromStatus: currentStatus,
      toStatus: newStatus,
      details: null,
    });

    logger.info(
      { taskId: id, from: currentStatus, to: newStatus, actor },
      "Task status changed",
    );

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

    // Set to cancelled status and clear expense approval
    await db
      .update(tasksTable)
      .set({
        expenseApproved: 0,
        expenseApprovedBy: null,
        expenseApprovedAt: null,
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

    const updated = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, taskId))
      .limit(1);

    return updated[0];
  }

  /**
   * Get the expense approval queue (tasks with expense_approved = 0).
   */
  async getExpenseQueue(opts: { page: number; limit: number }) {
    const db = getDb();
    const offset = (opts.page - 1) * opts.limit;

    const whereClause = eq(tasksTable.expenseApproved, 0);

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
      avgCompletionDays: avgResult[0]?.avgDays ?? 0,
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
}
