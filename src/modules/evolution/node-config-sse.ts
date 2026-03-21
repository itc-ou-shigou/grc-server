/**
 * Node Config SSE Manager — Real-time config push to WinClaw nodes
 *
 * Maintains persistent SSE connections from nodes.
 * When config changes (key assignment, role assignment, etc.),
 * the server pushes a notification so the node can immediately pull.
 */

import type { Response } from "express";
import pino from "pino";

const logger = pino({ name: "module:evolution:node-config-sse" });

export interface MeetingSSEEvent {
  event_type: "meeting_invite" | "meeting_started" | "meeting_message";
  session_id: string;
  title: string;
  type: string;
  shared_context?: string;
  facilitator_node_id?: string;
  participants?: { node_id: string; role_id: string; display_name: string }[];
}

export interface TaskSSEEvent {
  event_type:
    | "task_assigned"
    | "task_feedback"
    | "task_completed"
    | "task_approved"
    | "expense_approved"
    | "expense_rejected"
    | "expense_paid";
  task_id: string;
  task_code: string;
  title: string;
  priority?: string;
  category?: string;
  status?: string;
  description?: string;
  deliverables?: string[];
  assigned_role_id?: string;
  creator_node_id?: string;
  creator_role_id?: string;
  feedback?: string;
  result_summary?: string;
  // Expense-specific fields
  amount?: string | null;
  currency?: string | null;
  approved_by?: string;
  approved_at?: string;
  rejected_by?: string;
  rejected_at?: string;
  reason?: string;
  paid_by?: string;
  paid_at?: string;
}

export interface RelaySSEEvent {
  event_type: "relay_message" | "message_read" | "priority_escalated";
  message_id: string;
  from_node_id?: string;
  message_type?: string;
  subject?: string | null;
  payload?: unknown;
  priority?: string;
  new_priority?: string;
  reason?: string;
  created_at?: string;
  read_by?: string;
  read_at?: string;
}

export interface CommunitySSEEvent {
  event_type: "community_new_post" | "community_new_reply";
  post_id: string;
  title: string;
  channel: string;
  author_node_id: string;
  post_type: string;
  body_preview: string;
  created_at: string;
}

export interface ConfigUpdateEvent {
  revision: number;
  reason: string;
  /** If provided, the full config payload so the node doesn't need a second pull */
  config?: {
    role_id: string | null;
    role_mode: string | null;
    files: Record<string, string>;
    key_config: {
      primary: { provider: string; model: string; apiKey: string; baseUrl?: string } | null;
      auxiliary: { provider: string; model: string; apiKey: string; baseUrl?: string } | null;
    } | null;
  };
}

class NodeConfigSSEManager {
  /** nodeId → Set of active SSE Response objects */
  private connections: Map<string, Set<Response>> = new Map();

  /**
   * Register a new SSE connection for a node.
   */
  addConnection(nodeId: string, res: Response): void {
    let nodeConns = this.connections.get(nodeId);
    if (!nodeConns) {
      nodeConns = new Set();
      this.connections.set(nodeId, nodeConns);
    }
    nodeConns.add(res);

    logger.info(
      { nodeId, count: nodeConns.size },
      "Node config SSE client connected",
    );
  }

  /**
   * Remove an SSE connection when the client disconnects.
   */
  removeConnection(nodeId: string, res: Response): void {
    const nodeConns = this.connections.get(nodeId);
    if (!nodeConns) return;

    nodeConns.delete(res);

    if (nodeConns.size === 0) {
      this.connections.delete(nodeId);
    }

    logger.info(
      { nodeId, count: nodeConns?.size ?? 0 },
      "Node config SSE client disconnected",
    );
  }

  /**
   * Check if a node has any active SSE connections.
   */
  isNodeConnected(nodeId: string): boolean {
    const conns = this.connections.get(nodeId);
    return !!conns && conns.size > 0;
  }

  /**
   * Push a config update event to a specific node.
   */
  pushToNode(nodeId: string, event: ConfigUpdateEvent): boolean {
    const nodeConns = this.connections.get(nodeId);
    if (!nodeConns || nodeConns.size === 0) {
      logger.debug({ nodeId }, "No SSE connections for node — skipping push");
      return false;
    }

    const payload = `event: config_update\ndata: ${JSON.stringify(event)}\n\n`;

    for (const res of nodeConns) {
      try {
        res.write(payload);
      } catch {
        nodeConns.delete(res);
      }
    }

    logger.info(
      { nodeId, revision: event.revision, reason: event.reason, clients: nodeConns.size },
      "Config update pushed to node",
    );
    return true;
  }

