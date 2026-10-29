# Adversarial review: 003-domain-agents, implementation wave W5 (tasks 21–24), 2026-10-19

Scope: uncommitted work on `feat/m3-w1-foundation`: `git diff HEAD` (19 modified files) plus the untracked `packages/ai-core/src/research/**`, `packages/ai-core/fixtures/arxiv/*.xml`, `packages/ai-core/fixtures/scenarios/m3-4.ts`, `packages/ai-core/src/mock/arxiv-fixtures{,.test}.ts` and `apps/web/app/api/research/**`.
Reviewer context: fresh, without the implementer's reasoning. I did not treat `pdca/do.md` or the Implementation Notes as evidence. I did not run `mise run gate`, `test:e2e`, Stryker, `next build` or any server, as instructed. I did not verify the mutation score (83.17) for `citations.ts` / `budget.ts`.

## Evidence gathered

- Targeted suites, all run with `env -u NODE_ENV mise exec -- pnpm exec vitest run … --coverage.enabled=false`:
  - `packages/ai-core`: `src/research src/agents/token-ledger.test.ts src/agents/observer.test.ts src/mock/arxiv-fixtures.test.ts src/mock/m3-scenarios.test.ts` gave 14 files, `executed=483 passed=483`.
  - `apps/web`: `app/api/research lib/server/domain-stream.test.ts lib/server/platform.test.ts` gave 3 files, `executed=139 passed=139`.
- Probes. I wrote these under `…/scratchpad/review/` only. They import the real sources by absolute path:
  - `probe1.ts` / `probe2.ts`: about 90 report snippets run through `checkCitations` with node.
  - `redos.ts`: timing of `checkCitations`.
  - `parse.probe.ts`: vitest with a scratch config, covering the parser, the client cache and the tools.

| Probe | Input | Observed |
|---|---|---|
| C-slip | `_2312.99999_ は新しい。` / `https://huggingface.co/papers/2312.99999` / `https://www.alphaxiv.org/abs/2312.99999` / `https://m.arxiv.org/abs/2312.99999` / `10.48550/arXiv.2312.99999` / `https://arxiv.org/ABS/2312.99999` / `https://arxiv.org//abs/…` / `CS/0501002` / `arXiv:CS/0501002` / full-width `２３１２．９９９９９` / `2312.\n99999` | report unchanged, `removed: []` (unknown paper survives) |
| C-text | `[2312.99999](https://arxiv.org/abs/2401.01234)` and `[Hierarchical Agents (2312.99999)](https://arxiv.org/abs/2401.01234)` (known link, unknown ID in text) | unchanged, `removed: []` |
| C-adjacent | `手法 Z は [Fake][1] で提案された。\n\n[1]: https://arxiv.org/abs/2312.99999` | `"手法 Z は [Fake][1] で提案された。\n"`. Only the definition goes |
| C-adjacent | `性能が向上した[^1]。\n\n[^1]: 2312.99999` | `"性能が向上した[^1]。\n"` |
| C-adjacent | `- 2312.99999: Fake paper\n  続きの説明で性能が 10% 向上した。` | `"  続きの説明で性能が 10% 向上した。"` |
| C-destroy | known `2401.01234` (feed links abs, pdf, `http://dx.doi.org/10.1145/3600000.3600001`): `https://doi.org/10.48550/arXiv.2401.01234` | whole sentence removed, warning "集合に無い" |
| C-destroy | same paper: `https://doi.org/10.1145/3600000.3600001` (feed has `dx.doi.org`) | removed |
| C-destroy | same paper: `https://www.semanticscholar.org/arxiv/2401.01234` | removed |
| C-ok | `arXiv:` / `ARXIV:`, `v0`/`v12`, `abs`/`pdf`/`html`, `.pdf`, `?query`, `#frag`, `export.`/`www.`, no scheme, `<…>` autolinks, HTML `<a href>` (both quotes), pipes in link text inside table rows, `hep-th/…`, `math.GT/…`, headings, bold, quotes, CRLF | handled correctly |
| Cache | run A `client.search(...)`; run B uses a fresh `PaperCollector` and only `getPaperAbstract(id)` | tool `ok: true`, B's collector `['2401.01234']`, `checkCitations` keeps it |
| Parser | 200,000-deep nesting | `ArxivFeedError` in 45 ms (no crash) |
| Parser | 15,000 entries (1.74 MB, under the 2 MB cap) | parsed, all 15,000 returned (client asked for 10) |
| Parser | one entry with `<published>n/a</published>` in the multi fixture | whole feed → `ArxivFeedError` (retryable) |
| Timing | 5,000 unknown IDs on one line | 3,237 ms, 5,000 warnings. Other hostile shapes (`[`×50k, `a-`×50k, URL×5k) take ≤ 27 ms |

