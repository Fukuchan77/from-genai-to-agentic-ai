# rag-and-workflows（Milestone 2）— 完了した実装タスク W2: ナレッジベース（大タスク 5〜9）

完了した波（2026-10-12 に移行）。表記規約、ID 対応表、進捗、gate への段階的な結線、完了した波の移行手順は
[tasks.md](tasks.md) を参照する。波の敵対的レビューの記録は
`.sdd/reviews/002-rag-and-workflows-impl-w2-review-2026-10-12.md`（1 ラウンド。指摘への対応を追記済み）。
コミット: `5cd0a52`、`b904eff`、`4f01313`、`a86c4f2`。

---

## W2 ナレッジベース（大タスク 5〜9）

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

- [x] 5.1 マイグレーション SQL と Drizzle のテーブル定義とマイグレーター: `drizzle/0001_rag_schema.sql`（拡張 `vector` の有効化、`rag_migrations`・`rag_meta`・`rag_documents`・`rag_chunks`、plan「Data Model」の列・制約・CHECK・FK `ON DELETE CASCADE`・`UNIQUE (document_id, ordinal)`、HNSW（`vector_cosine_ops`）と GIN のインデックス、`tsv` の生成列）、`rag/db/schema.ts`（Drizzle 定義。`tsvector` は `customType`）、`rag/db/errors.ts`（`KnowledgeBaseUnavailableError` = `provider-unavailable`、`mise run services:up:db` の案内）、`rag/db/migrate.ts`（`runMigrations(db, directory)`: `NNNN_*.sql` を順に、各ファイルを 1 トランザクションで適用し、適用済みの名前を `rag_migrations` に記録。生 SQL を許すのはこのファイルだけ）+ `migrate.db.test.ts` に、適用の順序、再実行しても二重適用しない、失敗したファイルのロールバックと後続の未適用を先に足す（テストは PGlite を直接作る。起動は 1 テストファイルにつき 1 回で `beforeAll`）
  _Boundary:_ `packages/ai-core/drizzle/0001_rag_schema.sql`, `packages/ai-core/src/rag/db/schema.ts`, `packages/ai-core/src/rag/db/errors.ts`, `packages/ai-core/src/rag/db/migrate.ts`, `packages/ai-core/src/rag/db/migrate.db.test.ts`
  _Depends:_ 1.1
  _Requirements:_ 1.1, 1.3, 1.12
  _Traces:_ REQ-001, C4
- [x] 5.2 `rag/db/client.ts`: `RagDatabase = PgDatabase<PgQueryResultHKT>`、`createPgliteDatabase()`（メモリ上の PGlite に `vector` を有効化してマイグレーションを適用）、`createPostgresDatabase(config)`（postgres.js で接続しマイグレーションを適用。接続失敗は `KnowledgeBaseUnavailableError`）、`RagDatabaseHandle { db; kind; close() }` + `schema.db.test.ts` に、適用後の `information_schema.columns` と `schema.ts` の列名・型の突き合わせ、制約（CHECK の `page >= 1`、`source_type`、FK のカスケード、`UNIQUE (document_id, ordinal)`）とインデックス（HNSW・GIN）の存在、生成列 `tsv` が `search_text` から作られることを先に足す
  _Boundary:_ `packages/ai-core/src/rag/db/client.ts`, `packages/ai-core/src/rag/db/schema.db.test.ts`
  _Depends:_ 5.1
  _Requirements:_ 1.1, 1.12
  _Traces:_ REQ-001, C4
- [x] 5.3 `rag/db/client.pg.test.ts`: 実 Postgres（Compose の `db` プロファイル）での接続、マイグレーション、初期化 SQL による `CREATE EXTENSION vector` の経路を検証し、`rag/db/index.ts`（DB 層の公開 API）を作る。**初回の `mise run test:db` を実行**し、PostgreSQL 17 + pgvector での結果（成功した項目、差異）を research.md の「Req 1.12 の分類」とリスク R-2 に追記する。Docker を起動できない環境では、テストと記録欄だけを作り、実行と追記を「人が行うこと」として Implementation Notes に明記して残す（憲章 原則 8。未実測を実測済みと書かない）
  _Boundary:_ `packages/ai-core/src/rag/db/client.pg.test.ts`, `packages/ai-core/src/rag/db/index.ts`, `specs/002-rag-and-workflows/research.md`
  _Depends:_ 5.2
  _Requirements:_ 1.1, 1.12
  _Traces:_ REQ-001, C4
  _Verify:_ `mise run test:db` で `client.pg.test.ts` が成功する（Docker が必要）。`mise run gate` では `*.pg.test.ts` が走らず、gate が成功する

