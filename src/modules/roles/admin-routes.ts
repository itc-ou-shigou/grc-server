/**
 * Roles Module — Admin Routes
 *
 * Provides admin-only management endpoints for role templates and node role assignment.
 * All routes require JWT authentication + admin role.
 */

import { Router } from "express";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { eq, desc, sql } from "drizzle-orm";
import pino from "pino";
import type { GrcConfig } from "../../config.js";
import { createAuthMiddleware } from "../../shared/middleware/auth.js";
import { createAdminAuthMiddleware } from "../../shared/middleware/admin-auth.js";
import { asyncHandler, NotFoundError } from "../../shared/middleware/error-handler.js";
import { getDb } from "../../shared/db/connection.js";
import { paginationSchema } from "../../shared/utils/validators.js";
import { nodesTable } from "./schema.js";
import { RolesService } from "./service.js";
import { chatCompletionJson } from "../../shared/llm/client.js";
import { buildRoleGenerationPrompt } from "../../shared/llm/prompts.js";

const logger = pino({ name: "admin:roles" });

// ── Zod Schemas ─────────────────────────────────

const roleListQuerySchema = paginationSchema.extend({
  industry: z.string().optional(),
  department: z.string().optional(),
  mode: z.enum(["autonomous", "copilot"]).optional(),
});

const createRoleSchema = z.object({
  id: z.string().min(1).max(50),
  name: z.string().min(1).max(255),
  emoji: z.string().max(10).optional(),
  description: z.string().optional(),
  department: z.string().max(100).optional(),
  industry: z.string().max(100).optional(),
  mode: z.enum(["autonomous", "copilot"]).optional(),
  is_builtin: z.number().int().min(0).max(1).optional(),
  agents_md: z.string(),
  soul_md: z.string(),
  identity_md: z.string(),
  user_md: z.string(),
  tools_md: z.string(),
  heartbeat_md: z.string(),
  bootstrap_md: z.string(),
  tasks_md: z.string(),
});

const updateRoleSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  emoji: z.string().max(10).optional(),
  description: z.string().optional(),
  department: z.string().max(100).optional(),
  industry: z.string().max(100).optional(),
  mode: z.enum(["autonomous", "copilot"]).optional(),
  agents_md: z.string().optional(),
  soul_md: z.string().optional(),
  identity_md: z.string().optional(),
  user_md: z.string().optional(),
  tools_md: z.string().optional(),
  heartbeat_md: z.string().optional(),
  bootstrap_md: z.string().optional(),
  tasks_md: z.string().optional(),
});

const cloneRoleSchema = z.object({
  new_id: z.string().min(1).max(50),
  new_name: z.string().min(1).max(255),
});

const assignRoleSchema = z.object({
  role_id: z.string().min(1).max(50),
  mode: z.enum(["autonomous", "copilot"]).optional(),
  variables: z.record(z.string()).default({}),
  overrides: z.record(z.string()).optional(),
});

const updateConfigFileSchema = z.object({
  content: z.string(),
});

const generatePreviewSchema = z.object({
  role_description: z.string().min(1).max(5000),
  company_info: z.string().max(3000).optional(),
  mode: z.enum(["autonomous", "copilot"]).default("autonomous"),
});

// ── Route Registration ──────────────────────────

