/**
 * Auth Module — Route Registration
 *
 * Handles OAuth (GitHub, Google), anonymous tokens, refresh tokens,
 * API key management, and user profile retrieval.
 */

import { Router } from "express";
import type { Express, Request, Response, NextFunction } from "express";
import passport from "passport";
import { Strategy as GitHubStrategy } from "passport-github2";
import {
  Strategy as GoogleStrategy,
  type StrategyOptions as GoogleStrategyOptions,
  type Profile as GoogleProfile,
  type VerifyCallback as GoogleVerifyCallback,
} from "passport-google-oauth20";
import { randomBytes, createHmac } from "node:crypto";
import { z } from "zod";
import pino from "pino";
import type { GrcConfig } from "../../config.js";
import {
  createAuthMiddleware,
  registerApiKeyResolver,
} from "../../shared/middleware/auth.js";
import {
  asyncHandler,
  BadRequestError,
  ConflictError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
} from "../../shared/middleware/error-handler.js";
import { signToken, type JwtPayload } from "../../shared/utils/jwt.js";
import { nodeIdSchema, uuidSchema } from "../../shared/utils/validators.js";
import { AuthService } from "./service.js";

const logger = pino({ name: "module:auth" });

// ── Zod Schemas for Request Validation ──────────

const anonymousBodySchema = z.object({
  node_id: nodeIdSchema,
});

const VALID_API_SCOPES = ["read", "write", "publish"] as const;

const createApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(z.enum(VALID_API_SCOPES)).min(1).default(["read", "write"]),
  expires_in_days: z.number().int().min(1).max(365).optional(),
});

const refreshBodySchema = z.object({
  refresh_token: z.string().min(1),
});

const emailSendCodeSchema = z.object({
  email: z.string().email().max(255),
});

const emailVerifyCodeSchema = z.object({
  email: z.string().email().max(255),
  code: z.string().length(6).regex(/^\d{6}$/, "Code must be 6 digits"),
});

const emailRegisterSchema = z.object({
  email: z.string().email().max(255),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128)
    .refine(
      (pw) => /[a-z]/.test(pw) && /[A-Z]/.test(pw) && /\d/.test(pw),
      "Password must contain uppercase, lowercase, and a number",
    ),
  verification_code: z
    .string()
    .length(6)
    .regex(/^\d{6}$/, "Code must be 6 digits"),
});

const emailLoginSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1),
});

const pairBodySchema = z.object({
  email: z.string().email().max(255),
});

const pairVerifyBodySchema = z.object({
  email: z.string().email().max(255),
  code: z.string().length(6).regex(/^\d{6}$/, "Code must be 6 digits"),
  node_id: nodeIdSchema,
});

/**
 * Create a stricter rate limiter for authentication endpoints.
 * 20 requests per 15 minutes per IP to prevent brute-force attacks.
 */
function createAuthRateLimit() {
  const store = new Map<string, { count: number; resetAt: number }>();
  const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
  const MAX_REQUESTS = 20;

  // Cleanup expired entries every 5 minutes
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (now > entry.resetAt) store.delete(key);
    }
  }, 5 * 60 * 1000);

  return (req: Request, res: Response, next: NextFunction) => {
    const ip =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      req.socket.remoteAddress ||
      "unknown";
    const key = `auth:${ip}`;
    const now = Date.now();

    let entry = store.get(key);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + WINDOW_MS };
      store.set(key, entry);
    }

    entry.count++;

    if (entry.count > MAX_REQUESTS) {
      return res.status(429).json({
        error: "rate_limit_exceeded",
        message: "Too many authentication attempts. Please try again later.",
        retryAfter: Math.ceil((entry.resetAt - now) / 1000),
      });
    }

    return next();
  };
}

let _jwtPrivateKey = "";

