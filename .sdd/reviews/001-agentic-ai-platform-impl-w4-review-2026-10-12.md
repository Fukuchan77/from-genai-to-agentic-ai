# Adversarial Review — 001-agentic-ai-platform W4 (apps/web, tasks 20–24)

Scope: `git diff main...HEAD` (5 commits, `d8fe775`..`a8ba337`). Read in full: `lib/server/{platform,guard,errors}.ts` and the three Route Handlers. UI components and their tests were sampled, not read line by line. `mise run gate` was not re-run in this review.
Risk trigger: none (manual run). Prior reviews: W3 r3 (APPROVE). The W4 requirements it set for 20.1 (R3-1) are implemented in `platform.ts`.

## Critique

### [MEDIUM] RequestGuard measures only `image/…` files; the route and `adaptHistoryForModel` also treat a bare `image` media type as an image
**Location**: apps/web/lib/server/guard.ts:212-218 vs apps/web/app/api/chat/route.ts:27, apps/web/app/api/agent/tools/route.ts:39, packages/ai-core/src/chat/adapt-history.ts:42
**Issue**: A `file` part with `mediaType: "image"` is counted as an image by the routes (it forces the `imageInput` capability) and by the history adapter, but `inspectConversation` skips it. The 4-image count limit and the data-URL-only and 5 MiB checks (Req 3.11) are therefore bypassed.
**Evidence**: guard: `fields.mediaType.startsWith("image/")`; route: `part.mediaType === "image" || part.mediaType.startsWith("image/")`. `guard.test.ts` ("does not count non-image files as images") exercises only `application/pdf`; no test uses a bare `image`.
**Confidence**: high (code reading). Impact is bounded by the 512 KiB body limit.
**Fix**: Share one `isImageMediaType` helper (ideally exported from ai-core and used by guard, routes and adapter). Add a guard test with `mediaType: "image"` that expects `limit-exceeded` or `invalid-request`.

### [MEDIUM] Agent route turns every exception from `createAgentUIStreamResponse` into a 400 `invalid-request`
**Location**: apps/web/app/api/agent/tools/route.ts:100-127
**Issue**: The bare `catch {}` assumes validation failure. A bug in agent construction, or a `PlatformError` thrown inside the SDK call, is also reported as a bad request, with no log. This is the "lazy catch-all" the zero-tolerance list names. The chat route does it correctly by wrapping only `validateUIMessages`.
**Evidence**: `} catch { // The SDK validates the history ... throw new PlatformError("invalid-request", …) }`.
**Confidence**: high.
**Fix**: Call `validateUIMessages` (with the agent's tools) separately, as chat does, and let other errors reach `toErrorResponse`. Also guard the `body.messages as unknown as UIMessage[]` cast, because `adaptHistoryForModel` runs on unvalidated parts before validation, outside the inner try. A malformed part there yields 500 `unexpected` instead of 400. Add a test for each case.

### [LOW] File parts that are not images are not restricted to `data:` URLs
**Location**: apps/web/lib/server/guard.ts:212-218
**Issue**: Only image parts are checked for data URLs. A `file` part with a non-image type and an `http(s)` URL passes the guard and is later resolved by the AI SDK's download step. SDK 7.0.137 imports `fetchUntrustedUrl`, so SDK-side SSRF protection probably exists, but the project's own guard policy ("data: URLs only") is not applied and not tested. I did not verify the SDK's behavior at runtime.
**Confidence**: medium.
**Fix**: Reject any `file` part whose URL is not `data:`, or restrict to the media types the UI can send. Add a test with `application/pdf` and `https://…`.

### [LOW] Quota is spent before the request can fail for other reasons
**Location**: apps/web/lib/server/guard.ts:148-159, apps/web/app/api/chat/route.ts:60-66
**Issue**: `limiter.check()` runs inside `guardRequest`, before `validateUIMessages`, model resolution (capability or credential failure) and `loadSource` (422). Requests that never reach an LLM still consume the window. The tasks.md note says only that guard rejections are free.
**Confidence**: high. Cost impact is nil, but Req 3.11 reads "rejected requests without an LLM call", so this is a legitimate design choice to record.
**Fix**: Record the behavior in the 21 Implementation Notes or traceability Gaps, or move the check after resolution.

### [LOW] Guarded fetch: request bodies other than strings are silently dropped, and there is no timeout of its own
**Location**: apps/web/lib/server/platform.ts:230-274
**Issue**: `if (typeof init?.body === "string") outgoing.write(init.body)` ignores `Uint8Array` and stream bodies without error. A slow server that sends one byte at a time is bounded only by the caller's `signal`.
**Confidence**: medium. The current callers use GET and string bodies.
**Fix**: Throw on an unsupported body type. Confirm that `loadSource` always passes a signal with a timeout, and test it.

### [LOW] No test or doc evidence in this diff for the `local` mode having no rate limit
**Location**: apps/web/lib/server/guard.ts:148
**Issue**: Limits are enforced only for `live`, as Req 3.11 says. `AI_RUN_MODE` defaults to `local`, so the default hands-on run is unlimited; `guard.test.ts` covers non-live modes, but README or UI text does not say so.
**Confidence**: low.
**Fix**: One line in the module doc (W5).

### Checked and found sound
- `createGuardedLookup` / `isBlockedAddress` normalise through WHATWG `URL` as R3-1 required. Decoded-size counting runs after decompression, and the `cause` chain is unwrapped to `disallowed-url`.
- Error responses are allow-listed (`publicDetails`, fixed provider messages). Stream errors never carry the raw provider message.
- The body size is enforced by both `Content-Length` and bytes actually read. Strict schema, a UTF-8 fatal decoder and an `AbortSignal` pass-through are all present.
- tasks.md 23.5 / 24.4 completion tags are explicitly pending, so I did not flag them.
- No placeholder TODO/FIXME was found in the files read.

## Verdict
REQUEST_CHANGES

(Both MEDIUM items are small and test-addressable; no CRITICAL or HIGH finding.)

## Hallucination Signal
forced: false

## Resolution (2026-10-12)
- MEDIUM 1 (guard image predicate): fixed. `isImageMediaType` lives in `guard.ts`; both routes import it. Tests: `counts a bare image media type as an image`, `rejects a non-image file whose URL is not a data URL`.
- MEDIUM 2 (agent route catch scope / unvalidated adapt): fixed. Only `validateUIMessages` maps to `invalid-request`; the adapter receives the validated history. Tests: `does not adapt a history that failed validation`, `reports a failure after validation as unexpected, not as invalid-request`.
- LOW 1 (non-image files not restricted to data URLs): fixed in the guard.
- LOW 2-4 (quota order, guarded fetch body types, `local` mode doc): accepted and recorded in `traceability.md` Gaps.
- Gate after fixes: `mise run gate` exit 0, web `executed=298 passed=298`.
