# rag-and-workflows（Milestone 2）— 実装タスク W4: ワークフロー・パターン（大タスク 16〜19）

表記規約、ID 対応表、進捗、gate への段階的な結線、移行手順は [tasks.md](tasks.md) を参照する。W1（大タスク 1〜4）の完了後に着手できる。

5 つのワークフロー、6 つのパターン、共有予算、デモの合成、`/api/workflows`、`m2-3`・`m2-4` のシナリオを作る。制御フローは素の TypeScript の
関数合成で、`ToolLoopAgent` を使わない（Req 3.13）。唯一の例外は Role-Based Cooperation（17.6）で、`createGuardedAgent` を役割ごとに 1 回ずつ生成する。

**並行の注意**: 16、17 の関数のタスクは W2・W3 と並行してよい。シナリオとデモ（18）は、`gateway.ts`・`mock/index.ts`・`m2.test.ts` を W3 の 14.2 と
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

- [ ] 16.1 `workflows/limits.ts`・`errors.ts`: `assertWithinLimit(name, value, max)`（上限を超える値は `invalid-request`。`DEFAULT_WORKFLOW_LIMITS` を参照する）と `WorkflowStepError`（`PlatformError("output-invalid")` を継承し、失敗した段の名前を持つ）+ `limits.test.ts`・`errors.test.ts` に、境界値（上限ちょうどは通り、超えると拒否）、既定値の参照、`WorkflowStepError` が `PlatformError` で段の名前と原因を保持することを先に足す
  _Boundary:_ `packages/ai-core/src/workflows/limits.ts`, `packages/ai-core/src/workflows/limits.test.ts`, `packages/ai-core/src/workflows/errors.ts`, `packages/ai-core/src/workflows/errors.test.ts`
  _Depends:_ 2.1
  _Requirements:_ 3.5, 3.6, 3.7, 3.8
  _Traces:_ REQ-003, C11
- [ ] 16.2 (P) `workflows/prompt-chaining.ts`: `runPromptChain({ input, steps, signal })`。`ChainStep { name; run(input); validate?(output): readonly string[] }`。検証が問題を返したら**後続を実行せず**、`{ status: "failed"; failedStep; errors; steps }` を返す（例外にしない）。完了は `{ status: "completed"; output; steps }` + `prompt-chaining.test.ts` に、全ステップ成功、途中の検証失敗で後続の `run` が呼ばれない（非空虚）、失敗したステップ名と検証エラー、ステップ間で出力が次の入力になる、`validate` なしのステップ、中断を先に足す
  _Boundary:_ `packages/ai-core/src/workflows/prompt-chaining.ts`, `packages/ai-core/src/workflows/prompt-chaining.test.ts`
  _Depends:_ 16.1
  _Requirements:_ 3.1, 3.2, 3.13
  _Traces:_ REQ-003, C11
- [ ] 16.3 (P) `workflows/routing.ts`: `route({ input, categories, classify, handlers, fallback })`（`classify` は `{ category; reason }` を返す。事前定義の分類に無ければ `fallback` を実行して `matched: false`。結果は `{ category; reason; matched; output }`）と `classifyWithModel`（`generateValidated`、分類は `z.enum`）+ `routing.test.ts` に、分類どおりのハンドラの実行、分類結果と理由の返却、未知の分類でフォールバック（`matched: false`、他のハンドラは呼ばれない）、`classifyWithModel` のスキーマ違反の再生成を先に足す
  _Boundary:_ `packages/ai-core/src/workflows/routing.ts`, `packages/ai-core/src/workflows/routing.test.ts`
  _Depends:_ 16.1, 3.2
  _Requirements:_ 3.1, 3.3, 3.4, 3.13
  _Traces:_ REQ-003, C11