export async function register(app: Express, config: GrcConfig) {
  const router = Router();
  const authService = new AuthService(config);
  _jwtPrivateKey = config.jwt.privateKey;
  const requireAuth = createAuthMiddleware(config);

  // Strict rate limiter for auth endpoints (IP-based, 20 req/15min)
  const authRateLimit = createAuthRateLimit();

  // Register the API key resolver callback so the shared auth middleware
  // can resolve API keys without directly importing the auth module.
  registerApiKeyResolver((rawKey) => authService.resolveApiKey(rawKey));

  // ── Configure Passport Strategies ───────────────

  configurePassport(config, authService);

  // ── OAuth: GitHub ───────────────────────────────

  router.get(
    "/github",
    asyncHandler(async (req: Request, res: Response) => {
      if (!config.oauth.github.clientId) {
        throw new BadRequestError("GitHub OAuth is not configured");
      }
      // Generate the authorization URL and redirect
      const params = new URLSearchParams({
        client_id: config.oauth.github.clientId,
        redirect_uri: config.oauth.github.callbackUrl,
        scope: "read:user user:email",
        state: generateState(),
      });
      res.redirect(
        `https://github.com/login/oauth/authorize?${params.toString()}`,
      );
    }),
  );

  router.get(
    "/github/callback",
    asyncHandler(async (req: Request, res: Response) => {
      if (!config.oauth.github.clientId) {
        throw new BadRequestError("GitHub OAuth is not configured");
      }

      // Validate CSRF state parameter
      if (!validateState(req.query.state as string | undefined)) {
        throw new BadRequestError("Invalid or expired OAuth state parameter");
      }

      return new Promise<void>((resolve, reject) => {
        passport.authenticate(
          "github",
          { session: false },
          async (err: Error | null, user: unknown) => {
            if (err) {
              reject(err);
              return;
            }
            if (!user) {
              reject(new UnauthorizedError("GitHub authentication failed"));
              return;
            }

            try {
              const authUser = user as { id: string; tier: string; role: string; email?: string };
              const token = issueJwt(authUser, config);
              const refreshToken = await authService.issueRefreshToken(authUser.id);
              logger.info({ userId: authUser.id }, "GitHub OAuth login successful");
              // Use fragment (#) instead of query (?) to prevent token
              // from being sent in referrer headers and server logs
              res.redirect(
                `/#token=${encodeURIComponent(token)}&refresh_token=${encodeURIComponent(refreshToken)}`,
              );
              resolve();
            } catch (issueErr) {
              reject(issueErr);
            }
          },
        )(req, res);
      });
    }),
  );

  // ── OAuth: Google ───────────────────────────────

  router.get(
    "/google",
    asyncHandler(async (req: Request, res: Response) => {
      if (!config.oauth.google.clientId) {
        throw new BadRequestError("Google OAuth is not configured");
      }
      const params = new URLSearchParams({
        client_id: config.oauth.google.clientId,
        redirect_uri: config.oauth.google.callbackUrl,
        response_type: "code",
        scope: "openid email profile",
        access_type: "offline",
        state: generateState(),
      });
      res.redirect(
        `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
      );
    }),
  );

  router.get(
    "/google/callback",
    asyncHandler(async (req: Request, res: Response) => {
      if (!config.oauth.google.clientId) {
        throw new BadRequestError("Google OAuth is not configured");
      }

      // Validate CSRF state parameter
      if (!validateState(req.query.state as string | undefined)) {
        throw new BadRequestError("Invalid or expired OAuth state parameter");
      }

      return new Promise<void>((resolve, reject) => {
        passport.authenticate(
          "google",
          { session: false },
          async (err: Error | null, user: unknown) => {
            if (err) {
              reject(err);
              return;
            }
            if (!user) {
              reject(new UnauthorizedError("Google authentication failed"));
              return;
            }

            try {
              const authUser = user as { id: string; tier: string; role: string; email?: string };
              const token = issueJwt(authUser, config);
              const refreshToken = await authService.issueRefreshToken(authUser.id);
              logger.info({ userId: authUser.id }, "Google OAuth login successful");
              // Use fragment (#) instead of query (?) to prevent token
              // from being sent in referrer headers and server logs
              res.redirect(
                `/#token=${encodeURIComponent(token)}&refresh_token=${encodeURIComponent(refreshToken)}`,
              );
              resolve();
            } catch (issueErr) {
              reject(issueErr);
            }
          },
        )(req, res);
      });
    }),
  );

  // ── Anonymous Token ─────────────────────────────
  // Anonymous sessions get an access token + refresh token for long-lived nodes.

  router.post(
    "/anonymous",
    authRateLimit,
    asyncHandler(async (req: Request, res: Response) => {
      const body = anonymousBodySchema.parse(req.body);
      const user = await authService.registerAnonymous(body.node_id);

      const payload: JwtPayload = {
        sub: user.id,
        node_id: body.node_id,
        tier: "free",
        role: "user",
        scopes: ["read"],
      };
      const token = signToken(payload, config.jwt);

      // Issue refresh token so nodes can renew access without re-registering
      const refreshToken = await authService.issueRefreshToken(user.id);

      logger.info({ nodeId: body.node_id }, "Anonymous token issued with refresh token");

      res.json({
        token,
        refreshToken,
        user: {
          id: user.id,
          tier: user.tier,
          scopes: ["read"],
        },
      });
    }),
  );

  // ── Dev Token (development/test only) ───────────
  // Issues a token with custom scopes for E2E testing.
  // ONLY available when NODE_ENV !== "production".

  if (config.nodeEnv !== "production") {
    const devTokenSchema = z.object({
      node_id: nodeIdSchema,
      scopes: z.array(z.string()).default(["read", "write", "publish"]),
      role: z.enum(["user", "admin"]).default("user"),
      email: z.string().email().optional(),
    });

    router.post(
      "/dev/token",
      asyncHandler(async (req: Request, res: Response) => {
        const body = devTokenSchema.parse(req.body);
        const devSecret = process.env.DEV_TOKEN_SECRET;
        if (devSecret && req.headers["x-dev-secret"] !== devSecret) {
          throw new UnauthorizedError("Invalid dev secret");
        }
        const user = await authService.registerAnonymous(body.node_id);

        const payload: JwtPayload = {
          sub: user.id,
          node_id: body.node_id,
          tier: "free",
          role: body.role,
          scopes: body.scopes,
          ...(body.email ? { email: body.email } : {}),
        };
        const token = signToken(payload, config.jwt);

        logger.warn(
          { nodeId: body.node_id, scopes: body.scopes },
          "DEV token issued (non-production only)",
        );

        res.json({
          token,
          user: {
            id: user.id,
            tier: user.tier,
            scopes: body.scopes,
          },
        });
      }),
    );

    logger.warn("DEV /auth/dev/token route enabled (NODE_ENV=%s)", config.nodeEnv);
  }

  // ── Email Auth ──────────────────────────────────

  router.post(
    "/email/send-code",
    authRateLimit,
    asyncHandler(async (req: Request, res: Response) => {
      const body = emailSendCodeSchema.parse(req.body);

      try {
        await authService.sendVerificationCode(body.email);
      } catch (err) {
        if (err instanceof Error && err.message === "RATE_LIMIT") {
          throw new BadRequestError(
            "Please wait 60 seconds before requesting another code",
          );
        }
        throw err;
      }

      res.json({
        ok: true,
        message: "Verification code sent",
      });
    }),
  );

  router.post(
    "/email/verify-code",
    asyncHandler(async (req: Request, res: Response) => {
      const body = emailVerifyCodeSchema.parse(req.body);

      const verified = await authService.verifyCode(body.email, body.code, false);

      res.json({
        ok: true,
        verified,
      });
    }),
  );

  router.post(
    "/email/register",
    authRateLimit,
    asyncHandler(async (req: Request, res: Response) => {
      let body;
      try {
        body = emailRegisterSchema.parse(req.body);
      } catch (err) {
        logger.warn({ error: err, body: req.body }, "Email registration schema validation failed");
        throw err;
      }

      let user;
      try {
        user = await authService.registerWithEmail(
          body.email,
          body.password,
          body.verification_code,
        );
      } catch (err) {
        if (err instanceof Error) {
          if (err.message === "INVALID_CODE") {
            throw new BadRequestError(
              "Verification code is invalid or expired",
            );
          }
          if (err.message === "USER_EXISTS") {
            throw new ConflictError(
              "A user with this email already exists",
            );
          }
        }
        throw err;
      }

      // Auto-login: issue JWT + refresh token
      const token = issueJwt(
        { id: user.id, tier: user.tier, role: user.role, email: user.email ?? undefined },
        config,
      );
      const refreshToken = await authService.issueRefreshToken(user.id);

      logger.info({ userId: user.id, email: user.email }, "Email registration successful");

      res.status(201).json({
        ok: true,
        token,
        refreshToken,
        user: {
          id: user.id,
          provider: user.provider,
          displayName: user.displayName,
          email: user.email,
          tier: user.tier,
          role: user.role,
        },
      });
    }),
  );

  router.post(
    "/email/login",
    authRateLimit,
    asyncHandler(async (req: Request, res: Response) => {
      const body = emailLoginSchema.parse(req.body);

      let result;
      try {
        result = await authService.loginWithEmail(body.email, body.password);
      } catch (err) {
        if (err instanceof Error) {
          if (err.message === "INVALID_CREDENTIALS") {
            throw new UnauthorizedError("Invalid email or password");
          }
          if (err.message === "ACCOUNT_BANNED") {
            throw new ForbiddenError("This account has been banned");
          }
        }
        throw err;
      }

      res.json({
        ok: true,
        token: result.token,
        refreshToken: result.refreshToken,
        user: {
          id: result.user.id,
          provider: result.user.provider,
          displayName: result.user.displayName,
          email: result.user.email,
          tier: result.user.tier,
          role: result.user.role,
        },
      });
    }),
  );

  // ── Refresh Token ─────────────────────────────

  router.post(
    "/refresh",
    authRateLimit,
    asyncHandler(async (req: Request, res: Response) => {
      const body = refreshBodySchema.parse(req.body);

      const result = await authService.refreshAccessToken(body.refresh_token);
      if (!result) {
        throw new UnauthorizedError(
          "Refresh token is invalid, expired, or already revoked",
        );
      }

      logger.info("Token refreshed successfully");

      res.json({
        access_token: result.accessToken,
        refresh_token: result.refreshToken,
        token_type: "Bearer",
      });
    }),
  );

  // ── Get Current User ────────────────────────────

  router.get(
    "/me",
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      if (!req.auth) {
        throw new UnauthorizedError();
      }

      const user = await authService.getUserById(req.auth.sub);
      if (!user) {
        throw new NotFoundError("User");
      }

      const keys = await authService.listApiKeys(user.id);

      res.json({
        user: {
          id: user.id,
          provider: user.provider,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
          email: user.email,
          tier: user.tier,
          role: user.role,
          createdAt: user.createdAt,
        },
        apiKeys: keys.map((k) => ({
          id: k.id,
          keyPrefix: k.keyPrefix,
          name: k.name,
          scopes: k.scopes,
          lastUsedAt: k.lastUsedAt,
          expiresAt: k.expiresAt,
          createdAt: k.createdAt,
        })),
      });
    }),
  );

  // ── Create API Key ──────────────────────────────

  router.post(
    "/apikey",
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      if (!req.auth) {
        throw new UnauthorizedError();
      }

      const body = createApiKeySchema.parse(req.body);

      let expiresAt: Date | undefined;
      if (body.expires_in_days) {
        expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + body.expires_in_days);
      }

      const { rawKey, apiKey } = await authService.createApiKey({
        userId: req.auth.sub,
        name: body.name,
        scopes: body.scopes,
        expiresAt,
      });

      logger.info(
        { userId: req.auth.sub, keyId: apiKey.id },
        "API key created",
      );

      res.status(201).json({
        key: rawKey,
        id: apiKey.id,
        keyPrefix: apiKey.keyPrefix,
        name: apiKey.name,
        scopes: apiKey.scopes,
        expiresAt: apiKey.expiresAt,
        createdAt: apiKey.createdAt,
        warning:
          "Save this key now. It will not be shown again.",
      });
    }),
  );

  // ── Delete API Key ──────────────────────────────

  router.delete(
    "/apikey/:id",
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      if (!req.auth) {
        throw new UnauthorizedError();
      }

      const keyId = uuidSchema.parse(req.params.id);

      const deleted = await authService.deleteApiKey(keyId, req.auth.sub);
      if (!deleted) {
        throw new NotFoundError("API key");
      }

      logger.info(
        { userId: req.auth.sub, keyId },
        "API key deleted",
      );

      res.json({ deleted: true });
    }),
  );

  // ── Email Pairing (passwordless) ────────────────

  router.post(
    "/pair",
    authRateLimit,
    asyncHandler(async (req: Request, res: Response) => {
      const body = pairBodySchema.parse(req.body);
      try {
        await authService.sendVerificationCode(body.email);
      } catch (err) {
        if (err instanceof Error && err.message === "RATE_LIMIT") {
          throw new BadRequestError(
            "Please wait 60 seconds before requesting another code",
          );
        }
        throw err;
      }
      res.json({ ok: true, message: "Pairing code sent to your email" });
    }),
  );

  router.post(
    "/pair/verify",
    authRateLimit,
    asyncHandler(async (req: Request, res: Response) => {
      const body = pairVerifyBodySchema.parse(req.body);

      let result;
      try {
        result = await authService.verifyPairing(
          body.email,
          body.code,
          body.node_id,
        );
      } catch (err) {
        if (err instanceof Error) {
          if (err.message === "INVALID_CODE") {
            throw new BadRequestError(
              "Verification code is invalid or expired",
            );
          }
        }
        throw err;
      }

      res.json({
        ok: true,
        token: result.token,
        refreshToken: result.refreshToken,
        user: {
          id: result.user.id,
          provider: result.user.provider,
          displayName: result.user.displayName,
          email: result.user.email,
          tier: result.user.tier,
          role: result.user.role,
        },
      });
    }),
  );

  // ── Logout ──────────────────────────────────────

  router.post(
    "/logout",
    asyncHandler(async (req: Request, res: Response) => {
      const body = refreshBodySchema.parse(req.body);
      await authService.revokeRefreshToken(body.refresh_token);
      res.json({ ok: true, message: "Logged out successfully" });
    }),
  );

  // ── Revoke All Sessions (authenticated) ─────────

  router.post(
    "/revoke-all",
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      if (!req.auth) {
        throw new UnauthorizedError();
      }
      await authService.revokeAllUserTokens(req.auth.sub);
      res.json({ ok: true, message: "All sessions revoked" });
    }),
  );

  // ── Mount Routes ────────────────────────────────

  app.use("/auth", router);
  logger.info("Auth module registered");
}

