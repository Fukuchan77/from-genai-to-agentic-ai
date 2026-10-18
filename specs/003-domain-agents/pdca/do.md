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
