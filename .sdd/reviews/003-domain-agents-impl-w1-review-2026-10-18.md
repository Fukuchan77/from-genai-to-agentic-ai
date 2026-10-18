# Adversarial Review: 003 domain-agents, spike + Wave W1 (tasks 1.1, 1.4, 1.6, 2.1–6.4, 7.1)

- Date: 2026-10-18
- Scope: the uncommitted working tree on `feat/m3-w1-foundation` (`git diff HEAD` and the untracked `aci/{description-check,fatal,high-level-compare,input-guide,response-format,short-id,think-tool}{,.test}.ts`, `agents/{observer,token-ledger}{,.test}.ts`, `mock/m3-scenarios.test.ts`, `ports/sandbox.ts`, `testing/tool-description.ts`, `specs/003-domain-agents/pdca/do.md`)
- Inputs: `spec.md` (Req 1, 3, 4.9, 4.10), `plan.md` (Clarifications CL-1..CL-25, C1, C2, C3, C6, C9, C15, C16, 設定値, 環境変数, File Structure Plan, Test Strategy, spike, Implementation Waves), `research.md` (ADR-5 and the appended section 「spike の実測（W1）」), `tasks.md` W1, `.sdd/memory/constitution.md`
- Risk triggers: (1) files changed outside a task's `_Boundary:_`, and (3) existing tests modified. Trigger (2), a new dependency, did not occur: 1.2 was reverted. This review is also the constitution principle 9 wave review for W1 (tasks.md migration condition 3)
- Prior reviews in scope: none for 003. I read `002-rag-and-workflows-impl-w1-review-2026-10-12.md` to calibrate structure and severity. Its F-10 (`workflow-no-agent-loop` scans `.ts` only, accepted) is related to F-3 below and is tagged there

## Evidence gathered

- `env -u NODE_ENV TURBO_FORCE=true mise run gate` exited 0 with `0 cached, 4 total` in 31.6 s (`real`). Results: root `executed=399 passed=399` (1 expected fail), `@platform/ai-core executed=1884 passed=1884 skipped=4`, `@platform/eval-suite executed=7 skipped=8`, `web executed=733`. `workflow-no-agent-loop: scanned 34 FILES`, `tool-risk-declared: scanned 29 FILES`, `TypeScript packages/ai-core/tsconfig.json: 239 files`, `Docs: 8 module documents, 110 test references verified`. This matches the do.md claim (31 s, the same counts). The 5-minute budget (principle 3) is met.
- ai-core coverage from the gate run: `input-guide.ts` 73.68 % statements / 58.82 % branches / 80 % lines (the lowest new file). `token-ledger.ts` branches 83 %. `fatal.ts` and `observer.ts` 100 %. `define-tool.ts` 100 % lines.
- AI SDK source check: `node_modules/.pnpm/@ai-sdk+provider-utils@5.0.58_zod@4.6.5/.../dist/index.js:3166-3230`. `asSchema(zod4)` calls `zodSchema(schema)` with no options. That is `jsonSchema(() => addAdditionalPropertiesToJsonSchema(toJSONSchema(s, { target: "draft-7", io: "input", reused: "inline" })), { validate: safeParseAsync })`. `guidedInputSchema` reuses `zodSchema(inputSchema).jsonSchema`, so the wire JSON Schema is the SDK's own object (see Verified).
- Probes. I put the files only in the session scratchpad, ran them with the repo's Vitest binary and a scratch config, and ran `checkRepoRules` on a scratch fixture tree. Results are quoted in F-1, F-3, F-4, F-5 and F-6.
- Removed or changed lines in modified existing tests: `define-tool.test.ts` (`toBe(echoSchema)` was replaced, see Trigger 3), `calculator.test.ts` (the schema source changed), and description strings swapped for `describeTool(...)` in `define-tool.test.ts`, `tool-set.test.ts`, `guarded-agent.test.ts` and `patterns/role-based-cooperation.test.ts` (plus one `.describe("都市名")`). No test was deleted, skipped or loosened. All other hunks add tests.
- No `TODO` / `FIXME` in the new or changed code. `STOP_REASONS` (`agents/stop-reason.ts`) is unchanged.

## Trigger resolution

### Trigger 1 (boundary): confirmed. Every deviation is justified, but none is reflected in plan.md (F-8)