- Static checks:
  - No `TODO` / `FIXME` in the new code.
  - No change to any `package.json` or `pnpm-lock.yaml` (`git diff HEAD --stat` is empty for them).
  - `fast-xml-parser@5.11.2` was already declared in `packages/ai-core/package.json` (commit `ee815d5`), and so was the `./research` export.

## Trigger resolution

### Trigger (a) wave closing rule: done (this report). Tasks 24.1 and 24.2 are still `[ ]` in `tasks.md` although `stryker.config.mjs` already carries 24.1's change (F-12)

### Trigger (b) files outside `_Boundary:_`: confirmed, and fully covered by exception (11)

| File | Covered by | Judgement |
|---|---|---|
| `agents/token-ledger.ts` (+test), `agents/observer.ts` (+test), `agents/index.ts` | exception (11), W1 F-10/F-11 carry-over | Justified, and the tests only add cases (+41/+59 lines, nothing removed). `usageFromRun` and `forAgent` / 512-character `source` cap. See "Prior items" below. |
| `research/request-schema.ts` (+test) | exception (11) | Justified (no `zod` in `apps/web`; same pattern as helpdesk exception (7)). |
| `research/scenarios.test.ts` | exception (11) | Test only. |
| `mock/arxiv-fixtures.ts` (+test), `mock/index.ts` | exception (11); `mock/index.ts` is also in 22.5 | Justified. The fetcher refuses anything but `https://export.arxiv.org/api/query`. |
| `research/tools.ts` `onCall`/`onFailure`, `subagents.ts` `failureReasonOf`, `supervisor.ts` `onUsage` | inside the 21/22 boundaries anyway; listed for API visibility | Fine. |
| `plan.md`, `tasks.md`, `pdca/do.md` | process documents | `plan.md` edits checked under trigger (c). |

Nothing changed outside the boundaries that exception (11) does not name.

### Trigger (c) edits to `real-server.spec.ts`, `stryker.config.mjs`, `plan.md`

- `real-server.spec.ts`: append-only (+52 lines, 3 new `research:` tests, 1 import). No existing case was touched.
- `stryker.config.mjs`: +2 `mutate` entries (`research/citations.ts`, `research/budget.ts`), nothing removed. I did not run Stryker.
- `plan.md`: the C8 and C9 public interfaces and the File Structure Plan rows match the code (signatures of `createArxivClient`, `createResearchTools`, `runResearch`, `checkCitations`; the three new files). **One edit weakens a requirement**: the new C9 text says "Supervisor 自身のトークンは終了時に予算へ足すため、合計は `maxTotalTokens` を Supervisor の使用分だけ超えうる". That contradicts CL-17 ("Supervisor は Run 全体の `maxTotalTokens` を持ち"), which was left unchanged, and the `DEFAULT_RESEARCH` row ("トークンは Supervisor と子の合計"). See F-1. The C9 line "`TokenLedger` … `RunObserver` から記録する" was not synced (F-11).

## Critique

