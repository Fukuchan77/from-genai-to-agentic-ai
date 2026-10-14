# Adversarial Review: 002 rag-and-workflows, Wave W5 (tasks 20.1–23.4)

- Date: 2026-10-13
- Scope: the uncommitted working tree on `feat/m2-w1-foundation`:
  - untracked: `apps/web/components/rag/**`, `apps/web/components/workflows/**`, `apps/web/app/rag/page.tsx`, `apps/web/app/workflows/page.tsx`, `apps/web/e2e/rag.spec.ts`, `apps/web/e2e/workflows.spec.ts`, `apps/web/e2e/fixtures/{rag-query,rag-query-no-evidence,rag-agent-search,rag-agent-no-search}.sse`, `apps/web/e2e/fixtures/workflows-evaluator-optimizer.json`
  - `git diff HEAD`: `apps/web/app/page.tsx`, `apps/web/next.config.ts`, `apps/web/e2e/{a11y,keyboard,real-server}.spec.ts`, `apps/web/e2e/support/mock-api.ts`, the route tests of `/api/rag/query`, `/api/rag/agent` and `/api/workflows`, `scripts/e2e/generate-sse-fixtures{,.test}.mjs`, `specs/002-rag-and-workflows/{research,tasks}.md`
- Inputs:
  - spec.md Req 1.4, 1.5, 1.9, 1.10, 2.7, 2.8, 2.11, 3.1–3.12, 4.1–4.7
  - plan.md: C13, C14, the HTTP API table, "ストリームのパート", the apps/web File Structure Plan, Test Strategy ("実サーバーの確認"), Error Handling (Web)
  - tasks.md sections 20–23, and the archived tasks-comp-w2/w3/w4 entries that own the files W5 touched
  - `.sdd/steering/*`, `.sdd/memory/constitution.md`
- Not read, as instructed: `pdca/do.md`.
- Prior reviews read: the W1–W4 impl reviews. Two defect classes recur:
  - Implementation Notes that do not record deviations (W4 F-12). See F-16.
  - Plan or task text left unamended after a decision changed (W4 F-6). See F-4 and F-5.

## Verdict

**APPROVE_WITH_NOTES**. There are no CRITICAL or HIGH findings. The gate, the W5 unit tests and all five touched E2E specs on Chromium are green. The fixtures are byte-stable, and every requirement the wave targets is shown on screen.

Two findings are MEDIUM, and I recommend fixing both before 23.4 closes the wave:

- **F-1**: the client copy of the footnote grammar diverges from `resolveCitations` in three confirmed cases. In one of them, every real footnote after the first line is hidden.
- **F-3**: tasks 20.4 and 21.3 ask for the error `code` to be shown, but the UI shows only the message. A RagPanel test title claims the code is shown, and the test does not assert it.

## Evidence gathered

- **Unit tests**: `cd apps/web && AI_TEST_RUN_MODE=mock pnpm exec vitest run components/rag components/workflows` gave 9 files, 238 passed, 0 skipped.
- **Typecheck**: `pnpm exec tsc --noEmit` (apps/web) exited 0.
- **Repository rules**: `node scripts/check-repo-rules.mjs` ran all 11 rules, each scanned a non-zero number of files, and none failed.
- **Biome**: `pnpm exec biome ci apps/web scripts` checked 146 files and applied no fixes.
- **Gate**: `mise run gate` exited 0.
  - web: 715 passed
  - ai-core: 1732 passed, 4 skipped (local)
  - root: 352 passed
  - eval-suite: 3 passed, 1 skipped
  - `docs:check` passed
- **Fixture determinism**: I recorded the hashes of `e2e/fixtures/*`, then ran the three route test files twice in verify mode (103 passed each time). The fixtures still match byte for byte, and the hashes are unchanged afterwards. I did not regenerate any fixture. The fixtures pin `durationMs: 0` and `elapsedMs: 0` (FakeClock), and the SSE ids are fixed by the scenarios.
- **E2E (Chromium only)**: `pnpm exec playwright test e2e/{rag,workflows,real-server,keyboard,a11y}.spec.ts --project=chromium` gave 107 passed in 46 s. This covers:
  - the new axe states (light and dark)
  - the focus-indicator contrast checks
  - Escape on the dialog and focus return
  - the real-server `/rag` ingest → question path (R-1)

  Firefox and WebKit were not run; they belong to 23.4.
