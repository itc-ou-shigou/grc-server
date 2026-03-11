/**
 * Evolution Pool Module — A2A Protocol Routes
 *
 * Endpoints for Gene/Capsule sharing via the Agent-to-Agent protocol.
 * Compatible with the existing WinClaw A2A client (hubSearch.js).
 */

import { Router } from "express";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import pino from "pino";
import type { GrcConfig } from "../../config.js";
import { createAuthMiddleware, requireScopes } from "../../shared/middleware/auth.js";
import { createAdminAuthMiddleware } from "../../shared/middleware/admin-auth.js";
import {
  asyncHandler,
  BadRequestError,
  NotFoundError,
} from "../../shared/middleware/error-handler.js";
import { rateLimitMiddleware } from "../../shared/middleware/rate-limit.js";
import {
  a2aHelloSchema,
  a2aPublishSchema,
  a2aSearchSchema,
  nodeIdSchema,
} from "../../shared/utils/validators.js";
import { EvolutionService, upsertNode } from "./service.js";
import { nodeConfigSSE } from "./node-config-sse.js";
import { RolesService } from "../roles/service.js";

const logger = pino({ name: "module:evolution" });

// ── Request Validation Schemas ──────────────────

const a2aFetchSchema = z.object({
  asset_id: z.string().min(1).optional(),
  content_hash: z.string().min(1).optional(),
}).refine(
  (data) => data.asset_id || data.content_hash,
  { message: "Either asset_id or content_hash must be provided" },
);

const a2aReportSchema = z.object({
  asset_id: z.string().min(1),
  reporter_node_id: nodeIdSchema,
  success: z.boolean(),
  report_data: z.record(z.unknown()).optional(),
});

const a2aDecisionSchema = z.object({
  asset_id: z.string().min(1),
  decision: z.enum(["approved", "quarantined"]),
  reason: z.string().optional(),
});

const a2aRevokeSchema = z.object({
  asset_id: z.string().min(1),
  node_id: nodeIdSchema,
});

const trendingQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

// ── Module Registration ─────────────────────────

