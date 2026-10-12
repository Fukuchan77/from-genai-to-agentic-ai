# Adversarial Review: 002 rag-and-workflows, Wave W3 (tasks 10.1–15.4, wave close 15.5)

- Date: 2026-10-12
- Scope: the uncommitted working tree on `feat/m2-w1-foundation`. That is `git diff HEAD` (platform.ts/test, aci/index.ts, mock/index.ts, models/gateway.ts/test, rag/index.ts, rag/request-schema.ts/test, rag/db/schema.db.test.ts, stryker.config.mjs, plan.md, tasks.md, tasks-w4.md) plus the untracked files:
  - `rag/{retrieve,answer,eval}/**`, `rag/{query,agentic,lexical-rerank}.ts` and their tests
  - `aci/tools/search-knowledge-base{,.test}.ts`, `src/mock/m2-scenarios.test.ts`
  - `fixtures/rag/eval-set.json`, `fixtures/scenarios/m2-{1,2}.ts`
  - `apps/web/lib/server/rag-stream{,.test}.ts`, `apps/web/app/api/rag/{query,agent}/**`
- Inputs:
  - `spec.md` (Req 1.4–1.7, 1.9–1.11, 2.1–2.12)
  - `plan.md` (C2, C7–C10, C13, C15; CL-1, CL-2, CL-6, CL-11; HTTP API; stream parts; Error Handling; Test Strategy; contract table)
  - `tasks.md` (tasks 10–15 and their Implementation Notes)
  - `pdca/do.md` (W3 PROVE log)
  - `.sdd/memory/constitution.md`
- Prior reviews read: `002-rag-and-workflows-impl-w1-review-2026-10-12.md` and `002-rag-and-workflows-impl-w2-review-2026-10-12.md`. No W3 finding repeats a resolved prior finding.
- Risk trigger: none was given. The caller listed focus points instead, and each one is addressed under "Focus points".

## Evidence gathered

- `mise run gate` (run by the reviewer): exit 0.
  - Test counts: `@platform/ai-core executed=1430 passed=1430 skipped=4`, `web executed=415 passed=415`, `eval-suite executed=3 passed=3 skipped=1`, `//:test executed=351`.
  - `no-sql-raw: scanned 175 FILES`, `guarded-agent-only: scanned 277 FILES`, `tool-risk-declared: scanned 15 FILES`.
  - `Docs: 4 module documents, 51 test references verified`.
- Targeted runs:
  - `vitest run src/rag src/aci/tools/search-knowledge-base.test.ts src/mock/m2-scenarios.test.ts src/models/gateway.test.ts`: 680/680 passed.
  - web `vitest run app/api/rag lib/server/rag-stream.test.ts lib/server/platform.test.ts`: 129/129 passed.
- Dependencies: `git diff HEAD -- '*package.json' pnpm-lock.yaml` is empty, so no dependency was added.
- Removed or skipped tests: the only removed test lines are two `});` (timeouts added) and an import that was re-wrapped. No `.skip`, `.todo` or `it.fails` appears.
- Grep over the W3 files:
  - `rag/` does not import `agents/`.
  - `aci/` does not import `rag/`. `rag/agentic.ts` imports `aci/tools/search-knowledge-base`, which the dependency direction allows.
  - No `TODO`/`FIXME`/`any`.
  - The catch blocks are `pipeline.ts:278` (Rerank fallback), `query.ts:188` (answer generation), `dataset.ts:91,98`, and the routes.