### Implementation Notes

- マイグレーション SQL は `--> statement-breakpoint` で文を区切る（drizzle-kit と同じ記法）。PGlite の `db.execute` は拡張プロトコルで複数文を 1 回に送れないため、文ごとに実行する。`rag_migrations` は `runMigrations` が先に `CREATE TABLE IF NOT EXISTS` で作る（0001 自身も同じ定義を持つ）。`RagDatabase` の定義は循環を避けて `migrate.ts` に置き、`client.ts` から再エクスポートした。
- 型付きの `drizzle(client)` は `Record<string, never>` のスキーマ型で `RagDatabase` に代入できるが、`ReturnType<typeof drizzle>` は `Record<string, unknown>` に広がって代入できない（`tsc` だけが検出し、Vitest は検出しない）。共通型の `execute` は戻り値が `unknown` で、PGlite は `{ rows }`、postgres.js は配列を返すため、行の取り出しは生 SQL の境界（`rowsOf`）に閉じ込めた。
- テストの順序検査は `readdir` を逆順に返すモックを入れて初めて非空虚になる（APFS は名前順で返すため、`.sort()` を外してもテストが通っていた。PROVE で発見）。**人が行うこと（5.3）**: Docker を起動して `mise run test:db` を実行し、`research.md` の「W2 5.3 の記録」の表（Req 1.12 の分類、リスク R-2）を埋める。この環境では Docker デーモンが無く未実行で、`client.pg.test.ts` は `ECONNREFUSED` で失敗することだけを確認した。

---

## 6. 取り込みの部品（C5、C15 の `pdf-builder`）

文書ファイルを検査・読み込み・分割する純粋な部品。DB に依存しないので、5 と並列に進められる。

_Boundary:_ `packages/ai-core/src/rag/ingest/markdown.ts`, `packages/ai-core/src/rag/ingest/markdown.test.ts`, `packages/ai-core/src/rag/ingest/chunk.ts`, `packages/ai-core/src/rag/ingest/chunk.test.ts`, `packages/ai-core/src/rag/ingest/search-text.ts`, `packages/ai-core/src/rag/ingest/search-text.test.ts`, `packages/ai-core/src/testing/pdf-builder.ts`, `packages/ai-core/src/testing/pdf-builder.test.ts`, `packages/ai-core/src/testing/index.ts`, `packages/ai-core/src/rag/ingest/pdf.ts`, `packages/ai-core/src/rag/ingest/pdf.test.ts`, `packages/ai-core/src/rag/ingest/loader.ts`, `packages/ai-core/src/rag/ingest/loader.test.ts`
_Depends:_ 1.1
_Requirements:_ 1.1, 1.2, 1.8, 2.3
_Traces:_ REQ-001, REQ-002, C5, C15

- [x] 6.1 (P) `rag/ingest/markdown.ts`: `splitMarkdown(text): MarkdownSection[]`（ATX 見出し `#`〜`######` のみ。フェンス付きコードブロック内の `#` は見出しにしない。YAML の front matter から `tags` だけを読む。見出しの階層 `headingPath` を持つ）+ `markdown.test.ts` に、見出し境界での分割（1 つのセクションが複数の見出しをまたがない）、フェンス内の `#`、見出しの前の本文、空のセクション、front matter の `tags`（なし・配列・不正な形）、深い階層のパスを先に足す
  _Boundary:_ `packages/ai-core/src/rag/ingest/markdown.ts`, `packages/ai-core/src/rag/ingest/markdown.test.ts`
  _Depends:_ 1.1
  _Requirements:_ 1.2
  _Traces:_ REQ-001, C5
- [x] 6.2 `rag/ingest/chunk.ts`: `chunkDocument(doc, options): Chunk[]`（セクションが `chunkMaxCharacters`（コードポイント数）を超えるとき、段落、さらに文の境界で分ける。チャンク ID は ADR-5 の内容ハッシュ。重複時は `-2`、`-3`。1 つのチャンクが複数の見出しセクションをまたがない）+ `chunk.test.ts` に、最大文字数（コードポイントで数える。サロゲートペアを含む）、段落 → 文の順の分割、ID の安定性（同じ入力で同じ ID、本文が変われば変わる、文書の位置に依存しない）、重複する本文の接尾辞、見出しをまたがないこと（性質テスト）を先に足す
  _Boundary:_ `packages/ai-core/src/rag/ingest/chunk.ts`, `packages/ai-core/src/rag/ingest/chunk.test.ts`
  _Depends:_ 6.1
  _Requirements:_ 1.1, 1.2
  _Traces:_ REQ-001, C5
