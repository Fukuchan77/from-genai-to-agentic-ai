# 003-domain-agents W8 adversarial review (2026-10-29)

Scope: W8 "評価・解説・統合" (tasks 37–42) in the working tree of `feat/m3-w1-foundation`. This covers the five new regression tests, the four new capability tests and the capability `README.md`, the docs `docs/modules/3-1`〜`3-6`, `docs/phases/phase-3.md` and `docs/modules/index.md`, `scripts/check-docs.mjs` and its test, `specs/003-domain-agents/{research,traceability,tasks}.md`, `.sdd/steering/{tech,structure}.md`, `AGENTS.md`, and `specs/curriculum/{changes-from-drafts,README,security,sources}.md`.

Inputs read: tasks.md (the W8 section, its Implementation Notes and the W6/W7 carry-overs), research.md ("W8 の実測" and "W8 の最終統合の実測", ADR-5, ADR-6, I-5 / the 2026-10-19 arXiv measurement), plan.md (line 307 on research, line 351 on the council, the `CouncilRound` row at line 504), spec Req 4.8, and the W7 review (F-11, F-17, F-18). I checked the implementation the tests and docs describe: `marketing/council.ts`, `patterns/role-based-cooperation.ts`, `marketing/recommend.ts`, `research/supervisor.ts`, `research/citations.ts`, `analysis/attempts.ts`, `analysis/agent.ts`, `sandbox/lifecycle.ts`, `sandbox/docker/provider.ts`, `config/defaults.ts`, `aci/fatal.ts`, `aci/tool-set.ts`, `agents/guarded-agent.ts`, `mcp/github.ts`, `mcp/connect.ts`, `requirements/*`, `tooling/vitest/network-guard.ts`, `packages/eval-suite/vitest.config.ts`, `mise.toml`, `scripts/check-repo-rules.mjs` and `pnpm-workspace.yaml`.

Commands run (read-only):
- `env -u NODE_ENV AI_TEST_RUN_MODE=mock AI_TEST_SUITE=gate mise exec -- pnpm --filter @platform/eval-suite exec vitest run`: 14 files, 39 passed, 12 skipped.
- `env -u NODE_ENV mise run docs:check`: 14 documents, 245 test references verified.
- `env -u NODE_ENV mise run gate`: exit 0. root 427, ai-core 3,681 passed / 4 skipped, web 1,660, eval-suite 39 / 12 skipped, 13 repo rules. These match research.md line 570.
- `env -u NODE_ENV mise run audit`: fails on GHSA-6pq8-jhm2-2vcw (`qs`, a dev-only path through Stryker). This matches research.md.
- `AI_TEST_RUN_MODE=local AI_TEST_SUITE=local … vitest run tests/capability/analysis-fix.local.test.ts`: skipped with the "No Docker Engine answered …" reason (Ollama was reachable).
- `env -u NODE_ENV mise run test -- research-budget` (the command in 3-4, hands-on step 2): fails with `Could not find task research-budget in project`.
- A scratch probe (vitest with a scratchpad config that aliases `@platform/ai-core/*`; no repo file touched) ran `runResearch` on the m3-4 `default` scenario under `maxTotalTokens` 960 / 7,000 / 10,000 / 20,000. The totals were **1,370 / 9,100 / 11,800 / 14,480** (see F-1).
- `git diff --stat HEAD -- packages/ai-core apps/web stryker.config.mjs specs/003-domain-agents/plan.md`: empty. There are no source changes outside tests and docs, as the caller required.