- [ ] 16.4 `workflows/model-tier.ts`: `resolveTiers(gateway)`（`MODEL_TIERS` からゲートウェイ経由で軽量・高性能の 2 モデルを解決する。ワークフロー関数でゲートウェイを呼ぶのはここだけ）と `routeByDifficulty({ input, tiers, classifyDifficulty, run })`（難度を分類し、`tiers.light`/`tiers.capable` のどちらかで実行する。結果に `tier`、`modelId`、`displayName`、`distinct`（2 ティアが別モデルか）、`usage` を含む。CL-10）+ `model-tier.test.ts` に、難度に応じた振り分け先、結果のモデル名とトークン使用量、2 ティアが同じモデルのとき `distinct: false` で続行、`mock` での解決を先に足す
  _Boundary:_ `packages/ai-core/src/workflows/model-tier.ts`, `packages/ai-core/src/workflows/model-tier.test.ts`
  _Depends:_ 2.2, 16.3
  _Requirements:_ 3.12
  _Traces:_ REQ-003, C11
- [ ] 16.5 (P) `workflows/parallelization.ts`: `parallelSections({ sections, run, limits, signal })`（並列実行して順序どおりに全結果を返す。1 つでも失敗したら他を中断し、失敗した区画名を含む `WorkflowStepError` を投げる。区画数は `maxSections` まで）と `parallelVote({ task, votes, run, normalize, signal })`（`votes` 既定 3・上限 `maxVotes` 回を並列に実行し、`{ outcome: "majority"; conclusion; tally; ballots } | { outcome: "tie"; tiedLabels; tally; ballots }`。**最多票が同数のときは特定の結論を選ばない**）+ `parallelization.test.ts` に、並列に開始される（全区画が開始されてから完了する）、順序の維持、1 区画の失敗で他が中断され区画名がエラーに入る、区画数の上限超過の拒否、多数決の集計と内訳、同数で `tie` かつ結論を持たない（非空虚: 最初の票を選ぶ実装だと落ちる）、`normalize` による票の正規化、`votes` の上限超過を先に足す
  _Boundary:_ `packages/ai-core/src/workflows/parallelization.ts`, `packages/ai-core/src/workflows/parallelization.test.ts`
  _Depends:_ 16.1
  _Requirements:_ 3.1, 3.5, 3.6, 3.13
  _Traces:_ REQ-003, C11
- [ ] 16.6 (P) `workflows/orchestrator-workers.ts`: `orchestrate({ task, planner, worker, synthesize, limits, signal })`（計画 — サブタスクを実行時に決定。`generateValidated`、件数は `.min(1).max(maxSubtasks)` — → ワーカーへ並列委譲 → 統合。結果は `{ subtasks, results: { subtask; status: "completed" | "failed"; output? }[], synthesis }`。一部のワーカーが失敗しても残りで統合し、全件が失敗したら `WorkflowStepError`）+ `orchestrator-workers.test.ts` に、サブタスクが入力に応じて動的に変わる（2 種類のタスクで件数が違う）、ワーカーの並列実行、一部失敗でも残りで統合し失敗が結果に含まれる、全件失敗で `WorkflowStepError`、サブタスク数の上限超過で再生成、中断を先に足す
  _Boundary:_ `packages/ai-core/src/workflows/orchestrator-workers.ts`, `packages/ai-core/src/workflows/orchestrator-workers.test.ts`
  _Depends:_ 16.1, 3.2
  _Requirements:_ 3.1, 3.7, 3.13
  _Traces:_ REQ-003, C11