### [MEDIUM] F-1 The supervisor's own tokens are outside the shared budget, and its cap (20,000) ignores `maxTotalTokens`; the plan was edited to allow it while CL-17 still forbids it
**Location**: packages/ai-core/src/research/supervisor.ts:86-94, :159-160, :227-228; specs/003-domain-agents/plan.md C9 (new text)
**Issue**: The budget sees the supervisor's spend only after the supervisor ends. While it runs, every child is offered `maxTotalTokens − children's spend`. The supervisor's own limit is a fixed `maxTotalTokens: 20_000`, so a run can overshoot the shared budget by the supervisor's whole spend. With a smaller budget the overshoot is a multiple of it.
**Evidence**: `budget.recordUsage("supervisor", usageFromRun(run));` comes after `await supervisor.done`, and `supervisorLimits` returns `maxTotalTokens: 20_000` whatever the caller passes. `supervisor.test.ts:370-376` runs with `maxTotalTokens: 240` and ends with a total of 240 (search) + 480 (supervisor) = 720, three times the budget, and passes. Its comment ("240 of the 300 tokens") is stale. CL-17: "Supervisor は Run 全体の `maxTotalTokens` を持ち、各サブエージェント呼び出しの上限には残量を渡す"; plan `DEFAULT_RESEARCH`: "トークンは Supervisor と子の合計（CL-17）".
**Confidence**: high
**Fix**: Record the supervisor's usage per step (for example an `onStepFinish` / observer step hook feeding `budget.recordUsage("supervisor", …)`), so `remainingTokens()` includes it. Derive the supervisor's `maxTotalTokens` from the shared budget (`min(20_000, maxTotalTokens)`), or use a stop condition that reads `budget.remainingTokens()`. Then add a test that `usage.total.totalTokens ≤ maxTotalTokens + one step` holds. If the overshoot is meant to stay, change CL-17 and get it approved; a C9 sentence alone does not override a Clarification.

### [MEDIUM] F-2 The citation check lets unknown papers through in several realistic shapes (Req 4.5)
**Location**: packages/ai-core/src/research/citations.ts:12-24 (`BARE_ID` lookbehind/lookahead), :64-78 (`classifyUrl`), :113-121
**Issue**: Some unknown arXiv IDs survive in the report. These are the shapes that slip through:
- Underscore emphasis (`_2312.99999_`, `__…__`): `\w` in the lookarounds covers `_`.
- An ID inside a link to a host that is neither arXiv nor in `PAPER_HOSTS`. Examples: `huggingface.co/papers/<id>` (very common in LLM output), `alphaxiv.org/abs/<id>`, `paperswithcode.com`, `m.arxiv.org`. An unclassified bare URL produces no mention at all, and the ID inside it is never checked.
- The bare arXiv DOI `10.48550/arXiv.<id>` (lookbehind `/`).
- An unknown ID in the *text* of a Markdown link whose address is a known paper. The text is never scanned when the address classifies.
- `arxiv.org/ABS/…`, `arxiv.org//abs/…`, and upper-case old-style IDs (`CS/0501002`, `arXiv:CS/…`).
- Full-width digits, and an ID split by a line break or a zero-width space.
**Evidence**: Probe C-slip and C-text: each input came back unchanged with `removed: []`. Req 4.5: "本文中のすべての arXiv ID とリンクを…照合し、集合に含まれない論文への言及を除去".
**Confidence**: high (probed)
**Fix**:
- Drop `_` from the lookbehind/lookahead (use `[A-Za-z0-9./-]`).
- For any URL that does not classify, still scan it for the `ID_BODY` / `arXiv.<id>` pattern and treat a hit as an arXiv mention. Add `huggingface.co/papers`, `alphaxiv.org`, `m.arxiv.org` and `doi.org/10.48550/arXiv.` explicitly.
- Scan link text even when the address is a known paper.
- Match the path case-insensitively and collapse `//`.
- NFKC-normalise the line before matching, mapping the offsets back, or at least warn on full-width digit runs.
- Add each shape as a test.

### [MEDIUM] F-3 The citation check removes papers that were fetched, when they are cited by DOI or on another site
**Location**: packages/ai-core/src/research/citations.ts:28-41, :54-61, :77, :298-303
**Issue**: A non-arXiv link is kept only if its normalised address equals one of the paper's feed links byte for byte. Three real citation forms of a fetched paper are therefore removed together with their whole sentence, and the learner is told the paper is "not in the set":
- the arXiv DOI (`https://doi.org/10.48550/arXiv.<id>`), which arXiv's own feed never lists;
- the journal DOI on `doi.org` when the feed lists `dx.doi.org`;
- a Semantic Scholar `arxiv/<id>` URL.
**Evidence**: Probe C-destroy. All three were removed, e.g. `REM: ["https://doi.org/10.48550/arXiv.2401.01234"]`, and the warning says "検索で取得した論文の集合に無いため、その言及を除去しました".
**Confidence**: high (probed)
**Fix**:
- Map `doi.org/10.48550/arxiv.<id>` (case-insensitive) to an arXiv mention with key `<id>`.
- Normalise `dx.doi.org` → `doi.org` and compare DOIs case-insensitively (DOIs are case-insensitive).
- Treat a paper-site URL that embeds an arXiv ID as an arXiv mention.
- Add tests that cite a fetched paper by each form.

