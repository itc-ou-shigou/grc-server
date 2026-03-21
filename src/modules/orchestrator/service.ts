import { v4 as uuidv4 } from "uuid";
import { eq, and, inArray, sql } from "drizzle-orm";
import pino from "pino";
import { getDb } from "../../shared/db/connection.js";
import { orchestrationSessionsTable } from "./schema.js";
import { tasksTable } from "../tasks/schema.js";
import { computeComplexityScore, shouldForceMode } from "./complexity-scorer.js";
import { evaluateModelGate, type ModelGateResult } from "./model-gate.js";
import { selectTemplate } from "./template-mapper.js";
import { clawTeamBridge } from "./clawteam-bridge.js";
import { sessionTracker } from "./session-tracker.js";
import { nodeConfigSSE } from "../evolution/node-config-sse.js";
import {
  BadRequestError,
  NotFoundError,
} from "../../shared/middleware/error-handler.js";

const logger = pino({ name: "module:orchestrator:service" });

const COMPLEXITY_THRESHOLD = parseInt(
  process.env.GRC_SWARM_COMPLEXITY_THRESHOLD ?? "60",
  10,
);
const MAX_SESSIONS = parseInt(process.env.GRC_SWARM_MAX_SESSIONS ?? "3", 10);
const MAX_AGENTS = parseInt(process.env.GRC_SWARM_MAX_AGENTS ?? "15", 10);
const CLAWTEAM_ENABLED = process.env.GRC_CLAWTEAM_ENABLED === "true";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface OrchestrationDecision {
  useMultiAgent: boolean;
  reason: string;
  complexityScore?: number;
  modelGate?: ModelGateResult;
  template?: string;
  agentCount?: number;
}

/** Minimal task shape required for orchestration evaluation. */
export interface OrchestratorTaskInput {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  priority: string;
  dependsOn: unknown;
  deliverables: unknown;
  notes: string | null;
  assignedNodeId: string | null;
  executionMode?: string;
}

/** Minimal task shape required for swarm spawning. */
export interface OrchestratorSpawnInput {
  id: string;
  title: string;
  description: string | null;
}

// Drizzle inferred session type
type SessionRow = typeof orchestrationSessionsTable.$inferSelect;

// Valid session status values (mirrors the schema enum)
type SessionStatus =
  | "queued"
  | "spawning"
  | "running"
  | "collecting"
  | "completed"
  | "failed"
  | "aborted";

// ---------------------------------------------------------------------------
// OrchestratorService
// ---------------------------------------------------------------------------

export class OrchestratorService {

  // -------------------------------------------------------------------------
  // Decision gating
  // -------------------------------------------------------------------------

  /**
   * Evaluates whether a task should be executed in multi-agent mode.
   * Checks are applied in priority order; the first failing check produces
   * an immediate `useMultiAgent: false` decision.
   */
  async evaluateTask(task: OrchestratorTaskInput): Promise<OrchestrationDecision> {
    // 0. Master switch
    if (!CLAWTEAM_ENABLED) {
      return { useMultiAgent: false, reason: "ClawTeam integration disabled" };
    }

    // 0b. ClawTeam availability
    const available = await clawTeamBridge.isAvailable();
    if (!available) {
      return { useMultiAgent: false, reason: "ClawTeam CLI not available" };
    }

    // 1. User override via executionMode field or notes annotation
    const executionMode = task.executionMode ?? "auto";
    const forcedMode =
      executionMode !== "auto" ? executionMode : shouldForceMode(task.notes);

    if (forcedMode === "single") {
      return { useMultiAgent: false, reason: "User forced single-agent mode" };
    }

    // 2. Node failure check
    if (task.assignedNodeId && sessionTracker.isNodeDisabled(task.assignedNodeId)) {
      return {
        useMultiAgent: false,
        reason: "Node temporarily disabled due to repeated failures",
      };
    }

    // 3. Concurrency limits
    const activeSessions = sessionTracker.getActiveSessionCount();
    if (activeSessions >= MAX_SESSIONS) {
      return {
        useMultiAgent: false,
        reason: `Max concurrent sessions reached (${activeSessions}/${MAX_SESSIONS})`,
      };
    }

    // 4. Model quality gate
    const onlineNodeIds = nodeConfigSSE.getConnectedNodeIds();
    const modelGate = await evaluateModelGate(
      task.assignedNodeId,
      onlineNodeIds,
    );

    if (!modelGate.passed && forcedMode !== "multi") {
      return {
        useMultiAgent: false,
        reason: modelGate.reason ?? "Model gate failed",
        modelGate,
      };
    }

    // 5. Complexity score (bypassed when user forced multi-agent)
    const score = computeComplexityScore(task);

    if (score.total < COMPLEXITY_THRESHOLD && forcedMode !== "multi") {
      return {
        useMultiAgent: false,
        reason: `Complexity score ${score.total} < threshold ${COMPLEXITY_THRESHOLD}`,
        complexityScore: score.total,
        modelGate,
      };
    }

    // 6. Total concurrent agent ceiling
    const templateSelection = selectTemplate(task);
    const currentAgentCount = await this.getActiveAgentCount();
    if (currentAgentCount + templateSelection.agentCount > MAX_AGENTS) {
      return {
        useMultiAgent: false,
        reason: `Total agent limit would be exceeded (${currentAgentCount} + ${templateSelection.agentCount} > ${MAX_AGENTS})`,
        complexityScore: score.total,
      };
    }

    logger.info(
      {
        taskId: task.id,
        complexityScore: score.total,
        template: templateSelection.template,
        agents: templateSelection.agentCount,
        leaderTier: modelGate.leaderTier,
      },
      "Multi-agent execution approved",
    );

    return {
      useMultiAgent: true,
      reason: `Complexity ${score.total} >= ${COMPLEXITY_THRESHOLD}, model gate passed`,
      complexityScore: score.total,
      modelGate,
      template: templateSelection.template,
      agentCount: templateSelection.agentCount,
    };
  }

