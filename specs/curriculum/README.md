# From GenAI to Agentic AI — カリキュラム（確定版）

Python / LangChain / LangGraph ベースの3冊の教材と、Anthropic / IBM の Agentic AI の知見を、TypeScript / Next.js / Vercel AI SDK v7 のスタックへ移植・統合した学習カリキュラムの確定版である。設計ドラフト5本を、spec 001〜004 と 001 の plan / research の決定に合わせて清書した（2026-09-27）。ドラフトはリポジトリから削除し、改めた点は [changes-from-drafts.md](changes-from-drafts.md) に記録した。

## 文書の位置づけ

本カリキュラムは学習設計（何を、どの順序で、どの目標で学ぶか）を定める。個々の受け入れ基準と数値は spec が定める。記述が食い違う場合は、次の順で上位の文書を正とし、本カリキュラムを直す。

1. [constitution](../../.sdd/memory/constitution.md): 変更できない原則
2. spec [001](../001-agentic-ai-platform/spec.md)〜[004](../004-harness-evals-safety/spec.md): 要件と数値。横断制約・NFR・テスト方針の正本は 001
3. 001 の [plan](../001-agentic-ai-platform/plan.md) と [research](../001-agentic-ai-platform/research.md): 設計の決定と実測の根拠（002〜004 の設計は各 spec の設計フェーズで追加する）
4. 本カリキュラム

学習者向けの解説ドキュメント（`docs/modules/`、001 Req 7）は、本カリキュラムを元に各マイルストーンで書く。

## 文書構成

| ファイル | 内容 |
|---|---|
| [README.md](README.md)（本書） | 目的、成熟度モデル、19 モジュールのロードマップ、共通の学習方針、出典の略称 |
| [concepts.md](concepts.md) | 全モジュールが前提とする概念体系（成熟度、ワークフローとエージェント、ACI、コンテキスト、ハーネス、Evals、安全設計、アーキテクチャ選定） |
| [phase-1.md](phase-1.md) | Phase 1 基礎編（モジュール 1-0〜1-3、M1、spec 001） |
| [phase-2.md](phase-2.md) | Phase 2 発展編（モジュール 2-1〜2-4、M2、spec 002） |
| [phase-3.md](phase-3.md) | Phase 3 現場実践編（モジュール 3-1〜3-6、M3、spec 003） |
| [phase-4.md](phase-4.md) | Phase 4 運用・品質編（モジュール 4-1〜4-5、M4、spec 004） |
| [sources.md](sources.md) | 元教材の章とモジュールの対応、Python → TypeScript の置き換え対照 |
| [changes-from-drafts.md](changes-from-drafts.md) | ドラフトとの差分（清書時に解消した矛盾の記録） |

## 出典の略称

spec の「出典」列と本カリキュラムは、次の略称を使う。章番号は、各教材の移植設計での章番号である。全章の一覧と扱いは [sources.md](sources.md) にある。

