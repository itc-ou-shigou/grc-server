/**
 * Evolution Service — IEvolutionService implementation
 *
 * Handles Gene/Capsule CRUD, usage reporting, quality management,
 * and node registration for the A2A Protocol.
 */

import { v4 as uuidv4 } from "uuid";
import { eq, or, sql, desc, and, gte } from "drizzle-orm";
import pino from "pino";
import { getDb } from "../../shared/db/connection.js";
import {
  nodesTable,
  genesTable,
  capsulesTable,
  assetReportsTable,
  evolutionEventsTable,
} from "./schema.js";
import { scanPayload } from "./content-safety.js";
import { checkPromotion } from "./asset-scorer.js";
import type {
  IEvolutionService,
  IEvolutionAsset,
  IEvolutionSearchParams,
  AssetStatus,
  AssetType,
} from "../../shared/interfaces/evolution.interface.js";
import {
  BadRequestError,
  NotFoundError,
  ConflictError,
  ForbiddenError,
} from "../../shared/middleware/error-handler.js";

const logger = pino({ name: "module:evolution:service" });

// ── Helper: map a DB row to IEvolutionAsset ─────

function rowToAsset(
  row: Record<string, unknown>,
  type: AssetType,
): IEvolutionAsset {
  return {
    id: row.id as string,
    assetId: row.assetId as string,
    type,
    nodeId: row.nodeId as string,
    userId: (row.userId as string) ?? undefined,
    category: (row.category as string) ?? undefined,
    status: row.status as AssetStatus,
    signalsMatch: (row.signalsMatch as string[] | null) ?? [],
    contentHash: row.contentHash as string,
    signature: (row.signature as string) ?? undefined,
    useCount: row.useCount as number,
    failCount: (row.failCount as number) ?? 0,
    successRate: row.successRate as number,
    safetyScore: (row.safetyScore as number) ?? undefined,
    chainId: (row.chainId as string) ?? undefined,
    schemaVersion: (row.schemaVersion as string) ?? undefined,
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
  };
}

function rowToAssetSummary(
  row: Record<string, unknown>,
  type: AssetType,
): IEvolutionAsset {
  return {
    id: row.id as string,
    assetId: row.assetId as string,
    type,
    nodeId: row.nodeId as string,
    userId: (row.userId as string) ?? undefined,
    category: (row.category as string) ?? undefined,
    status: row.status as AssetStatus,
    signalsMatch: (row.signalsMatch as string[] | null) ?? [],
    contentHash: row.contentHash as string,
    signature: (row.signature as string) ?? undefined,
    useCount: row.useCount as number,
    failCount: (row.failCount as number) ?? 0,
    successRate: row.successRate as number,
    safetyScore: (row.safetyScore as number) ?? undefined,
    chainId: (row.chainId as string) ?? undefined,
    schemaVersion: (row.schemaVersion as string) ?? undefined,
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
  };
}

// ── Node Operations ─────────────────────────────

