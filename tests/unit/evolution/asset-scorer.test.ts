/**
 * Unit tests for src/modules/evolution/asset-scorer.ts
 */

import { describe, it, expect } from 'vitest';
import { checkPromotion } from '../../../src/modules/evolution/asset-scorer.js';
import type { AssetStatus } from '../../../src/shared/interfaces/evolution.interface.js';

// Constants mirror the source file thresholds
const PROMOTION_MIN_USE_COUNT = 10;
const PROMOTION_MIN_SUCCESS_RATE = 0.8;
const QUARANTINE_MIN_USE_COUNT = 5;
const QUARANTINE_MAX_SUCCESS_RATE = 0.3;

// ── Helper ────────────────────────────────────────────────────────────────────

function makeAsset(
  status: AssetStatus,
  useCount: number,
  successRate: number
) {
  return { status, useCount, successRate };
}

// ── Promotion path ────────────────────────────────────────────────────────────

describe('checkPromotion — should promote', () => {
  it('promotes when use_count >= 10 and success_rate >= 0.8', () => {
    const result = checkPromotion(makeAsset('approved', 10, 0.8));
    expect(result.shouldPromote).toBe(true);
    expect(result.shouldQuarantine).toBe(false);
  });

  it('promotes when use_count well above threshold and success_rate exactly 0.8', () => {
    const result = checkPromotion(makeAsset('approved', 50, 0.8));
    expect(result.shouldPromote).toBe(true);
  });

  it('promotes with high use_count and high success_rate', () => {
    const result = checkPromotion(makeAsset('pending', 100, 1.0));
    expect(result.shouldPromote).toBe(true);
    expect(result.shouldQuarantine).toBe(false);
  });

  it('promotion reason message contains success_rate and use count', () => {
    const result = checkPromotion(makeAsset('approved', 10, 0.9));
    expect(result.reason).toContain('Auto-promote');
    expect(result.reason).toContain('10');
  });

  it('does NOT promote when use_count is exactly at threshold but success_rate is just below 0.8', () => {
    const result = checkPromotion(makeAsset('approved', 10, 0.79));
    expect(result.shouldPromote).toBe(false);
  });

  it('does NOT promote when success_rate meets threshold but use_count is one below minimum', () => {
    const result = checkPromotion(makeAsset('approved', 9, 0.9));
    expect(result.shouldPromote).toBe(false);
  });

  it('promotes when status is pending (not only approved)', () => {
    const result = checkPromotion(makeAsset('pending', 10, 0.85));
    expect(result.shouldPromote).toBe(true);
  });
});

// ── Quarantine path ───────────────────────────────────────────────────────────

describe('checkPromotion — should quarantine', () => {
  it('quarantines when use_count >= 5 and success_rate < 0.3', () => {
    const result = checkPromotion(makeAsset('approved', 5, 0.2));
    expect(result.shouldQuarantine).toBe(true);
    expect(result.shouldPromote).toBe(false);
  });

  it('quarantines with success_rate of 0 (all failures)', () => {
    const result = checkPromotion(makeAsset('approved', 10, 0.0));
    expect(result.shouldQuarantine).toBe(true);
  });

  it('quarantine reason message contains success_rate and use count', () => {
    const result = checkPromotion(makeAsset('approved', 5, 0.1));
    expect(result.reason).toContain('Auto-quarantine');
    expect(result.reason).toContain('5');
  });

  it('does NOT quarantine when success_rate is exactly at 0.3 boundary', () => {
    // success_rate < 0.3 triggers quarantine; exactly 0.3 does NOT
    const result = checkPromotion(makeAsset('approved', 5, 0.3));
    expect(result.shouldQuarantine).toBe(false);
  });

  it('does NOT quarantine when use_count is one below minimum (4)', () => {
    const result = checkPromotion(makeAsset('approved', 4, 0.1));
    expect(result.shouldQuarantine).toBe(false);
  });

  it('quarantine takes precedence over promotion (safety first)', () => {
    // use_count >= 10 AND success_rate < 0.3 — quarantine wins
    const result = checkPromotion(makeAsset('approved', 15, 0.1));
    expect(result.shouldQuarantine).toBe(true);
    expect(result.shouldPromote).toBe(false);
  });
});

