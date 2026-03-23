/**
 * Evolution Module — Admin Routes
 *
 * Provides admin-only management endpoints for genes, capsules, nodes, and asset reports.
 * All routes require JWT authentication + admin role.
 */

import { Router } from "express";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { eq, desc, sql, and, inArray, count } from "drizzle-orm";
import path from "node:path";
import fs from "node:fs";
import pino from "pino";
import type { GrcConfig } from "../../config.js";
import { createAuthMiddleware } from "../../shared/middleware/auth.js";
import { createAdminAuthMiddleware } from "../../shared/middleware/admin-auth.js";
import { asyncHandler, NotFoundError } from "../../shared/middleware/error-handler.js";
import { getDb } from "../../shared/db/connection.js";
import { uuidSchema, paginationSchema } from "../../shared/utils/validators.js";
import {
  genesTable,
  capsulesTable,
  nodesTable,
  assetReportsTable,
} from "./schema.js";
import { users } from "../auth/schema.js";
import { AuthService } from "../auth/service.js";
import { RolesService } from "../roles/service.js";
import { EvolutionService } from "./service.js";
import { nodeConfigSSE } from "./node-config-sse.js";

const logger = pino({ name: "admin:evolution" });

// ── Zod Schemas ─────────────────────────────────

const assetListQuerySchema = paginationSchema.extend({
  status: z.string().optional(),
  type: z.enum(["gene", "capsule"]).optional(),
  category: z.string().optional(),
  nodeId: z.string().optional(),
});

const changeAssetStatusSchema = z.object({
  status: z.enum(["pending", "promoted", "quarantined", "approved"]),
  reason: z.string().optional(),
});

const reportListQuerySchema = paginationSchema.extend({
  reportType: z.string().optional(),
});

// ── Route Registration ──────────────────────────