  // -------------------------------------------------------------------------
  // Swarm spawning
  // -------------------------------------------------------------------------

  /**
   * Creates a session record and launches a ClawTeam swarm for the task.
   * Throws on spawn failure so the caller can fall back to single-agent mode.
   *
   * @returns The new session ID.
   */
  async spawnSwarm(
    task: OrchestratorSpawnInput,
    decision: OrchestrationDecision,
  ): Promise<string> {
    const db = getDb();
    const sessionId = uuidv4();
    const teamName = `grc-${task.id.substring(0, 8)}`;
    const template = decision.template ?? "strategy-room";

    logger.info(
      { sessionId, taskId: task.id, teamName, template },
      "Creating orchestration session",
    );

    await db.insert(orchestrationSessionsTable).values({
      id: sessionId,
      taskId: task.id,
      teamName,
      template,
      status: "spawning",
      executionMode: "multi",
      complexityScore: decision.complexityScore ?? null,
      modelTier: decision.modelGate?.leaderTier ?? null,
      leaderNodeId: decision.modelGate?.leaderNodeId ?? null,
      startedAt: new Date(),
    });

    const goal = `${task.title}\n\n${task.description ?? ""}`.trim();

    const result = await clawTeamBridge.spawnTeam({
      teamName,
      template,
      goal,
      // agentCommand is intentionally omitted here — the bridge selects the
      // platform-appropriate binary (winclaw/openclaw) automatically.
    });

    if (!result.success) {
      logger.error(
        { sessionId, teamName, error: result.error },
        "Swarm spawn failed — recording failure and updating session",
      );

      await db
        .update(orchestrationSessionsTable)
        .set({
          status: "failed",
          errorMessage: result.error ?? "Unknown spawn error",
          completedAt: new Date(),
        })
        .where(eq(orchestrationSessionsTable.id, sessionId));

      if (decision.modelGate?.leaderNodeId) {
        sessionTracker.recordFailure(decision.modelGate.leaderNodeId);
      }

      throw new Error(`Swarm spawn failed: ${result.error}`);
    }

    await db
      .update(orchestrationSessionsTable)
      .set({ status: "running" })
      .where(eq(orchestrationSessionsTable.id, sessionId));

    await sessionTracker.startTracking(sessionId);

    logger.info(
      { sessionId, teamName, template },
      "Swarm spawned and tracking started",
    );

    return sessionId;
  }

  // -------------------------------------------------------------------------
  // Session queries
  // -------------------------------------------------------------------------

  /** Returns a session by ID, throwing NotFoundError if absent. */
  async getSession(sessionId: string): Promise<SessionRow> {
    const db = getDb();
    const rows = await db
      .select()
      .from(orchestrationSessionsTable)
      .where(eq(orchestrationSessionsTable.id, sessionId))
      .limit(1);

    if (rows.length === 0) throw new NotFoundError("Orchestration session");
    return rows[0];
  }

  /**
   * Returns up to 50 sessions, optionally filtered by taskId and/or status.
   * Unknown status values are silently ignored rather than causing a type error
   * at the call site (query params are always `string | undefined`).
   */
  async listSessions(
    taskId?: string,
    status?: string,
  ): Promise<SessionRow[]> {
    const db = getDb();
    const conditions = [];

    if (taskId) {
      conditions.push(eq(orchestrationSessionsTable.taskId, taskId));
    }

    const VALID_STATUSES: ReadonlyArray<SessionStatus> = [
      "queued", "spawning", "running", "collecting",
      "completed", "failed", "aborted",
    ];
    const typedStatus = VALID_STATUSES.includes(status as SessionStatus)
      ? (status as SessionStatus)
      : undefined;

    if (typedStatus) {
      conditions.push(eq(orchestrationSessionsTable.status, typedStatus));
    }

    return db
      .select()
      .from(orchestrationSessionsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(sql`created_at DESC`)
      .limit(50);
  }

  // -------------------------------------------------------------------------
  // Session control
  // -------------------------------------------------------------------------

  /** Delegates to SessionTracker to abort a running session. */
  async abortSession(sessionId: string): Promise<void> {
    await sessionTracker.abortSession(sessionId);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /** Returns the total number of agents currently active across all sessions. */
  private async getActiveAgentCount(): Promise<number> {
    const db = getDb();
    const rows = await db
      .select({ agentCount: orchestrationSessionsTable.agentCount })
      .from(orchestrationSessionsTable)
      .where(
        inArray(orchestrationSessionsTable.status, [
          "spawning",
          "running",
          "collecting",
        ]),
      );
    return rows.reduce((sum, r) => sum + (r.agentCount ?? 0), 0);
  }
}

export const orchestratorService = new OrchestratorService();
