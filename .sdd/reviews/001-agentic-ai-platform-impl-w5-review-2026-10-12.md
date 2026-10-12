# Adversarial Review — 001-agentic-ai-platform W5 (E2E, module docs, final integration, tasks 25–29)

Scope: `git diff 3a7c1cd..HEAD -- . ':!specs' ':!.sdd'` (51 files) on `docs/archive-w5` (= `origin/main`, `8c161d8`). I read all of these in full: `scripts/check-docs.mjs`, `scripts/check-client-bundle.mjs`, `scripts/gate/assert-playwright-nonempty.mjs`, `scripts/e2e/generate-sse-fixtures.mjs`, `apps/web/playwright.config.ts`, every `apps/web/e2e/**` spec and support file, `mise.toml`, `.github/workflows/ci.yml`, and the source diffs (`catalog.ts`, `runtime-options.ts`, `pipeline.ts`, `guarded-agent.ts`, `mock/fixtures.ts`, both routes, `globals.css`, `postcss.config.mjs`). I sampled the module docs for path, test-name, command and tag claims; I did not read every sentence.
Risk trigger: none. This is the mandatory per-wave review (constitution principle 9).
Prior reviews: W4 (`001-agentic-ai-platform-impl-w4-review-2026-10-12.md`; its MEDIUM items were resolved) and 29.5 (`agentic-ai-platform-29.5.md`; its MEDIUM, the real Ollama `load_duration`, is now recorded as done, and its boundary LOW is fixed).

Evidence I gathered:
- `TURBO_FORCE=true mise run gate`: exit 0, `0 cached`. Biome 251 files, model-ID check 234 files, all 9 repo rules with non-zero scans, root 297, ai-core 702 (skipped 4), eval-suite 3 (skipped 1), web 305, and `Docs: 4 module documents, 51 test references verified`.
- The 1-0 hands-on command `vitest run src/agents/guarded-agent.test.ts -t "run summary"` runs 8 tests, so it is not empty.
- The Next.js 16.4.0 source calls `loadEnvConfig(dir)` in `server/config.js:1263`, `next-server.js:581` and `build/index.js:486`.
- The Playwright 1.63.0 webServer spawns with `{ ...DEFAULT_ENVIRONMENT_VARIABLES, ...process.env, ...options.env }` (`runner/index.js:872`).
- `mise settings get unix_default_inline_shell_args` returns `sh -o errexit -c`, so `test:e2e` stops before the non-empty check when Playwright fails.
- The tags `module/1-2` and `module/1-3` point to `7cc27cc`. The catalog switch `6a41888` is not an ancestor of that commit.
- I ran no E2E, no network calls and no Ollama.

## Critique

### [HIGH] The hands-on steps put settings in a root `.env.local`, which the web app never reads
**Location**: docs/modules/1-1-dev-environment.md:187, docs/modules/1-2-ai-sdk-core-and-tools.md:234-271, docs/modules/1-3-structured-output-and-summaries.md:262-266
**Issue**: The steps say `cp .env.example .env.local` at the repository root and then `mise exec -- pnpm --filter web dev`. Next.js loads env files only from its project directory (`apps/web`), and nothing in the repository loads the root file into the web process: no `[env]` / `_.file` in `mise.toml`, and no `dotenv` / `loadEnvFile` / `loadEnvConfig` in `apps`, `packages`, `scripts` or `tooling`. Only the Compose tasks read the root file (`--env-file .env.local`). As a result, every hands-on step that relies on a value in `.env.local` has no effect:
- 1-2 sets `AI_RUN_MODE=mock` and `AGENT_MAX_STEPS=1` and expects `step-limit`. The app instead stays in the default `local` mode and calls Ollama.
- 1-2 adds `TAVILY_API_KEY` and expects the disabled-tools notice to disappear.
- 1-3 and 1-2 set `AI_RUN_MODE=live` with an `ANTHROPIC_API_KEY`.