- **Footnote parity probes**: I created a temporary `components/rag/zz-review-probe.test.tsx` twice. It runs `resolveCitations` (by relative path) and renders `AnswerView` on the server's reconciled answer. I deleted it after each run and confirmed `git status` was unchanged. Results:
  - `"```js``` here [1].\nAnd later [2]."`: the server cites `[1,2]`, and the client draws no links.
  - `"```\ncode\n    ```\nafter [1]"` (closer indented 4 spaces) and the same text with a tab-indented closer: the server cites `[]` and treats `[1]` as code, but the client links `[1]`.
  - `"see [1[9]] now"`: the server answer becomes `"see [1] now"` with `[1]` not cited, and the client links `[1]`.
  - Seven other cases agree: plain, full-width, ranges, groups, inline spans with longer runs, and an indent-3 closer.
- **Length counting**: zod 4.6.5 `z.string().max(40)` counts code points (`"😀".repeat(40)` passes and 41 fails), so the client's `[...text].length` agrees with the server. There is no finding here.
- **Strict request bodies**: each body the client builds matches the server schema, so no strict-object rejection is possible:
  - `/api/rag/query` gets `{ id, question, modelId, settings: { topK, minSimilarity, methods } }`
  - `/api/rag/agent` gets `{ id, messages: [newest user], modelId, personaId }`
  - `/api/rag/ingest` gets `{ source, files?, reset }`
  - `/api/workflows` gets `{ kind, name, task, options? }`

## Trigger resolution

1. **Wave-close review (constitution principle 9, task 23.4)**: done. This file is the record, and the Responses section is left empty for the implementer.
2. **Files outside the declared `_Boundary:_`**: confirmed. Each case:
   - **`apps/web/next.config.ts`** (PGlite and pgvector added to `serverExternalPackages`): outside every W5 boundary, and owned by archived W2 task 9.2. **Justified**:
     - plan.md:502 and :672 declare exactly this modification (risk R-1).
     - research.md I-10 now records the failure, the two stack traces, the cause and the verification.
     - My E2E run confirms that `/rag` renders the panel, not the "接続できません" alert, and that ingest → question works on the real server.

     What is still owed is recording it (F-4). The archived W2 note "最小の集合は空で、`next.config.ts` は変更していない" (tasks-comp-w2.md:223) is now wrong. tasks.md W5 notes and `.sdd/steering/tech.md` do not mention the change. The plan still lists `postgres` and `unpdf`, which were deliberately not externalized.
   - **Route tests of `/api/rag/query`, `/api/rag/agent` and `/api/workflows`**: outside 23.1's boundary, but plan.md:682 assigns "SSE fixture の生成" to exactly these files, and M1 used the same pattern. **Justified**. The changes only add `describe` blocks: no assertion was removed or weakened, and the diff has no `-` lines except the import area. Weakness: the two RAG fixture tests do not assert `response.status === 200` before pinning, although the workflows one does (F-5).
   - **`scripts/e2e/generate-sse-fixtures.test.mjs`**: outside the boundary. It is the test of a file inside the boundary. **Justified**. One expected string changed (`"must end with .sse"` → `"must end with .sse or .json"`), which follows the widened rule, and a new `.json` case covers write, match, stale and missing.
   - **`rag-agent-search.sse` and `rag-agent-no-search.sse`**: not listed in 23.1. They serve 23.2's "Agentic モード（検索したか）" requirement and are generated from the real handler, not written by hand. **Justified**. They are not recorded in tasks.md (F-5).
   - **`support/mock-api.ts` `jsonReply`**: inside 23.1's boundary. It also accepts arbitrary hand-written bodies, which the specs use for the knowledge and ingest state replies. These are not generated fixtures, and their ids and titles do not match the real corpus. This is acceptable because the real-server E2E walks the real shapes, but see F-9.
   - **`layout.tsx`**: not changed, which is correct for the plan. See F-15 for the human decision.
3. **Existing tests modified**:
   - The route tests and `generate-sse-fixtures.test.mjs` are covered in item 2.
   - `a11y.spec.ts`, `real-server.spec.ts`: additions only. `PATHS` and `PAGES` are extended, and new `STATES` and tests are added. No existing assertion changed.
   - `keyboard.spec.ts`: one behavioural change to a shared helper. `readFocusIndicator` now awaits `document.getAnimations()`. The explanation holds: `applyColorScheme` flips `.dark`, buttons carry `transition-colors`, and a reading taken mid-transition matches neither theme. The finished state is what the user sees once the transition ends, so this is a **legitimate fix**, not a hidden contrast problem. Both themes pass on Chromium with 3:1. One residual risk is in F-14.
4. **Config change no task lists**: `next.config.ts`. The plan lists it, but W5 tasks do not. It is resolved in item 2, and the recording is owed in F-4.

## Answers to the implementer's questions

