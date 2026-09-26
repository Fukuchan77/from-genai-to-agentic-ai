# 次世代Agentic AIアプリケーション開発マスターカリキュラム

## 〜 生成AIからAgentic AIへ：Next.js 16 & Vercel AI SDK v7 による完全移行と実践工学 〜

---

## 0. カリキュラム策定方針とパラダイムシフト

### 0.1 本カリキュラムの目的

本学習プランは、従来の「プロンプティングと単純なAPI呼び出し（受動的生成AI）」および「Python / LangChain / LangGraphに依存した重厚なプロトタイプ」から脱却し、**「Web標準・完全型安全・本番稼働品質を備えた自律型Agentic AIシステム」**をゼロから構築できるフルスタックエンジニア・アーキテクトを育成するための総合シラバスです。

以下の3つの名著・教材の知見を現代のWebエコシステムへ統合・昇華させます。

1. **『つくりながら学ぶ！AIアプリ開発入門』(Web Book)**: Streamlitによるプロトタイピングから、Next.js 16 + React Compiler 19 による本番UI/UXへの昇華。
2. **『LangChain と LangGraph による RAG・AI エージェント［実践］入門』(書籍)**: LCELや過度なグラフ抽象化を排し、TypeScriptの関数合成と Vercel AI SDK Core による透明性の高いエージェントループへの刷新。
3. **『現場で活用するためのAIエージェント実践入門』(書籍)**: 実務ドメイン（ヘルプデスク、データ分析、論文調査等）への適用手法を、Model Context Protocol (MCP) や E2B サンドボックス、堅牢なCI/CD評価（Vitest / Evals）へと最新化。

---

### 0.2 IBM定義に基づく3段階の概念成熟度モデル

本カリキュラムでは、IBMの定義に厳格に準拠し、受講者がシステムの「自律性の水準（Agency）」を正しく弁別できるよう設計します。

```
[Level 1: Generative AI (受動的生成)]
   └─ 入力プロンプトに対して静的コンテンツ（文章・画像・コード）を出力して完了。
      状態変更を持たず、環境との能動的対話は行わない。

[Level 2: AI Agents (タスク自動化)]
   └─ 事前定義されたワークフローに基づき、特定の単一タスクやルール化された外部ツールを実行。
      局所的な決定論的処理が中心。

[Level 3: Agentic AI (自律型エージェントシステム)]
   └─ 最小限の人間の介入で、複雑でオープンエンドな長期目標を達成。
      IBMの7段階閉ループ（知覚→推論→目標設定→意思決定→実行→学習/適応→オーケストレーション）を
      自律的に反復し、環境の状態を物理的に変更（State Mutation）し続ける。
```

---

### 0.3 想定技術スタック仕様

| 分類                         | 採用技術       | バージョン / 仕様                                    | 採択理由・アーキテクチャ特性                                          |
| :--------------------------- | :------------- | :--------------------------------------------------- | :-------------------------------------------------------------------- |
| **ランタイム**               | Node.js        | `v26.10+` (LTS)                                      | 最新のWeb Streams API、V8最適化、安定した非同期処理                   |
| **パッケージマネージャ**     | pnpm           | `v12.6+`                                             | 高速なシンボリックリンク解決、Monorepoワークスペースの厳密管理        |
| **ビルド / フレームワーク**  | Next.js        | `v16.4+` (Turbopack)                                 | デフォルトTurbopack、App Router、Server Actions、Streaming SSR        |
| **フロントエンドコンパイラ** | React Compiler | `v19.3+`                                             | 手動メモ化（`useMemo`, `useCallback`）の撤廃、差分レンダリング最適化  |
| **言語仕様**                 | TypeScript     | `v7.1+` (Strict mode)                                | 最新の型推論機能、パターンマッチング親和性、エンドツーエンド型安全性  |
| **AIツールキット**           | Vercel AI SDK  | `v7.0+` (`ai`, `@ai-sdk/*`)                          | Web標準ストリーム準拠、マルチプロバイダ統一、UI連携フック             |
| **ランタイム検証**           | Zod            | `v4.6+`                                              | 超高速パース、JSON Schemaネイティブ出力（Structured Outputs完全整合） |
| **コード品質管理**           | Biome          | `v2.5+`                                              | Rust製高速Linter/Formatter、型定義とインポートの自動整理              |
| **テストフレームワーク**     | Vitest         | `v5.0+`                                              | 高速並列テスト実行、LLM-as-a-JudgeおよびEvalsのCI/CD統合              |
| **外部実行環境**             | E2B / MCP      | `@e2b/code-interpreter`, `@modelcontextprotocol/sdk` | 安全なサンドボックスコード実行、業界標準プロトコルによる外部連携      |

