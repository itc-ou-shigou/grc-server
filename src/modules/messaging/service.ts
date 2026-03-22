/**
 * Messaging Service — Async Message Queue Operations
 *
 * Provides enqueue, dequeue, status transitions, and statistics
 * for the persistent message queue. Designed to replace synchronous
 * sessions_send calls that frequently time out.
 */

import { v4 as uuidv4 } from "uuid";
import { eq, and, sql, or, inArray } from "drizzle-orm";
import pino from "pino";
import { getDb } from "../../shared/db/connection.js";
import { messageQueueTable } from "./schema.js";
import type { MessageQueueRow, NewMessageQueueRow } from "./schema.js";
import {
  NotFoundError,
  BadRequestError,
} from "../../shared/middleware/error-handler.js";

const logger = pino({ name: "messaging:service" });

// ── Types ───────────────────────────────────────────

export interface EnqueueParams {
  fromNodeId: string;
  toNodeId?: string;
  toRoleId?: string;
  messageType: string;
  subject?: string;
  body?: string;
  priority?: "critical" | "high" | "normal" | "low";
}

export interface PendingQuery {
  nodeId: string;
  roleIds?: string[];
  limit?: number;
}

export interface QueueStats {
  by_status: {
    pending: number;
    delivered: number;
    read: number;
    failed: number;
    expired: number;
  };
  by_priority: {
    critical: number;
    high: number;
    normal: number;
    low: number;
  };
  critical_pending: number;
  total: number;
}

// ── Service Implementation ──────────────────────────

export class MessagingService {
  /**
   * Get a single message by ID. Used for authorization checks.
   */
  async getById(id: string): Promise<MessageQueueRow | undefined> {
    const db = getDb();
    const [row] = await db
      .select()
      .from(messageQueueTable)
      .where(eq(messageQueueTable.id, id))
      .limit(1);
    return row;
  }

  /**
   * Enqueue a new message for async delivery.
   * At least one of toNodeId or toRoleId must be provided.
   */
  async enqueue(params: EnqueueParams): Promise<MessageQueueRow> {
    if (!params.toNodeId && !params.toRoleId) {
      throw new BadRequestError(
        "At least one of to_node_id or to_role_id must be provided",
      );
    }

    const db = getDb();
    const id = uuidv4();

    const row: NewMessageQueueRow = {
      id,
      fromNodeId: params.fromNodeId,
      toNodeId: params.toNodeId ?? null,
      toRoleId: params.toRoleId ?? null,
      messageType: params.messageType,
      subject: params.subject ?? null,
      body: params.body ?? null,
      priority: params.priority ?? "normal",
      status: "pending",
    };

    await db.insert(messageQueueTable).values(row);

    logger.info(
      { id, from: params.fromNodeId, to: params.toNodeId ?? params.toRoleId },
      "Message enqueued",
    );

    // Return the full row
    const [inserted] = await db
      .select()
      .from(messageQueueTable)
      .where(eq(messageQueueTable.id, id))
      .limit(1);

    return inserted;
  }

  /**
   * Get pending messages for a specific node.
   * Also returns messages addressed to the node's roles if roleIds provided.
   * Results are ordered by priority (critical first) then creation time.
   */
  async getPending(query: PendingQuery): Promise<MessageQueueRow[]> {
    const db = getDb();
    const limit = query.limit ?? 50;

    // Build conditions: pending status AND (to_node_id matches OR to_role_id matches)
    const targetConditions = [
      eq(messageQueueTable.toNodeId, query.nodeId),
    ];

    if (query.roleIds && query.roleIds.length > 0) {
      targetConditions.push(
        inArray(messageQueueTable.toRoleId, query.roleIds),
      );
    }

    const rows = await db
      .select()
      .from(messageQueueTable)
      .where(
        and(
          eq(messageQueueTable.status, "pending"),
          or(...targetConditions),
        ),
      )
      .orderBy(
        sql`CASE ${messageQueueTable.priority} WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 ELSE 4 END`,
        messageQueueTable.createdAt,
      )
      .limit(limit);

    return rows;
  }