export async function registerAdmin(app: Express, config: GrcConfig) {
  const router = Router();
  const requireAuth = createAuthMiddleware(config);
  const requireAdmin = createAdminAuthMiddleware(config);
  const authService = new AuthService(config);

  // ── GET /assets — List all genes+capsules (auth only — browsing) ──

  router.get(
    "/assets",
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const query = assetListQuerySchema.parse(req.query);
      const db = getDb();
      const offset = (query.page - 1) * query.limit;

      // Build conditions for each table.
      // NOTE: Category filter only applies to genes (capsules have no category column).
      // When a category filter is active, capsule results are skipped entirely.
      const wantGenes = !query.type || query.type === "gene";
      const wantCapsules = (!query.type || query.type === "capsule") && !query.category;

      const results: Array<Record<string, unknown>> = [];
      let total = 0;

      // Build gene conditions
      const geneConditions = [];
      if (query.status) geneConditions.push(eq(genesTable.status, query.status));
      if (query.category) geneConditions.push(eq(genesTable.category, query.category));
      if (query.nodeId) geneConditions.push(eq(genesTable.nodeId, query.nodeId));
      const geneWhere = geneConditions.length > 0 ? and(...geneConditions) : undefined;

      // Build capsule conditions
      const capsuleConditions = [];
      if (query.status) capsuleConditions.push(eq(capsulesTable.status, query.status));
      if (query.nodeId) capsuleConditions.push(eq(capsulesTable.nodeId, query.nodeId));
      const capsuleWhere = capsuleConditions.length > 0 ? and(...capsuleConditions) : undefined;

      if (query.type) {
        // Single-type query: straightforward offset/limit
        if (query.type === "gene") {
          const [genes, geneCount] = await Promise.all([
            db.select().from(genesTable).where(geneWhere)
              .orderBy(desc(genesTable.createdAt)).limit(query.limit).offset(offset),
            db.select({ count: sql<number>`COUNT(*)` }).from(genesTable).where(geneWhere),
          ]);
          for (const g of genes) results.push({ ...g, assetType: "gene" });
          total = geneCount[0]?.count ?? 0;
        } else {
          const [capsules, capsuleCount] = await Promise.all([
            db.select().from(capsulesTable).where(capsuleWhere)
              .orderBy(desc(capsulesTable.createdAt)).limit(query.limit).offset(offset),
            db.select({ count: sql<number>`COUNT(*)` }).from(capsulesTable).where(capsuleWhere),
          ]);
          for (const c of capsules) results.push({ ...c, assetType: "capsule" });
          total = capsuleCount[0]?.count ?? 0;
        }
      } else {
        // Combined view: genes first, then capsules, with correct pagination.
        // Get counts first so we can calculate the proper offset for each table.
        const [geneCountResult, capsuleCountResult] = await Promise.all([
          wantGenes
            ? db.select({ count: sql<number>`COUNT(*)` }).from(genesTable).where(geneWhere)
            : Promise.resolve([{ count: 0 }]),
          wantCapsules
            ? db.select({ count: sql<number>`COUNT(*)` }).from(capsulesTable).where(capsuleWhere)
            : Promise.resolve([{ count: 0 }]),
        ]);

        const geneTotal = geneCountResult[0]?.count ?? 0;
        const capsuleTotal = capsuleCountResult[0]?.count ?? 0;
        total = geneTotal + capsuleTotal;

        if (wantGenes && offset < geneTotal) {
          // Still in gene range
          const genesNeeded = Math.min(query.limit, geneTotal - offset);
          const genes = await db.select().from(genesTable).where(geneWhere)
            .orderBy(desc(genesTable.createdAt)).limit(genesNeeded).offset(offset);
          for (const g of genes) results.push({ ...g, assetType: "gene" });

          // Fill remaining slots with capsules from the beginning
          const capsulesNeeded = query.limit - genes.length;
          if (wantCapsules && capsulesNeeded > 0) {
            const capsules = await db.select().from(capsulesTable).where(capsuleWhere)
              .orderBy(desc(capsulesTable.createdAt)).limit(capsulesNeeded).offset(0);
            for (const c of capsules) results.push({ ...c, assetType: "capsule" });
          }
        } else if (wantCapsules) {
          // Past all genes, only capsules
          const capsuleOffset = wantGenes ? offset - geneTotal : offset;
          const capsules = await db.select().from(capsulesTable).where(capsuleWhere)
            .orderBy(desc(capsulesTable.createdAt)).limit(query.limit).offset(capsuleOffset);
          for (const c of capsules) results.push({ ...c, assetType: "capsule" });
        }
      }

      res.json({
        data: results,
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          totalPages: Math.ceil(total / query.limit),
        },
      });
    }),
  );

  // ── GET /assets/:id — Get asset details with reports (auth only — browsing) ──

  router.get(
    "/assets/:id",
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const db = getDb();
      const id = uuidSchema.parse(req.params.id);

      // Try genes first, then capsules
      const geneRows = await db
        .select()
        .from(genesTable)
        .where(eq(genesTable.id, id))
        .limit(1);

      if (geneRows.length > 0) {
        const reports = await db
          .select({
            id: assetReportsTable.id,
            assetId: assetReportsTable.assetId,
            assetType: assetReportsTable.assetType,
            reporterNodeId: assetReportsTable.reporterNodeId,
            reporterUserId: assetReportsTable.reporterUserId,
            reportType: assetReportsTable.reportType,
            details: assetReportsTable.details,
            createdAt: assetReportsTable.createdAt,
            reporterName: nodesTable.employeeName,
            reporterRole: nodesTable.roleId,
          })
          .from(assetReportsTable)
          .leftJoin(nodesTable, eq(assetReportsTable.reporterNodeId, nodesTable.nodeId))
          .where(eq(assetReportsTable.assetId, geneRows[0].assetId))
          .orderBy(desc(assetReportsTable.createdAt));

        return res.json({
          data: { ...geneRows[0], assetType: "gene", reports },
        });
      }

      const capsuleRows = await db
        .select()
        .from(capsulesTable)
        .where(eq(capsulesTable.id, id))
        .limit(1);

      if (capsuleRows.length > 0) {
        const reports = await db
          .select({
            id: assetReportsTable.id,
            assetId: assetReportsTable.assetId,
            assetType: assetReportsTable.assetType,
            reporterNodeId: assetReportsTable.reporterNodeId,
            reporterUserId: assetReportsTable.reporterUserId,
            reportType: assetReportsTable.reportType,
            details: assetReportsTable.details,
            createdAt: assetReportsTable.createdAt,
            reporterName: nodesTable.employeeName,
            reporterRole: nodesTable.roleId,
          })
          .from(assetReportsTable)
          .leftJoin(nodesTable, eq(assetReportsTable.reporterNodeId, nodesTable.nodeId))
          .where(eq(assetReportsTable.assetId, capsuleRows[0].assetId))
          .orderBy(desc(assetReportsTable.createdAt));

        return res.json({
          data: { ...capsuleRows[0], assetType: "capsule", reports },
        });
      }

      throw new NotFoundError("Asset");
    }),
  );

  // ── PATCH /assets/:id/status — Force status change (admin) ──

  router.patch(
    "/assets/:id/status",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const db = getDb();
      const id = uuidSchema.parse(req.params.id);
      const body = changeAssetStatusSchema.parse(req.body);

      // Try genes first
      const geneRows = await db
        .select({ id: genesTable.id })
        .from(genesTable)
        .where(eq(genesTable.id, id))
        .limit(1);

      if (geneRows.length > 0) {
        await db
          .update(genesTable)
          .set({
            status: body.status,
            ...(body.status === "promoted" ? { promotedAt: new Date() } : {}),
          })
          .where(eq(genesTable.id, id));

        logger.info(
          { assetId: id, assetType: "gene", newStatus: body.status, admin: req.auth?.sub },
          "Gene status changed by admin",
        );

        return res.json({ data: { id, assetType: "gene", status: body.status } });
      }

      // Try capsules
      const capsuleRows = await db
        .select({ id: capsulesTable.id })
        .from(capsulesTable)
        .where(eq(capsulesTable.id, id))
        .limit(1);

      if (capsuleRows.length > 0) {
        await db
          .update(capsulesTable)
          .set({
            status: body.status,
            ...(body.status === "promoted" ? { promotedAt: new Date() } : {}),
          })
          .where(eq(capsulesTable.id, id));

        logger.info(
          { assetId: id, assetType: "capsule", newStatus: body.status, admin: req.auth?.sub },
          "Capsule status changed by admin",
        );

        return res.json({ data: { id, assetType: "capsule", status: body.status } });
      }

      throw new NotFoundError("Asset");
    }),
  );

  // ── GET /nodes — List all registered nodes (admin — internal monitoring) ──

  router.get(
    "/nodes",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const query = z.object({
        ...paginationSchema.shape,
        node_id: z.string().optional(),
      }).parse(req.query);
      const db = getDb();
      const offset = (query.page - 1) * query.limit;

      const conditions = [];
      if (query.node_id) {
        conditions.push(eq(nodesTable.nodeId, query.node_id));
      }
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const [rows, totalResult] = await Promise.all([
        db
          .select()
          .from(nodesTable)
          .where(whereClause)
          .orderBy(desc(nodesTable.lastHeartbeat))
          .limit(query.limit)
          .offset(offset),
        db
          .select({ count: sql<number>`COUNT(*)` })
          .from(nodesTable)
          .where(whereClause),
      ]);

      const total = totalResult[0]?.count ?? 0;

      res.json({
        data: rows,
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          totalPages: Math.ceil(total / query.limit),
        },
      });
    }),
  );

  // ── PATCH /nodes/:nodeId/profile — Update employee profile fields ──

  const nodeProfileSchema = z.object({
    employee_id: z.string().max(100).optional(),
    employee_name: z.string().max(255).optional(),
    employee_email: z.string().max(255).optional(),
  });

  router.patch(
    "/nodes/:nodeId/profile",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const nodeId = req.params.nodeId as string;
      const body = nodeProfileSchema.parse(req.body);
      const db = getDb();

      await db
        .update(nodesTable)
        .set({
          ...(body.employee_id !== undefined && { employeeId: body.employee_id }),
          ...(body.employee_name !== undefined && { employeeName: body.employee_name }),
          ...(body.employee_email !== undefined && { employeeEmail: body.employee_email }),
        })
        .where(eq(nodesTable.nodeId, nodeId));

      const updated = await db
        .select()
        .from(nodesTable)
        .where(eq(nodesTable.nodeId, nodeId))
        .limit(1);

      if (!updated[0]) {
        return res.status(404).json({ error: "Node not found" });
      }

      res.json({ ok: true, data: updated[0] });
    }),
  );

  // ── GET /nodes/provision-defaults — Return host workspace base path ──

  router.get(
    "/nodes/provision-defaults",
    requireAuth, requireAdmin,
    asyncHandler(async (_req: Request, res: Response) => {
      // Default workspaces directory — configurable via env var
      const workspacesBase = process.env.WINCLAW_WORKSPACES_DIR
        || path.resolve("C:\\work\\workspaces");
      res.json({
        workspacesBasePath: workspacesBase,
        platform: process.platform,
      });
    }),
  );

  // ── POST /nodes/provision — Provision a new node (Docker or Daytona) ──

  const provisionNodeSchema = z.object({
    mode: z.enum(["local_docker", "daytona_sandbox"]),
    gatewayPort: z.number().int().min(1024).max(65535).optional(),
    workspacePath: z.string().optional(),
    employeeName: z.string().optional(),
    employeeCode: z.string().optional(),
    employeeEmail: z.string().optional(),
  });

  router.post(
    "/nodes/provision",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const body = provisionNodeSchema.parse(req.body);
      const { execSync } = await import("child_process");

      if (body.mode === "local_docker") {
        // Validate required fields
        if (!body.gatewayPort) {
          return res.status(400).json({ error: "gatewayPort is required for local_docker mode" });
        }
        if (!body.workspacePath) {
          return res.status(400).json({ error: "workspacePath is required for local_docker mode" });
        }

        // Determine GRC port - backend API is on 3100, frontend is on 3200
        // WinClaw nodes need to connect to the backend API
        const grcPort = process.env.GRC_API_PORT || "3100";

        // For Docker Desktop on Windows, host.docker.internal may not resolve correctly
        // Use host-gateway IP which is more reliable
        // The --add-host maps host.docker.internal to the host's gateway IP

        // Build docker run arguments (use execFileSync to prevent command injection)
        const { execFileSync } = await import("child_process");
        const dockerArgs = ["run", "-d", "-p", `${body.gatewayPort}:18789`,
          "--add-host", "host.docker.internal:host-gateway",
          "-e", `WINCLAW_GRC_URL=http://host.docker.internal:${grcPort}`,
          "-e", `WINCLAW_GATEWAY_BIND=lan`,
          "--network", "bridge"];
        if (body.employeeName) dockerArgs.push("-e", `employee_name=${body.employeeName}`);
        if (body.employeeCode) dockerArgs.push("-e", `employee_code=${body.employeeCode}`);
        if (body.employeeEmail) dockerArgs.push("-e", `employee_email=${body.employeeEmail}`);
        dockerArgs.push("-v", `${body.workspacePath}:/home/winclaw/.winclaw/workspace`);
        // Persist device identity inside workspace dir so each node has unique identity
        const identityPath = path.join(body.workspacePath, ".identity");
        fs.mkdirSync(identityPath, { recursive: true });
        dockerArgs.push("-v", `${identityPath}:/home/winclaw/.winclaw/identity`);
        // Config persistence volume for preserving settings across restarts (换水)
        const configPersistPath = path.join(body.workspacePath, ".config");
        fs.mkdirSync(configPersistPath, { recursive: true });
        dockerArgs.push("-v", `${configPersistPath}:/home/winclaw/.winclaw/config-persist`);
        dockerArgs.push("itccloudsoft/winclaw-node:latest");

        logger.info({ dockerArgs }, "Provisioning local Docker node");

        let containerId: string;
        try {
          containerId = execFileSync("docker", dockerArgs, { encoding: "utf-8" }).trim();
        } catch (err: any) {
          logger.error({ err: err.message }, "Docker run failed");
          return res.status(500).json({ error: "Docker run failed", detail: err.message });
        }

        // Extract token from docker logs (poll up to 15 seconds)
        let token: string | null = null;
        const TOKEN_REGEX = /Token:\s+(winclaw-node-[a-f0-9]+)/;
        for (let i = 0; i < 30; i++) {
          await new Promise(r => setTimeout(r, 500));
          try {
            const logs = execFileSync("docker", ["logs", containerId], { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
            const match = logs.match(TOKEN_REGEX);
            if (match) {
              token = match[1];
              break;
            }
          } catch { /* container may still be starting */ }
        }

        if (!token) {
          logger.warn({ containerId }, "Could not extract token from docker logs");
          return res.status(500).json({ error: "Failed to extract gateway token from container logs" });
        }

        const gatewayUrl = `http://localhost:${body.gatewayPort}/chat?token=${token}`;

        // Wait for the node to register with GRC (poll up to 20 seconds)
        const db = getDb();
        let nodeId: string | null = null;
        for (let i = 0; i < 40; i++) {
          await new Promise(r => setTimeout(r, 500));
          const found = await db
            .select({ nodeId: nodesTable.nodeId, id: nodesTable.id })
            .from(nodesTable)
            .where(
              body.employeeCode
                ? eq(nodesTable.employeeId, body.employeeCode)
                : eq(nodesTable.containerId, containerId)
            )
            .orderBy(sql`${nodesTable.createdAt} DESC`)
            .limit(1);
          if (found[0]) {
            nodeId = found[0].nodeId;
            break;
          }
        }

        if (nodeId) {
          // Update the node record with provisioning data
          await db
            .update(nodesTable)
            .set({
              provisioningMode: "local_docker",
              containerId: containerId.slice(0, 64),
              gatewayUrl,
              gatewayPort: body.gatewayPort,
              workspacePath: body.workspacePath,
            })
            .where(eq(nodesTable.nodeId, nodeId));

          // Auto-link node to a user record
          const nodeUser = await authService.upsertNodeUser({
            nodeId,
            displayName: body.employeeName,
            email: body.employeeEmail,
          });
          await db
            .update(nodesTable)
            .set({ userId: nodeUser.id })
            .where(eq(nodesTable.nodeId, nodeId));
        }

        logger.info({ containerId, nodeId, gatewayUrl }, "Local Docker node provisioned");

        res.json({
          data: {
            nodeId,
            containerId: containerId.slice(0, 64),
            gatewayUrl,
            gatewayPort: body.gatewayPort,
            provisioningMode: "local_docker",
          },
        });

      } else if (body.mode === "daytona_sandbox") {
        // Daytona Sandbox mode
        const DAYTONA_API_KEY = process.env.DAYTONA_API_KEY || "dtn_a92ccd0521fdaf9bc2c173087e23a3a52edc2d67fbb6a3508871a614a474b023";
        const DAYTONA_API_URL = process.env.DAYTONA_API_URL || "https://app.daytona.io/api";
        const DAYTONA_TARGET = process.env.DAYTONA_TARGET || "us";

        // Determine GRC URL from request origin or env
        const grcUrl = process.env.GRC_PUBLIC_URL || `https://${req.headers.host}`;

        // Generate a deterministic gateway token for WinClaw auth
        const { randomBytes } = await import("crypto");
        const winclawToken = `winclaw-node-${randomBytes(16).toString("hex")}`;

        const sandboxBody = {
          buildInfo: {
            dockerfileContent: "FROM itccloudsoft/winclaw-node:latest\n",
          },
          target: DAYTONA_TARGET,
          env: {
            WINCLAW_GRC_URL: grcUrl,
            WINCLAW_GATEWAY_TOKEN: winclawToken,
            ...(body.employeeName && { employee_name: body.employeeName }),
            ...(body.employeeCode && { employee_code: body.employeeCode }),
          },
          cpu: 2,
          memory: 2,
          disk: 5,
          autoStopInterval: 0,
        };

        logger.info({ sandboxBody }, "Creating Daytona sandbox");

        let sandboxResponse: any;
        try {
          const resp = await fetch(`${DAYTONA_API_URL}/sandbox`, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${DAYTONA_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(sandboxBody),
          });
          if (!resp.ok) {
            const errText = await resp.text();
            throw new Error(`Daytona API ${resp.status}: ${errText}`);
          }
          sandboxResponse = await resp.json();
        } catch (err: any) {
          logger.error({ err: err.message }, "Daytona sandbox creation failed");
          return res.status(500).json({ error: "Daytona sandbox creation failed", detail: err.message });
        }

        const sandboxId = sandboxResponse.id || sandboxResponse.sandboxId;

        // Gateway URL will be fetched dynamically via preview-url API when user clicks Gateway button
        // Store sandboxId and winclawToken for later resolution
        const gatewayUrl = `daytona://${sandboxId}/18789?token=${winclawToken}`;

        // Daytona sandbox does NOT run Docker ENTRYPOINT/CMD automatically.
        // We need to wait for sandbox to be "started" then launch WinClaw via toolbox API.
        const TOOLBOX_URL = "https://proxy.app.daytona.io/toolbox";

        // Poll until sandbox state is "started" (max 120s for image build + start)
        for (let i = 0; i < 120; i++) {
          await new Promise(r => setTimeout(r, 2000));
          try {
            const stateResp = await fetch(`${DAYTONA_API_URL}/sandbox/${sandboxId}`, {
              headers: { "Authorization": `Bearer ${DAYTONA_API_KEY}` },
            });
            if (stateResp.ok) {
              const stateData: any = await stateResp.json();
              if (stateData.state === "started") {
                logger.info({ sandboxId, iteration: i }, "Sandbox is started, launching WinClaw entrypoint");
                break;
              }
              if (stateData.state === "error" || stateData.state === "build_failed") {
                logger.error({ sandboxId, state: stateData.state }, "Sandbox failed to start");
                return res.status(500).json({ error: `Sandbox failed: ${stateData.state}`, detail: stateData.errorReason });
              }
              logger.info({ sandboxId, state: stateData.state, iteration: i }, "Waiting for sandbox to start...");
            }
          } catch { /* retry */ }
        }

        // Launch WinClaw entrypoint inside sandbox via toolbox API
        try {
          await fetch(`${TOOLBOX_URL}/${sandboxId}/process/execute`, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${DAYTONA_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              command: "bash -c 'nohup /usr/local/bin/entrypoint-node.sh > /tmp/winclaw.log 2>&1 &'",
              timeout: 10,
            }),
          });
          logger.info({ sandboxId }, "WinClaw entrypoint launched inside sandbox");
        } catch (err: any) {
          logger.warn({ sandboxId, err: err.message }, "Failed to launch entrypoint (sandbox may still be starting)");
        }

        // Wait for WinClaw to auto-register with GRC (entrypoint connects to GRC via A2A)
        const db = getDb();
        let nodeId: string | null = null;
        for (let i = 0; i < 30; i++) {
          await new Promise(r => setTimeout(r, 2000));
          // Find recently registered node matching employee code or most recent
          const found = await db
            .select({ nodeId: nodesTable.nodeId })
            .from(nodesTable)
            .where(
              body.employeeCode
                ? eq(nodesTable.employeeId, body.employeeCode)
                : sql`1=1`
            )
            .orderBy(sql`${nodesTable.createdAt} DESC`)
            .limit(1);
          if (found[0]) {
            nodeId = found[0].nodeId;
            break;
          }
        }

        if (nodeId) {
          // Update auto-registered node with Daytona provisioning info
          await db
            .update(nodesTable)
            .set({
              provisioningMode: "daytona_sandbox",
              sandboxId,
              gatewayUrl,
            })
            .where(eq(nodesTable.nodeId, nodeId));

          // Auto-link node to a user record
          const nodeUser = await authService.upsertNodeUser({
            nodeId,
            displayName: body.employeeName,
            email: body.employeeEmail,
          });
          await db
            .update(nodesTable)
            .set({ userId: nodeUser.id })
            .where(eq(nodesTable.nodeId, nodeId));

          logger.info({ sandboxId, nodeId, gatewayUrl }, "Daytona sandbox node provisioned and linked");
        } else {
          logger.warn({ sandboxId }, "WinClaw node did not register within timeout, sandbox created but not linked");
        }

        res.json({
          data: {
            nodeId,
            sandboxId,
            gatewayUrl,
            provisioningMode: "daytona_sandbox",
          },
        });
      }
    }),
  );

  // ── GET /nodes/:nodeId/gateway — Get gateway URL for a Daytona sandbox node ──

  router.get(
    "/nodes/:nodeId/gateway",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const nodeId = req.params.nodeId as string;
      const db = getDb();
      const existing = await db.select().from(nodesTable).where(eq(nodesTable.nodeId, nodeId)).limit(1);
      if (!existing[0]) {
        return res.status(404).json({ error: "Node not found" });
      }
      const node = existing[0];

      if (node.provisioningMode !== "daytona_sandbox" || !node.sandboxId) {
        // For local_docker nodes, return stored gatewayUrl directly
        return res.json({ data: { url: node.gatewayUrl } });
      }

      // For Daytona sandbox, fetch preview URL from Daytona API
      const DAYTONA_API_KEY = process.env.DAYTONA_API_KEY;
      const DAYTONA_API_URL = process.env.DAYTONA_API_URL || "https://app.daytona.io/api";

      try {
        const resp = await fetch(
          `${DAYTONA_API_URL}/sandbox/${node.sandboxId}/ports/18789/preview-url`,
          {
            headers: { "Authorization": `Bearer ${DAYTONA_API_KEY}` },
          }
        );
        if (!resp.ok) {
          const errText = await resp.text();
          logger.warn({ sandboxId: node.sandboxId, status: resp.status, errText }, "Failed to get preview URL");
          return res.status(502).json({ error: "Failed to get gateway URL from Daytona", detail: errText });
        }
        const previewData: any = await resp.json();
        const baseUrl = previewData.url || previewData.previewUrl;

        // Extract WinClaw token from stored gatewayUrl (daytona://sandboxId/port?token=xxx)
        let winclawToken = "";
        if (node.gatewayUrl?.includes("token=")) {
          winclawToken = node.gatewayUrl.split("token=")[1] || "";
        }

        // Build full gateway chat URL with WinClaw auth token
        const url = winclawToken
          ? `${baseUrl}/chat?token=${winclawToken}`
          : `${baseUrl}/chat`;

        res.json({ data: { url } });
      } catch (err: any) {
        logger.error({ err: err.message }, "Error fetching Daytona preview URL");
        res.status(500).json({ error: "Failed to fetch gateway URL", detail: err.message });
      }
    }),
  );

  // ── POST /nodes/:nodeId/restart — Restart a provisioned node ──

  router.post(
    "/nodes/:nodeId/restart",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const nodeId = req.params.nodeId as string;
      const db = getDb();
      const { execSync } = await import("child_process");

      const existing = await db
        .select()
        .from(nodesTable)
        .where(eq(nodesTable.nodeId, nodeId))
        .limit(1);

      if (!existing[0]) {
        throw new NotFoundError("Node");
      }

      const node = existing[0];

      if (!node.provisioningMode) {
        return res.status(400).json({ error: "Node is not a provisioned node (no provisioning mode)" });
      }

      if (node.provisioningMode === "local_docker") {
        if (!node.containerId) {
          return res.status(400).json({ error: "No container ID found for this node" });
        }

        const { execFileSync } = await import("child_process");

        // Identity path inside workspace dir (unique per node)
        const identityPath = node.workspacePath
          ? path.join(node.workspacePath, ".identity")
          : null;

        // Extract identity from old container BEFORE removing it
        if (identityPath) {
          fs.mkdirSync(identityPath, { recursive: true });
          try {
            execFileSync("docker", [
              "cp",
              `${node.containerId}:/home/winclaw/.winclaw/identity/device.json`,
              path.join(identityPath, "device.json"),
            ], { encoding: "utf-8" });
            logger.info({ identityPath }, "Extracted device identity from old container");
          } catch (err: any) {
            logger.warn({ err: err.message }, "Could not extract identity from old container (may already be on host)");
          }
        }

        // Extract config files from old container BEFORE removing it
        const configPersistPath = node.workspacePath
          ? path.join(node.workspacePath, ".config")
          : null;
        if (configPersistPath) {
          fs.mkdirSync(configPersistPath, { recursive: true });
          try {
            execFileSync("docker", ["cp",
              `${node.containerId}:/home/winclaw/.winclaw/winclaw.json`,
              path.join(configPersistPath, "winclaw.json"),
            ], { encoding: "utf-8" });
            execFileSync("docker", ["cp",
              `${node.containerId}:/home/winclaw/.winclaw/grc-config-state.json`,
              path.join(configPersistPath, "grc-config-state.json"),
            ], { encoding: "utf-8" });
            // Also try to extract OAuth credentials
            try {
              execFileSync("docker", ["cp",
                `${node.containerId}:/home/winclaw/.winclaw/credentials/oauth.json`,
                path.join(configPersistPath, "oauth.json"),
              ], { encoding: "utf-8" });
            } catch { /* OAuth may not exist, non-fatal */ }
            logger.info({ configPersistPath }, "Extracted config from old container for preservation");

            // Strip gateway auth token from persisted config to prevent stale token reuse
            try {
              const winclawJsonPath = path.join(configPersistPath, "winclaw.json");
              const rawConfig = fs.readFileSync(winclawJsonPath, "utf-8");
              const parsed = JSON.parse(rawConfig);
              if (parsed?.gateway?.auth?.token) {
                delete parsed.gateway.auth.token;
                fs.writeFileSync(winclawJsonPath, JSON.stringify(parsed, null, 2) + "\n", "utf-8");
                logger.info("Stripped gateway.auth.token from persisted winclaw.json");
              }
            } catch (stripErr: any) {
              logger.warn({ err: stripErr.message }, "Could not strip gateway auth token from config (non-fatal)");
            }
          } catch (err: any) {
            logger.warn({ err: err.message }, "Could not extract config from old container (non-fatal)");
          }
        }

        // Stop and remove old container
        try {
          execFileSync("docker", ["stop", node.containerId], { encoding: "utf-8" });
          execFileSync("docker", ["rm", node.containerId], { encoding: "utf-8" });
        } catch (err: any) {
          logger.warn({ err: err.message, containerId: node.containerId }, "Failed to stop/remove old container by ID, trying by port");
          // Fallback: find container by gateway port and stop it
          if (node.gatewayPort) {
            try {
              const portContainers = execFileSync("docker", ["ps", "-q", "--filter", `publish=${node.gatewayPort}`], { encoding: "utf-8" }).trim();
              if (portContainers) {
                for (const cid of portContainers.split("\n").filter(Boolean)) {
                  try {
                    execFileSync("docker", ["stop", cid], { encoding: "utf-8" });
                    execFileSync("docker", ["rm", cid], { encoding: "utf-8" });
                    logger.info({ containerId: cid, port: node.gatewayPort }, "Stopped container found by port fallback");
                  } catch { /* best effort */ }
                }
              }
            } catch { /* non-fatal */ }
          }
        }

        // Re-run with same config
        const grcPort = process.env.GRC_API_PORT || "3100";
        const dockerArgs = ["run", "-d", "--pull", "always", "-p", `${node.gatewayPort}:18789`,
          "-e", `WINCLAW_GRC_URL=http://host.docker.internal:${grcPort}`];
        if (node.employeeName) dockerArgs.push("-e", `employee_name=${node.employeeName}`);
        if (node.employeeId) dockerArgs.push("-e", `employee_code=${node.employeeId}`);
        if (node.employeeEmail) dockerArgs.push("-e", `employee_email=${node.employeeEmail}`);
        if (node.workspacePath) {
          dockerArgs.push("-v", `${node.workspacePath}:/home/winclaw/.winclaw/workspace`);
          dockerArgs.push("-v", `${identityPath}:/home/winclaw/.winclaw/identity`);
          if (configPersistPath) {
            dockerArgs.push("-v", `${configPersistPath}:/home/winclaw/.winclaw/config-persist`);
          }
        }
        dockerArgs.push("itccloudsoft/winclaw-node:latest");

        // Save role/key data from old node BEFORE deletion
        const preservedData = {
          roleId: node.roleId,
          roleMode: node.roleMode,
          configRevision: node.configRevision,
          configAppliedRevision: node.configAppliedRevision,
          primaryKeyId: node.primaryKeyId,
          auxiliaryKeyId: node.auxiliaryKeyId,
          keyConfigJson: node.keyConfigJson,
          employeeName: node.employeeName,
          employeeId: node.employeeId,
          employeeEmail: node.employeeEmail,
        };

        // DO NOT delete node record — keep it alive so data is never lost.
        // Just clear containerId so we know it's being restarted.
        await db.update(nodesTable)
          .set({ containerId: null })
          .where(eq(nodesTable.nodeId, nodeId));

        let newContainerId: string;
        try {
          newContainerId = execFileSync("docker", dockerArgs, { encoding: "utf-8" }).trim();
        } catch (err: any) {
          return res.status(500).json({ error: "Docker run failed", detail: err.message });
        }

        // Wait for new container to register with GRC and extract token
        let token: string | null = null;
        let newNodeId: string | null = null;
        const TOKEN_REGEX = /Token:\s+(winclaw-node-[a-f0-9]+)/;
        // Wait up to 60 seconds (120 × 500ms) for container startup + GRC registration
        for (let i = 0; i < 120; i++) {
          await new Promise(r => setTimeout(r, 500));
          try {
            // Read both stdout and stderr from container logs
            const logs = execFileSync("docker", ["logs", newContainerId], {
              encoding: "utf-8",
              maxBuffer: 1024 * 1024,
            });
            if (!token) {
              const match = logs.match(TOKEN_REGEX);
              if (match) token = match[1];
            }
            if (logs.includes("Node registered with GRC") || logs.includes("listening on ws://")) {
              // Find the newly registered node by employeeId
              if (node.employeeId) {
                const newNodes = await db
                  .select()
                  .from(nodesTable)
                  .where(eq(nodesTable.employeeId, node.employeeId))
                  .orderBy(desc(nodesTable.lastHeartbeat))
                  .limit(1);
                if (newNodes.length > 0) {
                  newNodeId = newNodes[0].nodeId;
                }
              }
              // If we have both token and nodeId, we're done
              if (token && newNodeId) break;
              // If we have nodeId but no token, keep trying for the token
              if (newNodeId && !token && i < 60) continue;
              break;
            }
          } catch { /* still starting */ }
        }

        // If token still not found from logs, try to extract from docker exec
        if (!token && newContainerId) {
          try {
            const catResult = execFileSync("docker", [
              "exec", newContainerId, "cat", "/tmp/winclaw-token",
            ], { encoding: "utf-8", timeout: 5000 }).trim();
            if (catResult.startsWith("winclaw-node-")) token = catResult;
          } catch { /* token file may not exist */ }
        }

        // Update node record with new container info + preserved data
        const gatewayUrl = token
          ? `http://localhost:${node.gatewayPort}/chat?token=${token}`
          : `http://localhost:${node.gatewayPort}/chat`;

        if (newNodeId && newNodeId !== nodeId) {
          // New node was registered via hello with a different ID.
          // Transfer all preserved data to the new node, then delete the old stub.
          await db
            .update(nodesTable)
            .set({
              containerId: newContainerId.slice(0, 64),
              gatewayUrl,
              gatewayPort: node.gatewayPort,
              provisioningMode: "local_docker",
              workspacePath: node.workspacePath,
              ...(preservedData.roleId && { roleId: preservedData.roleId }),
              ...(preservedData.roleMode && { roleMode: preservedData.roleMode }),
              ...(preservedData.configRevision && { configRevision: preservedData.configRevision }),
              ...(preservedData.configAppliedRevision && { configAppliedRevision: preservedData.configAppliedRevision }),
              ...(preservedData.primaryKeyId && { primaryKeyId: preservedData.primaryKeyId }),
              ...(preservedData.auxiliaryKeyId && { auxiliaryKeyId: preservedData.auxiliaryKeyId }),
              ...(preservedData.keyConfigJson != null ? { keyConfigJson: preservedData.keyConfigJson } : {}),
              ...(preservedData.employeeName && { employeeName: preservedData.employeeName }),
              ...(preservedData.employeeId && { employeeId: preservedData.employeeId }),
              ...(preservedData.employeeEmail && { employeeEmail: preservedData.employeeEmail }),
            })
            .where(eq(nodesTable.nodeId, newNodeId));
          // Now safe to delete old stub since new node has all data
          await db.delete(nodesTable).where(eq(nodesTable.nodeId, nodeId));
          logger.info({ oldNodeId: nodeId, newNodeId, newContainerId, gatewayUrl }, "Local Docker node restarted (new identity)");
        } else {
          // Same nodeId or hello hasn't registered yet — update the existing record directly
          await db
            .update(nodesTable)
            .set({
              containerId: newContainerId.slice(0, 64),
              gatewayUrl,
            })
            .where(eq(nodesTable.nodeId, nodeId));
          logger.info({ nodeId, newContainerId, gatewayUrl }, "Local Docker node restarted (same identity)");
        }

        res.json({
          data: { nodeId: newNodeId || nodeId, containerId: newContainerId.slice(0, 64), gatewayUrl, restarted: true },
        });

      } else if (node.provisioningMode === "daytona_sandbox") {
        const DAYTONA_API_KEY = process.env.DAYTONA_API_KEY || "dtn_a92ccd0521fdaf9bc2c173087e23a3a52edc2d67fbb6a3508871a614a474b023";
        const DAYTONA_API_URL = process.env.DAYTONA_API_URL || "https://app.daytona.io/api";
        const DAYTONA_TARGET = process.env.DAYTONA_TARGET || "us";

        // Delete old sandbox
        if (node.sandboxId) {
          try {
            await fetch(`${DAYTONA_API_URL}/sandbox/${node.sandboxId}`, {
              method: "DELETE",
              headers: { "Authorization": `Bearer ${DAYTONA_API_KEY}` },
            });
          } catch (err: any) {
            logger.warn({ err: err.message }, "Failed to delete old sandbox");
          }
        }

        // Create new sandbox
        const grcUrl = process.env.GRC_PUBLIC_URL || `https://${req.headers.host}`;
        const resp = await fetch(`${DAYTONA_API_URL}/sandbox`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${DAYTONA_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            buildInfo: {
              dockerfileContent: "FROM itccloudsoft/winclaw-node:latest\n",
            },
            target: DAYTONA_TARGET,
            env: {
              WINCLAW_GRC_URL: grcUrl,
              ...(node.employeeName && { employee_name: node.employeeName }),
              ...(node.employeeId && { employee_code: node.employeeId }),
            },
            cpu: 2,
            memory: 2,
            disk: 5,
            autoStopInterval: 0,
          }),
        });

        if (!resp.ok) {
          const errText = await resp.text();
          return res.status(500).json({ error: "Daytona sandbox creation failed", detail: errText });
        }

        const sandboxResponse: any = await resp.json();
        const newSandboxId = sandboxResponse.id || sandboxResponse.sandboxId;
        const gatewayUrl = `daytona://${newSandboxId}/18789`;

        await db
          .update(nodesTable)
          .set({ sandboxId: newSandboxId, gatewayUrl })
          .where(eq(nodesTable.nodeId, nodeId));

        logger.info({ nodeId, newSandboxId, gatewayUrl }, "Daytona sandbox node restarted");

        res.json({
          data: { nodeId, sandboxId: newSandboxId, gatewayUrl, restarted: true },
        });
      }
    }),
  );

  // ── DELETE /nodes/:nodeId — Delete a node (admin) ──

  router.delete(
    "/nodes/:nodeId",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const nodeId = req.params.nodeId as string;
      const db = getDb();

      const existing = await db
        .select()
        .from(nodesTable)
        .where(eq(nodesTable.nodeId, nodeId))
        .limit(1);

      if (!existing[0]) {
        throw new NotFoundError("Node");
      }

      const node = existing[0];

      // Clean up provisioned resources
      if (node.provisioningMode === "local_docker" && node.containerId) {
        const { execFileSync } = await import("child_process");
        try {
          execFileSync("docker", ["stop", node.containerId], { encoding: "utf-8" });
          execFileSync("docker", ["rm", node.containerId], { encoding: "utf-8" });
          logger.info({ containerId: node.containerId }, "Docker container stopped and removed");
        } catch (err: any) {
          logger.warn({ err: err.message, containerId: node.containerId }, "Failed to remove Docker container by ID, trying by port");
          // Fallback: find container by gateway port and stop it
          if (node.gatewayPort) {
            try {
              const portContainers = execFileSync("docker", ["ps", "-q", "--filter", `publish=${node.gatewayPort}`], { encoding: "utf-8" }).trim();
              if (portContainers) {
                for (const cid of portContainers.split("\n").filter(Boolean)) {
                  try {
                    execFileSync("docker", ["stop", cid], { encoding: "utf-8" });
                    execFileSync("docker", ["rm", cid], { encoding: "utf-8" });
                    logger.info({ containerId: cid, port: node.gatewayPort }, "Stopped container found by port fallback");
                  } catch { /* best effort */ }
                }
              }
            } catch { /* non-fatal */ }
          }
        }
      } else if (node.provisioningMode === "daytona_sandbox" && node.sandboxId) {
        const DAYTONA_API_KEY = process.env.DAYTONA_API_KEY || "dtn_a92ccd0521fdaf9bc2c173087e23a3a52edc2d67fbb6a3508871a614a474b023";
        const DAYTONA_API_URL = process.env.DAYTONA_API_URL || "https://app.daytona.io/api";
        try {
          await fetch(`${DAYTONA_API_URL}/sandbox/${node.sandboxId}`, {
            method: "DELETE",
            headers: { "Authorization": `Bearer ${DAYTONA_API_KEY}` },
          });
          logger.info({ sandboxId: node.sandboxId }, "Daytona sandbox deleted");
        } catch (err: any) {
          logger.warn({ err: err.message, sandboxId: node.sandboxId }, "Failed to delete Daytona sandbox");
        }
      }
      // For regular PC nodes (provisioningMode = null), only GRC data is deleted

      // Capture userId before deleting the node
      const nodeUserId = node.userId;

      await db.delete(nodesTable).where(eq(nodesTable.nodeId, nodeId));

      // CASCADE: delete the associated node-provider user (if any)
      if (nodeUserId) {
        await db
          .delete(users)
          .where(and(eq(users.id, nodeUserId), eq(users.provider, "node")));
        logger.info({ userId: nodeUserId }, "Associated node user deleted");
      }

      logger.info(
        { nodeId, admin: req.auth?.sub },
        "Node deleted by admin",
      );

      // Propagate updated roster (node removed from company)
      const rolesService = new RolesService();
      rolesService.propagateCompanyContext("node_released").catch(err =>
        logger.warn({ err }, "Failed to propagate context after node release")
      );

      res.json({ data: { nodeId, deleted: true } });
    }),
  );

  // ── GET /reports — List asset reports (admin — internal) ──

  router.get(
    "/reports",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const query = reportListQuerySchema.parse(req.query);
      const db = getDb();
      const offset = (query.page - 1) * query.limit;

      const conditions = [];
      if (query.reportType) {
        conditions.push(eq(assetReportsTable.reportType, query.reportType));
      }
      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const [rows, totalResult] = await Promise.all([
        db
          .select()
          .from(assetReportsTable)
          .where(where)
          .orderBy(desc(assetReportsTable.createdAt))
          .limit(query.limit)
          .offset(offset),
        db
          .select({ count: sql<number>`COUNT(*)` })
          .from(assetReportsTable)
          .where(where),
      ]);

      const total = totalResult[0]?.count ?? 0;

      res.json({
        data: rows,
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          totalPages: Math.ceil(total / query.limit),
        },
      });
    }),
  );

  // ── GET /stats — Evolution statistics (auth only — aggregated) ──

  router.get(
    "/stats",
    requireAuth,
    asyncHandler(async (_req: Request, res: Response) => {
      const db = getDb();

      // Use 24-hour window to match the node list's "Active" status criteria
      const activeThreshold = new Date();
      activeThreshold.setHours(activeThreshold.getHours() - 24);

      const [
        genesByStatus,
        capsulesByStatus,
        activeNodesResult,
        totalNodesResult,
        totalGenesResult,
        totalCapsulesResult,
        promotedGenesResult,
      ] = await Promise.all([
        db
          .select({
            status: genesTable.status,
            count: sql<number>`COUNT(*)`,
          })
          .from(genesTable)
          .groupBy(genesTable.status),
        db
          .select({
            status: capsulesTable.status,
            count: sql<number>`COUNT(*)`,
          })
          .from(capsulesTable)
          .groupBy(capsulesTable.status),
        db
          .select({ count: sql<number>`COUNT(*)` })
          .from(nodesTable)
          .where(sql`${nodesTable.lastHeartbeat} >= ${activeThreshold}`),
        db.select({ count: sql<number>`COUNT(*)` }).from(nodesTable),
        db.select({ count: sql<number>`COUNT(*)` }).from(genesTable),
        db.select({ count: sql<number>`COUNT(*)` }).from(capsulesTable),
        db
          .select({ count: sql<number>`COUNT(*)` })
          .from(genesTable)
          .where(eq(genesTable.status, "promoted")),
      ]);

      const totalGenes = totalGenesResult[0]?.count ?? 0;
      const promotedGenes = promotedGenesResult[0]?.count ?? 0;
      const promotionRate = totalGenes > 0 ? (promotedGenes / totalGenes) * 100 : 0;

      res.json({
        stats: {
          totalGenes,
          totalCapsules: totalCapsulesResult[0]?.count ?? 0,
          genesByStatus: genesByStatus.reduce(
            (acc, row) => {
              acc[row.status] = row.count;
              return acc;
            },
            {} as Record<string, number>,
          ),
          capsulesByStatus: capsulesByStatus.reduce(
            (acc, row) => {
              acc[row.status] = row.count;
              return acc;
            },
            {} as Record<string, number>,
          ),
          totalNodes: totalNodesResult[0]?.count ?? 0,
          activeNodes: activeNodesResult[0]?.count ?? 0,
          promotionRate: Math.round(promotionRate * 100) / 100,
        },
      });
    }),
  );

  // ── GET /leaderboard — Evolution Score leaderboard ──

  router.get(
    "/leaderboard",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const periodParam = (req.query.period as string) || "weekly";
      const limitParam = parseInt(req.query.limit as string, 10) || 10;

      if (periodParam !== "weekly" && periodParam !== "monthly") {
        return res.status(400).json({
          error: "Invalid period. Expected 'weekly' or 'monthly'.",
        });
      }

      const clampedLimit = Math.min(Math.max(limitParam, 1), 100);

      const evolutionService = new EvolutionService();
      const result = await evolutionService.calculateEvolutionLeaderboard(
        periodParam,
        clampedLimit,
      );

      res.json(result);
    }),
  );

  // ── GET /weekly-mvp — Weekly MVP rankings ──

  router.get(
    "/weekly-mvp",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const weekParam = req.query.week as string | undefined;

      // Validate format if provided
      if (weekParam && !/^\d{4}-W\d{2}$/.test(weekParam)) {
        return res.status(400).json({
          error: "Invalid week format. Expected ISO week like '2026-W12'.",
        });
      }

      const evolutionService = new EvolutionService();
      const result = await evolutionService.getWeeklyMVP(weekParam);

      res.json(result);
    }),
  );

  // ── GET /sse/status — SSE connection status overview ──

  router.get(
    "/sse/status",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const stats = nodeConfigSSE.getStats();
      const connectedIds = nodeConfigSSE.getConnectedNodeIds();
      const db = getDb();

      let nodes: {
        nodeId: string;
        employeeName: string | null;
        roleId: string | null;
        lastHeartbeat: Date | null;
      }[] = [];
      if (connectedIds.length > 0) {
        nodes = await db
          .select({
            nodeId: nodesTable.nodeId,
            employeeName: nodesTable.employeeName,
            roleId: nodesTable.roleId,
            lastHeartbeat: nodesTable.lastHeartbeat,
          })
          .from(nodesTable)
          .where(inArray(nodesTable.nodeId, connectedIds));
      }

      // Get total node count
      const [{ count: totalNodes }] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(nodesTable);

      res.json({
        ok: true,
        connected_nodes: stats.totalNodes,
        total_connections: stats.totalConnections,
        total_nodes: totalNodes,
        nodes: nodes.map((n) => ({
          node_id: n.nodeId,
          employee_name: n.employeeName,
          role_id: n.roleId,
          connected: true,
          last_heartbeat: n.lastHeartbeat,
        })),
      });
    }),
  );

  // ── GET /assets/:id/usage — Usage tracking: capsules derived from a gene + reporter breakdown ──

  router.get(
    "/assets/:id/usage",
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const db = getDb();
      const id = uuidSchema.parse(req.params.id);

      // Determine asset type and assetId
      let assetId: string | null = null;
      let assetType: "gene" | "capsule" | null = null;

      const geneRows = await db
        .select({ assetId: genesTable.assetId })
        .from(genesTable)
        .where(eq(genesTable.id, id))
        .limit(1);

      if (geneRows.length > 0) {
        assetId = geneRows[0].assetId;
        assetType = "gene";
      } else {
        const capsuleRows = await db
          .select({ assetId: capsulesTable.assetId })
          .from(capsulesTable)
          .where(eq(capsulesTable.id, id))
          .limit(1);
        if (capsuleRows.length > 0) {
          assetId = capsuleRows[0].assetId;
          assetType = "capsule";
        }
      }

      if (!assetId || !assetType) {
        throw new NotFoundError("Asset");
      }

      // If asset is a gene, find capsules that reference this gene
      let capsules: Array<Record<string, unknown>> = [];
      if (assetType === "gene") {
        const capsuleRows = await db
          .select({
            id: capsulesTable.id,
            assetId: capsulesTable.assetId,
            nodeId: capsulesTable.nodeId,
            status: capsulesTable.status,
          })
          .from(capsulesTable)
          .where(eq(capsulesTable.geneAssetId, assetId));

        // LEFT JOIN with nodes to get employee name + role
        const nodeIds = capsuleRows
          .map((c) => c.nodeId)
          .filter((nid): nid is string => !!nid);
        const uniqueNodeIds = [...new Set(nodeIds)];

        let nodeMap: Record<string, { employeeName: string | null; roleId: string | null }> = {};
        if (uniqueNodeIds.length > 0) {
          const nodeRows = await db
            .select({
              nodeId: nodesTable.nodeId,
              employeeName: nodesTable.employeeName,
              roleId: nodesTable.roleId,
            })
            .from(nodesTable)
            .where(inArray(nodesTable.nodeId, uniqueNodeIds));
          for (const n of nodeRows) {
            nodeMap[n.nodeId] = { employeeName: n.employeeName, roleId: n.roleId };
          }
        }

        capsules = capsuleRows.map((c) => ({
          id: c.id,
          assetId: c.assetId,
          nodeId: c.nodeId,
          nodeName: (c.nodeId && nodeMap[c.nodeId]?.employeeName) || c.nodeId || null,
          role: (c.nodeId && nodeMap[c.nodeId]?.roleId) || null,
          status: c.status,
        }));
      }

      // Aggregate reports grouped by reporter node
      const reportAgg = await db
        .select({
          reporterNodeId: assetReportsTable.reporterNodeId,
          reportCount: sql<number>`COUNT(*)`,
          lastUsed: sql<string>`MAX(${assetReportsTable.createdAt})`,
        })
        .from(assetReportsTable)
        .where(eq(assetReportsTable.assetId, assetId))
        .groupBy(assetReportsTable.reporterNodeId);

      // Enrich with node names
      const reporterNodeIds = reportAgg.map((r) => r.reporterNodeId);
      const uniqueReporterNodeIds = [...new Set(reporterNodeIds)];

      let reporterNodeMap: Record<string, { employeeName: string | null; roleId: string | null }> = {};
      if (uniqueReporterNodeIds.length > 0) {
        const nodeRows = await db
          .select({
            nodeId: nodesTable.nodeId,
            employeeName: nodesTable.employeeName,
            roleId: nodesTable.roleId,
          })
          .from(nodesTable)
          .where(inArray(nodesTable.nodeId, uniqueReporterNodeIds));
        for (const n of nodeRows) {
          reporterNodeMap[n.nodeId] = { employeeName: n.employeeName, roleId: n.roleId };
        }
      }

      const reporters = reportAgg.map((r) => ({
        nodeId: r.reporterNodeId,
        nodeName: reporterNodeMap[r.reporterNodeId]?.employeeName || r.reporterNodeId,
        role: reporterNodeMap[r.reporterNodeId]?.roleId || null,
        reportCount: Number(r.reportCount),
        lastUsed: r.lastUsed,
      }));

      const totalUses = reporters.reduce((sum, r) => sum + r.reportCount, 0);

      res.json({
        ok: true,
        capsules,
        reporters,
        totalUses,
      });
    }),
  );

  // ── Mount ─────────────────────────────────────

  app.use("/api/v1/admin/evolution", router);
  logger.info("Evolution admin routes registered");
}
