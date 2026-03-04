/**
 * Update Gateway Module — Route Registration
 *
 * Provides update checking, manifest retrieval, download redirect,
 * and update reporting endpoints.
 * All endpoints are anonymous (no authentication required).
 */

import { Router } from "express";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import pino from "pino";
import type { GrcConfig } from "../../config.js";
import {
  asyncHandler,
  BadRequestError,
  NotFoundError,
} from "../../shared/middleware/error-handler.js";
import {
  semverSchema,
  platformSchema,
  updateChannelSchema,
  nodeIdSchema,
} from "../../shared/utils/validators.js";
import { UpdateService } from "./service.js";

const logger = pino({ name: "module:update" });

// ── Zod Schemas for Request Validation ──────────

const updateCheckQuerySchema = z.object({
  version: semverSchema,
  platform: platformSchema,
  channel: updateChannelSchema.default("stable"),
});

const updateReportBodySchema = z.object({
  node_id: nodeIdSchema,
  from_version: semverSchema,
  to_version: semverSchema,
  platform: platformSchema,
  success: z.boolean(),
  error_message: z.string().max(5000).optional(),
  duration_ms: z.number().int().min(0).optional(),
});

export async function register(app: Express, _config: GrcConfig) {
  const router = Router();
  const updateService = new UpdateService();

  // ── Check for Update ──────────────────────────

  router.get(
    "/check",
    asyncHandler(async (req: Request, res: Response) => {
      const query = updateCheckQuerySchema.parse(req.query);

      const result = await updateService.checkForUpdate(
        query.version,
        query.platform,
        query.channel,
      );

      if (!result) {
        // 204 No Content — client is up-to-date
        res.status(204).end();
        return;
      }

      res.json({
        available: result.available,
        latest: result.latest,
        downloadUrl: result.downloadUrl,
        changelog: result.changelog,
        sizeBytes: result.sizeBytes,
        checksumSha256: result.checksumSha256,
        minUpgradeVersion: result.minUpgradeVersion,
        isCritical: result.isCritical,
      });
    }),
  );

  // ── Get Version Manifest ──────────────────────

  router.get(
    "/manifest/:version",
    asyncHandler(async (req: Request, res: Response) => {
      const version = semverSchema.parse(req.params.version);

      const manifest = await updateService.getManifest(version);
      if (!manifest) {
        throw new NotFoundError("Release manifest");
      }

      res.json({
        version,
        platforms: manifest,
      });
    }),
  );

  // ── Download Redirect ─────────────────────────

  router.get(
    "/download/:version",
    asyncHandler(async (req: Request, res: Response) => {
      const version = semverSchema.parse(req.params.version);
      const platform = platformSchema.optional().parse(req.query.platform);

      const manifest = await updateService.getManifest(version);
      if (!manifest) {
        throw new NotFoundError("Release");
      }

      // Find matching platform or first available
      const release = platform
        ? manifest.find((m) => m.platform === platform)
        : manifest[0];

      if (!release) {
        throw new NotFoundError("Release for platform");
      }

      // Redirect to the download URL
      res.redirect(302, release.downloadUrl);
    }),
  );

  // ── Report Update Result ──────────────────────

  router.post(
    "/report",
    asyncHandler(async (req: Request, res: Response) => {
      const body = updateReportBodySchema.parse(req.body);

      const reportId = await updateService.recordReport(body);

      res.status(201).json({
        id: reportId,
        recorded: true,
      });
    }),
  );

  // ── Mount Routes ──────────────────────────────

  app.use("/api/v1/update", router);
  logger.info("Update Gateway module registered");
}
