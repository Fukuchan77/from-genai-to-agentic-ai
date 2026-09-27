# rag-and-workflows — Requirements

## Overview

マスターカリキュラム Phase 2（発展編）のリファレンス実装の要件を定義する。LangChain の LCEL やグラフ抽象を使わず、TypeScript の関数合成と AI SDK v7 で、引用付きの RAG、Advanced RAG（HyDE / Multi-Query / RRF / Rerank）、Anthropic の5大ワークフローパターン、エージェントデザインパターンを実装する。IBM の成熟度モデルでは、主に Level 1（Generative AI）から Level 2（AI Agents）への移行を扱う。

本 spec は、2026-09-27 に [`001-agentic-ai-platform`](../001-agentic-ai-platform/spec.md) から分割した（要件レビュー C-1。[review-2026-09-26.md](../001-agentic-ai-platform/review-2026-09-26.md) §8）。

## 前提（001 から継承）

- 次の事項は `001-agentic-ai-platform` を正本とし、本 spec では再定義しない: Clarifications、Technical Constraints、Runtime Environment、LLM Provider & Test Strategy、Glossary、Non-Functional Requirements、Out of Scope / Future Work、001 Req 6（ループ制御と強制停止条件）、001 Req 7（モジュール解説ドキュメント）。
- 特にテスト方針は 001 に従う: 各モジュールの自動テストは `mock` モードで完走でき（001 Req 1.13）、比較・品質評価のテストは `local` モードで実行可能な場合に限り実行する（001 Req 1.13、1.14）。モジュールの実行（ハンズオン）は `local` / `live` を原則とする（001 Req 2.12）。外部サービスは `mock` では fixture または疑似実装に置き換える（001 Req 2.15）。品質ゲートは Docker なしで完走する（001 Req 1.11、1.12）。
- 本文中の `00N Req X.Y` は spec `00N` の要件 X.Y を指す。spec 番号のない `Req X.Y` は本 spec の要件を指す。

## 承認ゲート

本 spec の要件承認は、先行マイルストーン（M1）の実装が完了した後に行う。それまでは、001 の決定や先行マイルストーンの実装結果に合わせて改訂してよい。

## Module → Requirement Mapping

| Milestone | モジュール | 要件 | 出典 |
|---|---|---|---|
| M2 | 2-1 TypeScript ネイティブ RAG | Req 1 | マスター + 1_llm-agent 第10章 |
| M2 | 2-2 Advanced RAG | Req 2 | マスター + 2_ai-agent 第5・7章 |
| M2 | 2-3 5大ワークフローパターン | Req 3 | マスター |
| M2 | 2-4 エージェントデザインパターン | Req 4 | 2_ai-agent 第11・12章（復元） |

## Requirement ID 対応（分割前 → 本 spec）

受け入れ基準の枝番（X.Y の Y）は変えていない。

| 分割前（001） | 本 spec |
|---|---|
| Req 5 | Req 1 |
| Req 6 | Req 2 |
| Req 7 | Req 3 |
| Req 20 | Req 4 |

## Requirements

### Requirement 1: RAG ナレッジベースと引用付き回答

学習者として、PDF 等の文書からナレッジベースを作り、根拠となる引用付きで回答する RAG を、フレームワークのブラックボックスなしで構築したい。（モジュール 2-1）

**Acceptance Criteria**

1.1 WHEN 学習者が PDF または Markdown 文書を取り込み対象として指定した時、THE プラットフォーム SHALL 文書をチャンクに分割し、各チャンクの埋め込みベクトル、本文、出典メタデータ（文書名、ページまたは見出し）をナレッジベースに保存する。
1.2 THE プラットフォーム SHALL Markdown 文書を見出し境界でチャンク分割し、1つのチャンクが複数の見出しセクションをまたがないようにする。
1.3 WHEN 同一文書が再度取り込まれた時、THE プラットフォーム SHALL 既存のチャンクを置き換え、同一文書のチャンクを重複して保存しない。
1.4 WHEN 学習者が質問を送信した時、THE プラットフォーム SHALL 質問とベクトル類似度の高い上位 k 件（k は設定可能、既定 5）のチャンクを取得し、それらを根拠とした回答をストリーミングで返す。
1.5 WHEN 回答を返す時、THE プラットフォーム SHALL 回答が根拠としたチャンクの引用（文書名、ページまたは見出し、本文抜粋）を併せて返し、UI で回答本文と対応付けて表示する。
1.6 WHERE 検索時にメタデータフィルタ（文書名、タグ等）が指定された場合、THE プラットフォーム SHALL フィルタ条件に一致するチャンクのみを検索対象とする。
1.7 IF 類似度が設定された閾値以上のチャンクが1件も見つからない場合、THEN THE プラットフォーム SHALL 推測で回答を生成せず、ナレッジベースに該当情報がない旨を返す。
1.8 IF 取り込み対象ファイルが非対応形式である、またはテキストを抽出できない場合、THEN THE プラットフォーム SHALL そのファイルをスキップし、ファイル名と理由を取り込み結果に含める。
1.9 WHERE Agentic RAG モードが有効な場合、THE プラットフォーム SHALL ナレッジベース検索をエージェントのツールとして提供し、検索の要否・検索クエリ・検索回数をエージェントに判断させる。
1.10 WHILE Agentic RAG モードで、質問がナレッジベースの内容と無関係な状態、THE プラットフォーム SHALL 検索ツールを呼び出さずに回答できるようにし、各回答で検索ツールを呼び出したかどうかを結果に含める。
1.11 WHEN 回答と引用を返す時、THE プラットフォーム SHALL 引用に含まれるチャンク ID をそのリクエストで取得したチャンク ID の集合と照合し、集合に含まれない引用を除去して、除去したことを記録する。
1.12 THE プラットフォーム SHALL ベクトル検索・全文検索・RRF を使うテストを、インプロセス DB で実行できるもの（品質ゲートに含める）と、実行できないもの（別タスク）に分類し、分類と根拠（インプロセス DB で実測した結果）を設計ドキュメントに記録する。

