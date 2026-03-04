/**
 * Unit tests for src/shared/utils/collaborative-filter.ts
 */

import { describe, it, expect } from 'vitest';
import {
  jaccardSimilarity,
  findSimilarUsers,
  scoreItemsByFrequency,
} from '../../../src/shared/utils/collaborative-filter.js';

// ── jaccardSimilarity ─────────────────────────────────────────────────────────

describe('jaccardSimilarity', () => {
  it('returns 0 when both sets are empty', () => {
    expect(jaccardSimilarity(new Set(), new Set())).toBe(0);
  });

  it('returns 1 for two identical sets', () => {
    const a = new Set(['x', 'y', 'z']);
    const b = new Set(['x', 'y', 'z']);
    expect(jaccardSimilarity(a, b)).toBe(1);
  });

  it('returns 0 for two completely disjoint sets', () => {
    const a = new Set(['a', 'b']);
    const b = new Set(['c', 'd']);
    expect(jaccardSimilarity(a, b)).toBe(0);
  });

  it('returns correct value for partial overlap', () => {
    // intersection = {b, c} (2), union = {a, b, c, d} (4) => 0.5
    const a = new Set(['a', 'b', 'c']);
    const b = new Set(['b', 'c', 'd']);
    expect(jaccardSimilarity(a, b)).toBeCloseTo(0.5, 10);
  });

  it('returns correct value for single-element intersection', () => {
    // intersection = {a} (1), union = {a, b, c, d} (4) => 0.25
    const a = new Set(['a', 'b']);
    const b = new Set(['a', 'c', 'd']);
    expect(jaccardSimilarity(a, b)).toBeCloseTo(0.25, 10);
  });

  it('returns correct value for one set being a subset of the other', () => {
    // intersection = {a, b} (2), union = {a, b, c} (3) => ~0.667
    const a = new Set(['a', 'b']);
    const b = new Set(['a', 'b', 'c']);
    expect(jaccardSimilarity(a, b)).toBeCloseTo(2 / 3, 10);
  });

  it('returns 0 when one set is empty and the other is not', () => {
    const a = new Set<string>();
    const b = new Set(['a', 'b']);
    // union = 2, intersection = 0 => 0
    expect(jaccardSimilarity(a, b)).toBe(0);
  });

  it('returns 0 when the other set is empty and one is not', () => {
    const a = new Set(['a', 'b']);
    const b = new Set<string>();
    expect(jaccardSimilarity(a, b)).toBe(0);
  });

  it('is symmetric — order of arguments does not matter', () => {
    const a = new Set(['a', 'b', 'c']);
    const b = new Set(['b', 'c', 'd', 'e']);
    expect(jaccardSimilarity(a, b)).toBe(jaccardSimilarity(b, a));
  });

  it('returns 1 for two single-element identical sets', () => {
    const a = new Set(['skill-1']);
    const b = new Set(['skill-1']);
    expect(jaccardSimilarity(a, b)).toBe(1);
  });
});

// ── findSimilarUsers ──────────────────────────────────────────────────────────

describe('findSimilarUsers', () => {
  it('returns an empty array when allUserItems is empty', () => {
    const targetItems = new Set(['skill-a']);
    const result = findSimilarUsers(targetItems, new Map());
    expect(result).toEqual([]);
  });

  it('returns an empty array when target has no items', () => {
    const allUsers = new Map([
      ['user-1', new Set(['skill-a', 'skill-b'])],
    ]);
    const result = findSimilarUsers(new Set(), allUsers);
    expect(result).toEqual([]);
  });

  it('excludes users with zero similarity (no overlap)', () => {
    const targetItems = new Set(['skill-a']);
    const allUsers = new Map([
      ['user-1', new Set(['skill-b', 'skill-c'])],
    ]);
    const result = findSimilarUsers(targetItems, allUsers);
    expect(result).toHaveLength(0);
  });

  it('returns one user when there is a single similar user', () => {
    const targetItems = new Set(['skill-a', 'skill-b']);
    const allUsers = new Map([
      ['user-1', new Set(['skill-a', 'skill-c'])],
    ]);
    const result = findSimilarUsers(targetItems, allUsers);
    expect(result).toHaveLength(1);
    expect(result[0]!.userId).toBe('user-1');
    expect(result[0]!.similarity).toBeGreaterThan(0);
  });

  it('sorts results by descending similarity', () => {
    const targetItems = new Set(['a', 'b', 'c']);
    const allUsers = new Map([
      // 1/5 overlap
      ['user-low', new Set(['a', 'd', 'e', 'f', 'g'])],
      // 2/3 overlap
      ['user-high', new Set(['a', 'b'])],
    ]);
    const result = findSimilarUsers(targetItems, allUsers);
    expect(result[0]!.userId).toBe('user-high');
    expect(result[0]!.similarity).toBeGreaterThan(result[1]!.similarity);
  });

  it('respects the topN limit', () => {
    const targetItems = new Set(['skill-x']);
    const allUsers = new Map<string, Set<string>>();
    for (let i = 0; i < 10; i++) {
      allUsers.set(`user-${i}`, new Set(['skill-x', `skill-extra-${i}`]));
    }
    const result = findSimilarUsers(targetItems, allUsers, 3);
    expect(result).toHaveLength(3);
  });

  it('returns all matching users when count is below topN', () => {
    const targetItems = new Set(['skill-a']);
    const allUsers = new Map([
      ['user-1', new Set(['skill-a'])],
      ['user-2', new Set(['skill-a'])],
    ]);
    const result = findSimilarUsers(targetItems, allUsers, 50);
    expect(result).toHaveLength(2);
  });

  it('similarity values are between 0 (exclusive) and 1 (inclusive)', () => {
    const targetItems = new Set(['a', 'b']);
    const allUsers = new Map([
      ['user-1', new Set(['a', 'b'])],
      ['user-2', new Set(['a', 'c'])],
    ]);
    const result = findSimilarUsers(targetItems, allUsers);
    for (const { similarity } of result) {
      expect(similarity).toBeGreaterThan(0);
      expect(similarity).toBeLessThanOrEqual(1);
    }
  });
});

