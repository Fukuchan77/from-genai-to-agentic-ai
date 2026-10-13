# rag-and-workflows（Milestone 2）— 実装タスク（索引）

`/sdd-tasks` が生成した。承認済みの [spec.md](spec.md)（WHAT）と [plan.md](plan.md)（HOW、C1〜C18、Implementation Waves W1〜W6）から、
実装の波ごとに分割した。ルールは `~/.claude/sdd/rules/tasks-generation.md` と `~/.claude/sdd/rules/tasks-parallel-analysis.md`
に従う。並列モード（`--sequential` 未指定）。001 の `tasks.md` と同じ運用（索引 + 現在の波の全文、未着手の波は `tasks-wN.md`、
完了した波は `tasks-comp-wN.md`）を採る。

## ファイル構成

| ファイル | 内容 |
|---|---|
| `tasks.md`（本ファイル） | 表記規約、ID 対応表、進捗、gate への段階的な結線、**現在の波（W4）**のタスク全文 |
| `tasks-w5.md`・`tasks-w6.md` | 未着手の波。前の波の完了時に `tasks.md` へ昇格する |
| `tasks-comp-w1.md`〜 | 完了した波の保管先（W1〜W3 完了）。波の完了時に作る |
| `traceability.md` | 要件 → 設計 → タスク → テスト → コミット（Test と Commit は `/sdd-ship` が埋める） |

タスク番号は全ファイルで一意で、移動しても変えない。`_Depends:_` と `traceability.md` は、ファイルをまたいで
番号だけで参照する。

### 完了した波の移行手順

001 の `tasks.md`「完了した波の移行手順」と同じである（2 つのコミットに分け、1 つ目は `git mv tasks.md tasks-comp-wN.md` だけ、
2 つ目は `git mv tasks-w(N+1).md tasks.md` の後に索引の節を移す）。移行の条件は次のとおり。

1. その波の全サブタスクが `[x]` で、各大タスクの Implementation Notes が記入済みである。
2. 波の締めのタスク（下記「gate への段階的な結線」）が完了し、`mise run gate` と CI の `ci-status` が成功している。
3. その波の敵対的レビュー（憲章 原則 9。新規コンテキストで `sdd-reviewer` と `adversarial-review` skill）の記録が
   `.sdd/reviews/002-rag-and-workflows-impl-wN-review-YYYY-MM-DD.md`（1 ラウンド 1 ファイル）にあり、指摘への対応が追記されている。

## 表記規約

- `- [ ]` 未着手、`- [x]` 完了、`- [ ]*` 任意・後回し可のテスト（この spec では使っていない）。
- `(P)` = 並列実行可（依存なし・境界の重複なし）。同じ波の中で、依存関係の同じ段にあるタスクの間でだけ付ける。
- 各タスク（大タスク・サブタスクの両方）は `_Boundary:_`、`_Depends:_`、`_Requirements:_`、`_Traces:_` を必ず持つ。
- **テスト先行（憲章 原則 4）**: 実装を含むサブタスクは、対応するテストファイルを同じ `_Boundary:_` に含め、RED（失敗の確認）→
  GREEN → REFACTOR を 1 つのサブタスクの中で行う。設定・文書・ガイドなど単独のテストを持たないサブタスクは、検証手段を
  `_Verify:_` に書く。
- `_Requirements:_` は spec.md の受け入れ基準番号（例: `1.1`）を数値のみでカンマ区切りに列挙する。基盤の作業で対応する
  受け入れ基準が plan の部品表（`Requirements` 行）にあるものは、それを書く。
- `_Traces:_` は安定リンク ID を持つ。この spec は `spec.md`/`plan.md` に `REQ-###`/`DES-#.#` 形式の見出しを持たないため、
  下記の対応表で実在する見出しに固定する（001 と同じ扱い）。
- 各大タスクの末尾の `### Implementation Notes` は生成時は空。大タスクの完了後に、実装者が学びを 1〜3 項目追記する。
- **Boundary の対象**: plan の File Structure Plan にあるファイルに限る。次の例外だけを許す。(1) 生成物 `pnpm-lock.yaml`
  （1.1）。(2) `specs/002-rag-and-workflows/` 配下の spec 文書（`research.md` への実測の追記、`traceability.md`）。
  (3) plan C1「既知の影響」が明示する、`mock:judge-v1` の追加で影響を受ける `apps/web` の既存テスト（2.2 の RED で特定）。
- **共有ファイルの編集者**: `mise.toml` は 1.2（`client-bundle` のセンチネル）と各波の締めのタスクだけが編集する。
  `stryker.config.mjs` は各波の締めのタスクだけが編集する。`packages/ai-core/package.json` は 1.1 だけが編集する（`exports` の
  4 サブパス `./structured`、`./rag`、`./workflows`、`./patterns` を含む。参照先の `index.ts` は各領域の最初のタスクが作る）。
  `packages/ai-core/src/models/gateway.ts` の `mock` 既定シナリオへの追加は、シナリオを作る 14.2（M2-1/M2-2）と 18.1・18.2（M2-3/M2-4）だけが行う。
  `packages/ai-core/src/rag/index.ts` は 8.3（初期）と 13.4（最終）、`apps/web/lib/server/platform.ts` は 8.4 と 15.1 だけが編集する。

### ID 対応表