- [ ] 16.7 `workflows/evaluator-optimizer.ts`: `evaluateAndOptimize({ task, generate, evaluators, passScore, maxIterations, signal })`（各評価器を `parallelSections` で並列に実行し、統合スコア = 評価器ごとのスコアの最小値。**合格はコードがスコアと基準を比べて判定する**（LLM の自己申告を使わない）。履歴 `{ iteration; output; scores: { evaluator; score; feedback }[]; combinedScore }[]`。結果は `{ final; passed; iterations; history; bestIteration }`。合格しなければ最高スコアの生成物（同点は最も早い反復。CL-4）を返して `passed: false`。評価器が 1 つでも失敗したら `output-invalid`（スコアを推測で補わない）。反復回数は `maxIterationsCap` まで）と `createModelEvaluator({ name, rubric, model })`（スコアは 0〜100 の整数を `generateValidated` で検証）+ `evaluator-optimizer.test.ts` に、合格基準に達した時点で止まる（既定 85 点）、最大反復（既定 3）で止まり `passed: false`、最高スコアの選択と同点で最初の反復（非空虚）、統合スコアが最小値（非空虚: 平均だと落ちる）、評価器の並列実行、合格判定がコードであること（評価器が「合格」と言っても基準未満なら続ける）、履歴の中身、評価器の失敗、スコアが 0〜100 の整数でないときの再生成、上限超過の拒否を先に足す
  _Boundary:_ `packages/ai-core/src/workflows/evaluator-optimizer.ts`, `packages/ai-core/src/workflows/evaluator-optimizer.test.ts`
  _Depends:_ 16.5, 3.2
  _Requirements:_ 3.1, 3.8, 3.9, 3.10, 3.11, 3.13
  _Traces:_ REQ-003, C11
- [ ] 16.8 `workflows/index.ts`: `@platform/ai-core/workflows` の公開 API の初期版（5 パターン、`resolveTiers`、`assertWithinLimit`、`WorkflowStepError`、型）。`runWorkflowDemo` は 18.3 が足す
  _Boundary:_ `packages/ai-core/src/workflows/index.ts`
  _Depends:_ 16.2, 16.3, 16.4, 16.5, 16.6, 16.7
  _Requirements:_ 3.1
  _Traces:_ REQ-003, C11
  _Verify:_ `mise run typecheck` が成功し、`apps/web` から `@platform/ai-core/workflows` を import できる。plan「後続 spec への契約」の `evaluateAndOptimize`、`createModelEvaluator`、`parallelVote`、`orchestrate` がすべて公開されている

### Implementation Notes

<!-- Empty at generation. Implementer appends 1-3 bullet learnings after completing this major task. -->

---

## 17. エージェントデザインパターン（C12）

18 パターンのうち主要な 6 つを、独立して呼び出せる関数として提供する。Role-Based Cooperation だけが `ToolLoopAgent`
（`createGuardedAgent` 経由）を使い、`patterns/` で唯一 `agents/` を import してよいファイルである。

_Boundary:_ `packages/ai-core/src/patterns/passive-goal-creator.ts`, `packages/ai-core/src/patterns/passive-goal-creator.test.ts`, `packages/ai-core/src/patterns/prompt-optimizer.ts`, `packages/ai-core/src/patterns/prompt-optimizer.test.ts`, `packages/ai-core/src/patterns/single-path-plan.ts`, `packages/ai-core/src/patterns/single-path-plan.test.ts`, `packages/ai-core/src/patterns/multi-path-plan.ts`, `packages/ai-core/src/patterns/multi-path-plan.test.ts`, `packages/ai-core/src/patterns/reflection.ts`, `packages/ai-core/src/patterns/reflection.test.ts`, `packages/ai-core/src/patterns/role-based-cooperation.ts`, `packages/ai-core/src/patterns/role-based-cooperation.test.ts`, `packages/ai-core/src/patterns/index.ts`
_Depends:_ 2.1, 2.2, 3.2, 16.1, 16.5, 16.7
_Requirements:_ 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7
_Traces:_ REQ-004, C12

- [ ] 17.1 (P) `patterns/passive-goal-creator.ts`: `createPassiveGoal({ model, instruction, signal })` → `GoalSpec { objective; constraints; successCriteria; missingInformation; clarifyingQuestions }`。情報が不足するとき `missingInformation` と `clarifyingQuestions` が空でないことを `generateValidated` の追加検証で保証する + `passive-goal-creator.test.ts` に、十分な指示で目的・制約・成功基準が揃う、曖昧な指示で不足項目と確認用の質問が返る、不足ありなのに質問が空のとき再生成、3 回失敗で `output-invalid` を先に足す
  _Boundary:_ `packages/ai-core/src/patterns/passive-goal-creator.ts`, `packages/ai-core/src/patterns/passive-goal-creator.test.ts`
  _Depends:_ 3.2
  _Requirements:_ 4.1, 4.2
  _Traces:_ REQ-004, C12
