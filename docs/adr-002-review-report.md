# ADR-002 レビューレポート

**レビュー対象**: `C:\work\docs\to-C全球资源中心-架构设计-ADR-002.md`
**計画文書**: `C:\Users\USER\.claude\plans\delegated-gathering-yao.md`
**コード検査対象**: `C:\work\grc\src\`
**レビュー日**: 2026-03-03
**レビュアー**: Doc Agent (Architecture Review)

---

## 発見した問題 (Issues Found)

### [Critical] 問題 1: JWT アルゴリズムの不一致

**深刻度**: Critical
**場所**: ADR-002「安全机制」セクション vs `C:\work\grc\src\shared\utils\jwt.ts`

ADR-002 では JWT の署名アルゴリズムを **RS256**（非対称鍵）と明記している。

> ADR-002: "认证 JWT RS256 签名 + Refresh Token"

しかし実装コードでは **HS256**（対称鍵）が使用されている。

```typescript
// C:\work\grc\src\shared\utils\jwt.ts (line 20, 34)
algorithm: "HS256",
algorithms: ["HS256"],
```

RS256 は秘密鍵・公開鍵ペアを使用し、公開鍵のみで検証可能であるため、クライアント側での安全な検証（WinClaw クライアントが GRC の署名を検証する用途）に適している。HS256 では秘密鍵を全クライアントに配布する必要があり、ADR-002 のセキュリティモデル（Ed25519 によるマニフェスト署名等）と設計思想が矛盾する。

---

### [Critical] 問題 2: Refresh Token の実装欠落

**深刻度**: Critical
**場所**: ADR-002「4.3 JWT 结构」セクション vs 実装コード

ADR-002 では Refresh Token を明記している。

> "Token 有效期：24 小时"
> "Refresh Token：30 天（静默刷新）"

また計画文書でも以下の通り JWT 構造に `refresh_token` フィールドが存在する。

```typescript
// 計画文書 Part 1: 1.4.1
auth?: {
  mode: 'anonymous' | 'oauth' | 'apikey';
  token?: string;
};
```

しかし `C:\work\grc\src\shared\utils\jwt.ts` の `JwtPayload` インターフェースに Refresh Token の概念がなく、`C:\work\grc\src\shared\interfaces\auth.interface.ts` の `IAuthService` にも Refresh Token の発行・検証メソッドが定義されていない。また `config.ts` の JWT 設定に `expiresIn` は "7d"（7日）が設定されており、ADR-002 が指定する 24 時間とも不一致である。

---

### [Critical] 問題 3: DB スキーマの構造的不一致 — community_channels テーブル

**深刻度**: Critical
**場所**: ADR-002「6.9 DB 表结构扩展」vs `C:\work\grc\src\shared\db\migrations\001_initial.sql`

ADR-002 では `community_channels` テーブルに以下のカラムを定義している。

```sql
-- ADR-002 定義
display_name VARCHAR(255) NOT NULL,
creator_node_id VARCHAR(255) NULL,
is_system TINYINT(1) NOT NULL DEFAULT 0,
post_count INT NOT NULL DEFAULT 0,
```

しかし実装 SQL には `display_name`、`creator_node_id`（`created_by` として別名）、`is_system`、`post_count` が存在せず、代わりに `created_by CHAR(36)` という型違いのカラムがある。これは UI 表示（`display_name`）と System/User 判別（`is_system`）に直接影響する。

---

### [Critical] 問題 4: community_topics の設計が根本的に異なる

**深刻度**: Critical
**場所**: ADR-002「6.9 DB 表结构扩展」vs `C:\work\grc\src\shared\db\migrations\001_initial.sql`

ADR-002 では `community_topics` は既存テーブルへの ALTER TABLE（カラム追加）として設計されているが、実装 SQL では最初から Phase 3 対応のフルスキーマ（`channel_id`、`post_type`、`score`、`is_distilled` 等を含む）として定義されている。

さらに深刻な問題として、ADR-002 最終セクション「数据模型 > 完整数据库架构」の `community_topics` は旧来のスキーマ（`author_id CHAR(36)`、`body TEXT`、`category` カラム）として定義されており、Phase 3 の設計（`author_node_id`、`channel_id`、構造化 `post_type`）と完全に矛盾している。実装は Phase 3 設計を先行採用しているが、ADR-002 の「完整数据库架构」セクションには反映されていない。

---

### [Critical] 問題 5: Update Gateway — クライアントバイナリダウンロード API の欠落

**深刻度**: Critical
**場所**: 計画文書 1.3.1「ClawHub+」API リスト vs ADR-002「3. Update Gateway」

計画文書には以下の API が記載されている。

```
GET /api/v1/client/download/:platform  # プラットフォーム別ダウンロード
```

ADR-002 の Update Gateway セクション（3.2 API）にはこのエンドポイントが存在しない。`GET /api/v1/client/latest` と `GET /api/v1/client/changelog` は ClawHub+ の API セクション（1.3 API）に存在するが、実際のバイナリダウンロードエンドポイントはいずれのセクションにも定義されていない。

---

### [Major] 問題 6: DB スキーマの不一致 — users テーブル

**深刻度**: Major
**場所**: ADR-002「完整数据库架构」vs `C:\work\grc\src\shared\db\migrations\001_initial.sql`

ADR-002 の users テーブルには `promoted_asset_count INT NOT NULL DEFAULT 0` カラムが存在する。

```sql
-- ADR-002
promoted_asset_count INT NOT NULL DEFAULT 0,
```

しかし実装 SQL の users テーブルにはこのカラムがない。このカラムは Contributor 自動昇格条件（5+ promoted 資産）のトラッキングに使用されるべきものであり、昇格ロジックに影響する。

---

### [Major] 問題 7: DB スキーマの不一致 — nodes テーブル

**深刻度**: Major
**場所**: ADR-002「完整数据库架构」vs `C:\work\grc\src\shared\db\migrations\001_initial.sql`

ADR-002 の nodes テーブルには以下のカラムが存在する。

```sql
-- ADR-002
display_name VARCHAR(255),
capsule_count INT NOT NULL DEFAULT 0,
updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
```

実装 SQL の nodes テーブルには `display_name`、`capsule_count`、`updated_at` が存在しない。`display_name` は Community での Agent 表示名（Soul.md から取得）に使用されるため、Community モジュールの設計に直接影響する。

---

### [Major] 問題 8: DB スキーマの不一致 — genes テーブル（重要フィールド欠落）

**深刻度**: Major
**場所**: ADR-002「完整数据库架構」vs `C:\work\grc\src\shared\db\migrations\001_initial.sql`

ADR-002 の genes テーブルには以下のフィールドが存在するが、実装 SQL には存在しない。

```sql
-- ADR-002 にあるが実装にない
user_id CHAR(36) NULL,
category VARCHAR(50),
constraints_data JSON,
validation JSON,
fail_count INT NOT NULL DEFAULT 0,
chain_id VARCHAR(255),
schema_version INT NOT NULL DEFAULT 1,
safety_score FLOAT NULL,
promoted_at TIMESTAMP NULL,
```

逆に実装 SQL には `success_count INT NOT NULL DEFAULT 0` があるが、ADR-002 にはない。`category` フィールドは進化資産の分類（repair / optimize / innovate / harden）に使用され、テレメトリの `gene_usage.categories` 集計に必要である。

---

### [Major] 問題 9: DB スキーマの不一致 — skill_versions テーブル

**深刻度**: Major
**場所**: ADR-002「完整数据库架構」vs `C:\work\grc\src\shared\db\migrations\001_initial.sql`

ADR-002 では `skill_versions` テーブルのフィールド名が `checksum_sha256` と `tarball_url`（TEXT 型）であるが、実装では `tarball_sha256`（VARCHAR(64)）と `tarball_url`（VARCHAR(500)）となっている。また ADR-002 には `min_winclaw_version` があるが実装には `metadata JSON` として格納されており、直接クエリが困難になる。

---

### [Major] 問題 10: DB スキーマの不一致 — client_releases テーブル

**深刻度**: Major
**場所**: ADR-002「完整数据库架構」vs `C:\work\grc\src\shared\db\migrations\001_initial.sql`

ADR-002 の `client_releases` テーブルには以下が存在するが、実装と差異がある。

| フィールド | ADR-002 | 実装 SQL |
|-----------|---------|---------|
| `min_upgrade_version` | 存在 | 存在しない |
| `is_critical` | 存在 | 存在しない（代わりに `status` カラムに `recalled` 値で表現） |
| `published_at` | 存在 | 代わりに `created_at` |
| `manifest` | 存在しない | `manifest JSON NOT NULL` として存在 |
| `file_size` | `size_bytes BIGINT` | `file_size BIGINT` （名称相違） |

`min_upgrade_version` は増量更新の「このバージョン以降でないと増量不可」判定に不可欠であり、ADR-002 の 3.5 節（増量更新機能）の中核となるフィールドである。

---

### [Major] 問題 11: Rate Limit 数値の不一致

**深刻度**: Major
**場所**: ADR-002「4.4 速率限制」vs `C:\work\grc\src\shared\middleware\rate-limit.ts`

ADR-002 では以下の Rate Limit を定義している。

| Tier | req/hour |
|------|---------|
| Anonymous | 100 |
| Free (OAuth) | 500 |
| Contributor | 1,000 |
| Pro | 5,000 |

実装コード（`rate-limit.ts`）は ADR-002 と一致している。しかし計画文書では以下の異なる数値が記載されている。

> 計画文書 1.6: "Anonymous: 100 req/hour、OAuth: 1000 req/hour"
> 計画文書 1.7: "Pro $5/月 ... API rate limit 10x"

計画文書では Free OAuth ユーザーが 1000 req/hour、ADR-002 では 500 req/hour と矛盾している。どちらが正しいか明確化が必要である。

---

### [Major] 問題 12: API Key 認証の不完全な実装

**深刻度**: Major
**場所**: ADR-002「4.1 三种认证模式」vs `C:\work\grc\src\shared\middleware\auth.ts`

`auth.ts` では API Key 受信後に `authMode = "apikey"` を設定して `next()` を呼ぶが、実際の API Key 検証を「auth モジュールに委譲する」としてコメントのみで済ませている。

```typescript
// auth.ts (line 50-54)
// API Key validation is delegated to the auth module service
// Here we just mark the mode; the auth module will resolve the key
req.authMode = "apikey";
(req as unknown as Record<string, unknown>)._rawApiKey = apiKey;
return next();
```

しかし `auth/routes.ts` はスタブのみであるため、現在 API Key は実質的に認証なしで通過する状態になっている。これはセキュリティ上の重大な問題であり、将来の実装でも認証委譲の仕組みが標準化されていない（`_rawApiKey` というアンドキュメントなプロパティに依存している）。

---

### [Major] 問題 13: admin-auth.ts が ADR-002 のロール設計と不一致

**深刻度**: Major
**場所**: ADR-002「成功指标」vs `C:\work\grc\src\shared\middleware\admin-auth.ts`

ADR-002 では管理者認証に `role: admin` を使用すると記載されており、`config.ts` の `admin.emails` フィールドでメールアドレスによる管理者判定も行う設計になっている。しかし `admin-auth.ts` は実際には空のスタブファイルのみが存在し、管理者認証ロジックが一切実装されていない。Admin API の保護が未実装のまま各モジュールに `admin-routes.ts` が追加されれば、誰でも管理 API にアクセスできる状態になる。

---

### [Major] 問題 14: デプロイアーキテクチャの Modular Monolith 説明が不完全

**深刻度**: Major
**場所**: 計画文書 Part 3.5 vs ADR-002「Appendix B」

計画文書では ADR-002 の Appendix B に以下を明示的に追記することが要求されていた。

1. docker-compose.yml の完全定義（全サービス、ports、volumes、depends_on、healthcheck）
2. スケールパス（Phase 1〜3）の具体的な判断基準
3. マイクロサービス化優先順位（Update Gateway → AI Forum → ClawHub+）

ADR-002 の Appendix B は Docker Compose の構成に言及しているが、実際の `docker-compose.yml` サービス定義（全コンテナの healthcheck、depends_on 設定等）は記載されていない。また VPS → AKS 移行判断基準（50K ユーザー超）も Appendix B には含まれていない。

---

### [Minor] 問題 15: `GET /api/v1/client/changelog` エンドポイントが ADR-002 に欠落

**深刻度**: Minor
**場所**: 計画文書 1.3.1 vs ADR-002「1.3 ClawHub+ API」

計画文書には `GET /api/v1/client/changelog` が明示されているが、ADR-002 の ClawHub+ API セクションにはこのエンドポイントが存在しない。

---

### [Minor] 問題 16: コミュニティ Rate Limit テーブルが ADR-002 本文に追加されていない

**深刻度**: Minor
**場所**: ADR-002「6.5 Rate Limits」セクション

ADR-002 の Section 6.5 にはコミュニティ操作固有の Rate Limit テーブル（発帖 2 帖/4時間、回复 10 条/4時間等）が詳細に定義されている。しかし `rate-limit.ts` は全エンドポイントに同一の時間あたりリクエスト数制限を適用しており、コミュニティ操作の時間窓（4時間単位）が考慮されていない。設計として「4時間単位のコミュニティ操作 Rate Limit」と「1時間単位の汎用 Rate Limit」を分離する設計が ADR-002 に記載されているが、コード側での実現方針が未記述。

---

### [Minor] 問題 17: `DELETE /api/v1/update/download` エンドポイントの欠落

**深刻度**: Minor
**場所**: 計画文書 1.3.3 Update Gateway API リスト vs ADR-002「3.2 API」

計画文書の Update Gateway API には `GET /api/v1/update/download/:version` が存在するが、ADR-002 の 3.2 API セクションにこのエンドポイントが定義されていない。ADR-002 は 3.5.9 で MinIO CDN のパス構造を説明しているが、GRC が直接ダウンロードを提供するのか、CDN に直接誘導するのかが不明確である。

---

### [Minor] 問題 18: telemetry_reports テーブルの匿名化フィールド設計の差異

**深刻度**: Minor
**場所**: ADR-002「5.2 收集数据」vs `C:\work\grc\src\shared\db\migrations\001_initial.sql`

ADR-002 の `TelemetryReport` インターフェースでは `anonymous_id: string`（月次ローテーションハッシュ）を明示しているが、実装 SQL の `telemetry_reports` テーブルでは `node_id VARCHAR(255) NOT NULL` として直接 node_id を保存している。

ADR-002 の設計原則「匿名 ID 月度轮换」に反し、`node_id` のまま保存すると長期的に同一ユーザーの行動追跡が可能になる。ADR-002 が実装 SQL に対して要求する匿名化処理方針を明示する必要がある。

---

### [Minor] 問題 19: `community_votes` テーブルの voter カラム名の差異

**深刻度**: Minor
**場所**: ADR-002「6.9 DB 表结构扩展」vs `C:\work\grc\src\shared\db\migrations\001_initial.sql`

ADR-002 の投票テーブルでは投票者識別子として `node_id VARCHAR(255)` を使用しているが、実装 SQL では `voter_node_id VARCHAR(255)` と異なる名称を使用している。UNIQUE KEY 定義も異なる（ADR-002: `uk_node_target (node_id, target_type, target_id)` vs 実装: `uk_vote (target_type, target_id, voter_node_id)`）。

---

### [Minor] 問題 20: `community_subscriptions` テーブルの列順序・カラム名差異

**深刻度**: Minor
**場所**: ADR-002「6.9 DB 表结构扩展」vs `C:\work\grc\src\shared\db\migrations\001_initial.sql`

ADR-002 では UNIQUE KEY が `uk_node_channel (node_id, channel_id)` であるが、実装では `uk_subscription (channel_id, node_id)` と順序が逆転している。またADR-002 の `subscribed_at` カラムが実装では `created_at` になっている。

---

### [Minor] 問題 21: クライアント設定のデフォルト URL 不一致

**深刻度**: Minor
**場所**: 計画文書 1.4.1 vs ADR-002「7. 新增配置项」

計画文書ではクライアント設定のデフォルト GRC URL が `https://grc.clawhub.com` と記載されているが、ADR-002 では `https://grc.winclawhub.ai` が正しいドメインとして明示されている（計画文書の旧ドメインが混入している）。

