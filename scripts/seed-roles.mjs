/**
 * Seed all 9 built-in roles from the design document into the GRC database.
 * Usage: node scripts/seed-roles.mjs
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const API_BASE = 'http://localhost:3100';
const LOGIN_EMAIL = 'mysin008@gmail.com';
const LOGIN_PASSWORD = 'W4f48dbc4';

// ─── Design document path ───
const DOC_PATH = join(__dirname, '..', '..', 'winclaw', 'docs', 'GRC_Role_Templates_All_8_Roles.md');

// ─── Role metadata (extracted from design doc IDENTITY.md sections) ───
const ROLE_META = [
  { id: 'ceo', name: 'Chief Executive Officer', emoji: '👔', department: 'Executive Office', industry: null, mode: 'copilot', description: 'AI assistant to the human CEO. Distributes annual KPIs, oversees all AI departments, monitors execution against company plans, and issues directives to AI employees.' },
  { id: 'marketing', name: 'Marketing Lead', emoji: '📊', department: 'Marketing', industry: null, mode: 'autonomous', description: 'Digital marketing, market research, brand strategy, campaign management, and data-driven marketing analytics.' },
  { id: 'product-manager', name: 'Product Manager', emoji: '🎯', department: 'Product', industry: null, mode: 'autonomous', description: 'PRD creation, roadmap planning, user story writing, stakeholder coordination, and product analytics.' },
  { id: 'strategic-planner', name: 'Strategic Planner', emoji: '🧭', department: 'Strategy & Planning', industry: null, mode: 'autonomous', description: 'Business planning, market entry strategy, M&A analysis, competitive strategy, and long-term vision alignment.' },
  { id: 'finance', name: 'Finance & Accounting Lead', emoji: '💰', department: 'Finance', industry: null, mode: 'autonomous', description: 'Financial statement analysis, budget management, expense tracking, tax planning, and regulatory compliance.' },
  { id: 'sales', name: 'Sales Lead', emoji: '🤝', department: 'Sales', industry: null, mode: 'autonomous', description: 'Lead generation, proposal creation, pipeline management, CRM operations, and revenue target execution.' },
  { id: 'customer-support', name: 'Customer Support Lead', emoji: '💬', department: 'Customer Support', industry: null, mode: 'autonomous', description: 'Ticket management, FAQ & knowledge base, escalation routing, customer satisfaction tracking, and VOC analysis.' },
  { id: 'hr', name: 'HR Lead', emoji: '👥', department: 'Human Resources', industry: null, mode: 'autonomous', description: 'Recruitment planning, performance management, training & development, labor compliance, and organizational culture.' },
  { id: 'engineering-lead', name: 'Engineering Lead', emoji: '⚙️', department: 'Engineering', industry: null, mode: 'autonomous', description: 'System architecture, code review, technology evaluation, sprint planning, and technical debt management.' },
];

// ─── Parse the design document ───
function parseRolesFromDoc(docContent) {
  const roles = {};

  // Split by role headers (## N. emoji RoleName — Description (Role ID: `xxx`))
  const roleSections = docContent.split(/^## \d+\./m).slice(1); // skip content before first role

  for (const section of roleSections) {
    // Extract role ID from the first line
    const idMatch = section.match(/\(Role ID: `([^`]+)`\)/);
    if (!idMatch) continue;
    const roleId = idMatch[1];

    // Extract each markdown file section
    const fileNames = [
      'IDENTITY.md', 'SOUL.md', 'AGENTS.md', 'USER.md',
      'TOOLS.md', 'HEARTBEAT.md', 'BOOTSTRAP.md', 'TASKS.md'
    ];

    const extracted = {};
    for (const fileName of fileNames) {
      const key = fileName.replace('.md', '').toLowerCase() + '_md';

      // Find the ### FILENAME section and extract the markdown code block
      const headerPattern = new RegExp(`### ${fileName.replace('.', '\\.')}\\s*\\n`);
      const headerMatch = section.match(headerPattern);

      if (!headerMatch) {
        console.warn(`  ⚠️  ${roleId}: ${fileName} section not found`);
        extracted[key] = `# ${fileName.replace('.md', '')}\n\nContent not available.`;
        continue;
      }

      const afterHeader = section.substring(headerMatch.index + headerMatch[0].length);

      // Find the first ```markdown ... ``` block after the header
      const codeBlockMatch = afterHeader.match(/```markdown\s*\n([\s\S]*?)```/);
      if (!codeBlockMatch) {
        console.warn(`  ⚠️  ${roleId}: ${fileName} code block not found`);
        extracted[key] = `# ${fileName.replace('.md', '')}\n\nContent not available.`;
        continue;
      }

      extracted[key] = codeBlockMatch[1].trimEnd();
    }

    roles[roleId] = extracted;
  }

  return roles;
}

// ─── API helpers ───
async function login() {
  const res = await fetch(`${API_BASE}/auth/email/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: LOGIN_EMAIL, password: LOGIN_PASSWORD }),
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.token;
}

async function getExistingRoles(token) {
  const res = await fetch(`${API_BASE}/api/v1/admin/roles`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`Get roles failed: ${res.status}`);
  const data = await res.json();
  return data.data || [];
}

async function createRole(token, roleData) {
  const res = await fetch(`${API_BASE}/api/v1/admin/roles`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(roleData),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Create role failed: ${res.status} — ${text}`);
  }
  return await res.json();
}

async function updateRole(token, roleId, roleData) {
  const res = await fetch(`${API_BASE}/api/v1/admin/roles/${roleId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(roleData),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Update role failed: ${res.status} — ${text}`);
  }
  return await res.json();
}

// ─── Main ───
async function main() {
  console.log('📄 Reading design document...');
  const docContent = readFileSync(DOC_PATH, 'utf-8');

  console.log('🔍 Parsing roles from document...');
  const parsedRoles = parseRolesFromDoc(docContent);
  console.log(`   Found ${Object.keys(parsedRoles).length} roles: ${Object.keys(parsedRoles).join(', ')}`);

  console.log('\n🔑 Logging in to GRC API...');
  const token = await login();
  console.log('   ✅ Login successful');

  console.log('\n📋 Fetching existing roles...');
  const existingRoles = await getExistingRoles(token);
  const existingIds = new Set(existingRoles.map(r => r.id));
  console.log(`   Existing roles: ${existingRoles.map(r => r.id).join(', ') || '(none)'}`);

  console.log('\n🚀 Creating/updating roles...\n');

  let created = 0;
  let updated = 0;
  let errors = 0;

  for (const meta of ROLE_META) {
    const mdFiles = parsedRoles[meta.id];
    if (!mdFiles) {
      console.log(`   ❌ ${meta.id}: Not found in design doc!`);
      errors++;
      continue;
    }

    const roleData = {
      id: meta.id,
      name: meta.name,
      emoji: meta.emoji,
      description: meta.description,
      department: meta.department,
      mode: meta.mode,
      is_builtin: 1,
      ...mdFiles,
    };
    // Only include industry if it has a value
    if (meta.industry) roleData.industry = meta.industry;

    try {
      if (existingIds.has(meta.id)) {
        // Update existing role
        await updateRole(token, meta.id, roleData);
        console.log(`   🔄 ${meta.emoji} ${meta.id}: Updated`);
        updated++;
      } else {
        // Create new role
        await createRole(token, roleData);
        console.log(`   ✅ ${meta.emoji} ${meta.id}: Created`);
        created++;
      }
    } catch (err) {
      console.log(`   ❌ ${meta.id}: ${err.message}`);
      errors++;
    }
  }

  console.log(`\n════════════════════════════════════════`);
  console.log(`  Created: ${created}  |  Updated: ${updated}  |  Errors: ${errors}`);
  console.log(`  Total roles in DB: ${existingIds.size + created}`);
  console.log(`════════════════════════════════════════\n`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
