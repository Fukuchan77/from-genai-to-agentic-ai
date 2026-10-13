# Do Phase: rag-and-workflows

## Success Criteria

- Task fidelity: the six dependencies are pinned exactly as `plan.md` declares them; config, catalog, ports, `generateValidated`, and the repository checks match plan C1/C2/C3/C17.
- Consistency: every public contract that later waves use (`DEFAULT_RAG`, `DEFAULT_WORKFLOW_LIMITS`, `MODEL_TIERS`, `defaultRerankModel`, `RerankProvider`, `generateValidated`) is covered by tests that fail when its value or behavior changes.
- Safety: no secret in errors or cassettes (`COHERE_API_KEY` is redacted; errors carry paths and constraints, never generated text); `pnpm audit` reports 0 vulnerabilities.
- Performance: `mise run gate` stays within the 5-minute budget (constitution principle 3).
- Cost: no new service or network access in the gate.

## Implementation Log

### 2026-10-12 W1 Started (branch `feat/m2-w1-foundation`, tasks 1.1–4.4)

- Preflight skipped: W1 lanes are pure unit tests (no env variables, no external service).
- Execution mode: tasks run in one session (they share `mise.toml`, `catalog.ts`, and the gate), with no context compaction needed.

### Task 1.1 (dependencies)

- `pnpm view <name>@<version> time` publish ages: drizzle-orm 0.45.4 (95 h), @electric-sql/pglite 0.5.8 (1119 h), pglite-pgvector 0.0.9 (1119 h), postgres 3.4.9 (4555 h), unpdf 1.8.1 (1429 h), @ai-sdk/cohere 4.0.59 (84 h). All are older than 24 h.
- `pnpm install`: `+6` packages, no `allowBuilds` warning, so `pnpm-workspace.yaml` is unchanged. `pnpm audit`: "No known vulnerabilities found". `pnpm install --frozen-lockfile`: "Lockfile is up to date".
- Test-first does not apply (manifest only); `_Verify:_` is the install/audit/gate evidence above.

### Task 1.2 (knowledge/ and the bundle sentinel)

- `git check-ignore -q knowledge/sample.md` → ignored; `git check-ignore -q knowledge/README.md` → tracked. `mise tasks validate` → "All 26 task(s) validated successfully". `COHERE_API_KEY` sentinel `changeme-bundle-sentinel-cohere` is in the env table and in `--sentinel`.
- `knowledge/README.md` states the formats and limits from plan C5 (`.md`/`.markdown`/`.pdf`, scanned PDFs skipped as `no-text`, single-segment file names).

### Task 2.1 (config)

