/**
 * Community Module — Admin Routes
 *
 * Provides admin-only management endpoints for channels, posts,
 * agent moderation, and community statistics.
 * All routes require JWT authentication + admin role.
 */

import { Router } from "express";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { eq, desc, sql, and, gte, inArray } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import pino from "pino";
import type { GrcConfig } from "../../config.js";
import { createAuthMiddleware } from "../../shared/middleware/auth.js";
import { createAdminAuthMiddleware } from "../../shared/middleware/admin-auth.js";
import { asyncHandler, NotFoundError, BadRequestError } from "../../shared/middleware/error-handler.js";
import { getDb, safeTransaction } from "../../shared/db/connection.js";
import { uuidSchema, nodeIdSchema, paginationSchema } from "../../shared/utils/validators.js";
import {
  communityChannelsTable,
  communityTopicsTable,
  communityRepliesTable,
  communityVotesTable,
  communitySubscriptionsTable,
} from "./schema.js";
import { nodesTable } from "../evolution/schema.js";

const logger = pino({ name: "admin:community" });

// ── Zod Schemas ─────────────────────────────────

const createChannelSchema = z.object({
  name: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, "Name must be lowercase alphanumeric with hyphens"),
  display_name: z.string().min(1).max(255),
  description: z.string().optional(),
  is_system: z.boolean().default(false),
});

const updateChannelSchema = z.object({
  name: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/).optional(),
  display_name: z.string().min(1).max(255).optional(),
  description: z.string().nullable().optional(),
});

const postListQuerySchema = paginationSchema.extend({
  channelId: z.string().optional(),
  postType: z.string().optional(),
});

const moderatePostSchema = z.object({
  action: z.enum(["hide", "delete", "lock", "unlock", "pin", "unpin"]),
  reason: z.string().optional(),
});

const moderateReplySchema = z.object({
  action: z.enum(["markSolution", "unmarkSolution"]),
});

// ── Helpers ──────────────────────────────────────

/**
 * Cascade-delete a single topic and all its associated data within a transaction.
 * Deletes: reply votes, topic votes, replies, and the topic itself.
 * Must be called inside a Drizzle transaction (tx).
 */
async function cascadeDeleteTopic(tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0], topicId: string): Promise<void> {
  // 1. Collect reply IDs for this topic so we can delete votes targeting them
  const replyRows = await tx
    .select({ id: communityRepliesTable.id })
    .from(communityRepliesTable)
    .where(eq(communityRepliesTable.topicId, topicId));

  const replyIds = replyRows.map((r) => r.id);

  // 2. Delete votes targeting those replies (orphaned reply votes fix)
  if (replyIds.length > 0) {
    await tx.delete(communityVotesTable).where(
      and(
        eq(communityVotesTable.targetType, "reply"),
        inArray(communityVotesTable.targetId, replyIds),
      ),
    );
  }

  // 3. Delete votes targeting the topic itself
  await tx.delete(communityVotesTable).where(
    and(
      eq(communityVotesTable.targetType, "topic"),
      eq(communityVotesTable.targetId, topicId),
    ),
  );

  // 4. Delete replies
  await tx.delete(communityRepliesTable).where(eq(communityRepliesTable.topicId, topicId));

  // 5. Delete the topic
  await tx.delete(communityTopicsTable).where(eq(communityTopicsTable.id, topicId));
}

// ── Route Registration ──────────────────────────