---

## 1. 全体学習ロードマップ概要

学習は以下の4つの体系的フェーズ（全16モジュール）で進行します。

```
┌────────────────────────────────────────────────────────────────────────┐
│ Phase 1: 【基礎編】モダンWebネイティブAIアプリ開発（第1週〜第3週）        │
│  - 受動的生成AIからTool Callingへ / Vercel AI SDK Core 4大プリミティブ   │
│  - StreamlitからNext.js 16 + React Compiler 19へのパラダイム転換        │
│  - Zod 4.6 による構造化出力（Structured Outputs）とプロンプトキャッシュ │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│ Phase 2: 【発展編】モダンRAGと決定論的ワークフローパターン（第4週〜第7週）│
│  - LangChain LCELからの脱却：TypeScriptネイティブなパイプライン合成     │
│  - pgvector + Reciprocal Rank Fusion (RRF) による Advanced RAG         │
│  - Anthropicの5大ワークフローパターン（Chaining, Routing, Parallel,     │
│    Orchestrator-Workers, Evaluator-Optimizer）の実装                   │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│ Phase 3: 【現場実践編】実務ドメイン特化型エージェント開発（第8週〜第11週） │
│  - Model Context Protocol (MCP) による標準化されたACI（ツール）統合    │
│  - E2Bサンドボックス連携によるセキュアな自律コード実行とリフレクション   │
│  - 実践3大ドメイン：ヘルプデスク（Plan-and-Execute）、データ分析、論文探索│
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│ Phase 4: 【運用・品質編】Agentic AIのハーネス工学とEvals（第12週〜第14週） │
│  - コンテキストエンジニアリング（Compaction、段階的開示、Context Rot対策）│
│  - 長時間実行エージェントハーネス（Initializer - Worker 2層構造）      │
│  - Agent Evals（Vitest 5.0による自動回帰テスト、LLM-as-a-Judge）       │
│  - ブラスト半径の制御、Human-in-the-Loop、OpenTelemetryオブザーバビリティ│
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. 各フェーズの詳細シラバスとハンズオンカリキュラム

### Phase 1: 【基礎編】モダンWebネイティブAIアプリ開発

> **対象元本**: 『つくりながら学ぶ！AIアプリ開発入門』全編の最新化

#### モジュール 1-1: 開発環境構築とモダンスタックの基盤設計

- **学習目標**:
  - pnpm v12 + Node v26 によるモノレポ環境を構築し、Next.js 16.4 (Turbopack) と React Compiler 19.3 の動作を理解する。
  - Biome v2.5 による厳格なリンティング・フォーマットルールを策定する。
- **主要トピック**:
  - Python/Streamlitの「全行再実行モデル」と Next.js App Router の「差分ストリーミングレンダリング」のアーキテクチャ比較。
  - Server Components と Client Components の境界設計。
  - APIキー漏洩を防ぐサーバーサイド実行の原則。
- **ハンズオン**:
  - pnpm ワークスペースを用いた `apps/web` と `packages/ai-core` のモノレポ初期化。
  - `biome.json` の設定と CI ワークフローの構築。

#### モジュール 1-2: Vercel AI SDK v7 Core 4大プリミティブの完全習得

- **学習目標**:
  - `generateText`, `streamText`, `generateObject`, `streamObject` の使い分けをマスターする。
  - 複数プロバイダ（OpenAI, Anthropic Claude, Google Gemini）の動的差し替えを実装する。
- **主要トピック**:
  - Web Streams API に準拠したレスポンス制御（`toDataStreamResponse()`）。
  - 思考プロセストークン（Reasoning Tokens / Thinking Blocks）のストリーミング受信とUI分離。
- **ハンズオン**:
  - 単一UIからモデル（GPT-4o / Claude 3.7 Sonnet / Gemini 2.5 Flash）を瞬時に切り替え可能なリアルタイムストリーミングチャットの実装。

#### モジュール 1-3: Zod v4.6 による構造化出力（Structured Outputs）と要約パイプライン

- **学習目標**:
  - 従来の正規表現・プロンプトベースのパースを完全撤廃し、LLMネイティブの JSON Schema 制約による 100% 型安全なオブジェクト出力を実現する。
- **主要トピック**:
  - `generateObject` / `streamObject` によるスキーマ駆動開発。
  - 大規模WebページやYouTube字幕データの取得と段階的要約。
  - **Prompt Caching（プロンプトキャッシュ）**の原理とコスト削減（90%削減）の技法。
- **ハンズオン**:
  - Web記事 / 動画トランスクリプトを入力とし、タイトル・3行要点・重要タグ・アクション項目を型安全に抽出し、Next.js UIのカードコンポーネントへ即座に描画するアプリケーションの作成。

---

### Phase 2: 【発展編】モダンRAGと決定論的ワークフローパターン

> **対象元本**: 『LangChain と LangGraph による RAG・AI エージェント［実践］入門』の最新化

#### モジュール 2-1: LangChain脱却とTypeScriptネイティブなRAG基盤

- **学習目標**:
  - LCEL（LangChain Expression Language）のブラックボックスを排除し、TypeScriptの非同期関数合成によって保守性の高いRAGを実装する。
- **主要トピック**:
  - チャンキング戦略（セマンティック・マークダウン境界を意識した分割）。
  - AI SDK `embed` / `embedMany` と PostgreSQL (`pgvector`) の直接連携。
  - コサイン類似度検索とメタデータフィルタリング。
- **ハンズオン**:
  - Drizzle ORM + pgvector による PDF ナレッジベースのインデックス作成と、引用元（Citations）付き回答ストリーミングAPIの構築。

#### モジュール 2-2: Advanced RAG とハイブリッド検索

- **学習目標**:
  - ナイーブなベクトル検索の限界（キーワード不一致、文脈欠落）を高度なアルゴリズムで克服する。
- **主要トピック**:
  - **HyDE (Hypothetical Document Embeddings)**: 仮想回答を生成してからのベクトル検索。
  - **Multi-Query 展開**: `generateObject` による検索クエリの多角化。
  - **Reciprocal Rank Fusion (RRF)**: 全文検索（Postgres tsvector）とベクトル検索の融合。
  - **Reranking**: Cohere Rerank API による高精度な最終選別。
- **ハンズオン**:
  - ユーザーの曖昧な問い合わせから3つのサブクエリを並列生成し、ハイブリッド検索＋Rerankを行って回答精度を飛躍させるパイプラインの実装。

#### モジュール 2-3: Anthropic 5大ワークフローパターンの実装工学

- **学習目標**:
  - LangGraph等の複雑なグラフを使わず、Anthropicが提唱する「決定論的ワークフロー」を素のTypeScriptとAI SDKで実装する。
- **詳細パターン**:
  1. **Prompt Chaining**: 直列パイプラインとステップ間バリデーション。
  2. **Routing**: 入力意図に応じたモデル・処理の動的分岐。
  3. **Parallelization**: Sectioning（分割並列）と Voting（多数決・合議）。
  4. **Orchestrator-Workers**: 親エージェントによる動的タスク分解と並列ワーカー委譲。
  5. **Evaluator-Optimizer**: 生成と客観的ルーブリック評価による自己改善ループ。
- **ハンズオン**:
  - 仕様書のドラフト生成 $\rightarrow$ 専門評価器（セキュリティ・パフォーマンス）による並列採点 $\rightarrow$ 合格基準（85点）に達するまで自動推敲する Evaluator-Optimizer システムの構築。

---

### Phase 3: 【現場実践編】実務ドメイン特化型エージェント開発

> **対象元本**: 『現場で活用するためのAIエージェント実践入門』の最新化

#### モジュール 3-1: ACI工学と Model Context Protocol (MCP)

- **学習目標**:
  - Anthropicが提唱する「ACI（Agent-Computer Interface）設計原則」を理解し、エージェントが迷走しないツールを設計する。
  - プロプライエタリなツール定義から、業界標準規格 **MCP (Model Context Protocol)** への接続を実装する。
- **主要トピック**:
  - ポカヨケ（Poka-Yoke）思想：相対パス禁止、セマンティックな識別子、response_format指定。
  - 生のスタックトレースではなく「修正アクションを促すガイド」を返すエラーハンドリング。
  - `@modelcontextprotocol/sdk` を用いたMCPサーバー・クライアントの実装。
- **ハンズオン**:
  - GitHub / ローカルファイルシステムを操作するMCPサーバーとAI SDKクライアントの双方向接続。

#### モジュール 3-2: ドメイン実践①：ヘルプデスク・エージェント（Plan-and-Execute）

- **学習目標**:
  - 複雑な問い合わせに対し、最初に「実行計画」を策定し、進捗を更新しながら自律実行するパターンを習得する。
- **主要トピック**:
  - Planner (`generateObject`) によるタスク依存グラフの生成。
  - Executor (`streamText` + `tools`) による動的ツール実行。
  - Replanner による計画の動的組み替え。
- **ハンズオン**:
  - ブラウザ上で「現在のタスク」「完了タスク」「修正された計画」がリアルタイムにステップ表示されるNext.jsヘルプデスクダッシュボードの開発。

#### モジュール 3-3: ドメイン実践②：データ分析エージェント（E2B サンドボックス & 自己修正）

- **学習目標**:
  - クラウド上のセキュアな隔離環境（E2B）内で Python スクリプトを自律生成・実行させ、エラー発生時に自律リカバリするシステムを構築する。
- **主要トピック**:
  - TypeScriptから `@e2b/code-interpreter` を操作するアーキテクチャ。
  - 実行時エラー（Traceback）をLLMへフィードバックするリフレクションループ。
  - 生成されたグラフ画像（Base64 PNG）や表データのUIストリーミング。
- **ハンズオン**:
  - CSV/Excelファイルをアップロードし、「売上推移と異常値を分析して可視化せよ」というプロンプトから、コード生成 $\rightarrow$ サンドボックス実行 $\rightarrow$ エラー自動修正 $\rightarrow$ チャート描画までを自律完遂するエージェントの実装。

#### モジュール 3-4: ドメイン実践③：階層型論文リサーチエージェント（Agent-as-a-Tool）

- **学習目標**:
  - 複数の専門エージェントを束ねる階層型マルチエージェントを、複雑なメッセージパッシングフレームワークを使わずに実装する。
- **主要トピック**:
  - **Agent-as-a-Tool パターン**: Supervisor Agent のツール引数としてサブエージェントをラップする設計。
  - arXiv API 連携と論文の批判的精読。
- **ハンズオン**:
  - 「検索専門エージェント」「数式・手法精読エージェント」「市場影響評価エージェント」を統括し、最新AI論文の総合リサーチレポートをMarkdown形式で自動出力するシステム。

---

### Phase 4: 【運用・品質編】Agentic AIのハーネス工学とEvals

> **対象元本**: Anthropic Engineering最新知見（Evals, Harnesses, Context Engineering）の体系化

#### モジュール 4-1: コンテキストエンジニアリングと注意バジェット管理

- **学習目標**:
  - トークン枯渇や「Context Rot（長文による注意散漫・指示追従性低下）」を防ぐコンテキスト最適化手法を実装する。
- **主要トピック**:
  - システムプロンプトの「適正高度（Goldilocks Zone）」設計。
  - **Compaction（コンパクション）**: 未解決事項と重要変数のみを抽出したコンテキスト再構築。
  - **Structured Note-Taking**: 外部ストレージ（`NOTES.md` や DB）への記憶のオフロード。
  - **段階的開示（Progressive Disclosure）**: 大規模データを直接コンテキストに入れず、コード実行で集約・フィルタリングした結果のみを返す技法。
- **ハンズオン**:
  - 長時間の会話ログから定期的にコンパクションを実行し、常に注意バジェットを健全に保つ会話管理エンジンの実装。

#### モジュール 4-2: 長時間実行ハーネス（Long-Running Harnesses）

- **学習目標**:
  - セッションをまたぐ長時間タスクにおいて、「中途半端な状態での早期完了宣言（勝利宣言の誤謬）」を防ぐ2層エージェントアーキテクチャを構築する。
- **主要トピック**:
  - **Initializer Agent**: 要件定義、詳細タスク分解（`feature_list.json` の全項目 `passes: false` 初期化）、テストスクリプト（`init.sh`）の生成。
  - **Worker Agent**: 単一タスクの実装、事前テスト、実機テスト合格時のみ `passes: true` へのステータス更新、Gitコミットによる引き継ぎ。
- **ハンズオン**:
  - 複数の機能要件を持つWebコンポーネント群を、テストが全件パスするまで反復コミットしながら自律構築する2層ハーネスの実装。

#### モジュール 4-3: Agent Evals（評価工学）と Vitest 5.0 CI/CD統合

- **学習目標**:
  - 過程（Path）ではなく、環境の最終結果（Outcome）を客観評価するエージェント評価パイプラインを構築する。
- **主要トピック**:
  - 評価の4層構造：Task、Trial、Transcript、Outcome。
  - 3大グレーダーの併用：Code-based（決定論的）、LLM-as-a-Judge（ルーブリック採点）、Human SME。
  - 能力評価（Capability Evals）と回帰評価（Regression Evals）の運用ライフサイクル。
  - 評価の飽和（Saturation）対策と過剰トリガー（Overtriggering）防止。
- **ハンズオン**:
  - Vitest 5.0 を用いて、エージェントのDB更新結果やファイル生成結果を検証する自動テストスイートを作成し、GitHub Actions の CI/CD に統合する。

#### モジュール 4-4: 安全設計・ブラスト半径制御・オブザーバビリティ

- **学習目標**:
  - 本番運用における暴走・セキュリティリスク（プロンプトインジェクション、データ破壊）を遮断する。
- **主要トピック**:
  - ブラスト半径（Blast Radius）の最小化：使い捨てコンテナ、リードオンリー権限の分離。
  - **Human-in-the-Loop 権限ゲート**: 破壊的アクション（削除、送信、決済）実行前のUI承認ダイアログの実装。
  - OpenTelemetry (`experimental_telemetry`) による Langfuse / Braintrust トレース連携。
- **ハンズオン**:
  - ツール実行前にクライアント側で「承認 / 拒絶」の入力を待機させ、承認された場合のみサーバー側で処理を再開する対話型セキュアUIの実装。

---

## 3. モダンアーキテクチャ仕様とコード設計規範

本スタックにおける標準的なプロジェクト構成と実装パターンを定義します。

### 3.1 ディレクトリ構成（Monorepo設計）

```text
agentic-ai-platform/
├── apps/
│   └── web/                                # Next.js 16.4+ (App Router, Turbopack)
│       ├── app/
│       │   ├── api/
│       │   │   ├── chat/route.ts           # リアルタイムストリーミングチャット
│       │   │   ├── agent/helpdesk/route.ts # Plan-and-Execute エージェント
│       │   │   └── agent/analyst/route.ts  # E2B データ分析エージェント
│       │   ├── dashboard/                  # エージェント監視・実行画面
│       │   └── layout.tsx
│       ├── components/
│       │   ├── agent/
│       │   │   ├── PlanViewer.tsx          # リアルタイム計画進捗表示
│       │   │   ├── ToolApprovalModal.tsx   # Human-in-the-Loop 承認モーダル
│       │   │   └── E2BChartViewer.tsx      # 動的チャートレンダリング
│       │   └── ui/                         # shadcn/ui コンポーネント群
│       └── next.config.ts                  # React Compiler 19.3 有効化設定
├── packages/
│   ├── ai-core/                            # エージェント基盤ロジック (Pure TypeScript)
│   │   ├── src/
│   │   │   ├── workflows/                  # Anthropic 5大ワークフロー
│   │   │   │   ├── chaining.ts
│   │   │   │   ├── evaluator-optimizer.ts
│   │   │   │   └── orchestrator-workers.ts
│   │   │   ├── agents/                     # ドメインエージェント実装
│   │   │   │   ├── helpdesk.ts
│   │   │   │   └── data-analyst.ts
│   │   │   ├── aci/                        # ACI (Tool) 定義集
│   │   │   │   ├── mcp-client.ts
│   │   │   │   └── safe-tools.ts
│   │   │   └── harness/                    # 長時間実行・コンテキスト管理
│   │   │       ├── compaction.ts
│   │   │       └── two-tier-harness.ts
│   │   └── package.json
│   └── eval-suite/                         # Vitest 5.0 による Evals 評価スイート
│       ├── tests/
│       │   ├── capability/                 # 能力評価テスト
│       │   └── regression/                 # 回帰防止テスト
│       ├── vitest.config.ts
│       └── package.json
├── biome.json                              # Biome v2.5 リンター・フォーマッター設定
├── pnpm-workspace.yaml
├── turbo.json
└── package.json
```

---

### 3.2 構成ファイル仕様（設定の基準値）

#### `biome.json` (Biome v2.5+)

```json
{
  "$schema": "https://biomejs.dev/schemas/2.5.0/schema.json",
  "vcs": {
    "enabled": true,
    "clientKind": "git",
    "useIgnoreFile": true
  },
  "files": {
    "ignoreUnknown": false
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "correctness": {
        "noUnusedVariables": "error",
        "noUnusedImports": "error"
      },
      "style": {
        "useConst": "error"
      }
    }
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "single",
      "semicolons": "always"
    }
  }
}
```

#### `apps/web/next.config.ts` (Next.js 16.4+ / React Compiler 19.3+)

```typescript
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Turbopack設定（Next.js 16ではデフォルト有効）
  turbo: {},
  // React Compiler 19 有効化
  experimental: {
    reactCompiler: true,
  },
}

