/**
 * SSE Config Client — Real-time config push receiver for WinClaw nodes
 *
 * Connects to GET /a2a/config/stream?node_id=xxx and listens for:
 *   - "connected"       → Connection established
 *   - "config_update"   → New config available (with optional inline payload)
 *   - keepalive pings   → Ignored (connection health check)
 *
 * Features:
 *   - Automatic reconnection with exponential backoff
 *   - EventEmitter pattern for config updates
 *   - Fallback to pull-based config fetch when SSE push lacks full payload
 *   - Reports config_applied_revision to server after successful apply
 */

import { EventEmitter } from "node:events";
import * as http from "node:http";
import * as https from "node:https";
import type {
  SSEClientOptions,
  SSEConfigUpdateEvent,
  NodeConfig,
} from "./types.js";
import { A2AClient } from "./a2a-client.js";

// ── Event Types ─────────────────────────────────

export interface SSEConfigClientEvents {
  connected: [nodeId: string];
  config_update: [config: NodeConfig, reason: string];
  config_applied: [revision: number];
  config_error: [error: Error, revision: number];
  disconnected: [reason: string];
  reconnecting: [attempt: number, delay: number];
  error: [error: Error];
}

// ── SSE Line Parser ─────────────────────────────

interface SSEMessage {
  event: string;
  data: string;
}

class SSEParser {
  private buffer = "";
  private currentEvent = "";
  private currentData: string[] = [];

  constructor(private onMessage: (msg: SSEMessage) => void) {}

  feed(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    // Keep the last incomplete line in the buffer
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      this.processLine(line);
    }
  }

  private processLine(line: string): void {
    // Empty line = end of message
    if (line.trim() === "") {
      if (this.currentData.length > 0 || this.currentEvent) {
        this.onMessage({
          event: this.currentEvent || "message",
          data: this.currentData.join("\n"),
        });
      }
      this.currentEvent = "";
      this.currentData = [];
      return;
    }

    // Comment line (keepalive ping)
    if (line.startsWith(":")) {
      return;
    }

    // Field: value
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) return;

    const field = line.slice(0, colonIndex).trim();
    // Skip leading space after colon per SSE spec
    let value = line.slice(colonIndex + 1);
    if (value.startsWith(" ")) value = value.slice(1);

    switch (field) {
      case "event":
        this.currentEvent = value;
        break;
      case "data":
        this.currentData.push(value);
        break;
    }
  }
}

// ── SSE Config Client ───────────────────────────

export class SSEConfigClient extends EventEmitter<SSEConfigClientEvents> {
  private readonly serverUrl: string;
  private readonly nodeId: string;
  private readonly authToken?: string;
  private readonly reconnectDelay: number;
  private readonly maxReconnectDelay: number;
  private readonly autoReconnect: boolean;
  private readonly a2aClient: A2AClient;

  private currentRequest: http.ClientRequest | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _connected = false;
  private _stopped = false;
  private _currentRevision = 0;

  /** Callback to apply config — set via onConfigReceived() */
  private configHandler:
    | ((config: NodeConfig) => void | Promise<void>)
    | null = null;

  constructor(options: SSEClientOptions) {
    super();
    this.serverUrl = options.serverUrl.replace(/\/+$/, "");
    this.nodeId = options.nodeId;
    this.authToken = options.authToken;
    this.reconnectDelay = options.reconnectDelay ?? 5_000;
    this.maxReconnectDelay = options.maxReconnectDelay ?? 60_000;
    this.autoReconnect = options.autoReconnect ?? true;

    this.a2aClient = new A2AClient({
      serverUrl: options.serverUrl,
      nodeId: options.nodeId,
      authToken: options.authToken,
      timeout: options.timeout,
    });
  }

  // ── Public API ────────────────────────────────

  /** Current applied config revision */
  get currentRevision(): number {
    return this._currentRevision;
  }

  /** Whether SSE connection is active */
  get connected(): boolean {
    return this._connected;
  }

  /** Set the initial known config revision (e.g. from disk cache) */
  setCurrentRevision(rev: number): void {
    this._currentRevision = rev;
  }

  /**
   * Register a handler for incoming config updates.
   * This is called when a config_update event is received and
   * the config payload has been resolved (either inline or via pull).
   */
  onConfigReceived(handler: (config: NodeConfig) => void | Promise<void>): void {
    this.configHandler = handler;
  }

  /**
   * Start the SSE connection. Reconnects automatically on disconnect.
   */
  connect(): void {
    this._stopped = false;
    this.reconnectAttempt = 0;
    this.doConnect();
  }

