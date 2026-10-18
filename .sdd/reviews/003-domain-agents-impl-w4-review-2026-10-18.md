# Adversarial review: 003-domain-agents, implementation wave W4 (tasks 17–20), 2026-10-18

Scope: uncommitted work on `feat/m3-w1-foundation`. This covers `git diff HEAD` (24 modified files) plus the untracked `packages/ai-core/src/{sandbox,analysis}/**`, `packages/ai-core/src/testing/container-only*.ts`, `packages/ai-core/fixtures/{sandbox,analysis}/**`, `packages/ai-core/fixtures/scenarios/m3-3.ts`, `docker/sandbox/**`, `apps/web/app/api/analysis/**` and `apps/web/lib/server/{upload,sessions}*.ts`.
Reviewer context: fresh, without the implementer's reasoning. `pdca/do.md` was not read. I did not run `mise run gate`, `test:e2e`, `test:mutation` or any Docker container, as instructed.

## Evidence gathered

- Targeted suites (all with `env -u NODE_ENV mise exec -- pnpm exec vitest run … --coverage.enabled=false`):
  - `packages/ai-core`: `src/sandbox src/analysis src/testing/container-only.test.ts src/mock/m3-scenarios.test.ts` gave 20 files and 397 passed.
  - `apps/web`: `app/api/analysis lib/server/{upload,sessions,domain-stream,errors,guard,platform}.test.ts` gave 9 files and 286 passed.
  - Root: `tooling/vitest/setup-hermetic.test.ts scripts/check-repo-rules.test.mjs` gave 229 passed.
- Behaviour probes. I wrote a throwaway vitest file and config under the session scratchpad (`…/scratchpad/probe/`). They import the real sources by absolute path, and nothing in the repository was written:

| Probe | Setup | Observed |
|---|---|---|
| P1 | every `runPython` throws `PlatformError("provider-unavailable", …)` (Docker gone, E2B expired, session closed). The model writes code 5 times, then answers | `status: "succeeded"`, `attempts: 0`, `fixes: 0`, **6 model calls**, `stopReason: "completed"` |
| P2 | first run fails (`KeyError`), the model answers instead of fixing | `status: "succeeded"`, 1 attempt, and that attempt failed |
| P2b | the model answers without calling `runPython` | `status: "succeeded"`, 0 attempts |
| P4 | runs alternate fail/success: F S F S F S F | `attempt-limit` after 7 runs, `fixes: 3`. The last failure got **no** fix, but the learner is told "コードの修正を 3 回まで試しましたが、成功しませんでした" |
| P3 | Docker provider: `close()` while `engine.createContainer` is pending, then creation resolves | the run goes on: `closed,created,put,start,wait,remove`. The code ran to completion after the session was closed |

- Static checks: I read every file in scope. Below are the isolation points verified by reading the code. The container suite observes them live, but I did not run it.
  - `buildSpec` sets `NetworkDisabled` and `NetworkMode: "none"`, `ReadonlyRootfs`, `CapDrop: ["ALL"]`, `no-new-privileges`, `User: "10001:10001"`, `Memory = MemorySwap`, `NanoCpus`, `PidsLimit`, `Tmpfs /tmp rw,noexec,nosuid,size=64m`, and an anonymous volume at `/work`.
  - The Dockerfile `mkdir /work` runs as root, so the volume is seeded root-owned 755.
  - `tar.ts` writes uid/gid 0 and mode 0644.
  - Nothing in `analysis/` or `apps/web` executes the file or the generated code on the host. The host does only two things to the file: it lists the zip central directory, and it scans an OLE2 file for a UTF-16 stream name.

## Trigger resolution

### Trigger 1 (files outside `_Boundary:_`): confirmed. One change is not covered by the exceptions (F-7)

