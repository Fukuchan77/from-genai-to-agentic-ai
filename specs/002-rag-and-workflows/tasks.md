# rag-and-workflows（Milestone 2）— 実装タスク（索引）

`/sdd-tasks` が生成した。承認済みの [spec.md](spec.md)（WHAT）と [plan.md](plan.md)（HOW、C1〜C18、Implementation Waves W1〜W6）から、
実装の波ごとに分割した。ルールは `~/.claude/sdd/rules/tasks-generation.md` と `~/.claude/sdd/rules/tasks-parallel-analysis.md`
に従う。並列モード（`--sequential` 未指定）。001 の `tasks.md` と同じ運用（索引 + 現在の波の全文、未着手の波は `tasks-wN.md`、
完了した波は `tasks-comp-wN.md`）を採る。

## ファイル構成

| ファイル | 内容 |
|---|---|
| `tasks.md`（本ファイル） | 表記規約、ID 対応表、進捗、gate への段階的な結線、**現在の波（W2）**のタスク全文 |
| `tasks-w3.md`〜`tasks-w6.md` | 未着手の波。前の波の完了時に `tasks.md` へ昇格する |
| `tasks-comp-w1.md`〜 | 完了した波の保管先（W1 完了）。波の完了時に作る |
| `traceability.md` | 要件 → 設計 → タスク → テスト → コミット（Test と Commit は `/sdd-ship` が埋める） |

タスク番号は全ファイルで一意で、移動しても変えない。`_Depends:_` と `traceability.md` は、ファイルをまたいで
番号だけで参照する。

### 完了した波の移行手順

001 の `tasks.md`「完了した波の移行手順」と同じである（2 つのコミットに分け、1 つ目は `git mv tasks.md tasks-comp-wN.md` だけ、
2 つ目は `git mv tasks-w(N+1).md tasks.md` の後に索引の節を移す）。移行の条件は次のとおり。

1. その波の全サブタスクが `[x]` で、各大タスクの Implementation Notes が記入済みである。
2. 波の締めのタスク（下記「gate への段階的な結線」）が完了し、`mise run gate` と CI の `ci-status` が成功している。
3. その波の敵対的レビュー（憲章 原則 9。新規コンテキストで `sdd-reviewer` と `adversarial-review` skill）の記録が
   `.sdd/reviews/002-rag-and-workflows-impl-wN-review-YYYY-MM-DD.md`（1 ラウンド 1 ファイル）にあり、指摘への対応が追記されている。

## 表記規約

- `- [ ]` 未着手、`- [x]` 完了、`- [ ]*` 任意・後回し可のテスト（この spec では使っていない）。
- `(P)` = 並列実行可（依存なし・境界の重複なし）。同じ波の中で、依存関係の同じ段にあるタスクの間でだけ付ける。
- 各タスク（大タスク・サブタスクの両方）は `_Boundary:_`、`_Depends:_`、`_Requirements:_`、`_Traces:_` を必ず持つ。
- **テスト先行（憲章 原則 4）**: 実装を含むサブタスクは、対応するテストファイルを同じ `_Boundary:_` に含め、RED（失敗の確認）→
  GREEN → REFACTOR を 1 つのサブタスクの中で行う。設定・文書・ガイドなど単独のテストを持たないサブタスクは、検証手段を
  `_Verify:_` に書く。
- `_Requirements:_` は spec.md の受け入れ基準番号（例: `1.1`）を数値のみでカンマ区切りに列挙する。基盤の作業で対応する
  受け入れ基準が plan の部品表（`Requirements` 行）にあるものは、それを書く。
- `_Traces:_` は安定リンク ID を持つ。この spec は `spec.md`/`plan.md` に `REQ-###`/`DES-#.#` 形式の見出しを持たないため、
  下記の対応表で実在する見出しに固定する（001 と同じ扱い）。
- 各大タスクの末尾の `### Implementation Notes` は生成時は空。大タスクの完了後に、実装者が学びを 1〜3 項目追記する。
- **Boundary の対象**: plan の File Structure Plan にあるファイルに限る。次の例外だけを許す。(1) 生成物 `pnpm-lock.yaml`
  （1.1）。(2) `specs/002-rag-and-workflows/` 配下の spec 文書（`research.md` への実測の追記、`traceability.md`）。
  (3) plan C1「既知の影響」が明示する、`mock:judge-v1` の追加で影響を受ける `apps/web` の既存テスト（2.2 の RED で特定）。
- **共有ファイルの編集者**: `mise.toml` は 1.2（`client-bundle` のセンチネル）と各波の締めのタスクだけが編集する。
  `stryker.config.mjs` は各波の締めのタスクだけが編集する。`packages/ai-core/package.json` は 1.1 だけが編集する（`exports` の
  4 サブパス `./structured`、`./rag`、`./workflows`、`./patterns` を含む。参照先の `index.ts` は各領域の最初のタスクが作る）。
  `packages/ai-core/src/models/gateway.ts` の `mock` 既定シナリオへの追加は、シナリオを作る 14.2（M2-1/M2-2）と 18.1・18.2（M2-3/M2-4）だけが行う。
  `packages/ai-core/src/rag/index.ts` は 8.3（初期）と 13.4（最終）、`apps/web/lib/server/platform.ts` は 8.4 と 15.1 だけが編集する。

