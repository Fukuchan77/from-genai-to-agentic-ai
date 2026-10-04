# Task 11 独立 VDD 敵対的レビュー — 2026-09-28

## Review Scope

- Risk trigger: `packages/ai-core/vitest.config.ts` が Task 11 の `_Boundary:_` 外で変更された。
- Reviewed: `specs/001-agentic-ai-platform/{spec.md,plan.md,tasks.md}` の Req 1.13/1.14・C18・Task 11、`.sdd/steering/*.md`、作業ツリーの全差分、Task 11 実装・テスト、`global-setup-local.ts`、`gate-reporter.ts`、AI SDK v7.0.113 の V4 provider contract。
- Prior reviews: Task 6/7 および W1 review の C18・global setup 関連記録を確認した。Task 11 の先行レビューは存在しなかった。

## Verification Evidence

- `mise run gate`: exit 0。Biome 63 files、model ID 46 files、repository rules は全件非空。ai-core は 8 files / 52 passed / 0 skipped、root は 257 passed、ai-core line coverage 96.02%。Turborepo の既存 cache replay だが、ログには Task 11 の6テストを含む現在の52件が記録されている。
- Task 11 targeted test: 2 files / 6 passed。
- declaration emit probe: `tsc --declaration --emitDeclarationOnly` 成功。`@platform/ai-core/testing` の公開宣言に `any` はない。
- AI SDK integration probe: 公開 barrel の factory を `generateText`、`streamText`、`Output.object`、tool parsing 経由で実行し、3/3 passed。
- 実 Vitest integration probe:
  - unavailable: 2 tests が理由 `Local tests require AI_TEST_RUN_MODE=local.` 付きで skip され、gate reporter も同理由を2件集計した。
  - available: 同じ2 tests が実行され、2/2 passed。
- 上記プローブは `/tmp` にのみ作成し、リポジトリの実装コードは変更していない。

## Contract Assessment

1. **MockLanguageModelV4 factory**: `doGenerate` と `doStream` は V4 の content、finish reason、usage、stream part contract に適合する。tool call の `input` は JSON 文字列として供給され、AI SDK の tool parsing で元のオブジェクトへ復元された。object factory も `Output.object` で正常に検証・復元された。
2. **`describeLocal` / `itLocal`**: unavailable 時の理由付き skip と available 時の実行は、独立した実 Vitest probe では成立した。
3. **global setup**: mock/gate 時はネットワークを呼ばず unavailable context を提供し、`local` 時だけ Ollama を最大2秒で probe するため、副作用の範囲は C18 と一致する。ai-core config への登録自体は機能上必要である。
4. **public API types**: factory は `MockLanguageModelV4`、tool input は `JSONValue`、local helper は型付き callback を公開し、明示的・推論上の `any` はない。
5. **tests**: factory tests は指定値を独立した期待値で検証しており tautology ではない。一方、local helper と config の結線には恒久的な回帰テスト上の穴がある。

## Critique

### [MEDIUM] Task 11 の境界外変更が正式な task boundary に反映されていない
**Location**: `packages/ai-core/vitest.config.ts:24`; `specs/001-agentic-ai-platform/tasks.md:309-322`
**Issue**: `globalSetup` の追加は機能上妥当だが、Task 11 と 11.1/11.2 の `_Boundary:_` に `packages/ai-core/vitest.config.ts` がなく、adversarial-review の境界規則が求める正式な計画更新なしに完了扱いになっている。
**Evidence**: Task 11 の境界は `src/testing/` の5ファイルだけを列挙する一方、実 diff は `packages/ai-core/vitest.config.ts` に `globalSetup: ["../../tooling/vitest/global-setup-local.ts"]` を追加している。追加された Implementation Notes は逸脱の説明ではあるが `_Boundary:_` 自体を変更していない。また、完了済み Task 6.2 は `setup-hermetic` と `gate-reporter` の登録だけを明記しており、Task 11 が Task 6 の成果物を遡及変更できる記述ではない。
**Confidence**: high
**Fix**: Task 11（および所有する subtask 11.2）の `_Boundary:_` に `packages/ai-core/vitest.config.ts` を追加し、plan C18/File Structure の ai-core Vitest config の責務にも `global-setup-local` 登録を明記する。あるいは独立した prerequisite-fix task として記録し、その task の boundary と検証を与える。

