# Adversarial Review: 002 rag-and-workflows, Wave W4 (tasks 16.1–19.1, wave close 19.2)

- Date: 2026-10-12 (finished 2026-10-13 after a rate-limit pause)
- Scope: the uncommitted working tree on `feat/m2-w1-foundation`:
  - `git diff HEAD`: mise.toml, stryker.config.mjs, mock/index.ts, mock/m2-scenarios.test.ts, models/gateway.ts and gateway.test.ts, tasks.md
  - untracked: `packages/ai-core/src/workflows/**`, `packages/ai-core/src/patterns/**`, `fixtures/scenarios/m2-{3,4}.ts`, `apps/web/app/api/workflows/{route,route.test}.ts`
- Inputs:
  - spec.md Req 3.1–3.13 and 4.1–4.7
  - plan.md: C11, C12, C13 (including "ワークフロー API の呼び出し回数"), C15, the HTTP API table, the contract table, Error Handling, Test Strategy, CL-3/4/5/8/10
  - tasks.md sections 16–19
- Not read, as instructed: `pdca/do.md`.
- Prior reviews read: the W1, W2 and W3 impl reviews. F-1 is in the same class as W3 F-5 (provider failures misclassified), which W3 fixed for RAG only. F-2 touches a W1 decision and is tagged.

## Verdict

**REQUEST_CHANGES**. One HIGH finding (F-1). Several provider failures become `502 output-invalid` instead of `503 provider-unavailable`. A probe confirmed it, and the route tests do not catch it because they exercise only a sequential path.

Everything else holds or is MEDIUM/LOW:

- Requirement fidelity
- The no-agent-loop boundary
- Option limits enforced before the limiter and before any model call
- The `cross` same-ID refusal
- Tie and best-of semantics

## Evidence gathered

- Tests
  - `pnpm exec vitest run src/workflows src/patterns src/mock src/models` (ai-core): 28 files, 376 passed, 2 skipped (local).
  - `pnpm exec vitest run app/api/workflows` (web): 50 passed.
- Repository rules: `node scripts/check-repo-rules.mjs --only workflow-no-agent-loop,guarded-agent-only,ai-core-no-ui-deps,no-deprecated-object-api` reports `workflow-no-agent-loop: scanned 34 FILES`, and every rule passes.
- Dependencies: `git diff --stat HEAD -- package.json pnpm-lock.yaml packages/ai-core/package.json apps/web/package.json` is empty, so no new third-party dependency was added.
- Probe: a temporary file `src/workflows/zz-review-probe.test.ts` was created, run, deleted, and `git status` was confirmed unchanged afterwards. It ran `runWorkflowDemo("parallel-voting")` with a model whose `doGenerate` throws `APICallError`, and printed `PROBE WorkflowStepError output-invalid`.
- AI SDK 7.0.137 `dist/index.js` contains `maxRetries: maxRetriesArg ?? 2`. No workflow or pattern call sets `maxRetries`.
- Removed test assertions: none. The only `-` lines in the two modified test files are a widened import and the old `M2_SCENARIOS` constant, which was extended.

## Trigger resolution

- **Wave-close review (constitution principle 9, tasks 19.2, transfer condition 3)**: done. This file is the record, and the Responses section is left for the implementer.
- **Files touched outside a sub-task's `_Boundary:_`**: confirmed, judged deviation by deviation.
  1. `toStepError` and `resolveWorkflowLimits`/`WorkflowLimitOverrides`: inside the 16.1 files (`errors.ts`, `limits.ts`). This is an addition, not a boundary violation. It is justified because it keeps 400/503 codes, but it is not in plan C11, and its semantics have the gaps in F-1 and F-13.
  2. Stage labels added to `reflection.ts`, `role-based-cooperation.ts` and `evaluator-optimizer.ts` during task 18: these files belong to 16.7, 17.5 and 17.6, not to 18's boundary. The edit is benign (labels only, and tests pin them), so it is justified. It is not recorded in the 18 Implementation Notes (F-12).
  3. `generateStage`/`stageText` exported from `workflows/demos.ts` and used by `patterns/demos.ts`: the direction (patterns → workflows) is allowed by plan's diagram, and the helpers are not in the public `index.ts`. Acceptable; record it (F-12).
  4. Usage comes from a `wrapLanguageModel` ledger: acceptable, and `routeByDifficulty` still carries `usage` (Req 3.12). The ledger undercounts failed or retried calls (F-2).
  5. Japanese stage labels instead of `fixture:` markers: the tasks and plan text were not amended (F-6).
  6. Hand-written `GuardSchema`: justified. `guard.ts` documents the structural design, `apps/web` has no `zod`, and the check is strict (unknown keys, closed `kind`/`name` vocabularies, code-point task length).
