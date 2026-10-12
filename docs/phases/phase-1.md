# Phase 1 基礎編: モダン Web ネイティブ AI アプリ開発

Phase 1 はマイルストーン 1（M1）で提供します。要件は [spec 001](../../specs/001-agentic-ai-platform/spec.md)、学習設計は [curriculum の Phase 1](../../specs/curriculum/phase-1.md) にあります。

## 扱う成熟度の水準

IBM の3段階成熟度モデル（Generative AI / AI Agents / Agentic AI）のうち、Phase 1 は次の水準を扱います（Req 7.7）。

| 水準 | Phase 1 での扱い |
|---|---|
| Level 1: Generative AI | **主に扱う水準です。** 1-3 の構造化要約までは、入力に対して出力を返して完了する受動的な生成です。環境の状態を変えません |
| Level 2: AI Agents | **入口だけを扱います。** 1-2 の `ToolLoopAgent` によるツール呼び出しで、ルール化されたツールを実行するエージェントを最小構成で体験します。ツールは `read-only` に限ります |
| Level 3: Agentic AI | 扱いません。7段階の閉ループを自律的に反復して環境の状態を変えるシステムは、Phase 3〜4 で扱います |

水準の区別と7段階の閉ループは [1-0 導入](../modules/1-0-intro.md) で説明します。

## 学習の流れ

Streamlit と LangChain で作ったプロトタイプを、Next.js App Router と Vercel AI SDK v7 の本番品質のアプリへ移します。受動的な生成から始め、最後にツール呼び出しで AI エージェントへの転換を体験します。

| 順 | モジュール | 内容 | 実装の所在 |
|---|---|---|---|
| 1 | [1-0 導入](../modules/1-0-intro.md) | 成熟度モデル、7段階の閉ループ、比較マトリクス。解説のみ | なし |
| 2 | [1-1 開発環境](../modules/1-1-dev-environment.md) | モノレポ、品質ゲート、実行モード、モデルカタログ | リポジトリ全体、`packages/ai-core` の `config` と `models` |
| 3 | [1-2 Core とツール呼び出し](../modules/1-2-ai-sdk-core-and-tools.md) | ストリーミングチャット、`ToolLoopAgent`、停止条件 | `packages/ai-core` の `chat`・`agents`・`aci`、`apps/web` の `/chat`・`/agent` |
| 4 | [1-3 構造化出力と要約](../modules/1-3-structured-output-and-summaries.md) | 構造化出力、分割の境界、プロンプトキャッシュ | `packages/ai-core` の `summarize`、`apps/web` の `/summarize` |

Phase 1 が後続のフェーズに渡す基盤は、モノレポ、品質ゲート、実行モード、モデルカタログ、停止条件、ツールの規約、この解説の枠組みです。

## 共通の約束

- 品質ゲート（`mise run gate`）は `mock` で動き、API キー・Docker・ネットワークを必要としません。
- 各解説は Python / Streamlit 経験者向けの対比コラムを持ちます（Req 7.10）。
- 解説の書き方と検査は [docs/README.md](../README.md) にあります。