Risk triggers from the caller, answered:
1. Non-vacuous tests. Most of the five regression tests pin real behaviour. I read the implementation behind ≥ 8 assertions: the latch refusals in mcp-fatal-stop; `stepsUsed` 3 / 2, derived from CL-14 in helpdesk-plan; `dropped` with repeats collapsed and the cap applied after verification in marketing-catalog; the default 3 rounds and the moderator-overshoot branch in marketing-council; the call cap in research-budget. **The exception is the shared-token-budget half of 37.3, which never asserts the bound under pressure, and the run in fact overshoots it by 18–43 % (F-1).** The `spent <= max + moderatorTokens` bound in marketing-council is valid but loose: the real overshoot is at most `moderatorTokens − personaTokens` (F-21). The research thresholds are coupled to the fixture usage, which the authors acknowledge.
2. Numbers. Every number quoted in the docs and in changes-from-drafts matches research.md. The **interpretations** go further than the evidence in three places: hierarchical "3/3 citation-valid" (F-4), "draft changed" (F-5), and the cause given for the persona timeouts (F-2).
3. Docs honesty. Of the claims I checked against source, most were correct: sandbox limits, `maxSessions` 8, upload 20 MiB, 200 table rows, stderr 8,000, helpdesk 12 / 2 / 8, research reserve min(½, 20,000), arXiv 3 s / 1 day / 30 s cap, council ¼ reserve, persona counts 2–5 (marketing) and 1–5 (requirements), session id `crypto.randomUUID()`, the files allow list, the fatal codes, `MAX_RECOMMENDATIONS` 3. The false or stale ones are F-1, F-2, F-3, F-6, F-8, F-9 and F-11. On the authors' known-unverified list, the persona ranges and session-id generation are confirmed correct. The E2B lifetime (idle × 3) is correct in 3-3 but wrong in the steering (F-6). The "15 minutes" in ADR-6 is still unfixed and is propagated into tech.md.
4. analysis-fix. The test skips in every lane that exists, and research.md is honest about that. The 3-3 doc and the README checklist are not (F-3). The test's invariant on `fixes` also contradicts CL-26 (F-10).
5. check-docs. The new test fails if `checkModuleDoc` ignored topics (it expects the exact `missing topic heading:` error). Matching uses `includes`, so it is not trivially satisfiable. However, 3-1 got no MCP topics and 3-6 dropped the profile merge (F-12).
6. Process. The explanation for 42.1 is faithful (the audit is confirmed, and the E2E record shows 4 non-green runs). Three things are wrong: carry-overs assigned to 40.x and 41.x were dropped without a record while those boxes are ticked (F-7); the eval-suite skip count in the 37.x note is wrong (F-14); and 42.2 is ticked ahead of the 42.1 it depends on (F-22). No source files outside tests and docs changed.
7. AGENTS.md / steering. The 13-rule count and the area and route lists are correct. The steering misdescribes ADR-5 and the E2B lifetime (F-6). AGENTS.md says `seed:samples` seeds only the help desk and keeps a stale M2 status line (F-15).

## Verdict

**REQUEST_CHANGES.** Three HIGH findings: a false doc claim plus a regression test that does not pin the budget bound it claims to verify (F-1); a wrong causal explanation repeated in four places (F-2); a ticked capability task whose committed test can never run, described by the doc as runnable (F-3). Seven MEDIUM findings. All the fixes are in tests and docs except F-1's underlying overshoot, which plan.md line 307 says must not happen and which needs a human decision on whether to fix the code or the plan.

## Critique

### [HIGH] F-1 The research run overshoots `maxTotalTokens` in `mock`; the doc says it fits, and 37.3 does not pin the bound

**Location**: docs/modules/3-4-hierarchical-research.md:223; packages/eval-suite/tests/regression/research-budget.test.ts:148-203; specs/003-domain-agents/plan.md:307
**Issue**: The scripted m3-4 run spends 1,370 tokens under a 960 budget, 9,100 under 7,000 and 11,800 under 10,000. The doc says "960 トークンの予算でも合計が収まります", and plan C9 says "実行全体は `maxTotalTokens` に収まる（W5 レビュー F-1）". The regression test that 37.3 says verifies "共有トークン予算の上限" asserts the total against the cap only in the ample 20,000 case, where there is no pressure.
**Evidence**: Probe output: `PROBE 960 total 1370 calls 1 {"search":580,"supervisor":790}`, `PROBE 7000 total 9100 …{"search":4440,"supervisor":4660}`, `PROBE 10000 total 11800 …`. The test's own comment shows the overshoot without flagging it: "7,000 tokens: the Supervisor holds 3,500; the two searches use 4,440 of the sub-agents' share". 4,440 is more than the 3,500 share. The only total assertion is `expect(run.result.usage.total.totalTokens).toBeLessThanOrEqual(20_000)` in the "ample" test.
**Failure scenario**: A learner reads 3-4, sets `maxTotalTokens` as a hard cost cap, and pays 30–40 % more. Any regression that widens the overshoot passes the gate, because no test bounds `total` against `maxTotalTokens` under a tight budget.
**Confidence**: high (reproduced)
**Fix**: Correct 3-4 line 223 to report the measured totals. Add an assertion per budget, either `total <= max` (and then fix the code) or `total <= max + <one step>` with the soft-cap bound stated in plan C9. Record which one in plan.md line 307 and in tasks 37.3. The choice between them needs a human decision because the plan currently promises a hard cap.

