/**
 * Evolution Service — IEvolutionService implementation
 *
 * Handles Gene/Capsule CRUD, usage reporting, quality management,
 * and node registration for the A2A Protocol.
 */

import { v4 as uuidv4 } from "uuid";
import { eq, or, sql, desc, and, gte, lte, ne } from "drizzle-orm";
import pino from "pino";
import { getDb, safeTransaction } from "../../shared/db/connection.js";
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
import { getCurrentDialect } from "../../shared/db/dialect.js";

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
    signalsMatch: Array.isArray(row.signalsMatch)
      ? row.signalsMatch as string[]
      : typeof row.signalsMatch === 'string'
        ? (() => { try { const p = JSON.parse(row.signalsMatch); return Array.isArray(p) ? p : []; } catch { return []; } })()
        : [],
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
  employeeId?: string;
  employeeName?: string;
  employeeEmail?: string;
  workspacePath?: string;
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
        ...(params.employeeId !== undefined && {
          employeeId: params.employeeId,
        }),
        ...(params.employeeName !== undefined && {
          employeeName: params.employeeName,
        }),
        ...(params.employeeEmail !== undefined && {
          employeeEmail: params.employeeEmail,
        }),
        ...(params.workspacePath !== undefined && {
          workspacePath: params.workspacePath,
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

  // Insert new node — wrapped in try-catch to handle duplicate key from concurrent requests
  const id = uuidv4();
  try {
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
      employeeId: params.employeeId ?? null,
      employeeName: params.employeeName ?? null,
      employeeEmail: params.employeeEmail ?? null,
      workspacePath: params.workspacePath ?? null,
    });
  } catch (err: unknown) {
    // Handle duplicate key — another concurrent request beat us
    if (err && typeof err === "object" && "code" in err && (err as any).code === "ER_DUP_ENTRY") {
      logger.info({ nodeId: params.nodeId }, "Duplicate node insert detected — falling back to update");
      // Update instead
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
          ...(params.employeeId !== undefined && {
            employeeId: params.employeeId,
          }),
          ...(params.employeeName !== undefined && {
            employeeName: params.employeeName,
          }),
          ...(params.employeeEmail !== undefined && {
            employeeEmail: params.employeeEmail,
          }),
          ...(params.workspacePath !== undefined && {
            workspacePath: params.workspacePath,
          }),
        })
        .where(eq(nodesTable.nodeId, params.nodeId));

      const fallbackRow = await db
        .select()
        .from(nodesTable)
        .where(eq(nodesTable.nodeId, params.nodeId))
        .limit(1);

      return fallbackRow[0] as unknown as Record<string, unknown>;
    }
    throw err;
  }

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
   * Pure read -- does not modify the asset. Use recordAssetFetch()
   * separately to increment use_count when appropriate.
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

      const row = geneRows[0] as unknown as Record<string, unknown>;
      return rowToAsset(row, "gene");
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

      const row = capsuleRows[0] as unknown as Record<string, unknown>;
      return rowToAsset(row, "capsule");
    }

    return null;
  }

  /**
   * Record that an asset was fetched (increment use_count).
   * Should be called from the A2A fetch endpoint only, not from
   * internal reads, to avoid inflating usage counters.
   */
  async recordAssetFetch(assetIdOrHash: string): Promise<void> {
    const db = getDb();

    // Try genes first
    const geneRows = await db
      .select({ id: genesTable.id })
      .from(genesTable)
      .where(
        or(
          eq(genesTable.assetId, assetIdOrHash),
          eq(genesTable.contentHash, assetIdOrHash),
        ),
      )
      .limit(1);

    if (geneRows.length > 0) {
      await db
        .update(genesTable)
        .set({ useCount: sql`${genesTable.useCount} + 1` })
        .where(eq(genesTable.id, geneRows[0]!.id));
      return;
    }

    // Try capsules
    const capsuleRows = await db
      .select({ id: capsulesTable.id })
      .from(capsulesTable)
      .where(
        or(
          eq(capsulesTable.assetId, assetIdOrHash),
          eq(capsulesTable.contentHash, assetIdOrHash),
        ),
      )
      .limit(1);

    if (capsuleRows.length > 0) {
      await db
        .update(capsulesTable)
        .set({ useCount: sql`${capsulesTable.useCount} + 1` })
        .where(eq(capsulesTable.id, capsuleRows[0]!.id));
    }
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
    const hasSignalFilter = params.signals && params.signals.length > 0;

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

      // Dialect-aware: MySQL uses JSON_CONTAINS, SQLite uses json_each
      if (hasSignalFilter) {
        const dialect = getCurrentDialect();
        const signalConditions = params.signals!.map((sig) =>
          dialect === "mysql"
            ? sql`JSON_CONTAINS(${genesTable.signalsMatch}, ${JSON.stringify(sig)})`
            : sql`EXISTS (SELECT 1 FROM json_each(${genesTable.signalsMatch}) WHERE value = ${sig})`,
        );
        if (signalConditions.length === 1) {
          geneConditions.push(signalConditions[0]!);
        } else {
          geneConditions.push(sql`(${sql.join(signalConditions, sql` OR `)})`);
        }
      }

      const geneWhere =
        geneConditions.length > 0 ? and(...geneConditions) : sql`1=1`;

      // Count total
      const countResult = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(genesTable)
        .where(geneWhere);
      totalGenes = Number(countResult[0]?.count ?? 0);

      if (hasSignalFilter) {
        // When signals are provided, score genes by number of matching signals
        // and sort by score descending (best matches first)
        // Dialect-aware: MySQL uses IFNULL+JSON_CONTAINS, SQLite uses COALESCE+json_each
        const dialect = getCurrentDialect();
        const scoreParts = params.signals!.map((sig) =>
          dialect === "mysql"
            ? sql`COALESCE(JSON_CONTAINS(${genesTable.signalsMatch}, ${JSON.stringify(sig)}), 0)`
            : sql`COALESCE((SELECT 1 FROM json_each(${genesTable.signalsMatch}) WHERE value = ${sig} LIMIT 1), 0)`,
        );
        const scoreExpr = scoreParts.length === 1
          ? scoreParts[0]!
          : sql`(${sql.join(scoreParts, sql` + `)})`;

        const geneRows = await db
          .select({
            gene: genesTable,
            signalScore: sql<number>`${scoreExpr}`.as("signal_score"),
          })
          .from(genesTable)
          .where(geneWhere)
          .orderBy(sql`signal_score DESC`, desc(genesTable.updatedAt))
          .limit(limit)
          .offset(offset);

        for (const row of geneRows) {
          const r = row.gene as unknown as Record<string, unknown>;
          results.push(rowToAsset(r, "gene"));
        }
      } else {
        // No signal filter — standard query sorted by updatedAt
        const geneRows = await db
          .select()
          .from(genesTable)
          .where(geneWhere)
          .orderBy(desc(genesTable.updatedAt))
          .limit(limit)
          .offset(offset);

        for (const row of geneRows) {
          const r = row as unknown as Record<string, unknown>;
          results.push(rowToAsset(r, "gene"));
        }
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

      // Filter capsules by parent gene asset ID
      if (params.geneAssetId) {
        capsuleConditions.push(eq(capsulesTable.geneAssetId, params.geneAssetId));
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
        results.push(rowToAsset(r, "capsule"));
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

    // Insert the report outside the critical transaction (append-only, safe)
    await db.insert(assetReportsTable).values({
      id: uuidv4(),
      assetId: params.assetId,
      assetType,
      reporterNodeId: params.reporterNodeId,
      reporterUserId: params.reporterUserId ?? null,
      reportType: params.success ? "success" : "failure",
      details: params.reportData ?? null,
    });

    // Wrap counter update + promotion check + status update in a transaction
    // to prevent race conditions where concurrent reports could read stale
    // counters and skip or double-trigger promotion/quarantine.
    const { asset, promotionResult } = await safeTransaction(db, async (tx) => {
      // Use atomic SQL increment to prevent race conditions when
      // multiple nodes report usage concurrently.
      // failCount is incremented on failure, useCount always incremented.
      const failIncrement = params.success ? 0 : 1;
      await tx
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
      const refreshedRows = await tx
        .select()
        .from(table)
        .where(eq(table.assetId, params.assetId))
        .limit(1);
      const refreshedRow = refreshedRows[0] as unknown as Record<string, unknown>;
      const newUseCount = refreshedRow.useCount as number;
      const newSuccessRate = refreshedRow.successRate as number;

      // Check auto-promotion/quarantine
      const txPromotionResult = checkPromotion({
        status: currentRow.status as AssetStatus,
        useCount: newUseCount,
        successRate: newSuccessRate,
      });

      // Apply status change within the same transaction
      if (txPromotionResult.shouldPromote) {
        const updateSet: Record<string, unknown> = {
          status: "promoted" as AssetStatus,
          promotedAt: new Date(),
        };
        await tx
          .update(table)
          .set(updateSet as { status: string; promotedAt?: Date })
          .where(eq(table.assetId, params.assetId));

        await tx.insert(evolutionEventsTable).values({
          id: uuidv4(),
          assetId: params.assetId,
          assetType,
          eventType: "promoted",
          nodeId: null,
          details: txPromotionResult.reason ? { reason: txPromotionResult.reason } : null,
        });

        logger.info({ assetId: params.assetId, status: "promoted", reason: txPromotionResult.reason }, "Asset status updated");
      } else if (txPromotionResult.shouldQuarantine) {
        await tx
          .update(table)
          .set({ status: "quarantined" as AssetStatus })
          .where(eq(table.assetId, params.assetId));

        await tx.insert(evolutionEventsTable).values({
          id: uuidv4(),
          assetId: params.assetId,
          assetType,
          eventType: "quarantined",
          nodeId: null,
          details: txPromotionResult.reason ? { reason: txPromotionResult.reason } : null,
        });

        logger.info({ assetId: params.assetId, status: "quarantined", reason: txPromotionResult.reason }, "Asset status updated");
      }

      // Fetch final asset state within the transaction
      const updatedRows = await tx
        .select()
        .from(table)
        .where(eq(table.assetId, params.assetId))
        .limit(1);

      const txAsset = rowToAsset(
        updatedRows[0] as unknown as Record<string, unknown>,
        assetType,
      );

      return { asset: txAsset, promotionResult: txPromotionResult };
    });

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

  /**
   * Calculate Evolution Leaderboard — comprehensive score ranking for nodes.
   *
   * Scoring formula:
   *  - Gene published (approved+):        +15 each
   *  - Capsule solidified (approved+):     +20 each
   *  - Usage reports (used others' capsule): +5 each
   *  - Upvotes received on own assets:     +8 each
   *  - Downvotes received:                 -5 each
   *  - Capsule with success_streak >= 3:   +25 bonus each
   *  - Promoted capsule:                   +30 bonus each
   *  - Quarantined asset:                  -10 penalty each
   */
  async calculateEvolutionLeaderboard(
    period: "weekly" | "monthly" = "weekly",
    limit = 10,
  ): Promise<{
    period: string;
    startDate: string;
    endDate: string;
    rankings: Array<{
      rank: number;
      nodeId: string;
      employeeName: string | null;
      roleId: string | null;
      score: number;
      breakdown: {
        genes_published: number;
        capsules_solidified: number;
        usage_reports_sent: number;
        upvotes_received: number;
        downvotes_received: number;
        promoted_capsules: number;
        quarantined_assets: number;
        bonus_streaks: number;
      };
      badges: string[];
    }>;
  }> {
    const db = getDb();

    // ── Determine date range ──
    const now = new Date();
    let startDate: Date;
    let endDate: Date;

    if (period === "monthly") {
      startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      endDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    } else {
      // Weekly: last 7 days starting from Monday
      const dayOfWeek = now.getUTCDay() || 7; // Monday=1..Sunday=7
      startDate = new Date(now);
      startDate.setUTCDate(now.getUTCDate() - dayOfWeek + 1);
      startDate.setUTCHours(0, 0, 0, 0);
      endDate = new Date(startDate);
      endDate.setUTCDate(startDate.getUTCDate() + 7);
    }

    // ── 1. Genes published (approved or promoted) per node ──
    const genesPublished = await db
      .select({
        nodeId: genesTable.nodeId,
        count: sql<number>`COUNT(*)`,
      })
      .from(genesTable)
      .where(
        and(
          gte(genesTable.createdAt, startDate),
          lte(genesTable.createdAt, endDate),
          or(eq(genesTable.status, "approved"), eq(genesTable.status, "promoted")),
        ),
      )
      .groupBy(genesTable.nodeId);

    // ── 2. Capsules solidified (approved or promoted) per node ──
    const capsulesSolidified = await db
      .select({
        nodeId: capsulesTable.nodeId,
        count: sql<number>`COUNT(*)`,
      })
      .from(capsulesTable)
      .where(
        and(
          gte(capsulesTable.createdAt, startDate),
          lte(capsulesTable.createdAt, endDate),
          or(eq(capsulesTable.status, "approved"), eq(capsulesTable.status, "promoted")),
        ),
      )
      .groupBy(capsulesTable.nodeId);

    // ── 3. Usage reports where reporter used someone else's capsule (success) ──
    const usageReports = await db
      .select({
        reporterNodeId: assetReportsTable.reporterNodeId,
        count: sql<number>`COUNT(*)`,
      })
      .from(assetReportsTable)
      .innerJoin(capsulesTable, eq(assetReportsTable.assetId, capsulesTable.assetId))
      .where(
        and(
          gte(assetReportsTable.createdAt, startDate),
          lte(assetReportsTable.createdAt, endDate),
          eq(assetReportsTable.reportType, "success"),
          ne(assetReportsTable.reporterNodeId, capsulesTable.nodeId),
        ),
      )
      .groupBy(assetReportsTable.reporterNodeId);

    // ── 4. Votes received on own assets ──
    // Import assetVotesTable lazily — Impl-1 is adding it concurrently
    let upvotesReceived: Array<{ nodeId: string | null; count: number }> = [];
    let downvotesReceived: Array<{ nodeId: string | null; count: number }> = [];
    try {
      const { assetVotesTable } = await import("./schema.js");
      if (assetVotesTable) {
        // Upvotes on genes
        const geneUpvotes = await db
          .select({
            nodeId: genesTable.nodeId,
            count: sql<number>`COUNT(*)`,
          })
          .from(assetVotesTable)
          .innerJoin(genesTable, eq(assetVotesTable.assetId, genesTable.assetId))
          .where(
            and(
              gte(assetVotesTable.createdAt, startDate),
              lte(assetVotesTable.createdAt, endDate),
              eq(assetVotesTable.vote, "upvote"),
            ),
          )
          .groupBy(genesTable.nodeId);

        // Upvotes on capsules
        const capsuleUpvotes = await db
          .select({
            nodeId: capsulesTable.nodeId,
            count: sql<number>`COUNT(*)`,
          })
          .from(assetVotesTable)
          .innerJoin(capsulesTable, eq(assetVotesTable.assetId, capsulesTable.assetId))
          .where(
            and(
              gte(assetVotesTable.createdAt, startDate),
              lte(assetVotesTable.createdAt, endDate),
              eq(assetVotesTable.vote, "upvote"),
            ),
          )
          .groupBy(capsulesTable.nodeId);

        upvotesReceived = [...geneUpvotes, ...capsuleUpvotes];

        // Downvotes on genes
        const geneDownvotes = await db
          .select({
            nodeId: genesTable.nodeId,
            count: sql<number>`COUNT(*)`,
          })
          .from(assetVotesTable)
          .innerJoin(genesTable, eq(assetVotesTable.assetId, genesTable.assetId))
          .where(
            and(
              gte(assetVotesTable.createdAt, startDate),
              lte(assetVotesTable.createdAt, endDate),
              eq(assetVotesTable.vote, "downvote"),
            ),
          )
          .groupBy(genesTable.nodeId);

        // Downvotes on capsules
        const capsuleDownvotes = await db
          .select({
            nodeId: capsulesTable.nodeId,
            count: sql<number>`COUNT(*)`,
          })
          .from(assetVotesTable)
          .innerJoin(capsulesTable, eq(assetVotesTable.assetId, capsulesTable.assetId))
          .where(
            and(
              gte(assetVotesTable.createdAt, startDate),
              lte(assetVotesTable.createdAt, endDate),
              eq(assetVotesTable.vote, "downvote"),
            ),
          )
          .groupBy(capsulesTable.nodeId);

        downvotesReceived = [...geneDownvotes, ...capsuleDownvotes];
      }
    } catch {
      // assetVotesTable not yet available — votes will be zero
      logger.debug("assetVotesTable not available — vote scores will be zero");
    }

    // ── 5. Capsules with success_streak >= 3 (bonus) ──
    const streakBonuses = await db
      .select({
        nodeId: capsulesTable.nodeId,
        count: sql<number>`COUNT(*)`,
      })
      .from(capsulesTable)
      .where(
        and(
          gte(capsulesTable.createdAt, startDate),
          lte(capsulesTable.createdAt, endDate),
          gte(capsulesTable.successStreak, 3),
        ),
      )
      .groupBy(capsulesTable.nodeId);

    // ── 6. Promoted capsules (bonus) ──
    const promotedCapsules = await db
      .select({
        nodeId: capsulesTable.nodeId,
        count: sql<number>`COUNT(*)`,
      })
      .from(capsulesTable)
      .where(
        and(
          gte(capsulesTable.createdAt, startDate),
          lte(capsulesTable.createdAt, endDate),
          eq(capsulesTable.status, "promoted"),
        ),
      )
      .groupBy(capsulesTable.nodeId);

    // ── 7. Quarantined assets (penalty) ──
    const quarantinedGenes = await db
      .select({
        nodeId: genesTable.nodeId,
        count: sql<number>`COUNT(*)`,
      })
      .from(genesTable)
      .where(
        and(
          gte(genesTable.createdAt, startDate),
          lte(genesTable.createdAt, endDate),
          eq(genesTable.status, "quarantined"),
        ),
      )
      .groupBy(genesTable.nodeId);

    const quarantinedCapsules = await db
      .select({
        nodeId: capsulesTable.nodeId,
        count: sql<number>`COUNT(*)`,
      })
      .from(capsulesTable)
      .where(
        and(
          gte(capsulesTable.createdAt, startDate),
          lte(capsulesTable.createdAt, endDate),
          eq(capsulesTable.status, "quarantined"),
        ),
      )
      .groupBy(capsulesTable.nodeId);

    // ── 8. Trusted source check: capsules with success_rate >= 0.9 AND use_count >= 10 ──
    const trustedCapsules = await db
      .select({
        nodeId: capsulesTable.nodeId,
        count: sql<number>`COUNT(*)`,
      })
      .from(capsulesTable)
      .where(
        and(
          gte(capsulesTable.successRate, 0.9),
          gte(capsulesTable.useCount, 10),
        ),
      )
      .groupBy(capsulesTable.nodeId);

    // ── Merge all data into ranking map ──
    type NodeBreakdown = {
      genes_published: number;
      capsules_solidified: number;
      usage_reports_sent: number;
      upvotes_received: number;
      downvotes_received: number;
      promoted_capsules: number;
      quarantined_assets: number;
      bonus_streaks: number;
      has_trusted_capsule: boolean;
    };

    const rankMap = new Map<string, NodeBreakdown>();

    const getEntry = (nodeId: string): NodeBreakdown => {
      if (!rankMap.has(nodeId)) {
        rankMap.set(nodeId, {
          genes_published: 0,
          capsules_solidified: 0,
          usage_reports_sent: 0,
          upvotes_received: 0,
          downvotes_received: 0,
          promoted_capsules: 0,
          quarantined_assets: 0,
          bonus_streaks: 0,
          has_trusted_capsule: false,
        });
      }
      return rankMap.get(nodeId)!;
    };

    for (const row of genesPublished) {
      if (!row.nodeId) continue;
      getEntry(row.nodeId).genes_published = Number(row.count);
    }
    for (const row of capsulesSolidified) {
      if (!row.nodeId) continue;
      getEntry(row.nodeId).capsules_solidified = Number(row.count);
    }
    for (const row of usageReports) {
      if (!row.reporterNodeId) continue;
      getEntry(row.reporterNodeId).usage_reports_sent = Number(row.count);
    }
    for (const row of upvotesReceived) {
      if (!row.nodeId) continue;
      const entry = getEntry(row.nodeId);
      entry.upvotes_received += Number(row.count);
    }
    for (const row of downvotesReceived) {
      if (!row.nodeId) continue;
      const entry = getEntry(row.nodeId);
      entry.downvotes_received += Number(row.count);
    }
    for (const row of streakBonuses) {
      if (!row.nodeId) continue;
      getEntry(row.nodeId).bonus_streaks = Number(row.count);
    }
    for (const row of promotedCapsules) {
      if (!row.nodeId) continue;
      getEntry(row.nodeId).promoted_capsules = Number(row.count);
    }
    for (const row of quarantinedGenes) {
      if (!row.nodeId) continue;
      const entry = getEntry(row.nodeId);
      entry.quarantined_assets += Number(row.count);
    }
    for (const row of quarantinedCapsules) {
      if (!row.nodeId) continue;
      const entry = getEntry(row.nodeId);
      entry.quarantined_assets += Number(row.count);
    }
    for (const row of trustedCapsules) {
      if (!row.nodeId) continue;
      getEntry(row.nodeId).has_trusted_capsule = true;
    }

    // ── Calculate scores ──
    const scored = Array.from(rankMap.entries()).map(([nodeId, b]) => {
      const score =
        b.genes_published * 15 +
        b.capsules_solidified * 20 +
        b.usage_reports_sent * 5 +
        b.upvotes_received * 8 +
        b.downvotes_received * -5 +
        b.bonus_streaks * 25 +
        b.promoted_capsules * 30 +
        b.quarantined_assets * -10;

      return { nodeId, score, breakdown: b };
    });

    // Sort descending by score, take top N
    scored.sort((a, b) => b.score - a.score);
    const topN = scored.slice(0, limit);

    // ── Enrich with node metadata ──
    const nodeIds = topN.map((r) => r.nodeId);
    const nodeMetadata = new Map<string, { employeeName: string | null; roleId: string | null }>();

    if (nodeIds.length > 0) {
      const nodeRows = await db
        .select({
          nodeId: nodesTable.nodeId,
          employeeName: nodesTable.employeeName,
          roleId: nodesTable.roleId,
        })
        .from(nodesTable)
        .where(sql`${nodesTable.nodeId} IN (${sql.join(nodeIds.map((id) => sql`${id}`), sql`, `)})`);

      for (const row of nodeRows) {
        nodeMetadata.set(row.nodeId, {
          employeeName: row.employeeName,
          roleId: row.roleId,
        });
      }
    }

    // ── Build rankings with badges ──
    const rankings = topN.map((r, index) => {
      const rank = index + 1;
      const badges: string[] = [];

      if (r.breakdown.genes_published >= 5) badges.push("Gene Master");
      if (r.breakdown.capsules_solidified >= 10) badges.push("Capsule Creator");
      if (r.breakdown.usage_reports_sent >= 5) badges.push("Problem Solver");
      if (rank === 1) badges.push("Top Contributor");
      if (r.breakdown.has_trusted_capsule) badges.push("Trusted Source");

      return {
        rank,
        nodeId: r.nodeId,
        employeeName: nodeMetadata.get(r.nodeId)?.employeeName ?? null,
        roleId: nodeMetadata.get(r.nodeId)?.roleId ?? null,
        score: r.score,
        breakdown: {
          genes_published: r.breakdown.genes_published,
          capsules_solidified: r.breakdown.capsules_solidified,
          usage_reports_sent: r.breakdown.usage_reports_sent,
          upvotes_received: r.breakdown.upvotes_received,
          downvotes_received: r.breakdown.downvotes_received,
          promoted_capsules: r.breakdown.promoted_capsules,
          quarantined_assets: r.breakdown.quarantined_assets,
          bonus_streaks: r.breakdown.bonus_streaks,
        },
        badges,
      };
    });

    return {
      period,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      rankings,
    };
  }

  /**
   * Get weekly MVP rankings.
   *
   * Ranks nodes by contribution within an ISO week:
   *  - Task completions (from tasks table)
   *  - Community posts (from community_topics table)
   *  - Gene/capsule publications
   *
   * @param weekStr ISO week string like "2026-W12". Defaults to current week.
   * @returns Top 10 ranked nodes with scores.
   */
  async getWeeklyMVP(weekStr?: string): Promise<{
    week: string;
    startDate: string;
    endDate: string;
    rankings: Array<{
      nodeId: string;
      employeeName: string | null;
      roleId: string | null;
      tasksCompleted: number;
      communityPosts: number;
      genesPublished: number;
      score: number;
    }>;
  }> {
    const db = getDb();

    // Parse ISO week to start/end dates
    const { week, startDate, endDate } = parseISOWeek(weekStr);

    // Import task and community schemas lazily to avoid circular deps
    const { tasksTable } = await import("../tasks/schema.js");
    const { communityTopicsTable } = await import("../community/schema.js");

    // 1. Task completions per node
    const taskCompletions = await db
      .select({
        nodeId: tasksTable.assignedNodeId,
        count: sql<number>`COUNT(*)`,
      })
      .from(tasksTable)
      .where(
        and(
          eq(tasksTable.status, "completed"),
          gte(tasksTable.updatedAt, startDate),
          lte(tasksTable.updatedAt, endDate),
        ),
      )
      .groupBy(tasksTable.assignedNodeId);

    // 2. Community posts per author (authorId maps to node userId, but
    //    we join through nodes to get nodeId)
    const communityPosts = await db
      .select({
        nodeId: nodesTable.nodeId,
        count: sql<number>`COUNT(*)`,
      })
      .from(communityTopicsTable)
      .innerJoin(nodesTable, eq(communityTopicsTable.authorId, nodesTable.userId))
      .where(
        and(
          gte(communityTopicsTable.createdAt, startDate),
          lte(communityTopicsTable.createdAt, endDate),
        ),
      )
      .groupBy(nodesTable.nodeId);

    // 3. Genes published per node
    const genesPublished = await db
      .select({
        nodeId: genesTable.nodeId,
        count: sql<number>`COUNT(*)`,
      })
      .from(genesTable)
      .where(
        and(
          gte(genesTable.createdAt, startDate),
          lte(genesTable.createdAt, endDate),
        ),
      )
      .groupBy(genesTable.nodeId);

    // Merge into a single ranking map
    const rankMap = new Map<
      string,
      { tasksCompleted: number; communityPosts: number; genesPublished: number }
    >();

    for (const row of taskCompletions) {
      if (!row.nodeId) continue;
      const entry = rankMap.get(row.nodeId) ?? {
        tasksCompleted: 0,
        communityPosts: 0,
        genesPublished: 0,
      };
      entry.tasksCompleted = Number(row.count);
      rankMap.set(row.nodeId, entry);
    }

    for (const row of communityPosts) {
      if (!row.nodeId) continue;
      const entry = rankMap.get(row.nodeId) ?? {
        tasksCompleted: 0,
        communityPosts: 0,
        genesPublished: 0,
      };
      entry.communityPosts = Number(row.count);
      rankMap.set(row.nodeId, entry);
    }

    for (const row of genesPublished) {
      if (!row.nodeId) continue;
      const entry = rankMap.get(row.nodeId) ?? {
        tasksCompleted: 0,
        communityPosts: 0,
        genesPublished: 0,
      };
      entry.genesPublished = Number(row.count);
      rankMap.set(row.nodeId, entry);
    }

    // Score: tasks * 15 + community posts * 5 + genes * 10
    const scored = Array.from(rankMap.entries()).map(([nodeId, data]) => ({
      nodeId,
      ...data,
      score: data.tasksCompleted * 15 + data.communityPosts * 5 + data.genesPublished * 10,
    }));

    // Sort by score descending, take top 10
    scored.sort((a, b) => b.score - a.score);
    const top10 = scored.slice(0, 10);

    // Enrich with node metadata
    const nodeIds = top10.map((r) => r.nodeId);
    const nodeMetadata = new Map<string, { employeeName: string | null; roleId: string | null }>();

    if (nodeIds.length > 0) {
      const nodeRows = await db
        .select({
          nodeId: nodesTable.nodeId,
          employeeName: nodesTable.employeeName,
          roleId: nodesTable.roleId,
        })
        .from(nodesTable)
        .where(sql`${nodesTable.nodeId} IN (${sql.join(nodeIds.map((id) => sql`${id}`), sql`, `)})`);

      for (const row of nodeRows) {
        nodeMetadata.set(row.nodeId, {
          employeeName: row.employeeName,
          roleId: row.roleId,
        });
      }
    }

    return {
      week,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      rankings: top10.map((r) => ({
        nodeId: r.nodeId,
        employeeName: nodeMetadata.get(r.nodeId)?.employeeName ?? null,
        roleId: nodeMetadata.get(r.nodeId)?.roleId ?? null,
        tasksCompleted: r.tasksCompleted,
        communityPosts: r.communityPosts,
        genesPublished: r.genesPublished,
        score: r.score,
      })),
    };
  }
}

// ── Helper: Parse ISO week string to Date range ──

function parseISOWeek(weekStr?: string): {
  week: string;
  startDate: Date;
  endDate: Date;
} {
  const now = new Date();

  if (weekStr && /^\d{4}-W\d{2}$/.test(weekStr)) {
    const [yearStr, weekNumStr] = weekStr.split("-W");
    const year = parseInt(yearStr, 10);
    const weekNum = parseInt(weekNumStr, 10);

    // ISO week 1 contains the first Thursday of the year.
    // January 4 is always in ISO week 1.
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const dayOfWeek = jan4.getUTCDay() || 7; // Monday=1..Sunday=7
    const startOfWeek1 = new Date(jan4);
    startOfWeek1.setUTCDate(jan4.getUTCDate() - dayOfWeek + 1); // Monday of week 1

    const startDate = new Date(startOfWeek1);
    startDate.setUTCDate(startOfWeek1.getUTCDate() + (weekNum - 1) * 7);

    const endDate = new Date(startDate);
    endDate.setUTCDate(startDate.getUTCDate() + 7);

    return { week: weekStr, startDate, endDate };
  }

  // Default: current ISO week
  const dayOfWeek = now.getUTCDay() || 7;
  const startDate = new Date(now);
  startDate.setUTCDate(now.getUTCDate() - dayOfWeek + 1);
  startDate.setUTCHours(0, 0, 0, 0);

  const endDate = new Date(startDate);
  endDate.setUTCDate(startDate.getUTCDate() + 7);

  // Calculate the ISO week number for the response
  const jan4 = new Date(Date.UTC(startDate.getUTCFullYear(), 0, 4));
  const startOfYear = new Date(jan4);
  const dow = jan4.getUTCDay() || 7;
  startOfYear.setUTCDate(jan4.getUTCDate() - dow + 1);
  const weekNum = Math.ceil(
    ((startDate.getTime() - startOfYear.getTime()) / 86400000 + 1) / 7,
  );
  const week = `${startDate.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;

  return { week, startDate, endDate };
}