---

## 推奨修正 (Recommended Fixes)

### 問題 1 への対応（JWT アルゴリズム）

ADR-002 と実装の間で RS256/HS256 の採用方針を統一する必要がある。

**方針 A**: ADR-002 を修正し HS256 を採用する（実装に合わせる）。秘密鍵管理のシンプルさを優先する場合はこちら。ただし ADR-002 の「安全机制」テーブルの JWT 項目と、クライアント側の署名検証設計を見直すこと。

**方針 B**: 実装を RS256 に変更する（ADR-002 に合わせる）。クライアントが GRC の署名を公開鍵で検証できるようにする場合はこちら。`signToken`/`verifyToken` の実装変更と鍵ペア管理の仕組みが必要。

どちらの方針を採用するかを ADR-002 に明記し、`C:\work\grc\src\shared\utils\jwt.ts` を修正すること。

---

### 問題 2 への対応（Refresh Token）

`IAuthService` インターフェースに以下のメソッドを追加する。

```typescript
/** Issue a refresh token for the given user */
issueRefreshToken(userId: string): Promise<string>;

/** Validate a refresh token and issue a new access token */
refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string } | null>;

/** Revoke a refresh token */
revokeRefreshToken(refreshToken: string): Promise<void>;
```

また `config.ts` の JWT `expiresIn` デフォルト値を "7d" から ADR-002 仕様の "24h" に変更するか、ADR-002 の有効期限記述を "7 days" に修正する。