  /**
   * Push a task event to a specific node via SSE.
   * Used for task lifecycle notifications: assigned, completed, feedback.
   */
  pushTaskEvent(nodeId: string, event: TaskSSEEvent): boolean {
    const nodeConns = this.connections.get(nodeId);
    if (!nodeConns || nodeConns.size === 0) {
      logger.debug({ nodeId }, "No SSE connections for node — skipping task event push");
      return false;
    }

    const payload = `event: task_event\ndata: ${JSON.stringify(event)}\n\n`;

    for (const res of nodeConns) {
      try {
        res.write(payload);
      } catch {
        nodeConns.delete(res);
      }
    }

    logger.info(
      { nodeId, eventType: event.event_type, taskId: event.task_id, taskCode: event.task_code, clients: nodeConns.size },
      "Task event pushed to node",
    );
    return true;
  }

  /**
   * Push a meeting event to a specific node via SSE.
   */
  pushMeetingEvent(nodeId: string, event: MeetingSSEEvent): boolean {
    const nodeConns = this.connections.get(nodeId);
    if (!nodeConns || nodeConns.size === 0) {
      logger.debug({ nodeId }, "No SSE connections for node — skipping meeting event push");
      return false;
    }

    const payload = `event: meeting_event\ndata: ${JSON.stringify(event)}\n\n`;

    for (const res of nodeConns) {
      try {
        res.write(payload);
      } catch {
        nodeConns.delete(res);
      }
    }

    logger.info(
      { nodeId, eventType: event.event_type, sessionId: event.session_id, clients: nodeConns.size },
      "Meeting event pushed to node",
    );
    return true;
  }

  /**
   * Push a relay message event to a specific node via SSE.
   */
  pushRelayEvent(nodeId: string, event: RelaySSEEvent): boolean {
    const nodeConns = this.connections.get(nodeId);
    if (!nodeConns || nodeConns.size === 0) {
      logger.debug({ nodeId }, "No SSE connections for node — skipping relay event push");
      return false;
    }

    const payload = `event: relay_message\ndata: ${JSON.stringify(event)}\n\n`;

    for (const res of nodeConns) {
      try {
        res.write(payload);
      } catch {
        nodeConns.delete(res);
      }
    }

    logger.info(
      { nodeId, eventType: event.event_type, messageId: event.message_id, clients: nodeConns.size },
      "Relay event pushed to node",
    );
    return true;
  }

  /**
   * Broadcast a community event to all connected nodes (except the author).
   */
  broadcastCommunityEvent(event: CommunitySSEEvent, excludeNodeId?: string): number {
    let pushed = 0;
    const payload = `event: community_event\ndata: ${JSON.stringify(event)}\n\n`;
    for (const [nodeId, conns] of this.connections) {
      if (nodeId === excludeNodeId) continue;
      for (const res of conns) {
        try {
          res.write(payload);
          pushed++;
        } catch {
          conns.delete(res);
        }
      }
    }
    logger.info(
      { eventType: event.event_type, postId: event.post_id, pushed },
      "Community event broadcast",
    );
    return pushed;
  }

  /**
   * Broadcast a config update to all connected nodes (e.g., global config change).
   */
  broadcastAll(event: ConfigUpdateEvent): number {
    let pushed = 0;
    for (const [nodeId, conns] of this.connections) {
      const payload = `event: config_update\ndata: ${JSON.stringify(event)}\n\n`;
      for (const res of conns) {
        try {
          res.write(payload);
          pushed++;
        } catch {
          conns.delete(res);
        }
      }
    }
    return pushed;
  }

  /**
   * Send a keepalive ping to all connected nodes.
   */
  pingAll(): void {
    for (const [nodeId, conns] of this.connections) {
      for (const res of conns) {
        try {
          res.write(`: keepalive\n\n`);
        } catch {
          conns.delete(res);
          if (conns.size === 0) {
            this.connections.delete(nodeId);
          }
        }
      }
    }
  }

  /**
   * Get connection stats.
   */
  getStats(): { totalNodes: number; totalConnections: number } {
    let totalConnections = 0;
    for (const conns of this.connections.values()) {
      totalConnections += conns.size;
    }
    return {
      totalNodes: this.connections.size,
      totalConnections,
    };
  }

  getConnectedNodeIds(): string[] {
    return Array.from(this.connections.keys());
  }
}

/** Singleton instance */
export const nodeConfigSSE = new NodeConfigSSEManager();

// Keepalive ping every 30s to prevent connection drops
setInterval(() => {
  nodeConfigSSE.pingAll();
}, 30_000);
