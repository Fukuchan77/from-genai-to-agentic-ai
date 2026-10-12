# Adversarial Review: 002 rag-and-workflows, Wave W1 (tasks 1.1–4.3, wave close 4.4)

- Date: 2026-10-12
- Scope: uncommitted working tree on `feat/m2-w1-foundation` (`git diff HEAD` plus untracked `knowledge/README.md`, `packages/ai-core/src/ports/rerank{,.test}.ts`, `packages/ai-core/src/structured/*`, `specs/002-rag-and-workflows/pdca/do.md`)
- Inputs: `spec.md`, `plan.md` (CL-1..CL-12, C1, C2, C3, C17, C18, 設定値, 環境変数, 依存の宣言), `research.md` (ADR-2, ADR-7, ADR-8, ADR-11, I-4), `tasks.md` W1, `.sdd/memory/constitution.md`
- Risk trigger: the dependency manifest gained 6 third-party dependencies (`packages/ai-core/package.json`, `pnpm-lock.yaml`). This review is also the constitution principle 9 wave review (task 4.4, wave migration condition 3)
- Prior reviews in scope: none (no `.sdd/reviews/*002*` file existed)

## Evidence gathered

- `TURBO_FORCE=true mise run gate` -> exit 0 in 13 s, `0 cached, 4 total`. Root 337/337 (1 pre-existing `it.fails` in `check-docs.test.mjs:122`), ai-core 761 passed / 4 skipped, eval-suite 3 / 1 skipped, web 306/306. `no-sql-raw: scanned 112 FILES`. `Docs: 4 module documents, 51 test references verified`. Budget (5 min, principle 3) met.
- Targeted run: `vitest run src/ports/rerank.test.ts src/structured src/config src/models/{catalog,gateway}.test.ts` -> 117 passed.
- `pnpm audit` -> "No known vulnerabilities found".
- Lockfile diff: exactly 6 new `packages:` / `snapshots:` entries (`@ai-sdk/cohere@4.0.59`, `@electric-sql/pglite@0.5.8`, `@electric-sql/pglite-pgvector@0.0.9`, `drizzle-orm@0.45.4`, `postgres@3.4.9`, `unpdf@1.8.1`), importer specifiers are exact versions, and there are no transitive additions (`@ai-sdk/cohere` reuses the existing `@ai-sdk/provider{,-utils}`). There is no `drizzle-kit`, `pg` or `@types/pg` (these appear only as optional peers in the `drizzle-orm` metadata and are not resolved).
- Installed packages: none has `preinstall` / `install` / `postinstall`. `postgres` has only `prepare`, which does not run on a registry install. `pnpm-workspace.yaml` is unchanged, so no `allowBuilds` entry is needed. Licenses are Apache-2.0 / MIT / Unlicense.
- Nothing imports `@platform/ai-core/{rag,workflows,patterns}` (grep). The dangling `exports` targets do not affect `typecheck` (the gate is green).
- Removed lines in modified `*.test.*` files: only `env-schema.test.ts`'s single-line import, which was reformatted to a multi-line import with the new names. No test was deleted, weakened or skipped.
- Bypass probes: I wrote fixture trees in the session scratchpad (not in the repo) and ran `checkRepoRules` / `checkModelIds` against them. The results are quoted in F-1, F-2 and F-9.

## Trigger resolution: dependency trigger explained away (declared, exact, clean)

All six dependencies and versions match plan "依存の宣言" exactly (`package.json:30-43`, lockfile importers). None of the excluded packages (`drizzle-kit`, `pg`, `@types/pg`, Markdown parsers) is present. No install scripts, no `allowBuilds` change, `pnpm audit` is 0, and do.md records publish ages ≥ 84 h (principle 7). The `exports` subpaths `./structured`, `./rag`, `./workflows`, `./patterns` were added as task 1.1 specifies. `rag`, `workflows` and `patterns` point to files that do not exist yet; this is by design, nothing imports them, and typecheck is unaffected. No new infrastructure. Principle 10 is satisfied.

## Boundary check

