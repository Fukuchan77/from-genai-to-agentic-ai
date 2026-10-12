# Adversarial Review: 002 rag-and-workflows, Wave W2 (tasks 5.1–9.2, wave close 9.3)

- Date: 2026-10-12
- Scope: uncommitted working tree on `feat/m2-w1-foundation` (`git diff HEAD` plus untracked `packages/ai-core/drizzle/`, `packages/ai-core/src/rag/**`, `packages/ai-core/fixtures/rag/corpus/*.md`, `packages/ai-core/src/testing/pdf-builder{,.test}.ts`, `apps/web/app/api/rag/**`)
- Inputs: `spec.md` (Req 1.1–1.3, 1.8, 1.12, 2.3, 2.12), `plan.md` (C4, C5, C6, C13, C15, Data Model, HTTP API, Test Strategy, Error Handling → 取り込み), `tasks.md` tasks 5–9 and their Implementation Notes, `research.md` (Req 1.12 classification, R-1, R-2), `pdca/do.md` (W2 PROVE log)
- Risk triggers: (1) files changed outside a task's `_Boundary:_`; (2) no new dependency (to verify); (3) no deleted or skipped test (to verify); (4) PROVE evidence in do.md
- Prior reviews in scope: `002-rag-and-workflows-impl-w1-review-2026-10-12.md` (F-5 deferred to 8.4/15.1; F-11 accepted)

## Evidence gathered

- `mise run gate` (Node 26 via mise, `NODE_ENV` unset): exit 0. `@platform/ai-core executed=1058 passed=1058 skipped=4`, `web executed=349 passed=349`, `eval-suite executed=3 passed=3 skipped=1`, `no-sql-raw: scanned 143 FILES`, `Biome: 292 files`.
- `git diff HEAD -- '*package.json' pnpm-lock.yaml` is empty. No dependency was added.
- `git diff HEAD -- '*.test.*' '*.spec.*' | grep '^-[^-]'` is empty, so no existing test line was removed. There is no `.skip`, `.todo`, `it.fails` or `xit` in the new tests.
- `grep` over `rag/`, `testing/pdf-builder.ts` and `app/api/rag`: no `agents/` import, no React/Next import, no `any`, no `TODO`/`FIXME`. The only `sql.raw` is `rag/db/migrate.ts:21`. There are three bare `catch {}` blocks (`loader.ts:95`, `pdf.ts:24`, `client.ts:65`), discussed in F-12.
- Probe (a temporary test `src/rag/ingest/zz-review-probe.db.test.ts`, deleted after the run; `ls` confirms it is gone). It printed the following:
  - `CASE [{"documentId":"kb:guide.md",...}] [{"documentId":"kb:GUIDE.md",...}] ["kb:GUIDE.md","kb:guide.md"]`: one file on APFS, two documents.
  - `RESET {"ingested":[],"skipped":[{"file":"n.txt","reason":"unsupported-format"}],"embeddingModelId":"nomic-embed-text:latest"} {"embeddingModelId":"mock:embedding-v1","dimensions":768} 2`: `reset: true` did nothing, and the result names a model that the base does not use.
  - `EACCES Error EACCES`: an unreadable file throws a raw error out of `loadKnowledgeFile`.
  - `NFD "が.md"`: the NFD spelling of an NFC file name loads, and the ID is built from the NFD string.
  - `TITLE {"title":"Only H2", ... "body":"text\n\nTitle\n=====\n\nmore"}`: an H2 becomes the title, and a setext heading is not a boundary.
- PROVE re-check on `apps/web/app/api/rag/ingest/route.ts`. I copied it to the scratchpad, removed `signal: request.signal`, and `passes request.signal through…` failed (24/25). I restored the file from the copy, and `cmp` shows it is identical.
- Stryker report `reports/mutation/mutation.html` (from 9.3, score 86.59). Surviving and no-coverage mutants: markdown 56/264, chunk 20/130, search-text 2/36. The list is quoted in F-15 and F-16.
- Built server chunk (`apps/web/.next/server/chunks/[root-of-the-server]__018xw1m5_nu4b._.js`): `import.meta.url` compiles to `__turbopack_context__.F("packages/ai-core/src/rag/db/client.ts")`. `postgres` is bundled and not external. Next's built-in `server-external-packages.jsonc` lists `pg` but not `postgres`, `@electric-sql/pglite` or `unpdf`.
- `unpdf@1.8.1/dist/pdfjs.mjs` has `cMapUrl:null` by default and ships no `.bcmap` files.