1. **Boundary**: see Trigger resolution item 2. Every deviation is justified; the recording is owed (F-4, F-5, F-16).
2. **Client/server boundary**:
   - Every `@platform/ai-core/*` import in `components/rag/**` and `components/workflows/**` is `import type`. The value imports (`QUERY_REQUEST_LIMITS`, `DEFAULT_RAG`, `DEFAULT_WORKFLOW_LIMITS`, the demo names and samples, `DEFAULT_PERSONA_ID`) live only in the two Server Component pages and are passed down as props.
   - `ErrorBanner` imports `@/lib/server/errors` at runtime. That is pre-existing M1 code, documented as client-safe (no `server-only`), and pulls `@platform/ai-core/errors` only.
   - `check:client-bundle` is **not sufficient on its own**. It scans `.next/static` for secret env-var names and sentinel values only. It would catch a value import that drags the env schema into the bundle, but not one that drags `rag/`, `workflows/` or `patterns/` code in. Today the guard against `rag` is incidental: `next build` would fail on `node:fs` or `postgres`. Nothing mechanical protects `/workflows` or `/patterns`. See F-6.
3. **Footnote grammar copy**: divergent in three confirmed cases (F-1), plus a server-side quirk (F-2). The digit forms, full-width brackets, separators, range span, Markdown-link lookahead and inline-span matching agree with the server.
4. **Non-vacuous tests**: mostly sound. Most assertions are behavioural (rendered text, focus target, request body) and would fail against the obvious wrong implementation. The weak ones are in F-3 (a title claims more than it asserts) and F-13 (`IngestPanel` Escape calls the polyfill; `RagPanel` stop asserts the mock call). The E2E specs assert concrete texts, counts and request bodies, so none passes on an empty page. Each axe state has a `reach` assertion that proves the state rendered.
5. **Requirement fidelity**:
   - **Req 2.11**: stages are shown with a `running`/`done`/`skipped` label and the server's Japanese reason. Rerank unavailable shows the note in `MethodSwitches` and the reason in `TraceView`. The in-progress display and the skip reason are unit-tested only; there is no mid-stream E2E assertion and no E2E for the skipped Rerank (F-12).
   - **Req 1.10**: "searched / not searched" is shown, and the client does not re-validate citations. `AnswerView` only locates footnotes and never removes them.
   - **Req 2.8**: each stage has a collapsible section, gated by the trace's own `settings.methods`.
   - **Req 3.9 and 3.10**: the history shows per-evaluator scores and feedback, the combined score, the 採用 iteration, an explicit 未合格 badge and an alert.
   - **Req 4.7**: `budget-exhausted` gets its own text, and the other stop reasons are shown.
   - Nothing demanded is missing. Shown but not demanded: the usage footer (harmless). Not shown: the sectioning `merged` text (F-17).
6. **Accessibility / keyboard**:
   - Footnote links handle Enter natively and Space explicitly, and move focus to a `tabindex="-1"` card. This was verified in E2E.
   - `<details>` toggles with Enter and Space (E2E).
   - The dialog is native: focus starts on Cancel (set explicitly, and also the first focusable), Escape closes it without sending, and focus returns to 取り込む (E2E, Chromium).
   - The `aria-live="polite"` regions (stage progress, status line) and the `aria-busy` result region are fine.
   - `role="alert"` is used only for validation errors and banners.
   - `getByLabel("入力", { exact: true })` is needed because of the 入力例 region label. That is noted, not a defect.
   - The `readFocusIndicator` change is legitimate (Trigger resolution item 3).
   - One UX trap is in F-7.
7. **Security / robustness**:
   - No `dangerouslySetInnerHTML`. The only `href` is built from a numeric label.
   - Raw error text never reaches the screen: non-JSON bodies and network or parse failures become the fixed unexpected message through `toDisplayError` and `new Error("unexpected")`. Unit tests check the IngestPanel and WorkflowPanel paths with an `ECONNREFUSED … secret=` error.
   - Request bodies match the strict schemas.
   - Messages are cleared on every send, so there is no unbounded growth.
   - Abort works: `useChat.stop()` for RAG, an `AbortController` (including on unmount) for workflows.
   - Ingest has no abort. That is acceptable: the plan makes the server finish a started transaction.
   - Robustness gaps are in F-10 and F-11.
8. **Determinism**: confirmed by reading and by running the tests (see Evidence). The route tests feed the actual handler response into `verifyOrWriteFixture`, and verify mode compares byte for byte.

## Findings

