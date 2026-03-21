import pino from "pino";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../../shared/db/connection.js";
import { orchestrationSessionsTable } from "./schema.js";
import { clawTeamBridge } from "./clawteam-bridge.js";
import { tasksTable } from "../tasks/schema.js";

const logger = pino({ name: "module:orchestrator:session-tracker" });

const POLL_INTERVAL_MS = parseInt(
  process.env.GRC_SWARM_POLL_INTERVAL_MS ?? "15000",
  10,
);
const DEFAULT_TIMEOUT_MIN = parseInt(
  process.env.GRC_SWARM_DEFAULT_TIMEOUT_MIN ?? "45",
  10,
);

const TEMPLATE_TIMEOUTS: Record<string, number> = {
  "code-review": 30,
  "strategy-room": 45,
  "research-paper": 60,
  "hedge-fund": 45,
  dynamic: 60,
};

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

type SessionRow = typeof orchestrationSessionsTable.$inferSelect;

/** Snapshot of live session progress used internally during polls. */
interface SessionProgress {
  sessionId: string;
  teamName: string;
  totalTasks: number;
  completedTasks: number;
  progressPct: number;
  agents: Array<{ name: string; status: string; task?: string }>;
}

// ---------------------------------------------------------------------------
// SessionTracker
// ---------------------------------------------------------------------------

/**
 * Manages per-session polling intervals and result collection.
 * All intervals are properly cleared on abort, timeout, completion, and
 * shutdown so that no background work leaks after a session ends.
 */
export class SessionTracker {
  /** Active setInterval handles, keyed by sessionId. */
  private readonly pollingIntervals = new Map<
    string,
    ReturnType<typeof setInterval>
  >();

  /**
   * Guards against overlapping poll invocations for the same session when a
   * poll takes longer than the poll interval.
   */
  private readonly pollingInFlight = new Set<string>();

  /**
   * Tracks consecutive failures per nodeId. Keys are automatically removed
   * after the auto-reset period so the map stays small.
   */
  private readonly failureCounters = new Map<string, number>();

  /**
   * Stores the setTimeout handles for failure-counter auto-reset so they can
   * be cancelled on shutdown.
   */
  private readonly failureResetTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Starts polling a session. No-ops if the session is already tracked. */
  async startTracking(sessionId: string): Promise<void> {
    if (this.pollingIntervals.has(sessionId)) {
      logger.warn({ sessionId }, "Already tracking session — ignoring duplicate startTracking call");
      return;
    }

    logger.info(
      { sessionId, intervalMs: POLL_INTERVAL_MS },
      "Starting session tracking",
    );

    const interval = setInterval(async () => {
      if (this.pollingInFlight.has(sessionId)) {
        logger.debug({ sessionId }, "Skipping poll — previous still in flight");
        return;
      }

      this.pollingInFlight.add(sessionId);
      try {
        await this.pollSession(sessionId);
      } catch (err) {
        logger.error({ sessionId, err }, "Unhandled error in poll cycle");
      } finally {
        this.pollingInFlight.delete(sessionId);
      }
    }, POLL_INTERVAL_MS);

    this.pollingIntervals.set(sessionId, interval);
  }

  /** Stops polling a session and clears all associated state. */
  stopTracking(sessionId: string): void {
    const interval = this.pollingIntervals.get(sessionId);
    if (interval) {
      clearInterval(interval);
      this.pollingIntervals.delete(sessionId);
      this.pollingInFlight.delete(sessionId);
      logger.info({ sessionId }, "Stopped tracking session");
    }
  }

  /**
   * Stops all active polling intervals and cancels all pending timers.
   * Call this on application shutdown to avoid dangling async work.
   */
  shutdown(): void {
    logger.info(
      { activeSessions: this.pollingIntervals.size },
      "SessionTracker shutting down",
    );
    for (const [sessionId, interval] of this.pollingIntervals) {
      clearInterval(interval);
      logger.debug({ sessionId }, "Cleared polling interval on shutdown");
    }
    this.pollingIntervals.clear();
    this.pollingInFlight.clear();

    for (const [nodeId, timer] of this.failureResetTimers) {
      clearTimeout(timer);
      logger.debug({ nodeId }, "Cleared failure-reset timer on shutdown");
    }
    this.failureResetTimers.clear();
  }

  // -------------------------------------------------------------------------
  // Session operations
  // -------------------------------------------------------------------------