- **Existing tests and scenarios extended**: `m2-scenarios.test.ts` now runs the "exactly one turn matches" check over M1 + M2-1..M2-4 and adds marker and sample coverage. `gateway.test.ts` adds positive M2-3/M2-4 matches plus a negative purpose-separation case. Nothing was weakened. One inversion is noted: the plan asks to cover all `fixture:` markers, and the test now asserts there are none (F-6).

## Focus points

1. **Requirement fidelity**
   - Req 3.1 and 4.1: independent functions for all 5 workflows and 6 patterns, exported. The contract-table symbols (`evaluateAndOptimize`, `createModelEvaluator`, `parallelVote`, `orchestrate`, `cooperateByRole`) are on the documented subpaths.
   - Req 3.2: `runPromptChain` returns `failed` with the step name and errors, and no later step runs.
   - Req 3.3 and 3.4: own-key handler lookup, and the fallback runs with `matched:false`. The demo adds an `unknown` category, so the fallback is reachable.
   - Req 3.5: ordered results; one failure aborts the others and names the section.
   - Req 3.6: a tie returns `outcome:"tie"` with no `conclusion`. The tests include "3 different votes" and "lower count ignored".
   - Req 3.7: subtasks are planned at run time (`.min(1).max(maxSubtasks)`). Workers use `allSettled`, a partial failure is tolerated, and an all-failed run raises `WorkflowStepError`.
   - Req 3.8–3.11:
     - The pass is decided in code (`combinedScore >= passScore`).
     - The combined score is `Math.min`.
     - Best-of uses strict `>`, so the earliest tie wins (CL-4). A test pins `[62,62,58]` with best = 1.
     - An unmet bar returns `passed:false`.
     - Evaluators run in parallel through `parallelSections`.
     - A failed evaluator fails the run, and no score is guessed.
   - Req 3.12: the result has `tier`, `modelId`, `displayName`, `distinct` and summed `usage`.
   - Req 3.13 and constitution 1: `workflows/` imports nothing from `agents/`, and the rule passes.
   - Req 4.2, 4.3, 4.4, 4.5: hold. See F-14 for a nuance.
   - Req 4.6 and CL-5: `cross` with the same ID, or with no critic, is rejected before any model call (non-vacuous unit test).
   - Req 4.7 and CL-8: one `createGuardedAgent` per role, and each role gets the remaining budget. See F-3 and F-4.
2. **Boundary and architecture**: no React or Next imports in ai-core. The route imports only package subpaths. Only `role-based-cooperation.ts` imports `agents/`; its test reaches it through a `vi.mock` string, which the rule does not see, and the author disclosed this. Model IDs come only from `MODEL_TIERS`/the gateway, and no dependency was added.
3. **Non-vacuous tests**: spot-checked by reading 10 tests. Each would fail against the obvious broken implementation:
   - tie → first label
   - min → average
   - `>=` in best-of
   - pass from feedback text
   - `cross` same ID
   - chain continues after a failed validation
   - fallback not run
   - budget exhaustion
   - sections started sequentially
   - option over the limit reaching the gateway

   Weak spots are in F-10. The probe found no tautology. The cost-bound tests (`llmCalls <= maxCalls`) are weak by construction (F-2).
4. **Security and safety**:
   - Option limits are enforced in `inspect` before the limiter, and again in `run*Demo` before any resolve (tested).
   - Error details carry only option paths.
   - `WorkflowStepError` carries only the step name.
   - `request.signal` is propagated, which the tests prove.
   - The cost bound ignores SDK retries (F-2).
   - Prompt data wrapping has gaps (F-5).
5. **Scenario integrity**: every M2-3/M2-4 turn is unambiguous across M1 + M2, which the test proves using minimal witnesses. Real prompts are pinned by the demo tests. Some markers are task-agnostic (`[段: 投票 n/m]`, `[段: 対応・technical]`), so any task gets a canned answer for those stages in `mock`. That is acceptable for a demo but inconsistent with the "503 when no scenario" behavior of other demos.
6. **Error mapping**: `output-invalid` → 502 and other `PlatformError`s keep their codes. Top-level AI SDK errors → fixed 503. AI SDK errors raised inside parallel or step-wrapped stages are mis-mapped to 502 (F-1). Role errors are swallowed into a 200 response (F-3).

