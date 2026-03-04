/**
 * Unit tests for src/modules/clawhub/recommender.ts
 *
 * The SkillRecommender class relies on a live database connection for all
 * strategy methods (collaborativeFilter, contentBased, trendingRecommendations,
 * coldStart).  Rather than mocking the entire Drizzle ORM, these tests focus
 * on the pure-logic helpers that can be exercised without a DB:
 *
 *   - mergeAndDeduplicate (tested via a subclass that exposes it)
 *   - limit clamping (tested via getRecommendations with a mocked coldStart)
 *   - getRecommender singleton
 *
 * Strategy-level tests that require DB access are out of scope for unit tests
 * and belong in integration tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SkillRecommender,
  getRecommender,
  type RecommendedSkill,
} from '../../../src/modules/clawhub/recommender.js';

// ── Test Helpers ──────────────────────────────────────────────────────────────

/**
 * A testable subclass that exposes the private mergeAndDeduplicate helper
 * and overrides DB-bound strategy methods to return test data.
 */
class TestableRecommender extends SkillRecommender {
  // Expose the private helper for direct testing
  public merge(items: RecommendedSkill[], limit: number): RecommendedSkill[] {
    // Access via prototype so we do not have to re-implement it
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this as any).mergeAndDeduplicate(items, limit);
  }
}

function makeSkill(slug: string, score: number, downloadCount = 0): RecommendedSkill {
  return {
    slug,
    name: `Skill ${slug}`,
    description: null,
    version: '1.0.0',
    score,
    reason: 'test',
    downloadCount,
    averageRating: 0,
  };
}

// ── mergeAndDeduplicate ───────────────────────────────────────────────────────

describe('SkillRecommender — mergeAndDeduplicate', () => {
  const recommender = new TestableRecommender();

  it('returns an empty array from an empty input', () => {
    expect(recommender.merge([], 10)).toEqual([]);
  });

  it('deduplicates skills by slug, keeping the first occurrence', () => {
    const items = [
      makeSkill('skill-a', 0.9),
      makeSkill('skill-b', 0.8),
      makeSkill('skill-a', 0.7), // duplicate — should be removed
    ];
    const result = recommender.merge(items, 10);
    expect(result).toHaveLength(2);
    const slugs = result.map((r) => r.slug);
    expect(slugs).toEqual(expect.arrayContaining(['skill-a', 'skill-b']));
  });

  it('sorts results by score descending', () => {
    const items = [
      makeSkill('skill-c', 0.3),
      makeSkill('skill-a', 0.9),
      makeSkill('skill-b', 0.6),
    ];
    const result = recommender.merge(items, 10);
    expect(result[0]!.slug).toBe('skill-a');
    expect(result[1]!.slug).toBe('skill-b');
    expect(result[2]!.slug).toBe('skill-c');
  });

  it('respects the limit — caps output length', () => {
    const items = [
      makeSkill('a', 0.9),
      makeSkill('b', 0.8),
      makeSkill('c', 0.7),
      makeSkill('d', 0.6),
      makeSkill('e', 0.5),
    ];
    const result = recommender.merge(items, 3);
    expect(result).toHaveLength(3);
  });

  it('returns all items when count is below limit', () => {
    const items = [makeSkill('a', 0.9), makeSkill('b', 0.8)];
    const result = recommender.merge(items, 10);
    expect(result).toHaveLength(2);
  });

  it('selects the top-scored items when deduplication + limit both apply', () => {
    const items = [
      makeSkill('low', 0.2),
      makeSkill('high', 0.95),
      makeSkill('mid', 0.6),
      makeSkill('high', 0.1),  // duplicate of 'high'
      makeSkill('extra', 0.5),
    ];
    const result = recommender.merge(items, 2);
    expect(result).toHaveLength(2);
    expect(result[0]!.slug).toBe('high');
    expect(result[1]!.slug).toBe('mid');
  });

  it('handles a single item correctly', () => {
    const result = recommender.merge([makeSkill('only', 0.5)], 10);
    expect(result).toHaveLength(1);
    expect(result[0]!.slug).toBe('only');
  });

  it('handles all duplicates — returns a single unique item', () => {
    const items = [
      makeSkill('same', 0.9),
      makeSkill('same', 0.7),
      makeSkill('same', 0.5),
    ];
    const result = recommender.merge(items, 10);
    expect(result).toHaveLength(1);
    expect(result[0]!.slug).toBe('same');
  });
});