### [HIGH] F-2 "The three parallel persona calls queue up" is false: the council calls personas one at a time

**Location**: specs/003-domain-agents/research.md:553; docs/modules/3-6-marketing-support.md:102, :182; specs/curriculum/changes-from-drafts.md:162; packages/eval-suite/tests/capability/council-agreement.local.test.ts:95-96
**Issue**: Every W8 artefact explains the `granite4.2` timeouts as council-internal parallel calls serialising on a 1-slot Ollama. `runCouncil` passes one role per `cooperateByRole` call, and `cooperateByRole` is a sequential `for … await` loop.
**Evidence**: council.ts:294-296 has `roles: queue.slice(0, 1).map(roleFor), // One persona per call`, and role-based-cooperation.ts:119 has `for (const role of params.roles) { … await guarded.agent.generate(…)`. The same doc says so itself at 3-6:36 ("発言1名ごとに `cooperateByRole` を1回呼ぶ"). 3-6:182 then says "ペルソナの呼び出しの直列化は行っていません", but they already are serialised.
**Failure scenario**: A learner who hits the timeout "fixes" it by adding Ollama slots and sees no change, or concludes that the council design is parallel. A plausible cause the authors did not rule out is Vitest running every `*.local.test.ts` file in parallel (the eval-suite config does not disable `fileParallelism`, and turbo runs the ai-core local tests at the same time) against the single slot. If that is the cause, the timings in 38.2–38.4 are contaminated too.
**Confidence**: high (code), medium (alternative cause)
**Fix**: Remove the "parallel" explanation from the five places. State the cause as unknown (each persona call alone exceeded 60 s, with 0 tokens). Record whether the capability files ran alone or together, and re-measure with `--no-file-parallelism` if they ran together.

### [HIGH] F-3 38.2 is ticked, but the committed analysis-fix test cannot run in any lane, and 3-3 says it can

**Location**: packages/eval-suite/tests/capability/analysis-fix.local.test.ts:93-97; docs/modules/3-3-data-analysis-agent.md:146, :171, :240; specs/003-domain-agents/tasks.md:265
**Issue**: The network guard allows the Ollama origin only when `AI_TEST_RUN_MODE=local`, and the Docker sockets only when `AI_TEST_SUITE=container`. The eval-suite config throws on `AI_TEST_SUITE=container` (its suites are gate / local / pg). So the test skips even when Docker and Ollama are both up, which I reproduced. Task 38.2 requires the test to use the available Docker provider and skip only if Docker is absent. The 38.2 numbers come from an uncommitted variant.
**Evidence**: The skip reason begins "No Docker Engine answered. Start Docker and set DOCKER_HOST if needed." 3-3:146 says "`mise run test:local` # analysis-fix.local.test.ts を含む。Ollama が無ければスキップ". 3-3:171 says "（`local` 専用。Ollama と Docker が無ければスキップされる）". Traceability line 95 and research.md line 526 do state the always-skip.
**Failure scenario**: A learner with Docker and Ollama running follows hands-on step 4, sees a skip whose message says Docker is not answering, and spends time debugging a working Docker. The 3/3 completion table in 3-3:240 cannot be reproduced from the repo.
**Confidence**: high (reproduced)
**Fix**: Either add a lane that allows both (for example a `local-container` suite in the eval-suite config and the guard, plus a mise task), or untick 38.2 and record it as blocked. Correct 3-3:146, :171 and :240, and put the guard explanation first in the skip reason.

### [MEDIUM] F-4 Hierarchical "3/3 citation-valid" is vacuous for 2 of 3 runs: those reports are the canned "調査できませんでした"

