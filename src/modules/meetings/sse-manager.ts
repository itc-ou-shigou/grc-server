/**
 * Meetings Module — SSE Connection Manager
 *
 * Manages Server-Sent Events connections for real-time meeting updates.
 * Each meeting session has a set of connected SSE clients.
 */

import type { Response } from "express";
import pino from "pino";

const logger = pino({ name: "module:meetings:sse" });

class SSEManager {
  /** sessionId → Set of active SSE Response objects */
  private connections: Map<string, Set<Response>> = new Map();

  /**
   * Register a new SSE connection for a meeting session.
   */
  addConnection(sessionId: string, res: Response): void {
    let sessionConns = this.connections.get(sessionId);
    if (!sessionConns) {
      sessionConns = new Set();
      this.connections.set(sessionId, sessionConns);
    }
    sessionConns.add(res);

    logger.info(
      { sessionId, count: sessionConns.size },
      "SSE client connected",
    );
  }

  /**
   * Remove an SSE connection when the client disconnects.
   */
  removeConnection(sessionId: string, res: Response): void {
    const sessionConns = this.connections.get(sessionId);
    if (!sessionConns) return;

    sessionConns.delete(res);

    if (sessionConns.size === 0) {
      this.connections.delete(sessionId);
    }

    logger.info(
      { sessionId, count: sessionConns?.size ?? 0 },
      "SSE client disconnected",
    );
  }

  /**
   * Broadcast an event to all connected clients for a session.
   */
  broadcast(sessionId: string, event: string, data: unknown): void {
    const sessionConns = this.connections.get(sessionId);
    if (!sessionConns || sessionConns.size === 0) return;

    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

    for (const res of sessionConns) {
      try {
        res.write(payload);
      } catch {
        // Client disconnected unexpectedly; remove it
        sessionConns.delete(res);
      }
    }

    logger.debug(
      { sessionId, event, clients: sessionConns.size },
      "SSE broadcast sent",
    );
  }

  /**
   * Get the number of active SSE connections for a session.
   */
  getConnectionCount(sessionId: string): number {
    return this.connections.get(sessionId)?.size ?? 0;
  }

  /**
   * Get total connections across all sessions.
   */
  getTotalConnections(): number {
    let total = 0;
    for (const conns of this.connections.values()) {
      total += conns.size;
    }
    return total;
  }
}

/** Singleton SSE Manager instance */
export const sseManager = new SSEManager();
