/**
 * Unit tests for src/shared/utils/validators.ts
 */

import { describe, it, expect } from 'vitest';
import {
  paginationSchema,
  nodeIdSchema,
  slugSchema,
  semverSchema,
  a2aHelloSchema,
  a2aPublishSchema,
  a2aSearchSchema,
  skillSearchSchema,
} from '../../../src/shared/utils/validators.js';

// ── paginationSchema ──────────────────────────────────────────────────────────

describe('paginationSchema', () => {
  it('parses valid page and limit', () => {
    const result = paginationSchema.parse({ page: 2, limit: 10 });
    expect(result.page).toBe(2);
    expect(result.limit).toBe(10);
  });

  it('applies defaults when fields are omitted', () => {
    const result = paginationSchema.parse({});
    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
  });

  it('coerces string numbers', () => {
    const result = paginationSchema.parse({ page: '3', limit: '50' });
    expect(result.page).toBe(3);
    expect(result.limit).toBe(50);
  });

  it('rejects page < 1', () => {
    expect(() => paginationSchema.parse({ page: 0 })).toThrow();
  });

  it('rejects limit < 1', () => {
    expect(() => paginationSchema.parse({ limit: 0 })).toThrow();
  });

  it('rejects limit > 100', () => {
    expect(() => paginationSchema.parse({ limit: 101 })).toThrow();
  });

  it('accepts limit exactly at boundary 100', () => {
    const result = paginationSchema.parse({ limit: 100 });
    expect(result.limit).toBe(100);
  });

  it('accepts limit exactly at boundary 1', () => {
    const result = paginationSchema.parse({ limit: 1 });
    expect(result.limit).toBe(1);
  });
});

// ── nodeIdSchema ──────────────────────────────────────────────────────────────

describe('nodeIdSchema', () => {
  it('accepts a valid alphanumeric node ID', () => {
    expect(() => nodeIdSchema.parse('node12345')).not.toThrow();
  });

  it('accepts node ID with hyphens and underscores', () => {
    expect(() => nodeIdSchema.parse('node-abc_123')).not.toThrow();
  });

  it('accepts node ID exactly 8 characters long (min boundary)', () => {
    expect(() => nodeIdSchema.parse('abcd1234')).not.toThrow();
  });

  it('accepts node ID exactly 255 characters long (max boundary)', () => {
    const id = 'a'.repeat(255);
    expect(() => nodeIdSchema.parse(id)).not.toThrow();
  });

  it('rejects node ID shorter than 8 characters', () => {
    expect(() => nodeIdSchema.parse('abc123')).toThrow();
  });

  it('rejects node ID longer than 255 characters', () => {
    const id = 'a'.repeat(256);
    expect(() => nodeIdSchema.parse(id)).toThrow();
  });

  it('rejects node ID with spaces', () => {
    expect(() => nodeIdSchema.parse('node id 1')).toThrow();
  });

  it('rejects node ID with special characters', () => {
    expect(() => nodeIdSchema.parse('node@id!123')).toThrow();
  });

  it('rejects empty string', () => {
    expect(() => nodeIdSchema.parse('')).toThrow();
  });
});

// ── slugSchema ────────────────────────────────────────────────────────────────

describe('slugSchema', () => {
  it('accepts a simple lowercase slug', () => {
    expect(() => slugSchema.parse('my-skill')).not.toThrow();
  });

  it('accepts a slug with numbers', () => {
    expect(() => slugSchema.parse('skill-v2')).not.toThrow();
  });

  it('accepts a single-word slug', () => {
    expect(() => slugSchema.parse('skill')).not.toThrow();
  });

  it('accepts a multi-segment slug', () => {
    expect(() => slugSchema.parse('my-cool-skill-v3')).not.toThrow();
  });

  it('rejects a slug with uppercase letters', () => {
    expect(() => slugSchema.parse('My-Skill')).toThrow();
  });

  it('rejects a slug with trailing hyphen', () => {
    expect(() => slugSchema.parse('my-skill-')).toThrow();
  });

  it('rejects a slug with leading hyphen', () => {
    expect(() => slugSchema.parse('-my-skill')).toThrow();
  });

  it('rejects a slug with double hyphens', () => {
    expect(() => slugSchema.parse('my--skill')).toThrow();
  });

  it('rejects a slug with spaces', () => {
    expect(() => slugSchema.parse('my skill')).toThrow();
  });

  it('rejects empty string', () => {
    expect(() => slugSchema.parse('')).toThrow();
  });

  it('rejects a slug exceeding 100 characters', () => {
    const longSlug = 'a'.repeat(101);
    expect(() => slugSchema.parse(longSlug)).toThrow();
  });
});