**Evidence**: `next/dist/server/config.js:1263 (0, _env.loadEnvConfig)(dir, …)`, where `dir` is the app directory. 1-2:271: "`.env.local` に `AI_RUN_MODE=mock` と `AGENT_MAX_STEPS=1` を書いて再起動し … `step-limit` … となる". 1-1:187 `cp .env.example .env.local` comes right after "リポジトリのルートで" context. `git grep loadEnvConfig\|dotenv\|loadEnvFile -- apps packages scripts tooling` finds nothing.
**Confidence**: high for the mechanism (read from the installed Next source); medium for the end-to-end impact, because I did not start `next dev`.
**Fix**: Pick one way to load the file and document it:
- (a) Add `[env] _.file = ".env.local"` to `mise.toml` (it is optional when absent) and make the docs start the app through mise, ideally via a `dev` task. This also closes the 28 note (6) that there is no `dev` task.
- (b) Load the root file from `apps/web/next.config.ts` with `loadEnvConfig(path.resolve(__dirname, "../.."))`.
- (c) Tell learners to create `apps/web/.env.local`. Compose would then need its own file.

Then re-run the 1-2 step-limit hands-on by hand and record the result.

### [MEDIUM] `docs:check` accepts checklist references to tests that never run (`.skip`, `.todo`, `.fails`, and non-test `.test(...)` calls)
**Location**: scripts/check-docs.mjs:11-12, 80-89; scripts/check-docs.test.mjs:22, 108-116
**Issue**: The name extractor treats `it.skip("…")`, `it.todo("…")` and `it.fails("…")` as valid targets, and its own test locks this in ("is skipped but named"). The `\b(?:…|test)` alternative also matches regex method calls such as `PATTERN.test("x")`. A checklist item can therefore point at a test that is skipped, a placeholder, or not a test at all, and `docs:check` still counts it as "verified". That is a false green against Req 7.6 and constitution principle 11. The check also does not verify that the referenced file belongs to any gate suite's `include` (for example a `*.pg.test.ts` file, or a file outside the root, ai-core, eval-suite or web Vitest globs).
**Evidence**: `TEST_CALL = /\b(?:describe|it|test|describeLocal|itLocal)(?:\.(?:skip|only|todo|concurrent|sequential|fails))*\(…/`. Probe: `extractTestNames('if (PATTERN.test("not a test")) {}\nit.todo("planned only");\nit.fails("x")')` → `['not a test', 'planned only', 'x']`.
**Confidence**: high
**Fix**: Accept no modifiers, or only `concurrent` / `sequential`. Require the call to start a statement, for example with a lookbehind `(?<![.\w])`. Add tests showing that `it.skip`, `it.todo` and `X.test("…")` references are rejected. Optionally, reject references to `*.pg.test.*` files and to files that no Vitest project includes. The existing `describeLocal` / `itLocal` references are fine, because they report a skip with a reason (Req 1.14).

### [MEDIUM] The completion tags predate the local-model switch and 29.5, but the docs describe HEAD values without saying so
**Location**: docs/modules/1-3-structured-output-and-summaries.md:107, :143, :279, :415-420; docs/modules/1-2-ai-sdk-core-and-tools.md:360-365
**Issue**: `module/1-2` and `module/1-3` point to `7cc27cc`. In that tree the local Ollama default is the previous chat model with `contextWindow: 40_960`, which gives an input budget of 28,672, and chat and agent send no `num_ctx`. The 1-3 doc tells learners that the Ollama budget is 32,768 → 22,118 and asks them to compare the screen with 22,118. A learner who restores the tag (Req 7.11) sees 28,672 and a different model to pull. The "完成時点のタグ" sections list the E2E specs and docs as not included, but not the later catalog switch (`6a41888`) or the shared `num_ctx` (`206e5bf`).
**Evidence**: `git show 7cc27cc:packages/ai-core/src/models/catalog.ts` → `contextWindow: 40_960`, `chat: "<old local chat id>"`. `git merge-base --is-ancestor 6a41888 7cc27cc` → false. 1-3:107 `| Ollama（local の既定） | 32,768 | 22,118 |`.
**Confidence**: high
**Fix**: Do not re-tag (plan C22). Add to the 1-2 and 1-3 "含まれないもの" lists: "the 2026-10-12 local default change and the shared Ollama `num_ctx` for chat and agent (later commits)". In 1-3, state that the table values come from the current catalog and that the tag's catalog gives 40,960 / 28,672.

