/**
 * JWT Utilities — Token issuance and verification
 *
 * Uses RS256 (RSA + SHA-256) asymmetric algorithm as required by ADR-002.
 * Private key signs tokens; public key verifies them.
 */

import jwt, { type SignOptions, type VerifyOptions } from "jsonwebtoken";
import type { GrcConfig } from "../../config.js";

export interface JwtPayload {
  sub: string; // user ID (UUID)
  node_id?: string; // WinClaw node ID (for anonymous)
  tier: "free" | "pro" | "contributor";
  role?: "admin" | "user";
  email?: string; // user email (for admin whitelist enforcement)
  scopes: string[];
}

export function signToken(
  payload: JwtPayload,
  config: GrcConfig["jwt"],
  expiresInOverride?: string,
): string {
  const options: SignOptions = {
    issuer: config.issuer,
    expiresIn: (expiresInOverride ?? config.expiresIn) as unknown as number,
    algorithm: "RS256",
  };
  return jwt.sign(payload as object, config.privateKey, options);
}

export function verifyToken(
  token: string,
  config: GrcConfig["jwt"],
): JwtPayload {
  const options: VerifyOptions = {
    issuer: config.issuer,
    algorithms: ["RS256"],
  };
  const decoded = jwt.verify(token, config.publicKey, options);
  return decoded as JwtPayload;
}