### Requirement 2: Advanced RAG

学習者として、曖昧な質問やキーワード不一致に強い高度な検索パイプラインを構築し、ナイーブなベクトル検索との差を比較したい。（モジュール 2-2）

**Acceptance Criteria**

2.1 WHERE HyDE が有効な場合、THE プラットフォーム SHALL 質問から仮想回答を生成し、その仮想回答の埋め込みを用いてベクトル検索を行う。
2.2 WHERE Multi-Query 展開が有効な場合、THE プラットフォーム SHALL 1つの質問から構造化出力として3件のサブクエリを生成し、それらの検索を並列に実行する。
2.3 WHERE ハイブリッド検索が有効な場合、THE プラットフォーム SHALL 全文検索とベクトル検索の結果を RRF で統合した単一のランキングを返す。
2.4 THE プラットフォーム SHALL RRF 統合において、同一チャンクが複数の検索結果に含まれる場合でも統合後ランキングに1回だけ含める。
2.5 WHERE Rerank API のキーが設定されている場合、THE プラットフォーム SHALL 統合後の候補を Rerank で再順位付けし、上位 k 件を回答生成に用いる。
2.6 IF Rerank API のキーが未設定の場合、THEN THE プラットフォーム SHALL Rerank 段をスキップして統合後ランキングの上位 k 件を用い、Rerank がスキップされたことを実行結果に記録する。
2.7 THE プラットフォーム SHALL 各検索手法（ナイーブ、HyDE、Multi-Query、ハイブリッド、Rerank）を個別に有効・無効化できる設定を提供する。
2.8 WHEN 学習者が検索パイプラインを実行した時、THE プラットフォーム SHALL 各段階（サブクエリ、各検索の候補、統合後、Rerank 後）の中間結果を確認できる形で返す。
2.9 THE プラットフォーム SHALL 同一の評価用質問セットに対して、手法の組み合わせごとの検索精度（上位 k 件中の正解チャンク含有率）を比較できる評価を提供する。
2.10 THE プラットフォーム SHALL RAG 回答の品質評価として、忠実性（回答が取得チャンクに裏付けられているか）と回答関連性（回答が質問に答えているか）を、LLM-as-a-Judge で採点する評価を提供する。
2.11 WHILE 検索パイプラインが実行中の状態、THE プラットフォーム SHALL 各段階の進行状況（サブクエリ生成中、検索中、統合中、Rerank 中）と中間結果を、回答テキストとは別のデータとして UI へストリーミングし、表示する。
2.12 THE プラットフォーム SHALL 2.9 と 2.10 の評価用に、質問、正解チャンクの識別子、参照回答を持つラベル付き質問セット（20 問以上）と、その対象文書を初期投入する手段を提供する。

### Requirement 3: ワークフローパターン

学習者として、Anthropic の5大ワークフローパターンをグラフ抽象なしに実装し、要件に応じて使い分けられるようになりたい。（モジュール 2-3）

**Acceptance Criteria**

