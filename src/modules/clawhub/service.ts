/**
 * ClawHub+ Module -- Service Layer
 *
 * Business logic for skill CRUD operations:
 *   - Publish new skills and versions
 *   - List, search, and filter skills
 *   - Version management
 *   - Rating (upsert) and average recalculation
 *   - Download tracking with counter increment
 *   - Trending and recommended queries
 */

import { eq, and, desc, asc, sql, inArray, gt } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import pino from "pino";
import { getDb } from "../../shared/db/connection.js";
import { getCurrentDialect } from "../../shared/db/dialect.js";
import {
  skillsTable,
  skillVersionsTable,
  skillRatingsTable,
  skillDownloadsTable,
} from "./schema.js";
import {
  indexSkill,
  searchSkills,
  type SkillSearchDocument,
} from "./search.js";
import { getStorage } from "./storage.js";
import {
  NotFoundError,
  ConflictError,
  BadRequestError,
} from "../../shared/middleware/error-handler.js";
import type { PaginatedResult } from "../../shared/utils/validators.js";

const logger = pino({ name: "module:clawhub:service" });

// -- Types ---------------------------------------------------

export interface SkillRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  authorId: string;
  category: string | null;
  tags: string[] | null;
  latestVersion: string | null;
  downloadCount: number;
  ratingAvg: number;
  ratingCount: number;
  isOfficial: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SkillVersionRow {
  id: string;
  skillId: string;
  version: string;
  changelog: string | null;
  tarballUrl: string;
  checksumSha256: string;
  tarballSize: number;
  minWinclawVersion: string | null;
  createdAt: Date;
}

export interface PublishInput {
  name: string;
  slug: string;
  description: string;
  version: string;
  tags: string[];
  changelog?: string;
  tarball: Buffer;
  authorId: string;
}

export interface RateInput {
  skillId: string;
  userId: string;
  rating: number;
  review?: string;
}

export interface ListSkillsParams {
  q?: string;
  tags?: string;
  sort: "name" | "downloads" | "rating" | "created";
  page: number;
  limit: number;
}

// -- Helpers -------------------------------------------------

/** Map a sort key from the API to a Drizzle column + direction. */
function sortColumn(sort: string) {
  switch (sort) {
    case "name":
      return asc(skillsTable.name);
    case "downloads":
      return desc(skillsTable.downloadCount);
    case "rating":
      return desc(skillsTable.ratingAvg);
    case "created":
      return desc(skillsTable.createdAt);
    default:
      return desc(skillsTable.downloadCount);
  }
}

/** Build the sort array for Meilisearch from an API sort key. */
function meiliSort(sort: string): string[] {
  switch (sort) {
    case "name":
      return []; // Meilisearch uses relevance for text; name sort falls back to DB
    case "downloads":
      return ["download_count:desc"];
    case "rating":
      return ["rating_avg:desc"];
    case "created":
      return ["created_at:desc"];
    default:
      return ["download_count:desc"];
  }
}

/** Convert a skill DB row to a Meilisearch document. */
function toSearchDoc(row: SkillRow): SkillSearchDocument {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description ?? "",
    tags: row.tags ?? [],
    author_id: row.authorId,
    status: row.status,
    download_count: row.downloadCount,
    rating_avg: row.ratingAvg,
    created_at: row.createdAt ? Math.floor(row.createdAt.getTime() / 1000) : 0,
  };
}

// -- Service Functions ---------------------------------------

/**
 * List skills with optional search, tag filtering, sorting, and pagination.
 * Uses Meilisearch for full-text search when `q` is provided.
 * Falls back to direct DB query otherwise.
 */
