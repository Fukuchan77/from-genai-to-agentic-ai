# 評価テストの配置規約

`@platform/eval-suite` は、エージェントの振る舞いを **Capability** と **Regression** の2層で評価する。
M1 では配置規約と共通 Vitest 設定を用意し、評価項目の本格的な拡充は 004
`harness-evals-safety` に引き継ぐ。

## Capability

`tests/capability/` には、要約品質、安全性、ツール選択の妥当性など、「どの程度よくできたか」を
測る評価を置く。実モデルが必要な比較・品質評価は `*.local.test.ts` とし、
`AI_TEST_RUN_MODE=local` で Ollama と必要モデルを利用できる場合だけ実行する。利用できない場合は、
`localAvailability` を使って理由付きでスキップする。

M1 の例は `summary-quality.local.test.ts` とし、要約が要求された3件の要点を持つことを確認する。

M2 では RAG の評価を足した（[002 spec](../../../../specs/002-rag-and-workflows/spec.md) Req 2.9、2.10、2.12）。

| ファイル | 内容 |
|---|---|
| `rag-retrieval.local.test.ts` | 手法の組み合わせ（ナイーブ、ハイブリッド、HyDE、Multi-Query、全部、Rerank が使えるときはその組み合わせ）ごとの平均 recall@k とヒット率を、ラベル付き質問セットで比べて表に出力する。Multi-Query の「3 件」を `local` モデルが守る割合（再生成の回数）と、top-1 の類似度の分布（既定の閾値 0.5 との関係）も観察として出力する。Rerank は `COHERE_API_KEY` が無ければ行ごと省き、理由を出力する。質問ごとの recall の表も出力する。**全問（32 問）で約 26 分、他の処理と並走すると 1 時間以上**かかる。短く確かめるには `RAG_EVAL_QUESTIONS=<n>`（先頭の n 問だけ。3 問で約 2.5 分）、類似度の分布だけなら `-t "top-1 cosine"`（LLM を使わず数秒）を使う。中央値と四分位は最近順位 |
| `rag-judge.local.test.ts` | 忠実性と回答関連性を `judgeRagAnswer` で採点する。根拠のある回答は忠実性 `pass`、チャンクに無い内容を足した回答は `fail`、質問に答えていない回答は回答関連性 `fail` になることを固定のケースで確かめ、チャット用モデルが `[n]` の脚注を守る割合を質問セットの一部で観察する |

評価は専用のインメモリ DB（PGlite）に評価用コーパスだけを取り込んで行い、稼働中のナレッジベースや学習者の `knowledge/` には触れない。

## Regression

`tests/regression/` には、以前保証したエージェントの振る舞いを決定論的に固定する評価を置く。
`mock` シナリオを使い、停止理由、ツール呼び出し列、構造化された Outcome など、壊れてはならない
契約を検証する。M1 の `tool-agent-run.test.ts` はツールエージェントを最後まで通して検証し、
`@platform/ai-core` 内の純粋関数の単体テストとは重複させない。

M2 の `tests/regression/rag-eval-set.db.test.ts` は、RAG の評価の**配管**を gate で検証する。質問セットが 20 問以上で、すべての正解チャンク ID が評価用コーパスに実在し、`mock` の埋め込みで「質問 = チャンク本文」のとき recall@1 が 1.0 になることを確かめる。コーパスを編集して正解 ID がずれたら、このテストが落ちる。

## gate と `local` の線引き（RAG の評価）

| | gate（`mise run gate`、`mock`） | `local`（`mise run test:local`、Ollama） |
|---|---|---|
| 保証すること | 評価の配管: 質問セットの検証、正解 ID の実在、recall の算術 | 手法の組み合わせの recall@k の差、Judge の判定、`local` モデルの構造化出力と脚注の遵守率、閾値の妥当性 |
| 保証しないこと | **手法の効果の差と Judge の判定**。`mock` の埋め込みは意味を持たない | 実 Postgres での挙動（`*.pg.test.ts`）、Cohere の実呼び出し（手動のハンズオン） |
| 失敗したら | 配管かデータ（コーパス、質問セット）が壊れている | モデルや手法の性質。値を `specs/002-rag-and-workflows/research.md`「M2 実測（W6）」に記録する |

