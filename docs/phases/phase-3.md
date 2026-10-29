# Phase 3 現場実践編: ACI と MCP、ドメイン別エージェント

Phase 3 はマイルストーン 3（M3）で提供します。要件は [spec 003](../../specs/003-domain-agents/spec.md)、学習設計は [curriculum の Phase 3](../../specs/curriculum/phase-3.md) にあります。

## 扱う成熟度の水準

IBM の3段階成熟度モデル（Generative AI / AI Agents / Agentic AI）のうち、Phase 3 は次の水準を扱います（Req 7.7）。

| 水準 | Phase 3 での扱い |
|---|---|
| Level 1: Generative AI | 前提です。Phase 1〜2 で扱った、入力に対して出力を返して完了する設計は、各モジュールの中の部品（構造化出力、RAG、ワークフロー）として使います |
| Level 2: AI Agents | **Phase 3 の主な水準です。** LLM がツールを選んで呼び、結果を見て次の行動を決めます。3-1 の ACI と MCP、3-3 のデータ分析（コードを書いて実行し、結果で直す）、3-4 の Supervisor が該当します。ツールには `read-only` / `write` / `destructive` のリスク区分を付け、注釈のない外部ツールは `destructive` として扱います |
| Level 3: Agentic AI | **入口に立つ水準です。** 3-2 のヘルプデスクは、計画を立て、実行し、結果で計画を見直して、チケットという外部の状態を変えます。ただし計画の制御フローはコード（ワークフロー）が持ち、承認ゲート・長時間実行・オブザーバビリティは Phase 4 の領域です。7段階の閉ループを自律的に反復する運用は、この Phase では扱いません |

ワークフロー（コードが制御フローを決める）とエージェント（LLM が制御フローを決める）の区別は、Phase 2 の [2-3](../modules/2-3-workflow-patterns.md) から続きます。Phase 3 では、6つのドメインのそれぞれで、どちらを選んだかとその理由を解説に書きます（憲章 原則 1）。

## 学習の流れ

| 順 | モジュール | 内容 | 実装の所在 |
|---|---|---|---|
| 1 | [3-1 ACI と MCP](../modules/3-1-aci-and-mcp.md) | ツール説明文の設計、高水準ツール、自作の MCP サーバー、許可リスト、注釈とリスク区分、致命的エラーの停止 | `packages/ai-core` の `aci`・`mcp`・`files`、`apps/web` の `/mcp` |
| 2 | [3-2 ヘルプデスク・エージェント](../modules/3-2-helpdesk-agent.md) | Plan-and-Execute、計画の検査、チケットの永続化、認証情報の形状検査 | `packages/ai-core` の `helpdesk`、`apps/web` の `/helpdesk` |
| 3 | [3-3 データ分析エージェント](../modules/3-3-data-analysis-agent.md) | サンドボックスでのコード実行、アップロードの検査、修正ループ、図表の受け渡し | `packages/ai-core` の `sandbox`・`analysis`、`apps/web` の `/analysis` |
| 4 | [3-4 階層型リサーチエージェント](../modules/3-4-hierarchical-research.md) | Supervisor とサブエージェント、共有予算、引用の照合、arXiv の利用規約 | `packages/ai-core` の `research`、`apps/web` の `/research` |
| 5 | [3-5 要件定義書生成エージェント](../modules/3-5-requirements-interview.md) | ペルソナ面接、十分性の判定、固定の章立ての要件定義書 | `packages/ai-core` の `requirements`、`apps/web` の `/requirements` |
| 6 | [3-6 マーケティング支援エージェント](../modules/3-6-marketing-support.md) | ラウンドロビンの合議、合意の判定、カタログ照合 | `packages/ai-core` の `marketing`、`apps/web` の `/marketing` |

## 共通の約束

- 品質ゲート（`mise run gate`）は `mock` で動き、API キー・Docker・ネットワークを必要としません。gate の緑が保証するのは、制御フロー・型・停止条件・SQL・配管の正しさです。**実モデルの品質は保証しません。**
- 実モデルの観察は `*.local.test.ts`（`mise run test:local`、Ollama）が行い、Docker のサンドボックスの実機確認は `*.container.test.ts`（`mise run test:container`）が行います。どちらも環境が無ければ理由付きでスキップされ、**スキップは合格に数えません**。観察値は [research.md](../../specs/003-domain-agents/research.md) の「W8 の実測」に、使ったモデルとともに記録します。小さなローカルモデルでの少数回の観察であり、手法の優劣の根拠ではありません。
- E2B（`E2B_API_KEY`）と GitHub の MCP（`GITHUB_TOKEN`）は任意で、手動のハンズオンで確かめます。外向き通信の既定や注釈の実際は未確認です（3-1、3-3 の「確認できていないこと」）。
- LLM が生成したコードは、ホストでは実行しません。隔離環境（E2B または Docker）が無ければ、その機能は起動しません。
- 各解説は「本番ではどう作るか」の節で、ハブの手法ページへのリンクを示します（文書は転載しません）。認証・認可、承認待ちの保持、複数インスタンスは対象外です。
- 解説の書き方と検査は [docs/README.md](../README.md) にあります。