### [MEDIUM] F-4 Removal is limited to a line or sentence, so text about an unknown paper on neighbouring lines survives
**Location**: packages/ai-core/src/research/citations.ts:207-245
**Issue**: The check removes the line or sentence that holds the ID. When the ID sits on a different line from the claim, only the ID line goes and the claim stays. This happens with:
- reference-style links (`[Fake][1]` with `[1]: https://arxiv.org/abs/<unknown>`);
- footnotes (`[^1]` with `[^1]: <unknown>`);
- wrapped list items (continuation lines);
- a heading that carries the ID, whose section body stays and now sits under the previous heading.

Afterwards the claim has no citation, and the remaining text even has a dangling `[Fake][1]` / `[^1]`.
**Evidence**: Probe C-adjacent: `"手法 Z は [Fake][1] で提案された。\n"`, `"性能が向上した[^1]。\n"`, `"  続きの説明で性能が 10% 向上した。"`.
**Confidence**: high (probed)
**Fix**:
- Resolve reference definitions and footnotes first (map label → URL/ID) and treat each use site as a mention.
- Remove the indented continuation lines of a removed list item.
- When a heading is removed, either keep it and remove the ID only, or warn that its section stays.
- Pin each case with a test.

### [MEDIUM] F-5 The set the report is checked against includes papers from the process-wide cache, not only what this run's search sub-agent fetched
**Location**: packages/ai-core/src/research/tools.ts:173-186 (`ingested([paper])` in `getPaperAbstract`), subagents.ts:251-252, arxiv/client.ts:252-261, apps/web/lib/server/platform.ts:838-856 (one client per process)
**Issue**: `getAbstract` searches the one cache that every run in the process shares. `getPaperAbstract` then adds whatever it finds to the current run's collector. So a supervisor can name any ID that any earlier run (another learner's, or yesterday's) searched, read it, and cite it without this run's search sub-agent ever fetching it, and the check keeps it. The tool's error text "この調査の検索結果にありません" is also wrong, because the lookup is not scoped to "この調査".
**Evidence**: Probe "Cache". Run A searched; run B used a fresh collector and only `getPaperAbstract`. Result: `runB tool ok: true collector: ['2401.01234'] removed: []`. Req 4.5: "検索サブエージェントが取得した論文の集合と照合".
**Confidence**: high (probed)
**Fix**: Give `getPaperAbstract` the run's collector, or the IDs the search sub-agent returned, and refuse IDs outside it. Only the search tool's `onPapers` should add to the set. Add a test with a pre-warmed cache and a run that never searched.

### [LOW] F-6 A sub-agent that is cut off by the supervisor's timeout, or by the tool timeout, is missing from `missing`, and the supervisor's 900 s limit is shorter than its own call budget
**Location**: packages/ai-core/src/research/subagents.ts:303-304; supervisor.ts:86-94
**Issue**: When `context.abortSignal` fires, `run` throws before `onOutcome`. The ACI layer turns that into a `timeout` result for the supervisor. But the system-written "調査できなかった観点" section, which the supervisor is told *not* to write itself, never names that sub-agent.
- `maxDurationMs: 900_000` is fixed, while 8 calls × 180 s per child is 1,440 s. On a slow `local` model the supervisor times out mid-child, and only "supervisor: 時間の上限" appears.
- `supervisorLimits` derives `toolTimeoutMs` from `DEFAULT_SUBAGENT_LIMITS`, not from `params.limits.subagent`. A configured child with `maxDurationMs ≥ 200 s` reaches the tool timeout first.