- [ ] 17.2 (P) `patterns/prompt-optimizer.ts`: `optimizePromptOrResponse({ model, target: "prompt" | "response", original, goal })` → `{ original; improved; reasons }`（`reasons` は空にならない）+ `prompt-optimizer.test.ts` に、改善前後と理由の返却、`target` ごとのプロンプトの違い、理由が空のとき再生成を先に足す
  _Boundary:_ `packages/ai-core/src/patterns/prompt-optimizer.ts`, `packages/ai-core/src/patterns/prompt-optimizer.test.ts`
  _Depends:_ 3.2
  _Requirements:_ 4.1, 4.3
  _Traces:_ REQ-004, C12
- [ ] 17.3 (P) `patterns/single-path-plan.ts`: `planSinglePath({ planner, executor, goal, limits })` → `{ steps; results: { step; output }[] }`（ステップ数は `.max(maxPlanSteps)`。順に実行し、前のステップの結果を次に渡す）+ `single-path-plan.test.ts` に、順序どおりの実行（並列でない）、ステップごとの結果、ステップ数の上限超過で再生成、実行中の失敗で後続を実行しない、中断を先に足す
  _Boundary:_ `packages/ai-core/src/patterns/single-path-plan.ts`, `packages/ai-core/src/patterns/single-path-plan.test.ts`
  _Depends:_ 16.1, 3.2
  _Requirements:_ 4.1, 4.4
  _Traces:_ REQ-004, C12
- [ ] 17.4 `patterns/multi-path-plan.ts`: `planMultiPath({ planner, evaluator, goal, candidates, limits })` → `{ candidates; evaluations; selectedIndex; reason }`（候補数は既定 3・上限 `maxCandidates`。候補を `parallelSections` で並列に生成し、評価器が選ぶ。評価器の選択が範囲外なら再生成）+ `multi-path-plan.test.ts` に、既定で 3 候補、候補の並列生成、評価器が選んだ計画と理由、全候補の評価結果、候補数の上限超過の拒否、1 候補の生成失敗を先に足す
  _Boundary:_ `packages/ai-core/src/patterns/multi-path-plan.ts`, `packages/ai-core/src/patterns/multi-path-plan.test.ts`
  _Depends:_ 16.5, 16.7
  _Requirements:_ 4.1, 4.5
  _Traces:_ REQ-004, C12
- [ ] 17.5 `patterns/reflection.ts`: `reflect({ mode: "self" | "cross", generator, critic, task, maxIterations, signal })` → `{ final; history: { iteration; output; critique; revised }[]; generatorModelId; criticModelId }`（批評と修正を最大反復回数（既定 3）まで繰り返す。`cross` は `critic.entry.id !== generator.entry.id` を要求し、満たさなければ実行前に `invalid-request`。CL-5）+ `reflection.test.ts` に、`self` の反復と履歴、`cross` で批評側が別のカタログ ID であること、`cross` で同一モデルを拒否し LLM を呼ばない（非空虚）、反復回数の上限（既定 3、`maxIterationsCap` 超過を拒否）、批評が「修正不要」のとき早期に終わるかどうかの仕様に沿った動作、`mock` の `judge`（`mock:judge-v1`）を批評側に使えることを先に足す
  _Boundary:_ `packages/ai-core/src/patterns/reflection.ts`, `packages/ai-core/src/patterns/reflection.test.ts`
  _Depends:_ 2.2, 16.7
  _Requirements:_ 4.1, 4.6
  _Traces:_ REQ-004, C12
