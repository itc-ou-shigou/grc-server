/**
 * Zod Validators — Shared validation schemas
 */

import { z } from "zod";

// ── Pagination ───────────────────────────────────

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(20),
});

export type PaginationParams = z.infer<typeof paginationSchema>;

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// ── Common Fields ────────────────────────────────

export const uuidSchema = z.string().uuid();

export const nodeIdSchema = z
  .string()
  .min(8)
  .max(255)
  .regex(/^[a-zA-Z0-9_-]+$/);

export const slugSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const semverSchema = z
  .string()
  .regex(/^v?\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?(?:\+[a-zA-Z0-9.]+)?$/);

export const platformSchema = z.enum(["win32", "darwin", "linux"]);

export const tierSchema = z.enum(["free", "pro", "contributor"]);

export const updateChannelSchema = z.enum(["stable", "beta", "dev"]);

// ── A2A Protocol ─────────────────────────────────

export const a2aHelloSchema = z.object({
  node_id: nodeIdSchema,
  capabilities: z.record(z.unknown()).optional(),
  gene_count: z.number().int().min(0).optional(),
  env_fingerprint: z.string().optional(),
  platform: platformSchema.optional(),
  winclaw_version: semverSchema.optional(),
  employee_id: z.string().max(100).optional(),
  employee_name: z.string().max(255).optional(),
  employee_email: z.string().max(255).optional(),
  employee_role: z.string().max(100).optional(),
  workspace_path: z.string().max(500).regex(/^[a-zA-Z0-9_\-\/\\:. ]+$/, "Invalid path characters").optional(),
  gateway_port: z.number().int().min(1).max(65535).optional(),
  gateway_token: z.string().max(255).optional(),
  container_id: z.string().max(128).optional(),
});

export const a2aPublishSchema = z.object({
  node_id: nodeIdSchema,
  asset_type: z.enum(["gene", "capsule"]),
  asset_id: z.string().min(1).max(255),
  content_hash: z.string().min(1),
  payload: z.record(z.unknown()),
  signature: z.string().optional(),
  category: z.string().max(100).optional(),
});

export const a2aSearchSchema = z.object({
  signals: z.array(z.string()).optional(),
  status: z.enum(["pending", "approved", "promoted", "quarantined"]).optional(),
  type: z.enum(["gene", "capsule"]).optional(),
  gene_asset_id: z.string().min(1).max(255).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

// ── Skills ───────────────────────────────────────

export const skillSearchSchema = z.object({
  q: z.string().optional(),
  tags: z.string().optional(), // comma-separated
  sort: z.enum(["name", "downloads", "rating", "created"]).default("downloads"),
  ...paginationSchema.shape,
});

// ── Telemetry ────────────────────────────────────

export const telemetryReportSchema = z.object({
  node_id: nodeIdSchema,
  report_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "report_date must be YYYY-MM-DD format"),
  skill_calls: z.unknown().optional(),
  gene_usage: z.unknown().optional(),
  capsule_usage: z.unknown().optional(),
  platform: platformSchema.optional(),
  winclaw_version: semverSchema.optional(),
  session_count: z.number().int().min(0).optional(),
  active_minutes: z.number().int().min(0).optional(),
});
