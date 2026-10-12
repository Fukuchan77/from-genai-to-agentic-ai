# Adversarial Review r2 — 001-agentic-ai-platform W5 (fixes for round 1)

Scope: `git diff 8c161d8..HEAD` on `docs/archive-w5` (4 commits: `b29376e`, `6b0f8b2`, `9d08368`, `95bbb26`; 14 files). I read the full diff and all of `scripts/check-docs.mjs`, the new parts of `scripts/check-docs.test.mjs`, `apps/web/e2e/{a11y,summarize}.spec.ts`, `apps/web/e2e/support/axe.ts`, the new fixture, `.env.example`, `packages/ai-core/src/config/env-schema.ts`, the plan's mise task table, and the "完成時点のタグ" sections of 1-1, 1-2 and 1-3.
Risk trigger: none. This is the round-2 check of the round-1 Resolution.
Prior reviews: round 1 (`001-agentic-ai-platform-impl-w5-review-2026-10-12.md`, REQUEST_CHANGES, HIGH 1 / MEDIUM 5 / LOW 15). I treated its Resolution as unverified.

Evidence I gathered:
- `TURBO_FORCE=true mise run gate`: exit 0, `0 cached`. Root 299 (1 of them is an `it.fails`), ai-core 702 (4 skipped), eval-suite 3 (1 skipped), web 306, `Docs: 4 module documents, 51 test references verified`.
- `mise run gate:repeat`, run without the three `ANTHROPIC_*` variables in my shell (`ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_DEFAULT_SONNET_MODEL`): exit 0, and all 10 runs gave the same per-suite summary lines (root 299, ai-core 702/4, eval-suite 3/1, web 306, docs 51). This is new evidence for the round-1 NFR-02/03 LOW on HEAD `95bbb26`.
- `mise run test:e2e`: exit 0, `executed=159 skipped=0 (chromium=53 firefox=53 webkit=53)`, which matches the Resolution. 41 → 53 per engine is +12, the new axe states.
- Node 26.10.0 probe of the `dev` wrapper, using a temp file and a child that prints its env:
  - A variable already set in the shell wins over the file.
  - An empty value arrives as `""`. The env schema maps `""` to undefined (`emptyToUndefined`), so an unedited copy of `.env.example` is safe.
  - `export X=…` is parsed.
  - `${FOO}` is **not** expanded. Next.js's dotenv-expand would expand it.
  - A missing file prints only the path.
  - The child's exit status is propagated (7 → 7).
  - A missing binary exits 1 with no message.
  - SIGTERM to the wrapper leaves the child running (orphaned).
- `extractTestNames` probe: it still returns names from `// it("…")`, `/* test("…") */`, string contents, and `it(...)` nested inside `describe.skip(...)`.
- I checked all 51 references one by one. Each points to exactly one top-level `it(` / `describeLocal(` declaration. None is commented out, inside a skipped block, or an `it.fails`. So they resolve for the right reason today.
- Tags: `module/1-1` → `f671813`; `module/1-2` and `module/1-3` → `7cc27cc`. All three are annotated tags, and all three are on `origin` (`git ls-remote`).
  - At `7cc27cc`, the local Ollama chat/structured entry has `contextWindow: 40_960`. `inputBudget = floor(cw*0.8) - 4096` gives 28,672 there, and 22,118 for 32,768 at HEAD. Only `summarize/pipeline.ts` sends `num_ctx`.
  - Neither tag commit has a `[tasks.dev]`, and both define `record` as `pnpm --filter web dev`.
- I did not start `mise run dev`, contact external services, or push.

## Round-1 HIGH / MEDIUM status

