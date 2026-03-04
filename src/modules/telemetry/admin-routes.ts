/**
 * Telemetry Module — Admin Routes
 *
 * Provides admin-only endpoints for viewing telemetry dashboard,
 * reports, exports, and retention management.
 * All routes require JWT authentication + admin role.
 */

import { Router } from "express";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { desc, sql, and } from "drizzle-orm";
import pino from "pino";
import type { GrcConfig } from "../../config.js";
import { createAuthMiddleware } from "../../shared/middleware/auth.js";
import { createAdminAuthMiddleware } from "../../shared/middleware/admin-auth.js";
import { asyncHandler, BadRequestError } from "../../shared/middleware/error-handler.js";
import { getDb } from "../../shared/db/connection.js";
import { paginationSchema } from "../../shared/utils/validators.js";
import { telemetryReports } from "./schema.js";

const logger = pino({ name: "admin:telemetry" });

// ── Zod Schemas ─────────────────────────────────

const reportListQuerySchema = paginationSchema.extend({
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  platform: z.string().optional(),
});

const exportQuerySchema = z.object({
  dateFrom: z.string().min(1, "dateFrom is required"),
  dateTo: z.string().min(1, "dateTo is required"),
});

const cleanupReportsSchema = z.object({
  days: z.number().int().min(1).max(3650),
  dryRun: z.boolean().default(false),
});

// ── Route Registration ──────────────────────────

