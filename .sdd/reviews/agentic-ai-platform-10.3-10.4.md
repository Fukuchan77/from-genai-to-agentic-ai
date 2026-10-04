# Adversarial Review: Task 10.3 / 10.4 (+ shared `ports/abort.ts`) - remediation after `/sdd-ship` NO-GO

- Date: 2026-09-28
- Scope: `packages/ai-core/src/ports/{abort,transcript,web-search,index}.ts`, `transcript.test.ts`, `web-search.test.ts` (clock/http read for context)
- Inputs: spec.md Req 2.15 / 4.11 / 5.7, plan.md C10 + Constitution Compliance row 5, tasks.md section 10 (working-tree diff), constitution section 5, do.md remediation entry, installed `youtubei.js@18.1.0` and `@tavily/core@0.7.13` sources
- Prior reviews: none of `.sdd/reviews/*` cover C10/ports, so no inherited decisions

## Evidence gathered

- `vitest run src/ports --coverage.enabled=false`: 4 files, 21/21 passed (`Gate test summary: executed=21 passed=21 failed=0 skipped=0`).
- Coverage run for `src/ports/**` only (report written to `/tmp`): `abort.ts` lines 80% (uncovered 15-16, the reject branch), `transcript.ts` lines 93.18% / branches 81.81% (uncovered 94, 136-137), `web-search.ts` lines 100% / branches 88.88%.
- A throwaway probe under `/tmp/rv1034/` built **real** youtubei.js parser instances (`TranscriptSegment` from `runs`, `TranscriptSectionHeader`, `Text`, and `observe()` ObservedArray) plus a class that has a prototype getter `selectedLanguage` and a `#private` field, then ran the exact `transcriptInfoSchema` on them. Result: `success: true`. The prototype getter is read, `Text.text` undefined (`snippet: {}`) is accepted, the header is kept with no `target_id`, and `content: null` is accepted. `transcript: undefined` is rejected.
- Tavily SDK `_search` (`@tavily/core/dist/index.mjs` 212-311) destructures the known options, gathers the rest into `kwargs`, and spreads `kwargs` into the POST body passed to `axios.post(url, body, config)`. It never passes `signal` to axios.

## Risk trigger resolution

1. **Boundary (`abort.ts` added)**: explained away, with a LOW residual. The parent Task 10 `_Boundary:_` and the 10.3 sub-boundary now list `ports/abort.ts`. `index.ts` does not re-export it, so it stays internal. Two gaps remain: plan.md File Structure Plan (lines 638-646) has no row for it, and the 10.4 sub-boundary does not list it even though `web-search.ts` imports it (finding L-1).
2. **Dependencies**: confirmed clean. Only `zod` (already `4.6.5` in `packages/ai-core/package.json`), `youtubei.js`, and `@tavily/core` are imported, and all three are declared. No new third-party package.
3. **Test integrity (stub `snippet: { toString }` -> `{ text }`)**: explained away. Real `Text` has an own `text?: string` field, set in the constructor from `runs` or `simpleText`, and `toString()` is on the prototype. The old stub only mimicked `toString` and lacked the field real code would read, so it was the less faithful stub. The new stub matches the real object, and the probe confirms the schema accepts real instances. The implementation was not bent to fit the stub. One residual gap: the stubs are all plain objects, and no test covers `content: null` or zero segments (finding M-2).
4. **Non-vacuous**: mostly confirmed. do.md has PROVE rows for every new test, including a recorded vacuous-test catch and its fix (`snippet: { text: 42 }`). Expected values trace to the requirement or the youtubei shape: ms -> seconds, the header excluded, the Req 4.11 reasons. They are not copied from the implementation's output. Gaps: the `segments.length === 0 -> no-captions` branch and the `login_required` branch have no test, so deleting either mutant goes undetected (M-2). The Tavily signal test asserts a contract the real SDK does not honor (H-1).
5. **Requirement fidelity / `this` binding**: the `this` binding is confirmed preserved. `createInnertubeClient` returns `innertube.getInfo(videoId)` unchanged. `raceWithAbort` resolves with that same `VideoInfo`, which is not a thenable, so it is not unwrapped. `info.getTranscript()` is a member call, so `this === VideoInfo` and `this.page` / `this.#actions` resolve. Zod reads `selectedLanguage` from the original `TranscriptInfo`, so the getter's `this` is correct too. Constitution section 5 is now met for both external responses. The fidelity issues are elsewhere: H-1, M-1, M-3.

## Critique