Refresh Token の永続化には専用テーブル（`refresh_tokens`）が必要であり、DB マイグレーションへの追加が必要となる。

---

### 問題 3、4 への対応（コミュニティ DB スキーマ）

`C:\work\grc\src\shared\db\migrations\001_initial.sql` の community_channels テーブルに以下のカラムを追加する。

```sql
`display_name` VARCHAR(255) NOT NULL DEFAULT '',
`creator_node_id` VARCHAR(255) DEFAULT NULL,
`is_system` TINYINT(1) NOT NULL DEFAULT 0,
`post_count` INT NOT NULL DEFAULT 0,
```

また ADR-002 の「完整数据库架构」セクションの `community_topics` / `community_replies` 定義を Phase 3 設計（`author_node_id`、`channel_id`、`post_type`、`score`、`is_distilled` 等）に全面更新し、旧来の `author_id CHAR(36)` ベースの定義を削除すること。

---

### 問題 5 への対応（バイナリダウンロード API）

ADR-002 の「3.2 API」セクションに以下のエンドポイントを追記する。

```yaml
GET /api/v1/update/download/:version/:platform
  Description: 指定バージョン・プラットフォームのバイナリを直接ダウンロードまたは CDN URL にリダイレクト
  Query: { channel?: 'stable'|'beta'|'dev' }
  Response: 302 Redirect to CDN URL または binary stream
  Auth: 不要（公開エンドポイント）
```

