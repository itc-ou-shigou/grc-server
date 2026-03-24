#!/usr/bin/env node
// scripts/update-heartbeats.mjs
// Usage: node scripts/update-heartbeats.mjs [--dry-run] [--update-sqlite <path>] [--update-mysql <url>]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DRY_RUN = process.argv.includes("--dry-run");
const SQLITE_IDX = process.argv.indexOf("--update-sqlite");
const SQLITE_PATH = SQLITE_IDX >= 0 ? process.argv[SQLITE_IDX + 1] : null;
const MYSQL_IDX = process.argv.indexOf("--update-mysql");
const MYSQL_URL = MYSQL_IDX >= 0 ? process.argv[MYSQL_IDX + 1] : null;

// ── New universal heartbeat block ──
const NEW_HEARTBEAT_BLOCK = `## Every Heartbeat (MANDATORY — Execute First)

### Step 1: Check & Claim GRC Tasks
Use \`grc_task_update\` to find and claim YOUR pending tasks:
- Find all tasks where you are the assignee (by \`target_role_id\` matching your role)
- For each task in \`pending\` or \`draft\` status:
  - Immediately call \`grc_task_update\` to set status to \`in_progress\`
  - Begin executing the task
- For each task in \`review\` with feedback:
  - Address the feedback immediately
  - Re-submit via \`grc_task_complete\`
- For tasks with deadlines within 24 hours: prioritize these first

### Step 2: Check GRC Messages
- Check for any unread relay messages requiring your response
- Respond to priority/critical messages immediately via \`grc_relay_send\`

### Step 3: Execute Tasks
- For complex tasks (multi-step, research, design, analysis): use **clawteam** tool for parallel execution
- For simple tasks (updates, reports, notifications): execute directly
- If blocked, immediately report to CEO via \`grc_relay_send\` to_role_id="ceo"

### Step 4: If No Tasks Found
- Review your department's strategy via GET /a2a/strategy/summary
- Identify gaps and proactively create tasks aligned with company quarterly goals
- Post progress or questions to Community Forum
- Reply HEARTBEAT_OK only if truly nothing needs attention`;

// ── Department-specific additions ──
const DEPT_ADDITIONS = {
  "Engineering": "\n\n## Engineering Department Checks\n- On each heartbeat: check CI/CD pipeline status and build failures\n- Monitor error rates, latency dashboards, and security alerts\n- If no GRC tasks: review technical debt backlog, create prioritized fix tasks\n- For development tasks: use clawteam for code implementation with review cycle",
  "Design": "\n\n## Design Department Checks\n- On each heartbeat: check design review request queue\n- Monitor design system consistency and component adoption rates\n- If no GRC tasks: audit design library for gaps, create improvement tasks",
  "Testing": "\n\n## Testing Department Checks\n- On each heartbeat: check test pipeline results and failure rates\n- Monitor regression test suite health and coverage metrics\n- If no GRC tasks: identify untested critical paths, create test tasks",
  "Marketing": "\n\n## Marketing Department Checks\n- On each heartbeat: check campaign metrics and content calendar deadlines\n- Monitor ad spend pacing, engagement rates, and conversion funnels\n- If no GRC tasks: review upcoming deadlines, create content tasks\n- For campaigns involving spend: confirm budget approval with finance",
  "Sales": "\n\n## Sales Department Checks\n- On each heartbeat: check pipeline status and deal stage updates\n- Monitor customer follow-up deadlines and proposal due dates\n- If no GRC tasks: review stale opportunities, create outreach tasks",
  "Paid Media": "\n\n## Paid Media Department Checks\n- On each heartbeat: check ad campaign performance and budget pacing\n- Monitor ROAS, CPA, and conversion tracking accuracy\n- If no GRC tasks: audit active campaigns for optimization",
  "Support": "\n\n## Support Department Checks\n- On each heartbeat: check open ticket queue and SLA deadlines\n- Monitor customer satisfaction scores and escalation trends\n- If no GRC tasks: review knowledge base for outdated articles",
  "Product": "\n\n## Product Department Checks\n- On each heartbeat: check user feedback queue and feature request trends\n- Monitor product KPIs and user engagement metrics\n- If no GRC tasks: analyze user behavior data, create insight tasks",
  "Project Management": "\n\n## Project Management Checks\n- On each heartbeat: check project milestone status and blockers\n- Monitor sprint velocity and deadline compliance across teams\n- If no GRC tasks: review cross-team dependencies, create coordination tasks",
  "Data": "\n\n## Data Department Checks\n- On each heartbeat: check data pipeline health and processing job status\n- Monitor data quality metrics and anomaly detection alerts\n- If no GRC tasks: profile datasets for quality issues, create remediation tasks",
  "Business": "\n\n## Business Department Checks\n- On each heartbeat: check strategic initiative status and KPI progress\n- Monitor risk register and compliance deadlines\n- If no GRC tasks: scan for process improvement opportunities",
  "Operations": "\n\n## Operations Department Checks\n- On each heartbeat: check infrastructure monitoring dashboards and alerts\n- Monitor system availability, capacity utilization, and incident queue\n- If no GRC tasks: review infrastructure for optimization",
  "Game Development": "\n\n## Game Development Checks\n- On each heartbeat: check milestone status and build stability\n- Monitor game performance metrics and asset budget compliance\n- If no GRC tasks: audit game design documents for completeness gaps",
  "Game Development — Unity": "\n\n## Unity Development Checks\n- On each heartbeat: check Unity build status and test results\n- Monitor frame rate, memory usage, and shader compilation times",
  "Game Development — Unreal Engine": "\n\n## Unreal Engine Checks\n- On each heartbeat: check UE build pipeline and packaging status\n- Monitor rendering performance and memory budgets",
  "Game Development — Godot": "\n\n## Godot Development Checks\n- On each heartbeat: check Godot project build status\n- Monitor GDScript performance and node tree efficiency",
  "Game Development — Roblox": "\n\n## Roblox Development Checks\n- On each heartbeat: check publish status and experience analytics\n- Monitor concurrent user metrics and server performance",
  "Game Development — Blender": "\n\n## Blender Development Checks\n- On each heartbeat: check addon compatibility with latest Blender version",
  "Spatial Computing": "\n\n## Spatial Computing Checks\n- On each heartbeat: check XR build status and device compatibility\n- Monitor frame timing, latency, and spatial tracking accuracy",
  "Specialized": "\n\n## Specialized Agent Checks\n- On each heartbeat: check your specific domain data sources and queues\n- Monitor your domain-specific KPIs and alert thresholds\n- If no GRC tasks: run proactive analysis, create insight tasks",
};

