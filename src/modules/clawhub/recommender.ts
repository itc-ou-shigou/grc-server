/**
 * ClawHub+ Recommendation Engine
 *
 * Multi-strategy recommender for the Skill Marketplace.
 *
 * Strategies:
 *   1. Collaborative Filtering -- users who downloaded X also downloaded Y
 *   2. Content-Based           -- skills with similar tags to user history
 *   3. Trending                -- rapidly growing downloads in the last 7 days
 *   4. Cold Start              -- platform-aware popular skills for new users
 *
 * The `auto` strategy selects the best combination based on the amount
 * of history available for the requesting user.
 */

import { sql, eq, desc, and, inArray, gt } from "drizzle-orm";
import pino from "pino";
import { getDb } from "../../shared/db/connection.js";
import { getCurrentDialect } from "../../shared/db/dialect.js";
import { skillsTable, skillDownloadsTable } from "./schema.js";

const logger = pino({ name: "clawhub:recommender" });

// ── Public Types ────────────────────────────────────

export interface RecommendationRequest {
  /** WinClaw node ID for personalisation. */
  nodeId?: string;
  /** Authenticated user UUID. */
  userId?: string;
  /** Client platform (win32 | darwin | linux). */
  platform?: string;
  /** Maximum results (default 10). */
  limit?: number;
  /** Explicit strategy override; defaults to "auto". */
  strategy?: RecommendationStrategy;
}

export type RecommendationStrategy =
  | "collaborative"
  | "content"
  | "trending"
  | "cold_start"
  | "auto";

export interface RecommendedSkill {
  slug: string;
  name: string;
  description: string | null;
  version: string;
  /** Recommendation score in the range [0, 1]. */
  score: number;
  /** Human-readable explanation for why this was recommended. */
  reason: string;
  downloadCount: number;
  averageRating: number;
}

// ── Recommender ─────────────────────────────────────

export class SkillRecommender {
  /**
   * Return personalised skill recommendations.
   */
  async getRecommendations(req: RecommendationRequest): Promise<RecommendedSkill[]> {
    const limit = Math.min(Math.max(req.limit ?? 10, 1), 50);
    const strategy = req.strategy ?? "auto";

    try {
      if (strategy === "auto") {
        return await this.autoRecommend(req, limit);
      }

      switch (strategy) {
        case "collaborative":
          return await this.collaborativeFilter(req.userId ?? req.nodeId, limit);
        case "content":
          return await this.contentBased(req.userId ?? req.nodeId, limit);
        case "trending":
          return await this.trendingRecommendations(limit);
        case "cold_start":
          return await this.coldStart(req.platform, limit);
        default:
          return await this.coldStart(req.platform, limit);
      }
    } catch (err) {
      logger.error({ err, strategy }, "Recommendation engine error -- falling back to cold start");
      return this.coldStart(req.platform, limit);
    }
  }

  // ── Auto Strategy ───────────────────────────────

  /**
   * Automatically choose the best strategy based on the user's data
   * availability.
   *
   * - If the user has >= 3 downloads: mix collaborative (60%) + content (40%).
   * - If < 3 downloads: mix trending (70%) + cold start (30%).
   * - If no user context at all: pure cold start.
   */
  private async autoRecommend(
    req: RecommendationRequest,
    limit: number,
  ): Promise<RecommendedSkill[]> {
    const identifier = req.userId ?? req.nodeId;

    if (!identifier) {
      return this.coldStart(req.platform, limit);
    }

    const db = getDb();

    // Resolve which column to match -- userId when we have a UUID,
    // otherwise fall back to nodeId.
    const hasUserDownloads = req.userId
      ? await this.countDownloads(db, skillDownloadsTable.userId, req.userId)
      : 0;

    const hasNodeDownloads =
      hasUserDownloads === 0 && req.nodeId
        ? await this.countDownloads(db, skillDownloadsTable.nodeId, req.nodeId)
        : 0;

    const totalDownloads = hasUserDownloads + hasNodeDownloads;

    if (totalDownloads >= 3) {
      // Fetch userSkillIds once and pass to both strategies to avoid a duplicate query
      const userSkillIds = await this.getUserSkillIds(db, identifier);
      const [collab, content] = await Promise.all([
        this.collaborativeFilter(identifier, Math.ceil(limit * 0.6), userSkillIds),
        this.contentBased(identifier, Math.ceil(limit * 0.4), userSkillIds),
      ]);
      return this.mergeAndDeduplicate([...collab, ...content], limit);
    }

    // Not enough history -- trending + cold start
    const [trending, cold] = await Promise.all([
      this.trendingRecommendations(Math.ceil(limit * 0.7)),
      this.coldStart(req.platform, Math.ceil(limit * 0.3)),
    ]);
    return this.mergeAndDeduplicate([...trending, ...cold], limit);
  }