### ID 対応表

| ID | 対応する見出し |
|---|---|
| `REQ-001`〜`REQ-004` | spec.md の `### Requirement 1`〜`### Requirement 4`（要件グループ単位。受け入れ基準単位の詳細は `_Requirements:_` を見る） |
| `C1`〜`C18` | plan.md の `### C_N <名前>`（実在する見出し。`DES-#.#` の代わりにこの一次 ID を使う。001 の `C1`〜`C22` とは別の番号） |
| `CL-1`〜`CL-12` | plan.md「Clarifications」の決定 |
| `ADR-1`〜`ADR-12`、`R-1`/`R-2` | research.md の決定とリスク |

## 進捗

| 波 | 大タスク | 状態 | ファイル |
|---|---|---|---|
| W1 基盤 | 1 依存と設定ファイル、2 設定・カタログ・ゲートウェイの拡張、3 共通部品（Rerank ポート、`generateValidated`）、4 リポジトリ検査 | 完了（2026-10-12 に移行） | [tasks-comp-w1.md](tasks-comp-w1.md) |
| W2 ナレッジベース | 5 DB 層、6 取り込みの部品、7 埋め込みとストア、8 取り込みの組み立てと HTTP 入口、9 コーパスと実サーバー確認 | 未着手（現在の波） | 本ファイル |
| W3 検索・回答・Agentic | 10 検索パイプライン、11 回答と引用、12 Agentic RAG、13 RAG の評価、14 評価データとシナリオ、15 RAG の HTTP 入口 | 未着手 | [tasks-w3.md](tasks-w3.md) |
| W4 ワークフロー・パターン | 16 ワークフロー、17 エージェントデザインパターン、18 シナリオとデモ、19 ワークフローの HTTP 入口 | 未着手 | [tasks-w4.md](tasks-w4.md) |
| W5 画面と E2E | 20 RAG 画面の部品、21 ワークフロー画面の部品、22 ページ、23 E2E | 未着手 | [tasks-w5.md](tasks-w5.md) |
| W6 評価・解説・統合 | 24 評価テスト、25 `local` での実測、26 解説、27 トレーサビリティ・ステアリング、28 最終統合 | 未着手 | [tasks-w6.md](tasks-w6.md) |

**波の依存**（plan「Implementation Waves」）: W2 は W1 に、W3 は W2 に、W5 は W3 と W4 に、W6 は W5 に依存する。W4 は W1 のみに依存するため
W2・W3 と並行できるが、W3 と W4 は `gateway.ts`・`mock/index.ts`・`fixtures/scenarios/m2.test.ts` を共有するので、シナリオとデモのタスク
（18）は 14.2 の後に行う。関数そのもののタスク（16、17）は W2・W3 と並行してよい。

**plan の波の割り当てからの調整**: コーパス 6 本（plan では W3）を W2 の 9.1 に前倒しした。W2 の実サーバー確認（リスク R-1）が
「取り込み → 検索」を通すにはコーパスが要るためである。ラベル付き質問セット（`eval-set.json`）は plan のとおり W3 の 14.1 で、コーパスを固めた後に書く。
完成タグ（`module/2-1`〜`2-4`）は、解説の完成後に W6 の 28.3 でローカルに付け、push は人が行う。

## gate への段階的な結線

gate の各段は「走査 0 件で失敗」するため、検査対象がまだない規則を最初から入れると、実装の途中で必ず失敗する（001 と同じ）。
規則そのものは W1 の 4.1 で実装して単体テストで守り、`mise.toml` の `check:repo-rules --only` へは、走査対象が揃う波の締めで加える。
一度加えた規則は外さない。`gate` の段の順序は変えない（plan C17）。

| 時点 | 締めのタスク | `check:repo-rules --only` に加える規則 | その他の結線 |
|---|---|---|---|
| W1 の締め | 4.4 | `no-sql-raw`（`ai-core/src` は常に走査対象がある） | — |
| W2 の締め | 9.3 | — | `stryker.config.mjs` に `markdown.ts`、`chunk.ts`、`search-text.ts` |
| W3 の締め | 15.5 | — | `stryker.config.mjs` に `rrf.ts`、`citations.ts`、`recall.ts` |
| W4 の締め | 19.2 | `workflow-no-agent-loop`（`workflows/` と `patterns/` が揃う） | `stryker.config.mjs` に `parallelization.ts`、`evaluator-optimizer.ts` |
| W5 の締め | 23.4 | — | — |
| W6 の締め | 28.1 | — | `docs:check` は 001 から結線済み。2-1〜2-4 の解説が加わった状態で成功することを確かめる |

---

---

## 現在の波: W2 ナレッジベース（大タスク 5〜9）

W1（大タスク 1〜4）は完了し [tasks-comp-w1.md](tasks-comp-w1.md) に移した。