export async function listSkills(
  params: ListSkillsParams,
): Promise<PaginatedResult<SkillRow>> {
  const db = getDb();
  const offset = (params.page - 1) * params.limit;

  // -- Full-text search via Meilisearch --
  if (params.q) {
    let filter: string | undefined;
    if (params.tags) {
      const tagList = params.tags.split(",").map((t) => t.trim()).filter(Boolean);
      if (tagList.length > 0) {
        filter = tagList.map((t) => `tags = "${t}"`).join(" OR ");
      }
    }

    // Always filter for active skills
    const statusFilter = 'status = "active"';
    filter = filter ? `(${filter}) AND ${statusFilter}` : statusFilter;

    const { ids, totalHits } = await searchSkills(
      params.q,
      filter,
      meiliSort(params.sort),
      params.limit,
      offset,
    );

    if (ids.length === 0) {
      return {
        data: [],
        pagination: {
          page: params.page,
          limit: params.limit,
          total: 0,
          totalPages: 0,
        },
      };
    }

    // Fetch full rows from DB for the matched IDs (preserving search order)
    const rows = await db
      .select()
      .from(skillsTable)
      .where(inArray(skillsTable.id, ids));

    // Restore the Meilisearch ranking order
    const idOrder = new Map(ids.map((id, i) => [id, i]));
    const sorted = rows.sort(
      (a, b) => (idOrder.get(a.id) ?? 0) - (idOrder.get(b.id) ?? 0),
    );

    return {
      data: sorted as SkillRow[],
      pagination: {
        page: params.page,
        limit: params.limit,
        total: totalHits,
        totalPages: Math.ceil(totalHits / params.limit),
      },
    };
  }

  // -- Direct DB query (no search text) --
  const conditions = [eq(skillsTable.status, "active")];

  if (params.tags) {
    const tagList = params.tags.split(",").map((t) => t.trim()).filter(Boolean);
    if (tagList.length > 0) {
      // Dialect-aware: MySQL uses JSON_CONTAINS, SQLite uses json_each
      const dialect = getCurrentDialect();
      for (const tag of tagList) {
        conditions.push(
          dialect === "mysql"
            ? sql`JSON_CONTAINS(${skillsTable.tags}, ${JSON.stringify(tag)}, '$')`
            : sql`EXISTS (SELECT 1 FROM json_each(${skillsTable.tags}) WHERE value = ${tag})`,
        );
      }
    }
  }

  const whereClause = conditions.length === 1 ? conditions[0] : and(...conditions);

  // Count total
  const countResult = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(skillsTable)
    .where(whereClause);

  const total = Number(countResult[0]?.count ?? 0);

  // Fetch page
  const rows = await db
    .select()
    .from(skillsTable)
    .where(whereClause)
    .orderBy(sortColumn(params.sort))
    .limit(params.limit)
    .offset(offset);

  return {
    data: rows as SkillRow[],
    pagination: {
      page: params.page,
      limit: params.limit,
      total,
      totalPages: Math.ceil(total / params.limit),
    },
  };
}

/**
 * Get a single skill by slug, including its latest version info and rating summary.
 * Throws NotFoundError if the skill does not exist.
 */
export async function getSkillBySlug(slug: string): Promise<{
  skill: SkillRow;
  latestVersionInfo: SkillVersionRow | null;
}> {
  const db = getDb();

  const rows = await db
    .select()
    .from(skillsTable)
    .where(eq(skillsTable.slug, slug))
    .limit(1);

  if (rows.length === 0) {
    throw new NotFoundError("Skill");
  }

  const skill = rows[0] as SkillRow;

  // Fetch the latest version record
  let latestVersionInfo: SkillVersionRow | null = null;
  if (skill.latestVersion) {
    const versionRows = await db
      .select()
      .from(skillVersionsTable)
      .where(
        and(
          eq(skillVersionsTable.skillId, skill.id),
          eq(skillVersionsTable.version, skill.latestVersion),
        ),
      )
      .limit(1);

    if (versionRows.length > 0) {
      latestVersionInfo = versionRows[0] as SkillVersionRow;
    }
  }

  return { skill, latestVersionInfo };
}

/**
 * List all versions for a skill identified by its slug.
 * Returns versions sorted by creation date descending (newest first).
 */