- [x] 6.3 (P) `rag/ingest/search-text.ts`: `toSearchText(text)`（`Intl.Segmenter("ja")` による分かち書きと、ひらがなだけで 2 文字以下の語の除去。ADR-3）、`buildFullTextQuery(text)`（OR クエリ。語を英数字・かな・漢字に正規化してバインド用の文字列にする。語が 0 件なら `undefined`）+ `search-text.test.ts` に、日本語の分かち書き、助詞の除去、英数字の混在、記号・演算子文字（`&`・`|`・`!`・`:`・引用符）の無害化、語が 0 件の入力（助詞だけ）で `undefined` を返すことを先に足す。Node 26 の ICU が `ja` を分かち書きできることをテストで確かめる
  _Boundary:_ `packages/ai-core/src/rag/ingest/search-text.ts`, `packages/ai-core/src/rag/ingest/search-text.test.ts`
  _Depends:_ none
  _Requirements:_ 2.3
  _Traces:_ REQ-002, C5
- [x] 6.4 (P) `testing/pdf-builder.ts`: `buildTextPdf(pages: string[]): Uint8Array`（本文が ASCII の最小 PDF をメモリ上に生成する。PDF のバイナリはリポジトリに置かない）を作り、`testing/index.ts` から再エクスポートする + `pdf-builder.test.ts` に、生成した PDF を `unpdf` で読み戻してページ数と本文が一致すること、空のページ、複数ページを先に足す
  _Boundary:_ `packages/ai-core/src/testing/pdf-builder.ts`, `packages/ai-core/src/testing/pdf-builder.test.ts`, `packages/ai-core/src/testing/index.ts`
  _Depends:_ 1.1
  _Requirements:_ 1.1, 1.8
  _Traces:_ REQ-001, C15
- [x] 6.5 `rag/ingest/pdf.ts`: `extractPdfPages(bytes): Promise<string[]>`（`unpdf` でページごとの本文を抽出し、失敗を理由 `parse-failed` に変換する。全ページが空なら呼び出し側が `no-text` を判定できるよう、ページ配列をそのまま返す）+ `pdf.test.ts` に、`buildTextPdf` で作った PDF のページ単位の抽出、空のページだけの PDF、壊れたバイト列（`parse-failed`）を先に足す
  _Boundary:_ `packages/ai-core/src/rag/ingest/pdf.ts`, `packages/ai-core/src/rag/ingest/pdf.test.ts`
  _Depends:_ 6.4
  _Requirements:_ 1.1, 1.8
  _Traces:_ REQ-001, C5
- [x] 6.6 `rag/ingest/loader.ts`: `loadKnowledgeFile(root, name): Promise<LoadedDocument | SkippedFile>`（ファイル名は 1 セグメントのみ。`..`・区切り文字・先頭の `.`・NUL を拒否して `invalid-request`。`realpath` が root 配下であること、通常のファイルであること、サイズ上限を検査する。拡張子で形式 `.md`/`.markdown`/`.pdf` を判定し、`unsupported-format`・`no-text`・`parse-failed`・`too-large`・`not-found` を `SkippedFile` として返す。ファイルを読む前に検査する）+ `loader.test.ts` に、パストラバーサルの各表記、シンボリックリンクによる root 外への脱出、隠しファイル、ディレクトリ、サイズ超過、非対応形式、空の PDF、存在しないファイル、スキップ理由の 5 種すべてを、一時ディレクトリで先に足す
  _Boundary:_ `packages/ai-core/src/rag/ingest/loader.ts`, `packages/ai-core/src/rag/ingest/loader.test.ts`
  _Depends:_ 6.1, 6.5
  _Requirements:_ 1.1, 1.8
  _Traces:_ REQ-001, C5

### Implementation Notes

- 公開された型の置き場: `LoadedDocument`（`markdown` は `sections`、`pdf` は `pages`）と `Chunk` は `chunk.ts`、`SkippedFile`・`SKIP_REASONS` は `loader.ts`。`chunkDocument` に渡す `documentId` は接頭辞付きの完全な ID（`kb:` / `eval:` + ファイル名）で、ハッシュに含まれるため 8.1 が組み立てる。front matter の `tags` は `splitMarkdown` ではなく `readFrontMatterTags` が返す。
- PROVE で 3 件の空虚なテストを見つけて直した: コードポイント数とUTF-16 長を区別できないテスト（絵文字のテストを追加）、`Buffer` を `unpdf` に渡すと pdf.js が拒否する実バグ（`new Uint8Array(bytes)` で修正）、ICU は CJK を辞書で分割するので `Intl.Segmenter` のロケール `"ja"` は挙動を変えない（`"ja"` の固定はテストで守れない）。
- `chunkDocument` は長いセクションを分割するときにフェンス付きコードブロックを分断しうる（空行で切る）。評価コーパス（9.1）にはコードブロックを長く入れない。

