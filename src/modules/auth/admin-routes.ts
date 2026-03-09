/**
 * Auth Module — Admin Routes
 *
 * Provides admin-only management endpoints for users and API keys.
 * All routes require JWT authentication + admin role.
 */

import { Router } from "express";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { eq, desc, sql, and, gte, isNull } from "drizzle-orm";
import pino from "pino";
import type { GrcConfig } from "../../config.js";
import { createAuthMiddleware } from "../../shared/middleware/auth.js";
import { createAdminAuthMiddleware } from "../../shared/middleware/admin-auth.js";
import { asyncHandler, NotFoundError, BadRequestError } from "../../shared/middleware/error-handler.js";
import { getDb } from "../../shared/db/connection.js";
import { uuidSchema, paginationSchema } from "../../shared/utils/validators.js";
import { users, apiKeys, refreshTokens } from "./schema.js";

const logger = pino({ name: "admin:auth" });

// ── Helpers ──────────────────────────────────────

/** Escape SQL LIKE special characters (%, _, \) to prevent wildcard injection. */
function escapeLikePattern(s: string): string {
  return s.replace(/[%_\\]/g, "\\$&");
}

// ── Zod Schemas ─────────────────────────────────

const userListQuerySchema = paginationSchema.extend({
  provider: z.string().optional(),
  tier: z.enum(["free", "contributor", "pro"]).optional(),
  search: z.string().optional(),
});

const changeTierSchema = z.object({
  tier: z.enum(["free", "contributor", "pro"]),
});

const banUserSchema = z.object({
  banned: z.boolean(),
});

// ── Route Registration ──────────────────────────

