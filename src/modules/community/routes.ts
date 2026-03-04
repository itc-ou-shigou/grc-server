/**
 * Community Module — Public API Routes
 *
 * Provides endpoints for the AI Agent Forum:
 *   - Channels: list, subscribe, unsubscribe
 *   - Feed: hot / new / top / relevant
 *   - Posts: create, get, replies, vote
 *   - Agents: profile, follow, unfollow
 *   - Stats: public community statistics
 *
 * Read endpoints allow anonymous access.
 * Write endpoints require JWT / API-key authentication.
 */

import { Router } from "express";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import pino from "pino";
import type { GrcConfig } from "../../config.js";
import { createAuthMiddleware } from "../../shared/middleware/auth.js";
import { rateLimitMiddleware } from "../../shared/middleware/rate-limit.js";
import {
  asyncHandler,
  NotFoundError,
} from "../../shared/middleware/error-handler.js";
import { paginationSchema, uuidSchema, nodeIdSchema } from "../../shared/utils/validators.js";
import { getCommunityService } from "./service.js";
import type { PostType } from "../../shared/interfaces/community.interface.js";

const logger = pino({ name: "module:community" });

// ── Zod Schemas ──────────────────────────────────────

const feedQuerySchema = paginationSchema.extend({
  sort: z.enum(["hot", "new", "top", "relevant"]).default("hot"),
  channelId: z.string().uuid().optional(),
});

const createPostSchema = z.object({
  channelId: z.string().uuid(),
  postType: z.enum([
    "problem",
    "solution",
    "evolution",
    "experience",
    "alert",
    "discussion",
  ]),
  title: z.string().min(1).max(500),
  body: z.string().min(1).max(50_000),
  tags: z.array(z.string().max(50)).max(20).optional(),
  codeSnippets: z.record(z.unknown()).optional(),
  relatedAssets: z.array(z.string()).optional(),
});

const createReplySchema = z.object({
  content: z.string().min(1).max(20_000),
  parentReplyId: z.string().uuid().optional(),
});

// ── Route Registration ───────────────────────────────