**Evidence**: `if (context.abortSignal.aborted) throw context.abortSignal.reason;` comes before any `fail(...)`. `toolTimeoutMs: DEFAULT_SUBAGENT_LIMITS.maxDurationMs + 20_000`.
**Confidence**: medium
**Fix**:
- When the caller's signal is not aborted but the context signal is (tool timeout or supervisor timeout), call `onOutcome` with a `failed` result before rethrowing.
- Derive the supervisor duration from `maxSubagentCalls × child.maxDurationMs` plus a margin, and derive `toolTimeoutMs` from the effective child limits.

### [LOW] F-7 arXiv client: one bad entry fails the whole search and is retried as if it were transient; the result count is not enforced; HTTP 400 is retried
**Location**: packages/ai-core/src/research/arxiv/parse.ts:114-128, :145; client.ts:173-192
**Issue**:
- `paperOf` throws for the whole feed when one entry has an odd id, title or date. Parse errors are `retryable: true`, so a deterministic bad feed costs 4 requests and about 21 s of waits before the search becomes a gap.
- HTTP 400 (bad query) is retried the same way. That follows plan line 991, but it cannot get better.
- The client asks for `max_results ≤ 10` but returns every parsed entry. A misbehaving or hostile feed under 2 MB passes thousands of papers to the tool, which returns all of them (1,200-character abstracts each) to the model.

**Evidence**: Probes "Parser": one `<published>n/a</published>` → `ArxivFeedError`; 15,000 entries returned.
**Confidence**: medium
**Fix**:
- Skip (and count) unusable entries instead of failing the feed, and fail only when every entry is unusable or the feed is an error feed.
- Make the error feed / 400 non-retryable, or retry once.
- `slice(0, maxResults)` in the client.

