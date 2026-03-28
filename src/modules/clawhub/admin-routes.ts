/**
 * ClawHub Module — Admin Routes
 *
 * Provides admin-only management endpoints for skills, versions, and downloads.
 * All routes require JWT authentication + admin role.
 */

import { Router } from "express";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import multer from "multer";
import { eq, desc, sql, and, gte, like, or, asc } from "drizzle-orm";
import pino from "pino";
import type { GrcConfig } from "../../config.js";
import { createAuthMiddleware } from "../../shared/middleware/auth.js";
import { createAdminAuthMiddleware } from "../../shared/middleware/admin-auth.js";
import { asyncHandler, NotFoundError, BadRequestError } from "../../shared/middleware/error-handler.js";
import { getDb, safeTransaction } from "../../shared/db/connection.js";
import { uuidSchema, paginationSchema, slugSchema, semverSchema } from "../../shared/utils/validators.js";
import { skillsTable, skillVersionsTable, skillDownloadsTable, skillRatingsTable } from "./schema.js";
import { users } from "../auth/schema.js";
import { publishSkill } from "./service.js";

const logger = pino({ name: "admin:clawhub" });

function escapeLikePattern(s: string): string {
  return s.replace(/[%_\\]/g, "\\$&");
}

// ── Zod Schemas ─────────────────────────────────

const skillListQuerySchema = paginationSchema.extend({
  page_size: z.coerce.number().int().min(1).max(100).optional(),
  status: z.string().optional(),
  authorId: z.string().uuid().optional(),
  category: z.string().optional(),
  search: z.string().max(200).optional(),
  sort_by: z.enum(["createdAt", "downloads", "rating"]).optional().default("createdAt"),
});

const changeStatusSchema = z.object({
  status: z.enum(["active", "approved", "rejected", "flagged", "removed"]),
  reason: z.string().optional(),
});

// ── Route Registration ──────────────────────────

