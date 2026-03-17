/**
 * Company Context Generator — Dynamic template variable generation for A2A collaboration
 *
 * Generates the following template variables for role templates:
 *   ${company_roster}       — All AI employees table (name, role, responsibilities, status)
 *   ${org_chart}            — Organization chart (tree view)
 *   ${my_team}              — Role-specific team members
 *   ${collaboration_rules}  — Role-specific collaboration guidelines
 *
 * These variables are resolved into agentsMd templates so each agent's
 * workspace/AGENTS.md contains full company context for offline-capable collaboration.
 */

import { type MySql2Database } from "drizzle-orm/mysql2";
import { gte, and, isNotNull, desc } from "drizzle-orm";
import pino from "pino";
import { nodesTable } from "../evolution/schema.js";
import { roleJobDescriptionsTable } from "./job-descriptions-schema.js";

const logger = pino({ name: "module:roles:context-generator" });

/** 24-hour heartbeat cutoff for "active" nodes */
const HEARTBEAT_CUTOFF_MS = 24 * 60 * 60 * 1000;

// ── Types ────────────────────────────────────────

interface ActiveNode {
  nodeId: string;
  roleId: string | null;
  employeeId: string | null;
  employeeName: string | null;
  lastHeartbeat: Date | null;
}

interface JobDescription {
  roleId: string;
  displayName: string;
  summary: string;
  responsibilities: string;
  expertise: unknown; // JSON — string[]
  reportsTo: string | null;
  collaboration: unknown; // JSON — Record<string, string>
}

// ── CompanyContextGenerator ──────────────────────

export class CompanyContextGenerator {
  constructor(private db: MySql2Database) {}

  /**
   * Generate all context variables for a specific role.
   * Returns a Record<string, string> that can be spread into resolveTemplateVariables().
   */
  async generateAllContextVariables(
    roleId: string,
  ): Promise<Record<string, string>> {
    return {
      company_roster: await this.generateRoster(),
      org_chart: await this.generateOrgChart(),
      my_team: await this.generateMyTeam(roleId),
      collaboration_rules: await this.generateCollaborationRules(roleId),
    };
  }

  /**
   * Generate a markdown table of all AI employees with roles and status.
   *
   * Joins nodesTable with roleJobDescriptionsTable to include display name
   * and summary. Falls back to nodesTable-only if job descriptions table
   * is not yet available.
   */
  async generateRoster(): Promise<string> {
    const activeNodes = await this.getActiveNodes();

    if (activeNodes.length === 0) {
      return "(現在オンラインの社員はいません)";
    }

    const jobDescriptions = await this.getJobDescriptions();
    const jdMap = new Map(jobDescriptions.map((jd) => [jd.roleId, jd]));

    const header = [
      "| 社員名 | 社員番号 | 役職 | 担当領域 | 連絡方法 |",
      "|--------|---------|------|----------|----------|",
    ];

    const rows = activeNodes.map((node) => {
      const jd = node.roleId ? jdMap.get(node.roleId) : undefined;
      const name = node.employeeName ?? "(未設定)";
      const employeeId = node.employeeId ?? "-";
      const roleDisplay = jd?.displayName ?? node.roleId ?? "(未割当)";
      const summary = jd?.summary ?? "-";
      const contactMethod = node.roleId
        ? `grc_relay_send to_role_id="${node.roleId}"`
        : "-";

      return `| ${name} | ${employeeId} | ${roleDisplay} | ${summary} | ${contactMethod} |`;
    });

    return [...header, ...rows].join("\n");
  }

  /**
   * Generate an ASCII org chart showing reporting hierarchy.
   *
   * Uses reports_to from role_job_descriptions to build the tree.
   * Falls back to flat hierarchy (all report to CEO) if table is unavailable.
   */
  async generateOrgChart(): Promise<string> {
    const activeNodes = await this.getActiveNodes();
    const jobDescriptions = await this.getJobDescriptions();

    // Build a map of roleId -> active employee name
    const nodeByRole = new Map<string, ActiveNode>();
    for (const node of activeNodes) {
      if (node.roleId && !nodeByRole.has(node.roleId)) {
        nodeByRole.set(node.roleId, node);
      }
    }

    // If we have job descriptions, build tree from reports_to
    if (jobDescriptions.length > 0) {
      return this.buildOrgTree(jobDescriptions, nodeByRole);
    }

    // Fallback: flat hierarchy, all report to CEO
    return this.buildFlatOrgChart(activeNodes);
  }

