#!/usr/bin/env node
// scripts/upgrade-roles-v2.mjs
// Applies 3 improvements to all 184 role templates:
//   P0: Step 3.5 Deliverable Quality Gate (heartbeat_md)
//   P1: Step 1.5 Task Decomposition + Step 3b Progress Visibility (heartbeat_md)
//   P2: Deliverable Templates section (agents_md)
//
// Usage:
//   node scripts/upgrade-roles-v2.mjs --dry-run
//   node scripts/upgrade-roles-v2.mjs --update-sqlite <path> --update-mysql <url>

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DRY_RUN = process.argv.includes("--dry-run");
const SQLITE_IDX = process.argv.indexOf("--update-sqlite");
const SQLITE_PATH = SQLITE_IDX >= 0 ? process.argv[SQLITE_IDX + 1] : null;
const MYSQL_IDX = process.argv.indexOf("--update-mysql");
const MYSQL_URL = MYSQL_IDX >= 0 ? process.argv[MYSQL_IDX + 1] : null;

// ════════════════════════════════════════════
// P0: Step 3.5 — Deliverable Quality Gate
// ════════════════════════════════════════════
const STEP_3_5 = `
### Step 3.5: Deliverable Quality Gate (MANDATORY before grc_task_complete)
Before calling grc_task_complete, verify EVERY deliverable meets ALL criteria below:

| # | Criterion | How to Verify |
|---|-----------|---------------|
| 1 | **Concrete file** — Each deliverable must be a saved file or embedded full content in result_data | Write to workspace/ or include complete content |
| 2 | **Reviewable** — A peer agent could review it and find it complete or incomplete | Include enough detail: sections, data, analysis — not summaries |
| 3 | **Matches task description** — Every item in task deliverables is addressed | Cross-check deliverables array item by item |
| 4 | **No placeholders** — No "TBD", "to be determined", "will add later" | Every section must have actual content |

**DO NOT submit if any criterion fails.** If blocked on content quality, report the blocker to CEO.`;

// ════════════════════════════════════════════
// P1: Step 1.5 — Task Decomposition
// ════════════════════════════════════════════
const STEP_1_5 = `
### Step 1.5: Task Decomposition (for complex tasks)
When you receive or claim a task that requires 3+ steps or spans 2+ days:
1. Break it into sub-tasks using grc_task (set priority matching parent)
2. Reference parent task in sub-task notes (e.g., "Parent: TSK-XXX")
3. Assign sub-tasks to yourself with clear staggered deadlines
4. Then begin executing sub-tasks in order

Benefits: CEO and peers can see your progress in real-time; blockers are visible early.`;

// ════════════════════════════════════════════
// P1: Step 3b — Progress Visibility
// ════════════════════════════════════════════
const STEP_3B = `
### Step 3b: Progress Visibility (MANDATORY)
While working on a task:
- Update task status to in_progress immediately upon claiming
- For multi-step tasks: update grc_task_update result_summary with current progress at least every 2 hours
- When completing a sub-task: call grc_task_complete with actual result_data content, not just "done"
- When completing a parent task: verify ALL sub-tasks are completed first`;