- **The `define-tool.ts` trip placement (3.2)** is justified. `executeWithGuards` catches every thrown value and converts it to a `ToolOutcome` before `tool-set.ts` sees anything. C2 forbids carrying a `fatal` `ToolFailureKind` in the outcome ("`ToolFailureKind` の `fatal` を戻り値として使うこと（使わない）"). `AciTool` exposes only `toTool(runtime)`, so `tool-set.ts` cannot wrap `definition.execute`. The trip could live in `tool-set.ts` only if the outcome carried a fatal marker (forbidden by C2) or if `AciTool` exposed the raw execute (that would weaken the "only `defineAciTool` output" guarantee). `runtime.fatal` already reaches `toTool`, so `define-tool.ts` is the natural place. `define-tool.ts` is in the same wave's 4.7 boundary, so no other wave's file was touched. Only the C2 "Owns" text and the 3.2 boundary are stale.
- **`scripts/check-client-bundle.mjs` (6.3)** is justified: it fixes a real gap (F-related, see Verified for `SECRET_NAME`). The file is not in the plan's File Structure Plan.
- **`testing/tool-description.ts` + `testing/index.ts`** are not in any boundary or in the File Structure Plan. They add a public helper on `@platform/ai-core/testing` (F-18).
- **`aci/types.ts` `inputSchema`** is a C3 / 4.x change made in a file that only the 3.x boundary lists. It is low impact (a readonly field on `AciToolMetadata`).
- **`patterns/role-based-cooperation.test.ts`** is an M2 file outside every W1 boundary. It is forced by 4.7 (a throw-away tool description).
- **`aci/tools/calculator.test.ts`**: boundary exception (3) covers tests "broken by the description format change (4.6)". This test broke because of the schema wrapping in 4.7, not the description, so the exception covers it only loosely.
- `guarded-agent.test.ts` (3.3) and `tool-set.test.ts` (3.2) are inside their boundaries. The `config/load.test.ts` string rename is inside 2.1.

### Trigger 3 (existing tests modified): explained away. No test was weakened

- `define-tool.test.ts`: `expect(converted.inputSchema).toBe(echoSchema)` became `expect(asSchema(converted.inputSchema).jsonSchema).toEqual(asSchema(echoSchema).jsonSchema)` plus `expect(echo.inputSchema).toBe(echoSchema)`. The old identity property is intentionally false now, because the SDK tool receives a wrapper. The new oracle is "the JSON Schema the SDK would send for the raw Zod schema", which is the requirement (unchanged wire format and cassette keys). The implementation's output is not the reference. The new assertion is stronger on the property that matters. The SDK source check confirms that both sides go through the same `zodSchema()` with no options.
- `calculator.test.ts` now reads `createCalculatorTool().inputSchema` (the Zod schema the wrapper validates with) instead of casting the converted tool's schema. Equivalent. That the wrapper enforces the schema is covered generically by the new `define-tool.test.ts` "does not run the tool body for an invalid input" case.
- The `describeTool(...)` swaps change only description text that the new registration check would reject. No assertion on the old text existed except `converted.description`, which still compares against `echo.description` and `toContain("Echoes the text.")`.

## Boundary check

| File | Task | Status |
|---|---|---|
| `config/{defaults,env-schema,feature-requirements,load,index}.ts` + 3 tests, `.env.example` | 2.1 | in boundary |
| `models/gateway{,.test}.ts` | 2.2 | in boundary |
| `aci/fatal{,.test}.ts`, `aci/types.ts`, `aci/index.ts` | 3.1 / 4.8 | in boundary (`types.ts` `inputSchema` belongs to 4.x, see above) |
| `aci/tool-set{,.test}.ts` | 3.2 | in boundary |
| `aci/define-tool.ts` (the trip) | 3.2 | **outside 3.2**, inside 4.7 |
| `agents/guarded-agent{,.test}.ts` | 3.3 | in boundary |
| `aci/{description-check,input-guide,response-format,short-id,think-tool,high-level-compare}{,.test}.ts`, `aci/define-tool{,.test}.ts`, `aci/tools/*.ts` | 4.1–4.7 | in boundary |
| `aci/tools/calculator.test.ts` | 4.6 exc. (3) | loosely covered (broken by 4.7, not by the description format) |
| `agents/{token-ledger,observer}{,.test}.ts`, `agents/index.ts` | 5.1 / 5.2 | in boundary (`observer.ts` is new, while the plan says Modify; recorded) |
| `ports/sandbox.ts`, `ports/index.ts` | 6.1 | in boundary |
| `scripts/check-repo-rules{,.test}.mjs` | 6.2 | in boundary |
| `packages/ai-core/vitest.config.ts`, `mise.toml`, `scripts/check-client-bundle.test.mjs` | 6.3 | in boundary |
| `scripts/check-client-bundle.mjs` | 6.3 | **outside** |
| `mock/index.ts`, `mock/m3-scenarios.test.ts` | 6.4 | in boundary |
| `stryker.config.mjs` | 7.1 | in boundary |
| `testing/tool-description.ts`, `testing/index.ts` | none | **outside** |
| `patterns/role-based-cooperation.test.ts` | none | **outside** |
| `specs/003-domain-agents/{research,tasks}.md`, `pdca/do.md` | spec docs exc. (2) | allowed (research.md is append-only, which holds) |

