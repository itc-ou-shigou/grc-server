/**
 * ClawHub+ Module -- Route Registration
 *
 * Skill Marketplace API providing:
 *   - Public: search, list, get, trending, recommended, download
 *   - Protected: publish, rate
 *
 * All routes are mounted under /api/v1/skills.
 */

import { Router } from "express";
import fs from "node:fs";
import multer from "multer";
import { z } from "zod";
import type { Express, Request, Response } from "express";
import type { GrcConfig } from "../../config.js";
import pino from "pino";

import { createAuthMiddleware, requireScopes } from "../../shared/middleware/auth.js";
import {
  asyncHandler,
  BadRequestError,
  UnauthorizedError,
} from "../../shared/middleware/error-handler.js";
import {
  skillSearchSchema,
  slugSchema,
  semverSchema,
} from "../../shared/utils/validators.js";
import {
  listSkills,
  getSkillBySlug,
  listSkillVersions,
  getTrendingSkills,
  publishSkill,
  rateSkill,
  downloadSkill,
} from "./service.js";
import { getRecommender } from "./recommender.js";
import type { RecommendationStrategy } from "./recommender.js";
import { initSearchIndex } from "./search.js";
import { initStorage, getStorage } from "./storage.js";
import { getTarballPath } from "./storage-local.js";

const logger = pino({ name: "module:clawhub" });

// Multer configured with in-memory storage (tarball buffer)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50 MB max tarball size
  },
});

// -- Validation Schemas for request bodies -------------------

const rateBodySchema = z.object({
  rating: z.number().int().min(1).max(5),
  review: z.string().max(5000).optional(),
});

const publishFieldsSchema = z.object({
  name: z.string().min(1).max(255),
  slug: slugSchema,
  description: z.string().min(1).max(10000),
  version: semverSchema,
  tags: z.string().transform((val) => {
    try {
      const parsed = JSON.parse(val);
      if (!Array.isArray(parsed)) throw new Error("tags must be an array");
      return parsed as string[];
    } catch {
      throw new Error("tags must be a valid JSON array of strings");
    }
  }),
  changelog: z.string().max(10000).optional(),
});

const trendingQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

const recommendedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  strategy: z.enum(["collaborative", "content", "trending", "cold_start", "auto"]).default("auto"),
  platform: z.enum(["win32", "darwin", "linux"]).optional(),
});

// -- Route Registration --------------------------------------