**Location**: docs/modules/3-4-hierarchical-research.md:108-117; specs/003-domain-agents/research.md:533-538; packages/eval-suite/tests/capability/research-quality.local.test.ts:124, :327
**Issue**: The Supervisor called no sub-agent on the broad and market questions. In that case `runResearch` discards the model text and returns `unableReport(theme)`, which has no citations, so it is trivially "citation-valid". The table puts this side by side with the single agent's 0/3 as if the two were comparable. The test's invariant `reportCharacters > 0` is also satisfied by this canned text.
**Evidence**: supervisor.ts:274 has `if (succeeded.length === 0) report = unableReport(theme);`, and unableReport returns "# 調査できませんでした …". The doc's own line 56 describes this fallback.
**Failure scenario**: A reader takes "hierarchical 3/3 vs single 0/3" as evidence that the hierarchical design improves citation hygiene. In fact two of its three "valid" reports are a refusal written by the platform. The line 120 summary "階層化はトークンを増やす方向に働く" is drawn from runs in which the hierarchy was mostly not exercised.
**Confidence**: high
**Fix**: Report citation validity only over runs whose report came from the model (≥ 1 successful sub-agent), or add a column "report source: model / fallback". Weaken line 120 to "this run does not show either direction".

### [MEDIUM] F-5 "Draft changed" is measured differently for the two arms; the single arm's "はい" is trivially true

**Location**: packages/eval-suite/tests/capability/council-agreement.local.test.ts:106, :147; docs/modules/3-6-marketing-support.md:48, :76-85; specs/curriculum/changes-from-drafts.md:162
**Issue**: The council arm compares `improvedDraft`, which only changes when a persona emits a parseable `<draft>` block, against DRAFT. The single arm compares the whole raw output `single.final.trim()` against DRAFT. Any commentary at all makes it "changed".
**Evidence**: `draftChanged: council.improvedDraft !== DRAFT` versus `draftChanged: single.final.trim() !== "" && single.final.trim() !== DRAFT`. In council.ts:320, `draft = extractDraft(statement.text) ?? draft`.
**Failure scenario**: The docs conclude "合議は合意したが文案は変わらなかった … 合意の判定と改善は別の事柄". The data equally fits "the small model never wrote `<draft>` tags", which is a format-compliance failure and not evidence about agreement versus improvement. The single arm's "はい" carries no information.
**Confidence**: high
**Fix**: Apply the same `extractDraft` to the single output, and report how many persona statements contained a `<draft>` block. Reword the 3-6 conclusion until that is measured.

### [MEDIUM] F-6 The steering misdescribes ADR-5 (it says "abort") and the E2B lifetime (it says "15 分")

**Location**: .sdd/steering/tech.md:84-85
**Issue**: tech.md says the fatal latch "記録して abort し". The code deliberately does not abort; it stops through a `stopWhen` condition (spike S-1), and 3-1 and changes-from-drafts say so. tech.md also repeats the "E2B の `timeoutMs` は 15 分" number that research.md:567 itself flags as contradicting `lifetimeMs ?? idleTimeoutMs * 3` (30 min).
**Evidence**: guarded-agent.ts:190-195: "A stop condition (not an abort) ends the loop because an abort drops the stream's `finish` part and `onEnd` (spike S-1)". lifecycle.ts:70 is `const lifetimeMs = params.lifetimeMs ?? idleTimeoutMs * 3;`.
**Failure scenario**: AGENTS.md tells agents to read the steering first. An agent that reads it "restores" the abort in `buildToolSet` or `createGuardedAgent` and reintroduces the lost-`finish` bug that S-1 found.
**Confidence**: high
**Fix**: Change tech.md:85 to the stop-condition description, and tech.md:84 to "アイドル × 3（既定 30 分）", or to "ADR-6 は 15 分、実装は 30 分（人の判断待ち）".

### [MEDIUM] F-7 Carry-overs assigned to 40.x and 41.x were dropped without a record while those boxes are ticked

**Location**: specs/003-domain-agents/tasks.md:187, :198, :406; specs/003-domain-agents/plan.md:504
**Issue**: Four carry-overs were assigned to these tasks:
- W6 → 41.x: sync `CouncilRound` / `data-council-result` into the plan's Data Model (F-20), and do the `council.ts` PROVE and the Stryker decision (2nd F-13).
- W7 → 40.x: F-17 (constants duplicated) and F-18 (detecting the unseeded state by message text).

