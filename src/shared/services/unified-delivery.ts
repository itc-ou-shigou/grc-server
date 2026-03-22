/**
 * Unified Message Delivery Service
 *
 * Combines SSE real-time push with A2A Relay Queue persistence.
 * - Every message is persisted to a2a_relay_queue (guaranteed delivery)
 * - If target node has active SSE connection, push immediately
 * - On SSE reconnect, replay all pending (queued) messages
 */

import { v4 as uuidv4 } from "uuid";
import { eq, and } from "drizzle-orm";
import { sql } from "drizzle-orm";
import pino from "pino";
import { getDb } from "../db/connection.js";
import { a2aRelayQueueTable } from "../../modules/relay/schema.js";
import { nodeConfigSSE } from "../../modules/evolution/node-config-sse.js";
import type { RelaySSEEvent } from "../../modules/evolution/node-config-sse.js";

const logger = pino({ name: "service:unified-delivery" });

export class UnifiedDelivery {
  /**
   * Send a message with dual guarantee: persist + SSE push.
   */
  async send(params: {
    fromNodeId: string;
    toNodeId: string;
    messageType: string;
    subject?: string;
    payload: Record<string, unknown>;
    priority?: "critical" | "high" | "normal" | "low";
    expiresAt?: Date;
  }): Promise<{ messageId: string; deliveredViaSSE: boolean }> {
    const db = getDb();
    const id = uuidv4();
    const now = new Date();

    // Step 1: Persist to relay queue (guaranteed)
    await db.insert(a2aRelayQueueTable).values({
      id,
      fromNodeId: params.fromNodeId,
      toNodeId: params.toNodeId,
      messageType: params.messageType,
      subject: params.subject ?? null,
      payload: params.payload,
      priority: params.priority ?? "normal",
      status: "queued",
      expiresAt: params.expiresAt ?? null,
    });

    // Step 2: SSE instant push (if online)
    let deliveredViaSSE = false;
    if (nodeConfigSSE.isNodeConnected(params.toNodeId)) {
      const sseEvent: RelaySSEEvent = {
        event_type: "relay_message",
        message_id: id,
        from_node_id: params.fromNodeId,
        message_type: params.messageType,
        subject: params.subject,
        payload: params.payload,
        priority: params.priority ?? "normal",
        created_at: now.toISOString(),
      };

      deliveredViaSSE = nodeConfigSSE.pushRelayEvent(params.toNodeId, sseEvent);

      if (deliveredViaSSE) {
        await db
          .update(a2aRelayQueueTable)
          .set({ status: "delivered", deliveredAt: now })
          .where(eq(a2aRelayQueueTable.id, id));
      }
    }

    logger.info(
      {
        messageId: id,
        from: params.fromNodeId,
        to: params.toNodeId,
        type: params.messageType,
        sseDelivered: deliveredViaSSE,
      },
      "Unified delivery: message sent",
    );

    return { messageId: id, deliveredViaSSE };
  }

  /**
   * Replay all pending (queued) messages for a node that just reconnected via SSE.
   * Called when a node establishes a new SSE connection.
   */
  async replayPendingMessages(nodeId: string): Promise<number> {
    const db = getDb();

    const pending = await db
      .select()
      .from(a2aRelayQueueTable)
      .where(
        and(
          eq(a2aRelayQueueTable.toNodeId, nodeId),
          eq(a2aRelayQueueTable.status, "queued"),
        ),
      )
      .orderBy(
        sql`CASE ${a2aRelayQueueTable.priority} WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 ELSE 4 END`,
        a2aRelayQueueTable.createdAt,
      );

    if (pending.length === 0) return 0;

    let delivered = 0;
    const now = new Date();

    for (const msg of pending) {
      const sseEvent: RelaySSEEvent = {
        event_type: "relay_message",
        message_id: msg.id,
        from_node_id: msg.fromNodeId,
        message_type: msg.messageType,
        subject: msg.subject,
        payload: msg.payload as Record<string, unknown>,
        priority: msg.priority,
        created_at: msg.createdAt?.toISOString?.() ?? new Date().toISOString(),
      };

      if (nodeConfigSSE.pushRelayEvent(nodeId, sseEvent)) {
        await db
          .update(a2aRelayQueueTable)
          .set({ status: "delivered", deliveredAt: now })
          .where(eq(a2aRelayQueueTable.id, msg.id));
        delivered++;
      }
    }

    if (delivered > 0) {
      logger.info(
        { nodeId, total: pending.length, delivered },
        "Replayed pending relay messages on SSE reconnect",
      );
    }

    return delivered;
  }

  /**
   * Broadcast a message to multiple nodes.
   */
  async broadcast(params: {
    fromNodeId: string;
    toNodeIds: string[];
    messageType: string;
    subject?: string;
    payload: Record<string, unknown>;
    priority?: "critical" | "high" | "normal" | "low";
  }): Promise<{
    results: Array<{ nodeId: string; messageId: string; deliveredViaSSE: boolean }>;
    summary: { total: number; deliveredImmediately: number; queuedForLater: number };
  }> {
    const results: Array<{ nodeId: string; messageId: string; deliveredViaSSE: boolean }> = [];

    for (const toNodeId of params.toNodeIds) {
      const { messageId, deliveredViaSSE } = await this.send({
        fromNodeId: params.fromNodeId,
        toNodeId,
        messageType: params.messageType,
        subject: params.subject,
        payload: params.payload,
        priority: params.priority,
      });
      results.push({ nodeId: toNodeId, messageId, deliveredViaSSE });
    }

    return {
      results,
      summary: {
        total: results.length,
        deliveredImmediately: results.filter((r) => r.deliveredViaSSE).length,
        queuedForLater: results.filter((r) => !r.deliveredViaSSE).length,
      },
    };
  }
}

/** Singleton instance */
export const unifiedDelivery = new UnifiedDelivery();