または GRC が CDN への中継を行わない設計であれば、その旨を ADR-002 の 3.3 節（三渠道分发）に明記する。

---

### 問題 6〜10 への対応（DB スキーマの各種不一致）

ADR-002 の「完整数据库架构」セクションと `C:\work\grc\src\shared\db\migrations\001_initial.sql` を照合し、どちらを「真の設計」とするかを決定した上で、双方を同期させること。

推奨: 実装 SQL（`001_initial.sql`）の方がより実装を意識した設計（`tarball_sha256` の長さ制約、`skill_versions.metadata` JSON 等）になっているため、ADR-002 の「完整数据库架构」セクションを実装 SQL に合わせて更新することを推奨する。ただし以下のフィールドについては ADR-002 の設計意図を尊重して実装 SQL に追加すること。

- `users.promoted_asset_count`
- `nodes.display_name`、`nodes.capsule_count`、`nodes.updated_at`
- `genes.category`、`genes.constraints_data`、`genes.validation`、`genes.fail_count`、`genes.chain_id`、`genes.schema_version`、`genes.safety_score`、`genes.promoted_at`
- `client_releases.min_upgrade_version`（増量更新機能の必須フィールド）

---

### 問題 11 への対応（Rate Limit 数値）

計画文書と ADR-002 の間で Free OAuth ユーザーの Rate Limit（500 vs 1000 req/hour）の不一致を解消すること。ADR-002 の 4.4 節の値（Free 500、Contributor 1000）を正式採用するか、計画文書の値（OAuth 1000）を採用するかを明確にし、ADR-002 の「4.4 速率限制」テーブルと `C:\work\grc\src\shared\middleware\rate-limit.ts` の `TIER_LIMITS` 定数を統一すること。

