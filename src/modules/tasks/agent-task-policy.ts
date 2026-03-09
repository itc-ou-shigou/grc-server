/**
 * Agent Task Creation Policy Engine
 * Defines per-role limits for autonomous task creation via A2A API.
 */

export interface AgentTaskPolicy {
  canCreateTasks: boolean;
  maxTasksPerDay: number;
  maxTasksPerHour: number;
  allowedCategories: string[];
  canDelegateToRoles: string[];
  requiresApproval: boolean;
  maxExpenseAmount: number | null;
}

export const AGENT_TASK_POLICIES: Record<string, AgentTaskPolicy> = {
  // ── C-Suite ────────────────────────────────────
  ceo: {
    canCreateTasks: true,
    maxTasksPerDay: 10,
    maxTasksPerHour: 5,
    allowedCategories: ["strategic", "operational", "expense"],
    canDelegateToRoles: ["*"],
    requiresApproval: false,
    maxExpenseAmount: null,
  },
  cto: {
    canCreateTasks: true,
    maxTasksPerDay: 8,
    maxTasksPerHour: 4,
    allowedCategories: ["strategic", "operational"],
    canDelegateToRoles: ["engineering", "support", "marketing"],
    requiresApproval: false,
    maxExpenseAmount: 500000,
  },
  cfo: {
    canCreateTasks: true,
    maxTasksPerDay: 6,
    maxTasksPerHour: 3,
    allowedCategories: ["strategic", "operational", "expense"],
    canDelegateToRoles: ["*"],
    requiresApproval: false,
    maxExpenseAmount: null,
  },
  // ── Department Heads ───────────────────────────
  marketing: {
    canCreateTasks: true,
    maxTasksPerDay: 5,
    maxTasksPerHour: 3,
    allowedCategories: ["operational"],
    canDelegateToRoles: ["sales", "support"],
    requiresApproval: false,
    maxExpenseAmount: 100000,
  },
  sales: {
    canCreateTasks: true,
    maxTasksPerDay: 5,
    maxTasksPerHour: 3,
    allowedCategories: ["operational"],
    canDelegateToRoles: ["marketing", "support"],
    requiresApproval: false,
    maxExpenseAmount: 100000,
  },
  engineering: {
    canCreateTasks: true,
    maxTasksPerDay: 5,
    maxTasksPerHour: 3,
    allowedCategories: ["operational"],
    canDelegateToRoles: ["support"],
    requiresApproval: false,
    maxExpenseAmount: 50000,
  },
  hr: {
    canCreateTasks: true,
    maxTasksPerDay: 3,
    maxTasksPerHour: 2,
    allowedCategories: ["operational", "administrative"],
    canDelegateToRoles: [],
    requiresApproval: false,
    maxExpenseAmount: 50000,
  },
  legal: {
    canCreateTasks: true,
    maxTasksPerDay: 3,
    maxTasksPerHour: 2,
    allowedCategories: ["operational"],
    canDelegateToRoles: [],
    requiresApproval: true,
    maxExpenseAmount: 0,
  },
  support: {
    canCreateTasks: true,
    maxTasksPerDay: 3,
    maxTasksPerHour: 2,
    allowedCategories: ["operational"],
    canDelegateToRoles: [],
    requiresApproval: true,
    maxExpenseAmount: 0,
  },
  // ── Default (custom roles) ─────────────────────
  _default: {
    canCreateTasks: true,
    maxTasksPerDay: 2,
    maxTasksPerHour: 1,
    allowedCategories: ["operational"],
    canDelegateToRoles: [],
    requiresApproval: true,
    maxExpenseAmount: 0,
  },
};