  /**
   * Gracefully disconnect and stop reconnection.
   */
  disconnect(): void {
    this._stopped = true;
    this._connected = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.currentRequest) {
      this.currentRequest.destroy();
      this.currentRequest = null;
    }
  }

  /**
   * Manually trigger a config pull from the server.
   * Useful as a fallback or for initial sync.
   */
  async pullConfig(): Promise<NodeConfig> {
    const resp = await this.a2aClient.configPull();
    const config: NodeConfig = {
      revision: resp.revision,
      role_id: resp.role_id,
      role_mode: resp.role_mode,
      files: resp.files,
      key_config: resp.key_config,
    };
    return config;
  }

  /**
   * Report config applied revision to the server.
   */
  async reportApplied(revision: number): Promise<void> {
    await this.a2aClient.configStatus(revision, true);
  }

  // ── Internal Connection Logic ─────────────────

  private doConnect(): void {
    if (this._stopped) return;

    const streamUrl = `${this.serverUrl}/a2a/config/stream?node_id=${encodeURIComponent(this.nodeId)}`;
    const parsed = new URL(streamUrl);
    const isHttps = parsed.protocol === "https:";
    const transport = isHttps ? https : http;

    const reqOptions: http.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: `${parsed.pathname}${parsed.search}`,
      method: "GET",
      headers: {
        Accept: "text/event-stream",
        "Cache-Control": "no-cache",
        ...(this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {}),
      },
    };

    const parser = new SSEParser((msg) => this.handleSSEMessage(msg));

    const req = transport.request(reqOptions, (res) => {
      if (res.statusCode !== 200) {
        const err = new Error(`SSE connection failed: HTTP ${res.statusCode}`);
        this.emit("error", err);
        res.resume(); // drain
        this.scheduleReconnect();
        return;
      }

      res.setEncoding("utf-8");

      res.on("data", (chunk: string) => {
        parser.feed(chunk);
      });

      res.on("end", () => {
        this._connected = false;
        this.emit("disconnected", "stream_ended");
        this.scheduleReconnect();
      });

      res.on("error", (err) => {
        this._connected = false;
        this.emit("error", err);
        this.emit("disconnected", "stream_error");
        this.scheduleReconnect();
      });
    });

    req.on("error", (err) => {
      this._connected = false;
      this.emit("error", err);
      this.scheduleReconnect();
    });

    req.end();
    this.currentRequest = req;
  }

  private handleSSEMessage(msg: SSEMessage): void {
    switch (msg.event) {
      case "connected": {
        this._connected = true;
        this.reconnectAttempt = 0;
        try {
          const data = JSON.parse(msg.data) as { node_id: string };
          this.emit("connected", data.node_id);
        } catch {
          this.emit("connected", this.nodeId);
        }
        break;
      }

      case "config_update": {
        this.handleConfigUpdate(msg.data).catch((err) => {
          this.emit("error", err instanceof Error ? err : new Error(String(err)));
        });
        break;
      }

      default:
        // Unknown event — ignore (e.g. keepalive handled by parser)
        break;
    }
  }

  private async handleConfigUpdate(rawData: string): Promise<void> {
    let event: SSEConfigUpdateEvent;
    try {
      event = JSON.parse(rawData) as SSEConfigUpdateEvent;
    } catch (err) {
      this.emit("error", new Error(`Failed to parse config_update: ${err}`));
      return;
    }

    // Skip if already at this revision or newer
    if (event.revision <= this._currentRevision) {
      return;
    }

    let config: NodeConfig;

    if (event.config) {
      // Full config payload included — use it directly
      config = {
        revision: event.revision,
        role_id: event.config.role_id,
        role_mode: event.config.role_mode,
        files: event.config.files,
        key_config: event.config.key_config,
      };
    } else {
      // Only notification — need to pull full config
      try {
        config = await this.pullConfig();
      } catch (err) {
        this.emit("error", new Error(`Failed to pull config after SSE notification: ${err}`));
        return;
      }
    }

    // Emit the config update event
    this.emit("config_update", config, event.reason);

    // Call the registered config handler
    if (this.configHandler) {
      try {
        await this.configHandler(config);
        this._currentRevision = config.revision;

        // Report successful application to server
        try {
          await this.reportApplied(config.revision);
          this.emit("config_applied", config.revision);
        } catch (err) {
          // Non-fatal: server status report failed but config was applied locally
          this.emit("error", new Error(`Failed to report config status: ${err}`));
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        this.emit("config_error", error, config.revision);
      }
    }
  }

  private scheduleReconnect(): void {
    if (this._stopped || !this.autoReconnect) return;

    this.reconnectAttempt++;
    // Exponential backoff: delay * 2^(attempt-1), capped at maxReconnectDelay
    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempt - 1),
      this.maxReconnectDelay,
    );

    this.emit("reconnecting", this.reconnectAttempt, delay);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.doConnect();
    }, delay);
  }
}