| ID | 対応する見出し |
|---|---|
| `REQ-001`〜`REQ-004` | spec.md の `### Requirement 1`〜`### Requirement 4`（要件グループ単位。受け入れ基準単位の詳細は `_Requirements:_` を見る） |
| `C1`〜`C18` | plan.md の `### C_N <名前>`（実在する見出し。`DES-#.#` の代わりにこの一次 ID を使う。001 の `C1`〜`C22` とは別の番号） |
| `CL-1`〜`CL-12` | plan.md「Clarifications」の決定 |
| `ADR-1`〜`ADR-12`、`R-1`/`R-2` | research.md の決定とリスク |

## 進捗

| 波 | 大タスク | 状態 | ファイル |
|---|---|---|---|
| W1 基盤 | 1 依存と設定ファイル、2 設定・カタログ・ゲートウェイの拡張、3 共通部品（Rerank ポート、`generateValidated`）、4 リポジトリ検査 | 完了（2026-10-12 に移行） | [tasks-comp-w1.md](tasks-comp-w1.md) |
| W2 ナレッジベース | 5 DB 層、6 取り込みの部品、7 埋め込みとストア、8 取り込みの組み立てと HTTP 入口、9 コーパスと実サーバー確認 | 完了（2026-10-12 に移行） | [tasks-comp-w2.md](tasks-comp-w2.md) |
| W3 検索・回答・Agentic | 10 検索パイプライン、11 回答と引用、12 Agentic RAG、13 RAG の評価、14 評価データとシナリオ、15 RAG の HTTP 入口 | 完了（2026-10-12 に移行） | [tasks-comp-w3.md](tasks-comp-w3.md) |
| W4 ワークフロー・パターン | 16 ワークフロー、17 エージェントデザインパターン、18 シナリオとデモ、19 ワークフローの HTTP 入口 | 完了（2026-10-13 に検証。アーカイブ前） | 本ファイル |
| W5 画面と E2E | 20 RAG 画面の部品、21 ワークフロー画面の部品、22 ページ、23 E2E | 未着手 | [tasks-w5.md](tasks-w5.md) |
| W6 評価・解説・統合 | 24 評価テスト、25 `local` での実測、26 解説、27 トレーサビリティ・ステアリング、28 最終統合 | 未着手 | [tasks-w6.md](tasks-w6.md) |

**波の依存**（plan「Implementation Waves」）: W2 は W1 に、W3 は W2 に、W5 は W3 と W4 に、W6 は W5 に依存する。W4 は W1 のみに依存するため
W2・W3 と並行できるが、W3 と W4 は `gateway.ts`・`mock/index.ts`・`src/mock/m2-scenarios.test.ts` を共有するので、シナリオとデモのタスク
（18）は 14.2 の後に行う。関数そのもののタスク（16、17）は W2・W3 と並行してよい。

**plan の波の割り当てからの調整**: コーパス 6 本（plan では W3）を W2 の 9.1 に前倒しした。W2 の実サーバー確認（リスク R-1）が
「取り込み → 検索」を通すにはコーパスが要るためである。ラベル付き質問セット（`eval-set.json`）は plan のとおり W3 の 14.1 で、コーパスを固めた後に書く。
完成タグ（`module/2-1`〜`2-4`）は、解説の完成後に W6 の 28.3 でローカルに付け、push は人が行う。

## gate への段階的な結線

gate の各段は「走査 0 件で失敗」するため、検査対象がまだない規則を最初から入れると、実装の途中で必ず失敗する（001 と同じ）。
規則そのものは W1 の 4.1 で実装して単体テストで守り、`mise.toml` の `check:repo-rules --only` へは、走査対象が揃う波の締めで加える。
一度加えた規則は外さない。`gate` の段の順序は変えない（plan C17）。

| 時点 | 締めのタスク | `check:repo-rules --only` に加える規則 | その他の結線 |
|---|---|---|---|
| W1 の締め | 4.4 | `no-sql-raw`（`ai-core/src` は常に走査対象がある） | — |
| W2 の締め | 9.3 | — | `stryker.config.mjs` に `markdown.ts`、`chunk.ts`、`search-text.ts` |
| W3 の締め | 15.5 | — | `stryker.config.mjs` に `rrf.ts`、`citations.ts`、`recall.ts` |
| W4 の締め | 19.2 | `workflow-no-agent-loop`（`workflows/` と `patterns/` が揃う） | `stryker.config.mjs` に `parallelization.ts`、`evaluator-optimizer.ts` |
| W5 の締め | 23.4 | — | — |
| W6 の締め | 28.1 | — | `docs:check` は 001 から結線済み。2-1〜2-4 の解説が加わった状態で成功することを確かめる |

---

## 現在の波: W4 ワークフロー・パターン（大タスク 16〜19）

W3（大タスク 10〜15）は完了し [tasks-comp-w3.md](tasks-comp-w3.md) に移した。

5 つのワークフロー、6 つのパターン、共有予算、デモの合成、`/api/workflows`、`m2-3`・`m2-4` のシナリオを作る。制御フローは素の TypeScript の
関数合成で、`ToolLoopAgent` を使わない（Req 3.13）。唯一の例外は Role-Based Cooperation（17.6）で、`createGuardedAgent` を役割ごとに 1 回ずつ生成する。

**並行の注意**: 16、17 の関数のタスクは W2・W3 と並行してよい。シナリオとデモ（18）は、`gateway.ts`・`mock/index.ts`・`src/mock/m2-scenarios.test.ts` を W3 の 14.2 と
共有するため、14.2 の後に行う。16.8・17.7 以外の `index.ts` の編集は 18.3・18.4 だけが行う。

