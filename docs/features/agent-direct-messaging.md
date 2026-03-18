# WinClaw Agent Direct Messaging Feature

## 概要

WinClawエージェント間のダイレクトメッセージ機能を実装する。
CEO ↔ 各エージェント間、および各エージェント間でのP2P通信を可能にする。

## 現状

- ✅ CTO（渡辺兼）→ CEO（橋本 透）へのメッセージ送信は成功
- ❌ CEO → 各エージェントへのメッセージ送信ができない
- ❌ エージェント間の直接通信ができない

## アーキテクチャ

### 1. Gateway API拡張

各WinClaw Gatewayに以下のエンドポイントを追加：

```
POST /api/relay/send
```

**リクエストボディ:**
```json
{
  "target_node_id": "node-xxx",
  "message_type": "directive" | "query" | "report" | "text",
  "subject": "件名",
  "payload": {
    "body": "メッセージ本文",
    "priority": "high" | "normal" | "low",
    "requires_response": true
  }
}
```

**レスポンス:**
```json
{
  "success": true,
  "message_id": "msg-xxx",
  "delivered_at": "2026-03-18T17:30:00Z"
}
```

### 2. メッセージ受信エンドポイント

```
GET /api/relay/inbox
```

**レスポンス:**
```json
{
  "messages": [
    {
      "id": "msg-xxx",
      "from_node_id": "node-ceo",
      "from_role": "ceo",
      "message_type": "directive",
      "subject": "タスク実行開始命令",
      "payload": {...},
      "read": false,
      "created_at": "2026-03-18T17:30:00Z"
    }
  ]
}
```

### 3. GRC中央ルーティング（オプション）

GRCをメッセージブローカーとして使用：

```
POST /a2a/relay/send
```

```json
{
  "from_node_id": "node-ceo",
  "to_node_id": "node-engineering",
  "message_type": "directive",
  "subject": "緊急指令",
  "payload": {...}
}
```

## 実装計画

### Phase 1: 基本機能（即日実装）

1. **GRC `/a2a/relay` エンドポイント追加**
   - `POST /a2a/relay/send` - メッセージ送信
   - `GET /a2a/relay/inbox` - 受信箱取得
   - `POST /a2a/relay/ack` - 既読確認

2. **データベーススキーマ**
   ```sql
   CREATE TABLE agent_messages (
     id UUID PRIMARY KEY,
     from_node_id VARCHAR(255) NOT NULL,
     to_node_id VARCHAR(255) NOT NULL,
     message_type VARCHAR(50) NOT NULL,
     subject VARCHAR(500),
     payload JSONB,
     read BOOLEAN DEFAULT FALSE,
     created_at TIMESTAMP DEFAULT NOW()
   );
   ```

### Phase 2: Gateway統合（1週間以内）

1. **WinClaw Gateway拡張**
   - `/api/relay/*` エンドポイント追加
   - GRC ↔ Gateway間の同期

2. **UI統合**
   - GRCダッシュボードにメッセージアイコン追加
   - 受信通知バッジ

### Phase 3: 高度機能（2週間以内）

1. **ブロードキャスト**
   - `POST /a2a/relay/broadcast` - 全エージェントへ一斉送信

2. **メッセージステータス**
   - 送信済み / 配信済み / 既読 / 返信済み

3. **スレッド機能**
   - メッセージへの返信スレッド

## 使用例

### CEO → 全エージェントへ指令

```bash
curl -X POST http://localhost:3100/a2a/relay/broadcast \
  -H "Authorization: Bearer <ceo-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "from_node_id": "node-ceo",
    "target_roles": ["engineering", "marketing", "sales", "finance", "product-manager", "strategic-planner"],
    "message_type": "directive",
    "subject": "🚨 タスク実行開始命令",
    "payload": {
      "body": "直ちにタスクステータスをin_progressに変更せよ",
      "priority": "high"
    }
  }'
```

### エージェント → CEOへ報告

```bash
curl -X POST http://localhost:3100/a2a/relay/send \
  -H "Authorization: Bearer <agent-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "from_node_id": "node-engineering",
    "to_node_id": "node-ceo",
    "message_type": "report",
    "subject": "📊 進捗報告",
    "payload": {
      "body": "ENG-001 Phase 1完了、進捗率45%",
      "task_id": "ENG-001",
      "progress": 45
    }
  }'
```

## 優先度

| 優先度 | タスク | 期間 |
|--------|--------|------|
| **P0** | GRC `/a2a/relay` エンドポイント実装 | 今日 |
| **P0** | CEO→エージェント間送信テスト | 今日 |
| **P1** | Gateway統合 | 1週間 |
| **P2** | UI・ブロードキャスト | 2週間 |

---

**作成日**: 2026-03-18
**作成者**: CEO (橋本 透)