## Findings

| ID | Severity | Location | Issue | Confidence |
|---|---|---|---|---|
| F-1 | HIGH | packages/ai-core/src/workflows/errors.ts:25-29; parallelization.ts:27; patterns/single-path-plan.ts:101; workflows/orchestrator-workers.ts:93; apps/web/app/api/workflows/route.ts:111 | Provider (AI SDK) errors inside parallel, step or worker stages become `WorkflowStepError` → 502 `output-invalid` instead of 503 | high |
| F-2 | MEDIUM | workflows/demos.ts:42-71, :146-180, :210; patterns/demos.ts:94-123; patterns/reflection.ts:74,100 | The C13 cost bound ignores the AI SDK default `maxRetries: 2`, and the ledger counts only successful calls (prior: W1 accepted the default retries for `generateValidated`; new evidence: C13 makes the count a cost bound) | medium |
| F-3 | MEDIUM | patterns/role-based-cooperation.ts:108-116 | A catch-all swallows role errors. A provider outage or client abort in role-based-cooperation returns HTTP 200 (`stopped:"error"`/`"aborted"`), not 503, unlike every other demo | medium |
| F-4 | LOW | patterns/role-based-cooperation.ts:88-125; role-based-cooperation.test.ts:184-195 | The shared budget is not a hard cap. A role may spend more than `remaining`, and the test encodes 600+600 tokens against a budget of 1000 | medium |
| F-5 | LOW | workflows/demos.ts:214, :359; every `<tag>\n${data}\n</tag>` interpolation | The user's `aspects` option goes into the instruction label outside any data tag, and data tags are never escaped, so a `</task>` in the task breaks out | medium |
| F-6 | LOW | fixtures/scenarios/m2-3.ts:7-12; m2-scenarios.test.ts (`not.toContain("fixture:")`); plan.md:333, :655; tasks.md 18.1/18.2 | The marker scheme contradicts plan C15 and the task text (`fixture:` markers and their coverage test), and no plan amendment was made | high |
| F-7 | LOW | patterns/demos.ts:54 | `STRUCTURED_ATTEMPTS = 3` is hard-coded, whereas workflows/demos.ts:104 derives it from `DEFAULT_MAX_REGENERATIONS + 1` | high |
| F-8 | LOW | patterns/demos.ts:207-210; workflows/model-tier.ts:41-50; workflows/demos.ts:325-338 | Structured calls run on models resolved without `require: ["structuredOutput"]`: the self-reflection critic, which is the generator, and the model-routing classifier on the light tier | medium |
| F-9 | LOW | workflows/demos.ts:53-60 | `llmCalls` and tokens are counted only after `doGenerate` resolves, so failed attempts are invisible (see F-2) | high |
| F-10 | LOW | apps/web/app/api/workflows/route.test.ts:82-91, :343-364, :448-463 | Weak route assertions: patterns are checked only with `result toBeDefined()`, the 503 case covers only the sequential prompt-chaining path, and the already-aborted case does not assert the response | high |
| F-11 | LOW | apps/web/app/api/workflows/route.ts:76-80 | `inspect` throws instead of returning a `GuardError` (contract `GuardError \| undefined`). It works only through the outer `try` | high |
| F-12 | LOW | specs/002-rag-and-workflows/tasks.md:258-260, :285-287 | The Implementation Notes of major tasks 18 and 19 are empty, and deviations 2, 3 and 5 are not recorded (wave transfer condition 1) | high |
| F-13 | LOW | workflows/limits.ts:34-42 | `resolveWorkflowLimits` treats `passScore` and the `default*` keys as caps that can only go down and must be integers ≥ 1. For example, `{ defaultVotes: 5 }` is rejected although `maxVotes` is 9 | high |
| F-14 | LOW | patterns/passive-goal-creator.ts:18 | `successCriteria.min(1)` forces invented criteria for an ambiguous instruction, contradicting the prompt's "推測で穴を埋めず" | low |
| F-15 | LOW | patterns/reflection.ts:61-70 | `mode:"self"` silently accepts a critic with a different ID, so a "self" run can actually be a cross run | low |
| F-16 | LOW | workflows/demos.ts:378 | The voting demo normalizes ballots with `trim()` only, so "賛成です。" and "賛成" count as different labels and cause spurious ties in `local`/`live` | medium |