DB 層、取り込み、ストア、`/api/rag/knowledge`・`/api/rag/ingest`、**実サーバーでの PGlite のバンドル確認（リスク R-1）**、初回の
`mise run test:db`（リスク R-2）を行う。R-1 が失敗したら、ADR-1 の A2（品質ゲートで DB を使わない構成）へ退く判断をこの波で行う（人に確認する）。

5 は 6 と並列に進められる（6.1〜6.5 は DB に依存しない）。7 は 5 と 6.2・6.3 の後、8 は 5〜7 の後、9 は 8 の後に行う。

---

## 5. DB 層（C4）

PGlite と Postgres のどちらでも同じ型付きクエリで動く DB ハンドルとスキーマ、手書き SQL のマイグレーションを提供する。
`rag/db/` だけがドライバ（`drizzle-orm/pglite`・`drizzle-orm/postgres-js`・`postgres`・`@electric-sql/pglite`）を import してよい。

_Boundary:_ `packages/ai-core/drizzle/0001_rag_schema.sql`, `packages/ai-core/src/rag/db/schema.ts`, `packages/ai-core/src/rag/db/errors.ts`, `packages/ai-core/src/rag/db/migrate.ts`, `packages/ai-core/src/rag/db/migrate.db.test.ts`, `packages/ai-core/src/rag/db/client.ts`, `packages/ai-core/src/rag/db/schema.db.test.ts`, `packages/ai-core/src/rag/db/client.pg.test.ts`, `packages/ai-core/src/rag/db/index.ts`, `specs/002-rag-and-workflows/research.md`
_Depends:_ 1.1
_Requirements:_ 1.1, 1.3, 1.12
_Traces:_ REQ-001, C4

- [ ] 5.1 マイグレーション SQL と Drizzle のテーブル定義とマイグレーター: `drizzle/0001_rag_schema.sql`（拡張 `vector` の有効化、`rag_migrations`・`rag_meta`・`rag_documents`・`rag_chunks`、plan「Data Model」の列・制約・CHECK・FK `ON DELETE CASCADE`・`UNIQUE (document_id, ordinal)`、HNSW（`vector_cosine_ops`）と GIN のインデックス、`tsv` の生成列）、`rag/db/schema.ts`（Drizzle 定義。`tsvector` は `customType`）、`rag/db/errors.ts`（`KnowledgeBaseUnavailableError` = `provider-unavailable`、`mise run services:up:db` の案内）、`rag/db/migrate.ts`（`runMigrations(db, directory)`: `NNNN_*.sql` を順に、各ファイルを 1 トランザクションで適用し、適用済みの名前を `rag_migrations` に記録。生 SQL を許すのはこのファイルだけ）+ `migrate.db.test.ts` に、適用の順序、再実行しても二重適用しない、失敗したファイルのロールバックと後続の未適用を先に足す（テストは PGlite を直接作る。起動は 1 テストファイルにつき 1 回で `beforeAll`）
  _Boundary:_ `packages/ai-core/drizzle/0001_rag_schema.sql`, `packages/ai-core/src/rag/db/schema.ts`, `packages/ai-core/src/rag/db/errors.ts`, `packages/ai-core/src/rag/db/migrate.ts`, `packages/ai-core/src/rag/db/migrate.db.test.ts`
  _Depends:_ 1.1
  _Requirements:_ 1.1, 1.3, 1.12
  _Traces:_ REQ-001, C4
- [ ] 5.2 `rag/db/client.ts`: `RagDatabase = PgDatabase<PgQueryResultHKT>`、`createPgliteDatabase()`（メモリ上の PGlite に `vector` を有効化してマイグレーションを適用）、`createPostgresDatabase(config)`（postgres.js で接続しマイグレーションを適用。接続失敗は `KnowledgeBaseUnavailableError`）、`RagDatabaseHandle { db; kind; close() }` + `schema.db.test.ts` に、適用後の `information_schema.columns` と `schema.ts` の列名・型の突き合わせ、制約（CHECK の `page >= 1`、`source_type`、FK のカスケード、`UNIQUE (document_id, ordinal)`）とインデックス（HNSW・GIN）の存在、生成列 `tsv` が `search_text` から作られることを先に足す
  _Boundary:_ `packages/ai-core/src/rag/db/client.ts`, `packages/ai-core/src/rag/db/schema.db.test.ts`
  _Depends:_ 5.1
  _Requirements:_ 1.1, 1.12
  _Traces:_ REQ-001, C4