### [MEDIUM] The progressive summary-card E2E renders partial events written in the spec, not generated ones
**Location**: apps/web/e2e/summarize.spec.ts:24-35; apps/web/e2e/fixtures/summarize-transcript.sse
**Issue**: The generated transcript fixture contains two identical, complete `data-summary` events and no growing parts. The "カードの逐次描画" test therefore builds the partial objects itself (`progressively`: `{title}`, then `{title, keyPoints[0]}`). Plan C19 says the streams are "手書きしない" and generated from the real Route Handler. Here the stream shape the test exercises (which fields come first, how the partial objects look) is invented by the test. The real route does emit growing parts for the article scenario (`route.test.ts:117` "streams growing data-summary parts …"), so a generated growing fixture is available.
**Evidence**: The fixture's data lines are `data-summary {…full…}`, `data-summary {…full…}`, `data-summary-meta`. The spec builds `stage({ title: full.title })` and `stage({ title: full.title, keyPoints: full.keyPoints.slice(0, 1) })`.
**Confidence**: high
**Fix**: Generate a fourth fixture (for example `summarize-article.sse`) in `summarize/route.test.ts` from the scenario that streams growing parts, and hold it after the second `data-summary`. Alternatively, have the transcript scenario stream partial objects. Then drop `progressively`.

### [MEDIUM] axe runs only on the empty initial screens
**Location**: apps/web/e2e/a11y.spec.ts:10-19
**Issue**: Every axe scan runs right after `goto`, before any interaction. Rendered messages, reasoning parts, tool status and weather cards, the run summary, the disabled-tools notice, error alerts with the resend button, summary skeletons and cards, and the processing-info panel are never scanned. Req 1.19 and NFR-09 ask that WCAG 2.2 AA violations be detected in E2E, and most of the UI's contrast and ARIA surface exists only after a response.
**Evidence**: `await page.goto(path); await applyColorScheme(page, scheme); … expect(await accessibilityViolations(page)).toEqual([]);`. This is the only call to `accessibilityViolations`.
**Confidence**: high
**Fix**: Add axe scans after the mocked flows in both themes:
- chat after the answer, and with the error alert shown;
- agent with the card, and with the failure group shown;
- summarize while held (skeletons) and when finished.

The `mockApi` helpers already produce each of these states.

### [MEDIUM] The 1-1 doc still says `docs:check` is not in `gate`
**Location**: docs/modules/1-1-dev-environment.md:25-36
**Issue**: Task 29.1 wired `docs:check` as the last gate stage, but the doc's stage table lists five stages, and the next paragraph says "`docs:check` … は W5 の締めのタスク（29.1）で `gate` の最後の段として結線される予定です。それまでは `mise run docs:check` を単独で実行します". Learners get a wrong picture of the gate that 1-1 teaches.
**Evidence**: `mise.toml` `[tasks.gate] run = [… "mise run test", "mise run docs:check"]`. Gate log: `Docs: 4 module documents, 51 test references verified`.
**Confidence**: high
**Fix**: Add a `docs:check` row (fails when it scans 0 modules or 0 references) and remove the "予定" sentence. Grep the docs for other W5-time statements; `ローカルの注釈付きタグ` in 1-2:362 and 1-3:417 is also stale now that the tags are pushed.

### [LOW] The skip-link test claims to check focus but only checks the URL hash
**Location**: apps/web/e2e/keyboard.spec.ts:30-38
**Issue**: The title says "moves focus to the main region", but the only assertion is `toHaveURL(/#main$/)`. A skip link that changes the hash without moving focus (for example, `main` without `tabindex="-1"` in some engines) would pass.
**Evidence**: `await page.keyboard.press("Enter"); await expect(page).toHaveURL(/#main$/);`
**Confidence**: high
**Fix**: Assert `await expect(page.locator("#main")).toBeFocused()`, or assert that the next Tab lands inside `main`.