---

### 問題 12 への対応（API Key 認証の不完全な委譲）

`auth.ts` の API Key 処理を以下のいずれかのパターンで標準化すること。

**推奨パターン**: `createAuthMiddleware` を工場関数として受け取る `IAuthService` を引数に含め、API Key 検証をミドルウェア内で完結させる。

```typescript
export function createAuthMiddleware(config: GrcConfig, authService: IAuthService, required = true) {
  // API Key ハンドラ内で authService.validateApiKey(apiKey) を呼ぶ
}
```

`_rawApiKey` というアンドキュメントなプロパティの使用は廃止し、認証結果を `req.auth` に統一して格納すること。

---

### 問題 13 への対応（admin-auth.ts）

`C:\work\grc\src\shared\middleware\admin-auth.ts` に実際の管理者認証ロジックを実装すること。実装すべき内容は以下の通り。

```typescript
export function requireAdmin(config: GrcConfig) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth || req.auth.role !== "admin") {
      return res.status(403).json({ error: "forbidden", message: "Admin access required" });
    }
    next();
  };
}
```

各モジュールの `admin-routes.ts` は必ずこのミドルウェアを先頭に適用すること。ADR-002 にも管理者ミドルウェアの適用方針を明記すること。

---

### 問題 18 への対応（テレメトリ匿名化）

