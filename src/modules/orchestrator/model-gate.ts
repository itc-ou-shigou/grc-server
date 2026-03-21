import pino from "pino";
import { eq, and, inArray } from "drizzle-orm";
import { getDb } from "../../shared/db/connection.js";
import { aiModelKeysTable } from "../model-keys/schema.js";
import { nodesTable } from "../evolution/schema.js";

const logger = pino({ name: "module:orchestrator:model-gate" });

// ---------------------------------------------------------------------------
// Tier types
// ---------------------------------------------------------------------------

export type ModelTier = "S" | "A" | "B" | "C";

interface TierPattern {
  /** Lowercase provider identifier (e.g. "anthropic", "openai"). */
  provider: string;
  /**
   * Regex tested against the model name as returned by the key configuration.
   * All patterns are case-insensitive.
   */
  modelPattern: RegExp;
}

// ---------------------------------------------------------------------------
// Tier pattern tables
//
// Design spec (current):
//
// S-tier  — Best-in-class leaders capable of orchestrating a full swarm:
//           anthropic/claude-opus-*
//           anthropic/claude-sonnet-4*
//           openai/gpt-5*          (was gpt-4o in earlier specs)
//           openai/o1*, openai/o3*
//           google/gemini-2*-pro
//
// A-tier  — High-quality workers; also acceptable as leaders when S unavailable:
//           anthropic/claude-sonnet-3.5*, anthropic/claude-3.5*
//           openai/gpt-4o (non-mini), openai/gpt-4-turbo
//           google/gemini-1.5-pro
//           zai/glm-5*  (includes glm-5-turbo and future glm-5 variants)
//           moonshot/pony-alpha-2
//           gimi/gimi-2.7*, gimi/gimi-2.5*  (matched by range [5-9])
//
// B-tier  — Capable workers for non-critical subtasks:
//           anthropic/claude-haiku*
//           openai/gpt-4o-mini, openai/gpt-3.5*
//           google/gemini-*-flash
//           zai/glm-4*
//           gimi/gimi-2.1*
//
// C-tier  — Everything else (fallback, no multi-agent eligibility)
// ---------------------------------------------------------------------------

const S_TIER_PATTERNS: TierPattern[] = [
  { provider: "anthropic", modelPattern: /^claude-opus/i },
  { provider: "anthropic", modelPattern: /^claude-sonnet-4/i },
  { provider: "openai",    modelPattern: /^gpt-5/i },
  { provider: "openai",    modelPattern: /^o1/i },
  { provider: "openai",    modelPattern: /^o3/i },
  { provider: "google",    modelPattern: /^gemini-2.*-pro/i },
];

const A_TIER_PATTERNS: TierPattern[] = [
  // Anthropic
  { provider: "anthropic", modelPattern: /^claude-sonnet-3\.5/i },
  { provider: "anthropic", modelPattern: /^claude-3\.5/i },
  // OpenAI
  { provider: "openai",    modelPattern: /^gpt-4o(?!-mini)/i },
  { provider: "openai",    modelPattern: /^gpt-4-turbo/i },
  // Google
  { provider: "google",    modelPattern: /^gemini-1\.5-pro/i },
  // ZhipuAI — glm-5* covers glm-5, glm-5-turbo, and any future glm-5 variants
  { provider: "zai",       modelPattern: /^glm-5/i },
  // Moonshot
  { provider: "moonshot",  modelPattern: /^pony-alpha-2/i },
  // Gimi — 2.5* and 2.7* (minor version digits 5 through 9)
  { provider: "gimi",      modelPattern: /^gimi-2\.[5-9]/i },
];

const B_TIER_PATTERNS: TierPattern[] = [
  // Anthropic
  { provider: "anthropic", modelPattern: /^claude-haiku/i },
  // OpenAI
  { provider: "openai",    modelPattern: /^gpt-4o-mini/i },
  { provider: "openai",    modelPattern: /^gpt-3\.5/i },
  // Google
  { provider: "google",    modelPattern: /^gemini.*flash/i },
  // ZhipuAI — glm-4* covers glm-4, glm-4-plus, glm-4-air, etc.
  { provider: "zai",       modelPattern: /^glm-4/i },
  // Gimi — 2.1* only
  { provider: "gimi",      modelPattern: /^gimi-2\.1/i },
];

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * Classifies a provider/model combination into a quality tier.
 * Patterns are evaluated S → A → B; anything unmatched is C.
 */