## Critique

### [HIGH] F-1 Sibling tool calls of the same step still run after the latch trips. The plan's non-vacuous requirement is unmet and untested
**Location**: packages/ai-core/src/aci/tool-set.ts:43-64 (`refuseAfterLatch`), packages/ai-core/src/aci/define-tool.ts:113-130; missing test in tool-set.test.ts / guarded-agent.test.ts
**Issue**: The refusal reads `latch.error` when `execute` starts, but the AI SDK starts all tool calls of a step together, and the trip happens only after `await raceWithAbort(Promise.resolve().then(...))` settles. A later call in the same step therefore always runs, even when the fatal tool throws synchronously.
**Evidence**: Probe: a mock model returns `[fatalTool, otherTool]` in one step, both built through `buildToolSet(..., { fatal })`, with the same latch passed to `createGuardedAgent`. Result: `{"mode":"generate","sync":true,"otherRuns":1,"modelCalls":1,"stop":"error"}`, and the same `otherRuns=1` for `stream` and for an async throw. The requirement text says otherwise. Task 3.2: "ラッチが立った後のツール実行（**同じステップの残りを含む**）は本体を実行せず拒否する". Plan Test Strategy 非空虚: "致命的エラーでラッチが立った後、**同じステップの残り**と次のステップのツールが**実行されない**こと（実行回数のカウンタを検査）". research.md S-1 even says "ラッチが立った後の実行を止めるのは `buildToolSet` の配線（task 3.2）であり … 3.2 のテストが「ラッチ後は本体が呼ばれない」を実行回数で固定する". But the 3.2 tests call `execute` sequentially (`await execute(tools, "fatalTool"); await execute(tools, "otherTool")`), so they never exercise a same-step sibling. The limit is recorded only in a tasks.md note and do.md ("a sibling call that already started is not interrupted"), and the plan was not amended. In M3 all registered tools are read-only (Req 1.17) and each file call re-checks its own path, so the practical blast radius is small. Still, 004 builds approval and denial on this contract ("`FatalToolError`、`FatalLatch`、停止理由 `error` の経路" in 後続 spec への契約).
**Confidence**: high
**Fix**: Either (a) serialise tool execution per latch in `refuseAfterLatch`: chain each call on a per-latch promise, check the latch after the previous call settles, then run. That costs intra-step parallelism only when a latch is present. Or (b) amend plan C2 / Test Strategy and research.md (append) to state that same-step calls that already started are not stopped. In both cases, add a test with two calls in one step (`generate` and `stream`) that pins the chosen behaviour through the execution counter.

### [MEDIUM] F-2 The latch must be passed to two APIs by hand, and a mismatch is silent
**Location**: packages/ai-core/src/agents/guarded-agent.ts:96-101, :331-333; packages/ai-core/src/aci/types.ts:31-35
**Issue**: `buildToolSet(..., { fatal })` and `createGuardedAgent({ fatal })` must receive the same `FatalLatch` instance, and nothing detects when they don't.
**Evidence**: When only the tool set has it, tools refuse after the trip but no `stopWhen` reads the latch, so the loop runs to the step limit or a natural end, the stop reason is not `error`, and the learner message never reaches `finish` (Req 1.3). When only the agent has it, nothing ever trips. A latch that is already tripped (reused across runs) stops the new run after its first step with a stale error. The tasks.md note admits "渡し忘れを型で防ぐ仕組みは無い（15.2 の組み立てで 1 か所に集める）". Plan C2 originally made the agent own "Run ごとのラッチの生成".
**Confidence**: high (that it is undetectable); medium (likelihood, since 15.2 centralises assembly)
**Fix**: Record the latch on the built tool set, for example a module-private `WeakMap<GuardedToolSet, FatalLatch>` filled by `buildToolSet`, and have `createGuardedAgent` take it from `options.tools`. Drop `GuardedAgentOptions.fatal`, or keep it and throw `ConfigError` when it differs from the tool set's latch. Throw when the latch is already tripped at agent creation. Add tests for both mismatches.