export async function registerAdmin(app: Express, config: GrcConfig) {
  const router = Router();
  const requireAuth = createAuthMiddleware(config);
  const requireAdmin = createAdminAuthMiddleware(config);
  const service = new RolesService();

  // ── GET /roles — List all role templates (paginated) ──

  router.get(
    "/roles",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const query = roleListQuerySchema.parse(req.query);

      const result = await service.listTemplates({
        page: query.page,
        limit: query.limit,
        industry: query.industry,
        department: query.department,
        mode: query.mode,
      });

      res.json({
        data: result.templates,
        pagination: {
          page: query.page,
          limit: query.limit,
          total: result.total,
          totalPages: Math.ceil(result.total / query.limit),
        },
      });
    }),
  );

  // ── GET /roles/:id — Get single template ──

  router.get(
    "/roles/:id",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const id = req.params.id as string;
      const template = await service.getTemplate(id);

      res.json({ data: template });
    }),
  );

  // ── POST /roles — Create template ──

  router.post(
    "/roles",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const body = createRoleSchema.parse(req.body);

      const template = await service.createTemplate({
        id: body.id,
        name: body.name,
        emoji: body.emoji,
        description: body.description,
        department: body.department,
        industry: body.industry,
        mode: body.mode,
        isBuiltin: body.is_builtin,
        agentsMd: body.agents_md,
        soulMd: body.soul_md,
        identityMd: body.identity_md,
        userMd: body.user_md,
        toolsMd: body.tools_md,
        heartbeatMd: body.heartbeat_md,
        bootstrapMd: body.bootstrap_md,
        tasksMd: body.tasks_md,
      });

      res.status(201).json({ data: template });
    }),
  );

  // ── PUT /roles/:id — Update template ──

  router.put(
    "/roles/:id",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const id = req.params.id as string;
      const body = updateRoleSchema.parse(req.body);

      const template = await service.updateTemplate(id, {
        name: body.name,
        emoji: body.emoji,
        description: body.description,
        department: body.department,
        industry: body.industry,
        mode: body.mode,
        agentsMd: body.agents_md,
        soulMd: body.soul_md,
        identityMd: body.identity_md,
        userMd: body.user_md,
        toolsMd: body.tools_md,
        heartbeatMd: body.heartbeat_md,
        bootstrapMd: body.bootstrap_md,
        tasksMd: body.tasks_md,
      });

      res.json({ data: template });
    }),
  );

  // ── DELETE /roles/:id — Delete template (not builtin) ──

  router.delete(
    "/roles/:id",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const id = req.params.id as string;

      await service.deleteTemplate(id);

      res.json({ data: { id, deleted: true } });
    }),
  );

  // ── POST /roles/:id/clone — Clone template ──

  router.post(
    "/roles/:id/clone",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const id = req.params.id as string;
      const body = cloneRoleSchema.parse(req.body);

      const cloned = await service.cloneTemplate(id, body.new_id, body.new_name);

      res.status(201).json({ data: cloned });
    }),
  );

  // ── POST /roles/generate-preview — AI role generation ──

  router.post(
    "/roles/generate-preview",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const body = generatePreviewSchema.parse(req.body);

      logger.info(
        { mode: body.mode, admin: req.auth?.sub },
        "Generating AI role preview",
      );

      const messages = buildRoleGenerationPrompt({
        roleDescription: body.role_description,
        companyInfo: body.company_info,
        mode: body.mode,
      });

      const result = await chatCompletionJson<Record<string, unknown>>(
        { messages, temperature: 0.7 },
      );

      // Ensure mode is set from request
      result.mode = result.mode ?? body.mode;

      res.json(result);
    }),
  );

  // ── GET /employees — List all nodes with role info ──

  router.get(
    "/employees",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const query = paginationSchema.parse(req.query);
      const db = getDb();
      const offset = (query.page - 1) * query.limit;

      const [rows, totalResult] = await Promise.all([
        db
          .select()
          .from(nodesTable)
          .orderBy(desc(nodesTable.lastHeartbeat))
          .limit(query.limit)
          .offset(offset),
        db
          .select({ count: sql<number>`COUNT(*)` })
          .from(nodesTable),
      ]);

      const total = Number(totalResult[0]?.count ?? 0);

      // Use dedicated columns for role info (not the legacy capabilities JSON)
      const enriched = rows.map((row) => ({
        ...row,
        roleId: row.roleId ?? null,
        roleMode: row.roleMode ?? null,
        configRevision: row.configRevision ?? 0,
      }));

      res.json({
        data: enriched,
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          totalPages: Math.ceil(total / query.limit),
        },
      });
    }),
  );

  // ── POST /nodes/:nodeId/assign-role — Assign role to node ──

  router.post(
    "/nodes/:nodeId/assign-role",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const nodeId = req.params.nodeId as string;
      const body = assignRoleSchema.parse(req.body);

      const node = await service.assignRoleToNode(
        nodeId,
        body.role_id,
        body.variables,
        body.overrides,
        body.mode,
      );

      logger.info(
        { nodeId, roleId: body.role_id, admin: req.auth?.sub },
        "Role assigned to node by admin",
      );

      res.json({ data: node });
    }),
  );

  // ── POST /nodes/:nodeId/unassign-role — Unassign role ──

  router.post(
    "/nodes/:nodeId/unassign-role",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const nodeId = req.params.nodeId as string;

      const node = await service.unassignRoleFromNode(nodeId);

      logger.info(
        { nodeId, admin: req.auth?.sub },
        "Role unassigned from node by admin",
      );

      res.json({ data: node });
    }),
  );

  // ── GET /nodes/:nodeId/config — Get node's resolved config ──

  router.get(
    "/nodes/:nodeId/config",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const nodeId = req.params.nodeId as string;

      const nodeConfig = await service.getNodeConfig(nodeId);

      res.json({ data: nodeConfig });
    }),
  );

  // ── PUT /nodes/:nodeId/config/:fileName — Update single config file ──

  router.put(
    "/nodes/:nodeId/config/:fileName",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const nodeId = req.params.nodeId as string;
      const fileName = req.params.fileName as string;
      const body = updateConfigFileSchema.parse(req.body);

      await service.updateNodeConfigFile(nodeId, fileName, body.content);

      logger.info(
        { nodeId, fileName, admin: req.auth?.sub },
        "Node config file updated by admin",
      );

      res.json({ data: { nodeId, fileName, updated: true } });
    }),
  );

  // ── Mount ─────────────────────────────────────

  app.use("/api/v1/admin", router);
  logger.info("Roles admin routes registered");
}
