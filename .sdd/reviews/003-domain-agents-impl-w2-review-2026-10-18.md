# Adversarial review — 003-domain-agents, implementation wave W2 (tasks 8–11), 2026-10-18

Scope: uncommitted work on `feat/m3-w1-foundation` (`git diff HEAD` plus untracked `packages/ai-core/src/files/**`, `packages/ai-core/src/mcp/**`, `packages/ai-core/fixtures/scenarios/m3-1.ts`, `apps/web/app/api/mcp/**`, `workspace/README.md`).
Reviewer context: fresh, without the implementer's reasoning. `pdca/do.md` was read only to locate claims, and each claim used below was checked independently.

## Evidence gathered

- Tests: `env -u NODE_ENV AI_TEST_RUN_MODE=mock AI_TEST_SUITE=gate mise exec -- pnpm exec vitest run src/files src/mcp src/aci/define-tool.test.ts src/mock/m3-scenarios.test.ts src/models/gateway.test.ts --coverage.enabled=false`: 13 files, 279 passed, 0 skipped. These include real child-process starts of `files/stdio.ts`.
- `MCP_FS_ROOT=/nonexistent/ws mise exec -- node packages/ai-core/src/files/stdio.ts` exits 1 with the Japanese reason and does not create the directory. When driven with raw JSON-RPC under Node 26.12 (`initialize`, `tools/call readFile`), the server returned `_meta["agentic-ai/error"] = {kind:"fatal",code:"not-allowed"}` for `/etc/passwd` and `{kind:"recoverable"}` for `rel.txt`. The SDK's own input-validation error (`path`+`index` both set) comes back as `isError: true` without `_meta`.
- Transitive closure of the `.ts`-extension imports: `stdio.ts` → `server.ts` → `operations.ts` → `../aci/response-format.ts` and `../aci/short-id.ts` (both have no imports), `./path.ts` (node built-ins only), `zod` and `@modelcontextprotocol/server` (packages), and `../aci/types.ts` (an `import type`, which is erased). The only `.ts` specifiers in non-test source are in these three files.
- Path probe (`resolveWorkspacePath`, macOS APFS, case-insensitive). These are all correct: upper-case input → canonical in-root real path (macOS `realpath` canonicalises case), `ROOT-EVIL/x` → `outside-root`, link to an outside file → `outside-root`, `link/x` through an outside file → `outside-root`, self-loop → `invalid`, dangling link → `not-found` (and `writeFile` uses `wx`), root given through a symlink or with a trailing `/` → accepted, `a.txt/../../secret` and `missing/../../secret` → `outside-root`, 5000-char and 300-char segment → `invalid`, NUL → `invalid`.
- `@ai-sdk/mcp` stdio child env: `getEnvironment` copies only `DEFAULT_INHERITED_ENV_VARS` (HOME, PATH, …) plus the config's `MCP_FS_ROOT`. `GITHUB_TOKEN` is not passed to the child.
- `zod` record with `"__proto__"` key: the key is dropped, and the prototype is untouched.
- `biome ci` on the W2 files: clean. `check-repo-rules --only mcp-import-scope,tool-risk-declared`: pass (426 / 29 files).
- No change to any `package.json` or `pnpm-lock.yaml`.
- Mutation spot-checks. Each file was copied aside and restored afterwards, and `shasum -c` confirmed the originals.

| # | Mutation | Result |
|---|---|---|
| M1 | `operations.ts` size limit removed (`info.size > MAX_READ_BYTES` → `false`) | killed (1 test) |
| M2 | `server.ts` unexpected error reports `error.message` instead of `error.name` | **survived** (13/13) |
| M3 | `connect.ts` treats every call error as a disconnect (regex check removed) | **survived** (120/120 in `src/mcp`) |
| M4 | `/api/mcp/chat` `checkRequestedAllow` call removed | killed (1 test) |
| M5 | `connectOne` swallows the caller's abort | killed (1 test) |
| M6 | `path.ts` stops walking up on `ENOTDIR` | **survived** (75/75 in `src/files`) |
| M7 | trusted server text passed on even without `kind: "recoverable"` meta | **survived** (120/120) |

