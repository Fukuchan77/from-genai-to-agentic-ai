# W1 Non-Vacuous Test Audit: 001-agentic-ai-platform

- Date: 2026-09-27
- Scope: all W1 test files (9) and `specs/001-agentic-ai-platform/pdca/do.md` evidence (Tasks 4.1, 4.2, 4.3, 5.1–5.4, W1 Review Remediation, Re-review Remediation)
- Branch / HEAD: `001-agentic-ai-platform` @ `6cb79eb` (clean)
- Risk trigger: none (manual independent audit). Prior reviews read: `001-agentic-ai-platform-impl-w1-review-2026-09-27.md`, `...-r2.md`, `agentic-ai-platform-4.1.md`.
- Run: `mise run test` -> `Test Files 9 passed (9)`, `Tests 211 passed | 1 expected fail (212)`, reporter `executed=212 passed=212 failed=0 skipped=0` (Turbo cache hit; counts match do.md's final 212).

## Method

1. Read every test file and its target module. Checked that each imports and calls the real module.
2. Grepped for false-green patterns: `.skip` / `.todo` / `.only` / `.fails`, `expect(true`, `toBeDefined` / `toBeTruthy`, `catch` without rethrow, conditional expects, `it.each` over computed lists.
3. Confirmed from the installed runner (`vitest@5.0.2 .../chunks/run.C5UmxDPh.js`) that `test.fails` inverts the result after `afterEach` runs.
4. Ran a probe from `/tmp/vac-audit/probe.mjs` (outside the repo) against `checkRepoRules` to see which error messages come from a zero-scan rejection.
5. Matched every task and file to its RED / GREEN / PROVE entries in do.md.

## Per-file result

| File | Imports real target | False-green scan | PROVE in do.md | Result |
| :-- | :-- | :-- | :-- | :-- |
| `tooling/vitest/setup-hermetic.test.ts` (4.1) | yes (`./setup-hermetic` re-exports `network-guard`) | clean; the `resolve*` list is computed but guarded by `arrayContaining(["resolve4","resolve6"])`; the swallow at L300-305 is deliberate and asserted | yes (4.1 x3, 4.1 remediation x4, Fix C H-3/H-7/M-14/L-11) | PASS (LOW notes) |
| `tooling/vitest/hermetic-registration.test.ts` (M-4/H-7) | yes (`./network-guard`; registration through `setupFiles`) | one `it.fails` (L29), legitimate | yes (`setupFiles: []` -> both fail; afterEach removed -> `Expect test to fail`) | PASS |
| `tooling/vitest/gate-reporter.test.ts` (4.3) | yes | clean; `it.each` lists are literal and non-empty | yes (4.3 x5, M-11 x6) | PASS (LOW note) |
| `tooling/vitest/global-setup-local.test.ts` (4.2/H-3/M-8) | yes | clean; injected `fetch` / `provide` are the interface, and assertions check real return values | partial (3 mutants on the permanent file; the 4.2 PROVE ran on a deleted temporary test) | PASS (LOW gap) |
| `scripts/lib/cli.test.mjs` (M-7/L-4) | yes | clean | yes (`realpathSync` identity, `dist` removal) | PASS |
| `scripts/check-model-ids.test.mjs` (5.1) | yes | constant-mirror assertion L149-170; source-text test L269-274 | yes (5.1 summary + H-2/M-1/L-2/L-4/M-7 x12 + N-1) | FLAG (LOW / MEDIUM) |
| `scripts/check-repo-rules.test.mjs` (5.2) | yes | substring message assertions match the zero-scan text (L53, L55-57, L99-107); 9x `resolves.toBeDefined()` | yes for H-6 / M-2 / M-3 / M-5 / M-6 / M-13 / L-1 / L-3 / L-4; none for `ai-core-no-ui-deps`, zero-scan, or checker self-exclusion | FLAG (MEDIUM) |
| `scripts/check-updates.test.mjs` (5.3) | yes | source-text test L204-211 | yes (5.3 x1, L-6 x4); none for the 24h cutoff or `isAiV7Compatible` | FLAG (LOW / MEDIUM) |
| `scripts/gate/count.test.mjs` (5.4) | yes | source-text test L133-142 | yes (5.4 x4 as a summary without messages; H-1 x4 with named tests) | FLAG (MEDIUM, shared CLI finding) |

No CRITICAL suspected-vacuous test was found. No `.skip` / `.todo` / `.only`, no `expect(true)`, no empty bodies, no zero-case `each`, and no unconditional swallowed exceptions.

## Expected-fail judgement

`tooling/vitest/hermetic-registration.test.ts:29` `it.fails("fails a test that swallows a NetworkBlockedError")` is **legitimate**.

- The body swallows a blocked `fetch`. The only failure source is the `afterEach(assertNoUnconsumedBlockedConnections)` in `setup-hermetic.ts:21-23`.
- In Vitest 5.0.2 the `fails` inversion runs after `test.afterEach` (`run.C5UmxDPh.js`: afterEach, then `if (test.fails) { if (state === "pass") ... "Expect test to fail" }`), so a hook failure counts.
- do.md records a PROVE: afterEach removed -> `Error: Expect test to fail`; `setupFiles: []` -> fails.
- `assertNoUnconsumedBlockedConnections` clears the record (asserted in `setup-hermetic.test.ts:311-312`), so nothing leaks into the next test.
- Residual weakness: see LOW "it.fails accepts any failure".

## Critique

### [MEDIUM] Substring message assertions also match the zero-scan rejection
**Location**: scripts/check-repo-rules.test.mjs:53, 55-57, 99-107 (via `expectViolation` at L24-27)
**Issue**: `rejects.toThrow("eval")` and `rejects.toThrow("risk")` pass on any rejection of those rules, including `scanned 0 FILES`, because the rule names `no-dynamic-eval` and `tool-risk-declared` are in every error message.
**Evidence**: Probe output: `tool-risk-declared "tool-risk-declared: scanned 0 FILES\ntool-risk-declared: scanned 0 FILES"` and `no-dynamic-eval "no-dynamic-eval: scanned 0 FILES..."`. The RepoRuleError message is `${output}\n${failures}` (check-repo-rules.mjs:1045-1054), and `output` always holds `<rule>: scanned N FILES`.
**Confidence**: high
**Fix**: Assert the violation text: `"dynamic eval is forbidden"` for L53, `"defineAciTool call must declare risk"` for L55-57 and L99-107. A simpler option is to make `expectViolation` also assert `error.result.reports[0].fileCount > 0` and `violations.length > 0`. Detection is also covered by other tests (L373-377, L523-531), so this is not vacuous. The top-level-risk boundary case (L99), though, cannot tell a detection from a moved scan target.

### [MEDIUM] Gate CLI exit-code paths have no automated test; entry-point tests only grep source text
**Location**: scripts/gate/count.test.mjs:133-142, scripts/check-model-ids.test.mjs:269-274, scripts/check-updates.test.mjs:204-211; targets: scripts/check-model-ids.mjs:246-249, scripts/check-repo-rules.mjs:1059-1066, scripts/gate/count-biome.mjs:37-45, scripts/gate/count-tsc.mjs:73-81
**Issue**: The gate depends on these CLIs setting `process.exitCode = 1` on violations or zero counts. No test runs `run()` / `runCli()` / `main()`. Deleting `if (result.violations.length > 0) process.exitCode = 1;` passes every test, which is the "gate script exits 0" fake-pass class. The `isMainModule` tests only check that a string is present, so dead code or a commented-out copy would satisfy them.
**Evidence**: `expect(source).toContain("if (isMainModule(import.meta.url))"); expect(source).not.toContain("process.argv[1]");`. No test file references `runCli`, `run(`, `main(`, or `exitCode`. do.md has only manual runs ("zero-count input exit 1", Task 5.5 gate PROVE with `tool-risk-declared`). (prior: M-7 resolved; the source-text form of the fix was not challenged.)
**Confidence**: high
**Fix**: Export the CLI bodies with injected `{ stdin, stdout, stderr, setExitCode, argv }`, the same way `GateReporter` does. Then test in-process that a violation, a zero count, or a thrown error sets exit code 1 and a clean run does not. This avoids `child_process`, which `no-dynamic-eval` forbids in `scripts/`. Keep `isMainModule` behaviour covered by `cli.test.mjs`.

### [MEDIUM] PROVE gaps in check-repo-rules for rules and invariants outside the remediation mutants
**Location**: scripts/check-repo-rules.test.mjs:45-52, 89-97, 109-118 (ai-core-no-ui-deps, guarded-agent-only allow-path), 149-158 (checker self-exclusion), 160-169 (scan targets / extensions), 171-176 (zero-scan failure), 178-185 (FILE count output), 133-147 (scan-semantics negatives)
**Issue**: do.md's Task 5.2 PROVE covers only the `eval` branch and the risk-depth coordinator case. The Fix A PROVE list has no mutant for `ai-core-no-ui-deps` (package.json or source import), the `guarded-agent-only` allow-path, `CHECKER_FILES` exclusion, the `fileCount === 0` failure, or the string/comment/regex exclusions in the scan-semantics test.
**Evidence**: The Fix A PROVE list (do.md ~L1447-1477) names H-6, M-2, M-3, M-5, M-6, M-13, L-1, L-3, L-4, and M-7 only. Task 5.5 PROVE shows the gate fails on a zero-file rule, but that proves the mise wiring, not that this unit test catches a removed `fileCount === 0` branch.
**Confidence**: high (evidence absent); medium on impact (these rules are wired in W2/W3; the zero-scan invariant is W1)
**Fix**: Before W2 wiring, record PROVE for: removing the `fileCount === 0` failure (expect L171-176 to fail), emptying `CHECKER_FILES` (L149-158), skipping `package.json` deps or source imports in `ai-core-no-ui-deps`, and exempting every file in `guarded-agent-only`.

### [LOW] check-model-ids zero-scan guard has no recorded PROVE; the original 5.1 PROVE has no failure messages
**Location**: scripts/check-model-ids.test.mjs:94-101; scripts/check-model-ids.mjs:230
**Issue**: The non-empty-scan invariant (constitution: deterministic non-vacuous gate) is tested, but no mutant of `files.length === 0` is recorded. The 5.1 PROVE entry is a summary ("対応する4テストの失敗") without test names or messages.
**Evidence**: do.md L1198: `許可場所・既定値・コメント除外も個別に無効化し、対応する4テストの失敗を確認後に復元。` The remediation PROVE list (~L1560-1572) has no zero-scan mutant.
**Confidence**: high
**Fix**: Run and record: remove the throw -> `fails when no eligible files are scanned` fails.

### [LOW] Constant-mirror assertion on MODEL_ID_PREFIXES; six families have no behavioural test
**Location**: scripts/check-model-ids.test.mjs:149-170; scripts/check-model-ids.mjs:50-59
**Issue**: The test restates part of the exported list (tautological). `mixtral`, `codestral`, `deepseek-`, `jamba-`, `nova-`, and `snowflake-arctic-embed` are in neither the list assertion nor any fixture, so deleting them passes all tests.
**Evidence**: The `arrayContaining` list omits those six prefixes. No fixture contains `mixtral`, `codestral`, `deepseek`, `jamba`, `nova-`, or `snowflake`.
**Confidence**: high
**Fix**: Replace the list assertion with a table-driven detection test covering one ID per family, for example `it.each(MODEL_ID_FAMILIES)`, with a literal sample-ID map that fails when a family has no sample.

### [LOW] `resolves.toBeDefined()` on negative cases does not pin what was scanned
**Location**: scripts/check-repo-rules.test.mjs:144-146, 285, 428, 459, 466, 509, 598
**Issue**: `toBeDefined()` on a resolved result always holds. The real check is non-rejection, which works only because `checkRepoRules` rejects on any violation or zero scan. It does not prove the fixture file under test was scanned. For example, at L285 `mise.toml` keeps `fileCount >= 1` even if the workflow file were dropped from the scan.
**Evidence**: `await expect(run(root, "frozen-lockfile")).resolves.toBeDefined();`. A PROVE exists for L285 (M-2 run-only), but the assertion form stays weak.
**Confidence**: medium
**Fix**: Use `resolves.toMatchObject({ reports: [{ fileCount: <exact>, violations: [] }] })`, as L155 and L274 already do.

### [LOW] check-updates: the 24h cutoff and range parser lack PROVE; positive report branches are not asserted
**Location**: scripts/check-updates.test.mjs:69-86, 88-112, 114-139; scripts/check-updates.mjs:64-100, 107-109, 184-194
**Issue**: `isAiV7Compatible` has hyphen, x-range, `~`, `*`, `latest`, and comparator branches, but only 4 inputs are tested. The `publishedAt <= cutoff` boundary and non-OK HTTP responses have no recorded PROVE. The `formatUpdateReport` lines for "newer eligible ..." and "ai@^7 compatible release(s) ..." are never asserted.
**Evidence**: The 5.3 PROVE covers only `newerEligible = undefined`. The L-6 PROVE covers stable, signal, and TimeoutError. No test covers a 404 response or `formatUpdateReport` with `newerEligible` set.
**Confidence**: high
**Fix**: Add cases for `"7.x"`, `"~7.0.0"`, `"6.0.0 - 7.2.0"`, `"<7"` (false), `">=8"` (false), a non-OK fixture, and a report with a newer build and a compatible watsonx version. Record PROVE for changing `<=` to `<` at the cutoff.

### [LOW] Vitest reporter registration has no regression guard
**Location**: vitest.config.ts:29 (`reporters: ["default", "./tooling/vitest/gate-reporter.ts"]`)
**Issue**: `hermetic-registration.test.ts` guards `setupFiles` registration (M-4), but nothing guards the reporter. Removing it silently disables the "all tests skipped -> exit 1" gate rule, and every test still passes.
**Evidence**: The GateReporter tests construct the class directly, and no test loads `vitest.config.ts`. do.md 4.3 has one manual integration probe.
**Confidence**: medium
**Fix**: Add a config test that imports `vitest.config.ts` and asserts that `test.reporters` contains the gate reporter path, and that `passWithNoTests` is false for the gate suite. Otherwise, cover this with a `docs:check` / `check:repo-rules` rule.

### [LOW] it.fails accepts any failure
**Location**: tooling/vitest/hermetic-registration.test.ts:29-35
**Issue**: The expected-fail test passes on any failure (for example a timeout or a thrown error from a broken hook), not only on the unconsumed-block assertion.
**Evidence**: `it.fails(...)` with an empty-effect body. The message itself is pinned separately in setup-hermetic.test.ts:308-310.
**Confidence**: low
**Fix**: Acceptable as is. To tighten it, use `onTestFailed` inside the test to record `result.errors[0].message` and assert it in a following test, or keep the pair and document it.

### [LOW] global-setup-local: the permanent tests inherit PROVE from a deleted temporary test
**Location**: tooling/vitest/global-setup-local.test.ts:113-238
**Issue**: The Task 4.2 PROVE ran against `tooling/vitest/.task-4-2.test.ts`, which was deleted. For the permanent file, only 3 mutants are recorded (`/api` strip, `readJson` throw, `withDefaultTag`). The non-local short-circuit, invalid URL, HTTP error, connection failure, and `provide` key tests have no PROVE against the permanent file.
**Evidence**: do.md L1039 `Temporary test: tooling/vitest/.task-4-2.test.ts（Task 4.2完了時に削除）`; Fix C H-3/M-8 PROVE lists 3 breaks.
**Confidence**: high (evidence), low (impact; the assertions read as sound)
**Fix**: Re-run the two 4.2 mutants (fixed `available` result; provide key `brokenAvailability`) on the permanent file and record the failing test names.

### [LOW] Minor PROVE gaps in setup-hermetic and cli
**Location**: tooling/vitest/setup-hermetic.test.ts:278-284, 286-298, 315-321, 62-86; scripts/lib/cli.test.mjs:36-47
**Issue**: No recorded mutant for: "keeps the default Ollama origin blocked outside local mode", the trailing-slash `OLLAMA_BASE_URL` each-cases, the one-shot semantics of `consumeBlockedConnections`, per-form `Socket.connect` parsing (only a blanket `push` removal is recorded), and the negative `isMainModule` cases.
**Evidence**: The do.md 4.1 and Fix C PROVE lists do not name these tests.
**Confidence**: medium
**Fix**: Optional. Add one mutant each when these areas next change.

### [LOW] gate-reporter tests use a hand-built TestModule fake
**Location**: tooling/vitest/gate-reporter.test.ts:14-28
**Issue**: The fake's shape (`children.allTests()`, `options.mode`, `result().state/note`) is cast with `as unknown as TestModule`, so drift from the real Vitest 5 API would not surface in these tests.
**Evidence**: `} as unknown as TestModule;`. The real shape is exercised only by the live gate run (`executed=212`) and the manual all-skipped probe in do.md 4.3.
**Confidence**: low
**Fix**: Optional. Add one `satisfies`-typed partial, or run a nested Vitest invocation in the pg/local unit later.

### [LOW] `global-setup-local.ts` is not registered as `globalSetup`
**Location**: vitest.config.ts (no `globalSetup`)
**Issue**: The availability provider is unit-tested but not wired, so `*.local.test.ts` skip-with-reason behaviour has no consumer test yet.
**Evidence**: do.md L1020 defers the consumer test to Task 11.2.
**Confidence**: low (planned deferral)
**Fix**: Informational. Make sure Task 11.2 adds the `globalSetup` entry and a consumer test with PROVE.

## PROVE / execution evidence matrix

| Task / file | RED | GREEN count | PROVE (break + failure) | Gaps |
| :-- | :-- | :-- | :-- | :-- |
| 4.1 setup-hermetic | yes | 7 -> 9 -> 20 tests | yes, with messages | minor (LOW above) |
| 4.2 / H-3 global-setup-local | yes | 32 | yes on permanent file (3); earlier PROVE on deleted temp file | LOW above |
| 4.3 gate-reporter | yes | 7 -> 13 | yes (5 + 6) | none material |
| 5.1 check-model-ids | yes | 5 -> 13 | yes (remediation, named tests); original is a summary | zero-scan guard |
| 5.2 check-repo-rules | yes | 19 -> 96 -> 100 | yes (29 named mutants) | ai-core-no-ui-deps, zero-scan, self-exclusion, allow-path, scan-semantics |
| 5.3 check-updates | yes | 4 -> 8 | yes (1 + 4) | cutoff, range parser, report branches |
| 5.4 count | yes | 4 -> 9 -> 11 | yes (4 summary + 4 named) | CLI exit path (MEDIUM above) |
| cli (M-7 / L-4) | yes | 13 | yes (2) | negative cases (minor) |
| hermetic-registration (M-4 / H-7) | yes | 2 (1 expected fail) | yes (2, loopback re-run in N-3) | none |

Execution evidence (collected-count delta or named tests) exists for every file. The totals go 48 -> 208 -> 212 and match the current run (211 passed + 1 expected fail).

## Verdict
APPROVE_WITH_NOTES

## Hallucination Signal
forced: false