export function classifyModelTier(provider: string, modelName: string): ModelTier {
  const p = provider.toLowerCase();

  for (const pat of S_TIER_PATTERNS) {
    if (p === pat.provider && pat.modelPattern.test(modelName)) return "S";
  }
  for (const pat of A_TIER_PATTERNS) {
    if (p === pat.provider && pat.modelPattern.test(modelName)) return "A";
  }
  for (const pat of B_TIER_PATTERNS) {
    if (p === pat.provider && pat.modelPattern.test(modelName)) return "B";
  }

  return "C";
}

// ---------------------------------------------------------------------------
// Gate evaluation
// ---------------------------------------------------------------------------

export interface ModelGateResult {
  passed: boolean;
  leaderTier: ModelTier | null;
  leaderNodeId: string | null;
  eligibleWorkers: Array<{ nodeId: string; tier: ModelTier; roleId: string }>;
  reason?: string;
}

/**
 * Determines whether the currently assigned and online nodes meet the quality
 * bar required to run a multi-agent session.
 *
 * Requirements:
 * - At least 3 distinct online nodes total.
 * - The assigned (leader) node must carry an S-tier model.
 * - At least 2 additional worker nodes must be A-tier or better.
 * - At least 2 distinct roles must be represented across all nodes.
 */
export async function evaluateModelGate(
  assignedNodeId: string | null,
  onlineNodeIds: string[],
): Promise<ModelGateResult> {
  const db = getDb();

  if (!assignedNodeId) {
    return {
      passed: false,
      leaderTier: null,
      leaderNodeId: null,
      eligibleWorkers: [],
      reason: "No assigned node",
    };
  }

  const allNodeIds = [...new Set([assignedNodeId, ...onlineNodeIds])];
  if (allNodeIds.length < 3) {
    return {
      passed: false,
      leaderTier: null,
      leaderNodeId: null,
      eligibleWorkers: [],
      reason: `Insufficient online nodes: ${allNodeIds.length} < 3`,
    };
  }

  const nodesWithKeys = await db
    .select({
      nodeId: nodesTable.nodeId,
      roleId: nodesTable.roleId,
      primaryKeyId: nodesTable.primaryKeyId,
      provider: aiModelKeysTable.provider,
      modelName: aiModelKeysTable.modelName,
    })
    .from(nodesTable)
    .leftJoin(
      aiModelKeysTable,
      and(
        eq(nodesTable.primaryKeyId, aiModelKeysTable.id),
        eq(aiModelKeysTable.isActive, 1),
      ),
    )
    .where(inArray(nodesTable.nodeId, allNodeIds));

  const classified = nodesWithKeys.map((n) => ({
    nodeId: n.nodeId,
    roleId: n.roleId ?? "unknown",
    tier: n.provider && n.modelName
      ? classifyModelTier(n.provider, n.modelName)
      : ("C" as ModelTier),
  }));

  // --- Leader check ---
  const leader = classified.find((n) => n.nodeId === assignedNodeId);
  if (!leader || leader.tier !== "S") {
    const leaderTier = leader?.tier ?? null;
    logger.debug(
      { assignedNodeId, leaderTier },
      "Model gate failed: leader does not meet S-tier requirement",
    );
    return {
      passed: false,
      leaderTier,
      leaderNodeId: assignedNodeId,
      eligibleWorkers: [],
      reason: `Leader node model tier is ${leaderTier ?? "unknown"}, requires S-tier`,
    };
  }

  // --- Worker check ---
  const eligibleWorkers = classified.filter(
    (n) => n.nodeId !== assignedNodeId && (n.tier === "S" || n.tier === "A"),
  );

  if (eligibleWorkers.length < 2) {
    logger.debug(
      { assignedNodeId, workerCount: eligibleWorkers.length },
      "Model gate failed: insufficient eligible workers",
    );
    return {
      passed: false,
      leaderTier: leader.tier,
      leaderNodeId: assignedNodeId,
      eligibleWorkers,
      reason: `Insufficient eligible workers: ${eligibleWorkers.length} < 2`,
    };
  }

  // --- Role diversity check ---
  const uniqueRoles = new Set(classified.map((n) => n.roleId));
  if (uniqueRoles.size < 2) {
    logger.debug(
      { assignedNodeId, uniqueRoles: uniqueRoles.size },
      "Model gate failed: insufficient role diversity",
    );
    return {
      passed: false,
      leaderTier: leader.tier,
      leaderNodeId: assignedNodeId,
      eligibleWorkers,
      reason: `Insufficient role diversity: ${uniqueRoles.size} < 2`,
    };
  }

  logger.info(
    {
      assignedNodeId,
      leaderTier: leader.tier,
      workerCount: eligibleWorkers.length,
      roles: [...uniqueRoles],
    },
    "Model gate passed",
  );

  return {
    passed: true,
    leaderTier: leader.tier,
    leaderNodeId: assignedNodeId,
    eligibleWorkers,
  };
}
