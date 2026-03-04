/**
 * Evolution Module — Admin Routes
 *
 * Provides admin-only management endpoints for genes, capsules, nodes, and asset reports.
 * All routes require JWT authentication + admin role.
 */

import { Router } from "express";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { eq, desc, sql, and } from "drizzle-orm";
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
          .select()
          .from(assetReportsTable)
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
          .select()
          .from(assetReportsTable)
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

      const fiveMinutesAgo = new Date();
      fiveMinutesAgo.setMinutes(fiveMinutesAgo.getMinutes() - 5);

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
          .where(sql`${nodesTable.lastHeartbeat} >= ${fiveMinutesAgo}`),
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

  // ── Mount ─────────────────────────────────────

  app.use("/api/v1/admin/evolution", router);
  logger.info("Evolution admin routes registered");
}