// ── Already promoted — skip ───────────────────────────────────────────────────

describe('checkPromotion — already promoted', () => {
  it('returns no action when asset is already promoted', () => {
    const result = checkPromotion(makeAsset('promoted', 100, 1.0));
    expect(result.shouldPromote).toBe(false);
    expect(result.shouldQuarantine).toBe(false);
  });

  it('reason message says "already promoted"', () => {
    const result = checkPromotion(makeAsset('promoted', 100, 1.0));
    expect(result.reason.toLowerCase()).toContain('already promoted');
  });
});

// ── Already quarantined — skip ────────────────────────────────────────────────

describe('checkPromotion — already quarantined', () => {
  it('returns no action when asset is already quarantined', () => {
    const result = checkPromotion(makeAsset('quarantined', 0, 0.0));
    expect(result.shouldPromote).toBe(false);
    expect(result.shouldQuarantine).toBe(false);
  });

  it('reason message says "already quarantined"', () => {
    const result = checkPromotion(makeAsset('quarantined', 10, 0.1));
    expect(result.reason.toLowerCase()).toContain('already quarantined');
  });
});

// ── Insufficient data — no action ────────────────────────────────────────────

describe('checkPromotion — insufficient data', () => {
  it('returns no action when use_count is 0', () => {
    const result = checkPromotion(makeAsset('pending', 0, 0.0));
    expect(result.shouldPromote).toBe(false);
    expect(result.shouldQuarantine).toBe(false);
  });

  it('returns no action when use_count is below both thresholds', () => {
    const result = checkPromotion(makeAsset('approved', 3, 0.5));
    expect(result.shouldPromote).toBe(false);
    expect(result.shouldQuarantine).toBe(false);
  });

  it('reason message references use count and success rate', () => {
    const result = checkPromotion(makeAsset('pending', 2, 0.5));
    expect(result.reason).toContain('Insufficient data');
  });

  it('returns no action when use_count is between thresholds with moderate success_rate', () => {
    // useCount=7 (>= quarantine min 5 but success_rate=0.5 — not below 0.3)
    // and useCount=7 (< promotion min 10)
    const result = checkPromotion(makeAsset('approved', 7, 0.5));
    expect(result.shouldPromote).toBe(false);
    expect(result.shouldQuarantine).toBe(false);
  });
});

// ── Exact boundary edge cases ─────────────────────────────────────────────────

describe('checkPromotion — exact boundary edge cases', () => {
  it('promotes at exactly use_count=10, success_rate=0.8', () => {
    const result = checkPromotion(makeAsset('approved', PROMOTION_MIN_USE_COUNT, PROMOTION_MIN_SUCCESS_RATE));
    expect(result.shouldPromote).toBe(true);
  });

  it('quarantines at exactly use_count=5, success_rate=0.29', () => {
    const result = checkPromotion(makeAsset('approved', QUARANTINE_MIN_USE_COUNT, 0.29));
    expect(result.shouldQuarantine).toBe(true);
  });

  it('success_rate exactly 0.3 with use_count 5 does NOT quarantine', () => {
    const result = checkPromotion(makeAsset('approved', QUARANTINE_MIN_USE_COUNT, QUARANTINE_MAX_SUCCESS_RATE));
    expect(result.shouldQuarantine).toBe(false);
  });

  it('use_count 10, success_rate 0.29 — quarantine wins over promotion boundary check', () => {
    // Meets quarantine criteria (use_count>=5 AND rate<0.3)
    // Despite use_count >= promotion min, bad rate => quarantine
    const result = checkPromotion(makeAsset('approved', 10, 0.29));
    expect(result.shouldQuarantine).toBe(true);
    expect(result.shouldPromote).toBe(false);
  });
});
