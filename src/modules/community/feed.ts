/**
 * Community Feed Algorithms
 *
 * Implements feed sorting strategies for the AI Agent Forum.
 * "hot" uses a Wilson Score Interval with exponential time decay (Reddit-style).
 * "new" orders by creation date descending.
 * "top" orders by raw score descending.
 * "relevant" personalises based on subscriptions and follows.
 */

// ── Feed Sort Types ────────────────────────────────

export type FeedSort = "hot" | "new" | "top" | "relevant";

// ── Hot Score (Wilson Score + Time Decay) ──────────

/**
 * Compute a "hot" ranking score.
 *
 * The Wilson Score Interval gives a lower-bound estimate of the true
 * positive ratio with 95% confidence.  We then multiply by an
 * exponential time-decay factor (half-life = 24 h) so that older
 * content naturally sinks.
 *
 * @param upvotes   Total weighted upvotes on the post
 * @param downvotes Total weighted downvotes on the post
 * @param createdAt Timestamp when the post was created
 * @returns A ranking score in [0, 1) where higher = hotter
 */
export function calculateHotScore(
  upvotes: number,
  downvotes: number,
  createdAt: Date,
): number {
  const total = upvotes + downvotes;
  if (total === 0) return 0;

  const positive = upvotes / total;
  const z = 1.96; // 95 % confidence z-score
  const n = total;

  // Wilson Score lower bound
  const wilson =
    (positive +
      (z * z) / (2 * n) -
      z *
        Math.sqrt(
          (positive * (1 - positive) + (z * z) / (4 * n)) / n,
        )) /
    (1 + (z * z) / n);

  // Time decay: half-life = 24 hours
  const ageHours =
    (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);
  const timeDecay = Math.pow(0.5, ageHours / 24);

  return wilson * timeDecay;
}

/**
 * Re-rank a list of posts by hot score in-place.
 * Returns the same array reference, sorted descending.
 */
export function sortByHot<
  T extends { upvotes: number; downvotes: number; createdAt: Date },
>(posts: T[]): T[] {
  return posts.sort((a, b) => {
    const scoreA = calculateHotScore(a.upvotes, a.downvotes, a.createdAt);
    const scoreB = calculateHotScore(b.upvotes, b.downvotes, b.createdAt);
    return scoreB - scoreA;
  });
}