plan.md is unchanged, and its `CouncilRound` row still reads `index; turns: { personaId; text }[]; verdict` while the code has `round; statements; missing; verdict?; draft`. No W8 note records the PROVE, the Stryker decision (`council.ts` is not in `mutate`), or F-17 / F-18. F-17 and F-18 are apps/web code changes, and W8 touched no apps/web file.
**Evidence**: `git diff --stat HEAD -- specs/003-domain-agents/plan.md apps/web` is empty. The 41 Implementation Notes only restate the carry-over. W7 review line 179 says "F-17 … と F-18 … は、W8 の 40.x で扱う".
**Failure scenario**: The W8 wave is archived and the tags are cut. The plan's data model stays wrong for M4 readers, and F-17 / F-18 vanish from every list.
**Confidence**: high
**Fix**: Do the plan sync, or record each item as carried to M4 / human decision in the 40 and 41 Implementation Notes and in traceability. Record the `council.ts` Stryker decision.

### [MEDIUM] F-8 The hands-on command in 3-4 step 2 fails

**Location**: docs/modules/3-4-hierarchical-research.md:145
**Issue**: `mise run test -- research-budget` expands to `turbo run test research-budget`, which treats `research-budget` as a task name.
**Evidence**: Output: "x Could not find task `research-budget` in project … [test] ERROR task failed".
**Failure scenario**: The learner's first step in the budget exercise errors out.
**Confidence**: high (reproduced)
**Fix**: Use `mise exec -- pnpm --filter @platform/eval-suite exec vitest run tests/regression/research-budget.test.ts`, with `AI_TEST_RUN_MODE=mock AI_TEST_SUITE=gate` as in 1-0, and run it in docs review.

### [MEDIUM] F-9 "429 / 503 / `Retry-After` are unmeasured" contradicts research.md's 2026-10-19 measurement

**Location**: docs/modules/3-4-hierarchical-research.md:222; specs/curriculum/changes-from-drafts.md:160; specs/003-domain-agents/traceability.md:212
**Issue**: research.md:61-64 records `curl` measurements of 429 (`text/html`, "Rate exceeded.", no Retry-After), 503 (HTML, `Retry-After: 0`) and 301, and line 286 says the bodies are pinned in `parse.test.ts`. The new W8 docs say these are unmeasured and that the fixtures are "推測に基づく". tech.md:142 states the measured result ("429 / 503 は HTML"), so the W8 artefacts disagree with each other.
**Evidence**: research.md:62: "**429**: `content-type: text/html`、本文は `Rate exceeded.`（14 バイト）". 3-4:222: "429、503、`Retry-After` の実際の挙動 … は未実測です".
**Failure scenario**: Readers underrate the evidence, and the next person to look at arXiv re-measures, or edits fixtures that were in fact taken from real responses.
**Confidence**: high
**Fix**: State what was measured (the status codes, content types and bodies) and what was not (the success feeds with several results or none, the HTTP 400 feed, retry behaviour against the live server). Also fix the stale research.md lines 482 and 490.

### [MEDIUM] F-10 The analysis-fix invariant `fixes <= 3` contradicts CL-26's per-failure counting

**Location**: packages/eval-suite/tests/capability/analysis-fix.local.test.ts:145
**Issue**: `result.fixes` is the cumulative count over the whole analysis. CL-26 gives each failure its own three fixes. A correct run of fail → fix → fix (success) → fail → fix → fix (success) has `fixes === 4` and fails the "invariant".
**Evidence**: attempts.ts:79-83: `if (lastFailed) { fixes += 1; openFixes += 1; }`, and `openFixes` is reset only on success. The doc says "数えるのは**失敗ごと**です" (3-3:74).
**Failure scenario**: If the lane from F-3 is added, a model that recovers twice is reported as a test failure. This is a false red, and it encodes the old cumulative rule that W4 F-3 rejected.
**Confidence**: high
**Fix**: Assert per-failure behaviour instead: no failure episode has more than `MAX_FIX_ATTEMPTS` fix runs, and `status === "attempt-limit"` follows the fourth consecutive failure. Alternatively, assert `attempts.length <= agent step limit`.

### [LOW] F-11 Stale "E2E is later" and "chromium only" statements in the new docs