16.1 の後、16.2・16.3・16.5・16.6・17.1・17.2・17.6 は並列に進められる。16.4 と 16.7 はそれぞれ 16.3 と 16.5 の後。

---

## 16. ワークフロー（C11）

Anthropic の 5 パターンを、独立して呼び出せる再利用可能な関数として提供する。すべて解決済みのモデルと実行関数を引数で受け取り、`signal` を
伝播する（`resolveTiers` だけがゲートウェイを呼ぶ）。上限の検査は `assertWithinLimit`（CL-3）。

_Boundary:_ `packages/ai-core/src/workflows/limits.ts`, `packages/ai-core/src/workflows/limits.test.ts`, `packages/ai-core/src/workflows/errors.ts`, `packages/ai-core/src/workflows/errors.test.ts`, `packages/ai-core/src/workflows/prompt-chaining.ts`, `packages/ai-core/src/workflows/prompt-chaining.test.ts`, `packages/ai-core/src/workflows/routing.ts`, `packages/ai-core/src/workflows/routing.test.ts`, `packages/ai-core/src/workflows/model-tier.ts`, `packages/ai-core/src/workflows/model-tier.test.ts`, `packages/ai-core/src/workflows/parallelization.ts`, `packages/ai-core/src/workflows/parallelization.test.ts`, `packages/ai-core/src/workflows/orchestrator-workers.ts`, `packages/ai-core/src/workflows/orchestrator-workers.test.ts`, `packages/ai-core/src/workflows/evaluator-optimizer.ts`, `packages/ai-core/src/workflows/evaluator-optimizer.test.ts`, `packages/ai-core/src/workflows/index.ts`
_Depends:_ 2.1, 2.2, 3.2
_Requirements:_ 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12, 3.13
_Traces:_ REQ-003, C11

- [x] 16.1 `workflows/limits.ts`・`errors.ts`: `assertWithinLimit(name, value, max)`（上限を超える値は `invalid-request`。`DEFAULT_WORKFLOW_LIMITS` を参照する）と `WorkflowStepError`（`PlatformError("output-invalid")` を継承し、失敗した段の名前を持つ）+ `limits.test.ts`・`errors.test.ts` に、境界値（上限ちょうどは通り、超えると拒否）、既定値の参照、`WorkflowStepError` が `PlatformError` で段の名前と原因を保持することを先に足す
  _Boundary:_ `packages/ai-core/src/workflows/limits.ts`, `packages/ai-core/src/workflows/limits.test.ts`, `packages/ai-core/src/workflows/errors.ts`, `packages/ai-core/src/workflows/errors.test.ts`
  _Depends:_ 2.1
  _Requirements:_ 3.5, 3.6, 3.7, 3.8
  _Traces:_ REQ-003, C11
- [x] 16.2 (P) `workflows/prompt-chaining.ts`: `runPromptChain({ input, steps, signal })`。`ChainStep { name; run(input); validate?(output): readonly string[] }`。検証が問題を返したら**後続を実行せず**、`{ status: "failed"; failedStep; errors; steps }` を返す（例外にしない）。完了は `{ status: "completed"; output; steps }` + `prompt-chaining.test.ts` に、全ステップ成功、途中の検証失敗で後続の `run` が呼ばれない（非空虚）、失敗したステップ名と検証エラー、ステップ間で出力が次の入力になる、`validate` なしのステップ、中断を先に足す
  _Boundary:_ `packages/ai-core/src/workflows/prompt-chaining.ts`, `packages/ai-core/src/workflows/prompt-chaining.test.ts`
  _Depends:_ 16.1
  _Requirements:_ 3.1, 3.2, 3.13
  _Traces:_ REQ-003, C11
- [x] 16.3 (P) `workflows/routing.ts`: `route({ input, categories, classify, handlers, fallback })`（`classify` は `{ category; reason }` を返す。事前定義の分類に無ければ `fallback` を実行して `matched: false`。結果は `{ category; reason; matched; output }`）と `classifyWithModel`（`generateValidated`、分類は `z.enum`）+ `routing.test.ts` に、分類どおりのハンドラの実行、分類結果と理由の返却、未知の分類でフォールバック（`matched: false`、他のハンドラは呼ばれない）、`classifyWithModel` のスキーマ違反の再生成を先に足す
  _Boundary:_ `packages/ai-core/src/workflows/routing.ts`, `packages/ai-core/src/workflows/routing.test.ts`
  _Depends:_ 16.1, 3.2
  _Requirements:_ 3.1, 3.3, 3.4, 3.13
  _Traces:_ REQ-003, C11
- [x] 16.4 `workflows/model-tier.ts`: `resolveTiers(gateway)`（`MODEL_TIERS` からゲートウェイ経由で軽量・高性能の 2 モデルを解決する。ワークフロー関数でゲートウェイを呼ぶのはここだけ）と `routeByDifficulty({ input, tiers, classifyDifficulty, run })`（難度を分類し、`tiers.light`/`tiers.capable` のどちらかで実行する。結果に `tier`、`modelId`、`displayName`、`distinct`（2 ティアが別モデルか）、`usage` を含む。CL-10）+ `model-tier.test.ts` に、難度に応じた振り分け先、結果のモデル名とトークン使用量、2 ティアが同じモデルのとき `distinct: false` で続行、`mock` での解決を先に足す
  _Boundary:_ `packages/ai-core/src/workflows/model-tier.ts`, `packages/ai-core/src/workflows/model-tier.test.ts`
  _Depends:_ 2.2, 16.3
  _Requirements:_ 3.12
  _Traces:_ REQ-003, C11