  // ── Strategy 1: Collaborative Filtering ─────────

  /**
   * "Users who downloaded skills A, B also downloaded C, D."
   *
   * Steps:
   *   1. Get skills this user has downloaded.
   *   2. Find other users who downloaded the same skills.
   *   3. Return skills those users downloaded that this user has NOT.
   */
  private async collaborativeFilter(
    identifier: string | undefined,
    limit: number,
    prefetchedSkillIds?: string[],
  ): Promise<RecommendedSkill[]> {
    if (!identifier) return [];
    const db = getDb();

    // Step 1: skills the user has downloaded (reuse pre-fetched IDs when available)
    const userSkillIds = prefetchedSkillIds ?? await this.getUserSkillIds(db, identifier);
    if (userSkillIds.length === 0) return [];

    // Step 2: find other users who downloaded the same skills.
    //         Exclude rows belonging to the current identifier (could be
    //         stored in userId OR nodeId).
    const similarUsers = await db
      .select({ otherId: skillDownloadsTable.userId })
      .from(skillDownloadsTable)
      .where(
        and(
          inArray(skillDownloadsTable.skillId, userSkillIds),
          sql`${skillDownloadsTable.userId} IS NOT NULL`,
          sql`(${skillDownloadsTable.userId} != ${identifier})`,
          sql`(${skillDownloadsTable.nodeId} IS NULL OR ${skillDownloadsTable.nodeId} != ${identifier})`,
        ),
      )
      .groupBy(skillDownloadsTable.userId)
      .orderBy(sql`COUNT(*) DESC`)
      .limit(50);

    const similarUserIds = similarUsers
      .map((u) => u.otherId)
      .filter((id): id is string => id !== null);

    if (similarUserIds.length === 0) return [];

    // Step 3: skills those users downloaded (excluding the user's own)
    const safeRecommendations = await db
      .select({
        slug: skillsTable.slug,
        name: skillsTable.name,
        description: skillsTable.description,
        version: skillsTable.latestVersion,
        downloadCount: skillsTable.downloadCount,
        ratingAvg: skillsTable.ratingAvg,
        coDownloadCount: sql<number>`COUNT(DISTINCT ${skillDownloadsTable.userId})`,
      })
      .from(skillDownloadsTable)
      .innerJoin(skillsTable, eq(skillDownloadsTable.skillId, skillsTable.id))
      .where(
        and(
          inArray(skillDownloadsTable.userId, similarUserIds),
          userSkillIds.length > 0
            ? sql`${skillDownloadsTable.skillId} NOT IN (${sql.join(
                userSkillIds.map((id) => sql`${id}`),
                sql`, `,
              )})`
            : undefined,
          eq(skillsTable.status, "active"),
        ),
      )
      .groupBy(skillsTable.id)
      .orderBy(sql`COUNT(DISTINCT ${skillDownloadsTable.userId}) DESC`)
      .limit(limit);

    return safeRecommendations.map((r, i) => ({
      slug: r.slug,
      name: r.name,
      description: r.description,
      version: r.version ?? "0.0.0",
      score: Math.max(0.5, 1 - i * 0.05),
      reason: `${r.coDownloadCount} similar users also downloaded this`,
      downloadCount: r.downloadCount ?? 0,
      averageRating: r.ratingAvg ?? 0,
    }));
  }

  // ── Strategy 2: Content-Based ───────────────────

