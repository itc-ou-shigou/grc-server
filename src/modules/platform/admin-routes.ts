/**
 * Platform Module — Admin Routes
 *
 * Provides admin endpoints for viewing and editing platform values.
 * GET is available to all authenticated users (read-only view).
 * PUT requires admin role.
 */

import { Router } from "express";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import pino from "pino";
import type { GrcConfig } from "../../config.js";
import { createAuthMiddleware } from "../../shared/middleware/auth.js";
import { createAdminAuthMiddleware } from "../../shared/middleware/admin-auth.js";
import {
  asyncHandler,
  BadRequestError,
} from "../../shared/middleware/error-handler.js";
import { PlatformService } from "./service.js";

const logger = pino({ name: "admin:platform" });

// ── Zod Schemas ─────────────────────────────────

const updateValuesSchema = z.object({
  content: z.string().max(500_000, "Content is too large (max 500KB)"),
});

// ── Route Registration ──────────────────────────

export async function registerAdmin(app: Express, config: GrcConfig) {
  const router = Router();
  const platformService = new PlatformService();
  const requireAuth = createAuthMiddleware(config);
  const requireAdmin = createAdminAuthMiddleware(config);

  // ── GET /values — Read platform values (all authenticated users) ──

  router.get(
    "/values",
    requireAuth,
    asyncHandler(async (_req: Request, res: Response) => {
      const values = await platformService.getValues();

      if (!values) {
        return res.json({
          data: {
            content: "",
            contentHash: "",
            updatedBy: null,
            updatedAt: null,
            createdAt: null,
          },
        });
      }

      res.json({
        data: {
          content: values.content,
          contentHash: values.contentHash,
          updatedBy: values.updatedBy,
          updatedAt: values.updatedAt,
          createdAt: values.createdAt,
        },
      });
    }),
  );

  // ── PUT /values — Update platform values (admin only) ──

  router.put(
    "/values",
    requireAuth,
    requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const body = updateValuesSchema.parse(req.body);
      const adminUserId = req.auth!.sub;

      const result = await platformService.upsertValues(
        body.content,
        adminUserId,
      );

      logger.info(
        { adminUserId, contentHash: result.contentHash },
        "Platform values updated by admin",
      );

      res.json({
        data: {
          contentHash: result.contentHash,
        },
        message: "Platform values updated successfully",
      });
    }),
  );

  // ── Mount ─────────────────────────────────────

  app.use("/api/v1/admin/platform", router);
  logger.info("Platform admin routes registered");
}