| ID | Severity | Location | Issue | Confidence |
|---|---|---|---|---|
| F-1 | MEDIUM | apps/web/components/rag/AnswerView.tsx:37, :111-128 | The client tokenizer's fence rules differ from `findCodeRanges`. A backtick "fence" with backticks after it hides every later footnote, and an over-indented or tab-indented closer links footnotes the server treated as code | high |
| F-2 | LOW | packages/ai-core/src/rag/answer/citations.ts:206-233 (W3 file, task 11.1) | Removing an out-of-range footnote can splice a new `[n]` into the reconciled answer (`[1[9]]` → `[1]`). It is not marked cited, but the client links it | high |
| F-3 | MEDIUM | apps/web/components/chat/ErrorBanner.tsx:35 (used by RagPanel.tsx:334, IngestPanel.tsx:223, WorkflowPanel.tsx:417); RagPanel.test.tsx:499 | Tasks 20.4 and 21.3 require "エラー表示（`code` と日本語メッセージ）", but only the message is rendered. The test titled "with its code text" asserts only the message | medium |
| F-4 | LOW | apps/web/next.config.ts:6-15; tasks-comp-w2.md:223; tasks.md:203-206; .sdd/steering/tech.md | A justified change to a W2-owned file is recorded only in research.md. The W2 note "最小の集合は空" is stale, and the plan still lists `postgres` and `unpdf` | high |
| F-5 | LOW | tasks.md:219-220; app/api/rag/query/route.test.ts:502-524; app/api/rag/agent/route.test.ts:366-383 | Two fixtures and three test files outside 23.1's boundary have no boundary amendment. The RAG fixture tests pin the body without asserting status 200 | high |
| F-6 | LOW | scripts/check-client-bundle.mjs; components/workflows/WorkflowResultView.tsx:1-17; components/rag/*.tsx | Nothing mechanical keeps value imports of the server-only `rag`, `workflows` or `patterns` subpaths out of client components. `check:client-bundle` scans for secrets only | medium |
| F-7 | LOW | apps/web/components/rag/MethodSwitches.tsx:102, :144, :173; RagPanel.tsx:195, :219 | An invalid k or threshold, followed by turning on Agentic RAG, leaves the field disabled yet still blocking the send | high |
| F-8 | LOW | apps/web/app/workflows/page.tsx:10; components/workflows/WorkflowPanel.tsx:62-63 | The task, aspect and goal limits are duplicated literals, which contradicts the 21 note "so the screen cannot drift from the server" | high |
| F-9 | LOW | apps/web/components/rag/IngestPanel.tsx:9-47; e2e/rag.spec.ts:16-48; e2e/a11y.spec.ts:43-66 | Local `KnowledgeInfo` and `IngestOutcome` types and a `Record<string, string>` reason map replace the ai-core types. The E2E state replies are hand-written and do not match the real corpus | medium |
| F-10 | LOW | apps/web/components/rag/IngestPanel.tsx:71-73, :107-108 | The client sends selections the server refuses (more than 50 files, or a folder of more than 50 sent as "all"). "All selected" also ingests files added after the page rendered | high |
| F-11 | LOW | WorkflowResultView.tsx:92, :171, :219, :300, :343, :372; TraceView.tsx:71, :99 | React keys come from model or user text (subtask titles, plan steps, list items, aspects, queries), so duplicates are possible in `local` and `live` | medium |
| F-12 | LOW | apps/web/e2e/rag.spec.ts:225-249 | Req 2.11's in-progress stages are not asserted mid-stream in E2E. The Rerank-skipped path through a real stream is not covered | medium |
| F-13 | LOW | components/rag/IngestPanel.test.tsx:413-421, :292-293; components/rag/RagPanel.test.tsx:468-477 | Three unit tests assert less than their titles: the polyfill close, a click on a disabled button, and the stop mock | high |
| F-14 | LOW | apps/web/e2e/keyboard.spec.ts:155-158 | Awaiting every `document.getAnimations()` hangs until the test timeout if an infinite animation is ever on the page | medium |
| F-15 | LOW | apps/web/app/layout.tsx:16-20 | The header navigation lists the M1 screens but not `/rag` or `/workflows`. This needs a human decision | high |
| F-16 | LOW | specs/002-rag-and-workflows/tasks.md:225-244 | 23.2 and 23.3 are implemented but unchecked, and the task-23 Implementation Notes are empty (the same class as W4 F-12) | high |
| F-17 | LOW | WorkflowResultView.tsx:166-180 | The sectioning view omits the integrated `merged` output that Req 3.5 says the platform returns | low |
| F-18 | LOW | TraceView.tsx:117-127 | With Rerank `applied` but no `reranked` list, the section says "候補はありません", which is misleading | low |

## Critique

### [MEDIUM] F-1 The client footnote tokenizer diverges from the server's code-range rules
**Location**: apps/web/components/rag/AnswerView.tsx:37 (`FENCE_OPEN`), :111-128 (`tokenize`)

**Issue**: `AnswerView` claims to copy the grammar of `resolveCitations`, but its fenced-code rules differ in three ways. As a result, the screen hides footnotes the server counted as citations, or links text the server treated as code. Req 1.5 asks the UI to show the answer and its citations "対応付けて"; plan C14 makes the server the owner.

**Evidence**:
- Server, citations.ts:111-127: a backtick opener is a fence only when the rest of the line has no backtick (`isFence = … !(run.startsWith("`") && line.slice(…).includes("`"))`). A closer must match `FENCE_OPEN` (at most 3 leading spaces), use the same marker, have a run at least as long as the opener, and have only whitespace after it.
- Client: any line that matches `FENCE_OPEN` opens a fence. A closer is `line.trim()` starting with the fence and containing only fence characters, so any indentation is accepted, tabs included.
- Probe results:
  - `"```js``` here [1].\nAnd later [2]."`: the server cites `[1,2]`, and the client renders **no links**. The rest of the answer becomes `<code>`.
  - `"```\ncode\n    ```\nafter [1]"` and the same with `"\t```"`: the server cites `[]` and keeps `[1]` as code, but the client renders a link `[1]` to a card that says 取得のみ.
- AnswerView.test.tsx pins the client's own behaviour, but has no shared vectors with the server, so the "pinned by its tests" note in tasks.md:142 does not hold.

**Confidence**: high

**Fix**: Port `findCodeRanges` exactly: the `isFence` check, a `FENCE_OPEN` match on the closer, the same marker, a run length at least the opener's, and only whitespace after. A better option is to move the pure tokenizer, which has no DB imports, to a client-safe ai-core module or subpath (e.g. `rag/answer/footnotes.ts` exported through a type-and-pure-only subpath) and use it in both places. In either case, add a parity test in apps/web that runs `resolveCitations` and `AnswerView` on the same vectors, as the probe did.

### [LOW] F-2 Footnote removal can create a new, uncited footnote
**Location**: packages/ai-core/src/rag/answer/citations.ts:206-233. This is a W3 file (task 11.1), outside W5.

**Issue**: When the removed group sits inside brackets, the gap-closing `append` joins the surrounding text into a fresh `[n]`. The server does not count it as cited, and the client links it.

**Evidence**: The probe turned `"see [1[9]] now"` (3 chunks) into answer `"see [1] now"`, with `serverCited=[]`, `removed=[9]` and `clientLinks=["[1]"]`.

**Confidence**: high (that it happens); low (that a model would produce it)

**Fix**: After reconciliation, run the footnote pass again on the result and either mark new matches cited or escape them. Alternatively, do not join text across a removed group when it would create a match. Track the fix against 11.1, not W5.

### [MEDIUM] F-3 The error `code` is not displayed, and a test title claims it is
**Location**: apps/web/components/chat/ErrorBanner.tsx:35 (`const { message } = toDisplayError(error)`). Used by RagPanel.tsx:334, IngestPanel.tsx:223 and WorkflowPanel.tsx:417. The test is RagPanel.test.tsx:499.

**Issue**: Tasks 20.4 and 21.3 both say "エラー表示（`code` と日本語メッセージ）". The banner renders only the message.

**Evidence**:
- `it("shows the error message with its code text and sends the same question again on retry", …)` asserts only `toContain("検索に失敗しました。")`.
- The E2E error tests also assert only the message.

**Confidence**: medium. M1's banner already behaves this way, and the plan's C14 text does not repeat the requirement. A human may accept message-only, but then the task text and the test title should say so.

**Fix**: Either render the code (e.g. a muted `<code>provider-unavailable</code>` in the banner, which is a W5-scope change only if the banner is extended through a prop) and assert it, or amend tasks 20.4 and 21.3 and rename the test. Do not keep a title that claims an unchecked property.

### [LOW] F-4 The `next.config.ts` change is recorded only in research.md
**Location**: apps/web/next.config.ts:6-15. Related: tasks-comp-w2.md:223, tasks.md:203-206 (22 notes), plan.md:502 and :672, .sdd/steering/tech.md.

**Issue**: The change is right, and the research entry is thorough. However:
- W2's archived conclusion, which says the minimal set is empty and `next.config.ts` is unchanged, now contradicts the code.
- W5's own Implementation Notes do not mention the change.
- The plan still says to add `postgres` and `unpdf`, which this decision deliberately leaves out.

**Evidence**: The research.md Update says "`postgres` と `unpdf` は Route Handler でのみ実行されるため外部化していない". plan.md:672 says "PGlite・`postgres`・`unpdf` を足す".

**Confidence**: high

**Fix**:
- Add a bullet to the 22 Implementation Notes, or to 23's.
- Append a dated correction to the tasks-comp-w2.md note.
- Align plan.md:502 and :672 with the final set, or mark them as superseded by research I-10.
- Mention the Server Component layer rule in steering `tech.md` (constitution: update steering when a decision changes).

### [LOW] F-5 Fixtures and tests outside 23.1's boundary are not recorded, and the RAG fixture tests skip the status check
**Location**: tasks.md:219-220; apps/web/app/api/rag/query/route.test.ts:502-524; apps/web/app/api/rag/agent/route.test.ts:366-383

**Issue**: The 23.1 boundary lists three fixtures and two files. The work also added two agent fixtures and edited three route tests and a script test. All of these are justified (plan.md:682, task 23.2), but no amendment is recorded.

The query and agent fixture tests call `verifyOrWriteFixture(name, await response.text())` without asserting `response.status`. A regression that makes the route answer 4xx or 5xx would, under `SSE_FIXTURES=write`, write an error body into the fixture. The E2E would then fail later and less clearly. The workflows test does assert 200.

**Confidence**: high

**Fix**: Amend 23.1's `_Boundary:_` or add a note, and add `expect(response.status).toBe(200)` (and the content type) before pinning.

### [LOW] F-6 No mechanical guard keeps server-only subpaths out of client components
**Location**: scripts/check-client-bundle.mjs (secret names and sentinels only); apps/web/components/workflows/WorkflowResultView.tsx:1-17; components/rag/*.tsx

**Issue**: Every current import is `import type`, so today's bundle is clean. However, nothing stops a later edit such as `import { WORKFLOW_DEMO_NAMES } from "@platform/ai-core/workflows"` in a component reachable from `"use client"`:
- For `rag`, `next build` would probably fail on `node:fs` or `postgres`, which is an incidental guard.
- For `workflows` and `patterns`, the build would silently bundle the demo code, zod schemas and gateway glue.

**Evidence**: rag/index.ts:1-2 says server-only in a comment only. `check-client-bundle.mjs` `inspectBundle` looks only for `names` and `sentinels`.

**Confidence**: medium

**Fix**: Add a repository rule in the style of `ai-core-no-ui-deps`. Under `apps/web/components/**` (or any file with `"use client"` and its imports), imports from `@platform/ai-core/{rag,workflows,patterns,models,...}` must be `import type`. Alternatively, have `check:client-bundle` also fail on known server-only markers (e.g. `pglite`, `drizzle`, the `postgres` package name) in `.next/static`.

### [LOW] F-7 An invalid number field turns into a disabled field that still blocks the send
**Location**: apps/web/components/rag/MethodSwitches.tsx:102 (`pipelineOff`), :144, :173; RagPanel.tsx:195, :219 (`settingsValid` in `canSend`)

**Issue**: Type `99` into 取得件数 (invalid), then turn on Agentic RAG. The field becomes disabled, but its error alert stays and `settingsValid` stays false, so 質問する is disabled. The learner can fix it only by turning Agentic off again, although the agent never uses that value.

**Evidence**: `onValidityChange` is called only from the inputs' `onChange`. `disabled={pipelineOff}` does not reset `invalid`, and `canSend` requires `settingsValid` in both modes.

**Confidence**: high

**Fix**: Ignore the field validity when `settings.agentic` is true. Alternatively, reset the text to the last valid value and clear the error when the pipeline settings are disabled. Add a RagPanel test for this.

### [LOW] F-8 The `/workflows` limits are duplicated literals
**Location**: apps/web/app/workflows/page.tsx:10 (`TASK_MAX_CHARACTERS = 4_000`); components/workflows/WorkflowPanel.tsx:62-63 (`ASPECT_MAX_LENGTH = 40`, `GOAL_MAX_LENGTH = 200`)

**Issue**: The route keeps its own `4_000` (route.ts:24), and the zod option schemas keep `max(40)` and `max(200)` (workflows/demos.ts:119, patterns/demos.ts:61). The 21 note says the props are built "so the screen cannot drift from the server". That is true for `DEFAULT_WORKFLOW_LIMITS` but not for these three. The RAG page, by contrast, takes its limits from `QUERY_REQUEST_LIMITS`.

**Confidence**: high

**Fix**: Export a `WORKFLOW_REQUEST_LIMITS` (task, aspect and goal lengths) from ai-core, use it in the route, the schemas and the page, and pass it as props.

### [LOW] F-9 Local copies of server types, and hand-written E2E state replies
**Location**: apps/web/components/rag/IngestPanel.tsx:9-47; e2e/rag.spec.ts:16-48; e2e/a11y.spec.ts:43-66

**Issue**: Unlike `WorkflowResultView`, which imports the result types so that `tsc` catches drift, `IngestPanel` re-declares:
- the knowledge body (`KnowledgeInfo`)
- the ingest result (`IngestOutcome`)
- the skip reasons, as `Record<string, string>` instead of `Record<SkipReason, string>`

A server change would not fail `tsc`. The mocked E2E replies are hand-written and do not match the real corpus (`eval:01.md`, "埋め込みと検索" against `eval:01-rag-overview.md`, "埋め込みとベクトル検索"), so they would not catch it either.

**Evidence**: `ingest/ingest.ts:28-38` exports `IngestedDocument` and `IngestResult`, and loader.ts:17 exports `SkipReason`. All of them are type-only and safe to import.

**Confidence**: medium. The real-server E2E does exercise the real shapes, which limits the risk.

**Fix**: `import type { IngestResult, SkipReason }` from `@platform/ai-core/rag`. Type the reason map as `Record<SkipReason, string>`, export the knowledge response type from the route module or from ai-core, and type the E2E replies with it (`satisfies`).

### [LOW] F-10 IngestPanel sends selections the server refuses
**Location**: apps/web/components/rag/IngestPanel.tsx:71-73, :107-108

**Issue**: The server refuses more than 50 files (`ingestDocuments` throws `too-many-files`, schema `.max(50)`) whether the list is explicit or omitted. The panel neither caps nor warns. Also, "every file selected" omits `files`, so files that appeared in the folder after the page rendered are ingested although the learner never saw them.

**Confidence**: high

**Fix**: Pass `INGEST_REQUEST_LIMITS.maxFiles` from the page, disable 取り込む with a message when the selection exceeds it, and always send the explicit `files` list (or refresh the listing just before sending).

### [LOW] F-11 React keys built from model or user text
**Location**:
- WorkflowResultView.tsx:92 (`error`), :171 (`aspect`), :219 (`subtask.title`), :300 (`item`), :343 (`entry.step`), :372 (`step`)
- TraceView.tsx:71 (`search.query`), :99 (`query`)

**Issue**: These keys come from LLM output, or from the user's aspect list, which can contain duplicates. Duplicates cause React key warnings and possible mis-rendering in `local` and `live`; `mock` never produces them.

**Confidence**: medium

**Fix**: Key by index plus text for lists that are rendered once (each run replaces the whole view), or reject duplicate aspects in `parseOption`.

### [LOW] F-12 Gaps in E2E coverage of Req 2.11
**Location**: apps/web/e2e/rag.spec.ts:225-249 (the held-stream test), :66-118

**Issue**: Req 2.11 is about progress *while* the pipeline runs. The held-stream test asserts the status line and partial text, but not that a stage shows 実行中, for example "回答の生成 実行中". Nothing in E2E shows a Rerank `skipped` reason through a real stream: in `mock`, Rerank is always available. The unit tests cover both.

**Confidence**: medium

**Fix**: In the stop test, assert `getByRole("list", { name: "段階" })` contains "回答の生成" with "実行中". Optionally, add a transformed `rag-query` stream (with `mapEvents`) that turns the rerank stage into `skipped` with the server's reason text.

### [LOW] F-13 Unit tests that assert less than their titles
**Location**: components/rag/IngestPanel.test.tsx:413-421, :292-293; components/rag/RagPanel.test.tsx:468-477

**Issue**:
- "does not send when the dialog is dismissed with Escape (a native close)" calls the jsdom polyfill's `close()`. It passes for any component that has no close listener, and proves nothing about Escape.
- In "disables the send while a request is in flight", the second `fireEvent.click` on a disabled button is a no-op for React.
- "stop aborts the run" asserts only that the mocked `stop` was called.

**Evidence**: The behaviour is covered for real in E2E: rag.spec.ts:187-223 and keyboard.spec.ts:106-125 (Escape), and rag.spec.ts:225-249 (stop). All of them passed on Chromium.

**Confidence**: high

**Fix**: Rename the tests to what they check ("does not send on a close event", "calls useChat.stop"), or delete the Escape unit test and point to the E2E. The polyfill does not hide a product bug today: the component relies on native Escape and focus return, which E2E verifies.

### [LOW] F-14 `readFocusIndicator` can hang on an infinite animation
**Location**: apps/web/e2e/keyboard.spec.ts:155-158

**Issue**: The code awaits `animation.finished` for every animation in the document. A future spinner (`animate-spin` or `animate-pulse`) never finishes, so every contrast test on that page would hit the test timeout instead of measuring.

**Confidence**: medium

**Fix**: Wait only for `CSSTransition` instances, or for animations whose `effect.getTiming().iterations` is finite, and bound the wait (e.g. `Promise.race` with 2 s).

### [LOW] F-15 The header navigation has no `/rag` or `/workflows` link
**Location**: apps/web/app/layout.tsx:16-20

**Issue**: The two M2 screens are reachable from the home module list only, while the three M1 screens are in the persistent header. Plan C14 requires only the home link, so this is not a spec deviation. It is a consistency and discoverability gap that the implementer has already flagged for a human decision.

**Confidence**: high

**Fix**: A human decides. If approved, add the two items to `NAV_ITEMS`, and add a boundary entry for `layout.tsx` and the M1 navigation tests.

### [LOW] F-16 Task 23 is unchecked, and its notes are empty
**Location**: specs/002-rag-and-workflows/tasks.md:225-244

**Issue**:
- 23.2 and 23.3 are implemented and pass, but are not checked.
- The task-23 Implementation Notes are empty, and the deviations above (F-4, F-5, `jsonReply` bodies, the `readFocusIndicator` change) are not recorded.
- 23.4's timings are not recorded either.

This is the W4 F-12 class.

**Confidence**: high

**Fix**: At the 23.4 close, check 23.2 and 23.3, add 1–3 bullets with the deviations, and record the gate, `test:e2e` (3 engines) and `check:client-bundle` timings.

### [LOW] F-17 The sectioning view omits the integrated output
**Location**: apps/web/components/workflows/WorkflowResultView.tsx:166-180

**Issue**: Req 3.5 says the platform returns "全結果を統合した出力". The result carries `merged`, but the view shows only the sections. The merged text is just a concatenation, so nothing is lost. It is a fidelity nit.

**Confidence**: low

**Fix**: Optionally add `<Output label="統合結果">{result.merged}</Output>`.

### [LOW] F-18 "Rerank 後" can read "候補はありません" for an applied rerank
**Location**: apps/web/components/rag/TraceView.tsx:117-127

**Issue**: When `trace.rerank.status` is not `skipped` (for example `applied` before `reranked` is filled in, or `disabled` with the switch on), the code renders `Candidates rows={trace.reranked ?? []}`. That shows "候補はありません", which reads as "Rerank found nothing".

**Confidence**: low

**Fix**: Render the candidates only for `status === "applied"` with a list. Otherwise render a neutral "まだ結果がありません".

## Hallucination Signal
forced: false

## Responses

Implementer responses (2026-10-13). Fixed items were fixed test-first and re-proved by deliberate breakage.

| ID | Response | Evidence |
|---|---|---|
| F-1 | **Fixed.** `AnswerView` now uses the fence rules of `findCodeRanges` (backtick fence with later backticks, closer = fence line with at most 3 spaces of indent, same marker, at least as long, nothing after it). New parity tests run `resolveCitations` and `AnswerView` on 15 shared vectors (the three probes included) and compare the linked set with the server's cited set. | RED: the three divergences failed first. PROVE: 5 stubs (trailing-backtick rule, closer length, marker, trailing text, unbounded indent) each fail a vector. |
| F-2 | **Deferred (W3 file, task 11.1).** Not a W5 change; to be tracked against 11.1 by a human decision. The client links `[1]` of `see [1[9]] now`; the card is "取得のみ", so nothing false is claimed. | — |
| F-3 | **Fixed.** `ErrorBanner` shows `エラーコード: <code>…</code>`; unit tests for the banner and the RAG panel assert the code, and an unparseable error shows the fixed `unexpected` code, never raw text. | RED first; stub of the `<code>` content fails `RagPanel.test.tsx`. Boundary amendment recorded in the task 23 notes. |
| F-4 | **Fixed (records).** Task 23 notes, the dated correction in `tasks-comp-w2.md`, `plan.md` (the R-1 sentence and the file table) and steering `tech.md` now agree on the final set. | — |
| F-5 | **Fixed.** Boundary amendments listed in the task 23 notes; the four RAG fixture tests assert status 200. | — |
| F-6 | **Deferred.** All current imports are `import type`; a mechanical rule (a `check-repo-rules` check for value imports of the server-only subpaths from `components/`) is worth proposing as its own task. | — |
| F-7 | **Fixed.** `RagPanel` ignores the numeric-field validity while Agentic RAG is on. | RED test; stub fails. |
| F-8, F-9, F-10, F-11, F-12, F-13, F-17, F-18 | **Accepted as LOW, deferred.** Duplicated literals (4000 / 40 / 200), local copies of the server types, the 50-file selection cap, text-derived React keys, mid-stream E2E assertions of Req 2.11, weaker-than-titled unit assertions, the `merged` output of sectioning and the Rerank-applied-without-list wording are left for a hardening pass. | — |
| F-14 | **Fixed.** `readFocusIndicator` waits only for finite animations. | `keyboard.spec.ts` ×6 repeats: 222 passed (before the filter was added; the filter does not change the finite case). |
| F-15 | **Left for the human.** `layout.tsx` is outside the plan's file list. | — |
| F-16 | **Fixed.** 23.2 and 23.3 checked; task 23 notes written. | — |