- [ ] 5.3 `rag/db/client.pg.test.ts`: 実 Postgres（Compose の `db` プロファイル）での接続、マイグレーション、初期化 SQL による `CREATE EXTENSION vector` の経路を検証し、`rag/db/index.ts`（DB 層の公開 API）を作る。**初回の `mise run test:db` を実行**し、PostgreSQL 17 + pgvector での結果（成功した項目、差異）を research.md の「Req 1.12 の分類」とリスク R-2 に追記する。Docker を起動できない環境では、テストと記録欄だけを作り、実行と追記を「人が行うこと」として Implementation Notes に明記して残す（憲章 原則 8。未実測を実測済みと書かない）
  _Boundary:_ `packages/ai-core/src/rag/db/client.pg.test.ts`, `packages/ai-core/src/rag/db/index.ts`, `specs/002-rag-and-workflows/research.md`
  _Depends:_ 5.2
  _Requirements:_ 1.1, 1.12
  _Traces:_ REQ-001, C4
  _Verify:_ `mise run test:db` で `client.pg.test.ts` が成功する（Docker が必要）。`mise run gate` では `*.pg.test.ts` が走らず、gate が成功する

### Implementation Notes

<!-- Empty at generation. Implementer appends 1-3 bullet learnings after completing this major task. -->

---

## 6. 取り込みの部品（C5、C15 の `pdf-builder`）

文書ファイルを検査・読み込み・分割する純粋な部品。DB に依存しないので、5 と並列に進められる。

_Boundary:_ `packages/ai-core/src/rag/ingest/markdown.ts`, `packages/ai-core/src/rag/ingest/markdown.test.ts`, `packages/ai-core/src/rag/ingest/chunk.ts`, `packages/ai-core/src/rag/ingest/chunk.test.ts`, `packages/ai-core/src/rag/ingest/search-text.ts`, `packages/ai-core/src/rag/ingest/search-text.test.ts`, `packages/ai-core/src/testing/pdf-builder.ts`, `packages/ai-core/src/testing/pdf-builder.test.ts`, `packages/ai-core/src/testing/index.ts`, `packages/ai-core/src/rag/ingest/pdf.ts`, `packages/ai-core/src/rag/ingest/pdf.test.ts`, `packages/ai-core/src/rag/ingest/loader.ts`, `packages/ai-core/src/rag/ingest/loader.test.ts`
_Depends:_ 1.1
_Requirements:_ 1.1, 1.2, 1.8, 2.3
_Traces:_ REQ-001, REQ-002, C5, C15

- [ ] 6.1 (P) `rag/ingest/markdown.ts`: `splitMarkdown(text): MarkdownSection[]`（ATX 見出し `#`〜`######` のみ。フェンス付きコードブロック内の `#` は見出しにしない。YAML の front matter から `tags` だけを読む。見出しの階層 `headingPath` を持つ）+ `markdown.test.ts` に、見出し境界での分割（1 つのセクションが複数の見出しをまたがない）、フェンス内の `#`、見出しの前の本文、空のセクション、front matter の `tags`（なし・配列・不正な形）、深い階層のパスを先に足す
  _Boundary:_ `packages/ai-core/src/rag/ingest/markdown.ts`, `packages/ai-core/src/rag/ingest/markdown.test.ts`
  _Depends:_ 1.1
  _Requirements:_ 1.2
  _Traces:_ REQ-001, C5
- [ ] 6.2 `rag/ingest/chunk.ts`: `chunkDocument(doc, options): Chunk[]`（セクションが `chunkMaxCharacters`（コードポイント数）を超えるとき、段落、さらに文の境界で分ける。チャンク ID は ADR-5 の内容ハッシュ。重複時は `-2`、`-3`。1 つのチャンクが複数の見出しセクションをまたがない）+ `chunk.test.ts` に、最大文字数（コードポイントで数える。サロゲートペアを含む）、段落 → 文の順の分割、ID の安定性（同じ入力で同じ ID、本文が変われば変わる、文書の位置に依存しない）、重複する本文の接尾辞、見出しをまたがないこと（性質テスト）を先に足す
  _Boundary:_ `packages/ai-core/src/rag/ingest/chunk.ts`, `packages/ai-core/src/rag/ingest/chunk.test.ts`
  _Depends:_ 6.1
  _Requirements:_ 1.1, 1.2
  _Traces:_ REQ-001, C5
- [ ] 6.3 (P) `rag/ingest/search-text.ts`: `toSearchText(text)`（`Intl.Segmenter("ja")` による分かち書きと、ひらがなだけで 2 文字以下の語の除去。ADR-3）、`buildFullTextQuery(text)`（OR クエリ。語を英数字・かな・漢字に正規化してバインド用の文字列にする。語が 0 件なら `undefined`）+ `search-text.test.ts` に、日本語の分かち書き、助詞の除去、英数字の混在、記号・演算子文字（`&`・`|`・`!`・`:`・引用符）の無害化、語が 0 件の入力（助詞だけ）で `undefined` を返すことを先に足す。Node 26 の ICU が `ja` を分かち書きできることをテストで確かめる
  _Boundary:_ `packages/ai-core/src/rag/ingest/search-text.ts`, `packages/ai-core/src/rag/ingest/search-text.test.ts`
  _Depends:_ none
  _Requirements:_ 2.3
  _Traces:_ REQ-002, C5
