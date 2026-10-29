# 003-domain-agents W7 adversarial review (2026-10-25)

Scope: W7 "画面と E2E" (tasks 29–35) in the working tree of `feat/m3-w1-foundation`. This covers the six screens and their components, the top page, the E2E specs, `support/mock-api.ts`, the fixtures, the "generated SSE fixture" cases in `app/api/**/route.test.ts` and `biome.json`. It also covers two fixes made outside the boundary: `packages/ai-core/src/aci/define-tool.ts` (+test) and the limits-as-props change in `components/analysis/{FigureView,TableView,AnalysisPanel}.tsx`.

Inputs read: AGENTS.md, constitution (by reference), spec.md Req 1–6, plan.md C13/C14/C15, "HTTP API", "ストリームのパート", "Error Handling" (Web, help desk, requirements, marketing), File Structure Plan (apps/web), Test Strategy, tasks.md (W7 section, exceptions (1)–(12), carry-overs W3/W4/W6), and the W3 review F-8.

Commands run: `vitest run` on three panel test files (HelpdeskPanel, CouncilPanel, InterviewPanel): 62/62 passed. I did not run the gate, Playwright or any whole-repo command. I modified no source file: `git status` showed the same 21 modified files before and after the review.

Risk triggers from the caller, each answered below: (6) the help-desk diff under batching is confirmed as a real bug (F-2). (7) The requirements 409 problem is confirmed (F-4). (8) The globalThis brand can be forged, and its root cause has a second symptom (F-6, F-7). `fatalLatchOf` is safe today but latent (F-7). (5) Vacuous E2E checks: F-1, F-8, F-13. F-8 (W3, the FAQ seed) was dropped (F-1). F-17 and F-18 (W6) are addressed, but F-17 is undone by one click (F-3).

## Critique

### [HIGH] F-1 W3 carry-over F-8 dropped: the mock `/helpdesk` never answers from the FAQ, and the real-server test hides it
**Location**: `apps/web/lib/server/platform.ts:664-669` (`getHelpdeskStore`); `apps/web/e2e/real-server.spec.ts` ("helpdesk page: an inquiry is planned, revised and answered with a ticket"); `apps/web/app/helpdesk/page.tsx:19-32`; `specs/003-domain-agents/tasks.md:163`
**Issue**: tasks.md assigned "`mock` の DB 作成時に FAQ を投入する" to 35.x. Nothing seeds the help-desk FAQ into the web app's mock PGlite. `getCatalogRepo` seeds marketing data, but `getHelpdeskStore` seeds nothing. So on the real `mock` server every sample inquiry reaches `helpdesk.ts:317-318` and is escalated. Even the examples labelled "（解決）" and "（再計画）" end with "ナレッジに根拠が見つからなかったため、解決できませんでした。".
**Evidence**: `helpdesk.ts:317` `if (!results.some((result) => result.sources.length > 0)) return await escalate(NO_EVIDENCE_REASON);`. The real-server test asserts only `toContainText("T-")` and `"改訂 1"`, never `解決済み` or the answer. The route tests call `ingestFaq()` themselves. 35.x is checked `[x]`, and the carry-over is neither done nor carried forward.
**Concrete scenario**: A learner runs `mise run dev` in mock mode and clicks "VPN に接続できない（解決）". The result is "エスカレーション / ナレッジに根拠が見つからなかった". The E2E stays green.
**Confidence**: high
**Fix**: In `mock`, seed the help-desk FAQ (`seedHelpdesk`, idempotent) when the knowledge base is first used, the same way `getCatalogRepo` seeds the catalog. Add `解決済み` and an answer substring to the real-server helpdesk test. Add an assertion that the "（未解決）" example escalates.