| Round-1 finding | Status | Evidence |
|---|---|---|
| HIGH: root `.env.local` never reaches the web app | **Resolved** (mechanism verified; I did not repeat the end-to-end run, which the task forbids) | `mise.toml:155-166`. The probe shows that the file's variables reach the spawned child and that shell values win. The env schema treats empty values as unset. No doc or README still starts the app with `pnpm --filter web dev`. The only remaining mention is the historical note in `tasks.md:296` (6). Nothing in Node, the wrapper or `instrumentation.ts` prints values. New defects: N2, N3, N4, N5. |
| M1: `docs:check` accepts tests that never run | **Partially resolved** | Modifiers and member calls are now rejected (`check-docs.mjs:13-14`, tests at `check-docs.test.mjs:117-139`). Commented-out tests, string contents, and tests nested in `describe.skip` / `describe.todo` are still accepted (N1). |
| M2: tags predate the local-model switch and 29.5 | **Resolved for 1-2 / 1-3** | `1-3:110` and `1-3:421` give the correct tag values (40,960 / 28,672) and HEAD values (32,768 / 22,118). `1-2:366` lists both later changes. The docs contain no model ID literals (`check:model-ids` passes). The fix's own new change (`mise run dev`) is not listed, and 1-1 was not covered (N2). |
| M3: progressive summary E2E uses hand-written partial events | **Resolved** | `summarize-article.sse` is produced by `POST` from the real `route.ts` with `mockPlatform()` (`route.test.ts:380-390`) and byte-checked in gate (web 305 → 306). It has 10 `data-summary` events. Event 3 is `{title, keyPoints[0]}`, which matches the spec's `holdAfter count: 3` and its `not.toContainText(keyPoints[1])` / tags-count-0 assertions. `progressively` is gone. |
| M4: axe only on empty screens | **Resolved** | `a11y.spec.ts:46-141` has 6 states × 2 themes. Each `reach` asserts that the rendered state is visible before the axe call (`WCAG_TAGS` 2a/2aa/21aa/22aa, whole page). There is no theme provider that could reset `<html class>`. The tool-failure transform uses the real `ToolFailure` shape (`kind: "recoverable"`, `summary`, `nextAction`, see `aci/define-tool.ts:83-94`). I did not repeat the injected-contrast PROVE. |
| M5: 1-1 says `docs:check` is not in `gate` | **Resolved** | `1-1:35` adds the row, and the "予定" paragraph is gone. The new row slightly overclaims (see N1). |

## Critique

### [MEDIUM] N1: `docs:check` still counts commented-out tests and tests inside `describe.skip`, and 1-1 now says it cannot
**Location**: scripts/check-docs.mjs:13-14, 69-78; docs/modules/1-1-dev-environment.md:35
**Issue**: The extractor is a regex over the raw source. It does not see comments, strings or the enclosing block. A checklist reference stays "verified" in these cases:
- the referenced test is commented out (the usual way to silence a failing test);
- the test sits inside `describe.skip(...)` / `describe.todo(...)`;
- the name appears only in a string.

The new 1-1 gate row says "`.skip` / `.todo` などの実行されないテストは参照できない".
**Evidence**: `extractTestNames` on `// it("commented out test")`, `/* test("block commented") */`, `describe.skip("s", () => { it("inside skipped suite") })` and `'it("inside a string")'` returns all four names. The round-1 finding was "a checklist item can point at a test that is skipped … and `docs:check` still counts it as verified" (Req 7.6, constitution 11). The fix closes the modifier forms only.
**Confidence**: high (mechanism). Today's 51 references are all clean, so there is no current false green.
**Fix**: Either:
- (a) take the names from Vitest itself: run `vitest list --json` per project, or read the gate reporter's per-test results, and require the referenced test to be collected and not skipped/todo, except `describeLocal` / `itLocal`; or
- (b) at least strip comments and string literals before matching, and reject a match whose enclosing `describe` call carries `.skip` / `.todo` / `.skipIf`.

Add tests for the commented-out and `describe.skip`-nested cases. Until then, reword the 1-1 row to "`.skip` / `.todo` などの修飾子付きの宣言は参照できない".