**Location**: docs/modules/3-1-aci-and-mcp.md:308; docs/modules/3-4-hierarchical-research.md:229, :254; docs/modules/3-3-data-analysis-agent.md:271
**Issue**: The tag sections say E2E is not included or is a later deliverable, and 3-4 says the real-server check was chromium only. Yet `apps/web/e2e/{mcp,research,analysis}.spec.ts` exist from W7 (commit 5208b08) on three engines, and 3-3:196 itself lists the E2E spec.
**Evidence**: `ls apps/web/e2e` lists `mcp.spec.ts`, `research.spec.ts` and `analysis.spec.ts`.
**Failure scenario**: The tags `module/3-1` / `3-4` will contain E2E tests that their docs say they do not contain.
**Confidence**: high
**Fix**: Update the "含まれないもの" lines and 3-4:229.

### [LOW] F-12 REQUIRED_TOPICS omit 3-1's MCP topics and 3-6's profile merge

**Location**: scripts/check-docs.mjs:88-128
**Issue**: Task 40.8 adds topics for 3-1〜3-6. 3-1 keeps only the three pre-W8 ACI topics, although 40.1 lists the MCP server, allow list, annotations and risk, fatal latch and no-write-tools as the module's core. 3-6 lacks "利用者プロファイルのマージ" (an explicit item in 40.6). Deleting the whole MCP half of 3-1 would pass `docs:check`.
**Evidence**: `"3-1": ["ACI の失敗の多くは…", "Ground Truth に基づく進行", "エージェント設計の3原則"]`.
**Confidence**: high
**Fix**: Add "自作の MCP サーバー", "許可リスト", "注釈とリスク区分", "致命的エラーのラッチ" and "書き込み系ツールを登録しない理由" to 3-1, and "利用者プロファイルのマージ" to 3-6.

### [LOW] F-13 Checklist wording claims more than the referenced test proves

**Location**: docs/modules/3-3-data-analysis-agent.md:162; docs/modules/3-6-marketing-support.md:133; docs/modules/3-4-hierarchical-research.md:170, :173
**Issue**:
- 3-3:162 claims "成功・修正・上限到達の3つの経路" but references only the attempt-limit test.
- 3-6:133 names the three default personas, but the test uses personas `a`/`b`/`c` (council.test.ts:130).
- The test behind 3-4:173 ("回数に数えられず") asserts tokens only and never the call count.
- 3-4:170 says every reference is a gate test, then references a `*.local.test.ts`.

**Confidence**: high
**Fix**: Narrow the wording or add the references (the `fixed` scenario test; a default-persona order test).

### [LOW] F-14 The 37.x note says eval-suite has "8 件 `local` 専用スキップ"; the actual count is 12

**Location**: specs/003-domain-agents/tasks.md:244
**Evidence**: The run printed `executed=39 passed=39 failed=0 skipped=12`, and research.md:570 says 12.
**Confidence**: high
**Fix**: Change it to 12, or note that 8 was the count before 38.x.

### [LOW] F-15 AGENTS.md: `seed:samples` is "help-desk sample data"; `sandbox/` is "Docker sandbox"; M2 is "being finished"

**Location**: AGENTS.md:7, :19
**Issue**: `scripts/seed-samples.ts` also seeds the marketing catalog and personas (3-6 relies on that). `sandbox/` also holds E2B and mock. The M2 sentence "W6 … is being finished" is stale.
**Confidence**: high (the first two), medium (M2)
**Fix**: Update the three phrases. The mise.toml description of `seed:samples` is stale too (outside the W8 boundary).

### [LOW] F-16 changes-from-drafts says `@ai-sdk/mcp` may be imported in `mcp/` and `ports/`; the rule allows only `src/mcp/`

**Location**: specs/curriculum/changes-from-drafts.md:146
**Evidence**: check-repo-rules.mjs:643 is `const MCP_ALLOWED_DIRECTORY = "packages/ai-core/src/mcp/";`.
**Confidence**: high
**Fix**: Drop "と `ports/`".

### [LOW] F-17 The audit note says an `overrides` entry must be added; one already exists and needs a bump

**Location**: specs/003-domain-agents/research.md:574
**Evidence**: pnpm-workspace.yaml:16 is `"typed-rest-client>qs": "^6.16.0"`, and the lockfile resolves `qs@6.16.0`. The advisory covers `<=6.16.0`.
**Confidence**: high
**Fix**: Say "bump the existing override to `^6.16.1`" (still a dependency change for a human).

