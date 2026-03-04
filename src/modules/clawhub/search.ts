/**
 * ClawHub+ Module -- Meilisearch Integration
 *
 * Manages the `skills` search index for full-text search across
 * skill names, descriptions, and tags. Provides indexing and
 * query operations used by the service layer.
 */

import { MeiliSearch, type Index } from "meilisearch";
import pino from "pino";
import type { GrcConfig } from "../../config.js";

const logger = pino({ name: "module:clawhub:search" });

const INDEX_UID = "skills";

let meiliClient: MeiliSearch | null = null;
let skillsIndex: Index | null = null;

/**
 * Document shape stored in the Meilisearch index.
 * Fields are denormalized for search performance.
 */
export interface SkillSearchDocument {
  id: string;
  slug: string;
  name: string;
  description: string;
  tags: string[];
  author_id: string;
  status: string;
  download_count: number;
  rating_avg: number;
  created_at: number; // unix timestamp for sortable
}

/**
 * Initialize the Meilisearch client and configure the `skills` index.
 * Creates the index if it does not exist, then applies settings for
 * searchable, filterable, and sortable attributes.
 */
export async function initSearchIndex(config: GrcConfig["meilisearch"]): Promise<void> {
  meiliClient = new MeiliSearch({
    host: config.url,
    apiKey: config.apiKey,
  });

  // Create or get the index (primary key is `id`)
  try {
    const task = await meiliClient.createIndex(INDEX_UID, { primaryKey: "id" });
    await meiliClient.waitForTask(task.taskUid, { timeOutMs: 10_000 });
    logger.info("Created Meilisearch index: skills");
  } catch {
    // Index may already exist, which is fine
    logger.debug("Meilisearch index already exists or creation skipped");
  }

  skillsIndex = meiliClient.index(INDEX_UID);

  // Configure index settings
  const settingsTask = await skillsIndex.updateSettings({
    searchableAttributes: ["name", "description", "tags"],
    filterableAttributes: ["tags", "author_id", "status"],
    sortableAttributes: ["download_count", "rating_avg", "created_at"],
    rankingRules: [
      "words",
      "typo",
      "proximity",
      "attribute",
      "sort",
      "exactness",
    ],
  });

  await meiliClient.waitForTask(settingsTask.taskUid, { timeOutMs: 10_000 });
  logger.info("Meilisearch index settings updated");
}

/**
 * Get the initialized skills index. Throws if not initialized.
 */
function getIndex(): Index {
  if (!skillsIndex) {
    throw new Error("Meilisearch not initialized. Call initSearchIndex() first.");
  }
  return skillsIndex;
}

/**
 * Add or update a skill document in the search index.
 */
export async function indexSkill(skill: SkillSearchDocument): Promise<void> {
  const idx = getIndex();
  const task = await idx.addDocuments([skill]);
  // Fire and forget -- do not block on indexing
  logger.debug({ skillId: skill.id, taskUid: task.taskUid }, "Skill indexed");
}

/**
 * Search for skills using full-text search with optional filters and sorting.
 *
 * @param query - The search query string
 * @param filters - Meilisearch filter expression (e.g., 'tags = "automation"')
 * @param sort - Sort expressions (e.g., ["download_count:desc"])
 * @param limit - Maximum results to return
 * @param offset - Number of results to skip
 * @returns Object with matching skill IDs and estimated total hits
 */
export async function searchSkills(
  query: string,
  filters?: string,
  sort?: string[],
  limit = 20,
  offset = 0,
): Promise<{ ids: string[]; totalHits: number }> {
  const idx = getIndex();

  const result = await idx.search<SkillSearchDocument>(query, {
    filter: filters,
    sort,
    limit,
    offset,
    attributesToRetrieve: ["id"],
  });

  const ids = result.hits.map((hit) => hit.id);
  const totalHits =
    typeof result.estimatedTotalHits === "number"
      ? result.estimatedTotalHits
      : result.hits.length;

  return { ids, totalHits };
}

/**
 * Remove a skill document from the search index.
 */
export async function removeSkill(skillId: string): Promise<void> {
  const idx = getIndex();
  const task = await idx.deleteDocument(skillId);
  logger.debug({ skillId, taskUid: task.taskUid }, "Skill removed from index");
}