### [LOW] Keyboard-only coverage leaves out the agent screen and the stop, resend and model-switch controls; focus contrast leaves out buttons
**Location**: apps/web/e2e/keyboard.spec.ts:40-69, 156-163
**Issue**: NFR-09 says "チャット画面…をキーボードのみで操作可能". The specs send on `/chat` and `/summarize` only. `/agent`, Stop, Resend and the model combobox are never driven by keyboard. The six focus targets include no `button`, although buttons are the most common focusable element.
**Evidence**: `TARGETS` are the skip link, nav link, textarea, select/combobox, radio and URL field.
**Confidence**: medium
**Fix**: Add a keyboard round trip on `/agent`, keyboard Stop on a held stream, and the send button plus a ghost/outline button to `TARGETS`.

### [LOW] Focus-contrast background detection treats translucent non-`rgba` colors as opaque
**Location**: apps/web/e2e/keyboard.spec.ts:96-106
**Issue**: Alpha is parsed only from `rgba(…)` strings. A parent background computed as `oklch(… / 0.5)` or `lab(… / 0.5)`, which Tailwind v4 tokens can produce, counts as opaque, and its color is read from a transparent canvas without compositing. The fallback is white even in the dark theme. The 3:1 ratio can then be computed against the wrong color.
**Evidence**: `const alpha = candidate.startsWith("rgba") ? … : 1;`, `let backgroundColor = "rgb(255, 255, 255)";`
**Confidence**: medium (the current targets pass; the risk is future components)
**Fix**: Parse the `/ a` alpha of every color function and composite translucent layers up to the first opaque one. Fall back to the computed `body` background, not white.

### [LOW] The client-bundle check is narrower than its name suggests
**Location**: mise.toml `[tasks."check:client-bundle"]`; scripts/check-client-bundle.mjs:49-61
**Issue**: The check has four gaps:
- Only 2 of the 13 secret variables get sentinel values (ANTHROPIC, TAVILY). OPENAI, AZURE, GOOGLE and LANGFUSE_* get none.
- The script accepts zero `--sentinel` flags, so removing them from `mise.toml` silently turns off the value check.
- The build runs with `AI_RUN_MODE=mock`, so only build-time inlining is covered.
- The pages are `force-dynamic`, so a credential that leaks into RSC props at runtime in `live` mode would never appear in `.next/static`.

Req 1.10 is about the bundle, so the last point is outside its letter. I record it because the task text says the check "injects secret sentinels".
**Evidence**: `env = { …, ANTHROPIC_API_KEY = "changeme-bundle-sentinel-anthropic", TAVILY_API_KEY = "changeme-bundle-sentinel-tavily" }`; the test `io([])` passes with no sentinels.
**Confidence**: medium
**Fix**:
- Inject a sentinel for every name `secretEnvNames` returns. The script could generate them, or `mise.toml` could list them all.
- Fail when `sentinels.length === 0`.
- Optionally, add an E2E assertion that the `/chat` HTML from the real server contains no sentinel.

### [LOW] The 29.1 `_Verify:_` (one injected violation per stage) was exercised for `docs:check` only
**Location**: specs/001-agentic-ai-platform/tasks.md:223, :344
**Issue**: The Verify line asks for a temporary violation in each stage. The Notes record only the `docs:check` violation and refer to W1–W3 for the others. Those waves ran with different stage sets and scripts.
**Evidence**: "他の段の違反による非ゼロ終了は、各段を結線した波（W1〜W3）で確認済み。"
**Confidence**: high (as a process gap); the risk is low, because the `run = [...]` array stops at the first failure.
**Fix**: Record a one-off run on the final `mise.toml`: one violation per stage (a Biome error, a model ID literal, a repo-rule hit, a type error, a failing test, a missing doc section), each giving exit ≠ 0. Or reword the Verify line.

