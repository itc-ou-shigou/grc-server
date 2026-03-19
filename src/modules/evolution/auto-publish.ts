/**
 * Auto-Publish Service — Listens for task completion events
 * and auto-publishes Genes to the Evolution Pool.
 */

import pino from "pino";
import { EvolutionService } from "./service.js";

const log = pino({ name: "evolution:auto-publish" });

export class AutoPublishService {
  private evolutionService: EvolutionService;

  constructor(evolutionService: EvolutionService) {
    this.evolutionService = evolutionService;
  }

  /**
   * Called when a task transitions to "completed".
   * Logs the intent to publish a gene for the completed task.
   * Non-fatal — errors are caught and logged as warnings.
   */
  async onTaskCompleted(task: {
    id: string;
    taskCode: string;
    title: string;
    category: string | null;
    assignedNodeId?: string | null;
    assignedRoleId?: string | null;
    deliverables?: unknown;
    resultSummary?: string | null;
  }): Promise<void> {
    if (!task.assignedNodeId) return;
    if (!task.resultSummary && !task.deliverables) return; // nothing to publish

    try {
      const payload = {
        source: "task_completion",
        task_code: task.taskCode,
        task_title: task.title,
        category: task.category,
        creator_role: task.assignedRoleId,
        result_summary:
          typeof task.resultSummary === "string"
            ? task.resultSummary.substring(0, 500)
            : null,
        completed_at: new Date().toISOString(),
      };

      // Use a deterministic asset_id based on task code
      const assetId = `gene-task-${task.taskCode}`;
      const contentHash = Buffer.from(JSON.stringify(payload))
        .toString("base64url");

      log.info(
        { taskCode: task.taskCode, assetId },
        "Auto-publishing gene for completed task",
      );

      // Attempt to publish a gene through the evolution service.
      // ConflictError (duplicate) is expected if the task was already published.
      try {
        await this.evolutionService.publishAsset({
          nodeId: task.assignedNodeId,
          assetType: "gene",
          assetId,
          contentHash,
          payload,
          category: task.category ?? "operational",
        });
        log.info({ assetId }, "Gene auto-published successfully");
      } catch (err: unknown) {
        const error = err as { message?: string };
        if (error.message?.includes("already exists")) {
          log.debug({ assetId }, "Gene already published for this task — skipping");
        } else {
          throw err;
        }
      }
    } catch (err) {
      log.warn({ err, taskCode: task.taskCode }, "Auto-publish failed (non-fatal)");
    }
  }
}