Every changed file falls within its task's `_Boundary:_`. `.env.example` and `config/*` are 2.1. `models/catalog*`, `models/index.ts` and `gateway.test.ts` are 2.2/2.3, and `gateway.ts` is 2.3. `ports/*` is 3.1 and `structured/*` is 3.2. `scripts/*` belongs to 4.1–4.3. `mise.toml` is 1.2 (sentinel) plus 4.4 (`--only no-sql-raw`). `.gitignore` and `knowledge/README.md` are 1.2. `package.json` and `pnpm-lock.yaml` are 1.1. `apps/web/**` was not edited (2.2's glob was allowed but unused). `specs/.../tasks.md` and `pdca/do.md` are spec-document updates (expected). No boundary violation.

## Critique

### [MEDIUM] F-1 `workflow-no-agent-loop` is bypassed by `ai`'s own alias `Experimental_Agent` (= `ToolLoopAgent`)
**Location**: scripts/check-repo-rules.mjs:1046 (also the pre-existing `guarded-agent-only`, :679-685)
**Issue**: `ai@7.0.137` exports `ToolLoopAgent as Experimental_Agent`, so a workflow can construct the agent loop without the identifier `ToolLoopAgent` ever appearing, and neither the new rule nor M1's `guarded-agent-only` flags it.
**Evidence**: `node_modules/ai/dist/index.d.ts:10887`: `ToolLoopAgent as Experimental_Agent, type ToolLoopAgentSettings as Experimental_AgentSettings`. Probe: `import { Experimental_Agent } from "ai"; new Experimental_Agent({})` in `workflows/probe.ts` -> `workflow-no-agent-loop ... NOT FLAGGED []`, and the same file -> `guarded-agent-only ... NOT FLAGGED`. `ai["ToolLoopAgent"]` (string-indexed namespace) is also not flagged. Constitution principle 1: workflows "`ToolLoopAgent` を使ってはならない（MUST NOT）"; Req 3.13.
**Confidence**: high
**Fix**: Treat every name that `ai` exports for the class as forbidden: add `Experimental_Agent` (and `Experimental_AgentSettings` / `ToolLoopAgentSettings` if types count) to the identifier set, resolve `import { X as Y } from "ai"` aliases the way `guarded-agent-only` does, and flag string member access `["ToolLoopAgent"]`. Add violation cases for each, and apply the same alias fix to `guarded-agent-only` (separate M1 finding). This must land before the rule is wired at 19.2.

### [MEDIUM] F-2 `no-sql-raw` misses common indirections and other raw-SQL entry points
**Location**: scripts/check-repo-rules.mjs:1055-1088
**Issue**: The rule only matches `<sqlName>.raw` / `<sqlName>?.raw` / `<sqlName>["raw"]`, so destructuring, aliasing, optional bracket access, parentheses, and the other string-SQL APIs that the new dependencies bring in pass unflagged.
**Evidence**: Probe results, each in `packages/ai-core/src/rag/probe.ts`, all `NOT FLAGGED`:
- `const { raw } = sql; raw(input)`
- `sql?.["raw"](input)` (`tokens[index-2]` is `?.`, not `sql`)
- `const s = sql; s.raw(input)`
- `(sql).raw(input)`
- `postgres()` client `sql.unsafe("select " + input)`
- `db.execute(\`select ${input}\`)`

Plan C17 defines the rule as "`sql.raw` を使わない", so the literal scope is met. But the constitution's zero-tolerance "string SQL" concern, and the reason the rule exists, also cover postgres.js `unsafe`, Drizzle `execute(string)` and PGlite `exec`/`query(string)`.
**Confidence**: high (bypasses confirmed); medium (whether the wider APIs are in scope)
**Fix**: At minimum, handle `?.[` and destructuring `{ raw } = <sqlName>`. Decide in plan C17 whether `unsafe(`, `.execute(` with a non-`sql` template argument, and PGlite `.exec(` / `.query(` with string arguments belong to the rule (allow-listing `rag/db/migrate.ts` and the DB factory). Otherwise, record them in C17 as an accepted approximation with the residual risk.

