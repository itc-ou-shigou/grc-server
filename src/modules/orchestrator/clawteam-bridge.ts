import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import pino from "pino";

const execFileAsync = promisify(execFile);
const logger = pino({ name: "module:orchestrator:clawteam-bridge" });

/**
 * Binary name for the clawteam orchestration CLI.
 * Override with GRC_CLAWTEAM_BIN env var.
 */
const CLAWTEAM_BIN = process.env.GRC_CLAWTEAM_BIN ?? "clawteam";

/**
 * Default agent binary used to spawn individual agents within a team.
 * On Windows: winclaw; on Linux/macOS: openclaw.
 * Override with GRC_AGENT_BIN env var.
 */
const DEFAULT_AGENT_BIN =
  process.env.GRC_AGENT_BIN ??
  (process.platform === "win32" ? "winclaw" : "openclaw");

/** Default per-command timeout in milliseconds. */
const CLAWTEAM_TIMEOUT_MS = parseInt(
  process.env.GRC_CLAWTEAM_TIMEOUT_MS ?? "60000",
  10,
);

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface ClawTeamAgent {
  name: string;
  type: string;
  status: string;
  task?: string;
}

export interface TeamStatus {
  teamName: string;
  leader: string;
  members: ClawTeamAgent[];
  tasksSummary: {
    total: number;
    completed: number;
    pending: number;
    inProgress: number;
  };
}

export interface ClawTeamTaskItem {
  id: string;
  subject: string;
  owner: string;
  status: "pending" | "in_progress" | "completed" | "blocked";
}

export interface InboxMessage {
  from: string;
  content: string;
  timestamp: string;
  type: string;
}

export interface SpawnTeamConfig {
  teamName: string;
  template: string;
  goal: string;
  /**
   * Agent binary command. Defaults to platform-appropriate value:
   * `winclaw` on Windows, `openclaw` elsewhere.
   */
  agentCommand?: string;
}

export interface SpawnTeamResult {
  success: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns environment variables required for ClawTeam to operate correctly on
 * the current platform. On Windows the subprocess backend must be used because
 * PTY forking is not available.
 */
function getPlatformEnv(): Record<string, string> {
  if (process.platform === "win32") {
    return { CLAWTEAM_DEFAULT_BACKEND: "subprocess" };
  }
  return {};
}

/**
 * Executes a clawteam CLI command with `--json` output and returns the parsed
 * response. Throws a descriptive error on timeout or non-zero exit.
 */
async function execClawTeam(
  args: string[],
  timeoutMs = CLAWTEAM_TIMEOUT_MS,
): Promise<unknown> {
  const fullArgs = ["--json", ...args];
  const env = { ...process.env, ...getPlatformEnv() };

  logger.debug({ bin: CLAWTEAM_BIN, args: fullArgs }, "Executing clawteam");

  try {
    const { stdout, stderr } = await execFileAsync(CLAWTEAM_BIN, fullArgs, {
      env,
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    });

    if (stderr) {
      logger.warn({ stderr: stderr.substring(0, 500) }, "clawteam stderr");
    }

    try {
      return JSON.parse(stdout) as unknown;
    } catch {
      // Some commands emit plain text; wrap for consistent handling
      return { raw: stdout.trim() };
    }
  } catch (err: unknown) {
    const error = err as Error & { code?: string; killed?: boolean };
    if (error.killed) {
      throw new Error(
        `ClawTeam command timed out after ${timeoutMs}ms: clawteam ${args.join(" ")}`,
      );
    }
    throw new Error(
      `ClawTeam command failed (clawteam ${args.join(" ")}): ${error.message}`,
    );
  }
}

// ---------------------------------------------------------------------------
// ClawTeamBridge
// ---------------------------------------------------------------------------

/**
 * Thin wrapper around the ClawTeam CLI that manages subprocess lifecycles and
 * provides typed access to team operations.
 */
export class ClawTeamBridge {
  /** Tracks spawn-phase child processes so they can be killed on abort. */
  private readonly activeProcesses = new Map<string, ChildProcess>();

  // -------------------------------------------------------------------------
  // Availability
  // -------------------------------------------------------------------------

