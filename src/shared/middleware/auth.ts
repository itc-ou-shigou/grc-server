/**
 * Auth Middleware — JWT verification + API Key resolution + Anonymous mode
 *
 * Supports three authentication modes:
 * 1. Bearer token (JWT) — full access based on scopes
 * 2. API Key (x-api-key header) — programmatic access (fully resolved via callback)
 * 3. Anonymous — read-only access with rate limiting
 */

import type { Request, Response, NextFunction } from "express";
import { verifyToken, type JwtPayload } from "../utils/jwt.js";
import type { GrcConfig } from "../../config.js";
import type { ApiKeyResolverFn } from "../interfaces/auth.interface.js";

// Extend Express Request to include auth info
declare global {
  namespace Express {
    interface Request {
      auth?: JwtPayload;
      authMode?: "jwt" | "apikey" | "anonymous";
    }
  }
}

/**
 * Shared registry for the API key resolver callback.
 * The auth module registers its resolver at startup; the middleware
 * uses it to resolve API keys without a direct module dependency.
 */
let _apiKeyResolver: ApiKeyResolverFn | null = null;

/**
 * Register the API key resolver function.
 * Called once by the auth module during registration.
 */
export function registerApiKeyResolver(resolver: ApiKeyResolverFn): void {
  _apiKeyResolver = resolver;
}

/**
 * Creates an authentication middleware.
 * If `required` is false, anonymous access is allowed (auth info will be empty).
 */
export function createAuthMiddleware(config: GrcConfig, required = true) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // 1. Try Bearer token (JWT) — from Authorization header or ?token= query param
    //    (EventSource / SSE connections cannot send custom headers, so we also accept
    //     the token as a query parameter.)
    const authHeader = req.headers.authorization;
    const queryToken = req.query.token as string | undefined;
    const bearerToken = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : queryToken || undefined;

    if (bearerToken) {
      try {
        req.auth = verifyToken(bearerToken, config.jwt);
        req.authMode = "jwt";
        return next();
      } catch {
        return res.status(401).json({
          error: "invalid_token",
          message: "JWT token is invalid or expired",
        });
      }
    }

    // 2. Try API Key — fully resolve using the registered callback
    const apiKey = req.headers["x-api-key"] as string | undefined;
    if (apiKey) {
      // Basic format validation — reject obviously invalid keys early
      if (apiKey.length < 10) {
        return res.status(401).json({
          error: "invalid_api_key",
          message: "API key format is invalid",
        });
      }

      // Ensure the resolver has been registered (auth module is loaded)
      if (!_apiKeyResolver) {
        return res.status(503).json({
          error: "service_unavailable",
          message: "API key authentication is not available yet",
        });
      }

      try {
        const resolved = await _apiKeyResolver(apiKey);
        if (!resolved) {
          return res.status(401).json({
            error: "invalid_api_key",
            message: "API key is invalid or expired",
          });
        }

        req.authMode = "apikey";
        req.auth = {
          sub: resolved.userId,
          tier: resolved.tier,
          role: "user", // API keys cannot have admin role
          scopes: resolved.scopes,
        };
        return next();
      } catch {
        return res.status(500).json({
          error: "api_key_error",
          message: "Failed to validate API key",
        });
      }
    }

    // 3. Anonymous mode
    if (!required) {
      req.authMode = "anonymous";
      req.auth = {
        sub: "anonymous",
        tier: "free",
        scopes: ["read"],
      };
      return next();
    }

    // Authentication required but not provided
    return res.status(401).json({
      error: "authentication_required",
      message: "Bearer token or API key is required",
    });
  };
}

/**
 * Scope-checking middleware.
 * Requires that the authenticated user has ALL specified scopes.
 */
export function requireScopes(...scopes: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      return res.status(401).json({
        error: "authentication_required",
        message: "Authentication is required for this endpoint",
      });
    }

    const missing = scopes.filter((s) => !req.auth!.scopes.includes(s));
    if (missing.length > 0) {
      return res.status(403).json({
        error: "insufficient_scope",
        message: `Missing required scopes: ${missing.join(", ")}`,
      });
    }

    return next();
  };
}

/**
 * Tier-checking middleware.
 * Requires that the authenticated user has at least the specified tier.
 */
export function requireTier(...allowedTiers: Array<"free" | "pro" | "contributor">) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      return res.status(401).json({
        error: "authentication_required",
        message: "Authentication is required for this endpoint",
      });
    }

    if (!allowedTiers.includes(req.auth.tier)) {
      return res.status(403).json({
        error: "insufficient_tier",
        message: `This endpoint requires one of: ${allowedTiers.join(", ")}`,
      });
    }

    return next();
  };
}