- [ ] 6.4 (P) `testing/pdf-builder.ts`: `buildTextPdf(pages: string[]): Uint8Array`（本文が ASCII の最小 PDF をメモリ上に生成する。PDF のバイナリはリポジトリに置かない）を作り、`testing/index.ts` から再エクスポートする + `pdf-builder.test.ts` に、生成した PDF を `unpdf` で読み戻してページ数と本文が一致すること、空のページ、複数ページを先に足す
  _Boundary:_ `packages/ai-core/src/testing/pdf-builder.ts`, `packages/ai-core/src/testing/pdf-builder.test.ts`, `packages/ai-core/src/testing/index.ts`
  _Depends:_ 1.1
  _Requirements:_ 1.1, 1.8
  _Traces:_ REQ-001, C15
- [ ] 6.5 `rag/ingest/pdf.ts`: `extractPdfPages(bytes): Promise<string[]>`（`unpdf` でページごとの本文を抽出し、失敗を理由 `parse-failed` に変換する。全ページが空なら呼び出し側が `no-text` を判定できるよう、ページ配列をそのまま返す）+ `pdf.test.ts` に、`buildTextPdf` で作った PDF のページ単位の抽出、空のページだけの PDF、壊れたバイト列（`parse-failed`）を先に足す
  _Boundary:_ `packages/ai-core/src/rag/ingest/pdf.ts`, `packages/ai-core/src/rag/ingest/pdf.test.ts`
  _Depends:_ 6.4
  _Requirements:_ 1.1, 1.8
  _Traces:_ REQ-001, C5
- [ ] 6.6 `rag/ingest/loader.ts`: `loadKnowledgeFile(root, name): Promise<LoadedDocument | SkippedFile>`（ファイル名は 1 セグメントのみ。`..`・区切り文字・先頭の `.`・NUL を拒否して `invalid-request`。`realpath` が root 配下であること、通常のファイルであること、サイズ上限を検査する。拡張子で形式 `.md`/`.markdown`/`.pdf` を判定し、`unsupported-format`・`no-text`・`parse-failed`・`too-large`・`not-found` を `SkippedFile` として返す。ファイルを読む前に検査する）+ `loader.test.ts` に、パストラバーサルの各表記、シンボリックリンクによる root 外への脱出、隠しファイル、ディレクトリ、サイズ超過、非対応形式、空の PDF、存在しないファイル、スキップ理由の 5 種すべてを、一時ディレクトリで先に足す
  _Boundary:_ `packages/ai-core/src/rag/ingest/loader.ts`, `packages/ai-core/src/rag/ingest/loader.test.ts`
  _Depends:_ 6.1, 6.5
  _Requirements:_ 1.1, 1.8
  _Traces:_ REQ-001, C5

### Implementation Notes

<!-- Empty at generation. Implementer appends 1-3 bullet learnings after completing this major task. -->

---

## 7. 埋め込みとナレッジベースのストア（C6）

ナレッジベースへの書き込みと検索クエリを 1 か所（`rag/store.ts`）に集め、埋め込みの次元とモデルを検査する。全 SQL はここに置く。

_Boundary:_ `packages/ai-core/src/rag/embedding.ts`, `packages/ai-core/src/rag/embedding.test.ts`, `packages/ai-core/src/rag/store.ts`, `packages/ai-core/src/rag/store.db.test.ts`, `packages/ai-core/src/rag/store.pg.test.ts`, `specs/002-rag-and-workflows/research.md`
_Depends:_ 2.2, 5.2, 5.3, 6.2, 6.3
_Requirements:_ 1.1, 1.3, 1.4, 1.6, 1.7, 1.12, 2.3
_Traces:_ REQ-001, REQ-002, C6

- [ ] 7.1 (P) `rag/embedding.ts`: `embedTexts({ resolved, values, signal })`（`embedMany`。`entry.provider` に応じて `providerOptions` を付ける: OpenAI は `dimensions: 768`、Google は `outputDimensionality: 768`。結果の長さが 768 でなければ `output-invalid`）、`embedQuery`、`assertKnowledgeBaseCompatible(meta, resolved)`（不一致は `invalid-request` の `reason: "embedding-model-changed"`）+ `embedding.test.ts` に、プロバイダ別の次元の指定、長さの不一致、モデルの不一致、`rag_meta` が空のとき許可、中断を先に足す（M1 の `deterministic-embedding` を `dimensions: 768` で使う）
  _Boundary:_ `packages/ai-core/src/rag/embedding.ts`, `packages/ai-core/src/rag/embedding.test.ts`
  _Depends:_ 2.2
  _Requirements:_ 1.1
  _Traces:_ REQ-001, C6
- [ ] 7.2 `rag/store.ts`（書き込み側）: `createKnowledgeStore(db)` の `replaceDocument(doc, chunks, embedding, meta)`（1 トランザクション: 文書の削除 → 挿入。`rag_meta` の作成と照合。`ingested_at` は `Clock` から設定し、SQL に `now()` を書かない）、`getChunks(ids)`、`listDocuments()`、`getMeta()`、`reset()` + `store.db.test.ts`（テストファイルごとに PGlite を 1 つ作り、各テストの前に `TRUNCATE`）に、保存内容（本文・出典メタデータ・ページ・見出しパス・埋め込み）、同一文書の再取り込みで置換され重複しない、途中で失敗したら既存のチャンクが残る（ロールバック）、`tags` の和集合の保存、`rag_meta` の不一致の拒否、`reset()` を先に足す
  _Boundary:_ `packages/ai-core/src/rag/store.ts`, `packages/ai-core/src/rag/store.db.test.ts`
  _Depends:_ 5.2, 6.2, 7.1
  _Requirements:_ 1.1, 1.3
  _Traces:_ REQ-001, C6
