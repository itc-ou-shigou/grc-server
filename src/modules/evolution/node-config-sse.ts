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
