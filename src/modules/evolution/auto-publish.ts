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
    // Auto-publish disabled — voting/curation flow replaces automatic gene creation.
    log.debug({ taskCode: task.taskCode }, "Auto-publish disabled — skipping gene creation");
    return;
  }
}