## Critique

### [HIGH] F-1 Provider errors inside parallel, step or worker stages answer 502 `output-invalid` instead of 503
**Location**: packages/ai-core/src/workflows/errors.ts:25-29 (`toStepError`). Callers: parallelization.ts:27, patterns/single-path-plan.ts:101, workflows/orchestrator-workers.ts:93. The mapping in apps/web/app/api/workflows/route.ts:111 is skipped.

**Issue**: `toStepError` wraps every non-`PlatformError` in `WorkflowStepError("output-invalid")`, and that includes `APICallError`, `RetryError` and network errors. The route checks `AISDKError.isInstance(error)` only on the top-level error, so in these demos a provider outage reaches the client as 502 "the model's output was invalid":

- parallel-sectioning
- parallel-voting
- evaluator-optimizer (evaluators)
- multi-path-plan (candidates)
- single-path-plan (steps)
- orchestrator-workers (all workers failed)

**Evidence**:
- The probe (`runWorkflowDemo("parallel-voting")` with `APICallError`) printed `PROBE WorkflowStepError output-invalid`.
- Plan HTTP table for `/api/workflows`: "502 `output-invalid`、503、429". Task 19.1: "モデルの出力不正は 502 `output-invalid`、接続不能は 503".
- Plan Error Handling: `WorkflowStepError` is for "モデルの出力がスキーマ・上限・追加検証を満たさない".
- The only 503 route test (`route.test.ts:343`) uses prompt-chaining, whose errors are not wrapped.
- This is the same class of defect as W3 F-5.

**Fix**: In `toStepError`, return AI SDK errors unchanged (`AISDKError.isInstance(error)`) as well as aborts. Alternatively, convert them in ai-core to a fixed-message `PlatformError("provider-unavailable")` with no cause text. Add route tests that make the `APICallError` model fail parallel-voting, single-path-plan and evaluator-optimizer, and expect 503 with no provider text. Add a unit test in `errors.test.ts`.

### [MEDIUM] F-2 The per-request call bound is not a real bound in `live` (prior: W1 accepted default SDK retries for `generateValidated`)
**Location**: workflows/demos.ts:146-180 (`workflowDemoMaxCalls`), :210 (`generateText` without `maxRetries`). Also patterns/demos.ts:94-123 and patterns/reflection.ts:74,100. The `generateValidated` calls inherit the same default.

**Issue**: Plan C13 says the products of the limits are "1 リクエストの LLM 呼び出しの最大数" and that this bound, together with 429, holds cost down. Every call, however, uses the AI SDK default of 2 retries on retryable errors (429/5xx/network). Real provider requests can therefore reach up to 3× `workflowDemoMaxCalls`; for example, evaluator-optimizer at the cap is 56 → 168. The ledger increments only after a successful `doGenerate`, so the `llmCalls <= maxCalls` tests cannot observe retries or failed attempts.

**Evidence**: AI SDK 7.0.137 has `maxRetries: maxRetriesArg ?? 2`. `grep maxRetries packages/ai-core/src` finds only `ports/rerank.ts:72`. The ledger code is `const result = await doGenerate(); llmCalls += 1;`.

**Confidence**: medium. The retry count is certain; whether C13 meant logical calls is the open question.

**Fix**: Either pass `maxRetries: 0` in `generateStage`, `reflect`, and the `generateValidated` calls made by demos, or multiply the documented bound by `(maxRetries + 1)` and state it in plan C13 and the 2-3/2-4 docs. Count attempts in the ledger with `try { … } finally { llmCalls += 1 }`, so failures are visible.

### [MEDIUM] F-3 Role-based cooperation turns provider outages and client aborts into HTTP 200
**Location**: packages/ai-core/src/patterns/role-based-cooperation.ts:108-116

**Issue**: `catch { /* recorded in summary */ }` swallows every error from `agent.generate`. If the provider is down, the first role ends with `stopReason:"error"`, `cooperateByRole` returns normally, and the route answers 200 `{ result: { stopped: "error", outputs: [...] } }`. Every other demo answers 503. A caller abort likewise yields 200 `stopped:"aborted"`, while the other demos throw.

**Evidence**:
- Plan HTTP table: `/api/workflows` rejections include 503.
- The zero-tolerance list includes generic catch-all / swallowed exceptions.
- The test "stops with the role's error" asserts `run.stopReason`, but nothing asserts that `run.error.code` survives or how the route classifies it.