export async function upsertNode(params: {
  nodeId: string;
  capabilities?: Record<string, unknown>;
  geneCount?: number;
  capsuleCount?: number;
  envFingerprint?: string;
  platform?: string;
  winclawVersion?: string;
  displayName?: string;
}): Promise<Record<string, unknown>> {
  const db = getDb();
  const now = new Date();

  // Check if node exists
  const existing = await db
    .select()
    .from(nodesTable)
    .where(eq(nodesTable.nodeId, params.nodeId))
    .limit(1);

  if (existing.length > 0) {
    // Update heartbeat and optional fields
    await db
      .update(nodesTable)
      .set({
        lastHeartbeat: now,
        ...(params.capabilities !== undefined && {
          capabilities: params.capabilities,
        }),
        ...(params.geneCount !== undefined && {
          geneCount: params.geneCount,
        }),
        ...(params.capsuleCount !== undefined && {
          capsuleCount: params.capsuleCount,
        }),
        ...(params.envFingerprint !== undefined && {
          envFingerprint: params.envFingerprint,
        }),
        ...(params.platform !== undefined && {
          platform: params.platform,
        }),
        ...(params.winclawVersion !== undefined && {
          winclawVersion: params.winclawVersion,
        }),
        ...(params.displayName !== undefined && {
          displayName: params.displayName,
        }),
      })
      .where(eq(nodesTable.nodeId, params.nodeId));

    const updated = await db
      .select()
      .from(nodesTable)
      .where(eq(nodesTable.nodeId, params.nodeId))
      .limit(1);

    return updated[0] as unknown as Record<string, unknown>;
  }

  // Insert new node
  const id = uuidv4();
  await db.insert(nodesTable).values({
    id,
    nodeId: params.nodeId,
    lastHeartbeat: now,
    capabilities: params.capabilities ?? null,
    geneCount: params.geneCount ?? 0,
    capsuleCount: params.capsuleCount ?? 0,
    envFingerprint: params.envFingerprint ?? null,
    platform: params.platform ?? null,
    winclawVersion: params.winclawVersion ?? null,
    displayName: params.displayName ?? null,
  });

  const created = await db
    .select()
    .from(nodesTable)
    .where(eq(nodesTable.id, id))
    .limit(1);

  logger.info({ nodeId: params.nodeId }, "New node registered");
  return created[0] as unknown as Record<string, unknown>;
}

// ── Evolution Service Implementation ────────────

export class EvolutionService implements IEvolutionService {
  /**
   * Publish a new Gene or Capsule.
   * Runs content safety scan and sets initial status.
   */
  async publishAsset(params: {
    nodeId: string;
    assetType: AssetType;
    assetId: string;
    contentHash: string;
    payload: Record<string, unknown>;
    signature?: string;
    userId?: string;
    category?: string;
    schemaVersion?: string;
  }): Promise<IEvolutionAsset> {
    const db = getDb();

    // Content safety scan
    const scanResult = scanPayload(params.payload);
    const initialStatus: AssetStatus = scanResult.safe
      ? "approved"
      : "quarantined";

    if (!scanResult.safe) {
      logger.warn(
        { assetId: params.assetId, reasons: scanResult.reasons },
        "Content safety scan failed — asset quarantined",
      );
    }

    const id = uuidv4();
    const table =
      params.assetType === "gene" ? genesTable : capsulesTable;

    // Extract signals from payload if present (genes have signals_match)
    const signalsMatch =
      params.assetType === "gene"
        ? (params.payload.signals_match as string[]) ??
          (params.payload.signalsMatch as string[]) ??
          []
        : [];

    const strategy =
      params.assetType === "gene"
        ? (params.payload.strategy as Record<string, unknown>) ?? null
        : undefined;

    try {
      if (params.assetType === "gene") {
        await db.insert(genesTable).values({
          id,
          assetId: params.assetId,
          nodeId: params.nodeId,
          userId: params.userId ?? null,
          category: params.category ?? null,
          contentHash: params.contentHash,
          signature: params.signature ?? null,
          status: initialStatus,
          signalsMatch,
          strategy: strategy ?? null,
          constraintsData: (params.payload.constraints_data as Record<string, unknown>) ?? null,
          validation: (params.payload.validation as Record<string, unknown>) ?? null,
          schemaVersion: typeof params.schemaVersion === "number" ? params.schemaVersion : 1,
          useCount: 0,
          failCount: 0,
          successRate: 0,
        });
      } else {
        await db.insert(capsulesTable).values({
          id,
          assetId: params.assetId,
          nodeId: params.nodeId,
          userId: params.userId ?? null,
          contentHash: params.contentHash,
          signature: params.signature ?? null,
          status: initialStatus,
          schemaVersion: typeof params.schemaVersion === "number" ? params.schemaVersion : 1,
          useCount: 0,
          successRate: 0,
          successStreak: 0,
        });
      }
    } catch (err: unknown) {
      const error = err as { code?: string };
      if (error.code === "ER_DUP_ENTRY") {
        throw new ConflictError(
          `Asset with id '${params.assetId}' already exists`,
        );
      }
      throw err;
    }

    // Log evolution event
    await db.insert(evolutionEventsTable).values({
      id: uuidv4(),
      assetId: params.assetId,
      assetType: params.assetType,
      eventType: "published",
      nodeId: params.nodeId,
      details: scanResult.safe
        ? { status: initialStatus }
        : { status: initialStatus, safety_reasons: scanResult.reasons },
    });

    logger.info(
      {
        assetId: params.assetId,
        type: params.assetType,
        status: initialStatus,
      },
      "Asset published",
    );

    // Fetch and return the created asset
    const rows = await db
      .select()
      .from(table)
      .where(eq(table.assetId, params.assetId))
      .limit(1);

    return rowToAsset(
      rows[0] as unknown as Record<string, unknown>,
      params.assetType,
    );
  }

