# 002 rag-and-workflows — ギャップ分析

- 対象 spec: [spec.md](spec.md)（要件は承認済み、設計・タスクは未生成）
- 調査日: 2026-10-12 / 言語: 日本語（`spec.json`）
- 位置づけ: 情報と選択肢の提示。実装方針の決定は `/sdd-plan` で行う

## 分析サマリー

- **範囲**: M1 の土台（モデルゲートウェイ、決定論的埋め込み、`createGuardedAgent`、`defineAciTool`、ポート + `mock` fixture の規約、`data-*` ストリーム、テスト接尾辞と pg 用の接続許可、Compose の pgvector）は揃っている。一方、**DB 層、Rerank、ドキュメント取り込み、`workflows/` 領域、評価セットは M1 に無く**、Req 1〜4 の 45 の受け入れ基準のうち、土台がある（🔧）のは 9 件（1.4、1.9、1.10、2.2、2.6、2.11、3.12、3.13、4.7）、残り 36 件は新規（🆕）。既存コードだけで満たす（✅）基準は無い。
- **最大の不確実性は、品質ゲートでのインプロセス DB**。PGlite + pgvector が遮断されたテスト基盤・Node 26・TypeScript 7.1 先行版で動き、全文検索と RRF の SQL を検証できるかは未実測（G-1、R-1、R-2）。Req 1.12 自体が実測を求めており、plan の最初の調査に置く。
- **`mock` の埋め込みは意味を持たない**ため、精度比較（Req 2.9）と Judge（Req 2.10）は `local` 専用になり、gate が保証するのは算術・制御フロー・型に限られる（G-4、G-22）。解説とトレーサビリティにこの限界を明記する必要がある。
- **実行モード間の埋め込み次元のずれ**（mock / local は 768、OpenAI 1536、Google 3072）と、**`live` の既定プロバイダ（Anthropic）に埋め込みモデルが無い**ことが、M1 のカタログと衝突する（G-15、G-16）。ほかに、日本語の全文検索（G-2）、Rerank のプロバイダ未定（G-3）、Req 3.13 を機械的に守らせる規則が無いこと（R-13）がある。
- **推奨の方向**: データ層は PGlite（gate）+ Postgres（`test:db`）の二層（A1）を第一候補とし、成立しなければメモリ上の自前ストア（A2）に退く。コードの配置は新規領域を独立して追加し（B2）、重複の整理は M2 の末尾で判断する（B3）。仕様の曖昧さ 7 点（§5 末尾）は、plan の前に人が解釈を決める。

## 目次

1. 現状調査（既存コードの資産）
2. 要件ごとのギャップ表
3. 統合上の課題・制約（G-1〜G-22）
4. 実装アプローチの選択肢
5. plan フェーズで調査すべき項目（R-1〜R-16、仕様側の曖昧さ）

## 1. 現状調査（既存コードの資産）

調査日: 2026-10-12。対象: M1（001）の実装済みコード、steering、001 の plan / research、005。

### 1.1 そのまま使える資産

| 資産 | 場所 | M2 での使い道 |
|---|---|---|
| 埋め込みの解決 | `packages/ai-core/src/models/gateway.ts:233`（`resolveEmbedding`）、`catalog.ts` の `MODEL_DEFAULTS` | `embed` / `embedMany` に渡すモデルの解決。`mock` は決定論的埋め込み、`local` は `nomic-embed-text:latest`、`live` は OpenAI / Google |
| 決定論的埋め込み | `mock/deterministic-embedding.ts`（768 次元、SHA-256 シードの PRNG、L2 正規化） | Req 1 の `mock` テスト。ただし**意味的な近さを持たない**（後述 G-4） |
| `Output.object` + `streamText` の実績 | `summarize/pipeline.ts`（段階的要約、再生成） | Multi-Query のサブクエリ生成、Router、Evaluator のスコア出力 |
| 並列実行 + 統合の実績 | `summarize/plan.ts` / `pipeline.ts`（チャンク要約 → 統合） | Parallelization / Orchestrator-Workers の形の参考（汎用化は未了） |
| `createGuardedAgent` | `agents/guarded-agent.ts`、`agents/index.ts` | Agentic RAG（Req 1.9）と Role-Based Cooperation（Req 4.7）。`ToolLoopAgent` はここ以外で `new` できない（規則 `guarded-agent-only`） |
| `defineAciTool` / `buildToolSet` | `aci/` | 検索ツール（`risk: "read-only"`）の定義 |
| ポート + `mock` fixture の規約 | `ports/web-search.ts`、`mock/`、`fixtures/web-search/` | Rerank ポートの追加方法の手本 |
| シナリオ / カセット | `mock/scenario-model.ts`、`fixtures/scenarios/m1-*.ts`、`fixtures/cassettes/` | RAG・ワークフローの LLM 応答の固定（`m2-*` を追加） |
| テスト接尾辞 | `*.db.test.ts`（gate に含む）、`*.pg.test.ts`（`test:db`）。`vitest.config.ts` の接尾辞は `test` / `local.test` / `pg.test` で、`*.db.test.ts` は `*.test.ts` に一致して gate に入る | Req 1.12 の分類 |
| ネットワーク遮断 | `tooling/vitest/setup-hermetic.ts`。`AI_TEST_SUITE=pg` のときだけ `127.0.0.1:POSTGRES_PORT` を許可 | `*.pg.test.ts` の接続許可は既にある |
| Postgres + pgvector | `compose.yaml` の `postgres`（`pgvector/pgvector:pg17`、プロファイル `db`）、`infra/postgres/init/01-extensions.sql`（`CREATE EXTENSION vector`）、`mise run services:up:db` / `test:db` | Req 1 の本番側ストア |
| データストリーム | `apps/web/app/api/summarize/route.ts:94-125`（`createUIMessageStream` で `data-summary`・`data-summary-restart`・`data-summary-meta` を `writer.write`） | Req 2.11 の進行状況・中間結果を `data-*` パートで送る同じ方式（回答テキストとは別のデータになる）。`/api/chat` と `/api/agent/tools` は `streamText` 系の標準ストリームで、data part は使っていない |
| Web 層の型 | `lib/server/guard.ts`（`guardRequest`）、`lib/server/platform.ts`（依存の組み立て1か所）、`components/<feature>/`、`e2e/support/mock-api.ts` | 新しい Route Handler と画面 |
| 解説と検査 | `docs/modules/_template.md`、`scripts/check-docs.mjs`（`docs:check`）、005 の「本番ではどう作るか」節の検査 | 2-1〜2-4 の解説 |

