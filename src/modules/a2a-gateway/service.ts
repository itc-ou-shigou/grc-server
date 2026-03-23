/**
 * A2A Gateway Service — Agent Card CRUD + heartbeat
 *
 * Business logic for agent discovery and status tracking.
 */

import { eq, desc, sql, and } from "drizzle-orm";
import pino from "pino";
import { getDb } from "../../shared/db/connection.js";
import { agentCardsTable } from "./schema.js";
import { nodesTable } from "../evolution/schema.js";
import { NotFoundError } from "../../shared/middleware/error-handler.js";

const logger = pino({ name: "module:a2a-gateway:service" });

// ── AgentCardService ────────────────────────────

export class AgentCardService {
  /**
   * Register or update an Agent Card for a node.
   * Upsert: insert if not exists, update if exists.
   */
  async upsertAgentCard(data: {
    nodeId: string;
    agentCard: unknown;
    skills?: unknown;
    capabilities?: unknown;
  }) {
    const db = getDb();
    const now = new Date();

    // Check if exists
    const existing = await db
      .select({ nodeId: agentCardsTable.nodeId })
      .from(agentCardsTable)
      .where(eq(agentCardsTable.nodeId, data.nodeId))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(agentCardsTable)
        .set({
          agentCard: data.agentCard,
          skills: data.skills ?? null,
          capabilities: data.capabilities ?? null,
          lastSeenAt: now,
          status: "online",
        })
        .where(eq(agentCardsTable.nodeId, data.nodeId));

      logger.debug({ nodeId: data.nodeId }, "Agent card updated");
    } else {
      await db.insert(agentCardsTable).values({
        nodeId: data.nodeId,
        agentCard: data.agentCard,
        skills: data.skills ?? null,
        capabilities: data.capabilities ?? null,
        lastSeenAt: now,
        status: "online",
      });

      logger.info({ nodeId: data.nodeId }, "Agent card registered");
    }

    return this.getAgentCard(data.nodeId);
  }

  /**
   * Get a single Agent Card by node ID.
   */
  async getAgentCard(nodeId: string) {
    const db = getDb();

    const rows = await db
      .select()
      .from(agentCardsTable)
      .where(eq(agentCardsTable.nodeId, nodeId))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundError("AgentCard");
    }

    return rows[0];
  }

  /**
   * List all Agent Cards with optional status filter.
   */
  async listAgentCards(opts?: { status?: string }) {
    const db = getDb();

    const conditions = [];
    if (opts?.status) {
      conditions.push(
        eq(
          agentCardsTable.status,
          opts.status as (typeof agentCardsTable.status.enumValues)[number],
        ),
      );
    }
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = await db
      .select({
        nodeId: agentCardsTable.nodeId,
        agentCard: agentCardsTable.agentCard,
        skills: agentCardsTable.skills,
        capabilities: agentCardsTable.capabilities,
        lastSeenAt: agentCardsTable.lastSeenAt,
        status: agentCardsTable.status,
        createdAt: agentCardsTable.createdAt,
        updatedAt: agentCardsTable.updatedAt,
        // JOIN nodes table for authoritative role_id and employee info
        roleId: nodesTable.roleId,
        employeeName: nodesTable.employeeName,
        employeeId: nodesTable.employeeId,
      })
      .from(agentCardsTable)
      .leftJoin(nodesTable, eq(agentCardsTable.nodeId, nodesTable.nodeId))
      .where(whereClause)
      .orderBy(desc(agentCardsTable.lastSeenAt));

    return rows;
  }

  /**
   * Update agent heartbeat (last_seen_at + status).
   */
  async heartbeat(nodeId: string) {
    const db = getDb();
    const now = new Date();

    const rows = await db
      .select({ nodeId: agentCardsTable.nodeId })
      .from(agentCardsTable)
      .where(eq(agentCardsTable.nodeId, nodeId))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundError("AgentCard");
    }

    await db
      .update(agentCardsTable)
      .set({
        lastSeenAt: now,
        status: "online",
      })
      .where(eq(agentCardsTable.nodeId, nodeId));

    logger.debug({ nodeId }, "Agent heartbeat received");

    return { nodeId, lastSeenAt: now, status: "online" };
  }

  /**
   * Set agent status (online/offline/busy).
   */
  async setStatus(nodeId: string, status: "online" | "offline" | "busy") {
    const db = getDb();

    const rows = await db
      .select({ nodeId: agentCardsTable.nodeId })
      .from(agentCardsTable)
      .where(eq(agentCardsTable.nodeId, nodeId))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundError("AgentCard");
    }

    await db
      .update(agentCardsTable)
      .set({ status })
      .where(eq(agentCardsTable.nodeId, nodeId));

    logger.debug({ nodeId, status }, "Agent status updated");

    return { nodeId, status };
  }

  /**
   * Delete an Agent Card.
   */
  async deleteAgentCard(nodeId: string) {
    const db = getDb();

    const rows = await db
      .select({ nodeId: agentCardsTable.nodeId })
      .from(agentCardsTable)
      .where(eq(agentCardsTable.nodeId, nodeId))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundError("AgentCard");
    }

    await db
      .delete(agentCardsTable)
      .where(eq(agentCardsTable.nodeId, nodeId));

    logger.info({ nodeId }, "Agent card deleted");

    return { deleted: nodeId };
  }

  /**
   * Get agent statistics.
   */
  async getStats() {
    const db = getDb();

    const [totalResult, byStatusResult] = await Promise.all([
      db
        .select({ count: sql<number>`COUNT(*)` })
        .from(agentCardsTable),
      db
        .select({
          status: agentCardsTable.status,
          count: sql<number>`COUNT(*)`,
        })
        .from(agentCardsTable)
        .groupBy(agentCardsTable.status),
    ]);

    const total = totalResult[0]?.count ?? 0;
    const byStatus = byStatusResult.reduce(
      (acc, row) => {
        acc[row.status] = row.count;
        return acc;
      },
      {} as Record<string, number>,
    );

    return { total, byStatus };
  }

  /**
   * Mark stale agents (no heartbeat for > threshold) as offline.
   */
  async markStaleOffline(thresholdMinutes = 30) {
    const db = getDb();
    const cutoff = new Date();
    cutoff.setMinutes(cutoff.getMinutes() - thresholdMinutes);

    await db
      .update(agentCardsTable)
      .set({ status: "offline" })
      .where(
        and(
          sql`${agentCardsTable.lastSeenAt} < ${cutoff}`,
          sql`${agentCardsTable.status} != 'offline'`,
        ),
      );

    logger.debug({ thresholdMinutes }, "Stale agents marked offline");
  }
}
