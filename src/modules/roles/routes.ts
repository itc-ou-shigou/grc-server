/**
 * Roles Module — A2A Protocol Routes (Agent-Facing)
 *
 * Endpoints for WinClaw clients to check/pull/report role configuration.
 * Mounted under /a2a prefix alongside evolution routes.
 */

import { Router } from "express";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import pino from "pino";
import type { GrcConfig } from "../../config.js";
import { createAuthMiddleware } from "../../shared/middleware/auth.js";
import {
  asyncHandler,
  NotFoundError,
} from "../../shared/middleware/error-handler.js";
import { nodeIdSchema } from "../../shared/utils/validators.js";
import { getDb } from "../../shared/db/connection.js";
import { eq } from "drizzle-orm";
import { nodesTable } from "./schema.js";
import { RolesService } from "./service.js";

const logger = pino({ name: "module:roles" });

// ── Request Validation Schemas ──────────────────

const configCheckQuerySchema = z.object({
  node_id: nodeIdSchema,
  current_revision: z.coerce.number().int().min(0).default(0),
});

const configPullQuerySchema = z.object({
  node_id: nodeIdSchema,
});

const configStatusSchema = z.object({
  node_id: nodeIdSchema,
  revision: z.number().int().min(0),
  applied: z.boolean(),
});

// ── Module Registration ─────────────────────────

export async function register(app: Express, config: GrcConfig): Promise<void> {
  const router = Router();
  const service = new RolesService();
  const authOptional = createAuthMiddleware(config, false);
  const authRequired = createAuthMiddleware(config, true);

  // ────────────────────────────────────────────
  // GET /a2a/config/check — Check if config update available
  // Query: ?node_id=xxx&current_revision=3
  // ────────────────────────────────────────────
  router.get(
    "/config/check",
    authOptional,
    asyncHandler(async (req: Request, res: Response) => {
      const query = configCheckQuerySchema.parse(req.query);

      const nodeConfig = await service.getNodeConfig(query.node_id);

      const hasUpdate = nodeConfig.revision > query.current_revision;

      res.json({
        ok: true,
        has_update: hasUpdate,
        latest_revision: nodeConfig.revision,
        role_id: nodeConfig.roleId,
      });
    }),
  );

  // ────────────────────────────────────────────
  // GET /a2a/config/pull — Pull full resolved config
  // Query: ?node_id=xxx
  // ────────────────────────────────────────────
  router.get(
    "/config/pull",
    authOptional,
    asyncHandler(async (req: Request, res: Response) => {
      const query = configPullQuerySchema.parse(req.query);

      const nodeConfig = await service.getNodeConfig(query.node_id);

      res.json({
        ok: true,
        revision: nodeConfig.revision,
        role_id: nodeConfig.roleId,
        role_mode: nodeConfig.roleMode,
        files: nodeConfig.files,
        key_config: nodeConfig.key_config,
      });
    }),
  );

  // ────────────────────────────────────────────
  // POST /a2a/config/status — Report config apply status
  // Body: { node_id, revision, applied: true }
  // ────────────────────────────────────────────
  router.post(
    "/config/status",
    authOptional,
    asyncHandler(async (req: Request, res: Response) => {
      const body = configStatusSchema.parse(req.body);

      // Update node config_applied_revision column
      const db = getDb();

      const nodeRows = await db
        .select()
        .from(nodesTable)
        .where(eq(nodesTable.nodeId, body.node_id))
        .limit(1);

      if (nodeRows.length === 0) {
        throw new NotFoundError("Node");
      }

      const node = nodeRows[0]!;
      const currentRevision = node.configRevision ?? 0;

      // Only mark as applied if the reported revision matches or exceeds current
      if (body.revision >= currentRevision && body.applied) {
        await db
          .update(nodesTable)
          .set({
            configAppliedRevision: body.revision,
          })
          .where(eq(nodesTable.nodeId, body.node_id));

        logger.info(
          { nodeId: body.node_id, revision: body.revision },
          "Config apply status reported",
        );
      }

      res.json({ ok: true });
    }),
  );

  // ── Mount router under /a2a prefix ────────
  app.use("/a2a", router);

  logger.info("Roles module registered — 3 A2A config endpoints active");
}