### 1.2 存在しないもの（M1 には無い）

- **DB 層**: Drizzle / PGlite / `postgres` クライアントの依存、スキーマ、マイグレーション、`DATABASE_URL`（`env-schema.ts` に `POSTGRES_*` はあるが接続文字列は組み立てていない）。plan C（Compose）の Does NOT own に「DB スキーマとマイグレーション（002）」と明記されている。
- **Rerank**: ポート、環境変数（`env-schema.ts` / `FEATURE_REQUIREMENTS` / `.env.example` のいずれにも無い）、fixture、モデルカタログ上の概念。001 plan C7 の Does NOT own に「後続 spec のポート（Rerank …）は各 spec が同じ規約で追加する」とある。
- **ドキュメント取り込み**: PDF / Markdown のパーサ（`pdf-parse` 系、`unified` / `remark` 系）、チャンク分割、ファイルアップロードの Route Handler。
- **`workflows/` 領域**: `ai-core/src/workflows/`（steering の structure.md は M2 の予約領域と記載）。`package.json#exports` にサブパスが無い。
- **ラベル付き評価セット**と初期投入の仕組み、LLM-as-a-Judge（Req 2.9〜2.12）。`ModelPurpose` に `judge` はあるが、評価ロジックは無い（`eval-suite` は M1 では回帰テスト 1 本と `local` 専用の要約品質例のみ）。
- **進行状況 / 中間結果の UI**: 引用表示、段階表示のコンポーネント。
- **`rag` 系の `ToolLoopAgent` 不使用の検査**: Req 3.13 を機械的に守らせる規則（`RULE_NAMES` は 9 規則で、`guarded-agent-only` は「ここ以外で `new` しない」であり、「workflows/ から import しない」ではない）。

### 1.3 外部依存の確認（2026-10-12、npm レジストリ）

| パッケージ | 版 | 状態 |
|---|---|---|
| `@electric-sql/pglite` | 0.5.8 | 001 research I-9 の記載と一致 |
| `@electric-sql/pglite-pgvector` | 0.0.9 | 001 research は拡張名のみ記載。版は新規確認 |
| `drizzle-orm` / `drizzle-kit` | 0.45.4 / 0.31.11 | TypeScript 7.1 先行版との相性は未検証（001 ADR-2 の Consequences が「Drizzle のコード生成などが非互換なら、そのツールだけ 6.x へ後退」としている） |
| `@ai-sdk/cohere` | 4.0.59 | `ai@7.0.137` は `rerank()` と `RerankingModelV4` を持つ。Rerank 実装の候補（Cohere 以外は未調査） |

`@ai-sdk/cohere` は `packages/ai-core/node_modules/@ai-sdk/` に未導入（導入済みは anthropic / azure / google / openai）。

## 2. 要件ごとのギャップ表

凡例: ✅ 既存コードで満たす / 🔧 一部あり（拡張が要る）/ 🆕 新規。M1 は RAG・ワークフローの実装を持たないため、要件本体はほぼ 🆕。ここでは「土台の有無」で分類する。

### Req 1: RAG ナレッジベースと引用付き回答（モジュール 2-1）