- [x] 16.5 (P) `workflows/parallelization.ts`: `parallelSections({ sections, run, limits, signal })`（並列実行して順序どおりに全結果を返す。1 つでも失敗したら他を中断し、失敗した区画名を含む `WorkflowStepError` を投げる。区画数は `maxSections` まで）と `parallelVote({ task, votes, run, normalize, signal })`（`votes` 既定 3・上限 `maxVotes` 回を並列に実行し、`{ outcome: "majority"; conclusion; tally; ballots } | { outcome: "tie"; tiedLabels; tally; ballots }`。**最多票が同数のときは特定の結論を選ばない**）+ `parallelization.test.ts` に、並列に開始される（全区画が開始されてから完了する）、順序の維持、1 区画の失敗で他が中断され区画名がエラーに入る、区画数の上限超過の拒否、多数決の集計と内訳、同数で `tie` かつ結論を持たない（非空虚: 最初の票を選ぶ実装だと落ちる）、`normalize` による票の正規化、`votes` の上限超過を先に足す
  _Boundary:_ `packages/ai-core/src/workflows/parallelization.ts`, `packages/ai-core/src/workflows/parallelization.test.ts`
  _Depends:_ 16.1
  _Requirements:_ 3.1, 3.5, 3.6, 3.13
  _Traces:_ REQ-003, C11
- [x] 16.6 (P) `workflows/orchestrator-workers.ts`: `orchestrate({ task, planner, worker, synthesize, limits, signal })`（計画 — サブタスクを実行時に決定。`generateValidated`、件数は `.min(1).max(maxSubtasks)` — → ワーカーへ並列委譲 → 統合。結果は `{ subtasks, results: { subtask; status: "completed" | "failed"; output? }[], synthesis }`。一部のワーカーが失敗しても残りで統合し、全件が失敗したら `WorkflowStepError`）+ `orchestrator-workers.test.ts` に、サブタスクが入力に応じて動的に変わる（2 種類のタスクで件数が違う）、ワーカーの並列実行、一部失敗でも残りで統合し失敗が結果に含まれる、全件失敗で `WorkflowStepError`、サブタスク数の上限超過で再生成、中断を先に足す
  _Boundary:_ `packages/ai-core/src/workflows/orchestrator-workers.ts`, `packages/ai-core/src/workflows/orchestrator-workers.test.ts`
  _Depends:_ 16.1, 3.2
  _Requirements:_ 3.1, 3.7, 3.13
  _Traces:_ REQ-003, C11
- [x] 16.7 `workflows/evaluator-optimizer.ts`: `evaluateAndOptimize({ task, generate, evaluators, passScore, maxIterations, signal })`（各評価器を `parallelSections` で並列に実行し、統合スコア = 評価器ごとのスコアの最小値。**合格はコードがスコアと基準を比べて判定する**（LLM の自己申告を使わない）。履歴 `{ iteration; output; scores: { evaluator; score; feedback }[]; combinedScore }[]`。結果は `{ final; passed; iterations; history; bestIteration }`。合格しなければ最高スコアの生成物（同点は最も早い反復。CL-4）を返して `passed: false`。評価器が 1 つでも失敗したら `output-invalid`（スコアを推測で補わない）。反復回数は `maxIterationsCap` まで）と `createModelEvaluator({ name, rubric, model })`（スコアは 0〜100 の整数を `generateValidated` で検証）+ `evaluator-optimizer.test.ts` に、合格基準に達した時点で止まる（既定 85 点）、最大反復（既定 3）で止まり `passed: false`、最高スコアの選択と同点で最初の反復（非空虚）、統合スコアが最小値（非空虚: 平均だと落ちる）、評価器の並列実行、合格判定がコードであること（評価器が「合格」と言っても基準未満なら続ける）、履歴の中身、評価器の失敗、スコアが 0〜100 の整数でないときの再生成、上限超過の拒否を先に足す
  _Boundary:_ `packages/ai-core/src/workflows/evaluator-optimizer.ts`, `packages/ai-core/src/workflows/evaluator-optimizer.test.ts`
  _Depends:_ 16.5, 3.2
  _Requirements:_ 3.1, 3.8, 3.9, 3.10, 3.11, 3.13
  _Traces:_ REQ-003, C11
- [x] 16.8 `workflows/index.ts`: `@platform/ai-core/workflows` の公開 API の初期版（5 パターン、`resolveTiers`、`assertWithinLimit`、`WorkflowStepError`、型）。`runWorkflowDemo` は 18.3 が足す
  _Boundary:_ `packages/ai-core/src/workflows/index.ts`
  _Depends:_ 16.2, 16.3, 16.4, 16.5, 16.6, 16.7
  _Requirements:_ 3.1
  _Traces:_ REQ-003, C11
  _Verify:_ `mise run typecheck` が成功し、`apps/web` から `@platform/ai-core/workflows` を import できる。plan「後続 spec への契約」の `evaluateAndOptimize`、`createModelEvaluator`、`parallelVote`、`orchestrate` がすべて公開されている

### Implementation Notes

