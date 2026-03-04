/**
 * Collaborative filtering utility functions.
 * NOTE: Currently not used by the recommender module which implements CF directly in SQL.
 * Retained for potential future use when in-memory CF is needed for smaller datasets.
 *
 * Generic Collaborative Filtering Utilities
 *
 * Reusable set-similarity and item-scoring primitives that can be
 * consumed by both the ClawHub recommender and the Evolution module.
 */

/**
 * Compute Jaccard similarity between two sets.
 * Returns 0 when both sets are empty.
 */
export function jaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 && setB.size === 0) return 0;
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Find the top-N most similar users based on item-interaction overlap.
 *
 * @param targetUserItems  Items the target user has interacted with.
 * @param allUserItems     Map from userId to their item sets.
 * @param topN             Maximum number of similar users to return.
 * @returns Sorted array (descending similarity) of { userId, similarity }.
 */
export function findSimilarUsers(
  targetUserItems: Set<string>,
  allUserItems: Map<string, Set<string>>,
  topN = 50,
): Array<{ userId: string; similarity: number }> {
  const similarities: Array<{ userId: string; similarity: number }> = [];

  for (const [userId, items] of allUserItems) {
    const sim = jaccardSimilarity(targetUserItems, items);
    if (sim > 0) {
      similarities.push({ userId, similarity: sim });
    }
  }

  return similarities
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topN);
}

/**
 * Score candidate items by weighted frequency among similar users.
 *
 * Each item's score is the sum of the similarity scores of the users
 * who interacted with it, excluding items the target user already has.
 *
 * @param similarUsers   Output of {@link findSimilarUsers}.
 * @param allUserItems   Map from userId to their item sets.
 * @param excludeItems   Items that should not appear in the result
 *                       (typically items the target already has).
 * @returns Map from item ID to its aggregated score.
 */
export function scoreItemsByFrequency(
  similarUsers: Array<{ userId: string; similarity: number }>,
  allUserItems: Map<string, Set<string>>,
  excludeItems: Set<string>,
): Map<string, number> {
  const scores = new Map<string, number>();

  for (const { userId, similarity } of similarUsers) {
    const items = allUserItems.get(userId);
    if (!items) continue;
    for (const item of items) {
      if (excludeItems.has(item)) continue;
      scores.set(item, (scores.get(item) ?? 0) + similarity);
    }
  }

  return scores;
}