---

## 7. 埋め込みとナレッジベースのストア（C6）

ナレッジベースへの書き込みと検索クエリを 1 か所（`rag/store.ts`）に集め、埋め込みの次元とモデルを検査する。全 SQL はここに置く。

_Boundary:_ `packages/ai-core/src/rag/embedding.ts`, `packages/ai-core/src/rag/embedding.test.ts`, `packages/ai-core/src/rag/store.ts`, `packages/ai-core/src/rag/store.db.test.ts`, `packages/ai-core/src/rag/store.pg.test.ts`, `specs/002-rag-and-workflows/research.md`
_Depends:_ 2.2, 5.2, 5.3, 6.2, 6.3
_Requirements:_ 1.1, 1.3, 1.4, 1.6, 1.7, 1.12, 2.3
_Traces:_ REQ-001, REQ-002, C6

- [x] 7.1 (P) `rag/embedding.ts`: `embedTexts({ resolved, values, signal })`（`embedMany`。`entry.provider` に応じて `providerOptions` を付ける: OpenAI は `dimensions: 768`、Google は `outputDimensionality: 768`。結果の長さが 768 でなければ `output-invalid`）、`embedQuery`、`assertKnowledgeBaseCompatible(meta, resolved)`（不一致は `invalid-request` の `reason: "embedding-model-changed"`）+ `embedding.test.ts` に、プロバイダ別の次元の指定、長さの不一致、モデルの不一致、`rag_meta` が空のとき許可、中断を先に足す（M1 の `deterministic-embedding` を `dimensions: 768` で使う）
  _Boundary:_ `packages/ai-core/src/rag/embedding.ts`, `packages/ai-core/src/rag/embedding.test.ts`
  _Depends:_ 2.2
  _Requirements:_ 1.1
  _Traces:_ REQ-001, C6
- [x] 7.2 `rag/store.ts`（書き込み側）: `createKnowledgeStore(db)` の `replaceDocument(doc, chunks, embedding, meta)`（1 トランザクション: 文書の削除 → 挿入。`rag_meta` の作成と照合。`ingested_at` は `Clock` から設定し、SQL に `now()` を書かない）、`getChunks(ids)`、`listDocuments()`、`getMeta()`、`reset()` + `store.db.test.ts`（テストファイルごとに PGlite を 1 つ作り、各テストの前に `TRUNCATE`）に、保存内容（本文・出典メタデータ・ページ・見出しパス・埋め込み）、同一文書の再取り込みで置換され重複しない、途中で失敗したら既存のチャンクが残る（ロールバック）、`tags` の和集合の保存、`rag_meta` の不一致の拒否、`reset()` を先に足す
  _Boundary:_ `packages/ai-core/src/rag/store.ts`, `packages/ai-core/src/rag/store.db.test.ts`
  _Depends:_ 5.2, 6.2, 7.1
  _Requirements:_ 1.1, 1.3
  _Traces:_ REQ-001, C6
- [x] 7.3 `rag/store.ts`（検索側）: `searchByVector({ embedding, limit, minSimilarity, filter })`（`<=>` のコサイン距離から類似度を計算し、閾値未満を捨てる。`ScoredChunk { chunk; score; similarity? }`）、`searchByFullText({ query, limit, filter })`（`ts_rank`。`plainto_tsquery` ではなく、`buildFullTextQuery` が作る語をバインドして組み立てる）、`filter { documentIds?; tags? }`（`tags` は `&&`）+ `store.db.test.ts` に、`<=>` の順位と類似度の値、閾値の境界値（ちょうどの値を含める）、`tags` と文書名のフィルタ、全文検索の順位、日本語の分かち書き経由の一致、空クエリ（`undefined`）で検索しない、上限 `limit` を先に足す
  _Boundary:_ `packages/ai-core/src/rag/store.ts`, `packages/ai-core/src/rag/store.db.test.ts`
  _Depends:_ 6.3, 7.2
  _Requirements:_ 1.4, 1.6, 1.7, 2.3
  _Traces:_ REQ-001, REQ-002, C6
