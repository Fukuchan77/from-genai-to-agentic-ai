# Adversarial Review: 002 rag-and-workflows, Wave W6 (tasks 24–27, plus the out-of-boundary `hookTimeout` change)

- Date: 2026-10-13
- Scope: the uncommitted working tree on `feat/m2-w1-foundation`.
  - Untracked files:
    - `packages/eval-suite/tests/regression/rag-eval-set.db.test.ts`
    - `packages/eval-suite/tests/capability/rag-{retrieval,judge}.local.test.ts`
    - `docs/modules/2-{1,2,3,4}-*.md`
    - `docs/phases/phase-2.md`
  - Modified files:
    - `packages/eval-suite/tests/capability/README.md`
    - `docs/{README.md,modules/index.md}`
    - `specs/002-rag-and-workflows/{research,traceability,tasks}.md` and `pdca/do.md`
    - `.sdd/steering/{tech,structure}.md`, `AGENTS.md`
    - `specs/curriculum/changes-from-drafts.md`
    - `packages/ai-core/vitest.config.ts`, `apps/web/vitest.config.ts`
- Inputs:
  - spec.md Req 1.5, 1.7, 1.12, 2.2, 2.9, 2.10, 2.12, 3.1, 3.13, 4.7, 4.8
  - tasks.md §24–27
  - plan.md C12 (`cooperateByRole` contract)
  - research.md I-7, I-8, ADR-8, and "M2 実測（W6）"
  - sources (`ai-core/src/{rag,workflows,patterns}`, `apps/web/{app,components}`, `catalog.ts`, `defaults.ts`)
  - the raw logs in the session scratchpad: `local-run.log`, `token-run.log`, `repeat.log`, `repeat2.log`, `mutation.log`
  - the hub clone `/Users/Shared/codes/vaz-agentic-ai-next`
- Prior reviews read: the W5 impl review (APPROVE_WITH_NOTES, no HIGH). No W6 finding repeats a W5 finding.

## Evidence gathered (read-only)

- `TURBO_FORCE=true mise run gate` exited 0. Per workspace:
  - root: `executed=352`
  - ai-core: `executed=1732 skipped=4`
  - web: `executed=733`
  - eval-suite: `executed=8 passed=8 skipped=8` (skip reason `Local tests require AI_TEST_RUN_MODE=local.: 8`)
  - docs: `Docs: 8 module documents, 110 test references verified`
- Hook durations in my gate run were close to the old 10 s default:
  - `rag-eval-set.db.test.ts`: 8604 ms
  - `agentic.db.test.ts`: 7797 ms
  - `migrate.db.test.ts`: 7696 ms
- `mise run check:repo-rules`: all 11 rules ran, and each scanned a non-zero number of files (`workflow-no-agent-loop: scanned 34 FILES`). `mise run check:model-ids`: 384 files scanned. A grep of the new docs found no model-ID literals; only `catalog:` references are used.
- `ollama show granite4.2:latest` reports `parameters 8.8B`, so the "8.8B" figure is correct for the chat model.
- The hub pages `docs/guide/{context,loop,agentic}-engineering.md`, `docs/adr/0005-durable-workflow-engine.md` and `packages/agents/src/supervisor.ts` all exist in the local hub clone.
- The 18-pattern names match Liu et al., arXiv 2405.10467:
  - Passive / Proactive Goal Creator
  - Prompt/Response Optimiser
  - RAG
  - One-Shot / Incremental Model Querying
  - Single / Multi-Path Plan Generator
  - Self / Cross / Human Reflection
  - Voting / Role / Debate-Based Cooperation
  - Multimodal Guardrails
  - Tool/Agent Registry
  - Agent Adapter
  - Agent Evaluator

  The table has 18 rows: 7 newly implemented, 5 existing parts, RAG, and 5 explanation-only.