function updateHeartbeat(heartbeatMd, department) {
  if (!heartbeatMd) return heartbeatMd;
  let updated = heartbeatMd;

  // Step 1: Replace ALL variants of "Priority Order" with new 4-step block
  // Handles: "## Priority Order (every session)", "## Priority Order (Every Session)",
  //          "## Priority Order", "## Priority Order (continuous)", etc.
  const priorityRegex = /## Priority Order(?:\s*\([^)]*\))?[\s\S]*?(?=\n## (?:Daily|Weekly|Monthly|Every ))/i;
  if (priorityRegex.test(updated)) {
    updated = updated.replace(priorityRegex, NEW_HEARTBEAT_BLOCK + "\n\n");
  }

  // Step 2: Remove duplicate checklist at bottom (## Daily (09:00) to end)
  const dupRegex = /\n## Daily \(09:00\)[\s\S]*$/;
  if (dupRegex.test(updated)) {
    updated = updated.replace(dupRegex, "");
  }

  // Step 3: Append department-specific content (with idempotency guard)
  const addition = DEPT_ADDITIONS[department];
  if (addition && !updated.includes(addition.trim())) {
    updated = updated.trimEnd() + addition;
  }

  return updated;
}

// ── Main: Update JSON file ──
const jsonPath = path.resolve(__dirname, "role-templates-import.json");
const data = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
let changed = 0;
const results = [];

for (const role of data) {
  const before = role.heartbeat_md;
  const after = updateHeartbeat(before, role.department);
  if (before !== after) {
    role.heartbeat_md = after;
    changed++;
    results.push({ id: role.id, department: role.department });
    if (DRY_RUN) {
      console.log(`[DRY-RUN] ${role.id} (${role.department})`);
    }
  }
}

console.log(`\nJSON: Total=${data.length}, Changed=${changed}`);

if (!DRY_RUN) {
  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2) + "\n", "utf-8");
  console.log(`Written to ${jsonPath}`);
}

// ── Update SQLite database ──
if (SQLITE_PATH && !DRY_RUN) {
  console.log(`\nUpdating SQLite: ${SQLITE_PATH}`);
  try {
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(SQLITE_PATH);
    const stmt = db.prepare("UPDATE role_templates SET heartbeat_md = ? WHERE id = ?");
    const tx = db.transaction(() => {
      let dbChanged = 0;
      for (const role of data) {
        const result = stmt.run(role.heartbeat_md, role.id);
        if (result.changes > 0) dbChanged++;
      }
      return dbChanged;
    });
    const dbChanged = tx();
    console.log(`SQLite: ${dbChanged} rows updated`);
    db.close();
  } catch (err) {
    console.error(`SQLite error: ${err.message}`);
  }
}

// ── Update MySQL database ──
if (MYSQL_URL && !DRY_RUN) {
  console.log(`\nUpdating MySQL: ${MYSQL_URL.replace(/:[^:@]+@/, ':***@')}`);
  try {
    const mysql = (await import("mysql2/promise")).default;
    const pool = await mysql.createPool(MYSQL_URL);
    const conn = await pool.getConnection();
    await conn.beginTransaction();
    let mysqlChanged = 0;
    try {
      for (const role of data) {
        const [result] = await conn.execute(
          "UPDATE role_templates SET heartbeat_md = ? WHERE id = ?",
          [role.heartbeat_md, role.id]
        );
        if (result.changedRows > 0) mysqlChanged++;
      }
      await conn.commit();
      console.log(`MySQL: ${mysqlChanged} rows updated (committed)`);
    } catch (txErr) {
      await conn.rollback();
      throw txErr;
    } finally {
      conn.release();
    }
    await pool.end();
  } catch (err) {
    console.error(`MySQL error: ${err.message}`);
  }
}

// ── Verification ──
console.log("\n=== Verification ===");
const hasNew = data.filter(r => r.heartbeat_md?.includes("Step 1: Check & Claim")).length;
const hasOld = data.filter(r => r.heartbeat_md?.includes("Priority Order (every session)")).length;
const hasDup = data.filter(r => r.heartbeat_md?.includes("## Daily (09:00)")).length;
console.log(`✓ New format: ${hasNew}/${data.length}`);
console.log(`✗ Old format remaining: ${hasOld}`);
console.log(`✗ Duplicate checklist remaining: ${hasDup}`);