- [ ] 7.3 `rag/store.ts`（検索側）: `searchByVector({ embedding, limit, minSimilarity, filter })`（`<=>` のコサイン距離から類似度を計算し、閾値未満を捨てる。`ScoredChunk { chunk; score; similarity? }`）、`searchByFullText({ query, limit, filter })`（`ts_rank`。`plainto_tsquery` ではなく、`buildFullTextQuery` が作る語をバインドして組み立てる）、`filter { documentIds?; tags? }`（`tags` は `&&`）+ `store.db.test.ts` に、`<=>` の順位と類似度の値、閾値の境界値（ちょうどの値を含める）、`tags` と文書名のフィルタ、全文検索の順位、日本語の分かち書き経由の一致、空クエリ（`undefined`）で検索しない、上限 `limit` を先に足す
  _Boundary:_ `packages/ai-core/src/rag/store.ts`, `packages/ai-core/src/rag/store.db.test.ts`
  _Depends:_ 6.3, 7.2
  _Requirements:_ 1.4, 1.6, 1.7, 2.3
  _Traces:_ REQ-001, REQ-002, C6
- [ ] 7.4 `rag/store.pg.test.ts`: `store.db.test.ts` と同じケースを実 Postgres で実行する（`mise run test:db`。共通のケース表を `store.db.test.ts` から再利用するか、同じ入力を複製して結果が同じになることを検証する）。Docker を起動できない環境では、テストだけを作り、実行を「人が行うこと」として Implementation Notes に残す。実行できたら結果を research.md の R-2 に追記する
  _Boundary:_ `packages/ai-core/src/rag/store.pg.test.ts`, `specs/002-rag-and-workflows/research.md`
  _Depends:_ 5.3, 7.3
  _Requirements:_ 1.3, 1.6, 1.12
  _Traces:_ REQ-001, C6
  _Verify:_ `mise run test:db` で `store.pg.test.ts` が成功する（Docker が必要）。`mise run gate` では走らない

### Implementation Notes

<!-- Empty at generation. Implementer appends 1-3 bullet learnings after completing this major task. -->

---

## 8. 取り込みの組み立てと HTTP 入口（C5、C13 の一部）

読み込み → 分割 → 埋め込み → 文書単位の置換保存を組み立て、`GET /api/rag/knowledge` と `POST /api/rag/ingest` を既存の検査順（`guard → resolve → validate → ingest`）で提供する。

_Boundary:_ `packages/ai-core/src/rag/ingest/ingest.ts`, `packages/ai-core/src/rag/ingest/ingest.db.test.ts`, `packages/ai-core/src/rag/ingest/index.ts`, `packages/ai-core/src/rag/request-schema.ts`, `packages/ai-core/src/rag/request-schema.test.ts`, `packages/ai-core/src/rag/index.ts`, `apps/web/lib/server/platform.ts`, `apps/web/lib/server/platform.test.ts`, `apps/web/app/api/rag/knowledge/route.ts`, `apps/web/app/api/rag/knowledge/route.test.ts`, `apps/web/app/api/rag/ingest/route.ts`, `apps/web/app/api/rag/ingest/route.test.ts`
_Depends:_ 2.1, 5.3, 6.2, 6.6, 7.2, 7.3
_Requirements:_ 1.1, 1.3, 1.8, 2.12
_Traces:_ REQ-001, REQ-002, C5, C13

- [ ] 8.1 `rag/ingest/ingest.ts`: `ingestDocuments({ db, embedding, source, root, files, tags?, reset?, signal? }): Promise<IngestResult>`（文書 ID は取り込み元の接頭辞 `kb:`/`eval:` とファイル名から組み立てる。埋め込みはトランザクションの前に `embedMany` で計算する。`IngestResult { ingested; skipped; embeddingModelId }`。`reset: true` は `rag_*` を空にしてから取り込む。中断はトランザクションの前なら埋め込みを中断して開始せず、開始後は完了させる）と `ingest/index.ts` を作る + `ingest.db.test.ts` に、保存内容、再取り込みで置換され重複しない、埋め込みの失敗で既存のチャンクが残る、スキップの報告（5 種の理由）、`kb:` と `eval:` で同名ファイルが置換し合わない、埋め込みモデルの不一致の拒否と `reset: true` での作り直し、中断を先に足す
  _Boundary:_ `packages/ai-core/src/rag/ingest/ingest.ts`, `packages/ai-core/src/rag/ingest/ingest.db.test.ts`, `packages/ai-core/src/rag/ingest/index.ts`
  _Depends:_ 6.2, 6.6, 7.2
  _Requirements:_ 1.1, 1.3, 1.8
  _Traces:_ REQ-001, C5