### [LOW] F-18 Two capability invariants conflict with their own comments or the documented bound

**Location**: packages/eval-suite/tests/capability/council-agreement.local.test.ts:25, :175; packages/eval-suite/tests/capability/mcp-compare.local.test.ts:258
**Issue**: `SOFT_CAP = maxTotalTokens * 1.25` is not the documented bound, which is max plus one unsized call of any size. A long first moderator call fails the "invariant" on a correct run. mcp-compare asserts `stopReason === "completed"` for every run, which turns model behaviour into pass/fail, against its header ("Model behaviour is never a pass/fail threshold").
**Confidence**: medium
**Fix**: Record the overshoot instead of asserting 1.25×, and record the stop reason rather than asserting it.

### [LOW] F-19 index.md marks 3-1〜3-6 "提供済み" with tag links before the tags exist and before 42.1 is green

**Location**: docs/modules/index.md (W8 diff)
**Confidence**: medium
**Fix**: Flip to "提供済み" in 42.3, or note "タグは 42.3 で付ける".

### [LOW] F-20 3-6 hands-on step 3 lists Postgres as required; the capability test reads personas from a fixture file

**Location**: docs/modules/3-6-marketing-support.md:114
**Evidence**: seed.ts:43-44: `loadSamplePersonas` does `readFile(PERSONAS_FILE)`, with no DB.
**Confidence**: high
**Fix**: Drop Postgres from step 3.

### [LOW] F-21 The council overshoot bound is looser than needed, and `LinkedEnd` is duplicated

**Location**: packages/eval-suite/tests/regression/marketing-council.test.ts:192; packages/eval-suite/tests/regression/mcp-fatal-stop.test.ts:51-90 and packages/eval-suite/tests/capability/mcp-compare.local.test.ts:47-86
**Issue**: The moderator starts only when `tokensLeft() >= largestCall >= personaTokens`, so the overshoot is at most `moderatorTokens − personaTokens`. The `max + moderatorTokens` bound leaves `personaTokens` of slack, so a regression of that size passes. The 40-line in-memory transport is copy-pasted between two files.
**Confidence**: medium
**Fix**: Tighten to `max + moderatorTokens - personaTokens`, and move `LinkedEnd` into `@platform/ai-core/testing` or a shared eval-suite helper.

### [LOW] F-22 42.2 is ticked although its declared dependency 42.1 is not

**Location**: specs/003-domain-agents/tasks.md:423-428
**Issue**: Its Verify condition (mutation score 86.19 ≥ 70) is met and all twelve plan targets are in `mutate`, so the tick is substantively right, but the order breaks the declared dependency.
**Confidence**: high
**Fix**: Add a note that 42.2 was verified independently of the 42.1 blockers.

## Hallucination Signal

forced: false

## Responses (2026-10-29)

Fixes were made test-first where code is involved, by fresh-context agents on disjoint files; docs and tests only (`git diff HEAD -- packages/ai-core apps/web` is empty). `mise run gate` after the fixes: exit 0 (root 427, ai-core 3,681 / 4 skipped, web 1,660, eval-suite 39 / 12 skipped, `docs:check` 247 references).

