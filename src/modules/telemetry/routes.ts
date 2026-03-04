/**
 * Telemetry Module — Route Registration
 *
 * Provides anonymous telemetry reporting and public aggregated insights.
 * Report endpoint requires a node_id but no authentication.
 * Insights endpoint is fully public.
 */

import { Router } from "express";
import type { Express, Request, Response } from "express";
import pino from "pino";
import type { GrcConfig } from "../../config.js";
import {
  asyncHandler,
  BadRequestError,
} from "../../shared/middleware/error-handler.js";
import { telemetryReportSchema } from "../../shared/utils/validators.js";
import { TelemetryService } from "./service.js";

const logger = pino({ name: "module:telemetry" });

export async function register(app: Express, _config: GrcConfig) {
  const router = Router();
  const telemetryService = new TelemetryService();

  // ── Submit Telemetry Report ───────────────────

  router.post(
    "/report",
    asyncHandler(async (req: Request, res: Response) => {
      const body = telemetryReportSchema.parse(req.body);

      const reportId = await telemetryService.upsertReport({
        node_id: body.node_id,
        report_date: body.report_date,
        skill_calls: body.skill_calls,
        gene_usage: body.gene_usage,
        capsule_usage: body.capsule_usage,
        platform: body.platform,
        winclaw_version: body.winclaw_version,
        session_count: body.session_count,
        active_minutes: body.active_minutes,
      });

      res.status(201).json({
        id: reportId,
        recorded: true,
      });
    }),
  );

  // ── Get Aggregated Insights ───────────────────

  router.get(
    "/insights",
    asyncHandler(async (_req: Request, res: Response) => {
      const insights = await telemetryService.getInsights();

      res.json({
        totalNodes: insights.totalNodes,
        reportDates: insights.reportDates,
        platformDistribution: insights.platformDistribution,
        topSkills: insights.topSkills,
        versionDistribution: insights.versionDistribution,
      });
    }),
  );

  // ── Mount Routes ──────────────────────────────

  app.use("/api/v1/telemetry", router);
  logger.info("Telemetry module registered");
}
