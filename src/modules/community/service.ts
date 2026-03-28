/**
 * Community Service — Full ICommunityService Implementation
 *
 * Handles all community operations: posts, replies, voting, channels,
 * subscriptions, follows, reputation, feed, knowledge distillation, and stats.
 */

import { v4 as uuidv4 } from "uuid";
import { eq, desc, asc, sql, and, or, gte, inArray } from "drizzle-orm";
import pino from "pino";
import { getDb, safeTransaction } from "../../shared/db/connection.js";
import {
  communityChannelsTable,
  communityTopicsTable,
  communityRepliesTable,
  communityVotesTable,
  communitySubscriptionsTable,
  communityFollowsTable,
} from "./schema.js";
import type {
  ICommunityService,
  ICommunityPost,
  PostType,
} from "../../shared/interfaces/community.interface.js";
import { calculateHotScore, sortByHot } from "./feed.js";
import { calculateVoteWeight, computeVoteDelta } from "./voting.js";
import { validatePost } from "./content-safety.js";
import {
  NotFoundError,
  BadRequestError,
  ConflictError,
} from "../../shared/middleware/error-handler.js";

const logger = pino({ name: "community:service" });

// ── Default Constants ───────────────────────────────

const DEFAULT_DISTILLATION_THRESHOLD = 20;

// ── Helpers ─────────────────────────────────────────

/**
 * Map a raw DB row from communityTopicsTable to ICommunityPost.
 */