### [MEDIUM] F-3 Rerank errors carry the provider's raw error message in `details.cause`
**Location**: packages/ai-core/src/ports/rerank.ts:121-123
**Issue**: Any SDK error's `message` is copied verbatim into `PlatformError.details`. The test cannot catch a leak through that path, because the fake SDK never sees the key and its message is a constant.
**Evidence**: `throw unavailable("Rerank に失敗しました。", { ...(cause instanceof Error ? { cause: cause.message } : {}) })`. Test `rerank.test.ts:139-154` injects `sdk` (so `apiKey` is unused) and `new Error("status 429")`. plan HTTP API: rejections return `{ error: { code; message; details? } }`. The review brief requires that "error details must not leak the API key or query/candidate text". Provider 4xx bodies, `RetryError` aggregates and `APICallError.message` are uncontrolled text.
**Confidence**: medium (actual exposure depends on W3 callers, which per CL-11 convert to `skipped/provider-error`)
**Fix**: Replace `cause: cause.message` with a closed classification, e.g. `{ status: APICallError.isInstance(cause) ? cause.statusCode : undefined, name: cause.name }`. Add a test where the SDK error message contains the query, a candidate text and the API key, and assert that none of them appears in `message` / `details`.

### [LOW] F-4 An invalid `POSTGRES_PORT` now makes `loadPlatformConfig` fail for every M1 feature, in every mode
**Location**: packages/ai-core/src/config/load.ts:130-142, :206
**Issue**: `resolveDatabase` runs unconditionally, so a bad `POSTGRES_PORT` (only used by RAG in `local`/`live`) now stops `/chat`, `/agent` and `/summarize`, including in `mock`. That changes M1 startup behavior, which plan C1 says to extend "M1 の公開契約を変えずに".
**Evidence**: `if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new ConfigError(...)`; `database: resolveDatabase(parsed.data)` is always evaluated. Also `Number()` accepts `"0x1538"`, `"1e3"` and `" 5432 "`, which Compose's `${POSTGRES_PORT:-5432}` would not interpret the same way.
**Confidence**: medium
**Fix**: Either validate lazily (when the DB handle is built in C4/C13, mapping to `provider-unavailable` / `invalid-request` there), or keep the eager check and record the decision in plan C1. Parse with `/^\d{1,5}$/` before `Number`, and add `"0x1538"` / `"1e3"` to the rejection cases.

### [LOW] F-5 `apps/web/lib/server/platform.ts` keeps its own `credentialSecrets` list without `COHERE_API_KEY`
**Location**: apps/web/lib/server/platform.ts:321-329, :360
**Issue**: Task 2.3 updated ai-core's `credentialSecrets`, but the web app's redactor for recorded ports is built from a duplicated list that still omits `COHERE_API_KEY`.
**Evidence**: The web list has `ANTHROPIC_API_KEY ... TAVILY_API_KEY` only. `createRedactor(credentialSecrets(config.credentials))` is used for `recordedPorts`.
**Confidence**: high (drift exists); low (current exposure, since rerank has no recording wrapper per ADR-7)
**Fix**: Not in W1's boundary. Note it for 8.4/15.1 (the only editors of `platform.ts`): either export ai-core's `credentialSecrets` and reuse it, or add `COHERE_API_KEY` (and consider `POSTGRES_PASSWORD`) when the RAG wiring lands.

### [LOW] F-6 Timer and abort-listener cleanup in `createCohereRerank` is untested
**Location**: packages/ai-core/src/ports/rerank.test.ts:156-203 (implementation rerank.ts:124-127)
**Issue**: Deleting `clearTimeout(timer)` or `signal?.removeEventListener(...)` would not fail any test, so the "no leaked timers/listeners" property is unproven.
**Evidence**: No test asserts `vi.getTimerCount() === 0` after a successful or failed call, or that a reused caller signal has no listener left. The do.md PROVE list does not include these stubs.
**Confidence**: high
**Fix**: Add a fake-timer test that resolves the SDK, asserts `vi.getTimerCount()` is 0, and then advances past `timeoutMs` expecting no abort. Add a test that calls `rerank` N times with one long-lived signal and checks that a spy on `removeEventListener` matches the add count (or aborts the signal afterwards and asserts that no internal controller reacts).