- [x] 7.4 `rag/store.pg.test.ts`: `store.db.test.ts` と同じケースを実 Postgres で実行する（`mise run test:db`。共通のケース表を `store.db.test.ts` から再利用するか、同じ入力を複製して結果が同じになることを検証する）。Docker を起動できない環境では、テストだけを作り、実行を「人が行うこと」として Implementation Notes に残す。実行できたら結果を research.md の R-2 に追記する
  _Boundary:_ `packages/ai-core/src/rag/store.pg.test.ts`, `specs/002-rag-and-workflows/research.md`
  _Depends:_ 5.3, 7.3
  _Requirements:_ 1.3, 1.6, 1.12
  _Traces:_ REQ-001, C6
  _Verify:_ `mise run test:db` で `store.pg.test.ts` が成功する（Docker が必要）。`mise run gate` では走らない

### Implementation Notes

- ストアの API: `createKnowledgeStore(db, { clock })`。`replaceDocument(document, chunks, embeddings, meta)` は検証（チャンク数と埋め込み数の一致、768 次元）をトランザクションの前に行い、`rag_meta` は `INSERT … ON CONFLICT DO NOTHING` の後に読み直して照合する（並行する初回書き込みでも勝者に揃う）。タグはストアで集合にする（重複除去）が、front matter とリクエストの和集合は 8.1 が作る。空の `documentIds` / `tags` は「絞り込みなし」。
- `searchByFullText` は `buildFullTextQuery` の出力（単語の ` | ` 連結）だけを受け付け、それ以外は `invalid-request`。`to_tsquery` の演算子構文がバインド変数経由でも入らないようにする。閾値は SQL の `1 - (embedding <=> q) >= minSimilarity` で、直交ベクトル（類似度ちょうど 0）で境界を検証した。
- テストの「順序」「呼び出し」系は、偶然の一致（DB の返却順、`embedMany([])` の挙動）で空虚になりやすい。PROVE で何度も見つけたので、件数を増やして順序を逆にする。**人が行うこと（7.4）**: Docker で `mise run test:db` を実行し、research.md の「W2 7.4 の記録」の表を埋める。この環境では未実行。

---

## 8. 取り込みの組み立てと HTTP 入口（C5、C13 の一部）

読み込み → 分割 → 埋め込み → 文書単位の置換保存を組み立て、`GET /api/rag/knowledge` と `POST /api/rag/ingest` を既存の検査順（`guard → resolve → validate → ingest`）で提供する。

_Boundary:_ `packages/ai-core/src/rag/ingest/ingest.ts`, `packages/ai-core/src/rag/ingest/ingest.db.test.ts`, `packages/ai-core/src/rag/ingest/index.ts`, `packages/ai-core/src/rag/request-schema.ts`, `packages/ai-core/src/rag/request-schema.test.ts`, `packages/ai-core/src/rag/index.ts`, `apps/web/lib/server/platform.ts`, `apps/web/lib/server/platform.test.ts`, `apps/web/app/api/rag/knowledge/route.ts`, `apps/web/app/api/rag/knowledge/route.test.ts`, `apps/web/app/api/rag/ingest/route.ts`, `apps/web/app/api/rag/ingest/route.test.ts`
_Depends:_ 2.1, 5.3, 6.2, 6.6, 7.2, 7.3
_Requirements:_ 1.1, 1.3, 1.8, 2.12
_Traces:_ REQ-001, REQ-002, C5, C13

- [x] 8.1 `rag/ingest/ingest.ts`: `ingestDocuments({ db, embedding, source, root, files, tags?, reset?, signal? }): Promise<IngestResult>`（文書 ID は取り込み元の接頭辞 `kb:`/`eval:` とファイル名から組み立てる。埋め込みはトランザクションの前に `embedMany` で計算する。`IngestResult { ingested; skipped; embeddingModelId }`。`reset: true` は `rag_*` を空にしてから取り込む。中断はトランザクションの前なら埋め込みを中断して開始せず、開始後は完了させる）と `ingest/index.ts` を作る + `ingest.db.test.ts` に、保存内容、再取り込みで置換され重複しない、埋め込みの失敗で既存のチャンクが残る、スキップの報告（5 種の理由）、`kb:` と `eval:` で同名ファイルが置換し合わない、埋め込みモデルの不一致の拒否と `reset: true` での作り直し、中断を先に足す
  _Boundary:_ `packages/ai-core/src/rag/ingest/ingest.ts`, `packages/ai-core/src/rag/ingest/ingest.db.test.ts`, `packages/ai-core/src/rag/ingest/index.ts`
  _Depends:_ 6.2, 6.6, 7.2
  _Requirements:_ 1.1, 1.3, 1.8
  _Traces:_ REQ-001, C5
