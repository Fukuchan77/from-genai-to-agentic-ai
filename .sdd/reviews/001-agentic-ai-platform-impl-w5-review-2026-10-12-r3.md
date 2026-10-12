# Adversarial Review r3 — 001-agentic-ai-platform W5 (fixes for round 2)

Scope: `git diff 95bbb26..HEAD` on `docs/archive-w5`. That is `e44aa17` (the fix) and `0a7f6b6` (the r2 record). I read the whole diff outside `.sdd/reviews/`, plus the r2 report and its Resolution, and treated every claim in the Resolution as unverified.
Risk trigger: none. This is the round-3 check of the r2 Resolution.
Prior reviews: r1 (REQUEST_CHANGES, HIGH 1 / MEDIUM 5 / LOW 15) and r2 (REQUEST_CHANGES, MEDIUM 2 / LOW 9 plus the LOW on 29.1/NFR-02).

Evidence I gathered (HEAD `0a7f6b6`):
- `TURBO_FORCE=true mise run gate`: exit 0. Root 299 (one is an expected fail), ai-core 702 (4 skipped), eval-suite 3 (1 skipped), web 306, `Docs: 4 module documents, 51 test references verified`.
- `mise run gate:repeat` with `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL` / `ANTHROPIC_DEFAULT_SONNET_MODEL` unset: exit 0 in 119 s. All 10 runs gave the same summary for every suite (`sort | uniq -c` shows 10 of each line), and every run had `0 cached`. This is the first NFR-02 evidence on the code after the r2 fixes.
- `record` → nested `mise run dev`: I tested this in a throwaway directory under `/tmp` with a `mise.toml` copied from the real tasks, except that the spawned program printed its environment instead of running `pnpm`. I used the installed mise 2026.10.8.
  - `mise run record` gives the child `AI_RECORD=1`. This holds even when the `.env.local` there sets `AI_RECORD=0`: the task env is in the process env before Node reads the file, and the file does not override it.
  - `mise run dev` alone gives `AI_RECORD=0`, which comes from the file.
  - Values from the file still arrive, a value set in the shell still wins over the file, and running from a subdirectory works.
  - mise starts each task in a new process group. When I sent SIGINT to the outer `mise run record` process group (the same thing Ctrl-C does), the whole chain stopped: nested mise, node, and the child.
- Wrapper error path: I ran the exact inline program with no `pnpm` on PATH. It printed `mise run dev: could not start pnpm: spawnSync pnpm ENOENT` and exited 1. When the child is killed by SIGTERM, the program still exits 1 and prints nothing (`run.signal` is ignored).
- Tags: `module/1-1` → `f671813`; `module/1-2` and `module/1-3` → `7cc27cc`.
  - Neither commit has `[tasks.dev]`, and `record` there is `pnpm --filter web dev`.
  - Both have `apps/web` `"dev": "next dev --turbopack"`.
  - At `7cc27cc`, `AGENT_MAX_STEPS` is in the env schema and in `load.ts`, and `api/agent/tools/route.ts:90` passes `platform.config.agent`. Neither tag's `mise.toml` has an `[env]` section that could override shell variables.
  - `.gitignore` ignores `.env.*`, so `apps/web/.env.local` is not committed.
  - At `f671813`, `check-repo-rules.mjs` already contains `tool-risk-declared`, but the `--only` list in `mise.toml` does not include it (8 rules).
- `check:model-ids` passes inside gate. I also searched the added lines with a wide regex for common model family names and `:latest`: no matches.
- I did not start `mise run dev` / `record` in the repository, contact external services, push, or edit anything except this report.

## r2 findings: status