- [ ] 17.6 (P) `patterns/role-based-cooperation.ts`: `cooperateByRole({ roles, task, budget, clock, signal })` → `{ outputs: { role; output; run: AgentRunSummary }[]; final; stopped?: "budget-exhausted" | StopReason }`。役割（例: リサーチャー、コーダー、レビュアー。上限 `maxRoles`）ごとに `createGuardedAgent` を 1 回生成して順に作業を受け渡す。全役割で合計トークンの上限（既定 `AGENT_MAX_TOTAL_TOKENS`）を共有し、各役割には残りを `limits.maxTotalTokens` として渡す（CL-8）。残りが尽きたら次の役割を実行せず `stopped: "budget-exhausted"` とそれまでの出力を返す。役割の停止理由が `error`/`aborted`/`timeout` のときも次へ進まない。`patterns/` で唯一 `agents/` を import してよいファイル + `role-based-cooperation.test.ts` に、役割ごとに `createGuardedAgent` が 1 回ずつ呼ばれる、前の役割の出力が次の入力に入る、役割ごとの出力と最終成果物、共有予算の枯渇で後続を実行しない（非空虚）、各役割に「残り」が渡る、停止理由による打ち切り、役割数の上限超過の拒否を先に足す（`mock` モデルで検証）
  _Boundary:_ `packages/ai-core/src/patterns/role-based-cooperation.ts`, `packages/ai-core/src/patterns/role-based-cooperation.test.ts`
  _Depends:_ 2.1
  _Requirements:_ 4.1, 4.7
  _Traces:_ REQ-004, C12
- [ ] 17.7 `patterns/index.ts`: `@platform/ai-core/patterns` の公開 API の初期版（6 パターンと型、`cooperateByRole` の共有予算。`runPatternDemo` は 18.4 が足す）
  _Boundary:_ `packages/ai-core/src/patterns/index.ts`
  _Depends:_ 17.1, 17.2, 17.3, 17.4, 17.5, 17.6
  _Requirements:_ 4.1
  _Traces:_ REQ-004, C12
  _Verify:_ `mise run typecheck` が成功し、`apps/web` から `@platform/ai-core/patterns` を import できる。`mise run check:repo-rules` の `guarded-agent-only` が成功する（`new ToolLoopAgent` を書いていない）

### Implementation Notes

<!-- Empty at generation. Implementer appends 1-3 bullet learnings after completing this major task. -->

---

## 18. シナリオとデモの合成（C15、C11、C12）

`mock` のシナリオと、HTTP・画面から呼ぶ名前ごとの固定の合成を作る。各デモ合成の LLM 呼び出しの最大回数を算出してテストで固定し、
`live` でのレート制限（429）に加えて費用を抑える（plan C13「ワークフロー API の呼び出し回数」）。

_Boundary:_ `packages/ai-core/fixtures/scenarios/m2-3.ts`, `packages/ai-core/fixtures/scenarios/m2.test.ts`, `packages/ai-core/src/mock/index.ts`, `packages/ai-core/src/models/gateway.ts`, `packages/ai-core/src/models/gateway.test.ts`, `packages/ai-core/fixtures/scenarios/m2-4.ts`, `packages/ai-core/src/workflows/demos.ts`, `packages/ai-core/src/workflows/demos.test.ts`, `packages/ai-core/src/workflows/index.ts`, `packages/ai-core/src/patterns/demos.ts`, `packages/ai-core/src/patterns/demos.test.ts`, `packages/ai-core/src/patterns/index.ts`
_Depends:_ 14.2, 16.8, 17.7
_Requirements:_ 3.1, 3.2, 3.3, 3.5, 3.6, 3.7, 3.8, 3.12, 3.13, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7
_Traces:_ REQ-003, REQ-004, C11, C12, C15