- Read-only probe: a Vitest file and config in the session scratchpad, rooted at `packages/ai-core`. No repository file was touched. It printed the following:
  - `CITE "A [1, 7]." => "A [1, 7]." [] [false,false]`, `"A [1,2]." => "A [1,2]." []`, `"A [1-3]" => "A [1-3]" []`, `"A [1][7]." => "A [1]." [7] [true,false]`.
  - `GOLD total chunks 35 missing []`: every gold chunk ID in `eval-set.json` (32 questions) exists in the corpus.
  - `NOEVID rerank provider? false {"status":"disabled"} … rerank:skipped`, and the same with the lexical provider.
  - `EMPTYKB {"status":"disabled"} vector-search:skipped`: one stage record only, with all 4 methods on.
  - `BOTH hyde ERROR MockFixtureMissingError provider-unavailable` and `BOTH mq ERROR MockFixtureMissingError`: HyDE and Multi-Query enabled together on either sample question fail in `mock`.
- PROVE evidence: `pdca/do.md` "W3 (tasks 10–15)" lists stubs for each task, the survivors that were fixed, one real bug found (abort after the `trace` yield), and the mutation score 86.46. That is acceptable. The two "equivalent/unprovable survivors" are discussed in F-9.

## Focus points

1. **CL-1 (no evidence is decided only by vector hits): holds.**
   - `vectorHit` is `perQuery.some(entry.vector.length > 0)` over threshold-filtered vector results (`pipeline.ts:198`). The no-evidence branch returns before fusion (`pipeline.ts:124-129`).
   - The test `says no evidence when only the full-text search hits (CL-1)` is non-vacuous: the stub "full-text rescues" was caught (do.md).
   - HyDE and Multi-Query queries are included (`finds evidence when only one sub-query reaches the threshold`, `says no evidence when no sub-query reaches the threshold`).
   - After the gate passes, full-text-only candidates may reach the answer through RRF, which CL-1 allows.
2. **Abort and "no LLM call after abort": holds in code, partly unproven in tests.**
   - `streamRagQuery` checks the signal after retrieval, again after the `trace` yield, and passes it to `streamText`.
   - `generateValidated` and `generateHypotheticalAnswer` check `aborted` before calling the model.
   - The pipeline rethrows an abort raised during Rerank.
   - The test gaps are listed in F-9.
3. **Leakage of internals in stream errors: no leak found.**
   - Non-`PlatformError` errors become `unexpected` with a fixed text (`toStreamErrorText`), and `details` never leave the server.
   - Answer-generation failures become a fixed `provider-unavailable`.
   - The agent route wraps provider errors in the guarded agent's fixed text.
   - The tool converts non-platform search errors into a fixed sentence.
   - The cost of this conservatism is a misclassification (F-5).
