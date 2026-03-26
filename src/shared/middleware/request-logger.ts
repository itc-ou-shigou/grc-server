/**
 * Request Logger Middleware — Structured HTTP request logging.
 *
 * Logs method, URL, status code, response time, and auth info.
 * Uses pino for structured JSON logging.
 */

import type { Request, Response, NextFunction } from "express";
import pino from "pino";

const logger = pino({ name: "http" });

// High-frequency endpoints that should only be logged on error (prevent log bloat)
const QUIET_PATHS = new Set([
  "/healthz",
  "/api/v1/community/unread-count",
]);
const QUIET_PATH_PREFIXES = [
  "/a2a/config/stream",  // SSE long-poll
  "/a2a/heartbeat",
];

function isQuietPath(url: string): boolean {
  const path = url.split("?")[0];
  if (QUIET_PATHS.has(path)) return true;
  return QUIET_PATH_PREFIXES.some((p) => path.startsWith(p));
}

export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const start = Date.now();

  // Log on response finish
  res.on("finish", () => {
    const duration = Date.now() - start;
    const logData = {
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      duration,
      authMode: req.authMode ?? "none",
      userAgent: req.headers["user-agent"],
      ip:
        (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
        req.socket.remoteAddress,
    };

    if (res.statusCode >= 500) {
      logger.error(logData, "Request error");
    } else if (res.statusCode >= 400) {
      logger.warn(logData, "Request warning");
    } else if (!isQuietPath(req.originalUrl)) {
      // Skip INFO logging for high-frequency endpoints to prevent log bloat
      logger.info(logData, "Request completed");
    }
  });

  next();
}