### [LOW] The NFR-02 / NFR-03 evidence predates the final code
**Location**: specs/001-agentic-ai-platform/tasks.md:345, :347
**Issue**: `gate:repeat` (10 identical verdicts, keys removed) ran before the 29.5 code commit `206e5bf`. Only single gate runs (offline, `TURBO_FORCE`) were made on the 29.5 tree. The final code changes two routes and the agent factory, so the determinism evidence is one code change behind.
**Evidence**: The 29.2 partial note (gate:repeat, 1m59s) comes before 29.5. The offline note gives web 305, which includes the 29.5 tests, but it is a single run.
**Confidence**: medium
**Fix**: Re-run `mise run gate:repeat` without API keys on `8c161d8` and record the result. This is cheap (about 2 minutes).

### [LOW] Latency is stamped at DOM mutation, not paint; the real-route variant may measure a single read
**Location**: apps/web/e2e/support/latency-probe.ts:55-66; apps/web/e2e/latency.spec.ts:51-70
**Issue**: The reflect time is taken when the `MutationObserver` callback runs (commit), so render-to-paint time is excluded. The NFR says "画面に反映". The comment is honest about this. In the real-route test, the mock model may deliver all deltas in one network read. In that case every chunk shares one `receivedAt`, and the check reduces to "the final text appeared within 100 ms of the first byte".
**Evidence**: Comment: "the stamp is the commit time, not the paint time". `expect(chunks.length).toBeGreaterThan(0)` is the only size check on the real route.
**Confidence**: medium
**Fix**: Optionally stamp with `requestAnimationFrame` after the mutation, which is closer to paint. For the real route, record and annotate how many distinct `receivedAt` values were seen.

### [LOW] The E2E web server inherits the caller's environment
**Location**: apps/web/playwright.config.ts:24-31
**Issue**: Playwright merges `process.env` into the `next start` environment. A learner who exports `AGENT_MAX_STEPS`, `AGENT_TOOL_TIMEOUT_MS`, `TAVILY_API_KEY` and similar variables changes what the real-server specs see. Req 1.17 ("API キーなしで") is not enforced locally.
**Evidence**: `env: { ...DEFAULT_ENVIRONMENT_VARIABLES, ...process.env, ...this._options.env }` (Playwright `runner/index.js:872`). The config overrides only `AI_RUN_MODE` and `NODE_ENV`.
**Confidence**: medium
**Fix**: In `webServer.env`, blank out the credential and limit variables, or build the env from an allow-list.

### [LOW] `mock:` model IDs are written outside the catalog, including one that is not in the catalog
**Location**: apps/web/e2e/chat.spec.ts:18, :71; apps/web/e2e/support/mock-api.ts:324
**Issue**: Constitution principle 8 says model IDs outside the catalog must not appear in code. The specs hard-code `mock:general-v1` and invent `mock:alternative-v1`. `check:model-ids` has no `mock:` family, so the gate cannot see either. W4 component tests already use the same pattern, so this is a convention gap, not a W5 regression.
**Evidence**: `const ALTERNATIVE_MODEL = { id: "mock:alternative-v1", … }`; `/\{\\"id\\":\\"mock:general-v1\\",…/`
**Confidence**: medium
**Fix**: Derive the base ID from `defaultModelFor("mock","mock","chat")` (importable in the spec), or record an explicit `mock:` exception in plan C20.

### [LOW] The usage assertions cannot tell input from output tokens
**Location**: apps/web/e2e/chat.spec.ts:66-67
**Issue**: The mock scenario reports `inputTokens: 0, outputTokens: 0`, so the assertions "入力 0 トークン" and "出力 0 トークン" pass even if the two fields are swapped or one is read twice.
**Evidence**: Fixture `"usage":{"inputTokens":0,"outputTokens":0,…}`.
**Confidence**: high (the impact is small; unit tests cover `MessageMeta`)
**Fix**: Give the `m1-2/chat` scenario distinct non-zero usage, for example 12 and 34, and regenerate the fixtures.

### [LOW] Research and plan records were not updated for the new local defaults
**Location**: specs/001-agentic-ai-platform/research.md:319; plan.md:146
**Issue**: research.md still lists "❓ Ollama の既定モデル … to resolve in: 実装" as open. plan.md says the mock embedding dimension is 768 "（`embeddinggemma` に合わせる）". The new IDs' evidence (`ollama show`, 2026-10-12) exists only in the catalog comment and the tasks Notes. Constitution principle 8 names research.md Evidence as the verification place.
**Confidence**: high
**Fix**: Close the research question with the `ollama show` evidence and the Ollama version (0.40.3). Change the plan's 768 rationale to the current embedding model (also 768, so no code change).