### [MEDIUM] F-3 `mcp-import-scope` and `sandbox-import-scope` have straightforward bypasses (related to 002 W1 F-10, accepted there for `.ts`-only scanning)
**Location**: scripts/check-repo-rules.mjs:1151-1206, `moduleImports` :381-434, `codeFiles` :506
**Issue**: Several import forms and connection paths go unflagged.
- Template-literal imports (the tokenizer drops template text).
- `createRequire` aliases.
- `.mjs` / `.js` files.
- Anything under `scripts/` or `tooling/`.
- A Docker connection through `node:net` or a socket path taken from the environment.
**Evidence**: Fixture tree in the scratchpad, `checkRepoRules({ only: ["mcp-import-scope","sandbox-import-scope"] })` returned `violations: []` for both rules on:
- `await import(\`@ai-sdk/mcp\`)` (agents/a.ts)
- `const r = createRequire(import.meta.url); r("@ai-sdk/mcp"); r("@e2b/code-interpreter")` (agents/b.ts)
- `net.createConnection({ path: process.env.DOCKER_HOST ?? \`${HOME}/.docker/run/docker.sock\` })` (analysis/c.ts)
- `import { createMCPClient } from "@ai-sdk/mcp"` in `agents/d.mjs` and in `scripts/seed.ts` (not scanned: fileCount 3)

Plan C16 / ADR-4: "`node:http` による Docker 接続は `sandbox/docker/` だけ". The rule never looks at `node:http` / `node:net` imports. It uses the `socketPath` identifier and `"docker.sock"` strings as proxies. There is also a plan inconsistency: C16 says "`@ai-sdk/mcp` は `mcp/` と `ports/` だけ", while task 6.2 and the implementation say `mcp/` only. The proxy also has a false positive: the implementer had to rename a legitimate `docker.sock` string in `config/load.test.ts`, and W4's `DOCKER_HOST` tests outside `sandbox/docker/` will hit the same thing.
**Confidence**: high (bypasses confirmed)
**Fix**:
- Flag a dynamic `import(` / `require(` whose argument is a template literal, or any non-literal argument, in files that are not allow-listed.
- Treat calls on an identifier bound to `createRequire(...)` as `require`.
- Scan `.mts/.cts/.js/.mjs` and include `scripts/`.
- For Docker, flag `node:net` imports and `node:http`/`node:https` imports that pass `socketPath`/`path` options outside `sandbox/docker/`, or record the heuristic in plan C16 as an accepted approximation with its residual risk.
- Reconcile C16's "`mcp/` と `ports/`" with the task.

### [MEDIUM] F-4 `checkJsonSchemaDescription` accepts any property whose name is a substring of the description
**Location**: packages/ai-core/src/aci/description-check.ts:149
**Issue**: `description.includes(name)` lets short names such as `a`, `id`, `at`, `q`, `n` pass because they appear inside ordinary words.
**Evidence**: Probe with description "Reads a file at a valid path." + headings, properties `{a, id, at, owner}` (no `description`): result `["owner"]`, so `a`, `id` and `at` passed (`id` ⊂ "valid", `at` ⊂ "path"). CL-25 makes this the only check of input meaning for external MCP tools ("プロパティ名が実効の説明文に現れること") and the basis on which Req 1.1/1.11 count as satisfied for GitHub tools. The test "accepts a property whose name appears in the description" uses `path`, which is also a substring case, so it cannot detect this.
**Confidence**: high
**Fix**: Match the name as a token. Use a word boundary for ASCII names (`(?<![A-Za-z0-9_])name(?![A-Za-z0-9_])`) and treat `name=` / `` `name` `` / `name:` as matches. Add `id`-in-"valid" and `a`-in-text negative cases.

### [MEDIUM] F-5 `checkDescription` has false negatives, and it accepts schemas the SDK cannot send
**Location**: packages/ai-core/src/aci/description-check.ts:88-138; test description-check.test.ts:143-148
**Issue**: The walk ignores `additionalProperties` (records), `$ref`/`definitions` (recursive `z.lazy`) and accepts a union when any member is described. It also converts with `unrepresentable: "any"`, while the SDK's `zod4Schema` uses the default (`throw`).
**Evidence**: Probes:
- `z.record(z.string(), z.object({ inner: z.string() })).describe("map")` gives `[]` (`inner` is undescribed but not flagged).
- A `z.lazy` node with `bad: z.string()` gives `[]`.
- `z.union([z.string().describe("s"), z.number()])` gives `[]`.
- `z.object({ when: z.date().describe("w") })` passes `defineAciTool`, but `asSchema(tool.inputSchema).jsonSchema` throws `Error: Date cannot be represented in JSON Schema` when the request is built. The test "does not throw for a schema JSON Schema cannot represent" enshrines the acceptance.

Req 1.1: "すべてのツールに … スキーマで検証される入力定義".
**Confidence**: high (probes); low (current impact, since no M1/M3 tool uses these shapes yet)
**Fix**: Walk `additionalProperties` (path `name{}`) and resolve local `$ref`s with a visited set. Require the description on the union node itself, or on every member. Convert with the same options as the SDK (no `unrepresentable: "any"`), or call `zodSchema(schema).jsonSchema` in `assertValidDefinition` so an unsendable schema fails at definition time. Change the date test to expect a `ConfigError`.