// ── Helper Functions ────────────────────────────

/**
 * Issue a JWT for an authenticated user.
 * Includes the email claim when available (needed for admin whitelist).
 */
function issueJwt(
  user: { id: string; tier: string; role: string; email?: string },
  config: GrcConfig,
): string {
  const isAdmin =
    user.role === "admin" ||
    (user.email && config.admin.emails.includes(user.email));

  const payload: JwtPayload = {
    sub: user.id,
    tier: user.tier as JwtPayload["tier"],
    role: isAdmin ? "admin" : "user",
    email: user.email ?? undefined,
    scopes: ["read", "write", "publish"],
  };
  return signToken(payload, config.jwt);
}

/**
 * Generate a self-validating OAuth state token using HMAC.
 * No server-side storage needed — works across multiple instances.
 */
function generateState(): string {
  const nonce = randomBytes(16).toString("hex");
  const ts = Date.now().toString();
  const data = `${nonce}:${ts}`;
  const sig = createHmac("sha256", _jwtPrivateKey).update(data).digest("hex");
  return `${data}:${sig}`;
}

/**
 * Validate and consume an OAuth state token.
 * Verifies HMAC signature and checks 10-minute expiry.
 */
function validateState(state: string | undefined): boolean {
  if (!state) return false;
  const parts = state.split(":");
  if (parts.length !== 3) return false;
  const [nonce, ts, sig] = parts;
  if (!nonce || !ts || !sig) return false;

  // Check expiry (10 minutes)
  const timestamp = parseInt(ts, 10);
  if (isNaN(timestamp) || Date.now() - timestamp > 10 * 60 * 1000) return false;

  // Verify HMAC signature
  const data = `${nonce}:${ts}`;
  const expected = createHmac("sha256", _jwtPrivateKey).update(data).digest("hex");
  return sig === expected;
}

