# Adversarial review: 003-domain-agents, implementation wave W6 (tasks 25–28), round 2, 2026-10-25

Scope: commits `1611759..14139a6` on `feat/m3-w1-foundation` (`git diff 1611759^..14139a6 -- packages apps scripts stryker.config.mjs`), plus `specs/003-domain-agents/{spec,plan,tasks,tasks-w8,traceability,research}.md`, `pdca/do.md` and `.sdd/memory/constitution.md`.
Round 1: `.sdd/reviews/003-domain-agents-impl-w6-review-2026-10-24.md` (REQUEST_CHANGES, F-1..F-23), including its "Responses" section.
Reviewer context: fresh, without the implementer's reasoning. I read the Responses as claims to check, not as evidence. I did not modify any source, test or spec file. Round-2 IDs below restart at F-1; round-1 items are written `r1 F-n`.

## Evidence gathered

- Targeted suites, run with `env -u NODE_ENV AI_TEST_RUN_MODE=mock AI_TEST_SUITE=gate mise exec -- pnpm --filter … exec vitest run --coverage.enabled=false …`:
  - `@platform/ai-core`: `src/requirements src/marketing src/patterns/role-based-cooperation.test.ts src/mock/m3-scenarios.test.ts src/models/gateway.test.ts`: 22 files, `executed=443 passed=443`.
  - `web`: `app/api/requirements app/api/marketing lib/server/platform.test.ts lib/server/domain-stream.test.ts`: 7 files, `executed=298 passed=298`.
- `env -u NODE_ENV mise run gate`: exit 0. Root `executed=419 passed=419`, `docs:check` "8 module documents, 110 test references verified". Turbo served 3 of 4 workspace test tasks from cache. The tree was clean at `14139a6`, so the cache key matches the reviewed code.
- `git status` was clean before and after. I wrote no probe files. The round-1 probes P1 to P4 now exist as committed tests, and I read those tests instead of re-running throwaway copies:
  - P1: `council.test.ts:318-329`, which asserts 130 of 100.
  - P2: `council.test.ts:514-547`, `:549-561`.
  - P3: `council.test.ts:452-492`.
  - P4: `messages/route.test.ts:851-874`.
- Static reads: `council.ts`, `moderator.ts`, `profile.ts`, `research/budget.ts`, `structured/errors.ts`, `role-based-cooperation.ts` (diff), `requirements/interview.ts`, `personas.ts`, `web-session.ts`, `apps/web/lib/server/sessions.ts`, the three requirements routes and the two marketing routes, and the plan/tasks/traceability diffs.
- Not reproduced: the Stryker scores (84.73 → 82.89) and the E2E / `test:db` lanes.

## Verification of the claimed fixes

### r1 F-1: shared token budget with a moderator reserve. **Holds, as a documented soft cap.**

- `council.ts:228-235` reserves `floor(maxTotalTokens / 4)` for `moderator` through `createBudget({ reserve })`. `research/budget.ts` hides the reserve from `remainingTokens()` until the moderator's own spend passes it.
- A persona call starts only when `remaining >= largestCall` (`:292-293`), and the judgement only when `tokensLeft() >= largestCall` (`:322`).
- `judgeAgreement` now runs its own retry loop (`maxRegenerations: 0`, `moderator.ts:124-150`) and stops a regeneration when `usage + lastAttemptTokens > tokenLimit`.
- In P1 the spend falls from 330 to 130 of 100, and the test pins 130 (`council.test.ts:326`). The overshoot by the first call of each kind is written into plan CL-17, `DEFAULT_COUNCIL` and C12, and into research.md. pdca/do.md records that the human approved those plan edits.
- The invariant test is narrower than the Responses say (F-7 below).

### r1 F-2: `/messages` lock before the first await. **Holds.**

- At `route.ts:98-112`, the unknown-id, completed, current-round-prefix and `RUNNING` checks and `RUNNING.add` run in one synchronous block after the last `await` (`guardRequest`). Only then come the rate limit and `gateway.resolve`.
- The lock is released in `execute`'s `finally` and in the outer `catch`.
- `route.test.ts:851-874` sends two identical requests with the first one held in `resolve`. It asserts `[200, 409]`, `round: 1` and 3 answers. `:876-892` shows that a failed resolve releases the lock.
- I found no remaining await between check and lock. The residual concern about where the lock lives is F-9.