export async function listSkillVersions(slug: string): Promise<SkillVersionRow[]> {
  const db = getDb();

  // First find the skill by slug
  const skillRows = await db
    .select({ id: skillsTable.id })
    .from(skillsTable)
    .where(eq(skillsTable.slug, slug))
    .limit(1);

  if (skillRows.length === 0) {
    throw new NotFoundError("Skill");
  }

  const skillId = skillRows[0].id;

  const versions = await db
    .select()
    .from(skillVersionsTable)
    .where(eq(skillVersionsTable.skillId, skillId))
    .orderBy(desc(skillVersionsTable.createdAt));

  return versions as SkillVersionRow[];
}

/**
 * Get trending skills: top by download count within the last 7 days.
 * Counts downloads recorded in the last 7 days, then sorts skills by that count.
 */
export async function getTrendingSkills(limit: number): Promise<SkillRow[]> {
  const db = getDb();

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  // Subquery: count downloads per skill in the last 7 days
  const trendingRows = await db
    .select({
      skillId: skillDownloadsTable.skillId,
      recentDownloads: sql<number>`COUNT(*)`.as("recent_downloads"),
    })
    .from(skillDownloadsTable)
    .where(gt(skillDownloadsTable.downloadedAt, sevenDaysAgo))
    .groupBy(skillDownloadsTable.skillId)
    .orderBy(sql`recent_downloads DESC`)
    .limit(limit);

  if (trendingRows.length === 0) {
    // Fallback: return top skills by overall download count
    const fallback = await db
      .select()
      .from(skillsTable)
      .where(eq(skillsTable.status, "active"))
      .orderBy(desc(skillsTable.downloadCount))
      .limit(limit);

    return fallback as SkillRow[];
  }

  const skillIds = trendingRows.map((r) => r.skillId);

  const skills = await db
    .select()
    .from(skillsTable)
    .where(
      and(
        inArray(skillsTable.id, skillIds),
        eq(skillsTable.status, "active"),
      ),
    );

  // Preserve trending order
  const idOrder = new Map(skillIds.map((id, i) => [id, i]));
  const sorted = skills.sort(
    (a, b) => (idOrder.get(a.id) ?? 0) - (idOrder.get(b.id) ?? 0),
  );

  return sorted as SkillRow[];
}

/**
 * Get recommended skills: top-rated skills with at least 10 downloads.
 */
export async function getRecommendedSkills(limit: number): Promise<SkillRow[]> {
  const db = getDb();

  const rows = await db
    .select()
    .from(skillsTable)
    .where(
      and(
        eq(skillsTable.status, "active"),
        gt(skillsTable.downloadCount, 10),
      ),
    )
    .orderBy(desc(skillsTable.ratingAvg))
    .limit(limit);

  return rows as SkillRow[];
}

/**
 * Publish a new skill or add a new version to an existing skill.
 *
 * Logic:
 * 1. Validate all fields
 * 2. Upload tarball to MinIO, compute SHA-256
 * 3. If slug does not exist: create new skill record + first version
 * 4. If slug exists and author matches: add new version
 * 5. If slug exists and author differs: throw ConflictError
 * 6. Update Meilisearch index
 * 7. Return the skill and version records
 */
