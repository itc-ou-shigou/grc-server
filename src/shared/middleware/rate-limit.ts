/**
 * Rate Limiting Middleware — Tier-based request throttling.
 *
 * Rate limits by authentication tier:
 * - Anonymous: 100 req/hour
 * - Free (authenticated): 500 req/hour
 * - Contributor: 1000 req/hour
 * - Pro: 5000 req/hour
 *
 * Uses in-memory sliding window. For production scale,
 * swap to Redis-based limiter (ioredis + sliding window lua script).
 */

import type { Request, Response, NextFunction } from "express";
import pino from "pino";

const logger = pino({ name: "rate-limit" });

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const TIER_LIMITS: Record<string, number> = {
  anonymous: 1000,
  free: 10000,
  contributor: 20000,
  pro: 50000,
};

const WINDOW_MS = 60 * 60 * 1000; // 1 hour

// In-memory store (replace with Redis for multi-instance)
const store = new Map<string, RateLimitEntry>();

// Maximum number of tracked keys to prevent memory exhaustion under DoS
const MAX_STORE_SIZE = 100_000;

// Periodic cleanup of expired entries
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.resetAt) {
      store.delete(key);
    }
  }
}, 5 * 60 * 1000); // every 5 minutes

/**
 * Extract a rate limit key from the request.
 * Uses user ID for authenticated users, IP for anonymous.
 */
function getRateLimitKey(req: Request): string {
  if (req.auth && req.auth.sub !== "anonymous") {
    return `user:${req.auth.sub}`;
  }
  // Anonymous: use IP
  const ip =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.socket.remoteAddress ||
    "unknown";
  return `ip:${ip}`;
}

/**
 * Rate limiting middleware.
 * Must be applied AFTER auth middleware (needs req.auth).
 */
export function rateLimitMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const key = getRateLimitKey(req);
  const tier = req.auth?.tier ?? "anonymous";
  const limit = TIER_LIMITS[tier] ?? TIER_LIMITS.anonymous!;
  const now = Date.now();

  let entry = store.get(key);
  if (!entry || now > entry.resetAt) {
    // Prevent unbounded memory growth under DoS
    if (!entry && store.size >= MAX_STORE_SIZE) {
      logger.warn(
        { storeSize: store.size },
        "Rate limit store at capacity — rejecting new entries",
      );
      return res.status(429).json({
        error: "rate_limit_exceeded",
        message: "Server is under heavy load. Please try again later.",
        retryAfter: 60,
      });
    }
    entry = { count: 0, resetAt: now + WINDOW_MS };
    store.set(key, entry);
  }

  entry.count++;

  // Set rate limit headers
  res.setHeader("X-RateLimit-Limit", limit);
  res.setHeader("X-RateLimit-Remaining", Math.max(0, limit - entry.count));
  res.setHeader("X-RateLimit-Reset", Math.ceil(entry.resetAt / 1000));

  if (entry.count > limit) {
    logger.warn({ key, tier, count: entry.count, limit }, "Rate limit exceeded");
    return res.status(429).json({
      error: "rate_limit_exceeded",
      message: `Rate limit exceeded. Limit: ${limit} requests per hour for tier: ${tier}`,
      retryAfter: Math.ceil((entry.resetAt - now) / 1000),
    });
  }

  return next();
}