### r1 F-3: CL-12 refusal when a persona is silent. **Holds.**

- `council.ts:363-365` overrides `agreed` when `statements.length < personas.length`, and covers both failed personas and personas skipped for budget.
- Tests: `:514-547` (b fails, judge says agreed, result `max-rounds`), `:549-561` (agreement accepted once everyone speaks), `:563-580` (budget leaves c out).
- Plan CL-12 (★) was amended, and do.md records the human approval.
- Side effects: F-5 and F-6.

### r1 F-4: an extraction failure goes to `output-invalid` with no commit. **Holds.**

- `extractRequirements` no longer catches `StructuredOutputError` (`interview.ts:165-210`). The route commits only after every step (`route.ts:169-172`).
- `route.test.ts:641-661` asserts: one `error` part with `code: "output-invalid"`, no judgement, `round 0`, `answers []`, and a retry that succeeds.
- Plan Error Handling (要件) was rewritten to match.
- Side effect: F-4 (previews).

### r1 F-5: per-round verdict streaming. **Holds.**

- `onRound` is called right after each round settles (`council.ts:325`, `:368`), wrapped in `safely`. The route writes `data-council-verdict` from it.
- `council/route.test.ts:385-409` makes every call after round 1's judge fail. It asserts the part order turn×3, verdict, turn×3, error, and no result.

### r1 F-6: recommend reply text and history round-trip. **Holds, with a weak test.**

- The schema accepts `data-*` / `step-start` parts on assistant messages only (`recommend-request-schema.ts:36-60`).
- The route writes a code-built `text` part, either "N 件をおすすめします。" or a fixed reason. `recommend.ts` returns only constant reasons when `items` is empty.
- The round-trip test feeds turn 1's parts back in, but through a hand-written reconstruction (F-8).

### r1 F-9: tag neutralisation. **Holds.**

- `moderator.ts:59-68` neutralises `draft|statement|previous-round-statement|turn|profile|conversation|message`.
- It is applied to the draft, the statements and the persona names (`council.ts:154-158`) and to the turns (`moderator.ts:70-77`).
- `profile.ts:105-115` now neutralises the client-supplied `previous` profile.
- `council.test.ts:452-492` asserts exact tag counts in the persona and moderator prompts for a forged `</statement>` and for forged draft and name values.

### r1 F-14: registry sweep and cap. **Holds.**

- `web-session.ts:71-92` sweeps on `ensureCapacity()` and on `create`, and refuses at 100 with `provider-unavailable`.
- `sessions/route.ts` calls `ensureCapacity()` before any LLM call.
- Tests: `web-session.test.ts:50+` and `sessions/route.test.ts:150`. Recorded in plan C13 and Error Handling.
- Residual edges: F-10.

### r1 F-15: code points. **Holds.**

- `personas.ts:95-103` counts `[...overview].length`.
- `personas.test.ts:181-195` and `request-schema.test.ts:46-50` test the boundary with 2000 and 2001 emoji.

### Accepted / deferred items: partly recorded

- Recorded in plan Error Handling:
  - r1 F-8, but it now contradicts another line (F-2 below).
  - r1 F-10, F-11, F-12 ("受け入れた挙動").
  - The `/messages` order of r1 F-13 (Web section).
- r1 F-16: carried only in `traceability.md`.
- r1 F-17, F-18, F-19, F-20, F-22, F-23: not recorded anywhere. F-1 below gives the detail.

## Critique

### [MEDIUM] F-1 The deferred round-1 items are not recorded where the Responses say they are, and five of them have no disposition at all
**Location**: specs/003-domain-agents/tasks.md:149-181 (carry-over sections); specs/003-domain-agents/tasks-w8.md:22-37 (37.x), :179-194 (41.x); `.sdd/reviews/003-domain-agents-impl-w6-review-2026-10-24.md:317-318`
**Issue**: The Responses claim three things:
- r1 F-16 is "Carried to W8 (37.x)".
- The type differences (r1 F-20) are "carried to 41.x".
- F-17–F-23 are handled as "minor".

