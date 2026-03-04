/**
 * Update Module — Admin Routes
 *
 * Provides admin-only management endpoints for client releases and update reports.
 * All routes require JWT authentication + admin role.
 */

import { Router } from "express";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { eq, desc, sql, and } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import pino from "pino";
import type { GrcConfig } from "../../config.js";
import { createAuthMiddleware } from "../../shared/middleware/auth.js";
import { createAdminAuthMiddleware } from "../../shared/middleware/admin-auth.js";
import { asyncHandler, NotFoundError, BadRequestError } from "../../shared/middleware/error-handler.js";
import { getDb } from "../../shared/db/connection.js";
import { uuidSchema, paginationSchema } from "../../shared/utils/validators.js";
import { clientReleases, updateReports } from "./schema.js";

const logger = pino({ name: "admin:update" });

// ── Zod Schemas ─────────────────────────────────

const releaseListQuerySchema = paginationSchema.extend({
  platform: z.string().optional(),
  channel: z.string().optional(),
});

const createReleaseSchema = z.object({
  version: z.string().min(1).max(50),
  platform: z.string().min(1).max(20),
  channel: z.string().min(1).max(20).default("stable"),
  download_url: z.string().url().max(500),
  size_bytes: z.number().int().positive(),
  checksum_sha256: z.string().max(64).optional(),
  changelog: z.string().optional(),
  min_upgrade_version: z.string().max(50).optional(),
  is_critical: z.boolean().default(false),
});

const updateReleaseSchema = z.object({
  download_url: z.string().url().max(500).optional(),
  size_bytes: z.number().int().positive().optional(),
  checksum_sha256: z.string().max(64).optional(),
  changelog: z.string().optional(),
  min_upgrade_version: z.string().max(50).nullable().optional(),
  is_critical: z.boolean().optional(),
  published_at: z.string().datetime().optional(),
});

const reportListQuerySchema = paginationSchema.extend({
  status: z.string().optional(),
  platform: z.string().optional(),
  version: z.string().optional(),
});

// ── Route Registration ──────────────────────────

