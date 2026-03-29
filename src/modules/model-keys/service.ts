/**
 * Model-Keys Service — AI Model API Key CRUD + Node Assignment
 *
 * Handles encrypted storage of API keys and distributes them to
 * WinClaw nodes via the existing configRevision sync mechanism.
 */

import { v4 as uuidv4 } from "uuid";
import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { eq, desc, sql, and, like } from "drizzle-orm";
import pino from "pino";
import { getDb } from "../../shared/db/connection.js";
import { aiModelKeysTable } from "./schema.js";
import { nodesTable } from "../evolution/schema.js";
import {
  BadRequestError,
  NotFoundError,
} from "../../shared/middleware/error-handler.js";

import { nodeConfigSSE } from "../evolution/node-config-sse.js";

const logger = pino({ name: "module:model-keys:service" });

// ── AES-256-GCM Encryption Helpers ──────────────

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const secret =
    process.env.MODEL_KEY_ENCRYPTION_SECRET ||
    "dev-model-key-secret-32-chars!!";
  const key = Buffer.alloc(32);
  Buffer.from(secret, "utf-8").copy(key);
  return key;
}

function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf-8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

function decrypt(encoded: string): string {
  const key = getEncryptionKey();
  const buf = Buffer.from(encoded, "base64");
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext) + decipher.final("utf-8");
}

/** Mask an API key for display: keep first 6 and last 4 characters. */
function maskApiKey(plain: string): string {
  if (plain.length <= 12) return plain.substring(0, 4) + "...";
  return plain.substring(0, 6) + "..." + plain.substring(plain.length - 4);
}

// ── Types ────────────────────────────────────────

interface KeyConfigEntry {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
  apiType?: string;
}

interface KeyConfigJson {
  primary: KeyConfigEntry | null;
  auxiliary: KeyConfigEntry | null;
}

// ── Service ──────────────────────────────────────

export class ModelKeysService {
  // ── Key CRUD ─────────────────────────────────

  async listKeys(opts: {
    category?: string;
    provider?: string;
    page?: number;
    limit?: number;
  }): Promise<{ keys: Record<string, unknown>[]; total: number }> {
    const db = getDb();
    const page = opts.page ?? 1;
    const limit = opts.limit ?? 50;
    const offset = (page - 1) * limit;

    const conditions = [];
    if (opts.category) {
      conditions.push(
        eq(
          aiModelKeysTable.category,
          opts.category as "primary" | "auxiliary",
        ),
      );
    }
    if (opts.provider) {
      conditions.push(like(aiModelKeysTable.provider, `%${opts.provider}%`));
    }

    const whereClause =
      conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, totalResult] = await Promise.all([
      db
        .select()
        .from(aiModelKeysTable)
        .where(whereClause)
        .orderBy(desc(aiModelKeysTable.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`COUNT(*)` })
        .from(aiModelKeysTable)
        .where(whereClause),
    ]);

    const total = Number(totalResult[0]?.count ?? 0);

    // Mask API keys for list response
    const keys = rows.map((row) => {
      let apiKeyPrefix = "";
      try {
        apiKeyPrefix = maskApiKey(decrypt(row.apiKeyEnc));
      } catch {
        apiKeyPrefix = "***";
      }
      return {
        id: row.id,
        category: row.category,
        name: row.name,
        provider: row.provider,
        modelName: row.modelName,
        apiKeyPrefix,
        baseUrl: row.baseUrl,
        notes: row.notes,
        isActive: row.isActive === 1,
        createdBy: row.createdBy,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    });

    return { keys, total };
  }

  async getKey(id: string): Promise<Record<string, unknown>> {
    const db = getDb();
    const rows = await db
      .select()
      .from(aiModelKeysTable)
      .where(eq(aiModelKeysTable.id, id))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundError("Model key");
    }

    const row = rows[0]!;
    let apiKeyPrefix = "";
    try {
      apiKeyPrefix = maskApiKey(decrypt(row.apiKeyEnc));
    } catch {
      apiKeyPrefix = "***";
    }