| AC | 分類 | 根拠・不足 |
|---|---|---|
| 1.1 取り込みと保存 | 🆕 | DB 層・パーサ・チャンク分割が無い。埋め込みは `gateway.resolveEmbedding`（✅）。PDF のページ番号を出典メタデータに載せるパーサの選定が必要（G-6） |
| 1.2 見出し境界の分割 | 🆕 | Markdown パーサ（見出しツリー）が無い。純関数で、`mock` で全件テストできる |
| 1.3 再取り込みで置換 | 🆕 | 文書単位のキー（文書名か内容ハッシュか）の決定が必要。トランザクション内の delete + insert |
| 1.4 上位 k 件 + ストリーミング回答 | 🔧 | 回答のストリーミングは `streamText`（✅ `/api/chat`）。ベクトル検索・k の設定は 🆕。k の既定 5 は `config/defaults.ts` に足す |
| 1.5 引用の返却と UI の対応付け | 🆕 | 引用の型・UI 部品が無い。回答本文との対応付け（`[1]` 形式か構造化出力か）は未決（G-7） |
| 1.6 メタデータフィルタ | 🆕 | スキーマ設計（`tags` の型など）と、`WHERE` を併用したベクトル検索 |
| 1.7 閾値未満は「該当なし」 | 🆕 | 類似度の尺度が実行モードで変わる（G-4）。閾値の既定値と、`mock` での扱いが未決 |
| 1.8 非対応形式のスキップと報告 | 🆕 | 取り込み結果の型（`skipped: { file, reason }[]`） |
| 1.9 Agentic RAG | 🔧 | `createGuardedAgent` + `defineAciTool`（✅）。検索ツールは `read-only`。ツール数の上限・停止条件は既存の仕組みに乗る |
| 1.10 無関係な質問で検索しない + 検索有無の記録 | 🔧 | `AgentRunSummary.toolsCalled`（✅ `guarded-agent.ts`）から「検索したか」を導ける。`mock` ではシナリオの述語で再現 |
| 1.11 引用 ID の照合 | 🆕 | 純関数。除去の記録先（結果の `removedCitations`）を設計する |
| 1.12 DB テストの分類と実測 | 🆕 | PGlite + pgvector が `fetch` / `net` / `dns` の遮断下で動くか、RRF 用の全文検索（`tsvector`）が PGlite で動くかを**実測する必要がある**（G-1）。001 research I-9 は採用を 002 で確定すると明記 |

### Req 2: Advanced RAG（モジュール 2-2）

| AC | 分類 | 根拠・不足 |
|---|---|---|
| 2.1 HyDE | 🆕 | `generateText` + `embed`。`mock` の埋め込みは意味を持たず、HyDE の効果をテストで示せない（G-4） |
| 2.2 Multi-Query（3 件、並列） | 🔧 | `Output.object` の実績（✅ summarize）。並列実行は `Promise.all` で素直に書ける。「3 件」は Zod の `.length(3)` で固定できるが、小型の `local` モデルが守れるかは別（G-8） |
| 2.3 ハイブリッド（全文 + ベクトル + RRF） | 🆕 | 全文検索は Postgres `tsvector`。**日本語の全文検索**（`simple` 設定では分かち書きされない）が最大の論点（G-2）。RRF 自体は純関数 |
| 2.4 RRF の重複排除 | 🆕 | 純関数のプロパティテスト対象 |
| 2.5 Rerank | 🆕 | ポート・実装・API キー・fixture が全て無い（G-3）。`ai` の `rerank()` は使える |
| 2.6 キー未設定でスキップ + 記録 | 🔧 | 「キーが無ければ機能を無効にして理由を記録する」流儀は `FEATURE_REQUIREMENTS` と `web-search` にある。`rerank` を足すだけだが、`mock` でも「スキップ」と「fixture 実行」のどちらを既定にするか決める必要がある |
| 2.7 手法ごとの有効・無効 | 🆕 | 設定オブジェクト（`{ hyde, multiQuery, hybrid, rerank }`）と、リクエストスキーマ（`z.strictObject`） |
| 2.8 中間結果の返却 | 🆕 | パイプラインの戻り値に段階別の trace を含める設計 |
| 2.9 検索精度の比較評価 | 🆕 | `eval-suite` に比較テストを置く。`mock` の埋め込みでは比較が無意味になるため `local` 専用（`*.local.test.ts`）。gate では「評価ロジック自体」（recall@k の算出）だけを検証できる |
| 2.10 LLM-as-a-Judge | 🆕 | `ModelPurpose "judge"` は✅。採点プロンプト・スキーマ・`local` 専用テストは新規。004 Req 3 の Evals と重複しない境界を決める（G-9） |
| 2.11 進行状況のストリーミング | 🔧 | `data-*` パートの方式は✅（summarize）。段階イベントの型、`/api/rag` の Route Handler、UI は新規 |
| 2.12 ラベル付き質問セット（20 問以上）と投入手段 | 🆕 | 対象文書・質問・正解チャンク ID・参照回答を作る。正解チャンク ID は**チャンク分割の結果に依存する**ため、安定した ID 規則（内容ハッシュ等）が前提（G-5） |

### Req 3: ワークフローパターン（モジュール 2-3）