### [MEDIUM] F-6 The fix guide's "正しい入力の例" is often not a valid input, and `input-guide.ts` is the least-covered new file
**Location**: packages/ai-core/src/aci/input-guide.ts:49-90; input-guide.test.ts:68-75
**Issue**: `exampleFor` ignores exclusive bounds, formats/patterns and refinements. The guide then tells the model that an invalid value is correct, which invites the same failing call until the step limit.
**Evidence**: Probes:
- `z.number().gt(5)`: guide `5 より大きい値にしてください` and `正しい入力の例: {"n":1}`, and `schema.safeParse(example).success === false`.
- `z.email()`: `email-example-valid => false`.
- An object with `.refine(a < b)`: example `{"a":1,"b":1}`, which violates the refine.

Req 1.2: "違反したパラメータ名と**正しい入力形式**を示す修正ガイド". Coverage: 73.68 % statements, 58.82 % branches, uncovered lines `61-73, 78, 105` (number bounds, boolean, array, `default`, number `too_small`). The only validity test uses a simple schema.
**Confidence**: high (probes); medium (impact on real models)
**Fix**: Validate the generated example with `inputSchema.safeParse` and omit the example line (or say "例は省略") when it fails. Handle `exclusiveMinimum` / `exclusiveMaximum` and `format` (email, uri, date-time, uuid) with fixed sample values. Add parameterised tests asserting that every emitted example parses, plus number / boolean / array / `too_small`-number cases.

### [MEDIUM] F-8 Boundary deviations are recorded in tasks.md and do.md only, not in plan.md (zero-tolerance item)
**Location**: plan.md C2 "Owns" and File Structure Plan; files listed under Trigger 1
**Issue**: The zero-tolerance rule requires an explicit plan.md update for files modified outside the task boundary. Six deviations have none: `define-tool.ts` for 3.2, `check-client-bundle.mjs`, `testing/tool-description.ts` + `testing/index.ts`, `types.ts` for 4.x, `patterns/role-based-cooperation.test.ts`, and `calculator.test.ts`.
**Evidence**: Plan C2 still assigns the latch to `aci/tool-set.ts` ("実行時のラッチの配線（致命的エラーをラッチに載せ…）") and the latch creation to `guarded-agent.ts` ("Run ごとのラッチの生成、内部 `AbortController` による停止"). Both changed, through S-1 and the 3.2 deviation. Plan File Structure Plan states "ここに無いファイルは tasks.md が触れない".
**Confidence**: high
**Fix**: In the next plan sync:
- Update C2's Owns. The trip lives in `define-tool.ts` and the refusal in `tool-set.ts`. The caller creates the latch, or F-2's derivation is used. The stop path is `stopWhen` rather than abort, per S-1.
- Add `scripts/check-client-bundle.mjs` and `packages/ai-core/src/testing/tool-description.ts` to the File Structure Plan.
- Note the M2 test touched by 4.7 as a boundary exception like (3).

### [LOW] F-7 `classifyToolError` treats any thrown object with `status`/`statusCode` 401/403 as fatal `auth-failed`
**Location**: packages/ai-core/src/aci/fatal.ts:48-65
**Issue**: The duck-typed check cannot tell our own credentials apart from a third party's response. A future read tool that throws on a fetched page's 403 (bot protection, a private URL), or a W5 child agent whose provider returns 403 for policy reasons, would end the run with "トークンまたはキーの設定を確認してください", which is wrong guidance.
**Evidence**: `const status = record.status ?? record.statusCode; ... if (status === 401 || status === 403) return { kind: "fatal", error: new FatalToolError("auth-failed", AUTH_FAILED_MESSAGE) }`. The check runs before the `PlatformError` branch. M1 tools are not affected today: weather converts HTTP failures to `ToolExecutionError`, which is handled before classification. CL-24 says "HTTP の 401 / 403 は従来どおり `auth-failed`", which supports the rule for credentialed connections only.
**Confidence**: medium
**Fix**: Keep the heuristic only for errors from credentialed adapters, for example `APICallError` from our gateway, the MCP HTTP transport, or E2B. Have those adapters throw `FatalToolError("auth-failed")` explicitly and drop the generic duck typing. Otherwise document in C2 that tools fetching arbitrary URLs must convert 401/403 into `ToolExecutionError`, and add a test for that convention.