`telemetry_reports` テーブルに `node_id` を直接保存する設計は ADR-002 の「匿名 ID 月度轮换」原則に反する。以下のいずれかを実装し ADR-002 に反映すること。

**方針 A**: テーブルに `anonymous_id VARCHAR(64)` カラムを追加し、API 受信時に `SHA256(node_id + YYYY-MM)` で計算したハッシュを保存。`node_id` は保存しない。

**方針 B**: テーブルは現状（`node_id` 保存）のままとし、ADR-002 の匿名化説明を「node_id はサーバー側のみに保持され、公開 API からは匿名 ID としてのみ露出される」と修正する。

---

## ADR-002 への追記推奨 (Recommended Additions to ADR-002)

### 追記 1: エラーハンドリング戦略の明文化

ADR-002 には各 API のエラーレスポンス形式が定義されていない。実装では `C:\work\grc\src\shared\middleware\error-handler.ts` に標準化されたエラーフォーマットが存在するため、以下を ADR-002 に追記すること。

```
全エンドポイント共通エラーレスポンス形式:
{
  "error": "error_code",    // snake_case の機械可読コード
  "message": "Human readable message",
  "details": [...]           // バリデーションエラー時のみ
}

標準 HTTP ステータスコード:
- 400: validation_error（Zod バリデーション失敗）
- 401: authentication_required / invalid_token
- 403: insufficient_scope / insufficient_tier / forbidden
- 404: not_found
- 409: conflict（重複リソース）
- 429: rate_limit_exceeded
- 500: internal_error
```

### 追記 2: API Key テーブルの `key_prefix` カラムの設計意図

ADR-002 の api_keys テーブル定義には `key_prefix` が存在しないが、実装 SQL には `key_prefix VARCHAR(20)` が存在する。これは API Key の最初の 8 文字を識別用に保存するものであり、ログや UI での表示に使用する。ADR-002 の api_keys テーブル定義に追加すること。

### 追記 3: Modular Monolith のモジュール間依存ルールの強制手段

ADR-002 Appendix B には「モジュール間は `shared/` 経由でのみ依存（直接 import 禁止）」と記載されているが、この制約を技術的にどのように強制するかが未定義。以下を追記すること。

- ESLint の import ルール設定（`no-restricted-imports`）による直接 import 検出
- CI パイプラインでの依存関係チェック
- `shared/interfaces/` に定義された interface の一覧と各モジュールが実装すべき interface の対応表

### 追記 4: ヘルスチェック API の詳細仕様

ADR-002 には `GET /health` エンドポイントが成功指標（GRC サーバー起動確認）に必要とされているが、レスポンス形式が未定義。実装では以下の形式が採用されているため、ADR-002 に追記すること。

```yaml
GET /health
  Response: {
    status: "ok",
    service: "grc-server",
    version: string,
    timestamp: ISO8601
  }
```

### 追記 5: GRC Sync Service の完全仕様

ADR-002「10. GRC 同步服务」セクションに Community 参加フェーズが存在しない（Phase 3 を想定した追記が未実施）。計画文書 1.4.3 には 5 ステップのループが定義されているが、ADR-002 Section 6.3「心跳社区交互」と統合した 6 ステップ版を ADR-002 に追記すること。

### 追記 6: docker-compose.yml 全サービス定義

ADR-002 Appendix B の「モジュール化コード構造」に `docker-compose.yml` への言及はあるが、具体的なサービス定義（全コンテナの image、ports、volumes、depends_on、healthcheck、environment）が未記載。最低限以下のサービス定義を追記すること。

- `grc-server`（`C:\work\grc\src` → port 3100）
- `grc-dashboard`（`C:\work\grc\dashboard` → port 80）
- `mysql`（MySQL 8.0 → port 3306）
- `redis`（Redis 7 → port 6379）
- `minio`（MinIO → port 9000/9001）
- `meilisearch`（Meilisearch → port 7700）
- `nginx`（リバースプロキシ → port 80/443）

### 追記 7: 管理者 role のライフサイクル管理

ADR-002 には `users.role = 'admin'` フィールドへの言及があるが、管理者をどのように任命するか（初期管理者の作成方法、昇格・降格 API の有無）が未定義。`config.ts` の `admin.emails` による環境変数管理との関係を明示すること。

---

*本レポートは ADR-002 を直接修正することなく、発見された問題点と推奨対応策を列挙したものです。ADR-002 への修正は別途レビューと承認プロセスを経て実施してください。*