- [x] 8.2 (P) `rag/request-schema.ts`（取り込みと知識ベース一覧）: `POST /api/rag/ingest` の `z.strictObject`（`source: "knowledge" | "eval-corpus"`、`files?`（50 件以下、各ファイル名は 1 セグメント）、`tags?`（10 件以下、各 40 文字以下）、`reset?`）。クエリのスキーマは 11.3 が足す + `request-schema.test.ts` に、未知フィールドの拒否、範囲、既定値、ファイル名のパス検査の違反を先に足す
  _Boundary:_ `packages/ai-core/src/rag/request-schema.ts`, `packages/ai-core/src/rag/request-schema.test.ts`
  _Depends:_ 2.1
  _Requirements:_ 1.1, 1.8
  _Traces:_ REQ-001, C13
- [x] 8.3 `rag/index.ts`: `@platform/ai-core/rag` の公開 API の初期版（DB 層、取り込み、埋め込み、ストア、リクエストスキーマ。型を含む）。`rag/` が `agents/` を import しないことを確認する
  _Boundary:_ `packages/ai-core/src/rag/index.ts`
  _Depends:_ 5.3, 7.3, 8.1, 8.2
  _Requirements:_ 1.1
  _Traces:_ REQ-001, C4, C5, C6
  _Verify:_ `apps/web` から `@platform/ai-core/rag` を import する 8.4 の型検査が通る。`mise run typecheck` と `check:repo-rules` が成功する
- [x] 8.4 `apps/web/lib/server/platform.ts`: `getKnowledgeBase()`（実行モードに応じて `mock` は PGlite、`local`/`live` は postgres.js のハンドルを 1 回だけ作る。接続失敗は `provider-unavailable`）と `knowledgeRoots`（`knowledge/` と評価コーパスの絶対パス）を足す。`ports.rerank` は 15.1 が足す + `platform.test.ts` に、実行モード別の DB の種類、1 回だけ作ること、`knowledgeRoots` の絶対パスを先に足す
  _Boundary:_ `apps/web/lib/server/platform.ts`, `apps/web/lib/server/platform.test.ts`
  _Depends:_ 8.3
  _Requirements:_ 1.1
  _Traces:_ REQ-001, C13
- [x] 8.5 (P) `app/api/rag/knowledge/route.ts`: 知識ベースの状態と取り込み可能なファイルの一覧（plan「HTTP API」のレスポンス。`embedding`、`knowledgeBase`、`available`、`rerank`）。`rerank.available` は `mock` で常に真、`local`/`live` は `COHERE_API_KEY` の有無から導く（15.1 より前でもポートに依存しない）。Postgres に接続できなければ 503 `provider-unavailable` で起動方法を案内する + `route.test.ts` に、検査順、空のナレッジベース、取り込み済みの文書の一覧、503 を先に足す
  _Boundary:_ `apps/web/app/api/rag/knowledge/route.ts`, `apps/web/app/api/rag/knowledge/route.test.ts`
  _Depends:_ 8.4
  _Requirements:_ 1.1, 2.12
  _Traces:_ REQ-001, REQ-002, C13
- [x] 8.6 (P) `app/api/rag/ingest/route.ts`: 取り込み（`guard → resolve → validate → ingest`）。非対応形式・テキスト抽出不可・サイズ超過・存在しないファイルは拒否せず `skipped` に理由付きで含める。ファイル名のパス検査の違反と埋め込みモデルの不一致は 400 `invalid-request`、埋め込みの次元不正は 502 `output-invalid`。`ModelSelectionError(no-default)` は `AI_MODEL_EMBEDDING` とプロバイダのキーの設定を案内する `invalid-request` に変換する。`request.signal` を伝播する + `route.test.ts` に、検査順（413 → 400 → 400 → `live` のみ 429）、各拒否のコード、`skipped` の理由、`source: "eval-corpus"` の取り込み、中断を先に足す
  _Boundary:_ `apps/web/app/api/rag/ingest/route.ts`, `apps/web/app/api/rag/ingest/route.test.ts`, `apps/web/lib/server/errors.ts`, `apps/web/lib/server/errors.test.ts`
  _Depends:_ 8.1, 8.2, 8.4
  _Requirements:_ 1.1, 1.3, 1.8, 2.12
  _Traces:_ REQ-001, REQ-002, C13

### Implementation Notes