### [LOW] F-7 The local light-tier test does not pin ADR-11's choice
**Location**: packages/ai-core/src/models/catalog.test.ts:220-223
**Issue**: The test only asserts `light !== capable`, so any other local model (e.g. the judge `gemma4:e2b`) would pass, although ADR-11 fixes `light = llama3.2:latest`.
**Evidence**: ADR-11: "`local` は `light = llama3.2:latest`・`capable = granite4.2:latest`". The test is `expect(MODEL_TIERS.local.ollama.light).not.toBe(MODEL_TIERS.local.ollama.capable)`.
**Confidence**: medium (the literal cannot appear in tests because of `check-model-ids`, so this is a constraint, not negligence)
**Fix**: Assert via catalog properties that do not need the literal, e.g. light's `contextWindow`/size is smaller than capable's, or `light` is not `MODEL_DEFAULTS.local.ollama.judge`. Alternatively, export a named constant from the catalog and compare against it.

### [LOW] F-8 Zod issue messages can echo generated key names into `StructuredOutputError`
**Location**: packages/ai-core/src/structured/generate-validated.ts:48-53
**Issue**: With a strict schema, Zod 4's `unrecognized_keys` message is `Unrecognized key: "<key>"`, so model-generated keys enter `issuesByAttempt` / `details`. The "never puts the generated text into the error" test uses a non-strict `z.object`, which strips the extra key before any issue is produced.
**Evidence**: `generate-validated.test.ts:110-121` uses `schema = z.object(...)` and `leak: "PRIVATE-TEXT-123"` as a value, not a key. Plan HTTP schemas use `z.strictObject` widely. The caller-supplied `validate()` strings are also copied verbatim (the caller decides).
**Confidence**: medium
**Fix**: For `unrecognized_keys`, emit only `path` + `code` (e.g. `"(root): unrecognized_keys"`). Add a strict-schema case with a sensitive key name to the leak test, and document that `validate()` messages must not include generated text.

### [LOW] F-9 `rerank-` model-ID family has false positives on ordinary identifiers
**Location**: scripts/check-model-ids.mjs:65
**Issue**: `rerank-` followed by any digit is treated as a model ID, so names such as `stage-rerank-2`, `data-rerank-1`, `rerank-1st-stage` and `rerank-3-candidates` fail the gate. Plan C14/C15 stream part IDs and fixture IDs are likely to use such names.
**Evidence**: Probe: `stage-rerank-2` -> `rerank-2`, `data-rerank-1` -> `rerank-1`, `rerank-1st-stage` and `rerank-3-candidates` are flagged. `rerank-pro-tips` and `rerank-fast-path` are flagged as well. True negatives `jina-reranker-v2-…` and `bge-reranker-v2-m3` are out of scope (no catalog entry), so that is acceptable.
**Confidence**: medium
**Fix**: Tighten to the shapes actually in use, `rerank-v\d` / `rerank-(?:english|multilingual)-v\d` / `rerank-\d+(?:\.\d+)+`, and require a non-word, non-hyphen left boundary. Add the four false-positive strings to the "does not flag" test.