- `PlatformError` のうち `output-invalid` 以外（`provider-unavailable` など、要求や環境に関するもの）は `WorkflowStepError` に包まず、そのまま上位へ渡す（`errors.ts` の `toStepError`）。包むと Route Handler が 503 でなく 502 を返してしまう。呼び出し側の中断は理由をそのまま投げる。
- 合格判定・多数決・最高スコア選択はすべてコード側の比較で、LLM の自己申告を使わない。評価器の応答スキーマには「合格」の欄を置かない。トークン使用量の集計は `model-tier.ts` の `sumUsage` に置き、`demos.ts`（18.3）が再利用する。
- 敵対的な stub（`prove.sh` / `provepy.py`）で、互いを覆い合って生き残る防御（`hasOwn` と分類の包含、`parallelSections` が持つ中断チェックの重複）を見つけた。片方だけを外すテスト、または重複の削除で解消した。

---

## 17. エージェントデザインパターン（C12）

18 パターンのうち主要な 6 つを、独立して呼び出せる関数として提供する。Role-Based Cooperation だけが `ToolLoopAgent`
（`createGuardedAgent` 経由）を使い、`patterns/` で唯一 `agents/` を import してよいファイルである。

_Boundary:_ `packages/ai-core/src/patterns/passive-goal-creator.ts`, `packages/ai-core/src/patterns/passive-goal-creator.test.ts`, `packages/ai-core/src/patterns/prompt-optimizer.ts`, `packages/ai-core/src/patterns/prompt-optimizer.test.ts`, `packages/ai-core/src/patterns/single-path-plan.ts`, `packages/ai-core/src/patterns/single-path-plan.test.ts`, `packages/ai-core/src/patterns/multi-path-plan.ts`, `packages/ai-core/src/patterns/multi-path-plan.test.ts`, `packages/ai-core/src/patterns/reflection.ts`, `packages/ai-core/src/patterns/reflection.test.ts`, `packages/ai-core/src/patterns/role-based-cooperation.ts`, `packages/ai-core/src/patterns/role-based-cooperation.test.ts`, `packages/ai-core/src/patterns/index.ts`
_Depends:_ 2.1, 2.2, 3.2, 16.1, 16.5, 16.7
_Requirements:_ 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7
_Traces:_ REQ-004, C12

- [x] 17.1 (P) `patterns/passive-goal-creator.ts`: `createPassiveGoal({ model, instruction, signal })` → `GoalSpec { objective; constraints; successCriteria; missingInformation; clarifyingQuestions }`。情報が不足するとき `missingInformation` と `clarifyingQuestions` が空でないことを `generateValidated` の追加検証で保証する + `passive-goal-creator.test.ts` に、十分な指示で目的・制約・成功基準が揃う、曖昧な指示で不足項目と確認用の質問が返る、不足ありなのに質問が空のとき再生成、3 回失敗で `output-invalid` を先に足す
  _Boundary:_ `packages/ai-core/src/patterns/passive-goal-creator.ts`, `packages/ai-core/src/patterns/passive-goal-creator.test.ts`
  _Depends:_ 3.2
  _Requirements:_ 4.1, 4.2
  _Traces:_ REQ-004, C12
- [x] 17.2 (P) `patterns/prompt-optimizer.ts`: `optimizePromptOrResponse({ model, target: "prompt" | "response", original, goal })` → `{ original; improved; reasons }`（`reasons` は空にならない）+ `prompt-optimizer.test.ts` に、改善前後と理由の返却、`target` ごとのプロンプトの違い、理由が空のとき再生成を先に足す
  _Boundary:_ `packages/ai-core/src/patterns/prompt-optimizer.ts`, `packages/ai-core/src/patterns/prompt-optimizer.test.ts`
  _Depends:_ 3.2
  _Requirements:_ 4.1, 4.3
  _Traces:_ REQ-004, C12
- [x] 17.3 (P) `patterns/single-path-plan.ts`: `planSinglePath({ planner, executor, goal, limits })` → `{ steps; results: { step; output }[] }`（ステップ数は `.max(maxPlanSteps)`。順に実行し、前のステップの結果を次に渡す）+ `single-path-plan.test.ts` に、順序どおりの実行（並列でない）、ステップごとの結果、ステップ数の上限超過で再生成、実行中の失敗で後続を実行しない、中断を先に足す
  _Boundary:_ `packages/ai-core/src/patterns/single-path-plan.ts`, `packages/ai-core/src/patterns/single-path-plan.test.ts`
  _Depends:_ 16.1, 3.2
  _Requirements:_ 4.1, 4.4
  _Traces:_ REQ-004, C12
- [x] 17.4 `patterns/multi-path-plan.ts`: `planMultiPath({ planner, evaluator, goal, candidates, limits })` → `{ candidates; evaluations; selectedIndex; reason }`（候補数は既定 3・上限 `maxCandidates`。候補を `parallelSections` で並列に生成し、評価器が選ぶ。評価器の選択が範囲外なら再生成）+ `multi-path-plan.test.ts` に、既定で 3 候補、候補の並列生成、評価器が選んだ計画と理由、全候補の評価結果、候補数の上限超過の拒否、1 候補の生成失敗を先に足す
  _Boundary:_ `packages/ai-core/src/patterns/multi-path-plan.ts`, `packages/ai-core/src/patterns/multi-path-plan.test.ts`
  _Depends:_ 16.5, 16.7
  _Requirements:_ 4.1, 4.5
  _Traces:_ REQ-004, C12