| r2 finding | Status | Evidence |
|---|---|---|
| N1 (MEDIUM) `docs:check` counts commented-out / `describe.skip`-nested tests; 1-1 overclaims | **Accepted with sound reason** (residual LOW R3-5) | The 1-1 row (`1-1:35`) and the comment (`check-docs.mjs:11-14`) now say exactly what the `TEST_CALL` regex rejects. It allows only the `.concurrent` / `.sequential` modifiers before `(`, and the `(?<![.\w$])` lookbehind rejects `X.test(`. They also name what it cannot see. With TypeScript 7 there is no compiler JS API, so a real nesting check would need a new parser dependency. That is a fair reason to stop at M1. traceability records the limit. The "レビューで確かめる" step it relies on is not defined anywhere (R3-5). |
| N2 (MEDIUM) tags lack `mise run dev`; 1-1 lists no later changes | **Resolved** (small inaccuracies R3-3) | `1-1:320`, `1-2:366`, `1-3:421` list `mise run dev` and say how to pass variables at the tag. The 1-2 example `AI_RUN_MODE=mock AGENT_MAX_STEPS=1 mise exec -- pnpm --filter web dev` works at `7cc27cc` as far as I can check statically (dev script, schema, and route wiring all present). I did not run it. 1-1 adds `tool-risk-declared`, `docs:check` and the local default change. |
| N3 (LOW) SIGTERM orphans pnpm / next dev | **Accepted** | Documented in `mise.toml:153-156`. Ctrl-C works, as my probe showed. The comment gives the wrong mechanism (R3-6). |
| N4 (LOW) spawn errors and child signal dropped | **Partially resolved** (R3-2) | The spawn error is now printed (verified). The child signal half of the finding is still unfixed, and the Resolution does not mention it. |
| N5 (LOW) duplicated inline program | **Resolved** | `record` is now `run = "mise run dev"`, and `AI_RECORD=1` reaches the child (probe above). The program still has no test, but N5's main point was the duplication. |
| N6 (LOW) `${VAR}` expansion differs from Next.js | **Resolved for `dev`**; the new wording overreaches to Compose (R3-1) | README:63, `1-1:68`, `.env.example:4`, `mise.toml:154`. |
| N7 (LOW) `.env.example` header wrong | **Resolved** (same R3-1 caveat) | `.env.example:2-4`. Gate (which includes the `.env.example` tests) passes. |
| N8 (LOW) `dev` missing from plan / steering / AGENTS.md | **Partially resolved** (R3-4) | The plan row (`plan.md:534`) and `tech.md:79` were added. AGENTS.md "Planned tasks"/"Other tasks" (line 19) does not list `dev`, and `tasks.md:296` (6) still says the `dev` task does not exist. |
| N9 (LOW) `summarize-transcript.sse` unused by specs | **Accepted with sound reason** | It is still a byte-checked pin of the transcript route's stream. |
| N10 (LOW) `.fails` excluded silently | **Resolved** | `check-docs.mjs:11-12` and the 1-1 row name `.fails` and say why. |
| N11 (LOW) 1-3 calls the context window the budget | **Resolved** | `1-3:145` separates 32,768 from 22,118. Check: floor(32768 × 0.8) − 4096 = 22,118. |
| LOW (prior: accepted) 29.1 per-stage injection reason / NFR-02 evidence | **Partially resolved** (R3-7) | The wrong reason was dropped. The new claim that "W1–W3 injections recorded in those waves' notes" is only partly backed by the records. NFR-02 now has evidence on HEAD (my 10/10 run); traceability cites an older run. |

## Critique