// ── scoreItemsByFrequency ─────────────────────────────────────────────────────

describe('scoreItemsByFrequency', () => {
  it('returns empty map when similarUsers is empty', () => {
    const allUsers = new Map([['user-1', new Set(['skill-a'])]]);
    const result = scoreItemsByFrequency([], allUsers, new Set());
    expect(result.size).toBe(0);
  });

  it('returns empty map when all items are excluded', () => {
    const similarUsers = [{ userId: 'user-1', similarity: 0.8 }];
    const allUsers = new Map([['user-1', new Set(['skill-a'])]]);
    const exclude = new Set(['skill-a']);
    const result = scoreItemsByFrequency(similarUsers, allUsers, exclude);
    expect(result.size).toBe(0);
  });

  it('accumulates weighted scores from multiple users', () => {
    const similarUsers = [
      { userId: 'user-1', similarity: 0.8 },
      { userId: 'user-2', similarity: 0.5 },
    ];
    const allUsers = new Map([
      ['user-1', new Set(['skill-a', 'skill-b'])],
      ['user-2', new Set(['skill-a', 'skill-c'])],
    ]);
    const result = scoreItemsByFrequency(similarUsers, allUsers, new Set());

    // skill-a is seen by both users: 0.8 + 0.5 = 1.3
    expect(result.get('skill-a')).toBeCloseTo(1.3, 10);
    // skill-b is seen only by user-1: 0.8
    expect(result.get('skill-b')).toBeCloseTo(0.8, 10);
    // skill-c is seen only by user-2: 0.5
    expect(result.get('skill-c')).toBeCloseTo(0.5, 10);
  });

  it('excludes items that the target user already has', () => {
    const similarUsers = [{ userId: 'user-1', similarity: 1.0 }];
    const allUsers = new Map([
      ['user-1', new Set(['skill-owned', 'skill-new'])],
    ]);
    const exclude = new Set(['skill-owned']);
    const result = scoreItemsByFrequency(similarUsers, allUsers, exclude);

    expect(result.has('skill-owned')).toBe(false);
    expect(result.has('skill-new')).toBe(true);
  });

  it('handles a user in similarUsers that is not in allUserItems gracefully', () => {
    const similarUsers = [{ userId: 'ghost-user', similarity: 0.9 }];
    const allUsers = new Map<string, Set<string>>();
    const result = scoreItemsByFrequency(similarUsers, allUsers, new Set());
    expect(result.size).toBe(0);
  });

  it('higher similarity users contribute more to the item score', () => {
    const similarUsers = [
      { userId: 'user-high', similarity: 0.9 },
      { userId: 'user-low', similarity: 0.1 },
    ];
    const allUsers = new Map([
      ['user-high', new Set(['skill-a'])],
      ['user-low', new Set(['skill-b'])],
    ]);
    const result = scoreItemsByFrequency(similarUsers, allUsers, new Set());
    expect(result.get('skill-a')!).toBeGreaterThan(result.get('skill-b')!);
  });

  it('empty exclude set allows all items through', () => {
    const similarUsers = [{ userId: 'user-1', similarity: 0.5 }];
    const allUsers = new Map([
      ['user-1', new Set(['a', 'b', 'c'])],
    ]);
    const result = scoreItemsByFrequency(similarUsers, allUsers, new Set());
    expect(result.size).toBe(3);
  });
});