### [LOW] F-10 `workflow-no-agent-loop` scope approximations
**Location**: scripts/check-repo-rules.mjs:631-637, :1034
**Issue**: (a) Only `.ts` is scanned, while plan C17 says "全ファイル", so `.tsx`, `.mts` and `.js` added later would escape. (b) A local subdirectory named `agents` (`./agents/helper`) is a false positive. (c) Transitive reach (a workflow importing an area that re-exports `agents/`) and multi-step `generateText({ tools, stopWhen: stepCountIs(n) })` loops are not detected.
**Evidence**: `collectFiles(root, WORKFLOW_DIRECTORIES, new Set([".ts"]))`. The probe `import { x } from "./agents/helper"` is FLAGGED, and the `generateText` + `stepCountIs` probe is NOT FLAGGED.
**Confidence**: medium
**Fix**: Scan `.ts`, `.tsx`, `.mts`, `.cts` and `.js`. Match relative paths that resolve to `packages/ai-core/src/agents` (resolve against the file's directory) instead of any `agents` segment. Record (c) in C17 as an accepted approximation, or add a check that `stopWhen` with `tools` is not used in `workflows/` / `patterns/` outside role-based cooperation.

### [LOW] F-11 `knowledge/README.md` hard-codes limits and describes W2 behavior that does not exist yet
**Location**: knowledge/README.md (制限, 対応形式)
**Issue**: "最大 50 件、1 ファイルあたり最大 5 MiB" duplicates `DEFAULT_RAG.maxIngestFiles` / `maxIngestFileBytes` without a link. The format and skip behavior it promises (`.markdown`, OCR-less `no-text` skip, no subdirectories) is implemented only in W2 (C5).
**Evidence**: The README text versus `config/defaults.ts` `DEFAULT_RAG`. No `rag/ingest` code exists yet.
**Confidence**: medium
**Fix**: Name the source constant (`DEFAULT_RAG`). Add a W2 task note (9.x) to re-check the README against the implemented loader.

### [LOW] F-12 2-1 required topics omit the metadata filter in the curriculum's topic list
**Location**: scripts/check-docs.mjs:63-71
**Issue**: `specs/curriculum/phase-2.md:28` lists "コサイン類似度検索とメタデータフィルタ" (Req 1.6) as a main topic of 2-1, but no 2-1 required heading covers metadata filtering.
**Evidence**: The 2-1 topic is "埋め込みと pgvector によるコサイン類似度検索". Phase-2 line 28 reads "AI SDK の `embed` / `embedMany` と pgvector（Drizzle ORM 経由）の直接連携。コサイン類似度検索とメタデータフィルタ。"
**Confidence**: low (the heading set is a judgment call; the plan C18 musts are present)
**Fix**: Extend the topic to "…コサイン類似度検索とメタデータフィルタ", or record why the filter is left to the hands-on section.

### [LOW] F-13 Undeclared public constant `DEFAULT_DATABASE`
**Location**: packages/ai-core/src/config/defaults.ts:46-53, config/index.ts:4
**Issue**: A new exported constant (including the default password literal `"postgres"`) is added to `@platform/ai-core/config` without being in plan C1's public interface.
**Evidence**: Plan C1 lists `DEFAULT_RAG` and `DEFAULT_WORKFLOW_LIMITS` only. The implementer records the deviation in the tasks.md 2.x notes.
**Confidence**: high (deviation exists, documented); low (impact)
**Fix**: Add `DEFAULT_DATABASE` to plan C1 / 設定値 in the next plan sync. Optionally keep it unexported until C4 needs it.

### [LOW] F-14 E2E impact of `mock:judge-v1` was assessed by reading, not by running
**Location**: specs/002-rag-and-workflows/tasks.md 2.x Implementation Notes
**Issue**: Task 2.2 asks to find the effect on "既存テスト（`apps/web` の画面のテストと E2E を含む）" in RED. Playwright was not run, so the claim that "an extra option does not affect E2E" is unverified.
**Evidence**: Note: "`apps/web/e2e/**` は読んで確認した … Playwright の実行は W5 で行う". My own read of `chat.spec.ts` (display-name regex `Alternative Mock Model`), `keyboard.spec.ts` (radio, not model picker) and `mock-api.ts` agrees with the note, and I found no option-count assertion.
**Confidence**: low (likely fine)
**Fix**: Run `mise run test:e2e` (chromium only is enough) before the wave closes, or carry the item explicitly into W5's 23.x checklist.

### [LOW] F-15 Wave close 4.4 is still open (process)
**Location**: specs/002-rag-and-workflows/tasks.md:221-226
**Issue**: Migration conditions 2 (CI `ci-status` green) and 3 (this review plus responses appended) are not yet met. The work is uncommitted, so CI has not run.
**Evidence**: `- [ ] 4.4`. `mise.toml` already carries `no-sql-raw` in `--only` (gate green, `scanned 112 FILES`).
**Confidence**: high
**Fix**: Append responses to F-1..F-14 in this file, commit, and confirm `ci-status` before checking 4.4 and moving tasks.md.

## Verified (no finding)

- `generateValidated`: attempts = `maxRegenerations + 1` (tests for 0, 2 and 3). Usage is summed across failed attempts through `NoObjectGeneratedError.usage` (tests 360/36/396 and 150/15/165). In v7 `usage` is the total, since `totalUsage` is deprecated. No attempt starts after an abort, and the abort reason is rethrown. Provider errors are rethrown unchanged with no helper-level retry (SDK-internal `maxRetries` stays at the default, which matches M1). The error contains no generated text (value-level). `system` goes through `instructions`, proven by the `SYS` assertion. `generateObject` / `streamObject` are not used. `maxRegenerations` validation covers -1, 1.5 and NaN.
- `createCohereRerank`: Zod validates the response, rejects out-of-range and duplicate indices, and applies `topN` and sorting. The timeout yields `details.reason: "timeout"`, and a caller abort rethrows `signal.reason` instead of wrapping it. `clearTimeout` and `removeEventListener` run in `finally` on every path after registration (only the test coverage is missing, F-6). `raceWithAbort` attaches a rejection handler, so a hung SDK promise does not become an unhandled rejection. `maxRetries: 0` matches CL-11. `@ai-sdk/cohere` `reranking(modelId)` exists in 4.0.59.
- Config: the host is fixed at `127.0.0.1`. The defaults equal `compose.yaml` (`POSTGRES_USER:-postgres`, `POSTGRES_PASSWORD:-postgres`, `POSTGRES_DB:-agentic_ai`, `127.0.0.1:${POSTGRES_PORT:-5432}`). `credentials.cohere` is present only when set, `FEATURE_REQUIREMENTS.rerank = ["COHERE_API_KEY"]`, and `.env.example` names equal the schema (existing test). `DEFAULT_RAG` / `DEFAULT_WORKFLOW_LIMITS` equal plan "設定値" value by value.
- Catalog: `mock:judge-v1` exists (mock only), `MODEL_DEFAULTS.mock.mock.judge` points to it, and the gateway resolves judge ≠ chat (CL-5). `MODEL_TIERS` matches ADR-11 (mock both `general-v1`, live single model per provider). `RERANK_MODELS` stays outside `MODEL_CATALOG` and pickers. Rerank ID literals appear only in `catalog.ts`, and `check-model-ids` on the real repository is green.
- `check-docs`: the 2-1 and 2-2 topics include "`mock` の緑が保証しないもの" and "日本語の埋め込みでの閾値の限界" (plan C18). The missing-topic test iterates every topic.
- `COHERE_API_KEY` bundle sentinel is in both `env` and `--sentinel` (`mise.toml:178-181`). `.gitignore` tracks only `knowledge/README.md`.

## Verdict
REQUEST_CHANGES

The wave's deliverables are on-plan and the dependency trigger is clean. Two items should be fixed, or explicitly accepted in plan C17 / C2, before 4.4 is checked: F-1, because the repository rule that mechanically enforces constitution principle 1 has a one-line bypass through `ai`'s own export, and F-3, because uncontrolled provider text flows into error details. F-2 needs either a fix or a recorded acceptance. The remaining items are LOW and can be answered in the response section.

## Hallucination Signal
forced: false

## Responses

<!-- Implementer appends the response to each finding here (wave migration condition 3). -->

### Round 1 responses (2026-10-12, implementer)

| Finding | Response | Evidence |
|---|---|---|
| F-1 | **Fixed.** `AGENT_CLASS_NAMES` = `ToolLoopAgent` + `Experimental_Agent` is used by `workflow-no-agent-loop` (identifiers and `ai["…"]` string access) and by the M1 rule `guarded-agent-only` (named, aliased, and namespace forms). | 6 new violation cases (3 per rule); `check-repo-rules.test.mjs` 149 passed |
| F-2 | **Fixed for the syntactic forms; the rest is an accepted approximation.** Now detected: `sql?.["raw"]`, `(sql).raw`, `const { raw } = sql`, aliases (`const s = sql`, `const s = d.sql`), and `.unsafe` on the same names. Not detectable without types and accepted: `db.execute(string)` and PGlite `exec`/`query(string)`; they are reviewed in code review (W2 5.x DB layer). A non-sql object with `raw`/`unsafe` is not flagged (test). | 8 new violation cases + 1 no-false-positive test |
| F-3 | **Fixed.** `details` carries only `errorName` and a numeric `status`; the provider message is dropped. | Tests: closed classification; key, query, and candidate text absent from message and details |
| F-4 | **Partly fixed, decision recorded.** The port is parsed with `/^\d{1,5}$/` (rejects `0x1538`, `1e3`, padded input, `-1`; test cases added). The check stays eager: `loadPlatformConfig` validates every variable at start-up already (an invalid `AGENT_MAX_STEPS` fails the same way), so a bad `POSTGRES_PORT` failing fast is consistent. | `load.test.ts` 8 rejection cases |
| F-5 | **Deferred, in another task's boundary.** `apps/web/lib/server/platform.ts` is edited only by 8.4 and 15.1; they must add `COHERE_API_KEY` to its `credentialSecrets` or reuse ai-core's list. Noted in tasks.md Implementation Notes (task 2). | — |
| F-6 | **Fixed.** Tests for `vi.getTimerCount() === 0` after success and failure, and for matching add/remove of the abort listener on a long-lived signal. | PROVE: deleting `clearTimeout` / `removeEventListener` fails both tests |
| F-7 | **Fixed (partly).** The literal cannot appear in tests (`check-model-ids`), so the test pins that the light tier is neither the judge model nor an embedding model, and differs from the capable tier. | `catalog.test.ts` |
| F-8 | **Fixed.** `unrecognized_keys` issues no longer include the key names; test uses `z.strictObject` and a sensitive key name. `validate()` messages are the caller's responsibility (documented in the Implementation Notes). | `generate-validated.test.ts` |
| F-9 | **Fixed.** Pattern tightened to published shapes (`rerank-v\d`, `rerank-(english\|multilingual)-v\d`, `rerank-\d+.\d`, `rerank-lite-\d`) and no preceding hyphen; the four reported strings plus `rerank-pro-tips` and `rerank-fast-path` are in the "does not flag" test. | `check-model-ids.test.mjs` 19 passed |
| F-10 | Accepted. `workflows/` and `patterns/` scan is by directory prefix, as plan C17 states; re-exports through `export * from "../agents"` are caught by `moduleImports`. | — |
| F-11 | Accepted. `knowledge/README.md` mirrors plan C5; 8.x updates it if the limits change. | — |
| F-12 | Accepted. The metadata filter is a 2-1 curriculum topic, but the topic headings are the minimum set; 26.1 may add more headings. | — |
| F-13 | Accepted and recorded. `DEFAULT_DATABASE` is a plan-external constant kept in `defaults.ts` so `load.ts` and the DB layer share the Compose values. | tasks.md Implementation Notes |
| F-14 | Accepted. Playwright runs in W5 (23.x) and at the W6 close (28.1). | — |
| F-15 | Closed by this response; 4.4 is marked done after the final `mise run gate` below. | `TURBO_FORCE=true mise run gate`: exit 0, 13 s |

Final gate after the fixes: Biome 257 files; `no-sql-raw: scanned 112 FILES`; typecheck ai-core 116 files; tests `//:test executed=351 passed=351`, `@platform/ai-core executed=769 passed=769 skipped=4`, `web executed=306 passed=306`; `Docs: 4 module documents, 51 test references verified`; `pnpm audit`: No known vulnerabilities found.