| AC | 分類 | 根拠・不足 |
|---|---|---|
| 3.1 5 パターンの独立関数 | 🆕 | `ai-core/src/workflows/` と `package.json#exports` の `./workflows` を新設 |
| 3.2 Prompt Chaining のステップ間検証 | 🆕 | 失敗ステップ名 + 検証エラーを返す型。`PlatformError`（`output-invalid`）の再利用を検討 |
| 3.3 Routing（分類 + 理由） | 🆕 | `Output.object` の列挙型。分類の語彙は閉じた kebab-case |
| 3.4 フォールバック | 🆕 | 純粋な制御フロー |
| 3.5 Sectioning | 🆕 | `Promise.all`。部分失敗の扱い（1 件失敗で全体失敗か）が仕様に無い（G-10） |
| 3.6 Voting（N 回、同数は「同数」） | 🆕 | 集計は純関数。N の上限（コスト）の既定が未定 |
| 3.7 Orchestrator-Workers | 🆕 | サブタスクの数の上限が仕様に無い（暴走防止。constitution の停止条件の精神に照らして上限が要る。G-10） |
| 3.8 Evaluator-Optimizer（85 点、3 回） | 🆕 | 既定値は `config/defaults.ts` に置く流儀に従う |
| 3.9 履歴の返却 | 🆕 | 型のみ |
| 3.10 未合格時は最高スコアを返す | 🆕 | 同点時の選択規則が仕様に無い（先勝ちなど。G-10） |
| 3.11 複数評価器、最小値 | 🆕 | 純関数 + 並列 |
| 3.12 難度による軽量 / 高性能の振り分け | 🔧 | `gateway.resolve({ purpose, modelId })` と `MODEL_CATALOG`（✅）。ただし「軽量」「高性能」の 2 段をカタログ上どう表すか（`ModelPurpose` に無い）が未決（G-11）。トークン使用量は `usage`（✅） |
| 3.13 `ToolLoopAgent` を使わない | 🔧 | 規則 `guarded-agent-only` は `guarded-agent.ts` 以外の `new ToolLoopAgent` を禁じるため、`workflows/` が `createGuardedAgent` を呼ぶことは検出しない。**3.13 を機械的に保つ規則が無い**（`workflows/` から `agents/` と `ToolLoopAgent` の import を禁じる規則の追加） |

### Req 4: エージェントデザインパターン（モジュール 2-4）

| AC | 分類 | 根拠・不足 |
|---|---|---|
| 4.1 6 パターンの独立関数 | 🆕 | 配置は `workflows/` か新領域 `patterns/` か（G-12）。steering は `ai-core/src/workflows/` を M2 の予約としている |
| 4.2 Passive Goal Creator | 🆕 | `Output.object`（目的・制約・成功基準・不足項目・質問） |
| 4.3 Prompt/Response Optimizer | 🆕 | 構造化出力 |
| 4.4 Single-Path Plan | 🆕 | 計画生成 → 順次実行。ステップ数の上限が仕様に無い（G-10） |
| 4.5 Multi-Path Plan（既定 3、並列、評価器で選択） | 🆕 | 3.7 / 3.11 と同じ部品の再利用候補 |
| 4.6 Self-/Cross-Reflection | 🆕 | Cross-Reflection は「生成時と異なるモデル」が要る。`local` では Ollama の別モデル（`granite4.2` と `gemma4:e2b`）で可能。`live` の既定プロバイダ（Anthropic）は 1 社のためモデルが異なれば足りるのか、プロバイダが異なる必要があるのかが未定義（G-13） |
| 4.7 Role-Based Cooperation（役割ごとの `ToolLoopAgent`） | 🔧 | `createGuardedAgent`（✅）を役割ごとに 1 回ずつ生成する。3 エージェントの合算の停止条件（累積トークン等）は**実行単位ごとに独立**で、全体の予算が仕様に無い（G-14） |
| 4.8 18 パターンの対応表 | 🆕 | 解説ドキュメントのみ。`docs:check` に「対応表が 18 行ある」検査を足すかは任意 |

### 横断（承認済みの前提・005・001 から継承）

| 項目 | 分類 | 根拠 |
|---|---|---|
| 解説ドキュメント 2-1〜2-4（001 Req 7） | 🔧 | `_template.md` と `docs:check`（✅）。005 Req 2 の「本番ではどう作るか」節の参照先は、`specs/curriculum/README.md:103-105` の表で既に定義済み（2-1・2-2 は CE、2-3 は LE・AE、2-4 は AE）。リンクの文字列検査は 005 のルールが担う |
| `mock` での完走（001 Req 1.13） | 🔧 | シナリオ / カセットの枠組みは✅。RAG は埋め込み + 生成 + DB が揃うため fixture の量が増える |
| 品質ゲート 5 分以内（001 NFR） | ⚠ | PGlite の WASM 起動・マイグレーションが `*.db.test.ts` ごとに走ると時間を食う。共有インスタンス化が要る（G-1） |
| カバレッジ 80%（`vitest.config.ts` の閾値） | ⚠ | 新しい領域は最初のテストから閾値の対象になる |
| TypeScript 7.1 先行版 + Drizzle | ⚠ | 未検証（§5 の調査項目 R-2） |

## 3. 統合上の課題・制約

要件を実装に落とすときに、既存の仕組みとぶつかる点。番号 G-n は §2 から参照している。