export async function registerAdmin(app: Express, config: GrcConfig) {
  const router = Router();
  const requireAuth = createAuthMiddleware(config);
  const requireAdmin = createAdminAuthMiddleware(config);

  // ── GET /dashboard — Aggregated telemetry stats (auth only) ──

  router.get(
    "/dashboard",
    requireAuth,
    asyncHandler(async (_req: Request, res: Response) => {
      const db = getDb();

      const [
        totalReportsResult,
        dailyCountResult,
        platformDist,
        versionDist,
        uniqueNodesResult,
      ] = await Promise.all([
        db.select({ count: sql<number>`COUNT(*)` }).from(telemetryReports),
        db
          .select({
            date: telemetryReports.reportDate,
            count: sql<number>`COUNT(*)`,
          })
          .from(telemetryReports)
          .groupBy(telemetryReports.reportDate)
          .orderBy(desc(telemetryReports.reportDate))
          .limit(30),
        db
          .select({
            platform: telemetryReports.platform,
            count: sql<number>`COUNT(*)`,
          })
          .from(telemetryReports)
          .where(sql`${telemetryReports.platform} IS NOT NULL`)
          .groupBy(telemetryReports.platform)
          .orderBy(sql`COUNT(*) DESC`),
        db
          .select({
            version: telemetryReports.winclawVersion,
            count: sql<number>`COUNT(*)`,
          })
          .from(telemetryReports)
          .where(sql`${telemetryReports.winclawVersion} IS NOT NULL`)
          .groupBy(telemetryReports.winclawVersion)
          .orderBy(sql`COUNT(*) DESC`)
          .limit(10),
        db
          .select({
            count: sql<number>`COUNT(DISTINCT ${telemetryReports.nodeId})`,
          })
          .from(telemetryReports),
      ]);

      res.json({
        stats: {
          totalReports: totalReportsResult[0]?.count ?? 0,
          uniqueNodes: uniqueNodesResult[0]?.count ?? 0,
          dailyReportCount: dailyCountResult,
          platformDistribution: platformDist.reduce(
            (acc, row) => {
              if (row.platform) acc[row.platform] = row.count;
              return acc;
            },
            {} as Record<string, number>,
          ),
          versionDistribution: versionDist.reduce(
            (acc, row) => {
              if (row.version) acc[row.version] = row.count;
              return acc;
            },
            {} as Record<string, number>,
          ),
        },
      });
    }),
  );

  // ── GET /reports — List raw telemetry reports (admin — raw node data) ──

  router.get(
    "/reports",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const query = reportListQuerySchema.parse(req.query);
      const db = getDb();
      const offset = (query.page - 1) * query.limit;

      const conditions = [];
      if (query.dateFrom) {
        conditions.push(sql`${telemetryReports.reportDate} >= ${query.dateFrom}`);
      }
      if (query.dateTo) {
        conditions.push(sql`${telemetryReports.reportDate} <= ${query.dateTo}`);
      }
      if (query.platform) {
        conditions.push(sql`${telemetryReports.platform} = ${query.platform}`);
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const [rows, totalResult] = await Promise.all([
        db
          .select()
          .from(telemetryReports)
          .where(where)
          .orderBy(desc(telemetryReports.reportDate))
          .limit(query.limit)
          .offset(offset),
        db
          .select({ count: sql<number>`COUNT(*)` })
          .from(telemetryReports)
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

  // ── GET /export — Export aggregated data as JSON (admin — raw data) ──

  router.get(
    "/export",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const query = exportQuerySchema.parse(req.query);
      const db = getDb();

      const conditions = [
        sql`${telemetryReports.reportDate} >= ${query.dateFrom}`,
        sql`${telemetryReports.reportDate} <= ${query.dateTo}`,
      ];

      const where = and(...conditions);

      const [dailyAgg, platformAgg, versionAgg] = await Promise.all([
        db
          .select({
            date: telemetryReports.reportDate,
            reportCount: sql<number>`COUNT(*)`,
            uniqueNodes: sql<number>`COUNT(DISTINCT ${telemetryReports.nodeId})`,
            totalSessions: sql<number>`COALESCE(SUM(${telemetryReports.sessionCount}), 0)`,
            totalActiveMinutes: sql<number>`COALESCE(SUM(${telemetryReports.activeMinutes}), 0)`,
          })
          .from(telemetryReports)
          .where(where)
          .groupBy(telemetryReports.reportDate)
          .orderBy(telemetryReports.reportDate),
        db
          .select({
            platform: telemetryReports.platform,
            count: sql<number>`COUNT(*)`,
          })
          .from(telemetryReports)
          .where(where)
          .groupBy(telemetryReports.platform),
        db
          .select({
            version: telemetryReports.winclawVersion,
            count: sql<number>`COUNT(*)`,
          })
          .from(telemetryReports)
          .where(where)
          .groupBy(telemetryReports.winclawVersion),
      ]);

      res.json({
        export: {
          dateRange: { from: query.dateFrom, to: query.dateTo },
          daily: dailyAgg,
          byPlatform: platformAgg,
          byVersion: versionAgg,
        },
      });
    }),
  );

  // ── POST /reports/cleanup — Delete reports older than N days (admin — destructive) ──

  router.post(
    "/reports/cleanup",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const body = cleanupReportsSchema.parse(req.body);
      const db = getDb();

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - body.days);
      const cutoffStr = cutoffDate.toISOString().split("T")[0]; // YYYY-MM-DD

      const countResult = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(telemetryReports)
        .where(sql`${telemetryReports.reportDate} < ${cutoffStr}`);

      const toDelete = countResult[0]?.count ?? 0;

      if (body.dryRun) {
        return res.json({ wouldDelete: toDelete, cutoffDate: cutoffStr, dryRun: true });
      }

      if (toDelete === 0) {
        return res.json({ deleted: 0, message: "No reports older than the specified cutoff" });
      }

      await db
        .delete(telemetryReports)
        .where(sql`${telemetryReports.reportDate} < ${cutoffStr}`);

      logger.info(
        { days: body.days, cutoffDate: cutoffStr, deletedCount: toDelete, admin: req.auth?.sub },
        "Old telemetry reports deleted",
      );

      res.json({ deleted: toDelete, cutoffDate: cutoffStr });
    }),
  );

  // ── Mount ─────────────────────────────────────

  app.use("/api/v1/admin/telemetry", router);
  logger.info("Telemetry admin routes registered");
}