  /**
   * Recommend skills whose tags overlap with the user's download history.
   */
  private async contentBased(
    identifier: string | undefined,
    limit: number,
    prefetchedSkillIds?: string[],
  ): Promise<RecommendedSkill[]> {
    if (!identifier) return [];
    const db = getDb();

    // Gather tags from skills the user has downloaded (reuse pre-fetched IDs when available)
    const userSkillIds = prefetchedSkillIds ?? await this.getUserSkillIds(db, identifier);
    if (userSkillIds.length === 0) return [];

    const userSkillRows = await db
      .select({ tags: skillsTable.tags })
      .from(skillsTable)
      .where(inArray(skillsTable.id, userSkillIds));

    // Count tag frequencies
    const tagCounts = new Map<string, number>();
    for (const row of userSkillRows) {
      const tags = row.tags ?? [];
      for (const tag of tags) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      }
    }
    if (tagCounts.size === 0) return [];

    // Pick the 5 most frequent tags
    const topTags = [...tagCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([tag]) => tag);

    // Dialect-aware: MySQL uses JSON_CONTAINS, SQLite uses json_each
    const dialect = getCurrentDialect();
    const tagConditions = topTags.map(
      (tag) => dialect === "mysql"
        ? sql`JSON_CONTAINS(${skillsTable.tags}, ${JSON.stringify(tag)}, '$')`
        : sql`EXISTS (SELECT 1 FROM json_each(${skillsTable.tags}) WHERE value = ${tag})`,
    );

    const candidates = await db
      .select({
        slug: skillsTable.slug,
        name: skillsTable.name,
        description: skillsTable.description,
        version: skillsTable.latestVersion,
        downloadCount: skillsTable.downloadCount,
        ratingAvg: skillsTable.ratingAvg,
        tags: skillsTable.tags,
      })
      .from(skillsTable)
      .where(
        and(
          eq(skillsTable.status, "active"),
          sql`(${sql.join(tagConditions, sql` OR `)})`,
          userSkillIds.length > 0
            ? sql`${skillsTable.id} NOT IN (${sql.join(
                userSkillIds.map((id) => sql`${id}`),
                sql`, `,
              )})`
            : undefined,
        ),
      )
      .orderBy(desc(skillsTable.ratingAvg))
      .limit(limit);

