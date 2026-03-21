/**
 * Module Loader — Modular Monolith Dynamic Registration
 *
 * Each module exports a `register(app, config)` function.
 * Admin modules export a `registerAdmin(app, config)` function.
 * The loader conditionally mounts modules based on environment toggles.
 */

import type { Express } from "express";
import type { GrcConfig } from "./config.js";
import pino from "pino";

const logger = pino({ name: "module-loader" });

export interface GrcModule {
  name: string;
  register: (app: Express, config: GrcConfig) => Promise<void>;
}

export interface GrcAdminModule {
  registerAdmin: (app: Express, config: GrcConfig) => Promise<void>;
}

export interface AdminModuleStatus {
  module: string;
  adminLoaded: boolean;
  error?: string;
}

/** Tracks which admin modules loaded successfully vs failed. */
const adminModuleStatuses: AdminModuleStatus[] = [];

/** Returns the load status for all admin modules. */
export function getAdminModuleStatuses(): AdminModuleStatus[] {
  return [...adminModuleStatuses];
}

/**
 * Loads and registers all enabled modules onto the Express app.
 * Modules are loaded dynamically so that disabled modules are never imported.
 * After each module's main routes are loaded, admin routes are also loaded.
 */
export async function loadModules(
  app: Express,
  config: GrcConfig,
): Promise<string[]> {
  const moduleMap: Record<string, () => Promise<GrcModule>> = {
    auth: () =>
      import("./modules/auth/routes.js").then((m) => ({
        name: "auth",
        register: m.register,
      })),
    clawhub: () =>
      import("./modules/clawhub/routes.js").then((m) => ({
        name: "clawhub",
        register: m.register,
      })),
    evolution: () =>
      import("./modules/evolution/routes.js").then((m) => ({
        name: "evolution",
        register: m.register,
      })),
    update: () =>
      import("./modules/update/routes.js").then((m) => ({
        name: "update",
        register: m.register,
      })),
    telemetry: () =>
      import("./modules/telemetry/routes.js").then((m) => ({
        name: "telemetry",
        register: m.register,
      })),
    community: () =>
      import("./modules/community/routes.js").then((m) => ({
        name: "community",
        register: m.register,
      })),
    platform: () =>
      import("./modules/platform/routes.js").then((m) => ({
        name: "platform",
        register: m.register,
      })),
    roles: () =>
      import("./modules/roles/routes.js").then((m) => ({
        name: "roles",
        register: m.register,
      })),
    tasks: () =>
      import("./modules/tasks/routes.js").then((m) => ({
        name: "tasks",
        register: m.register,
      })),
    relay: () =>
      import("./modules/relay/routes.js").then((m) => ({
        name: "relay",
        register: m.register,
      })),
    strategy: () =>
      import("./modules/strategy/routes.js").then((m) => ({
        name: "strategy",
        register: m.register,
      })),
    "a2a-gateway": () =>
      import("./modules/a2a-gateway/routes.js").then((m) => ({
        name: "a2a-gateway",
        register: m.register,
      })),
    meetings: () =>
      import("./modules/meetings/routes.js").then((m) => ({
        name: "meetings",
        register: m.register,
      })),
    "model-keys": () =>
      import("./modules/model-keys/routes.js").then((m) => ({
        name: "model-keys",
        register: m.register,
      })),
    messaging: () =>
      import("./modules/messaging/routes.js").then((m) => ({
        name: "messaging",
        register: m.register,
      })),
    orchestrator: () =>
      import("./modules/orchestrator/routes.js").then((m) => ({
        name: "orchestrator",
        register: m.register,
      })),
  };

  const adminModuleMap: Record<
    string,
    () => Promise<GrcAdminModule>
  > = {
    auth: () => import("./modules/auth/admin-routes.js"),
    clawhub: () => import("./modules/clawhub/admin-routes.js"),
    evolution: () => import("./modules/evolution/admin-routes.js"),
    update: () => import("./modules/update/admin-routes.js"),
    telemetry: () => import("./modules/telemetry/admin-routes.js"),
    community: () => import("./modules/community/admin-routes.js"),
    platform: () => import("./modules/platform/admin-routes.js"),
    roles: () => import("./modules/roles/admin-routes.js"),
    tasks: () => import("./modules/tasks/admin-routes.js"),
    relay: () => import("./modules/relay/admin-routes.js"),
    strategy: () => import("./modules/strategy/admin-routes.js"),
    "a2a-gateway": () => import("./modules/a2a-gateway/admin-routes.js"),
    meetings: () => import("./modules/meetings/admin-routes.js"),
    "model-keys": () => import("./modules/model-keys/admin-routes.js"),
    orchestrator: () => import("./modules/orchestrator/admin-routes.js"),
  };

  const loaded: string[] = [];

  for (const [key, loader] of Object.entries(moduleMap)) {
    const enabled = config.modules[key as keyof typeof config.modules];
    if (!enabled) {
      logger.info({ module: key }, "Module disabled — skipping");
      continue;
    }

    try {
      const mod = await loader();
      await mod.register(app, config);
      loaded.push(key);
      logger.info({ module: key }, "Module loaded successfully");
    } catch (err) {
      logger.error({ module: key, err }, "Failed to load module");
      // In Modular Monolith, one module failure should NOT crash the entire server.
      // Log the error and continue loading other modules.
      continue;
    }

    // After loading the main module routes, also load admin routes
    const adminLoader = adminModuleMap[key];
    if (adminLoader) {
      try {
        const adminMod = await adminLoader();
        await adminMod.registerAdmin(app, config);
        adminModuleStatuses.push({ module: key, adminLoaded: true });
        logger.info({ module: key }, "Admin routes loaded successfully");
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        adminModuleStatuses.push({ module: key, adminLoaded: false, error: errMsg });
        logger.error({ module: key, err }, "Failed to load admin routes");
        // Admin route failure should not prevent the main module from functioning
      }
    }
  }

  return loaded;
}