### [LOW] The CI E2E job keeps traces on failure but never uploads them
**Location**: .github/workflows/ci.yml `e2e` job; apps/web/playwright.config.ts:15
**Issue**: `trace: "retain-on-failure"` writes to `test-results/`, which the job discards. A CI-only failure, such as latency on a slow runner, leaves nothing to inspect.
**Confidence**: high
**Fix**: Add an `actions/upload-artifact` step, pinned by SHA, with `if: failure()` for `apps/web/test-results/`.

### [LOW] `SSE_FIXTURES=write` in the caller's environment turns the fixture check into a rewrite
**Location**: scripts/e2e/generate-sse-fixtures.mjs:39-41; mise.toml `[tasks.test]`
**Issue**: The write mode depends only on the environment variable. If a developer leaves it exported, `mise run gate` rewrites the fixtures and passes, and the stale-fixture protection disappears for that run.
**Confidence**: low
**Fix**: Set `SSE_FIXTURES = ""` in `[tasks.test]` env, or make the gate reporter fail when the variable is set in the `gate` suite.

### [LOW] Unrelated edit to an existing test: model-ID fixtures changed from `qwen3` to `gemma4`
**Location**: scripts/check-model-ids.test.mjs:33, 42, 60, 137, 145, 263
**Issue**: An existing test was changed without a recorded reason in the catalog-switch commit `6a41888`. The `qwen` family is still detected, so coverage did not drop. This is noted only because "existing test modified" is a review trigger.
**Confidence**: high (no impact)
**Fix**: None needed. Optionally, note the change in the commit or Notes.

### [LOW] (prior: 29.5 LOW, unresolved) The module docs do not say that chat and the agent share the Ollama `num_ctx`
**Location**: docs/modules/1-2-ai-sdk-core-and-tools.md; docs/modules/1-3-structured-output-and-summaries.md:143
**Issue**: 1-3 says `streamSummary` sends `num_ctx`. 1-2 does not mention that chat and the agent now send the same value, or the memory cost (about 10 GB resident). Kept out of the verdict.
**Fix**: Add one sentence to 1-2's Ollama hands-on step.

### Checked and found sound
- **`ci-status`**: `needs: [gate, e2e, secret-scan, audit, mutation, client-bundle]` lists all six plan C2 jobs, with `if: always()`. It requires each result to be `success` (so `skipped` or `cancelled` fail), and the matrix result is aggregated.
- **New CI jobs**: they use the same SHA-pinned `actions/checkout` and `jdx/mise-action`, `persist-credentials: false`, `mise run setup` (frozen lockfile) and workflow-level `permissions: contents: read`. `actions-pinned` and `frozen-lockfile` scan the workflow. The matrix value interpolated into `run:` is static.
- **`assert-playwright-nonempty`**: it fails on 0 collected tests, all tests skipped, and a required project with 0 executed tests. The required list comes from `E2E_PROJECTS`, so each matrix job requires its own engine. Errexit prevents a stale `results.json` from being read after a Playwright failure, and `test-results/` is gitignored.
- **`check-client-bundle`**: it fails on 0 files and on a schema with no secret names, and it never echoes the value.
- **SSE fixtures**: `verifyOrWriteFixture` refuses empty streams and requires a byte-exact match in the normal mode. The fixtures come from route tests that use explicit `MOCK_ENV` and shared scenarios. The fixtures contain no secrets.
- **`mockApi`**: it returns 501 for unplanned `/api/**` paths and fails loudly when `mapEvents` finds no event or `offerAlternativeModel` finds no model list. The chat, agent and summarize assertions use the held-stream state (partial text visible, rest absent, Stop visible, Send disabled), so they are not tautological.
- **Source changes**:
  - `ollamaRuntimeOptions` is applied on all three paths.
  - The Turbopack fix in `mock/fixtures.ts` is behavior-preserving.
  - The Firefox `:focus-visible` outline fix is covered by `keyboard.spec`.