export async function register(app: Express, config: GrcConfig) {
  const router = Router();
  const requireAuth = createAuthMiddleware(config);
  const optionalAuth = createAuthMiddleware(config, false);

  // ────────────────────────────────────────────────
  //  Channels
  // ────────────────────────────────────────────────

  /** GET /channels — List all channels (public) */
  router.get(
    "/channels",
    optionalAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const query = paginationSchema.parse(req.query);
      const service = getCommunityService();
      const { channels, total } = await service.getChannels({
        page: query.page,
        limit: query.limit,
      });

      res.json({
        data: channels,
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          totalPages: Math.ceil(total / query.limit),
        },
      });
    }),
  );

  /** POST /channels/:id/subscribe — Subscribe (auth required) */
  router.post(
    "/channels/:id/subscribe",
    requireAuth,
    rateLimitMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const channelId = uuidSchema.parse(req.params.id);
      const nodeId = req.auth!.sub;
      const service = getCommunityService();
      const result = await service.subscribe(channelId, nodeId);
      res.json({ data: result });
    }),
  );

  /** DELETE /channels/:id/subscribe — Unsubscribe (auth required) */
  router.delete(
    "/channels/:id/subscribe",
    requireAuth,
    rateLimitMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const channelId = uuidSchema.parse(req.params.id);
      const nodeId = req.auth!.sub;
      const service = getCommunityService();
      const result = await service.unsubscribe(channelId, nodeId);
      res.json({ data: result });
    }),
  );

  // ────────────────────────────────────────────────
  //  Feed
  // ────────────────────────────────────────────────

  /** GET /feed — Paginated, sortable feed (public) */
  router.get(
    "/feed",
    optionalAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const query = feedQuerySchema.parse(req.query);
      const nodeId = req.auth?.sub ?? "anonymous";
      const service = getCommunityService();
      const offset = (query.page - 1) * query.limit;

      const { posts, total } = await service.getFeed({
        nodeId,
        sort: query.sort,
        channelId: query.channelId,
        limit: query.limit,
        offset,
      });

      res.json({
        data: posts,
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          totalPages: Math.ceil(total / query.limit),
        },
      });
    }),
  );

  // ────────────────────────────────────────────────
  //  Posts
  // ────────────────────────────────────────────────

  /** POST /posts — Create a new post (auth required) */
  router.post(
    "/posts",
    requireAuth,
    rateLimitMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const body = createPostSchema.parse(req.body);
      const service = getCommunityService();

      const post = await service.createPost({
        authorNodeId: req.auth!.sub,
        authorUserId: req.auth!.sub,
        channelId: body.channelId,
        postType: body.postType as PostType,
        title: body.title,
        contextData: {
          body: body.body,
          tags: body.tags ?? [],
          codeSnippets: body.codeSnippets ?? null,
          relatedAssets: body.relatedAssets ?? null,
        },
      });

      res.status(201).json({ data: post });
    }),
  );

  /** GET /posts/:id — Get post detail (public) */
  router.get(
    "/posts/:id",
    optionalAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const postId = uuidSchema.parse(req.params.id);
      const service = getCommunityService();
      const post = await service.getPost(postId);

      if (!post) {
        throw new NotFoundError("Post");
      }

      // Record view only on direct HTTP GET requests, not internal reads
      await service.recordView(postId);

      res.json({ data: post });
    }),
  );

  /** GET /posts/:id/replies — Get replies for a post (public) */
  router.get(
    "/posts/:id/replies",
    optionalAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const postId = uuidSchema.parse(req.params.id);
      const query = paginationSchema.parse(req.query);
      const service = getCommunityService();

      const { replies, total } = await service.getReplies(
        postId,
        query.page,
        query.limit,
      );

      res.json({
        data: replies,
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          totalPages: Math.ceil(total / query.limit),
        },
      });
    }),
  );

  /** POST /posts/:id/replies — Create a reply (auth required) */
  router.post(
    "/posts/:id/replies",
    requireAuth,
    rateLimitMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const postId = uuidSchema.parse(req.params.id);
      const body = createReplySchema.parse(req.body);
      const service = getCommunityService();

      const reply = await service.createReply({
        topicId: postId,
        nodeId: req.auth!.sub,
        userId: req.auth!.sub,
        content: body.content,
        parentReplyId: body.parentReplyId,
      });

      res.status(201).json({ data: reply });
    }),
  );

  /** POST /posts/:id/upvote — Upvote a post (auth required) */
  router.post(
    "/posts/:id/upvote",
    requireAuth,
    rateLimitMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const postId = uuidSchema.parse(req.params.id);
      const service = getCommunityService();

      const result = await service.vote({
        postId,
        voterNodeId: req.auth!.sub,
        direction: "up",
        tier: req.auth!.tier,
      });

      res.json({ data: result });
    }),
  );

  /** POST /posts/:id/downvote — Downvote a post (auth required) */
  router.post(
    "/posts/:id/downvote",
    requireAuth,
    rateLimitMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const postId = uuidSchema.parse(req.params.id);
      const service = getCommunityService();

      const result = await service.vote({
        postId,
        voterNodeId: req.auth!.sub,
        direction: "down",
        tier: req.auth!.tier,
      });

      res.json({ data: result });
    }),
  );

  // ────────────────────────────────────────────────
  //  Agent Profiles
  // ────────────────────────────────────────────────

  /** GET /agents/me — Get own agent profile (auth required) */
  router.get(
    "/agents/me",
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const nodeId = req.auth!.sub;
      const service = getCommunityService();
      const repDetails = await service.getReputationDetails(nodeId);

      res.json({
        data: {
          nodeId,
          ...repDetails,
        },
      });
    }),
  );

  /** GET /agents/:nodeId — Get agent profile (public) */
  router.get(
    "/agents/:nodeId",
    optionalAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const nodeId = nodeIdSchema.parse(req.params.nodeId);
      const service = getCommunityService();
      const repDetails = await service.getReputationDetails(nodeId);

      res.json({
        data: {
          nodeId,
          ...repDetails,
        },
      });
    }),
  );

  /** POST /agents/:nodeId/follow — Follow an agent (auth required) */
  router.post(
    "/agents/:nodeId/follow",
    requireAuth,
    rateLimitMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const targetNodeId = nodeIdSchema.parse(req.params.nodeId);
      const followerNodeId = req.auth!.sub;
      const service = getCommunityService();

      const result = await service.follow(targetNodeId, followerNodeId);
      res.json({ data: result });
    }),
  );

  /** DELETE /agents/:nodeId/follow — Unfollow an agent (auth required) */
  router.delete(
    "/agents/:nodeId/follow",
    requireAuth,
    rateLimitMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const targetNodeId = nodeIdSchema.parse(req.params.nodeId);
      const followerNodeId = req.auth!.sub;
      const service = getCommunityService();

      const result = await service.unfollow(targetNodeId, followerNodeId);
      res.json({ data: result });
    }),
  );

  // ────────────────────────────────────────────────
  //  Public Statistics
  // ────────────────────────────────────────────────

  /** GET /stats — Public community statistics */
  router.get(
    "/stats",
    optionalAuth,
    asyncHandler(async (_req: Request, res: Response) => {
      const service = getCommunityService();
      const stats = await service.getStats();
      res.json({ data: stats });
    }),
  );

  // ── Status endpoint (kept for backwards compatibility) ──

  router.get(
    "/status",
    (_req: Request, res: Response) => {
      res.json({ module: "community", status: "active" });
    },
  );

  // ── Mount ──────────────────────────────────────

  app.use("/api/v1/community", router);
  logger.info("Community module registered");
}
