import { Router } from "express";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import pino from "pino";
import type { GrcConfig } from "../../config.js";
import { createAuthMiddleware } from "../../shared/middleware/auth.js";
import {
  asyncHandler,
  BadRequestError,
} from "../../shared/middleware/error-handler.js";
import { orchestratorService } from "./service.js";

const logger = pino({ name: "module:orchestrator" });

export async function register(app: Express, config: GrcConfig): Promise<void> {
  const router = Router();
  const authRequired = createAuthMiddleware(config, true);

  // GET /a2a/orchestrator/sessions - List orchestration sessions
  router.get(
    "/sessions",
    authRequired,
    asyncHandler(async (req: Request, res: Response) => {
      const taskId = req.query.task_id as string | undefined;
      const status = req.query.status as string | undefined;
      const sessions = await orchestratorService.listSessions(taskId, status);
      res.json({ ok: true, sessions });
    }),
  );

  // GET /a2a/orchestrator/sessions/:id - Get session detail
  router.get(
    "/sessions/:id",
    authRequired,
    asyncHandler(async (req: Request, res: Response) => {
      const session = await orchestratorService.getSession(req.params.id as string);
      res.json({ ok: true, session });
    }),
  );

  // POST /a2a/orchestrator/sessions/:id/abort - Abort session
  router.post(
    "/sessions/:id/abort",
    authRequired,
    asyncHandler(async (req: Request, res: Response) => {
      await orchestratorService.abortSession(req.params.id as string);
      res.json({ ok: true, message: "Session aborted" });
    }),
  );

  // POST /a2a/orchestrator/evaluate - Evaluate if task should use multi-agent
  router.post(
    "/evaluate",
    authRequired,
    asyncHandler(async (req: Request, res: Response) => {
      const schema = z.object({
        task_id: z.string(),
        title: z.string(),
        description: z.string().nullable().optional(),
        category: z.string().nullable().optional(),
        priority: z.string().default("medium"),
        depends_on: z.unknown().optional(),
        deliverables: z.unknown().optional(),
        notes: z.string().nullable().optional(),
        assigned_node_id: z.string().nullable().optional(),
        execution_mode: z.enum(["auto", "single", "multi"]).default("auto"),
      });

      const data = schema.parse(req.body);
      const decision = await orchestratorService.evaluateTask({
        id: data.task_id,
        title: data.title,
        description: data.description ?? null,
        category: data.category ?? null,
        priority: data.priority,
        dependsOn: data.depends_on ?? null,
        deliverables: data.deliverables ?? null,
        notes: data.notes ?? null,
        assignedNodeId: data.assigned_node_id ?? null,
        executionMode: data.execution_mode,
      });

      res.json({ ok: true, decision });
    }),
  );

  app.use("/a2a/orchestrator", router);
  logger.info("Orchestrator module registered");
}