export default nextConfig
```

---

### 3.3 コアコード実装規範

#### パターンA: Evaluator-Optimizer パターン（Vercel AI SDK v7 + Zod v4.6）

LangGraphのグラフステートマシンを使わず、型安全な推論ループを数行で構築します。

```typescript
// packages/ai-core/src/workflows/evaluator-optimizer.ts
import { anthropic } from '@ai-sdk/anthropic'
import { generateObject, generateText } from 'ai'
import { z } from 'zod'

// Zod 4.6 による評価ルーブリックのスキーマ定義
const EvaluationSchema = z.object({
  score: z.number().min(0).max(100).describe('品質スコア（85点以上で合格）'),
  critique: z.string().describe('改善のための具体的かつアクション可能なフィードバック'),
  passes: z.boolean().describe('基準（85点以上）を達成したかどうか'),
})

export interface OptimizationResult {
  finalContent: string
  iterations: number
  history: Array<{ round: number; score: number; critique: string }>
}

export async function runEvaluatorOptimizer(
  task: string,
  maxIterations = 3,
): Promise<OptimizationResult> {
  let currentDraft = ''
  const history: Array<{ round: number; score: number; critique: string }> = []

  // 1. 初回生成（Generator）
  const initial = await generateText({
    model: anthropic('claude-3-7-sonnet-20250219'),
    system: 'あなたは専門のドキュメント作成エキスパートです。',
    prompt: `次のタスクに対する初稿を作成してください: ${task}`,
  })
  currentDraft = initial.text

  // 2. 評価・自己推敲ループ（Evaluator-Optimizer Loop）
  for (let round = 1; round <= maxIterations; round++) {
    // 評価器（Evaluator）
    const evaluation = await generateObject({
      model: anthropic('claude-3-7-sonnet-20250219'),
      schema: EvaluationSchema,
      system:
        'あなたは極めて厳格な客観的査読者です。感情を排し、基準に基づき採点してください。',
      prompt: `以下のドラフトを客観的ルーブリックに基づいて評価・採点してください。\n\n【タスク】\n${task}\n\n【現在のドラフト】\n${currentDraft}`,
    })

    history.push({
      round,
      score: evaluation.object.score,
      critique: evaluation.object.critique,
    })

    if (evaluation.object.passes) {
      return { finalContent: currentDraft, iterations: round, history }
    }

    // 改善器（Optimizer）
    const revised = await generateText({
      model: anthropic('claude-3-7-sonnet-20250219'),
      system: 'あなたはドラフトを推敲・洗練するライティングスペシャリストです。',
      prompt: `査読フィードバックを反映してドラフトを全面的に修正・推敲してください。\n\n【元ドラフト】\n${currentDraft}\n\n【査読フィードバック】\n${evaluation.object.critique}`,
    })
    currentDraft = revised.text
  }

  return { finalContent: currentDraft, iterations: maxIterations, history }
}
```

---

#### パターンB: ポカヨケ（Poka-Yoke）設計に基づく安全なACIツール定義

Anthropicの「Writing tools for AI agents」に準拠した、エージェントがハルシネーションを起こさないツール実装。

```typescript
// packages/ai-core/src/aci/safe-tools.ts
import { tool } from 'ai'
import { z } from 'zod'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'