### [LOW] F-9 The `concise` output is longer than the configured limit
**Location**: packages/ai-core/src/aci/response-format.ts:22-26
**Issue**: The result is `maxCharacters` code points plus an omission line plus `fullTextHint`. The text returned to the model is therefore longer than `DEFAULT_TOOLS.conciseMaxCharacters` (1,000).
**Evidence**: Req 1.6: "`concise` 指定時に出力を設定された上限（既定 1,000 文字）以内の要約に切り詰め、全文取得方法の案内を付与する". Two readings are possible (the body ≤ 1,000 with the hint added, or the whole output ≤ 1,000). The tests pin the first without recording the choice.
**Confidence**: medium
**Fix**: Decide and record it in C3. If the whole output must fit, reserve the note and hint length inside `maxCharacters` (and reject a hint longer than the limit).

### [LOW] F-10 `TokenLedger` is not connected to `RunObserver`, and its fields do not match `AgentRunSummary.totalTokens`
**Location**: packages/ai-core/src/agents/token-ledger.ts:1-26, :58-65; guarded-agent.ts:39-44
**Issue**: Plan C9 says "`TokenLedger`… `RunObserver` から記録する", but there is no observer adapter or test. `AgentTokenTotals` is `{ input, output, cacheRead, reasoning }` while `UsageInput` is `{ inputTokens, outputTokens, totalTokens }`, so every caller has to map the fields. A record with only `totalTokens` counts as "known" and adds `inputTokens: 0, outputTokens: 0`, so the role reports exact zeros instead of unknown parts.
**Evidence**: `const known = isCount(total) || (isCount(input) && isCount(output)); … state.inputTokens += isCount(input) ? input : 0;`.
**Confidence**: medium
**Fix**: Add a `ledgerObserver(ledger, role): RunObserver` that maps `AgentRunSummary.totalTokens`, with a test. Document or represent per-field unknowns (for example `unknownInputCalls`), or require both input and output to count as known.

### [LOW] F-11 The external-content log is a standalone object, not a `RunObserver` hook, and "never the content" is a convention only
**Location**: packages/ai-core/src/agents/observer.ts:26-54
**Issue**: CL-10 says "`RunObserver` で外部コンテンツ…の取り込みを記録する口". The implementation is an unrelated `ExternalContentLog`, so nothing links an ingestion to a run or an agent. `source` is an unbounded string, so a caller can put content into it.
**Evidence**: `createExternalContentLog()` has no run or agent association. The test drops an extra `content` property but cannot stop `source: <content>`.
**Confidence**: medium
**Fix**: Add the run's agent name (from `createNamedObserver`) to the ingestion record, or expose the log through the observer options. Cap `source` (for example 512 characters) with a test, so the constraint is mechanical.

### [LOW] F-12 The module 1-2 doc shows a tool definition that `defineAciTool` now rejects
**Location**: docs/modules/1-2-ai-sdk-core-and-tools.md:150-158
**Issue**: The "abridged" `current-time.ts` snippet still uses the old one-sentence description. With 4.7 it would throw `ConfigError`, and the surrounding text does not mention the CL-18 format.
**Evidence**: `description: "現在の日時を返します。日付や時刻、曜日を答えるときに使ってください。",`, while the code is now the four-line CL-18 form. AGENTS.md: "After a rename … grep for the old name … before reporting done".
**Confidence**: high
**Fix**: Update the snippet now, or carry it explicitly into 40.1 (the 3-1 doc can explain the change). Note it in "移植時の変更点" if 1-2 is not re-tagged.

### [LOW] F-13 research.md describes a different CL-2 mechanism from the one implemented
**Location**: specs/003-domain-agents/research.md 「CL-2: 入力検証の失敗の文言」 and S-1 bullet 「同じステップの残りのツールは止まらない」
**Issue**: research.md says the schema is wrapped as `jsonSchema(z.toJSONSchema(schema), { validate })`. The implementation uses `zodSchema(schema).jsonSchema`, and the two produce different JSON Schemas: raw `z.toJSONSchema` lacks `io: "input"`, the draft-7 target and `addAdditionalPropertiesToJsonSchema`, so the documented form would change cassette keys. The S-1 bullet also attributes same-step stopping to task 3.2 (see F-1). Principle 8 requires facts to be measured.
**Evidence**: research.md "ツールの `inputSchema` を `jsonSchema(z.toJSONSchema(schema), { validate })` で包み" vs define-tool.ts:91-93.
**Confidence**: high
**Fix**: Append a correction to research.md (append-only): the adopted form is `zodSchema(...).jsonSchema` and why it matters for keys, plus the same-step result from F-1.

