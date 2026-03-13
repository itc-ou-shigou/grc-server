#!/usr/bin/env node
/**
 * GRC Node Config Sync — Standalone runner
 *
 * Run on a WinClaw / Daytona sandbox node to:
 *   1. Connect to GRC server via SSE for real-time config push
 *   2. Apply received config (role files + LLM API keys) to local disk
 *   3. Report config_applied_revision back to server
 *   4. Auto-reconnect on disconnect with exponential backoff
 *
 * Environment variables:
 *   GRC_SERVER_URL  — GRC server URL (default: http://localhost:3100)
 *   GRC_NODE_ID     — This node's unique ID (required)
 *   GRC_AUTH_TOKEN   — JWT token for authenticated endpoints (optional)
 *   GRC_CONFIG_DIR  — Local config directory (default: ~/.winclaw/grc-config)
 *
 * Usage:
 *   npx tsx src/node-client/run.ts
 *   # or
 *   GRC_SERVER_URL=https://grc.myaiportal.net GRC_NODE_ID=207993ec... node dist/node-client/run.js
 */

import * as path from "node:path";
import * as os from "node:os";
import { SSEConfigClient } from "./sse-config-client.js";
import { ConfigManager } from "./config-manager.js";

// ── Configuration ───────────────────────────────

const SERVER_URL = process.env.GRC_SERVER_URL || "http://localhost:3100";
const NODE_ID = process.env.GRC_NODE_ID;
const AUTH_TOKEN = process.env.GRC_AUTH_TOKEN;
const CONFIG_DIR = process.env.GRC_CONFIG_DIR || path.join(os.homedir(), ".winclaw", "grc-config");

if (!NODE_ID) {
  console.error("ERROR: GRC_NODE_ID environment variable is required");
  console.error("  Set it to your node's unique SHA-256 identifier.");
  console.error("  Example: GRC_NODE_ID=207993ecaae5d170... npx tsx src/node-client/run.ts");
  process.exit(1);
}

// ── Initialize ──────────────────────────────────

console.log("=== GRC Node Config Sync ===");
console.log(`  Server:     ${SERVER_URL}`);
console.log(`  Node ID:    ${NODE_ID.slice(0, 16)}...`);
console.log(`  Config Dir: ${CONFIG_DIR}`);
console.log(`  Auth:       ${AUTH_TOKEN ? "JWT token provided" : "No auth (unauthenticated)"}`);
console.log("");

const configManager = new ConfigManager({
  configDir: CONFIG_DIR,
  onConfigApplied: (config) => {
    console.log(`  [ConfigManager] Applied revision ${config.revision}`);
    console.log(`    Role: ${config.role_id ?? "(none)"} / mode: ${config.role_mode ?? "(none)"}`);
    console.log(`    Files: ${Object.keys(config.files).join(", ") || "(none)"}`);
    if (config.key_config) {
      const p = config.key_config.primary;
      const a = config.key_config.auxiliary;
      console.log(`    Primary key:   ${p ? `${p.provider}/${p.model}` : "(none)"}`);
      console.log(`    Auxiliary key:  ${a ? `${a.provider}/${a.model}` : "(none)"}`);
    }
  },
  onConfigError: (error) => {
    console.error(`  [ConfigManager] Failed to apply config:`, error.message);
  },
});

console.log(`  Loaded state: revision=${configManager.currentRevision}`);

const client = new SSEConfigClient({
  serverUrl: SERVER_URL,
  nodeId: NODE_ID,
  authToken: AUTH_TOKEN,
  reconnectDelay: 5_000,
  maxReconnectDelay: 60_000,
});

// Restore known revision from disk
client.setCurrentRevision(configManager.currentRevision);

// ── Event Handlers ──────────────────────────────

client.onConfigReceived(async (config) => {
  await configManager.applyConfig(config);
});

client.on("connected", (nodeId) => {
  console.log(`[SSE] Connected — node: ${nodeId.slice(0, 16)}...`);
});

client.on("config_update", (config, reason) => {
  console.log(`[SSE] Config update received — rev: ${config.revision}, reason: ${reason}`);
});

client.on("config_applied", (revision) => {
  console.log(`[SSE] Config revision ${revision} confirmed to server`);
});

client.on("config_error", (error, revision) => {
  console.error(`[SSE] Config apply failed — rev: ${revision}, error: ${error.message}`);
});

client.on("disconnected", (reason) => {
  console.warn(`[SSE] Disconnected — reason: ${reason}`);
});

client.on("reconnecting", (attempt, delay) => {
  console.log(`[SSE] Reconnecting — attempt #${attempt} in ${delay}ms`);
});

client.on("error", (error) => {
  console.error(`[SSE] Error: ${error.message}`);
});

// ── Start ───────────────────────────────────────

client.connect();
console.log("[SSE] Connecting...\n");

// ── Graceful shutdown ───────────────────────────

function shutdown(signal: string): void {
  console.log(`\n[${signal}] Shutting down...`);
  client.disconnect();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
