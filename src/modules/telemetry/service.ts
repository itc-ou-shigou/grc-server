/**
 * Telemetry Module — Service Implementation
 *
 * Handles anonymous telemetry report upsert and aggregated insights computation.
 * All data is anonymized; only aggregate statistics are exposed publicly.
 */

import { eq, and, sql, count } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import pino from "pino";
import { getDb } from "../../shared/db/connection.js";
import { telemetryReports } from "./schema.js";

const logger = pino({ name: "telemetry:service" });

// ── Types ───────────────────────────────────────

export interface TelemetryReportInput {
  node_id: string;
  report_date: string;
  skill_calls?: unknown;
  gene_usage?: unknown;
  capsule_usage?: unknown;
  platform?: string;
  winclaw_version?: string;
  session_count?: number;
  active_minutes?: number;
}

export interface TelemetryInsights {
  totalNodes: number;
  reportDates: number;
  platformDistribution: Record<string, number>;
  topSkills: Array<{ name: string; totalInvocations: number }>;
  versionDistribution: Record<string, number>;
}

// ── Service Implementation ──────────────────────

export class TelemetryService {
  /**
   * Upsert a telemetry report by node_id + report_date.
   * If a report already exists for the same node and date, it is updated.
   * Returns the report ID.
   */
  async upsertReport(input: TelemetryReportInput): Promise<string> {
    const db = getDb();

    // Generate an anonymous ID from the node_id for privacy
    const anonymousId = `anon-${Buffer.from(input.node_id).toString("base64url").slice(0, 16)}`;

    // Parse report_date string to Date object for Drizzle date column
    const reportDateObj = new Date(input.report_date);

    // Check if a report already exists for this node+reportDate
    const existing = await db
      .select({ id: telemetryReports.id })
      .from(telemetryReports)
      .where(
        and(
          eq(telemetryReports.nodeId, input.node_id),
          eq(telemetryReports.reportDate, reportDateObj),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      // Update existing report
      const id = existing[0]!.id;
      await db
        .update(telemetryReports)
        .set({
          anonymousId,
          skillCalls: input.skill_calls ?? null,
          geneUsage: input.gene_usage ?? null,
          capsuleUsage: input.capsule_usage ?? null,
          platform: input.platform ?? null,
          winclawVersion: input.winclaw_version ?? null,
          sessionCount: input.session_count ?? 0,
          activeMinutes: input.active_minutes ?? 0,
        })
        .where(eq(telemetryReports.id, id));

      logger.debug(
        { reportId: id, nodeId: input.node_id, reportDate: input.report_date },
        "Telemetry report updated",
      );
      return id;
    }

    // Insert new report (id has default UUID() in schema, but we provide one for logging)
    const id = uuidv4();
    await db.insert(telemetryReports).values({
      id,
      nodeId: input.node_id,
      anonymousId,
      reportDate: reportDateObj,
      skillCalls: input.skill_calls ?? null,
      geneUsage: input.gene_usage ?? null,
      capsuleUsage: input.capsule_usage ?? null,
      platform: input.platform ?? null,
      winclawVersion: input.winclaw_version ?? null,
      sessionCount: input.session_count ?? 0,
      activeMinutes: input.active_minutes ?? 0,
    });

    logger.debug(
      { reportId: id, nodeId: input.node_id, reportDate: input.report_date },
      "Telemetry report created",
    );
    return id;
  }

  /**
   * Compute aggregated, anonymized telemetry insights.
   * Returns platform distribution, top skills, version distribution, etc.
   */
  async getInsights(): Promise<TelemetryInsights> {
    const db = getDb();

    // Total unique nodes
    const totalNodesResult = await db
      .select({
        total: sql<number>`COUNT(DISTINCT ${telemetryReports.nodeId})`,
      })
      .from(telemetryReports);
    const totalNodes = totalNodesResult[0]?.total ?? 0;

    // Total unique report dates
    const reportDatesResult = await db
      .select({
        total: sql<number>`COUNT(DISTINCT ${telemetryReports.reportDate})`,
      })
      .from(telemetryReports);
    const reportDates = reportDatesResult[0]?.total ?? 0;

    // Platform distribution: count nodes per platform from the dedicated column
    const platformRows = await db
      .select({
        platform: telemetryReports.platform,
        nodeCount: sql<number>`COUNT(DISTINCT ${telemetryReports.nodeId})`,
      })
      .from(telemetryReports)
      .where(sql`${telemetryReports.platform} IS NOT NULL`)
      .groupBy(telemetryReports.platform);

    const platformDistribution: Record<string, number> = {};
    for (const row of platformRows) {
      if (row.platform && row.platform !== "null") {
        platformDistribution[row.platform] = row.nodeCount;
      }
    }

    // Version distribution: count nodes per winclaw_version from the dedicated column
    const versionRows = await db
      .select({
        version: telemetryReports.winclawVersion,
        nodeCount: sql<number>`COUNT(DISTINCT ${telemetryReports.nodeId})`,
      })
      .from(telemetryReports)
      .where(sql`${telemetryReports.winclawVersion} IS NOT NULL`)
      .groupBy(telemetryReports.winclawVersion);

    const versionDistribution: Record<string, number> = {};
    for (const row of versionRows) {
      if (row.version && row.version !== "null") {
        versionDistribution[row.version] = row.nodeCount;
      }
    }

    // Top skills: aggregate invocation counts across all reports
    // skill_calls is a JSON array of { name, invocations }
    // We use JSON_TABLE to unnest the array (MySQL 8.0+)
    const skillRows = await db.execute(
      sql`SELECT
            jt.skill_name AS name,
            SUM(jt.invocations) AS total_invocations
          FROM ${telemetryReports},
          JSON_TABLE(
            ${telemetryReports.skillCalls},
            '$[*]' COLUMNS (
              skill_name VARCHAR(255) PATH '$.name',
              invocations INT PATH '$.invocations'
            )
          ) AS jt
          WHERE ${telemetryReports.skillCalls} IS NOT NULL
          GROUP BY jt.skill_name
          ORDER BY total_invocations DESC
          LIMIT 20`,
    );

    const topSkills: Array<{ name: string; totalInvocations: number }> = [];
    const skillResult = skillRows as unknown as Array<
      Array<{ name: string; total_invocations: number }>
    >;
    if (Array.isArray(skillResult) && Array.isArray(skillResult[0])) {
      for (const row of skillResult[0]) {
        topSkills.push({
          name: row.name,
          totalInvocations: Number(row.total_invocations),
        });
      }
    }

    return {
      totalNodes,
      reportDates,
      platformDistribution,
      topSkills,
      versionDistribution,
    };
  }
}