export async function publishSkill(input: PublishInput): Promise<{
  skill: SkillRow;
  version: SkillVersionRow;
}> {
  const db = getDb();

  const storage = getStorage();

  // Compute hash of the tarball
  const sha256 = storage.computeSha256(input.tarball);
  const tarballSize = input.tarball.length;

  // Check if slug already exists
  const existingRows = await db
    .select()
    .from(skillsTable)
    .where(eq(skillsTable.slug, input.slug))
    .limit(1);

  let skillId: string;
  let isNewSkill = false;

  if (existingRows.length > 0) {
    const existing = existingRows[0];

    // Ownership check
    if (existing.authorId !== input.authorId) {
      throw new ConflictError(
        `Skill slug "${input.slug}" is owned by a different author`,
      );
    }

    skillId = existing.id;

    // Check for duplicate version
    const versionExists = await db
      .select({ id: skillVersionsTable.id })
      .from(skillVersionsTable)
      .where(
        and(
          eq(skillVersionsTable.skillId, skillId),
          eq(skillVersionsTable.version, input.version),
        ),
      )
      .limit(1);

    if (versionExists.length > 0) {
      throw new ConflictError(
        `Version "${input.version}" already exists for skill "${input.slug}"`,
      );
    }
  } else {
    // New skill
    skillId = uuidv4();
    isNewSkill = true;
  }

  // Upload tarball to storage (outside transaction -- cannot be rolled back)
  const tarballUrl = await storage.uploadTarball(input.slug, input.version, input.tarball);

  // Wrap DB writes in a transaction so skill + version are atomic.
  // If the transaction fails, clean up the uploaded tarball (best-effort compensation).
  const versionId = uuidv4();
  let skill: SkillRow;
  let version: SkillVersionRow;

  try {
    const result = await db.transaction(async (tx) => {
      // Ensure the parent skill record exists before inserting the version
      // (skill_versions.skill_id has a FK constraint referencing skills.id)
      if (isNewSkill) {
        // Insert new skill record first
        await tx.insert(skillsTable).values({
          id: skillId,
          slug: input.slug,
          name: input.name,
          description: input.description,
          authorId: input.authorId,
          tags: input.tags,
          latestVersion: input.version,
          downloadCount: 0,
          ratingAvg: 0,
          ratingCount: 0,
          status: "active",
        });
      } else {
        // Update existing skill with new version and metadata
        await tx
          .update(skillsTable)
          .set({
            name: input.name,
            description: input.description,
            tags: input.tags,
            latestVersion: input.version,
          })
          .where(eq(skillsTable.id, skillId));
      }

      // Create version record (parent skill now guaranteed to exist)
      await tx.insert(skillVersionsTable).values({
        id: versionId,
        skillId,
        version: input.version,
        changelog: input.changelog ?? null,
        tarballUrl,
        checksumSha256: sha256,
        tarballSize,
        minWinclawVersion: null,
      });

      // Fetch the final skill and version records within the transaction
      const [skillRow] = await tx
        .select()
        .from(skillsTable)
        .where(eq(skillsTable.id, skillId))
        .limit(1);

      const [versionRow] = await tx
        .select()
        .from(skillVersionsTable)
        .where(eq(skillVersionsTable.id, versionId))
        .limit(1);

      return {
        skill: skillRow as SkillRow,
        version: versionRow as SkillVersionRow,
      };
    });

    skill = result.skill;
    version = result.version;
  } catch (err) {
    // Compensation: best-effort cleanup of the uploaded tarball
    logger.warn(
      { slug: input.slug, version: input.version },
      "Transaction failed during publishSkill — attempting tarball cleanup",
    );
    storage.deleteTarball(input.slug, input.version).catch((cleanupErr) => {
      logger.error(
        { err: cleanupErr, slug: input.slug, version: input.version },
        "Failed to clean up tarball after transaction failure",
      );
    });
    throw err;
  }

  // Index in Meilisearch (non-blocking)
  indexSkill(toSearchDoc(skill)).catch((err) => {
    logger.error({ err, skillId: skill.id }, "Failed to index skill in Meilisearch");
  });

  logger.info(
    { slug: input.slug, version: input.version, isNewSkill },
    "Skill published",
  );

  return { skill, version };
}

/**
 * Rate a skill (upsert: one rating per user per skill).
 * Recalculates the average rating on the skill record.
 */