export async function register(app: Express, config: GrcConfig): Promise<void> {
  const router = Router();
  const service = new EvolutionService();
  const rolesService = new RolesService();
  const authOptional = createAuthMiddleware(config, false);
  const authRequired = createAuthMiddleware(config, true);
  const adminAuth = createAdminAuthMiddleware(config);

  // ────────────────────────────────────────────
  // POST /a2a/hello — Node registration/heartbeat
  // ────────────────────────────────────────────
  router.post(
    "/hello",
    authOptional,
    asyncHandler(async (req: Request, res: Response) => {
      const body = a2aHelloSchema.parse(req.body);

      const node = await upsertNode({
        nodeId: body.node_id,
        capabilities: body.capabilities as Record<string, unknown> | undefined,
        geneCount: body.gene_count,
        envFingerprint: body.env_fingerprint,
        platform: body.platform,
        winclawVersion: body.winclaw_version,
        employeeId: body.employee_id,
        employeeName: body.employee_name,
        employeeEmail: body.employee_email,
      });

      logger.debug({ nodeId: body.node_id }, "Hello received");

      res.json({
        ok: true,
        node_id: body.node_id,
        registered: true,
        node,
      });
    }),
  );

  // ────────────────────────────────────────────
  // POST /a2a/heartbeat — Alias for hello
  // Now includes pending config if revision mismatch detected
  // ────────────────────────────────────────────
  router.post(
    "/heartbeat",
    authOptional,
    asyncHandler(async (req: Request, res: Response) => {
      const body = a2aHelloSchema.parse(req.body);

      const node = await upsertNode({
        nodeId: body.node_id,
        capabilities: body.capabilities as Record<string, unknown> | undefined,
        geneCount: body.gene_count,
        envFingerprint: body.env_fingerprint,
        platform: body.platform,
        winclawVersion: body.winclaw_version,
        employeeId: body.employee_id,
        employeeName: body.employee_name,
        employeeEmail: body.employee_email,
      });

      // Check if there's a pending config update — push it inline
      let pendingConfig = null;
      try {
        const nodeConfig = await rolesService.getNodeConfig(body.node_id);
        const clientRevision = (body as Record<string, unknown>).current_revision as number | undefined;
        if (clientRevision !== undefined && nodeConfig.revision > clientRevision) {
          pendingConfig = {
            revision: nodeConfig.revision,
            role_id: nodeConfig.roleId,
            role_mode: nodeConfig.roleMode,
            files: nodeConfig.files,
            key_config: nodeConfig.key_config,
          };
        }
      } catch {
        // Node may not exist yet in config context; ignore
      }

      res.json({
        ok: true,
        node_id: body.node_id,
        heartbeat: true,
        node,
        ...(pendingConfig ? { config_update: pendingConfig } : {}),
      });
    }),
  );

  // ────────────────────────────────────────────
  // POST /a2a/publish — Publish Gene or Capsule
  // ────────────────────────────────────────────
  router.post(
    "/publish",
    authRequired,
    rateLimitMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const body = a2aPublishSchema.parse(req.body);

      const asset = await service.publishAsset({
        nodeId: body.node_id,
        assetType: body.asset_type,
        assetId: body.asset_id,
        contentHash: body.content_hash,
        payload: body.payload,
        signature: body.signature,
      });

      res.status(201).json({
        ok: true,
        asset,
      });
    }),
  );

  // ────────────────────────────────────────────
  // POST /a2a/fetch — Fetch asset by ID or hash
  // ────────────────────────────────────────────
  router.post(
    "/fetch",
    authOptional,
    asyncHandler(async (req: Request, res: Response) => {
      const body = a2aFetchSchema.parse(req.body);

      const key = body.asset_id ?? body.content_hash!;
      const asset = await service.fetchAsset(key);

      if (!asset) {
        throw new NotFoundError("Asset");
      }

      // Record the fetch (increment use_count) only from the A2A endpoint
      await service.recordAssetFetch(key);

      res.json({
        ok: true,
        asset,
      });
    }),
  );

  // ────────────────────────────────────────────
  // POST /a2a/report — Receive usage report
  // ────────────────────────────────────────────
  router.post(
    "/report",
    authRequired,
    rateLimitMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const body = a2aReportSchema.parse(req.body);

      const result = await service.reportUsageFull({
        assetId: body.asset_id,
        reporterNodeId: body.reporter_node_id,
        success: body.success,
        reportData: body.report_data,
      });

      res.json({
        ok: true,
        asset_id: body.asset_id,
        use_count: result.asset.useCount,
        success_rate: result.asset.successRate,
        status: result.asset.status,
        promotion_check: result.promotionResult,
      });
    }),
  );

  // ────────────────────────────────────────────
  // POST /a2a/decision — Admin decision on asset
  // ────────────────────────────────────────────
  router.post(
    "/decision",
    authRequired,
    adminAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const body = a2aDecisionSchema.parse(req.body);

      await service.updateStatus(
        body.asset_id,
        body.decision,
        body.reason,
      );

      res.json({
        ok: true,
        asset_id: body.asset_id,
        decision: body.decision,
        reason: body.reason ?? null,
      });
    }),
  );

  // ────────────────────────────────────────────
  // POST /a2a/revoke — Revoke a published asset
  // ────────────────────────────────────────────
  router.post(
    "/revoke",
    authRequired,
    asyncHandler(async (req: Request, res: Response) => {
      const body = a2aRevokeSchema.parse(req.body);

      await service.revokeAsset(body.asset_id, body.node_id);

      res.json({
        ok: true,
        asset_id: body.asset_id,
        revoked: true,
      });
    }),
  );

  // ────────────────────────────────────────────
  // GET /a2a/assets/search — Search assets
  // Compatible with: ?signals=error,timeout&status=promoted&limit=20
  // ────────────────────────────────────────────
  router.get(
    "/assets/search",
    authOptional,
    asyncHandler(async (req: Request, res: Response) => {
      // Parse signals from comma-separated string (hubSearch.js client format)
      const rawSignals = req.query.signals as string | undefined;
      const signals = rawSignals
        ? rawSignals.split(",").map((s) => s.trim()).filter(Boolean)
        : undefined;

      const parsed = a2aSearchSchema.parse({
        signals,
        status: req.query.status,
        limit: req.query.limit,
        offset: req.query.offset,
      });

      const result = await service.searchAssets({
        signals: parsed.signals,
        status: parsed.status,
        limit: parsed.limit,
        offset: parsed.offset,
      });

      res.json({
        ok: true,
        assets: result.assets,
        total: result.total,
        limit: parsed.limit,
        offset: parsed.offset,
      });
    }),
  );

  // ────────────────────────────────────────────
  // GET /a2a/assets/trending — Top assets by use_count
  // ────────────────────────────────────────────
  router.get(
    "/assets/trending",
    authOptional,
    asyncHandler(async (req: Request, res: Response) => {
      const { limit } = trendingQuerySchema.parse(req.query);
      const assets = await service.getTrending(limit);

      res.json({
        ok: true,
        assets,
        limit,
      });
    }),
  );

  // ────────────────────────────────────────────
  // GET /a2a/assets/stats — Statistics overview
  // ────────────────────────────────────────────
  router.get(
    "/assets/stats",
    authOptional,
    asyncHandler(async (_req: Request, res: Response) => {
      const stats = await service.getStats();

      res.json({
        ok: true,
        stats,
      });
    }),
  );

  // ────────────────────────────────────────────
  // GET /a2a/config/stream — SSE stream for real-time config push
  // Node connects once; server pushes config_update events.
  // ────────────────────────────────────────────
  router.get(
    "/config/stream",
    authOptional,
    asyncHandler(async (req: Request, res: Response) => {
      const nodeId = req.query.node_id as string;
      if (!nodeId || nodeId.length < 10) {
        res.status(400).json({ ok: false, error: "node_id query parameter required" });
        return;
      }

      // Set SSE headers
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no", // Nginx: disable proxy buffering
      });

      // Send initial connected event
      res.write(`event: connected\ndata: ${JSON.stringify({ node_id: nodeId })}\n\n`);

      // If there's a pending config, push it immediately on connect
      try {
        const nodeConfig = await rolesService.getNodeConfig(nodeId);
        // Always send current config on SSE connect so node gets latest state
        const initEvent = {
          revision: nodeConfig.revision,
          reason: "sse_connect",
          config: {
            role_id: nodeConfig.roleId,
            role_mode: nodeConfig.roleMode,
            files: nodeConfig.files,
            key_config: nodeConfig.key_config,
          },
        };
        res.write(`event: config_update\ndata: ${JSON.stringify(initEvent)}\n\n`);
      } catch {
        // Node not found in DB — that's okay, it may register later
      }

      // Register SSE connection
      nodeConfigSSE.addConnection(nodeId, res);

      // Clean up on disconnect
      req.on("close", () => {
        nodeConfigSSE.removeConnection(nodeId, res);
      });
    }),
  );

  // ────────────────────────────────────────────
  // GET /a2a/config/stream/stats — SSE connection stats (admin)
  // ────────────────────────────────────────────
  router.get(
    "/config/stream/stats",
    authRequired,
    adminAuth,
    asyncHandler(async (_req: Request, res: Response) => {
      const stats = nodeConfigSSE.getStats();
      res.json({
        ok: true,
        ...stats,
        connected_nodes: nodeConfigSSE.getConnectedNodeIds(),
      });
    }),
  );

  // ── Mount router under /a2a prefix ────────
  app.use("/a2a", router);

  logger.info("Evolution Pool module registered — 12 A2A endpoints active (incl. SSE)");
}
