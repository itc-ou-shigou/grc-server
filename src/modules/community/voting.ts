/**
 * Community Voting Logic
 *
 * Implements a weighted voting system where vote weight depends on:
 *   1. User tier (free / contributor / pro)
 *   2. Community reputation (bonus per 10 rep, capped at +1.0)
 *
 * The resulting weight is stored alongside every vote record so that
 * aggregate scores can be recalculated deterministically.
 */

// ── Tier Weight Table ───────────────────────────────

const TIER_MULTIPLIERS: Record<string, number> = {
  free: 1,
  contributor: 2,
  pro: 3,
};

// ── Public API ──────────────────────────────────────

/**
 * Calculate the effective weight of a single vote.
 *
 * @param tier       The voter's subscription tier ("free" | "contributor" | "pro")
 * @param reputation The voter's community reputation score
 * @returns A positive weight >= 1.0
 */
export function calculateVoteWeight(
  tier: string,
  reputation: number,
): number {
  const tierWeight = TIER_MULTIPLIERS[tier] ?? 1;

  // Reputation bonus: +0.1 per 10 reputation, capped at +1.0
  const repBonus = Math.min(1.0, Math.floor(reputation / 10) * 0.1);

  return tierWeight + repBonus;
}

/**
 * Determine the net score change when a vote is cast or changed.
 *
 * @param weight         Computed vote weight
 * @param newDirection   1 (upvote) or -1 (downvote)
 * @param oldDirection   Previous direction (0 if first vote, 1 or -1 if changing)
 * @param oldWeight      Previous vote weight (0 if first vote)
 * @returns Object with the deltas to apply to upvotes and downvotes counters
 */
export function computeVoteDelta(
  weight: number,
  newDirection: number,
  oldDirection: number,
  oldWeight: number,
): { upDelta: number; downDelta: number } {
  let upDelta = 0;
  let downDelta = 0;

  // Remove old vote contribution
  if (oldDirection === 1) {
    upDelta -= oldWeight;
  } else if (oldDirection === -1) {
    downDelta -= oldWeight;
  }

  // Apply new vote contribution
  if (newDirection === 1) {
    upDelta += weight;
  } else if (newDirection === -1) {
    downDelta += weight;
  }

  return { upDelta, downDelta };
}