None of the 37.x or 41.x task texts mentions them. r1 F-16 survives only as one sentence in `traceability.md:200`. r1 F-17, F-18, F-19, F-22 and F-23 have no fix and no "accepted" or "carried" record in plan, tasks or traceability. Unlike W1–W5, `tasks.md` has no "W6 からの持ち越し" section.
**Evidence**:
- `grep -n -E "W6|F-16|F-20|CouncilRound" specs/003-domain-agents/tasks-w*.md` finds no W6 carry-over in `tasks-w8.md`.
- `tasks.md` has "## W1・W2 からの持ち越し", "## W3 からの持ち越し", "## W4 からの持ち越し" and "## W5 からの持ち越し", then goes straight to "## 現在の波: W6". `plan.md:500`/`:552` still show the round-1 `CouncilRound` shape (`index; turns`).
- Round 1 verdict: "F-5 to F-8 are contract or process gaps to fix or record before the wave is archived". W8's 41.1 builds traceability from these records.
**Confidence**: high
**Fix**: Add a "## W6 からの持ち越し" section to `tasks.md` naming each item and its destination:
- r1 F-16 → 37.x, with the never-agreeing-draft test.
- r1 F-20 → 41.x (sync `CouncilRound` / `data-council-result` in plan Data Model and stream table), or sync the plan now.
- r1 F-17 → W7 (35.x: discard previews on a stream error).
- r1 F-18 → W7 (render the document without raw HTML).
- r1 F-19, F-22, F-23: accepted limitations, with one line each.

Add the destinations to the 37.x / 41.x task texts as well, then correct the Responses.

### [LOW] F-2 Plan Error Handling now says both "no way to re-fetch the session" and "reconnect and continue"
**Location**: specs/003-domain-agents/plan.md:1021 vs :1025
**Issue**: The r1 F-8 acceptance added a bullet saying there is no session re-fetch route. The older bullet two lines below still promises that a disconnected learner can reconnect and continue.
**Evidence**: `:1021` "`GET /api/requirements/sessions/[id]` のような**セッションの再取得口は無い**。コミット後にストリームが切れると次の質問を取り直せない（受け入れた制限…）". `:1025` "面接の途中でクライアントが切断 → セッションはアイドルの破棄まで保持する。再接続して続けられる。"
**Confidence**: high
**Fix**: Reword `:1025`. For example: "a disconnect before the commit leaves the session as it was and the same answers can be re-sent; after the commit the next questions cannot be fetched again (see above)".

### [LOW] F-3 `/api/marketing/council` still reads the database before the 429, against the plan's Web rule; only the `/messages` order was recorded (prior: r1 F-13, kept)
**Location**: apps/web/app/api/marketing/council/route.ts:32-50; specs/003-domain-agents/plan.md:1039
**Issue**: The r1 F-13 response recorded the `/messages` order only. The council route still runs `getCatalogRepo()` / `listPersonas()` before `rateLimitRejection`, and it still disables the guard's limiter by passing `mode: "mock"`.
**Evidence**: Plan Web: "すべてのルートの検査順は 413 → 400（形式）→ 400（件数・長さ）→ `live` のみ 429。拒否は LLM・サンドボックス・DB を使う前に行う。" Code: `guardRequest(request, POLICY, { limiter: platform.limiter, mode: "mock" })`, then `await getCatalogRepo()`, then `rateLimitRejection(...)`.
**Confidence**: medium (the order is deliberate and tested in "does not spend the live quota on an unseeded catalog", but the plan text says otherwise)
**Fix**: Record the council order (413 → 400 → 503 DB → 400 persona → 429 → capability) in plan Error Handling "Web" next to the `/messages` line, or change the route.

