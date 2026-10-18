# Do Phase: domain-agents

## Success Criteria

- Task fidelity: config values, the fatal-error latch, the ACI checks and the sandbox port match plan C1/C2/C3/C6/C9/C15/C16 and the CL decisions; where the spike changed a mechanism (S-1), the plan's own fallback was taken and recorded in `research.md`.
- Consistency: every public contract later waves use (`DEFAULT_*`, `FatalLatch`, `checkDescription`, `TokenLedger`, `SandboxProvider`, the two new repo rules) is covered by tests that fail when its value or behaviour changes (PROVE below).
- Safety: no secret in errors, summaries or cassettes (`E2B_API_KEY`, `GITHUB_TOKEN` are redacted and sentinel-checked); the think tool and the external-content log keep no content; the fix guide never echoes received values.
- Performance: `mise run gate` stays within the 5-minute budget (constitution principle 3).
- Cost: no new service, key, or network access in the gate.

## Implementation Log

### 2026-10-18 W1 Started (branch `feat/m3-w1-foundation`)

- Preflight: the gate lane has no external dependency (PREFLIGHT OK). `E2B_API_KEY`, `GITHUB_TOKEN`, `DOCKER_HOST` are unset and no Docker socket exists, so spikes S-4 (1.5), S-5 (1.6) and S-6 (1.4) can only be recorded as not measured. `NODE_ENV=development` leaks from the shell; every `mise run` below used `env -u NODE_ENV`.
- `pnpm install` was refused by the auto-mode classifier ("Untrusted Code Integration") twice (including after the user re-ran the command). The edit to `packages/ai-core/package.json` was reverted so `package.json` and the lockfile stay consistent (the patch is kept in the scratchpad). Blocked by this: 1.2 (the four dependencies and the `exports`), 1.3 (S-2/S-3 need `@ai-sdk/mcp` and `@modelcontextprotocol/server`), and the audit / `allowBuilds` check of 7.2. Nothing implemented so far imports a new dependency.

### Task 1.1 (spike S-1 and CL-2)

- Experiment (scratchpad, not committed): `ToolLoopAgent` + `MockLanguageModelV4`, a tool that trips a latch, `generate` / `stream` / `createAgentUIStream`, stopped by (a) abort, (b) `stopWhen`, (c) both. Result: abort stops the loop but drops `finish` and `onEnd` in `stream` and rejects `generate`; `stopWhen` stops after one model call with a normal `finish`. Adopted the plan's fallback: the latch is read by `stopWhen`; no abort on trip. Full table in `research.md` ("spike の実測（W1）").
- CL-2 is possible: wrapping the Zod schema with `jsonSchema(() => zodSchema(s).jsonSchema, { validate })` lets the fix guide replace Zod's issue dump; the SDK still prefixes `Invalid input for tool <name>:`. The JSON Schema is the SDK's own, so cassette keys do not change.

### Task 2.1 (config) — Boundary: as declared