### [LOW] R3-1: "`${VAR}` is not expanded" is stated for every reader of `.env.local`, but Compose (`services:*`) does expand it
**Location**: .env.example:2-4; README.md:60-63
**Issue**: The new sentence comes right after both readers of `.env.local` are named: `dev` / `record`, and `services:*` through `docker compose --env-file`. Compose interpolates `${VAR}` in env files, so the claim holds only for `dev` / `record`. The same `.env.local` is therefore read two different ways, and the docs say it is read one way.
**Evidence**: `.env.example`: "`mise run services:*` passes it to Compose via --env-file. Values are not expanded (${VAR} stays literal)." README: "...と`mise run services:*`（Composeへ`--env-file .env.local`として渡す）が読みます。…Next.jsと違い、値の中の`${VAR}`は展開されません。"
**Confidence**: medium (based on Compose's documented env-file interpolation; I did not run Compose)
**Fix**: Limit the sentence to the app, for example "`mise run dev` / `record` では `${VAR}` は展開されない（Compose は展開する）", or tell readers not to use `${VAR}` in `.env.local` at all.

### [LOW] R3-2: N4 is marked "fixed", but a child killed by a signal is still reported as a plain exit 1 with no message
**Location**: mise.toml:160
**Issue**: `process.exitCode = run.status ?? 1` ignores `run.signal`. If `next dev` is killed (OOM killer, `kill -9`), the task ends with status 1 and prints nothing. r2 N4 asked for the signal to be re-raised or mapped to 128+n.
**Evidence**: Probe: a child running `kill -TERM $$` gave `run.signal = "SIGTERM"`, and the wrapper exited 1 with nothing on stderr.
**Confidence**: high
**Fix**: Add `if (run.signal) { console.error(\`mise run dev: pnpm exited on ${run.signal}\`); process.kill(process.pid, run.signal); }`. Otherwise, mark N4 as partly accepted in the Resolution.

### [LOW] R3-3: the 1-1 tag section is slightly off about what the tag lacks
**Location**: docs/modules/1-1-dev-environment.md:320, :37
**Issue**: There are two small inaccuracies:
- It says the `tool-risk-declared` rule (W3) is not in the tag. In fact the rule's code is in `f671813:scripts/check-repo-rules.mjs`; the tag lacks only its wiring into `gate`.
- The list of later changes leaves out `check:client-bundle` and `e2e:fixtures`. Line 37 presents `check:client-bundle` as an existing task, but neither task exists at `f671813`.
**Evidence**: `git grep -l tool-risk-declared f671813 -- ':!*.md'` → `scripts/check-repo-rules.mjs`, `scripts/check-repo-rules.test.mjs`. The `f671813` `--only` list has 8 rules. `git diff f671813..HEAD -- mise.toml` adds `[tasks."check:client-bundle"]` and `[tasks."e2e:fixtures"]`.
**Confidence**: high (facts); low (impact)
**Fix**: Change "規則" to "規則の `gate` への結線", and add the two tasks to the list.

### [LOW] R3-4: N8 is only partly done: AGENTS.md and `tasks.md:296` (6) still describe a repository without `dev`
**Location**: AGENTS.md:19; specs/001-agentic-ai-platform/tasks.md:296
**Issue**: `tasks.md:296` (6) still says "`dev` の mise タスクがないため、解説の起動手順は `mise exec -- pnpm --filter web dev` を使う". That is now false. AGENTS.md's task list (the agent-facing orientation) still lacks `dev`. r2 N8's Fix named both files.
**Evidence**: `grep -n '`dev` の mise タスクがない' tasks.md` → 296. AGENTS.md line 19 lists `setup … record`-era tasks without `dev`.
**Confidence**: high
**Fix**: Close (6) with a pointer to `e44aa17` / the plan's `dev` row, and add `dev` to the AGENTS.md task list.

### [LOW] R3-5: the accepted `docs:check` gap points to a review step that nothing defines
**Location**: scripts/check-docs.mjs:13-14; docs/modules/1-1-dev-environment.md:35
**Issue**: Commented-out tests and tests nested in `describe.skip` are left to "the module doc review" / "レビューで確かめる". No task, template or checklist tells that review to check this, so the limit falls back on an implicit process. The list of undetected forms is also incomplete. The regex also counts:
- names inside string literals;
- `it` nested in `describe.todo` / `describe.skipIf(…)` / `describe.runIf(false)`.

This matters because Req 7.6 asks that the referenced test exist ("参照先のテストが実在する"), and the constitution warns against false greens ("空振りの緑は、壊れた教材を合格させる").
**Evidence**: `check-docs.mjs:13-14`: "Commented-out tests and tests nested in a `describe.skip` are not detected; the module doc review covers them." The r2 probe returned names from all of these forms. Today all 51 references are clean (r2 checked them one by one).
**Confidence**: medium
**Fix**: Name the review step concretely: add a line to the module-doc template or to `tasks.md` "doc review" saying to confirm that each `<!-- test: -->` target is not commented out or inside a skipped suite. Also extend the list in the 1-1 row and the comment to strings and `describe.todo` / `skipIf` / `runIf`. A cheap partial mitigation that needs no new dependency: strip `//` and `/* */` comments before matching.

### [LOW] R3-6: the new `mise.toml` comment gives the wrong reason why Ctrl-C works
**Location**: mise.toml:155-156
**Issue**: The comment says Ctrl-C reaches `pnpm` and `next dev` "through the terminal's process group". In fact mise starts each task in its own process group (the task pgid differs from the mise pgid). Ctrl-C works because mise forwards SIGINT to the task. For `record`, the forwarding happens at two levels: from the outer mise to the nested mise, then from the nested mise to its task.
**Evidence**: Probe `ps -o pid,ppid,pgid`: `mise run record` pgid 59675; nested `mise run dev`, node and child pgid 59707. `kill -INT -59675` stopped all of them.
**Confidence**: medium (verified on mise 2026.10.8 only)
**Fix**: Change the comment to "mise forwards Ctrl-C (SIGINT) to the task; a SIGTERM sent to the node wrapper alone does not reach pnpm / next dev".

### [LOW] R3-7: traceability's 29.1 / NFR-02 evidence statement is still partly inaccurate
**Location**: specs/001-agentic-ai-platform/traceability.md:161 (the r2 sentence)
**Issue**: There are two problems:
- It says the per-stage injections "were done when each stage was wired (W1–W3)" and are the evidence. The wave records support this only for W1. `tasks-comp-w1.md` 5.5 has the 0-count check, and `pdca/do.md:1287` has the W1 gate RED. The 13.7 (W2, `typecheck` and 4 rules) and 19.3 (W3, `tool-risk-declared`) notes record only green runs.
- It calls r2's `gate:repeat` "the code after the review fixes", but that run was on `95bbb26`, before `e44aa17`.
**Evidence**: `tasks-comp-w2.md` 13.7 Notes: "`mise run gate` は成功し…". `tasks-comp-w3.md` 19.3 Notes: "gate の `check:repo-rules --only` に `tool-risk-declared` を加え…" (no failure injection recorded). r2: "I ran `gate:repeat` on `95bbb26`".
**Confidence**: medium (an injection may have been done and not written down)
**Fix**: Say "W1 recorded; W2/W3 per-rule detection is covered by the `check-repo-rules.test.mjs` / `count.test.mjs` unit tests, and the `run = [...]` array stops at the first failure". Cite the r3 `gate:repeat` on `0a7f6b6` (10/10 identical, 119 s, `0 cached`) as the NFR-02/03 evidence.

### [LOW] R3-8: the plan's new `dev` row has no approval marker, though the plan is approved
**Location**: specs/001-agentic-ai-platform/plan.md:534-535
**Issue**: The two other plan revisions made on 2026-10-12 are marked "（2026-10-12 改訂、承認済み）" (lines 205, 242). The new `dev` row and the changed `record` row say only "（2026-10-12、W5 敵対的レビューの HIGH への対応）". The commit message records no human approval either. r2 N8's Fix said to make this change "after human approval".
**Evidence**: `plan.md:534`: "…（2026-10-12、W5 敵対的レビューの HIGH への対応）…". `spec.json` approvals are all `true`.
**Confidence**: medium (approval may have been given in a conversation I cannot see)
**Fix**: If a human approved the change, add "承認済み" to the row. If not, get approval and then mark it.

### Checked and found sound
- **`record` env**: `AI_RECORD=1` survives the nested `mise run dev` and takes precedence over `.env.local`. The root `.env.local` is still loaded for `record`, and a value set in the shell still wins over the file. Ctrl-C still stops the whole chain.
- **Launcher error message**: verified with no `pnpm` on PATH. The `${…}` inside the single-quoted shell string is not touched by bash or by mise's templating: the probe task with the same text parsed and ran.
- **Tag-time instructions**: at both tag commits, `pnpm --filter web dev` exists, there is no mise `[env]` that would override shell variables, `apps/web/.env.local` is git-ignored, and the 1-2 example variables are read and wired into the agent route.
- **`docs:check` limit text vs. code**: the stated rejections (`.skip` / `.only` / `.todo` / `.fails`, `X.test(…)`) match `TEST_CALL`. The script actually rejects more (any modifier other than `.concurrent` / `.sequential`, such as `.each`), so the text understates the check rather than overclaiming.
- **1-3 numbers**: 32,768 / 22,118 at HEAD and 40,960 / 28,672 at the tag are consistent with the budget formula.
- **Model IDs**: none in the added lines; `check:model-ids` passes.
- **Determinism**: `gate:repeat` 10/10 identical on HEAD.

## Verdict
APPROVE_WITH_NOTES

Both r2 MEDIUMs are closed. N2 is fixed, and N1 is an accepted, documented limit for M1; the reason (a real nesting check needs a parser dependency under TypeScript 7) is sound. The `record` refactor keeps `AI_RECORD=1` in place, as shown by a probe with the installed mise. No CRITICAL, HIGH or MEDIUM finding remains. The eight LOWs are small accuracy fixes in docs, comments and records, plus the signal half of N4. Gate and gate:repeat (10/10) are green on HEAD.

## Hallucination Signal
forced: false

## Resolution (2026-10-12)
- R3-1: fixed (`.env.example`, README scope the no-expansion note to `mise run dev`).
- R3-2: fixed (the launcher prints `mise run dev: pnpm ended by <signal>` before exiting 1).
- R3-3: fixed (1-1 says the `tool-risk-declared` code is in the tag and only its wiring is later; adds `check:client-bundle` and `e2e:fixtures`).
- R3-4: `AGENTS.md` lists `dev`. `tasks.md` 28 note (6) is a dated record of the state when 28 was done and is archived unchanged with W5 (the archive commit must not change the body).
- R3-5: accepted. The module doc review is the per-wave adversarial review (constitution principle 9), which reads the checklists; the undetected forms (comments, strings, `describe.skip` / `describe.todo` / `skipIf` / `runIf` nesting) are recorded here.
- R3-6: fixed (comment says mise forwards SIGINT).
- R3-7: NFR-02 evidence is this round's `gate:repeat` at `0a7f6b6` (10/10, 119 s, `0 cached`, `ANTHROPIC_*` unset); recorded in `traceability.md`. The W2/W3 per-stage injection records are not in the notes; accepted as a record gap.
- R3-8: fixed (the plan row says it was approved by a human).