  /**
   * Fetch an asset by asset_id or content_hash.
   * Increments use_count on successful fetch.
   */
  async fetchAsset(
    assetIdOrHash: string,
  ): Promise<IEvolutionAsset | null> {
    const db = getDb();

    // Search genes first
    const geneRows = await db
      .select()
      .from(genesTable)
      .where(
        or(
          eq(genesTable.assetId, assetIdOrHash),
          eq(genesTable.contentHash, assetIdOrHash),
        ),
      )
      .limit(1);

    if (geneRows.length > 0) {
      // Block quarantined assets from being fetched/downloaded
      if (geneRows[0]!.status === "quarantined") {
        logger.warn({ assetId: assetIdOrHash }, "Blocked fetch of quarantined gene");
        return null;
      }

      // Increment use_count
      await db
        .update(genesTable)
        .set({ useCount: sql`${genesTable.useCount} + 1` })
        .where(eq(genesTable.id, geneRows[0]!.id));

      const row = geneRows[0] as unknown as Record<string, unknown>;
      return rowToAsset(
        { ...row, useCount: (row.useCount as number) + 1 },
        "gene",
      );
    }

    // Search capsules
    const capsuleRows = await db
      .select()
      .from(capsulesTable)
      .where(
        or(
          eq(capsulesTable.assetId, assetIdOrHash),
          eq(capsulesTable.contentHash, assetIdOrHash),
        ),
      )
      .limit(1);

    if (capsuleRows.length > 0) {
      // Block quarantined assets from being fetched/downloaded
      if (capsuleRows[0]!.status === "quarantined") {
        logger.warn({ assetId: assetIdOrHash }, "Blocked fetch of quarantined capsule");
        return null;
      }

      await db
        .update(capsulesTable)
        .set({ useCount: sql`${capsulesTable.useCount} + 1` })
        .where(eq(capsulesTable.id, capsuleRows[0]!.id));

      const row = capsuleRows[0] as unknown as Record<string, unknown>;
      return rowToAsset(
        { ...row, useCount: (row.useCount as number) + 1 },
        "capsule",
      );
    }

    return null;
  }