### [MEDIUM] F-2 The help-desk "修正された計画" loses, or gets wrong, the "before" descriptions when plan revisions arrive in one render
**Location**: `apps/web/components/helpdesk/HelpdeskPanel.tsx:235-245` (tracker set during render), `PlanDashboard.tsx:115-151`
**Issue**: `data-helpdesk-plan` uses one id (`plan`), so the message holds only the newest revision. The panel rebuilds "previous" from the revision it last rendered. With the mock model, or a chunked network read, revision 0 and revision 1 can be applied before React renders. In that case `previous` is `undefined` and the removed task loses its description. If revisions 1 and 2 are applied together, `previous` holds revision 0's tasks, so "変更前" shows text from the wrong revision.
**Evidence**: The E2E only passes because the fixture is paced: `streamReply("helpdesk", { paceMs: 30 })` with the comment "Paced like a real run, so the screen sees the plan before the replan". The unpaced ticket-list test and the real-server test do not check the removed description. The unit test re-renders between revisions (`view.redraw()`), so the batched case is never exercised.
**Concrete scenario**: On the real mock server the stream arrives in one or two chunks. The panel then shows "削除 t2" with no description (or a stale one from another revision).
**Confidence**: medium (depends on React batching and chunking; the author's own pacing shows they hit it)
**Fix (preferred)**: Have the server put the "before" descriptions into the stream. Extend `PlanDiff` in the part with `before: { id, description }[]` for removed and changed tasks (domain-stream already has the old plan). The screen then only renders. This needs a recorded boundary exception and a plan "ストリームのパート" update. **Client-only alternative**: record every plan part through `useChat({ onData })`, which fires per data part even when renders are batched. Keep a map of revision to tasks and pair `diff` with revision `plan.revision - 1`. Add a unit test where revision 0 and revision 1 arrive in a single render, and one where revision 0 jumps to revision 2.

### [MEDIUM] F-3 The W6 F-17 fix is undone by "閉じる", and a stopped council keeps an unconfirmed round
**Location**: `apps/web/components/marketing/CouncilPanel.tsx:122-125, 256-260`
**Issue**: `shownTurns` drops the turns of unconfirmed rounds only while `error !== undefined`. ErrorBanner's `onDismiss={clearError}` clears the error, and then the discarded statements come back under "判定を待っています". `stop()` never sets an error, so after 停止 the unconfirmed round stays with "判定を待っています", and the status line is empty: nothing says the run was stopped. The other panels say "生成を停止しました".
**Evidence**: `error === undefined ? view.turns : confirmedRoundTurns(...)`. `CouncilPanel.test.tsx` has no test for dismiss or stop.
**Confidence**: high
**Fix**: Base the filter on the run outcome, not on the banner. Once a run has ended (`status` is `ready` or `error`) without `data-council-result`, show only confirmed rounds. Add a "stopped" status message. Add tests for dismissing the banner and for stopping mid-round.

### [MEDIUM] F-4 Every requirements 409 is read as "complete": a busy-lock 409 ends the interview on screen and offers a broken download
**Location**: `apps/web/components/requirements/InterviewPanel.tsx:131-134, 278-286, 348-352`; server `app/api/requirements/sessions/[id]/messages/route.ts:103,111`
**Issue**: The server returns 409 both for "この面接はすでに完了しています。" and for "前の回答を処理中です。終わってからもう一度送ってください。". The panel sets `alreadyComplete` for any 409.
**What the learner sees in the bad case**: "面接が完了しました。" and "回答の受付は終了しました。要件定義書をダウンロードできます。". The answer form is removed, the server's message is never shown, and the download button becomes an enabled link. That link hits `GET …/document`, which returns 409 because no document exists, so the browser reports a failed download or saves an error file. The only way forward is "新しい面接を始める", which throws away a session that was still alive.
**Reachability**: Low. Within one panel `running` blocks double submit. It needs a retry racing the server's lock release, or a second client on the same session.
**Confidence**: medium (consequence is certain, reachability is low)
**Fix**: Have the server tell the cases apart (for example `details.reason: "completed" | "busy"` through the public-details allow-list). Treat only "completed" as complete. Otherwise show the server's message with a retry. Add a unit test for the busy 409.

### [MEDIUM] F-5 The credential notice blames the inquiry; the kinds come from the agent's draft answer
**Location**: `apps/web/components/helpdesk/HelpdeskPanel.tsx:165`
**Issue**: The screen says "問い合わせに認証情報が含まれていました。". `credentialKinds` comes from `detectCredentialShapes(answer)` on the agent's draft answer (`helpdesk.ts:350-370`, Req 2.8, plan "問い合わせ本文に含まれるものは…検査せず"). The learner is told the wrong thing about what the guard does.
**Evidence**: `const earlier = detectCredentialShapes(answer)` → `emit({ …, credentialKinds: earlier })`. The unit test only checks that the text contains "値は表示しません", so it passes with the wrong sentence.
**Confidence**: high
**Fix**: Reword, for example: "回答の下書きに認証情報の形をした文字列が見つかったため、回答を作り直しました（種別だけを表示し、値は表示しません）". For escalated tickets, say it was escalated. Assert the sentence in the test.

### [MEDIUM] F-6 The globalThis defined-tool set can now be forged or replaced, and the comment claims otherwise
**Location**: `packages/ai-core/src/aci/define-tool.ts:24-42`
**Issue**: `Symbol.for` keys are global. Any code in the process can call `globalThis[Symbol.for("@platform/ai-core/aci/defined-tools")].add(lookAlike)` and pass `isDefinedAciTool`. It skips `defineAciTool`'s name, description, schema and risk checks; `buildToolSet` still re-checks `risk`. Code that runs before the module loads can also install `{ has: () => true, add() {} }`. The doc comment "Only this module reads or writes the set, so nothing else can register a tool" is now false. No test covers forging or replacement. The old module-private WeakSet was unforgeable. The design guarantee is weaker and this is not recorded. The practical risk is low: code already in the process is trusted.
**Confidence**: high (that it can be forged); low (that it matters for security)
**Fix**: Install the holder with `Object.defineProperty(globalThis, KEY, { value: new WeakSet(), writable: false, configurable: false, enumerable: false })`, and on load check that an existing value is a real `WeakSet` (`Object.prototype.toString`). Correct the comment. Record the trade-off in tasks.md exception (13) and plan C2/C3. Better still, remove the need for it (F-7).

### [MEDIUM] F-7 The multi-bundle root cause has other symptoms: errors from a page-built MCP registry lose their class in the route
**Location**: `apps/web/app/mcp/page.tsx:31-40` (renders through `getServers()`, which creates the shared registry when the page runs first); `apps/web/app/api/mcp/chat/route.ts:84-91,141-142`; `apps/web/lib/server/errors.ts:123-140`; `packages/ai-core/src/mcp/connect.ts:350-368`
**Issue**: When the page bundle's copy of ai-core creates the registry, `registry.toolsFor()` throws that copy's `ConfigError` (a `PlatformError`). This happens for 21 tools (Req 1.15) or a tool outside the configured allow-list (Req 1.8). The route's `toPublicError` tests `error instanceof PlatformError` against its own copy, which fails. The learner gets 500 `unexpected` instead of 400 `invalid-request` with the message, and the result depends on whether `/mcp` was rendered before the first API call. The define-tool brand fixed one symptom of this. `fatalLatchOf`'s module-level WeakMap (`aci/tool-set.ts:38`) is safe today, because every `buildToolSet` and `createGuardedAgent` pair runs in the same module. It would silently return `undefined` (no latch, so Req 1.3 is lost) if a tool set ever crossed bundles.
**Confidence**: medium (the copies were observed by the author for define-tool; the instanceof failure follows from the same mechanism and I did not run it)
**Fix**: Create the registry only from one place, for example `instrumentation.ts` or the route modules, with the page reading status that a route created. Or classify platform errors by a brand (`Symbol.for("…platform-error")` on the prototype, or the `name` + `code` shape) instead of `instanceof`. Add a real-server test that renders `/mcp` first and then posts a 21-tool allow-list, expecting 400.

### [MEDIUM] F-8 `mcp-servers.json` is hand-written data passed through the handler; the E2E asserts reason text the product never produces
**Location**: `apps/web/app/api/mcp/servers/route.test.ts:21-36,120-132`; `apps/web/e2e/mcp.spec.ts:46,50`
**Issue**: The fixture comes from `GET` with `getMcpRegistry` mocked to a constant `STATUS`. The product text is `リスク区分が destructive のため登録しません（read-only にするには、サーバーが readOnlyHint: true を付ける必要があります）。` (`connect.ts:253`). The fixture text is `…登録しません。` and `認証に失敗しました（auth-failed）。`. The E2E checks those exact strings, so it checks the mock, not the product. 35.2 says "fixture は Route Handler の実際の出力から生成し、手書きしない".
**Confidence**: high
**Fix**: Generate the fixture from a real `connectMcpServers` against the in-process file server (as the chat route test does) plus a server that cannot connect. Assert in the E2E only on text the product emits.

### [MEDIUM] F-9 A sandbox that becomes unavailable at run time loses its `guidance`, and the form stays enabled
**Location**: `apps/web/components/analysis/AnalysisPanel.tsx:238-247`; `apps/web/lib/server/errors.ts:188-201` (`parseStreamErrorText` keeps only `code` and `message`)
**Issue**: `POST /api/analysis` returns 503 `provider-unavailable` with `details.guidance` (exception (9) exists for exactly this). ErrorBanner shows only the message. `setup` is fixed at page render, so the screen still says the sandbox is available and keeps the inputs enabled. Req 3.8 asks for the disabled display and the guidance. The same applies to the `sandbox-unavailable` result note "しばらくしてからやり直してください".
**Confidence**: high
**Fix**: Read `details.guidance` from the error body in AnalysisPanel and show it. On a 503 or `sandbox-unavailable` result, re-fetch `/api/analysis/status` or switch the panel to the disabled state. Add a test.

### [MEDIUM] F-10 W7 changes outside the boundary and undocumented deviations are not recorded in tasks.md
**Location**: `specs/003-domain-agents/tasks.md:41-62` (no exception (13)), W7 "Implementation Notes" (all empty)
**Issue**: The following files changed without an entry: `packages/ai-core/src/aci/define-tool.ts` and its test; 12 `app/api/**/route.test.ts` files (they are in the plan's File Structure but in no W7 `_Boundary:_`); `biome.json`; the six `.json` fixtures (35.2's boundary lists only `.sse`); `crypto.randomUUID` spied to fixed values; the MCP root rewritten to `/srv/mcp-workspace` in two fixtures. The FigureView, TableView and AnalysisPanel props change is inside the boundary but changes the components' contract, and plan C14 does not mention it. Under "Implementation Notes" the convention says the implementer adds 1–3 learnings; none were added.
**Confidence**: high
**Fix**: Add exception (13) listing these with reasons, sync plan C2/C14, and fill in Implementation Notes for 29–35.

### [LOW] F-11 W4 carry-over F-21 dropped (does a real Next.js disconnect abort `request.signal`?)
**Location**: `tasks.md:173` ("35.x の E2E で確かめる"); `e2e/real-server.spec.ts` (no abort or disconnect test)
**Issue**: No E2E aborts a request on the real server and checks that the sandbox is released, for example with a later `DELETE` returning `x-analysis-session: absent`. The item is neither done nor carried forward.
**Confidence**: high
**Fix**: Add a real-server test that aborts a `/api/analysis` request mid-stream and then checks the header from `DELETE` (`absent` means it was already released). Otherwise, carry it forward explicitly.

### [LOW] F-12 35.1 verification "トップから 6 画面に遷移できる" is not covered by any E2E
**Location**: `apps/web/app/page.tsx:47-76`; `e2e/real-server.spec.ts:49-65` (visits paths directly)
**Confidence**: high
**Fix**: Add one spec that opens `/`, checks the six links and labels, and follows each link.

### [LOW] F-13 The requirements completion path runs only on a hand-transformed fixture; the real route's end is never exercised
**Location**: `e2e/requirements.spec.ts:129-167`, `e2e/a11y.spec.ts` ("requirements sufficient verdict…"), `e2e/real-server.spec.ts` (the requirements test stops after round 1)
**Issue**: `transform` drops `data-requirements-questions` and rewrites the judgement. No generated fixture covers a round that completes or a forced end. No real-server check covers `GET …/document` (200, `Content-Disposition`). The analysis row-limit E2E likewise injects 250 rows, which the server would never send. That one is acceptable as a client-side defence, but it does not exercise the product.
**Confidence**: high
**Fix**: Generate `requirements-complete.sse` from the M3_5 sufficient scenario. Add a real-server test that finishes an interview and downloads the document.

### [LOW] F-14 The report turns any https link into a clickable link
**Location**: `apps/web/components/research/ReportView.tsx:122-157`
**Issue**: `checkCitations` keeps links to non-paper hosts ("A link to somewhere else can still carry an ID in its text"). The report is model text built from external abstracts, so a prompt-injected abstract can become a clickable phishing link. AgentInspector, by contrast, links only `https://arxiv.org/abs/…`.
**Confidence**: medium
**Fix**: Link only arXiv addresses and the links of fetched papers. Render others as text, or show the host next to the label.

### [LOW] F-15 Recommend retry adds a duplicate user message
**Location**: `apps/web/components/marketing/RecommendPanel.tsx:210-215`
**Issue**: `retry()` calls `sendMessage({ text })` again, so the conversation sent to the server holds the failed user message twice, and the profile extraction sees it twice. McpPanel uses `regenerate`.
**Confidence**: high
**Fix**: Use `regenerate({ body: { profile } })`.

### [LOW] F-16 MCP panel: refresh during a run hides the newer server state; the over-limit state still allows send
**Location**: `apps/web/components/mcp/McpPanel.tsx:133-148,213-221,356`
**Issue**: "状態を更新" stays enabled while generating. A refresh during a stream sets `refreshedAt = messages.length`, which already counts the streaming assistant message, so the finish metadata (a server that dropped during the run, Req 1.10) never wins. Turning the think tool on with 20 tools selected shows an alert but leaves 送信 enabled (the server returns 400, which is acceptable).
**Confidence**: medium
**Fix**: Disable refresh while generating, or compare against the message id instead of the count.

### [LOW] F-17 Sample texts and limits are duplicated instead of imported
**Location**: `app/helpdesk/page.tsx:19-32`, `components/research/ResearchPanel.tsx:28-31`, `components/requirements/InterviewPanel.tsx:24`
**Issue**: The help-desk examples and research themes repeat the strings of `M3_2_SAMPLE_INQUIRIES` and `M3_4_SAMPLE_THEMES`; `/mcp` imports its constants. `MAX_ANSWERS_PER_REQUEST = 10` repeats the server's limit. These can drift apart silently.
**Confidence**: high
**Fix**: Pass them from the page using the `@platform/ai-core/mock` and `MESSAGES_REQUEST_LIMITS` constants.

### [LOW] F-18 The unseeded state is detected by searching message text
**Location**: `app/marketing/page.tsx:29-31`, `components/marketing/RecommendPanel.tsx:43-46`
**Issue**: `message.includes("seed:samples")` decides which UI to show. Rewording the server message silently breaks the guidance.
**Confidence**: medium
**Fix**: Send a `details.reason` or `guidance` key from the server, as the analysis route does.

### [LOW] F-19 Weak keyboard and E2E checks
**Location**: `e2e/keyboard.spec.ts` (marketing test: `getByLabel("広告文案").focus()`); `e2e/mcp.spec.ts:146`
**Issue**: The marketing "keyboard only" test focuses the textarea programmatically. The MCP fatal test's `送信 toBeDisabled()` passes only because the input is empty, not because of the error state.
**Confidence**: high
**Fix**: Reach the textarea with `tabTo`. Drop the vacuous assertion, or assert something the error state actually causes.

### [LOW] F-20 Minor analysis UI issues
**Location**: `components/analysis/AnalysisPanel.tsx:255-259`; `app/analysis/page.tsx:52-71`
**Issue**: Notices use `key={reason}` (React key collision on repeated reasons). When no model is available, the page shows only the "no model" alert and hides the disabled-sandbox guidance. FigureView drops a figure on the client without saying so; the server limit is the same, so this is unlikely.
**Confidence**: medium
**Fix**: Key notices by index plus reason. Render SandboxNotice before the model check.

## Verified OK

- No `dangerouslySetInnerHTML` or `innerHTML` in any W7 component. Statements, answers, reasons, report text, cells and captions are React text nodes (tests cover markup-as-text for ReportView, TableView, FigureView alt and TicketList).
- FigureView: exact `image/png`, a strict base64 alphabet with length % 4, the PNG signature prefix, the byte limit, and non-empty trimmed alt. The `data:` prefix is constant. SVG and HTML render nothing (tests for SVG/HTML payloads, non-PNG base64, the limit ±1 and exact-limit).
- TableView draws at most `maxRows` and shows "N 件中 M 件を表示" with `max(totalRows, rows.length)`.
- AgentInspector links only `https://arxiv.org/abs/…`. ReportView refuses `javascript:` and `http:` and never links `![`.
- Credential kinds are filtered to the closed vocabulary, so values never reach the DOM. The MCP fatal notice shows the allowed root, as Req 1.3 requires.
- No W7 client component imports `@platform/ai-core/config` (only a comment in FigureView, and a test). Pages pass limits as props (the client-bundle concern is resolved).
- Generated fixtures are compared byte for byte at every gate run (`verifyOrWriteFixture`), so a stale fixture fails. `mise run e2e:fixtures` regenerates them. UUIDs are pinned, so regeneration is deterministic.
- W6 F-18: the requirements document is only downloaded, never rendered. The fixed `requirements.md` name is used. The button is a real disabled button before the document exists.
- Analysis: `sessionId` is a client UUID that stays the same across analyses and is renewed after a successful end. End calls `stop()` before `DELETE`. A failed end is reported. Disabled sandbox locks every input and hides "セッションを終了" (unit and E2E).
- Requirements: 404 shows the expiry guidance and start-over (unit and E2E). Answers are kept on failure and resent on retry. Only filled answers are sent, 1–10.
- Status `aria-live` regions in all panels are rendered unconditionally, not re-created, so changes are announced. Inputs have labels, persona checkboxes have `aria-label`, and the table scroll region is focusable.
- Spot mutations, reasoned against the tests: dropping `previous` in the help-desk tracker; dropping the credential-kind filter; always showing all council turns; ignoring 409/404 in InterviewPanel; removing the PNG prefix check; the table slice; the allow-list limit disabling; the new session id after end; the https-only link check. The existing tests kill each of these. The survivors are the batched-revision case (F-2), dismiss and stop in the council (F-3), and the credential sentence (F-5).
- HelpdeskPanel, CouncilPanel and InterviewPanel tests: 62/62 pass (single-file vitest).

## Verdict
REQUEST_CHANGES

Counts: CRITICAL 0 / HIGH 1 / MEDIUM 9 / LOW 10

## Hallucination Signal
forced: false

## Responses (2026-10-25, implementer)

修正はテスト先行で行い、各修正の変異（PROVE）は実装者が自分で実行して確かめた。修正後の gate は exit 0（87.9 秒）、E2E は 3 エンジン 735 件成功、`check:client-bundle` は成功。修正後の新しいコンテキストでの再レビューは未実施。

- **F-1（HIGH）修正**: `getHelpdeskStore` が `mock` のときだけ FAQ を投入する（`ensureMockFaq`、同じ DB には 1 回。サンプルのチケットは入れず `T-0001` を保つ）。`platform.test.ts` に 4 ケース（mock で投入、local・live で投入しない、1 回だけ）。変異 3 件が検出された。実サーバーの E2E は「解決済み」と回答の本文、「未解決」のエスカレーションを検査する。ただし回答の本文はシナリオ台本のもので、他の spec が先に知識ベースを埋めると FAQ の投入そのものは E2E では判別できない（投入の保証は `platform.test.ts`）。
- **F-2 修正**: `onData` で版ごとに計画を記録し、`revision - 1` と対にする。一括配信と版の飛びのテスト。変異 6 件が検出された。
- **F-3 修正**: 実行の結果（`ready` / `error` で結果なし）で未確定のラウンドを隠す。バナーを閉じても戻らず、停止の文言も出す。変異 3 件。**F-15 修正**: 再試行は `regenerate`。変異 2 件。ただし実際の送信本文に重複がないことは、`useChat` をモックしたテストでは確かめていない（`regenerate` の呼び出しと `sendMessage` の不使用だけ）。
- **F-4 修正**: 409 に `error.details.reason`（`completed` / `busy`）を足し、画面は `completed` のときだけ完了とみなす。3 層のテスト。
- **F-5 修正**: 認証情報の通知を「回答の下書き」に対するものに直した（再作成 / エスカレーションで文言を分ける）。
- **F-6 修正**: 定義済みツールのホルダーを置き換え不可にし、本物の `WeakSet` 以外は拒否。**F-7 修正**: `PlatformError` を印で判定する（別コピーのモジュール間でも `instanceof PlatformError` が成り立つ。サブクラスはコピーごと）。実サーバーの E2E で F-7 の再現はできなかった（HTTP 経由ではルート自身の検査が先に答える）ため、守っているのは単体テストだけ。`latchOfToolSet` はコメントのみ。
- **F-8 修正**: `mcp-servers.json` を本物の `connectMcpServers`（自作のファイルサーバーと、起動できない `github`）から生成し、`mcp.spec.ts` を製品の文言に直した。`readOnlyHint` の文言は自作サーバーでは出ないため検査していない。
- **F-9・F-20 修正**: 503 の `details.guidance` と `sandbox-unavailable` の結果で無効状態に切り替える。通知のキー、モデルなしでもサンドボックスの案内を出す。変異は 7 件中 6 件が検出され、1 件は等価。
- **F-12・F-13・F-19 修正**: トップの 6 リンクの spec、要件の面接を最後まで進めて `GET .../document` を確かめる実サーバーの spec、キーボードの spec を `tabTo` に直した。
- **F-14・F-16 修正**: レポートのリンクは arXiv のアドレスだけ。MCP の更新ボタンは実行中に無効にし、新旧の比較をメッセージ ID で行う。
- **F-10 対応**: `tasks.md` に例外 (13) と Implementation Notes を書いた。例外 (13) は 2026-10-25 に人が承認し、plan へ同期した（C2 の複数のモジュールコピー、C13 の `ensureMockFaq` と 409 の `details.reason`、C14 の props と確定していない結果、C16 の fixture の扱い）。
- **持ち越し**: F-11（切断の検証。モックが速すぎて観測できない。`research.md` の W7 の節）。F-17（入力例と上限の重複。`M3_*_SAMPLE_*` と `MESSAGES_REQUEST_LIMITS` を page から渡す形への変更）と F-18（未投入の判定を文言の検索でなく `details` で行う）は、W8 の 40.x で扱う。