- 取り込みは「全ファイルの検査・読み込み → 全埋め込み → 1 つのトランザクションで全文書を置換」の順にした（文書ごとのトランザクションではない）。2 番目の文書の失敗で 1 番目も巻き戻り、`reset: true` の失敗でも既存のナレッジベースが残る。ストアの `replaceDocument` は外側のトランザクションの中でセーブポイントになる。トランザクションの開始後は `signal` を見ない（開始後は完了させる）。この「開始後に中断しても完了する」性質は、ストアが読む `Clock` の中でシグナルを中断するテストで固定した。
- `listIngestableFiles` を `ingest.ts` に足した（`GET /api/rag/knowledge` の `available` と、`files` 省略時の全件取り込みで共有）。`knowledge/README.md` と隠しファイルを除外する。`isSafeFileName` は `loader.ts` から export して、リクエストスキーマと実行時の検査が同じ判定を使う。`platform.ts` の `knowledgeRoots` は作業ディレクトリでなく fixtures ディレクトリから導く（`next dev` は `apps/web`、他は ルートで動くため）。`platform.ts` の `credentialSecrets`（レコーダのリダクタ）には `COHERE_API_KEY` がまだ無い。15.1（`ports.rerank`）で足す。
- Route Handler の教訓: `toErrorResponse` は `source-unavailable` 以外の `details` を返さないので、`embedding-model-changed` は日本語のメッセージ（`reset` の案内）に加え、W2 レビュー F-3 の修正で `errors.ts` の許可リスト経由の `reason` としてもクライアントに伝わる。SDK のエラーはプロバイダの応答を含みうるため `AISDKError.isInstance` のときだけ固定メッセージの `provider-unavailable` に変え、TypeError などのバグは 500 のまま残す（偽装しない）。`platform.ts` の PROVE では、キャッシュを外した変異でテストが無限ループになった（検出はできたが、テストの途中終了にタイムアウトが無い）。

---

## 9. コーパスと実サーバー確認、W2 の締め（C15、C13、C17）

評価用の日本語コーパスを置き、Next.js の実サーバー（Turbopack）で PGlite・`unpdf`・`postgres` のバンドルが通ることを確かめる（M1 W4 の教訓。
Vitest はバンドラーを通らないため、ここでしか検出できない）。

_Boundary:_ `packages/ai-core/fixtures/rag/corpus/01-rag-overview.md`, `packages/ai-core/fixtures/rag/corpus/02-chunking.md`, `packages/ai-core/fixtures/rag/corpus/03-embeddings-and-search.md`, `packages/ai-core/fixtures/rag/corpus/04-hybrid-and-rrf.md`, `packages/ai-core/fixtures/rag/corpus/05-rerank-and-evaluation.md`, `packages/ai-core/fixtures/rag/corpus/06-agentic-rag.md`, `packages/ai-core/src/rag/ingest/ingest.db.test.ts`, `apps/web/next.config.ts`, `apps/web/e2e/real-server.spec.ts`, `stryker.config.mjs`
_Depends:_ 1.2, 6.1, 6.2, 6.3, 7.4, 8.1, 8.6
_Requirements:_ 1.1, 1.2, 1.12, 2.12
_Traces:_ REQ-001, REQ-002, C13, C15, C17

- [x] 9.1 評価用コーパス 6 本（`01-rag-overview.md`、`02-chunking.md`、`03-embeddings-and-search.md`、`04-hybrid-and-rrf.md`、`05-rerank-and-evaluation.md`、`06-agentic-rag.md`）を日本語で書く。見出し構造（H1〜H3）を持ち、HyDE・Multi-Query・RRF・Rerank・忠実性など検索手法の違いを問う質問の根拠になる内容にする。1 セクションを 800 文字以下に収めすぎず、分割が起きるセクションも 1 つ以上含める。正解チャンク ID は内容ハッシュなので、**この後の編集は 14.1 の `eval-set.json` の更新を伴う**ことをファイルの先頭ではなく Implementation Notes に書く + `ingest.db.test.ts` に、実コーパス 6 本が `skipped` なしで取り込めること、全チャンクが `chunkMaxCharacters` 以下で見出しをまたがないこと、チャンク ID が一意であることを先に足す（`eval:` 接頭辞で取り込む）
  _Boundary:_ `packages/ai-core/fixtures/rag/corpus/01-rag-overview.md`, `packages/ai-core/fixtures/rag/corpus/02-chunking.md`, `packages/ai-core/fixtures/rag/corpus/03-embeddings-and-search.md`, `packages/ai-core/fixtures/rag/corpus/04-hybrid-and-rrf.md`, `packages/ai-core/fixtures/rag/corpus/05-rerank-and-evaluation.md`, `packages/ai-core/fixtures/rag/corpus/06-agentic-rag.md`, `packages/ai-core/src/rag/ingest/ingest.db.test.ts`
  _Depends:_ 8.1
  _Requirements:_ 1.1, 1.2, 2.12
  _Traces:_ REQ-001, REQ-002, C15