| ID | 課題 | 内容 | 影響する要件 |
|---|---|---|---|
| G-1 | **インプロセス DB の採用可否が未実測** | PGlite 0.5.8 + `pglite-pgvector` 0.0.9 が (a) テスト基盤の `fetch` / `node:net` / `node:dns` 遮断下で起動できるか、(b) `vector` と RRF 用の全文検索を使えるか、(c) Node 26 と TypeScript 7.1 先行版で動くか、(d) 1 ファイルあたりの起動時間が gate の 5 分に収まるか、を測っていない。001 research I-9 は「採用は 002 で確定」と書き残している。Req 1.12 は実測を設計ドキュメントに記録することを求める | 1.12、2.3、NFR |
| G-2 | **日本語の全文検索** | Postgres の `to_tsvector('simple', …)` は日本語を分かち書きしない。`pg_bigm` / `pgroonga` は pgvector の公式イメージに無く、PGlite でも使えない。ハイブリッド検索（Req 2.3）の「全文」側を何で実現するか（英語文書だけを評価セットにする、`pg_trgm` の三つ組一致で代替する、アプリ側で分かち書き（`Intl.Segmenter`）して `simple` に渡す、など）で、評価セット（Req 2.12）の言語も決まる | 2.3、2.9、2.12 |
| G-3 | **Rerank のプロバイダが未定** | 候補は Cohere（`@ai-sdk/cohere`）、Voyage、Jina など。いずれも API キーが要り、`mock` では fixture か疑似実装にする（001 Req 2.15）。キー名（`COHERE_API_KEY` など）は `env-schema.ts`・`FEATURE_REQUIREMENTS`・`.env.example` の 3 か所に足す（gitleaks の設定に影響するかは未確認）。001 plan は Rerank のポートを「各 spec が同じ規約で追加する」としている（`ports/rerank.ts`、`mock/` の fixture 実装、`recordingRerank` ラッパ） | 2.5、2.6 |
| G-4 | **`mock` の埋め込みは意味を持たない** | `createDeterministicEmbeddingModel` は SHA-256 由来の乱数ベクトルで、同一テキストは同一ベクトルだが、似た文は似ない。したがって `mock` では (a) 閾値（Req 1.7）は「完全一致で 1.0、他はほぼ 0」という形でしか検証できない、(b) HyDE・ハイブリッド・Rerank の**検索精度の差**は示せない。精度比較（Req 2.9）は `local` 専用になる。`mock` のテストは「ランキングの算術」（RRF、重複排除、閾値の分岐）に絞る設計が必要 | 1.7、2.1、2.9 |
| G-5 | **チャンク ID の安定性** | 正解チャンク ID（Req 2.12）と引用の照合（Req 1.11）は、再取り込みで ID が変わらないことが前提。連番 ID だと分割規則を変えるたびに評価セットが壊れる。内容ハッシュ（文書名 + 見出しパス + 本文）か、文書内の序数を使うかの選択がある | 1.3、1.11、2.12 |
| G-6 | **PDF パーサの選定** | PDF の本文抽出とページ番号の取得（Req 1.1）に使うライブラリが無い。Node 26 での動作、ネイティブ依存（`allowBuilds` に理由が要る）、公開 24 時間未満の版を採らない規則（`minimumReleaseAge`）との整合を見る必要がある。PDF fixture（`mock` で使うバイナリ）の置き場所は `fixtures/` | 1.1、1.8 |
| G-7 | **引用と回答本文の対応付け方式** | (a) モデルに `[1]` 形式の脚注を書かせる（小型 `local` モデルが守らない恐れ）、(b) `Output.object` で「回答の文 + 根拠チャンク ID」を構造化出力にする（ストリーミングの部分表示が複雑になる。summarize の `partial` / `restart` の流儀が使える）、(c) 回答後に後処理で対応付ける。UI の要件（Req 1.5）と 1.11 の照合の置き場所が変わる | 1.5、1.11 |
| G-8 | **小型モデルが構造化出力の制約を守れるか** | `local` の既定は `granite4.2:latest`。3 件ちょうどのサブクエリ（Req 2.2）、0〜100 点（Req 3.8）などの制約を破った場合の挙動（再生成するか、`output-invalid` で止めるか）。summarize の `withRegeneration`（`summarize/retry.ts`）は再利用候補だが、`summarize/` 内にあり汎用化されていない | 2.2、3.3、3.8、4.2 |
| G-9 | **評価の置き場所が 004 と重なる** | Req 2.9・2.10 の評価（検索精度、Judge）は `eval-suite` に置くが、004 Req 3 が Agent Evals の基盤（Judge の共通化、評価レポート）を持つ。M2 で作った Judge が M4 で作り直しにならないよう、M2 では「RAG 専用の最小の採点関数」に留め、`packages/eval-suite/` の配置規約（`capability/` と `regression/`）に従う | 2.9、2.10 |
| G-10 | **無限・過大な展開の上限が仕様に無い** | Orchestrator-Workers のサブタスク数（3.7）、Single-Path Plan のステップ数（4.4）、Voting の N（3.6）、Parallelization の分割数（3.5）に上限が無い。constitution の「必ず止まる」精神に照らして、既定の上限と超過時の挙動（`PlatformError("invalid-request")` で拒否か、切り詰めか）を plan で決める。Req 3.13 により `ToolLoopAgent` を使わないため、停止条件の仕組み（`createRunStopConditions`）は適用されず、上限は各パターンの関数が自分で持つ | 3.5〜3.7、4.4 |
| G-11 | **「軽量 / 高性能」モデルの表現** | Req 3.12 は難度で 2 つのモデルへ振り分ける。`ModelPurpose` は `chat / structured / embedding / judge` の 4 つで、「軽量」「高性能」の区別が無い。選択肢: (a) `gateway.resolve({ purpose, modelId })` に呼び出し側がカタログの ID を渡す（モデル ID リテラルはカタログにだけ置く規則の範囲で、カタログに「tier」を足す）、(b) `ModelPurpose` を拡張する（001 の公開型の変更になり、`cassette` のスキーマ `z.enum([...])`（`cassette-store.ts:75`）にも波及する）。`mock` では 2 つのモデルがどちらも `mock:general-v1` になるため、振り分けの検証にはシナリオで区別する工夫が要る | 3.12 |
| G-12 | **パターン実装の置き場所** | 4.1 の 6 パターンは、制御フローをコードで書くもの（Goal Creator、Optimizer、Plan Generators、Reflection）と、`ToolLoopAgent` を使うもの（Role-Based Cooperation）が混在する。`workflows/` に全部置くと Req 3.13 の検査（`workflows/` は `ToolLoopAgent` を使わない）が書けなくなる。`workflows/`（3 章）と `patterns/`（4 章。Role-Based Cooperation だけ `agents/` を import してよい）に分けるか、`patterns/` 内で `role-based.ts` だけ例外にするかを決める。steering は新しいトップレベルのワークスペースを作らない前提だが、`ai-core` 内の領域追加は想定内 | 3.13、4.1、4.7 |
| G-13 | **Cross-Reflection の「異なるモデル」の定義** | 異なるモデル ID か、異なるプロバイダか。`mock` では同一モデルしかないため、シナリオの述語でモデルを区別する必要がある | 4.6 |
| G-14 | **複数エージェントの合算予算** | Role-Based Cooperation は役割ごとに `createGuardedAgent` を作り、停止条件は各エージェントの実行ごとに独立する。3 役 × `AGENT_MAX_TOTAL_TOKENS`（既定 50,000）で、全体の上限が暴れる。全体の上限を設けるかは仕様に無く、003 Req 4（階層型リサーチ）の設計とも関係する | 4.7 |
| G-15 | **Embedding 次元の固定** | pgvector の列は `vector(N)` で次元が固定される。`mock` と `local`（nomic-embed-text）は 768、`live` の OpenAI `text-embedding-3-small` は既定 1536、Google `gemini-embedding-001` は既定 3072 で、**実行モードを切り替えると既存のナレッジベースが使えなくなる**。さらに `MODEL_DEFAULTS.live.anthropic` と `azure` には `embedding` が無く、`AI_LIVE_PROVIDER` の既定（anthropic）のままでは `live` の RAG が `RangeError` で起動しない（`catalog.ts` の `defaultModelFor`）。対応案: (a) 埋め込みの次元を 768 に統一する（OpenAI・Google は `dimensions` / `outputDimensionality` を指定できる。`providerOptions` の確認が要る）、(b) モデルごとにテーブルを分ける、(c) 取り込み時に次元の不一致を検出して再取り込みを促す（`PlatformError`）。いずれにせよ**埋め込みモデル ID と次元をチャンクと一緒に記録する**ことが要る | 1.1、1.4 |
| G-16 | **`live` の埋め込み用プロバイダ** | 上の G-15 の続き。Anthropic を既定とする `live` で RAG を動かすには、埋め込みだけ別プロバイダを選ぶ設定（例: `AI_EMBEDDING_PROVIDER`）が要る。`resolveEmbedding` は現状、`live` の単一プロバイダに従う | 1.4、2.1 |
| G-17 | **Route Handler の設計** | ルート（`/api/rag/ingest`、`/api/rag/query`、`/api/rag/eval` など）は `guardRequest` を通し、`z.strictObject` で検証し、`guard → resolve → validate → adapt → stream` の順に処理する（steering の structure.md）。ファイルアップロード（multipart）は、既存の本文サイズ検査（413）が JSON 前提で、`multipart/form-data` の扱いは未実装。ローカルの単一の学習者という前提（005 Req 1）を踏まえて、アップロードの代わりに**サーバー側のディレクトリ指定**（`fixtures/` か `knowledge/`）で取り込むのも選択肢だが、その場合パストラバーサル対策（`summarize/url-guard.ts` に相当するパス検査）が要る | 1.1、1.8、2.12 |
| G-18 | **DB 接続の組み立て** | `lib/server/platform.ts` が依存の組み立て 1 か所の規則。DB ハンドル（`mock` は PGlite、`local`/`live` は Postgres）も同じ場所で組み立てる。ただし**`mock` のとき Next.js のサーバー（`mise run dev`）は PGlite をプロセス内に持つ**ことになり、再起動で消える。永続化の必要（取り込みの再実行で足りるか）は学習用途として許容できるかを plan で確認する | 1.1、2.12 |
| G-19 | **Drizzle と TypeScript 7.1 先行版** | `drizzle-kit`（マイグレーション生成）は Node の CLI で、TypeScript のコンパイラ API に依存しなければ問題ないが、未検証。steering の Constraints は、コンパイラ API 依存のツールを採らないとしている。001 ADR-2 は、非互換ならそのツールだけ 6.x へ後退し、範囲・理由・解除条件を記録するとしている | 1.12 |
| G-20 | **サプライチェーン規則** | 新規依存（`@electric-sql/pglite`、`pglite-pgvector`、`drizzle-orm`、`drizzle-kit`、PDF パーサ、Rerank SDK）は、(a) `plan.md` に宣言してから追加、(b) 公開 24 時間以上、(c) 完全一致で固定、(d) `allowBuilds` に理由、(e) API キーが要るものはキーが無い場合の代替、を満たす。`mise run audit`（`pnpm audit`）の対象にも入る | 全般 |
| G-21 | **`docs:check` と解説の増加** | 解説 4 本（2-1〜2-4）が増える。005 の「本番ではどう作るか」節と、001 Req 7 の必須節（`_template.md`）の検査が 4 本とも通る必要がある。習熟度チェックリストは**テストを参照する**ため、テスト名を先に決める必要がある | 解説 |
| G-22 | **`describeLocal` のテスト量** | 検索精度の比較（2.9）、Judge（2.10）、Cross-Reflection の実効性などは `local` 専用で、gate では「スキップ（理由付き）」になる。gate の緑がこれらを保証しないことを解説と `traceability` に明記する（steering の「緑は本物であること」）。gate で検証できる部分（算術・制御フロー・型）を明確に分ける | 2.9、2.10 |

