/**
 * Update Gateway Module — Service Implementation
 *
 * Handles version checking with semver comparison, manifest retrieval,
 * and update result reporting.
 */

import { eq, and, desc } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import pino from "pino";
import { getDb } from "../../shared/db/connection.js";
import { clientReleases, updateReports } from "./schema.js";

const logger = pino({ name: "update:service" });

// ── Semver Comparison ───────────────────────────

interface SemverParts {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
}

/**
 * Parse a semver version string into its components.
 * Strips leading "v" if present.
 */
function parseSemver(version: string): SemverParts | null {
  const cleaned = version.startsWith("v") ? version.slice(1) : version;
  const match = cleaned.match(
    /^(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9.]+))?/,
  );
  if (!match) return null;
  return {
    major: Number.parseInt(match[1]!, 10),
    minor: Number.parseInt(match[2]!, 10),
    patch: Number.parseInt(match[3]!, 10),
    prerelease: match[4] ?? null,
  };
}

/**
 * Compare two semver versions.
 * Returns: -1 if a < b, 0 if a == b, 1 if a > b.
 * Pre-release versions are considered less than the release version.
 */
function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return 0;

  if (pa.major !== pb.major) return pa.major > pb.major ? 1 : -1;
  if (pa.minor !== pb.minor) return pa.minor > pb.minor ? 1 : -1;
  if (pa.patch !== pb.patch) return pa.patch > pb.patch ? 1 : -1;

  // Pre-release comparison
  if (pa.prerelease && !pb.prerelease) return -1; // pre-release < release
  if (!pa.prerelease && pb.prerelease) return 1; // release > pre-release
  if (pa.prerelease && pb.prerelease) {
    return pa.prerelease < pb.prerelease
      ? -1
      : pa.prerelease > pb.prerelease
        ? 1
        : 0;
  }

  return 0;
}

// ── Service Types ───────────────────────────────

export interface UpdateCheckResult {
  available: boolean;
  latest: string;
  downloadUrl: string;
  changelog: string | null;
  sizeBytes: number;
  checksumSha256: string | null;
  minUpgradeVersion: string | null;
  isCritical: number;
}

export interface UpdateReportInput {
  node_id: string;
  from_version: string;
  to_version: string;
  platform: string;
  success: boolean;
  error_message?: string;
  duration_ms?: number;
}

// ── Service Implementation ──────────────────────

export class UpdateService {
  /**
   * Check if an update is available for the given version, platform, and channel.
   * Returns the latest release info if a newer version exists, or null if up-to-date.
   */
  async checkForUpdate(
    currentVersion: string,
    platform: string,
    channel: string,
  ): Promise<UpdateCheckResult | null> {
    const db = getDb();

    // Find the latest release for this platform+channel, ordered by creation date.
    // No status filter — all rows are considered active.
    const rows = await db
      .select()
      .from(clientReleases)
      .where(
        and(
          eq(clientReleases.platform, platform),
          eq(clientReleases.channel, channel),
        ),
      )
      .orderBy(desc(clientReleases.publishedAt))
      .limit(20);

    if (rows.length === 0) {
      return null;
    }

    // Find the highest version using semver comparison
    let latest = rows[0]!;
    for (const row of rows) {
      if (compareSemver(row.version, latest.version) > 0) {
        latest = row;
      }
    }

    // Compare with current version
    if (compareSemver(latest.version, currentVersion) <= 0) {
      return null; // Already up-to-date
    }

    logger.info(
      {
        currentVersion,
        latestVersion: latest.version,
        platform,
        channel,
      },
      "Update available",
    );

    return {
      available: true,
      latest: latest.version,
      downloadUrl: latest.downloadUrl,
      changelog: latest.changelog,
      sizeBytes: latest.sizeBytes,
      checksumSha256: latest.checksumSha256,
      minUpgradeVersion: latest.minUpgradeVersion,
      isCritical: latest.isCritical,
    };
  }

  /**
   * Get the full manifest for a specific version.
   * Returns null if the version is not found.
   */
  async getManifest(
    version: string,
  ): Promise<Array<{
    version: string;
    platform: string;
    channel: string;
    downloadUrl: string;
    sizeBytes: number;
    changelog: string | null;
    checksumSha256: string | null;
    minUpgradeVersion: string | null;
    isCritical: number;
  }> | null> {
    const db = getDb();
    const normalizedVersion = version;

    // No status filter — all rows are considered active.
    const rows = await db
      .select()
      .from(clientReleases)
      .where(eq(clientReleases.version, normalizedVersion));

    // Also try with/without "v" prefix
    if (rows.length === 0) {
      const altVersion = normalizedVersion.startsWith("v")
        ? normalizedVersion.slice(1)
        : `v${normalizedVersion}`;

      const altRows = await db
        .select()
        .from(clientReleases)
        .where(eq(clientReleases.version, altVersion));

      if (altRows.length === 0) {
        return null;
      }

      return altRows.map((r) => ({
        version: r.version,
        platform: r.platform,
        channel: r.channel,
        downloadUrl: r.downloadUrl,
        sizeBytes: r.sizeBytes,
        changelog: r.changelog,
        checksumSha256: r.checksumSha256,
        minUpgradeVersion: r.minUpgradeVersion,
        isCritical: r.isCritical,
      }));
    }

    return rows.map((r) => ({
      version: r.version,
      platform: r.platform,
      channel: r.channel,
      downloadUrl: r.downloadUrl,
      sizeBytes: r.sizeBytes,
      changelog: r.changelog,
      checksumSha256: r.checksumSha256,
      minUpgradeVersion: r.minUpgradeVersion,
      isCritical: r.isCritical,
    }));
  }

  /**
   * Record an update report from a client node.
   * Maps boolean success to status string.
   */
  async recordReport(input: UpdateReportInput): Promise<string> {
    const db = getDb();
    const id = uuidv4();

    await db.insert(updateReports).values({
      id,
      nodeId: input.node_id,
      fromVersion: input.from_version,
      toVersion: input.to_version,
      platform: input.platform,
      status: input.success ? "success" : "failure",
      errorMessage: input.error_message ?? null,
      durationMs: input.duration_ms ?? null,
    });

    logger.info(
      {
        reportId: id,
        nodeId: input.node_id,
        from: input.from_version,
        to: input.to_version,
        success: input.success,
      },
      "Update report recorded",
    );

    return id;
  }
}
