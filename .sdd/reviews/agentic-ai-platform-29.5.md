# Adversarial Review: Task 29.5 (Ollama `num_ctx` shared across chat, agent, summary)

- Date: 2026-10-12
- Scope: uncommitted working tree on `feat/w4-apps-web` (`git diff HEAD` + untracked `packages/ai-core/src/models/runtime-options{,.test}.ts`)
- Requirements: 1.5, 3.3 (plan C8, C11, C12, revised 2026-10-12)
- Risk trigger: boundary violation (`apps/web/app/api/chat/route.test.ts`, `apps/web/app/api/agent/tools/route.test.ts` changed, not listed in `_Boundary:_`)

## Evidence gathered

- Targeted tests: ai-core `runtime-options.test.ts` (13), `guarded-agent.test.ts` (36), `pipeline.test.ts` (28) -> 77 passed; web `chat/route.test.ts` (11), `agent/tools/route.test.ts` (17) -> 28 passed.
- `TURBO_FORCE=true mise run gate` -> exit=0, `0 cached, 4 total`; root 297, ai-core 702 (skipped 4), eval-suite 3 (skipped 1), web 305; `Docs: 4 module documents, 51 test references verified`.
- No `package.json` / lockfile change; no new third-party dependency.
- Existing tests: only additions; no existing test modified, deleted or skipped. The pre-existing `pipeline.test.ts` "Ollama context length" block (including the real `createOllama` request-body test) passes unchanged after the refactor, so it serves as a regression check for the move.
- Provider source read (`ollama-ai-provider-v2@4.0.1`, `dist/index.mjs`): `createOllama().languageModel` and `.chat` both map to `createLanguageModel` -> `OllamaResponsesLanguageModel`. `buildRequest` calls `parseProviderOptions({ provider: "ollama", schema })` (schema has `options.num_ctx`) and `buildBaseArgs` sets `options: ollamaOptions.options`; `tools` / `tool_choice` are added next to `baseArgs` without touching `options`. So chat (no tools) and agent (tools) requests build the body the same way as the summary request the pipeline test proves.
- Gateway (`models/gateway.ts:229`) builds every Ollama language model through `providers.ollama(settings).languageModel(entry.id)`. The recording wrapper (`wrapLanguageModel` + `recordingMiddleware`) does not remove `providerOptions`. `mock/request-key.ts:14` puts `providerOptions` in `OMITTED_KEYS`, so cassette keys do not change.
- Agent path: `createGuardedAgent` puts `providerOptions` into the `ToolLoopAgent` settings (`guarded-agent.ts:307`). There is no `prepareStep` that could override it, and `GuardedToolLoopAgent` only overrides `generate`. The new test uses `createAgentUIStream` (which `createAgentUIStreamResponse` wraps) over 3 steps and checks `providerOptions` on all 3 `doStream` calls. The agent route test goes through the real `POST` -> `createAgentUIStreamResponse` with a real `createGuardedAgent`; the `vi.mock` only records the call and passes it on to the original.
- Embedding path: `resolveEmbedding` / `embeddingModel` are unchanged, and no embedding call site uses `ollamaRuntimeOptions`. Not affected.

## Trigger resolution: explained away (convention-conformant; the boundary text is the defect)

`tasks.md:55-56` says: "実装を含むサブタスクは、対応するテストファイルを同じ `_Boundary:_` に含み、RED → GREEN → REFACTOR を1つのサブタスクの中で行う". 29.5 includes implementation in both `route.ts` files, so their sibling `route.test.ts` files belong to the task by convention. The declared boundary leaves them out by mistake. The ai-core side is already covered by globs (`models/**`, `agents/**`). `summarize/pipeline.test.ts` is listed literally as `pipeline.ts` only, but it was not modified. The test changes are additive (one `it.each` each) and do not touch other behavior. The `specs/` changes (`tasks.md` Notes, `pdca/do.md`) are progress records, which every task writes. Residual: the `_Boundary:_` line should name the two `route.test.ts` files (LOW, below).

## Critique

### [MEDIUM] Verify criterion "load_duration < 100 ms on real Ollama when calls alternate" is unmet
**Location**: specs/001-agentic-ai-platform/tasks.md:340, :348
**Issue**: The task's `_Verify:_` requires a measurement on real Ollama that has not been done, so 29.5 cannot be marked complete. The task is correctly left `- [ ]` and the gap is recorded honestly.
**Evidence**: `_Verify:_ ... 実 Ollama で交互に呼んでも load_duration が 100 ms 未満であること（29.2 と同じ手順）を確認する`; Notes: `**未完了**: 実 Ollama で交互に呼んだときの load_duration < 100 ms の確認（このセッションでは Ollama への接続が許可されなかった）`
**Confidence**: high
**Fix**: A human runs the 29.2 procedure (alternate summary / chat / agent calls against granite4.2, read `load_duration` and `ollama ps`) on this code and records the numbers in the big-task-29 Notes before checking 29.5.