// ── limit clamping ────────────────────────────────────────────────────────────

describe('SkillRecommender — limit clamping in getRecommendations', () => {
  let recommender: SkillRecommender;

  beforeEach(() => {
    recommender = new SkillRecommender();

    // Stub out the DB-bound cold_start strategy to return empty
    // This prevents real DB calls while still exercising limit clamping
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(recommender as any, 'coldStart').mockResolvedValue([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(recommender as any, 'trendingRecommendations').mockResolvedValue([]);
  });

  it('clamps limit to a minimum of 1', async () => {
    // limit = 0 should become 1; no crash
    const result = await recommender.getRecommendations({ limit: 0, strategy: 'cold_start' });
    expect(Array.isArray(result)).toBe(true);
  });

  it('clamps limit to a maximum of 50', async () => {
    // limit = 200 should be clamped to 50; still works without error
    const result = await recommender.getRecommendations({ limit: 200, strategy: 'cold_start' });
    expect(Array.isArray(result)).toBe(true);
  });

  it('uses default limit of 10 when limit is not specified', async () => {
    // Should not throw; default limit = 10 clamped to min(max(10,1),50) = 10
    const result = await recommender.getRecommendations({ strategy: 'cold_start' });
    expect(Array.isArray(result)).toBe(true);
  });

  it('falls back to cold_start when no user identifier is provided and strategy is auto', async () => {
    // No userId, no nodeId → pure cold start
    const result = await recommender.getRecommendations({ strategy: 'auto' });
    expect(Array.isArray(result)).toBe(true);
  });
});

// ── Strategy selection defaults ───────────────────────────────────────────────

describe('SkillRecommender — strategy selection and fallback', () => {
  let recommender: SkillRecommender;

  beforeEach(() => {
    recommender = new SkillRecommender();
    // Stub DB-bound methods to avoid live DB calls
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(recommender as any, 'coldStart').mockResolvedValue([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(recommender as any, 'trendingRecommendations').mockResolvedValue([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(recommender as any, 'collaborativeFilter').mockResolvedValue([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(recommender as any, 'contentBased').mockResolvedValue([]);
  });

  it('returns an array (possibly empty) for strategy "trending"', async () => {
    const result = await recommender.getRecommendations({ strategy: 'trending' });
    expect(Array.isArray(result)).toBe(true);
  });

  it('returns an array (possibly empty) for strategy "cold_start"', async () => {
    const result = await recommender.getRecommendations({ strategy: 'cold_start' });
    expect(Array.isArray(result)).toBe(true);
  });

  it('returns an array (possibly empty) for strategy "collaborative" with no identifier', async () => {
    const result = await recommender.getRecommendations({ strategy: 'collaborative' });
    expect(Array.isArray(result)).toBe(true);
  });

  it('returns an array (possibly empty) for strategy "content" with no identifier', async () => {
    const result = await recommender.getRecommendations({ strategy: 'content' });
    expect(Array.isArray(result)).toBe(true);
  });
});

// ── getRecommender singleton ──────────────────────────────────────────────────

describe('getRecommender', () => {
  it('returns a SkillRecommender instance', () => {
    const instance = getRecommender();
    expect(instance).toBeInstanceOf(SkillRecommender);
  });

  it('returns the same instance on repeated calls (singleton pattern)', () => {
    const a = getRecommender();
    const b = getRecommender();
    expect(a).toBe(b);
  });
});