## 4. 実装アプローチの選択肢

決定ではなく比較。選択は `/sdd-plan` で行う。論点は大きく 2 つ（A: データ層とテスト戦略、B: コードの配置）に分かれる。

### A. データ層（Req 1、2.3、1.12）

| 案 | 内容 | 長所 | 短所・リスク | 規模 |
|---|---|---|---|---|
| A1: PGlite（gate）+ Postgres（`test:db`）の二層 | ストア層をインターフェース（`VectorStore`）で隠し、gate は PGlite、本番とハンズオンは Docker Postgres。SQL は共通（Drizzle） | Req 1.12 の想定どおり。gate が Docker 不要。`pg` テストで差を検出できる | PGlite と Postgres の挙動差（拡張、`tsvector` 設定、インデックス）。G-1 の実測が前提。起動時間 | 中 |
| A2: メモリ上の自前ストア（gate）+ Postgres | gate ではメモリ上のコサイン類似度 + 自前 BM25。pgvector は `*.pg.test.ts` のみ | 起動が速く決定論的。依存が少ない | SQL（`<=>`、`tsvector`）を gate が一切検証しない。Req 1.12 の「インプロセス DB で実行できるもの」の分類が空になる。教材として「pgvector を使う」学習目標（phase-2.md §2-1）の検証が `test:db` に偏る | 小 |
| A3: Postgres のみ（gate でも Docker） | gate が Docker を要求 | 実装が最小 | 001 Req 1.11・1.12（Docker なしで gate が完走）に反する。**不可** | — |