- [ ] 18.1 `fixtures/scenarios/m2-3.ts`: 5 ワークフローのシナリオ（`prompt-chaining`（アウトライン → 本文。本文の検証に失敗するケースを含む）、`routing`、`model-routing`、`parallel-sectioning`、`parallel-voting`（多数決と同数の 2 通り）、`orchestrator-workers`、`evaluator-optimizer`（不合格 → 改善 → 合格、未合格のまま最大反復の 2 通り））を `fixture:` マーカーで照合する形で作る。シナリオ ID は `m2-3/...`。`models/gateway.ts` の `mock` 既定シナリオに足し、`mock/index.ts` から `M2_3_SCENARIOS` を再エクスポートする + `m2.test.ts` に、曖昧な一致の検出と全 `fixture:` マーカーの網羅に M2-3 を足し、`gateway.test.ts` に M2-3 が一致することを先に足す
  _Boundary:_ `packages/ai-core/fixtures/scenarios/m2-3.ts`, `packages/ai-core/fixtures/scenarios/m2.test.ts`, `packages/ai-core/src/mock/index.ts`, `packages/ai-core/src/models/gateway.ts`, `packages/ai-core/src/models/gateway.test.ts`
  _Depends:_ 14.2, 16.8
  _Requirements:_ 3.2, 3.3, 3.5, 3.6, 3.7, 3.8, 3.12
  _Traces:_ REQ-003, C15
- [ ] 18.2 `fixtures/scenarios/m2-4.ts`: 6 パターンのシナリオ（`passive-goal-creator`（十分な指示と曖昧な指示）、`prompt-response-optimizer`、`single-path-plan`、`multi-path-plan`、`self-reflection`、`cross-reflection`（`mock:judge-v1` が批評）、`role-based-cooperation`（ツール呼び出しを含む役割ごとの流れ））を作る。シナリオ ID は `m2-4/...`。`gateway.ts` と `mock/index.ts` に足し、`M2_4_SCENARIOS` を再エクスポートする + `m2.test.ts` に M2-4 の曖昧な一致の検出と `fixture:` マーカーの網羅を、`gateway.test.ts` に M2-4 の一致を先に足す
  _Boundary:_ `packages/ai-core/fixtures/scenarios/m2-4.ts`, `packages/ai-core/fixtures/scenarios/m2.test.ts`, `packages/ai-core/src/mock/index.ts`, `packages/ai-core/src/models/gateway.ts`, `packages/ai-core/src/models/gateway.test.ts`
  _Depends:_ 17.7, 18.1
  _Requirements:_ 4.2, 4.3, 4.4, 4.5, 4.6, 4.7
  _Traces:_ REQ-004, C15
- [ ] 18.3 `workflows/demos.ts`: `runWorkflowDemo(name, deps, input)`（`prompt-chaining`/`routing`/`model-routing`/`parallel-sectioning`/`parallel-voting`/`orchestrator-workers`/`evaluator-optimizer` の名前ごとの固定の合成。`name` は閉じた語彙で、`options` は名前ごとの `z.strictObject`。上限を超える値は `invalid-request`）を作り、`workflows/index.ts` から公開する + `demos.test.ts` に、各名前が `mock` のシナリオで完走して結果の型どおりに返る、**各合成の LLM 呼び出しの最大回数**（上限の積。例: Evaluator-Optimizer は反復 × 評価器 + 生成）が上限どおりで、上限を超える `options` を拒否する、未知の名前の拒否を先に足す
  _Boundary:_ `packages/ai-core/src/workflows/demos.ts`, `packages/ai-core/src/workflows/demos.test.ts`, `packages/ai-core/src/workflows/index.ts`
  _Depends:_ 18.1, 16.8
  _Requirements:_ 3.1, 3.13
  _Traces:_ REQ-003, C11
- [ ] 18.4 `patterns/demos.ts`: `runPatternDemo(name, deps, input)`（`passive-goal-creator`/`prompt-response-optimizer`/`single-path-plan`/`multi-path-plan`/`self-reflection`/`cross-reflection`/`role-based-cooperation` の名前ごとの固定の合成。`role-based-cooperation` のデモだけは `role-based-cooperation.ts` のエクスポートを経由して呼び、`demos.ts` 自身は `agents/` を import しない）を作り、`patterns/index.ts` から公開する + `demos.test.ts` に、各名前の完走、最大呼び出し回数、`cross-reflection` が `AI_MODEL_JUDGE` 未設定の構成（同一 ID）で `invalid-request` になること、`demos.ts` が `agents/` を import していないこと、上限超過の拒否を先に足す
  _Boundary:_ `packages/ai-core/src/patterns/demos.ts`, `packages/ai-core/src/patterns/demos.test.ts`, `packages/ai-core/src/patterns/index.ts`
  _Depends:_ 18.2, 17.7
  _Requirements:_ 4.1, 4.6
  _Traces:_ REQ-004, C12
  _Verify:_ `mise run check:repo-rules --only workflow-no-agent-loop`（ローカルで実行）が `demos.ts` を許可せず、`role-based-cooperation.ts` だけを許可して成功する