4. **Guard order 413 → 400 → 400 → 429 (live only): holds.**
   - Both routes call M1's `guardRequest` before any resolve.
   - Both route tests prove that a 400 does not consume the live rate-limit slot.
   - Nothing proves that 413 precedes 429 in `live` (F-9; M1's guard tests cover it).
5. **Rerank skip and provider-error fallback: holds for the evidence path (CL-6, CL-11).** It is misreported on the no-evidence path (F-3). The catch-all is in F-11.
6. **Citation resolution edge cases.**
   - These work: code blocks, inline code, full-width brackets, `[0]`, Markdown links, duplicates and the gap clean-up.
   - Grouped and range footnotes are not handled (F-1).
7. **HTTP routes and an unreachable DB.**
   - `getKnowledgeBase` failures before the stream become 503 `provider-unavailable`, and a failed creation is not cached.
   - The agent route has no such test (F-9).
   - A DB or embedding failure after the stream has started becomes `unexpected` (F-5).
8. **`rag/` imports `agents/`: no.** `summarizeAgenticRun` takes a structural `{ toolsCalled }`.
9. **Deviations recorded in the tasks.md notes.**
   - HyDE uses `structuredModel`. This is recorded, but plan C7's `deps` is not updated (F-13).
   - The scenario test path moved to `src/mock/m2-scenarios.test.ts`. plan.md and tasks-w4.md `_Boundary_` lines are updated, but stale references remain (F-14).
   - The eval set has no unrelated questions. This is justified by `goldChunkIds.min(1)` and covered by `query.db.test.ts`, but the task 14.1 text still asks for them (F-13).
   - The agent route requires `personaId` (and `modelId`), and they are silently unused (F-13).

## Critique

### [MEDIUM] F-1 Grouped and range footnotes bypass citation reconciliation (Req 1.11, Req 1.5)
**Location**: packages/ai-core/src/rag/answer/citations.ts:40, :169-183
**Issue**: `FOOTNOTE` matches only a single ordinal per bracket, so `[1, 7]`, `[1,2]`, `[1-3]` and `[^7]` are neither checked nor rewritten. An out-of-range ordinal inside a group stays in the answer and is not recorded in `removedCitations`. Valid ordinals in a group are not marked `cited`.
**Evidence**: The probe printed `"A [1, 7]." => "A [1, 7]." removed [] cited [false,false]` and `"A [1,2]." => "A [1,2]." [] [false,false]`. Req 1.11: "集合に含まれない引用を除去して、除去したことを記録する". Small `local` models commonly emit `[1, 2]` even when the prompt says "[1] のように". The Agentic RAG answer path (`summarizeAgenticRun`) has the same gap.
**Confidence**: high (behavior); medium (frequency in practice)
**Fix**: Parse `[n(, n)*]` and `[n-m]` (ASCII and full-width separators). Keep the in-range members, drop and record the out-of-range ones, and rewrite the bracket, or split it into `[1][2]`. Add tests for `[1, 7]`, `[1,2]`, `[2-3]`, `[7, 9]` (whole bracket removed) and the full-width forms. The file is under Stryker, so also check that the new branches are killed.

### [MEDIUM] F-2 `createSearchKnowledgeBaseTool` is not exported from `@platform/ai-core/rag`, contrary to the contract table and task 13.4
**Location**: packages/ai-core/src/rag/index.ts (no export); apps/web/app/api/rag/agent/route.ts:1
**Issue**: Task 13.4 is marked `[x]`. Its text requires "`createSearchKnowledgeBaseTool` と引用レジストリの再エクスポート", and its `_Verify_` says "apps/web から `@platform/ai-core/rag` の契約表の全シンボルを import できる". The tool is only reachable through `@platform/ai-core/aci`.
**Evidence**: `grep -n SearchKnowledgeBase src/rag/index.ts` returns nothing. Plan "後続 spec への契約": "`createSearchKnowledgeBaseTool`（ツール名 `searchKnowledgeBase`、`risk: "read-only"`）と引用レジストリ | `@platform/ai-core/rag` | 004 Req 4.8".
**Confidence**: high
**Fix**: Re-export `createSearchKnowledgeBaseTool`, `SEARCH_KNOWLEDGE_BASE_TOOL_NAME` and the tool's types from `rag/index.ts`. `rag/` already depends on `aci/tools/search-knowledge-base`, so the direction is allowed. Add a type-level or import test that pins every contract-table symbol to its documented subpath. Alternatively, amend the contract table to `@platform/ai-core/aci` and record why.

### [MEDIUM] F-3 `RagResult.rerank` reports `disabled` when Rerank was enabled but there was no evidence (Req 2.6, 2.7)
**Location**: packages/ai-core/src/rag/retrieve/pipeline.ts:85-89, :124-129; trace.ts:114
**Issue**: The empty-knowledge-base return and the no-evidence return never call `trace.setRerank`, so the default `{ status: "disabled" }` is returned even when `methods.rerank` is true. The learner switched Rerank on and the result says it was off.
**Evidence**: The probe printed `NOEVID rerank provider? false {"status":"disabled"} …rerank:skipped` and the same with the lexical provider. `EMPTYKB {"status":"disabled"}` is printed with all 4 methods on. The test `does not call Rerank when there is no evidence` asserts only the stage, not `trace.rerank`. `query.ts:204` forwards `retrieval.trace.rerank` as `RagResult.rerank`, which the C14 UI reads.
**Confidence**: high
**Fix**: On both early returns, set `rerank` to `disabled` when `!methods.rerank` and to `skipped` otherwise. The reason is `api-key-missing` without a provider, or a new closed reason such as `no-evidence`; a new reason needs a plan C7 update because `RerankSkipReason` is a closed set. Assert `trace.rerank` in the no-evidence and empty-KB tests for `rerank: true`.

### [MEDIUM] F-4 Intermediate results are streamed once, after retrieval has finished (Req 2.11; plan C8 "累積した RetrievalTrace")
**Location**: packages/ai-core/src/rag/query.ts:143-159; apps/web/lib/server/rag-stream.ts:36-38
**Issue**: Stage status events stream live, but the intermediate data (sub-queries, hypothetical answer, per-search candidates, fused list) arrives in one `trace` event only after Rerank completes. Req 2.11 asks for intermediate results *while* the pipeline runs. The plan describes `data-rag-trace` as an accumulating trace overwritten under one id, which implies several sends.
**Evidence**: Req 2.11: "WHILE 検索パイプラインが実行中の状態、…各段階の進行状況…と中間結果を、回答テキストとは別のデータとして UI へストリーミング". Plan C8: "`trace`（累積した `RetrievalTrace`）". Plan stream table: `data-rag-trace` id `trace`（上書き）. The tests encode the single send: `expect(types.filter((type) => type === "trace")).toHaveLength(1)` in `query.db.test.ts:124` and in the route test.
**Confidence**: medium (the interpretation of "WHILE … 中間結果" can be argued)
**Fix**: Emit a `trace` snapshot (`trace.build()`) after each stage that adds data: `hyde`, `multi-query`, search, `fusion`, `rerank`. Bridge it through the same queue as `stage`. Keep the "exactly one trace before text" ordering rule as "the last trace before text". Alternatively, record in plan CL/C8 that intermediate data is sent once per retrieval, and cite the latency rationale.

### [MEDIUM] F-5 Retrieval-stage failures inside the stream are classified as `unexpected`, not `provider-unavailable`
**Location**: packages/ai-core/src/rag/query.ts:143-157 (retrieval errors pass through raw); retrieve/hyde.ts:40; rag/embedding.ts (embed calls); apps/web/lib/server/rag-stream.ts:62
**Issue**: Only the answer-generation failure is converted to the fixed `provider-unavailable`. The following reach `toStreamErrorText` as non-`PlatformError` and become `unexpected` ("予期しないエラー"):
- a HyDE `generateText` provider error
- an embedding API failure (Ollama stopped after the cached preflight)
- a Postgres outage after the `getKnowledgeBase` handle was cached

The learner gets no guidance, and the UI cannot tell a stopped service from a bug.
**Evidence**: Plan Error Handling: "Postgres に接続できない（`local` / `live`）→ `provider-unavailable`（503）。`mise run services:up:db` を案内する". `query.db.test.ts` "passes retrieval errors through unchanged" pins only the `PlatformError` case. No test covers a provider or driver error during retrieval.
**Confidence**: medium
**Fix**: In `streamRagQuery`, wrap the retrieval call. Rethrow aborts and `PlatformError`s unchanged, and map anything else to a fixed `provider-unavailable` message, without the cause, that names the DB, embedding and model services. Add a `query.db.test.ts` case whose embedding `doEmbed` throws `new Error("ECONNREFUSED …secret…")`, and expect `provider-unavailable` with no secret.

### [LOW] F-6 Stage name `fusion` differs from the plan's stream contract `fuse`
**Location**: packages/ai-core/src/rag/retrieve/trace.ts:26-32; plan.md:462
**Issue**: The plan's `data-rag-stage` vocabulary is `"hyde" | "multi-query" | "vector-search" | "full-text-search" | "fuse" | "rerank" | "generate"`, while the code emits `fusion` (`id: stage-fusion`). The tasks note mentions `fusion`, but the plan was not updated. W5's UI (C14) may be written against the plan.
**Evidence**: `| "fusion"` in `RetrievalStage`. Plan: `… \| "fuse" \| "rerank" …`.
**Confidence**: high
**Fix**: Update plan.md's stream-part table to `fusion`, or rename the stage. Grep tasks-w5.md for `fuse`.

### [LOW] F-7 With an empty knowledge base, the trace records one stage, so the UI shows no status for the enabled methods
**Location**: packages/ai-core/src/rag/retrieve/pipeline.ts:85-89
**Issue**: The note "16 通りの組み合わせはいつも同じ 6 段が同じ順で並ぶ" holds only for a non-empty base. The empty-KB path records only `vector-search: skipped`. HyDE, Multi-Query, full-text, fusion and rerank are absent, which matters for the C14 progress view keyed by `stage-<stage>`.
**Evidence**: The probe printed `EMPTYKB … vector-search:skipped` with all methods on.
**Confidence**: high
**Fix**: Record every stage as `skipped` with the reason "ナレッジベースが空です" (and set `rerank` per F-3). Add the empty-KB case to the 16-combination test.

### [LOW] F-8 HyDE and Multi-Query enabled together have no `mock` scenario; every sample question fails
**Location**: packages/ai-core/fixtures/scenarios/m2-1.ts:70-125
**Issue**: With both switches on, Multi-Query expands the hypothetical answer. No scenario matches that prompt, so the stream ends with `MockFixtureMissingError` (`provider-unavailable`). The `/rag` page exposes the 4 switches independently, so a learner in `mock` hits an error on a valid combination.
**Evidence**: The probe printed `BOTH hyde ERROR MockFixtureMissingError provider-unavailable` and `BOTH mq ERROR …`. Plan Test Strategy: "画面の入力例は、シナリオに対応する質問文を提示する".
**Confidence**: high
**Fix**: Add a structured turn that matches `lastUserTextIncludes: M2_CORPUS_TEXT.whyRag` (the HyDE output) and returns 3 corpus sub-queries. Alternatively, document in the 2-2 module doc and the UI that the combination has no `mock` example. Add the combination to `m2-scenarios.test.ts`.

### [LOW] F-9 Test weaknesses (tautological or vacuous assertions, missing abort and DB cases)
**Location**:
- apps/web/app/api/rag/agent/route.test.ts:285-298
- packages/ai-core/src/rag/query.db.test.ts:213-229
- packages/ai-core/src/rag/retrieve/hyde.test.ts:117-124
- packages/ai-core/src/rag/retrieve/pipeline.db.test.ts:309-321
- the agent route test (no 503 case)

**Issue**:
- (a) `starts every request with a fresh citation registry` passes with a module-level shared registry, because the same chunk would keep label 1. The test name claims a property it cannot detect, and do.md admits this.
- (b) `does not start generation when the signal aborts during retrieval` aborts on the `trace` event, which is after retrieval. No test aborts mid-retrieval, for example after HyDE and before Multi-Query, to prove no further LLM call. That holds only by reading `generateValidated`.
- (c) `passes the abort signal on to the model call` asserts `abortSignal` `toBeDefined()`, not that it is the caller's signal.
- (d) `matches Japanese text through the segmented search text` says "CL-1 still says no evidence" in a comment but asserts nothing about `noEvidence`.
- (e) `/api/rag/agent` has no unreachable-DB (503) test, and no test that a mid-run abort stops after the tool call.
- (f) No `live` test pins 413 before 429 on the RAG routes.

**Evidence**: The quoted test bodies. do.md: "per-request registry (same fixed chunk → same label)".
**Confidence**: high for (a)–(d); medium that (e) and (f) matter
**Fix**:
- (a) Use two different questions or a searcher stub returning different chunks per request, and assert that the second request's citations do not contain the first's chunk. Or rename the test so it claims less.
- (b) Use a structured model that aborts the controller in `doGenerate`, and assert `doGenerateCalls.length === 1` with HyDE and Multi-Query on.
- (c) Assert identity, or that the passed signal aborts when the controller does.
- (d) Assert `noEvidence === true`.
- (e) Add the agent 503 case and a tool-time abort case.
- (f) Add an oversized body in `live` after the limit is used up, and expect 413.

### [LOW] F-10 The lexical Rerank breaks ties by chunk ID (a content hash), discarding the fused order
**Location**: packages/ai-core/src/rag/lexical-rerank.ts:33, :40
**Issue**: Candidates with equal overlap, including the all-zero case when the question has no usable words, are ordered by hash, not by their fused rank. The "applied" Rerank can then push the best vector hit out of the top k in `mock`, which is what learners and E2E see.
**Evidence**: `if (queryWords.size === 0) return { id: candidate.id, score: 0 }` and `.sort((l, r) => r.score - l.score || compareIds(l.id, r.id))`.
**Confidence**: medium
**Fix**: Break ties by the input position (a stable sort over `candidates`). This is still deterministic. Update the "同点の決定論" test to expect input order.

### [LOW] F-11 The Rerank catch-all hides programming errors; duplicate IDs from a provider are not removed
**Location**: packages/ai-core/src/rag/retrieve/pipeline.ts:260-283
**Issue**:
- `catch (error)` maps every non-abort error, including a `TypeError` in the pipeline's own mapping, to `provider-error`. Nothing is logged: not even the error name, which constitution 7 allows.
- `scores.slice(0, topK)` keeps a repeated ID twice, so a misbehaving provider can put the same chunk twice in `final`, contrary to the spirit of Req 2.4.

**Evidence**: The zero-tolerance list ("generic catch-all"). `for (const { id, score } of scores.slice(0, settings.topK))` has no `seen` set.
**Confidence**: medium (cause); low (likelihood)
**Fix**: Narrow the try to `provider.rerank(...)` only, so the mapping runs outside it. Skip IDs that were already taken. Optionally pass the error name to an observer or logger.

### [LOW] F-12 The Judge does not check verdict/score consistency; no-chunk faithfulness scores 1 although the rubric puts `unknown` at about 3
**Location**: packages/ai-core/src/rag/eval/judge.ts:71-75, :144-151
**Issue**: `{ verdict: "pass", score: 1 }` is accepted, although the rubric maps pass to 4–5, fail to 1–2 and unknown to about 3. The synthetic no-evidence judgement uses `score: 1`, so averaging scores in 004 or the capability test counts "cannot judge" as "worst".
**Evidence**: The rubric lines `pass（4〜5）`, `fail（1〜2）`, `unknown（3 など）`. `score: 1` in the no-chunk branch.
**Confidence**: medium
**Fix**: Add a `validate` to `generateValidated` that rejects pass < 4 and fail > 2, which triggers regeneration. Use 3 for the synthetic `unknown`, or make `score` optional for `unknown` and document it.

### [LOW] F-13 Interface deviations recorded only in tasks.md, not in plan.md
**Location**: plan.md C7 (`deps { store; embedding; structuredModel; chatModel; rerank }`), HTTP API row `/api/rag/agent` (`modelId?: string`), task 14.1 text
**Issue**:
- `RetrievalDeps` dropped `chatModel`, and HyDE now runs on `structuredModel`. `runRetrieval` is in the contract table for 003.
- `/api/rag/agent` requires `modelId` and `personaId`, and silently ignores `personaId`, because it reuses M1's schema.
- The query schema's `modelId` is a catalog enum, not a string.
- The eval set omits the unrelated questions that task 14.1 asks for.

Constitution precedence makes the plan the source of truth, so it should state what was built.
**Evidence**: The tasks.md notes under 10, 11 and 15, and `conversationRequestSchema()` (`modelId: modelIdSchema, personaId: personaIdSchema`, both required).
**Confidence**: high
**Fix**: Amend plan C7 (deps), the HTTP API row (required `modelId`/`personaId`, and that the persona is unused, or drop `personaId` with a RAG-specific `z.strictObject`) and task 14.1's text. Accepting an unused required field is a small API smell. A dedicated agent schema without `personaId` is cleaner.

### [LOW] F-14 Stale references to `m2.test.ts` after the move
**Location**: packages/ai-core/fixtures/scenarios/m2-1.ts:6, :10; m2-2.ts:4; specs/002-rag-and-workflows/tasks-w4.md:136, :141 (task bodies); tasks.md:286 (14.2 body)
**Issue**: The file is now `src/mock/m2-scenarios.test.ts`. Comments and the W4 task bodies still tell the next implementer to edit `m2.test.ts`; only the `_Boundary_` lines were updated.
**Evidence**: The `grep -rn "m2\.test\.ts"` hits listed above. AGENTS.md: "After a rename … grep for the old name".
**Confidence**: high
**Fix**: Replace the references in the comments and the 18.1/18.2 bodies. Keep the 14.2 note that explains the move.

### [LOW] F-15 Undeclared boundary edit: `rag/db/schema.db.test.ts` timeout
**Location**: packages/ai-core/src/rag/db/schema.db.test.ts:121
**Issue**: 15.5's `_Boundary_` is `stryker.config.mjs` only, but the wave close also raised the timeout of a W2 test (task 5.x). This is recorded in do.md but not in the tasks.md notes or plan.md.
**Evidence**: The diff `}, 30_000);` with the comment "Starting a second PGlite takes seconds when the gate runs every workspace at once". do.md 15.5.
**Confidence**: high
**Fix**: Add one line to the 15.5 Implementation Notes ("Boundary 外の変更 … 最小の修正"), as was done in W2.

### [LOW] F-16 The Agentic summary reconciles only the last step's text
**Location**: apps/web/app/api/rag/agent/route.ts:95-106
**Issue**: `stepText` resets at each `start-step`. Footnotes the agent wrote in an earlier step, which the UI already rendered, are never reconciled. When the run stops at the step limit right after a tool call, `rag.answer` is `""` while the screen shows text. do.md lists the reset as an unprovable survivor.
**Evidence**: `if (part.type === "start-step") stepText = "";`
**Confidence**: low
**Fix**: Document in C9 that `rag.answer` is the final step's text, or reconcile the concatenated text of every step. Add a two-text-step scenario to kill the survivor.

### [LOW] F-17 An empty model answer yields `answer: ""` with `noEvidence: false`
**Location**: packages/ai-core/src/rag/query.ts:177-196
**Issue**: When the answer stream finishes with no text (for example finish reason `length`/`content-filter`, or a small model returning nothing), the result has an empty answer, citations all `cited: false`, and no signal to the UI.
**Evidence**: The loop accumulates `text` and nothing checks for `text === ""` before `resolveCitations`.
**Confidence**: low
**Fix**: Treat an empty answer as a `provider-unavailable` (or `output-invalid`) stream error, or fall back to `NO_EVIDENCE_MESSAGE` with a recorded reason. Add a test.

### [LOW] F-18 An aborted `/api/rag/query` stream ends with an `unexpected` error part, not as aborted
**Location**: apps/web/app/api/rag/query/route.ts:62-67
**Issue**: The abort reason thrown from `execute` goes to `onError` → `toRagStreamError` → `unexpected`. The plan says the stream "は `aborted` として終わり". The client has usually disconnected already, so this is mostly invisible, but a `stop()` that keeps the reader open could show "予期しないエラー".
**Evidence**: `onError: toRagStreamError` and no abort branch. Plan Error Handling, 検索・回答.
**Confidence**: low
**Fix**: In `execute`, catch an abort when `request.signal.aborted` is true and return quietly (or write an `abort` part). Assert the absence of an `error` part in the already-aborted route test.

### [LOW] F-19 Two sources of truth for Rerank availability
**Location**: apps/web/app/api/rag/knowledge/route.ts:23-26 vs apps/web/lib/server/platform.ts:376-380
**Issue**: `GET /api/rag/knowledge` recomputes availability from `mode` and `credentials.cohere`, while the query pipeline uses `platform.ports.rerank`. They agree today but can drift, for example under a test or a future override of `ports.rerank`.
**Evidence**: `if (platform.mode === "mock" || platform.config.credentials.cohere) return { available: true };`
**Confidence**: medium
**Fix**: Derive it from `platform.ports.rerank !== undefined`. The knowledge route belongs to W2's boundary, so do this in W5 or with a note.

## Verdict
REQUEST_CHANGES

Rationale: there is no CRITICAL or HIGH finding.
- CL-1, the abort ordering, the guard order, the Rerank fallback, the import boundaries and error redaction all hold.
- The gate is green (1430 + 415 + 351 + 3 tests), and PROVE evidence exists.
- No dependency was added.

Five MEDIUM findings should be fixed before the wave is closed (each is small):
- F-1 (Req 1.11 bypass through grouped footnotes)
- F-2 (task 13.4 marked done, but the contract-table export is missing)
- F-3 (`rerank: disabled` reported for an enabled Rerank)
- F-4 (intermediate results not streamed while the pipeline runs, or the plan amended)
- F-5 (stream-time service failures shown as `unexpected`)

The LOW findings can be fixed or answered in the response section.

## Hallucination Signal
forced: false

## Responses (2026-10-12, implementer)

| ID | Response |
|---|---|
| F-1 | **Fixed test-first.** `resolveCitations` parses `[n, m]`, `[n,m]`, `[n-m]` and full-width forms; in-range members are kept (written as `[n][m]`), out-of-range ones removed and recorded; reversed/very wide ranges (>20) and lists with non-numbers are left alone. 9 new tests; PROVE: span check off and range-order check off each fail a test. |
| F-2 | **Fixed.** `rag/index.ts` re-exports `createSearchKnowledgeBaseTool`, `SEARCH_KNOWLEDGE_BASE_TOOL_NAME` and the tool types; `rag/index.test.ts` pins the runtime contract names. |
| F-3 | **Fixed.** Both early returns set the Rerank outcome (`disabled` when off; `skipped` when on, with `api-key-missing` when no provider). |
| F-4 | **Fixed.** `runRetrieval` takes `onTrace`; `streamRagQuery` emits a trace snapshot after every stage and the complete trace at the end (all under the id `trace`). Tests: ≥2 traces, growing stage lists, candidates visible before retrieval ends; route test updated. |
| F-5 | **Fixed.** Retrieval failures that are neither aborts nor `PlatformError` become a fixed `provider-unavailable` message (HyDE, embedding API, driver errors); aborts keep their reason. The `services:up:db` hint is not added for post-handle outages (the message points at the knowledge base / embedding settings). |
| F-6, F-13 | **Plan reconciled / noted.** Stage name `fuse` → `fusion` in plan.md; HyDE-on-`structuredModel`, scenario-test path, eval set without unrelated questions and the agent route's required `personaId` are recorded in tasks.md Implementation Notes (tasks 10, 13, 14, 15). |
| F-8 | **Deferred (W5).** HyDE + Multi-Query together has no sample question in `mock`; the combination is covered by pipeline tests with fake models. To be considered when the `/rag` page offers input examples. |
| F-9 | **Partly.** The shared-registry route test stays unprovable with one fixed scenario (unit tests cover it). Mid-search abort is covered by the new "retrieval abort stays an abort" test; an agent-route 503 test is deferred to 23 (real-server E2E). |
| F-14 | **Fixed.** Stale `m2.test.ts` references replaced in m2-1.ts, m2-2.ts and tasks-w4.md. |
| F-15 | **Recorded.** The 30 s timeouts on two PGlite-start tests (`schema.db.test.ts`, `platform.test.ts`) are listed in tasks.md 15.5 notes. |
| F-7, F-10–F-12, F-16–F-19 | **Deferred (LOW)**, no behavior change in W3; revisit in the W6 review pass. |