  /**
   * Generate role-specific team member list.
   *
   * For CEO: lists all direct reports.
   * For others: lists CEO + peers in related departments.
   */
  async generateMyTeam(roleId: string): Promise<string> {
    const activeNodes = await this.getActiveNodes();
    const jobDescriptions = await this.getJobDescriptions();
    const nodeByRole = new Map<string, ActiveNode>();
    for (const node of activeNodes) {
      if (node.roleId && !nodeByRole.has(node.roleId)) {
        nodeByRole.set(node.roleId, node);
      }
    }

    const jdMap = new Map(jobDescriptions.map((jd) => [jd.roleId, jd]));
    const myJd = jdMap.get(roleId);

    if (roleId === "ceo") {
      // CEO sees all direct reports
      const directReports = jobDescriptions.filter(
        (jd) => jd.reportsTo === "ceo",
      );

      if (directReports.length === 0) {
        // Fallback: list all active nodes except self
        const others = activeNodes.filter((n) => n.roleId !== "ceo");
        if (others.length === 0) return "(直属の部下はいません)";
        return this.formatTeamList("あなたの直属の部下", others, jdMap);
      }

      const teamNodes = directReports
        .map((jd) => {
          const node = nodeByRole.get(jd.roleId);
          return node
            ? node
            : ({
                nodeId: "",
                roleId: jd.roleId,
                employeeId: null,
                employeeName: null,
                lastHeartbeat: null,
              } as ActiveNode);
        });

      return this.formatTeamList("あなたの直属の部下", teamNodes, jdMap);
    }

    // Non-CEO: show reporting chain + collaborators
    const lines: string[] = [];

    // 1. Report-to (boss)
    const reportsTo = myJd?.reportsTo ?? "ceo";
    const bossNode = nodeByRole.get(reportsTo);
    const bossJd = jdMap.get(reportsTo);
    const bossName = bossNode?.employeeName ?? "(未配置)";
    const bossDisplay = bossJd?.displayName ?? reportsTo;
    lines.push(`### 上司`);
    lines.push(`- ${bossName} (${bossDisplay}) — grc_relay_send to_role_id="${reportsTo}"`);
    lines.push("");

    // 2. Collaboration partners from job description
    const collabJson = myJd?.collaboration;
    const collaboration = this.parseCollaboration(collabJson);
    if (Object.keys(collaboration).length > 0) {
      lines.push("### 連携先");
      for (const [partnerRoleId, reason] of Object.entries(collaboration)) {
        const partnerNode = nodeByRole.get(partnerRoleId);
        const partnerJd = jdMap.get(partnerRoleId);
        const partnerName = partnerNode?.employeeName ?? "(未配置)";
        const partnerDisplay = partnerJd?.displayName ?? partnerRoleId;
        lines.push(
          `- ${partnerName} (${partnerDisplay}) — ${reason} — grc_relay_send to_role_id="${partnerRoleId}"`,
        );
      }
    } else {
      // Fallback: list peers (same reporting level)
      const peers = activeNodes.filter(
        (n) => n.roleId !== roleId && n.roleId !== "ceo",
      );
      if (peers.length > 0) {
        lines.push("### 同僚");
        for (const peer of peers) {
          const peerJd = peer.roleId ? jdMap.get(peer.roleId) : undefined;
          const peerDisplay = peerJd?.displayName ?? peer.roleId ?? "(未割当)";
          lines.push(
            `- ${peer.employeeName ?? "(未設定)"} (${peerDisplay}) — grc_relay_send to_role_id="${peer.roleId}"`,
          );
        }
      }
    }

    return lines.join("\n");
  }