export async function rateSkill(input: RateInput): Promise<void> {
  const db = getDb();

  // Validate rating range
  if (input.rating < 1 || input.rating > 5) {
    throw new BadRequestError("Rating must be between 1 and 5");
  }

  // Verify the skill exists
  const [skillRow] = await db
    .select({ id: skillsTable.id })
    .from(skillsTable)
    .where(eq(skillsTable.id, input.skillId))
    .limit(1);

  if (!skillRow) {
    throw new NotFoundError("Skill");
  }

  // Wrap the upsert + average recalculation in a transaction to ensure
  // the rating row and the aggregated counters stay consistent.
  const updatedSkill = await db.transaction(async (tx) => {
    // Check if user already rated this skill
    const existingRating = await tx
      .select({ id: skillRatingsTable.id })
      .from(skillRatingsTable)
      .where(
        and(
          eq(skillRatingsTable.skillId, input.skillId),
          eq(skillRatingsTable.userId, input.userId),
        ),
      )
      .limit(1);

    if (existingRating.length > 0) {
      // Update existing rating
      await tx
        .update(skillRatingsTable)
        .set({
          rating: input.rating,
          review: input.review ?? null,
        })
        .where(eq(skillRatingsTable.id, existingRating[0].id));
    } else {
      // Insert new rating
      await tx.insert(skillRatingsTable).values({
        id: uuidv4(),
        skillId: input.skillId,
        userId: input.userId,
        rating: input.rating,
        review: input.review ?? null,
      });
    }

    // Recalculate average rating
    const [aggResult] = await tx
      .select({
        avg: sql<number>`AVG(${skillRatingsTable.rating})`,
        count: sql<number>`COUNT(*)`,
      })
      .from(skillRatingsTable)
      .where(eq(skillRatingsTable.skillId, input.skillId));

    const ratingAvg = Number(aggResult?.avg ?? 0);
    const ratingCount = Number(aggResult?.count ?? 0);

    await tx
      .update(skillsTable)
      .set({
        ratingAvg: Math.round(ratingAvg * 100) / 100,
        ratingCount,
      })
      .where(eq(skillsTable.id, input.skillId));

    // Fetch updated skill within the transaction for search index update
    const [updated] = await tx
      .select()
      .from(skillsTable)
      .where(eq(skillsTable.id, input.skillId))
      .limit(1);

    return updated;
  });

  if (updatedSkill) {
    indexSkill(toSearchDoc(updatedSkill as SkillRow)).catch((err) => {
      logger.error({ err, skillId: input.skillId }, "Failed to update skill in Meilisearch after rating");
    });
  }

  logger.info(
    { skillId: input.skillId, userId: input.userId, rating: input.rating },
    "Skill rated",
  );
}

/**
 * Record a download and increment the skill's download counter.
 * Returns a presigned URL for the tarball.
 *
 * @param slug - The skill slug
 * @param version - The requested version string
 * @param userId - The authenticated user ID (may be "anonymous")
 * @param nodeId - The WinClaw node ID (optional)
 */
export async function downloadSkill(
  slug: string,
  version: string,
  userId?: string,
  nodeId?: string,
): Promise<{ downloadUrl: string }> {
  const db = getDb();

  // Find the skill
  const [skillRow] = await db
    .select()
    .from(skillsTable)
    .where(eq(skillsTable.slug, slug))
    .limit(1);

  if (!skillRow) {
    throw new NotFoundError("Skill");
  }

  // Find the version
  const [versionRow] = await db
    .select()
    .from(skillVersionsTable)
    .where(
      and(
        eq(skillVersionsTable.skillId, skillRow.id),
        eq(skillVersionsTable.version, version),
      ),
    )
    .limit(1);

  if (!versionRow) {
    throw new NotFoundError(`Skill version "${version}"`);
  }

  // Record the download
  await db.insert(skillDownloadsTable).values({
    id: uuidv4(),
    skillId: skillRow.id,
    version: versionRow.version,
    nodeId: nodeId ?? null,
    userId: userId && userId !== "anonymous" ? userId : null,
  });

  // Increment the download counter
  await db
    .update(skillsTable)
    .set({
      downloadCount: sql`${skillsTable.downloadCount} + 1`,
    })
    .where(eq(skillsTable.id, skillRow.id));

  // Generate download URL (SAS URL for Azure, local path for local mode)
  const storage = getStorage();
  const downloadUrl = await storage.getTarballUrl(slug, version);

  logger.info({ slug, version, userId }, "Skill download recorded");

  return { downloadUrl };
}
