/**
 * Unit tests for Zod validation schemas used across admin routes.
 *
 * Since the schemas are defined inline within each admin-routes.ts file
 * and are not exported, we recreate equivalent schemas here to validate
 * the same business rules. This ensures the validation logic is tested
 * independently of Express route handlers.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// ── Recreated Schemas (matching those in admin route files) ──────────────────

// Common pagination used across all admin modules
const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// Auth module: user tier change
const changeTierSchema = z.object({
  tier: z.enum(["free", "contributor", "pro"]),
});

// Auth module: ban user
const banUserSchema = z.object({
  banned: z.boolean(),
});

// Auth module: user list query
const userListQuerySchema = paginationSchema.extend({
  provider: z.string().optional(),
  tier: z.enum(["free", "contributor", "pro"]).optional(),
  search: z.string().optional(),
});

// ClawHub module: skill status change
const changeStatusSchema = z.object({
  status: z.enum(["active", "approved", "rejected", "flagged", "removed"]),
  reason: z.string().optional(),
});

// ClawHub module: skill list query
const skillListQuerySchema = paginationSchema.extend({
  status: z.string().optional(),
  authorId: z.string().optional(),
  category: z.string().optional(),
});

// Evolution module: asset status change
const changeAssetStatusSchema = z.object({
  status: z.enum(["pending", "promoted", "quarantined", "approved"]),
  reason: z.string().optional(),
});

// Evolution module: asset list query
const assetListQuerySchema = paginationSchema.extend({
  status: z.string().optional(),
  type: z.enum(["gene", "capsule"]).optional(),
  category: z.string().optional(),
  nodeId: z.string().optional(),
});

// Update module: create release
const createReleaseSchema = z.object({
  version: z.string().min(1).max(50),
  platform: z.string().min(1).max(20),
  channel: z.string().min(1).max(20).default("stable"),
  download_url: z.string().url().max(500),
  size_bytes: z.number().int().positive(),
  checksum_sha256: z.string().max(64).optional(),
  changelog: z.string().optional(),
  min_upgrade_version: z.string().max(50).optional(),
  is_critical: z.boolean().default(false),
});

// Update module: update release
const updateReleaseSchema = z.object({
  download_url: z.string().url().max(500).optional(),
  size_bytes: z.number().int().positive().optional(),
  checksum_sha256: z.string().max(64).optional(),
  changelog: z.string().optional(),
  min_upgrade_version: z.string().max(50).nullable().optional(),
  is_critical: z.boolean().optional(),
  published_at: z.string().datetime().optional(),
});

// Telemetry module: export query
const exportQuerySchema = z.object({
  dateFrom: z.string().min(1, "dateFrom is required"),
  dateTo: z.string().min(1, "dateTo is required"),
});

// Telemetry module: delete old reports
const deleteOldReportsSchema = z.object({
  days: z.coerce.number().int().min(1).max(3650),
});

// Community module: create channel
const createChannelSchema = z.object({
  name: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, "Name must be lowercase alphanumeric with hyphens"),
  display_name: z.string().min(1).max(255),
  description: z.string().optional(),
  is_system: z.boolean().default(false),
});

// Community module: update channel
const updateChannelSchema = z.object({
  name: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/).optional(),
  display_name: z.string().min(1).max(255).optional(),
  description: z.string().nullable().optional(),
});

// Community module: moderate post
const moderatePostSchema = z.object({
  action: z.enum(["hide", "delete", "lock", "unlock", "pin", "unpin"]),
  reason: z.string().optional(),
});

// ── Tests ────────────────────────────────────────────────────────────────────

// ── Pagination Schema (shared across all admin modules) ──

describe('Admin paginationSchema', () => {
  it('applies defaults when no params are given', () => {
    const result = paginationSchema.parse({});
    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
  });

  it('accepts valid page and limit values', () => {
    const result = paginationSchema.parse({ page: 5, limit: 50 });
    expect(result.page).toBe(5);
    expect(result.limit).toBe(50);
  });

  it('coerces string values from query parameters', () => {
    const result = paginationSchema.parse({ page: '3', limit: '25' });
    expect(result.page).toBe(3);
    expect(result.limit).toBe(25);
  });

  it('rejects page less than 1', () => {
    expect(() => paginationSchema.parse({ page: 0 })).toThrow();
  });

  it('rejects negative page', () => {
    expect(() => paginationSchema.parse({ page: -1 })).toThrow();
  });

  it('rejects limit less than 1', () => {
    expect(() => paginationSchema.parse({ limit: 0 })).toThrow();
  });

  it('rejects limit greater than 100', () => {
    expect(() => paginationSchema.parse({ limit: 101 })).toThrow();
  });

  it('accepts limit at boundary 1', () => {
    const result = paginationSchema.parse({ limit: 1 });
    expect(result.limit).toBe(1);
  });

  it('accepts limit at boundary 100', () => {
    const result = paginationSchema.parse({ limit: 100 });
    expect(result.limit).toBe(100);
  });

  it('rejects non-integer page', () => {
    expect(() => paginationSchema.parse({ page: 1.5 })).toThrow();
  });

  it('rejects non-integer limit', () => {
    expect(() => paginationSchema.parse({ limit: 10.5 })).toThrow();
  });
});

// ── Auth: changeTierSchema ──

describe('Auth changeTierSchema', () => {
  it('accepts "free" tier', () => {
    const result = changeTierSchema.parse({ tier: 'free' });
    expect(result.tier).toBe('free');
  });

  it('accepts "contributor" tier', () => {
    const result = changeTierSchema.parse({ tier: 'contributor' });
    expect(result.tier).toBe('contributor');
  });

  it('accepts "pro" tier', () => {
    const result = changeTierSchema.parse({ tier: 'pro' });
    expect(result.tier).toBe('pro');
  });

  it('rejects invalid tier value', () => {
    expect(() => changeTierSchema.parse({ tier: 'enterprise' })).toThrow();
  });

  it('rejects empty tier', () => {
    expect(() => changeTierSchema.parse({ tier: '' })).toThrow();
  });

  it('rejects missing tier field', () => {
    expect(() => changeTierSchema.parse({})).toThrow();
  });

  it('rejects numeric tier', () => {
    expect(() => changeTierSchema.parse({ tier: 1 })).toThrow();
  });
});

// ── Auth: banUserSchema ──

describe('Auth banUserSchema', () => {
  it('accepts banned = true', () => {
    const result = banUserSchema.parse({ banned: true });
    expect(result.banned).toBe(true);
  });

  it('accepts banned = false', () => {
    const result = banUserSchema.parse({ banned: false });
    expect(result.banned).toBe(false);
  });

  it('rejects missing banned field', () => {
    expect(() => banUserSchema.parse({})).toThrow();
  });

  it('rejects string value for banned', () => {
    expect(() => banUserSchema.parse({ banned: 'true' })).toThrow();
  });

  it('rejects numeric value for banned', () => {
    expect(() => banUserSchema.parse({ banned: 1 })).toThrow();
  });
});

// ── Auth: userListQuerySchema ──

describe('Auth userListQuerySchema', () => {
  it('applies pagination defaults with no params', () => {
    const result = userListQuerySchema.parse({});
    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
    expect(result.provider).toBeUndefined();
    expect(result.tier).toBeUndefined();
    expect(result.search).toBeUndefined();
  });

  it('accepts provider filter', () => {
    const result = userListQuerySchema.parse({ provider: 'github' });
    expect(result.provider).toBe('github');
  });

  it('accepts tier filter with valid values', () => {
    const result = userListQuerySchema.parse({ tier: 'pro' });
    expect(result.tier).toBe('pro');
  });

  it('rejects invalid tier filter', () => {
    expect(() => userListQuerySchema.parse({ tier: 'admin' })).toThrow();
  });

  it('accepts search parameter', () => {
    const result = userListQuerySchema.parse({ search: 'john' });
    expect(result.search).toBe('john');
  });

  it('combines all filters', () => {
    const result = userListQuerySchema.parse({
      page: '2',
      limit: '10',
      provider: 'google',
      tier: 'free',
      search: 'test',
    });
    expect(result.page).toBe(2);
    expect(result.limit).toBe(10);
    expect(result.provider).toBe('google');
    expect(result.tier).toBe('free');
    expect(result.search).toBe('test');
  });
});

// ── ClawHub: changeStatusSchema ──

describe('ClawHub changeStatusSchema', () => {
  const validStatuses = ["active", "approved", "rejected", "flagged", "removed"];

  it('accepts all valid status values', () => {
    for (const status of validStatuses) {
      const result = changeStatusSchema.parse({ status });
      expect(result.status).toBe(status);
    }
  });

  it('accepts optional reason', () => {
    const result = changeStatusSchema.parse({ status: 'rejected', reason: 'Violates policy' });
    expect(result.reason).toBe('Violates policy');
  });

  it('does not require reason', () => {
    const result = changeStatusSchema.parse({ status: 'approved' });
    expect(result.reason).toBeUndefined();
  });

  it('rejects invalid status value', () => {
    expect(() => changeStatusSchema.parse({ status: 'published' })).toThrow();
  });

  it('rejects missing status', () => {
    expect(() => changeStatusSchema.parse({})).toThrow();
  });

  it('rejects empty status', () => {
    expect(() => changeStatusSchema.parse({ status: '' })).toThrow();
  });
});

// ── ClawHub: skillListQuerySchema ──

describe('ClawHub skillListQuerySchema', () => {
  it('applies defaults with no params', () => {
    const result = skillListQuerySchema.parse({});
    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
  });

  it('accepts status filter', () => {
    const result = skillListQuerySchema.parse({ status: 'active' });
    expect(result.status).toBe('active');
  });

  it('accepts authorId filter', () => {
    const result = skillListQuerySchema.parse({ authorId: 'user-123' });
    expect(result.authorId).toBe('user-123');
  });

  it('accepts category filter', () => {
    const result = skillListQuerySchema.parse({ category: 'automation' });
    expect(result.category).toBe('automation');
  });
});

// ── Evolution: changeAssetStatusSchema ──

describe('Evolution changeAssetStatusSchema', () => {
  const validStatuses = ["pending", "promoted", "quarantined", "approved"];

  it('accepts all valid asset status values', () => {
    for (const status of validStatuses) {
      const result = changeAssetStatusSchema.parse({ status });
      expect(result.status).toBe(status);
    }
  });

  it('accepts optional reason', () => {
    const result = changeAssetStatusSchema.parse({ status: 'quarantined', reason: 'Suspicious content' });
    expect(result.reason).toBe('Suspicious content');
  });

  it('does not require reason', () => {
    const result = changeAssetStatusSchema.parse({ status: 'promoted' });
    expect(result.reason).toBeUndefined();
  });

  it('rejects invalid status like "active"', () => {
    expect(() => changeAssetStatusSchema.parse({ status: 'active' })).toThrow();
  });

  it('rejects invalid status like "deleted"', () => {
    expect(() => changeAssetStatusSchema.parse({ status: 'deleted' })).toThrow();
  });

  it('rejects missing status', () => {
    expect(() => changeAssetStatusSchema.parse({})).toThrow();
  });
});

// ── Evolution: assetListQuerySchema ──

describe('Evolution assetListQuerySchema', () => {
  it('applies defaults', () => {
    const result = assetListQuerySchema.parse({});
    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
  });

  it('accepts "gene" type filter', () => {
    const result = assetListQuerySchema.parse({ type: 'gene' });
    expect(result.type).toBe('gene');
  });

  it('accepts "capsule" type filter', () => {
    const result = assetListQuerySchema.parse({ type: 'capsule' });
    expect(result.type).toBe('capsule');
  });

  it('rejects invalid type filter', () => {
    expect(() => assetListQuerySchema.parse({ type: 'plugin' })).toThrow();
  });

  it('accepts nodeId filter', () => {
    const result = assetListQuerySchema.parse({ nodeId: 'node-123' });
    expect(result.nodeId).toBe('node-123');
  });

  it('accepts status and category filters', () => {
    const result = assetListQuerySchema.parse({ status: 'pending', category: 'tools' });
    expect(result.status).toBe('pending');
    expect(result.category).toBe('tools');
  });
});

// ── Update: createReleaseSchema ──

describe('Update createReleaseSchema', () => {
  const validRelease = {
    version: '1.0.0',
    platform: 'win32',
    download_url: 'https://cdn.example.com/release.zip',
    size_bytes: 1024000,
  };

  it('accepts a valid minimal release', () => {
    const result = createReleaseSchema.parse(validRelease);
    expect(result.version).toBe('1.0.0');
    expect(result.platform).toBe('win32');
    expect(result.channel).toBe('stable'); // default
    expect(result.is_critical).toBe(false); // default
  });

  it('accepts full release with all fields', () => {
    const result = createReleaseSchema.parse({
      ...validRelease,
      channel: 'beta',
      checksum_sha256: 'a'.repeat(64),
      changelog: 'Bug fixes and improvements',
      min_upgrade_version: '0.9.0',
      is_critical: true,
    });
    expect(result.channel).toBe('beta');
    expect(result.is_critical).toBe(true);
    expect(result.checksum_sha256).toBe('a'.repeat(64));
  });

  it('rejects missing version', () => {
    const { version: _, ...rest } = validRelease;
    expect(() => createReleaseSchema.parse(rest)).toThrow();
  });

  it('rejects empty version', () => {
    expect(() => createReleaseSchema.parse({ ...validRelease, version: '' })).toThrow();
  });

  it('rejects version exceeding 50 characters', () => {
    expect(() => createReleaseSchema.parse({ ...validRelease, version: 'v'.repeat(51) })).toThrow();
  });

  it('rejects missing platform', () => {
    const { platform: _, ...rest } = validRelease;
    expect(() => createReleaseSchema.parse(rest)).toThrow();
  });

  it('rejects empty platform', () => {
    expect(() => createReleaseSchema.parse({ ...validRelease, platform: '' })).toThrow();
  });

  it('rejects missing download_url', () => {
    const { download_url: _, ...rest } = validRelease;
    expect(() => createReleaseSchema.parse(rest)).toThrow();
  });

  it('rejects invalid download_url', () => {
    expect(() =>
      createReleaseSchema.parse({ ...validRelease, download_url: 'not-a-url' })
    ).toThrow();
  });

  it('rejects missing size_bytes', () => {
    const { size_bytes: _, ...rest } = validRelease;
    expect(() => createReleaseSchema.parse(rest)).toThrow();
  });

  it('rejects zero size_bytes', () => {
    expect(() => createReleaseSchema.parse({ ...validRelease, size_bytes: 0 })).toThrow();
  });

  it('rejects negative size_bytes', () => {
    expect(() => createReleaseSchema.parse({ ...validRelease, size_bytes: -100 })).toThrow();
  });

  it('rejects non-integer size_bytes', () => {
    expect(() => createReleaseSchema.parse({ ...validRelease, size_bytes: 1024.5 })).toThrow();
  });

  it('defaults channel to "stable"', () => {
    const result = createReleaseSchema.parse(validRelease);
    expect(result.channel).toBe('stable');
  });

  it('defaults is_critical to false', () => {
    const result = createReleaseSchema.parse(validRelease);
    expect(result.is_critical).toBe(false);
  });
});

// ── Update: updateReleaseSchema ──

describe('Update updateReleaseSchema', () => {
  it('accepts empty object (all fields optional)', () => {
    const result = updateReleaseSchema.parse({});
    expect(result).toEqual({});
  });

  it('accepts partial update with download_url', () => {
    const result = updateReleaseSchema.parse({ download_url: 'https://cdn.example.com/new.zip' });
    expect(result.download_url).toBe('https://cdn.example.com/new.zip');
  });

  it('accepts partial update with is_critical', () => {
    const result = updateReleaseSchema.parse({ is_critical: true });
    expect(result.is_critical).toBe(true);
  });

  it('accepts nullable min_upgrade_version', () => {
    const result = updateReleaseSchema.parse({ min_upgrade_version: null });
    expect(result.min_upgrade_version).toBeNull();
  });

  it('accepts published_at as ISO datetime', () => {
    const result = updateReleaseSchema.parse({ published_at: '2026-03-01T12:00:00Z' });
    expect(result.published_at).toBe('2026-03-01T12:00:00Z');
  });

  it('rejects invalid datetime for published_at', () => {
    expect(() => updateReleaseSchema.parse({ published_at: 'not-a-date' })).toThrow();
  });

  it('rejects invalid download_url', () => {
    expect(() => updateReleaseSchema.parse({ download_url: 'not-a-url' })).toThrow();
  });
});

// ── Telemetry: exportQuerySchema ──

describe('Telemetry exportQuerySchema', () => {
  it('accepts valid dateFrom and dateTo', () => {
    const result = exportQuerySchema.parse({ dateFrom: '2026-01-01', dateTo: '2026-03-01' });
    expect(result.dateFrom).toBe('2026-01-01');
    expect(result.dateTo).toBe('2026-03-01');
  });

  it('rejects missing dateFrom', () => {
    expect(() => exportQuerySchema.parse({ dateTo: '2026-03-01' })).toThrow();
  });

  it('rejects missing dateTo', () => {
    expect(() => exportQuerySchema.parse({ dateFrom: '2026-01-01' })).toThrow();
  });

  it('rejects empty dateFrom', () => {
    expect(() => exportQuerySchema.parse({ dateFrom: '', dateTo: '2026-03-01' })).toThrow();
  });

  it('rejects empty dateTo', () => {
    expect(() => exportQuerySchema.parse({ dateFrom: '2026-01-01', dateTo: '' })).toThrow();
  });

  it('rejects both fields missing', () => {
    expect(() => exportQuerySchema.parse({})).toThrow();
  });
});

// ── Telemetry: deleteOldReportsSchema ──

describe('Telemetry deleteOldReportsSchema', () => {
  it('accepts valid number of days', () => {
    const result = deleteOldReportsSchema.parse({ days: 90 });
    expect(result.days).toBe(90);
  });

  it('coerces string to number', () => {
    const result = deleteOldReportsSchema.parse({ days: '365' });
    expect(result.days).toBe(365);
  });

  it('accepts minimum boundary of 1 day', () => {
    const result = deleteOldReportsSchema.parse({ days: 1 });
    expect(result.days).toBe(1);
  });

  it('accepts maximum boundary of 3650 days (~10 years)', () => {
    const result = deleteOldReportsSchema.parse({ days: 3650 });
    expect(result.days).toBe(3650);
  });

  it('rejects 0 days', () => {
    expect(() => deleteOldReportsSchema.parse({ days: 0 })).toThrow();
  });

  it('rejects negative days', () => {
    expect(() => deleteOldReportsSchema.parse({ days: -1 })).toThrow();
  });

  it('rejects days exceeding 3650', () => {
    expect(() => deleteOldReportsSchema.parse({ days: 3651 })).toThrow();
  });

  it('rejects non-integer days', () => {
    expect(() => deleteOldReportsSchema.parse({ days: 30.5 })).toThrow();
  });

  it('rejects missing days', () => {
    expect(() => deleteOldReportsSchema.parse({})).toThrow();
  });
});

// ── Community: createChannelSchema ──

describe('Community createChannelSchema', () => {
  const validChannel = {
    name: 'general-discussion',
    display_name: 'General Discussion',
  };

  it('accepts valid channel with minimal fields', () => {
    const result = createChannelSchema.parse(validChannel);
    expect(result.name).toBe('general-discussion');
    expect(result.display_name).toBe('General Discussion');
    expect(result.is_system).toBe(false); // default
  });

  it('accepts channel with all fields', () => {
    const result = createChannelSchema.parse({
      ...validChannel,
      description: 'A channel for general discussion',
      is_system: true,
    });
    expect(result.description).toBe('A channel for general discussion');
    expect(result.is_system).toBe(true);
  });

  it('accepts lowercase alphanumeric name with hyphens', () => {
    expect(() => createChannelSchema.parse({ ...validChannel, name: 'my-channel-123' })).not.toThrow();
  });

  it('rejects name with uppercase letters', () => {
    expect(() => createChannelSchema.parse({ ...validChannel, name: 'General' })).toThrow();
  });

  it('rejects name with spaces', () => {
    expect(() => createChannelSchema.parse({ ...validChannel, name: 'my channel' })).toThrow();
  });

  it('rejects name with underscores', () => {
    expect(() => createChannelSchema.parse({ ...validChannel, name: 'my_channel' })).toThrow();
  });

  it('rejects name with special characters', () => {
    expect(() => createChannelSchema.parse({ ...validChannel, name: 'my@channel!' })).toThrow();
  });

  it('rejects empty name', () => {
    expect(() => createChannelSchema.parse({ ...validChannel, name: '' })).toThrow();
  });

  it('rejects name exceeding 100 characters', () => {
    expect(() => createChannelSchema.parse({ ...validChannel, name: 'a'.repeat(101) })).toThrow();
  });

  it('rejects empty display_name', () => {
    expect(() => createChannelSchema.parse({ ...validChannel, display_name: '' })).toThrow();
  });

  it('rejects display_name exceeding 255 characters', () => {
    expect(() =>
      createChannelSchema.parse({ ...validChannel, display_name: 'a'.repeat(256) })
    ).toThrow();
  });

  it('rejects missing name', () => {
    expect(() => createChannelSchema.parse({ display_name: 'Test' })).toThrow();
  });

  it('rejects missing display_name', () => {
    expect(() => createChannelSchema.parse({ name: 'test' })).toThrow();
  });

  it('defaults is_system to false', () => {
    const result = createChannelSchema.parse(validChannel);
    expect(result.is_system).toBe(false);
  });
});

// ── Community: updateChannelSchema ──

describe('Community updateChannelSchema', () => {
  it('accepts empty object (all fields optional)', () => {
    const result = updateChannelSchema.parse({});
    expect(result).toEqual({});
  });

  it('accepts name update', () => {
    const result = updateChannelSchema.parse({ name: 'new-name' });
    expect(result.name).toBe('new-name');
  });

  it('accepts display_name update', () => {
    const result = updateChannelSchema.parse({ display_name: 'New Display Name' });
    expect(result.display_name).toBe('New Display Name');
  });

  it('accepts nullable description', () => {
    const result = updateChannelSchema.parse({ description: null });
    expect(result.description).toBeNull();
  });

  it('accepts description as string', () => {
    const result = updateChannelSchema.parse({ description: 'Updated description' });
    expect(result.description).toBe('Updated description');
  });

  it('rejects invalid name format', () => {
    expect(() => updateChannelSchema.parse({ name: 'UPPERCASE' })).toThrow();
  });
});

// ── Community: moderatePostSchema ──

describe('Community moderatePostSchema', () => {
  const validActions = ["hide", "delete", "lock", "unlock", "pin", "unpin"];

  it('accepts all valid moderation actions', () => {
    for (const action of validActions) {
      const result = moderatePostSchema.parse({ action });
      expect(result.action).toBe(action);
    }
  });

  it('accepts optional reason', () => {
    const result = moderatePostSchema.parse({ action: 'hide', reason: 'Spam content' });
    expect(result.reason).toBe('Spam content');
  });

  it('does not require reason', () => {
    const result = moderatePostSchema.parse({ action: 'lock' });
    expect(result.reason).toBeUndefined();
  });

  it('rejects invalid action', () => {
    expect(() => moderatePostSchema.parse({ action: 'ban' })).toThrow();
  });

  it('rejects empty action', () => {
    expect(() => moderatePostSchema.parse({ action: '' })).toThrow();
  });

  it('rejects missing action', () => {
    expect(() => moderatePostSchema.parse({})).toThrow();
  });

  it('rejects numeric action', () => {
    expect(() => moderatePostSchema.parse({ action: 1 })).toThrow();
  });
});