## Trigger resolution

### Trigger 1 (boundary): confirmed, every deviation justified, and recorded in plan.md this time

| File | Declared? | Judgement |
|---|---|---|
| `files/operations.ts` | No (tasks (6)) | Necessary. `stdio.ts` must start under plain type stripping (CL-3, 8.4 `_Verify:_`), and `tools.ts` imports `../aci` (extension-less, plus `rates.json`). Verified by starting it. |
| `tsconfig.base.json` `allowImportingTsExtensions` | No (tasks (6)) | Necessary for the above (`noEmit: true` already set). It is repo-wide, though: see F-15. |
| `aci/types.ts`, `aci/define-tool.ts`, `aci/define-tool.test.ts` (`externalInputSchema`) | No (tasks (6)) | Necessary. `buildToolSet` accepts only `defineAciTool` products, and the Zod `checkDescription` cannot express CL-25's JSON-Schema check. The test file only has additions (72 lines, 0 removed). |
| `mcp/request-schema.ts`, `mcp/chat.ts`, `publicMcpStatus` in `mcp/types.ts` | `mcp/**` is inside task 9's boundary, but they are written for 10.4/10.5 | Justified (`apps/web` has no `zod`; M2's `rag/request-schema.ts` is the precedent). Synced into plan C5 and the File Structure Plan. |
| `mise.toml`, `stryker.config.mjs`, `apps/web/e2e/real-server.spec.ts`, `research.md` | Task 11 boundary | Inside the boundary, but tasks 11.1–11.3 are still `[ ]` (F-18). |
| `fixtures/scenarios/m3-1.ts` imports `../../src/mcp/chat` | 10.1 | Inside the boundary. The gateway now depends on `mcp/chat.ts` → `request-schema.ts` (type-only import), so `@ai-sdk/mcp` is not pulled into `models/`. |

Nothing else crept in. Unlike W1 (F-8), plan.md C3/C4/C5 and the File Structure Plan now list the new files. The deviations still await human approval (tasks.md (6)).

### Trigger 2 (dependencies): explained away

No `package.json` or lockfile change. `@ai-sdk/mcp` and `@modelcontextprotocol/server` were declared in W1 (1.2).

### Trigger 3 (existing tests edited): explained away

- `mock/m3-scenarios.test.ts`: `EXPECTED_M3_SCENARIOS` 0→4 and `EXPECTED_M3_TURNS` 0→9, which is the update 10.1 mandates. The numbers trace to the fixture: 4 `defineScenario` calls with 3 + 1 + 2 + 3 turns. The ambiguity detectors are unchanged.
- `models/gateway.test.ts`: one import line widened and one case appended (see F-13 for its title). No assertion was removed.
- `aci/define-tool.test.ts`, `apps/web/lib/server/platform.test.ts`: append-only (72 and 126 lines, 0 removed).

## Critique

### [MEDIUM] F-1 One `ShortIdIndex` is shared by every conversation that uses the file server, so an index can resolve to another request's listing
**Location**: `packages/ai-core/src/files/operations.ts:197-201,287-290`; `packages/ai-core/src/files/server.ts:93-107`; `apps/web/lib/server/platform.ts` (`getMcpRegistry`, one registry per process)
**Issue**: `createFilesServer` calls `createFileOperations` once per server process, and the platform keeps one client per process, so every `/api/mcp/chat` request (and both `/api/mcp/compare` runs) writes into the same `#index`.
**Evidence**: `readonly #index = new ShortIdIndex<IndexedEntry>(...)` lives in `FileToolContext`, which is created once in `createFileOperations(options)` from `createFilesServer`. `stdio.ts` creates one server. Scenario: chat A calls `listFiles` on `/ws/docs`, chat B calls `searchFiles "TODO"`, then chat A calls `readFile {index: 0}` and gets B's first hit. A new conversation that calls `readFile {index: 2}` without listing first also gets a stale entry from an earlier conversation, never the "まだ割り当てられていません" guide. The path stays inside the root, so this is not an escape, but Req 1.13's "直前の結果の索引" contract breaks and learners' conversations bleed into each other.
**Confidence**: high (read from code; the single context per process is structural)
**Fix**: Scope the index to the caller. Options: return the indexed path set in the tool result and resolve the index statelessly; key the index by MCP session (Streamable HTTP session ID, or one stdio server per conversation); or make `index` resolve only against an assignment token returned with the listing. Add a test where two interleaved listings use the same index.

