/**
 * Asset Scorer — Auto-promotion and auto-quarantine logic
 *
 * Evaluates an asset's usage statistics and determines whether it
 * should be promoted or quarantined based on configurable thresholds.
 */

import type { AssetStatus } from "../../shared/interfaces/evolution.interface.js";

/** Thresholds for automatic status transitions */
const PROMOTION_MIN_USE_COUNT = 10;
const PROMOTION_MIN_SUCCESS_RATE = 0.8;

const QUARANTINE_MIN_USE_COUNT = 5;
const QUARANTINE_MAX_SUCCESS_RATE = 0.3;

export interface PromotionCheckResult {
  shouldPromote: boolean;
  shouldQuarantine: boolean;
  reason: string;
}

/**
 * Evaluate whether an asset should be auto-promoted or auto-quarantined.
 *
 * Promotion: use_count >= 10 AND success_rate >= 0.8
 * Quarantine: use_count >= 5 AND success_rate < 0.3
 */
export function checkPromotion(asset: {
  status: AssetStatus;
  useCount: number;
  successRate: number;
}): PromotionCheckResult {
  // Already in a terminal state
  if (asset.status === "promoted") {
    return {
      shouldPromote: false,
      shouldQuarantine: false,
      reason: "Asset is already promoted",
    };
  }

  if (asset.status === "quarantined") {
    return {
      shouldPromote: false,
      shouldQuarantine: false,
      reason: "Asset is already quarantined",
    };
  }

  // Check quarantine condition first (safety takes precedence)
  if (
    asset.useCount >= QUARANTINE_MIN_USE_COUNT &&
    asset.successRate < QUARANTINE_MAX_SUCCESS_RATE
  ) {
    return {
      shouldPromote: false,
      shouldQuarantine: true,
      reason: `Auto-quarantine: success_rate ${(asset.successRate * 100).toFixed(1)}% below ${QUARANTINE_MAX_SUCCESS_RATE * 100}% threshold with ${asset.useCount} uses`,
    };
  }

  // Check promotion condition
  if (
    asset.useCount >= PROMOTION_MIN_USE_COUNT &&
    asset.successRate >= PROMOTION_MIN_SUCCESS_RATE
  ) {
    return {
      shouldPromote: true,
      shouldQuarantine: false,
      reason: `Auto-promote: success_rate ${(asset.successRate * 100).toFixed(1)}% meets ${PROMOTION_MIN_SUCCESS_RATE * 100}% threshold with ${asset.useCount} uses`,
    };
  }

  // Not enough data for either transition
  return {
    shouldPromote: false,
    shouldQuarantine: false,
    reason: `Insufficient data: ${asset.useCount} uses, ${(asset.successRate * 100).toFixed(1)}% success rate`,
  };
}