- [x] 17.5 `patterns/reflection.ts`: `reflect({ mode: "self" | "cross", generator, critic, task, maxIterations, signal })` → `{ final; history: { iteration; output; critique; revised }[]; generatorModelId; criticModelId }`（批評と修正を最大反復回数（既定 3）まで繰り返す。`cross` は `critic.entry.id !== generator.entry.id` を要求し、満たさなければ実行前に `invalid-request`。CL-5）+ `reflection.test.ts` に、`self` の反復と履歴、`cross` で批評側が別のカタログ ID であること、`cross` で同一モデルを拒否し LLM を呼ばない（非空虚）、反復回数の上限（既定 3、`maxIterationsCap` 超過を拒否）、批評が「修正不要」のとき早期に終わるかどうかの仕様に沿った動作、`mock` の `judge`（`mock:judge-v1`）を批評側に使えることを先に足す
  _Boundary:_ `packages/ai-core/src/patterns/reflection.ts`, `packages/ai-core/src/patterns/reflection.test.ts`
  _Depends:_ 2.2, 16.7
  _Requirements:_ 4.1, 4.6
  _Traces:_ REQ-004, C12
- [x] 17.6 (P) `patterns/role-based-cooperation.ts`: `cooperateByRole({ roles, task, budget, clock, signal })` → `{ outputs: { role; output; run: AgentRunSummary }[]; final; stopped?: "budget-exhausted" | StopReason }`。役割（例: リサーチャー、コーダー、レビュアー。上限 `maxRoles`）ごとに `createGuardedAgent` を 1 回生成して順に作業を受け渡す。全役割で合計トークンの上限（既定 `AGENT_MAX_TOTAL_TOKENS`）を共有し、各役割には残りを `limits.maxTotalTokens` として渡す（CL-8）。残りが尽きたら次の役割を実行せず `stopped: "budget-exhausted"` とそれまでの出力を返す。役割の停止理由が `error`/`aborted`/`timeout` のときも次へ進まない。`patterns/` で唯一 `agents/` を import してよいファイル + `role-based-cooperation.test.ts` に、役割ごとに `createGuardedAgent` が 1 回ずつ呼ばれる、前の役割の出力が次の入力に入る、役割ごとの出力と最終成果物、共有予算の枯渇で後続を実行しない（非空虚）、各役割に「残り」が渡る、停止理由による打ち切り、役割数の上限超過の拒否を先に足す（`mock` モデルで検証）
  _Boundary:_ `packages/ai-core/src/patterns/role-based-cooperation.ts`, `packages/ai-core/src/patterns/role-based-cooperation.test.ts`
  _Depends:_ 2.1
  _Requirements:_ 4.1, 4.7
  _Traces:_ REQ-004, C12
- [x] 17.7 `patterns/index.ts`: `@platform/ai-core/patterns` の公開 API の初期版（6 パターンと型、`cooperateByRole` の共有予算。`runPatternDemo` は 18.4 が足す）
  _Boundary:_ `packages/ai-core/src/patterns/index.ts`
  _Depends:_ 17.1, 17.2, 17.3, 17.4, 17.5, 17.6
  _Requirements:_ 4.1
  _Traces:_ REQ-004, C12
  _Verify:_ `mise run typecheck` が成功し、`apps/web` から `@platform/ai-core/patterns` を import できる。`mise run check:repo-rules` の `guarded-agent-only` が成功する（`new ToolLoopAgent` を書いていない）

### Implementation Notes

- `reflect` の履歴の `revised` は修正後の本文（文字列）にした。批評者が `needsRevision: false` と答えたときは `revised === output` で早期に終わる。反復の上限はコードが持つ（`maxIterationsCap`）。`cross` は `critic` を省略すると生成側と同じ ID になり、同じ拒否に落ちる。
- `cooperateByRole` のテストは、規則 `workflow-no-agent-loop` が `patterns/` の `role-based-cooperation.ts` 以外の `agents/` の import（テストも含む）を許さないため、`vi.mock` + `vi.hoisted` で `createGuardedAgent` を覗く。`token-budget` の停止理由は、モデルが 1 ステップで自然に終わると発火しない（`completed` になる）ので、予算切れは残りトークンの計算で判定する。
- パターンの戻り値にトークン使用量を持たせず、`demos.ts`（18.3・18.4）がモデルを `wrapLanguageModel` で包んで集計する方針にした（計画の戻り値の型を保つため）。

---

## 18. シナリオとデモの合成（C15、C11、C12）

`mock` のシナリオと、HTTP・画面から呼ぶ名前ごとの固定の合成を作る。各デモ合成の LLM 呼び出しの最大回数を算出してテストで固定し、
`live` でのレート制限（429）に加えて費用を抑える（plan C13「ワークフロー API の呼び出し回数」）。

_Boundary:_ `packages/ai-core/fixtures/scenarios/m2-3.ts`, `packages/ai-core/src/mock/m2-scenarios.test.ts`, `packages/ai-core/src/mock/index.ts`, `packages/ai-core/src/models/gateway.ts`, `packages/ai-core/src/models/gateway.test.ts`, `packages/ai-core/fixtures/scenarios/m2-4.ts`, `packages/ai-core/src/workflows/demos.ts`, `packages/ai-core/src/workflows/demos.test.ts`, `packages/ai-core/src/workflows/index.ts`, `packages/ai-core/src/patterns/demos.ts`, `packages/ai-core/src/patterns/demos.test.ts`, `packages/ai-core/src/patterns/index.ts`
_Depends:_ 14.2, 16.8, 17.7
_Requirements:_ 3.1, 3.2, 3.3, 3.5, 3.6, 3.7, 3.8, 3.12, 3.13, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7
_Traces:_ REQ-003, REQ-004, C11, C12, C15

