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

## Regression

`tests/regression/` には、以前保証したエージェントの振る舞いを決定論的に固定する評価を置く。
`mock` シナリオを使い、停止理由、ツール呼び出し列、構造化された Outcome など、壊れてはならない
契約を検証する。M1 の `tool-agent-run.test.ts` はツールエージェントを最後まで通して検証し、
`@platform/ai-core` 内の純粋関数の単体テストとは重複させない。

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
