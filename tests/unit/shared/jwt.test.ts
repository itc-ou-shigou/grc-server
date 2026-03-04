/**
 * Unit tests for src/shared/utils/jwt.ts
 *
 * Uses RS256 (RSA key pair) as required by ADR-002.
 */

import { describe, it, expect } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { signToken, verifyToken, type JwtPayload } from '../../../src/shared/utils/jwt.js';
import type { GrcConfig } from '../../../src/config.js';

// ── Generate test RSA key pairs ───────────────────────────────────────────────

const { publicKey: testPublicKey, privateKey: testPrivateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const { publicKey: wrongPublicKey, privateKey: wrongPrivateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<GrcConfig['jwt']> = {}): GrcConfig['jwt'] {
  return {
    privateKey: testPrivateKey,
    publicKey: testPublicKey,
    issuer: 'grc.test',
    expiresIn: '1h',
    refreshTokenExpiresIn: '30d',
    ...overrides,
  };
}

const basePayload: JwtPayload = {
  sub: 'user-uuid-12345678',
  tier: 'free',
  scopes: ['read:skills'],
};

// ── signToken + verifyToken roundtrip ─────────────────────────────────────────

describe('signToken + verifyToken roundtrip', () => {
  it('signs and verifies a token successfully', () => {
    const config = makeConfig();
    const token = signToken(basePayload, config);
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);

    const decoded = verifyToken(token, config);
    expect(decoded.sub).toBe(basePayload.sub);
    expect(decoded.tier).toBe(basePayload.tier);
    expect(decoded.scopes).toEqual(basePayload.scopes);
  });

  it('roundtrip preserves all fields including optional ones', () => {
    const config = makeConfig();
    const payload: JwtPayload = {
      sub: 'user-abc',
      tier: 'pro',
      role: 'admin',
      scopes: ['read:skills', 'write:skills'],
      node_id: 'node-xyz12345',
      email: 'admin@example.com',
    };
    const token = signToken(payload, config);
    const decoded = verifyToken(token, config);

    expect(decoded.sub).toBe(payload.sub);
    expect(decoded.tier).toBe(payload.tier);
    expect(decoded.role).toBe(payload.role);
    expect(decoded.scopes).toEqual(payload.scopes);
    expect(decoded.node_id).toBe(payload.node_id);
    expect(decoded.email).toBe(payload.email);
  });

  it('token is a three-part dot-separated JWT string', () => {
    const config = makeConfig();
    const token = signToken(basePayload, config);
    const parts = token.split('.');
    expect(parts).toHaveLength(3);
  });
});

// ── verifyToken fails with wrong key ──────────────────────────────────────────

describe('verifyToken with wrong key', () => {
  it('throws when verifying with a different RSA key pair', () => {
    const config = makeConfig();
    const token = signToken(basePayload, config);

    const wrongConfig = makeConfig({
      publicKey: wrongPublicKey,
      privateKey: wrongPrivateKey,
    });
    expect(() => verifyToken(token, wrongConfig)).toThrow();
  });
});

// ── verifyToken fails with wrong issuer ───────────────────────────────────────

describe('verifyToken with wrong issuer', () => {
  it('throws when the issuer does not match', () => {
    const config = makeConfig({ issuer: 'grc.correct' });
    const token = signToken(basePayload, config);

    const wrongIssuerConfig = makeConfig({ issuer: 'grc.wrong' });
    expect(() => verifyToken(token, wrongIssuerConfig)).toThrow();
  });
});

// ── verifyToken fails with expired token ──────────────────────────────────────

describe('verifyToken with expired token', () => {
  it('throws when verifying an expired token', async () => {
    // Sign with 1-millisecond expiry, then wait for it to expire
    const config = makeConfig({ expiresIn: '1ms' });
    const token = signToken(basePayload, config);

    // Wait to ensure the token has expired
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(() => verifyToken(token, config)).toThrow();
  });
});

// ── payload field verification ────────────────────────────────────────────────

describe('verifyToken payload fields', () => {
  it('decoded payload contains sub field', () => {
    const config = makeConfig();
    const token = signToken(basePayload, config);
    const decoded = verifyToken(token, config);
    expect(decoded.sub).toBe(basePayload.sub);
  });

  it('decoded payload contains tier field', () => {
    const config = makeConfig();
    const token = signToken({ ...basePayload, tier: 'contributor' }, config);
    const decoded = verifyToken(token, config);
    expect(decoded.tier).toBe('contributor');
  });

  it('decoded payload contains scopes array', () => {
    const config = makeConfig();
    const scopes = ['read:skills', 'write:skills', 'admin:all'];
    const token = signToken({ ...basePayload, scopes }, config);
    const decoded = verifyToken(token, config);
    expect(decoded.scopes).toEqual(scopes);
  });

  it('decoded payload has standard JWT claims (iat, exp)', () => {
    const config = makeConfig();
    const token = signToken(basePayload, config);
    // Cast to access standard JWT claims
    const decoded = verifyToken(token, config) as JwtPayload & {
      iat?: number;
      exp?: number;
      iss?: string;
    };
    expect(typeof decoded.iat).toBe('number');
    expect(typeof decoded.exp).toBe('number');
    expect(decoded.exp!).toBeGreaterThan(decoded.iat!);
  });

  it('decoded payload has correct issuer', () => {
    const config = makeConfig({ issuer: 'grc.winclawhub.ai' });
    const token = signToken(basePayload, config);
    const decoded = verifyToken(token, config) as JwtPayload & { iss?: string };
    expect(decoded.iss).toBe('grc.winclawhub.ai');
  });

  it('throws for a completely malformed token string', () => {
    const config = makeConfig();
    expect(() => verifyToken('not.a.token', config)).toThrow();
  });

  it('throws for an empty token string', () => {
    const config = makeConfig();
    expect(() => verifyToken('', config)).toThrow();
  });
});
