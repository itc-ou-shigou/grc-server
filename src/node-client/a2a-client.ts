/**
 * A2A HTTP Client — WinClaw node → GRC server communication
 *
 * Handles all pull-based A2A protocol calls:
 *   POST /a2a/hello        — Node registration
 *   POST /a2a/heartbeat    — Periodic heartbeat (with inline config)
 *   GET  /a2a/config/check — Check for config updates
 *   GET  /a2a/config/pull  — Pull full config
 *   POST /a2a/config/status — Report config applied revision
 */

import type {
  A2AClientOptions,
  HeartbeatPayload,
  HeartbeatResponse,
  ConfigCheckResponse,
  ConfigPullResponse,
} from "./types.js";

export class A2AClient {
  private readonly serverUrl: string;
  private readonly nodeId: string;
  private readonly authToken?: string;
  private readonly timeout: number;

  constructor(options: A2AClientOptions) {
    // Strip trailing slash
    this.serverUrl = options.serverUrl.replace(/\/+$/, "");
    this.nodeId = options.nodeId;
    this.authToken = options.authToken;
    this.timeout = options.timeout ?? 15_000;
  }

  // ── HTTP Helpers ──────────────────────────────

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (this.authToken) {
      h["Authorization"] = `Bearer ${this.authToken}`;
    }
    return h;
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: Record<string, unknown>,
    query?: Record<string, string>,
  ): Promise<T> {
    let url = `${this.serverUrl}${path}`;
    if (query) {
      const params = new URLSearchParams(query);
      url += `?${params.toString()}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const res = await fetch(url, {
        method,
        headers: this.headers(),
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`A2A ${method} ${path} failed: ${res.status} ${text}`);
      }

      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  // ── A2A Endpoints ─────────────────────────────

  /**
   * Register this node with the GRC server.
   */
  async hello(payload?: Partial<HeartbeatPayload>): Promise<HeartbeatResponse> {
    return this.request<HeartbeatResponse>("POST", "/a2a/hello", {
      node_id: this.nodeId,
      ...payload,
    });
  }

  /**
   * Send heartbeat. If current_revision is provided and server has
   * a newer config, the response includes config_update inline.
   */
  async heartbeat(
    currentRevision?: number,
    payload?: Partial<HeartbeatPayload>,
  ): Promise<HeartbeatResponse> {
    return this.request<HeartbeatResponse>("POST", "/a2a/heartbeat", {
      node_id: this.nodeId,
      current_revision: currentRevision,
      ...payload,
    });
  }

  /**
   * Check if a config update is available without downloading it.
   */
  async configCheck(currentRevision: number): Promise<ConfigCheckResponse> {
    return this.request<ConfigCheckResponse>("GET", "/a2a/config/check", undefined, {
      node_id: this.nodeId,
      current_revision: String(currentRevision),
    });
  }

  /**
   * Pull the full config from the server.
   */
  async configPull(): Promise<ConfigPullResponse> {
    return this.request<ConfigPullResponse>("GET", "/a2a/config/pull", undefined, {
      node_id: this.nodeId,
    });
  }

  /**
   * Report that a config revision has been successfully applied.
   */
  async configStatus(revision: number, applied: boolean): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>("POST", "/a2a/config/status", {
      node_id: this.nodeId,
      revision,
      applied,
    });
  }
}