### [MEDIUM] F-2 Disconnect detection is a regex on an error message the server can author, and it is untested in the negative
**Location**: `packages/ai-core/src/mcp/connect.ts:26,324-336`
**Issue**: Any thrown call error whose message matches `/Connection closed|closed client|not connected/i` permanently marks the server `unavailable` and closes its client. A JSON-RPC error reply from the server becomes an `MCPClientError` whose message is the server's `error.message` (`@ai-sdk/mcp` `onResponse`: `new MCPClientError({ message: response.error.message, ... })`).
**Evidence**: An untrusted GitHub server (or an ordinary GitHub error such as "… app is not connected …") replying with such a JSON-RPC error makes the platform drop GitHub for the rest of the process lifetime (see F-3: there is no reconnect). Mutation M3, where every `Error` counts as a disconnect, survived all 120 `src/mcp` tests, so no test pins "an ordinary call error leaves the server connected".
**Confidence**: high
**Fix**: Detect disconnection from the client state instead of from text: track `transport.onclose` / the client's closed flag, or match only the SDK's own exact messages (`"Connection closed"`, `"Attempted to send a request from a closed client"`) *and* require `error.code === undefined`. Add a test where a JSON-RPC error with "not connected" in its message leaves `state: "connected"`.

### [MEDIUM] F-3 A server that is unavailable once stays unavailable until the Next.js process restarts, and a dead server shows as `connected`
**Location**: `apps/web/lib/server/platform.ts` (`getMcpRegistry`, which caches the registry on `globalThis`); `packages/ai-core/src/mcp/connect.ts:137-181,338-353`
**Issue**: `createMcpRegistry` throws only on abort or invalid IDs. A server that fails to connect (a mistyped `MCP_FS_ROOT`, a transient GitHub error) or that disconnects mid-run is recorded `unavailable` in a registry that is cached forever. Nothing retries. In the other direction, a child process that dies between calls keeps `state: "connected"` in `/api/mcp/servers` until some tool call fails.
**Evidence**: `holder[MCP_REGISTRY_KEY] = created`. Only a rejected promise is evicted. `#markUnavailable` sets `state.client = undefined`, and no path ever sets a new client. `createMCPClient({ ..., onUncaughtError: () => {} })` registers no close hook. Scenario: a learner starts `next dev`, opens `/mcp`, notices `MCP_FS_ROOT` was wrong, creates the directory, and the file server stays unavailable until restart. Req 1.10 is met in the narrow sense, but the hands-on loop is broken.
**Confidence**: medium (behaviour is certain; whether the spec intends recovery is a judgement)
**Fix**: Reconnect lazily in `toolsFor`/`status` for `unavailable` servers, with a backoff, or evict and rebuild the registry when any server is unavailable and a minimum interval has passed. Hook the transport's `onclose` to flip the status immediately. Document the restart requirement if recovery is deliberately out of scope.