## Trigger resolution

1. **Boundary deviations: confirmed and justified, but plan.md is not updated (F-18).**
   - `loader.ts` (owned by 6.6) was edited in two places. 8.2 exported `isSafeFileName` so that the schema and the runtime use one predicate, and 9.2 added `/* turbopackIgnore: true */` comments.
   - `embedding.ts` (owned by 7.1): 7.2 widened the second parameter of `assertKnowledgeBaseCompatible` to `{ entry: { id } }`.
   - `client.ts` (owned by 5.2): 9.2 replaced `new URL(…, import.meta.url)` with `path.resolve(...)`, because Turbopack fails the build on a directory asset.
   - Each edit is minimal, has no behavior change beyond its purpose, and is recorded in the tasks.md notes ("Boundary 外の変更 … 最小の修正"). None appears in plan.md.
   - `apps/web/e2e/real-server.spec.ts` deep-imports `../../../packages/ai-core/src/testing/pdf-builder`, which bypasses `package.json#exports`. The comment justifies it.
2. **No dependency added: confirmed.** The empty diff is quoted above.
3. **No deleted or skipped test: confirmed.** `platform.test.ts` is append-only.
4. **PROVE evidence: present.** do.md has RED, GREEN and PROVE entries for every task (5.1–9.3), including the stubs that were first not caught and the tests strengthened afterwards (`readdir` order, `getChunks` order, compat check, outer transaction, signal propagation, clock). I spot-checked one (the signal) and it holds.
5. **`next.config.ts` unchanged (9.2): sound for `mock`, unproven for `postgres` (F-9).** The PGlite WASM and `unpdf` are exercised by the real-server E2E, including the PDF test with page numbers. `postgres` is bundled but `createPostgresDatabase` never runs in any E2E. tasks.md says so honestly ("未確認: … postgres.js は import まで").
6. **`*.pg.test.ts` never executed: honestly represented.** The status is consistent across research.md (two tables of "未実測", R-2 updated), tasks.md 5.x/7.x notes ("人が行うこと"), and do.md ("Not executed against Postgres"). From reading, I expect the pg tests to work on postgres.js:
   - `postgres.js` `inferType` gives strings and numbers type 0 (unknown). Drizzle's `PgArray.mapToDriverValue` sends `'{…}'` literals, so `&&` resolves to `text[]`.
   - `cosineDistance` sends a `'[…]'` text that resolves to `vector`.
   - `inArray` expands to `IN ($1…)`.
   - `db.transaction` inside a transaction uses `client.savepoint` (drizzle `postgres-js/session.js:139`).
   - `CREATE DATABASE ${admin(name)}` uses the identifier helper.

   One real gap remains: no pg test exercises the nested-savepoint path that `ingestDocuments` relies on (F-8).

## Critique

### [MEDIUM] F-1 Case and Unicode variants of one file name create duplicate documents (Req 1.3)
**Location**: packages/ai-core/src/rag/ingest/ingest.ts:88, :107; loader.ts:139-152
**Issue**: The document ID is built from the caller's spelling of the name, not from the file that was opened. On the default case-insensitive, normalization-insensitive APFS, `guide.md`, `GUIDE.md` and the NFD spelling all open the same file but are stored as separate documents with separate chunks.
**Evidence**: The probe printed `["kb:GUIDE.md","kb:guide.md"]` after ingesting `guide.md` and then `GUIDE.md`. `realpath` returns the on-disk name `…/guide.md`, but `documentId = \`${prefix}${loaded.file}\`` with `loaded.file = name`. The in-request dedupe is `new Set(params.files)` (exact string). Req 1.3: "同一文書が再度取り込まれた時 … 同一文書のチャンクを重複して保存しない".
**Confidence**: high
**Fix**: Use `path.basename(realPath)` as `LoadedDocument.file`, so the on-disk spelling becomes the ID. Dedupe on the resolved real path inside `ingestDocuments`. Add a test that ingests `a.md` and then `A.md` (skip it when the temp FS is case-sensitive) plus an NFC/NFD pair, and expect one document.

