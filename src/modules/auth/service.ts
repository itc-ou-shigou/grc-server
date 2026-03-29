/**
 * Auth Module — Service Implementation
 *
 * Implements IAuthService for OAuth user management, anonymous registration,
 * API key validation, and refresh token management. All database access uses Drizzle ORM.
 */

import { eq, and, sql, isNull, gt, desc } from "drizzle-orm";
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcryptjs";
import pino from "pino";
import { getDb } from "../../shared/db/connection.js";
import type {
  IAuthService,
  IAuthUser,
  IApiKey,
  IResolvedApiKey,
} from "../../shared/interfaces/auth.interface.js";
import type { GrcConfig } from "../../config.js";
import { generateApiKey } from "../../shared/utils/crypto.js";
import { signToken, type JwtPayload } from "../../shared/utils/jwt.js";
import { users, apiKeys, refreshTokens, verificationCodes } from "./schema.js";
import { EmailService } from "./email-service.js";

const logger = pino({ name: "auth:service" });

/**
 * Hash a string using SHA-256 for secure storage comparison.
 * Used for both API key hashes and refresh token hashes.
 */
function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * HMAC-SHA256 hash for verification codes.
 * Prevents plaintext code exposure if the database is compromised.
 */
function hmacSha256(input: string, key: string): string {
  return createHmac("sha256", key).update(input, "utf8").digest("hex");
}

/**
 * Parse a duration string like "30d", "24h" into milliseconds.
 */
function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)([dhms])$/);
  if (!match) {
    throw new Error(`Invalid duration format: ${duration}`);
  }
  const value = Number.parseInt(match[1]!, 10);
  const unit = match[2]!;
  const multipliers: Record<string, number> = {
    d: 86400000,
    h: 3600000,
    m: 60000,
    s: 1000,
  };
  return value * multipliers[unit]!;
}

/**
 * Map a database row to the IAuthUser interface.
 */