  /**
   * Generate role-specific collaboration rules.
   *
   * Uses collaboration JSON from role_job_descriptions to build a scenario table
   * with actual employee names from active nodes.
   */
  async generateCollaborationRules(roleId: string): Promise<string> {
    const activeNodes = await this.getActiveNodes();
    const jobDescriptions = await this.getJobDescriptions();
    const nodeByRole = new Map<string, ActiveNode>();
    for (const node of activeNodes) {
      if (node.roleId && !nodeByRole.has(node.roleId)) {
        nodeByRole.set(node.roleId, node);
      }
    }

    const jdMap = new Map(jobDescriptions.map((jd) => [jd.roleId, jd]));
    const myJd = jdMap.get(roleId);

    const lines: string[] = [];
    lines.push("### あなたの協働ガイド");
    lines.push("");

    // Build scenario table
    if (roleId === "ceo") {
      // CEO: can contact all departments
      lines.push("| 場面 | 連絡先 | ツール |");
      lines.push("|------|--------|--------|");

      for (const jd of jobDescriptions) {
        if (jd.roleId === "ceo") continue;
        const node = nodeByRole.get(jd.roleId);
        const name = node?.employeeName ?? "(未配置)";
        const expertise = this.parseExpertise(jd.expertise);
        const expertiseStr =
          expertise.length > 0 ? expertise.slice(0, 2).join("・") : jd.summary;
        lines.push(
          `| ${expertiseStr} | ${name} (${jd.displayName}) | grc_relay_send to_role_id="${jd.roleId}" |`,
        );
      }

      lines.push(
        `| 全員への通知 | 全社員 | grc_broadcast |`,
      );
    } else {
      // Non-CEO: use collaboration JSON or build from job descriptions
      const collaboration = this.parseCollaboration(myJd?.collaboration);

      lines.push("| 場面 | 連絡先 | ツール |");
      lines.push("|------|--------|--------|");

      if (Object.keys(collaboration).length > 0) {
        for (const [partnerRoleId, reason] of Object.entries(collaboration)) {
          const partnerNode = nodeByRole.get(partnerRoleId);
          const partnerJd = jdMap.get(partnerRoleId);
          const partnerName = partnerNode?.employeeName ?? "(未配置)";
          const partnerDisplay = partnerJd?.displayName ?? partnerRoleId;
          lines.push(
            `| ${reason} | ${partnerName} (${partnerDisplay}) | grc_relay_send to_role_id="${partnerRoleId}" |`,
          );
        }
      } else {
        // Fallback: at minimum, show CEO as escalation path
        const ceoNode = nodeByRole.get("ceo");
        const ceoName = ceoNode?.employeeName ?? "(未配置)";
        lines.push(
          `| 経営判断・承認 | ${ceoName} (CEO) | grc_relay_send to_role_id="ceo" |`,
        );
      }

      // Always show CEO escalation for non-CEO roles (if not already in collaboration)
      const collaboration2 = this.parseCollaboration(myJd?.collaboration);
      if (!("ceo" in collaboration2)) {
        const ceoNode = nodeByRole.get("ceo");
        const ceoName = ceoNode?.employeeName ?? "(未配置)";
        lines.push(
          `| 経営判断・承認・エスカレーション | ${ceoName} (CEO) | grc_relay_send to_role_id="ceo" |`,
        );
      }

      lines.push(
        `| 全体通知 | 全社員 | grc_broadcast |`,
      );
    }

    lines.push("");
    lines.push("### 重要なルール");
    lines.push("1. タスク委任: 専門外は該当社員に委任");
    lines.push("2. 承認フロー: 重要決定は関連部門の報告後に判断");
    lines.push("3. 全体通知: grc_broadcast を使用");
    lines.push("4. 社員状態確認: grc_roster でオンライン状態を確認");

    return lines.join("\n");
  }

  // ── Private helpers ────────────────────────────

  /**
   * Fetch all active nodes (heartbeat within 24h, roleId assigned).
   */
  private async getActiveNodes(): Promise<ActiveNode[]> {
    const cutoff = new Date(Date.now() - HEARTBEAT_CUTOFF_MS);

    const nodes = await this.db
      .select({
        nodeId: nodesTable.nodeId,
        roleId: nodesTable.roleId,
        employeeId: nodesTable.employeeId,
        employeeName: nodesTable.employeeName,
        lastHeartbeat: nodesTable.lastHeartbeat,
      })
      .from(nodesTable)
      .where(
        and(
          isNotNull(nodesTable.roleId),
          gte(nodesTable.lastHeartbeat, cutoff),
        ),
      )
      .orderBy(desc(nodesTable.lastHeartbeat));

    // Deduplicate: keep latest heartbeat per roleId
    const seen = new Set<string>();
    const result: ActiveNode[] = [];

    for (const n of nodes) {
      if (!n.roleId || seen.has(n.roleId)) continue;
      seen.add(n.roleId);
      result.push(n);
    }

    return result;
  }

  /**
   * Fetch all role job descriptions. Returns empty array if table doesn't exist.
   */
  private async getJobDescriptions(): Promise<JobDescription[]> {
    try {
      const rows = await this.db
        .select({
          roleId: roleJobDescriptionsTable.roleId,
          displayName: roleJobDescriptionsTable.displayName,
          summary: roleJobDescriptionsTable.summary,
          responsibilities: roleJobDescriptionsTable.responsibilities,
          expertise: roleJobDescriptionsTable.expertise,
          reportsTo: roleJobDescriptionsTable.reportsTo,
          collaboration: roleJobDescriptionsTable.collaboration,
        })
        .from(roleJobDescriptionsTable);

      return rows;
    } catch (err) {
      // Table might not exist yet (Coder 1 may not have run migrations)
      logger.warn(
        { err: (err as Error).message },
        "Failed to query role_job_descriptions — falling back to nodesTable only",
      );
      return [];
    }
  }