// ── semverSchema ──────────────────────────────────────────────────────────────

describe('semverSchema', () => {
  it('accepts plain semver', () => {
    expect(() => semverSchema.parse('1.0.0')).not.toThrow();
  });

  it('accepts semver with v prefix', () => {
    expect(() => semverSchema.parse('v1.0.0')).not.toThrow();
  });

  it('accepts semver with pre-release identifier', () => {
    expect(() => semverSchema.parse('1.0.0-beta.1')).not.toThrow();
  });

  it('accepts semver with build metadata', () => {
    expect(() => semverSchema.parse('1.0.0+build.20240101')).not.toThrow();
  });

  it('accepts semver with both pre-release and build metadata', () => {
    expect(() => semverSchema.parse('1.2.3-alpha.1+001')).not.toThrow();
  });

  it('accepts v-prefixed semver with pre-release', () => {
    expect(() => semverSchema.parse('v2.10.4-rc.2')).not.toThrow();
  });

  it('rejects plain text', () => {
    expect(() => semverSchema.parse('latest')).toThrow();
  });

  it('rejects incomplete version like 1.0', () => {
    expect(() => semverSchema.parse('1.0')).toThrow();
  });

  it('rejects empty string', () => {
    expect(() => semverSchema.parse('')).toThrow();
  });
});

// ── a2aHelloSchema ────────────────────────────────────────────────────────────

describe('a2aHelloSchema', () => {
  const validNodeId = 'node-abc12345';

  it('accepts minimal valid payload (node_id only)', () => {
    expect(() => a2aHelloSchema.parse({ node_id: validNodeId })).not.toThrow();
  });

  it('accepts full valid payload with all optional fields', () => {
    expect(() =>
      a2aHelloSchema.parse({
        node_id: validNodeId,
        capabilities: { streaming: true },
        gene_count: 5,
        env_fingerprint: 'fp-abc123',
        platform: 'win32',
        winclaw_version: 'v2.0.0',
      })
    ).not.toThrow();
  });

  it('rejects missing node_id', () => {
    expect(() => a2aHelloSchema.parse({ gene_count: 0 })).toThrow();
  });

  it('rejects invalid platform value', () => {
    expect(() =>
      a2aHelloSchema.parse({ node_id: validNodeId, platform: 'bsd' })
    ).toThrow();
  });

  it('rejects invalid semver in winclaw_version', () => {
    expect(() =>
      a2aHelloSchema.parse({ node_id: validNodeId, winclaw_version: 'invalid' })
    ).toThrow();
  });

  it('rejects negative gene_count', () => {
    expect(() =>
      a2aHelloSchema.parse({ node_id: validNodeId, gene_count: -1 })
    ).toThrow();
  });

  it('accepts gene_count of 0', () => {
    expect(() =>
      a2aHelloSchema.parse({ node_id: validNodeId, gene_count: 0 })
    ).not.toThrow();
  });

  it('accepts all three platform values', () => {
    for (const platform of ['win32', 'darwin', 'linux'] as const) {
      expect(() =>
        a2aHelloSchema.parse({ node_id: validNodeId, platform })
      ).not.toThrow();
    }
  });
});

// ── a2aPublishSchema ──────────────────────────────────────────────────────────