### [MEDIUM] F-4 The learner never learns why the file server is unavailable, and the test only checks that some reason exists
**Location**: `packages/ai-core/src/mcp/connect.ts:84-93`; `packages/ai-core/src/mcp/connect.test.ts:530-541`
**Issue**: When `MCP_FS_ROOT` does not exist, the child prints the precise reason to the inherited stderr and exits. The status reason the learner sees is the generic `接続に失敗しました（MCPClientError）。起動コマンド、環境変数、接続先を確認してください。`
**Evidence**: `expect(status.reason).toBeTruthy();` passes for any text. Req 1.10 asks for "サーバー名と原因". `resolveServerRoot` already exists and could be called in-process before spawning.
**Confidence**: medium
**Fix**: In `mcpServerConfigs`/`createMcpRegistry`, pre-check the root with `resolveServerRoot` (or a `stat`) and record a specific reason such as "許可ルートが存在しません（MCP_FS_ROOT）". Alternatively, capture the child's stderr (`stderr: "pipe"`) and map the known exit reason. Assert the reason's content in the test.

### [MEDIUM] F-5 The real-server E2E and the `mock` comparison depend on the contents of the learner's gitignored `workspace/`
**Location**: `apps/web/e2e/real-server.spec.ts:284` (`// The first entry of workspace/ is its tracked README.`); `packages/ai-core/fixtures/scenarios/m3-1.ts:41,117`
**Issue**: The E2E expects `[0] README.md` and `toolsCalled: ["listFiles","readFile"]`, and the low-level compare scenario reads `index: 0` of the listing.
**Evidence**: `workspace/README.md` tells learners to put their files there. Directories sort first (`Number(right.kind === "directory") - ...`), and names compare by code unit, so `AGENDA.md` sorts before `README.md`. Once a learner adds `docs/` or `AGENDA.md`, two things go wrong. (a) The E2E fails on their machine. (b) In `mock` the low-level run reads a different item, possibly a directory, which gives a recoverable error that the scenario still answers with "README の内容を読みました". The high-level run reads README. Req 1.12 requires "同じ操作".
**Confidence**: high
**Fix**: Point the E2E's `MCP_FS_ROOT` at a fixture directory created for the test. Make the low-level scenario search for or select README (for example `searchFiles` then `readFile {index}`, or `listFiles` then `readFile {path: <root>/README.md}`) so both approaches read the same file whatever else is present.

### [LOW] F-6 The server's "unexpected error" path is untested; a message leak there would not be caught
**Location**: `packages/ai-core/src/files/server.ts:64-78`
**Issue**: The comment promises that an unexpected error "is reported by name only: its message may hold a path", but no test triggers a non-`FileToolError` failure.
**Evidence**: Mutation M2 (`error.name` → `error.message`) survived `server.test.ts` (13/13).
**Confidence**: high
**Fix**: Add a case that forces an unexpected error, for example an `EACCES` directory in `searchFiles`, or a `readdir` on a path that `stat` reports as a directory but fails. Assert that the result text has the error name and not the path.

### [LOW] F-7 `ENOTDIR` handling in `resolveExistingPrefix` is untested, and without it an escape becomes recoverable
**Location**: `packages/ai-core/src/files/path.ts:42`
**Issue**: When a link points to an outside *file*, `<root>/link/x` currently yields `outside-root` (fatal). If the `ENOTDIR` branch is removed, it yields `invalid` (recoverable), so the run keeps going after an escape attempt.
**Evidence**: Mutation M6 survived all 75 `src/files` tests. The probe confirmed that `/Root/out/x` → `outside-root` with the code as written.
**Confidence**: high
**Fix**: Add `path.test.ts` cases for `<root>/file.txt/x` (`not-found`) and `<root>/link-to-outside-file/x` (`outside-root`).

### [LOW] F-8 Transport errors are swallowed with an empty `onUncaughtError`
**Location**: `packages/ai-core/src/mcp/connect.ts:149-152`
**Issue**: `onUncaughtError: () => {}` discards SSE or stream errors, "maximum reconnection attempts exceeded", and protocol errors. They are not logged (not even by name) and they do not update the status. This is a zero-tolerance item: a swallowed exception.
**Evidence**: `@ai-sdk/mcp` sends `this.onerror?.(new MCPClientError({ message: "MCP HTTP Transport Error: Maximum reconnection attempts ... exceeded." }))` to this handler.
**Confidence**: medium
**Fix**: Route it to the state: record the error *name* in the status (never the message), mark the server unavailable for terminal transport errors, and optionally count occurrences for the observer.