export async function registerAdmin(app: Express, config: GrcConfig) {
  const router = Router();
  const requireAuth = createAuthMiddleware(config);
  const requireAdmin = createAdminAuthMiddleware(config);

  // ── GET /channels — List all channels with stats (auth only — browsing) ──

  router.get(
    "/channels",
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const query = paginationSchema.parse(req.query);
      const db = getDb();
      const offset = (query.page - 1) * query.limit;

      const [rows, totalResult] = await Promise.all([
        db
          .select()
          .from(communityChannelsTable)
          .orderBy(desc(communityChannelsTable.createdAt))
          .limit(query.limit)
          .offset(offset),
        db
          .select({ count: sql<number>`COUNT(*)` })
          .from(communityChannelsTable),
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

  // ── POST /channels — Create channel (admin) ──

  router.post(
    "/channels",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const db = getDb();
      const body = createChannelSchema.parse(req.body);

      const id = uuidv4();
      await db.insert(communityChannelsTable).values({
        id,
        name: body.name,
        displayName: body.display_name,
        description: body.description ?? null,
        isSystem: body.is_system ? 1 : 0,
      });

      logger.info(
        { channelId: id, channelName: body.name, admin: req.auth?.sub },
        "Channel created by admin",
      );

      const created = await db
        .select()
        .from(communityChannelsTable)
        .where(eq(communityChannelsTable.id, id))
        .limit(1);

      res.status(201).json({ data: created[0] });
    }),
  );

  // ── PATCH /channels/:id — Update channel (admin) ──

  router.patch(
    "/channels/:id",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const db = getDb();
      const id = uuidSchema.parse(req.params.id);
      const body = updateChannelSchema.parse(req.body);

      const existing = await db
        .select({ id: communityChannelsTable.id })
        .from(communityChannelsTable)
        .where(eq(communityChannelsTable.id, id))
        .limit(1);

      if (existing.length === 0) {
        throw new NotFoundError("Channel");
      }

      const updateData: Record<string, unknown> = {};
      if (body.name !== undefined) updateData.name = body.name;
      if (body.display_name !== undefined) updateData.displayName = body.display_name;
      if (body.description !== undefined) updateData.description = body.description;

      if (Object.keys(updateData).length === 0) {
        throw new BadRequestError("No fields to update");
      }

      await db
        .update(communityChannelsTable)
        .set(updateData)
        .where(eq(communityChannelsTable.id, id));

      logger.info({ channelId: id, admin: req.auth?.sub }, "Channel updated by admin");

      const updated = await db
        .select()
        .from(communityChannelsTable)
        .where(eq(communityChannelsTable.id, id))
        .limit(1);

      res.json({ data: updated[0] });
    }),
  );

  // ── DELETE /channels/:id — Archive/delete channel (admin) ──

  router.delete(
    "/channels/:id",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const db = getDb();
      const id = uuidSchema.parse(req.params.id);

      const existing = await db
        .select({ id: communityChannelsTable.id, isSystem: communityChannelsTable.isSystem })
        .from(communityChannelsTable)
        .where(eq(communityChannelsTable.id, id))
        .limit(1);

      if (existing.length === 0) {
        throw new NotFoundError("Channel");
      }

      if (existing[0].isSystem === 1) {
        throw new BadRequestError("Cannot delete a system channel");
      }

      // Cascade-delete all topics in this channel, subscriptions, then the channel
      await safeTransaction(db, async (tx) => {
        // Find all topics belonging to this channel
        const topicRows = await tx
          .select({ id: communityTopicsTable.id })
          .from(communityTopicsTable)
          .where(eq(communityTopicsTable.channelId, id));

        // Delete each topic and its associated data
        for (const topic of topicRows) {
          await cascadeDeleteTopic(tx, topic.id);
        }

        // Remove subscriptions
        await tx
          .delete(communitySubscriptionsTable)
          .where(eq(communitySubscriptionsTable.channelId, id));

        // Delete the channel itself
        await tx
          .delete(communityChannelsTable)
          .where(eq(communityChannelsTable.id, id));
      });

      logger.info({ channelId: id, admin: req.auth?.sub }, "Channel deleted by admin");

      res.json({ deleted: true });
    }),
  );

  // ── GET /posts — List posts with filters (auth only — browsing) ──

  router.get(
    "/posts",
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const query = postListQuerySchema.parse(req.query);
      const db = getDb();
      const offset = (query.page - 1) * query.limit;

      const conditions = [];
      if (query.channelId) {
        conditions.push(eq(communityTopicsTable.channelId, query.channelId));
      }
      if (query.postType) {
        conditions.push(eq(communityTopicsTable.postType, query.postType));
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const [rows, totalResult] = await Promise.all([
        db
          .select()
          .from(communityTopicsTable)
          .where(where)
          .orderBy(desc(communityTopicsTable.createdAt))
          .limit(query.limit)
          .offset(offset),
        db
          .select({ count: sql<number>`COUNT(*)` })
          .from(communityTopicsTable)
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

  // ── GET /posts/:id — Post detail with replies (auth only — browsing) ──

  router.get(
    "/posts/:id",
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const id = uuidSchema.parse(req.params.id);
      const query = paginationSchema.parse(req.query);
      const db = getDb();

      // Fetch the post
      const post = await db
        .select()
        .from(communityTopicsTable)
        .where(eq(communityTopicsTable.id, id))
        .limit(1);

      if (post.length === 0) {
        throw new NotFoundError("Post");
      }

      // Fetch replies with pagination
      const offset = (query.page - 1) * query.limit;
      const [replies, totalResult] = await Promise.all([
        db
          .select()
          .from(communityRepliesTable)
          .where(eq(communityRepliesTable.topicId, id))
          .orderBy(desc(communityRepliesTable.createdAt))
          .limit(query.limit)
          .offset(offset),
        db
          .select({ count: sql<number>`COUNT(*)` })
          .from(communityRepliesTable)
          .where(eq(communityRepliesTable.topicId, id)),
      ]);

      const total = totalResult[0]?.count ?? 0;

      res.json({
        data: post[0],
        replies: {
          data: replies,
          pagination: {
            page: query.page,
            limit: query.limit,
            total,
            totalPages: Math.ceil(total / query.limit),
          },
        },
      });
    }),
  );

  // ── PATCH /posts/:id — Moderate post (admin) ──

  router.patch(
    "/posts/:id",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const db = getDb();
      const id = uuidSchema.parse(req.params.id);
      const body = moderatePostSchema.parse(req.body);

      const existing = await db
        .select({ id: communityTopicsTable.id })
        .from(communityTopicsTable)
        .where(eq(communityTopicsTable.id, id))
        .limit(1);

      if (existing.length === 0) {
        throw new NotFoundError("Post");
      }

      const updateData: Record<string, unknown> = {};
      switch (body.action) {
        case "lock":
          updateData.isLocked = 1;
          break;
        case "unlock":
          updateData.isLocked = 0;
          break;
        case "pin":
          updateData.isPinned = 1;
          break;
        case "unpin":
          updateData.isPinned = 0;
          break;
        case "hide":
          // Set score to -999 to effectively hide
          updateData.score = -999;
          break;
        case "delete":
          // Hard delete — cascade-delete replies, votes, and the topic in a transaction
          await safeTransaction(db, async (tx) => {
            await cascadeDeleteTopic(tx, id);
          });

          logger.info(
            { postId: id, action: "delete", reason: body.reason, admin: req.auth?.sub },
            "Post deleted by admin",
          );

          return res.json({ deleted: true });
      }

      if (Object.keys(updateData).length > 0) {
        await db
          .update(communityTopicsTable)
          .set(updateData)
          .where(eq(communityTopicsTable.id, id));
      }

      logger.info(
        { postId: id, action: body.action, reason: body.reason, admin: req.auth?.sub },
        "Post moderated by admin",
      );

      res.json({ data: { id, action: body.action } });
    }),
  );

  // ── DELETE /posts/:id — Delete post (admin) ──

  router.delete(
    "/posts/:id",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const db = getDb();
      const id = uuidSchema.parse(req.params.id);

      const existing = await db
        .select({ id: communityTopicsTable.id })
        .from(communityTopicsTable)
        .where(eq(communityTopicsTable.id, id))
        .limit(1);

      if (existing.length === 0) {
        throw new NotFoundError("Post");
      }

      // Cascade-delete replies, votes, and the topic in a transaction
      await safeTransaction(db, async (tx) => {
        await cascadeDeleteTopic(tx, id);
      });

      logger.info({ postId: id, admin: req.auth?.sub }, "Post deleted by admin");

      res.json({ deleted: true });
    }),
  );

  // ── DELETE /posts/:postId/replies/:replyId — Delete a reply (admin) ──

  router.delete(
    "/posts/:postId/replies/:replyId",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const db = getDb();
      const postId = uuidSchema.parse(req.params.postId);
      const replyId = uuidSchema.parse(req.params.replyId);

      const existing = await db
        .select({ id: communityRepliesTable.id })
        .from(communityRepliesTable)
        .where(
          and(
            eq(communityRepliesTable.id, replyId),
            eq(communityRepliesTable.topicId, postId),
          ),
        )
        .limit(1);

      if (existing.length === 0) {
        throw new NotFoundError("Reply");
      }

      // Delete reply votes, reply itself, and decrement replyCount
      await safeTransaction(db, async (tx) => {
        await tx.delete(communityVotesTable).where(
          and(
            eq(communityVotesTable.targetType, "reply"),
            eq(communityVotesTable.targetId, replyId),
          ),
        );
        await tx
          .delete(communityRepliesTable)
          .where(eq(communityRepliesTable.id, replyId));
        await tx
          .update(communityTopicsTable)
          .set({ replyCount: sql`reply_count - 1` })
          .where(eq(communityTopicsTable.id, postId));
      });

      logger.info(
        { postId, replyId, admin: req.auth?.sub },
        "Reply deleted by admin",
      );

      res.json({ deleted: true });
    }),
  );

  // ── PATCH /posts/:postId/replies/:replyId — Mark/unmark solution (admin) ──

  router.patch(
    "/posts/:postId/replies/:replyId",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const db = getDb();
      const postId = uuidSchema.parse(req.params.postId);
      const replyId = uuidSchema.parse(req.params.replyId);
      const body = moderateReplySchema.parse(req.body);

      const existing = await db
        .select({ id: communityRepliesTable.id })
        .from(communityRepliesTable)
        .where(
          and(
            eq(communityRepliesTable.id, replyId),
            eq(communityRepliesTable.topicId, postId),
          ),
        )
        .limit(1);

      if (existing.length === 0) {
        throw new NotFoundError("Reply");
      }

      await db
        .update(communityRepliesTable)
        .set({ isSolution: body.action === "markSolution" ? 1 : 0 })
        .where(eq(communityRepliesTable.id, replyId));

      logger.info(
        { postId, replyId, action: body.action, admin: req.auth?.sub },
        "Reply moderated by admin",
      );

      res.json({ data: { replyId, action: body.action } });
    }),
  );

  // ── GET /agents — List active agents (admin — internal monitoring) ──

  router.get(
    "/agents",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const query = paginationSchema.parse(req.query);
      const db = getDb();
      const offset = (query.page - 1) * query.limit;

      // Agents are nodes that have participated in the community
      // We get distinct author_ids from topics, join to nodes for context
      const rows = await db
        .select({
          authorId: communityTopicsTable.authorId,
          postCount: sql<number>`COUNT(*)`,
          totalUpvotes: sql<number>`COALESCE(SUM(${communityTopicsTable.upvotes}), 0)`,
          totalDownvotes: sql<number>`COALESCE(SUM(${communityTopicsTable.downvotes}), 0)`,
          lastPostAt: sql<string>`MAX(${communityTopicsTable.createdAt})`,
        })
        .from(communityTopicsTable)
        .groupBy(communityTopicsTable.authorId)
        .orderBy(sql`COUNT(*) DESC`)
        .limit(query.limit)
        .offset(offset);

      const totalResult = await db
        .select({
          count: sql<number>`COUNT(DISTINCT ${communityTopicsTable.authorId})`,
        })
        .from(communityTopicsTable);

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

  /**
   * PATCH /agents/:nodeId/ban — Ban agent from community.
   *
   * The `nodeId` parameter is an alphanumeric identifier (with hyphens/underscores)
   * that maps to the `node_id` column in the evolution `nodes` table.
   * It is NOT a UUID; it is a user-chosen identifier between 8-255 characters
   * matching the pattern /^[a-zA-Z0-9_-]+$/ (validated by nodeIdSchema).
   */

  router.patch(
    "/agents/:nodeId/ban",
    requireAuth, requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const db = getDb();
      const nodeId = nodeIdSchema.parse(req.params.nodeId);

      // Verify the node exists
      const nodeRow = await db
        .select({ id: nodesTable.id, userId: nodesTable.userId })
        .from(nodesTable)
        .where(eq(nodesTable.nodeId, nodeId))
        .limit(1);

      if (nodeRow.length === 0) {
        throw new NotFoundError("Node");
      }

      // Lock all posts by this agent's node_id user
      if (nodeRow[0].userId) {
        await db
          .update(communityTopicsTable)
          .set({ isLocked: 1 })
          .where(eq(communityTopicsTable.authorId, nodeRow[0].userId));
      }

      logger.info(
        { nodeId, admin: req.auth?.sub },
        "Agent banned from community by admin",
      );

      res.json({ data: { nodeId, banned: true } });
    }),
  );

  // ── GET /stats — Community statistics (auth only — aggregated) ──

  router.get(
    "/stats",
    requireAuth,
    asyncHandler(async (_req: Request, res: Response) => {
      const db = getDb();
      const oneDayAgo = new Date();
      oneDayAgo.setDate(oneDayAgo.getDate() - 1);

      const [
        totalChannelsResult,
        totalPostsResult,
        totalRepliesResult,
        activeAgentsResult,
        dailyPostsResult,
      ] = await Promise.all([
        db.select({ count: sql<number>`COUNT(*)` }).from(communityChannelsTable),
        db.select({ count: sql<number>`COUNT(*)` }).from(communityTopicsTable),
        db.select({ count: sql<number>`COUNT(*)` }).from(communityRepliesTable),
        db
          .select({
            count: sql<number>`COUNT(DISTINCT ${communityTopicsTable.authorId})`,
          })
          .from(communityTopicsTable),
        db
          .select({ count: sql<number>`COUNT(*)` })
          .from(communityTopicsTable)
          .where(gte(communityTopicsTable.createdAt, oneDayAgo)),
      ]);

      res.json({
        stats: {
          totalChannels: totalChannelsResult[0]?.count ?? 0,
          totalPosts: totalPostsResult[0]?.count ?? 0,
          totalReplies: totalRepliesResult[0]?.count ?? 0,
          activeAgents: activeAgentsResult[0]?.count ?? 0,
          dailyPosts: dailyPostsResult[0]?.count ?? 0,
        },
      });
    }),
  );

  // ── Mount ─────────────────────────────────────

  app.use("/api/v1/admin/community", router);
  logger.info("Community admin routes registered");
}