- [x] 9.2 `next.config.ts` の `serverExternalPackages` に `@electric-sql/pglite`・`postgres`・`unpdf` を足し、`next build` が成功すること、実サーバー（`mock`、PGlite）で `GET /api/rag/knowledge` が 200 で、`POST /api/rag/ingest`（`source: "eval-corpus"`）が通り、ブラウザ・サーバーのエラーが 0 であることを `real-server.spec.ts` に足す（画面は W5 の 23.3 で足す）。最小の `serverExternalPackages` の集合を、足したものを 1 つずつ外して確定し、Implementation Notes に記録する。**R-1 が失敗したら、ADR-1 の A2 へ退く判断を人に確認する**（勝手に構成を変えない）。`mise run build` 後に `mise run check:client-bundle` が `COHERE_API_KEY` のセンチネルを含めて成功することも確かめる
  _Boundary:_ `apps/web/next.config.ts`, `apps/web/e2e/real-server.spec.ts`
  _Depends:_ 1.2, 8.6, 9.1
  _Requirements:_ 1.1, 1.12
  _Traces:_ REQ-001, C13, C17
  _Verify:_ `mise run test:e2e`（`real-server.spec.ts`。3 エンジン）が成功し、`mise run check:client-bundle` が成功する
- [x] 9.3 **W2 の締め**: `stryker.config.mjs` の `mutate` に `rag/ingest/markdown.ts`、`rag/ingest/chunk.ts`、`rag/ingest/search-text.ts` を足し、`mise run test:mutation` が閾値 70 を満たすことを確かめる（満たさなければ、生き残った変異に対するテストを足す）。`mise run gate` が成功することを確かめ、所要時間を Implementation Notes に記録する（`*.db.test.ts` の追加による増分を含む。予算 5 分）
  _Boundary:_ `stryker.config.mjs`
  _Depends:_ 6.1, 6.2, 6.3, 7.4, 9.2
  _Requirements:_ 1.2
  _Traces:_ REQ-001, C17
  _Verify:_ `mise run gate` と `mise run test:mutation` が成功する。gate の所要時間を記録する 波の敵対的レビュー（憲章 原則 9。新規コンテキストで `sdd-reviewer`）を行い、記録 `.sdd/reviews/002-rag-and-workflows-impl-w2-review-YYYY-MM-DD.md` が存在し、指摘への対応が追記されていることを確かめる（波の移行条件 3）

### Implementation Notes

- **コーパスを編集したら 14.1 の `eval-set.json`（正解チャンク ID）を更新する**。チャンク ID は文書 ID・見出し階層・本文の内容ハッシュなので、1 文字の変更でも ID が変わる。`02-chunking.md` の「チャンクサイズの考え方」節（869 文字）は分割が起きる節として意図して残す。コードブロックを長く入れない（`chunkDocument` が分断しうる）。
- **R-1（実サーバーでのバンドル）**: `serverExternalPackages` は **何も足さずに** `next build`、`next start` の実サーバー E2E（3 エンジン 171 件）、`next dev` のスモークが通った。最小の集合は空で、`next.config.ts` は変更していない。**（2026-10-13 訂正: W5 で `/rag` ページ（Server Component）が PGlite を実行すると SSR 層で失敗したため、`@electric-sql/pglite` と `@electric-sql/pglite-pgvector` を足した。research.md I-10 を参照。）**通らなかったのは `new URL("../../../drizzle", import.meta.url)`（ディレクトリのアセット参照として Turbopack が失敗させる。M1 W4 と同じ）で、`path.resolve` に直した。`loader.ts` の動的なファイルアクセスには `turbopackIgnore` を付けた（警告 0）。PDF（`unpdf`）は E2E が `knowledge/` に一時 PDF を書いて取り込み、ページ番号まで確認した。未確認: `local` / `live` での実 Postgres 接続（postgres.js は import まで。接続は Docker 無しで未実行）。
- **W2 の締め**: gate（`TURBO_FORCE=true`、キャッシュ 0）は 20 秒で成功（予算 5 分）。`//:test` 351、`ai-core` 1058（skipped 4）、`web` 349、`eval-suite` 3。ミューテーション 86.59（閾値 70）: `chunk.ts` 84.62、`markdown.ts` 78.79、`search-text.ts` 94.44。Boundary 外の変更（`loader.ts`、`embedding.ts`、`client.ts`）は 8.2・7.2・9.2 で必要になった最小の修正。W2 レビュー F-3 の修正で `lib/server/errors.ts` と `errors.test.ts` を 8.6 の `_Boundary:_` に足した（2026-10-12 に人が承認。`invalid-request` の `reason` を許可リスト `embedding-model-changed` / `too-many-files` / `invalid-file-name` だけ公開する。plan「HTTP API」の契約どおり）。