### [LOW] F-8 The citation check is quadratic in the number of unknown mentions on one line, and removal warnings are not capped
**Location**: packages/ai-core/src/research/citations.ts:149-165, :229-242, :318-320
**Issue**: Each unknown mention scans its line for sentence bounds and re-filters the known mentions. A long single-line report full of invented IDs blocks the event loop for seconds. Every distinct removed ID adds one warning line, while only the "no ID" warnings are capped at 5.
**Evidence**: Probe "Timing": 5,000 unknown IDs on one line took 3,237 ms and produced 5,000 warnings.
**Confidence**: medium (the supervisor's 20 k token cap bounds realistic input well below this)
**Fix**: Compute the sentence bounds once per line, and cap removal warnings like `MAX_REFERENCE_WARNINGS`, with a count line.

### [LOW] F-9 The Agent Inspector streams sub-agent summaries before, and outside, the citation check
**Location**: packages/ai-core/src/research/subagents.ts:311; apps/web/lib/server/domain-stream.ts:198 (`summary: { text }`)
**Issue**: `summary` events carry the child's own text, clipped to 800 characters. An invented ID in a child's summary reaches the browser as-is, even though the report later removes it. Req 4.5 is about the report, but a learner sees both side by side.
**Evidence**: `emit({ agent: kind, kind: "summary", detail: { text: answer } });` and no check before it.
**Confidence**: medium
**Fix**: Run `checkCitations(answer, papers.all())` on the summary for the event (and possibly for the result handed to the supervisor), or mark unchecked IDs in the UI.

### [LOW] F-10 `data-research-result` does not carry the usage or the call count that plan C13 lists for it
**Location**: apps/web/lib/server/domain-stream.ts:284-294; plan.md line 546
**Issue**: The plan says `data-research-result` is `ResearchResult` (report, warnings, missing, usage, calls). The route writes only `report`, `warnings` and `missing`. The final usage is the last `data-research-usage` state part instead. Req 4.10 is met through that part, but the part contract differs from the plan, and a client that keeps only the result has no totals.
**Evidence**: `data: { report: …, warnings: […], missing: … }`.
**Confidence**: high
**Fix**: Add `usage` and `calls` to the result part, or change the plan row to say that the totals live in the final `data-research-usage`.

### [LOW] F-11 Prior items W1 F-10 / F-11: closed in substance, but the plan text is stale and one part is still open
**Location**: packages/ai-core/src/agents/token-ledger.ts:86-98; observer.ts:43-74; plan.md C9 "`TokenLedger` … `RunObserver` から記録する"
**Issue**:
- F-10 asked for a `ledgerObserver` that maps `AgentRunSummary.totalTokens`. The implementation adds `usageFromRun(summary)`, which the caller applies after `done`. The mapping and the "unknown, not zero" rule are fixed and tested, but C9 still says the ledger records from `RunObserver`.
- F-11 is closed for the agent name (`forAgent`) and the 512-character cap, both tested. An ingestion is still not linked to a run.
- No route passes `externalContent` to `runResearch`, so the CL-10 record is never produced by the running app (by grep, true of every M3 route).

**Evidence**: `budget.recordUsage(kind, usageFromRun(summary))` in subagents.ts:302; `grep externalContent apps/web/app/api/**/route.ts` → none.
**Confidence**: high
**Fix**: Sync C9 ("`usageFromRun` で `AgentRunSummary` から記録する"). Record in CL-10 / 004 handoff that M3 routes do not wire the log yet. Optionally add a run id to `forAgent`.

### [LOW] F-12 Task status and plan-edge rules not enforced
**Location**: specs/003-domain-agents/tasks.md:311-318; plan.md line 992; packages/ai-core/src/research/subagents.ts:139-146
**Issue**:
- 24.1 is `[ ]` although its change is in the tree, and 24.2 (gate measurement) is open. The wave cannot be archived as `tasks-comp-w5.md` until both are done.
- Plan line 992 says an empty feed must make the report state "該当する論文が見つからなかった". The code relies only on the search child's instruction: a `found.size === 0` search that is not `arxivDown` returns `ok`, and nothing guarantees the statement.
- The search result handed to the supervisor is a free-text summary plus IDs, so authors and dates from Req 4.3 reach only the UI cards, not the supervisor. This is a reasonable reading of 4.3 together with 4.4, but it is not written down.

**Evidence**: `if (arxivDown && found.size === 0) return fail(…)` is the only empty-result branch.
**Confidence**: medium
**Fix**:
- Tick 24.1 after the Stryker run is quoted, and finish 24.2.
- When a search returned no papers, add a fixed note to the run (for example a `missing`-like "no papers found" line, or a report note).
- Write the 4.3/4.4 reading into C9.

### [LOW] F-13 The theme is placed between tags without escaping, and a theme with an ID loses the fallback report's heading
**Location**: packages/ai-core/src/research/supervisor.ts:125-139, :220
**Issue**:
- A theme containing `</research-theme>` closes the data block early. That is soft prompt-injection hardening only, and the theme is the learner's own input.
- `unableReport` / `assembledReport` put the theme into the report heading before `checkCitations`. A theme such as "2312.99999 の追試" therefore removes the `#` heading (or the whole "could not research" sentence) and adds a removal warning about the learner's own theme.

**Evidence**: probe `idInHeading`: `"## 2312.99999 の手法"` → `""`.
**Confidence**: medium
**Fix**: Neutralise `</research-theme>` in the theme. Run the citation check on the supervisor or child text before the code adds its own heading and `missing` section, or exempt those lines.

### [LOW] F-14 The 90 s child tool timeout includes the wait in the process-wide arXiv queue
**Location**: packages/ai-core/src/research/subagents.ts:36-42; arxiv/client.ts:224-249; apps/web/lib/server/platform.ts:847-856
**Issue**: The queue is shared by every run in the process (by design, for arXiv's terms of use). With a few concurrent research runs and a slow or failing arXiv (up to 4×15 s + 21 s per search), a search can time out while it is still waiting in the queue. A `timeout` failure is not `source-unavailable`, so `arxivDown` stays false. If the child then answers "nothing found", it is reported as `ok` rather than as a gap.
**Evidence**: `onFailure` sets `arxivDown` only for `PlatformError` code `source-unavailable`. The tool timeout is a `ToolOutcome` failure produced in `executeWithGuards`, not an error that reaches `onFailure`.
**Confidence**: low
**Fix**: Treat any failed `searchArxiv` with `found.size === 0` as a gap, or count tool timeouts as `arxivDown`.

## Requirement fidelity (spec 4.1–4.10)

| Req | Code | Pinning test | Would it catch a wrong behaviour? |
|---|---|---|---|
| 4.1 | `createSubagent` ×3, `strictObject` input schemas, `risk: "read-only"` | `subagents.test.ts` "definitions", "offers each only its own tools" | Yes |
| 4.2 | `runResearch` (Markdown text, assembled fallback) | `supervisor.test.ts` "a run that works", scenarios, route mock run, E2E | Yes. The Markdown sections are only asked for in the prompt, not checked |
| 4.3 | `searchArxiv` → `summaryOf` (title, authors, date, ID, abstract) | `tools.test.ts:112` | Yes for the tool. See F-12 for what reaches the supervisor |
| 4.4 | `SubagentResult` (status, agent, summary, paperIds), 800-character clip | `subagents.test.ts:245` checks keys, absence of abstract and tool call | Yes |
| 4.5 | `checkCitations` + `attachCitationWarnings` | `citations.test.ts` (568 lines), supervisor/route/E2E "未取得の手法 X" | Partly: F-2, F-3, F-4 and F-5 pass the suite |
| 4.6 | `fail(...)` → `onOutcome` → `missing` → `missingSection`; `unableReport` | `supervisor.test.ts:385-429`, route partial failure, E2E | Yes for model errors and refusals. No for the abort/timeout path (F-6) |
| 4.7 | client retries (1 + 3), `Retry-After`, back-off 3/6/12 s, cap 30 s; `arxivDown` → gap | `client.test.ts:314-427`, `subagents.test.ts:546-620`, route "arXiv cannot be reached" | Yes (fixtures only; real arXiv behaviour is unmeasured, as research.md says) |
| 4.8 | `createBudget.takeCall`, serial execution through `FatalLatch` | `budget.test.ts`, `supervisor.test.ts:274-293, 359-382`, route `maxSubagentCalls`, E2E `"calls":2,"maxCalls":2` | Yes, including several calls in one step (serialised, counter is synchronous) |
| 4.9 | `ResearchEvent` with `agent`, field-copying streamer | `supervisor.test.ts:215` (exact order), `domain-stream.test.ts:453` (abstract/transcript dropped), route "event before next LLM call" | Yes |
| 4.10 | `TokenLedger` by role, `onUsage` state part, `unknown` | `supervisor.test.ts:200-213, 297-318`, `budget.test.ts:85-110` | Yes (sum = total, 9×120 derived from the script). The budget overshoot (F-1) is not asserted against |

## Verified (no finding)

- **Serial sub-agents**: `buildToolSet` with a latch queues each step's calls, and the tool timeout starts only when a call actually runs. The test with two `searchPapers` in one step observes `peak: 1`. Without the queue the `setImmediate` in the fake search would give 2.
- **Refused calls**: a refused call is not counted (`takeCall` returns false before `calls += 1`), is reported as `budget-exhausted` with a fixed reason, and becomes `missing`. A child's usage is recorded before an abort is rethrown, and the supervisor's usage before the caller's abort is thrown. No result and no final usage are sent after an abort (route test and supervisor test).
- **Error text**: the strings that reach the browser are:
  - `failureReasonOf`: the vetted `AgentRunSummary.error.message` or fixed text;
  - the client's `PlatformError("source-unavailable", fixed text)`, which has no body or server wording;
  - `ArxivFeedError`'s fixed message;
  - the route's `toStreamErrorText`.

  Tests check that `sk-secret-*` stays out of the report, the result and the error part.
- **Stream mapping**: per-kind whitelists with type checks; unknown agents and kinds are dropped; `missing` is re-mapped to `{agent, reason}`; usage is copied field by field. `apps/web` imports no secret; the arXiv client gets `platform.ports.http`.
- **Parser**: a DOCTYPE or ENTITY is refused before parsing; `processEntities: false`; one decoding pass over the 5 predefined and the numeric references; 200,000-deep nesting fails cleanly; the id must match `ARXIV_ID_PATTERN` after the `abs/` prefix; the error feed (`title === "Error"`) is a failure.
- **Client**:
  - **Queue**: one queue, spacing counted from the end of a request; an aborted waiter is skipped without moving the slot.
  - **Cache**: keyed by lower-cased, space-collapsed query plus `maxResults`; empty results are cached, failures are not.
  - **`getAbstract`**: never calls the fetcher.
  - **Limits**: per-request timeout through `raceWithAbort`; byte-measured size cap, not retried.
  - **Shared client**: `globalThis` singleton with failure eviction, and a reset helper used in `beforeEach`/`afterEach`.
- **Route**: order is guard (size, schema, rate limit in `live`) → `resolve({ require: ["tools"] })` → arXiv client → stream. A rejected request reaches neither arXiv nor the model (route test 216).
- **Mock fetcher**: answers only the arXiv API URL; the scenario count update (13 / 63) is pinned in `m3-scenarios.test.ts`.
- **Citation check, correct cases**: `arXiv:` labels (any case, NBSP / full-width colon), versions (`v0`, `v12`), `abs`/`pdf`/`html`/`.pdf`, query/fragment, `www.`/`export.`, no scheme, autolinks, HTML anchors, pipes inside table links, old-style archives (`hep-th`, `math.GT`), headings, emphasis with `*`, block quotes, CRLF. Fixed parts of IDs are not over-matched (`2313.99999` and `1234.5678` are not IDs; `2499.12345` is one only with a label).

## Verdict
REQUEST_CHANGES

F-1 weakens CL-17 through a plan edit without approval. F-2 to F-5 are concrete, reproduced gaps in the wave's central safety rule (Req 4.5), in both directions: an unknown paper kept, and a fetched paper destroyed. None is a HIGH on its own: plain IDs and arXiv links, the shapes a model invents most, are caught. But they should be fixed, or explicitly accepted, before the wave is archived.

## Hallucination Signal
forced: false


## Responses (implementer, 2026-10-19)

- **F-1 fixed** (test first): `createBudget` gained `reserve` (a role's tokens are held back; its own spend inside the reserve does not lower the rest, beyond it does). `runResearch` reserves half of `maxTotalTokens` (at most 20,000) for the supervisor and caps the supervisor at that; the stale test comment and expectation were replaced (a run with `maxTotalTokens: 960` ends at 960 or less). Plan C9 rewritten.
- **F-2 fixed** for underscore emphasis, Hugging Face / alphaxiv / m.arxiv / Semantic Scholar pages, the arXiv DOI (link and bare), upper-case paths and old-style IDs, a doubled slash, and an unknown ID in the text of a link to a known paper. **Accepted, not fixed**: full-width digits, an ID split by a line break or a zero-width space, other sites that embed an ID (a learner sees these as unverified text, not as an arXiv mention).
- **F-3 fixed**: `dx.doi.org` is `doi.org`, DOIs compare case-insensitively, the arXiv DOI and Semantic Scholar `arxiv/<id>` pages count as the arXiv paper.
- **F-4 accepted**: removal is per line or sentence; reference-style links, footnotes, wrapped list items and removed headings leave their neighbours. Recorded as a limit in plan C9 and for the explanation (40.4).
- **F-5 fixed**: `getPaperAbstract` reads only from the run's own set (`knownPapers`), no longer adds to it (`onRead` feeds the cards), and the reading sub-agent is given the run's collector.
- **F-6 fixed**: a child cut off by the tool's `TimeoutError` is recorded as a failure (a learner's stop still is not); the supervisor's duration and tool timeout derive from the call count and the sub-agent limits.
- **F-7, F-8, F-9, F-13, F-14 accepted** (LOW; carried to 40.4 as known limits): a bad feed entry fails the search, the result count is not enforced, HTTP 400 is retried, quadratic scan on a line of thousands of unknown IDs, inspector summaries are not citation-checked, the theme is not escaped inside its tag, queue waiting counts toward the child's tool timeout.
- **F-10 resolved by text**: usage lives in the `data-research-usage` part; plan C13 text aligned. **F-11**: plan text synced (`externalContent` is wired by callers in later waves). **F-12**: tasks 24.1 / 24.2 closed in `tasks.md`.
- Not re-reviewed by a fresh reviewer after the fixes.
