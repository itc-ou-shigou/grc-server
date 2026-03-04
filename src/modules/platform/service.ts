/**
 * Platform Module — Service Implementation
 *
 * Manages platform-wide values/culture content.
 * Single-row table: one record holds the current platform values.
 */

import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import pino from "pino";
import { getDb } from "../../shared/db/connection.js";
import { platformValues } from "./schema.js";

const logger = pino({ name: "platform:service" });

// ── Types ───────────────────────────────────────

export interface PlatformValuesRow {
  content: string;
  contentHash: string;
  updatedBy: string | null;
  updatedAt: Date;
  createdAt: Date;
}

export interface UpsertResult {
  contentHash: string;
}

// ── Service Implementation ──────────────────────

export class PlatformService {
  /**
   * Get the current platform values.
   * Returns the first (and only) row, or null if none exists yet.
   */
  async getValues(): Promise<PlatformValuesRow | null> {
    const db = getDb();

    const rows = await db
      .select({
        content: platformValues.content,
        contentHash: platformValues.contentHash,
        updatedBy: platformValues.updatedBy,
        updatedAt: platformValues.updatedAt,
        createdAt: platformValues.createdAt,
      })
      .from(platformValues)
      .limit(1);

    if (rows.length === 0) return null;
    return rows[0]!;
  }

  /**
   * Create or update the platform values.
   * Uses SHA-256 hash for content change detection (ETag support).
   */
  async upsertValues(
    content: string,
    adminUserId: string,
  ): Promise<UpsertResult> {
    const db = getDb();
    const contentHash = createHash("sha256")
      .update(content, "utf-8")
      .digest("hex");

    // Check if a row already exists
    const existing = await db
      .select({ id: platformValues.id })
      .from(platformValues)
      .limit(1);

    if (existing.length > 0) {
      // Update existing row
      const id = existing[0]!.id;
      await db
        .update(platformValues)
        .set({
          content,
          contentHash,
          updatedBy: adminUserId,
        })
        .where(eq(platformValues.id, id));

      logger.info(
        { adminUserId, contentHash },
        "Platform values updated",
      );
    } else {
      // Insert first row
      const id = uuidv4();
      await db.insert(platformValues).values({
        id,
        content,
        contentHash,
        updatedBy: adminUserId,
      });

      logger.info(
        { adminUserId, contentHash },
        "Platform values created",
      );
    }

    return { contentHash };
  }
}
