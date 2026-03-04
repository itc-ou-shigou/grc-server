/**
 * Admin Auth Middleware — Verifies admin role for management endpoints.
 *
 * All admin routes (/api/v1/admin/*) must pass through this middleware.
 * Checks: JWT valid + role === "admin" + email in admin whitelist.
 */

import type { Request, Response, NextFunction } from "express";
import type { GrcConfig } from "../../config.js";

/**
 * Creates an admin authentication middleware.
 * Requires valid JWT with role: "admin".
 * Cross-checks against the admin email whitelist from config when configured.
 */
export function createAdminAuthMiddleware(config: GrcConfig) {
  const adminEmails = new Set(
    config.admin.emails.map((e) => e.toLowerCase()),
  );
  const whitelistEnabled = adminEmails.size > 0;

  return (req: Request, res: Response, next: NextFunction) => {
    // Must be authenticated (JWT mode only -- API keys cannot be admin)
    if (!req.auth || req.authMode !== "jwt") {
      return res.status(401).json({
        error: "authentication_required",
        message: "Admin access requires JWT authentication",
      });
    }

    // Must have admin role in JWT claims
    if (req.auth.role !== "admin") {
      return res.status(403).json({
        error: "admin_required",
        message: "This endpoint requires admin privileges",
      });
    }

    // If an admin email whitelist is configured, verify the user's
    // email is on it. This provides defense-in-depth: even if a JWT
    // has role=admin, the email must match the whitelist.
    if (whitelistEnabled) {
      const email = req.auth.email;

      if (!email) {
        return res.status(403).json({
          error: "admin_email_required",
          message:
            "Admin email whitelist is enabled but no email claim is present in the token. " +
            "Re-authenticate via OAuth to include your email in the JWT.",
        });
      }

      if (!adminEmails.has(email.toLowerCase())) {
        return res.status(403).json({
          error: "admin_email_not_whitelisted",
          message: "Your email is not in the admin whitelist",
        });
      }
    }

    return next();
  };
}