- [x] 18.1 `fixtures/scenarios/m2-3.ts`: 5 ワークフローのシナリオ（`prompt-chaining`（アウトライン → 本文。本文の検証に失敗するケースを含む）、`routing`、`model-routing`、`parallel-sectioning`、`parallel-voting`（多数決と同数の 2 通り）、`orchestrator-workers`、`evaluator-optimizer`（不合格 → 改善 → 合格、未合格のまま最大反復の 2 通り））を `fixture:` マーカーで照合する形で作る。シナリオ ID は `m2-3/...`。`models/gateway.ts` の `mock` 既定シナリオに足し、`mock/index.ts` から `M2_3_SCENARIOS` を再エクスポートする + `src/mock/m2-scenarios.test.ts` に、曖昧な一致の検出と全 `fixture:` マーカーの網羅に M2-3 を足し、`gateway.test.ts` に M2-3 が一致することを先に足す
  _Boundary:_ `packages/ai-core/fixtures/scenarios/m2-3.ts`, `packages/ai-core/src/mock/m2-scenarios.test.ts`, `packages/ai-core/src/mock/index.ts`, `packages/ai-core/src/models/gateway.ts`, `packages/ai-core/src/models/gateway.test.ts`
  _Depends:_ 14.2, 16.8
  _Requirements:_ 3.2, 3.3, 3.5, 3.6, 3.7, 3.8, 3.12
  _Traces:_ REQ-003, C15
- [x] 18.2 `fixtures/scenarios/m2-4.ts`: 6 パターンのシナリオ（`passive-goal-creator`（十分な指示と曖昧な指示）、`prompt-response-optimizer`、`single-path-plan`、`multi-path-plan`、`self-reflection`、`cross-reflection`（`mock:judge-v1` が批評）、`role-based-cooperation`（ツール呼び出しを含む役割ごとの流れ））を作る。シナリオ ID は `m2-4/...`。`gateway.ts` と `mock/index.ts` に足し、`M2_4_SCENARIOS` を再エクスポートする + `src/mock/m2-scenarios.test.ts` に M2-4 の曖昧な一致の検出と `fixture:` マーカーの網羅を、`gateway.test.ts` に M2-4 の一致を先に足す
  _Boundary:_ `packages/ai-core/fixtures/scenarios/m2-4.ts`, `packages/ai-core/src/mock/m2-scenarios.test.ts`, `packages/ai-core/src/mock/index.ts`, `packages/ai-core/src/models/gateway.ts`, `packages/ai-core/src/models/gateway.test.ts`
  _Depends:_ 17.7, 18.1
  _Requirements:_ 4.2, 4.3, 4.4, 4.5, 4.6, 4.7
  _Traces:_ REQ-004, C15
- [x] 18.3 `workflows/demos.ts`: `runWorkflowDemo(name, deps, input)`（`prompt-chaining`/`routing`/`model-routing`/`parallel-sectioning`/`parallel-voting`/`orchestrator-workers`/`evaluator-optimizer` の名前ごとの固定の合成。`name` は閉じた語彙で、`options` は名前ごとの `z.strictObject`。上限を超える値は `invalid-request`）を作り、`workflows/index.ts` から公開する + `demos.test.ts` に、各名前が `mock` のシナリオで完走して結果の型どおりに返る、**各合成の LLM 呼び出しの最大回数**（上限の積。例: Evaluator-Optimizer は反復 × 評価器 + 生成）が上限どおりで、上限を超える `options` を拒否する、未知の名前の拒否を先に足す
  _Boundary:_ `packages/ai-core/src/workflows/demos.ts`, `packages/ai-core/src/workflows/demos.test.ts`, `packages/ai-core/src/workflows/index.ts`
  _Depends:_ 18.1, 16.8
  _Requirements:_ 3.1, 3.13
  _Traces:_ REQ-003, C11
- [x] 18.4 `patterns/demos.ts`: `runPatternDemo(name, deps, input)`（`passive-goal-creator`/`prompt-response-optimizer`/`single-path-plan`/`multi-path-plan`/`self-reflection`/`cross-reflection`/`role-based-cooperation` の名前ごとの固定の合成。`role-based-cooperation` のデモだけは `role-based-cooperation.ts` のエクスポートを経由して呼び、`demos.ts` 自身は `agents/` を import しない）を作り、`patterns/index.ts` から公開する + `demos.test.ts` に、各名前の完走、最大呼び出し回数、`cross-reflection` が `AI_MODEL_JUDGE` 未設定の構成（同一 ID）で `invalid-request` になること、`demos.ts` が `agents/` を import していないこと、上限超過の拒否を先に足す
  _Boundary:_ `packages/ai-core/src/patterns/demos.ts`, `packages/ai-core/src/patterns/demos.test.ts`, `packages/ai-core/src/patterns/index.ts`
  _Depends:_ 18.2, 17.7
  _Requirements:_ 4.1, 4.6
  _Traces:_ REQ-004, C12
  _Verify:_ `mise run check:repo-rules --only workflow-no-agent-loop`（ローカルで実行）が `demos.ts` を許可せず、`role-based-cooperation.ts` だけを許可して成功する

### Implementation Notes