| 略称 | 指すもの | 章の対応 |
|---|---|---|
| マスター | 清書前の統合カリキュラム案（4 フェーズ・14 モジュール）。本カリキュラムの骨格 | [changes-from-drafts.md](changes-from-drafts.md) |
| 1_llm-agent | 教材 A『つくりながら学ぶ！AIアプリ開発入門』の移植設計 | [sources.md §2](sources.md#2-教材-a1_llm-agent) |
| 2_ai-agent | 教材 B『LangChain と LangGraph による RAG・AI エージェント［実践］入門』の移植設計 | [sources.md §3](sources.md#3-教材-b2_ai-agent) |
| 3_genai-agent | 教材 C『現場で活用するためのAIエージェント実践入門』の移植設計 | [sources.md §4](sources.md#4-教材-c3_genai-agent) |
| Guide | Anthropic / IBM の知見をまとめた概念モジュール（モジュール1〜5、総合演習） | [sources.md §5](sources.md#5-guideagentic-ai-development-guide) |

## 目的と対象者

Python / LangChain で LLM アプリ開発を学んだ（あるいは学ぼうとしている）エンジニアが、TypeScript / Web 標準スタックで、本番品質の Agentic AI システムを一人で設計・構築・評価できるようになることを目的とする。

成果物は、ローカルで動きテストで検証できるリファレンス実装と、モジュールごとの日本語の解説である。価値は次の3点にある（001 Overview）。

1. 受動的生成 → タスク自動化 → 自律型エージェントへの成熟段階を、コードで体験できる。
2. API キーなしでも全テストが決定論的に通る。
3. 各モジュールの習熟度を、チェックリストと自動テストで客観的に判定できる。

## 成熟度モデル

IBM の定義に基づく3段階で、システムの自律性の水準を区別する。詳細は [concepts.md §1](concepts.md#1-生成-ai-から-agentic-ai-へ) にある。各フェーズの解説の冒頭には、扱う水準を明記する（001 Req 7.7）。

| 水準 | 内容 | 主に扱うフェーズ |
|---|---|---|
| Level 1: Generative AI | 入力に対して静的なコンテンツを出力して完了する。環境の状態を変えない | Phase 1 |
| Level 2: AI Agents | 事前に定義したワークフローに沿って、特定のタスクやルール化されたツールを実行する | Phase 1（1-2 のツール呼び出し）〜 Phase 3 |
| Level 3: Agentic AI | 最小限の人間の介入で、オープンエンドな長期目標を達成する。7段階の閉ループを反復し、環境の状態を変え続ける | Phase 3〜4 |

## ロードマップ

4 フェーズ・19 モジュールで構成する。マスターの 14 モジュールに、他のドラフトから復元した5モジュール（1-0、2-4、3-5、3-6、4-5）を加えた（001 Clarifications Session 2026-09-26 (2)）。各フェーズを1つのマイルストーンとして、M1 → M4 の順に実装する。

「出典」列は 001 の Module → Requirement Mapping と同じである。各フェーズの文書の「元教材の対応章」には、[sources.md](sources.md) で対応づけた章をすべて挙げる。

| Phase | モジュール | 要件 | 出典 |
|---|---|---|---|
| 1 基礎編（M1） | 1-0 導入: 生成 AI から Agentic AI へ（解説中心） | 001 Req 7.8 | Guide モジュール1（復元） |
| | 1-1 開発環境とモダンスタック基盤 | 001 Req 1、2 | マスター |
| | 1-2 AI SDK v7 Core とツール呼び出し | 001 Req 3、5 | マスター + 1_llm-agent 第4・11章 |
| | 1-3 構造化出力と要約パイプライン | 001 Req 4 | マスター + 1_llm-agent 第7・8章 |
| 2 発展編（M2） | 2-1 TypeScript ネイティブ RAG | 002 Req 1 | マスター + 1_llm-agent 第10章 |
| | 2-2 Advanced RAG | 002 Req 2 | マスター + 2_ai-agent 第5・7章 |
| | 2-3 5大ワークフローパターン | 002 Req 3 | マスター |
| | 2-4 エージェントデザインパターン | 002 Req 4 | 2_ai-agent 第11・12章（復元） |
| 3 現場実践編（M3） | 3-1 ACI と MCP | 003 Req 1 | マスター + Guide モジュール3 |
| | 3-2 ヘルプデスク・エージェント | 003 Req 2 | マスター |
| | 3-3 データ分析エージェント | 003 Req 3 | マスター |
| | 3-4 階層型リサーチエージェント | 003 Req 4 | マスター + 3_genai-agent 第6章 |
| | 3-5 要件定義書生成エージェント | 003 Req 5 | 2_ai-agent 第10章（復元） |
| | 3-6 マーケティング支援エージェント | 003 Req 6 | 3_genai-agent 第7章（復元） |
| 4 運用・品質編（M4） | 4-1 コンテキストエンジニアリング | 004 Req 1 | マスター + 3_genai-agent 第2章 |
| | 4-2 長時間実行ハーネス | 004 Req 2 | マスター |
| | 4-3 Agent Evals | 004 Req 3 | マスター + Guide モジュール5 + 3_genai-agent 第8章 |
| | 4-4 安全設計・オブザーバビリティ | 004 Req 4、5、001 Req 6 | マスター + Guide モジュール5 + 3_genai-agent 第9章 |
| | 4-5 総合演習: アーキテクチャ選定 | 004 Req 6 | Guide 総合演習（復元） |

ループ制御と強制停止条件（001 Req 6）は、M1 のツール呼び出しから全エージェントに適用し、解説はモジュール 4-4 でまとめて行う。

## 共通の学習方針

### マイルストーンと承認

- M1 → M2 → M3 → M4 の順に進める。後続 spec の要件は、先行マイルストーンの実装が完了した後に人間が承認する（constitution 原則 9）。
- 各モジュールは、リファレンス実装、テスト、日本語の解説の3点が揃って完成とする。完成時点のリファレンス実装には `module/<phase>-<n>` のタグを付け、学習者が自分の作業との差分を比較して復帰できるようにする（001 Req 7.11。1-0 は解説のみのためタグなし）。

### 実行モード

LLM の呼び出し先は、コードを変えずに設定だけで3種を切り替える（001 Req 2）。

| モード | 呼び出し先 | 使う場面 |
|---|---|---|
| `mock` | シナリオスクリプトまたは録画したカセットを再生する決定論的なモック | テスト。ハンズオンでは明示的に指定した場合だけ |
| `local` | Ollama | Web アプリとハンズオンの既定 |
| `live` | 商用 API（Anthropic / OpenAI / Azure OpenAI / Google。IBM watsonx.ai は AI SDK v7 対応の実装がある場合だけ） | 実モデルでの確認 |

### テストと習熟度判定

- `mise run gate` は `mock` モードで、API キー・Docker・ネットワークなしで完走する（001 Req 1.5、1.11、NFR オフライン動作）。テストや走査の件数が 0 の場合は失敗させ、スキップは合格に数えない（001 Req 1.14、1.15、research ADR-10）。
- 各モジュールの自動テストは `mock` で完走する。精度比較、RAG 品質評価、Capability 評価、LLM-as-a-Judge などの比較・品質評価のテストは、`local` モードで実行できる場合に限り実行し、実行できない場合はスキップとして報告する（001 Req 1.13、1.14）。
- 習熟度判定チェックリストの各項目は、自動テストで検証できるものについてテストを参照する。参照先の実在は品質ゲートで検査する（001 Req 7.6）。各フェーズの文書の「習熟度判定」は、このチェックリストの元になる観点である。

### 解説ドキュメントの構成

各モジュールの解説は、学習目標、主要トピック、ハンズオン手順（各手順に必要な実行モードと外部サービス）、習熟度判定チェックリスト、リファレンス実装とテストの所在、元教材との対照表（移植で諦めたものの列を含む）、移植時の変更点（[changes-from-drafts.md](changes-from-drafts.md) と実測に基づく）を持つ（001 Req 7.2〜7.5）。Phase 1 の解説には、Python / Streamlit 経験者向けの対比コラムを加える（001 Req 7.10）。

## 技術スタック

版は固定しない。実装時点の最新安定版を完全一致で固定する（001 Technical Constraints）。確認済みの版は research の [External dependencies](../001-agentic-ai-platform/research.md#external-dependencies) にある。

| 領域 | 採用技術 | 方針 |
|---|---|---|
| ランタイム / パッケージ | Node.js v26、pnpm | `mise.toml` で固定。先行版の採用は方針として許容する |
| 言語 | TypeScript 7.1 先行版（strict） | 全ワークスペースで完全一致のビルドに固定。非互換のツール・ワークスペースに限り 6.x へ後退し、理由を記録する |
| モノレポ | pnpm workspaces + Turborepo | 入口は mise タスク（`mise run gate`） |
| Web | Next.js（App Router、Turbopack、React Compiler） | UI は shadcn/ui の基本部品と自前のチャット部品 |
| AI | Vercel AI SDK v7 + Zod | エージェントは `ToolLoopAgent`、ワークフローは素の TypeScript。構造化出力は `Output.object`、ツール入力は `inputSchema` |
| ツール連携 | MCP（公式 SDK + AI SDK の MCP クライアント） | M3 から |
| データ | Postgres + pgvector（Docker Compose） | M2 から。検索は pgvector + Reciprocal Rank Fusion |
| サンドボックス | E2B（キーがなければローカルのコンテナ） | LLM が生成したコードの実行専用。ホストでは実行しない |
| 評価 | Vitest（Capability / Regression、LLM-as-a-Judge） | M4 で本体。回帰評価は `mock` で品質ゲートに含める |
| 観測 | OpenTelemetry（OTLP）+ Langfuse | M4 から |
| lint / format | Biome | リポジトリ全体で単一の規約 |

## 対象外

認証・認可、本番デプロイ（任意の付録扱い）、会話履歴のセッションをまたいだ永続化、耐久的な中断・再開などは扱わない。一覧とドラフトから意図的に除外した項目は、001 の [Out of Scope / Future Work](../001-agentic-ai-platform/spec.md#out-of-scope--future-work) にある。