  /** Aborts a running session: kills the team, writes DB state, stops polling. */
  async abortSession(sessionId: string): Promise<void> {
    const db = getDb();

    const rows = await db
      .select()
      .from(orchestrationSessionsTable)
      .where(eq(orchestrationSessionsTable.id, sessionId))
      .limit(1);

    if (rows.length === 0) {
      logger.warn({ sessionId }, "abortSession called for unknown session");
      return;
    }

    const session = rows[0];

    logger.info(
      { sessionId, teamName: session.teamName },
      "Aborting session",
    );

    // Kill process and clean up team resources
    await clawTeamBridge.abortTeam(session.teamName);

    await db
      .update(orchestrationSessionsTable)
      .set({
        status: "aborted",
        errorMessage: "Manually aborted",
        completedAt: new Date(),
      })
      .where(eq(orchestrationSessionsTable.id, sessionId));

    this.stopTracking(sessionId);
    logger.info({ sessionId, teamName: session.teamName }, "Session aborted");
  }

  // -------------------------------------------------------------------------
  // Failure tracking
  // -------------------------------------------------------------------------

  /**
   * Records a spawn/execution failure for a node.
   * Returns true when the failure threshold (3) is reached and the node
   * should be considered temporarily disabled.
   */
  recordFailure(nodeId: string): boolean {
    const count = (this.failureCounters.get(nodeId) ?? 0) + 1;
    this.failureCounters.set(nodeId, count);

    if (count >= 3) {
      logger.warn(
        { nodeId, failureCount: count },
        "Node disabled for multi-agent due to repeated failures (auto-reset in 1h)",
      );

      // Cancel any existing reset timer before scheduling a new one
      const existingTimer = this.failureResetTimers.get(nodeId);
      if (existingTimer) clearTimeout(existingTimer);

      const resetTimer = setTimeout(() => {
        this.failureCounters.delete(nodeId);
        this.failureResetTimers.delete(nodeId);
        logger.info({ nodeId }, "Node failure counter auto-reset after 1h");
      }, 60 * 60 * 1000);

      this.failureResetTimers.set(nodeId, resetTimer);
      return true;
    }

    return false;
  }

  /** Returns true if a node has reached the failure threshold. */
  isNodeDisabled(nodeId: string): boolean {
    return (this.failureCounters.get(nodeId) ?? 0) >= 3;
  }

  // -------------------------------------------------------------------------
  // Metrics
  // -------------------------------------------------------------------------

  /** Returns the number of sessions currently being polled. */
  getActiveSessionCount(): number {
    return this.pollingIntervals.size;
  }

  // -------------------------------------------------------------------------
  // Private — poll cycle
  // -------------------------------------------------------------------------

  private async pollSession(sessionId: string): Promise<void> {
    const db = getDb();

    const rows = await db
      .select()
      .from(orchestrationSessionsTable)
      .where(eq(orchestrationSessionsTable.id, sessionId))
      .limit(1);

    if (rows.length === 0) {
      logger.warn({ sessionId }, "Session row not found during poll — stopping tracker");
      this.stopTracking(sessionId);
      return;
    }

    const session = rows[0];

    // Terminal states: stop polling immediately
    if (["completed", "failed", "aborted"].includes(session.status)) {
      logger.debug(
        { sessionId, status: session.status },
        "Session in terminal state — stopping tracker",
      );
      this.stopTracking(sessionId);
      return;
    }

    // Timeout check
    const timeoutMin =
      TEMPLATE_TIMEOUTS[session.template ?? ""] ?? DEFAULT_TIMEOUT_MIN;
    if (session.startedAt) {
      const elapsedMs =
        Date.now() - new Date(session.startedAt).getTime();
      if (elapsedMs > timeoutMin * 60 * 1000) {
        logger.warn(
          {
            sessionId,
            teamName: session.teamName,
            timeoutMin,
            elapsedMs: Math.round(elapsedMs / 1000),
          },
          "Session timed out",
        );
        await this.handleTimeout(session);
        return;
      }
    }

    // Fetch ClawTeam progress
    const tasks = await clawTeamBridge.getTaskList(session.teamName);

    if (tasks.length === 0 && session.status === "running") {
      // ClawTeam may not be fully initialised yet — wait for next poll
      logger.debug(
        { sessionId, teamName: session.teamName },
        "No tasks yet — ClawTeam may still be initialising",
      );
      return;
    }

    const completed = tasks.filter((t) => t.status === "completed").length;
    const total = tasks.length || 1;
    const progressPct = Math.round((completed / total) * 100);

    const agentsUpdate = tasks.map((t) => ({
      name: t.owner,
      status: t.status,
      task: t.subject,
    }));

    await db
      .update(orchestrationSessionsTable)
      .set({
        agentsJson: agentsUpdate,
        agentCount: tasks.length,
      })
      .where(eq(orchestrationSessionsTable.id, sessionId));

    logger.debug(
      {
        sessionId,
        teamName: session.teamName,
        progressPct,
        completed,
        total,
      },
      "Session progress updated",
    );

    if (completed === total && total > 0) {
      await this.collectResults(session);
    }
  }