    return candidates.map((c) => {
      const cTags = c.tags ?? [];
      const matchCount = cTags.filter((t) => topTags.includes(t)).length;
      return {
        slug: c.slug,
        name: c.name,
        description: c.description,
        version: c.version ?? "0.0.0",
        score: Math.min(1, matchCount / topTags.length + 0.2),
        reason: `Matches your interests: ${cTags.filter((t) => topTags.includes(t)).join(", ") || "general"}`,
        downloadCount: c.downloadCount ?? 0,
        averageRating: c.ratingAvg ?? 0,
      };
    });
  }

  // ── Strategy 3: Trending ────────────────────────

  /**
   * Skills with the most downloads in the last 7 days.
   */
  private async trendingRecommendations(limit: number): Promise<RecommendedSkill[]> {
    const db = getDb();
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const trending = await db
      .select({
        slug: skillsTable.slug,
        name: skillsTable.name,
        description: skillsTable.description,
        version: skillsTable.latestVersion,
        downloadCount: skillsTable.downloadCount,
        ratingAvg: skillsTable.ratingAvg,
        recentDownloads: sql<number>`COUNT(${skillDownloadsTable.id})`,
      })
      .from(skillsTable)
      .innerJoin(skillDownloadsTable, eq(skillDownloadsTable.skillId, skillsTable.id))
      .where(
        and(
          eq(skillsTable.status, "active"),
          gt(skillDownloadsTable.downloadedAt, sevenDaysAgo),
        ),
      )
      .groupBy(skillsTable.id)
      .orderBy(sql`COUNT(${skillDownloadsTable.id}) DESC`)
      .limit(limit);

    if (trending.length === 0) {
      // Fallback: overall popular skills when no recent downloads exist
      return this.coldStart(undefined, limit);
    }

    return trending.map((t, i) => ({
      slug: t.slug,
      name: t.name,
      description: t.description,
      version: t.version ?? "0.0.0",
      score: Math.max(0.3, 1 - i * 0.07),
      reason: `Trending: ${t.recentDownloads} downloads this week`,
      downloadCount: t.downloadCount ?? 0,
      averageRating: t.ratingAvg ?? 0,
    }));
  }

  // ── Strategy 4: Cold Start ──────────────────────

  /**
   * For new users with no download history -- serve globally popular skills,
   * optionally filtered by platform tag.
   */
  private async coldStart(
    platform: string | undefined,
    limit: number,
  ): Promise<RecommendedSkill[]> {
    const db = getDb();

    const conditions = [eq(skillsTable.status, "active")];

    // Dialect-aware: MySQL uses JSON_CONTAINS, SQLite uses json_each
    const dialect = getCurrentDialect();
    if (platform) {
      conditions.push(
        dialect === "mysql"
          ? sql`JSON_CONTAINS(${skillsTable.tags}, ${JSON.stringify(platform)}, '$')`
          : sql`EXISTS (SELECT 1 FROM json_each(${skillsTable.tags}) WHERE value = ${platform})`,
      );
    }

    const popular = await db
      .select({
        slug: skillsTable.slug,
        name: skillsTable.name,
        description: skillsTable.description,
        version: skillsTable.latestVersion,
        downloadCount: skillsTable.downloadCount,
        ratingAvg: skillsTable.ratingAvg,
      })
      .from(skillsTable)
      .where(and(...conditions))
      .orderBy(desc(skillsTable.downloadCount))
      .limit(limit);

    // If platform filtering yielded too few results, backfill without filter
    if (popular.length < limit && platform) {
      const existingSlugs = new Set(popular.map((p) => p.slug));
      const backfill = await db
        .select({
          slug: skillsTable.slug,
          name: skillsTable.name,
          description: skillsTable.description,
          version: skillsTable.latestVersion,
          downloadCount: skillsTable.downloadCount,
          ratingAvg: skillsTable.ratingAvg,
        })
        .from(skillsTable)
        .where(eq(skillsTable.status, "active"))
        .orderBy(desc(skillsTable.downloadCount))
        .limit(limit);

      for (const row of backfill) {
        if (popular.length >= limit) break;
        if (!existingSlugs.has(row.slug)) {
          popular.push(row);
          existingSlugs.add(row.slug);
        }
      }
    }

    return popular.map((p, i) => ({
      slug: p.slug,
      name: p.name,
      description: p.description,
      version: p.version ?? "0.0.0",
      score: Math.max(0.2, 0.8 - i * 0.06),
      reason: `Popular: ${p.downloadCount ?? 0} total downloads`,
      downloadCount: p.downloadCount ?? 0,
      averageRating: p.ratingAvg ?? 0,
    }));
  }

  // ── Internal Helpers ────────────────────────────

  /**
   * Count downloads for a given column/value pair.
   */
  private async countDownloads(
    db: ReturnType<typeof getDb>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    column: any,
    value: string,
  ): Promise<number> {
    const result = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(skillDownloadsTable)
      .where(eq(column, value));
    return Number(result[0]?.count ?? 0);
  }

  /**
   * Retrieve distinct skill IDs the identifier has downloaded.
   * Checks both userId and nodeId columns for maximum coverage.
   */
  private async getUserSkillIds(
    db: ReturnType<typeof getDb>,
    identifier: string,
  ): Promise<string[]> {
    const rows = await db
      .select({ skillId: skillDownloadsTable.skillId })
      .from(skillDownloadsTable)
      .where(
        sql`(${skillDownloadsTable.userId} = ${identifier} OR ${skillDownloadsTable.nodeId} = ${identifier})`,
      )
      .groupBy(skillDownloadsTable.skillId);

    return rows.map((r) => r.skillId);
  }

  /**
   * Merge, deduplicate by slug, sort by score descending, and cap at `limit`.
   */
  private mergeAndDeduplicate(
    items: RecommendedSkill[],
    limit: number,
  ): RecommendedSkill[] {
    const seen = new Set<string>();
    const merged: RecommendedSkill[] = [];
    for (const item of items) {
      if (!seen.has(item.slug)) {
        seen.add(item.slug);
        merged.push(item);
      }
    }
    return merged.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}

// ── Singleton ─────────────────────────────────────

let recommenderInstance: SkillRecommender | null = null;

export function getRecommender(): SkillRecommender {
  if (!recommenderInstance) {
    recommenderInstance = new SkillRecommender();
  }
  return recommenderInstance;
}