実測次第で A1 が成立しない場合は A2 に退く。その場合は Req 1.12 の分類（インプロセスで実行できるもの / できないもの）に根拠を記録する。

### B. コードの配置（Req 3、4、全般）

| 案 | 内容 | 長所 | 短所・リスク |
|---|---|---|---|
| B1: 既存領域を拡張 | 要約の再生成（`summarize/retry.ts`）などを汎用化して流用し、新規領域は `rag/`・`workflows/` | 重複が少ない | `summarize/` を汎用部品の置き場に変えると M1 の契約（公開 API、プロンプトキャッシュ方針）に波及。レビュー済みコードの再改修 |
| B2: 新規領域（`rag/`、`workflows/`、`patterns/`）を独立して追加 | 必要な小部品（再生成、集計）は新領域内に置き、M1 のコードは触らない | M1 の契約を壊さない。段階ゲートに沿う | 再生成ロジックが一時的に 2 か所になる（M1 の `withRegeneration` と同種） |
| B3: ハイブリッド | 新規領域を追加し、重複が実際に 3 回目に出た時点で共通部品を切り出す（`retry` の汎用化は M2 の末尾で判断） | 先に抽象化しない | 判断の時期を記録しないと放置される |

`apps/web` は `/rag`（取り込み + 質問）、`/rag/pipeline`（Advanced RAG の段階表示）、`/workflows`（5 パターンの実行）の 3 画面程度が候補。

### 推奨の方向（情報提供。決定は plan）

- データ層は **A1 を第一候補**とし、G-1 の実測を plan の最初の調査に置く。成立しなければ A2。
- 配置は **B2 → B3**（M1 を触らず、重複は M2 の最後に評価する）。
- Rerank は `ports/rerank.ts` + `mock/` の fixture 実装 + `recordingRerank` で、`web-search` と同じ規約に揃える（G-3）。
- 埋め込みは次元を 768 に統一する方針を第一候補とし、`providerOptions` で `live` の OpenAI・Google が 768 を出せるか確認する（G-15）。確認できなければ「モデル ID と次元をチャンクに記録し、不一致は取り込み直し」とする。
- 日本語の全文検索は、`Intl.Segmenter` による分かち書き + `simple` を第一候補（追加依存が無い）。精度が足りなければ `pg_trgm`（G-2）。

## 5. plan フェーズで調査すべき項目

優先度: 高 = plan の構成を左右する（先に実測）/ 中 = 設計の詳細 / 低 = 後続で足りる。