| File | Covered by | Judgement |
|---|---|---|
| `tooling/vitest/network-guard.ts`, `setup-hermetic.test.ts` | exception (8) | Justified (W1 F-16 follow-up), and append-only: +52 test lines, 0 removed. The allowed set is exact paths, only in the `container` suite, with no TCP. A test pins `.evil` suffixes and other suites. |
| `testing/container-only*.ts`, `testing/index.ts` | exception (8) | Justified. Skip-with-reason works: a probe failure becomes a skip, not a failure, and `container-only.test.ts` covers this. The vitest config keeps `*.container.test.*` out of `gate`. |
| `docker/sandbox/requirements.txt` | exception (8) | Justified (fully pinned). |
| `lib/server/guard.ts`, `errors.ts`, `sandbox/docker/local.ts`, `uploadKindOf` export | exception (9) | Justified. `guard.ts` is a pure extraction: `guardRequest` keeps its order, and the old tests still pass. `errors.ts` passes only `details.guidance` (string, 1–500 chars) for `provider-unavailable`. The only producer is `selectSandboxProvider`, which uses fixed text plus the configured image name. |
| `lib/server/errors.test.ts`, `guard.test.ts` | implied by (9) | Not named, but they test the files (9) names. Append-only. |
| `sandbox/mock-marker.ts`, `analysis/scenarios.test.ts`, `sandbox/file-name.test.ts`, `docker/local.test.ts` | section boundaries `sandbox/**`, `analysis/**` | Inside the section boundaries. |
| **`scripts/check-repo-rules.mjs` and `scripts/check-repo-rules.test.mjs`** | **none** (20.2's boundary is `mise.toml`, `stryker.config.mjs`) | **Not recorded.** It loosens `sandbox-import-scope` by excluding `tooling/vitest/` and `packages/ai-core/src/testing/container-only*`. It is explained in the 20 Implementation Notes, but it is missing from exceptions (8)/(9) and from plan C16. See F-7. |

### Trigger 2 (existing tests modified): explained away

- `mock/m3-scenarios.test.ts`: the counts go 8 → 11 scenarios and 32 → 42 turns. Recomputed from `m3-3.ts`: success 2 + fixed 3 + attempt-limit 5 = 10 turns over 3 scenarios. That matches 32 + 10 and 8 + 3. The detectors are unchanged.
- `domain-stream.test.ts`, `platform.test.ts`: the only removed lines are widened imports (1 each). `errors.test.ts`, `guard.test.ts`, `gateway.test.ts`, `check-repo-rules.test.mjs` and `setup-hermetic.test.ts` are append-only. No assertion was removed or loosened.

### Trigger 3 (Docker design changed after measurement): explained away, with plan sync done

- The change: `/work` becomes an anonymous volume instead of a tmpfs, `/tmp` becomes the only writable tmpfs, containers are thrown away per run, and the API version is 1.44. It is measured in research "W4 の実測", synced into plan C6 "Owns" and the `runAnalysis` signature, and pinned by `provider.test.ts:171`.
- The safety argument holds on the code. `/work` comes from the image's root-owned directory and the tar entries are root-owned 0644, so uid 10001 cannot fill the volume. `DELETE ?force=1&v=1` removes the volume with the container.
- Remaining gaps the redesign opened: F-4 (close vs. a run being created) and F-5 (log size on the daemon).
- CL-26 (first run + 3 fixes = 4 runs) is defensible against Req 3.3 ("修正を最大 3 回まで繰り返す"). It is marked ★, so it needs the human confirmation the plan's legend requires before approval. The cumulative counting across failure episodes is a separate question (F-3).

## Critique

### [HIGH] F-1 A sandbox that cannot run is reported as `succeeded` with zero attempts, after up to 12 model calls
**Location**: `packages/ai-core/src/analysis/run-python-tool.ts:94-99`, `packages/ai-core/src/analysis/agent.ts:222-227`, `packages/ai-core/src/aci/fatal.ts:66-69`
**Issue**: A `PlatformError` thrown by `session.runPython` escapes `execute` before `log.record`, so `classifyToolError` treats it as recoverable. The run is not counted, the model is asked again, and if the model eventually answers, the result is `succeeded`.
**Evidence**: Probe P1 gave `succeeded attempts 0 fixes 0 modelCalls 6 completed`. It is reachable in normal use:
- Docker stops after start-up. The enabled setup is cached forever (F-9), so the 503 pre-check passes, and `createContainer` throws `provider-unavailable`.
- E2B expires mid-session, and `EXPIRED` is thrown.
- `DELETE /api/analysis/sessions/[id]` or a disconnect closes the session, and `CLOSED` is thrown.
- The tool timeout (`executionTimeoutMs + 5 s`) fires because create, a 20 MiB archive and start took longer than 5 s before the wait deadline even started (F-20).

Req 3.1 / 3.6: the learner sees "succeeded" and zero executions, and every extra step spends tokens. `run-python-tool.test.ts:274` pins the recoverable behaviour, but no test looks at the run's resulting status.
**Confidence**: high (reproduced)
**Fix**: In `runPython`, map a `provider-unavailable` from the session to a fatal error (add e.g. `sandbox-unavailable` to `FATAL_ERROR_CODES`, or reuse `config-missing`) so the latch stops the run. Surface it as its own status (e.g. `"sandbox-unavailable"`), or as a stream error with the selection guidance. Separately, never report `succeeded` without a successful attempt (F-2). Add an `agent.test.ts` case and a route case where the provider fails after selection.

### [MEDIUM] F-2 `succeeded` does not mean any code succeeded: a model that gives up, or never runs code, gets `succeeded`
**Location**: `packages/ai-core/src/analysis/agent.ts:227`
**Issue**: `status` is derived only from `run.stopReason === "completed"`, not from the attempt log.
**Evidence**: Probe P2: the first run fails and the model answers, giving `succeeded` with its only attempt failed. Probe P2b: there is no `runPython` call, and the result is `succeeded` with 0 attempts. Req 3.3 requires that on an error the platform "SHALL エラー出力をエージェントへフィードバックして修正版のコードを生成・再実行"; the model choosing to stop early is not covered by any status. Req 3.1 requires generating and running code. The `data-analysis-result` part then tells the UI `succeeded` with `fixes: 0`.
**Confidence**: high (reproduced)
**Fix**: Set `succeeded` only when the last attempt has no error. Otherwise use a distinct status such as `"gave-up"` or `"no-run"`, document it in plan C7 and the stream table, and add tests for both probes.

### [MEDIUM] F-3 Fixes are counted across the whole analysis, so a fresh failure after earlier successful fixes stops at once with a false message
**Location**: `packages/ai-core/src/analysis/attempts.ts:72-76`, `run-python-tool.ts:134-139`
**Issue**: `fixes` never resets after a success, so `exhausted()` can be true for a failure that has had no fix at all.
**Evidence**: Probe P4 (`F S F S F S F`) ended in `attempt-limit` with `fixes: 3`. The last failure was stopped without a single fix, and the learner reads "コードの修正を 3 回まで試しましたが、成功しませんでした". Req 3.3 says "コード実行がエラーで終了した場合 … この修正を最大 3 回まで繰り返す" (per failure). Req 3.4 says "最大修正回数に達してもコード実行が成功しない場合". CL-26 defines a fix as "失敗した実行の次の実行" but is silent on whether the budget is per failure or per analysis. `attempts.test.ts:151` covers only "succeeds on the last fix".
**Confidence**: medium (an interpretation question, but the message is wrong under either reading)
**Fix**: Either count consecutive fixes per failure episode (reset after a success) and bound the total runs with the step limit, or record the cumulative reading explicitly in CL-26 (★, needs confirmation) and change the message to say the analysis-wide budget is used up. Add a test for the alternating sequence.

### [MEDIUM] F-4 Closing a Docker session while a run's container is being created does not stop that run
**Location**: `packages/ai-core/src/sandbox/docker/provider.ts:175-188, 238-246`
**Issue**: `close()` removes only the ids already in `active`. A container whose `createContainer` is still pending is added to `active` after `close` ran, and nothing checks `closed` afterwards, so it is filled, started and waited on.
**Evidence**: Probe P3 gave `closed,created,put,start,wait,remove`, and the run returned a normal result. A disconnect or a `DELETE` (Req 3.7: "破棄する") during the create window leaves the generated code running for up to `executionTimeoutMs` (60 s). The only remaining guard is the `finally` that removes the container at the end. `provider.test.ts:495` covers only a close during `wait`. Also, `close` clears `files` while `run` may be iterating that map, so a container can start without its inputs.
**Confidence**: high (reproduced)
**Fix**: After `createContainer` resolves, and again before `start`, check `closed`. If it is set, remove the container and throw `CLOSED`. Snapshot `files` at the start of `run`. Add a test for the close-during-create window.

### [MEDIUM] F-5 Container stdout is unbounded on the daemon's disk
**Location**: `packages/ai-core/src/sandbox/docker/provider.ts:51-77`
**Issue**: The container spec has no `HostConfig.LogConfig`, so the daemon's default log driver (json-file, no rotation by default) stores everything the code prints. The provider then reads only 16 MiB of it.
**Evidence**: `MAX_LOG_BYTES = 16 * 1024 * 1024` limits only what `engine.logs` reads. Generated code (`while True: print("x"*10**6)`) has up to 60 s to write to `/var/lib/docker/containers/<id>/…-json.log` on the host or VM disk before the timeout removes the container. Memory, PIDs, network and `/tmp` are capped, but not this. The container tests check a 1 MB output, not a flood.
**Confidence**: medium (the default driver is configurable per daemon; Docker Desktop and Rancher keep it in a VM)
**Fix**: Set `LogConfig: { Type: "json-file", Config: { "max-size": "16m", "max-file": "1" } }` (or `local` with the same limits) in `buildSpec`, extend `DockerContainerSpec`, assert it in `provider.test.ts`, and add a container test that floods stdout.

### [MEDIUM] F-6 Docker calls have no timeout, and a pending probe is cached, so a hung daemon would hang every analysis route
**Location**: `packages/ai-core/src/sandbox/docker/engine.ts:98-137` (`send`), `probe.ts:52`, `apps/web/lib/server/platform.ts` (`getSandboxSelection`)
**Issue**: `ping`, `imageExists`, `createContainer`, `putFile`, `start`, `logs` and `remove` send requests with no timeout. `getSandboxSelection` stores the pending promise in the `globalThis` holder and clears it only when it settles.
**Evidence**: `send` has no `timeout` and no signal except for `wait`. A socket that accepts but never answers (Docker Desktop or Rancher during start-up, a paused VM, a socket proxy) makes `probeDockerEnvironment` never settle. Every later `GET /api/analysis/status`, `POST /api/analysis` and `DELETE …/sessions/[id]` then awaits the same pending promise forever. Inside a run, a hung `logs` or `remove` hangs the tool until the 65 s tool timeout, which leads into F-1.
**Confidence**: medium (needs a misbehaving daemon; code path certain)
**Fix**: Give `send` a default timeout (e.g. 2 s for `ping` / `imageExists`, 30 s for the others, none for `wait`, which has its deadline). Make a timed-out probe count as unreachable. Add fake-socket tests for a server that never answers.

### [MEDIUM] F-7 `scripts/check-repo-rules.mjs` was changed to exempt test support from `sandbox-import-scope`, outside every boundary and exception
**Location**: `scripts/check-repo-rules.mjs:649-651, 1263`, `scripts/check-repo-rules.test.mjs:1144-1170`, `specs/003-domain-agents/tasks.md` exceptions (8)/(9)
**Issue**: A governance rule was loosened by path prefix (`tooling/vitest/` as a whole directory, and `packages/ai-core/src/testing/container-only*`). The change is not recorded as a boundary exception, and plan C16 is not updated.
**Evidence**: 20.2 `_Boundary:_` is `` `mise.toml`, `stryker.config.mjs` ``. Exceptions (8)/(9) list network-guard, container-only, requirements.txt, guard.ts, errors.ts, local.ts and the `uploadKindOf` export, but not the rule script. The 20 Implementation Notes describe the exclusion, but that is not where boundary deviations are recorded (W3 put them in (7)). Because `tooling/vitest/` is excluded whole, any future file there can open a Docker socket without the rule noticing.
**Confidence**: high
**Fix**: Add exception (10) for `scripts/check-repo-rules.mjs` and its test, and sync the exclusion into plan C16. Narrow the exclusion to the two exact files (`tooling/vitest/network-guard.ts`, `packages/ai-core/src/testing/container-only.ts`, plus their tests) instead of a directory prefix.

### [LOW] F-8 Table cells and column names have no length limit, so one table can carry megabytes into the stream
**Location**: `packages/ai-core/src/analysis/output-parser.ts:112-160`, `apps/web/lib/server/domain-stream.ts` (`case "table"`)
**Issue**: Rows (200), columns (100), items (10) and the caption (200) are capped, but not a cell string or a column name.
**Evidence**: `isCell` accepts any string. With 200 × 100 cells, one `__TABLE__:` line can be as large as the 16 MiB log read (Docker), and E2B has no stdout cap at all (`execution.logs.stdout.join("")`). Each table is written to the UI stream as-is, and 10 per run are allowed. Req 3.5 only names rows, so this is about robustness, not a requirement breach.
**Confidence**: medium
**Fix**: Cap cell and column-name length (e.g. 1,000 characters, cut with a note) and the serialized size per table. Test both in `output-parser.test.ts`.

### [LOW] F-9 An enabled Docker setup is cached for the process lifetime, so the status route keeps saying `docker` after Docker stops or the image is removed
**Location**: `apps/web/lib/server/platform.ts` (`getSandboxSelection`, `createSandboxSetup`)
**Issue**: Only a `disabled` selection is re-evaluated. Once enabled, the setup never looks again.
**Evidence**: "An enabled setup is built once." When the daemon later stops, `GET /api/analysis/status` still returns `{ kind: "docker" }`, `POST` passes the 503 check, and the failure arrives as F-1. Req 3.8 asks for the disabled display and the guidance when the container runtime is unavailable.
**Confidence**: medium
**Fix**: When `createContainer` reports `provider-unavailable`, or on a periodic ping, drop the cached setup (stopping its sweep) so the next request re-selects. Alternatively, have the status route ping the engine.

### [LOW] F-10 Two in-flight requests with the same `sessionId` share one sandbox: the input file is overwritten, and one abort kills the other run
**Location**: `apps/web/app/api/analysis/route.ts:86-96`, `packages/ai-core/src/sandbox/docker/provider.ts:139, 226`
**Issue**: The registry serializes only `acquire`, so leases overlap. The Docker session keeps one `files` map, and every request writes `data.<kind>` into it.
**Evidence**: Request B's `writeFile("data.csv", …)` replaces A's input, and A's next run copies B's file into its container. Either request's `abort` listener calls `registry.release(sessionId)`, which closes the session under the other. A double-click or a retry from the UI is enough.
**Confidence**: medium
**Fix**: Reject a second in-flight request for the same session (409), or give each request its own file set. Test this in `route.test.ts`.

### [LOW] F-11 No cap on the number of sessions or the bytes they hold; the mock provider keeps every session's files forever
**Location**: `packages/ai-core/src/sandbox/lifecycle.ts:92-101`, `packages/ai-core/src/sandbox/mock.ts:66-67, 84-88`
**Issue**: Every new UUID creates a sandbox and, with Docker, keeps up to 20 MiB in memory for up to 10 idle minutes. With E2B, each one is a billed cloud sandbox for up to 30 minutes. In `mock` mode (the real-server E2E, and any demo started with `AI_RUN_MODE=mock`), `MockSandboxRecord.files` is never cleared on `close`, so memory grows with every request.
**Evidence**: `entries` has no size limit. In `mock.ts`, `close()` sets `closed` and increments `closeCount` but keeps `record.files`. The rate limit applies only in `live` mode.
**Confidence**: medium
**Fix**: Add a maximum number of live sessions (oldest idle evicted, or 503 when full), and clear `record.files` contents on close in the mock (keep only names if tests need them).

### [LOW] F-12 A container that `close` also fails to remove is forgotten silently, and nothing can find leftovers after a crash
**Location**: `packages/ai-core/src/sandbox/docker/provider.ts:238-246`, `buildSpec`
**Issue**: `close` ignores the result of `removeQuietly` and clears `leaked`. Containers carry no label, so a crashed server leaves unnamed, unlabelled containers and volumes.
**Evidence**: `await Promise.all([...active, ...leaked].map((id) => removeQuietly(id)))`, followed by `leaked.clear()`, with no `onWarning`. The research claims "残ったものは `onWarning` で通知して `close` で再度削除する", but a second failure is not reported.
**Confidence**: high
**Fix**: Call `onWarning` for each id still not removed in `close`. Add `Labels: { "agentic-ai.sandbox": "1" }` to the spec, and a `mise run sandbox:clean` task (or a start-up sweep) that removes labelled containers.

### [LOW] F-13 `unreadable` also catches a valid workbook whose probe timed out or ran out of memory, and calls it broken
**Location**: `packages/ai-core/src/analysis/agent.ts:156-163, 118-127`
**Issue**: Any `probe.error` (`TimeoutError`, `Killed`, `MemoryError`) ends the analysis as "ファイルを読み込めませんでした … 壊れていないか". The parameter named `name` receives the exception name.
**Evidence**: The probe uses `options.executionTimeoutMs` and the container memory limit. A large but valid 20 MiB `.xlsx` loaded by `openpyxl` (even `read_only`) can hit either one. `agent.test.ts:320` covers only `BadZipFile`.
**Confidence**: medium
**Fix**: Treat only the libraries' "cannot open" exceptions (`BadZipFile`, `InvalidFileException`, `XLRDError`, `KeyError` from openpyxl) as `unreadable`. Report timeouts and kills separately, or let the loop handle them. Rename the parameter.

### [LOW] F-14 The `.xls` check accepts any OLE2 file that contains the bytes of "Book" in UTF-16LE anywhere
**Location**: `packages/ai-core/src/analysis/upload-check.ts:84-88, 121-125`
**Issue**: `holdsStreamName` searches the whole file, not the OLE2 directory. A Word `.doc` stores its text in UTF-16LE, so one that mentions "Book" passes as `.xls` and reaches the sandbox.
**Evidence**: `Buffer.from(bytes…).includes(encoded)` runs over all 20 MiB. Req 3.9 says "非対応形式である … サンドボックスを起動せずに". The probe would then report it as `unreadable` (it is caught, but only after the sandbox starts).
**Confidence**: medium
**Fix**: Read the OLE2 header's first directory sector (`_sectDirStart`) and match 64-byte directory entry names, or at least restrict the search to directory sectors. Add a `.doc`-renamed test.

### [LOW] F-15 An upload is copied about five times in memory
**Location**: `apps/web/lib/server/upload.ts:48-137`, `packages/ai-core/src/sandbox/docker/provider.ts:226`, `docker/tar.ts:37`
**Issue**: There is the body buffer, then the `FormData` parse, `file.arrayBuffer()`, the session's `bytes.slice()`, and a fresh tar per run. Around 100 MB is live per 20 MiB request.
**Evidence**: See the code. No concurrency limit applies to uploads outside `live`.
**Confidence**: high (code), low (impact for a single learner)
**Fix**: Drop the body reference after parsing, and reuse one tar per file across runs. A streaming multipart parser is optional.

### [LOW] F-16 Plan sync gaps and task status
**Location**: `specs/003-domain-agents/plan.md` (HTTP table, C13), `tasks.md` 19.6, 20.2
**Issue**:
- The `x-analysis-session: released | absent` response header is not in the plan's `DELETE /api/analysis/sessions/[id]` row.
- Task 19.6 orders 429 before `checkUpload`, but the code runs it after the 503 check. The code's order is better and is explained in the Implementation Notes, but the plan does not record it.
- The plan's `getSessionRegistries()` became `getSessionRegistry(name, options)`.
- 20.2 is still `[ ]`, though its `mise.toml` and `stryker.config.mjs` edits are in the tree.

**Evidence**: `git diff HEAD -- specs/003-domain-agents/plan.md` touches only C6, C7, CL-26, the status row and the stream table.
**Confidence**: high
**Fix**: Add the header, the check order and the function name to plan C13 and the HTTP table, and tick 20.2 once its verification is quoted.

### [LOW] F-17 E2B sandboxes keep outbound internet access (prior: CL-21 accepted, handed to 004)
**Location**: `packages/ai-core/src/sandbox/e2b.ts:101-105`, `apps/web/lib/server/platform.ts` (`createE2b({ apiKey })`)
**Issue**: Generated code in an E2B sandbox can send the learner's data out. `e2b.test.ts:82` pins "does not change its network default".
**Evidence**: plan CL-21 and the tasks.md "004 への引き継ぎ事項" record it. Reported for completeness; not counted in the verdict.
**Confidence**: high
**Fix**: None for W4 beyond the existing handoff. Consider passing `allowInternetAccess: false` by default, since nothing in the analysis needs the network.

### [LOW] F-18 E2B and Docker differ in state between runs, and an E2B timeout drops partial output
**Location**: `packages/ai-core/src/sandbox/e2b.ts:128-176`
**Issue**: E2B's `runCode` runs in a persistent kernel, so variables, imports and the matplotlib state survive across runs and across requests of a session. Docker starts a fresh process each run. On an E2B timeout, stdout and stderr are returned empty, while Docker keeps what was printed.
**Evidence**: `resultOfFailedRun` returns `stdout: "", stderr: ""`. The model is told to re-run whole scripts, which mostly hides the difference, but the learner's attempt history differs by provider.
**Confidence**: medium
**Fix**: Document it in the module notes, or restart the E2B kernel context per run so the providers match.

### [LOW] F-19 Weak assertions in two stop tests
**Location**: `apps/web/app/api/analysis/route.test.ts:460`, `packages/ai-core/src/analysis/agent.test.ts:390`
**Issue**: The disconnect test accepts 0 or 1 runs (`toBeLessThanOrEqual(1)`), and the `stopped` test accepts any non-zero number of attempts.
**Evidence**: The abort is triggered inside the first model call, before any `runPython`, so the deterministic expectation is exactly 0 runs. With `maxSteps: 2`, exactly 1 or 2 attempts follows from the scenario.
**Confidence**: medium
**Fix**: Assert the exact counts.

### [LOW] F-20 The tool timeout does not include the Docker set-up time, so a slow create or upload becomes an uncounted tool failure
**Location**: `packages/ai-core/src/analysis/agent.ts:65-90`, `sandbox/docker/provider.ts:175-193`
**Issue**: `toolTimeoutMs = executionTimeoutMs + 5 s`, but the provider starts its `executionTimeoutMs` deadline only after create, archive (up to 20 MiB plus earlier files) and start.
**Evidence**: If set-up takes more than 5 s, the tool times out first. The result is a recoverable tool error that `log.record` never sees, which feeds F-1.
**Confidence**: low (depends on the machine)
**Fix**: Start the provider's deadline before `createContainer`, or widen the margin and count a tool timeout as a failed attempt.

### [LOW] F-21 Disposal on disconnect is immediate, not after the idle period Req 3.7 describes
**Location**: `apps/web/app/api/analysis/route.ts:86-89`
**Issue**: Req 3.7 disposes "接続が途絶えた状態を含むアイドル状態が設定時間（既定 10 分）続いた時点で". The route closes the sandbox at the moment `request.signal` aborts.
**Evidence**: Task 19.6 asks for this ("`request.signal` の abort でサンドボックスを破棄"), and since every request re-sends the file, nothing is lost. It is still a reading of the spec that plan C13 should state. Whether Next.js aborts `request.signal` on a client disconnect during a streamed response was not checked on the real server (research "W4 の実サーバー確認" lists only completed runs).
**Confidence**: low
**Fix**: State the reading in plan C13, and add a real-server check of the disconnect path (or record it as unverified).

## Requirement fidelity (spec 3.1–3.10)

| Req | Status | Notes |
|---|---|---|
| 3.1 | Met, with F-1/F-2 | Code is generated and run only via `runPython`. Status misreports in F-1/F-2. |
| 3.2 | Met | No host execution path found. The Docker spec is as plan C6 (corrected); E2B is cloud. |
| 3.3 | Met for consecutive failures | 4 runs maximum per CL-26 (★). Cumulative counting is in F-3. Infrastructure failures are not counted (F-1). |
| 3.4 | Met | `attempt-limit` carries every attempt with its code (8,000 chars), stderr (20,000) and `errorSummary`. The message is wrong in the F-3 case. |
| 3.5 | Met | Markers are taken out before cutting; PNG signature, 1 MiB, alt 1–200 and 200 rows are checked twice (parser and streamer); no SVG or HTML path. Size robustness is in F-8. |
| 3.6 | Met | `data-analysis-attempt` carries code, stdout, stderr and the error summary, and the result carries `fixes`. |
| 3.7 | Met, with F-4/F-10/F-21 | Idle sweep at 10 min plus 1 ms, `DELETE`, and release on abort. The cross-bundle registry is confirmed on the real server. |
| 3.8 | Met at start-up, with F-9 | Selection goes E2B → Docker (image present) → disabled, with guidance (`sandbox:build`). No re-check after start-up. |
| 3.9 | Met, with F-14 | Order: 413 (declared and received) → form 400 → instruction / session 400 → `checkUpload` 400 → 503 → 429 → model. Tests check that a rejection starts no sandbox and no model. |
| 3.10 | Met | The mock provider answers from fixtures, and the `m3-3` scenarios cover success, fixed and limit. |

## Verified (no finding)

- Secrets: Docker errors keep only `operation` and `status`. E2B messages are fixed text, with tests that the key does not appear. The status route sends only `kind` or `reason`/`guidance`. `console.warn` prints only the container id.
- `assertSandboxFileName` is applied by all three providers and by `putFile`. `SANDBOX_MAIN_FILE` is reserved. The learner's file name never reaches the sandbox path (`data.<kind>`), and it reaches the prompt only after basename, control-character stripping and `JSON.stringify`.
- Parallel `runPython` calls in one step cannot exceed the limit, because `refuseAfterLatch` serializes calls when a latch is set (`aci/tool-set.ts:75-79`).
- The registry has no race between `acquire` / `release` / `sweep`. `inUse` is incremented synchronously before the first await, `release` and `acquire` are serialized per session, and `sweep` skips `inUse > 0`.
- `readUpload` rejects on the declared length before reading, stops reading at the first byte over the cap, and re-checks `file.size`. Unknown fields, duplicate fields and non-file `file` parts are rejected, with no echo of what the client sent.

## Verdict

REQUEST_CHANGES

F-1 is a correctness defect on a normal path: the sandbox becomes unavailable after selection, and the learner is told `succeeded` with nothing executed while tokens are spent. F-2 to F-7 are concrete, reproduced or code-certain issues in the attempt accounting, the Docker lifecycle and resource limits, and one unrecorded loosening of a governance rule. F-17 is inherited (CL-21) and is excluded from the verdict. The isolation design itself (Req 3.2, constitution principle 6) holds.

## Hallucination Signal

forced: false

## Responses (implementer, 2026-10-18)

The verdict was REQUEST_CHANGES. Every HIGH and MEDIUM finding was fixed test-first (RED, GREEN, PROVE); the LOW findings are fixed or deferred below. A fresh re-review of the fixes was not run (same position as W3).

| ID | Response |
|---|---|
| F-1 | Fixed. `runPython` turns a `provider-unavailable` from the session into a fatal `sandbox-unavailable` (new code in the closed vocabulary), so the run ends after one model call with the sandbox's own message and the status `sandbox-unavailable`. PROVE: the two stubs that make it recoverable again or fatal for every `PlatformError` both fail tests. |
| F-2 | Fixed. `succeeded` needs a last run that did not fail; otherwise the status is the new `incomplete` (gave up after an error, or never ran code). Plan C7 and the stream table synced. |
| F-3 | Fixed, and CL-26 rewritten (still ★). The allowance is per failure (a success closes it); `fixes` stays the analysis-wide total for display. The alternating case F S F S F S F is now a test. |
| F-4 | Fixed. A session closed while a container is being made ends the run after the creation (the container is removed, nothing is placed or started); the files are snapshotted at the start of a run. |
| F-5 | Fixed. `LogConfig` json-file `max-size 16m`, `max-file 1` is in the container spec (asserted in the unit test and run against the real engine; a container test floods stdout). |
| F-6 | Fixed. Every Engine call but `wait` has a timeout (3 s for `ping` / `imageExists`, 30 s for the rest); a body cut short by a timeout is a failure. The probe therefore always settles. |
| F-7 | Fixed. The exemption is exactly four files, not directories; recorded as boundary exception (10) and synced into plan C16. |
| F-8 | Fixed. Cells and column names longer than 1,000 characters are cut with an ellipsis (`maxCellCharacters`). |
| F-9 | Fixed together with F-1: on `sandbox-unavailable` the route calls `invalidateSandboxSelection()` (stops the sweep, closes every session), so the next request and the status choose again. |
| F-10 | Fixed. A second request for a session whose analysis is still running is refused with 400 `invalid-request` before the rate limit and before any sandbox work (`registry.isBusy`). |
| F-11 | Fixed. `maxSessions` (8, `DEFAULT_SANDBOX`) evicts the idle session used longest ago, or refuses when all are in use; the mock provider drops its files when a session closes. |
| F-12 | Fixed. `close` reports containers it cannot remove; containers carry the label `agentic-ai.sandbox=1`; `mise run sandbox:clean` removes leftovers. |
| F-13 | Fixed. A probe that hit `TimeoutError`, `Killed`, `MemoryError` or `ExitCode` no longer makes the workbook `unreadable`; the analysis goes on. |
| F-14 | Deferred (accepted limit). A `.doc` that contains "Book" in UTF-16LE passes the `.xls` check and is caught by the probe as `unreadable`, after the sandbox starts. Parsing the OLE2 directory is more than this wave needs. |
| F-15 | Deferred (accepted). About five in-memory copies of a 20 MiB upload; one learner at a time. |
| F-16 | Fixed except the tick of 20.2 / 20.3, done when their verification is quoted. Plan synced: the `DELETE` header, the check order, `getSessionRegistry`. |
| F-17 | Not changed; inherited from CL-21 and in the 004 hand-over. |
| F-18 | Documented only: E2B keeps kernel state between runs and drops partial output on a timeout; Docker does neither. The model is told to send whole scripts, which hides most of it. |
| F-19 | Fixed. The disconnect test asserts exactly 0 runs. |
| F-20 | Fixed. The tool's time margin over one execution is 30 s (it was 5 s), which covers Docker's set-up. |
| F-21 | Reading stated in plan C13 (immediate disposal on disconnect). Whether the real Next.js server aborts `request.signal` on a client disconnect during a stream is **unverified**. |

Evidence after the fixes: `mise run gate` exit 0 (53.5 s; root 419, `@platform/ai-core` 2,778 / 4 skipped, `web` 959); `mise run test:container` 17 passed on the real engine and no container or volume left; `mise run test:e2e` 393 passed (chromium 131, firefox 131, webkit 131); `check:client-bundle` clean.