const BASE_PROJECT_DIR = '/workspace/projects'

export const safeFileReadTool = tool({
  description:
    'プロジェクト内の指定ファイルを読み込みます。相対パスは受け付けず、絶対パスのみを許可します。',
  parameters: z.object({
    absolutePath: z
      .string()
      .startsWith('/', {
        message:
          'エラー: 相対パスは禁止されています。必ず "/" から始まる絶対パスを指定してください。',
      })
      .describe('読み込むファイルの絶対パス（例: /workspace/projects/src/index.ts）'),
    responseFormat: z
      .enum(['concise', 'detailed'])
      .default('concise')
      .describe(
        'トークン節約のため、要約のみが必要な場合は "concise"、全文が必要な場合は "detailed" を指定',
      ),
  }),
  execute: async ({ absolutePath, responseFormat }) => {
    // ディレクトリトラバーサル防止チェック
    const normalized = path.normalize(absolutePath)
    if (!normalized.startsWith(BASE_PROJECT_DIR)) {
      return {
        isError: true,
        message: `アクセス拒否: パス ${absolutePath} は許可されたワークスペース外です。${BASE_PROJECT_DIR} 配下のパスを指定してください。`,
      }
    }

    try {
      const content = await fs.readFile(normalized, 'utf-8')
      if (responseFormat === 'concise' && content.length > 1000) {
        return {
          isError: false,
          summary: `ファイル行数: ${content.split('\n').length} 行。先頭500文字: ${content.slice(0, 500)}...`,
          note: '全文が必要な場合は responseFormat: "detailed" で再リクエストしてください。',
        }
      }
      return { isError: false, content }
    } catch (error) {
      return {
        isError: true,
        message: `ファイル読み込み失敗: ${(error as Error).message}。パスが実在するか確認してください。`,
      }
    }
  },
})
```

---

#### パターンC: Agent Evals 自動回帰テストスイート（Vitest 5.0+）

エージェントの推論過程ではなく、最終的な外部環境の Outcome（事実）をアサーションします。

```typescript
// packages/eval-suite/tests/regression/helpdesk-eval.test.ts
import { describe, expect, it } from 'vitest'
import { runHelpdeskAgent } from '@agentic/ai-core/agents/helpdesk'
import { db } from '@agentic/ai-core/db'
import { tickets } from '@agentic/ai-core/db/schema'
import { eq } from 'drizzle-orm'

