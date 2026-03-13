/**
 * GRC Node Client — WinClaw A2A Protocol Client Library
 *
 * Provides both pull-based and push-based (SSE) config sync
 * between WinClaw nodes and the GRC server.
 *
 * Usage:
 *
 * ```ts
 * import { SSEConfigClient, ConfigManager, A2AClient } from "./node-client/index.js";
 *
 * const configManager = new ConfigManager({ configDir: "~/.winclaw/config" });
 *
 * const client = new SSEConfigClient({
 *   serverUrl: "https://grc.myaiportal.net",
 *   nodeId: "207993ecaae5d170...",
 * });
 *
 * client.setCurrentRevision(configManager.currentRevision);
 *
 * client.onConfigReceived(async (config) => {
 *   await configManager.applyConfig(config);
 *   console.log(`Config rev ${config.revision} applied`);
 * });
 *
 * client.on("connected", (nodeId) => console.log(`SSE connected: ${nodeId}`));
 * client.on("config_applied", (rev) => console.log(`Rev ${rev} confirmed`));
 * client.on("error", (err) => console.error("SSE error:", err.message));
 * client.on("reconnecting", (n, d) => console.log(`Reconnect #${n} in ${d}ms`));
 *
 * client.connect();
 * ```
 */

export { A2AClient } from "./a2a-client.js";
export { SSEConfigClient } from "./sse-config-client.js";
export type { SSEConfigClientEvents } from "./sse-config-client.js";
export { ConfigManager } from "./config-manager.js";
export type {
  A2AClientOptions,
  SSEClientOptions,
  ConfigManagerOptions,
  NodeConfig,
  KeyConfig,
  KeyConfigEntry,
  HeartbeatPayload,
  HeartbeatResponse,
  ConfigCheckResponse,
  ConfigPullResponse,
  SSEConnectedEvent,
  SSEConfigUpdateEvent,
} from "./types.js";