    return {
      id: row.id,
      category: row.category,
      name: row.name,
      provider: row.provider,
      modelName: row.modelName,
      apiKeyPrefix,
      baseUrl: row.baseUrl,
      notes: row.notes,
      isActive: row.isActive === 1,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async createKey(data: {
    category: "primary" | "auxiliary";
    name: string;
    provider: string;
    model_name: string;
    api_key: string;
    base_url?: string;
    notes?: string;
    created_by?: string;
  }): Promise<Record<string, unknown>> {
    const db = getDb();
    const id = uuidv4();
    const apiKeyEnc = encrypt(data.api_key);

    await db.insert(aiModelKeysTable).values({
      id,
      category: data.category,
      name: data.name,
      provider: data.provider,
      modelName: data.model_name,
      apiKeyEnc,
      baseUrl: data.base_url ?? null,
      notes: data.notes ?? null,
      createdBy: data.created_by ?? "",
    });

    logger.info({ keyId: id, provider: data.provider }, "Model key created");
    return this.getKey(id);
  }

  async updateKey(
    id: string,
    data: {
      name?: string;
      provider?: string;
      model_name?: string;
      api_key?: string;
      base_url?: string | null;
      notes?: string | null;
      is_active?: boolean;
    },
  ): Promise<Record<string, unknown>> {
    const db = getDb();

    // Check exists
    const existing = await db
      .select()
      .from(aiModelKeysTable)
      .where(eq(aiModelKeysTable.id, id))
      .limit(1);

    if (existing.length === 0) {
      throw new NotFoundError("Model key");
    }

    const updateSet: Record<string, unknown> = {};
    if (data.name !== undefined) updateSet.name = data.name;
    if (data.provider !== undefined) updateSet.provider = data.provider;
    if (data.model_name !== undefined) updateSet.modelName = data.model_name;
    if (data.api_key !== undefined) updateSet.apiKeyEnc = encrypt(data.api_key);
    if (data.base_url !== undefined) updateSet.baseUrl = data.base_url;
    if (data.notes !== undefined) updateSet.notes = data.notes;
    if (data.is_active !== undefined)
      updateSet.isActive = data.is_active ? 1 : 0;

    if (Object.keys(updateSet).length === 0) {
      throw new BadRequestError("No fields to update");
    }

    await db
      .update(aiModelKeysTable)
      .set(updateSet as typeof aiModelKeysTable.$inferInsert)
      .where(eq(aiModelKeysTable.id, id));

    logger.info({ keyId: id }, "Model key updated");

    // If this key is assigned to nodes, update their key_config_json
    await this.refreshNodesUsingKey(id);

    return this.getKey(id);
  }

  async deleteKey(id: string): Promise<void> {
    const db = getDb();

    const existing = await db
      .select()
      .from(aiModelKeysTable)
      .where(eq(aiModelKeysTable.id, id))
      .limit(1);

    if (existing.length === 0) {
      throw new NotFoundError("Model key");
    }

    // Check if key is assigned to any node
    const assignedNodes = await db
      .select({ nodeId: nodesTable.nodeId })
      .from(nodesTable)
      .where(
        sql`${nodesTable.primaryKeyId} = ${id} OR ${nodesTable.auxiliaryKeyId} = ${id}`,
      );

    if (assignedNodes.length > 0) {
      throw new BadRequestError(
        `Cannot delete key: it is assigned to ${assignedNodes.length} node(s). Unassign first.`,
      );
    }

    await db
      .delete(aiModelKeysTable)
      .where(eq(aiModelKeysTable.id, id));

    logger.info({ keyId: id }, "Model key deleted");
  }

  // ── Node Key Assignment ──────────────────────

  async assignKeysToNode(
    nodeId: string,
    primaryKeyId?: string | null,
    auxiliaryKeyId?: string | null,
  ): Promise<Record<string, unknown>> {
    const db = getDb();

    // Verify node exists (by nodeId column)
    const nodeRows = await db
      .select()
      .from(nodesTable)
      .where(eq(nodesTable.nodeId, nodeId))
      .limit(1);

    if (nodeRows.length === 0) {
      throw new NotFoundError("Node");
    }

    const node = nodeRows[0]!;

    // Build key config
    const keyConfig: KeyConfigJson = { primary: null, auxiliary: null };

    let finalPrimaryKeyId: string | null = node.primaryKeyId ?? null;
    let finalAuxiliaryKeyId: string | null = node.auxiliaryKeyId ?? null;

    // Handle primary key
    if (primaryKeyId !== undefined) {
      if (primaryKeyId === null || primaryKeyId === "") {
        finalPrimaryKeyId = null;
      } else {
        const primaryKey = await this.getKeyRaw(primaryKeyId);
        if (!primaryKey) throw new NotFoundError("Primary model key");
        if (primaryKey.isActive !== 1)
          throw new BadRequestError("Primary key is not active");
        finalPrimaryKeyId = primaryKeyId;
        keyConfig.primary = {
          provider: primaryKey.provider,
          model: primaryKey.modelName,
          apiKey: decrypt(primaryKey.apiKeyEnc),
          ...(primaryKey.baseUrl ? { baseUrl: primaryKey.baseUrl } : {}),
        };
      }
    } else if (finalPrimaryKeyId) {
      // Keep existing
      const pk = await this.getKeyRaw(finalPrimaryKeyId);
      if (pk) {
        keyConfig.primary = {
          provider: pk.provider,
          model: pk.modelName,
          apiKey: decrypt(pk.apiKeyEnc),
          ...(pk.baseUrl ? { baseUrl: pk.baseUrl } : {}),
        };
      }
    }

    // Handle auxiliary key
    if (auxiliaryKeyId !== undefined) {
      if (auxiliaryKeyId === null || auxiliaryKeyId === "") {
        finalAuxiliaryKeyId = null;
      } else {
        const auxKey = await this.getKeyRaw(auxiliaryKeyId);
        if (!auxKey) throw new NotFoundError("Auxiliary model key");
        if (auxKey.isActive !== 1)
          throw new BadRequestError("Auxiliary key is not active");
        finalAuxiliaryKeyId = auxiliaryKeyId;
        keyConfig.auxiliary = {
          provider: auxKey.provider,
          model: auxKey.modelName,
          apiKey: decrypt(auxKey.apiKeyEnc),
          ...(auxKey.baseUrl ? { baseUrl: auxKey.baseUrl } : {}),
        };
      }
    } else if (finalAuxiliaryKeyId) {
      // Keep existing
      const ak = await this.getKeyRaw(finalAuxiliaryKeyId);
      if (ak) {
        keyConfig.auxiliary = {
          provider: ak.provider,
          model: ak.modelName,
          apiKey: decrypt(ak.apiKeyEnc),
          ...(ak.baseUrl ? { baseUrl: ak.baseUrl } : {}),
        };
      }
    }

    // Determine final key_config_json
    const hasAny = keyConfig.primary || keyConfig.auxiliary;
    const keyConfigJson = hasAny ? keyConfig : null;

    const currentRevision = node.configRevision ?? 0;
    const newRevision = currentRevision + 1;

    await db
      .update(nodesTable)
      .set({
        primaryKeyId: finalPrimaryKeyId,
        auxiliaryKeyId: finalAuxiliaryKeyId,
        keyConfigJson: keyConfigJson,
        configRevision: newRevision,
      })
      .where(eq(nodesTable.nodeId, nodeId));

    logger.info(
      { nodeId, primaryKeyId: finalPrimaryKeyId, auxiliaryKeyId: finalAuxiliaryKeyId, revision: newRevision },
      "Keys assigned to node",
    );

    // Push config update to node via SSE (if connected)
    this.pushConfigToNode(nodeId, newRevision, "key_assignment");

    const updated = await db
      .select()
      .from(nodesTable)
      .where(eq(nodesTable.nodeId, nodeId))
      .limit(1);

    return updated[0] as unknown as Record<string, unknown>;
  }

  async unassignKeysFromNode(nodeId: string): Promise<Record<string, unknown>> {
    const db = getDb();

    const nodeRows = await db
      .select()
      .from(nodesTable)
      .where(eq(nodesTable.nodeId, nodeId))
      .limit(1);

    if (nodeRows.length === 0) {
      throw new NotFoundError("Node");
    }

    const node = nodeRows[0]!;
    const currentRevision = node.configRevision ?? 0;

    await db
      .update(nodesTable)
      .set({
        primaryKeyId: null,
        auxiliaryKeyId: null,
        keyConfigJson: null,
        configRevision: Math.max(currentRevision + 1, Math.floor(Date.now() / 1000)),
      })
      .where(eq(nodesTable.nodeId, nodeId));

    logger.info({ nodeId }, "Keys unassigned from node");

    // Push config update to node via SSE (if connected)
    this.pushConfigToNode(nodeId, currentRevision + 1, "key_unassignment");

    const updated = await db
      .select()
      .from(nodesTable)
      .where(eq(nodesTable.nodeId, nodeId))
      .limit(1);

    return updated[0] as unknown as Record<string, unknown>;
  }

  async getNodeAssignedKeys(nodeId: string): Promise<Record<string, unknown>> {
    const db = getDb();

    const nodeRows = await db
      .select()
      .from(nodesTable)
      .where(eq(nodesTable.nodeId, nodeId))
      .limit(1);

    if (nodeRows.length === 0) {
      throw new NotFoundError("Node");
    }

    const node = nodeRows[0]!;
    let primaryInfo: Record<string, unknown> | null = null;
    let auxiliaryInfo: Record<string, unknown> | null = null;

    if (node.primaryKeyId) {
      const pk = await this.getKeyRaw(node.primaryKeyId);
      if (pk) {
        primaryInfo = {
          id: pk.id,
          name: pk.name,
          provider: pk.provider,
          modelName: pk.modelName,
          isActive: pk.isActive === 1,
        };
      }
    }

    if (node.auxiliaryKeyId) {
      const ak = await this.getKeyRaw(node.auxiliaryKeyId);
      if (ak) {
        auxiliaryInfo = {
          id: ak.id,
          name: ak.name,
          provider: ak.provider,
          modelName: ak.modelName,
          isActive: ak.isActive === 1,
        };
      }
    }

    return {
      nodeId: node.nodeId,
      primaryKeyId: node.primaryKeyId,
      auxiliaryKeyId: node.auxiliaryKeyId,
      primaryKey: primaryInfo,
      auxiliaryKey: auxiliaryInfo,
    };
  }

  // ── Private Helpers ──────────────────────────

  /** Get raw key row (with encrypted api_key). */
  private async getKeyRaw(id: string) {
    const db = getDb();
    const rows = await db
      .select()
      .from(aiModelKeysTable)
      .where(eq(aiModelKeysTable.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Re-build key_config_json for all nodes that reference the given key.
   * Called after a key is updated so that nodes get the new data on next sync.
   */
  private async refreshNodesUsingKey(keyId: string): Promise<void> {
    const db = getDb();

    const affectedNodes = await db
      .select()
      .from(nodesTable)
      .where(
        sql`${nodesTable.primaryKeyId} = ${keyId} OR ${nodesTable.auxiliaryKeyId} = ${keyId}`,
      );

    for (const node of affectedNodes) {
      const keyConfig: KeyConfigJson = { primary: null, auxiliary: null };

      if (node.primaryKeyId) {
        const pk = await this.getKeyRaw(node.primaryKeyId);
        if (pk && pk.isActive === 1) {
          keyConfig.primary = {
            provider: pk.provider,
            model: pk.modelName,
            apiKey: decrypt(pk.apiKeyEnc),
            ...(pk.baseUrl ? { baseUrl: pk.baseUrl } : {}),
          };
        }
      }

      if (node.auxiliaryKeyId) {
        const ak = await this.getKeyRaw(node.auxiliaryKeyId);
        if (ak && ak.isActive === 1) {
          keyConfig.auxiliary = {
            provider: ak.provider,
            model: ak.modelName,
            apiKey: decrypt(ak.apiKeyEnc),
            ...(ak.baseUrl ? { baseUrl: ak.baseUrl } : {}),
          };
        }
      }

      const hasAny = keyConfig.primary || keyConfig.auxiliary;
      const currentRevision = node.configRevision ?? 0;

      await db
        .update(nodesTable)
        .set({
          keyConfigJson: hasAny ? keyConfig : null,
          configRevision: Math.max(currentRevision + 1, Math.floor(Date.now() / 1000)),
        })
        .where(eq(nodesTable.nodeId, node.nodeId));

      logger.info(
        { nodeId: node.nodeId, keyId, newRevision: currentRevision + 1 },
        "Refreshed key config for node after key update",
      );

      // Push config update to node via SSE (if connected)
      this.pushConfigToNode(node.nodeId, currentRevision + 1, "key_update");
    }
  }

  /**
   * Push full config to a node via SSE.
   * Loads the node's resolved config and sends it as a config_update event.
   */
  private async pushConfigToNode(
    nodeId: string,
    revision: number,
    reason: string,
  ): Promise<void> {
    if (!nodeConfigSSE.isNodeConnected(nodeId)) return;

    try {
      const db = getDb();
      const nodeRows = await db
        .select()
        .from(nodesTable)
        .where(eq(nodesTable.nodeId, nodeId))
        .limit(1);

      if (nodeRows.length === 0) return;
      const node = nodeRows[0]!;

      // Build files map from resolved columns
      const files: Record<string, string> = {};
      const resolvedMap: Record<string, string | null> = {
        "AGENTS.md": node.resolvedAgentsMd,
        "SOUL.md": node.resolvedSoulMd,
        "IDENTITY.md": node.resolvedIdentityMd,
        "USER.md": node.resolvedUserMd,
        "TOOLS.md": node.resolvedToolsMd,
        "HEARTBEAT.md": node.resolvedHeartbeatMd,
        "BOOTSTRAP.md": node.resolvedBootstrapMd,
        "TASKS.md": node.resolvedTasksMd,
      };
      for (const [k, v] of Object.entries(resolvedMap)) {
        if (v) files[k] = v;
      }

      // Parse key_config_json
      let keyConfig = null;
      if (node.keyConfigJson) {
        try {
          keyConfig =
            typeof node.keyConfigJson === "string"
              ? JSON.parse(node.keyConfigJson)
              : node.keyConfigJson;
        } catch { /* ignore */ }
      }

      nodeConfigSSE.pushToNode(nodeId, {
        revision,
        reason,
        config: {
          role_id: node.roleId ?? null,
          role_mode: node.roleMode ?? null,
          files,
          key_config: keyConfig,
        },
      });
    } catch (err) {
      logger.warn({ nodeId, err }, "Failed to push config via SSE");
    }
  }
}
