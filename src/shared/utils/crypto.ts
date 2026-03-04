/**
 * Crypto Utilities — HMAC-SHA256 signing and verification
 * Used for A2A Protocol asset signature verification.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Generate an HMAC-SHA256 signature for the given data.
 */
export function hmacSign(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data, "utf8").digest("hex");
}

/**
 * Verify an HMAC-SHA256 signature.
 * Uses Node.js crypto.timingSafeEqual to prevent timing attacks.
 */
export function hmacVerify(
  data: string,
  signature: string,
  secret: string,
): boolean {
  const expected = hmacSign(data, secret);
  if (expected.length !== signature.length) return false;

  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signature, "hex");
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}

/**
 * Generate a cryptographically secure random string.
 */
export function generateSecret(bytes: number = 32): string {
  return randomBytes(bytes).toString("hex");
}

/**
 * Generate a random API key with a prefix.
 */
export function generateApiKey(prefix: string = "grc"): string {
  return `${prefix}_${randomBytes(24).toString("base64url")}`;
}