  /**
   * Search assets with optional filters.
   * Returns assets without full payload for list views.
   */
  async searchAssets(
    params: IEvolutionSearchParams,
  ): Promise<{ assets: IEvolutionAsset[]; total: number }> {
    const db = getDb();
    const limit = params.limit ?? 20;
    const offset = params.offset ?? 0;
    const results: IEvolutionAsset[] = [];

    const shouldSearchGenes =
      !params.type || params.type === "gene";
    const shouldSearchCapsules =
      !params.type || params.type === "capsule";

    let totalGenes = 0;
    let totalCapsules = 0;

    if (shouldSearchGenes) {
      // Build gene where conditions
      const geneConditions = [];
      if (params.status) {
        geneConditions.push(eq(genesTable.status, params.status));
      } else {
        // Exclude quarantined by default for A2A search
        geneConditions.push(sql`${genesTable.status} != 'quarantined'`);
      }
      if ((params as Record<string, unknown>).category) {
        geneConditions.push(
          eq(genesTable.category, (params as Record<string, unknown>).category as string),
        );
      }

      const geneWhere =
        geneConditions.length > 0 ? and(...geneConditions) : sql`1=1`;

      // Count total
      const countResult = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(genesTable)
        .where(geneWhere);
      totalGenes = Number(countResult[0]?.count ?? 0);

      // Fetch rows
      const geneRows = await db
        .select()
        .from(genesTable)
        .where(geneWhere)
        .orderBy(desc(genesTable.updatedAt))
        .limit(limit)
        .offset(offset);

      for (const row of geneRows) {
        const r = row as unknown as Record<string, unknown>;
        // Filter by signals if specified
        if (params.signals && params.signals.length > 0) {
          const assetSignals =
            (r.signalsMatch as string[] | null) ?? [];
          const hasMatch = params.signals.some((s) =>
            assetSignals.includes(s),
          );
          if (!hasMatch) continue;
        }
        results.push(rowToAssetSummary(r, "gene"));
      }
    }

    if (shouldSearchCapsules) {
      const capsuleConditions = [];
      if (params.status) {
        capsuleConditions.push(eq(capsulesTable.status, params.status));
      } else {
        // Exclude quarantined by default for A2A search
        capsuleConditions.push(sql`${capsulesTable.status} != 'quarantined'`);
      }

      const capsuleWhere =
        capsuleConditions.length > 0 ? and(...capsuleConditions) : sql`1=1`;

      const countResult = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(capsulesTable)
        .where(capsuleWhere);
      totalCapsules = Number(countResult[0]?.count ?? 0);

      const capsuleRows = await db
        .select()
        .from(capsulesTable)
        .where(capsuleWhere)
        .orderBy(desc(capsulesTable.updatedAt))
        .limit(limit)
        .offset(offset);

      for (const row of capsuleRows) {
        const r = row as unknown as Record<string, unknown>;
        results.push(rowToAssetSummary(r, "capsule"));
      }
    }

    return {
      assets: results,
      total: totalGenes + totalCapsules,
    };
  }

  /**
   * Record a usage report and update the asset's success metrics.
   * Triggers auto-promotion/quarantine check.
   */
  async reportUsage(assetId: string, success: boolean): Promise<void> {
    await this.reportUsageFull({
      assetId,
      reporterNodeId: "system",
      success,
    });
  }