| Finding | Response |
|---|---|
| F-1 (HIGH) | **Doc fixed; the overshoot itself is a human decision.** 3-4 now reports the measured totals (960 → 1,370; 7,000 → 9,100; 10,000 → 11,800; 20,000 → 14,480) and says the budget cannot serve as a strict cap. No assertion was added: a hard-cap assertion would fail today, and pinning the overshoot would freeze a possible bug. Whether to fix `runResearch` or change plan C9 to a soft cap is recorded in tasks.md (37 notes) for a human. |
| F-2 (HIGH) | **Accepted; my explanation was wrong.** The "parallel calls queue up" text was removed from research.md, 3-6 (2 places), changes-from-drafts and the test comment. The cause is stated as unidentified, with the candidates not ruled out (runaway generation; other local test files running at the same time) and a `--no-file-parallelism` re-measure recommended. Not re-measured. |
| F-3 (HIGH) | **Accepted.** 38.2 is unticked in tasks.md and recorded as blocked. 3-3 now says the test always skips today and that its 3/3 table came from a one-off run with a temporary guard override that is not in the repo. The skip reason leads with the guard explanation. A lane that allows both Ollama and Docker changes the test infrastructure's safety policy, so it is left to a human. |
| F-4 (MEDIUM) | Fixed: the test records the report source, citation validity is computed over model-written reports only, and 3-4 annotates the 3/3 and weakens the summary line. |
| F-5 (MEDIUM) | Fixed in the test (same draft extraction for both arms, count of statements with a `<draft>` block) and in 3-6 (conclusion withdrawn). The earlier numbers were not re-measured. |
| F-6 (MEDIUM) | Fixed in tech.md (stop condition, not abort; E2B lifetime idle × 3 with the ADR-6 mismatch flagged). |
| F-7 (MEDIUM) | Recorded in tasks.md (40, 41 notes): plan sync of `CouncilRound` / `data-council-result` and the `council.ts` PROVE are carried to a human before M4; the `council.ts` Stryker decision is "not a plan target, not added"; W7 F-17 / F-18 are `apps/web` changes outside W8. |
| F-8 (MEDIUM) | Fixed and run: the 3-4 step 2 command now runs `research-budget.test.ts` (9 passed). |
| F-9 (MEDIUM) | Fixed in 3-4, changes-from-drafts, traceability and research.md (the 429 / 503 / 301 responses were measured on 2026-10-19; list of what was not). |
| F-10 (MEDIUM) | Fixed: the cumulative `fixes <= 3` assertion was replaced with always-true invariants. |
| F-11 | Fixed (3-1, 3-3, 3-4). |
| F-12 | Fixed: `REQUIRED_TOPICS` now has the five MCP topics for 3-1 and the profile merge for 3-6. |
| F-13 | Fixed (3-3 split into three referenced items; 3-4 and 3-6 wording narrowed). |
| F-14 | Fixed in the tasks.md 37 note (12 skipped; 8 before 38.x). |
| F-15 | Fixed in AGENTS.md (M2 status, `seed:samples`, sandbox providers). The `mise.toml` description of `seed:samples` is outside the W8 boundary. |
| F-16 | Fixed in changes-from-drafts. |
| F-17 | research.md now says the existing override `^6.16.0` needs a bump to `^6.16.1` (dependency change, left to a human). |
| F-18 | Fixed: the 1.25× cap and the `completed` assertion were removed; the overshoot and stop reason are printed instead. |
| F-19 | index.md now says the tags are created in 42.3. |
| F-20 | Fixed (3-6 step 3 no longer lists Postgres). |
| F-21 | **Not changed.** The looser overshoot bound in `marketing-council.test.ts` and the duplicated `LinkedEnd` are recorded as accepted: tightening needs the moderator/persona token sizes pinned per case, and sharing the transport needs an ai-core testing export (outside the boundary). |
| F-22 | Noted in tasks.md (42 notes): 42.2 was verified independently of the 42.1 blockers. |

No fresh re-review of these fixes was run.

## Human decisions (2026-10-29) and their follow-up

- **F-1**: plan C9 now says the shared budget is a **soft cap** (decided by the human). `research-budget.test.ts` gained "keeps the total within the soft cap: the budget plus what the Supervisor itself spent" (budgets 960 / 7,000 / 10,000). PROVE: with the budget's remaining-token calculation ignoring spend, the test fails (`max 960: expected 3010 to be less than or equal to 1750`); with usage never recorded it passes vacuously (total 0), and that stub is killed by the existing tests (S3 in 37.3). Source restored byte-identical. 3-4 and tasks.md were updated.
- **F-3**: 38.2 stays unticked and moves to M4; no new lane (decided). 3-3 now says so.
- **ADR-6**: corrected to "idle × 3 (default 30 min)", matching the code; tech.md and research.md updated.
- **Out-of-boundary items** (recommend round-trip test, W7 F-17 / F-18, plan Data Model sync, `council.ts` PROVE) are recorded in tasks.md "004 への引き継ぎ事項" as the first M4 task.
- **Dependency**: the `typed-rest-client>qs` override in `pnpm-workspace.yaml` was raised from `^6.16.0` to `^6.16.1` (resolves to 6.17.0; the lockfile diff contains only `qs`). `mise run audit` now reports no known vulnerabilities.