### [MEDIUM] F-2 `reset: true` is silently a no-op when every file is skipped, and the result reports the wrong model
**Location**: packages/ai-core/src/rag/ingest/ingest.ts:144
**Issue**: `if (prepared.length === 0) return result()` returns before the reset and the transaction. The response is still 200, and `embeddingModelId` is the *requested* model, so a caller that asked for a rebuild cannot tell that the old base (old model) is still in place.
**Evidence**: The probe printed `RESET {"ingested":[],…,"embeddingModelId":"nomic-embed-text:latest"}` while `getMeta()` was `{"embeddingModelId":"mock:embedding-v1"}` with 2 documents left. Plan Error Handling says "`reset: true` は全文書を消してから取り込む", and C14 makes reset a destructive, confirmed UI action. No test covers reset with zero ingestable files; "does not touch the knowledge base when every file is skipped" covers only `reset` omitted.
**Confidence**: high (behavior); medium (which semantics is intended)
**Fix**: Decide and record it in plan C5. Either (a) honor the reset (empty the base in a transaction even with nothing to ingest), or (b) refuse `reset: true` with nothing ingestable as `invalid-request`. In both cases, make `IngestResult.embeddingModelId` report the base's model after the call, not the requested one. Add the test.

### [MEDIUM] F-3 `reason: "embedding-model-changed"` never reaches the client, contrary to the plan's HTTP contract
**Location**: apps/web/lib/server/errors.ts:89; apps/web/app/api/rag/ingest/route.ts (no mapping)
**Issue**: `toPublicError` passes `details` only for `source-unavailable`, so the 400 for an embedding-model mismatch carries no machine-readable reason. W5's `/rag` UI then has to parse the Japanese message to offer "reset".
**Evidence**: Plan "HTTP API": "400 `invalid-request`（…埋め込みモデルの不一致 `reason: \"embedding-model-changed\"`）". `const details = error.code === "source-unavailable" ? publicDetails(error.details) : undefined;`. The route test asserts only `error.message` contains "reset" and the model ID. tasks.md 8.x notes acknowledge it ("`reason` ではなく日本語のメッセージ … で伝わる"), but plan.md was not changed.
**Confidence**: high
**Fix**: Either allow `publicDetails` (closed `reason` only, already pattern-checked) for `invalid-request` too, or for an allow-list of reasons such as `embedding-model-changed`, `too-many-files` and `invalid-file-name`. Alternatively, amend plan "HTTP API" to drop the `reason`. Assert `error.details.reason` in the route test.

### [MEDIUM] F-4 An unreadable file aborts the whole ingest with 500 instead of being skipped (Req 1.8)
**Location**: packages/ai-core/src/rag/ingest/loader.ts:55-62, :79-89
**Issue**: `resolveOrUndefined` maps only `ENOENT/ENOTDIR/ELOOP`, and `open` and `readFile` errors are not mapped at all. One `EACCES` (or `EIO`/`EPERM`) file throws out of `ingestDocuments`, so the route answers 500 `unexpected` for the whole batch and names no file.
**Evidence**: The probe printed `EACCES Error EACCES` for a mode-000 `locked.md`. Req 1.8: "テキストを抽出できない場合 … そのファイルをスキップし、ファイル名と理由を取り込み結果に含める". Plan Error Handling: "拒否せず `skipped` に含めて残りを処理する".
**Confidence**: medium (an edge case, but a direct contract break)
**Fix**: Map filesystem read errors on a validated name (`EACCES`, `EPERM`, `EIO`, `EISDIR`) to a skip reason. Use `not-found` or `parse-failed`, or add `unreadable` to `SKIP_REASONS` through the plan. Add a loader test with `chmod 000` (skip it when running as root).