- [ ] 8.2 (P) `rag/request-schema.ts`（取り込みと知識ベース一覧）: `POST /api/rag/ingest` の `z.strictObject`（`source: "knowledge" | "eval-corpus"`、`files?`（50 件以下、各ファイル名は 1 セグメント）、`tags?`（10 件以下、各 40 文字以下）、`reset?`）。クエリのスキーマは 11.3 が足す + `request-schema.test.ts` に、未知フィールドの拒否、範囲、既定値、ファイル名のパス検査の違反を先に足す
  _Boundary:_ `packages/ai-core/src/rag/request-schema.ts`, `packages/ai-core/src/rag/request-schema.test.ts`
  _Depends:_ 2.1
  _Requirements:_ 1.1, 1.8
  _Traces:_ REQ-001, C13
- [ ] 8.3 `rag/index.ts`: `@platform/ai-core/rag` の公開 API の初期版（DB 層、取り込み、埋め込み、ストア、リクエストスキーマ。型を含む）。`rag/` が `agents/` を import しないことを確認する
  _Boundary:_ `packages/ai-core/src/rag/index.ts`
  _Depends:_ 5.3, 7.3, 8.1, 8.2
  _Requirements:_ 1.1
  _Traces:_ REQ-001, C4, C5, C6
  _Verify:_ `apps/web` から `@platform/ai-core/rag` を import する 8.4 の型検査が通る。`mise run typecheck` と `check:repo-rules` が成功する
- [ ] 8.4 `apps/web/lib/server/platform.ts`: `getKnowledgeBase()`（実行モードに応じて `mock` は PGlite、`local`/`live` は postgres.js のハンドルを 1 回だけ作る。接続失敗は `provider-unavailable`）と `knowledgeRoots`（`knowledge/` と評価コーパスの絶対パス）を足す。`ports.rerank` は 15.1 が足す + `platform.test.ts` に、実行モード別の DB の種類、1 回だけ作ること、`knowledgeRoots` の絶対パスを先に足す
  _Boundary:_ `apps/web/lib/server/platform.ts`, `apps/web/lib/server/platform.test.ts`
  _Depends:_ 8.3
  _Requirements:_ 1.1
  _Traces:_ REQ-001, C13
- [ ] 8.5 (P) `app/api/rag/knowledge/route.ts`: 知識ベースの状態と取り込み可能なファイルの一覧（plan「HTTP API」のレスポンス。`embedding`、`knowledgeBase`、`available`、`rerank`）。`rerank.available` は `mock` で常に真、`local`/`live` は `COHERE_API_KEY` の有無から導く（15.1 より前でもポートに依存しない）。Postgres に接続できなければ 503 `provider-unavailable` で起動方法を案内する + `route.test.ts` に、検査順、空のナレッジベース、取り込み済みの文書の一覧、503 を先に足す
  _Boundary:_ `apps/web/app/api/rag/knowledge/route.ts`, `apps/web/app/api/rag/knowledge/route.test.ts`
  _Depends:_ 8.4
  _Requirements:_ 1.1, 2.12
  _Traces:_ REQ-001, REQ-002, C13
- [ ] 8.6 (P) `app/api/rag/ingest/route.ts`: 取り込み（`guard → resolve → validate → ingest`）。非対応形式・テキスト抽出不可・サイズ超過・存在しないファイルは拒否せず `skipped` に理由付きで含める。ファイル名のパス検査の違反と埋め込みモデルの不一致は 400 `invalid-request`、埋め込みの次元不正は 502 `output-invalid`。`ModelSelectionError(no-default)` は `AI_MODEL_EMBEDDING` とプロバイダのキーの設定を案内する `invalid-request` に変換する。`request.signal` を伝播する + `route.test.ts` に、検査順（413 → 400 → 400 → `live` のみ 429）、各拒否のコード、`skipped` の理由、`source: "eval-corpus"` の取り込み、中断を先に足す
  _Boundary:_ `apps/web/app/api/rag/ingest/route.ts`, `apps/web/app/api/rag/ingest/route.test.ts`
  _Depends:_ 8.1, 8.2, 8.4
  _Requirements:_ 1.1, 1.3, 1.8, 2.12
  _Traces:_ REQ-001, REQ-002, C13

### Implementation Notes

<!-- Empty at generation. Implementer appends 1-3 bullet learnings after completing this major task. -->

---

## 9. コーパスと実サーバー確認、W2 の締め（C15、C13、C17）

評価用の日本語コーパスを置き、Next.js の実サーバー（Turbopack）で PGlite・`unpdf`・`postgres` のバンドルが通ることを確かめる（M1 W4 の教訓。
Vitest はバンドラーを通らないため、ここでしか検出できない）。