3.1 THE プラットフォーム SHALL Prompt Chaining、Routing、Parallelization、Orchestrator-Workers、Evaluator-Optimizer の5パターンを、それぞれ独立して呼び出せる再利用可能な関数として提供する。
3.2 WHEN Prompt Chaining の途中ステップの出力がステップ間検証に失敗した時、THE プラットフォーム SHALL 後続ステップを実行せず、失敗したステップ名と検証エラーを返す。
3.3 WHEN Routing に入力が与えられた時、THE プラットフォーム SHALL 入力を事前定義された分類のいずれか1つに振り分け、分類結果と選択理由を返したうえで対応する処理を実行する。
3.4 IF Routing の分類結果が事前定義された分類のいずれにも該当しない場合、THEN THE プラットフォーム SHALL 既定のフォールバック処理を実行する。
3.5 WHERE Parallelization が Sectioning モードの場合、THE プラットフォーム SHALL 分割された各サブタスクを並列に実行し、全結果を統合した出力を返す。
3.6 WHERE Parallelization が Voting モードの場合、THE プラットフォーム SHALL 同一タスクを N 回（N は設定可能）並列実行し、多数決による結論と各票の内訳を返す。最多票が同数の場合は、結論を「同数」として返し、特定の結論を選ばない。
3.7 WHEN Orchestrator-Workers にタスクが与えられた時、THE プラットフォーム SHALL オーケストレーターが実行時にサブタスクを動的に決定し、各サブタスクをワーカーへ並列委譲し、統合結果とサブタスク一覧を返す。
3.8 WHEN Evaluator-Optimizer が実行された時、THE プラットフォーム SHALL 生成物を 0〜100 点のスコアと改善フィードバックで評価し、スコアが合格基準（既定 85 点）に達するか最大反復回数（既定 3 回）に達するまで改善を繰り返す。
3.9 THE プラットフォーム SHALL Evaluator-Optimizer の結果として、最終生成物、実行した反復回数、各反復のスコアとフィードバックの履歴を返す。
3.10 IF Evaluator-Optimizer が最大反復回数に達しても合格基準を満たさない場合、THEN THE プラットフォーム SHALL 最高スコアの生成物を返し、結果に未合格であることを明示する。
3.11 WHEN Evaluator-Optimizer が複数の専門評価器（例: セキュリティ、パフォーマンス）で構成された時、THE プラットフォーム SHALL 各評価器を並列に実行し、評価器ごとのスコアと、評価器ごとのスコアの最小値を統合スコアとして返す。
3.12 WHERE Routing がモデル選択に用いられる場合、THE プラットフォーム SHALL 入力の難度分類に応じて軽量モデルと高性能モデルのいずれかへ振り分け、振り分け先のモデル名とトークン使用量を結果に含める。
3.13 THE プラットフォーム SHALL ワークフローパターンの制御フローをコード（TypeScript の関数合成）で記述し、`ToolLoopAgent` を使わずに実装する。

### Requirement 4: エージェントデザインパターン

学習者として、18 のエージェントデザインパターンの体系を理解し、そのうち主要なパターンをグラフ抽象なしの TypeScript で実装して使い分けられるようになりたい。（モジュール 2-4）

**Acceptance Criteria**

4.1 THE プラットフォーム SHALL Passive Goal Creator、Prompt/Response Optimizer、Single-Path Plan Generator、Multi-Path Plan Generator、Self-Reflection / Cross-Reflection、Role-Based Cooperation の6パターンを、それぞれ独立して呼び出せる再利用可能な関数として提供する。
4.2 WHEN Passive Goal Creator に曖昧な指示が与えられた時、THE プラットフォーム SHALL 目的、制約、成功基準を持つ目標仕様を構造化出力として返し、情報が不足する場合は不足項目と確認用の質問を併せて返す。
4.3 WHEN Prompt/Response Optimizer が実行された時、THE プラットフォーム SHALL 改善前後のプロンプト（または回答）と、改善の理由を返す。
4.4 WHEN Single-Path Plan Generator にゴールが与えられた時、THE プラットフォーム SHALL 順序付きのステップ一覧を生成して順に実行し、ステップごとの結果を返す。
4.5 WHEN Multi-Path Plan Generator にゴールが与えられた時、THE プラットフォーム SHALL 複数の候補計画（数は設定可能、既定 3）を並列に生成し、評価器が選んだ計画と選択理由、全候補の評価結果を返す。
4.6 WHEN Self-Reflection または Cross-Reflection が実行された時、THE プラットフォーム SHALL 批評（Cross-Reflection では生成時と異なるモデルによる批評）と修正を最大反復回数（既定 3 回）まで繰り返し、各反復の批評と修正の履歴を返す。
4.7 WHEN Role-Based Cooperation にタスクが与えられた時、THE プラットフォーム SHALL 役割（例: リサーチャー、コーダー、レビュアー）ごとの `ToolLoopAgent` に作業を順に受け渡し、役割ごとの出力と最終成果物を返す。
4.8 THE プラットフォーム SHALL 18 パターンすべてについて、リファレンス実装のどのモジュール・関数に対応するか、または解説のみで扱うかを示す対応表を、モジュール 2-4 の解説ドキュメントに含める。

## Open Questions（レビューからの持ち越し）

なし。要件レビュー（[review-2026-09-26.md](../001-agentic-ai-platform/review-2026-09-26.md)）から持ち越した項目は、2026-09-27 にすべてレビューの推奨どおり要件へ反映した（001 の Clarifications「Session 2026-09-27 (2)」）。

| ID | 決定 | 反映先 |
|---|---|---|
| H-8 | ラベル付き質問セット（20 問以上）と対象文書を初期投入する手段を提供する | Req 2.12 |
| M-8 | 最多票が同数の場合は、結論を「同数」として返す | Req 3.6 |
| H-10 | 統合スコアは評価器ごとのスコアの最小値とする | Req 3.11 |
| C-4 関連 | テストのインプロセス DB での実行可否を実測して分類し、設計ドキュメントに記録する | Req 1.12 |

---

_Split from 001-agentic-ai-platform: 2026-09-27_