`local` の評価は、数値を観察として出力し、手法の優劣そのものはアサートしない。アサートするのは、全質問が完走すること、配管が妥当なこと、固定のケースでの Judge の判定である。

## M3 の評価（[003 spec](../../../../specs/003-domain-agents/spec.md)）

M3 では回帰（gate、`mock`）と能力（`local`）を次のように分けた。能力テストは数値を観察として表に出力し、優劣はアサートしない。結果は
`specs/003-domain-agents/research.md` に記録する。

| ファイル | レーン | 内容 |
|---|---|---|
| `tests/regression/mcp-fatal-stop.test.ts` | gate | 許可ルート外の読み取り（致命的エラー）でループが止まり、停止理由が `error` になり、後続のツールが実行されない |
| `tests/regression/helpdesk-plan.db.test.ts` | gate（PGlite） | 問い合わせ → 計画 → 実行 → 判断 → チケット保存（`resolved` と `escalated`） |
| `tests/regression/research-budget.test.ts` | gate | Supervisor の呼び出し回数の上限と共有トークン予算 |
| `tests/regression/marketing-catalog.db.test.ts` | gate（PGlite） | レコメンドがカタログの商品 ID だけを返し、除去した件数を記録する |
| `tests/regression/marketing-council.test.ts` | gate | 合議の既定のラウンド数（3）と `max-rounds`、モデレーターが大きいときの予算 |
| `mcp-compare.local.test.ts` | `local` | 高水準ツール `findAndReadFiles` と低レベルの組み合わせのステップ数・トークン数（Req 1.12） |
| `analysis-fix.local.test.ts` | `local` + Docker | 実モデルが誤ったコードを修正して完走する割合。`local` レーンは Docker のソケットを遮断するため、通常の `mise run test:local` では理由付きでスキップされる（Ollama と Docker の両方を許すレーンが必要）|
| `research-quality.local.test.ts` | `local` | Supervisor の呼び分け、引用の遵守、単一エージェントとのトークン使用量の比較 |
| `council-agreement.local.test.ts` | `local` | 合議が上限内で合意に達する割合、単一エージェントとのトークン使用量の比較 |

| | gate | `local`（`mise run test:local`） | `container`（`mise run test:container`） |
|---|---|---|---|
| 保証すること | 配管: 停止理由、呼び出し回数と予算の上限、カタログ照合、チケットの保存 | 実モデルの観察値（ステップ数、トークン数、完走率、引用の遵守率、合意率） | 実 Docker のサンドボックスの隔離と実行（`@platform/ai-core` の `*.container.test.ts`） |
| 保証しないこと | 実モデルの品質。スキップは合格に数えない | 再現性（モデルとサンプリングに依存） | E2B の実機、macOS 以外のソケット |

## ファイル名と実行レーン

- `*.test.ts`: `mise run gate` の決定論的な `mock` レーンで実行する。
- `*.local.test.ts`: `mise run test:local` の実モデル評価で実行する。gate では収集するが、
  local 環境が利用できない場合は理由付きでスキップする。
- `*.db.test.ts`: インプロセス DB で完結する評価に使い、gate に含める。
- `*.pg.test.ts`: Docker Postgres が必要な評価に使い、`mise run test:db` だけで実行する。

テストは外部ネットワークへフォールバックさせない。`setup-hermetic` の制約下で、必要な外部状態は
fixture、mock、または明示された local レーンから与える。

## 004 への引き継ぎ

004 ではこの配置を維持したまま、次を追加する。

- Capability 評価のデータセット、採点基準、閾値、失敗時の診断情報
- LLM-as-a-Judge の校正、再現性、コスト記録
- 安全性、長時間実行ハーネス、承認ゲートに対する回帰評価
- 評価ケースと要件・リスク・本番インシデントのトレーサビリティ

新しい評価は、判定根拠をコードで検証できる場合はコードベースの採点を優先し、LLM 判定が必要な
場合も入力、rubric、閾値、モデル情報を明示する。