_Boundary:_ `packages/ai-core/fixtures/rag/corpus/01-rag-overview.md`, `packages/ai-core/fixtures/rag/corpus/02-chunking.md`, `packages/ai-core/fixtures/rag/corpus/03-embeddings-and-search.md`, `packages/ai-core/fixtures/rag/corpus/04-hybrid-and-rrf.md`, `packages/ai-core/fixtures/rag/corpus/05-rerank-and-evaluation.md`, `packages/ai-core/fixtures/rag/corpus/06-agentic-rag.md`, `packages/ai-core/src/rag/ingest/ingest.db.test.ts`, `apps/web/next.config.ts`, `apps/web/e2e/real-server.spec.ts`, `stryker.config.mjs`
_Depends:_ 1.2, 6.1, 6.2, 6.3, 7.4, 8.1, 8.6
_Requirements:_ 1.1, 1.2, 1.12, 2.12
_Traces:_ REQ-001, REQ-002, C13, C15, C17

- [ ] 9.1 評価用コーパス 6 本（`01-rag-overview.md`、`02-chunking.md`、`03-embeddings-and-search.md`、`04-hybrid-and-rrf.md`、`05-rerank-and-evaluation.md`、`06-agentic-rag.md`）を日本語で書く。見出し構造（H1〜H3）を持ち、HyDE・Multi-Query・RRF・Rerank・忠実性など検索手法の違いを問う質問の根拠になる内容にする。1 セクションを 800 文字以下に収めすぎず、分割が起きるセクションも 1 つ以上含める。正解チャンク ID は内容ハッシュなので、**この後の編集は 14.1 の `eval-set.json` の更新を伴う**ことをファイルの先頭ではなく Implementation Notes に書く + `ingest.db.test.ts` に、実コーパス 6 本が `skipped` なしで取り込めること、全チャンクが `chunkMaxCharacters` 以下で見出しをまたがないこと、チャンク ID が一意であることを先に足す（`eval:` 接頭辞で取り込む）
  _Boundary:_ `packages/ai-core/fixtures/rag/corpus/01-rag-overview.md`, `packages/ai-core/fixtures/rag/corpus/02-chunking.md`, `packages/ai-core/fixtures/rag/corpus/03-embeddings-and-search.md`, `packages/ai-core/fixtures/rag/corpus/04-hybrid-and-rrf.md`, `packages/ai-core/fixtures/rag/corpus/05-rerank-and-evaluation.md`, `packages/ai-core/fixtures/rag/corpus/06-agentic-rag.md`, `packages/ai-core/src/rag/ingest/ingest.db.test.ts`
  _Depends:_ 8.1
  _Requirements:_ 1.1, 1.2, 2.12
  _Traces:_ REQ-001, REQ-002, C15
- [ ] 9.2 `next.config.ts` の `serverExternalPackages` に `@electric-sql/pglite`・`postgres`・`unpdf` を足し、`next build` が成功すること、実サーバー（`mock`、PGlite）で `GET /api/rag/knowledge` が 200 で、`POST /api/rag/ingest`（`source: "eval-corpus"`）が通り、ブラウザ・サーバーのエラーが 0 であることを `real-server.spec.ts` に足す（画面は W5 の 23.3 で足す）。最小の `serverExternalPackages` の集合を、足したものを 1 つずつ外して確定し、Implementation Notes に記録する。**R-1 が失敗したら、ADR-1 の A2 へ退く判断を人に確認する**（勝手に構成を変えない）。`mise run build` 後に `mise run check:client-bundle` が `COHERE_API_KEY` のセンチネルを含めて成功することも確かめる
  _Boundary:_ `apps/web/next.config.ts`, `apps/web/e2e/real-server.spec.ts`
  _Depends:_ 1.2, 8.6, 9.1
  _Requirements:_ 1.1, 1.12
  _Traces:_ REQ-001, C13, C17
  _Verify:_ `mise run test:e2e`（`real-server.spec.ts`。3 エンジン）が成功し、`mise run check:client-bundle` が成功する
- [ ] 9.3 **W2 の締め**: `stryker.config.mjs` の `mutate` に `rag/ingest/markdown.ts`、`rag/ingest/chunk.ts`、`rag/ingest/search-text.ts` を足し、`mise run test:mutation` が閾値 70 を満たすことを確かめる（満たさなければ、生き残った変異に対するテストを足す）。`mise run gate` が成功することを確かめ、所要時間を Implementation Notes に記録する（`*.db.test.ts` の追加による増分を含む。予算 5 分）
  _Boundary:_ `stryker.config.mjs`
  _Depends:_ 6.1, 6.2, 6.3, 7.4, 9.2
  _Requirements:_ 1.2
  _Traces:_ REQ-001, C17
  _Verify:_ `mise run gate` と `mise run test:mutation` が成功する。gate の所要時間を記録する 波の敵対的レビュー（憲章 原則 9。新規コンテキストで `sdd-reviewer`）を行い、記録 `.sdd/reviews/002-rag-and-workflows-impl-w2-review-YYYY-MM-DD.md` が存在し、指摘への対応が追記されていることを確かめる（波の移行条件 3）

### Implementation Notes

<!-- Empty at generation. Implementer appends 1-3 bullet learnings after completing this major task. -->