// ════════════════════════════════════════════
// P2: Department Deliverable Templates (agents_md)
// ════════════════════════════════════════════
const DEPT_TEMPLATES = {
  "Engineering": `

## Deliverable Templates

### Architecture Decision Record (ADR)
\`\`\`
# ADR-{NNN}: {Title}
## Status: Proposed | Accepted | Deprecated
## Context
(Why this decision was needed. What forces are at play.)
## Decision
(What was decided. Be specific about technology, pattern, or approach.)
## Consequences
(What are the positive and negative outcomes.)
## Alternatives Considered
(What other options were evaluated and why they were rejected.)
\`\`\`

### Technical Spec Document
\`\`\`
# {Feature Name} — Technical Specification
## Overview (1 paragraph)
## Requirements
- [ ] Req 1
## Design
(Include diagram or table)
## API Endpoints
| Method | Path | Description | Auth |
|--------|------|-------------|------|
## Implementation Plan
| Step | Description | Effort | Dependencies |
|------|-------------|--------|-------------|
## Testing Strategy
## Risks & Mitigations
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
\`\`\``,

  "Design": `

## Deliverable Templates

### Design Spec
\`\`\`
# {Feature/Component} — Design Specification
## Problem Statement
## User Personas Affected
## Design Direction
(Include wireframes or mockup descriptions)
## Component Inventory
| Component | State | Variants | Accessibility |
|-----------|-------|----------|---------------|
## Design Tokens
| Token | Value | Usage |
|-------|-------|-------|
## Interaction Patterns
## Handoff Notes for Engineering
\`\`\``,

  "Testing": `

## Deliverable Templates

### Test Plan
\`\`\`
# {Feature} — Test Plan
## Scope
## Test Strategy (unit/integration/e2e)
## Test Cases
| ID | Scenario | Steps | Expected Result | Priority |
|----|----------|-------|----------------|----------|
## Coverage Targets
## Risk Areas
## Environment Requirements
\`\`\``,

  "Marketing": `

## Deliverable Templates

### Campaign Brief
\`\`\`
# {Campaign Name} — Campaign Brief
## Objective
## Target Audience
| Segment | Size | Channel | Message |
|---------|------|---------|---------|
## Content Calendar
| Date | Channel | Content Type | Status |
|------|---------|-------------|--------|
## Budget
| Item | Amount | ROI Target |
|------|--------|-----------|
## KPIs
| Metric | Target | Measurement Method |
|--------|--------|--------------------|
## Success Criteria
\`\`\``,

  "Sales": `

## Deliverable Templates

### Deal Review
\`\`\`
# {Account} — Deal Review
## Deal Summary
| Field | Value |
|-------|-------|
| Stage | |
| Value | |
| Close Date | |
## Decision Makers
| Name | Role | Influence | Status |
|------|------|-----------|--------|
## Competition
## Next Steps
| Action | Owner | Due Date |
|--------|-------|----------|
## Risk Assessment
\`\`\``,

  "Paid Media": `

## Deliverable Templates

### Campaign Performance Report
\`\`\`
# {Campaign} — Performance Report ({Period})
## Summary
| Metric | Actual | Target | % of Target |
|--------|--------|--------|-------------|
| Spend | | | |
| ROAS | | | |
| CPA | | | |
## Channel Breakdown
| Channel | Spend | Conversions | CPA | ROAS |
|---------|-------|-------------|-----|------|
## Optimization Actions
| Action | Expected Impact | Priority |
|--------|----------------|----------|
\`\`\``,

  "Support": `

## Deliverable Templates

### Knowledge Base Article
\`\`\`
# {Title}
## Problem
## Solution
## Steps
1. Step 1
2. Step 2
## Related Articles
## Tags
\`\`\``,

  "Product": `

## Deliverable Templates

### Product Requirements Document (PRD)
\`\`\`
# {Feature} — PRD
## Problem Statement
## User Stories
| As a... | I want... | So that... | Priority |
|---------|-----------|-----------|----------|
## Success Metrics
| Metric | Current | Target | Timeline |
|--------|---------|--------|----------|
## Requirements
### Must Have
### Nice to Have
## Wireframes/Mockups
## Technical Constraints
\`\`\``,

  "Project Management": `

## Deliverable Templates

### Project Status Report
\`\`\`
# {Project} — Status Report ({Date})
## Overall Status: 🟢 On Track | 🟡 At Risk | 🔴 Blocked
## Milestones
| Milestone | Due | Status | Notes |
|-----------|-----|--------|-------|
## Blockers
| Blocker | Owner | ETA | Escalation |
|---------|-------|-----|------------|
## Next Week Plan
## Risks
| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
\`\`\``,

  "Data": `

## Deliverable Templates

### Data Analysis Report
\`\`\`
# {Analysis Title}
## Objective
## Methodology
## Data Sources
| Source | Period | Records | Quality |
|--------|--------|---------|---------|
## Findings
## Visualizations
(Include chart descriptions or file references)
## Recommendations
| # | Recommendation | Impact | Effort |
|---|---------------|--------|--------|
## Limitations
\`\`\``,

  "Business": `

## Deliverable Templates

### Business Analysis Report
\`\`\`
# {Title} — Business Analysis
## Executive Summary
## Current State
## Gap Analysis
| Area | Current | Target | Gap | Priority |
|------|---------|--------|-----|----------|
## Recommendations
| # | Action | Impact | Effort | Timeline |
|---|--------|--------|--------|----------|
## Success Metrics
## Stakeholder Impact
\`\`\``,

  "Operations": `

## Deliverable Templates

### Incident Report
\`\`\`
# Incident Report — {Date} {Title}
## Severity: P1 | P2 | P3 | P4
## Timeline
| Time | Event |
|------|-------|
## Root Cause
## Impact
## Resolution
## Action Items
| # | Action | Owner | Due | Status |
|---|--------|-------|-----|--------|
## Prevention
\`\`\``,

  "Game Development": `

## Deliverable Templates

### Game Design Document (GDD) Section
\`\`\`
# {Section Name} — Game Design Document
## Overview
## Target Experience
## Core Mechanic
| Element | Description | Parameters | Player Impact |
|---------|-------------|------------|---------------|
## Player Loop
## Progression
| Stage | Unlock Condition | New Content |
|-------|-----------------|-------------|
## Edge Cases
| Scenario | Expected Behavior | Recovery |
|----------|-----------------|----------|
## Dependencies
## Success Metrics
\`\`\``,

  "Game Development — Unity": `

## Deliverable Templates

### Unity Technical Spec
\`\`\`
# {System} — Unity Technical Spec
## Architecture
## MonoBehaviour/ScriptableObject Design
| Class | Responsibility | Update Loop |
|-------|---------------|-------------|
## Performance Budget
| Metric | Target | Current |
|--------|--------|---------|
## Asset Pipeline
## Testing Approach
\`\`\``,

  "Game Development — Unreal Engine": `

## Deliverable Templates

### Unreal Technical Spec
\`\`\`
# {System} — UE Technical Spec
## Architecture (C++ / Blueprint split)
## Class Hierarchy
| Class | Parent | Responsibility |
|-------|--------|---------------|
## Performance Budget
## Asset Requirements
\`\`\``,

  "Game Development — Godot": `

## Deliverable Templates

### Godot Technical Spec
\`\`\`
# {System} — Godot Spec
## Scene Tree Design
## GDScript Architecture
## Performance Targets
\`\`\``,

  "Game Development — Roblox": `

## Deliverable Templates

### Roblox Experience Spec
\`\`\`
# {Feature} — Roblox Experience Spec
## Gameplay Flow
## Luau Architecture
## Monetization Integration
## Performance Targets
\`\`\``,

  "Game Development — Blender": `

## Deliverable Templates

### Blender Addon Spec
\`\`\`
# {Addon} — Technical Spec
## Features
## Blender API Usage
## UI/Panel Layout
## Compatibility Matrix
\`\`\``,

  "Spatial Computing": `

## Deliverable Templates

### XR Experience Spec
\`\`\`
# {Feature} — XR Specification
## Spatial Interaction Design
## Performance Budget
| Metric | Target | Platform |
|--------|--------|----------|
## Input Mapping
| Gesture/Controller | Action | Feedback |
|-------------------|--------|----------|
## Accessibility
\`\`\``,

  "Specialized": `

## Deliverable Templates

### Domain Analysis Report
\`\`\`
# {Topic} — Analysis Report
## Objective
## Data Sources & Methodology
## Findings
| # | Finding | Impact | Confidence |
|---|---------|--------|-----------|
## Recommendations
| # | Action | Priority | Expected Impact |
|---|--------|----------|----------------|
## Next Steps
\`\`\``,
};