- RED: 12 failures in `env-schema.test.ts`, `feature-requirements.test.ts`, `load.test.ts`. GREEN: 52 passed in `src/config`.
- PROVE: stubbed `cacheTtlMs`, a persona ID, `github-mcp` → `E2B_API_KEY`, the `e2b` credential, the `MCP_FS_ROOT` and `DOCKER_SANDBOX_IMAGE` overrides → 5 failures (`expected [ 'E2B_API_KEY' ] to deeply equal [ 'GITHUB_TOKEN' ]`, `expected undefined to be 'changeme-e2b'`, `expected 'workspace/' to be '/tmp/ws'`, …). Restored: 52 passed.
- Decision: extra export `DEFAULT_MCP_FS_ROOT` (like M2's `DEFAULT_DATABASE`) so the default lives with the other defaults; `DEFAULT_TOOLS.maxToolsPerAgent` is the literal 20 because `config` cannot import `agents`, and a test pins it to `MAX_AGENT_TOOLS`.

### Task 2.2 (gateway secrets)

- RED: `expected '{"version":1,"key":…' not to contain 'test-e2b-key'` (and the GitHub token). GREEN: `credentialSecrets` gets both; 70 passed in `src/models`. The RED run is the PROVE (the unmodified implementation leaks both).

### Task 3.1–3.3 (fatal errors and the latch)

- 3.1 RED: `Cannot find module './fatal'`; GREEN 18 passed. PROVE: `trip` overwrote, only 401 was fatal, the raw message went into the summary, `Error.message` carried the learner text → 5 failures (e.g. `expected FatalToolError: second … to be FatalToolError: first`, `expected 'ツールの実行に失敗しました（Error）。request to https…' not to contain 'sk-secret-value-123'`). Restored: 18 passed.
- 3.2 RED: 4 failures (`expected 1 to be +0`, `expected undefined to be 'auth-failed'`). GREEN: `aci` + `agents` 206 passed. PROVE: removed the refusal and the trip → the same 4 failures. Restored.
- 3.3 RED: `expected 10 to be 1` ×3 (the loop ran to the step limit). GREEN: 43 passed in `guarded-agent.test.ts`. PROVE: latch condition made constant false, abort priority restored, error mapping replaced → 4 failures (`expected 10 to be 1`, `expected { Object (stopReason, steps, ...) } to match object { stopReason: 'error', … }`). Restored.
- **Deviation from the Boundary**: 3.2's boundary is `aci/tool-set.ts` and its test, but `defineAciTool`'s `executeWithGuards` turns every thrown error into an outcome before `tool-set.ts` can see it. The trip therefore lives in `define-tool.ts` (`failureFrom` calls `classifyToolError` and trips `runtime.fatal`); `tool-set.ts` adds only the refusal after the latch. The behaviour is covered end to end through `buildToolSet` in `tool-set.test.ts`.
- Decision: `GuardedAgentOptions.fatal` is passed by the caller (the same latch instance that went into `buildToolSet`'s `runtime.fatal`), because the tool set is built before the agent. `AgentRunErrorCode` gains the four fatal codes.
- Limit: tool calls of one step run concurrently, so a sibling call that already started is not interrupted; only calls that start after the latch is tripped are refused.

### Task 4.1–4.8 (ACI checks and helpers)

- RED for 4.1/4.2/4.3/4.5: `Cannot find module` for each. 4.4: written before the modules; RED was not observed separately (covered by PROVE).
- PROVE 4.1: heading match without `trimStart`, ASCII-only colon, no empty-body check, no recursion, name-in-text always true → 7 failures (e.g. `accepts a full-width colon after a heading`, `checks nested object fields with their dotted path`). 4.2/4.3/4.5: 12 failures (`never cuts a surrogate pair in half`, `does not divide by zero…`, `names a missing required parameter, its type and that it cannot be omitted`, …). 4.4: 6 failures (`never puts a UUID or an item id in the assignment shown to the model`, `acknowledges the call without echoing or storing the thought`, …). All restored.
- 4.6/4.7: the six M1 descriptions were rewritten before the registration check existed, so there was no separate RED. PROVE of 4.6: restoring `web-search.ts` from `git show HEAD:…` makes `passes for all six M1 tools` fail with `ConfigError: ツール「webSearch」の説明文が規約を満たしていません…`. PROVE of 4.7: check disabled and schema unwrapped → 3 failures (rejects a description without the three headings, rejects an input field without .describe(), shows the model a fix guide).
- Decisions: `compareApproaches` returns the plan's `{ steps, tokens, ratio }` (steps/tokens saved by the high-level tool; `ratio` = high/low tokens, `undefined` when a run failed or the low-level run used 0 tokens); `createThinkTool` keeps the plan's `AciTool | undefined` and takes an optional `onCall` recorder; `AciTool` gained `inputSchema` (the Zod schema) so `checkDescription` can inspect a defined tool.
- **Existing tests modified (risk trigger 3)**: `define-tool.test.ts` (the `toBe(echoSchema)` identity assertion became a JSON-Schema equality, because the tool now exposes a wrapped schema), `tool-set.test.ts`, `guarded-agent.test.ts`, `patterns/role-based-cooperation.test.ts` (descriptions via the new `testing/describeTool`, one `.describe()` added), `aci/tools/calculator.test.ts` (reads `aciTool.inputSchema`). No test was deleted, skipped, or weakened.

### Task 5.1–5.2 (TokenLedger, observer)

- RED: `Cannot find module` ×2. GREEN: 95 passed in `src/agents`. PROVE: a made-up total, no `unknown`, `unknownCalls` leaking into the total, content kept in the log, an `agent` default, no empty-name check → 7 failures in total (e.g. `keeps only the kind and the source, never the content`, `marks a role whose usage is unavailable as unknown and adds nothing for it`). Restored.
- `agents/observer.ts` did not exist (`RunObserver` lives in `guarded-agent.ts`), so the file is new; it adds `createNamedObserver` and `createExternalContentLog` without touching `RunObserver`.

### Task 6.1–6.4 (port, rules, container lane, scenario detector)

- 6.1: types only; `tsc` passes; no E2B or Docker type appears in the port.
- 6.2 RED: 40 failures. GREEN: 189 passed. PROVE: out-of-scope allowance, the SDK sub-path, the `docker.sock` string, the listed files, the docker allowance → 25 failures. The new rules also ran on the real tree (`mcp-import-scope: scanned 363 FILES`, `sandbox-import-scope: scanned 363 FILES`) and flagged my own `docker.sock` string in `config/load.test.ts`, which I renamed.
- 6.3 RED: 4 failures (the sentinel checks, including a **real gap**: `GITHUB_TOKEN` was not a secret name for `check-client-bundle`, because `SECRET_NAME` lacked `TOKEN`; fixed in `scripts/check-client-bundle.mjs` with a whole-word match so `AGENT_MAX_TOTAL_TOKENS` stays out — a Boundary deviation). `mise tasks validate` → 27 tasks. `mise run test:container` exits 0 with "No test files found". A dummy `*.container.test.ts` ran under `container` and was absent from `vitest list` under `gate`; removed. `test:container` runs only `@platform/ai-core` (the other workspaces' Vitest configs do not know the suite); the hermetic network guard still blocks unix sockets for the container suite, which the first container test (17.x) must deal with.
- 6.4 RED: `M3_SCENARIOS is not iterable`. GREEN: 66 passed in `src/mock`. PROVE: detectors weakened → 4 failures; an ambiguous scenario added to the real list → `holds the expected number of scenarios and turns` fails.

### Task 7.1 / gate

- `stryker.config.mjs` gets `aci/description-check.ts`.
- `mise run gate` (with `env -u NODE_ENV`): exit 0, `real 31 s`. Root 399, `@platform/ai-core` 1884 (4 skipped), `@platform/eval-suite` 7 (8 skipped), `web` 733, `Docs: 8 module documents, 110 test references verified`, `tool-risk-declared: scanned 29 FILES`, `TypeScript packages/ai-core/tsconfig.json: 239 files`. Before this wave: root 352, ai-core 1732, web 733.

### W1 adversarial review (`.sdd/reviews/003-domain-agents-impl-w1-review-2026-10-18.md`): REQUEST_CHANGES

- Fixed: F-1 (HIGH, a sibling call of the same step ran after the latch tripped). With a latch, `buildToolSet` now runs tool calls one after another and refuses those that start after the trip. New test `refuses a sibling call that starts together with the failing call (one step)`; PROVE: removing the queue → `expected 1 to be +0` (the sibling ran). F-2 in part: `createGuardedAgent` rejects an already-tripped latch (test added). Gate after the fix: exit 0.
- Open (not fixed in this session): F-2 (the latch is still passed to two places by hand), F-3 (repo-rule bypasses; plan C16 vs 6.2 disagree on `ports/`), F-4/F-5 (`checkJsonSchemaDescription` substring match, records / `z.lazy` / `z.date()`), F-6 (fix-guide example can be invalid), F-8 (boundary deviations to record in plan.md), F-12 (`docs/modules/1-2-…` snippet now fails the description check), F-7 and F-9–F-19 (LOW). Wave W1 is not closed: 1.2, 1.3, 1.5 (types) and 7.2 remain open.

### 1.2 / 1.3 / 1.5 completed after the user ran `pnpm install`

- The user's first `pnpm install` changed nothing (the manifest edit had been reverted); I re-applied the saved patch and `pnpm install` then succeeded: `Packages: +32 -4`, `pnpm audit` → "No known vulnerabilities found", no `allowBuilds` warning (`pnpm-workspace.yaml` unchanged), `pnpm install --frozen-lockfile` → "Lockfile is up to date". Publish ages were checked before (73 h, 304 h, 109 h, 455 h).
- S-2/S-3 measured with a real stdio server started by Node 26 type stripping (no `tsx`): tools/list carries annotations; `isError`, `_meta`, `structuredContent` reach `execute`; `client.tools()` works in `ToolLoopAgent`. S-4 types read from `@e2b/code-interpreter` 2.9.0 `.d.ts`. See `research.md`.
- `mise run gate` after the install: exit 0 (root 399, ai-core 1886 / 4 skipped, eval-suite 7 / 8 skipped, web 733, docs 8 / 110).

### Review fixes applied (second pass)

- F-2: `buildToolSet` records `runtime.fatal` in a module-private `WeakMap`; `createGuardedAgent` reads it with `fatalLatchOf(options.tools)` and the `fatal` option is gone, so the latch cannot differ between the two. An already-tripped latch is rejected (test).
- F-4/F-5: `checkJsonSchemaDescription` matches a property name as a whole word (`id` no longer passes through "valid"); `checkDescription` walks record values (`name{}`), follows local `$ref` once per path (`z.lazy`), requires a union to be described as a whole or in every non-null member, and converts with the AI SDK's options, so an unsendable schema (a `Date`) is an issue (`unsendable-schema`) and `defineAciTool` rejects it. PROVE (substring match, `some`, no record walk, no `$ref` ignore): 5 failures in `description-check.test.ts` / `input-guide.test.ts`.
- F-6: the fix guide's example handles exclusive bounds and string formats, and is printed only when the schema accepts it (11 parameterised cases plus a refine case that omits it).
- F-3: `mcp-import-scope` / `sandbox-import-scope` now scan `.ts .tsx .mts .cts .js .mjs .cjs` under `apps`, `packages`, `scripts`, `tooling`; they follow a `createRequire` alias and flag `import(x)` / `require(x)` with a non-literal specifier outside the allowed places. PROVE (old scan scope, no alias, no dynamic ban): 9 failures. The Docker check remains an approximation (`socketPath`, `docker.sock` strings); it is recorded in plan C2/C16, not closed.
- F-8: plan.md C2/C3 Owns, the File Structure Plan and C16 (`ports/` is not allowed for `@ai-sdk/mcp`) synced. F-12: the `docs/modules/1-2` snippet shows the CL-18 form. F-13: corrections appended to `research.md`.
- Not done: F-7, F-9–F-11, F-14–F-19 (LOW; F-14 is explained in `research.md`, the rest are noted for the wave close). Gate after the fixes: exit 0 (root 410, ai-core 1905 / 4 skipped, eval-suite 7, web 733). Not re-reviewed by a fresh `sdd-reviewer`.

### /sdd-ship validation (2026-10-18): GO

- Fresh `env -u NODE_ENV mise run gate`: exit 0. Root 410 (1 expected fail), `@platform/ai-core` 1905 / 4 skipped (96 files), `@platform/eval-suite` 7 / 8 skipped, `web` 733, `Docs: 8 module documents, 110 test references verified`, `tool-risk-declared: scanned 29 FILES`, `TypeScript packages/ai-core/tsconfig.json: 239 files`. `pnpm audit`: no known vulnerabilities. The counts match the second-pass figures above.
- Every W1 task is `[x]`; PROVE evidence exists for each new test group above. W1 review HIGH (F-1) and MEDIUM (F-2–F-6, F-8) are fixed; F-7, F-9–F-11, F-14–F-19 (LOW) stay open and are carried to the wave close. No fresh `sdd-reviewer` re-review of the fixes.
- Commits: `ee815d5` (deps, 1.2), `3af8b69` (config + gateway, 2.x), `70dd437` (aci + fatal latch, 3.x/4.x), `efcde0d` (TokenLedger + observer, 5.x), `077c51e` (port, rules, container lane, detector, 6.x/7.1). Spike results and the gate timing (1.1, 1.3–1.6, 7.2) ride in the docs commit.

## W2 (MCP・ファイル) — started 2026-10-18 (branch `feat/m3-w1-foundation`, uncommitted)

- Preflight: gate lane has no external dependency (PREFLIGHT OK). `GITHUB_TOKEN`, `E2B_API_KEY` are not needed in W2; 11.1 (real-server E2E) needs the Playwright browsers and a free E2E port, checked there. `node` on `PATH` is v24.22 while `mise.toml` pins 26.12; every command below ran as `mise exec -- …` (Node 26.12) from the repo root or `packages/ai-core`.
- Scope: all unchecked tasks in `tasks.md` = W2 (8.1–11.3).

### 8.1 / 8.2 (workspace, `resolveWorkspacePath`)

- 8.1 RED: `git check-ignore -q workspace/sample.txt` → not ignored. GREEN: `workspace/*` ignored, `workspace/README.md` tracked (`git check-ignore` exit codes checked both ways).
- 8.2 RED: module missing. GREEN: 22 passed. PROVE: (a) prefix match without a separator → `rejects a sibling directory that shares the root's prefix`, `…link that points to a file in a prefix-sharing sibling`, `rejects an escape through a missing path…` fail with `expected an error, received …/root-evil/secret.txt`; (b) no `realpath` + (a) → 7 failures (symlink escape, not-found cases). Restored: 22 passed.
- Design: an escape through a path that does not exist is `outside-root`, not `not-found` (the nearest existing ancestor is resolved, so the answer never says what exists outside the root).

### 9.1 (`mcp/types.ts`, `mcp/risk.ts`)

- RED: module missing. GREEN: 14 passed. PROVE: `!== false` instead of `=== true`, no `destructiveHint` rule, inherited property allowed → 8 failures (`expected 'read-only' to be 'destructive'`). Restored.
- Added to the plan's rule: a tool claiming both `readOnlyHint: true` and `destructiveHint: true` is `destructive` (contradictory annotations are not trusted).

### 8.3 / 8.4 (file tools, MCP server, stdio entry)

- **Boundary deviation (new file `files/operations.ts`)**: CL-3 / 8.4 `_Verify:_` require `node …/files/stdio.ts` to start under Node's type stripping, which cannot resolve extension-less imports (`./server`, `../aci`). The `aci` index also pulls `rates.json` (needs an import attribute under plain Node). So the logic the server serves lives in `files/operations.ts` (neutral `FileOperation`, `FileToolError`; imports only `../aci/response-format.ts`, `../aci/short-id.ts` (dependency-free) and `./path.ts`, all with the `.ts` extension); `tools.ts` wraps each operation with `defineAciTool` and maps the errors to `FatalToolError` / `ToolExecutionError`; `server.ts` and `stdio.ts` use the operations directly. `tsconfig.base.json` gained `allowImportingTsExtensions` (needed for those `.ts` imports; `noEmit` is already set). Plan C4 and the File Structure Plan are synced below.
- `createFileTools({ root })` has no `clock`: no file tool depends on time (`ToolRuntime` already supplies the clock); the plan's `{ root, clock }` was dropped.
- 8.3 RED: module missing. GREEN: 40 passed. PROVE (7 stubs, each run alone): outside-root recoverable → 6 failures; concise default `detailed` → 3; search follows links → 1 (`does not follow a symbolic link while searching`); write without `wx` → 1 (`does not write through a dangling link…`); outside links kept in listing → 1; index starts at 1 → 3; binary check removed → 1. Restored: 40 passed.
- 8.4 RED: module missing. GREEN: 12 passed (in-memory raw JSON-RPC peer + a real child process started with `process.execPath stdio.ts`). PROVE: no read-only annotation → 1 failure; fatal reported as recoverable → 3; fatal without `isError` → 2; `process.exit(0)` → 2; the missing root created → 1 (`exits with the reason, and without creating the directory…`). Restored: 74 passed in `src/files`. `MCP_FS_ROOT=/nonexistent/ws mise exec -- node packages/ai-core/src/files/stdio.ts` exits 1 with the reason (Node 26.12).
- Only `@ai-sdk/mcp` is import-scoped to `mcp/`; the server test therefore talks JSON-RPC over `InMemoryTransport` itself instead of using a client package.

### 9.2 (`mcp/allow-list.ts`) / 9.3 (`mcp/adapt.ts`)

- 9.2 RED: module missing. GREEN: 9 passed (7 pure + 2 against a real `createMCPClient` connected to the files server over `InMemoryTransport`: only the allowed tools become client tools). PROVE: everything allowed → 8 failures; plain-object schemas → 1 (`treats a hostile tool name as a plain key…`); `unknown` not reported → 2; schema not closed → 1. Restored.
- TypeScript 7.1-dev cannot instantiate the SDK's `toolsFromDefinitions<TOOL_SCHEMAS>` / `ReturnType<MCPClient["tools"]>` with explicit schemas (`TS5115 … infinitely circular … $InferZodRecordInput`; even `Schema<unknown>` is "not assignable to `FlexibleSchema<unknown>`"). `loadAllowedTools` therefore calls the client through a one-method structural type (`SchemaLoadingClient`) and `McpClientTool` is this layer's own minimal shape of what it reads. Recorded in the code.
- 9.3 **Boundary deviation (`aci/types.ts`, `aci/define-tool.ts`, `aci/define-tool.test.ts`)**: `buildToolSet` accepts only objects `defineAciTool` made, and `defineAciTool` required a Zod schema and the strict `checkDescription` (every field `.describe()`d). CL-25's looser JSON-Schema check and the server's own schema could not pass through that. `AciToolDefinition` gained `externalInputSchema` (a JSON Schema from outside): the description is checked with `checkJsonSchemaDescription`, the model receives the schema unchanged, the Zod `inputSchema` only validates the input (the MCP adapter uses `z.looseObject({})` and the server validates its fields). 4 tests appended to `define-tool.test.ts` (no existing test touched).
- 9.3 RED: module missing. GREEN: 29 passed in `adapt.test.ts` (+4 in `define-tool.test.ts`). PROVE: fatal believed from every server → 1 failure (`treats a fatal result from a server that is not trusted as recoverable`); any code accepted → 1; server text passed on from every server → 2; no description check → 1; no output cap → 1; external schema checked as Zod → 2; external schema not sent → 1. **First attempt at "401/403 not fatal" passed**: `classifyToolError` also maps a `statusCode` of 401/403, and my configured message equalled its default, so the test could not tell the adapter's explicit mapping from the fallback. The test's `auth-failed` wording now differs from the platform default; the stub then fails 2 tests. Restored: `src/aci` + `src/mcp` 286 passed.
- Decisions: a recoverable `isError` result from a **trusted** server passes the server's own fix guide on as `nextAction` (our server writes it); from an untrusted server nothing of its text is passed on. Results are capped at 20,000 characters (`MAX_MCP_OUTPUT_CHARACTERS`). `adaptMcpTool` returns `{ ok: false, reason }` instead of throwing, so the registry can record `disabledReason`.

### 9.4 (`mcp/github.ts`) / 9.5 (`mcp/connect.ts`, `mcp/index.ts`)

- 9.4 RED: module missing. GREEN: 16 passed. PROVE (6 stubs): no `trim` → 2 failures; a write tool in the allow-list → 2; GitHub trusted → 1; token in the URL → 2; the files server not trusted → 1; `MCP_FS_ROOT` not passed → 2. Restored.
- Decisions: `githubServerConfig` also sends `X-MCP-Readonly: true` (documented read-only mode of the hosted server; the platform's own allow-list and risk check do not depend on it). `McpServerConfig` gained `fatalMessages` (the learner's wording by code, built from configuration, CL-24). The five read-only GitHub tools and their documented inputs are in `GITHUB_TOOL_INPUTS`; they are unconfirmed until the hands-on run (S-6).
- 9.5 RED: module missing. GREEN: 28 passed in `connect.test.ts` (incl. 2 with the real `filesServerConfig` child process started by `Experimental_StdioMCPTransport`). PROVE (8 stubs): non-read-only tools registered → 1 failure; no tool limit → 3; a disconnect never detected → 1; duplicate names kept → 1; an agent allow-list may widen → 1; abort ignored → 1; the raw error message in the reason → 1; the learner-stop guard in `adaptMcpTool` removed → 0 failures at first (**vacuous**), a test was added (`leaves a stop by the learner alone…`) and the stub then fails it. Restored: `src/mcp` 95 passed + 28.
- `ToolsForOptions.reservedTools` lets a caller count its built-in tools against the 20-tool limit; `createGuardedAgent` still checks the final set.
- Test seams: `ConnectOptions.transportFor` (a server in the same process), `clock` for the connection time limit.

### 10.1–10.5 (HTTP entrance)

- **Boundary deviations (new files)**: `packages/ai-core/src/mcp/{request-schema,chat}.ts` (+ tests) and `publicMcpStatus` in `mcp/types.ts` (+ `types.test.ts`): `apps/web` has no `zod` dependency, so the route schemas, the chat instructions and the comparison wording live in `@platform/ai-core/mcp` (M2's `rag/request-schema.ts` is the precedent).
- 10.1 RED: expected counts changed to 4 scenarios / 9 turns first; the gateway test for the M3-1 scenarios failed (no scenario matched). GREEN: `src/models` + `src/mock` 137 passed / 2 skipped. PROVE: `...M3_1_SCENARIOS` removed from the gateway default list → `answers the M3-1 MCP scenarios…` fails; a high-level turn matched on `[run:` only → `answers each M3 turn alone…` fails (ambiguity detector).
- 10.2 RED: imports of `createMcpRegistry`, `getMcpRegistry`, `mcpServerConfigs`, `setMcpRegistryForTesting` missing. GREEN: `platform.test.ts` 53 passed (+9). PROVE: GitHub offered in `mock` → 1 failure; relative root left to the cwd → 2; a failure cached → 1; the cause of a connect failure leaked → 2.
- 10.3 GREEN: 4 passed. PROVE: no whitelist → the leak test fails; wrong limit → 2; errors swallowed → 1. `publicMcpStatus` moved to ai-core afterwards; the route test still passes.
- 10.4 GREEN: 15 passed (rejections 413 / 400 shape / 400 limit / 429 live only / allow-list unknown server and tool / write-destructive 400 / registry refusal 400 / capability-unsupported / 503; mock runs: list → read → answer with `{ run, mcp }` on `finish`; a path outside the root → `stopReason: "error"`, `error.code: "not-allowed"`, message with the root; think on/off; allow narrowing; abort signal). The registry in these tests is the real `connectMcpServers` with the real `files/stdio.ts` child process. PROVE (7 stubs): the write/destructive check removed → 1 failure; no latch → 1; `mcp` missing from `finish` → 1; no `signal` → 1; no `require: ["tools"]` → 1; think switch ignored → 2; **the think tool not counted against the 20-tool limit survived** (0 failures) → a test with a recording registry now pins `reservedTools` 1 / 0 and the stub fails it.
- 10.5 GREEN: 10 passed (high-level: 2 steps / 890 tokens; low-level: 3 steps / 1,478 tokens; comparison steps 1, tokens 588, ratio 0.602). The first "one side fails" test did not fail the run: the AI SDK turns a call to a tool that is not loaded into a tool error and the scenario carries on to `completed`. The failing side is now a `listFiles` bound to a root that does not exist (fatal `config-missing`). PROVE (6 stubs): failure not marked, output tokens not counted, the same tools for both, no file-server check, no signal, no tool capability required → each fails the matching test.

### 11.1 / 11.2 (real server, wiring)

- Preflight for the E2E lane: port 3100 free, chromium / firefox / webkit installed (`playwright install --dry-run` locations exist), no pre-push hook, `NODE_ENV=development` leaks from the shell so every command ran with `env -u NODE_ENV`.
- 11.1: the first `next build` **failed** (`new URL("../files/stdio.ts", import.meta.url)` in `mcp/github.ts` is a Turbopack asset reference; same cause as M1's fixtures directory). Fixed with `resolve(dirname(fileURLToPath(import.meta.url)), …)`. Then `next build` succeeded with no `serverExternalPackages` change, and `real-server.spec.ts` `mcp:` (4 cases: servers list, chat list→read, outside-root fatal, comparison) passed on chromium (4 passed, 7.6 s). No leftover `files/stdio.ts` process or listener. Details in `research.md` ("W2 の実サーバー確認").
- `no-dynamic-eval` forbids `node:child_process` everywhere (ADR-4), so the child-process tests I first wrote in `files/server.test.ts` were rejected by `check:repo-rules`. `stdio.ts`'s root check moved to `resolveServerRoot` (`files/server.ts`, tested in process; PROVE: creating the missing root → 2 failures, file accepted as root → 1, symlink not resolved → 1); the real child process is exercised through `@ai-sdk/mcp` in `mcp/connect.test.ts` (which also asserts the missing root is not created) and in the E2E.
- 11.2: `mise.toml` `check:repo-rules --only` + `mcp-import-scope` (`mcp-import-scope: scanned 426 FILES`, all rules pass); `stryker.config.mjs` + `files/path.ts`, `mcp/risk.ts`. First `mise run gate` after the wave's code: exit 0, 37 s wall.
- 11.2 mutation: all files 86.61 (threshold 70); `files/path.ts` 77.78, `mcp/risk.ts` 100.

### W2 adversarial review (`.sdd/reviews/003-domain-agents-impl-w2-review-2026-10-18.md`): REQUEST_CHANGES (0 HIGH, 5 MEDIUM, 13 LOW)

- Fixed: F-2 (disconnect = only the client's own `MCPClientError` without a `code`; `isDisconnectError` + tests). F-5 (E2E no longer expects `[0] README.md`; the low-level comparison now does `searchFiles("README")` → `readFile` index 0, so both ways read the same file regardless of the learner's `workspace/`; `MCP_COMPARE_TOOLS.lowLevel` = searchFiles + readFile).
- Accepted for now, to carry: F-1 (one index per file-server process, shared by concurrent chats; single learner, ADR-10; cannot leave the root), F-3 (no reconnect until restart), F-4 (generic reason for a missing `MCP_FS_ROOT`), F-6–F-18 (LOW). Not re-reviewed by a fresh reviewer.
- Gate after the fixes: exit 0 (root 410, ai-core 2,107 / 4 skipped, eval-suite 7, web 771); E2E `mcp:` 4 passed. `GITHUB_TOKEN` is unset in the shell.

### W2 review responses (second pass)

- Fixed: F-4 (`McpServerConfig.preflight`; `filesServerConfig` checks the root with `resolveServerRoot`, so the status names `MCP_FS_ROOT` and the path), F-6 (unexpected server error reported by name only: new `EACCES` test), F-7 (`ENOTDIR` cases in `path.test.ts`), F-11 (a configuration over 20 tools is refused when the registry is built; `getMcpRegistry` then answers 503), F-13 (test title), F-14 (trusted server error without `_meta` → generic next action), F-17 (the server stops work on the client's cancellation: `ctx.mcpReq.signal`). PROVE: each stub (ENOTDIR branch, message leak, `recoverableMeta` condition, startup limit, preflight) fails its new test.
- Carried (not fixed, by choice): F-1 (shared `ShortIdIndex` per file-server process; single learner, cannot leave the root), F-3 (no reconnect / no proactive `connected` → `unavailable`), F-8 (`onUncaughtError` is silent), F-9 (401/403 is fatal for any server; document in plan C5), F-10 (check-then-use window; `writeFile`/`deleteFile` are not registered for agents), F-12 (`tool-risk-declared` scans only `aci/`), F-15 (`allowImportingTsExtensions` is workspace-wide because `apps/web` type-checks the `ai-core` sources), F-16 (a comparison run that read nothing still counts as completed).
- Gate after the fixes: exit 0 (root 410, ai-core 2,110 / 4 skipped, eval-suite 7, web 771); E2E `mcp:` 4 passed.

### W2 review responses (third pass)

- Fixed: F-8 (`onUncaughtError` marks the server broken for the client's own terminal errors — connection closed, reconnection attempts exhausted — and `status()` then shows `unavailable` with the error name only; PROVE: any error counts → 1 failure, `status()` never syncs → 1), F-12 (`tool-risk-declared` now scans all of `packages/ai-core/src`: 29 → 256 files), F-9 and the F-1 / F-3 / F-10 limits documented in plan C5.
- Still carried: F-1, F-3 (reconnect), F-10, F-15 (workspace-wide `allowImportingTsExtensions`), F-16.
- Gate: exit 0 (root 410, ai-core 2,112 / 4 skipped, eval-suite 7, web 771).

### /sdd-ship validation (2026-10-18, W2): GO

- Fresh `mise run gate`: exit 0. Root 410 (1 expected fail), `@platform/ai-core` 2,112 / 4 skipped, `@platform/eval-suite` 7 / 8 skipped, `web` 771, `Docs: 8 module documents, 110 test references verified`, `mcp-import-scope` wired in `check:repo-rules --only`. ai-core coverage: all files 96.84 % lines, `src/files` 91.31 %. The new `src/files` tests (`tools.test.ts` 40, `server.test.ts` 14, `path.test.ts` 23) appear by name in the run output.
- Every W2 task (8.1–11.3) is `[x]`; PROVE evidence is recorded for each new test group above. W2 review: 0 HIGH; MEDIUM F-2, F-4, F-5 and LOW F-6–F-9, F-11–F-14, F-17 fixed; F-1, F-3, F-10, F-15, F-16 carried by choice (documented in plan C5); no fresh `sdd-reviewer` re-review of the fixes. Boundary deviations (`operations.ts`, `mcp/{request-schema,chat}.ts`, `externalInputSchema`, `allowImportingTsExtensions`) are recorded above and in plan.md.
- Auto-fixes: `traceability.md` Test / Commit cells for Requirement 1.1–1.17 (W2 tasks); empty `### Implementation Notes` of task 11 in `tasks.md`. No code or test edits.
- Commits: `4121998` (aci external schema), `9df796f` (files), `7c3c3f9` (mcp), `c710007` (web routes, mock scenarios, E2E), `2432c19` (gate / mutation wiring). Docs ride in the docs commit.
- Not run here: E2E (`mcp:` 4 passed earlier in the wave, not re-run), `pnpm audit`, `test:mutation`.