### [HIGH] The caller's AbortSignal is sent to the Tavily API as a JSON body field and never aborts the HTTP request
**Location**: packages/ai-core/src/ports/web-search.ts:46 (with web-search.test.ts:71-88)
**Issue**: The production `tavily({ apiKey })` client does not accept a `signal` option, so `{ signal }` falls into `kwargs` and is serialized into the POST body sent to Tavily as `"signal":{}`. The underlying request is never cancelled. The test only proves that the injected stub received `signal`.
**Evidence**: `web-search.ts:46` `client.search(query, signal ? { signal } : {})`. In `@tavily/core/dist/index.mjs`, `const _a = options, { searchDepth, ... clientName } = _a, kwargs = __objRest(_a, [...])` is followed by `post("search", __spreadValues({ query, search_depth: ..., filter_by_language: filterByLanguage }, kwargs), callConfig, requestTimeout)` and `axios.post(url, body, config)`. The `config` has no `signal`. The tasks.md note says "signal を注入 client へ渡しつつ", which assumes the SDK ignores the field.
**Confidence**: high that the field is serialized into the body. Medium on the upstream effect: Tavily may ignore unknown fields or return 400/422 on every signalled search.
**Fix**: Do not forward `signal` to the real SDK. Build the production adapter as `{ search: (q) => sdk.search(q, {}) }` and keep only `raceWithAbort` for caller-side cancellation. Alternatively, map the signal to a supported option such as `timeout`. Change the test to assert what the port promises (the caller's rejection), plus a unit test of the production adapter that shows no `signal` key reaches the SDK options.

### [MEDIUM] A failed `Innertube.create()` is cached for the life of the process
**Location**: packages/ai-core/src/ports/transcript.ts:144-150
**Issue**: `clientPromise ??= createClient()` stores a rejected promise permanently. After one transient network failure during session creation, every later `fetchTranscript` fails with `fetch-failed` until the process restarts. `lib/server/platform.ts` builds the port once per server.
**Evidence**: `let clientPromise: Promise<YoutubeClient> | undefined;` ... `clientPromise ??= createClient(); const client = await raceWithAbort(clientPromise, signal);` Nothing resets `clientPromise` when it rejects.
**Confidence**: high
**Fix**: Clear the cache when creation fails, e.g. `clientPromise = createClient().catch((e) => { clientPromise = undefined; throw e; })`. Add a test where the first `createClient` rejects and the second call succeeds.

### [MEDIUM] The `no-captions` paths for an empty transcript body and for zero segments are untested, as is the `login_required` path
**Location**: packages/ai-core/src/ports/transcript.ts:159-160, 100-102; transcript.test.ts:57-62
**Issue**: Two Req 4.11 branches have no test, so deleting either one leaves the suite green. The first is the youtubei response with `content: null` / `body: null` / `initial_segments: []`, or only section headers, which the implementation maps to `no-captions`. The second is the `login_required` -> `private` mapping.
**Evidence**: The only `no-captions` case is `["no-captions", new Error("Transcript panel not found. Video likely has no transcript.")]`. No fixture sets `content: null` or an empty `initial_segments`. The schema's `.nullish()` on `content` / `body` exists to handle exactly these shapes (`Transcript.content: TranscriptSearchPanel | null`, `TranscriptSearchPanel.body: TranscriptSegmentList | null`). Branch coverage for `transcript.ts` is 81.81%. The do.md PROVE table has no row for either branch.
**Confidence**: high
**Fix**: Add `it.each` cases: `content: null`, `body: null`, `initial_segments: []`, and headers only, each expecting `reason: "no-captions"`. Add a `new Error("LOGIN_REQUIRED")` case (or an InnertubeError-like `{ info: { status: "LOGIN_REQUIRED" } }`) expecting `private`. PROVE each by deleting its branch.

### [MEDIUM] A private video that youtubei reports through `playability_status` (not by throwing) will be classified `no-captions` or `fetch-failed`, not `private`
**Location**: packages/ai-core/src/ports/transcript.ts:27-30, 152-153
**Issue**: `MediaInfo` throws only when `playability_status.status === 'ERROR'`. A `LOGIN_REQUIRED` / "This video is private" status returns normally, and `basic_info` is spread from `info.video_details`, which is typically absent for private videos. So `is_private` is `undefined` and the port goes on to `getTranscript()`, which fails with "... Video likely has no transcript." and maps to `no-captions`. Req 4.11 requires the reason shown for 非公開 to be distinct.
**Evidence**: `MediaInfo.js:29` `if (info.playability_status?.status === 'ERROR') throw new InnertubeError('This video is unavailable', info.playability_status);` builds `this.basic_info = { ...info.video_details, ... }`, and line 62 sets `this.playability_status = info.playability_status;`. The port validates only `basic_info.{title,is_private}` and never reads `playability_status`.
**Confidence**: medium. It depends on the live YouTube response shape for private videos, which was not observed.
**Fix**: Validate `playability_status: z.object({ status: z.string(), reason: z.string().optional() }).optional()` with Zod. Map a private or login-required status to `private` before calling `getTranscript()`, and add a stub test for it. Keep age-restriction login prompts from being mislabeled.

### [LOW] Unsupported Tavily SDK failures (401 / 429 / timeout / network) escape as raw `Error`, not `PlatformError("source-unavailable")`
**Location**: packages/ai-core/src/ports/web-search.ts:46
**Issue**: Only schema failures are wrapped. SDK rejections pass through as-is, unlike the transcript port, which closes every failure into `TranscriptSourceError`. Consumers therefore see two error vocabularies from the same port.
**Evidence**: `const raw = await raceWithAbort(client.search(...), signal);` has no try/catch. The SDK throws `new Error("An unexpected error occurred while making the request. Error: ...")` and handler-specific errors.
**Confidence**: medium that C9's tool layer may be intended to handle this. The plan does not state that it does.
**Fix**: Wrap non-abort SDK rejections in `PlatformError("source-unavailable", ..., { provider: "tavily", cause: message })`, rethrow `signal.reason` when aborted, and add a test.

### [LOW] `failureText` can throw inside the catch handler, and the substring "private" matches unrelated errors
**Location**: packages/ai-core/src/ports/transcript.ts:89-104
**Issue**: `JSON.stringify(cause.info)` runs inside the catch path. A circular or BigInt-bearing `info` makes it throw a raw `TypeError` that is not a `TranscriptSourceError`. Separately, any message containing "private" maps to `private`. That includes the JS engine's own "Cannot read private member #page from an object whose class did not declare it" (a lost-`this` bug) and a stringified info with an `is_private` key.
**Evidence**: `const details = "info" in cause ? JSON.stringify(cause.info) : "";` and `if (text.includes("private") || ...) return "private";`
**Confidence**: low (no current youtubei path produces a circular `info`)
**Fix**: Wrap the stringify in try/catch, or read only `cause.info?.status` / `cause.info?.reason` through a small Zod schema. Match specific phrases such as "this video is private" or a `LOGIN_REQUIRED` status rather than the bare word.

### [LOW] The segment timing schema accepts any string, and bad timings are silently dropped, which can turn corrupt data into `no-captions`
**Location**: packages/ai-core/src/ports/transcript.ts:34-35, 115-117
**Issue**: `start_ms: z.string()` accepts `""` (`Number("") === 0`) and `"abc"`. Non-finite or inverted timings are dropped instead of failing validation. If every segment is malformed, the result is `no-captions` rather than the `fetch-failed` the remediation criteria set for malformed responses.
**Evidence**: `start_ms: z.string(), end_ms: z.string(),` ... `if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return [];`. do.md success criterion 2 says a malformed youtubei response "は `TranscriptSourceError("fetch-failed")` で失敗し、`no-captions` や `private` に誤分類されない".
**Confidence**: medium
**Fix**: Use `z.string().regex(/^\d+$/)` (or `z.coerce.number().int().nonnegative()` on a digit string), with a refine for `end >= start` on real segments, so malformed timings reach `fetch-failed`. Add a test.

### [LOW] `target_id` presence is a heuristic header discriminator; youtubei exposes an explicit `type`
**Location**: packages/ai-core/src/ports/transcript.ts:113-114
**Issue**: Real parser nodes carry an own `type` property (`'TranscriptSegment'` / `'TranscriptSectionHeader'`). The probe shows own keys `type, start_ms, end_ms, snippet, start_time_text, target_id`. The code instead drops any item without `target_id`, so if YouTube stops sending `targetId`, every real segment is dropped and reported as `no-captions`.
**Evidence**: `if (!item.target_id || !item.snippet.text) return [];`, and `TranscriptSegment.js` sets `this.target_id = data.targetId;` with no default.
**Confidence**: low
**Fix**: Validate `type: z.literal(["TranscriptSegment", "TranscriptSectionHeader"])`, or a discriminated union on `type`, and filter on `type === "TranscriptSegment"`. Update the stubs to carry `type`.

### [LOW] One non-http result rejects the whole Tavily result set
**Location**: packages/ai-core/src/ports/web-search.ts:18-28
**Issue**: `z.array(z.object({ url: z.url({ protocol: /^https?$/ }) ... }))` makes a single bad hit fail the entire search with `source-unavailable`, discarding valid hits. That is a design choice the plan does not record.
**Evidence**: The test case `"non-http url"` expects a rejection of the whole response.
**Confidence**: low (this could be the intended strictness)
**Fix**: Either document the fail-closed choice in the tasks.md Implementation Notes, or validate the envelope strictly and filter out invalid items with the dropped count in details.

### [LOW] Boundary bookkeeping is incomplete for `abort.ts`
**Location**: specs/001-agentic-ai-platform/tasks.md (10.4 `_Boundary:_`); specs/001-agentic-ai-platform/plan.md:638-646
**Issue**: `web-search.ts` (Task 10.4) imports `./abort`, but the 10.4 sub-boundary does not list it. plan.md's File Structure Plan also has no `ports/abort.ts` row. Only tasks.md was updated.
**Evidence**: The 10.4 `_Boundary:_` is `web-search.ts, web-search.test.ts, index.ts`, and plan.md lists only clock/http/transcript/web-search/index under `ports/`.
**Confidence**: high
**Fix**: Add `ports/abort.ts` to the 10.4 sub-boundary and a plan.md File Structure row ("internal abort race shared by transcript / web-search; not exported"). Optionally add `abort.test.ts` to cover the reject-side cleanup (lines 15-16) and the pre-aborted path directly.

## Verdict
REQUEST_CHANGES

## Hallucination Signal
forced: false

---

## Re-review (round 2)

- Date: 2026-09-28
- Inputs: the current `packages/ai-core/src/ports/{abort,transcript,web-search}.ts` and their tests, the working-tree diffs of `tasks.md` / `plan.md` / `pdca/do.md`, and youtubei.js `parser/parser.js` 272-283 (`playability_status` construction)
- Independent evidence:
  - `vitest run src/ports` with coverage: 4 files, **34/34 passed** (`executed=34 passed=34 failed=0 skipped=0`). Coverage is `transcript.ts` lines 96% / branches 89.13% (uncovered 147-148, the production `Innertube.create` adapter), `web-search.ts` lines 100% / branches 92.3% (uncovered 60, a non-`Error` SDK rejection), and `abort.ts` lines 80% (uncovered 15-16).
  - `tsc -p packages/ai-core/tsconfig.json --noEmit`: clean.
  - `biome ci packages/ai-core/src/ports`: 10 files, no issues.
  - I did not re-run the full `mise run gate` myself. The coordinator reports exit 0 with ai-core `executed=44 passed=44`.
- PROVE: do.md "Round 1 修正の RED / GREEN / PROVE" records a break and the observed failure for each new test, plus a `cmp` restore.

### Per-finding resolution

| ID | Round-1 finding | Status | Evidence |
|---|---|---|---|
| H-1 | `signal` serialized into the Tavily request body | **Resolved** | `web-search.ts:38-43` `createSdkClient` returns `{ search: (query) => sdk.search(query) }`, so the SDK gets no options. The test `keeps the AbortSignal out of the real Tavily SDK request options` module-mocks `@tavily/core`. It asserts `tavily` was called with `{ apiKey: "sdk-key" }` and `sdkSearch` with exactly `("real sdk")`, which is load-bearing because a second argument would fail `toHaveBeenCalledWith`. Caller-side abort still goes through `raceWithAbort` (line 55). The side effect that the SDK HTTP request is not cancelled is recorded in the tasks.md Implementation Notes. |
| M-1 | Rejected `Innertube.create()` cached forever | **Resolved** | `transcript.ts:161-164` `.catch` resets `clientPromise = undefined` and rethrows. Test `retries client creation after a failed attempt` expects `fetch-failed`, then success, with `createClient` called twice. A synchronous throw from an injected non-async `createClient` leaves `clientPromise` undefined, which is also correct. |
| M-2 | No test for the empty `no-captions` responses or the private classification | **Resolved** | `it.each` covers `content: null`, `body: null`, `initial_segments: []`, and headers only, each mapping to `no-captions`. PROVE deleted the `segments.length === 0` check and all 4 failed. Error-path cases cover `info.reason` "This video is private" → `private` and "LOGIN_REQUIRED: Sign in to confirm your age" → `fetch-failed`. |
| M-3 | Private videos reported through `playability_status` | **Resolved** | `playabilityStatusSchema` (`status: z.string(), reason: z.string().optional()`, whole object optional) matches youtubei's construction `{ status: data.playabilityStatus.status, reason: data.playabilityStatus.reason \|\| '', ... }`, where `reason` is always a string. The check runs before `getTranscript()` (`transcript.ts:168-171`). The test asserts `private` and that `getTranscript` was not called. The live YouTube wording is still unobserved (see R2-L-2). |
| L-1 | Raw SDK errors escaped | **Resolved** | `web-search.ts:54-62` wraps them in `PlatformError("source-unavailable", …, { provider: "tavily", cause })` and rethrows `signal.reason` when aborted. The 429 test asserts both `code` and `details.cause`. |
| L-2 | `JSON.stringify` in the catch handler; bare "private" match | **Resolved** | `failureText` reads only `info.{status,reason}` via `errorInfoSchema.safeParse`. `isPrivateText` is `/\b(video is private\|private video)\b/`. Tests cover a circular `info` → `fetch-failed` (PROVE: reverting to stringify gives `TypeError: Converting circular structure`) and "Cannot read private member #page" → `fetch-failed`. |
| L-3 | Lax timing schema | **Resolved, one sub-part untested** | `z.string().regex(/^\d+$/)` plus `.refine(end >= start)`. The `start_ms: ""` test passes, with PROVE by removing the regex. No test covers `end_ms < start_ms`, so the refine is a surviving mutant (R2-L-1). |
| L-4 | `target_id` heuristic vs `type` | **Deferred (accepted as a note)** | The rationale and the consequence ("youtubei の更新で `targetId` が欠けた場合は全 segment が `no-captions` になる") are recorded in the tasks.md Implementation Notes. It stays out of the verdict. |
| L-5 | Fail-closed on a non-http URL | **Resolved (documented intent)** | tasks.md Implementation Notes: "http/https 以外の URL を1件でも含む応答は、結果全体を fail-closed で拒否する（引用元として扱う URL を部分的に信頼しないため）". |
| L-6 | Boundary bookkeeping for `abort.ts` | **Resolved** | The 10.4 `_Boundary:_` now lists `ports/abort.ts`. The plan.md File Structure Plan has the row "`packages/ai-core/src/ports/abort.ts` … 内部 helper。`./ports` からは公開しない". `index.ts` still does not export it. |

### Remaining findings

### [LOW] The `end_ms >= start_ms` refine has no test (surviving mutant)
**Location**: packages/ai-core/src/ports/transcript.ts:43-45; transcript.test.ts:101-163
**Issue**: Removing the `.refine(...)` keeps all 34 tests green. An inverted segment would then pass through with a negative `durationSeconds`, because `mapSegments` no longer filters on timing.
**Evidence**: `.refine((item) => Number(item.end_ms) >= Number(item.start_ms), { message: "end_ms must not precede start_ms" })`. The malformed cases are `start_ms: 1500` (type), `start_ms: ""` (regex), and `snippet.text: 42`. None has `end_ms < start_ms`, and the do.md PROVE table has no row for the refine.
**Confidence**: high
**Fix**: Add an `"inverted segment timing"` case (`start_ms: "3000", end_ms: "1000"`) expecting `fetch-failed`, and PROVE it by deleting the refine.

### [LOW] Only the "video is private" wording is tested; the "private video" alternative is not
**Location**: packages/ai-core/src/ports/transcript.ts:111-113
**Issue**: The regex's second alternative covers YouTube's newer `playabilityStatus.reason` "Private video", which is the most likely live wording. No test uses it, so dropping that alternative goes undetected.
**Evidence**: `/\b(video is private|private video)\b/`. Every private test uses "This video is private".
**Confidence**: medium (the live wording is unverified, as noted for M-3)
**Fix**: Add a `playability_status: { status: "LOGIN_REQUIRED", reason: "Private video" }` case expecting `private`. Ideally, record the live response wording once `test:local` / a recording exists (C7 cassette).

### [LOW] The reject-side cleanup in `raceWithAbort` is still unexecuted (carried over)
**Location**: packages/ai-core/src/ports/abort.ts:14-16
**Issue**: No test runs a signalled call whose inner promise rejects. The SDK-failure and transcript-failure tests pass no signal, so the listener-removal branch is uncovered. It has low behavioral risk because the listener is `{ once: true }` and a late `reject` on a settled promise is a no-op.
**Evidence**: Coverage `abort.ts | 76.92 | 75 | 80 | 80 | 15-16`
**Confidence**: high (the coverage gap itself); low (practical impact)
**Fix**: Pass `new AbortController().signal` in the "wraps Tavily SDK failures" test, or add a small `abort.test.ts` for the pre-aborted, resolve, and reject paths.

### Verdict (round 2)
APPROVE_WITH_NOTES

The blocking items (H-1, M-1, M-2, M-3) are fixed, and a test for each fails when its fix is broken (see do.md PROVE). The three remaining LOW items are test-coverage gaps with no production-behavior defect. L-4 is an accepted deferral with recorded rationale.

### Hallucination Signal (round 2)
forced: false
