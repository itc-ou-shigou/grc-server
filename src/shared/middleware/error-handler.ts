/**
 * Global Error Handler — Centralized error handling for all modules.
 *
 * Catches both synchronous and asynchronous errors thrown in route handlers.
 * Returns standardized JSON error responses.
 */

import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import pino from "pino";

const logger = pino({ name: "error-handler" });

/**
 * Application-level error class with HTTP status code.
 */
export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

/** 400 Bad Request */
export class BadRequestError extends AppError {
  constructor(message = "Bad request", details?: unknown) {
    super(400, "bad_request", message, details);
  }
}

/** 401 Unauthorized */
export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized") {
    super(401, "unauthorized", message);
  }
}

/** 403 Forbidden */
export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super(403, "forbidden", message);
  }
}

/** 404 Not Found */
export class NotFoundError extends AppError {
  constructor(resource = "Resource") {
    super(404, "not_found", `${resource} not found`);
  }
}

/** 409 Conflict */
export class ConflictError extends AppError {
  constructor(message = "Resource already exists") {
    super(409, "conflict", message);
  }
}

/**
 * Global error handler middleware.
 * Must be registered LAST in the Express middleware chain.
 */
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  // Zod validation errors
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: "validation_error",
      message: "Request validation failed",
      details: err.errors.map((e) => ({
        path: e.path.join("."),
        message: e.message,
        code: e.code,
      })),
    });
  }

  // Application errors
  if (err instanceof AppError) {
    // Log 5xx errors as errors, 4xx as warnings
    if (err.statusCode >= 500) {
      logger.error({ err, statusCode: err.statusCode }, err.message);
    } else {
      logger.warn({ code: err.code, statusCode: err.statusCode }, err.message);
    }

    return res.status(err.statusCode).json({
      error: err.code,
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
  }

  // Unexpected errors
  logger.error({ err }, "Unhandled error");
  return res.status(500).json({
    error: "internal_error",
    message:
      process.env.NODE_ENV === "production"
        ? "An unexpected error occurred"
        : err.message,
  });
}

/**
 * Async route handler wrapper.
 * Catches promise rejections and forwards them to the error handler.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