### [LOW] F-14 "Cassette keys do not change" holds for schemas only. The six M1 descriptions changed
**Location**: tasks.md task 4 Implementation Notes; do.md task 1.1 note
**Issue**: Tool descriptions are part of the canonicalised request (`mock/request-key.ts` hashes `params` minus `abortSignal`/`headers`/`providerOptions`). The rewritten M1 descriptions therefore change the key of any recorded request that includes those tools.
**Evidence**: `fixtures/cassettes/llm/` is empty, so the gate is unaffected. Learners' `local` recordings for `/agent`, `/rag/agent` and similar would no longer match in `mock`.
**Confidence**: medium
**Fix**: Qualify the note ("スキーマ由来のキーは変わらない。M1 の説明文の改訂により、M1 ツールを含む録画は撮り直しが要る") and mention it in the 3-1 doc's 移植時の変更点.

### [LOW] F-15 Without a latch the behaviour is not exactly M1's, and recoverable text has two sources of truth
**Location**: packages/ai-core/src/aci/define-tool.ts:121-140, fatal.ts:66-75
**Issue**: Without `runtime.fatal`, a thrown 401/403 or a `FatalToolError` now returns `AUTH_FAILED_MESSAGE` or `learnerMessage` as the summary. M1 returned `ツール「x」の実行に失敗しました（Error）。`. The test "behaves like M1 without a latch" checks only `ok: false`. Separately, `classifyToolError`'s recoverable summary and next action are computed and then discarded by `failureFrom`, which has its own copies (`RECOVERABLE_NEXT_ACTION` == `FAILURE_NEXT_ACTION`, different summary format). Task 3.2 asked for "`classifyToolError` の要約と次の修正アクション".
**Confidence**: medium
**Fix**: Either use `classifyToolError`'s recoverable result in `failureFrom` (adding the tool name there), or drop the recoverable branch from `classifyToolError`'s public contract. Pin the no-latch summary text in the M1-compatibility test.

### [LOW] F-16 `test:container` promises a skip with a reason that does not exist yet, and the network guard will block it
**Location**: mise.toml `[tasks."test:container"]`; tooling/vitest/setup-hermetic.ts
**Issue**: The description says "skipped with a reason when Docker is unreachable", but there is no `describeContainer`/skip helper. With 0 tests the task passes silently. The hermetic guard blocks unix sockets, so the first `*.container.test.ts` (17.x) needs a change in `tooling/vitest/`, which no W4 boundary lists (the implementer noted this).
**Evidence**: `pnpm --filter @platform/ai-core run test` with `AI_TEST_SUITE=container` is honoured: mise `env` reaches the child, and turbo is bypassed, so turbo's env filtering does not apply. `passWithNoTests: suiteName !== "gate"`. CI does not run it, which matches plan "CI は Docker を使えるが M3 では組み込まない".
**Confidence**: high
**Fix**: Add the skip helper (mirroring `describeLocal`) and the container-suite exception to the network guard in W4's first container task. Add `tooling/vitest/*` to that task's boundary now.

### [LOW] F-17 `WORKFLOW_FILES` silently drops a listed file that is renamed or never created
**Location**: scripts/check-repo-rules.mjs:631-640, :1118-1121
**Issue**: Only existing listed files are scanned, and `workflows/` / `patterns/` keep the rule above 0 files. If W3 or W6 names a file differently (for example `helpdesk/plan.ts`), the ADR-9 guard stops covering it with no failure.
**Evidence**: `for (const file of WORKFLOW_FILES) { if (await fileExists(...)) listedFiles.push(file); }`. Tasks 16.1 and 28.1 only say "確かめる".
**Confidence**: medium
**Fix**: Once a listed file's directory (`helpdesk/`, `requirements/`, `marketing/`) exists, require its listed files to exist (fail with "listed workflow file missing"). Alternatively have 16.1 and 28.1 add an assertion of the expected scanned count.

### [LOW] F-18 `describeTool` is a public helper that satisfies the description check with boilerplate
**Location**: packages/ai-core/src/testing/tool-description.ts, testing/index.ts:10
**Issue**: `@platform/ai-core/testing` is an exported subpath, and no repo rule keeps non-test code from importing it. Production code could pass `checkDescription` with "使うとき: テストの中で呼び出すとき。", which defeats CL-16 / CL-18.
**Evidence**: `grep '@platform/ai-core/testing' apps/web` (non-test) shows only a comment today. No rule in `check-repo-rules.mjs` mentions `testing`.
**Confidence**: low
**Fix**: Keep the helper test-local (import by relative path only, not re-exported from `testing/index.ts`), or add a rule or a guard that rejects the exact boilerplate outside `*.test.*`.

