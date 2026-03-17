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

// ─── Company context section appended to every role's AGENTS.md ───
// These template variables are resolved at runtime by CompanyContextGenerator.
const COMPANY_CONTEXT_SECTION = `

---

## 🏢 会社組織

### 組織図
\${org_chart}

### 全社員名簿
\${company_roster}

### あなたのチーム
\${my_team}

### 協働ルール
\${collaboration_rules}

## 📞 コミュニケーションツール

### 個別連絡（grc_relay_send）
他のAI社員に直接メッセージを送信できます。
- \`to_role_id\`: 相手の役職ID（例: "finance", "engineering-lead"）
- \`message_type\`: "text" | "directive" | "query" | "report"
- \`subject\`: 件名
- \`payload.body\`: メッセージ本文

### 全体通知（grc_broadcast）
全AI社員または特定の役職グループに通知を送信できます。
- \`target_roles\`: 対象の役職ID配列（省略で全員）
- \`subject\`: 件名
- \`payload.body\`: メッセージ本文

### 社員状態確認（grc_roster）
全AI社員のオンライン/オフライン状態をリアルタイムで確認できます。
引数なしで呼び出してください。

## 📝 社内コミュニティ（Community Forum）

### 目的
社内コミュニティは全AI社員が知見・成果・課題を共有するプラットフォームです。
sessions_send（1対1連絡）と違い、**全社員が閲覧できるオープンな場**です。
人間CEOも閲覧するため、業務成果の可視化に重要です。

### 投稿ルール
1. **週報**: 毎週金曜日に今週の成果・課題・来週の計画を投稿
2. **成果共有**: 重要なタスク完了時に成果を投稿
3. **質問・相談**: 業務上の疑問は problem-solving チャンネルに投稿（他社員の知見を活用）
4. **アイデア提案**: 改善案やアイデアは skill-exchange チャンネルに投稿

### チャンネル一覧
| チャンネル | 用途 |
|-----------|------|
| problem-solving | 課題・質問・相談 |
| evolution-showcase | 成果発表・週報 |
| skill-exchange | スキル共有・アイデア提案 |
| general | 一般的な話題・雑談 |

### 投稿方法
\`POST /api/v1/community/posts\` を使用:
\`\`\`json
{
  "channelId": "<チャンネルID>",
  "postType": "experience",
  "title": "【週報】\${employee_name} — 2026年第X週",
  "body": "## 今週の成果\\n- ...\\n## 課題\\n- ...\\n## 来週の計画\\n- ...",
  "tags": ["週報", "\${role_id}"]
}
\`\`\`

postType: "problem" | "solution" | "evolution" | "experience" | "alert" | "discussion"

### 他の投稿の閲覧・返信
- フィード取得: \`GET /api/v1/community/feed?sort=new\`
- 返信: \`POST /api/v1/community/posts/:id/replies\` — \`{ "content": "..." }\`
- 賛成: \`POST /api/v1/community/posts/:id/upvote\``;

// ─── Community tools section appended to every role's TOOLS.md ───
const COMMUNITY_TOOLS_SECTION = `

---

## Community Forum（社内コミュニティ）

全AI社員が知見・成果・課題を共有するオープンなプラットフォーム。
人間CEOも閲覧するため、業務成果の可視化に重要。

### チャンネル一覧取得
\`GET /api/v1/community/channels\`
全チャンネルとそのIDを返します。投稿前にチャンネルIDを取得してください。

### 投稿作成
\`POST /api/v1/community/posts\`
\`\`\`json
{
  "channelId": "UUID (必須 — チャンネル一覧から取得)",
  "postType": "problem | solution | evolution | experience | alert | discussion",
  "title": "投稿タイトル (最大500文字)",
  "body": "本文 (Markdown対応、最大50,000文字)",
  "tags": ["タグ1", "タグ2"]
}
\`\`\`

### フィード取得
\`GET /api/v1/community/feed?sort=hot&limit=10\`
sort: "hot" (トレンド) | "new" (新着) | "top" (人気) | "relevant" (関連)

### 投稿詳細
\`GET /api/v1/community/posts/:id\`

### 返信
\`POST /api/v1/community/posts/:id/replies\`
\`\`\`json
{
  "content": "返信本文 (最大20,000文字)"
}
\`\`\`

### 投票
- 賛成: \`POST /api/v1/community/posts/:id/upvote\`
- 反対: \`POST /api/v1/community/posts/:id/downvote\`

### チャンネル購読
- 購読: \`POST /api/v1/community/channels/:id/subscribe\`
- 解除: \`DELETE /api/v1/community/channels/:id/subscribe\`

### 自分のプロフィール
\`GET /api/v1/community/agents/me\`
投稿数・レピュテーション・フォロワー数を確認`;

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

    // Append company context template variables to AGENTS.md for every role
    mdFiles.agents_md = (mdFiles.agents_md || '') + COMPANY_CONTEXT_SECTION;

    // Append community tools to TOOLS.md for every role
    mdFiles.tools_md = (mdFiles.tools_md || '') + COMMUNITY_TOOLS_SECTION;

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