// Finance is a common cross-department role
DEPT_TEMPLATES["Finance"] = `

## Deliverable Templates

### Financial Report
\`\`\`
# {Report Title} — {Period}
## Executive Summary (max 150 words)
## Key Metrics
| Metric | Actual | Budget | Variance | % Var |
|--------|--------|--------|----------|-------|
## Department Breakdown
| Department | Budget | Actual | Variance | Notes |
|-----------|--------|--------|----------|-------|
## Cash Flow Summary
| Category | Inflow | Outflow | Net |
|----------|--------|--------|-----|
## Recommendations
| # | Action | Impact | Priority |
|---|--------|--------|----------|
\`\`\``;

// HR
DEPT_TEMPLATES["HR"] = `

## Deliverable Templates

### HR Report
\`\`\`
# {Report Title} — {Period}
## Headcount Summary
| Department | Current | Target | Open Roles |
|-----------|---------|--------|-----------|
## Recruitment Pipeline
| Role | Stage | Candidates | Target Date |
|------|-------|-----------|-------------|
## Employee Engagement
## Action Items
\`\`\``;

// ════════════════════════════════════════════
// Update functions
// ════════════════════════════════════════════

function upgradeHeartbeat(heartbeatMd) {
  if (!heartbeatMd) return heartbeatMd;
  let hb = heartbeatMd;

  // P0: Insert Step 3.5 after Step 3 (if not already present)
  if (!hb.includes("Step 3.5")) {
    // Find "### Step 3: Execute Tasks" section end (before Step 4)
    const step4Marker = "### Step 4:";
    const idx = hb.indexOf(step4Marker);
    if (idx > 0) {
      hb = hb.substring(0, idx) + STEP_3_5 + "\n\n" + hb.substring(idx);
    }
  }

  // P1: Insert Step 1.5 after Step 1 (if not already present)
  if (!hb.includes("Step 1.5")) {
    const step2Marker = "### Step 2:";
    const idx = hb.indexOf(step2Marker);
    if (idx > 0) {
      hb = hb.substring(0, idx) + STEP_1_5 + "\n\n" + hb.substring(idx);
    }
  }

  // P1: Insert Step 3b after Step 3.5 (if not already present)
  if (!hb.includes("Step 3b")) {
    const step4Marker = "### Step 4:";
    const idx = hb.indexOf(step4Marker);
    if (idx > 0) {
      hb = hb.substring(0, idx) + STEP_3B + "\n\n" + hb.substring(idx);
    }
  }

  return hb;
}