| ID | 優先度 | 調査内容 | 方法 | 関連 |
|---|---|---|---|---|
| R-1 | 高 | PGlite 0.5.8 + `pglite-pgvector` 0.0.9 が、Node 26 とテスト基盤（`fetch`/`net`/`dns` 遮断）の下で、`vector` の `<=>` 検索、HNSW / IVFFlat、`tsvector` を使えるか。1 ファイルあたりの起動時間と、共有インスタンスでの分離（テストごとのトランザクションか、スキーマ作り直しか） | 使い捨てのスクリプトで実測し、結果を plan の「Req 1.12 の分類」に記録 | G-1、A1 |
| R-2 | 高 | `drizzle-orm` / `drizzle-kit` が TypeScript 7.1 先行版で型検査・マイグレーション生成できるか。pgvector 型（`vector()`）が `drizzle-orm` にあるか。PGlite 用ドライバ（`drizzle-orm/pglite`）の可否 | 公式ドキュメント（Context7）+ 実測 | G-19 |
| R-3 | 高 | 日本語全文検索の方式（`Intl.Segmenter` + `simple`、`pg_trgm`）の PGlite / Postgres での可否と、評価セットの言語（日本語か英語か）の決定 | 実測。PGlite の同梱拡張の一覧（pglite.dev/extensions） | G-2 |
| R-4 | 高 | Rerank プロバイダの選定（Cohere / Voyage / Jina）。AI SDK の `rerank()` と `RerankingModelV4` の対応状況、無料枠、`@ai-sdk/*` の版と公開日（24 時間規則）、`mock` fixture の形式 | 公式ドキュメント + `npm view` | G-3 |
| R-5 | 高 | 埋め込みの次元の統一（768）が `live` の OpenAI（`dimensions`）と Google（`outputDimensionality`）で可能か。`providerOptions` の指定方法。`live` の既定プロバイダが埋め込みを持たない場合の設定方法（`AI_EMBEDDING_PROVIDER` を足すか） | AI SDK v7 のドキュメント（Context7）と各プロバイダの仕様 | G-15、G-16 |
| R-6 | 中 | PDF パーサの選定（Node 26 での動作、ネイティブ依存の有無、ページ単位の抽出、メンテナンス状況）。テスト用 PDF fixture の作成方法 | `npm view` と小さな実測 | G-6 |
| R-7 | 中 | 引用の方式（G-7 の a / b / c）を、`local` の `granite4.2` で試し、守れる割合を実測。`mock` の決定論テストとの両立 | `local` で数回試行 | G-7、G-8 |
| R-8 | 中 | チャンク ID の規則（内容ハッシュか序数か）と、再取り込み時の置換の単位（文書名か内容ハッシュか） | 設計 | G-5 |
| R-9 | 中 | Route Handler の入力方式（multipart か、サーバー側ディレクトリの指定か）。既存の `guardRequest` の検査順への適合と、パス検査の置き場 | `lib/server/guard.ts` を読み、設計 | G-17 |
| R-10 | 中 | `ModelPurpose` を変えずに「軽量 / 高性能」を表す方法（カタログへの tier、呼び出し側の `modelId` 指定） | `catalog.ts` / `gateway.ts` の読み込み | G-11 |
| R-11 | 中 | 004 Req 3 との Judge の境界（M2 は RAG 専用の最小、M4 で共通化する）。`eval-suite` の配置と、gate 内で検証する部分 / `local` 専用の部分の線引き | 004 spec を読み、設計 | G-9、G-22 |
| R-12 | 中 | 上限の既定値（サブタスク数、プランのステップ数、Voting の N、並列数）と超過時の挙動。複数エージェントの合算予算（003 Req 4 との整合） | 設計。constitution の原則 2 を再確認 | G-10、G-14 |
| R-13 | 中 | `workflows/` と `patterns/` の分割、および Req 3.13 を守らせる新しいリポジトリ規則（`workflows/` から `agents/`・`ToolLoopAgent` の import を禁じる）。`check-repo-rules.mjs` は走査 0 件で失敗する規約 | `check-repo-rules.mjs` の既存規則を参照 | G-12、3.13 |
| R-14 | 低 | `mock` の fixture 量（`m2-1`〜`m2-4` のシナリオ・カセット）の見積り。`describeLocal` で扱う範囲 | 設計 | G-22 |
| R-15 | 低 | UI の部品（引用表示、段階表示）と WCAG 2.2 AA、E2E（3 エンジン）、SSE fixture（`mise run e2e:fixtures`）の拡張 | 既存の `apps/web/e2e` を参照 | Req 1.5、2.11 |
| R-16 | 低 | gitleaks 設定と新しい環境変数（Rerank のキー）の相互作用 | `.gitleaks.toml` の確認 | G-3 |

### 仕様側の曖昧さ（要件の改訂候補。plan 前に人が判断する）

承認済みの要件のため、ここでは記録だけに留める。実装前に解釈を決めないと plan が割れる点。

1. **Req 1.7 の「閾値」の尺度**: 類似度の種類（コサイン類似度か距離か）と既定値が未定義で、実行モードごとの埋め込みで分布が異なる（G-4）。
2. **Req 2.2 の「3 件」を満たさない出力**: 再生成か失敗か。
3. **Req 3.5・3.7・4.4 の上限**: 数の上限が無い（G-10）。
4. **Req 3.10 の同点処理**: 最高スコアの生成物が複数ある場合の選択規則。
5. **Req 4.6 の「異なるモデル」**: モデル ID の相違かプロバイダの相違か（G-13）。
6. **Req 2.6 と `mock` モード**: キー未設定のとき、`mock` で Rerank を fixture で実行するのか、スキップを既定にするのか。
7. **Req 1.12 の置き場所**: 「設計ドキュメントに記録する」は、本 spec 配下の `plan.md` か `research.md` かを明示していない（001 の流儀に従うなら `research.md` の ADR）。

これらを要件の改訂とするか、plan の決定（Clarifications）として記録するかは、`/sdd-plan` の前に判断する。2.6 と 1.12 は plan の決定で足りる見込みで、1.7・3.10・4.6 は受け入れ基準の文言に影響しうる。