### [MEDIUM] F-5 Atomicity in `local`/`live` rests on an untested postgres.js nested-savepoint path
**Location**: packages/ai-core/src/rag/ingest/ingest.ts:157-170; store.ts:233, :301; store.pg.test.ts
**Issue**: `ingestDocuments` opens one outer transaction, and `replaceDocument`/`reset` open nested `db.transaction` savepoints inside it. No pg test runs `ingestDocuments` or a nested transaction, so the "all documents or none" property is proven only on PGlite (single connection, PGlite's own transaction mutex).
**Evidence**: `store.pg.test.ts` calls `store.replaceDocument` at top level only. `client.pg.test.ts` "rolls back a failed transaction" is single-level. There is no `ingest.pg.test.ts`. The ingest notes say "ストアの `replaceDocument` は外側のトランザクションの中でセーブポイントになる". Plan Test Strategy: `*.pg.test.ts` guarantees "*.db.test.ts と同じ SQL が実 Postgres でも同じ結果になること".
**Confidence**: medium (I expect drizzle's `client.savepoint` to work; the gap is the evidence)
**Fix**: Add an `ingest.pg.test.ts` (or a case in `store.pg.test.ts`) that runs `db.transaction(tx => { replaceDocument(tx…a); replaceDocument(tx…b with duplicate chunk ID) })` and asserts that `a` is rolled back. Also run the "writes all documents or none" case through `ingestDocuments` on Postgres. Add a row for it to research.md's 7.4 table.

### [LOW] F-6 Markdown title is the first heading of any level, not the first H1
**Location**: packages/ai-core/src/rag/ingest/loader.ts:100
**Issue**: `sections.find(s => s.headingPath.length > 0)?.headingPath[0]` returns an H2/H3 when the document has no H1, while the plan says the file name is the fallback.
**Evidence**: Plan Data Model: "`title` … Markdown は最初の H1（なければファイル名）". The probe gave `## Only H2` → `"title":"Only H2"`.
**Confidence**: high
**Fix**: Track the heading level in `MarkdownSection` (or detect `#` + space at level 1) and fall back to `stem(file)` when there is no H1. Add a test for an H2-only document.

### [LOW] F-7 Setext headings are not boundaries (ATX-only), so Req 1.2 holds only for ATX documents
**Location**: packages/ai-core/src/rag/ingest/markdown.ts:15, :120-163
**Issue**: `Title\n=====` stays inside the previous section's body. A chunk then spans what a Markdown renderer shows as two sections. The test "treats a hash-only line without text as body text" also fixes non-CommonMark behavior (`#` alone is an empty ATX heading in CommonMark).
**Evidence**: The probe body was `"text\n\nTitle\n=====\n\nmore"` under `["Only H2"]`. Req 1.2: "Markdown 文書を見出し境界でチャンク分割し、1つのチャンクが複数の見出しセクションをまたがない". Plan C5 deliberately limits the splitter to ATX, and `knowledge/README.md` says so.
**Confidence**: medium (plan-sanctioned narrowing of the spec)
**Fix**: Either support setext H1/H2 (a non-blank paragraph line followed by `=+`/`-+`, outside fences), or record the narrowing as an explicit spec/plan deviation (Req 1.2 scope = ATX) in the 2-1 module doc.

### [LOW] F-8 Concurrent ingests on Postgres and concurrent migrations have no guard
**Location**: packages/ai-core/src/rag/store.ts:248-256; rag/db/migrate.ts:36-70
**Issue**: (a) Two concurrent ingests of the same document under READ COMMITTED: the second `DELETE` does not see the first's newly inserted row, so its `INSERT` hits the PK and returns a raw driver error, which becomes 500. (b) Two processes migrating a blank database both try `CREATE TABLE rag_meta` and one fails, which surfaces as 422 (see F-13). No `pg_advisory_xact_lock` is taken.
**Evidence**: The plan lists "並行する取り込み" under what `*.db.test.ts` does not guarantee and assigns it to `*.pg.test.ts`, but neither pg test covers it.
**Confidence**: medium (single local learner, so low likelihood)
**Fix**: Take `pg_advisory_xact_lock(<const>)` at the start of the ingest transaction and of `runMigrations` (PGlite accepts it too). Alternatively, document the limitation in plan C6 and drop "並行する取り込み" from the `*.pg.test.ts` guarantees.

### [LOW] F-9 R-1 is closed for PGlite/unpdf, but bundled postgres.js is never executed
**Location**: apps/web/next.config.ts (unchanged); tasks.md task 9 notes
**Issue**: The conclusion "最小の集合は空" is proven for `mock` only. `postgres` is bundled by Turbopack (it is not in Next's default external list, which has `pg`), and no real-server run executes `createPostgresDatabase`.
**Evidence**: Chunk grep: `"postgres"` is referenced in 5 server chunks and is not external. tasks.md: "未確認: `local` / `live` での実 Postgres 接続（postgres.js は import まで）". This is honest, but it is a residual risk for the first `local` learner run.
**Confidence**: medium
**Fix**: Add a Docker-free smoke: run `next start` in `local` mode with a closed `POSTGRES_PORT` and expect `GET /api/rag/knowledge` → 503 `provider-unavailable`. This needs the embedding check to come after the DB, or a reachable Ollama stub. That exercises the bundled driver's connect and error path. Keep the full check in the human `test:db` step.

### [LOW] F-10 Japanese PDFs that rely on predefined CJK CMaps are untested and may extract no text
**Location**: packages/ai-core/src/rag/ingest/pdf.ts:18
**Issue**: `unpdf`'s bundled pdf.js has `cMapUrl: null` and ships no `.bcmap` files. PDFs with CID fonts without `ToUnicode` (common for non-embedded Japanese fonts) may extract empty or garbled text and be skipped as `no-text`. All tests use ASCII Helvetica PDFs.
**Evidence**: `grep cMapUrl node_modules/unpdf/dist/pdfjs.mjs` → `cMapUrl:null`. `buildTextPdf` accepts printable ASCII only.
**Confidence**: low
**Fix**: Run one Japanese PDF manually in `local` and record the result in the 2-1 doc's "gate の緑が保証しないもの". If it fails, pass `cMapUrl` to a vendored `pdfjs-dist/cmaps` directory, which would be a new dependency under principle 10.

### [LOW] F-11 TOCTOU and symlink nuances in the loader
**Location**: packages/ai-core/src/rag/ingest/loader.ts:139-150; ingest.ts:69-78
**Issue**: (a) The checks run on `realPath`, then `open(realPath)` runs without `O_NOFOLLOW`, so a local process could swap the final component for a symlink or FIFO between `realpath`/`stat` and `open`. (b) A symlink inside the root that points to a hidden file in the root (`link.md → .env`) is accepted, so the hidden-file rule applies only to the requested name. (c) `listIngestableFiles` drops symlinks (`Dirent.isFile()`), but the loader accepts them by name. The two disagree.
**Evidence**: `await realpath(...)`; `stat(realPath).isFile()`; `open(path, "r")`. `!entry.name.startsWith(".")` is checked only on the request name.
**Confidence**: medium (low exploitability: a local single-user directory)
**Fix**: `open(realPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | O_NONBLOCK)` and then `handle.stat().isFile()` (already done). Reject a `realPath` whose basename starts with `.`. Make `listIngestableFiles` include symlinks whose target is an in-root regular file, or document that it does not.

### [LOW] F-12 Catch-all conversions lose the error class
**Location**: packages/ai-core/src/rag/ingest/pdf.ts:18-26; rag/db/client.ts:63-69
**Issue**: (a) `extractPdfPages` maps any error, including programming errors and out-of-memory, to `parse-failed`. (b) `createPostgresDatabase` maps any `SELECT 1` failure (wrong password, missing database, TLS) to "start the DB with `mise run services:up:db`", which misleads a learner whose DB is running.
**Evidence**: `.catch(() => { throw new PdfParseError(); })`, `catch { throw new PdfParseError(); }`, `catch { await client.end(...); throw new KnowledgeBaseUnavailableError(); }`. The zero-tolerance list includes "generic catch-all".
**Confidence**: medium
**Fix**: (a) Convert only pdf.js error classes (`InvalidPDFException`, `FormatError`, `UnknownErrorException`, by `name`) and rethrow the rest. (b) Classify by postgres.js `code` (`28P01` auth, `3D000` missing database, `ECONNREFUSED`) into distinct Japanese guidance under the same `provider-unavailable` code, with no driver text.

### [LOW] F-13 A migration failure surfaces as 422 `source-unavailable`
**Location**: packages/ai-core/src/rag/db/migrate.ts:61-66
**Issue**: In M1's vocabulary, `source-unavailable` means "the article/video source cannot be read" (422). A missing pgvector extension or DDL failure on the learner's Postgres therefore becomes a 422 from `/api/rag/*`.
**Evidence**: `throw new PlatformError("source-unavailable", \`マイグレーション ${name} の適用に失敗しました…\`)`. Plan C13: DB failures → 503 `provider-unavailable`.
**Confidence**: medium
**Fix**: Use `provider-unavailable` (a `KnowledgeBaseUnavailableError` with a migration-specific message), and keep `migration` in `details` for logs only.

### [LOW] F-14 Exactly-at-limit chunk packing is untested (surviving boundary mutants)
**Location**: packages/ai-core/src/rag/ingest/chunk.ts:91, :97, :111
**Issue**: The `<= max` → `< max` and `> max` → `>= max` mutants survive, so no test packs units to exactly `maxCharacters` code points. Plan C5's "超えるとき" boundary is unpinned.
**Evidence**: Stryker survivors: `L97 EqualityOperator "codePointLength(candidate.trim()) < max"`, `L91 "… >= max"`, `L111 "codePointLength(trimmed) < max"`, `L111 ConditionalExpression "false"`.
**Confidence**: high
**Fix**: Add cases where a section is exactly `max` code points (one chunk), `max + 1` (split), and two paragraphs whose joined, trimmed length is exactly `max` (one chunk).

### [LOW] F-15 Markdown parser gaps shown by surviving mutants
**Location**: packages/ai-core/src/rag/ingest/markdown.ts:17-21, :25, :38, :50-56, :88
**Issue**: Mutants survive for the following:
- Anchor removal in `FENCE_OPEN`, `FRONT_MATTER_*`, `TAGS_KEY` and `BLOCK_ITEM` (for example, `subtags: [x]` or a mid-line `` ``` `` would be mishandled).
- The lone-CR normalization (`/\r\n?/` → `/\r\n/`).
- Quote tracking in `splitFlowItems` (commas inside quotes: `["a, b", c]`).
- `unquote` edge cases.
- Comment and blank lines inside a block list (`L88`).
**Evidence**: 56 of 264 markdown mutants survived or had no coverage (score 78.79). Examples: `L17 Regex "/ {0,3}(\`{3,}|~{3,})/"`, `L20 Regex "/tags[ \t]*:(.*)$/"`, `L53 BlockStatement "{}"`, `L25 Regex "/\r\n/g"`.
**Confidence**: high (survivors exist); medium (each is reachable through realistic input)
**Fix**: Add cases for a quoted comma in a flow list, `subtags:`, a lone `\r`, a mid-line backtick run, a comment line inside a block list, and a `...` front-matter terminator. Record any intentionally equivalent mutants (`L153`, `L154` trim) in do.md.

### [LOW] F-16 Tautological or over-mocked web tests
**Location**: apps/web/lib/server/platform.test.ts ("propagates provider-unavailable when Postgres cannot be reached"); app/api/rag/{knowledge,ingest}/route.test.ts (`vi.mock("@/lib/server/platform")` + `mockRejectedValueOnce(new KnowledgeBaseUnavailableError())`)
**Issue**: The platform test asserts that a fake factory's thrown `KnowledgeBaseUnavailableError` comes out as `provider-unavailable`, which is an assertion on the mock's own value. The route 503 tests also inject the error at `getKnowledgeBase`, so the composition "real `getKnowledgeBase` → real `createPostgresDatabase` failure → 503" is never exercised in the gate.
**Evidence**: `postgres: async () => { throw new KnowledgeBaseUnavailableError(); }` → `rejects.toMatchObject({ code: "provider-unavailable" })`. The real failure mapping is tested only in `schema.db.test.ts` with a fake `postgres` module and in the never-run `client.pg.test.ts`.
**Confidence**: medium
**Fix**: Replace the platform test with one that calls the real `createKnowledgeBase` in `local` mode against a closed port (a `127.0.0.1` port is blocked by the test network guard, so inject the fake `postgres` module as `schema.db.test.ts` does) and asserts 503 through `GET`. Drop the tautological case.

### [LOW] F-17 The E2E PDF test writes into the learner's real `knowledge/` directory
**Location**: apps/web/e2e/real-server.spec.ts (PDF test, `path.resolve(process.cwd(), "..", "..", "knowledge")`)
**Issue**: If a run is killed between `writeFile` and `finally`, `knowledge/e2e-real-server-<engine>.pdf` is left behind. A later "ingest all files" then indexes it into the learner's base. The path also depends on `process.cwd()` being `apps/web`.
**Evidence**: `await writeFile(path.join(directory, file), buildTextPdf([...]))` with `rm` in `finally`.
**Confidence**: medium
**Fix**: Point `knowledgeRoots.knowledge` at a temporary directory for the E2E server (an env override such as `RAG_KNOWLEDGE_DIR` honored only when `AI_RUN_MODE=mock`), or derive the path from `import.meta.dirname` and remove stale `e2e-real-server-*.pdf` in a `globalSetup`.

### [LOW] F-18 Boundary deviations are recorded in tasks.md but not in plan.md
**Location**: rag/ingest/loader.ts (8.2, 9.2), rag/embedding.ts (7.2), rag/db/client.ts (9.2), e2e/real-server.spec.ts (deep import into `packages/ai-core/src`)
**Issue**: These are edits outside the owning task's `_Boundary:_`, and a cross-package deep import that bypasses `exports`. Each is justified and minimal, but the zero-tolerance rule asks for an explicit plan.md update.
**Evidence**: tasks.md task 9 note: "Boundary 外の変更（`loader.ts`、`embedding.ts`、`client.ts`）は 8.2・7.2・9.2 で必要になった最小の修正". plan.md is unchanged in the diff.
**Confidence**: high (process)
**Fix**: Add one line per deviation to plan C4/C5/C6 or to the File Structure Plan. Either expose `buildTextPdf` through a vitest-free subpath (`@platform/ai-core/testing/pdf`), or record the deep import as allowed for E2E in structure.md.

### [LOW] F-19 Smaller items
**Location**: various
**Issue / Fix**:
- (a) `store.pg.test.ts:19` comment says "out of the TRUNCATE below", but the file uses `store.reset()`. Fix the comment.
- (b) Front-matter `tags` are unbounded (count and length), while request tags are capped at 10×40. Apply the same caps (or drop over-limit tags) in `readFrontMatterTags`.
- (c) `reset: true` from either source empties both `kb:` and `eval:` documents (plan-consistent: "`rag_*` を空にして"). Make sure the W5 confirmation dialog says "全文書" explicitly.
- (d) The built server reads `drizzle/*.sql` and fixtures from the source tree via `__turbopack_context__.F("packages/ai-core/src/rag/db/client.ts")`, so the build output is not relocatable. This is fine for the curriculum; mention it in the 2-1 doc if `standalone` output is ever used.
- (e) (prior: W1 F-5 deferred) `platform.ts` `credentialSecrets` still lacks `COHERE_API_KEY`. 8.4 edited the file and deferred again to 15.1. Still open.
- (f) The vector search with a tag/document filter can return fewer than `limit` rows once the planner chooses the HNSW index (pgvector applies `WHERE` after the `ef_search` candidates; iterative scan is off by default). This is not visible at corpus scale. Mention it in the 2-1 doc, or `SET LOCAL hnsw.iterative_scan = relaxed_order` on Postgres.

**Confidence**: (a) high, (b) medium, (c) high, (d) medium, (e) high, (f) low

## Verified (no finding)

- Path checks: `isSafeFileName` rejects `""`, a leading `.` (so `..`), `/`, `\` and NUL, and the request schema reuses it (`.max(255)`). `realpath` containment uses `relative()` and rejects `""`, `..`, `../…` and absolute results. Symlink escape → 400 (tests in loader, ingest and route, plus E2E `../README.md` → 400). The 413 → 400 → 400 → `live`-only 429 order is tested, and a rejection does not consume quota.
- SQL: every query is a Drizzle builder or a `sql` template with bound parameters. `to_tsquery('simple', $1)` input is gated by `PLAIN_OR_QUERY` (`\p{L}\p{N}` words joined by ` | `), and `buildFullTextQuery` can only emit that shape (NFKC, lowercase, split on `[^\p{L}\p{N}]`). The `no-sql-raw` allow-list is `migrate.ts` only (the gate scanned 143 files).
- Error leaks: `toPublicError` returns only `code` and the Japanese `message` (details only for `source-unavailable`). `AISDKError` maps to a fixed 503 message (the test injects `sk-secret-value` and a URL, and neither appears). Driver errors are not echoed by `createPostgresDatabase`. `TypeError` stays 500 `unexpected`.
- Transactions: embeddings are computed before the transaction, and the compat check runs before `embedMany` (a test asserts 0 calls). There is one outer transaction with per-document savepoints. `reset` runs inside the same transaction, so a failed reset keeps the old base (tested). `rag_meta` is created with `ON CONFLICT DO NOTHING`, then re-read and compared inside the transaction. An abort before the transaction leaves no rows or meta; after it starts, the write completes (tested with a clock that aborts).
- Chunking: units are per section or per page, so a chunk never spans sections; the corpus property test checks every chunk against exactly one owning section. Lengths are in code points (emoji test). The ID is `sha256(documentId\nheadingPath\nbody)[0:16]` plus `-n` on repeats, so `kb:`/`eval:` IDs never collide. 9.1's corpus has a split section (869 chars), and the eval-set coupling is noted in tasks.md.
- Plan conformance: there is no `agents/` import in `rag/`, no React/Next in ai-core, and no model-ID literal (the tests use `MODEL_DEFAULTS`/`getModelEntry`). Messages are Japanese and identifiers and comments are English. The public `@platform/ai-core/rag` API matches C4–C6 (plus `listIngestableFiles`, which the notes record).
- Stryker additions are sensible (the three pure modules). The 9.3 run scored 86.59 (≥ 70).

## Verdict
REQUEST_CHANGES

F-1 to F-4 are contract-level defects in the wave's own requirements and plan: Req 1.3 duplicates on the learner's default filesystem, a destructive `reset` that silently does nothing, the HTTP `reason` contract, and Req 1.8 batch aborts. Each is small to fix and test. F-5 should be answered with a pg test, or recorded as an explicit item in the human `test:db` step. The LOW items can be answered in the response section. The triggers are resolved: no dependency, no deleted tests, PROVE present, and the boundary deviations are justified but need a plan.md line (F-18).

## Hallucination Signal
forced: false

## Responses

<!-- Implementer appends the response to each finding here (wave migration condition 3). -->


## Responses (2026-10-12)

| ID | 対応 |
|---|---|
| F-1 | 修正。文書 ID を実名（`basename(realPath)`）から作り、要求内も文書 ID で重複排除。テスト 4 件（RED 後に GREEN、PROVE 済み） |
| F-2 | 修正（案 a）。`reset` は 0 件でも実行し、`embeddingModelId` は呼び出し後のナレッジベースのモデル。plan C5 に記録 |
| F-3 | 修正。`invalid-request` の `reason` を許可リスト（`embedding-model-changed` / `too-many-files` / `invalid-file-name`）で返す。errors とルートのテスト |
| F-4 | 修正。`EACCES` / `EPERM` / `EIO` / `EISDIR` は `parse-failed` でスキップ（語彙は増やさない） |
| F-5 | テストを追加（`store.pg.test.ts` の入れ子トランザクション）。Docker が無く未実行。research.md の表に「未実測」の行を追加し、人が `mise run test:db` で埋める |
| F-6〜F-17, F-19 | 未対応（LOW）。M2 の後続タスクまたは最終統合（28）で再評価する。特に F-9（実 Postgres で postgres.js を動かす）は F-5 と同じ人の作業に含める |
| F-18 | plan C5 に規則を追記。Boundary 外の変更は tasks.md の Implementation Notes に記録済み |