### [LOW] F-9 An untrusted server can still end a run, via HTTP 401/403 on a tool call (prior: W1 F-7, carried to 9.x)
**Location**: `packages/ai-core/src/mcp/adapt.ts:190-193`
**Issue**: `trustErrorMeta: false` stops `_meta` from ending the run, but a 401/403 HTTP status on a tool call becomes `FatalToolError("auth-failed")` for any server.
**Evidence**: The wording is the platform's own `GITHUB_AUTH_MESSAGE`, so no server text leaks; that part of CL-24 holds. GitHub also uses 403 for secondary rate limits and for resources the token cannot reach, so in those cases a run stops with "トークンを確認してください" although the token is fine. This is the W1 F-7 decision, now realised explicitly for MCP. The status is not re-raised.
**Confidence**: medium
**Fix**: Accept and document it in plan C5 as deliberate (a transport-level signal, not server-authored), or limit it to 401 and treat 403 as recoverable unless the body says the token is invalid.

### [LOW] F-10 Check-then-use window between path validation and the file operation
**Location**: `packages/ai-core/src/files/operations.ts:300-318` (read), `:608-617` (overwrite of an existing file, no `wx`), `:658-666` (unlink)
**Issue**: `resolveWorkspacePath` resolves the real path, and the operation then reopens it by name. A concurrent writer who replaces a directory component with a symlink between the two steps redirects the read, overwrite or unlink outside the root. `writeFile` on an existing path follows links.
**Evidence**: Exploiting this needs a local process that can write inside `workspace/`. `writeFile` and `deleteFile` are not registered for agents (Req 1.17), but the stdio server exposes them to any client that speaks to it.
**Confidence**: medium (real but narrow)
**Fix**: Open with `O_NOFOLLOW` on the leaf and re-verify the opened descriptor's real path (`/dev/fd/N` → `realpath`) against the root before reading or writing. Document the residual risk in the C4 notes.

### [LOW] F-11 An over-limit *configuration* is refused per request as the learner's 400, not at startup, and the status still says every tool is registered
**Location**: `packages/ai-core/src/mcp/connect.ts:277-287,314-319`; `apps/web/app/api/mcp/chat/route.ts:88-91`
**Issue**: Req 1.15 says "上限を超える構成を起動時に拒否する". The registry builds statuses with no limit check, and the limit fires only inside `toolsFor`. Through `/api/mcp/chat` it then surfaces as `400 invalid-request` ("許可リストを絞ってください") even when the request sent no `allow`, so the fault is the server's configuration.
**Evidence**: `Registry` constructor: `assemble(...)` → `state.status = { ...tools: statuses }` with `registered: true` for all eligible tools. No count check happens there.
**Confidence**: medium
**Fix**: Check the default (configured) allow-list total in the constructor or in `connectMcpServers`. Either reject it as a startup `ConfigError` (which `getMcpRegistry` turns into 503), or mark the excess as `disabledReason` in the status. Keep the per-request check for request-narrowed lists.

### [LOW] F-12 `tool-risk-declared` does not scan the new `defineAciTool` callers
**Location**: `scripts/check-repo-rules.mjs:918-920`; callers `packages/ai-core/src/files/tools.ts:34-46`, `packages/ai-core/src/mcp/adapt.ts:176-206`
**Issue**: The rule collects only `packages/ai-core/src/aci`. W2 adds two `defineAciTool` call sites outside it, and the scan count is unchanged from W1 (29 files).
**Evidence**: `collectFiles(root, ["packages/ai-core/src/aci"], ...)`. Both new callers pass a computed `risk` (`operation.risk`, `options.risk`), and the type and runtime checks still require it, so the practical risk is low.
**Confidence**: high
**Fix**: Widen the scan to `packages/ai-core/src/**` at the W2 close (11.2), or record why the type-level requirement suffices.