export async function registerAdmin(app: Express, config: GrcConfig) {
  const router = Router();
  const requireAuth = createAuthMiddleware(config);
  const requireAdmin = createAdminAuthMiddleware(config);

  // ── GET /releases — List all releases (auth only — browsing) ──

  router.get(
    "/releases",
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const query = releaseListQuerySchema.parse(req.query);
      const db = getDb();
      const offset = (query.page - 1) * query.limit;

      const conditions = [];
      if (query.platform) {
        conditions.push(eq(clientReleases.platform, query.platform));
      }
      if (query.channel) {
        conditions.push(eq(clientReleases.channel, query.channel));
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const [rows, totalResult] = await Promise.all([
        db
          .select()
          .from(clientReleases)
          .where(where)
          .orderBy(desc(clientReleases.publishedAt))
          .limit(query.limit)
          .offset(offset),
        db
          .select({ count: sql<number>`COUNT(*)` })
          .from(clientReleases)
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

  // ── POST /releases — Create new release (admin) ──

  router.post(
    "/releases",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const db = getDb();
      const body = createReleaseSchema.parse(req.body);

      const id = uuidv4();
      await db.insert(clientReleases).values({
        id,
        version: body.version,
        platform: body.platform,
        channel: body.channel,
        downloadUrl: body.download_url,
        sizeBytes: body.size_bytes,
        checksumSha256: body.checksum_sha256 ?? null,
        changelog: body.changelog ?? null,
        minUpgradeVersion: body.min_upgrade_version ?? null,
        isCritical: body.is_critical ? 1 : 0,
      });

      logger.info(
        { releaseId: id, version: body.version, platform: body.platform, admin: req.auth?.sub },
        "Release created by admin",
      );

      const created = await db
        .select()
        .from(clientReleases)
        .where(eq(clientReleases.id, id))
        .limit(1);

      res.status(201).json({ data: created[0] });
    }),
  );

  // ── PATCH /releases/:id — Update release fields (admin) ──

  router.patch(
    "/releases/:id",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const db = getDb();
      const id = uuidSchema.parse(req.params.id);
      const body = updateReleaseSchema.parse(req.body);

      const existing = await db
        .select({ id: clientReleases.id })
        .from(clientReleases)
        .where(eq(clientReleases.id, id))
        .limit(1);

      if (existing.length === 0) {
        throw new NotFoundError("Release");
      }

      const updateData: Record<string, unknown> = {};
      if (body.download_url !== undefined) updateData.downloadUrl = body.download_url;
      if (body.size_bytes !== undefined) updateData.sizeBytes = body.size_bytes;
      if (body.checksum_sha256 !== undefined) updateData.checksumSha256 = body.checksum_sha256;
      if (body.changelog !== undefined) updateData.changelog = body.changelog;
      if (body.min_upgrade_version !== undefined) updateData.minUpgradeVersion = body.min_upgrade_version;
      if (body.is_critical !== undefined) updateData.isCritical = body.is_critical ? 1 : 0;
      if (body.published_at !== undefined) updateData.publishedAt = new Date(body.published_at);

      if (Object.keys(updateData).length === 0) {
        throw new BadRequestError("No fields to update");
      }

      await db
        .update(clientReleases)
        .set(updateData)
        .where(eq(clientReleases.id, id));

      logger.info({ releaseId: id, admin: req.auth?.sub }, "Release updated by admin");

      const updated = await db
        .select()
        .from(clientReleases)
        .where(eq(clientReleases.id, id))
        .limit(1);

      res.json({ data: updated[0] });
    }),
  );

  // ── DELETE /releases/:id — Delete release (admin) ──

  router.delete(
    "/releases/:id",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const db = getDb();
      const id = uuidSchema.parse(req.params.id);

      const existing = await db
        .select({ id: clientReleases.id })
        .from(clientReleases)
        .where(eq(clientReleases.id, id))
        .limit(1);

      if (existing.length === 0) {
        throw new NotFoundError("Release");
      }

      await db.delete(clientReleases).where(eq(clientReleases.id, id));

      logger.info({ releaseId: id, admin: req.auth?.sub }, "Release deleted by admin");

      res.json({ deleted: true });
    }),
  );

  // ── GET /reports — List update reports (auth only — browsing) ──

  router.get(
    "/reports",
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const query = reportListQuerySchema.parse(req.query);
      const db = getDb();
      const offset = (query.page - 1) * query.limit;

      const conditions = [];
      if (query.status) {
        conditions.push(eq(updateReports.status, query.status));
      }
      if (query.platform) {
        conditions.push(eq(updateReports.platform, query.platform));
      }
      if (query.version) {
        conditions.push(eq(updateReports.toVersion, query.version));
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const [rows, totalResult] = await Promise.all([
        db
          .select()
          .from(updateReports)
          .where(where)
          .orderBy(desc(updateReports.reportedAt))
          .limit(query.limit)
          .offset(offset),
        db
          .select({ count: sql<number>`COUNT(*)` })
          .from(updateReports)
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

  // ── GET /stats — Update statistics (auth only — aggregated) ──

  router.get(
    "/stats",
    requireAuth,
    asyncHandler(async (_req: Request, res: Response) => {
      const db = getDb();

      const [
        totalResult,
        successResult,
        platformDist,
        avgDurationResult,
        versionAdoption,
      ] = await Promise.all([
        db.select({ count: sql<number>`COUNT(*)` }).from(updateReports),
        db
          .select({ count: sql<number>`COUNT(*)` })
          .from(updateReports)
          .where(eq(updateReports.status, "success")),
        db
          .select({
            platform: updateReports.platform,
            count: sql<number>`COUNT(*)`,
          })
          .from(updateReports)
          .groupBy(updateReports.platform),
        db
          .select({
            avg: sql<number>`AVG(${updateReports.durationMs})`,
          })
          .from(updateReports)
          .where(sql`${updateReports.durationMs} IS NOT NULL`),
        db
          .select({
            version: updateReports.toVersion,
            count: sql<number>`COUNT(*)`,
          })
          .from(updateReports)
          .where(eq(updateReports.status, "success"))
          .groupBy(updateReports.toVersion)
          .orderBy(sql`COUNT(*) DESC`)
          .limit(10),
      ]);

      const totalReports = totalResult[0]?.count ?? 0;
      const successCount = successResult[0]?.count ?? 0;
      const successRate = totalReports > 0 ? (successCount / totalReports) * 100 : 0;

      res.json({
        stats: {
          totalReports,
          successRate: Math.round(successRate * 100) / 100,
          platformDistribution: platformDist.reduce(
            (acc, row) => {
              const key = row.platform ?? "unknown";
              acc[key] = row.count;
              return acc;
            },
            {} as Record<string, number>,
          ),
          avgDurationMs: avgDurationResult[0]?.avg ?? null,
          versionAdoption,
        },
      });
    }),
  );

  // ── Mount ─────────────────────────────────────

  app.use("/api/v1/admin/update", router);
  logger.info("Update admin routes registered");
}