describe('Agent Evals: ヘルプデスク問い合わせ解決の回帰テスト', () => {
  it('ユーザーのパスワードリセット要求に対して、安全な手順を案内しチケット状態を解決済みに更新できること', async () => {
    // 1. テスト環境の初期状態（Outcomeの事前準備）
    const testTicketId = 'ticket-eval-001'
    await db
      .insert(tickets)
      .values({
        id: testTicketId,
        userEmail: 'user@example.com',
        issue: 'ログインパスワードを忘れました。リセット方法を教えてください。',
        status: 'open',
      })
      .onConflictDoNothing()

    // 2. エージェントの自律実行（試行: Trial）
    const result = await runHelpdeskAgent({
      ticketId: testTicketId,
      maxSteps: 5,
    })

    // 3. 環境の最終状態（Outcome）のコードベース評価
    const updatedTicket = await db.query.tickets.findFirst({
      where: eq(tickets.id, testTicketId),
    })

    // アサーション：チケットのステータスが "resolved" に遷移していること
    expect(updatedTicket?.status).toBe('resolved')

    // アサーション：生成回答に生パスワード等の危険情報が含まれておらず、正規リセットURLが含まれること
    expect(result.finalResponse).toMatch(/https:\/\/auth\.example\.com\/reset/)
    expect(result.finalResponse).not.toMatch(/一時パスワードは.*です/)
  })
})
```

---

## 4. 学習チェックリストと習熟度判定基準

各フェーズを修了するごとに、以下のチェックリストで理解度・実装力を検証します。

### Phase 1 判定基準: Webネイティブ基盤

- [ ] Next.js 16 (Turbopack) 環境で Server Actions と API Route の役割を分離できているか。
- [ ] React Compiler 19 の挙動を理解し、不要な `useMemo` / `useCallback` なしで再レンダリングを抑制できているか。
- [ ] Zod 4.6 スキーマを用いて 100% 型安全な JSON 出力を取得し、クライアントに描画できるか。
- [ ] プロンプトキャッシュを有効化し、同一コンテキスト再送時のトークンコストを低減できているか。

### Phase 2 判定基準: ワークフロー & RAG

- [ ] LangChain に頼らず、素の TypeScript の非同期処理で再現性の高いワークフローを組めるか。
- [ ] 単純なベクトル検索と、HyDE / RRF / Reranking を組み合わせた高度なRAGの違いを説明・実装できるか。
- [ ] Anthropic 5大パターンのうち「Orchestrator-Workers」と「Evaluator-Optimizer」を要件に応じて正しく選定できるか。

### Phase 3 判定基準: 自律エージェント & ACI

- [ ] ツール定義において、エージェントが誤認しやすい曖昧なパラメータや相対パスを排除できているか。
- [ ] MCP（Model Context Protocol）サーバーを立ち上げ、AI SDKから標準プロトコル経由でツール連携ができるか。
- [ ] E2B等の隔離サンドボックスを用いて、コード実行エラー時にエージェントが自律的にコードを修正して再実行できるループを構築できるか。

### Phase 4 判定基準: ハーネス & 評価運用

- [ ] 長時間タスクにおいて、コンテキストの肥大化（Context Rot）を防ぐ Compaction またはノートテイク機構を組み込んでいるか。
- [ ] 初期化エージェント（Initializer）と作業エージェント（Worker）を分けた2層ハーネスを実装できるか。
- [ ] Vitest 5.0 を用いて、エージェントの最終アウトカムを検証する自動回帰テストスイートをCI/CDで運用できるか。
- [ ] 不可逆な変更（DB削除、外部送信等）を行う前に Human-in-the-Loop の確認ゲートを確実に設けているか。

---

## 5. 結論と次のステップ

本マスター学習プランを完遂することで、受講者は「ただLLMと会話するチャットアプリの作成者」から、**「物理的な環境の状態を能動的に更新し、長期目標を自律的に達成する堅牢な Agentic AI システムのアーキテクト」**へと進化します。

決定論的なコード（TypeScript / Next.js）の予測可能性と、確率的な知能（LLM / Vercel AI SDK）の探索能力を最高水準で統合し、実運用の荒波に耐えうる本番プロダクトを創出してください。