### [LOW] F-13 A gateway test title promises a second step it does not assert
**Location**: `packages/ai-core/src/models/gateway.test.ts:156-171`
**Issue**: "a tool call on the first step, then the next step by tool result" asserts only `first.toolCalls` = `["listFiles"]`.
**Evidence**: `generateText` runs one step (no `stopWhen`), and nothing checks the `readFile` turn. The later turns are covered by route tests, so this is a misleading title, not a gap in behaviour.
**Confidence**: high
**Fix**: Rename the test, or run with `stopWhen: stepCountIs(3)` and assert the sequence.

### [LOW] F-14 Pass-through of a trusted server's text is under-pinned
**Location**: `packages/ai-core/src/mcp/adapt.ts:111-115`
**Issue**: For the trusted server, the text is passed to the model only when `_meta` says `kind: "recoverable"`. The SDK's own input-validation error (observed: `isError: true`, no `_meta`, text "Input validation error: …") should fall back to the generic next action. Dropping the `recoverableMeta` condition is not detected.
**Evidence**: Mutation M7 survived (120/120).
**Confidence**: high
**Fix**: Add a case where the trusted server returns `isError` without `_meta` and the result carries `GENERIC_NEXT_ACTION`.

### [LOW] F-15 `allowImportingTsExtensions` is enabled for every workspace, but only three files need it
**Location**: `tsconfig.base.json:18`
**Issue**: The relaxation applies to `apps/web`, `eval-suite` and all of `ai-core`, and no rule keeps `.ts` specifiers confined to `files/{operations,server,stdio}.ts`. The child-process tests do catch the reverse problem (an extension-less import added to the closure).
**Evidence**: `grep` shows `.ts` specifiers only in those three files today.
**Confidence**: medium
**Fix**: Add a repo rule (or extend `mcp-import-scope`) that permits `.ts` specifiers only in `packages/ai-core/src/files/{operations,server,stdio}.ts`, or enable the option only in `packages/ai-core/tsconfig.json`.

### [LOW] F-16 The comparison counts a run that never read the file as finished
**Location**: `apps/web/app/api/mcp/compare/route.ts:46-56`
**Issue**: `failed` is derived only from `stopReason !== "completed"`. A low-level run whose `readFile` returned a recoverable error, followed by a final answer, counts as completed, and a ratio is computed for different work.
**Evidence**: Together with F-5, the `mock` low-level run produces a ratio even when it read a directory.
**Confidence**: medium
**Fix**: Also mark a run as failed when its last call to the reading tool errored, or when `toolsCalled` lacks the reading tool for the approach.

### [LOW] F-17 The file server ignores the client's cancellation
**Location**: `packages/ai-core/src/files/server.ts:66`
**Issue**: `operation.run(args, AbortSignal.timeout(SERVER_TOOL_TIMEOUT_MS))` ignores the request's own signal (the `extra.signal` of the handler). When a learner stops a run, the client rejects at once (correctly not treated as a broken server), but a `searchFiles` that reads up to 500 files of 1 MB continues in the child for up to 30 s.
**Evidence**: The handler signature `(args) => callOperation(operation, args)` drops the second parameter.
**Confidence**: medium
**Fix**: `(args, extra) => callOperation(operation, args, AbortSignal.any([extra.signal, AbortSignal.timeout(...)]))`.

### [LOW] F-18 The wave is not closable yet (process)
**Location**: `specs/003-domain-agents/tasks.md:299-316`
**Issue**: 11.1–11.3 are `[ ]`, but `mise.toml` (`mcp-import-scope`), `stryker.config.mjs` (`files/path.ts`, `mcp/risk.ts`), `real-server.spec.ts` and the research R-1 note are already changed. There is no recorded `mise run gate` result or mutation-score evidence for W2, and the tasks.md (6) deviations await human approval.
**Evidence**: `tasks.md` 11.2 `_Verify:_` ("閾値 70 を満たす") and 11.3 `_Verify:_` (gate success and timing) have no PROVE entry in `pdca/do.md` yet.
**Confidence**: high
**Fix**: Run 11.2/11.3 once the mutation run in progress finishes, record the results, and get the (6) approval.