- Measured numbers against the raw logs:
  - Every figure in 25.1-a (recall@5 and hit rate), 25.1-b (32/32, 9/10, 0/10), 25.1-c (verdicts and scores) and the in-scope row of 25.1-d (0.710 / 0.762 / 0.822 / 0.858 / 0.938, 32/32) matches `local-run.log` exactly.
  - The 25.2 per-trial totals, the averages (2433.3 / 1926.0) and the ratios (1.495 → 1.50, 1.183 → 1.18, 1.112 → 1.11, mean 1.26) match `token-run.log`.
  - The out-of-scope row of 25.1-d (0.627 … 0.746, 8/8) has **no saved raw output** (see F-3).
- `hookTimeout` justification:
  - `repeat.log` run 6/10 failed with `Hook timed out in 10000ms` in `src/rag/agentic.db.test.ts`, `src/rag/query.db.test.ts` and `src/rag/retrieve/pipeline.db.test.ts`. That run started at 22:00:31, after Stryker had finished at 22:00:20, so the failures were not caused by an overlapping mutation run.
  - `repeat2.log` passed 10/10.

## Verdict

**REQUEST_CHANGES.** There are no CRITICAL or HIGH findings, and the gate is green. The numbers that do have a raw log were transcribed correctly.

However, this wave's deliverables are the measurement record and the learner docs, and several statements in them are wrong or stronger than the evidence:

- The timeout chronology in research.md contradicts the log (F-1).
- The bolded claim that HyDE and Multi-Query make results worse rests on one sampled run (F-2).
- The out-of-scope similarity numbers have no saved output (F-3).
- 25.2 measured a different comparator than the task asked for, with a script that was then deleted (F-4).
- Some mock-mode hands-on steps cannot produce what they describe (F-6).
- The 27.2 verification ("no stale rule count") is false (F-7).

All of these are document fixes; F-4 may also need a re-run. The `hookTimeout` change is justified (F-15).

## Critique

### [MEDIUM] F-1 research.md misstates when the retrieval table was produced, and the source run's assertions were never evaluated
**Location**:
- specs/002-rag-and-workflows/research.md:308
- specs/002-rag-and-workflows/pdca/do.md (Task 25, first bullet)
- specs/002-rag-and-workflows/tasks.md (§24 notes, third bullet)

**Issue**: research.md says the table came from a run that finished before the timeout ("タイムアウト前に完了した初回の実行"). do.md and tasks.md say the timeout hit "immediately after printing" / "right after printing". The log shows the table was printed **after** the 1-hour timeout fired.

**Evidence**: In `local-run.log`, the comparison `console.table` (naive 70.8% …) is headed `stdout | … > observes how often granite4.2 returns three valid Multi-Query sub-queries (regenerations)`, which is the **second** test. Vitest assigns stray output to the test that is running at that moment. The first test is reported as `× compares mean recall@k … 3600062ms` / `Error: Test timed out in 3600000ms`. So the comparison loop was still running when the timeout fired, and it finished at some point during the second test's 557 s. The post-print assertions (`perQuestion` lengths, `naive.meanRecall > 0`) ran on a promise the runner had already abandoned, so their outcome was never reported. Elsewhere, research.md states "初回は約 60 分", while the run actually exceeded 60 minutes.

The values themselves are complete: `compareMethods` returned, and 32 questions × 5 combinations were printed. Only the description of how they were produced is wrong.

**Confidence**: high

**Fix**:
- Reword research.md:308 along these lines: "the comparison exceeded the then 1-hour timeout. Vitest recorded the test as failed and moved on; the comparison kept running, finished during the next test, and printed the complete table. The test's own completion assertions were therefore never evaluated." Make the same correction in do.md and in the tasks.md notes.
- Preferably, re-run the comparison under the 3-hour timeout so a green run backs the table (it is already on the human list as item 3; make that the recommended action, not an optional one).