  /**
   * Full usage report with reporter info and optional data.
   */
  async reportUsageFull(params: {
    assetId: string;
    reporterNodeId: string;
    success: boolean;
    reportData?: Record<string, unknown>;
    reporterUserId?: string;
  }): Promise<{ asset: IEvolutionAsset; promotionResult: ReturnType<typeof checkPromotion> }> {
    const db = getDb();

    // Determine asset type and table
    const geneRows = await db
      .select()
      .from(genesTable)
      .where(eq(genesTable.assetId, params.assetId))
      .limit(1);

    let assetType: AssetType;
    let table: typeof genesTable | typeof capsulesTable;
    let currentRow: Record<string, unknown>;

    if (geneRows.length > 0) {
      assetType = "gene";
      table = genesTable;
      currentRow = geneRows[0] as unknown as Record<string, unknown>;
    } else {
      const capsuleRows = await db
        .select()
        .from(capsulesTable)
        .where(eq(capsulesTable.assetId, params.assetId))
        .limit(1);

      if (capsuleRows.length === 0) {
        throw new NotFoundError("Asset");
      }

      assetType = "capsule";
      table = capsulesTable;
      currentRow = capsuleRows[0] as unknown as Record<string, unknown>;
    }

    // Insert the report with new column names
    await db.insert(assetReportsTable).values({
      id: uuidv4(),
      assetId: params.assetId,
      assetType,
      reporterNodeId: params.reporterNodeId,
      reporterUserId: params.reporterUserId ?? null,
      reportType: params.success ? "success" : "failure",
      details: params.reportData ?? null,
    });

    // Use atomic SQL increment to prevent race conditions when
    // multiple nodes report usage concurrently.
    // failCount is incremented on failure, useCount always incremented.
    const failIncrement = params.success ? 0 : 1;
    await db
      .update(table)
      .set({
        useCount: sql`${table.useCount} + 1`,
        ...(assetType === "gene"
          ? { failCount: sql`${(table as typeof genesTable).failCount} + ${failIncrement}` }
          : {}),
        successRate: sql`CASE WHEN (${table.useCount} + 1) > 0 THEN (${table.useCount} + 1 - ${assetType === "gene" ? sql`${(table as typeof genesTable).failCount} + ${failIncrement}` : sql`0`}) / (${table.useCount} + 1) ELSE 0 END`,
      })
      .where(eq(table.assetId, params.assetId));

    // Re-read for accurate values after atomic update
    const refreshedRows = await db
      .select()
      .from(table)
      .where(eq(table.assetId, params.assetId))
      .limit(1);
    const refreshedRow = refreshedRows[0] as unknown as Record<string, unknown>;
    const newUseCount = refreshedRow.useCount as number;
    const newSuccessRate = refreshedRow.successRate as number;

    // Check auto-promotion/quarantine
    const promotionResult = checkPromotion({
      status: currentRow.status as AssetStatus,
      useCount: newUseCount,
      successRate: newSuccessRate,
    });

    if (promotionResult.shouldPromote) {
      await this.updateStatus(params.assetId, "promoted", promotionResult.reason);
    } else if (promotionResult.shouldQuarantine) {
      await this.updateStatus(
        params.assetId,
        "quarantined",
        promotionResult.reason,
      );
    }

    // Fetch updated asset
    const updatedRows = await db
      .select()
      .from(table)
      .where(eq(table.assetId, params.assetId))
      .limit(1);

    const asset = rowToAsset(
      updatedRows[0] as unknown as Record<string, unknown>,
      assetType,
    );

    return { asset, promotionResult };
  }

  /**
   * Get trending assets (most used in the last 7 days).
   */
  async getTrending(limit = 10): Promise<IEvolutionAsset[]> {
    const db = getDb();
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // Query genes sorted by use_count, filtered by recent updates
    const geneRows = await db
      .select()
      .from(genesTable)
      .where(
        and(
          gte(genesTable.updatedAt, sevenDaysAgo),
          or(
            eq(genesTable.status, "approved"),
            eq(genesTable.status, "promoted"),
          ),
        ),
      )
      .orderBy(desc(genesTable.useCount))
      .limit(limit);

    const capsuleRows = await db
      .select()
      .from(capsulesTable)
      .where(
        and(
          gte(capsulesTable.updatedAt, sevenDaysAgo),
          or(
            eq(capsulesTable.status, "approved"),
            eq(capsulesTable.status, "promoted"),
          ),
        ),
      )
      .orderBy(desc(capsulesTable.useCount))
      .limit(limit);

    const allAssets: IEvolutionAsset[] = [];

    for (const row of geneRows) {
      allAssets.push(
        rowToAsset(
          row as unknown as Record<string, unknown>,
          "gene",
        ),
      );
    }
    for (const row of capsuleRows) {
      allAssets.push(
        rowToAsset(
          row as unknown as Record<string, unknown>,
          "capsule",
        ),
      );
    }

    // Sort combined results by use_count descending, take top N
    allAssets.sort((a, b) => b.useCount - a.useCount);
    return allAssets.slice(0, limit);
  }