- RED: 11 failures in `env-schema.test.ts`, `feature-requirements.test.ts`, `load.test.ts` (missing `DEFAULT_RAG`, `COHERE_API_KEY`, `database`).
- GREEN: 35 passed in `src/config`.
- PROVE: stubbed `port > 99_999`, `host: "localhost"`, dropped `credentials.cohere`, `rerank: ["TAVILY_API_KEY"]`, and `rrfK: 61` → 7 failures (e.g. `expected { host: 'localhost', port: 5432, … } to deeply equal { host: '127.0.0.1', … }`, `expected [ 'TAVILY_API_KEY' ] to deeply equal [ 'COHERE_API_KEY' ]`, "rejects POSTGRES_PORT=70000 … expected function to throw"). Restored: 35 passed.
- Decision: `POSTGRES_PORT` stays `optionalString` in the schema (M1 contract) and is parsed in `load.ts`; an invalid port is a `ConfigError`. `DEFAULT_DATABASE` is an extra exported constant (not in the plan's list) so the Compose defaults live in one place.

### Task 2.2 (catalog)

- RED: 6 failures (`judge` default still `mock:general-v1`, `MODEL_TIERS`/`RERANK_MODELS`/`defaultRerankModel` missing).
- GREEN: 64 passed, 2 skipped in `src/models`.
- PROVE: stubbed mock `judge` back to `general-v1`, local `light` = `capable`, openai `capable` ≠ `light`, rerank `provider: "mock"` → 6 failures (e.g. `expected 'mock:general-v1' to be 'mock:judge-v1'`, `expected 'granite4.2:latest' not to be 'granite4.2:latest'`). Restored: 64 passed.
- Impact scan (plan C1 "既知の影響"): `mise run test` after adding `mock:judge-v1` → web 306/306, ai-core all green, so **no `apps/web` test needed a change**. `apps/web/e2e/**` was reviewed by reading: `chat.spec.ts` picks the alternative model by display name and `mock-api.ts` `offerAlternativeModel` copies the first `mock:general-v1` entry of the model list, so an extra option does not affect them. The Playwright run itself is not part of W1 (W5 runs it).
- Decision: the Cohere rerank model is `rerank-v4.0-pro` (research.md I-4: multilingual); rerank models live in `RERANK_MODELS`, outside `MODEL_CATALOG`, so they never appear in model pickers or `listModels`.

### Task 2.3 (gateway secrets)

- RED: `expected '{"version":1,"key":…' not to contain 'test-cohere-key'`. GREEN: `credentialSecrets` gets `COHERE_API_KEY`; 30 passed in `gateway.test.ts`. The RED run is the PROVE (the unmodified implementation leaks the key).

### Task 3.1 (Rerank port)

- The test file was written before the module existed (import failure is the RED); GREEN: 21 passed.
- PROVE: removed the sort/slice, the index range/duplicate check, the timeout branch, and `maxRetries: 0` → 5 failures (applies topN…, out-of-range index, duplicated index, timeout reason, default SDK call). Restored: 21 passed. `rerank.ts` coverage: 100% lines.
- Decision: `RerankSdkCall` is the injectable seam (default builds `createCohere({ apiKey }).reranking(modelId)` and calls `ai`'s `rerank` with `maxRetries: 0`, since CL-11 falls back instead of retrying). The caller's abort is rethrown as the signal's reason; a timeout and any SDK/response failure are `source-unavailable` with `details.provider = "cohere"`.

### Task 3.2 (`generateValidated`)

- RED: `Cannot find module './errors'`. GREEN: 18 passed. `structured/` coverage: 97.82% lines.
- PROVE: removed the feedback in the retry prompt, the abort check, the usage accumulation on `NoObjectGeneratedError`, the extra `validate`, and set the default to 3 regenerations → 7 failures (regeneration prompt, third-attempt error, extra validation ×2, usage ×2, abort). Restored: 18 passed.
- Decision: system text goes through `instructions` (as `summarize/pipeline.ts` does); the result `usage` is `{ inputTokens, outputTokens, totalTokens, cacheReadTokens }` as plain numbers.

### Task 4.1 (repo rules)

- RED: 30 failures. GREEN: 135 passed in `check-repo-rules.test.mjs`. PROVE: disabled relative-import matching, the `ToolLoopAgent` match, and the `sql` alias → 20 failures; restored: 135 passed.
- `workflow-no-agent-loop` scans test files of `workflows/` and `patterns/` too (plan: "全ファイル"), so a later test there must not import the agents area.

### Task 4.2 (model-ID check)

- RED: 2 failures. GREEN: 19 passed. The `rerank-` family needs a version or variant word (`rerank-v4.0-pro`, `rerank-multilingual-v3.0`, `rerank-2.5`) so `05-rerank-and-evaluation.md` and `rerank-skipped` are not flagged. PROVE: plain `"rerank-"` pattern → "does not flag rerank words that are not model IDs" fails; restored: 19 passed. `mise run check:model-ids` → "scanned 240 files", exit 0.

### Task 4.3 (docs topics)

- RED: 5 failures. GREEN: 29 passed; PROVE: removing the `mock` and threshold topics from `2-1` → "requires module 2-1 to explain what a green mock run cannot show" fails; restored: 29 passed. The topic strings are the headings 26.1/26.2 must contain.

### Task 4.4 (W1 closing)

- `mise.toml` `check:repo-rules --only` gains `no-sql-raw` (`workflow-no-agent-loop` is wired at 19.2).
- First `mise run gate` failed at `lint` (Biome formatting of 8 new files and one `noTemplateCurlyInString` warning in a test string). Root cause: files were written by hand without running the formatter. Fix: `mise run lint:fix`, and the test now builds the `${` text from pieces. No blind retry.
- Second `mise run gate`: exit 0 in 12 s. Evidence: `Biome: 257 files`, `Model ID check: scanned 240 files.`, `no-sql-raw: scanned 112 FILES`, `no-dynamic-eval: scanned 232 FILES`, typecheck `ai-core 116 files`, tests `//:test executed=337 passed=337`, `@platform/ai-core executed=761 passed=761 skipped=4`, `web executed=306 passed=306`, `eval-suite executed=3 passed=3 skipped=1`, `Docs: 4 module documents, 51 test references verified`.

### 2026-10-12 W1 adversarial review (round 1)

- `sdd-reviewer` (fresh context) → REQUEST_CHANGES, 3 MEDIUM + 12 LOW; report `.sdd/reviews/002-rag-and-workflows-impl-w1-review-2026-10-12.md`.
- Fixed with tests first (RED: 13 failures in `check-repo-rules.test.mjs`, 6 in config/rerank/structured): F-1 (`Experimental_Agent`), F-2 (syntactic `sql.raw`/`unsafe` forms), F-3 (closed error classification), F-4 (strict port parse), F-6 (timer/listener cleanup), F-7, F-8 (strict-schema key names), F-9 (tighter `rerank-` shapes). PROVE for F-6: removing `clearTimeout` and `removeEventListener` fails both new tests.
- Final `TURBO_FORCE=true mise run gate`: exit 0 in 13 s; `//:test executed=351 passed=351`, `@platform/ai-core executed=769 passed=769 skipped=4`, `web executed=306 passed=306`; `pnpm audit` clean.
- Learning: the first implementation of a lexical rule covers the plan's literal wording; the reviewer found the real bypasses through library aliases (`Experimental_Agent`), so rule tests should list every export name of the guarded symbol.

### 2026-10-12 W1 ship validation (`/sdd-ship rag-and-workflows W1`)

- Validation: all 11 W1 subtasks `[x]` with Implementation Notes on tasks 1–4; every changed file is inside its task's `_Boundary:_`; PROVE evidence is recorded for each new test group above; the adversarial review findings F-1..F-9 are fixed test-first.
- Gate (`TURBO_FORCE=true mise run gate`, 0 cached): exit 0. `//:test executed=351 passed=351`, `@platform/ai-core executed=769 passed=769 skipped=4` (`rerank.test.ts` 24 tests, `generate-validated.test.ts` 19 tests; `rerank.ts` 100% lines), `web executed=306 passed=306`, `eval-suite executed=3 passed=3 skipped=1`, `Docs: 4 module documents, 51 test references verified`, `pnpm audit` clean.
- Mechanical fixes: `tasks.md` progress table (W1 marked complete), `AGENTS.md` repository-rule count (nine -> ten wired), `traceability.md` Test/Commit cells.
- Commits: b5f32ab (deps), f5f9490 (ai-core), f4b73f1 (repo checks).

### 2026-10-12 W2 `/sdd-impl` start

- Preflight: `mise.toml` has no `preflight` task. Gate lane (mock) needs no env or service: OK. DB lane (`test:db`): Docker daemon not running (`docker info` socket error) → 5.3 and 7.4 `*.pg.test.ts` can be written but not executed (task text allows it; recorded as human steps). `NODE_ENV=development` leaks into the shell → `unset NODE_ENV` before build/E2E (9.2). Port 3000 and 5432 free.
- Task 6 delegated to a fresh-context subagent (independent of task 5, disjoint boundary); it must not run the full gate or edit tasks.md / do.md.

### Task 5.1 (migrations + schema + migrator)

- RED: `Cannot find module './migrate'`; the real-migration test failed with `ENOENT … drizzle` until the SQL file existed. GREEN: 9 passed.
- PROVE: removed `.sort()` → initially still green (APFS lists names in order: vacuous!). Fixed the test to mock `readdir` in reverse order; then `.sort()` removed → 3 failures (`expected [ '0010', '0002', '0001' ] to deeply equal [ '0001', '0002', '0010' ]`). Never-skip-applied → 2 failures; no transaction → rollback test fails (`expected true to be false`); accept any `.sql` → `expected [ '0001_first.sql', …(2) ] to deeply equal [ '0001_first.sql' ]`. Restored: 9 passed.

### Task 5.2 (client + schema checks)

- RED: `Cannot find module './client'`. Two follow-up fixes found by the first GREEN run: the generated-column error text is `can only be updated to DEFAULT`; postgres.js retries a blocked socket until `connect_timeout` (5 s = test timeout) so the connection-failure path uses a fake `postgres` module (the real driver is covered by `client.pg.test.ts`). GREEN: 22 passed.
- PROVE (8 breaks, each restored from a copy): drop `CHECK (page >= 1)`, drop `ON DELETE CASCADE`, drop `UNIQUE (document_id, ordinal)`, `tsv` from `body`, rename `search_text` in `schema.ts` (6+ failures), `page` notNull drift in `schema.ts`, drop the HNSW index, drop `client.end()` on failure → each fails exactly the expected test (e.g. `closes the connection pool when the server cannot be reached`, `rag_chunks: column names, types and nullability agree`). Restored: 22 passed.

### Task 5.3 (pg test + index)

- `client.pg.test.ts` uses a scratch database (`CREATE DATABASE rag_pg_test_<hex>`), so `mise run test:db` never touches the learner's `agentic_ai`. Without a server, `AI_TEST_SUITE=pg` fails with `connect ECONNREFUSED 127.0.0.1:5432` at `CREATE DATABASE`. **Not executed against Postgres** (no Docker): research.md R-2 table left "未実測".
- Typecheck caught what Vitest cannot: `Record<string, unknown>` vs `Record<string, never>` schema types, and `unknown` rows from the shared-type `execute`. `tsc` clean for `rag/db` after the fixes; `biome check --write` clean.

### Task 6 (ingest parts, delegated to a fresh-context subagent; re-verified in the main session)

- Subagent evidence: 148 tests in 6 files; RED per file (`Cannot find module`); PROVE per file with stub → failure message (e.g. `markdown`: fence ignored → `expected [ …(4) ] to have a length of 1 but got 4`; `chunk`: no `-2` suffix → `expected '2461fb1936c3f46e' to be '2461fb1936c3f46e-2'`; `search-text`: `&` join → `expected '全文 & 検索' to be '全文 | 検索'`; `pdf-builder`: only first page in Kids → `expected 1 to be 3`; `loader`: containment removed → `expected { file: 'escape.md', …(4) } to be an instance of PlatformError`). Three vacuous tests were found by PROVE and fixed (code-point vs UTF-16 length; Buffer input rejected by pdf.js — a real bug fixed with `new Uint8Array(bytes)`; segmenter locale `"ja"` cannot be pinned by a test).
- Main-session verification (bare shell is Node 24; `mise exec --` is Node 26.10.0): `vitest run src/rag src/testing` → 11 files, 206 passed, 2 skipped (pre-existing `local-only`); `biome check packages/ai-core` → 147 files clean; `tsc -p packages/ai-core` → no errors. Re-ran the loader PROVE (containment check removed) → 4 symlink tests fail; restored → 49 passed.
- Learning: the shell `node` is v24 while the project pins 26 — run vitest through `mise exec --` (or `mise run`) for evidence.

### Task 7.1 (embedding)

- RED: `Cannot find module './embedding'`. GREEN: 18 passed.
- PROVE: openai `dimensions: 1536` → `asks OpenAI for 768 dimensions…` fails; google key renamed → 2 failures; length check disabled → 4 failures; early `throwIfAborted` removed → `does not call the model when the signal is already aborted` fails; compat ignoring model ID / rejecting an empty base → 1 failure each. The `values.length === 0` guard was redundant (`embedMany([])` returns `[]` by itself, the test still passed with the guard stubbed out), so it was removed and the test kept as a regression check on the SDK behavior.

### Task 7.2 / 7.3 (store)

- RED: `Cannot find module './store'` (16 write-side tests), then `store.searchByVector is not a function` (19 search tests). GREEN: 39 passed (incl. limit validation). Found by review of my own test: the first helper used `sql.raw`, which the `no-sql-raw` rule forbids in tests too → `db.$count(table)`.
- PROVE write side (8 stubs): `new Date()` instead of the clock; delete removed; tags not deduped; compat check removed; no transaction (rollback test fails); write validation removed; reset keeps meta; getChunks in DB order. The last one was first NOT caught by the intended test (DB order coincided) → the ordering test was strengthened (5 chunks, reversed request) and the stub then failed it: `returns chunks in the requested order and omits unknown ids`.
- PROVE search side (9 stubs): `gte`→`gt` (threshold-exact test fails), `desc(distance)`, tag filter dropped, `limit` dropped, `PLAIN_OR_QUERY` check off, `undefined` query searching, `ts_rank` ascending, similarity = distance, empty filter lists → each fails the targeted tests. Restored: 39 passed.
- ai-core suite after tasks 5–7: `vitest run` → 52 files, 1005 passed, 4 skipped; `tsc` and `biome` clean.

### Task 7.4 (store.pg.test.ts)

- Created with the same inputs as `store.db.test.ts` in a scratch database. Not executed against Postgres (no Docker); `AI_TEST_SUITE=pg` fails with `ECONNREFUSED 127.0.0.1:5432`. research.md "W2 7.4 の記録" holds the empty table.

### Task 8.1 (ingestDocuments)

- RED: `Cannot find module './ingest'`; GREEN: 21 passed (18 first pass + 3 added after PROVE).
- PROVE (9 stubs): eval prefix → `kb:`; no compat check; no outer transaction; reset ignored; no abort check after embedding; file limit off; no name dedupe; request tags dropped; signal not passed to `embedTexts`. Three were NOT caught by the first test set (compat check, outer transaction, signal propagation) → tests added: "rejects another embedding model before calling the embedding API" (`expected 1 to be +0`), "writes all documents or none…" (`expected [ 'kb:a.md' ] to deeply equal [ 'kb:old.md' ]`), "passes the abort signal to the embedding model" (`expected false to be true`). All three then fail under their stubs.

### Task 8.2 / 8.3 (request schema, rag/index.ts)

- RED: `Cannot find module './request-schema'`; GREEN: 29 passed. PROVE (6 stubs): `z.object` → unknown-field test; refine removed → the path-like names fail; tag length by UTF-16 units → `counts characters, not UTF-16 units`; `reset` default true; `min(1)` removed; `maxTags` 11 → each fails its test. `isSafeFileName` exported from `loader.ts` (loader tests still 49 passed).
- 8.3: `rag/index.ts` created; `tsc` clean; `mise run check:repo-rules` → all 10 rules pass (`no-sql-raw: scanned 143 FILES`); `grep agents packages/ai-core/src/rag` → no import.

### Task 8.4 (platform)

- RED: `Cannot read properties of undefined (reading 'knowledge')` (10 failures); GREEN: 35 passed. PROVE (6 stubs): mock→postgres (3 fail), wrong DB config (2), no caching (**the test run never terminated — CPU 100 %, killed by hand; detected, but a hang is not an assertion message**), failure cached (`does not cache a failure…`), cwd-based knowledge root (2), override ignored (`can be replaced for tests`).

### Task 8.5 / 8.6 (routes)

- 8.5 `GET /api/rag/knowledge`: 8 tests. PROVE (6 stubs): rerank always available, every embedding error → null, meta ignored, no-default rethrown, wrong dims, no `toErrorResponse` → each fails its targeted tests. A first PROVE run printed nothing because macOS has no `timeout`; it was discarded and redone.
- 8.6 `POST /api/rag/ingest`: 25 tests (incl. 413 / 9 × 400 / symlink escape / live-only 429 / reset rebuild / 502 / 503 / signal). PROVE (9 stubs) all detected after strengthening the clock test (stub "clock not passed" had survived: the test now asserts `ingestedAt` from the fake clock). `tsc -p apps/web` clean after fixing `GET(request())` → `GET()` in the tests.
- Web suite subset: `vitest run app/api/rag lib/server/platform.test.ts` → green.

### Task 9.1 / 9.2 / 9.3 (corpus, real server, W2 close)

- 9.1 RED: 3 failing tests (6 files `not-found`). The first corpus had no section over 800 characters → the split-path assertion failed (`expected 0 to be greater than or equal to 1`); a paragraph pair was added. PROVE: default max 2000 → `expected 866 to be less than or equal to 800`; long section removed → split assertion fails; one file removed → 3 failures. `check:model-ids` found real model-ID literals in my new tests (15 places) → replaced with `MODEL_DEFAULTS`.
- 9.2 RED: `next build` failed on `new URL("../../../drizzle", import.meta.url)` (`Module not found`), fixed with `path.resolve`; then a Turbopack "whole project traced" warning on `loader.ts` → `turbopackIgnore`. After that: `next build` clean; `E2E_PROJECTS=chromium` 57 passed; full `mise run test:e2e` → `171 passed`, `Playwright: executed=171 skipped=0 (chromium=57 firefox=57 webkit=57)`; `next dev` smoke: knowledge 200, ingest 200; `mise run check:client-bundle` → `scanned 20 files for 14 names and 3 sentinels`. Side effects of `next dev` reverted (`next-env.d.ts`, generated `apps/web/AGENTS.md`). `NODE_ENV=development` leaks in the shell: all builds were run with `NODE_ENV=production` explicitly.
- 9.3: `stryker.config.mjs` + 3 files. `mise run test:mutation` → `Final mutation score of 86.59` (chunk 84.62, markdown 78.79, search-text 94.44), exit 0. `TURBO_FORCE=true mise run gate` → exit 0 in 20 s: `//:test executed=351 passed=351`, `@platform/ai-core executed=1058 passed=1058 skipped=4`, `web executed=349 passed=349`, `eval-suite executed=3 passed=3 skipped=1`, `Biome: 292 files`, `no-sql-raw: scanned 143 FILES`, `Docs: 4 module documents, 51 test references verified`.
- Adversarial review (wave close): see below.

### W2 adversarial review (round 1)

- `sdd-reviewer` (fresh context, resumed once after an API session limit) → REQUEST_CHANGES: 5 MEDIUM (F-1..F-5), 14 LOW; report `.sdd/reviews/002-rag-and-workflows-impl-w2-review-2026-10-12.md`.
- Fixed test-first (RED: 7 ai-core + 3 web failures): F-1 on-disk name as document ID + dedupe, F-2 reset honored with nothing to ingest + result reports the base's model, F-3 closed `invalid-request` reasons reach the client, F-4 unreadable files skipped as `parse-failed`. PROVE: 7 stubs (unreadable mapping off, requested spelling used, no dedupe, reset ignored, requested model reported, allow-list off, details dropped) each fail the targeted tests. F-5: pg test added, NOT run (no Docker); LOW items answered in the review's Responses table.
- Final `TURBO_FORCE=true mise run gate`: exit 0; `//:test executed=351`, `@platform/ai-core executed=1066 passed=1066 skipped=4`, `web executed=354 passed=354`, `eval-suite executed=3`, `Docs: 4 module documents, 51 test references verified`.
- Learning: a lexical review of the happy path missed filesystem semantics (case-insensitive APFS, EACCES) and "empty result" branches (reset with nothing to ingest); list the zero-item and permission cases when writing the first tests.

### 2026-10-12 W2 `/sdd-ship`

- First verdict NO-GO: `apps/web/lib/server/errors.ts` / `errors.test.ts` (review F-3 fix) were outside every `_Boundary:_`. The user approved widening the 8.6 boundary; `tasks.md` boundary, notes and W2-close note updated.
- Gate (`TURBO_FORCE=true mise run gate`, 0 cached): exit 0. `//:test executed=351`, `@platform/ai-core executed=1066 passed=1066 skipped=4`, `web executed=354 passed=354`, `eval-suite executed=3 skipped=1`, `Biome: 292 files`, `no-sql-raw: scanned 143 FILES`, `Docs: 4 module documents, 51 test references verified`.
- Not run: `*.pg.test.ts` (no Docker); LOW findings F-6..F-17, F-19 deferred.
- Commits: 5cd0a52 (ai-core), b904eff (web), 4f01313 (stryker); docs commit follows.

## W3 (tasks 10–15)

- Preflight: gate lane is `mock` and needs no env or service → skipped (no `mise preflight`). `*.pg.test.ts` still not runnable (no Docker).
- Delegation: 10.1–10.4, 13.1–13.3, and 11.1/11.3/12.1 went to three fresh-context subagents in parallel (disjoint boundaries, no gate/tasks.md/do.md edits); their evidence was re-run in the main session (e.g. `vitest run src/rag/eval` → 77 passed). 10.5–10.8, 11.2, 11.4, 12.2, 13.4, 14.x, 15.x were done in the main session.

### Evidence summary (RED → GREEN → PROVE)

- 10.5–10.8 (`pipeline.db.test.ts`, 49 tests incl. 16 method combinations): RED `Cannot find module` / 6+7+21 failing; PROVE stubs: no topK slice (`expected [... 'c-low'] to deeply equal [...]`), filter dropped, threshold −1, empty-KB guard removed (`expected 1 to be +0` embed calls), compat check removed, full-text rescues no-evidence (CL-1: `expected [ {…} ] to deeply equal []`), no dedupe, sequential searches, pool ignored, hybrid-off still searching, hyde ignored, usage dropped (×2), swallow abort, wrong reason, topN, rerank not skipped on disabled. Survivors found and fixed: RRF `k` (score pinned to 2/61), zero-word full-text, Rerank score kept, unknown-ID fallback, no-evidence Rerank stage.
- 11.2/11.4: prompt PROVE (label from 0, no escaping, instruction text, no throw on empty, signal dropped, question dropped) – one vacuous instruction assertion strengthened. `query.db.test.ts` PROVE: resolve skipped, noEvidence calls LLM, usage dropped, text not forwarded, raw error forwarded; **real bug found**: consumer abort right after the `trace` event still started generation → `throwIfAborted()` after the trace yield; abort tests now assert the abort reason (stub "abort converted" is caught).
- 12.2: registry/summarize/searcher PROVE (same label, shared registry, 0-based label, live chunks, any-tool count, filter dropped, signal dropped, instructions) – signal propagation test added after a survivor.
- 14.2: scenario ambiguity/pin tests PROVE: shortened HyDE question → ambiguity failure; corpus text edit → pin failure; judge marker drift → 2 failures. Discovered that `fixtures/**` tests are outside the Vitest `include` → test moved to `src/mock/m2-scenarios.test.ts` (recorded in tasks.md and plan.md).
- 15.1–15.4 PROVE: platform (mock→key, always lexical, always cohere), rag-stream (ids, text-end, detail, swallow errors, raw error text), query route (signal, structured needed, require, rerank wiring, limiter, raw errors, embedding message, modelId), agent route (shared registry, rag metadata, extra tool, require tools, raw errors). Equivalent/unprovable survivors: agent route `stepText` reset (single-step answer in the fixture) and per-request registry (same fixed chunk → same label); both covered at unit level.

### 15.5 (W3 close)

- `mise run test:mutation`: `Final mutation score of 86.46` (rrf 82.98, citations 82.87, recall 93.42; threshold 70).
- First `TURBO_FORCE=true mise run gate`: exit 1 — two PGlite-start tests (`schema.db.test.ts` "independent in-memory database", `platform.test.ts` "real in-memory PGlite") hit the 5 s default timeout when all workspaces run at once (not a logic failure). Fixed by an explicit 30 s timeout on those two tests, then gate re-run: exit 0.
- Gate (`TURBO_FORCE=true mise run gate`): `//:test executed=351`, `@platform/ai-core executed=1430 passed=1430 skipped=4`, `web executed=415 passed=415`, `eval-suite executed=3 passed=3 skipped=1`, `Biome: 333 files`, `Docs: 4 module documents, 51 test references verified`.
- Coverage (`ai-core`): all files lines 98.1 %, `src/rag` lines 100 % (threshold 80 %).

### W3 adversarial review (round 1)

- `sdd-reviewer` → REQUEST_CHANGES (0 CRITICAL/HIGH, 5 MEDIUM F-1..F-5, LOW F-6..F-19). Fixed test-first: F-1 grouped/range footnotes, F-2 rag/index re-exports, F-3 Rerank outcome on early returns, F-4 incremental traces (`onTrace`), F-5 retrieval failures → fixed `provider-unavailable`. Responses table appended to the review file.
- Final `TURBO_FORCE=true mise run gate`: exit 0 in 27 s. `//:test executed=351`, `@platform/ai-core executed=1461 passed=1461 skipped=4`, `web executed=415 passed=415`, `eval-suite executed=3 skipped=1`, `Biome: 334 files`, `Docs: 4 module documents, 51 test references verified`.
- Learning: a first RED pass on happy paths missed "one footnote may hold several numbers", "Rerank on but nothing to rerank" and "failures after the stream starts"; list the grouped/empty/mid-stream cases when writing the first tests.

## W4 (tasks 16–19)

- Preflight: gate lane is `mock` and needs no env or service → skipped. Work is done inline in the main session (no subagents; the session rules allow them only on request). `*.pg.test.ts` still not runnable (no Docker).
- Method note: tests and the first implementation of each task were written in the same step, so the RED observed was "module not found" (16.1) or was not captured separately (16.2–16.7); non-vacuity rests on the PROVE stubs below, run with a `prove.sh` helper (perl substitution → vitest → restore).

### Task 16 (workflows)

- 16.1 limits/errors: PROVE 6 stubs (`>=` boundary, no integer check, override unchecked, `undefined` erases the default, cause leaked into `details`, wrong code) → each fails its targeted test. Added `resolveWorkflowLimits` (overrides may lower, never raise, a default) and, in 16.4 time, `toStepError` (moved into `errors.ts`; shared by parallelization and orchestrator-workers).
- 16.2 prompt chaining: 6 stubs (no stop on failure, input not chained, no abort check, signal dropped, wrong failed step, failed step not recorded) all detected.
- 16.3 routing: 10 stubs; two survivors (`hasOwn` and category-membership guards covered each other) → two tests added (extra handler key not in `categories`; `toString` as category with no own handler); re-proved.
- 16.4 model-tier: 10 stubs; two survivors (initial abort check; base-model reuse in `resolveTiers`) → classifier-not-called assertion and `requests.length === 2` added; re-proved. `resolveTiers` learns mode/provider from the default `chat` resolve, since the gateway does not expose its config.
- 16.5 parallelization: 14 stubs; survivor `tally unsorted` → test added; a delayed-start stub is caught by the order/first-failure tests. The barrier tests would hang (1 s timeout) for a sequential implementation.
- 16.6 orchestrator-workers: 13 stubs; survivor "planner abort signal dropped" → test asserting the model call receives an aborted signal.
- 16.7 evaluator-optimizer: 20 stubs; one equivalent mutant (explicit abort check before `parallelSections`, which checks it itself) removed from the code instead of tested.
- Design decisions: a `PlatformError` other than `output-invalid` (503/400 class) is never wrapped into `WorkflowStepError`, so the route keeps answering 503/400; orchestrate's all-workers-failed error is named `workers`.

### Task 17 (patterns)

- 17.1–17.2: PROVE 14 stubs; one test was vacuous (the `<instruction>` marker also appears in the system prompt) → assertions now read the user message only. The same weakness was found in routing / model-evaluator / orchestrator tests and fixed with `provepy.py` (literal replacement; the perl helper had expanded `${...}` to empty strings in two earlier stubs).
- 17.3 single path: 11 stubs; survivor "no abort after a failing step" → test where the step fails because of the abort (the abort reason, not a step failure, is surfaced).
- 17.4 multi path: 15 stubs; survivors `.length(count)`, section signal, evaluator signal → 2 tests added (extra evaluation entry regenerated; signals reach planner and evaluator calls).
- 17.5 reflection: 16 stubs; equivalent mutants removed from the code (cross without critic is rejected by the same-ID check; the abort check before the critic is done by `generateValidated`); abort-during-critique test added for the check before the revision.
- 17.6 role-based cooperation: 15 stubs; survivors fixed (mock usage split into input/output so a "only input counted" stub fails; system prompt assertion for `instructions`). The repository rule `workflow-no-agent-loop` flagged the test's own `agents/` imports → spy through `vi.hoisted` + `vi.mock`.
- 17.7: `mise`-equivalent checks run directly: `node scripts/check-repo-rules.mjs` → all rules pass (`workflow-no-agent-loop: scanned 30 FILES`, `guarded-agent-only` passes).

### Task 18 (scenarios and demos)

- 18.1/18.2 RED: new `m2-scenarios.test.ts` and `gateway.test.ts` cases failed until `M2_3_SCENARIOS` / `M2_4_SCENARIOS` were wired into `gateway.ts`. PROVE: duplicate marker, bad scenario ID, missing `purpose`, a sample task that contains an M1 marker (`東京の天気` — caught while designing; the sample became `大阪の天気`), unpinned first role turn (ambiguous with the tool-result turn), gateway without the scenarios → each fails a test.
- 18.3 `workflows/demos.ts` (28 tests): 23 PROVE stubs on the first pass; survivors (`passScore`, `maxIterations`, `maxSubtasks` ignored; no abort pre-check; cache-read tokens; option error echoing a key) fixed with 6 tests. Stage-label drift in every composition fails the mock run (the scenario pin).
- 18.4 `patterns/demos.ts` (27 tests): 17 stubs; survivors (target/goal/candidates options, tool capability, researcher's tool, signals) fixed by a capturing gateway and an agent-factory spy; `demos.ts` is asserted not to import the agents area.
- Prompt labels were added to `reflect`, `cooperateByRole` and `createModelEvaluator` after their own tasks (tests first: RED = 3 failing label tests).

### Task 19 (route and wave close)

- 19.1 `apps/web/app/api/workflows/route.ts` (50 tests): 12 stubs; survivors fixed (guard order for kind/name, blank task, code-point length, platform agent limits; the inspect/try-catch was equivalent behavior and was simplified away).
- 19.2: violation examples fail `check-repo-rules --only workflow-no-agent-loop` (exit 1); `mise.toml` and `stryker.config.mjs` updated. `mise run test:mutation` → 86.45 (6 min 46 s, over the 5 min budget); mutation survivors of `evaluator-optimizer.ts` / `parallelization.ts` (boundaries 0/100 of the pass score and scores, names in limit errors) closed with 4 tests; the mutation run was not repeated (7 min).
- `TURBO_FORCE=true mise run gate` → exit 0: `//:test executed=351`, `@platform/ai-core executed=1732 passed=1732 skipped=4`, `web executed=472 passed=472`, `eval-suite executed=3 passed=3 skipped=1`, `Biome: 372 files`, `workflow-no-agent-loop: scanned 34 FILES`, `Docs: 4 module documents, 51 test references verified`. `NODE_ENV=production mise run check:client-bundle` → `scanned 20 files for 14 names and 3 sentinels`; the build lists `/api/workflows`.
- Not run: `*.pg.test.ts` (no Docker), `local`-mode tests (Ollama).
- Adversarial review: spawned with `sdd-reviewer` (fresh context); result recorded below.

### W4 ship validation (2026-10-13)

- `/sdd-ship rag-and-workflows W4`: GO. All of 16.1–19.2 are `[x]`; the review file records F-1 (HIGH) as fixed test-first, F-2/F-3/F-7/F-9/F-12 fixed, the rest deferred as LOW.
- Fresh `TURBO_FORCE=true mise run gate` → exit 0: `//:test executed=351`, `@platform/ai-core executed=1732 passed=1732 skipped=4`, `web executed=472 passed=472`, `eval-suite executed=3 passed=3 skipped=1`, `Biome: 372 files`, `workflow-no-agent-loop: scanned 34 FILES`, `Docs: 4 module documents, 51 test references verified`.
- Auto-fix (mechanical): gate counts in the notes above (1727/465) were taken before the review fixes landed; corrected to 1732/472 in this file and `tasks.md`. W4 row of the progress table marked complete; traceability `W4:` Test/Commit cells filled.
- Not re-run: `test:mutation` (6 min 46 s, last result 86.45 before four boundary tests were added), `*.pg.test.ts`, `local` tests.

## W5 (tasks 20–23)

- Preflight: the gate lane is `mock` and needs no env or service → skipped. Work is inline in the main session (subagents only on request). `*.pg.test.ts` and `local` tests are not runnable here.
- Method: tests first for every sub-task (RED = "module not found"), then GREEN, then PROVE with a literal-replacement helper (`prove.py`: replace one fragment, run vitest, restore). Survivors were closed with extra tests and re-proved.

### Task 20 (RAG screen parts)

- 20.1 `AnswerView`/`CitationList` (30 tests): ~25 stubs; survivors fixed with tests: raw spelling of a card-less full-width footnote, reversed/too-wide ranges, a lone backtick, a longer backtick run not closing a shorter span, the separator between the numbers of a group. Equivalent mutant left: `high < low` in `parseGroup` (a reversed range yields no numbers, so the raw text is drawn either way); it mirrors the server grammar.
- 20.2 `StageProgress`/`TraceView` (21 tests): ~30 stubs; survivors fixed: `aria-live` (the first stub hit the JSDoc comment, not the attribute), a stage without a reason drawing an empty span, recorded data of a method that is off, the excerpt cut and its off-by-one, rank numbering (assert `startsWith("1")`, `startsWith("2")`).
- 20.3 `MethodSwitches` (33) / `IngestPanel` (34): 18 + 20 stubs. Survivors fixed: validity of the other field when one is fixed first, deselection reset on a source change, the previous result hidden while the next ingest runs. Left: `Number.isFinite` (a `type=number` input never yields `NaN` text in the DOM; kept as a boundary parse), `reset: withReset` vs `reset` (equivalent in the flow).
- 20.4 `RagPanel` (43 tests): 35 stubs; survivors fixed: first-vs-newest user message in `prepareRagRequest`, a submit while generating, the run summary while still running, the error outcome of the summary.
- `tsc --noEmit` in `apps/web` clean; `components/rag` 161 tests green.

### Task 21 (workflow screen parts)

- 21.1/21.2 `WorkflowResultView` (36 tests; 14 views): ~45 stubs. Survivors fixed: failed-worker count vs completed count (use 3 results), `undefined` text for a failed worker, best-iteration marker when it is not the last, combined score vs the first evaluator's score, evaluator scores in the text, overlapping fixture strings ("要約して" ⊂ the improved text made a swapped before/after invisible), the raw stop label, the empty final output.
- 21.3 `WorkflowPanel` (41 tests): 27 stubs. Survivors fixed: aspect length counted in characters, abort on unmount. Redundant guards removed (see Implementation Notes).
- `tsc --noEmit` in `apps/web` clean.

### Task 22 (pages)

- `app/rag/page.tsx`, `app/workflows/page.tsx`, `app/page.tsx` (two module cards). No unit tests by design; `tsc --noEmit` clean, `mise run check:client-bundle` → `next build` lists `/rag` (ƒ) and `/workflows` (○), `Client bundle: scanned 24 files for 14 names and 3 sentinels`.
- Deviation noted: tasks.md 23.4 names `mise run build`, which does not exist; `check:client-bundle` builds. `layout.tsx` nav links left alone (outside the plan's file list).

### Task 23 (E2E, wave close)

- 23.1: `generate-sse-fixtures.mjs` accepts `.json` (RED on the script test first). Route tests generate `rag-query.sse`, `rag-query-no-evidence.sse`, `workflows-evaluator-optimizer.json` (stalls sample, `passed: false`) and, beyond the task list, `rag-agent-search.sse` / `rag-agent-no-search.sse`. `mise run e2e:fixtures` twice → identical md5; corrupting a fixture makes the three route tests fail with "is stale (line N …)".
- Real-server finding (research I-10): the `/rag` Server Component ran PGlite in the SSR chunk layer → "Extension bundle not found" → the page showed a connection error under concurrent cold requests; Vitest stayed green. Fix: `serverExternalPackages` += `@electric-sql/pglite`, `@electric-sql/pglite-pgvector`; `real-server.spec.ts` now ingests and asks through the page.
- Spec findings fixed on the way: `role="alert"` collides with Next's empty route announcer (filter by text); `tabTo` takes CSS selectors only (no `:has-text`); a closed `<select>` ignores ArrowDown on macOS Chromium (the keyboard test picks an example button instead); focus-contrast readings must wait for `transition-colors` (1.81:1, 1 in 4 runs).
- Adversarial review (`sdd-reviewer`, fresh context): APPROVE_WITH_NOTES, 2 MEDIUM + 16 LOW (`.sdd/reviews/002-rag-and-workflows-impl-w5-review-2026-10-13.md`). Fixed test-first: F-1 (client fence rules diverged from `findCodeRanges`; 15 parity vectors against `resolveCitations`, 5 stubs killed), F-3 (error `code` now shown by `ErrorBanner`), F-7, F-5 (status 200), F-14, plus the records (F-4, F-16). Deferred: F-2 (W3 file), F-6, F-8…F-13, F-17, F-18; F-15 left for the human (header nav).
- Final: `TURBO_FORCE=true mise run gate` exit 0 in ~31 s: `//:test executed=352`, `@platform/ai-core executed=1732 passed=1732 skipped=4`, `web executed=733 passed=733`, `eval-suite executed=3 skipped=1`, `Biome: 395 files`, `Docs: 4 module documents, 51 test references verified`. `mise run test:e2e` → `363 passed (1.9m)`, `Playwright: executed=363 skipped=0 (chromium=121 firefox=121 webkit=121)`; axe (WCAG 2.2 AA, light and dark, 12 rendered states on the new screens) 0 violations. `mise run check:client-bundle` → `scanned 20 files for 14 names and 3 sentinels`.
- Not run: `test:mutation` (W5 adds no mutation targets), `*.pg.test.ts` (no Docker), `local`-mode tests (Ollama).

### W5 ship (`/sdd-ship`, 2026-10-13)

- Verdict GO. Fresh `TURBO_FORCE=true mise run gate` exit 0: `web executed=733 passed=733`, `ai-core 1732 passed (skipped 4)`, `//:test 352`, `Docs: 4 module documents, 51 test references verified`. `mise run test:e2e` → `363 passed (1.6m)`, `Playwright: executed=363 skipped=0 (chromium=121 firefox=121 webkit=121)`. `mise run check:client-bundle` → `scanned 20 files for 14 names and 3 sentinels`.
- Auto-fix (mechanical): traceability W5 Test/Commit cells (22 rows) and the Gaps note.
- Commits: b40870d (screens), 3574034 (next.config), 5968504 (e2e), then this docs commit. Boundary amendments (ErrorBanner, route tests, generator test, extra fixtures, next.config) are recorded in the task 23 notes.
- Not run: `test:mutation`, `*.pg.test.ts`, `local` tests. Wave migration (`tasks-comp-w5.md`) is not part of this ship.