### [MEDIUM] F-2 The docs state "HyDE and Multi-Query were worse than naive" in bold from one sampled run where the gaps are 1–2 questions, and give a cause that was not checked
**Location**:
- docs/modules/2-2-advanced-rag.md:123
- specs/002-rag-and-workflows/research.md:306
- specs/002-rag-and-workflows/tasks.md (§25 notes)

**Issue**: The hit-rate gap between naive and HyDE is **one question** (24/32 vs 23/32), and between naive and Multi-Query it is two (24/32 vs 22/32). Both methods depend on LLM sampling (the model runs at Ollama's default `temperature 1`), the run was done once, and research.md itself says re-running would change the values. Doc 2-2 nevertheless bolds the claim and adds an unhedged explanation: "小型のモデルが書く仮想回答やサブクエリが質問の意図から外れると、検索はかえって悪くなりえます". research.md marks that explanation as "個々の出力は未確認の推測", but the doc drops the hedge.

There is also a structural explanation the doc does not mention. `runRetrieval` drops the original question once HyDE or Multi-Query is on (`searchText = hypothetical.text`; `queries = expanded.subQueries`, pipeline.ts:113, 129). With both on, the sub-queries are generated **from the hypothetical answer**, not from the question (pipeline.ts:121–124). Either effect could explain the drop without any model weakness.

Only hybrid vs naive (30/32 vs 24/32) involves no sampling, so it is the only robust comparison here.

**Confidence**: high

**Fix**: Remove the bold, and say the HyDE / Multi-Query differences are within 1–2 questions in a single run. Keep the speculative cause hedged as research.md does. Mention the pipeline design (the original question is not searched when HyDE or Multi-Query is on, and HyDE feeds Multi-Query) as a candidate cause the learner can test with `perQuestion`.

### [MEDIUM] F-3 The out-of-scope similarity numbers (the main evidence that "0.5 never says no evidence") have no saved output, and their run is only partly disclosed
**Location**:
- specs/002-rag-and-workflows/research.md:89, 334–341
- docs/modules/2-1-typescript-native-rag.md:145–150
- docs/modules/2-2-advanced-rag.md:153–158
- specs/002-rag-and-workflows/pdca/do.md (Task 25)

**Issue**: The 8-question out-of-scope row (min 0.627, p25 0.684, median 0.706, p75 0.711, max 0.746, 8/8 ≥ 0.5) appears in no saved log. `local-run.log` contains only the 32-question in-scope table, printed by an earlier version of the test whose title differs from the current one. do.md says the numbers came from the 3-question re-run ("a 3-question run passed in 148 s (also gave the 8-question out-of-scope similarity table, added to the similarity test afterwards)"). That wording leaves unclear whether the out-of-scope code existed in the test at the time or was an ad-hoc script.

research.md:341 does disclose that the two rows come from different runs. It does not say that the re-run used `RAG_EVAL_QUESTIONS=3`, or that no raw output was kept. The docs show both rows in one table with no note, and the docs and the I-8 update rest their headline conclusion on this row.

**Confidence**: high (no log), medium (on what was actually run)

**Fix**: Re-run the similarity test (it needs no LLM, about 1 s after ingest) with the current file and save the output. Then state in research.md: the command (`RAG_EVAL_QUESTIONS=3 … vitest run -t "top-1 cosine"`), the date, and that the out-of-scope row does not depend on the question limit. Add the "measured in a separate run" note under the table in 2-1 and 2-2.

### [MEDIUM] F-4 25.2 compared Role-Based against a custom 2-tool agent instead of the `/agent` the task named, the script was deleted, and the 1.26× conclusion depends on that choice
**Location**:
- specs/002-rag-and-workflows/research.md:347–363
- docs/modules/2-4-agent-design-patterns.md:126–135, 164–169
- specs/002-rag-and-workflows/pdca/do.md ("Throwaway script for 25.2 … deleted")

**Issue**: Task 25.2 asks for a comparison with "M1 の `/agent`（単一エージェント + ツール）". The real `/agent` route builds a persona system prompt and five tools: currentTime, calculator, currencyConvert, weather and webSearch (`apps/web/app/api/agent/tools/route.ts:70-79`). The measurement instead used `createGuardedAgent` with only the two tools the task needs. Fewer tool schemas and no persona mean fewer input tokens per step, so the single-agent baseline is smaller than `/agent` would give, which inflates the ratio. The script (`zz-token-compare.local.test.ts`) was deleted, so nobody can reproduce or audit it.

Doc 2-4 has two further mismatches:
- Hands-on step 3 tells learners to run the "利用状況の調査と集計" sample and send "the same task" to `/agent`, then compare with "上の表". The table, however, used a different task ("今の時刻を確かめ、1 日 8 時間…") and a different single-agent setup, so the learner's numbers are not comparable.
- research.md discloses "同じ 2 つのツールを全部持つ", but neither it nor the doc flags this as a deviation from the task.

**Confidence**: high (deviation, script deleted), medium (direction of the bias)

**Fix**: Either re-measure through the actual `/agent` route handler (or `createGuardedAgent` with the same tool set and persona), or record the deviation explicitly as a limitation in research.md and 2-4. Commit the comparison as a `*.local.test.ts` (or a script under `scripts/`) so it can be reproduced. Align hands-on step 3 with the measured task, or say its numbers will differ.

### [MEDIUM] F-5 The measurement shows the Role-Based demo's "final deliverable" is the reviewer's approval comment, and the wave records this as a cost observation, not as a Req 4.7 gap
**Location**:
- specs/002-rag-and-workflows/research.md:361
- docs/modules/2-4-agent-design-patterns.md:135
- packages/ai-core/src/patterns/demos.ts:243-246
- packages/ai-core/src/patterns/role-based-cooperation.ts:132

**Issue**: Req 4.7 says the pattern returns "役割ごとの出力と最終成果物". `cooperateByRole` sets `final` to the last role's text. In the demo, the last role is a reviewer told to "承認するか、直す点を短く述べてください". So in all three measured trials `final` was "承認します。…", not the report the task asked for. research.md explains this away as "`final` の定義が「最後の役割の出力」であるため", but plan C12 does not define `final` that way; it gives only `{ outputs; final; stopped? }`.

The code is from W4. W6 is where the evidence surfaced, and no follow-up or gap was recorded.

**Confidence**: medium

**Fix**: Record this as a gap in traceability.md (Req 4.7) and decide on one of two options:
- make the reviewer return the approved deliverable (or revise it), or
- define `final` in plan C12 as the last role's output and say in 2-4 that the deliverable is in `outputs[n-2]` when the last role is a reviewer.

### [MEDIUM] F-6 Mock-mode hands-on steps in 2-1 and 2-2 cannot show what they describe
**Location**:
- docs/modules/2-1-typescript-native-rag.md:175–185
- docs/modules/2-2-advanced-rag.md:166, 174

**Issue**: The `mock` embedding finds a chunk only for its exact text: "The mock embedding finds a chunk only for its exact text", per the comment in `apps/web/e2e/real-server.spec.ts:4`. Different texts have similarity ≈ 0.

- 2-1 step 2 says `mock` "でも画面の流れは確かめられる" with the question "RAG とは何ですか。". In mock that question returns "該当なし", not footnotes and cards.
- 2-1 step 3 (mode `mock`) asks the learner to raise the threshold toward 1 and see "同じ質問" turn into "該当なし". In mock, a natural question is already "該当なし" at 0.5. An exact-text question has similarity 1.0, which stays above any threshold ≤ 1 (the threshold is inclusive), so it never flips.
- 2-2 step 1 says mock shows the flow with "「曖昧な質問」". There is no such sample, and natural questions find nothing in mock.

Neither doc mentions that mock questions must be pasted chunk text.

**Confidence**: high

**Fix**: Add a note: in `mock`, retrieval finds only a chunk whose exact body is pasted as the question (for example, copy a paragraph of the evaluation corpus). Rewrite 2-1 step 3 to use that, with a threshold above 1.0 being impossible, or move the threshold experiment to `local`. Drop the quote marks around 曖昧な質問, or point to a concrete example.

### [MEDIUM] F-7 Task 27.2's Verify (no stale rule count) is not met, and the Implementation Note says it was checked
**Location**:
- docs/modules/1-1-dev-environment.md:32
- specs/002-rag-and-workflows/tasks.md:265

**Issue**: 1-1 still says "リポジトリの規則（9 規則。…）", but there are now 11 rules. The note "`grep` for "9規則"/"未作成" found no stale references" was true only for the no-space spelling "9規則"; the stale text uses "9 規則".

**Evidence**:
- `grep -rn "9 規則" docs` → `docs/modules/1-1-dev-environment.md:32`
- `check-repo-rules` lists 11 rules

**Confidence**: high

**Fix**: Update 1-1 (a one-line amendment outside 27.2's boundary; record it), and correct the tasks.md note. Grep both spellings (`9 *規則`).

### [LOW] F-8 AGENTS.md and the curriculum status are contradictory or stale
**Location**: AGENTS.md:7, AGENTS.md:42

**Issue**:
- The paragraph still opens "Milestone 1 implementation is underway:" and then says "Milestone 1 is complete".
- The architecture bullet still says "Later milestones add areas such as `workflows/` (M2)", but `workflows/` now exists.

**Confidence**: high

**Fix**: Change the opener to past tense ("Milestone 1 delivered: …"). Change the bullet to "M2 added `structured/`, `rag/`, `workflows/`, `patterns/`; M4 adds `harness/`".

### [LOW] F-9 Measurements are attributed to the wrong model or purpose in the docs
**Location**:
- docs/modules/2-1-typescript-native-rag.md:150
- docs/modules/2-2-advanced-rag.md:112, 125, 158, 264

**Issue**:
1. The similarity distribution is a property of the **embedding** model (`nomic-embed-text`), but both docs say "この数値は 8.8B 級の `local` モデルの環境で…". 8.8B is the chat model.
2. 2-2:264 says "HyDE の生成は用途 `chat`", but `runRetrieval` uses `deps.structuredModel` for HyDE (pipeline.ts:106), and `/api/rag/query` resolves `purpose: "structured"` when HyDE is on (route.ts:43-49).
3. 2-2:112 cites `catalog: local.ollama.chat` for the comparison, but the test uses `purpose: "structured"`.
4. 2-2:125 puts the footnote row under the header `catalog: local.ollama.structured`, but the footnote test uses `purpose: "chat"`.

The values are the same Ollama tag (granite4.2), but the references are wrong.

**Confidence**: high

**Fix**: Use "埋め込みモデル（`catalog: local.ollama.embedding`）" for the similarity numbers, `structured` for HyDE and Multi-Query, and `chat` for the footnote row.

### [LOW] F-10 Hands-on 2-2 step 3 cannot be followed as written: `perQuestion` is not printed, and the run takes about an hour with no warning
**Location**:
- docs/modules/2-2-advanced-rag.md:183–192
- docs/modules/2-1-typescript-native-rag.md:150
- packages/eval-suite/tests/capability/README.md

**Issue**:
- The step says "**どの手法が、どの質問で効いたか**を `perQuestion` で確かめます", but `rag-retrieval.local.test.ts` prints only the means (lines 183–196).
- `mise run test:local` runs the full comparison: about 60 min in the recorded run, about 26 min by research.md's estimate, and "about an hour" by the test comment at line 37. Neither the doc nor the README mentions this or the `RAG_EVAL_QUESTIONS` knob.
- 2-1 and 2-2 tell learners to "自分の環境で測ってください" using the same file, which also requires the whole comparison unless they use `-t`.
- The three duration figures are mutually inconsistent.

**Confidence**: high

**Fix**: Print a per-question table, or drop the instruction. Document the runtime, `RAG_EVAL_QUESTIONS=<n>`, and a `-t` filter for the similarity test. Align the test comment with research.md's estimate.

### [LOW] F-11 Always-true or near-tautological assertions in the new tests
**Location**:
- packages/eval-suite/tests/capability/rag-judge.local.test.ts:178
- packages/eval-suite/tests/capability/rag-retrieval.local.test.ts:203-204
- packages/eval-suite/tests/regression/rag-eval-set.db.test.ts:79-83, 121-123

**Issue**:
- `expect(withFootnote).toBeLessThanOrEqual(sample.length)` cannot fail, because the counter increments at most once per sample.
- `meanRecall` between 0 and 1 holds by construction in `recallAtK`.
- The regression test's `eval:`-prefix check runs on a DB that contains only the eval corpus, so it fails only if the source→prefix mapping breaks.
- The `scores 0 when …` test re-tests `recallAtK` (already covered by `recall.test.ts`) and adds a fifth "executed" count without exercising the harness.

The regression test's core assertions are meaningful, and PROVE is recorded: a corrupted gold ID fails two tests, and a wrong question fails `noEvidence`. However, it does not exercise `compareMethods`, which is what the `local` comparison actually uses, or the hybrid path.

**Confidence**: high

**Fix**:
- In the footnote test, replace the vacuous expect with a completion check (`expect(answersSeen).toBe(sample.length)`).
- In the regression test, drive the recall@1 check through `compareMethods` with a single `naive` combination, so the harness the local test relies on is covered at the gate.
- Drop or rename the recallAtK duplicate.

### [LOW] F-12 "Median" and quartiles are nearest-rank upper values, not the usual definition
**Location**: packages/eval-suite/tests/capability/rag-retrieval.local.test.ts:269-277; research.md:338–339

**Issue**: `quantile(0.5)` returns `sorted[floor(0.5 * n)]`. For n = 8 that is the 5th value, and for n = 32 the 17th, not the mean of the two middle values. The labels say 中央値 / 第 1 四分位 with no definition.

**Confidence**: high

**Fix**: Either compute the conventional median or label the values "nearest-rank (upper)". The conclusions do not change.

### [LOW] F-13 Docs claim small models "cannot keep exactly 3", but the only observations are 32/32 and 6/6
**Location**: docs/modules/2-2-advanced-rag.md:36, 267

**Issue**: The doc says "小型のモデルは「ちょうど 3 件」を守れないことがあり、再生成の回数が増えます", but the W6 run (32/32 on the first try) and I-7 (6/6) never observed a failure. The schema does not constrain length (`z.array(z.string())`), so this is genuine model compliance, and the claim has no support in this repository's measurements.

**Confidence**: medium

**Fix**: Phrase it as a possibility the code guards against ("守れない場合に備えて…。この環境の実測では 32/32 が 1 回目で有効だった").

### [LOW] F-14 UI labels quoted in hands-on steps do not match the UI
**Location**: docs/modules/2-2-advanced-rag.md:181; docs/modules/2-2-advanced-rag.md:174

**Issue**:
- The doc quotes 「スキップ（キー未設定）」, but the UI shows the status `スキップ` (StageProgress.tsx:39) and the trace text "Rerank の API キーが未設定のため、スキップしました。" (TraceView.tsx:11).
- 「曖昧な質問」 is not a sample. (The pre-existing MethodSwitches note "有効にしても検索はスキップされます" also says *search* is skipped when only Rerank is; that is out of W6 scope.)

**Confidence**: high

**Fix**: Quote the actual strings, or describe them without quote marks.

### [LOW] F-15 `hookTimeout: 60_000` is justified but sits outside every W6 boundary
**Location**: packages/ai-core/vitest.config.ts:27-29; apps/web/vitest.config.ts:47-48

**Issue**: The change is outside tasks 24–28's `_Boundary:_`. The evidence supports it:
- `repeat.log` run 6/10 failed with `Hook timed out in 10000ms` in three ai-core PGlite `beforeAll` hooks, with no overlapping Stryker run.
- In my own gate run, `.db.test.ts` files took 7.7–8.6 s under the parallel turbo run.
- `gate:repeat` then passed 10/10.

The change only relaxes the hook timeout, so a hung hook still fails after 60 s, and no test outcome is masked. The deviation is recorded in the tasks.md §24 notes and do.md, but not in the traceability Gaps list of intended boundary exceptions, which is where W5 recorded its amendments. `packages/eval-suite/vitest.config.ts` was left at the default and relies on per-hook timeouts instead, which is inconsistent.

**Confidence**: high

**Fix**: Keep the change. Add it to the traceability "Gaps" list of intended boundary exceptions. Optionally, apply the same `hookTimeout` in `packages/eval-suite/vitest.config.ts` for consistency.

### [LOW] F-16 `docs/README.md` was edited outside task 26's boundary
**Location**: docs/README.md:12, 16

**Issue**: `docs/README.md` is not in the `_Boundary:_` of task 26 (or any W6 task). The edit is correct and small.

**Confidence**: high

**Fix**: Record it as a boundary amendment in the task 26 notes.

### [LOW] F-17 Traceability's "同上" makes the Role-Based row read as "未実施。人が行う"
**Location**: specs/002-rag-and-workflows/traceability.md:150

**Issue**: The Role-Based token row's status is "同上", and the row above it is the Cohere row, whose status is "未実施。**人が行う**". The token comparison was in fact measured.

**Confidence**: high

**Fix**: Write the status explicitly: "実測の結果は research.md「M2 実測（W6）」25.2".

### [LOW] F-18 Debatable pattern mapping: One-Shot Model Querying → `generateValidated`
**Location**: docs/modules/2-4-agent-design-patterns.md:80

**Issue**: In Liu et al., One-Shot Model Querying means generating the whole plan in a single foundation-model query, as opposed to Incremental Model Querying. `generateValidated` is a single-call helper with up to 2 regenerations, which is closer to a retry wrapper. `planSinglePath` (one structured call producing every step) is the closer match.

**Confidence**: low

**Fix**: Map #5 to `planSinglePath` / `generateValidated`, and say briefly why.

### [LOW] F-19 "元教材の第11章" does not name the book
**Location**: docs/modules/2-4-agent-design-patterns.md:29

**Issue**: Book A's chapter 11 is external tools, while book B's (2_ai-agent) chapter 11 is the 18 patterns (sources.md:39, 59). The sentence is ambiguous.

**Confidence**: high

**Fix**: Write "2_ai-agent 第11章".

## Risk trigger

The trigger was the out-of-boundary `hookTimeout` change. **Confirmed as justified** (F-15): the failure was reproduced in `gate:repeat` run 6/10, the root cause is PGlite WASM start-up under parallel load, and the fix does not mask failures. Only the bookkeeping is missing.

## Hallucination Signal
forced: false

## Response (2026-10-14)

Verdict was `REQUEST_CHANGES` (no CRITICAL/HIGH). All 19 findings were handled; none was left silently. "Decision needed" items are on the human list.

| ID | Outcome | What changed |
|---|---|---|
| F-1 | Fixed (docs). Re-run **not** done | research.md 25.1-a, do.md, tasks.md §24 now say the comparison exceeded the 1-hour timeout, was recorded as failed, finished during the next test, and its own assertions were never evaluated. A green full run is the recommended human item 3. |
| F-2 | Fixed (docs) | Bold removed in 2-2 and research.md; the 1–2 question gap, single sampled run and the pipeline-design candidate cause (original question not searched under HyDE/Multi-Query; HyDE feeds Multi-Query) are stated. Hybrid vs naive (30/32 vs 24/32) is named as the only sampling-free comparison. |
| F-3 | Fixed (re-measured) | Similarity test re-run alone on 2026-10-14 (`-t "top-1 cosine"`, 5 s, embeddings only): both rows came from one run and equal the earlier values. Command, date and the nearest-rank definition are in research.md 25.1-d; 2-1 and 2-2 point to it. Raw log kept in the session scratchpad only. |
| F-4 | Fixed as a recorded limitation. Re-measure **not** done | research.md and 2-4 state that the baseline had 2 tools and no persona, unlike `/agent` (5 tools + persona), that the 1.26 ratio is therefore likely overstated (direction is an inference), and that the script was deleted. Hands-on step 3 now says its numbers are not comparable with the table. Decision needed: re-measure through `/agent` or accept (human item 4). |
| F-5 | Recorded as a gap. Code/plan **not** changed | traceability.md Gaps records the Req 4.7 gap and the two options (fix the demo, or define `final` in plan C12); 2-4 and research.md state the current behaviour. W4 code and the approved plan are out of W6's boundary. Decision needed (human item 5). |
| F-6 | Fixed (docs) | 2-1 and 2-2 say the `mock` embedding matches only exact chunk text and tell the learner to paste a corpus paragraph; the threshold experiment moved to `local`; the "曖昧な質問" quote is replaced by a pointer to `eval-set.json`. |
| F-7 | Fixed | `docs/modules/1-1-dev-environment.md` 9 → 11 rules; the tasks.md 27.2 note now records that the first grep missed the spaced spelling. `grep -rn "9 *規則"` over docs, steering and AGENTS.md returns nothing. |
| F-8 | Fixed | AGENTS.md: "Milestone 1 delivered:" and "M2 added `structured/`, `rag/`, `workflows/`, `patterns/`; M4 adds `harness/`". |
| F-9 | Fixed (docs) | Similarity attributed to the embedding model; HyDE and Multi-Query to `structured`; footnotes to `chat`. |
| F-10 | Fixed | The comparison test now prints a per-question table; the README and 2-2 state the run time (about 26 min alone, 1 h+ under load), `RAG_EVAL_QUESTIONS=<n>` and `-t "top-1 cosine"`; the test comment matches research.md. Checked with a 2-question local run (113 s; the table printed). |
| F-11 | Fixed (tests) | Footnote test asserts `answersSeen === sample.length`; the always-true `meanRecall` range checks and the `recallAtK` duplicate are gone; the gate regression now drives recall@1 through `compareMethods`. PROVE: appending text to the question makes it fail (`expected [ …(40) ] to deeply equal []`). |
| F-12 | Fixed | Columns are labelled "(nearest rank)"; research.md says so. |
| F-13 | Fixed (docs) | The claim is phrased as a safeguard; the 32/32 observation is quoted. |
| F-14 | Fixed (docs) | Real UI strings quoted. |
| F-15 | Recorded | Added to traceability Gaps. `eval-suite/vitest.config.ts` left at the default (per-hook timeouts in the new test). |
| F-16 | Recorded | tasks.md §26 note and traceability Gaps. |
| F-17 | Fixed | The Role-Based row now says "実測済み" with the `/agent` caveat. |
| F-18 | Fixed (docs) | #5 now maps to `planSinglePath`, with `generateValidated` named as the layer below. |
| F-19 | Fixed (docs) | "`2_ai-agent` の第 11 章". |

Verification after the fixes: `TURBO_FORCE=true mise run gate` → exit 0 (`//:test executed=352`, `@platform/ai-core executed=1732 skipped=4`, `web executed=733`, `eval-suite executed=7 skipped=8`, `Docs: 8 module documents, 110 test references verified`). The first gate run after the F-11 test rename failed in `docs:check` because 2-2 still cited the old test name; the reference was updated.