export async function register(app: Express, config: GrcConfig): Promise<void> {
  // Initialize infrastructure dependencies
  try {
    await initStorage(config.azure);
  } catch (err) {
    logger.warn({ err }, "Azure Blob storage initialization failed -- uploads will fail until Azure is available");
  }

  try {
    await initSearchIndex(config.meilisearch);
  } catch (err) {
    logger.warn({ err }, "Meilisearch initialization failed -- full-text search will fall back to DB queries");
  }

  const router = Router();

  const publicAuth = createAuthMiddleware(config, false);
  const requiredAuth = createAuthMiddleware(config, true);

  // ────────────────────────────────────────────────────
  // Public Endpoints
  // ────────────────────────────────────────────────────

  /**
   * GET /api/v1/skills/trending
   * Trending skills (top by downloads in last 7 days).
   * NOTE: This route must be declared BEFORE /:slug to avoid param collision.
   */
  router.get(
    "/trending",
    publicAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const query = trendingQuerySchema.parse(req.query);
      const skills = await getTrendingSkills(query.limit);

      res.json({ data: skills });
    }),
  );

  /**
   * GET /api/v1/skills/recommended
   * Personalised skill recommendations powered by the multi-strategy
   * recommendation engine.  Falls back to the legacy top-rated query
   * when the recommender encounters an unrecoverable error.
   * NOTE: This route must be declared BEFORE /:slug to avoid param collision.
   */
  router.get(
    "/recommended",
    publicAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const query = recommendedQuerySchema.parse(req.query);
      const recommender = getRecommender();
      const recommendations = await recommender.getRecommendations({
        nodeId: req.auth?.node_id,
        userId: req.auth?.sub !== "anonymous" ? req.auth?.sub : undefined,
        platform: query.platform,
        limit: query.limit,
        strategy: query.strategy as RecommendationStrategy,
      });
      res.json({ data: recommendations });
    }),
  );

  /**
   * GET /api/v1/skills
   * List skills with search, filtering, sorting, pagination.
   */
  router.get(
    "/",
    publicAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const params = skillSearchSchema.parse(req.query);
      const result = await listSkills(params);

      res.json(result);
    }),
  );

  /**
   * GET /api/v1/skills/:slug
   * Get skill details by slug.
   */
  router.get(
    "/:slug",
    publicAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const slug = slugSchema.parse(req.params.slug);
      const { skill, latestVersionInfo } = await getSkillBySlug(slug);

      res.json({
        ...skill,
        latestVersionInfo,
      });
    }),
  );

  /**
   * GET /api/v1/skills/:slug/versions
   * List all versions of a skill.
   */
  router.get(
    "/:slug/versions",
    publicAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const slug = slugSchema.parse(req.params.slug);
      const versions = await listSkillVersions(slug);

      res.json({ data: versions });
    }),
  );

  // ────────────────────────────────────────────────────
  // Protected Endpoints
  // ────────────────────────────────────────────────────

  /**
   * POST /api/v1/skills
   * Publish a new skill or a new version of an existing skill.
   * Requires authentication with 'write' and 'publish' scopes.
   */
  router.post(
    "/",
    requiredAuth,
    requireScopes("write", "publish"),
    upload.single("tarball"),
    asyncHandler(async (req: Request, res: Response) => {
      if (!req.auth || req.auth.sub === "anonymous") {
        throw new UnauthorizedError("Authentication required to publish skills");
      }

      // Validate the tarball file
      if (!req.file) {
        throw new BadRequestError("Tarball file is required (field: tarball)");
      }

      // Validate form fields
      const fields = publishFieldsSchema.parse(req.body);

      const result = await publishSkill({
        name: fields.name,
        slug: fields.slug,
        description: fields.description,
        version: fields.version,
        tags: fields.tags,
        changelog: fields.changelog,
        tarball: req.file.buffer,
        authorId: req.auth.sub,
      });

      res.status(201).json(result);
    }),
  );

  /**
   * POST /api/v1/skills/:slug/rate
   * Rate a skill (upsert: one rating per user per skill).
   * Requires authentication.
   */
  router.post(
    "/:slug/rate",
    requiredAuth,
    asyncHandler(async (req: Request, res: Response) => {
      if (!req.auth || req.auth.sub === "anonymous") {
        throw new UnauthorizedError("Authentication required to rate skills");
      }

      const slug = slugSchema.parse(req.params.slug);
      const body = rateBodySchema.parse(req.body);

      // Look up the skill by slug to get the ID
      const { skill } = await getSkillBySlug(slug);

      await rateSkill({
        skillId: skill.id,
        userId: req.auth.sub,
        rating: body.rating,
        review: body.review,
      });

      res.json({ message: "Rating submitted successfully" });
    }),
  );

  /**
   * GET /api/v1/skills/:slug/download/:version
   * Download a skill tarball.
   * Records the download, then:
   *   - Local mode: streams the file directly from disk
   *   - Azure mode: redirects to a presigned SAS URL (302)
   * Anonymous access allowed (public auth).
   */
  router.get(
    "/:slug/download/:version",
    publicAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const slug = slugSchema.parse(req.params.slug);
      const version = semverSchema.parse(req.params.version);

      const userId = req.auth?.sub;
      const nodeId = req.auth?.node_id;

      // Record the download and increment counter (shared logic)
      const { downloadUrl } = await downloadSkill(slug, version, userId, nodeId);

      const storage = getStorage();
      if (storage.isLocal) {
        // Local mode: serve the tarball file directly
        const filePath = getTarballPath(slug, version);
        if (!fs.existsSync(filePath)) {
          return res.status(404).json({ error: "Tarball not found" });
        }
        res.setHeader("Content-Type", "application/gzip");
        res.setHeader("Content-Disposition", `attachment; filename="${slug}-${version}.tar.gz"`);
        return fs.createReadStream(filePath).pipe(res);
      } else {
        // Azure mode: redirect to SAS URL
        return res.redirect(302, downloadUrl);
      }
    }),
  );

  // Mount the router
  app.use("/api/v1/skills", router);

  logger.info("ClawHub+ module registered with all endpoints");
}
