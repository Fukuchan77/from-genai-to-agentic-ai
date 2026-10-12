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