### [LOW] `_Boundary:_` omits the route test files required by the tasks.md convention
**Location**: specs/001-agentic-ai-platform/tasks.md:336
**Issue**: The boundary lists `apps/web/app/api/chat/route.ts` and `apps/web/app/api/agent/tools/route.ts` but not their `route.test.ts` siblings, even though tasks.md:55 requires a subtask's test files in its boundary. This is what triggered the review.
**Evidence**: `_Boundary:_ ... apps/web/app/api/chat/route.ts, apps/web/app/api/agent/tools/route.ts` vs. tasks.md:55 `対応するテストファイルを同じ _Boundary:_ に含み`
**Confidence**: high
**Fix**: Add `apps/web/app/api/chat/route.test.ts` and `apps/web/app/api/agent/tools/route.test.ts`, and change `summarize/pipeline.ts` to `summarize/pipeline{,.test}.ts`, in the 29.5 `_Boundary:_`.

### [LOW] Nothing enforces `ollamaRuntimeOptions` at future Ollama call sites; one existing direct call already skips it
**Location**: packages/ai-core/src/models/runtime-options.ts:15; packages/ai-core/src/models/catalog.local.test.ts:29, :56
**Issue**: The shared `num_ctx` is applied by each caller spreading a helper, not by the gateway. Any new `generateText` / `streamText` on an Ollama model (M2 workflows, judge calls) silently brings back both the model reload and the server-default 4,096 truncation. `catalog.local.test.ts` already calls `generateText` on the resolved Ollama model without it.
**Evidence**: `export function ollamaRuntimeOptions(entry: ModelEntry): OllamaRuntimeOptions { if (entry.provider !== "ollama") return {}; ...}`. Plan C11 chose the helper approach ("渡す値を組み立てる関数 ollamaRuntimeOptions(entry) は models/ に1つ置き"), so this is not a spec deviation, only a gap in enforcement.
**Confidence**: medium
**Fix**: Pick one: (a) apply the value in the gateway with a `wrapLanguageModel` middleware (`transformParams` merging `providerOptions.ollama.options.num_ctx`) for Ollama entries, so callers cannot forget it; or (b) add a `check:repo-rules` rule or a note in `structure.md` "Where Things Go" requiring `...ollamaRuntimeOptions(entry)` on every LLM call. Either way, decide whether `catalog.local.test.ts` should send it too (it runs in the same `test:local` session as the summary eval).

### [LOW] Real-provider forwarding is proven only for the summary path; chat and agent rely on a mock model
**Location**: apps/web/app/api/chat/route.test.ts:304-327; apps/web/app/api/agent/tools/route.test.ts:403-427
**Issue**: The route tests check that `providerOptions` reaches `MockLanguageModelV4.doStreamCalls`, not that the real Ollama provider puts `options.num_ctx` in the request body for a call that has `tools`. Reading the provider source shows it does (`buildRequest` adds `tools` without touching `baseArgs.options`), but no test pins this for the agent path.
**Evidence**: `const model = createTextStreamModel("こんにちは。"); ... expect(model.doStreamCalls[0]?.providerOptions).toEqual(expected);`. The only body-level check is `pipeline.test.ts:392` (no tools).
**Confidence**: medium (the behavior is correct today; the risk is a provider upgrade)
**Fix**: Add one test in `guarded-agent.test.ts` (inside its boundary) that runs a `createGuardedAgent` with tools against `createOllama({ fetch })` returning 400, and asserts `bodies[0]` matches `{ options: { num_ctx } , tools: [...] }`, like `pipeline.test.ts:392`.

### [LOW] The route-level "only to Ollama" case is checked only against the mock provider, not a live provider
**Location**: apps/web/app/api/chat/route.test.ts:304-307; apps/web/app/api/agent/tools/route.test.ts:403-406
**Issue**: The non-Ollama case of the `it.each` is `["mock", "mock"]`. No route-level case uses a live entry (anthropic / openai). That case is covered at unit level by `runtime-options.test.ts` (every non-Ollama catalog entry -> `{}`) and by `pipeline.test.ts` (anthropic -> `undefined`), so the gap is small.
**Evidence**: `it.each([["local", "ollama"], ["mock", "mock"]] as const)`
**Confidence**: low
**Fix**: Optionally add a `["live", "anthropic"]` row (the entry is resolved by stubbing `gateway.resolve`, so no credentials or network are needed).