### [MEDIUM] N2: none of the three tags has `mise run dev`, and 1-1's tag section lists no later changes
**Location**: docs/modules/1-1-dev-environment.md:316-320; docs/modules/1-2-ai-sdk-core-and-tools.md:366; docs/modules/1-3-structured-output-and-summaries.md:421
**Issue**: The hands-on steps now start the app with `mise run dev`, but the task was added after all three tags. A learner who restores `module/1-2` or `module/1-3` (Req 7.11) gets "task not found". If they fall back to the old command, they hit the round-1 HIGH again: the root `.env.local` is ignored without any message, and `mise run record` at the tag still runs bare `pnpm --filter web dev`. The round-1 M2 fix added "タグより後の変更" lists to 1-2 and 1-3, but they do not include this change. The 1-1 section (tag `f671813`, W2) lists none of the later changes:
- the `docs:check` gate stage and the `tool-risk-declared` rule, which the HEAD gate table that 1-1 teaches includes;
- the local default model switch;
- `mise run dev`.
**Evidence**: `git show 7cc27cc:mise.toml` and `git show f671813:mise.toml` have no `[tasks.dev]`, and `record` is `run = "pnpm --filter web dev"`. `1-2:366` and `1-3:421` list only the model switch and `num_ctx`. `1-1:320` lists only E2E, docs and later modules.
**Confidence**: high (facts); medium (severity, because the hands-on steps are written for HEAD anyway: 1-1's `/chat` step cannot run at `f671813`).
**Fix**: Add to all three "含まれないもの" lists: "`mise run dev` とルートの `.env.local` の読み込み（W5 レビュー対応。タグの時点では、変数をシェルで設定するか `apps/web/.env.local` に置く）". Add to 1-1 also: "the `docs:check` gate stage (29.1), the W3 repo rule `tool-risk-declared`, and the 2026-10-12 local default change". Alternatively, add one sentence at the top of each hands-on section: "手順は main の最新を前提とする".

### [LOW] N3: SIGTERM to the `dev` / `record` wrapper orphans `pnpm` and `next dev`
**Location**: mise.toml:158, :165
**Issue**: `spawnSync` blocks the parent's event loop, and Node's default SIGTERM action kills only the parent. A signal sent to the wrapper alone therefore leaves `pnpm → next dev` running with port 3000 held. Ctrl-C reaches the whole foreground process group, so it is not affected. The cases are a stop button in an IDE task runner, `kill <pid>`, and a process manager.
**Evidence**: Probe: `node -e 'spawnSync("sleep",["37"],{stdio:"inherit"})' & kill -TERM $!` → parent exit 143, and `sleep 37` was still running.
**Confidence**: medium. I did not check how mise itself forwards signals.
**Fix**: Use async `spawn` and forward `SIGINT`/`SIGTERM`/`SIGHUP` to the child, then exit with the child's code or signal. Alternatively, put the wrapper in `scripts/dev.mjs` with a small test (this also fixes N5).

### [LOW] N4: the wrapper drops spawn errors and a child's signal
**Location**: mise.toml:158, :165
**Issue**: `process.exitCode = spawnSync(…).status ?? 1` ignores `result.error` and `result.signal`. If `pnpm` is not on PATH, the task exits 1 with no output. If `next` is killed by a signal, the task reports a plain 1. This is lazy error handling (zero-tolerance list), although it is unlikely under mise.
**Evidence**: Probe: `spawnSync("does-not-exist-pnpm")` → exit 1, nothing on stderr.
**Confidence**: high
**Fix**: Print `result.error.message` when it is set. Re-raise `result.signal` with `process.kill(process.pid, signal)`, or map it to 128+n.

### [LOW] N5: the same inline program is duplicated in `dev` and `record`, and it has no test
**Location**: mise.toml:155-166
**Issue**: Two copies of a one-line JS program in TOML can drift, and Biome, typecheck and tests do not cover them. The repository puts other task logic in `scripts/*.mjs` with tests.
**Confidence**: high
**Fix**: Move the program to `scripts/dev.mjs` (`--record` can stay as the mise `env`). Call it from both tasks and cover env precedence and exit propagation with a unit test.

### [LOW] N6: the docs say the root file is read "like Next.js", but `${VAR}` expansion differs
**Location**: README.md:60-63; docs/modules/1-1-dev-environment.md:68; mise.toml:153-154
**Issue**: Node's env-file parser keeps `${FOO}` as literal text. Next.js's `loadEnvConfig` (dotenv-expand) expands it. A learner who writes `OLLAMA_BASE_URL=http://${HOST}:11434` gets an invalid URL. Since the env schema checks URLs, startup then reports `ConfigError` for that variable.
**Evidence**: Probe: `EXPANDED=${FOO}-x` → `"${FOO}-x"`.
**Confidence**: high (mechanism); low (likelihood)
**Fix**: Add "変数の展開（`${VAR}`）はしない" to the README and 1-1 sentences.

### [LOW] N7: `.env.example` still says Next.js reads the root `.env.local`
**Location**: .env.example:2
**Issue**: The header of the file learners copy says "Next.js and `mise run services:*` (Compose via --env-file) both read .env.local". The round-1 HIGH showed this premise is false. README and 1-1 were corrected; this file was not.
**Confidence**: high
**Fix**: Change it to "`mise run dev` / `mise run record` (via Node's `--env-file-if-exists`) and `mise run services:*` read the root .env.local; Next.js itself reads only `apps/web/.env*`". Check that the `.env.example` name/schema test does not depend on the comment.

### [LOW] N8: the new `dev` task, and `record`'s new env loading, are missing from the plan and steering
**Location**: specs/001-agentic-ai-platform/plan.md:517-535 (mise task table); .sdd/steering/tech.md; AGENTS.md (Tooling, "Other tasks")
**Issue**: `dev` is now the documented way learners start the app, but the plan's "mise タスク（学習者と CI の入口）" table has no `dev` row. The `record` row does not say that the root `.env.local` is loaded. AGENTS.md asks that steering be updated when an implementation changes a decision.
**Confidence**: high
**Fix**: Add a `dev` row to the plan (after human approval, since the plan is approved), and add the loading rule to `record`. Mention `dev` in `tech.md` and in the AGENTS.md task list. Close `tasks.md:296` (6).

### [LOW] N9: `summarize-transcript.sse` is still generated and listed, but no E2E spec uses it now
**Location**: apps/web/e2e/support/mock-api.ts:17-22; apps/web/app/api/summarize/route.test.ts:377
**Issue**: After the switch to `summarize-article`, `loadFixture("summarize-transcript")` / `streamReply("summarize-transcript")` appear in no spec. The fixture is a byte-checked artifact that nothing consumes. The pasted-transcript UI path is still covered by `real-server.spec.ts:61` through the real route.
**Evidence**: `grep -rn summarize-transcript apps/web/e2e apps/web/app` → only `FIXTURE_NAMES` and the route test.
**Confidence**: high
**Fix**: Either delete the fixture and its generating test, or use it in a spec, for example the transcript variant of the finished-summary axe state.

### [LOW] N10: the stricter extractor also rejects `it.fails`, which does run
**Location**: scripts/check-docs.mjs:13-14
**Issue**: `it.fails` runs and passes only when its body fails. `hermetic-registration.test.ts:29` uses it for a meaningful guarantee ("fails a test that swallows a NetworkBlockedError"). That test can no longer be referenced. This is defensible (an expected failure is a weak checklist target), but neither the comment nor the 1-1 row states it.
**Confidence**: low (design choice)
**Fix**: Either keep the rule and name `.fails` in the 1-1 row as intentionally excluded, or allow `.fails`.

### [LOW] N11: 1-3 calls the context window the "planning budget"
**Location**: docs/modules/1-3-structured-output-and-summaries.md:145
**Issue**: "計画の予算（カタログの 32,768）" conflates `contextWindow` (32,768) with the input budget (22,118) that the table two paragraphs above defines. The tag note covers the table but not this sentence.
**Confidence**: medium
**Fix**: Change it to "計画が前提にするコンテキスト長（カタログの `contextWindow`、現在 32,768）".

### [LOW] (prior: accepted LOW) The reason given for accepting the 29.1 per-stage injection gap does not hold
**Location**: .sdd/reviews/001-agentic-ai-platform-impl-w5-review-2026-10-12.md (Resolution, "superseded by the gate runs below"); specs/001-agentic-ai-platform/traceability.md:161
**Issue**: A green gate run cannot show that each stage fails on a violation. Only the NFR-02/03 item is closed by a later run. I ran `gate:repeat` on `95bbb26` without the `ANTHROPIC_*` variables: 10/10 identical. Accepting the gap is still reasonable at LOW; only the stated reason is wrong.
**Confidence**: high
**Fix**: In traceability, reword the 29.1 item as "accepted; the `run = [...]` array stops at the first failure", and record my `gate:repeat` result as the NFR-02/03 evidence.

### Accepted LOWs from round 1: re-assessment
I re-read each of the 14 accepted LOWs with the round-2 changes in mind. None needs to go above LOW:
- **client-bundle sentinel count / zero sentinels pass** (closest to MEDIUM): the name scan still runs and fails on zero files. The value check is a narrower add-on, so this is not a vacuous gate. It stays LOW. Adding a `sentinels.length === 0` failure is one line and worth doing.
- **E2E web server inherits the caller's env**: unchanged by `mise run dev`, because `test:e2e` does not read `.env.local`.
- **`mock:` IDs outside the catalog** and **usage 0/0**: still test-convention gaps.
- **Others**: skip-link focus, keyboard scope, alpha parsing, latency stamp, trace upload, `SSE_FIXTURES`, research/plan records and the unrelated fixture edit are unaffected by the fixes.
- **NFR-02/03**: now evidenced (see above).

### Checked and found sound
- **Env loading and logs**: `--env-file-if-exists` keeps shell values, which matches the docs' claim. Empty values are safe. Nothing prints values: Node prints only a missing path, and `instrumentation.ts` prints names and features. README, 1-1, 1-2 and 1-3 start the app only with `mise run dev`. No other doc or spec file still gives `pnpm --filter web dev` as a hands-on command.
- **Tag values in docs**: 40,960 / 28,672 at the tag and 32,768 / 22,118 at HEAD are correct under `floor(cw*0.8) - 4096`. "Only the summary sends `num_ctx` at the tag" is correct. The docs contain no model ID literals.
- **New fixture provenance (plan C19)**: it is generated by the real Route Handler in a gate test and compared byte-for-byte. It is not hand-written.
- **axe states**: they are non-vacuous. Each state is asserted before the scan, and the whole page is scanned with the WCAG 2.2 AA tags.
- **The 51 references**: each resolves to a single real, top-level, non-skipped declaration. `describeLocal` reports a skip with its reason (Req 1.14).

## Verdict
REQUEST_CHANGES

The round-1 HIGH and M2 to M5 are resolved. M1 is only partially resolved: N1 is the remaining hole, plus an overclaim in the 1-1 row. N2 applies the round-1 M2 reasoning to the fix's own `mise run dev` and to 1-1. Both MEDIUMs are fixes in docs or scripts, with no ai-core behavior change. There is no CRITICAL or HIGH finding. Gate, gate:repeat (10/10) and E2E (159/0 skipped) are green.

## Hallucination Signal
forced: false

## Resolution (2026-10-12)
- M1 (partial) / N1 (MEDIUM): the docs now state what `docs:check` actually rejects (modified declarations `.skip` / `.only` / `.todo` / `.fails` and `X.test(...)` method calls) and that commented-out tests and tests nested in `describe.skip` are not detected and are left to the module doc review (1-1 stage table; comment in `scripts/check-docs.mjs`). Detecting nesting and comments needs a parser and is accepted as a limit for M1.
- N2 (MEDIUM): fixed. The tag sections of 1-1, 1-2 and 1-3 list `mise run dev` as a later change and say how to pass variables at the tag (shell, or `apps/web/.env.local`). 1-1 also lists `tool-risk-declared`, the `docs:check` stage and the local default change.
- N4: fixed. The wrapper prints `mise run dev: could not start pnpm: <message>` and exits 1 (checked with pnpm removed from PATH: `spawnSync pnpm ENOENT`).
- N5: fixed. `record` now runs `mise run dev` with `AI_RECORD=1`; the inline launcher exists once.
- N6, N7: fixed (README, 1-1, `.env.example` say `${VAR}` is not expanded and where the file is read).
- N8: fixed (plan C1 task table has `dev`, `record` runs `dev`; `.sdd/steering/tech.md` has the dev command).
- N10: fixed (comment says why `.fails` is excluded).
- N11: fixed (1-3 separates the context length 32,768 from the input budget 22,118).
- N3 (SIGTERM to the wrapper orphans pnpm / next dev) and N9 (`summarize-transcript.sse` is generated but unused by specs; it still pins the transcript route's stream byte-for-byte): accepted; N3 is documented in the `mise.toml` comment.
- Accepted LOW on 29.1 per-stage injection: the round-1 reason was wrong. The per-stage injections were done when each stage was wired (W1–W3, recorded in those waves' notes) and in 29.1 for `docs:check`; that is the evidence, not later green runs. NFR-02 evidence is this round's `gate:repeat` (10/10 identical) on the fixed code, recorded in `traceability.md`.
- Re-verified `mise run dev` end to end in a disposable worktree after the change (`provider: mock`, `stopReason: step-limit`, `steps: 1`).
