/**
 * Seed role_job_descriptions table with JD data for all 9 roles.
 * Uses INSERT ... ON DUPLICATE KEY UPDATE for idempotent operation.
 *
 * Usage: node scripts/seed-job-descriptions.mjs
 */
import mysql from "mysql2/promise";

const DB_URL = process.env.DATABASE_URL || "mysql://root:Admin123@13.78.81.86:18306/grc-server";

const JOB_DESCRIPTIONS = [
  {
    role_id: "ceo",
    display_name: "最高経営責任者 (CEO)",
    summary: "会社全体の経営方針を策定し、各部門を統括する最終意思決定者",
    responsibilities: "- 経営戦略の策定と実行\n- 各部門の業績監督\n- 重要な意思決定と承認\n- 外部ステークホルダーとの関係管理\n- 組織全体の方向性設定",
    expertise: JSON.stringify(["経営戦略", "意思決定", "組織マネジメント", "リーダーシップ"]),
    reports_to: null,
    collaboration: JSON.stringify({
      "engineering-lead": "技術判断の相談",
      "finance": "予算承認",
      "product-manager": "製品方針決定",
      "marketing": "マーケ戦略承認",
      "sales": "商談エスカレーション",
      "strategic-planner": "中長期戦略策定",
      "hr": "人事判断",
      "customer-support": "重要顧客対応",
    }),
  },
  {
    role_id: "engineering-lead",
    display_name: "エンジニアリングリード",
    summary: "技術戦略の策定とエンジニアリングチームの統括",
    responsibilities: "- 技術アーキテクチャの設計と意思決定\n- 開発チームのマネジメント\n- 技術的課題の解決\n- コードレビューと品質管理\n- 技術ロードマップの策定",
    expertise: JSON.stringify(["ソフトウェア開発", "システム設計", "技術マネジメント", "DevOps"]),
    reports_to: "ceo",
    collaboration: JSON.stringify({
      "product-manager": "機能仕様の確認",
      "ceo": "技術投資の承認",
      "strategic-planner": "技術ロードマップ",
    }),
  },
  {
    role_id: "finance",
    display_name: "財務担当",
    summary: "会社の財務管理、予算策定、経費管理を担当",
    responsibilities: "- 予算の策定と管理\n- 経費の承認と監査\n- 財務レポートの作成\n- キャッシュフロー管理\n- 財務リスクの評価",
    expertise: JSON.stringify(["財務管理", "予算策定", "会計", "財務分析"]),
    reports_to: "ceo",
    collaboration: JSON.stringify({
      "ceo": "予算承認",
      "sales": "売上予測",
      "marketing": "マーケ予算",
    }),
  },
  {
    role_id: "product-manager",
    display_name: "プロダクトマネージャー",
    summary: "製品戦略の策定と開発プロセスの管理",
    responsibilities: "- 製品ロードマップの策定\n- ユーザーリサーチと要件定義\n- 開発チームとの連携\n- KPIの設定と追跡\n- 競合分析",
    expertise: JSON.stringify(["プロダクト戦略", "UX", "アジャイル", "市場分析"]),
    reports_to: "ceo",
    collaboration: JSON.stringify({
      "engineering-lead": "開発連携",
      "marketing": "GTM戦略",
      "sales": "顧客フィードバック",
      "ceo": "製品方針承認",
    }),
  },
  {
    role_id: "marketing",
    display_name: "マーケティング担当",
    summary: "マーケティング戦略の策定と実行",
    responsibilities: "- マーケティング戦略の策定\n- 広告キャンペーンの企画と実行\n- ブランド管理\n- 市場調査とデータ分析\n- コンテンツ制作",
    expertise: JSON.stringify(["マーケティング", "広告", "ブランディング", "データ分析"]),
    reports_to: "ceo",
    collaboration: JSON.stringify({
      "sales": "リード創出",
      "product-manager": "製品マーケ",
      "ceo": "マーケ予算承認",
      "finance": "予算管理",
    }),
  },
  {
    role_id: "sales",
    display_name: "営業担当",
    summary: "営業戦略の策定と顧客開拓",
    responsibilities: "- 営業戦略の策定\n- 顧客開拓と関係構築\n- 商談管理\n- 売上予測\n- 契約交渉",
    expertise: JSON.stringify(["営業", "顧客管理", "交渉", "CRM"]),
    reports_to: "ceo",
    collaboration: JSON.stringify({
      "marketing": "リード共有",
      "finance": "売上報告",
      "product-manager": "顧客要望",
      "ceo": "大型案件承認",
    }),
  },
  {
    role_id: "strategic-planner",
    display_name: "戦略企画担当",
    summary: "中長期戦略の策定と事業計画の立案",
    responsibilities: "- 中長期戦略の策定\n- 市場動向の分析\n- 新規事業の評価\n- KPIフレームワークの設計\n- 経営会議の資料作成",
    expertise: JSON.stringify(["戦略企画", "事業計画", "市場分析", "KPI設計"]),
    reports_to: "ceo",
    collaboration: JSON.stringify({
      "ceo": "戦略承認",
      "product-manager": "製品戦略",
      "finance": "投資計画",
      "marketing": "市場分析共有",
    }),
  },
  {
    role_id: "hr",
    display_name: "人事担当",
    summary: "人事戦略の策定と組織開発を担当",
    responsibilities: "- 採用戦略の策定と実行\n- 人材育成プログラムの設計\n- 労務管理と福利厚生\n- 組織文化の醸成\n- パフォーマンス評価制度の運用",
    expertise: JSON.stringify(["人事管理", "採用", "人材育成", "労務"]),
    reports_to: "ceo",
    collaboration: JSON.stringify({
      "ceo": "人事判断承認",
      "engineering-lead": "技術採用",
      "finance": "人件費管理",
    }),
  },
  {
    role_id: "customer-support",
    display_name: "カスタマーサポート",
    summary: "顧客対応と満足度向上を担当",
    responsibilities: "- 顧客問い合わせの対応\n- FAQとナレッジベースの管理\n- 顧客満足度の向上施策\n- エスカレーション対応\n- サポートプロセスの改善",
    expertise: JSON.stringify(["カスタマーサポート", "コミュニケーション", "問題解決", "CRM"]),
    reports_to: "ceo",
    collaboration: JSON.stringify({
      "product-manager": "不具合報告",
      "engineering-lead": "技術的質問",
      "sales": "顧客引継ぎ",
      "ceo": "重要顧客エスカレーション",
    }),
  },
];

async function main() {
  console.log("Connecting to database...");
  const connection = await mysql.createConnection(DB_URL);

  console.log("Seeding role_job_descriptions...\n");

  let upserted = 0;
  let errors = 0;

  for (const jd of JOB_DESCRIPTIONS) {
    try {
      await connection.execute(
        `INSERT INTO role_job_descriptions
           (role_id, display_name, summary, responsibilities, expertise, reports_to, collaboration)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           display_name = VALUES(display_name),
           summary = VALUES(summary),
           responsibilities = VALUES(responsibilities),
           expertise = VALUES(expertise),
           reports_to = VALUES(reports_to),
           collaboration = VALUES(collaboration)`,
        [
          jd.role_id,
          jd.display_name,
          jd.summary,
          jd.responsibilities,
          jd.expertise,
          jd.reports_to,
          jd.collaboration,
        ],
      );
      console.log(`  [OK] ${jd.role_id} — ${jd.display_name}`);
      upserted++;
    } catch (err) {
      console.error(`  [FAIL] ${jd.role_id}: ${err.message}`);
      errors++;
    }
  }

  console.log(`\n========================================`);
  console.log(`  Upserted: ${upserted}  |  Errors: ${errors}`);
  console.log(`========================================\n`);

  await connection.end();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
