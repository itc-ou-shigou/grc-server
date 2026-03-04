/**
 * IAuthService — Auth module interface for cross-module consumption.
 *
 * Other modules must depend on this interface, NOT on the auth module directly.
 * This enforces the Modular Monolith boundary and enables future service extraction.
 */

export interface IAuthUser {
  id: string;
  provider: "github" | "google" | "anonymous" | "email";
  providerId: string;
  displayName: string | null;
  avatarUrl: string | null;
  email: string | null;
  tier: "free" | "pro" | "contributor";
  role: "admin" | "user";
  createdAt: Date;
  updatedAt: Date;
}

export interface IApiKey {
  id: string;
  userId: string;
  keyPrefix: string; // first 8 chars for identification
  name: string;
  scopes: string[];
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
}

/**
 * Resolved API key information returned by the API key resolver callback.
 * Used by the auth middleware to populate req.auth after resolving an API key.
 */
export interface IResolvedApiKey {
  userId: string;
  tier: "free" | "pro" | "contributor";
  scopes: string[];
}

/**
 * Callback type for resolving API keys in the auth middleware.
 *
 * The auth module provides this function at registration time so that
 * the shared middleware can resolve API keys without importing the auth
 * module directly (respecting the Modular Monolith boundary).
 *
 * Returns the resolved key info, or null if the key is invalid/expired.
 */
export type ApiKeyResolverFn = (rawKey: string) => Promise<IResolvedApiKey | null>;

export interface IAuthService {
  /** Find user by internal UUID */
  getUserById(id: string): Promise<IAuthUser | null>;

  /** Find user by OAuth provider + provider ID */
  getUserByProvider(
    provider: string,
    providerId: string,
  ): Promise<IAuthUser | null>;

  /** Create or update user from OAuth callback */
  upsertOAuthUser(params: {
    provider: "github" | "google";
    providerId: string;
    displayName: string;
    avatarUrl?: string;
    email?: string;
  }): Promise<IAuthUser>;

  /** Register an anonymous node and return a user record */
  registerAnonymous(nodeId: string): Promise<IAuthUser>;

  /** Validate an API key and return the associated user */
  validateApiKey(rawKey: string): Promise<IAuthUser | null>;

  /** Update user tier */
  updateTier(
    userId: string,
    tier: "free" | "pro" | "contributor",
  ): Promise<void>;

  /** Issue a refresh token for the given user. Returns the raw (unhashed) token. */
  issueRefreshToken(userId: string): Promise<string>;

  /** Exchange a refresh token for a new access + refresh token pair. Returns null if token is invalid/expired/revoked. */
  refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string } | null>;

  /** Revoke a refresh token so it can no longer be used. */
  revokeRefreshToken(refreshToken: string): Promise<void>;

  /**
   * Resolve an API key to its owner's details for middleware use.
   * Returns user ID, tier, and scopes, or null if the key is invalid/expired.
   */
  resolveApiKey(rawKey: string): Promise<IResolvedApiKey | null>;
}