function upgradeAgents(agentsMd, department) {
  if (!agentsMd) return agentsMd;
  // P2: Append deliverable templates (if not already present)
  if (agentsMd.includes("## Deliverable Templates")) return agentsMd;

  const template = DEPT_TEMPLATES[department];
  if (!template) return agentsMd;

  return agentsMd.trimEnd() + template;
}

// ════════════════════════════════════════════
// Main
// ════════════════════════════════════════════

const jsonPath = path.resolve(__dirname, "role-templates-import.json");
const data = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));

let hbChanged = 0, agChanged = 0;

for (const role of data) {
  const hbBefore = role.heartbeat_md;
  const agBefore = role.agents_md;

  role.heartbeat_md = upgradeHeartbeat(role.heartbeat_md);
  role.agents_md = upgradeAgents(role.agents_md, role.department);

  if (role.heartbeat_md !== hbBefore) hbChanged++;
  if (role.agents_md !== agBefore) agChanged++;

  if (DRY_RUN && (role.heartbeat_md !== hbBefore || role.agents_md !== agBefore)) {
    console.log(`[DRY-RUN] ${role.id} (${role.department}) hb:${role.heartbeat_md !== hbBefore} ag:${role.agents_md !== agBefore}`);
  }
}

console.log(`\nJSON: Total=${data.length}, heartbeat changed=${hbChanged}, agents changed=${agChanged}`);

if (!DRY_RUN) {
  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2) + "\n", "utf-8");
  console.log(`Written to ${jsonPath}`);
}

// ── Update SQLite ──
if (SQLITE_PATH && !DRY_RUN) {
  console.log(`\nUpdating SQLite: ${SQLITE_PATH}`);
  try {
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(SQLITE_PATH);
    const stmt = db.prepare("UPDATE role_templates SET heartbeat_md = ?, agents_md = ? WHERE id = ?");
    const tx = db.transaction(() => {
      let count = 0;
      for (const role of data) {
        const r = stmt.run(role.heartbeat_md, role.agents_md, role.id);
        if (r.changes > 0) count++;
      }
      return count;
    });
    const count = tx();
    console.log(`SQLite: ${count} rows updated`);
    db.close();
  } catch (err) {
    console.error(`SQLite error: ${err.message}`);
  }
}

// ── Update MySQL ──
if (MYSQL_URL && !DRY_RUN) {
  console.log(`\nUpdating MySQL: ${MYSQL_URL.replace(/:[^:@]+@/, ':***@')}`);
  try {
    const mysql = (await import("mysql2/promise")).default;
    const pool = await mysql.createPool(MYSQL_URL);
    const conn = await pool.getConnection();
    await conn.beginTransaction();
    let count = 0;
    try {
      for (const role of data) {
        const [r] = await conn.execute(
          "UPDATE role_templates SET heartbeat_md = ?, agents_md = ? WHERE id = ?",
          [role.heartbeat_md, role.agents_md, role.id]
        );
        if (r.changedRows > 0) count++;
      }
      await conn.commit();
      console.log(`MySQL: ${count} rows updated (committed)`);
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
const has35 = data.filter(r => r.heartbeat_md?.includes("Step 3.5")).length;
const has15 = data.filter(r => r.heartbeat_md?.includes("Step 1.5")).length;
const has3b = data.filter(r => r.heartbeat_md?.includes("Step 3b")).length;
const hasTemplates = data.filter(r => r.agents_md?.includes("Deliverable Templates")).length;
console.log(`P0 Step 3.5 (Quality Gate): ${has35}/${data.length}`);
console.log(`P1 Step 1.5 (Decomposition): ${has15}/${data.length}`);
console.log(`P1 Step 3b (Visibility): ${has3b}/${data.length}`);
console.log(`P2 Deliverable Templates: ${hasTemplates}/${data.length}`);
