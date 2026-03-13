/**
 * Node Client Types — Shared interfaces for WinClaw A2A protocol
 */

// ── Key Config ─────────────────────────────────

export interface KeyConfigEntry {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
}

export interface KeyConfig {
  primary: KeyConfigEntry | null;
  auxiliary: KeyConfigEntry | null;
}

// ── Config Payload (from /a2a/config/pull or SSE push) ──

export interface NodeConfig {
  revision: number;
  role_id: string | null;
  role_mode: string | null;
  files: Record<string, string>;
  key_config: KeyConfig | null;
}

// ── SSE Events ─────────────────────────────────

export interface SSEConnectedEvent {
  node_id: string;
}

export interface SSEConfigUpdateEvent {
  revision: number;
  reason: string;
  config?: {
    role_id: string | null;
    role_mode: string | null;
    files: Record<string, string>;
    key_config: KeyConfig | null;
  };
}

// ── A2A Client Options ─────────────────────────

export interface A2AClientOptions {
  /** GRC server base URL (e.g. "https://grc.myaiportal.net" or "http://localhost:3100") */
  serverUrl: string;
  /** This node's unique ID (SHA-256 hash) */
  nodeId: string;
  /** Optional JWT token for authenticated endpoints */
  authToken?: string;
  /** Request timeout in ms (default: 15000) */
  timeout?: number;
}

// ── SSE Client Options ─────────────────────────

export interface SSEClientOptions extends A2AClientOptions {
  /** Reconnect delay in ms after disconnect (default: 5000) */
  reconnectDelay?: number;
  /** Max reconnect delay in ms with exponential backoff (default: 60000) */
  maxReconnectDelay?: number;
  /** Auto-reconnect on disconnect (default: true) */
  autoReconnect?: boolean;
}

// ── Config Manager Options ─────────────────────

export interface ConfigManagerOptions {
  /** Directory to write config files into (e.g. ~/.winclaw/config/) */
  configDir: string;
  /** Callback when config is applied successfully */
  onConfigApplied?: (config: NodeConfig) => void | Promise<void>;
  /** Callback when config application fails */
  onConfigError?: (error: Error, config: NodeConfig) => void | Promise<void>;
}

// ── Heartbeat Payload ──────────────────────────

export interface HeartbeatPayload {
  node_id: string;
  gene_count?: number;
  platform?: string;
  winclaw_version?: string;
  env_fingerprint?: string;
  capabilities?: Record<string, unknown>;
  employee_id?: string;
  employee_name?: string;
  employee_email?: string;
  current_revision?: number;
}

// ── Heartbeat Response ─────────────────────────

export interface HeartbeatResponse {
  ok: boolean;
  node_id: string;
  heartbeat: boolean;
  node: Record<string, unknown>;
  config_update?: NodeConfig;
}

// ── Config Check Response ──────────────────────

export interface ConfigCheckResponse {
  ok: boolean;
  has_update: boolean;
  latest_revision: number;
  role_id: string | null;
}

// ── Config Pull Response ───────────────────────

export interface ConfigPullResponse {
  ok: boolean;
  revision: number;
  role_id: string | null;
  role_mode: string | null;
  files: Record<string, string>;
  key_config: KeyConfig | null;
}