### [MEDIUM] `globalSetup` と公開 local helper の実結線を恒久テストが検証していない
**Location**: `packages/ai-core/src/testing/local-only.test.ts:13-69`; `packages/ai-core/vitest.config.ts:24`
**Issue**: Req 1.14 が要求する「実行できない場合は理由を示してスキップ」と Task 11.2 の「不可なら理由付きでスキップ、可なら実行」は registrar stub だけで検証され、公開 `describeLocal` / `itLocal`、`inject("localAvailability")`、global setup、Vitest result note の結線はテストされていない。
**Evidence**: `local-only.test.ts` は `createLocalTestApi()` に手製 registrar と `skip` spy を渡している。公開された `describeLocal` / `itLocal` はどのテストからも呼ばれず、`vitest.config.ts` から `globalSetup` 行を削除しても現在の Task 11 テストは通り得る。PDCA の PROVE も helper 内部の `context.skip(reason)` 削除を壊しているだけで、config 結線や reporter の reason 集計を壊していない。独立 probe では実挙動が正しいことを確認できたため現時点の実装バグではないが、今回の risk trigger そのものを回帰検出できない。
**Confidence**: high
**Fix**: fixture 用 Vitest project/config を恒久化し、(a) unavailable context で公開 helper の test が指定理由付き skip となること、(b) available context で body が実行されること、(c) ai-core config が `global-setup-local.ts` を登録していること、の少なくとも3点を検証する。reporter まで含めるなら skip note が `skippedByReason` に入ることも assertion する。

### [LOW] `itLocal` の公開 callback 型が Vitest の通常の test context を過度に狭めている
**Location**: `packages/ai-core/src/testing/local-only.ts:8-20,47-51`
**Issue**: `itLocal` は実行時には Vitest の完全な context を渡すが、公開型は `skip(reason)` しか持たない独自 `LocalTestContext` なので、`it` の代替として `context.expect`、`onTestFinished`、`signal` などを利用できない。
**Evidence**: declaration emit は `itLocal(name: string, test: (context: LocalTestContext) => unknown): void` を生成し、`LocalTestContext` は `skip(reason: string): void` だけを宣言する。実 adapter は Vitest context をそのまま `test(context)` へ渡しているため、型と実値の能力が一致していない。
**Confidence**: medium
**Fix**: Vitest が公開する `TestContext` / test callback 型を利用し、必要なら `Pick` ではなく通常の Vitest callback と互換な型を公開する。意図的に `skip` だけへ制限する設計なら、API コメントと plan にその制限を明記する。

## Verdict

REQUEST_CHANGES

境界外変更そのもののランタイム挙動は妥当で、factory と local helper の contract も独立 probe では成立した。しかし、境界を正式に更新しておらず、その境界外変更が欠落しても恒久テストが検出しないため、Task 11 を完了として承認できない。boundary の正式化と実 Vitest 結線テストの追加後に再レビュー可能である。

## Hallucination Signal

forced: false

---

## Round 2 — 2026-09-28

### Review Scope

先行 Round 1 の3 finding（boundary 未反映、実 Vitest 結線テスト不足、callback 型が狭い）に限定して、`specs/001-agentic-ai-platform/{plan.md,tasks.md,pdca/do.md}`、`packages/ai-core/src/testing/*`、`packages/ai-core/vitest.config.ts`、現在の作業ツリー差分を再確認した。実装コードへの変更は行っていない。

### Verification Evidence

- Targeted: `AI_TEST_RUN_MODE=mock AI_TEST_SUITE=gate mise exec -- pnpm --filter @platform/ai-core exec vitest run src/testing/mock-models.test.ts src/testing/local-only.test.ts --coverage.enabled=false` → exit 0、2 files、7 passed / 2 skipped。`gate-reporter` は `Local tests require AI_TEST_RUN_MODE=local.` を2件集計した。
- Typecheck: `mise run typecheck` → exit 0、4/4 successful。
- Main session evidence: `mise run gate` exit 0（ai-core 53 passed、2 skipped with reason、lines 98.01%、root 257 passed）を確認資料として採用した。

### Finding Resolution

1. **Boundary 未反映 — 解消**
   - Task 11 と 11.2 の `_Boundary:_` に `packages/ai-core/vitest.config.ts` が追加された。
   - plan の C18 と File Structure Plan に、ai-core Vitest config が `global-setup-local` を登録する責務が明記された。

2. **実 Vitest 結線テスト不足 — 解消**
   - `local-only.test.ts` が公開 `describeLocal` / `itLocal` を実 Vitest 上で登録し、注入された unavailable context により理由付き skip となることを恒久的に検証する。
   - 同テストが ai-core config の `globalSetup` 登録を直接検査するため、登録行の欠落を回帰検出できる。
   - available 分岐は `createLocalTestApi` の決定的テストで body 実行を検証し、公開 helper の test body 自体も local availability が成立する実行では通常実行される構成になっている。今回の targeted 実行では unavailable 分岐と reporter の理由集計を実測した。

3. **Callback 型が狭い — 解消**
   - 公開 API は Vitest の `SuiteFactory` / `TestFunction` を採用し、内部 registrar は `TestContext` を受け取る。
   - wrapper は suite の `TestAPI` と test の完全な context を callback へ転送する。integration test も callback の型付き `localIt` / `expect` を使用し、`mise run typecheck` が成功した。

## Round 2 Critique

解消を妨げる新規 finding はない。先行3 finding はすべて、差分・恒久テスト・targeted 実行・型検査の証拠により解消済みと判定する。

## Round 2 Verdict

APPROVE

## Round 2 Hallucination Signal

forced: true