function toAuthUser(row: typeof users.$inferSelect): IAuthUser {
  return {
    id: row.id,
    provider: row.provider as IAuthUser["provider"],
    providerId: row.providerId,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    email: row.email,
    tier: row.tier as IAuthUser["tier"],
    role: row.role as IAuthUser["role"],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Map a database row to the IApiKey interface.
 */
function toApiKeyInfo(row: typeof apiKeys.$inferSelect): IApiKey {
  return {
    id: row.id,
    userId: row.userId,
    keyPrefix: row.keyPrefix,
    name: row.name,
    scopes: row.scopes as string[],
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}

/** Number of bcrypt salt rounds for password hashing. */
const BCRYPT_ROUNDS = 12;

/** Verification code validity period in minutes. */
const CODE_EXPIRES_MINUTES = 5;

/** Maximum number of verification attempts per code. */
const MAX_CODE_ATTEMPTS = 5;

/** Minimum interval between code sends (seconds). */
const CODE_RATE_LIMIT_SECONDS = 60;

export class AuthService implements IAuthService {
  private config: GrcConfig;
  private emailService: EmailService;

  constructor(config: GrcConfig) {
    this.config = config;
    this.emailService = new EmailService(config);
  }

  async getUserById(id: string): Promise<IAuthUser | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return rows.length > 0 ? toAuthUser(rows[0]!) : null;
  }

  async getUserByProvider(
    provider: string,
    providerId: string,
  ): Promise<IAuthUser | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(users)
      .where(and(eq(users.provider, provider), eq(users.providerId, providerId)))
      .limit(1);
    return rows.length > 0 ? toAuthUser(rows[0]!) : null;
  }

  async upsertOAuthUser(params: {
    provider: "github" | "google";
    providerId: string;
    displayName: string;
    avatarUrl?: string;
    email?: string;
  }): Promise<IAuthUser> {
    const db = getDb();

    // Check if the user already exists
    const existing = await this.getUserByProvider(
      params.provider,
      params.providerId,
    );

    if (existing) {
      // Update display name, avatar, and email
      await db
        .update(users)
        .set({
          displayName: params.displayName,
          avatarUrl: params.avatarUrl ?? existing.avatarUrl,
          email: params.email ?? existing.email,
        })
        .where(eq(users.id, existing.id));

      logger.info(
        { userId: existing.id, provider: params.provider },
        "OAuth user updated",
      );

      // Return updated user
      const updated = await this.getUserById(existing.id);
      return updated!;
    }

    // Insert new user
    const id = uuidv4();
    const now = new Date();
    await db.insert(users).values({
      id,
      provider: params.provider,
      providerId: params.providerId,
      displayName: params.displayName,
      avatarUrl: params.avatarUrl ?? null,
      email: params.email ?? null,
      tier: "free",
      role: "user",
      createdAt: now,
      updatedAt: now,
    });

    logger.info(
      { userId: id, provider: params.provider },
      "New OAuth user created",
    );

    const created = await this.getUserById(id);
    return created!;
  }

  async upsertNodeUser(params: {
    nodeId: string;
    displayName?: string;
    email?: string;
  }): Promise<IAuthUser> {
    const db = getDb();

    // Check if a node-provider user already exists for this nodeId
    const existing = await this.getUserByProvider("node", params.nodeId);

    if (existing) {
      // Update displayName/email if provided
      const updates: Record<string, string> = {};
      if (params.displayName !== undefined) updates.displayName = params.displayName;
      if (params.email !== undefined) updates.email = params.email;

      if (Object.keys(updates).length > 0) {
        await db
          .update(users)
          .set(updates)
          .where(eq(users.id, existing.id));
      }

      logger.info(
        { userId: existing.id, nodeId: params.nodeId },
        "Node user updated",
      );

      const updated = await this.getUserById(existing.id);
      return updated!;
    }

    // Insert new node-provider user
    const id = uuidv4();
    const now = new Date();
    await db.insert(users).values({
      id,
      provider: "node",
      providerId: params.nodeId,
      displayName: params.displayName ?? `node-${params.nodeId.slice(0, 8)}`,
      email: params.email ?? null,
      tier: "free",
      role: "user",
      createdAt: now,
      updatedAt: now,
    });

    logger.info(
      { userId: id, nodeId: params.nodeId },
      "New node user created",
    );

    const created = await this.getUserById(id);
    return created!;
  }

  async registerAnonymous(nodeId: string): Promise<IAuthUser> {
    const db = getDb();

    // Check if anonymous user already exists for this node
    const existing = await this.getUserByProvider("anonymous", nodeId);
    if (existing) {
      return existing;
    }

    const id = uuidv4();
    const now = new Date();
    await db.insert(users).values({
      id,
      provider: "anonymous",
      providerId: nodeId,
      displayName: `node-${nodeId.slice(0, 8)}`,
      tier: "free",
      role: "user",
      createdAt: now,
      updatedAt: now,
    });

    logger.info({ userId: id, nodeId }, "Anonymous user registered");

    const created = await this.getUserById(id);
    return created!;
  }

  async validateApiKey(rawKey: string): Promise<IAuthUser | null> {
    const db = getDb();
    const keyHash = sha256(rawKey);

    const rows = await db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.keyHash, keyHash))
      .limit(1);

    if (rows.length === 0) {
      return null;
    }

    const key = rows[0]!;

    // Check expiration
    if (key.expiresAt && key.expiresAt < new Date()) {
      logger.warn({ keyId: key.id }, "API key expired");
      return null;
    }

    // Update last_used_at
    await db
      .update(apiKeys)
      .set({ lastUsedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(apiKeys.id, key.id));

    return this.getUserById(key.userId);
  }

  async updateTier(
    userId: string,
    tier: "free" | "pro" | "contributor",
  ): Promise<void> {
    const db = getDb();
    await db.update(users).set({ tier }).where(eq(users.id, userId));
    logger.info({ userId, tier }, "User tier updated");
  }

  // ── Refresh Token Management ──────────────────

  /**
   * Issue a refresh token for the given user.
   * Generates a cryptographically random token, stores its SHA-256 hash in the DB,
   * and returns the raw token to the caller.
   */
  async issueRefreshToken(userId: string): Promise<string> {
    const db = getDb();
    const rawToken = randomBytes(32).toString("base64url");
    const tokenHash = sha256(rawToken);
    const ttlMs = parseDuration(this.config.jwt.refreshTokenExpiresIn);
    const expiresAt = new Date(Date.now() + ttlMs);
    const id = uuidv4();

    await db.insert(refreshTokens).values({
      id,
      userId,
      tokenHash,
      expiresAt,
    });

    logger.info({ userId, tokenId: id }, "Refresh token issued");
    return rawToken;
  }

  /**
   * Exchange a refresh token for a new access + refresh token pair.
   * Implements refresh token rotation: the old token is revoked and a new one is issued.
   * Returns null if the token is invalid, expired, or already revoked.
   */
  async refreshAccessToken(
    refreshToken: string,
    expiresInOverride?: string,
  ): Promise<{ accessToken: string; refreshToken: string } | null> {
    const db = getDb();
    const tokenHash = sha256(refreshToken);

    // Look up the token by hash
    const rows = await db
      .select()
      .from(refreshTokens)
      .where(
        and(
          eq(refreshTokens.tokenHash, tokenHash),
          isNull(refreshTokens.revokedAt),
        ),
      )
      .limit(1);

    if (rows.length === 0) {
      // Check if this is a reused (already-revoked) token — potential theft
      const revokedRows = await db
        .select({ userId: refreshTokens.userId })
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, tokenHash))
        .limit(1);

      if (revokedRows.length > 0) {
        // Reuse detected — revoke ALL tokens for this user (security measure)
        logger.error(
          { userId: revokedRows[0]!.userId },
          "Refresh token reuse detected — revoking all user tokens",
        );
        await db
          .update(refreshTokens)
          .set({ revokedAt: sql`CURRENT_TIMESTAMP` })
          .where(
            and(
              eq(refreshTokens.userId, revokedRows[0]!.userId),
              isNull(refreshTokens.revokedAt),
            ),
          );
      }

      logger.warn("Refresh token not found or already revoked");
      return null;
    }

    const storedToken = rows[0]!;

    // Check expiration
    if (storedToken.expiresAt < new Date()) {
      logger.warn({ tokenId: storedToken.id }, "Refresh token expired");
      return null;
    }

    // Revoke the old refresh token (rotation)
    await db
      .update(refreshTokens)
      .set({ revokedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(refreshTokens.id, storedToken.id));

    // Fetch the user to build the JWT payload
    const user = await this.getUserById(storedToken.userId);
    if (!user) {
      logger.error({ userId: storedToken.userId }, "Refresh token user not found");
      return null;
    }

    // Check if user is banned
    if (user.role === "banned") {
      logger.warn({ userId: user.id }, "Banned user attempted token refresh");
      return null;
    }

    // Determine admin status
    const isAdmin =
      user.role === "admin" ||
      (user.email != null && this.config.admin.emails.includes(user.email));

    // Issue new access token
    const payload: JwtPayload = {
      sub: user.id,
      tier: user.tier,
      role: isAdmin ? "admin" : "user",
      email: user.email ?? undefined,
      scopes: ["read", "write", "publish"],
    };
    const accessToken = signToken(payload, this.config.jwt, expiresInOverride);

    // Issue new refresh token
    const newRefreshToken = await this.issueRefreshToken(user.id);

    logger.info({ userId: user.id, expiresInOverride: expiresInOverride ?? "default" }, "Access token refreshed via refresh token rotation");

    return { accessToken, refreshToken: newRefreshToken };
  }

  /**
   * Revoke a refresh token so it can no longer be used.
   */
  async revokeRefreshToken(refreshToken: string): Promise<void> {
    const db = getDb();
    const tokenHash = sha256(refreshToken);

    await db
      .update(refreshTokens)
      .set({ revokedAt: sql`CURRENT_TIMESTAMP` })
      .where(
        and(
          eq(refreshTokens.tokenHash, tokenHash),
          isNull(refreshTokens.revokedAt),
        ),
      );

    logger.info("Refresh token revoked");
  }

  /**
   * Revoke all refresh tokens for a user (logout from all devices).
   */
  async revokeAllUserTokens(userId: string): Promise<void> {
    const db = getDb();
    await db
      .update(refreshTokens)
      .set({ revokedAt: sql`CURRENT_TIMESTAMP` })
      .where(
        and(
          eq(refreshTokens.userId, userId),
          isNull(refreshTokens.revokedAt),
        ),
      );
    logger.info({ userId }, "All refresh tokens revoked");
  }

  // ── API Key Resolution (for middleware) ────────

  /**
   * Resolve an API key to its owner's details for middleware use.
   * Looks up the key by hash, checks expiration, updates last_used_at,
   * and returns the user ID, tier, and scopes.
   */
  async resolveApiKey(rawKey: string): Promise<IResolvedApiKey | null> {
    const db = getDb();
    const keyHash = sha256(rawKey);

    const rows = await db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.keyHash, keyHash))
      .limit(1);

    if (rows.length === 0) {
      return null;
    }

    const key = rows[0]!;

    // Check expiration
    if (key.expiresAt && key.expiresAt < new Date()) {
      logger.warn({ keyId: key.id }, "API key expired (middleware resolution)");
      return null;
    }

    // Update last_used_at
    await db
      .update(apiKeys)
      .set({ lastUsedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(apiKeys.id, key.id));

    // Fetch user tier
    const user = await this.getUserById(key.userId);
    if (!user) {
      logger.error({ keyId: key.id, userId: key.userId }, "API key owner not found");
      return null;
    }

    // Check if user is banned
    if (user.role === "banned") {
      logger.warn({ userId: user.id }, "Banned user attempted API key usage");
      return null;
    }

    return {
      userId: key.userId,
      tier: user.tier,
      scopes: key.scopes as string[],
    };
  }

  // ── API Key Management ──────────────────────────

  /**
   * Create a new API key for a user.
   * Returns the raw key (only shown once) and the key metadata.
   */
  async createApiKey(params: {
    userId: string;
    name: string;
    scopes: string[];
    expiresAt?: Date;
  }): Promise<{ rawKey: string; apiKey: IApiKey }> {
    const db = getDb();
    const rawKey = generateApiKey("grc");
    const keyHash = sha256(rawKey);
    const keyPrefix = rawKey.slice(0, 12); // "grc_" + 8 chars
    const id = uuidv4();

    await db.insert(apiKeys).values({
      id,
      userId: params.userId,
      keyHash,
      keyPrefix,
      name: params.name,
      scopes: params.scopes,
      expiresAt: params.expiresAt ?? null,
    });

    logger.info(
      { keyId: id, userId: params.userId, name: params.name },
      "API key created",
    );

    const rows = await db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.id, id))
      .limit(1);

    return { rawKey, apiKey: toApiKeyInfo(rows[0]!) };
  }

  /**
   * List all API keys for a user (without revealing hashes).
   */
  async listApiKeys(userId: string): Promise<IApiKey[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.userId, userId));
    return rows.map(toApiKeyInfo);
  }

  /**
   * Delete an API key. Only the owning user can delete their own keys.
   * Returns true if the key was found and deleted.
   */
  async deleteApiKey(keyId: string, userId: string): Promise<boolean> {
    const db = getDb();
    const rows = await db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId)))
      .limit(1);

    if (rows.length === 0) {
      return false;
    }

    await db
      .delete(apiKeys)
      .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId)));

    logger.info({ keyId, userId }, "API key deleted");
    return true;
  }

  // ── Node API Key Management ─────────────────────

  /**
   * Issue or retrieve an API Key for a node.
   *
   * - If an API Key with exact name `auto:node:{nodeId}` already exists,
   *   return its metadata (keyId, keyPrefix) WITHOUT rawKey — the raw key
   *   cannot be recovered from the stored hash.
   * - If no key exists, create a new one and return rawKey + metadata.
   *
   * WinClaw persists rawKey locally on first receipt. Subsequent hellos
   * only need the keyId to confirm the key is still valid.
   */
  async issueApiKeyForNode(
    userId: string,
    nodeId: string,
  ): Promise<{ rawKey: string | null; keyId: string; keyPrefix: string }> {
    const db = getDb();
    const keyName = `auto:node:${nodeId}`;

    // Check for existing key using exact match (NOT LIKE)
    const existingKeys = await db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.userId, userId), eq(apiKeys.name, keyName)))
      .limit(1);

    if (existingKeys.length > 0) {
      const existing = existingKeys[0]!;
      logger.info(
        { keyId: existing.id, nodeId },
        "Returning existing API key for node (rawKey not recoverable)",
      );
      return { rawKey: null, keyId: existing.id, keyPrefix: existing.keyPrefix };
    }

    // No existing key — create a new one (no expiry)
    const { rawKey, apiKey } = await this.createApiKey({
      userId,
      name: keyName,
      scopes: ["read", "write", "publish"],
      expiresAt: undefined,
    });

    logger.info(
      { keyId: apiKey.id, userId, nodeId },
      "New API key issued for node",
    );

    return { rawKey, keyId: apiKey.id, keyPrefix: apiKey.keyPrefix };
  }

  /**
   * Revoke the API Key for a node (admin "剔除" action).
   * Finds and deletes the key with exact name match `auto:node:{nodeId}`.
   * Returns true if a key was found and deleted.
   */
  async revokeApiKeyForNode(userId: string, nodeId: string): Promise<boolean> {
    const db = getDb();
    const keyName = `auto:node:${nodeId}`;

    const existingKeys = await db
      .select({ id: apiKeys.id })
      .from(apiKeys)
      .where(and(eq(apiKeys.userId, userId), eq(apiKeys.name, keyName)));

    for (const key of existingKeys) {
      await this.deleteApiKey(key.id, userId);
    }

    if (existingKeys.length > 0) {
      logger.info({ userId, nodeId, count: existingKeys.length }, "Node API keys revoked");
    }

    return existingKeys.length > 0;
  }

  // ── Email Auth ────────────────────────────────

  /**
   * Generate a 6-digit verification code, store it in the database,
   * and send it to the given email address via SMTP.
   * Rate-limited to 1 code per 60 seconds per email.
   */
  async sendVerificationCode(email: string): Promise<void> {
    const db = getDb();
    const normalizedEmail = email.toLowerCase().trim();

    // Rate limit: check if an unused, unexpired code was sent to this email within the last 60 seconds
    const cutoff = new Date(Date.now() - CODE_RATE_LIMIT_SECONDS * 1000);
    const recent = await db
      .select()
      .from(verificationCodes)
      .where(
        and(
          eq(verificationCodes.email, normalizedEmail),
          gt(verificationCodes.createdAt, cutoff),
          isNull(verificationCodes.usedAt),
          gt(verificationCodes.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (recent.length > 0) {
      throw new Error("RATE_LIMIT");
    }

    // Generate a 6-digit code
    const code = String(randomInt(100000, 999999));
    const recordId = uuidv4();

    // Insert record using raw SQL to set expires_at = created_at + 5 minutes
    // This avoids JavaScript timezone conversion issues
    await db.execute(sql`
      INSERT INTO verification_codes (id, email, code, created_at, expires_at, attempts)
      VALUES (
        ${recordId},
        ${normalizedEmail},
        ${hmacSha256(code, this.config.jwt.privateKey)},
        NOW(),
        DATE_ADD(NOW(), INTERVAL ${CODE_EXPIRES_MINUTES} MINUTE),
        0
      )
    `);

    // Send the code via email
    await this.emailService.sendVerificationCode(normalizedEmail, code);

    logger.info({ email: normalizedEmail }, "Verification code sent");
  }

  /**
   * Verify that a code matches the latest unexpired, unused code for the email.
   * Increments the attempt counter; fails if max attempts exceeded.
   *
   * @param consume - If true, mark the code as used so it cannot be reused.
   *   The 3-step registration flow calls verify-code (consume=false) first
   *   to let the UI advance, then register (consume=true) to finalize.
   * @returns true if the code is valid.
   */
  async verifyCode(email: string, code: string, consume = false): Promise<boolean> {
    const db = getDb();
    const normalizedEmail = email.toLowerCase().trim();

    // Find the latest unexpired, unused code for this email
    // Use SQL NOW() instead of JavaScript new Date() to avoid timezone issues
    const rows = await db
      .select()
      .from(verificationCodes)
      .where(
        and(
          eq(verificationCodes.email, normalizedEmail),
          sql`${verificationCodes.expiresAt} > NOW()`,
          isNull(verificationCodes.usedAt),
        ),
      )
      .orderBy(desc(verificationCodes.createdAt))
      .limit(1);

    if (rows.length === 0) {
      logger.warn({ email: normalizedEmail, consume }, "No valid verification code found (expired or already used)");
      return false;
    }

    const record = rows[0]!;
    logger.info({
      email: normalizedEmail,
      consume,
      recordId: record.id,
      attempts: record.attempts
    }, "Found verification code record");

    // Check max attempts
    if (record.attempts >= MAX_CODE_ATTEMPTS) {
      logger.warn({ email: normalizedEmail, attempts: record.attempts }, "Verification code max attempts exceeded");
      return false;
    }

    // Increment attempts
    await db
      .update(verificationCodes)
      .set({ attempts: sql`${verificationCodes.attempts} + 1` })
      .where(eq(verificationCodes.id, record.id));

    // Check if code matches (timing-safe comparison to prevent timing attacks)
    const expectedHash = hmacSha256(code, this.config.jwt.privateKey);
    const codeMatch = record.code.length === expectedHash.length &&
      timingSafeEqual(Buffer.from(record.code, "utf8"), Buffer.from(expectedHash, "utf8"));
    if (!codeMatch) {
      logger.warn({ email: normalizedEmail, consume }, "Verification code mismatch");
      return false;
    }

    // Only mark the code as used when consume=true (i.e. during registration)
    if (consume) {
      await db
        .update(verificationCodes)
        .set({ usedAt: sql`CURRENT_TIMESTAMP` })
        .where(eq(verificationCodes.id, record.id));
      logger.info({ email: normalizedEmail, recordId: record.id }, "Verification code consumed");
    }

    logger.info({ email: normalizedEmail, consumed: consume }, "Verification code verified");
    return true;
  }

  /**
   * Register a new user with email and password.
   * Requires a valid verification code that has already been verified.
   * Returns the created user.
   */
  async registerWithEmail(
    email: string,
    password: string,
    verificationCode: string,
  ): Promise<IAuthUser> {
    const db = getDb();
    const normalizedEmail = email.toLowerCase().trim();

    logger.info({ email: normalizedEmail }, "Starting email registration");

    // Verify and consume the code (marks it as used so it cannot be reused)
    const codeValid = await this.verifyCode(normalizedEmail, verificationCode, true);
    if (!codeValid) {
      logger.warn({ email: normalizedEmail }, "Registration failed: invalid or expired verification code");
      throw new Error("INVALID_CODE");
    }

    // Check if a user with this email + provider='email' already exists
    const existing = await this.getUserByProvider("email", normalizedEmail);
    if (existing) {
      logger.warn({ email: normalizedEmail }, "Registration failed: user already exists");
      throw new Error("USER_EXISTS");
    }

    // Hash the password with bcrypt
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    // Create the user
    const id = uuidv4();
    const now = new Date();
    await db.insert(users).values({
      id,
      provider: "email",
      providerId: normalizedEmail,
      displayName: normalizedEmail.split("@")[0] ?? normalizedEmail,
      email: normalizedEmail,
      passwordHash,
      tier: "free",
      role: "user",
      createdAt: now,
      updatedAt: now,
    });

    logger.info({ userId: id, email: normalizedEmail }, "Email user registered");

    const created = await this.getUserById(id);
    return created!;
  }

  /**
   * Authenticate a user with email and password.
   * Returns the user, JWT access token, and refresh token.
   */
  async loginWithEmail(
    email: string,
    password: string,
  ): Promise<{ user: IAuthUser; token: string; refreshToken: string }> {
    const db = getDb();
    const normalizedEmail = email.toLowerCase().trim();

    // Look up the user by provider='email' and provider_id=email
    const rows = await db
      .select()
      .from(users)
      .where(
        and(eq(users.provider, "email"), eq(users.providerId, normalizedEmail)),
      )
      .limit(1);

    if (rows.length === 0) {
      throw new Error("INVALID_CREDENTIALS");
    }

    const row = rows[0]!;

    // Check if user is banned
    if (row.role === "banned") {
      throw new Error("ACCOUNT_BANNED");
    }

    // Check password
    if (!row.passwordHash) {
      throw new Error("INVALID_CREDENTIALS");
    }

    const passwordMatch = await bcrypt.compare(password, row.passwordHash);
    if (!passwordMatch) {
      throw new Error("INVALID_CREDENTIALS");
    }

    const user = toAuthUser(row);

    // Determine admin status
    const isAdmin =
      user.role === "admin" ||
      (user.email != null && this.config.admin.emails.includes(user.email));

    // Issue JWT
    const payload: JwtPayload = {
      sub: user.id,
      tier: user.tier,
      role: isAdmin ? "admin" : "user",
      email: user.email ?? undefined,
      scopes: ["read", "write", "publish"],
    };
    const token = signToken(payload, this.config.jwt);

    // Issue refresh token
    const refreshToken = await this.issueRefreshToken(user.id);

    logger.info({ userId: user.id, email: normalizedEmail }, "Email login successful");

    return { user, token, refreshToken };
  }

  /**
   * Verify a pairing code and associate a node_id with an email user.
   * If no user exists for this email, creates one (passwordless).
   * If a user already exists, reuses it.
   * Returns JWT + refreshToken with full scopes.
   */
  async verifyPairing(
    email: string,
    code: string,
    nodeId: string,
  ): Promise<{ user: IAuthUser; token: string; refreshToken: string }> {
    const normalizedEmail = email.toLowerCase().trim();

    // Verify and consume the code
    const codeValid = await this.verifyCode(normalizedEmail, code, true);
    if (!codeValid) {
      throw new Error("INVALID_CODE");
    }

    const db = getDb();

    // Find or create email user
    let user = await this.getUserByProvider("email", normalizedEmail);

    if (!user) {
      // Create new email user (passwordless - no passwordHash)
      const id = uuidv4();
      const now = new Date();
      await db.insert(users).values({
        id,
        provider: "email",
        providerId: normalizedEmail,
        displayName: normalizedEmail.split("@")[0] ?? normalizedEmail,
        email: normalizedEmail,
        tier: "free",
        role: "user",
        createdAt: now,
        updatedAt: now,
      });
      user = (await this.getUserById(id))!;
      logger.info(
        { userId: id, email: normalizedEmail, nodeId },
        "New email user created via pairing",
      );
    } else {
      logger.info(
        { userId: user.id, email: normalizedEmail, nodeId },
        "Existing email user paired with node",
      );
    }

    // Determine admin status
    const isAdmin =
      user.role === "admin" ||
      (user.email != null && this.config.admin.emails.includes(user.email));

    // Issue JWT with full scopes
    const payload: JwtPayload = {
      sub: user.id,
      node_id: nodeId,
      tier: user.tier,
      role: isAdmin ? "admin" : "user",
      email: user.email ?? undefined,
      scopes: ["read", "write", "publish"],
    };
    const token = signToken(payload, this.config.jwt);

    // Issue refresh token
    const refreshToken = await this.issueRefreshToken(user.id);

    logger.info(
      { userId: user.id, email: normalizedEmail, nodeId },
      "Pairing successful",
    );

    return { user, token, refreshToken };
  }

}