- **Dependencies**: `@tailwindcss/postcss` is the only new dependency (recorded in W4 traceability as approved).
- **Tags and docs**: the tags exist and point at the commits the docs name. The docs' file paths resolve.
- **Zero-tolerance list**: no TODO/FIXME was found in the files I read. The swallowed `catch {}` blocks in `mock-api.ts` / `latency-probe.ts` are commented and limited to parsing.

## Verdict
REQUEST_CHANGES

One HIGH (hands-on env loading) and five MEDIUM findings, all fixable in docs, specs or scripts without touching ai-core behavior. No CRITICAL finding. The gate and CI wiring is non-vacuous.

## Hallucination Signal
forced: false

## Resolution (2026-10-12)
- HIGH (root `.env.local` never reaches the web app): fixed. New `mise run dev` task (and `mise run record`) starts `next dev` through `node --env-file-if-exists=.env.local`, so the root file is loaded and variables already set in the shell win, as in Next.js. Docs 1-1, 1-2, 1-3 and `README.md` now start the app with `mise run dev`. Verified by hand in a disposable worktree whose `.env.local` held `AI_RUN_MODE=mock`, `AGENT_MAX_STEPS=1`, `PORT=3123`: the server listened on 3123, and `POST /api/agent/tools` ("東京の天気を教えて") finished with `provider: mock`, `stopReason: step-limit`, `steps: 1` (the 1-2 hands-on).
- MEDIUM 1 (`docs:check` accepts tests that never run): fixed. `TEST_CALL` accepts only `concurrent` / `sequential` modifiers and requires a call that is not a member access (`(?<![.\w$])`). Tests: `never names a test that does not run: skip, only, todo, fails`, `ignores .test(...) calls that are not test declarations`; the old "is skipped but named" expectation was the defect and was removed. RED observed with the old regex. The 51 existing references still resolve.
- MEDIUM 2 (tags predate the local-model switch and 29.5): fixed in docs, no re-tag (plan C22). 1-2 and 1-3 "含まれないもの" list both later changes; the 1-3 budget table says it shows the current catalog and gives the tag's 40,960 / 28,672.
- MEDIUM 3 (progressive summary E2E uses hand-written partial events): fixed. New generated fixture `summarize-article.sse` (route test `matches the generated SSE fixture of a streamed article summary …`, 10 growing `data-summary` events); `summarize.spec.ts` holds after the third and `progressively` is gone. PROVE: holding after the fourth fails on `not.toContainText("ツールを安全に使う")`.
- MEDIUM 4 (axe only on empty screens): fixed. `a11y.spec.ts` also scans six rendered states in both themes (chat answer, chat error with resend, agent card and run summary, agent tool failure, summary skeletons, finished summary and processing info): +12 tests per engine. PROVE: a low-contrast colour on the weather card fails only `/agent: agent weather card and run summary … (light)` with `color-contrast (serious)`.
- MEDIUM 5 (1-1 says `docs:check` is not in `gate`): fixed. The stage table has a `docs:check` row and the "予定" paragraph is gone; "ローカルの注釈付きタグ" in 1-2 and 1-3 now reads "注釈付きタグ".
- LOW (prior 29.5, docs do not say chat and agent share `num_ctx`): fixed in 1-2 hands-on step 1, with the ~10 GB resident cost.
- Other LOW (14): accepted for M1 and recorded in `traceability.md`. None changes a verdict of a gate stage or a requirement; the E2E-coverage ones (skip-link focus, keyboard-only coverage of the agent screen, focus-contrast alpha parsing, latency stamping, trace upload) are candidates for M2 hardening; the evidence ones (29.1 per-stage injection, NFR-02/03 before the final code) are superseded by the gate runs below and CI on this PR.
- After fixes: `mise run gate` exit 0 (root 299, ai-core 702 / 4 skipped, eval-suite 3 / 1 skipped, web 306, `Docs: 4 module documents, 51 test references verified`); `mise run test:e2e` exit 0, `executed=159 skipped=0 (chromium=53 firefox=53 webkit=53)`.