### [LOW] No test pins that chat and summary resolve to the same Ollama model / `num_ctx`
**Location**: packages/ai-core/src/models/catalog.ts:252-253; tasks.md:340 (Verify "3つの経路...が同じ num_ctx を渡す")
**Issue**: Each path asserts `num_ctx == its own entry.contextWindow`. The "no reload when alternating" goal also depends on `MODEL_DEFAULTS.local.ollama.chat` and `.structured` being the same model (both `granite4.2:latest` today), and no test asserts that equality.
**Evidence**: `chat: "granite4.2:latest", structured: "granite4.2:latest",` and the tests use `defaultModelFor(mode, provider, "chat")` (routes) vs `structuredEntry("local", "ollama")` (pipeline)
**Confidence**: low
**Fix**: Add an assertion in `runtime-options.test.ts`: `ollamaRuntimeOptions(getModelEntry(defaultModelFor("local","ollama","chat")))` equals the same call for `"structured"`. If the defaults may differ on purpose, document that the reload-free property holds only when they match.

### [LOW] Stale "known constraint" in traceability.md and no learner-facing note for chat/agent
**Location**: specs/001-agentic-ai-platform/traceability.md:165-166; docs/modules/1-3-structured-output-and-summaries.md:143, :395
**Issue**: traceability.md still lists constraint "(3) Ollama の num_ctx は要約の呼び出しだけに渡し、チャットとエージェントはサーバー既定のまま", which this change makes false. The module docs describe `num_ctx` only for summaries.
**Evidence**: traceability.md:166 `(3) Ollama の num_ctx は要約の呼び出しだけに渡し、チャットとエージェントはサーバー既定のまま。`
**Confidence**: high (outside the 29.5 boundary; normally updated at `/sdd-ship`)
**Fix**: Update traceability (3)/(4) at ship time. Optionally add one sentence to the module 1-2 doc (chat/agent) about the shared `num_ctx` and its memory cost (about 10 GB resident vs about 6 GB).

### [LOW] `ollamaRuntimeOptions` accepts embedding entries and would return `num_ctx: 2048` for them
**Location**: packages/ai-core/src/models/runtime-options.ts:15-18; packages/ai-core/src/models/runtime-options.test.ts:15-23
**Issue**: The function does not separate Ollama language entries from the embedding entry (`nomic-embed-text`, `contextWindow` 2,048), and the test asserts that output for it. There is no call site today, so this does not affect behavior. It is an API-shape note only.
**Evidence**: `const ollamaEntries = entries.filter((entry) => entry.provider === "ollama");` (includes the embedding entry)
**Confidence**: low
**Fix**: None required. Optionally document "for language-model calls" in the JSDoc.

### [LOW] Unrelated task state change in the same working tree (29.2 flipped to `[x]`)
**Location**: specs/001-agentic-ai-platform/tasks.md:316, :347
**Issue**: The uncommitted diff also completes task 29.2 (checkbox plus a new offline-run note whose counts, ai-core 702 / web 305, already include the 29.5 tests). Committing both together blurs which change verified what.
**Evidence**: `-- [ ] 29.2 ...` / `+- [x] 29.2 ...`; note `root 297、ai-core 702 skipped 4、eval-suite 3 skipped 1、web 305`
**Confidence**: medium
**Fix**: Commit the 29.2 doc update separately from the 29.5 code, or say in the commit message that the offline run was made on the 29.5 tree.

## Checks with no finding

- Zero-tolerance list: no TODO/FIXME, no swallowed errors added, no O(n^2), no security anti-pattern. No hard-coded value replaces general logic (`num_ctx` comes from `entry.contextWindow`, per plan C11/C12).
- Non-vacuous: `runtime-options.test.ts` guards against zero-case parametrization ("covers both Ollama and non-Ollama catalog entries"). Expected values follow the requirement ("カタログの contextWindow を渡す"), not observed output. The guarded-agent test uses an arbitrary literal for a pass-through check and asserts `steps === 3` and 3 `doStream` calls, so the loop over calls is not empty. The route tests assert `doStreamCalls` length 1 before reading `[0]`, and `created.agents` is reset in `afterEach`. Mentally mutating the code: removing the spread in either route fails its Ollama row; sending to all providers fails the mock row; dropping the settings pass-through in `createGuardedAgent` fails the agent test and the agent route. This matches the PROVE notes.
- Requirement 1.5 (gate without API keys): the gate passes. Mock mode sends no `providerOptions`, and cassette keys ignore them.
- Requirement 3.3 (model switch keeps history): `num_ctx` is call-level, not part-level, so `adaptHistoryForModel` is unaffected. Switching to a non-Ollama model sends nothing extra.
- Dependency direction: `apps/web` imports `ollamaRuntimeOptions` from the `@platform/ai-core/models` export subpath, which is allowed.

## Verdict
APPROVE_WITH_NOTES

## Hallucination Signal
forced: false
