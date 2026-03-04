/**
 * Unit tests for src/modules/community/feed.ts
 */

import { describe, it, expect } from 'vitest';
import { calculateHotScore, sortByHot } from '../../../src/modules/community/feed.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Create a Date that is `hoursAgo` hours in the past from now.
 */
function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

// ── calculateHotScore ─────────────────────────────────────────────────────────

describe('calculateHotScore — zero votes', () => {
  it('returns 0 when upvotes and downvotes are both 0', () => {
    const score = calculateHotScore(0, 0, hoursAgo(1));
    expect(score).toBe(0);
  });
});

describe('calculateHotScore — all upvotes', () => {
  it('returns a positive score for a post with only upvotes', () => {
    const score = calculateHotScore(100, 0, hoursAgo(1));
    expect(score).toBeGreaterThan(0);
  });

  it('score is less than 1 (bounded by Wilson lower bound × decay)', () => {
    const score = calculateHotScore(1000, 0, hoursAgo(0.01));
    expect(score).toBeLessThan(1);
  });
});

describe('calculateHotScore — all downvotes', () => {
  it('returns a very low (near-zero) score when all votes are downvotes', () => {
    // All-downvote: positive ratio = 0, Wilson score ~ 0 × decay
    const score = calculateHotScore(0, 100, hoursAgo(1));
    expect(score).toBeCloseTo(0, 3);
  });
});

describe('calculateHotScore — mixed votes', () => {
  it('returns a positive score for majority upvotes', () => {
    const score = calculateHotScore(80, 20, hoursAgo(2));
    expect(score).toBeGreaterThan(0);
  });

  it('higher upvote ratio yields higher score than lower upvote ratio (same total, same age)', () => {
    const scoreHigh = calculateHotScore(90, 10, hoursAgo(1));
    const scoreLow = calculateHotScore(50, 50, hoursAgo(1));
    expect(scoreHigh).toBeGreaterThan(scoreLow);
  });

  it('more total votes yields higher confidence (higher Wilson score) for same ratio', () => {
    const scoreMany = calculateHotScore(900, 100, hoursAgo(1));
    const scoreFew = calculateHotScore(9, 1, hoursAgo(1));
    expect(scoreMany).toBeGreaterThan(scoreFew);
  });
});

describe('calculateHotScore — time decay', () => {
  it('older post scores lower than newer post with the same vote profile', () => {
    const scoreNew = calculateHotScore(50, 10, hoursAgo(1));
    const scoreOld = calculateHotScore(50, 10, hoursAgo(48));
    expect(scoreNew).toBeGreaterThan(scoreOld);
  });

  it('a very old post (7 days) has a negligible score even with strong upvotes', () => {
    // 7 days = 168 hours; decay = 0.5^(168/24) = 0.5^7 ≈ 0.0078
    const score = calculateHotScore(1000, 0, hoursAgo(168));
    expect(score).toBeLessThan(0.01);
  });

  it('a brand-new post (seconds old) retains most of its Wilson score', () => {
    // Nearly no decay for a post just created
    const score = calculateHotScore(10, 0, hoursAgo(0.001));
    // decay ≈ 1, Wilson score with 10/10 ratio should be close to 0.7+
    expect(score).toBeGreaterThan(0.5);
  });
});

describe('calculateHotScore — single vote', () => {
  it('returns a positive score for a single upvote', () => {
    const score = calculateHotScore(1, 0, hoursAgo(1));
    expect(score).toBeGreaterThan(0);
  });

  it('returns a near-zero score for a single downvote', () => {
    const score = calculateHotScore(0, 1, hoursAgo(1));
    expect(score).toBeCloseTo(0, 2);
  });
});

// ── sortByHot ─────────────────────────────────────────────────────────────────

describe('sortByHot', () => {
  it('returns an empty array unchanged', () => {
    expect(sortByHot([])).toEqual([]);
  });

  it('returns a single-item array unchanged', () => {
    const post = { upvotes: 10, downvotes: 2, createdAt: hoursAgo(1), id: 'p1' };
    const result = sortByHot([post]);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('p1');
  });

  it('sorts posts by hot score descending', () => {
    const posts = [
      // Low score: few votes, all old
      { upvotes: 5, downvotes: 5, createdAt: hoursAgo(100), id: 'low' },
      // High score: many upvotes, recent
      { upvotes: 100, downvotes: 5, createdAt: hoursAgo(1), id: 'high' },
      // Medium score: decent upvotes, moderate age
      { upvotes: 30, downvotes: 5, createdAt: hoursAgo(12), id: 'mid' },
    ];
    const result = sortByHot(posts);
    expect(result[0]!.id).toBe('high');
    expect(result[result.length - 1]!.id).toBe('low');
  });

  it('mutates and returns the same array reference', () => {
    const posts = [
      { upvotes: 5, downvotes: 0, createdAt: hoursAgo(10), id: 'a' },
      { upvotes: 50, downvotes: 0, createdAt: hoursAgo(1), id: 'b' },
    ];
    const ref = posts;
    const result = sortByHot(posts);
    expect(result).toBe(ref);
  });

  it('places zero-vote posts last (score = 0)', () => {
    const posts = [
      { upvotes: 0, downvotes: 0, createdAt: hoursAgo(1), id: 'zero' },
      { upvotes: 1, downvotes: 0, createdAt: hoursAgo(2), id: 'one-up' },
    ];
    const result = sortByHot(posts);
    expect(result[0]!.id).toBe('one-up');
    expect(result[1]!.id).toBe('zero');
  });

  it('handles posts where all have zero votes — order is stable or consistent', () => {
    const posts = [
      { upvotes: 0, downvotes: 0, createdAt: hoursAgo(1), id: 'a' },
      { upvotes: 0, downvotes: 0, createdAt: hoursAgo(2), id: 'b' },
    ];
    const result = sortByHot(posts);
    // All scores are 0, so the sort should not crash and return both items
    expect(result).toHaveLength(2);
  });
});