  /**
   * Build an ASCII org chart tree from job descriptions and active nodes.
   */
  private buildOrgTree(
    jobDescriptions: JobDescription[],
    nodeByRole: Map<string, ActiveNode>,
  ): string {
    const jdMap = new Map(jobDescriptions.map((jd) => [jd.roleId, jd]));

    // Find root (reportsTo === null, typically CEO)
    const roots = jobDescriptions.filter((jd) => !jd.reportsTo);
    // Find children per parent
    const childrenMap = new Map<string, JobDescription[]>();
    for (const jd of jobDescriptions) {
      if (jd.reportsTo) {
        const siblings = childrenMap.get(jd.reportsTo) ?? [];
        siblings.push(jd);
        childrenMap.set(jd.reportsTo, siblings);
      }
    }

    const lines: string[] = [];

    const renderNode = (
      jd: JobDescription,
      prefix: string,
      isLast: boolean,
      isRoot: boolean,
    ) => {
      const node = nodeByRole.get(jd.roleId);
      const name = node?.employeeName ?? "(未配置)";
      const connector = isRoot ? "" : isLast ? "└── " : "├── ";
      lines.push(`${prefix}${connector}${jd.displayName} — ${name}`);

      const children = childrenMap.get(jd.roleId) ?? [];
      const childPrefix = isRoot
        ? ""
        : prefix + (isLast ? "    " : "│   ");

      children.forEach((child, i) => {
        renderNode(child, childPrefix, i === children.length - 1, false);
      });
    };

    if (roots.length === 0) {
      // No root found — use flat rendering
      return this.buildFlatOrgChart(
        Array.from(nodeByRole.values()),
      );
    }

    for (const root of roots) {
      renderNode(root, "", false, true);
    }

    // Add roles that have active nodes but no job description entry
    const describedRoles = new Set(jobDescriptions.map((jd) => jd.roleId));
    for (const [roleId, node] of nodeByRole) {
      if (!describedRoles.has(roleId)) {
        const name = node.employeeName ?? "(未設定)";
        lines.push(`├── ${roleId} — ${name}`);
      }
    }

    return lines.join("\n");
  }

  /**
   * Fallback: flat org chart when job descriptions table is unavailable.
   * Assumes all roles report to CEO.
   */
  private buildFlatOrgChart(activeNodes: ActiveNode[]): string {
    const ceoNode = activeNodes.find((n) => n.roleId === "ceo");
    const others = activeNodes.filter((n) => n.roleId !== "ceo");

    const lines: string[] = [];

    const ceoName = ceoNode?.employeeName ?? "(未配置)";
    lines.push(`CEO — ${ceoName}`);

    others.forEach((node, i) => {
      const name = node.employeeName ?? "(未設定)";
      const role = node.roleId ?? "(未割当)";
      const connector = i === others.length - 1 ? "└── " : "├── ";
      lines.push(`${connector}${role} — ${name}`);
    });

    if (others.length === 0 && !ceoNode) {
      return "(組織図データがありません)";
    }

    return lines.join("\n");
  }

  /**
   * Format a team member list as markdown.
   */
  private formatTeamList(
    title: string,
    nodes: ActiveNode[],
    jdMap: Map<string, JobDescription>,
  ): string {
    const lines: string[] = [];
    lines.push(`### ${title}`);
    lines.push("");

    for (const node of nodes) {
      const jd = node.roleId ? jdMap.get(node.roleId) : undefined;
      const name = node.employeeName ?? "(未配置)";
      const roleDisplay = jd?.displayName ?? node.roleId ?? "(未割当)";
      const summary = jd?.summary ?? "";
      const contactInfo = node.roleId
        ? `grc_relay_send to_role_id="${node.roleId}"`
        : "-";

      lines.push(`- **${name}** (${roleDisplay}) — ${summary}`);
      lines.push(`  連絡: ${contactInfo}`);
    }

    return lines.join("\n");
  }

  /**
   * Safely parse collaboration JSON field.
   * Expected: Record<string, string> e.g. {"finance": "予算承認", "engineering": "技術判断"}
   */
  private parseCollaboration(
    value: unknown,
  ): Record<string, string> {
    if (!value) return {};

    try {
      const parsed = typeof value === "string" ? JSON.parse(value) : value;
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, string>;
      }
    } catch {
      // ignore parse errors
    }

    return {};
  }

  /**
   * Safely parse expertise JSON field.
   * Expected: string[] e.g. ["経営戦略", "意思決定"]
   */
  private parseExpertise(value: unknown): string[] {
    if (!value) return [];

    try {
      const parsed = typeof value === "string" ? JSON.parse(value) : value;
      if (Array.isArray(parsed)) {
        return parsed.map(String);
      }
    } catch {
      // ignore parse errors
    }

    return [];
  }
}