export async function registerAdmin(app: Express, config: GrcConfig) {
  const router = Router();
  const requireAuth = createAuthMiddleware(config);
  const requireAdmin = createAdminAuthMiddleware(config);

  // ── GET /stats — Auth statistics (any authenticated user — aggregated, no PII) ──

  router.get(
    "/stats",
    requireAuth,
    asyncHandler(async (_req: Request, res: Response) => {
      const db = getDb();
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const [
        totalUsersResult,
        tierDistribution,
        providerDistribution,
        newUsersResult,
      ] = await Promise.all([
        db.select({ count: sql<number>`COUNT(*)` }).from(users),
        db
          .select({
            tier: users.tier,
            count: sql<number>`COUNT(*)`,
          })
          .from(users)
          .groupBy(users.tier),
        db
          .select({
            provider: users.provider,
            count: sql<number>`COUNT(*)`,
          })
          .from(users)
          .groupBy(users.provider),
        db
          .select({ count: sql<number>`COUNT(*)` })
          .from(users)
          .where(gte(users.createdAt, sevenDaysAgo)),
      ]);

      res.json({
        stats: {
          totalUsers: totalUsersResult[0]?.count ?? 0,
          tierDistribution: tierDistribution.reduce(
            (acc, row) => {
              acc[row.tier] = row.count;
              return acc;
            },
            {} as Record<string, number>,
          ),
          providerDistribution: providerDistribution.reduce(
            (acc, row) => {
              acc[row.provider] = row.count;
              return acc;
            },
            {} as Record<string, number>,
          ),
          newUsersLast7Days: newUsersResult[0]?.count ?? 0,
        },
      });
    }),
  );

  // ── GET /me — Current user profile (auth only) ──

  router.get(
    "/me",
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const db = getDb();
      const userId = req.auth!.sub;

      const rows = await db
        .select({
          id: users.id,
          displayName: users.displayName,
          email: users.email,
          tier: users.tier,
          role: users.role,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (rows.length === 0) {
        throw new NotFoundError("User");
      }

      const user = rows[0];
      // Use JWT role if DB role is not admin (dev token / admin middleware sets role in JWT)
      const jwtRole = req.auth?.role;
      if (jwtRole === "admin" && user.role !== "admin") {
        user.role = "admin";
      }

      res.json({ user });
    }),
  );

  // ── GET /users — List users with pagination and filters (admin — PII) ──

  router.get(
    "/users",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const query = userListQuerySchema.parse(req.query);
      const db = getDb();
      const offset = (query.page - 1) * query.limit;

      const conditions = [];
      if (query.provider) {
        conditions.push(eq(users.provider, query.provider));
      }
      if (query.tier) {
        conditions.push(eq(users.tier, query.tier));
      }
      if (query.search) {
        const escaped = `%${escapeLikePattern(query.search)}%`;
        conditions.push(
          sql`(${users.displayName} LIKE ${escaped} OR ${users.email} LIKE ${escaped})`,
        );
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const [rows, totalResult] = await Promise.all([
        db
          .select({
            id: users.id,
            provider: users.provider,
            providerId: users.providerId,
            displayName: users.displayName,
            avatarUrl: users.avatarUrl,
            email: users.email,
            tier: users.tier,
            role: users.role,
            createdAt: users.createdAt,
            updatedAt: users.updatedAt,
          })
          .from(users)
          .where(where)
          .orderBy(desc(users.createdAt))
          .limit(query.limit)
          .offset(offset),
        db
          .select({ count: sql<number>`COUNT(*)` })
          .from(users)
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

  // ── GET /users/:id — Get user by ID (admin — PII) ──

  router.get(
    "/users/:id",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const db = getDb();
      const id = uuidSchema.parse(req.params.id);

      const rows = await db
        .select({
          id: users.id,
          provider: users.provider,
          providerId: users.providerId,
          displayName: users.displayName,
          avatarUrl: users.avatarUrl,
          email: users.email,
          tier: users.tier,
          role: users.role,
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
        })
        .from(users)
        .where(eq(users.id, id))
        .limit(1);

      if (rows.length === 0) {
        throw new NotFoundError("User");
      }

      res.json({ data: rows[0] });
    }),
  );

  // ── PATCH /users/:id/tier — Change user tier (admin) ──

  router.patch(
    "/users/:id/tier",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const db = getDb();
      const id = uuidSchema.parse(req.params.id);
      const body = changeTierSchema.parse(req.body);

      const existing = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, id))
        .limit(1);

      if (existing.length === 0) {
        throw new NotFoundError("User");
      }

      await db
        .update(users)
        .set({ tier: body.tier })
        .where(eq(users.id, id));

      logger.info({ userId: id, newTier: body.tier, admin: req.auth?.sub }, "User tier changed");

      res.json({ data: { id, tier: body.tier } });
    }),
  );

  // ── PATCH /users/:id/ban — Ban/unban user (admin) ──

  router.patch(
    "/users/:id/ban",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const db = getDb();
      const id = uuidSchema.parse(req.params.id);
      const body = banUserSchema.parse(req.body);

      const existing = await db
        .select({ id: users.id, role: users.role })
        .from(users)
        .where(eq(users.id, id))
        .limit(1);

      if (existing.length === 0) {
        throw new NotFoundError("User");
      }

      if (existing[0].role === "admin") {
        throw new BadRequestError("Cannot ban an admin user");
      }

      const newRole = body.banned ? "banned" : "user";
      await db
        .update(users)
        .set({ role: newRole })
        .where(eq(users.id, id));

      // Revoke all refresh tokens for banned users
      if (body.banned) {
        await db
          .update(refreshTokens)
          .set({ revokedAt: sql`CURRENT_TIMESTAMP` })
          .where(and(eq(refreshTokens.userId, id), isNull(refreshTokens.revokedAt)));
        logger.info({ userId: id }, "All refresh tokens revoked due to ban");
      }

      logger.info({ userId: id, banned: body.banned, admin: req.auth?.sub }, "User ban status changed");

      res.json({ data: { id, role: newRole, banned: body.banned } });
    }),
  );

  // ── GET /apikeys — List all API keys (admin — security sensitive) ──

  router.get(
    "/apikeys",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const query = paginationSchema.parse(req.query);
      const db = getDb();
      const offset = (query.page - 1) * query.limit;

      const [rows, totalResult] = await Promise.all([
        db
          .select({
            id: apiKeys.id,
            userId: apiKeys.userId,
            keyPrefix: apiKeys.keyPrefix,
            name: apiKeys.name,
            scopes: apiKeys.scopes,
            lastUsedAt: apiKeys.lastUsedAt,
            expiresAt: apiKeys.expiresAt,
            createdAt: apiKeys.createdAt,
            userDisplayName: users.displayName,
            userEmail: users.email,
          })
          .from(apiKeys)
          .leftJoin(users, eq(apiKeys.userId, users.id))
          .orderBy(desc(apiKeys.createdAt))
          .limit(query.limit)
          .offset(offset),
        db
          .select({ count: sql<number>`COUNT(*)` })
          .from(apiKeys),
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

  // ── DELETE /apikeys/:id — Revoke an API key (admin) ──

  router.delete(
    "/apikeys/:id",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const db = getDb();
      const id = uuidSchema.parse(req.params.id);

      const existing = await db
        .select({ id: apiKeys.id })
        .from(apiKeys)
        .where(eq(apiKeys.id, id))
        .limit(1);

      if (existing.length === 0) {
        throw new NotFoundError("API key");
      }

      await db.delete(apiKeys).where(eq(apiKeys.id, id));

      logger.info({ keyId: id, admin: req.auth?.sub }, "API key revoked by admin");

      res.json({ deleted: true });
    }),
  );

  // ── Mount ─────────────────────────────────────

  app.use("/api/v1/admin/auth", router);
  logger.info("Auth admin routes registered");
}
