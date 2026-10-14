# Phase 2 発展編: モダン RAG と決定論的ワークフローパターン

Phase 2 はマイルストーン 2（M2）で提供します。要件は [spec 002](../../specs/002-rag-and-workflows/spec.md)、学習設計は [curriculum の Phase 2](../../specs/curriculum/phase-2.md) にあります。

## 扱う成熟度の水準

IBM の3段階成熟度モデル（Generative AI / AI Agents / Agentic AI）のうち、Phase 2 は次の水準を扱います（Req 7.7）。

| 水準 | Phase 2 での扱い |
|---|---|
| Level 1: Generative AI | **2-1・2-2・2-3 の主な水準です。** RAG とワークフローは、入力に対して出力を返して完了します。検索や分岐を足しても、制御フローを決めるのはコードで、環境の状態は変えません |
| Level 2: AI Agents | **移行の水準です。** 2-1 の Agentic RAG（検索をツールにして、必要なときだけ呼ぶ）と、2-4 の Role-Based Cooperation（役割ごとのエージェントへ作業を受け渡す）で、LLM が制御フローを決める設計に入ります。ツールは `read-only` に限ります |
| Level 3: Agentic AI | 扱いません。7段階の閉ループを自律的に反復して環境の状態を変えるシステムは、Phase 3〜4 で扱います |

ワークフロー（コードが制御フローを決める）とエージェント（LLM が制御フローを決める）の区別を、実装で体得するフェーズです。区別は [2-3 5大ワークフローパターン](../modules/2-3-workflow-patterns.md) で説明します。

## 学習の流れ

LangChain の LCEL や LangGraph のグラフ抽象を使わず、TypeScript の関数合成と AI SDK v7 で、引用付きの RAG、Advanced RAG、Anthropic の5大ワークフローパターン、エージェントデザインパターンを実装します。

| 順 | モジュール | 内容 | 実装の所在 |
|---|---|---|---|
| 1 | [2-1 TypeScript ネイティブ RAG](../modules/2-1-typescript-native-rag.md) | 取り込み、分割、埋め込み、pgvector 検索、閾値、引用、Agentic RAG | `packages/ai-core` の `rag`、`apps/web` の `/rag` |
| 2 | [2-2 Advanced RAG](../modules/2-2-advanced-rag.md) | HyDE、Multi-Query、ハイブリッド検索と RRF、Rerank、中間結果のストリーミング、RAG の評価 | `packages/ai-core` の `rag/retrieve`・`rag/eval`、`packages/eval-suite` |
| 3 | [2-3 5大ワークフローパターン](../modules/2-3-workflow-patterns.md) | Prompt Chaining、Routing、Parallelization、Orchestrator-Workers、Evaluator-Optimizer | `packages/ai-core` の `workflows`、`apps/web` の `/workflows` |
| 4 | [2-4 エージェントデザインパターン](../modules/2-4-agent-design-patterns.md) | 18 パターンの体系と、6パターンの実装 | `packages/ai-core` の `patterns`、`apps/web` の `/workflows` |

Phase 1 が渡した基盤（モノレポ、品質ゲート、実行モード、モデルカタログ、停止条件、ツールの規約）の上に、Phase 2 は共通部品（`structured/` の再生成付き構造化出力）、データ層（PGlite と Postgres）、評価の配管を足します。これらは Phase 3〜4 が使います。

## 共通の約束

- 品質ゲート（`mise run gate`）は `mock` で動き、API キー・Docker・ネットワークを必要としません。gate の緑が保証するのは、算術・制御フロー・型・SQL の正しさです。**検索手法の効果の差と Judge の判定は保証しません。** それらは `*.local.test.ts`（`mise run test:local`）だけが示します。
- 実 Postgres の挙動は `*.pg.test.ts`（`mise run test:db`、Docker が必要）が確かめます。Rerank の実際の呼び出し（`COHERE_API_KEY`）は任意で、手動のハンズオンで確かめます。
- ハンズオンの既定は `local`（Ollama）です。2-1・2-2 は Docker の Postgres も使います。
- 各解説は「本番ではどう作るか」の節で、ハブの手法ページへのリンクを示します（文書は転載しません）。
- 解説の書き方と検査は [docs/README.md](../README.md) にあります。