export async function registerAdmin(app: Express, config: GrcConfig) {
  const router = Router();
  const requireAuth = createAuthMiddleware(config);
  const requireAdmin = createAdminAuthMiddleware(config);

  // ── GET / — List all skills (auth only — browsing) ──

  router.get(
    "/",
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const query = skillListQuerySchema.parse(req.query);
      const db = getDb();
      const pageSize = query.page_size ?? query.limit;
      const offset = (query.page - 1) * pageSize;

      const conditions = [];
      if (query.status) {
        conditions.push(eq(skillsTable.status, query.status));
      }
      if (query.authorId) {
        conditions.push(eq(skillsTable.authorId, query.authorId));
      }
      if (query.category) {
        conditions.push(eq(skillsTable.category, query.category));
      }
      // Text search: match against name, slug, or description
      if (query.search) {
        const pattern = `%${escapeLikePattern(query.search)}%`;
        conditions.push(
          or(
            like(skillsTable.name, pattern),
            like(skillsTable.slug, pattern),
            like(skillsTable.description, pattern),
          )!,
        );
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      // Dynamic sort
      let orderByClause;
      switch (query.sort_by) {
        case "downloads":
          orderByClause = desc(skillsTable.downloadCount);
          break;
        case "rating":
          orderByClause = desc(skillsTable.ratingAvg);
          break;
        case "createdAt":
        default:
          orderByClause = desc(skillsTable.createdAt);
          break;
      }

      const [rows, totalResult] = await Promise.all([
        db
          .select({
            id: skillsTable.id,
            slug: skillsTable.slug,
            name: skillsTable.name,
            description: skillsTable.description,
            authorId: skillsTable.authorId,
            category: skillsTable.category,
            tags: skillsTable.tags,
            latestVersion: skillsTable.latestVersion,
            downloadCount: skillsTable.downloadCount,
            ratingAvg: skillsTable.ratingAvg,
            ratingCount: skillsTable.ratingCount,
            isOfficial: skillsTable.isOfficial,
            status: skillsTable.status,
            createdAt: skillsTable.createdAt,
            updatedAt: skillsTable.updatedAt,
            authorDisplayName: users.displayName,
            authorEmail: users.email,
          })
          .from(skillsTable)
          .leftJoin(users, eq(skillsTable.authorId, users.id))
          .where(where)
          .orderBy(orderByClause)
          .limit(pageSize)
          .offset(offset),
        db
          .select({ count: sql<number>`COUNT(*)` })
          .from(skillsTable)
          .where(where),
      ]);

      const total = totalResult[0]?.count ?? 0;

      res.json({
        data: rows,
        pagination: {
          page: query.page,
          limit: pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        },
      });
    }),
  );

  // ── GET /downloads/stats — Download statistics (auth only — aggregated) ──
  // NOTE: This route must be defined BEFORE /:id to avoid matching "downloads" as an id

  router.get(
    "/downloads/stats",
    requireAuth,
    asyncHandler(async (_req: Request, res: Response) => {
      const db = getDb();
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const [totalResult, bySkill, byDay] = await Promise.all([
        db
          .select({ count: sql<number>`COUNT(*)` })
          .from(skillDownloadsTable),
        db
          .select({
            skillId: skillDownloadsTable.skillId,
            skillName: skillsTable.name,
            count: sql<number>`COUNT(*)`,
          })
          .from(skillDownloadsTable)
          .leftJoin(skillsTable, eq(skillDownloadsTable.skillId, skillsTable.id))
          .groupBy(skillDownloadsTable.skillId, skillsTable.name)
          .orderBy(sql`COUNT(*) DESC`)
          .limit(20),
        db
          .select({
            date: sql<string>`DATE(${skillDownloadsTable.downloadedAt})`,
            count: sql<number>`COUNT(*)`,
          })
          .from(skillDownloadsTable)
          .where(gte(skillDownloadsTable.downloadedAt, thirtyDaysAgo))
          .groupBy(sql`DATE(${skillDownloadsTable.downloadedAt})`)
          .orderBy(sql`DATE(${skillDownloadsTable.downloadedAt})`),
      ]);

      res.json({
        stats: {
          totalDownloads: totalResult[0]?.count ?? 0,
          bySkill,
          byDay,
        },
      });
    }),
  );

  // ── GET /categories — List all used categories with counts (auth only) ──

  router.get(
    "/categories",
    requireAuth,
    asyncHandler(async (_req: Request, res: Response) => {
      const db = getDb();

      const rows = await db
        .select({
          category: skillsTable.category,
          count: sql<number>`COUNT(*)`,
        })
        .from(skillsTable)
        .where(sql`${skillsTable.category} IS NOT NULL`)
        .groupBy(skillsTable.category)
        .orderBy(sql`COUNT(*) DESC`);

      res.json({ data: rows });
    }),
  );

  // ── GET /:id — Get skill details with all versions (auth only — browsing) ──

  router.get(
    "/:id",
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const db = getDb();
      const id = uuidSchema.parse(req.params.id);

      const skillRows = await db
        .select()
        .from(skillsTable)
        .where(eq(skillsTable.id, id))
        .limit(1);

      if (skillRows.length === 0) {
        throw new NotFoundError("Skill");
      }

      const versions = await db
        .select()
        .from(skillVersionsTable)
        .where(eq(skillVersionsTable.skillId, id))
        .orderBy(desc(skillVersionsTable.createdAt));

      res.json({
        data: {
          ...skillRows[0],
          versions,
        },
      });
    }),
  );

  // ── PATCH /:id/status — Change skill status (admin) ──

  router.patch(
    "/:id/status",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const db = getDb();
      const id = uuidSchema.parse(req.params.id);
      const body = changeStatusSchema.parse(req.body);

      const existing = await db
        .select({ id: skillsTable.id })
        .from(skillsTable)
        .where(eq(skillsTable.id, id))
        .limit(1);

      if (existing.length === 0) {
        throw new NotFoundError("Skill");
      }

      await db
        .update(skillsTable)
        .set({ status: body.status })
        .where(eq(skillsTable.id, id));

      logger.info(
        { skillId: id, newStatus: body.status, reason: body.reason, admin: req.auth?.sub },
        "Skill status changed by admin",
      );

      res.json({ data: { id, status: body.status } });
    }),
  );

  // ── DELETE /:id — Force delete skill (admin) ──

  router.delete(
    "/:id",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const db = getDb();
      const id = uuidSchema.parse(req.params.id);

      const existing = await db
        .select({ id: skillsTable.id })
        .from(skillsTable)
        .where(eq(skillsTable.id, id))
        .limit(1);

      if (existing.length === 0) {
        throw new NotFoundError("Skill");
      }

      // Delete related records first, then the skill — all in a transaction
      await safeTransaction(db, async (tx) => {
        await tx.delete(skillDownloadsTable).where(eq(skillDownloadsTable.skillId, id));
        await tx.delete(skillRatingsTable).where(eq(skillRatingsTable.skillId, id));
        await tx.delete(skillVersionsTable).where(eq(skillVersionsTable.skillId, id));
        await tx.delete(skillsTable).where(eq(skillsTable.id, id));
      });

      logger.info({ skillId: id, admin: req.auth?.sub }, "Skill force-deleted by admin");

      res.json({ deleted: true });
    }),
  );

  // ── POST / — Admin publish a new skill (multipart form data) ──

  const adminUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  });

  const adminPublishSchema = z.object({
    name: z.string().min(1).max(255),
    slug: slugSchema,
    description: z.string().min(1).max(10000),
    version: semverSchema,
    category: z.string().max(100).optional(),
    tags: z.string().transform((val) => {
      try {
        const parsed = JSON.parse(val);
        if (!Array.isArray(parsed)) throw new Error("tags must be an array");
        return parsed as string[];
      } catch {
        throw new Error("tags must be a valid JSON array of strings");
      }
    }).optional().default("[]"),
    changelog: z.string().max(10000).optional(),
    isOfficial: z.enum(["0", "1"]).optional().default("0"),
  });

  router.post(
    "/",
    requireAuth, requireAdmin,
    adminUpload.single("tarball"),
    asyncHandler(async (req: Request, res: Response) => {
      if (!req.file) {
        throw new BadRequestError("Tarball file is required (field: tarball)");
      }

      const fields = adminPublishSchema.parse(req.body);

      const result = await publishSkill({
        name: fields.name,
        slug: fields.slug,
        description: fields.description,
        version: fields.version,
        tags: fields.tags ?? [],
        changelog: fields.changelog,
        tarball: req.file.buffer,
        authorId: req.auth!.sub,
      });

      // Set category and isOfficial (admin-only fields)
      if (fields.category || fields.isOfficial === "1") {
        const db = getDb();
        await db
          .update(skillsTable)
          .set({
            ...(fields.category ? { category: fields.category } : {}),
            ...(fields.isOfficial === "1" ? { isOfficial: 1 } : {}),
          })
          .where(eq(skillsTable.id, result.skill.id));

        result.skill.category = fields.category ?? result.skill.category;
        if (fields.isOfficial === "1") {
          result.skill.isOfficial = 1;
        }
      }

      logger.info(
        { skillId: result.skill.id, slug: fields.slug, version: fields.version, admin: req.auth?.sub },
        "Skill published by admin",
      );

      res.status(201).json(result);
    }),
  );

  // ── Mount ─────────────────────────────────────

  app.use("/api/v1/admin/skills", router);
  logger.info("ClawHub admin routes registered");
}