### Implementation Notes

<!-- Empty at generation. Implementer appends 1-3 bullet learnings after completing this major task. -->

---

## 19. ワークフローの HTTP 入口と W4 の締め（C13、C17）

`POST /api/workflows` を既存の検査順で提供する。Route Handler は `runWorkflowDemo`/`runPatternDemo` を呼ぶだけにする。

_Boundary:_ `apps/web/app/api/workflows/route.ts`, `apps/web/app/api/workflows/route.test.ts`, `mise.toml`, `stryker.config.mjs`
_Depends:_ 4.4, 15.5, 16.8, 17.7, 18.3, 18.4
_Requirements:_ 3.1, 3.13, 4.1
_Traces:_ REQ-003, REQ-004, C13, C17

- [ ] 19.1 `app/api/workflows/route.ts`: `{ kind: "workflow" | "pattern"; name; task（1〜4000 文字）; options? }` を `z.strictObject` で検査し、`runWorkflowDemo`/`runPatternDemo` を呼んで JSON `{ name; result; usage }` を返す。`options` が上限を超える値は 400 `invalid-request`、モデルの出力不正は 502 `output-invalid`、接続不能は 503、`live` のみ 429。`request.signal` を伝播する + `route.test.ts` に、検査順（413 → 400 → 400 → `live` のみ 429）、`kind` と `name` の組み合わせの検証、各名前が `mock` で完走する、上限超過の拒否、`output-invalid` のコード、中断を先に足す
  _Boundary:_ `apps/web/app/api/workflows/route.ts`, `apps/web/app/api/workflows/route.test.ts`
  _Depends:_ 18.3, 18.4
  _Requirements:_ 3.1, 4.1
  _Traces:_ REQ-003, REQ-004, C13
- [ ] 19.2 **W4 の締め**: `mise.toml` の `check:repo-rules` の `--only` に `workflow-no-agent-loop` を足し、`stryker.config.mjs` の `mutate` に `workflows/parallelization.ts`、`workflows/evaluator-optimizer.ts` を足す。**先に確かめること**: `workflows/` の任意のファイルに `ToolLoopAgent` の import を一時的に足すと `mise run check:repo-rules` が失敗し、`patterns/role-based-cooperation.ts` だけが許可されることを実リポジトリで確認して戻す。`mise run test:mutation` が閾値 70 を、`mise run gate` が成功することを確かめ、所要時間を Implementation Notes に記録する（予算 5 分）
  _Boundary:_ `mise.toml`, `stryker.config.mjs`
  _Depends:_ 4.4, 15.5, 16.8, 17.7, 19.1
  _Requirements:_ 3.13
  _Traces:_ REQ-003, C17
  _Verify:_ `mise run gate`（`check:repo-rules` の出力に `workflow-no-agent-loop: scanned N FILES`、N ≥ 1）と `mise run test:mutation` が成功する。違反例で規則が失敗することの確認を Implementation Notes に記録する 波の敵対的レビュー（憲章 原則 9。新規コンテキストで `sdd-reviewer`）を行い、記録 `.sdd/reviews/002-rag-and-workflows-impl-w4-review-YYYY-MM-DD.md` が存在し、指摘への対応が追記されていることを確かめる（波の移行条件 3）

### Implementation Notes

<!-- Empty at generation. Implementer appends 1-3 bullet learnings after completing this major task. -->