### [LOW] F-4 Previews of a rolled-back round are still streamed, and the F-4 fix makes this more frequent (prior: r1 F-17, not fixed, not recorded)
**Location**: apps/web/app/api/requirements/sessions/[id]/messages/route.ts:137-146, :42-45
**Issue**: Extraction failures used to be swallowed. They now abort the round, so a failure on answer 3 leaves the previews of answers 1–2 on screen even though nothing was committed. No final preview with the committed `session.state.requirements` is written before the error.
**Evidence**: The comment still says "The previews already streamed are the only trace." `route.test.ts:641-661` asserts `answers: []` after the failure but does not look at the preview parts.
**Confidence**: medium
**Fix**: In the `catch` path of `execute`, write `writeRequirementsPreview(writer, session.state.requirements)` before rethrowing, or record in the W7 tasks (33.x/35.x) that the screen drops previews on a stream error.

### [LOW] F-5 The moderator is called, and charged to the budget, for a round that by code can no longer agree
**Location**: packages/ai-core/src/marketing/council.ts:322-365; council.test.ts:563-580
**Issue**: When the budget leaves a persona out, `statements.length < personas.length` already decides "not agreed". Yet the moderator is still asked whenever `tokensLeft() >= largestCall`, which the reserve makes likely. That spends tokens on a verdict the code overrides, in exactly the situation where the budget is scarce.
**Evidence**: Test log `["a", "b", "judge"]` with `verdict.agreed === false` and reason `INCOMPLETE_ROUND_REASON`. The code comment says the moderator's verdict is kept "参考として".
**Confidence**: medium (a design choice, but CL-17's purpose is cost)
**Fix**: When the round is incomplete because of the budget (not because of failures), skip `judgeAgreement`, settle the round with the fixed reason and `verdict` absent or fixed, and end with `budget-exhausted`. Otherwise record in C12 that the moderator is still consulted.

### [LOW] F-6 Personas skipped for lack of budget are not listed in `missing`
**Location**: packages/ai-core/src/marketing/council.ts:289-307, :54-59
**Issue**: Only personas that ran and failed go into `missing`. A persona that is never called because `remaining < largestCall` appears in neither `statements` nor `missing`. The round record, the stream and the result therefore cannot say who was left out, and the CL-12 refusal reason is generic.
**Evidence**: The loop does `if (remaining <= 0 || remaining < largestCall) break;` and nothing pushes the rest of the `queue` to `missing`. `CouncilMissing.reason` is documented as "The run's stop reason, or `empty`".
**Confidence**: medium
**Fix**: After the loop, push every persona still in `queue` with `reason: "budget"`, and extend the docstring.

### [LOW] F-7 The budget "INVARIANT" test skips 16 of its 36 combinations, including every larger-moderator case except two
**Location**: packages/ai-core/src/marketing/council.test.ts:345-386
**Issue**: `if (Math.floor(max / 4) < per * judgeSize) continue;` drops:
- the whole `[100, 30]` config;
- the ×3 judge for `[20,5]`, `[40,5]`, `[55,7]`, `[100,10]`, `[200,25]` and `[7,1]`.

So 20 of 36 combinations run. The Responses describe it as "9 budget/size configs x valid/broken moderator". The skipped cases are the ones where the moderator is larger than the personas, which is the realistic shape because the moderator reads every statement.
**Evidence**: The guard line above. For example, `[100, 30]` with a ×1 judge (spend 90) would pass, but it is skipped.
**Confidence**: high (fact). The impact is low because the plan already admits the soft cap.
**Fix**: Run every combination. For the cases outside the steady-size premise, assert the documented bound (`spent ≤ max + first moderator call`) instead of skipping them, so the soft-cap claim is pinned too.

### [LOW] F-8 The F-6 round-trip test rebuilds the assistant message by hand instead of with the SDK's reader
**Location**: apps/web/app/api/marketing/recommend/route.test.ts:133-143, :391-437
**Issue**: `assistantMessageFrom` hard-codes a leading `{ type: "step-start" }`, which this route never causes because it writes no `start-step` chunk. It copies data and text parts in its own shape. The test therefore shows that the schema accepts the helper's shape, not what `useChat` sends. The Responses frame this as "built from the real stream".
**Evidence**: `const uiParts = [{ type: "step-start" }];`. `ai@7.0.150` exports `readUIMessageStream` (present in `dist/index.d.ts`).
**Confidence**: medium
**Fix**: Build the turn-2 assistant message with `readUIMessageStream` over the turn-1 response body and feed that back.

### [LOW] F-9 The `/messages` round lock lives in module scope, though the registry was moved to `globalThis` for exactly that reason
**Location**: apps/web/app/api/requirements/sessions/[id]/messages/route.ts:69; apps/web/lib/server/sessions.ts:102-105
**Issue**: `RUNNING` is a module-level `WeakSet`. `sessions.ts` explains that a module variable does not survive a dev-server module reload, which is why the registry is on `globalThis`. A reload of the route module during a running round gives a fresh `WeakSet`, and then a second submit can run the same round (the r1 F-2 symptom).
**Evidence**: `const RUNNING = new WeakSet<RequirementsSession>();` vs "the dev server reloads modules, so a registry in a module variable would not hold the session another route created".
**Confidence**: low (dev-only, and needs a reload mid-round)
**Fix**: Keep the flag on the session object (`running: boolean` in `RequirementsSession`), so it lives as long as the session.

### [LOW] F-10 Session cap edges: a 503 after the LLM calls in a race, and in `mock` / `local` anyone can fill all 100 slots
**Location**: packages/ai-core/src/requirements/web-session.ts:84-88; apps/web/app/api/requirements/sessions/route.ts:42-75
**Issue**:
- `create` re-checks capacity after `generatePersonas` and `askRound`. Two concurrent starts at 99 sessions both pass `ensureCapacity()`, both spend the LLM calls, and one then gets 503.
- `POST /sessions` is rate-limited only in `live`, so in `mock` / `local` 100 requests lock everyone out for 10 minutes.
**Evidence**: `create(id, factory) { ensureCapacity(); return raw.create(id, factory); }`. Plan C13: "超えると 503".
**Confidence**: low (single-learner local app)
**Fix**: Accept and note it in C13, or reserve a slot at `ensureCapacity()` and release it on failure.

### [LOW] F-11 Stale comments after the fixes
**Location**: packages/ai-core/src/marketing/council.ts:199-200; packages/ai-core/src/marketing/council.test.ts:564
**Issue**:
- The `runCouncil` docstring still says a failed persona goes on "(the hand-off of `cooperateByRole` is restarted after it)", but each persona is now its own `cooperateByRole` call.
- The test comment says "Budget 80 with 25 reserved", but the test uses `maxTotalTokens: 100`.
**Evidence**: Quoted lines.
**Confidence**: high
**Fix**: Update both comments.

### [LOW] F-12 The vacuous default-round test is still in the gate (prior: r1 F-16, deferred)
**Location**: apps/web/app/api/marketing/council/route.test.ts:426-429
**Issue**: It still asserts `DEFAULT_COUNCIL.maxRounds === 3` and never calls the route. It is counted as one of the 298 passing web tests.
**Evidence**: `it("uses the default round limit when the request names none", () => { expect(DEFAULT_COUNCIL.maxRounds).toBe(3); … })`
**Confidence**: high
**Fix**: As in round 1. Also see F-1 for where the deferral must be recorded.

### [LOW] F-13 The review fixes in `council.ts` have no recorded PROVE, and `council.ts` is not a mutation target
**Location**: stryker.config.mjs (targets `marketing/moderator.ts`, `recommend.ts` only); specs/003-domain-agents/pdca/do.md "W6 adversarial review and close"
**Issue**: The F-1 and F-3 logic is new code in `council.ts`: the reserve, the `largestCall` gates and the incomplete-round override. Its kill evidence is only the sentence "PROVE with one-line mutations" in the Responses, with no counts, while the implementation tasks each list stub counts. The mutation score of the two targeted files fell from 84.73 to 82.89 after the fixes.
**Evidence**: do.md lists per-task PROVE counts for 25.x–27.x but none for the review fixes.
**Confidence**: low
**Fix**: Record the PROVE mutations for the fix tests in do.md, for example `>=` vs `>` at `council.ts:293`/`:322` and removing `:363-365`, or add `council.ts` to the Stryker targets for one run.

### [LOW] F-14 `cooperateByRole` is now called with one role at a time, so the M2 hand-off is reimplemented in `taskFor`
**Location**: packages/ai-core/src/marketing/council.ts:149-161, :289-307
**Issue**: The r1 F-1 fix calls `cooperateByRole` once per persona, so its `earlier` hand-off is always empty. `taskFor` now builds what each persona sees. "Uses M2 Role-Based Cooperation" is now nominal: the pattern's hand-off is no longer exercised by the council the curriculum teaches with.
**Evidence**: `roles: queue.slice(0, 1).map(roleFor)`. Plan C12 was updated ("発言 1 名ごとに `cooperateByRole` を 1 回呼ぶ") and approved.
**Confidence**: low (recorded and approved; informational for module 3-6's docs)
**Fix**: Mention it in the 3-6 module doc's "移植時の変更点" (40.x).

## Prior items (round 1, 2026-10-24)

| r1 ID | Status | Note |
|---|---|---|
| F-1 budget | fixed (soft cap, documented and approved) | 330 → 130 of 100. Test is narrower than claimed (F-7) |
| F-2 TOCTOU | fixed | lock before the first await. Lock scope (F-9) |
| F-3 CL-12 silent persona | fixed | ★ CL-12 amended and approved. Side effects F-5, F-6 |
| F-4 extraction failure | fixed | `output-invalid`, no commit. Previews (F-4 here) |
| F-5 per-round verdicts | fixed | `onRound` |
| F-6 recommend text / history | fixed | test helper (F-8) |
| F-7 boundaries | fixed | exception (12), human-approved per tasks.md:62 |
| F-8 no re-fetch | accepted, recorded | plan contradiction (F-2 here) |
| F-9 tag neutralisation | fixed | |
| F-10, F-11, F-12 | accepted, recorded in plan Error Handling | |
| F-13 check order | partly recorded | council order not recorded (F-3 here) |
| F-14 registry sweep | fixed | edges (F-10 here) |
| F-15 code points | fixed | |
| F-16 vacuous test | not fixed | carried only in traceability.md (F-1, F-12 here) |
| F-17 rolled-back previews | not fixed, not recorded | F-1, F-4 here |
| F-18 inline Markdown/HTML | not fixed, not recorded | F-1 here |
| F-19 free-text reasons | not fixed, not recorded | F-1 here |
| F-20 plan type drift | not fixed | "carried to 41.x" is not in 41.x (F-1 here) |
| F-21 Implementation Notes | fixed | tasks.md:220, :274, :336, :364 |
| F-22 small-talk notes vs judge | not fixed, not recorded | F-1 here |
| F-23 seed ordinal conflict | not fixed, not recorded | F-1 here |

## Verdict

REQUEST_CHANGES

All eight code fixes I was asked to verify (r1 F-1 to F-6, F-9, F-14, F-15) hold in the code and in non-vacuous tests, and the gate is green. The change requested is documentation only. F-1: the Responses claim carry-overs that do not exist in `tasks-w8.md`, and five round-1 items have no recorded disposition before the wave is archived. F-2 is a direct contradiction in plan Error Handling. Everything else is LOW and can ride along or be carried forward with F-1.

## Hallucination Signal

forced: false

## Responses (2026-10-25, implementer)

Documentation-only round, as the verdict asks. No behaviour changed.

- **F-1** (carry-overs not recorded): added "W6 からの持ち越し" to `tasks.md` with a destination for every round-1 deferral (F-16 → 37.x, F-20 → 41.x, F-17 / F-18 → 35.x, F-19 / F-22 / F-23 accepted), and a pointer line in the Implementation Notes of tasks 37 and 41 in `tasks-w8.md`.
- **F-2**: plan Error Handling now says a pre-commit disconnect can be retried by resending the answer, and a post-commit disconnect needs a new session.
- **F-11**: both stale comments fixed (`council.ts`, `council.test.ts`).
- **F-3, F-5, F-6, F-9, F-10**: accepted limitations, listed in `tasks.md` "W6 からの持ち越し".
- **F-4** → 35.x. **F-7, F-8, F-12** → 37.x. **F-13** → 41.x. **F-14** → the 3-6 module doc (40.x).
