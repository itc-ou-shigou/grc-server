import {
  mysqlTable,
  mysqlEnum,
  char,
  varchar,
  int,
  json,
  timestamp,
  text,
  index,
} from "drizzle-orm/mysql-core";

export const orchestrationSessionsTable = mysqlTable(
  "orchestration_sessions",
  {
    id: char("id", { length: 36 }).primaryKey().notNull(),
    taskId: char("task_id", { length: 36 }).notNull(),
    teamName: varchar("team_name", { length: 100 }).notNull(),
    template: varchar("template", { length: 50 }),
    status: mysqlEnum("status", [
      "queued", "spawning", "running", "collecting",
      "completed", "failed", "aborted",
    ]).notNull().default("queued"),
    executionMode: varchar("execution_mode", { length: 20 }).notNull().default("auto"),
    agentCount: int("agent_count").default(0),
    agentsJson: json("agents_json"),
    complexityScore: int("complexity_score"),
    modelTier: varchar("model_tier", { length: 10 }),
    leaderNodeId: varchar("leader_node_id", { length: 255 }),
    resultJson: json("result_json"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  (table) => ({
    idxTaskId: index("idx_orch_task_id").on(table.taskId),
    idxStatus: index("idx_orch_status").on(table.status),
  }),
);