  /**
   * Mark a message as delivered. Sets deliveredAt timestamp.
   */
  async markDelivered(messageId: string): Promise<MessageQueueRow> {
    const db = getDb();

    const [existing] = await db
      .select()
      .from(messageQueueTable)
      .where(eq(messageQueueTable.id, messageId))
      .limit(1);

    if (!existing) {
      throw new NotFoundError("Message");
    }

    if (existing.status !== "pending") {
      throw new BadRequestError(
        `Cannot mark message as delivered: current status is "${existing.status}"`,
      );
    }

    await db
      .update(messageQueueTable)
      .set({
        status: "delivered",
        deliveredAt: sql`NOW()`,
      })
      .where(eq(messageQueueTable.id, messageId));

    logger.info({ messageId }, "Message marked as delivered");

    const [updated] = await db
      .select()
      .from(messageQueueTable)
      .where(eq(messageQueueTable.id, messageId))
      .limit(1);

    return updated;
  }

  /**
   * Mark a message as read. Sets readAt timestamp.
   */
  async markRead(messageId: string): Promise<MessageQueueRow> {
    const db = getDb();

    const [existing] = await db
      .select()
      .from(messageQueueTable)
      .where(eq(messageQueueTable.id, messageId))
      .limit(1);

    if (!existing) {
      throw new NotFoundError("Message");
    }

    if (existing.status !== "pending" && existing.status !== "delivered") {
      throw new BadRequestError(
        `Cannot mark message as read: current status is "${existing.status}"`,
      );
    }

    await db
      .update(messageQueueTable)
      .set({
        status: "read",
        readAt: sql`NOW()`,
        // Also set deliveredAt if it was still pending
        ...(existing.status === "pending" ? { deliveredAt: sql`NOW()` } : {}),
      })
      .where(eq(messageQueueTable.id, messageId));

    logger.info({ messageId }, "Message marked as read");

    const [updated] = await db
      .select()
      .from(messageQueueTable)
      .where(eq(messageQueueTable.id, messageId))
      .limit(1);

    return updated;
  }

  /**
   * Get queue statistics — counts by status, priority, and critical_pending.
   */
  async getStats(): Promise<QueueStats> {
    const db = getDb();

    const [statusRows, priorityRows, criticalPendingRows] = await Promise.all([
      db
        .select({
          status: messageQueueTable.status,
          count: sql<number>`COUNT(*)`,
        })
        .from(messageQueueTable)
        .groupBy(messageQueueTable.status),
      db
        .select({
          priority: messageQueueTable.priority,
          count: sql<number>`COUNT(*)`,
        })
        .from(messageQueueTable)
        .groupBy(messageQueueTable.priority),
      db
        .select({ count: sql<number>`COUNT(*)` })
        .from(messageQueueTable)
        .where(
          and(
            eq(messageQueueTable.status, "pending"),
            eq(messageQueueTable.priority, "critical"),
          ),
        ),
    ]);

    const byStatus = { pending: 0, delivered: 0, read: 0, failed: 0, expired: 0 };
    let total = 0;
    for (const row of statusRows) {
      const count = Number(row.count);
      total += count;
      if (row.status in byStatus) {
        (byStatus as Record<string, number>)[row.status] = count;
      }
    }

    const byPriority = { critical: 0, high: 0, normal: 0, low: 0 };
    for (const row of priorityRows) {
      const count = Number(row.count);
      if (row.priority in byPriority) {
        (byPriority as Record<string, number>)[row.priority] = count;
      }
    }

    const criticalPending = Number(criticalPendingRows[0]?.count ?? 0);

    return {
      by_status: byStatus,
      by_priority: byPriority,
      critical_pending: criticalPending,
      total,
    };
  }
}

// ── Singleton Access ──────────────────────────────

let _service: MessagingService | null = null;

export function getMessagingService(): MessagingService {
  if (!_service) {
    _service = new MessagingService();
  }
  return _service;
}
