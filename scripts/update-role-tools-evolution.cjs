const mysql = require('mysql2/promise');

const NEW_EVOLUTION_SECTION = `## Evolution Network (GEP Protocol)

### When to register Gene/Capsule
- Register Gene: when you discover a reusable problem pattern with signals + strategy
- Register Capsule: after successfully solving a problem using a Gene strategy
- Do NOT register: task completion reports, general knowledge sharing

### Search before solving
\`\`\`
Tool: grc_assets
  search_query: "timeout relay"
  status: "approved"
\`\`\`

### Register a Gene (problem pattern + strategy)
\`\`\`
Tool: grc_publish
  asset_type: "gene"
  asset_id: "gene-{category}-{short-name}"
  payload:
    category: "repair"
    signals_match: ["timeout", "relay"]
    strategy: ["Check node_id length", "Truncate to 16 chars", "Verify relay_queue schema"]
    validation: ["relay_send test to CEO node"]
\`\`\`

### Register a Capsule (execution record)
\`\`\`
Tool: grc_publish
  asset_type: "capsule"
  gene_asset_id: "gene-repair-relay-timeout"
  payload:
    trigger: ["log_error", "timeout"]
    summary: "Truncated node_id to 16 chars. 1 file / 3 lines changed."
    confidence: 0.9
    outcome: { status: "success" }
\`\`\`

### Report usage
\`\`\`
POST /a2a/report
  { "asset_id": "capsule-xxx", "success": true }
\`\`\`

### Vote on Gene/Capsule quality
\`\`\`
POST /a2a/evolution/vote
  { "asset_id": "gene-xxx", "vote": "upvote" }
\`\`\``;

(async () => {
  const conn = await mysql.createConnection('mysql://root:Admin123@13.78.81.86:18306/grc-server');

  const [roles] = await conn.execute('SELECT id, tools_md FROM role_templates');

  for (const role of roles) {
    let toolsMd = role.tools_md;

    // Remove old Evolution sections
    toolsMd = toolsMd.replace(/## Evolution Network \(A2A Tools\)[\s\S]*?(?=\n## |\n---|\Z)/g, '');
    toolsMd = toolsMd.replace(/## Evolution Network Tools \(WinClaw Built-in\)[\s\S]*?(?=\n## |\n---|\Z)/g, '');
    toolsMd = toolsMd.replace(/## Evolution Network \(GEP Protocol\)[\s\S]*?(?=\n## |\n---|\Z)/g, '');

    // Clean multiple blank lines
    toolsMd = toolsMd.replace(/\n{4,}/g, '\n\n\n');

    // Append new section
    toolsMd = toolsMd.trimEnd() + '\n\n' + NEW_EVOLUTION_SECTION + '\n';

    await conn.execute('UPDATE role_templates SET tools_md = ? WHERE id = ?', [toolsMd, role.id]);
    console.log(`Updated: ${role.id} (${toolsMd.length} chars)`);
  }

  await conn.end();
  console.log('All role templates updated.');
})().catch(e => console.error(e.message));
