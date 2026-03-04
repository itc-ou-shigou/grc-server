/**
 * Unit tests for src/modules/community/voting.ts
 */

import { describe, it, expect } from 'vitest';
import {
  calculateVoteWeight,
  computeVoteDelta,
} from '../../../src/modules/community/voting.js';

// ── calculateVoteWeight ───────────────────────────────────────────────────────

describe('calculateVoteWeight — tier base weights', () => {
  it('returns 1 (base) for the free tier with 0 reputation', () => {
    expect(calculateVoteWeight('free', 0)).toBe(1);
  });

  it('returns 2 (base) for the contributor tier with 0 reputation', () => {
    expect(calculateVoteWeight('contributor', 0)).toBe(2);
  });

  it('returns 3 (base) for the pro tier with 0 reputation', () => {
    expect(calculateVoteWeight('pro', 0)).toBe(3);
  });

  it('returns 1 (fallback base) for an unknown tier with 0 reputation', () => {
    expect(calculateVoteWeight('enterprise', 0)).toBe(1);
  });

  it('returns 1 (fallback) for empty string tier with 0 reputation', () => {
    expect(calculateVoteWeight('', 0)).toBe(1);
  });
});

describe('calculateVoteWeight — reputation bonus', () => {
  it('adds 0 bonus for reputation 0–9', () => {
    expect(calculateVoteWeight('free', 9)).toBe(1.0);
  });

  it('adds 0.1 bonus for reputation 10', () => {
    expect(calculateVoteWeight('free', 10)).toBeCloseTo(1.1, 10);
  });

  it('adds 0.1 bonus for reputation 19 (floor(19/10) = 1)', () => {
    expect(calculateVoteWeight('free', 19)).toBeCloseTo(1.1, 10);
  });

  it('adds 0.2 bonus for reputation 20', () => {
    expect(calculateVoteWeight('free', 20)).toBeCloseTo(1.2, 10);
  });

  it('caps reputation bonus at 1.0 for very high reputation (>= 100)', () => {
    // floor(100/10) * 0.1 = 1.0, which equals the cap
    expect(calculateVoteWeight('free', 100)).toBeCloseTo(2.0, 10);
  });

  it('caps reputation bonus at 1.0 for reputation far above cap (1000)', () => {
    // Without cap this would be floor(1000/10)*0.1 = 10.0; capped at 1.0
    expect(calculateVoteWeight('free', 1000)).toBeCloseTo(2.0, 10);
  });

  it('combines tier weight and rep bonus correctly for pro + high rep', () => {
    // pro (3) + rep bonus capped at 1.0 = 4.0
    expect(calculateVoteWeight('pro', 500)).toBeCloseTo(4.0, 10);
  });

  it('combines contributor tier with partial reputation', () => {
    // contributor (2) + floor(50/10)*0.1 = 2 + 0.5 = 2.5
    expect(calculateVoteWeight('contributor', 50)).toBeCloseTo(2.5, 10);
  });

  it('weight is always at least 1.0 for any valid input', () => {
    expect(calculateVoteWeight('free', 0)).toBeGreaterThanOrEqual(1.0);
    expect(calculateVoteWeight('unknown-tier', 0)).toBeGreaterThanOrEqual(1.0);
  });
});

// ── computeVoteDelta ─────────────────────────────────────────────────────────

describe('computeVoteDelta — new upvote (no previous vote)', () => {
  it('adds weight to upDelta when casting a new upvote', () => {
    const delta = computeVoteDelta(2.0, 1, 0, 0);
    expect(delta.upDelta).toBeCloseTo(2.0, 10);
    expect(delta.downDelta).toBe(0);
  });
});

describe('computeVoteDelta — new downvote (no previous vote)', () => {
  it('adds weight to downDelta when casting a new downvote', () => {
    const delta = computeVoteDelta(2.0, -1, 0, 0);
    expect(delta.upDelta).toBe(0);
    expect(delta.downDelta).toBeCloseTo(2.0, 10);
  });
});

describe('computeVoteDelta — direction change: upvote to downvote', () => {
  it('removes old upvote weight and adds new downvote weight', () => {
    // Previously upvoted with weight 1.5, now downvoting with weight 2.0
    const delta = computeVoteDelta(2.0, -1, 1, 1.5);
    expect(delta.upDelta).toBeCloseTo(-1.5, 10);
    expect(delta.downDelta).toBeCloseTo(2.0, 10);
  });
});

describe('computeVoteDelta — direction change: downvote to upvote', () => {
  it('removes old downvote weight and adds new upvote weight', () => {
    // Previously downvoted with weight 1.0, now upvoting with weight 1.5
    const delta = computeVoteDelta(1.5, 1, -1, 1.0);
    expect(delta.upDelta).toBeCloseTo(1.5, 10);
    expect(delta.downDelta).toBeCloseTo(-1.0, 10);
  });
});

describe('computeVoteDelta — same direction (upvote again)', () => {
  it('removes old upvote weight and adds new upvote weight (re-vote)', () => {
    // Same direction re-cast with potentially different weight
    const delta = computeVoteDelta(2.5, 1, 1, 2.0);
    expect(delta.upDelta).toBeCloseTo(0.5, 10); // -2.0 + 2.5
    expect(delta.downDelta).toBe(0);
  });
});

describe('computeVoteDelta — same direction (downvote again)', () => {
  it('removes old downvote weight and adds new downvote weight', () => {
    const delta = computeVoteDelta(3.0, -1, -1, 2.0);
    expect(delta.upDelta).toBe(0);
    expect(delta.downDelta).toBeCloseTo(1.0, 10); // -2.0 + 3.0
  });
});

describe('computeVoteDelta — weight of 1.0 (minimum weight)', () => {
  it('produces correct deltas for the minimum vote weight', () => {
    const delta = computeVoteDelta(1.0, 1, 0, 0);
    expect(delta.upDelta).toBe(1.0);
    expect(delta.downDelta).toBe(0);
  });
});

describe('computeVoteDelta — fractional weights', () => {
  it('handles fractional weights correctly', () => {
    const delta = computeVoteDelta(1.3, -1, 1, 1.1);
    expect(delta.upDelta).toBeCloseTo(-1.1, 10);
    expect(delta.downDelta).toBeCloseTo(1.3, 10);
  });
});
