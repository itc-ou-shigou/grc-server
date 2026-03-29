/**
 * Platform Module — Public Route Registration
 *
 * Provides the public GET endpoint for WinClaw clients to fetch platform values.
 * Supports ETag (If-None-Match) for efficient polling.
 */

import { Router } from "express";
import type { Express, Request, Response } from "express";
import pino from "pino";
import type { GrcConfig } from "../../config.js";
import { createAuthMiddleware } from "../../shared/middleware/auth.js";
import { asyncHandler } from "../../shared/middleware/error-handler.js";
import { PlatformService } from "./service.js";

const logger = pino({ name: "module:platform" });

export async function register(app: Express, config: GrcConfig) {
  const router = Router();
  const platformService = new PlatformService();
  const requireAuth = createAuthMiddleware(config);
  const authOptional = createAuthMiddleware(config, false);

  // ── GET /values — Fetch platform values (auth optional for sync clients) ──
  // WinClaw clients use this endpoint with ETag support.
  // If-None-Match header with contentHash → 304 when unchanged.

  router.get(
    "/values",
    authOptional,
    asyncHandler(async (req: Request, res: Response) => {
      const values = await platformService.getValues();

      if (!values) {
        return res.json({
          data: {
            content: "",
            contentHash: "",
            updatedAt: null,
          },
        });
      }

      // ETag support: If client sends If-None-Match with the content hash,
      // respond with 304 Not Modified if nothing changed.
      // Strip surrounding quotes / W/ prefix that some HTTP clients add.
      const rawIfNoneMatch = req.headers["if-none-match"];
      const ifNoneMatch = rawIfNoneMatch
        ?.replace(/^W\//, "")
        .replace(/^"|"$/g, "")
        .trim();
      if (ifNoneMatch && ifNoneMatch === values.contentHash) {
        return res.status(304).end();
      }

      res.setHeader("ETag", values.contentHash);
      res.json({
        data: {
          content: values.content,
          contentHash: values.contentHash,
          updatedAt: values.updatedAt,
        },
      });
    }),
  );

  // ── Mount Routes ──────────────────────────────

  app.use("/api/v1/platform", router);
  logger.info("Platform module registered");
}