function rowToPost(row: typeof communityTopicsTable.$inferSelect): ICommunityPost {
  return {
    id: row.id,
    authorNodeId: row.authorId,
    authorUserId: null, // Topics store authorId (which maps to userId or nodeId)
    channelId: row.channelId ?? "",
    postType: row.postType as PostType,
    title: row.title,
    contextData: (row.contextData as Record<string, unknown>) ?? {},
    score: row.score,
    replyCount: row.replyCount,
    isDistilled: row.isDistilled === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ── Service Implementation ──────────────────────────

export class CommunityService implements ICommunityService {

  // ─── Post CRUD ─────────────────────────────────

  /**
   * Create a structured community post.
   * Validates content safety, verifies channel exists, inserts into DB.
   */
  async createPost(params: {
    authorNodeId: string;
    authorUserId?: string;
    channelId: string;
    postType: PostType;
    title: string;
    contextData: Record<string, unknown>;
  }): Promise<ICommunityPost> {
    const db = getDb();

    // Validate content safety
    const body = typeof params.contextData.body === "string"
      ? params.contextData.body
      : params.title; // Use title as body fallback for validation
    const safetyResult = validatePost(params.title, body);
    if (!safetyResult.safe) {
      throw new BadRequestError(
        `Content safety check failed: ${safetyResult.reason}`,
      );
    }

    // Verify channel exists
    const channelRows = await db
      .select({ id: communityChannelsTable.id })
      .from(communityChannelsTable)
      .where(eq(communityChannelsTable.id, params.channelId))
      .limit(1);

    if (channelRows.length === 0) {
      throw new NotFoundError("Channel");
    }

    const id = uuidv4();
    const bodyText = typeof params.contextData.body === "string"
      ? params.contextData.body
      : "";
    const tags = Array.isArray(params.contextData.tags)
      ? params.contextData.tags
      : null;
    const codeSnippets = params.contextData.codeSnippets ?? null;
    const relatedAssets = params.contextData.relatedAssets ?? null;

    // Wrap post insert + channel counter increment in a transaction
    // so the counter stays accurate even under concurrent creates.
    const post = await safeTransaction(db, async (tx) => {
      await tx.insert(communityTopicsTable).values({
        id,
        authorId: params.authorUserId ?? params.authorNodeId,
        channelId: params.channelId,
        title: params.title,
        body: bodyText,
        postType: params.postType,
        tags: tags as unknown as null,
        contextData: params.contextData as unknown as null,
        codeSnippets: codeSnippets as unknown as null,
        relatedAssets: relatedAssets as unknown as null,
        score: 0,
        upvotes: 0,
        downvotes: 0,
        replyCount: 0,
        viewCount: 0,
        isPinned: 0,
        isLocked: 0,
        isDistilled: 0,
      });

      // Increment channel post count
      await tx
        .update(communityChannelsTable)
        .set({ postCount: sql`${communityChannelsTable.postCount} + 1` })
        .where(eq(communityChannelsTable.id, params.channelId));

      const rows = await tx
        .select()
        .from(communityTopicsTable)
        .where(eq(communityTopicsTable.id, id))
        .limit(1);

      return rowToPost(rows[0]!);
    });

    logger.info(
      { postId: id, channelId: params.channelId, postType: params.postType },
      "Post created",
    );

    return post;
  }

  /**
   * Get a single post by ID.
   * Pure read with no side effects — call recordView separately for HTTP GET endpoints.
   */
  async getPost(postId: string): Promise<ICommunityPost | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(communityTopicsTable)
      .where(eq(communityTopicsTable.id, postId))
      .limit(1);

    if (rows.length === 0) return null;

    return rowToPost(rows[0]!);
  }

  /**
   * Increment the view count for a post.
   * Call this from the HTTP GET /posts/:id route handler, not from internal reads.
   */
  async recordView(postId: string): Promise<void> {
    const db = getDb();
    await db
      .update(communityTopicsTable)
      .set({ viewCount: sql`view_count + 1` })
      .where(eq(communityTopicsTable.id, postId));
  }

  // ─── Feed ──────────────────────────────────────

  /**
   * Get a paginated feed of posts.
   *
   * Sorting strategies:
   *   - "new"      : createdAt DESC
   *   - "top"      : score DESC (all-time)
   *   - "hot"      : Wilson Score + time decay (computed in-app)
   *   - "relevant" : posts from subscribed channels + followed agents
   */
  async getFeed(params: {
    nodeId: string;
    sort: "hot" | "new" | "top" | "relevant";
    channelId?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ posts: ICommunityPost[]; total: number }> {
    const db = getDb();
    const limit = params.limit ?? 20;
    const offset = params.offset ?? 0;

    // Build WHERE conditions
    const conditions = [];
    if (params.channelId) {
      conditions.push(eq(communityTopicsTable.channelId, params.channelId));
    }

    // For "relevant" sort, restrict to channels the node is subscribed to
    // and agents the node follows
    if (params.sort === "relevant" && params.nodeId) {
      const subscriptionRows = await db
        .select({ channelId: communitySubscriptionsTable.channelId })
        .from(communitySubscriptionsTable)
        .where(eq(communitySubscriptionsTable.nodeId, params.nodeId));

      const followRows = await db
        .select({ followingNodeId: communityFollowsTable.followingNodeId })
        .from(communityFollowsTable)
        .where(eq(communityFollowsTable.followerNodeId, params.nodeId));

      const subChannelIds = subscriptionRows.map((r) => r.channelId);
      const followedNodeIds = followRows.map((r) => r.followingNodeId);

      const relevantConditions = [];
      if (subChannelIds.length > 0) {
        relevantConditions.push(
          inArray(communityTopicsTable.channelId, subChannelIds),
        );
      }
      if (followedNodeIds.length > 0) {
        relevantConditions.push(
          inArray(communityTopicsTable.authorId, followedNodeIds),
        );
      }

      // If the agent has neither subscriptions nor follows, fall back to "new"
      if (relevantConditions.length > 0) {
        // Use Drizzle's or() helper: posts from subscribed channels OR followed authors
        conditions.push(or(...relevantConditions)!);
      }
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    // Count total matching
    const totalResult = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(communityTopicsTable)
      .where(where);
    const total = Number(totalResult[0]?.count ?? 0);

    // Determine ordering
    let orderBy;
    switch (params.sort) {
      case "new":
      case "relevant":
        orderBy = desc(communityTopicsTable.createdAt);
        break;
      case "top":
        orderBy = desc(communityTopicsTable.score);
        break;
      case "hot":
        // For hot, we fetch more rows, compute scores in-app, then paginate
        // This avoids a complex SQL expression for Wilson Score
        orderBy = desc(communityTopicsTable.createdAt); // initial fetch order
        break;
      default:
        orderBy = desc(communityTopicsTable.createdAt);
    }

    if (params.sort === "hot") {
      // Restrict hot feed to the last 7 days so that the in-app sort pool
      // is bounded and the total count reflects the same filtered set.
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const hotWhere = where
        ? and(where, gte(communityTopicsTable.createdAt, sevenDaysAgo))
        : gte(communityTopicsTable.createdAt, sevenDaysAgo);

      // Fetch up to 500 posts within the window for in-app Wilson Score ranking
      const hotRows = await db
        .select()
        .from(communityTopicsTable)
        .where(hotWhere)
        .orderBy(desc(communityTopicsTable.createdAt))
        .limit(500);

      // Sort raw rows while they still have upvotes/downvotes fields
      sortByHot(hotRows);
      const hotPosts = hotRows.map((r) => rowToPost(r));

      // Derive total from the same filtered set (consistent with data query)
      const hotTotalResult = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(communityTopicsTable)
        .where(hotWhere);
      const hotTotal = Number(hotTotalResult[0]?.count ?? 0);

      // Apply pagination to the sorted result
      const paged = hotPosts.slice(offset, offset + limit);
      return { posts: paged, total: hotTotal };
    }

    // Standard DB-side sort + pagination
    const rows = await db
      .select()
      .from(communityTopicsTable)
      .where(where)
      .orderBy(orderBy)
      .limit(limit)
      .offset(offset);

    const posts = rows.map((r) => rowToPost(r));
    return { posts, total };
  }

  // ─── Replies ───────────────────────────────────

  /**
   * Create a reply on a topic.
   */
  async createReply(params: {
    topicId: string;
    nodeId: string;
    userId?: string;
    content: string;
    parentReplyId?: string;
  }): Promise<Record<string, unknown>> {
    const db = getDb();

    // Verify topic exists and is not locked
    const topicRows = await db
      .select({
        id: communityTopicsTable.id,
        isLocked: communityTopicsTable.isLocked,
      })
      .from(communityTopicsTable)
      .where(eq(communityTopicsTable.id, params.topicId))
      .limit(1);

    if (topicRows.length === 0) {
      throw new NotFoundError("Topic");
    }
    if (topicRows[0]!.isLocked === 1) {
      throw new BadRequestError("This topic is locked and cannot receive new replies");
    }

    // Content safety check on reply body
    const safetyResult = validatePost("reply", params.content);
    if (!safetyResult.safe) {
      throw new BadRequestError(
        `Content safety check failed: ${safetyResult.reason}`,
      );
    }

    const id = uuidv4();

    // Wrap reply insert + topic counter increment in a transaction
    // so the replyCount stays accurate even under concurrent replies.
    const created = await safeTransaction(db, async (tx) => {
      await tx.insert(communityRepliesTable).values({
        id,
        topicId: params.topicId,
        authorId: params.userId ?? params.nodeId,
        body: params.content,
        isSolution: 0,
      });

      // Increment topic reply count and update lastReplyAt
      await tx
        .update(communityTopicsTable)
        .set({
          replyCount: sql`${communityTopicsTable.replyCount} + 1`,
          lastReplyAt: new Date(),
        })
        .where(eq(communityTopicsTable.id, params.topicId));

      const rows = await tx
        .select()
        .from(communityRepliesTable)
        .where(eq(communityRepliesTable.id, id))
        .limit(1);

      return rows[0] as unknown as Record<string, unknown>;
    });

    logger.info(
      { replyId: id, topicId: params.topicId },
      "Reply created",
    );

    return created;
  }

  /**
   * Get replies for a topic with pagination.
   */
  async getReplies(
    topicId: string,
    page = 1,
    limit = 20,
  ): Promise<{ replies: Record<string, unknown>[]; total: number }> {
    const db = getDb();
    const offset = (page - 1) * limit;

    const [rows, totalResult] = await Promise.all([
      db
        .select()
        .from(communityRepliesTable)
        .where(eq(communityRepliesTable.topicId, topicId))
        .orderBy(asc(communityRepliesTable.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`COUNT(*)` })
        .from(communityRepliesTable)
        .where(eq(communityRepliesTable.topicId, topicId)),
    ]);

    const total = Number(totalResult[0]?.count ?? 0);

    return {
      replies: rows as unknown as Record<string, unknown>[],
      total,
    };
  }

  // ─── Voting ────────────────────────────────────

  /**
   * Cast or change a vote on a topic or reply.
   * Implements weighted voting and atomic score updates.
   */
  async vote(params: {
    postId: string;
    voterNodeId: string;
    direction: "up" | "down";
    targetType?: "topic" | "reply";
    tier?: string;
  }): Promise<{ newScore: number }> {
    const db = getDb();
    const targetType = params.targetType ?? "topic";
    const targetId = params.postId;
    const directionNum = params.direction === "up" ? 1 : -1;

    // Prevent self-voting on topics
    if (targetType === "topic") {
      const topicRows = await db
        .select({ authorId: communityTopicsTable.authorId })
        .from(communityTopicsTable)
        .where(eq(communityTopicsTable.id, targetId))
        .limit(1);

      if (topicRows.length === 0) {
        throw new NotFoundError("Topic");
      }
      if (topicRows[0]!.authorId === params.voterNodeId) {
        throw new BadRequestError("Cannot vote on your own post");
      }
    }

    if (targetType === "reply") {
      const replyRows = await db
        .select({ authorId: communityRepliesTable.authorId })
        .from(communityRepliesTable)
        .where(eq(communityRepliesTable.id, targetId))
        .limit(1);

      if (replyRows.length === 0) {
        throw new NotFoundError("Reply");
      }
      if (replyRows[0]!.authorId === params.voterNodeId) {
        throw new BadRequestError("Cannot vote on your own reply");
      }
    }

    // Get voter reputation for weight calculation (read outside transaction is fine)
    const reputation = await this.getReputation(params.voterNodeId);
    const tier = params.tier ?? "free";
    const weight = calculateVoteWeight(tier, reputation);

    // Wrap the read-modify-write in a transaction to prevent race conditions
    // where concurrent votes could double-count score deltas.
    return await safeTransaction(db, async (tx) => {
      // Check for existing vote
      const existingVotes = await tx
        .select()
        .from(communityVotesTable)
        .where(
          and(
            eq(communityVotesTable.nodeId, params.voterNodeId),
            eq(communityVotesTable.targetType, targetType),
            eq(communityVotesTable.targetId, targetId),
          ),
        )
        .limit(1);

      const oldDirection = existingVotes.length > 0 ? existingVotes[0]!.direction : 0;
      const oldWeight = existingVotes.length > 0 ? existingVotes[0]!.weight : 0;

      // If same direction already, this is a no-op (idempotent)
      if (oldDirection === directionNum) {
        // Return current score
        if (targetType === "topic") {
          const topicRows = await tx
            .select({ score: communityTopicsTable.score })
            .from(communityTopicsTable)
            .where(eq(communityTopicsTable.id, targetId))
            .limit(1);
          return { newScore: topicRows[0]?.score ?? 0 };
        }
        // For replies, score is not tracked on the reply table, return 0
        return { newScore: 0 };
      }

      // Compute deltas
      const { upDelta, downDelta } = computeVoteDelta(
        weight,
        directionNum,
        oldDirection,
        oldWeight,
      );

      // Upsert vote record
      if (existingVotes.length > 0) {
        await tx
          .update(communityVotesTable)
          .set({
            direction: directionNum,
            weight,
          })
          .where(eq(communityVotesTable.id, existingVotes[0]!.id));
      } else {
        await tx.insert(communityVotesTable).values({
          id: uuidv4(),
          nodeId: params.voterNodeId,
          targetType,
          targetId,
          direction: directionNum,
          weight,
        });
      }

      // Update the target's vote counters and score
      if (targetType === "topic") {
        await tx
          .update(communityTopicsTable)
          .set({
            upvotes: sql`${communityTopicsTable.upvotes} + ${upDelta}`,
            downvotes: sql`${communityTopicsTable.downvotes} + ${downDelta}`,
            score: sql`${communityTopicsTable.score} + ${upDelta} - ${downDelta}`,
          })
          .where(eq(communityTopicsTable.id, targetId));

        const updated = await tx
          .select({ score: communityTopicsTable.score })
          .from(communityTopicsTable)
          .where(eq(communityTopicsTable.id, targetId))
          .limit(1);

        logger.info(
          { targetId, voterNodeId: params.voterNodeId, direction: params.direction },
          "Vote recorded on topic",
        );

        return { newScore: updated[0]?.score ?? 0 };
      }

      // For replies, there is no score column; return 0
      logger.info(
        { targetId, voterNodeId: params.voterNodeId, direction: params.direction },
        "Vote recorded on reply",
      );

      return { newScore: 0 };
    });
  }

  // ─── Reputation ────────────────────────────────

  /**
   * Calculate reputation for a node.
   *
   * Reputation = (posts created * 5) + (replies given * 2) + (upvotes received * 1)
   */
  async getReputation(nodeId: string): Promise<number> {
    const db = getDb();

    // Count posts by this author
    const postCountResult = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(communityTopicsTable)
      .where(eq(communityTopicsTable.authorId, nodeId));
    const postCount = Number(postCountResult[0]?.count ?? 0);

    // Count replies by this author
    const replyCountResult = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(communityRepliesTable)
      .where(eq(communityRepliesTable.authorId, nodeId));
    const replyCount = Number(replyCountResult[0]?.count ?? 0);

    // Sum upvotes on this author's topics
    const upvoteResult = await db
      .select({ total: sql<number>`COALESCE(SUM(${communityTopicsTable.upvotes}), 0)` })
      .from(communityTopicsTable)
      .where(eq(communityTopicsTable.authorId, nodeId));
    const upvotesReceived = Number(upvoteResult[0]?.total ?? 0);

    return postCount * 5 + replyCount * 2 + upvotesReceived;
  }

  /**
   * Get detailed reputation breakdown.
   */
  async getReputationDetails(nodeId: string): Promise<{
    reputation: number;
    postCount: number;
    replyCount: number;
    upvotesReceived: number;
  }> {
    const db = getDb();

    const postCountResult = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(communityTopicsTable)
      .where(eq(communityTopicsTable.authorId, nodeId));
    const postCount = Number(postCountResult[0]?.count ?? 0);

    const replyCountResult = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(communityRepliesTable)
      .where(eq(communityRepliesTable.authorId, nodeId));
    const replyCount = Number(replyCountResult[0]?.count ?? 0);

    const upvoteResult = await db
      .select({ total: sql<number>`COALESCE(SUM(${communityTopicsTable.upvotes}), 0)` })
      .from(communityTopicsTable)
      .where(eq(communityTopicsTable.authorId, nodeId));
    const upvotesReceived = Number(upvoteResult[0]?.total ?? 0);

    const reputation = postCount * 5 + replyCount * 2 + upvotesReceived;

    return { reputation, postCount, replyCount, upvotesReceived };
  }

  // ─── Channels ──────────────────────────────────

  /**
   * List non-archived channels with subscriber counts.
   */
  async getChannels(params?: { page?: number; limit?: number }): Promise<{
    channels: Record<string, unknown>[];
    total: number;
  }> {
    const db = getDb();
    const page = params?.page ?? 1;
    const limit = params?.limit ?? 20;
    const offset = (page - 1) * limit;

    const [rows, totalResult] = await Promise.all([
      db
        .select()
        .from(communityChannelsTable)
        .orderBy(desc(communityChannelsTable.subscriberCount))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`COUNT(*)` })
        .from(communityChannelsTable),
    ]);

    const total = Number(totalResult[0]?.count ?? 0);

    return {
      channels: rows as unknown as Record<string, unknown>[],
      total,
    };
  }

  /**
   * Subscribe a node to a channel.
   */
  async subscribe(
    channelId: string,
    nodeId: string,
  ): Promise<{ subscribed: boolean }> {
    const db = getDb();

    // Verify channel exists (read outside transaction is fine for existence check)
    const channelRows = await db
      .select({ id: communityChannelsTable.id })
      .from(communityChannelsTable)
      .where(eq(communityChannelsTable.id, channelId))
      .limit(1);

    if (channelRows.length === 0) {
      throw new NotFoundError("Channel");
    }

    // Wrap check + insert + counter increment in a transaction to prevent
    // duplicate subscriptions and counter drift from concurrent requests.
    return await safeTransaction(db, async (tx) => {
      // Check if already subscribed
      const existing = await tx
        .select({ id: communitySubscriptionsTable.id })
        .from(communitySubscriptionsTable)
        .where(
          and(
            eq(communitySubscriptionsTable.nodeId, nodeId),
            eq(communitySubscriptionsTable.channelId, channelId),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        return { subscribed: true }; // Already subscribed (idempotent)
      }

      try {
        await tx.insert(communitySubscriptionsTable).values({
          id: uuidv4(),
          nodeId,
          channelId,
        });
      } catch (err: unknown) {
        const error = err as { code?: string };
        if (error.code === "ER_DUP_ENTRY") {
          // Concurrent insert won the race -- treat as idempotent success
          return { subscribed: true };
        }
        throw err;
      }

      // Increment subscriber count
      await tx
        .update(communityChannelsTable)
        .set({
          subscriberCount: sql`${communityChannelsTable.subscriberCount} + 1`,
        })
        .where(eq(communityChannelsTable.id, channelId));

      logger.info({ channelId, nodeId }, "Subscribed to channel");
      return { subscribed: true };
    });
  }

  /**
   * Unsubscribe a node from a channel.
   */
  async unsubscribe(
    channelId: string,
    nodeId: string,
  ): Promise<{ unsubscribed: boolean }> {
    const db = getDb();

    // Wrap check + delete + counter decrement in a transaction to prevent
    // counter drift from concurrent unsubscribe requests.
    return await safeTransaction(db, async (tx) => {
      const existing = await tx
        .select({ id: communitySubscriptionsTable.id })
        .from(communitySubscriptionsTable)
        .where(
          and(
            eq(communitySubscriptionsTable.nodeId, nodeId),
            eq(communitySubscriptionsTable.channelId, channelId),
          ),
        )
        .limit(1);

      if (existing.length === 0) {
        return { unsubscribed: true }; // Not subscribed (idempotent)
      }

      await tx
        .delete(communitySubscriptionsTable)
        .where(eq(communitySubscriptionsTable.id, existing[0]!.id));

      // Decrement subscriber count (floor at 0)
      // Dialect-aware: MAX(x, 0) works in both MySQL and SQLite (replaces MySQL-only GREATEST)
      await tx
        .update(communityChannelsTable)
        .set({
          subscriberCount: sql`MAX(${communityChannelsTable.subscriberCount} - 1, 0)`,
        })
        .where(eq(communityChannelsTable.id, channelId));

      logger.info({ channelId, nodeId }, "Unsubscribed from channel");
      return { unsubscribed: true };
    });
  }

  // ─── Following ─────────────────────────────────

  /**
   * Follow another agent.
   */
  async follow(
    targetNodeId: string,
    followerNodeId: string,
  ): Promise<{ following: boolean }> {
    const db = getDb();

    // Prevent self-follow
    if (targetNodeId === followerNodeId) {
      throw new BadRequestError("Cannot follow yourself");
    }

    // Check if already following
    const existing = await db
      .select({ id: communityFollowsTable.id })
      .from(communityFollowsTable)
      .where(
        and(
          eq(communityFollowsTable.followerNodeId, followerNodeId),
          eq(communityFollowsTable.followingNodeId, targetNodeId),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      return { following: true }; // Already following (idempotent)
    }

    await db.insert(communityFollowsTable).values({
      id: uuidv4(),
      followerNodeId,
      followingNodeId: targetNodeId,
    });

    logger.info({ targetNodeId, followerNodeId }, "Agent followed");
    return { following: true };
  }

  /**
   * Unfollow an agent.
   */
  async unfollow(
    targetNodeId: string,
    followerNodeId: string,
  ): Promise<{ unfollowed: boolean }> {
    const db = getDb();

    const existing = await db
      .select({ id: communityFollowsTable.id })
      .from(communityFollowsTable)
      .where(
        and(
          eq(communityFollowsTable.followerNodeId, followerNodeId),
          eq(communityFollowsTable.followingNodeId, targetNodeId),
        ),
      )
      .limit(1);

    if (existing.length === 0) {
      return { unfollowed: true }; // Not following (idempotent)
    }

    await db
      .delete(communityFollowsTable)
      .where(eq(communityFollowsTable.id, existing[0]!.id));

    logger.info({ targetNodeId, followerNodeId }, "Agent unfollowed");
    return { unfollowed: true };
  }

  // ─── Knowledge Distillation ────────────────────

  /**
   * Get posts with score >= minScore that have not been distilled yet.
   */
  async getDistillationCandidates(
    minScore?: number,
  ): Promise<ICommunityPost[]> {
    const db = getDb();
    const threshold = minScore ?? DEFAULT_DISTILLATION_THRESHOLD;

    const rows = await db
      .select()
      .from(communityTopicsTable)
      .where(
        and(
          eq(communityTopicsTable.isDistilled, 0),
          gte(communityTopicsTable.score, threshold),
        ),
      )
      .orderBy(desc(communityTopicsTable.score))
      .limit(50);

    return rows.map((r) => rowToPost(r));
  }

  /**
   * Mark a post as distilled, optionally storing the resulting asset_id.
   */
  async markDistilled(postId: string, assetId?: string): Promise<void> {
    const db = getDb();

    const existing = await db
      .select({ id: communityTopicsTable.id })
      .from(communityTopicsTable)
      .where(eq(communityTopicsTable.id, postId))
      .limit(1);

    if (existing.length === 0) {
      throw new NotFoundError("Post");
    }

    const updateData: Record<string, unknown> = {
      isDistilled: 1,
    };
    // Store assetId in relatedAssets if provided
    if (assetId) {
      updateData.relatedAssets = JSON.stringify([assetId]);
    }

    await db
      .update(communityTopicsTable)
      .set(updateData)
      .where(eq(communityTopicsTable.id, postId));

    logger.info({ postId, assetId }, "Post marked as distilled");
  }

  // ─── Stats ─────────────────────────────────────

  /**
   * Get aggregate community statistics.
   */
  async getStats(): Promise<Record<string, unknown>> {
    const db = getDb();
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);

    const [
      totalChannelsResult,
      totalPostsResult,
      totalRepliesResult,
      activeAgentsResult,
      dailyPostsResult,
      totalVotesResult,
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
      db.select({ count: sql<number>`COUNT(*)` }).from(communityVotesTable),
    ]);

    return {
      totalChannels: Number(totalChannelsResult[0]?.count ?? 0),
      totalPosts: Number(totalPostsResult[0]?.count ?? 0),
      totalReplies: Number(totalRepliesResult[0]?.count ?? 0),
      activeAgents: Number(activeAgentsResult[0]?.count ?? 0),
      dailyPosts: Number(dailyPostsResult[0]?.count ?? 0),
      totalVotes: Number(totalVotesResult[0]?.count ?? 0),
    };
  }
}

// ── Singleton ─────────────────────────────────────

let serviceInstance: CommunityService | null = null;

export function getCommunityService(): CommunityService {
  if (!serviceInstance) {
    serviceInstance = new CommunityService();
  }
  return serviceInstance;
}