- `mock` のシナリオは最後のユーザーメッセージだけで照合する（システムプロンプトは見えない）。そのため、デモの合成とパターンのプロンプトの先頭に `[段: <段>]`・`[役割: <名前>]` の識別行を置き、評価器には `評価者: <名前>` の行を足した（W3 の `[judge-axis:…]` と同じ判断で、`fixture:` は本番プロンプトに載せない）。同じ段を共有する複数の変種は、標識にサンプルのタスク文を含めて区別する。標識と本物のプロンプトのずれは、`demos.test.ts` が全デモを `mock` で完走させて固定する。
- LLM 呼び出しの最大回数は `workflowDemoMaxCalls` / `patternDemoMaxCalls` に算出し（構造化出力は再生成を含め 3 回、Role-Based は役割数 × `maxSteps`）、オプションの上限検査を兼ねさせた。Route Handler は同じ関数を `inspect`（`live` のレート制限より前）で呼ぶ。トークン使用量と呼び出し回数は、モデルを `wrapLanguageModel` で包む `createUsageLedger` で集計する（パターンの戻り値の型を変えないため）。
- 規則 `workflow-no-agent-loop` は `patterns/` のテストも含めて `role-based-cooperation.ts` 以外の `agents/` の import を許さない。`createGuardedAgent` を覗くテストは `vi.hoisted` + `vi.mock` を使う。

---

## 19. ワークフローの HTTP 入口と W4 の締め（C13、C17）

`POST /api/workflows` を既存の検査順で提供する。Route Handler は `runWorkflowDemo`/`runPatternDemo` を呼ぶだけにする。

_Boundary:_ `apps/web/app/api/workflows/route.ts`, `apps/web/app/api/workflows/route.test.ts`, `mise.toml`, `stryker.config.mjs`
_Depends:_ 4.4, 15.5, 16.8, 17.7, 18.3, 18.4
_Requirements:_ 3.1, 3.13, 4.1
_Traces:_ REQ-003, REQ-004, C13, C17

- [x] 19.1 `app/api/workflows/route.ts`: `{ kind: "workflow" | "pattern"; name; task（1〜4000 文字）; options? }` を `z.strictObject` で検査し、`runWorkflowDemo`/`runPatternDemo` を呼んで JSON `{ name; result; usage }` を返す。`options` が上限を超える値は 400 `invalid-request`、モデルの出力不正は 502 `output-invalid`、接続不能は 503、`live` のみ 429。`request.signal` を伝播する + `route.test.ts` に、検査順（413 → 400 → 400 → `live` のみ 429）、`kind` と `name` の組み合わせの検証、各名前が `mock` で完走する、上限超過の拒否、`output-invalid` のコード、中断を先に足す
  _Boundary:_ `apps/web/app/api/workflows/route.ts`, `apps/web/app/api/workflows/route.test.ts`
  _Depends:_ 18.3, 18.4
  _Requirements:_ 3.1, 4.1
  _Traces:_ REQ-003, REQ-004, C13
- [x] 19.2 **W4 の締め**: `mise.toml` の `check:repo-rules` の `--only` に `workflow-no-agent-loop` を足し、`stryker.config.mjs` の `mutate` に `workflows/parallelization.ts`、`workflows/evaluator-optimizer.ts` を足す。**先に確かめること**: `workflows/` の任意のファイルに `ToolLoopAgent` の import を一時的に足すと `mise run check:repo-rules` が失敗し、`patterns/role-based-cooperation.ts` だけが許可されることを実リポジトリで確認して戻す。`mise run test:mutation` が閾値 70 を、`mise run gate` が成功することを確かめ、所要時間を Implementation Notes に記録する（予算 5 分）
  _Boundary:_ `mise.toml`, `stryker.config.mjs`
  _Depends:_ 4.4, 15.5, 16.8, 17.7, 19.1
  _Requirements:_ 3.13
  _Traces:_ REQ-003, C17
  _Verify:_ `mise run gate`（`check:repo-rules` の出力に `workflow-no-agent-loop: scanned N FILES`、N ≥ 1）と `mise run test:mutation` が成功する。違反例で規則が失敗することの確認を Implementation Notes に記録する 波の敵対的レビュー（憲章 原則 9。新規コンテキストで `sdd-reviewer`）を行い、記録 `.sdd/reviews/002-rag-and-workflows-impl-w4-review-YYYY-MM-DD.md` が存在し、指摘への対応が追記されていることを確かめる（波の移行条件 3）

### Implementation Notes

- `apps/web` は zod に依存しないため、`/api/workflows` の本文の検査は `GuardSchema` を満たす手書きの `safeParse` で行った（厳密なオブジェクト、`kind` と `name` の組み合わせ、`task` は文字数（コードポイント）で 1〜4000）。`options` の上限超過は `inspect` が `invalid-request` を投げ、`live` のレート制限の前に 400 になる。
- 締めの確認: 違反例（`workflows/limits.ts` に `ToolLoopAgent` の import、`patterns/demos.ts` に `../agents` の import）で `check-repo-rules --only workflow-no-agent-loop` は exit 1、`role-based-cooperation.ts` だけが許可される。`mise run test:mutation` は 6 分 46 秒（予算 5 分を超過。ファイルが 17 本に増えた）で、総合 86.45（`parallelization.ts` 95.08、`evaluator-optimizer.ts` 84.26、閾値 70）。`TURBO_FORCE=true mise run gate` は exit 0 で、`workflow-no-agent-loop: scanned 34 FILES`、`@platform/ai-core executed=1732 passed=1732 skipped=4`、`web executed=472 passed=472`、テスト段は約 28 秒。`NODE_ENV=production mise run check:client-bundle`（`next build`）も成功した。