## Security questions: answers with evidence

- **Path escape**: no escape found through `..`, a prefix-sharing sibling, symlinks (file, directory, chained `link/x`), a dangling symlink plus write (`wx` → recoverable `EEXIST`), case variants on APFS, NUL, or very long paths (probe table above). The residual risk is the TOCTOU window (F-10).
- **Can an MCP server stop a run?** The trusted file server can, only with a closed-vocabulary code, and the learner's wording comes from `filesServerConfig.fatalMessages` (it contains the root, per Req 1.5). The untrusted GitHub server cannot through `_meta`, but can through HTTP 401/403 (F-9). It can also make the platform drop it permanently with a crafted error message (F-2).
- **Server wording in learner-facing text**: the `classifyMcpToolResult` fatal message, the recoverable summary and the connect reasons are all built from configuration, IDs or error *names*. Untrusted text reaches only the model as tool output (in-scope for M4) and never `finish.run.error`.
- **Can write, destructive or unannotated tools register?** No. `riskFromAnnotations` gives `destructive` unless there is an own `readOnlyHint === true` (and no `destructiveHint: true`), and `assemble` excludes every non-`read-only` tool. The route additionally refuses such names (M4 killed).
- **`GITHUB_TOKEN` leakage**: it is not in the child env (SDK allow-list of env vars), not in statuses (`publicMcpStatus` whitelist), and not in connect reasons (built from name or status code only). `createMcpRegistry` swallows the cause, the route errors map non-platform errors to fixed text, and `finish` metadata carries `publicMcpStatus` only. GitHub is never configured in `mock`. The client bundle cannot contain it because no client component imports `@platform/ai-core/mcp` (W2 adds none).
- **20-tool limit with MCP tools plus think**: `reservedTools: think ? 1 : 0` is passed and pinned by a route test, and `buildToolSet`/`createGuardedAgent` re-check the final set. See F-11 for when the check fires.
- **Learner abort misread as a broken server**: no. `adaptMcpTool` rethrows when `abortSignal.aborted`, so `onCallError` (and the disconnect marking) is never reached.
- **Races in the shared registry**: creation is single-flight (the promise is shared, and a failure is evicted). There is cross-request state in the file server's index (F-1) and no recovery (F-3). A server that dies mid-run: in-flight calls get "Connection closed" → recoverable result plus `unavailable`. That is correct, but it is matched by text (F-2).
- **Allow-list checked before the model**: yes. `checkRequestedAllow` and `toolsFor` run before `gateway.resolve`. Tests assert that no agent is created; they do not assert that `resolve` is not called, but the order in the code is unambiguous.
- **`.ts`-extension closure and plain-Node start**: verified (see Evidence).

## Verified (no finding)

- Requirement 1.4/1.5/CL-1 classification: relative and missing paths are recoverable with a fix guide, an outside path is fatal `not-allowed` with the root in the message. This holds in the tools, the server `_meta`, the client classification and `finish`.
- `GITHUB_TOKEN` is trimmed, sent only as `Authorization: Bearer`, and the URL is constant. With no token, GitHub is absent (Req 1.9).
- `buildAllowedSchemas` uses a null-prototype object and exact-name matching, and allow-lists can only narrow (`toolsFor` throws on widening).
- Request schema: `z.strictObject`, `__proto__` keys are dropped, and servers and tools are bounded.

## Verdict

REQUEST_CHANGES

There is no HIGH finding. F-1 (shared index across conversations), F-2 (server-influenced, untested disconnect classification) and F-5 (E2E and comparison depend on learner files) are concrete, high-confidence defects against Req 1.13, 1.10 and 1.12 that a test can pin. F-3 and F-4 weaken Req 1.10's learner experience.

## Hallucination Signal

forced: false