/**
 * Configure Passport.js strategies for GitHub and Google OAuth.
 */
function configurePassport(config: GrcConfig, authService: AuthService): void {
  // Disable Passport session serialization (we use stateless JWTs)
  passport.serializeUser((user, done) => done(null, user));
  passport.deserializeUser((user, done) => done(null, user as Express.User));

  // ── GitHub Strategy ─────────────────────────────

  if (config.oauth.github.clientId && config.oauth.github.clientSecret) {
    passport.use(
      new GitHubStrategy(
        {
          clientID: config.oauth.github.clientId,
          clientSecret: config.oauth.github.clientSecret,
          callbackURL: config.oauth.github.callbackUrl,
          scope: ["read:user", "user:email"],
        },
        async (
          _accessToken: string,
          _refreshToken: string,
          profile: { id: string; displayName?: string; username?: string; photos?: Array<{ value: string }>; emails?: Array<{ value: string }> },
          done: (err: Error | null, user?: unknown) => void,
        ) => {
          try {
            const email = profile.emails?.[0]?.value;
            const avatarUrl = profile.photos?.[0]?.value;
            const displayName =
              profile.displayName || profile.username || `github-${profile.id}`;

            const user = await authService.upsertOAuthUser({
              provider: "github",
              providerId: profile.id,
              displayName,
              avatarUrl,
              email,
            });

            done(null, user);
          } catch (err) {
            done(err as Error);
          }
        },
      ),
    );
    logger.info("GitHub OAuth strategy configured");
  }

  // ── Google Strategy ─────────────────────────────

  if (config.oauth.google.clientId && config.oauth.google.clientSecret) {
    const googleOptions: GoogleStrategyOptions = {
      clientID: config.oauth.google.clientId,
      clientSecret: config.oauth.google.clientSecret,
      callbackURL: config.oauth.google.callbackUrl,
      scope: ["openid", "email", "profile"],
    };

    const googleVerify = async (
      _accessToken: string,
      _refreshToken: string,
      profile: GoogleProfile,
      done: GoogleVerifyCallback,
    ): Promise<void> => {
      try {
        const email = profile.emails?.[0]?.value;
        const avatarUrl = profile.photos?.[0]?.value;
        const displayName = profile.displayName || `google-${profile.id}`;

        const user = await authService.upsertOAuthUser({
          provider: "google",
          providerId: profile.id,
          displayName,
          avatarUrl,
          email,
        });

        done(null, user);
      } catch (err) {
        done(err as Error);
      }
    };

    passport.use(new GoogleStrategy(googleOptions, googleVerify));
    logger.info("Google OAuth strategy configured");
  }
}