  /**
   * Update asset status (admin decision or auto-promotion).
   */
  async updateStatus(
    assetId: string,
    status: AssetStatus,
    reason?: string,
  ): Promise<void> {
    const db = getDb();

    // Build the update set — include promotedAt if status is "promoted"
    const updateSet: Record<string, unknown> = { status };
    if (status === "promoted") {
      updateSet.promotedAt = new Date();
    }

    // Try genes first
    const geneUpdate = await db
      .update(genesTable)
      .set(updateSet as { status: string; promotedAt?: Date })
      .where(eq(genesTable.assetId, assetId));

    const geneAffected =
      (geneUpdate as unknown as [{ affectedRows: number }])[0]
        ?.affectedRows ?? 0;

    let assetType: AssetType = "gene";

    if (geneAffected === 0) {
      const capsuleUpdate = await db
        .update(capsulesTable)
        .set(updateSet as { status: string; promotedAt?: Date })
        .where(eq(capsulesTable.assetId, assetId));

      const capsuleAffected =
        (capsuleUpdate as unknown as [{ affectedRows: number }])[0]
          ?.affectedRows ?? 0;

      if (capsuleAffected === 0) {
        throw new NotFoundError("Asset");
      }
      assetType = "capsule";
    }

    // Log evolution event
    await db.insert(evolutionEventsTable).values({
      id: uuidv4(),
      assetId,
      assetType,
      eventType: status,
      nodeId: null,
      details: reason ? { reason } : null,
    });

    logger.info({ assetId, status, reason }, "Asset status updated");
  }

  /**
   * Revoke a published asset. Only the original publisher can revoke.
   */
  async revokeAsset(assetId: string, nodeId: string): Promise<void> {
    const db = getDb();

    // Try genes
    const geneRows = await db
      .select()
      .from(genesTable)
      .where(eq(genesTable.assetId, assetId))
      .limit(1);

    if (geneRows.length > 0) {
      if (geneRows[0]!.nodeId !== nodeId) {
        throw new ForbiddenError(
          "Only the publisher can revoke an asset",
        );
      }

      await db
        .delete(genesTable)
        .where(eq(genesTable.assetId, assetId));

      await db.insert(evolutionEventsTable).values({
        id: uuidv4(),
        assetId,
        assetType: "gene",
        eventType: "revoked",
        nodeId: nodeId,
        details: null,
      });

      logger.info({ assetId, nodeId }, "Gene revoked");
      return;
    }

    // Try capsules
    const capsuleRows = await db
      .select()
      .from(capsulesTable)
      .where(eq(capsulesTable.assetId, assetId))
      .limit(1);

    if (capsuleRows.length === 0) {
      throw new NotFoundError("Asset");
    }

    if (capsuleRows[0]!.nodeId !== nodeId) {
      throw new ForbiddenError(
        "Only the publisher can revoke an asset",
      );
    }

    await db
      .delete(capsulesTable)
      .where(eq(capsulesTable.assetId, assetId));

    await db.insert(evolutionEventsTable).values({
      id: uuidv4(),
      assetId,
      assetType: "capsule",
      eventType: "revoked",
      nodeId: nodeId,
      details: null,
    });

    logger.info({ assetId, nodeId }, "Capsule revoked");
  }

  /**
   * Get aggregate statistics for the Evolution Pool.
   */
  async getStats(): Promise<{
    totalGenes: number;
    totalCapsules: number;
    promotedCount: number;
    activeNodes: number;
  }> {
    const db = getDb();

    const [geneCount] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(genesTable);

    const [capsuleCount] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(capsulesTable);

    const [promotedGenes] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(genesTable)
      .where(eq(genesTable.status, "promoted"));

    const [promotedCapsules] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(capsulesTable)
      .where(eq(capsulesTable.status, "promoted"));

    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

    const [activeNodesResult] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(nodesTable)
      .where(gte(nodesTable.lastHeartbeat, twentyFourHoursAgo));

    return {
      totalGenes: Number(geneCount?.count ?? 0),
      totalCapsules: Number(capsuleCount?.count ?? 0),
      promotedCount:
        Number(promotedGenes?.count ?? 0) +
        Number(promotedCapsules?.count ?? 0),
      activeNodes: Number(activeNodesResult?.count ?? 0),
    };
  }
}