### [LOW] F-19 The wave cannot close yet (process)
**Location**: specs/003-domain-agents/tasks.md 1.2, 1.3, 1.5, 7.2; "### Implementation Notes" of task 7
**Issue**: Migration conditions 1 and 2 are not met. 1.2 (dependencies and `exports`), 1.3 (S-2/S-3, needed before W2), the type check part of 1.5, and 7.2 (gate duration in research.md, `pnpm audit`, `allowBuilds`) are open. Task 7's Implementation Notes are empty. CI has not run because the work is uncommitted.
**Evidence**: `- [ ] 1.2`, `- [ ] 1.3`, `- [ ] 1.5`, `- [ ] 7.2`. do.md records that `pnpm install` was refused by the sandbox classifier.
**Confidence**: high
**Fix**: Get human approval for `pnpm install`, finish 1.2 → 1.3 → 1.5 → 7.2, append the responses to this file, commit, and confirm `ci-status` before moving tasks.md.

## Verified (no finding)

- **S-1 decision**. The latch is read by `stopWhen`, with no abort, and it matches the measured spike. The probe and `guarded-agent.test.ts` show one model call, `stopReason: "error"` and `error: { code, message: learnerMessage }` for `generate`, for `stream` and for the UI stream. There is no `abort` chunk, and `guarded.abortSignal.aborted === false`. In `finalise`, the latch outranks an abort and a later trip does not rewrite a finished summary (test "keeps a stop that already happened"). `latchTripped` reads only the latch, as S-1's fallback requires. `STOP_REASONS` is unchanged. `deriveStopReason` reaches `error` through the existing `errored` branch (C2 "Does NOT own").
- **`guidedInputSchema`**. The JSON Schema is the SDK's own object: `zodSchema(inputSchema).jsonSchema`, the same call `asSchema` makes for a Zod 4 schema. An async `.refine` works (`runs: 0`, guide delivered). `z.coerce.number()` and `.transform` deliver the parsed value to `execute` (test `{ count: 3 }`). `formatInputGuide` adds no received values (the SDK's own `Value: {...}` prefix remains, as research.md records).
- **Config** (2.1). Every `DEFAULT_*` value equals plan 「設定値」, field by field. The five environment variables are optional. `e2b-sandbox` → `E2B_API_KEY` and `github-mcp` → `GITHUB_TOKEN`. Docker is not in the feature table (C1). `credentials.e2b` / `credentials.github` exist only when set. The `DEFAULT_MCP_FS_ROOT` extra is recorded.
- **Gateway** (2.2). `credentialSecrets` now includes `E2B_API_KEY` and `GITHUB_TOKEN`. The RED and PROVE runs are recorded.
- **`SECRET_NAME`** (6.3). `(?:^|_)TOKEN(?:$|_)` adds `GITHUB_TOKEN` and still excludes `AGENT_MAX_TOTAL_TOKENS`. No other schema name ends in or contains a `_TOKEN_` word. The sentinels are in both `env` and `--sentinel` with identical `changeme-` values (the test parses mise.toml). Watch for W7: a client component that hard-codes the text `GITHUB_TOKEN` / `E2B_API_KEY` in help copy will now fail the bundle check, so the guidance must come from server JSON.
- **Sandbox port** (6.1). The types match C6 exactly. No E2B or Docker type is used.
- **Scenario detector** (6.4). It is tested with synthetic ambiguous sets. The real-set check is non-vacuous through the prior M1/M2 turns (> 30) and the pinned M3 count (0).
- **ACI helpers**. `ShortIdIndex` has no UUID, and `resolve` rejects out-of-range or non-integer indices. `createThinkTool` keeps nothing and calls `onCall` with no arguments. `compareApproaches` computes no ratio on failure or on 0 low-level tokens. `applyResponseFormat` counts code points, never splits a surrogate pair, and checks the exact and +1 boundaries.
- `stryker.config.mjs` adds `aci/description-check.ts` (7.1). I did not run mutation testing (a run was already in progress).

## Verdict
REQUEST_CHANGES

The wave delivers the planned W1 surface and the gate is green with fresh evidence (31.6 s, 0 cached). The two risk triggers resolve as follows. The boundary deviations are justified but undocumented in plan.md (F-8). No existing test was weakened. Before the wave closes, fix F-1 or explicitly accept it by amending plan C2 / Test Strategy and research.md. As implemented, the plan's own non-vacuous requirement ("同じステップの残り … 実行されない") is neither met nor tested, and research.md claims otherwise. F-2 (the double-passed latch) should be fixed while the API is still unused, because 004 builds on it. F-3 to F-6 are concrete false-negative holes in mechanical checks that the plan relies on, each confirmed by a probe. Each needs a fix or a recorded acceptance. The LOW items can be answered in the response section. Independently of the findings, migration is blocked on 1.2, 1.3, 1.5 and 7.2 (F-19).

## Hallucination Signal
forced: false

## Responses

<!-- Implementer appends the response to each finding here (wave migration condition 3). -->