  /** Returns true if the clawteam binary is reachable and responds. */
  async isAvailable(): Promise<boolean> {
    try {
      await execClawTeam(["--version"], 5_000);
      return true;
    } catch {
      logger.warn({ bin: CLAWTEAM_BIN }, "ClawTeam CLI not available");
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Team lifecycle
  // -------------------------------------------------------------------------

  /**
   * Launches a new ClawTeam team. The process is tracked until it exits so it
   * can be aborted if needed. Uses the platform-appropriate agent binary
   * unless overridden by `config.agentCommand`.
   */
  async spawnTeam(config: SpawnTeamConfig): Promise<SpawnTeamResult> {
    const agentCommand = config.agentCommand ?? DEFAULT_AGENT_BIN;

    const args = [
      "launch",
      config.template,
      "--team",
      config.teamName,
      "--goal",
      config.goal,
      "--command",
      agentCommand,
    ];

    const env = { ...process.env, ...getPlatformEnv() };

    // If a previous process for this team is still tracked, kill it first to
    // avoid orphaned processes.
    const existing = this.activeProcesses.get(config.teamName);
    if (existing) {
      logger.warn(
        { teamName: config.teamName },
        "Killing existing tracked process before re-spawn",
      );
      existing.kill("SIGTERM");
      this.activeProcesses.delete(config.teamName);
    }

    logger.info(
      { teamName: config.teamName, template: config.template, agentCommand },
      "Spawning ClawTeam",
    );

    return new Promise<SpawnTeamResult>((resolve) => {
      let child: ChildProcess;

      try {
        child = spawn(CLAWTEAM_BIN, args, {
          env,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ teamName: config.teamName, err }, "Failed to spawn clawteam process");
        resolve({ success: false, error: msg });
        return;
      }

      this.activeProcesses.set(config.teamName, child);

      let stdoutBuf = "";
      let stderrBuf = "";

      child.stdout?.on("data", (chunk: Buffer) => {
        stdoutBuf += chunk.toString();
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        stderrBuf += chunk.toString();
      });

      const timeoutHandle = setTimeout(() => {
        logger.error(
          { teamName: config.teamName, timeoutMs: CLAWTEAM_TIMEOUT_MS },
          "ClawTeam spawn timed out — killing process",
        );
        child.kill("SIGTERM");
        this.activeProcesses.delete(config.teamName);
        resolve({
          success: false,
          error: `Spawn timed out after ${CLAWTEAM_TIMEOUT_MS / 1000}s`,
        });
      }, CLAWTEAM_TIMEOUT_MS);

      child.on("close", (code) => {
        clearTimeout(timeoutHandle);
        this.activeProcesses.delete(config.teamName);

        if (code === 0) {
          logger.info(
            { teamName: config.teamName, template: config.template },
            "Team spawned successfully",
          );
          resolve({ success: true });
        } else {
          const snippet = stderrBuf.substring(0, 300);
          logger.error(
            { teamName: config.teamName, exitCode: code, stderr: snippet },
            "Team spawn failed",
          );
          resolve({
            success: false,
            error: `Exit code ${code}: ${snippet}`,
          });
        }
      });

      child.on("error", (err) => {
        clearTimeout(timeoutHandle);
        this.activeProcesses.delete(config.teamName);
        logger.error(
          { teamName: config.teamName, err },
          "Child process error during spawn",
        );
        resolve({ success: false, error: err.message });
      });
    });
  }

  /**
   * Kills the tracked spawn process for a team (if any) and requests a
   * graceful team cleanup via the CLI. Safe to call on already-cleaned teams.
   */
  async abortTeam(teamName: string): Promise<void> {
    const proc = this.activeProcesses.get(teamName);
    if (proc) {
      logger.info({ teamName }, "Killing tracked spawn process");
      proc.kill("SIGTERM");
      this.activeProcesses.delete(teamName);
    }
    // Best-effort CLI cleanup; errors are logged but not re-thrown
    await this.cleanupTeam(teamName);
  }

  // -------------------------------------------------------------------------
  // Status & inspection
  // -------------------------------------------------------------------------

  /** Returns current team status, or null if the CLI call fails. */
  async getTeamStatus(teamName: string): Promise<TeamStatus | null> {
    try {
      const result = await execClawTeam(["board", "show", teamName]);
      return result as TeamStatus;
    } catch (err) {
      logger.warn({ teamName, err }, "Failed to get team status");
      return null;
    }
  }

  /** Returns the task list for a team, or an empty array on failure. */
  async getTaskList(teamName: string): Promise<ClawTeamTaskItem[]> {
    try {
      const result = await execClawTeam(["task", "list", teamName]);
      if (Array.isArray(result)) return result as ClawTeamTaskItem[];
      if (result && typeof result === "object" && "tasks" in result) {
        return (result as { tasks: ClawTeamTaskItem[] }).tasks;
      }
      return [];
    } catch (err) {
      logger.warn({ teamName, err }, "Failed to get task list");
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // Inbox
  // -------------------------------------------------------------------------

  /** Reads up to 50 inbox messages for a team (optionally filtered to one agent). */
  async peekInbox(
    teamName: string,
    agentName?: string,
  ): Promise<InboxMessage[]> {
    try {
      const args = ["inbox", "peek", teamName];
      if (agentName) args.push("--agent", agentName);
      args.push("--limit", "50");
      const result = await execClawTeam(args);
      return Array.isArray(result) ? (result as InboxMessage[]) : [];
    } catch (err) {
      logger.warn({ teamName, agentName, err }, "Failed to peek inbox");
      return [];
    }
  }

  /** Sends a direct inbox message to a specific agent on a team. */
  async sendMessage(
    teamName: string,
    to: string,
    content: string,
  ): Promise<void> {
    await execClawTeam(["inbox", "send", teamName, to, content]);
  }

  /** Broadcasts a message to all agents on a team. */
  async broadcastMessage(teamName: string, content: string): Promise<void> {
    await execClawTeam(["inbox", "broadcast", teamName, content]);
  }

  // -------------------------------------------------------------------------
  // Shutdown / cleanup
  // -------------------------------------------------------------------------

  /** Requests graceful shutdown of a specific agent. */
  async requestShutdown(
    teamName: string,
    agentName: string,
    reason: string,
  ): Promise<void> {
    try {
      await execClawTeam([
        "lifecycle",
        "request-shutdown",
        teamName,
        agentName,
        "--reason",
        reason,
      ]);
    } catch (err) {
      logger.warn({ teamName, agentName, err }, "Failed to request agent shutdown");
    }
  }

  /** Forcefully cleans up all resources for a team. */
  async cleanupTeam(teamName: string): Promise<void> {
    try {
      await execClawTeam(["team", "cleanup", teamName, "--force"]);
      logger.info({ teamName }, "Team cleaned up");
    } catch (err) {
      logger.warn({ teamName, err }, "Failed to cleanup team (may already be gone)");
    }
  }

  // -------------------------------------------------------------------------
  // Metrics
  // -------------------------------------------------------------------------

  /** Returns the number of spawn-phase processes currently being tracked. */
  getActiveTeamCount(): number {
    return this.activeProcesses.size;
  }
}

export const clawTeamBridge = new ClawTeamBridge();