**Confidence**: medium. Plan CL-8 does say the hand-off stops and returns the outputs, so a 200 response may be intended.

**Fix**: Decide and record it. Either rethrow (or map to `PlatformError(run.error.code)`) when a role ends in `error` with `provider-unavailable`, or when the caller aborted. Or keep the result semantics and amend the plan's HTTP table and Error Handling to say role errors are results. Add a test that pins `outputs[i].run.error.code`.

### [LOW] F-4 The shared token budget can be exceeded
**Location**: patterns/role-based-cooperation.ts:88-125. Test: role-based-cooperation.test.ts:184-195.

**Issue**: The M1 token budget is checked after each step, so a role can overspend `remaining`, and the run's total can exceed `budget.maxTotalTokens`. The test expects 600 + 600 tokens against a budget of 1000 as normal behavior.

**Evidence**: CL-8 says "全役割の合計トークンの上限を共有", and the plan contract table lists "`cooperateByRole` の共有予算" as a contract for 003 Req 4.

**Fix**: Document the overshoot bound (at most one step per role) in CL-8 and the 2-4 doc, or report `totalTokens` and an `exceededBy` field in the result. 003 builds on this contract.

### [LOW] F-5 User text outside data tags, and data tags that can be closed from inside
**Location**: workflows/demos.ts:359 (`stage: \`観点・${section.name}\`` from the user's `options.aspects`), :214 (`[段: …]` label). Every `<task>\n${…}\n</task>` interpolation in workflows/, patterns/ and routing.

**Issue**: `WORK_INSTRUCTIONS` says only tag contents are data, but a user's aspect value (up to 40 characters, up to 8 of them) sits in the instruction line. No interpolation escapes a closing tag, so a task containing `</task>` ends the data block early.

**Evidence**: The focus point requires user text to be wrapped as data. The impact is low because the tools are read-only and the output returns to the same user.

**Fix**: Put aspects inside an `<aspect>` tag. Add one helper that neutralizes `</` inside interpolated data, and use it everywhere.

### [LOW] F-6 The scenario markers contradict plan C15 and tasks 18.1/18.2, with no amendment
**Location**: fixtures/scenarios/m2-3.ts:7-12, and the test `keeps the stage markers readable` (`not.toContain("fixture:")`). The texts that say otherwise are plan.md:333 ("`lastUserTextIncludes` の `fixture:` マーカー"), plan.md:655, and tasks.md 18.1 ("全 `fixture:` マーカーの網羅").

**Issue**: The deviation is reasonable (it keeps the production prompts readable, and W3 set a precedent), but the source-of-truth documents still describe the opposite, and the new test asserts the opposite.

**Fix**: Amend plan C15, the File Structure Plan row and the 18.1/18.2 task text to describe stage-label markers, and record the decision in the 18 Implementation Notes.

### [LOW] F-7 `STRUCTURED_ATTEMPTS` is hard-coded in the pattern demos
**Location**: patterns/demos.ts:54

**Issue**: `const STRUCTURED_ATTEMPTS = 3;` duplicates `DEFAULT_MAX_REGENERATIONS + 1` (workflows/demos.ts:104). The tests also hard-code 3, so a change to the regeneration count silently understates `patternDemoMaxCalls`.

**Fix**: Import `DEFAULT_MAX_REGENERATIONS` and derive the value.

### [LOW] F-8 Structured calls on models resolved without the structured-output capability
**Location**: patterns/demos.ts:207-210 (self mode: the critic is the `chat` generator, and `generateValidated` runs on it). Also workflows/model-tier.ts:41-50 with demos.ts:325-338 (the classifier runs on `tiers.light`, which was resolved as `chat`).

**Issue**: When the chat model or a tier model lacks structured output, the failure surfaces after the call as 502 or a provider error. It should surface as 400 `capability-unsupported` before any call. The current catalog tiers all support structured output, so this is latent.

**Fix**: Resolve with `require: ["structuredOutput"]` where a structured call follows, or assert `entry.capabilities.structuredOutput` before running.

### [LOW] F-9 The ledger counts only successful calls
**Location**: workflows/demos.ts:53-60

**Fix**: See F-2. Count each attempt in a `finally` block.

### [LOW] F-10 Weak route assertions
**Location**:
- route.test.ts:82-91: patterns are checked with only `result toBeDefined()`, and `llmCalls > 0` is not asserted.
- :343-364: the only 503 test uses the sequential prompt-chaining path, which hides F-1.
- :448-463: the already-aborted test does not assert the response.

**Fix**: Assert one distinguishing field per pattern, for example `history`, `outputs` or `selectedIndex`. Add the F-1 cases.

### [LOW] F-11 `inspect` throws instead of returning a violation
**Location**: apps/web/app/api/workflows/route.ts:76-80

**Issue**: `GuardPolicy.inspect` is typed to return `GuardError | undefined`. This route relies on a thrown `PlatformError` escaping `guardRequest` and being mapped by the outer `catch`. The ordering is correct today (before the limiter), but it is fragile if `guardRequest` ever catches. A client abort maps to 500 `unexpected`, which is harmless.

**Fix**: Catch the `PlatformError` inside `inspect` and return `new GuardError("invalid-request", message)`.

### [LOW] F-12 Implementation Notes for tasks 18 and 19 are empty
**Location**: specs/002-rag-and-workflows/tasks.md:258-260, :285-287

**Issue**: Wave transfer condition 1 requires notes. The deviations listed under Trigger resolution, items 2, 3 and 5, are not recorded.

**Fix**: Fill in the notes before archiving W4.

### [LOW] F-13 `resolveWorkflowLimits` treats thresholds and defaults as caps that can only go down
**Location**: workflows/limits.ts:34-42

**Issue**: Every override key must be an integer from 1 up to the shipped default. As a result:

- `{ defaultVotes: 5 }` is rejected although `maxVotes` is 9.
- `{ passScore: 90 }` and `{ passScore: 0 }` are rejected, while the `passScore` parameter accepts 0–100.

The function is part of the public API.

**Fix**: Restrict overrides to the `max*` keys, or validate `default*` keys against their `max*` keys and `passScore` against 0–100.

### [LOW] F-14 `successCriteria.min(1)` pushes the model to invent criteria
**Location**: patterns/passive-goal-creator.ts:18

**Fix**: Allow an empty list when `missingInformation` is non-empty, or require that the gaps cover the success criteria.

### [LOW] F-15 Self mode accepts a different critic
**Location**: patterns/reflection.ts:61-70

**Fix**: In `self` mode, reject a critic whose ID differs from the generator's (or ignore the critic), so that the mode name stays true.

### [LOW] F-16 Ballot normalization is too weak for real models
**Location**: workflows/demos.ts:378

**Fix**: Map each ballot to `賛成`/`反対`/`その他` by keyword, or ask for a structured `{ vote: z.enum([...]) }`.

## Hallucination Signal
forced: false

## Responses

<!-- Implementer: append one row or paragraph per finding (Fixed / Partly / Declined + evidence). -->

| ID | Response |
|---|---|
| F-1 | Fixed test-first. `toStepError` keeps an AI SDK error unwrapped; unit test + 7 route tests (parallel-voting, parallel-sectioning, orchestrator-workers, evaluator-optimizer, multi-path-plan, single-path-plan, role-based-cooperation) now expect 503 with no provider text. PROVE: removing the line fails both. |
| F-2 / F-9 | Fixed. `createUsageLedger` counts a call before it reaches the provider (failed attempts and SDK retries count) and takes `maxCalls`; both demo runners pass `workflowDemoMaxCalls` / `patternDemoMaxCalls` as the cap, so the C13 bound is enforced, not only observed. Tests: failed attempt counted; the call after the cap never reaches the provider; PROVE for off-by-one, count-after-call. |
| F-3 | Fixed. `cooperateByRole` rethrows an AI SDK error or a non-`output-invalid` PlatformError (unless the caller aborted); other errors still end the hand-off as `stopped: "error"`. 2 tests + route test. |
| F-7 | Fixed (`DEFAULT_MAX_REGENERATIONS + 1`). |
| F-12 | Implementation Notes of 18/19 were written after the review started; the stage-label deviation is recorded there. |
| F-6 | Accepted: the label scheme follows the W3 decision (tasks-comp-w3 14.2 note); plan C15 / tasks 18.1 wording to be amended in the W6 traceability task (27). |
| F-4, F-5, F-8, F-10, F-11, F-13–F-16 | Deferred (LOW). F-4: the budget is enforced between roles by design (CL-8; a role may cross it in its last step). F-10 partly addressed by the new 503 tests. F-11: `inspect` throws `invalid-request` deliberately, documented in the route. |
