/**
 * Unit tests for src/shared/utils/crypto.ts
 */

import { describe, it, expect } from 'vitest';
import {
  hmacSign,
  hmacVerify,
  generateSecret,
  generateApiKey,
} from '../../../src/shared/utils/crypto.js';

// ── hmacSign ──────────────────────────────────────────────────────────────────

describe('hmacSign', () => {
  it('returns a hex string', () => {
    const sig = hmacSign('hello', 'secret');
    expect(sig).toMatch(/^[0-9a-f]+$/);
  });

  it('returns a 64-character SHA-256 hex digest', () => {
    const sig = hmacSign('hello', 'secret');
    expect(sig).toHaveLength(64);
  });

  it('is deterministic — same inputs produce same output', () => {
    const sig1 = hmacSign('data-payload', 'my-secret-key');
    const sig2 = hmacSign('data-payload', 'my-secret-key');
    expect(sig1).toBe(sig2);
  });

  it('produces different output for different data', () => {
    const sig1 = hmacSign('payload-a', 'secret');
    const sig2 = hmacSign('payload-b', 'secret');
    expect(sig1).not.toBe(sig2);
  });

  it('produces different output for different secrets', () => {
    const sig1 = hmacSign('payload', 'secret-a');
    const sig2 = hmacSign('payload', 'secret-b');
    expect(sig1).not.toBe(sig2);
  });

  it('matches known deterministic value for "hello" + "secret"', () => {
    // Pre-computed: echo -n "hello" | openssl dgst -sha256 -hmac "secret"
    const expected = '88aab3ede8d3adf94d26ab90d3bafd4a2083070c3bcce9c014ee04a443847c0b';
    expect(hmacSign('hello', 'secret')).toBe(expected);
  });
});

// ── hmacVerify ────────────────────────────────────────────────────────────────

describe('hmacVerify', () => {
  it('returns true for a valid signature', () => {
    const data = 'test-payload';
    const secret = 'my-secret';
    const sig = hmacSign(data, secret);
    expect(hmacVerify(data, sig, secret)).toBe(true);
  });

  it('returns false for a tampered signature', () => {
    const data = 'test-payload';
    const secret = 'my-secret';
    const sig = hmacSign(data, secret);
    const tampered = sig.replace(sig[0]!, sig[0] === 'a' ? 'b' : 'a');
    expect(hmacVerify(data, tampered, secret)).toBe(false);
  });

  it('returns false when data is different', () => {
    const secret = 'my-secret';
    const sig = hmacSign('original-data', secret);
    expect(hmacVerify('different-data', sig, secret)).toBe(false);
  });

  it('returns false when the wrong secret is used', () => {
    const data = 'test-payload';
    const sig = hmacSign(data, 'correct-secret');
    expect(hmacVerify(data, sig, 'wrong-secret')).toBe(false);
  });

  it('returns false for an empty signature string', () => {
    const data = 'test-payload';
    const secret = 'my-secret';
    expect(hmacVerify(data, '', secret)).toBe(false);
  });

  it('returns false for a completely wrong signature', () => {
    expect(hmacVerify('data', 'not-a-valid-signature', 'secret')).toBe(false);
  });

  it('verifies correctly with unicode data', () => {
    const data = '日本語テスト';
    const secret = 'unicode-secret';
    const sig = hmacSign(data, secret);
    expect(hmacVerify(data, sig, secret)).toBe(true);
  });
});

// ── generateSecret ────────────────────────────────────────────────────────────

describe('generateSecret', () => {
  it('returns a hex string', () => {
    const s = generateSecret();
    expect(s).toMatch(/^[0-9a-f]+$/);
  });

  it('returns 64 hex chars for default 32 bytes', () => {
    // 32 bytes → 64 hex characters
    const s = generateSecret();
    expect(s).toHaveLength(64);
  });

  it('returns correct length for custom byte count', () => {
    // 16 bytes → 32 hex characters
    expect(generateSecret(16)).toHaveLength(32);
    // 64 bytes → 128 hex characters
    expect(generateSecret(64)).toHaveLength(128);
  });

  it('generates unique values each call', () => {
    const s1 = generateSecret();
    const s2 = generateSecret();
    expect(s1).not.toBe(s2);
  });
});

// ── generateApiKey ────────────────────────────────────────────────────────────

describe('generateApiKey', () => {
  it('returns a string starting with the default grc_ prefix', () => {
    const key = generateApiKey();
    expect(key.startsWith('grc_')).toBe(true);
  });

  it('returns a string starting with a custom prefix', () => {
    const key = generateApiKey('wc');
    expect(key.startsWith('wc_')).toBe(true);
  });

  it('has a non-empty payload after the prefix', () => {
    const key = generateApiKey();
    const parts = key.split('_');
    // parts[0] = 'grc', parts[1] = base64url payload
    expect(parts.length).toBeGreaterThanOrEqual(2);
    expect(parts[1]!.length).toBeGreaterThan(0);
  });

  it('generates unique values each call', () => {
    const k1 = generateApiKey();
    const k2 = generateApiKey();
    expect(k1).not.toBe(k2);
  });

  it('payload portion contains only URL-safe base64url characters', () => {
    const key = generateApiKey();
    const payload = key.slice('grc_'.length);
    // base64url uses A-Z, a-z, 0-9, -, _  (no + or /)
    expect(payload).toMatch(/^[A-Za-z0-9\-_]+$/);
  });
});
