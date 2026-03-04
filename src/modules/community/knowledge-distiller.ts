/**
 * Knowledge Distiller
 *
 * Automatically identifies high-quality community posts (score >= threshold)
 * that can be converted into Evolution Gene candidates.
 *
 * Only "solution" and "evolution" post types are eligible for distillation.
 * The distiller extracts signals from tags and title keywords, builds a
 * strategy object from the post body, and returns everything needed for
 * the Evolution module to create a Gene.
 */

import pino from "pino";
import type { ICommunityPost } from "../../shared/interfaces/community.interface.js";

const logger = pino({ name: "community:knowledge-distiller" });

// Post types eligible for distillation
const DISTILLABLE_TYPES = new Set(["solution", "evolution"]);

// ── Signal Extraction ───────────────────────────────

/**
 * Extract signal keywords from a post's title and contextData.tags.
 * Normalises to lower-kebab-case and deduplicates.
 */
function extractSignals(post: ICommunityPost): string[] {
  const raw: string[] = [];

  // From tags stored in contextData
  const ctx = post.contextData ?? {};
  if (Array.isArray(ctx.tags)) {
    for (const tag of ctx.tags) {
      if (typeof tag === "string") raw.push(tag);
    }
  }

  // From title: extract significant words (>= 4 chars, alpha only)
  const titleWords = post.title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .split(/\s+/)
    .filter((w) => w.length >= 4);

  raw.push(...titleWords);

  // Deduplicate and normalise
  const seen = new Set<string>();
  const signals: string[] = [];
  for (const s of raw) {
    const normalised = s.toLowerCase().replace(/\s+/g, "-");
    if (!seen.has(normalised)) {
      seen.add(normalised);
      signals.push(normalised);
    }
  }

  return signals;
}

// ── Strategy Builder ────────────────────────────────

/**
 * Build a strategy object from the post content for Gene creation.
 */
function buildStrategy(post: ICommunityPost): Record<string, unknown> {
  const ctx = post.contextData ?? {};

  return {
    source: "community-distillation",
    sourcePostId: post.id,
    postType: post.postType,
    title: post.title,
    score: post.score,
    codeSnippets: ctx.codeSnippets ?? null,
    relatedAssets: ctx.relatedAssets ?? null,
    distilledAt: new Date().toISOString(),
  };
}

// ── Public API ──────────────────────────────────────

export interface DistillationResult {
  /** Signals extracted from the post for Gene matching */
  signalsMatch: string[];
  /** Strategy payload to store in the Gene */
  strategy: Record<string, unknown>;
  /** Suggested category for the Gene */
  category: string;
}

/**
 * Attempt to distill a community post into Gene metadata.
 *
 * Returns null if the post is not eligible for distillation
 * (wrong type, already distilled, or insufficient quality signals).
 */
export function distillPost(
  post: ICommunityPost,
): DistillationResult | null {
  // Only distill solution and evolution posts
  if (!DISTILLABLE_TYPES.has(post.postType)) {
    logger.debug(
      { postId: post.id, postType: post.postType },
      "Post type not eligible for distillation",
    );
    return null;
  }

  // Skip already-distilled posts
  if (post.isDistilled) {
    logger.debug({ postId: post.id }, "Post already distilled");
    return null;
  }

  const signalsMatch = extractSignals(post);
  if (signalsMatch.length === 0) {
    logger.debug(
      { postId: post.id },
      "No signals could be extracted from post",
    );
    return null;
  }

  const strategy = buildStrategy(post);
  const category = post.postType === "solution" ? "solution" : "strategy";

  logger.info(
    { postId: post.id, signalCount: signalsMatch.length, category },
    "Post distilled successfully",
  );

  return {
    signalsMatch,
    strategy,
    category,
  };
}