describe('a2aPublishSchema', () => {
  const validBase = {
    node_id: 'node-abc12345',
    asset_type: 'gene' as const,
    asset_id: 'gene-001',
    content_hash: 'sha256-abcdef',
    payload: { code: 'console.log("hello")' },
  };

  it('accepts a valid gene publish payload', () => {
    expect(() => a2aPublishSchema.parse(validBase)).not.toThrow();
  });

  it('accepts capsule as asset_type', () => {
    expect(() =>
      a2aPublishSchema.parse({ ...validBase, asset_type: 'capsule' })
    ).not.toThrow();
  });

  it('accepts optional signature field', () => {
    expect(() =>
      a2aPublishSchema.parse({ ...validBase, signature: 'sig-abc' })
    ).not.toThrow();
  });

  it('rejects missing node_id', () => {
    const { node_id: _, ...rest } = validBase;
    expect(() => a2aPublishSchema.parse(rest)).toThrow();
  });

  it('rejects missing asset_type', () => {
    const { asset_type: _, ...rest } = validBase;
    expect(() => a2aPublishSchema.parse(rest)).toThrow();
  });

  it('rejects invalid asset_type', () => {
    expect(() =>
      a2aPublishSchema.parse({ ...validBase, asset_type: 'plugin' })
    ).toThrow();
  });

  it('rejects missing content_hash', () => {
    const { content_hash: _, ...rest } = validBase;
    expect(() => a2aPublishSchema.parse(rest)).toThrow();
  });

  it('rejects missing payload', () => {
    const { payload: _, ...rest } = validBase;
    expect(() => a2aPublishSchema.parse(rest)).toThrow();
  });
});

// ── a2aSearchSchema ───────────────────────────────────────────────────────────

describe('a2aSearchSchema', () => {
  it('applies defaults when all fields are omitted', () => {
    const result = a2aSearchSchema.parse({});
    expect(result.limit).toBe(20);
    expect(result.offset).toBe(0);
  });

  it('accepts valid status value', () => {
    const result = a2aSearchSchema.parse({ status: 'approved' });
    expect(result.status).toBe('approved');
  });

  it('accepts all valid status values', () => {
    for (const status of ['pending', 'approved', 'promoted', 'quarantined'] as const) {
      expect(() => a2aSearchSchema.parse({ status })).not.toThrow();
    }
  });

  it('rejects invalid status value', () => {
    expect(() => a2aSearchSchema.parse({ status: 'archived' })).toThrow();
  });

  it('accepts signals array', () => {
    const result = a2aSearchSchema.parse({ signals: ['sig-a', 'sig-b'] });
    expect(result.signals).toEqual(['sig-a', 'sig-b']);
  });

  it('coerces string limit and offset', () => {
    const result = a2aSearchSchema.parse({ limit: '50', offset: '10' });
    expect(result.limit).toBe(50);
    expect(result.offset).toBe(10);
  });

  it('rejects limit > 100', () => {
    expect(() => a2aSearchSchema.parse({ limit: 101 })).toThrow();
  });

  it('rejects negative offset', () => {
    expect(() => a2aSearchSchema.parse({ offset: -1 })).toThrow();
  });
});

// ── skillSearchSchema ─────────────────────────────────────────────────────────

describe('skillSearchSchema', () => {
  it('applies default sort of downloads', () => {
    const result = skillSearchSchema.parse({});
    expect(result.sort).toBe('downloads');
  });

  it('applies default pagination values', () => {
    const result = skillSearchSchema.parse({});
    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
  });

  it('accepts all valid sort values', () => {
    for (const sort of ['name', 'downloads', 'rating', 'created'] as const) {
      const result = skillSearchSchema.parse({ sort });
      expect(result.sort).toBe(sort);
    }
  });

  it('rejects invalid sort value', () => {
    expect(() => skillSearchSchema.parse({ sort: 'popularity' })).toThrow();
  });

  it('accepts optional query string q', () => {
    const result = skillSearchSchema.parse({ q: 'my-skill' });
    expect(result.q).toBe('my-skill');
  });

  it('accepts optional comma-separated tags', () => {
    const result = skillSearchSchema.parse({ tags: 'ai,automation' });
    expect(result.tags).toBe('ai,automation');
  });

  it('accepts page and limit override', () => {
    const result = skillSearchSchema.parse({ page: 3, limit: 50 });
    expect(result.page).toBe(3);
    expect(result.limit).toBe(50);
  });
});