  // -------------------------------------------------------------------------
  // Private — result collection
  // -------------------------------------------------------------------------

  private async collectResults(session: SessionRow): Promise<void> {
    const db = getDb();
    const { id: sessionId, teamName } = session;

    logger.info({ sessionId, teamName }, "Collecting results from ClawTeam");

    await db
      .update(orchestrationSessionsTable)
      .set({ status: "collecting" })
      .where(eq(orchestrationSessionsTable.id, sessionId));

    let tasks = await clawTeamBridge.getTaskList(teamName);
    let messages = await clawTeamBridge.peekInbox(teamName);

    const resultJson = {
      tasks: tasks.map((t) => ({
        id: t.id,
        subject: t.subject,
        owner: t.owner,
        status: t.status,
      })),
      messages: messages.map((m) => ({
        from: m.from,
        content: m.content,
        timestamp: m.timestamp,
      })),
      collectedAt: new Date().toISOString(),
    };

    const summaryParts = messages
      .filter((m) => m.content && m.content.length > 0)
      .map((m) => `[${m.from}]: ${m.content.substring(0, 300)}`);

    const resultSummary =
      summaryParts.length > 0
        ? `Multi-agent execution completed. ${tasks.length} agents contributed:\n${summaryParts.join("\n")}`
        : `Multi-agent execution completed with ${tasks.length} agents.`;

    await db
      .update(tasksTable)
      .set({
        status: "review",
        resultSummary,
        resultData: resultJson as Record<string, unknown>,
        version: sql`version + 1`,
      })
      .where(eq(tasksTable.id, session.taskId));

    await db
      .update(orchestrationSessionsTable)
      .set({
        status: "completed",
        resultJson,
        completedAt: new Date(),
      })
      .where(eq(orchestrationSessionsTable.id, sessionId));

    await clawTeamBridge.cleanupTeam(teamName);
    this.stopTracking(sessionId);

    logger.info({ sessionId, teamName }, "Session completed and results collected");
  }

  // -------------------------------------------------------------------------
  // Private — timeout handling
  // -------------------------------------------------------------------------

  private async handleTimeout(session: SessionRow): Promise<void> {
    const db = getDb();
    const { id: sessionId, teamName } = session;

    logger.warn({ sessionId, teamName }, "Collecting partial results after timeout");

    const tasks = await clawTeamBridge.getTaskList(teamName);
    const messages = await clawTeamBridge.peekInbox(teamName);

    const completed = tasks.filter((t) => t.status === "completed").length;
    const partialResult = {
      tasks: tasks.map((t) => ({
        id: t.id,
        subject: t.subject,
        owner: t.owner,
        status: t.status,
      })),
      messages: messages.map((m) => ({ from: m.from, content: m.content })),
      timeout: true,
      collectedAt: new Date().toISOString(),
    };

    const timeoutMin =
      TEMPLATE_TIMEOUTS[session.template ?? ""] ?? DEFAULT_TIMEOUT_MIN;

    await db
      .update(tasksTable)
      .set({
        resultSummary: `[PARTIAL] Multi-agent session timed out. ${completed}/${tasks.length} agents completed. Partial results available.`,
        resultData: partialResult as Record<string, unknown>,
        version: sql`version + 1`,
      })
      .where(eq(tasksTable.id, session.taskId));

    await db
      .update(orchestrationSessionsTable)
      .set({
        status: "failed",
        resultJson: partialResult,
        errorMessage: `Timeout after ${timeoutMin} minutes`,
        completedAt: new Date(),
      })
      .where(eq(orchestrationSessionsTable.id, sessionId));

    await clawTeamBridge.cleanupTeam(teamName);
    this.stopTracking(sessionId);

    logger.warn({ sessionId, teamName, timeoutMin }, "Session marked failed after timeout");
  }
}

export const sessionTracker = new SessionTracker();
