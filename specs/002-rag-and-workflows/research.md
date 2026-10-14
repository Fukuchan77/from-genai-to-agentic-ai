# rag-and-workflows — Discovery & Research Log

`/sdd-plan` の調査記録。調査日は 2026-10-12。実測は Node 26.10.0、TypeScript 7.1.0-dev.20261009.1、Vitest 5.0.3 の隔離ディレクトリ（リポジトリ外の作業用ディレクトリ）で行い、リポジトリには何も追加していない。憲章の原則 8 に従い、API・版・挙動は公式ドキュメント（Context7、npm レジストリ）と実測を根拠にする。ギャップ分析（[gap-analysis.md](gap-analysis.md)）の調査項目 R-1〜R-16 と課題 G-1〜G-22 を参照する。

## Discovery type

**Extension（既存システムの拡張）+ 一部 New feature**。M1 の土台（ゲートウェイ、ポート規約、`createGuardedAgent`、`defineAciTool`、`data-*` ストリーム、テスト接尾辞）の上に、DB 層・RAG・ワークフロー・パターンの 3 領域を新設する。DB 層、Rerank、PDF 取り込み、日本語全文検索は M1 に前例がなく、Full discovery（実測）で調べた。

## Investigations

### I-1: インプロセス DB（PGlite + pgvector）が品質ゲートで使えるか（R-1、G-1、Req 1.12）

- **Question**: PGlite 0.5.8 + `@electric-sql/pglite-pgvector` 0.0.9 が、Node 26、Vitest 5、テスト基盤のネットワーク遮断（`fetch` / `node:net` / `node:dns`）の下で、`vector` 検索・HNSW・全文検索を動かせるか。起動時間は 5 分の予算に収まるか。
- **Findings**:
  - 動く。`PGlite.create({ extensions: { vector } })` + `CREATE EXTENSION vector` で pgvector **0.8.1**（PostgreSQL **18.3** の WASM ビルド）が使える。`<=>` による並べ替え、`1 - (a <=> b)` による類似度、`hnsw` インデックスの作成、`text[]` の `&&` によるメタデータフィルタ、`tsvector` の生成列と GIN インデックス、`pg_trgm`（`contrib/pg_trgm`）、`hnsw.iterative_scan` / `hnsw.ef_search` / `ivfflat.probes` の `SET` がすべて成功した。
  - テスト基盤の遮断（`tooling/vitest/setup-hermetic.ts` を `setupFiles` に指定）の下でも、`NetworkBlockedError` は起きなかった。PGlite は WASM で、ソケットを開かない。
  - 起動時間は 1 ファイルあたり **約 0.9〜1.1 秒**（`PGlite.create` + 拡張の読み込み。2 ファイルを並列に実行して 2 つとも約 1.1 秒）。マイグレーションとテーブル作成は無視できる。`ROLLBACK` によるテストごとの分離も動く。
  - 本番側は Compose の `pgvector/pgvector:pg17`（PostgreSQL 17）で、PGlite の主バージョン（18）とずれる。`<=>`・`tsvector`・配列演算子は両者で同じ SQL になるが、**実 Postgres での実行は未実測**（この環境では Docker デーモンが起動していない）。
- **Evidence**: `PGlite.create` の起動時間 `startup ms 1083 / 1091`（Vitest 5.0.3、hermetic セットアップ込み）。`select extversion from pg_extension where extname='vector'` → `0.8.1`。`select version()` → `PostgreSQL 18.3 (PGlite 0.5.8)`。
- **Decision**: ADR-1（A1 を採用）。

### I-2: Drizzle と TypeScript 7.1 先行版、マイグレーションの方式（R-2、G-19、G-20）

- **Question**: `drizzle-orm` / `drizzle-kit` が TypeScript 7.1 先行版・Node 26 で動くか。`vector()` 列型と PGlite / postgres.js のドライバがあるか。
- **Findings**:
  - `drizzle-orm` 0.45.4（2026-10-08 公開）は TypeScript 7.1 先行版の `tsc` で型検査できた。`vector(name, { dimensions })`、`index().using("hnsw", col.op("vector_cosine_ops"))`、`cosineDistance()` は `drizzle-orm/pg-core` / `drizzle-orm` にある。`tsvector` 列型は**無い**（`customType` が要る）。
  - `drizzle-orm/pglite` と `drizzle-orm/postgres-js` の両方の戻り値が、共通型 `PgDatabase<PgQueryResultHKT>` に代入できた（TypeScript 7.1 でエラーなし）。ただし `db.execute()` の戻り値の形がドライバで異なる（PGlite は `{ rows }`、postgres.js は配列）ため、共通型では `unknown` になる。クエリビルダー（`db.select().from().where()`）なら型が揃う。
  - `drizzle-kit` 0.31.11 は Node 26 で `generate` が動く（SQL が出力される）。しかし**依存の `@esbuild-kit/esm-loader` / `@esbuild-kit/core-utils`（非推奨、`esbuild` 0.18.20）に中程度の脆弱性が 4 件あり、`npm audit` が失敗する**。本リポジトリの `mise run audit`（`pnpm audit --audit-level=moderate`）は CI で必須のため、導入すると CI が落ちる。`drizzle-orm`・PGlite・`unpdf`・`@ai-sdk/cohere`・`postgres` だけの構成では `found 0 vulnerabilities`。
  - `drizzle-kit` を入れると `esbuild` が 3 版（0.18.20、0.25.12、0.28.2）入り、いずれも `postinstall` を持つ（`allowBuilds` の理由が要る）。
- **Evidence**: `npm audit`（`drizzle-kit` を含む構成）→ `4 moderate severity vulnerabilities`、含まない構成 → `found 0 vulnerabilities`。`tsc -p`（7.1.0-dev.20261009.1）で `RagDb = PgDatabase<PgQueryResultHKT>` に `drizzlePglite(...)` と `drizzlePostgres(...)` を代入してエラーなし。
- **Decision**: ADR-2（`drizzle-kit` を採らず、手書き SQL のマイグレーション + Drizzle ORM の型付きクエリ）。

### I-3: 日本語の全文検索（R-3、G-2、Req 2.3）

- **Question**: `tsvector` で日本語の全文検索をどう実現するか。
- **Findings**:
  - `to_tsvector('simple', 日本語本文)` は分かち書きしないため、`検索` で検索しても **0 件**（実測）。
  - Node 26 の `Intl.Segmenter("ja", { granularity: "word" })` は追加依存なしで分かち書きできる（`全文検索` → `全文 | 検索`、`ベクトル検索` → `ベクトル | 検索`）。分かち書きした語を空白で連結して `simple` に渡せば、`ts_rank` で順位が付く。
  - 助詞・助動詞（`は`、`の`、`と`、`ます`）も語として出るため、OR 検索（`a | b | c`）にすると、全文書にある助詞が順位を汚す（実測で、無関係な文書が 3 位に入った）。**ひらがなだけの 2 文字以下の語を除く**フィルタが要る。AND 検索（`plainto_tsquery`）は自然文では 0 件になるため使えない。
  - `pg_trgm` の `word_similarity` は分かち書き不要で動き（正解の文書が 0.56、他は 0〜0.25）、PGlite の同梱拡張にある（`contrib/pg_trgm`）。ただし Compose の `pgvector/pgvector` イメージで `CREATE EXTENSION pg_trgm` が使えるかは未確認（contrib は通常含まれるが、未実測）。
- **Evidence**: 分かち書き結果と、`tsv @@ to_tsquery('simple', '全文 | 検索 | ...')` の `ts_rank`（d: 0.047、a: 0.037、b: 0.017、c: 0.009）。`unsegmented simple` → `{ c: 0 }`。
- **Decision**: ADR-3（`Intl.Segmenter` + `simple` + ひらがな短語の除去。`pg_trgm` は採らない）。

### I-4: Rerank のプロバイダ（R-4、G-3、Req 2.5、2.6）

- **Question**: AI SDK v7 の `rerank()` を使える Rerank プロバイダはどれか。キー、版、公開日、日本語対応は。
- **Findings**:
  - `ai@7.0.137` は `rerank()` と `RerankingModelV4` を持つ。`rerank({ model, documents, query, topN, abortSignal, providerOptions })` は `{ ranking: { originalIndex, score, document }[], rerankedDocuments, originalDocuments, response }` を返す（Context7 の AI SDK ドキュメント）。
  - `@ai-sdk/cohere` 4.0.59（2026-10-08 公開、Apache-2.0）は `cohere.reranking(modelId)` を提供する。型定義の例示 ID は `rerank-v3.5` 等で、任意の文字列を受ける。AI SDK のドキュメントは `rerank-v4.0-pro` を例示する。Cohere のドキュメントは `rerank-v4.0-pro`（多言語）と `rerank-v4.0-fast`（低遅延、100 以上の言語）を挙げる。`@ai-sdk/voyage` 2.0.58 も `voyage.reranking('rerank-2.5')` を持つ。
  - 価格と無料枠の公式情報は確認できなかった（第三者の記載が食い違う）。**価格は記録しない**（原則 8: 未確認の数値を書かない）。
- **Evidence**: `https://ai-sdk.dev/docs/ai-sdk-core/reranking`、`https://ai-sdk.dev/providers/ai-sdk-providers/cohere`、`https://docs.cohere.com/v2/docs/rerank`、`node_modules/@ai-sdk/cohere/dist/index.d.ts`（`reranking(modelId): RerankingModelV4`）。
- **Decision**: ADR-7（Cohere、キーは `COHERE_API_KEY`、モデル ID はカタログに置く）。

### I-5: 埋め込みの次元（R-5、G-15、G-16）

- **Question**: 実行モード間で次元を 768 に揃えられるか。`live` の既定プロバイダ（Anthropic）に埋め込みモデルが無い問題は。
- **Findings**:
  - OpenAI は `providerOptions: { openai: { dimensions: 768 } }`（`text-embedding-3` 以降）、Google は `providerOptions: { google: { outputDimensionality: 768 } }` で次元を指定できる（Context7 の AI SDK ドキュメント）。`mock`（`MOCK_EMBEDDING_DIMENSIONS = 768`）と `local`（`nomic-embed-text`、`embedding_length: 768`、Ollama の `/api/tags` で確認）は 768。
  - G-16 は新しい環境変数を要しない。`resolveEmbedding` の `selectEntry` は `AI_MODEL_EMBEDDING` が明示されていればそのカタログ ID を使い、`assertReachable` は**そのモデルのプロバイダ**の認証情報だけを検査する。したがって `AI_LIVE_PROVIDER=anthropic` のまま `AI_MODEL_EMBEDDING=text-embedding-3-small` + `OPENAI_API_KEY` で動く。未指定のとき `ModelSelectionError("no-default")` になるだけなので、RAG 側でその設定方法を案内する日本語のエラーに変換すればよい。
- **Evidence**: `config/load.ts` `resolveModels`（明示 ID を優先）、`models/gateway.ts` `selectEntry` / `assertReachable`、`catalog.ts` `MODEL_DEFAULTS.live.anthropic`（`embedding` なし）。
- **Decision**: ADR-4。

### I-6: PDF パーサ（R-6、G-6、Req 1.1、1.8）

- **Question**: ページ単位でテキストを抽出でき、Node 26 で動き、ネイティブ依存を持たない PDF パーサはあるか。
- **Findings**: `unpdf` 1.8.1（MIT、2026-08-13 公開）は `getDocumentProxy` + `extractText(doc, { mergePages: false })` でページごとの文字列配列を返す。Node 26 で動いた。`@napi-rs/canvas` は画像描画用の任意の peer 依存で、テキスト抽出には不要。不正なバイト列は `InvalidPDFException` を投げる（スキップの理由に使える）。パッケージは 2.5 MB。pdfjs の警告（`Indexing all PDF objects`）が標準出力に出る場合がある。PDF の fixture は、本文が ASCII の最小 PDF を生成するテスト用ビルダーで作れる（バイナリを置かない）。
- **Evidence**: `extractText` の戻り値 `[ 'Chunking respects heading boundaries.', 'Reciprocal Rank Fusion merges rankings.' ]`（2 ページ）。不正入力 → `InvalidPDFException Invalid PDF structure.`。
- **Decision**: ADR-5 の一部（`unpdf` を採用）。

### I-7: 引用の方式と小型モデルの構造化出力（R-7、G-7、G-8）

- **Question**: 引用を `[n]` 脚注で書かせるか、構造化出力で書かせるか。小型の `local` モデルは「ちょうど 3 件」を守れるか。
- **Findings**（`local`、Ollama、各モデル 6 問。少数の試行であり、確率の推定ではない）:
  - Multi-Query の `Output.object`（`queries` は `.length(3)`）: `granite4.2:latest` 6/6 有効（平均 5.0 秒）、`llama3.2:latest` 6/6 有効（平均 1.8 秒）。
  - 引用: 序数の脚注（`[1]`）は `granite4.2` で 6/6 が範囲内、`llama3.2` では 2/6 のみが脚注を付け、4/6 は脚注なし。構造化出力（ハッシュ ID を写させる）は `granite4.2` で 4/6、`llama3.2` で 6/6 が引用を返し、**どの方式でも範囲外・存在しない ID の引用は 0 件**だった。つまり失敗の主な形は「引用を付けない」であり「偽の ID を作る」ではなかった。
  - したがって、モデルが引用を付けなかった場合に備え、検索で取得した全チャンクを `cited: false` 付きで返す設計が要る。
- **Evidence**: 試行スクリプトの出力（`granite4.2:latest valid=6/6 fail=0 avg=5.0s` など）。
- **Decision**: ADR-6。

### I-8: `local` 埋め込みの日本語での類似度分布（Req 1.7 の閾値）

- **Question**: コサイン類似度の閾値で「該当情報なし」を判定できるか。
- **Findings**（`nomic-embed-text:latest`、5 文書 × 関連 5 問 + 無関係 4 問）:
  - 英語: 関連の最大類似度 0.54〜0.69、無関係 0.35〜0.45（接頭辞なし）。閾値 0.5 付近で分離できる。
  - **日本語: 関連 0.64〜0.79、無関係 0.53〜0.67 で重なる**（接頭辞 `search_query:` / `search_document:` を付けても 0.55〜0.62 と 0.61〜0.74 で重なる）。単一の閾値では分離できない。top-1 の正解率は日英とも 4/5。
  - `mock` の埋め込みは SHA-256 由来の乱数ベクトルで、異なる文の類似度は 0 付近（標準偏差 約 0.036）、同一文は 1.0。
- **Evidence**: 試行スクリプトの出力（`no-prefix relevant max-sim 0.74 0.64 0.79 0.71 0.69 | irrelevant 0.53 0.65 0.65 0.67`）。
- **Decision**: ADR-9 の一部（閾値は既定 0.5、リクエストで変更可能。`local` の日本語では閾値が弱い防御であることを解説に明記し、回答プロンプトでも「根拠が無ければ該当なしと答える」ことを要求する）。
- **Update（W6、2026-10-13、25.1-d）**: 評価コーパスに対する最上位の類似度は、答えがある質問 32 問で 0.710〜0.938（中央値 0.822）、答えが無い質問 8 問で 0.627〜0.746（中央値 0.706）で、**8/8 が閾値 0.5 以上**だった。日本語では既定の閾値 0.5 は「該当なし」を一度も判定しなかった。詳細は「M2 実測（W6）」。決定は変えない（既定 0.5、弱い防御として解説に明記）。

### I-9: 上限と同点・モデル区別の決定に必要な既存コードの確認（R-10、R-12、R-13、G-10、G-11、G-13）

- **Findings**:
  - `ModelPurpose` は `chat / structured / embedding / judge` の 4 つで、cassette スキーマ（`cassette-store.ts`）が `z.enum` で固定している。拡張は波及が大きい。一方 `judge` は「独立した評価用モデル」の意味で、`MODEL_DEFAULTS.local.ollama.judge`（`gemma4:e2b`）は生成側（`granite4.2`）と別である。`mock` の `judge` は生成側と同じ `mock:general-v1`。
  - `check-repo-rules.mjs` の規則は `runners[ruleName](root)` が `{ fileCount, violations }` を返す形で、トークン列を走査する。`guarded-agent-only` は `ToolLoopAgent` の `new` だけを禁じるため、`workflows/` から `createGuardedAgent` を呼ぶことは検出しない。
  - `scripts/check-model-ids.mjs` のモデル族リストに Rerank の ID（`rerank-v4.0-*` など）は無い。
  - `scripts/check-docs.mjs` の `REQUIRED_TOPICS` には既に `2-3`、`2-4` が定義されている（`2-1`、`2-2` は無い）。
  - `summarize/retry.ts` の `withRegeneration` は `SummaryValidationError` に結合した非同期ジェネレータで、他領域から再利用すると M1 の契約に波及する。
- **Evidence**: `models/types.ts:14`、`models/catalog.ts` の `MODEL_DEFAULTS`、`scripts/check-repo-rules.mjs:656-720`、`scripts/check-model-ids.mjs` の `MODEL_ID_FAMILIES`、`scripts/check-docs.mjs:41-65`。
- **Decision**: ADR-8、ADR-10、ADR-11。

### I-10: Next.js サーバーでの PGlite のバンドル（未実測の最大リスク）

- **Question**: Turbopack のサーバービルドで `@electric-sql/pglite` の WASM と拡張の tarball を読み込めるか。
- **Findings**: 未実測。M1 の W4 で、Vitest が緑のまま実サーバー（本番ビルド）では 3 ページとも 500 になった前例がある（`specs/001-agentic-ai-platform/pdca/act.md`）。`next.config.ts` には既に `serverExternalPackages: ["jsdom", "youtubei.js"]` の前例があり、PGlite・`postgres`・`unpdf` も外部化の候補になる。
- **Decision**: 実装の最初の Web タスクで `next build` と実サーバー E2E（`real-server.spec.ts` の拡張）を通し、外部化の要否を確定する（リスク R-1）。
- **Update（W5、2026-10-13、22.1 の実サーバー確認）**: Route Handler（`/api/rag/*`）は外部化なしで動いた（W2 9.2）が、**Server Component のページが `getKnowledgeBase()` を実行すると 500 相当になった**。`next start` の出力は `TypeError: The "path" argument must be of type string or an instance of Buffer or URL. Received an instance of URL`（`.next/server/chunks/ssr/…pglite…`）と `Error: Extension bundle not found: /_next/static/media/vector.tar.<hash>.gz`。ページのコードは SSR 用のチャンクグループに入り、そこでは `new URL("./vector.tar.gz", import.meta.url)` がクライアント用のアセット URL に書き換えられて、pgvector の tarball を読めない。Vitest は緑のままだった（M1 W4 と同じ型の失敗）。`curl` でも、起動直後の同時リクエストで再現した。**決定**: `next.config.ts` の `serverExternalPackages` に `@electric-sql/pglite` と `@electric-sql/pglite-pgvector` を足し、全レイヤで `node_modules` から読み込む。確認: 外部化後は `/rag` が空のナレッジベースを表示し、`POST /api/rag/ingest`（評価コーパス 6 件）も通る。`postgres` と `unpdf` は Route Handler でのみ実行されるため外部化していない。

## Existing patterns to reuse

| Pattern | Location | Why reuse |
|---------|----------|-----------|
| ポート + `mock` の疑似実装 + 構成の 1 か所での組み立て | `ports/web-search.ts`、`mock/fixtures.ts`、`apps/web/lib/server/platform.ts` | Rerank ポートと DB ハンドルを同じ規約で追加する |
| `Output.object` + `streamText` + `data-*` パート | `summarize/pipeline.ts`、`apps/web/app/api/summarize/route.ts` | Multi-Query、Router、Evaluator の構造化出力と、RAG の進行状況ストリーム |
| `createGuardedAgent` + `createAgentUIStreamResponse` + `messageMetadata` | `agents/guarded-agent.ts`、`apps/web/app/api/agent/tools/route.ts` | Agentic RAG（Req 1.9）と Role-Based Cooperation（Req 4.7） |
| `defineAciTool` / `buildToolSet` | `aci/` | 検索ツール（`risk: "read-only"`） |
| シナリオ（述語照合）とカセット | `mock/scenario.ts`、`fixtures/scenarios/m1-*.ts` | `m2-*` シナリオの追加。`lastUserTextIncludes` と `purpose` で照合する |
| `describeLocal` / `itLocal`、テスト接尾辞、`gate-reporter` | `testing/`、`tooling/vitest/` | 精度比較・Judge を `local` 専用に置く |
| 規則の追加方法（走査 0 件で失敗） | `scripts/check-repo-rules.mjs` | `workflow-no-agent-loop`、`no-sql-raw` を同じ形で追加する |
| `guardRequest` と `z.strictObject` | `apps/web/lib/server/guard.ts` | 新しい Route Handler の検査順 |
| 解説テンプレートと `docs:check` | `docs/modules/_template.md`、`scripts/check-docs.mjs` | 2-1〜2-4 の解説 |

## External dependencies

| Dependency | Version | Purpose | Verified |
|------------|---------|---------|----------|
| `drizzle-orm` | 0.45.4（2026-10-08 公開、Apache-2.0） | 型付きクエリ（`pglite` / `postgres-js` 共通の `PgDatabase`） | ✅ TS 7.1 で型検査、PGlite で実行 |
| `@electric-sql/pglite` | 0.5.8（001 research I-9 と一致） | インプロセス DB（品質ゲートと `mock` の Web アプリ） | ✅ Node 26、Vitest 5 + 遮断下で実行 |
| `@electric-sql/pglite-pgvector` | 0.0.9（2026-08-26 公開、Apache-2.0） | PGlite の pgvector 拡張（0.8.1） | ✅ |
| `postgres`（postgres.js） | 3.4.9（Unlicense、独自の型を同梱） | `local` / `live` の Docker Postgres 接続 | ⚠ ロードと型のみ。実接続は未実測（Docker 未起動） |
| `unpdf` | 1.8.1（MIT、2.5 MB、ネイティブ依存なし） | PDF のページ単位テキスト抽出 | ✅ Node 26 |
| `@ai-sdk/cohere` | 4.0.59（2026-10-08 公開、Apache-2.0） | `cohere.reranking()` | ⚠ 型と API 形状のみ。実キーでの呼び出しは未実測 |
| ~~`drizzle-kit`~~ | 0.31.11 | （採らない） | ❌ `npm audit` で中程度 4 件（ADR-2） |

`ai@7.0.137`（既存）の `embed` / `embedMany` / `rerank` を使う。

## Architecture decisions

### ADR-1: データ層は PGlite（品質ゲート）+ Docker Postgres（`test:db`、ハンズオン）の二層にする

- **Context**: Req 1.12 は、DB を使うテストをインプロセス DB で実行できるものと、できないものに分類することを求める。001 Req 1.11 は品質ゲートが Docker なしで完走することを求める。
- **Decision**: ギャップ分析の A1。ストアの SQL は Drizzle のクエリビルダーで 1 回だけ書き、`PgDatabase<PgQueryResultHKT>` を受け取る。品質ゲートの `*.db.test.ts` は PGlite、`*.pg.test.ts` は Compose の Postgres に同じストア関数を実行する。`mock` の Web アプリ（`mise run dev`、E2E）も PGlite を使う。
- **Alternatives**: A2（メモリ上の自前ストア）は `<=>` と `tsvector` を品質ゲートが一切検証せず、Req 1.12 の「インプロセスで実行できるもの」が空になる。A3（Postgres のみ）は 001 Req 1.11 に反する。
- **Consequences**: PGlite（PostgreSQL 18、pgvector 0.8.1）と Compose（PostgreSQL 17）の差を `*.pg.test.ts` が検出する（実 Postgres は未実測。リスク R-2）。`mock` のサーバーは再起動でナレッジベースが消える（学習用途として許容。取り込みは再実行できる。G-18）。

### ADR-2: マイグレーションは手書き SQL + 自前の小さなマイグレーター。`drizzle-kit` は採らない

- **Context**: `drizzle-kit` は `npm audit` の中程度 4 件を持ち込み、CI の `audit` が落ちる（I-2）。生成列（`tsvector`）、`CREATE EXTENSION`、`hnsw` は、いずれにせよ手書き SQL が要る。
- **Decision**: `packages/ai-core/drizzle/NNNN_<name>.sql` を順に適用し、適用済みの名前を `rag_migrations` に記録する。Drizzle のスキーマ（`schema.ts`）は型付きクエリ用に別に書き、`*.db.test.ts` の**スキーマ照合テスト**（マイグレーション適用後に `information_schema.columns` と `getTableColumns` の列名・型を突き合わせる）で乖離を検出する。
- **Alternatives**: `drizzle-kit generate`（依存と監査の問題）。`pnpm.overrides` で `esbuild` を上げる案は、非推奨パッケージ `@esbuild-kit/*` の固定依存が残るため採らない。
- **Consequences**: スキーマ変更時に SQL と `schema.ts` の両方を直す必要がある（照合テストが漏れを検出する）。

### ADR-3: 日本語の全文検索は `Intl.Segmenter` + `simple` + 助詞の除去

- **Context**: I-3。
- **Decision**: 取り込み時に本文を分かち書きして `search_text` 列に保存し、生成列 `tsv = to_tsvector('simple', search_text)` を GIN インデックスで引く。検索時は質問を同じ関数で分かち書きし、**ひらがなだけで 2 文字以下の語を除いて**、`to_tsquery('simple', 't1 | t2 | ...')`（OR）を組み立てる。語は英数字・かな・漢字だけに正規化してからクエリに入れ、SQL にはバインド変数で渡す。語が 0 件なら全文検索を実行せず空の結果を返す。
- **Alternatives**: `pg_trgm`（Compose イメージでの利用が未確認。三つ組一致は語の境界を持たない）。`pgroonga` / `pg_bigm`（pgvector の公式イメージに無く、PGlite でも使えない）。
- **Consequences**: 分かち書きの品質は ICU の辞書に依存する。全文検索の順位は `ts_rank`（BM25 ではない）。評価用コーパスは日本語にする（学習者の実際の使い方と一致する）。

### ADR-4: 埋め込みの次元は 768 に統一し、ナレッジベースに埋め込みモデルを記録する

- **Context**: I-5。`vector(N)` は次元が固定で、モデルを切り替えると既存のベクトルが使えない。
- **Decision**: 列は `vector(768)`。OpenAI は `dimensions: 768`、Google は `outputDimensionality: 768` を `providerOptions` で指定する（`rag/embedding.ts` の 1 か所）。`mock` と `local` は 768 のまま。`rag_meta` に埋め込みモデルの ID と次元を保存し、取り込み・検索のたびに現在のモデルと照合する。不一致は `PlatformError("invalid-request", …, { reason: "embedding-model-changed" })` で、`reset: true` の取り込みで作り直す。埋め込み結果の長さが 768 でなければ `output-invalid`。
- **Alternatives**: モデルごとにテーブルを分ける（クエリとスキーマが複雑になる）。次元をそのままにして不一致を検出するだけ（OpenAI / Google の既定次元ではインデックスの `vector(768)` に入らない）。
- **Consequences**: 次元を縮約した OpenAI / Google の埋め込みは、既定の次元より精度が落ちうる。`live` の Anthropic 既定では `AI_MODEL_EMBEDDING` と対応するキーが要る（案内するエラーを出す）。

### ADR-5: チャンク ID は内容ハッシュ、文書 ID はファイル名、再取り込みは文書単位で置換する

- **Context**: G-5。引用の照合（Req 1.11）と正解チャンク ID（Req 2.12）は、再取り込みで ID が変わらないことが前提。
- **Decision**: 文書 ID は取り込み元の接頭辞（`kb:` = `knowledge/`、`eval:` = 評価コーパス）+ **ファイル名（1 セグメント）**（plan レビューで、取り込み元をまたぐ同名ファイルの置換を避けるために追加）。チャンク ID は `sha256(documentId + "\n" + headingPath.join(" > ") + "\n" + body)` の先頭 16 桁の 16 進。同じ文書内で同じ ID になった場合は出現順の接尾辞 `-2`、`-3` を付ける。再取り込み（Req 1.3）は 1 つのトランザクションで、その文書のチャンクを削除してから挿入する。埋め込みはトランザクションの前に計算し、失敗しても既存のチャンクを残す。PDF は `unpdf` でページごとに抽出し、ページを出典（`page`）に持つ。Markdown は見出し境界で分割し（`headingPath` を持つ）、1 セクションが最大文字数（既定 800 文字）を超える場合は段落、さらに文の境界で分ける。
- **Alternatives**: 連番 ID（分割規則の変更で評価セットが壊れる）。文書の内容ハッシュを文書 ID にする（同じファイルの更新が別文書になり、置換できない）。
- **Consequences**: 文書の本文を 1 文字変えると、その見出しのチャンク ID が変わり、正解 ID を持つ評価セットが無効になる。評価セットの検証テスト（ADR-12）が検出する。

### ADR-6: 引用は序数の脚注 `[n]` を基本とし、取得した全チャンクを `cited` 付きで返す

- **Context**: I-7。
- **Decision**: 回答プロンプトは、取得チャンクに 1 から始まる序数ラベルを付け、根拠にした資料を `[1]` の形で文末に付けさせる。サーバーは回答テキストの `[n]` を解析し、(a) 1〜取得件数の範囲にある序数をチャンク ID に対応付け、(b) 範囲外の序数を回答から除去して `removedCitations` に記録する（Req 1.11）。返す引用は**取得した全チャンク**で、脚注が参照したものに `cited: true` を付ける（モデルが脚注を付けなくても、根拠候補を UI に出せる）。回答の確定版は `data-rag-result` に `answer`（除去後）として載せ、UI はストリーム中の本文を確定版に置き換える。
- **Alternatives**: 構造化出力（回答 + チャンク ID の配列）。ストリーミングの部分表示が複雑で、`granite4.2` では 2/6 が引用なしだった。事後の自動対応付け（回答の文と各チャンクの類似度）。追加の埋め込みが要り、決定論的でない。
- **Consequences**: `local` の小型モデルが脚注を付けないと、`cited` がすべて `false` になる（解説に明記する）。ラベルは序数で、モデルが `[7]` のような範囲外の値を書いたときだけ除去が働く。

### ADR-7: Rerank は Cohere（`@ai-sdk/cohere`）、`mock` は語の重なりによる疑似実装

- **Context**: I-4。Req 2.5、2.6。
- **Decision**: `ports/rerank.ts` に `RerankProvider`（`rerank(query, documents, signal)` → 並べ替えた序数とスコア）を定義し、本番実装 `createCohereRerank(apiKey, modelId)` は `ai` の `rerank()` を呼ぶ。キー名は `COHERE_API_KEY`（`env-schema.ts`、`FEATURE_REQUIREMENTS` の `rerank`、`.env.example`）。モデル ID はカタログ（`RERANK_MODELS`、機能の既定 1 件）にだけ書く。`mock` の疑似実装 `createLexicalRerank()` は ADR-3 の分かち書きで質問と候補の語の重なりを数える決定論的な実装で、キーが要らない。キーが無い `local` / `live` では Rerank 段をスキップし、実行結果に `{ status: "skipped", reason: "api-key-missing" }` を記録する。`mock` では疑似実装を使う（Req 2.5 の「キーが設定されている」に相当する条件を、`mock` では満たしたものとして扱う）。録画ラッパ（`recordingRerank`）は作らない（`mock` が疑似実装で、cassette に残す対象が無い）。
- **Alternatives**: Voyage（`@ai-sdk/voyage`）。Cohere の方が AI SDK のドキュメントに例が多く、多言語モデルが明記されている。fixture（JSON）による固定応答は、候補の組み合わせごとに fixture が要り保守が重い。
- **Consequences**: Cohere の価格・無料枠は未確認（解説は「料金は公式ページで確認する」とする）。実キーでの呼び出しは `*.local.test.ts` ではなく手動のハンズオンで確認する（キーが要る）。

### ADR-8: コードの配置は新規領域を独立して追加する（B2 → B3）

- **Context**: ギャップ分析の B。G-12、R-13。
- **Decision**: `ai-core/src/` に `structured/`（再生成付き構造化出力の共通ヘルパ）、`rag/`、`workflows/`、`patterns/` を追加する。依存の向きは `workflows/` と `rag/` → `structured/`、`patterns/` → `workflows/`・`structured/`。`workflows/` と `patterns/` は `agents/` と `ToolLoopAgent` を import せず、**唯一の例外が `patterns/role-based-cooperation.ts`**（`agents/` から `createGuardedAgent` を import してよい）。リポジトリ規則 `workflow-no-agent-loop` で検査する（Req 3.13）。M1 の `summarize/retry.ts` は変更しない。重複（`withRegeneration` と `generateValidated`）は M2 の最後のタスクで統合の要否を判断し、結果を記録する（B3）。
- **Alternatives**: B1（M1 の `summarize/` を汎用化）は M1 の公開契約に波及する。
- **Consequences**: 再生成ロジックが一時的に 2 か所になる。
- **統合の要否の判断（W6、27.3、2026-10-13）**: **統合しない。重複は許容する。** 比べた結果:

  | 観点 | `summarize/retry.ts` の `withRegeneration` | `structured/generate-validated.ts` の `generateValidated` |
  |---|---|---|
  | 形 | 非同期ジェネレータ。試行の中身（`streamText` のイベント）を呼び出し側へ流しながら再試行する | 1 回の `generateText` + `Output.object` を呼び、値を返す関数 |
  | 試行の所有者 | 呼び出し側（`attempt` 関数が自分でモデルを呼ぶ） | 本関数（モデル呼び出しを内包する） |
  | 再試行の合図 | `onRestart` が UI へ「破棄せよ」のイベントを返す | なし（ストリームを持たない） |
  | 失敗の型 | `SummaryValidationError`（M1 の公開契約。`/api/summarize` と画面がエラー文言に使う） | `StructuredOutputError`（使用量を持つ） |
  | 共有できる部分 | 「最大 2 回の再生成」の定数（どちらも 2）と、前回の問題点を次のプロンプトへ渡す考え方だけ。ループの本体は 8 行ほど | 同左 |

  統合するなら `generateValidated` を `withRegeneration` の上に載せるか、両者を共通のループへ寄せることになる。前者は非ストリームの呼び出しにジェネレータ（ストリーム用）を持ち込み、後者は `SummaryValidationError` を `StructuredOutputError` に寄せるため、M1 の公開契約（`@platform/ai-core/summarize` の `SummaryValidationError`、`MAX_REGENERATIONS`、`withRegeneration`）と `summarize` の既存テストに波及する。得られるのは約 8 行の重複の解消だけである。この spec では `summarize/retry.ts` を変更しない（タスク 27.3）。
  - **後続の作業として記録するだけにするもの**: (1) 再生成回数の定数を 1 か所にする（`summarize/retry.ts` の `MAX_REGENERATIONS` を `structured` の `DEFAULT_MAX_REGENERATIONS` から導く）。M1 の公開 API を変えないので、M4（評価基盤）で `structured/` を触るときに行ってよい。(2) 統合を再検討する条件: `withRegeneration` を使う 3 つ目の利用者が現れて、ループの本体を直す必要が出たとき。

### ADR-9: 仕様の曖昧さ（ギャップ分析 §5）は plan の決定として扱う

- **Decision**: 下表。受け入れ基準の文言は変えない。1.7・3.10・4.6 は人が確認する（plan の Clarifications 参照）。

| # | 曖昧さ | 決定 |
|---|---|---|
| 1 | Req 1.7 の閾値の尺度 | **コサイン類似度**（`1 - コサイン距離`、−1〜1）。既定 0.5（`DEFAULT_RAG.minSimilarity`）、リクエストで変更可。ベクトル検索の各段が閾値未満の候補を捨てる。全文検索の一致は閾値の対象外（キーワード一致の回収が目的）。統合後の候補が 0 件なら「該当なし」 |
| 2 | Req 2.2 の「3 件」を満たさない出力 | `generateValidated` が最大 2 回再生成し、なお不正なら `output-invalid` |
| 3 | Req 3.5・3.7・4.4 の上限 | `DEFAULT_WORKFLOW_LIMITS`（plan の Interfaces 参照）。呼び出し側の指定が上限を超えれば `invalid-request` で拒否し、モデルの出力が超える場合はスキーマの `.max()` で不正出力として再生成する |
| 4 | Req 3.10 の同点 | 最も早い反復の生成物を返す（厳密な `>` で更新する） |
| 5 | Req 4.6 の「異なるモデル」 | **カタログ ID が異なる**こと。批評側は `purpose: "judge"` のモデル。`mock` の `judge` は新しいカタログ項目 `mock:judge-v1` にする。`live` の Anthropic 既定のように同じ ID になる構成は `invalid-request` で拒否し、`AI_MODEL_JUDGE` の設定方法を案内する |
| 6 | Req 2.6 と `mock` | `mock` では疑似 Rerank を実行し、キーの無い `local` / `live` ではスキップして記録する（ADR-7） |
| 7 | Req 1.12 の記録先 | 本ファイルの I-1 と plan の「Req 1.12 の分類」に記録する |

### ADR-10: RAG の評価は M2 では RAG 専用の最小実装にとどめる

- **Context**: G-9、R-11。004 Req 3 が Agent Evals の基盤（Judge の共通化、`unknown` の選択肢、レポート）を持つ。
- **Decision**: M2 は `rag/eval/` に (a) 検索精度（recall@k）の算術、(b) 評価軸ごとに別のプロンプトで採点する忠実性・回答関連性の Judge（`unknown` を選択肢に含める。004 Req 3.13 に先回りして揃える）、(c) ラベル付き質問セットの型と読み込みを置く。比較・Judge の実行は `packages/eval-suite/tests/capability/*.local.test.ts`。004 で `eval-suite` の共通基盤へ移す（インターフェースは `JudgeModel` を注入する形にして、移行時に呼び出し側を変えない）。
- **Consequences**: M4 で Judge を共通化するときに `rag/eval/judge.ts` を移す作業が残る。

### ADR-11: 難度による振り分けは「ティア」をカタログに足し、`ModelPurpose` は変えない

- **Context**: G-11、R-10。
- **Decision**: `models/catalog.ts` に `MODEL_TIERS`（`mode` と `provider` ごとに `light` / `capable` のカタログ ID）を追加する。`mock` は両方 `mock:general-v1`、`local` は `light = llama3.2:latest`・`capable = granite4.2:latest`、`live` は既存カタログのモデル（`claude-sonnet-4-6` など 1 社 1 モデル）を両方に置き、軽量モデルを持たないプロバイダでは同じ ID になる。ワークフロー関数は解決済みの 2 つのモデルを引数で受け取り、ゲートウェイを直接呼ばない（`workflows/model-tier.ts` の `resolveTiers` が `gateway.resolve({ purpose, modelId })` を呼ぶ）。
- **Alternatives**: `ModelPurpose` に `light` / `capable` を足す（cassette スキーマと公開型に波及）。
- **Consequences**: `live` の Anthropic で振り分け先が同一になる（結果に `distinct: false` を含め、解説に書く）。軽量モデルを `live` のカタログに足すかは、価格・コンテキスト上限を公式ドキュメントで確認した上で別の変更として行う（憲章 原則 8）。

### ADR-12: ラベル付き質問セットと取り込み元

- **Decision**: コーパスは `packages/ai-core/fixtures/rag/corpus/*.md`（日本語、RAG と本リポジトリの題材に関する文書 6 本前後）、質問セットは `fixtures/rag/eval-set.json`（20 問以上: 質問、正解チャンク ID、参照回答）。初期投入（Req 2.12）は取り込み API が `source: "eval-corpus"` を受け取ることと、テストが同じ取り込み関数を直接呼ぶことで満たす。PDF のコーパスはテスト用ビルダーでメモリ上に生成する（バイナリを置かない）。学習者の文書は `knowledge/`（`.gitignore` 済み）に置く。取り込み API は 2 つのディレクトリ（`knowledge`、`eval-corpus`）の**ファイル名（1 セグメント）**だけを受け付け、アップロード（multipart）は扱わない（ローカルの単一の学習者という前提。パストラバーサルとシンボリックリンクの脱出を検査する）。
- **Consequences**: 正解チャンク ID が現在のコーパスのチャンクに存在することを品質ゲートのテストで検証する（コーパスを編集して ID がずれたらテストが落ちる）。

## Req 1.12 の分類（実測に基づく）

| テスト対象 | 品質ゲート（`*.db.test.ts`、PGlite） | 別タスク（`*.pg.test.ts`、`mise run test:db`） | 根拠 |
|---|---|---|---|
| ベクトル検索（`<=>`、k 件、メタデータフィルタ `tags &&`、文書名の絞り込み） | ✅ | 同じケースを再実行 | I-1: PGlite で `<=>`・`&&` が動作 |
| HNSW インデックスの作成と、インデックス付きの検索 | ✅（作成と結果の正しさ） | 再現率・`ef_search` の挙動 | I-1: `hnsw` の作成と `SET hnsw.ef_search` が成功 |
| 全文検索（`simple` + 分かち書き、`ts_rank`、生成列、GIN） | ✅ | 同じケースを再実行 | I-1、I-3 |
| 置換（Req 1.3）、トランザクションのロールバック | ✅ | 同時取り込みの競合 | I-1: `ROLLBACK` で分離 |
| RRF（Req 2.3、2.4） | ✅（TypeScript の純関数。DB 不要） | — | ADR（RRF は SQL に書かない） |
| スキーマ照合（マイグレーションと `schema.ts`） | ✅ | postgres.js ドライバでも | ADR-2 |
| `CREATE EXTENSION vector` を初期化 SQL で行う経路、PostgreSQL 17 + 公式イメージの pgvector | ✗ | ✅ | PGlite は PostgreSQL 18 の WASM で、Compose の初期化 SQL（`infra/postgres/init/01-extensions.sql`）を通らない |
| postgres.js ドライバ経由の接続、接続のライフサイクル | ✗ | ✅ | PGlite はソケットを使わない |
| 並行する取り込みの競合・ロック | ✗ | ✅ | PGlite は単一接続 |

「別タスク」の列は実 Postgres での実測が未了のため、**計画時点では期待であり、`test:db` を初めて実行したタスクで根拠を更新する**（リスク R-2）。

**W2 5.3 の記録（2026-10-12）**: `rag/db/client.pg.test.ts` を作成した（使い捨てのデータベース `rag_pg_test_<乱数>` を `CREATE DATABASE` して使い、学習者の `agentic_ai` には触れない。検証項目: 初期化 SQL による `vector` の有効化、空のデータベースでのマイグレーション適用、pgvector が 0.5.0 以上、HNSW・GIN の作成、二重適用しない、postgres.js 経由の挿入と `<=>` の順位、トランザクションのロールバック、認証失敗が `KnowledgeBaseUnavailableError` になる）。**この環境では Docker デーモンが起動しておらず（`docker info` がソケット接続エラー）、`mise run test:db` を実行できなかった。実 Postgres での結果は未実測であり、成功とは記録しない。** 人が Docker を起動して `mise run test:db` を実行し、成功した項目と差異を次の表に追記する。

| 項目 | 結果（PostgreSQL 17 + pgvector） | 差異・対応 |
|---|---|---|
| 初期化 SQL による `CREATE EXTENSION vector` | 未実測 | |
| 空のデータベースでのマイグレーション適用 | 未実測 | |
| pgvector の版（`pg_extension.extversion`） | 未実測 | |
| HNSW・GIN インデックスの作成 | 未実測 | |
| postgres.js 経由の挿入と `<=>` の順位 | 未実測 | |
| トランザクションのロールバック | 未実測 | |
| 認証失敗の `KnowledgeBaseUnavailableError` への変換 | 未実測 | |

**W2 7.4 の記録（2026-10-12）**: `rag/store.pg.test.ts` を作成した（`store.db.test.ts` と同じ入力と期待値で、置換とロールバック、埋め込みモデルの記録、`<=>` の順位と類似度、閾値ちょうどの境界、`tags` の `&&`（配列パラメータが postgres.js で通るか）と文書名のフィルタ、日本語の全文検索の順位）。**Docker が無く未実行（`ECONNREFUSED 127.0.0.1:5432` で失敗することだけ確認）で、実 Postgres での結果は未実測である。** 人が `mise run test:db` を実行し、差異を次の表に追記する。特に確かめたいのは、配列パラメータ（`tags &&`、`IN (…)`）と `1 - (embedding <=> $1)` のパラメータ型の推論が postgres.js で PGlite と同じ結果になること。

| 項目 | 結果（PostgreSQL 17 + pgvector） | 差異・対応 |
|---|---|---|
| 置換・ロールバック・`rag_meta` の照合 | 未実測 | |
| `<=>` の順位・類似度・閾値の境界 | 未実測 | |
| `tags &&` と文書名のフィルタ（配列パラメータ） | 未実測 | |
| 日本語の全文検索（`to_tsquery('simple', $1)`、`ts_rank`） | 未実測 | |
| 入れ子のトランザクション（セーブポイント）で外側ごと巻き戻る（`ingestDocuments` の原子性の前提。レビュー F-5） | 未実測 | |

## Risks & open questions

- ⚠ **R-1: Turbopack のサーバービルドでの PGlite**（I-10）— mitigation: 最初の Web タスクで `next build` と実サーバー E2E を通す。`serverExternalPackages` に `@electric-sql/pglite`・`postgres`・`unpdf` を追加し、必要最小限を確定する。失敗するなら `mock` の Web アプリだけメモリ上の `VectorStore` に退く（ADR-1 の A2。Req 1.12 の分類は `*.db.test.ts` が担保する）。
- ⚠ **R-2: 実 Postgres（PostgreSQL 17 + pgvector）での挙動が未実測**（Docker 未起動。2026-10-12 の W2 5.3 時点でも未実行。上の「W2 5.3 の記録」の表を人が埋める）— mitigation: `*.pg.test.ts` を同じ SQL で用意し、最初に `mise run test:db` を実行したタスクで結果を記録する。差が出たら Compose のイメージのタグ（`pg17` → `pg18`）を上げるか、SQL を直す。
- ⚠ **R-3: `local` の日本語埋め込みで閾値が弱い**（I-8）— mitigation: 閾値を要件どおり実装しつつ、回答プロンプトでも「根拠が無ければ該当なし」を要求し、解説に限界を明記する。精度比較のテストは top-1/recall で評価し、閾値の分離力に依存しない。
- ⚠ **R-4: `mock` の埋め込みは意味を持たない**（G-4）— mitigation: 品質ゲートのテストは算術（RRF、重複排除、閾値の分岐、recall の計算）、制御フロー、型に絞る。HyDE・Multi-Query・ハイブリッド・Rerank の**効果の差**は `*.local.test.ts` だけで示し、解説と traceability に「gate の緑はこの差を保証しない」と明記する。
- ⚠ **R-5: Cohere の実キーでの呼び出しが未実測**（I-4）— mitigation: `RerankProvider` の境界でレスポンスを Zod 検証し、`mock` の疑似実装と同じインターフェースのテストを持つ。手動のハンズオンで確認し、結果を解説に記録する。
- ⚠ **R-6: 小型モデルの構造化出力・引用の確率は少数試行の観察**（I-7）— mitigation: `generateValidated` の再生成と、`cited` 付きで全チャンクを返す設計で、遵守率に依存しない。
- ⚠ **R-7: `live` の Anthropic 既定では Cross-Reflection と埋め込みが設定なしで動かない**（ADR-9 #5、ADR-4）— mitigation: 起動時ではなく呼び出し時に、設定方法を案内する日本語のエラーを返す。
- ❓ **Q-1: 軽量モデルを `live` のカタログに足すか**（ADR-11）— to resolve in: 実装フェーズの別タスク（公式ドキュメントでモデル ID・価格・コンテキスト上限を確認してから）。
- ✅ **Q-2: `withRegeneration` と `generateValidated` の統合**（ADR-8）— 解決（W6、27.3）: 統合しない。重複（約 8 行）を許容し、判断と根拠を ADR-8 に記録した。

## M2 実測（W6）

`local` でしか得られない数値の記録（タスク 25.1、25.2）。実行日は 2026-10-13、実行環境は Ollama（`granite4.2:latest` = チャットと構造化出力、`nomic-embed-text:latest` = 埋め込み、`gemma4:e2b` = Judge）、`mise run test:local` と同じ `AI_TEST_RUN_MODE=local`（`packages/eval-suite` 単体で `AI_TEST_SUITE=local pnpm exec vitest run`）。Docker は使えず、`*.pg.test.ts` は未実行。**これらの数値はモデルと質問セットに依存する観察で、gate の対象外**（憲章 原則 3、11）。値は各テストの標準出力（`console.table`）から転記した。

### 25.1-a 手法の組み合わせごとの検索精度（`rag-retrieval.local.test.ts`、質問 32 問、recall@5）

評価用コーパス 6 文書を専用の PGlite に取り込み、類似度の閾値は 0（順位だけを比べる）、`topK = 5`、候補数 20。

| 組み合わせ | 平均 recall@5 | ヒット率@5 |
|---|---|---|
| ナイーブ（ベクトル検索のみ） | 70.8% | 75.0% |
| ハイブリッド（ベクトル + 全文、RRF） | **89.1%** | **93.8%** |
| HyDE | 65.6% | 71.9% |
| Multi-Query | 63.5% | 68.8% |
| HyDE + Multi-Query + ハイブリッド | 68.8% | 68.8% |
| Rerank を含む組み合わせ | **未実測**（`COHERE_API_KEY` が無いため行ごと省かれた。「人が行うこと」に残す） | — |

- 読み取れること（この質問セットとモデルでの観察）: ハイブリッドが最も高く、ナイーブより約 18 ポイント上がった（ヒット 30/32 対 24/32）。サンプリングを含まない比較はこれだけで、頑健な差と言える。HyDE と Multi-Query はナイーブをわずかに下回ったが（ヒット 23/32、22/32 対 24/32。**差は 1〜2 問**）、手法の出力は温度 1 の既定のサンプリングで揺れ、実行は 1 回だけなので、「効かなかった」とは言えず、「差は確認できなかった」にとどまる。下がった原因も未確認で、候補は 2 つある。(1) 8.8B の `local` モデルが書く仮想回答やサブクエリが質問の意図から外れた（個々の出力は未確認）。(2) パイプラインの設計: HyDE か Multi-Query を有効にすると**元の質問そのものは検索されない**（`searchText = hypothetical.text`、`queries = expanded.subQueries`。`pipeline.ts`）。両方を有効にすると、サブクエリは質問ではなく**仮想回答から**作られる。学習者は `perQuestion`（質問ごとの結果）で確かめられる。全部を組み合わせても、ハイブリッド単独を下回った。
- 言えないこと: 手法の一般的な優劣。質問は 32 問、コーパスは 6 文書で、HyDE などの効果が出やすい長い文書群や曖昧な質問を含まない。モデルを替えれば順位は変わりうる。
- 実行時間: 初回は 1 時間を超えた（他のプロセスと並走）。単独で質問 3 問が約 148 秒（1 問あたり約 50 秒）で、32 問は約 26 分が目安。**初回の実行は、当時の 1 時間のテストタイムアウトを超えた。** Vitest はそのテストを「失敗」と記録して次のテストに進み、比較の処理は止まらずに続いて、次のテストの実行中に完了して表を出力した（標準出力は、その時点で動いていた次のテストの見出しの下に出ている）。このため、**このテスト自身の完了後のアサーション（質問ごとの結果の長さ、ナイーブの recall が 0 より大きいこと）は、結果として報告されていない**。表の値は 32 問 × 5 組み合わせがすべて出力されたものの転記だが、緑の実行に裏付けられていない。そのためタイムアウトを 3 時間に改め、`RAG_EVAL_QUESTIONS=<n>` で質問数を絞れるようにした。**改めた後の全問の再実行はしていない**（手法の出力はサンプリングで揺れるため、再実行すると値は少し変わる）。緑の実行で表を裏付けることを、「人が行うこと」の推奨の作業に挙げる。

### 25.1-b `granite4.2` の構造化出力と脚注の遵守

| 項目 | 結果 | 試行 |
|---|---|---|
| Multi-Query の「ちょうど 3 件」（再生成なし） | 32/32 が 1 回目で有効（再生成 0 回、全試行が不正 0 件） | 32 問 |
| 回答の脚注 `[n]`（範囲内の脚注を 1 つ以上付けた回答） | 9/10 | 質問セットの先頭 10 問、`topK = 5` |
| 範囲外の脚注（`[7]` など）を含んだ回答 | 0/10 | 同上 |

I-7 の少数試行（6 問で 6/6）と矛盾しない。偽の ID を作る失敗は観察されず、失敗の形は「脚注を付けない」だった（ADR-6 の設計の前提どおり）。

### 25.1-c Judge の採点（`rag-judge.local.test.ts`、Judge = 用途 `judge` の既定）

固定の 3 ケース（質問「RAG とは何ですか。」、根拠のチャンクは質問セットの正解チャンク）。いずれも期待どおりだった。

| ケース | 忠実性 | 回答関連性 |
|---|---|---|
| 根拠のある回答 | pass（5） | pass（5） |
| チャンクに無い内容（「2030 年に ISO 99999 として標準化」）を足した回答 | **fail**（2）。理由に足した主張を名指しした | pass（5） |
| 質問に答えていない回答（天気） | fail（1） | **fail**（1） |

3 ケース 1 回ずつの観察で、Judge の判定の再現性（同じ入力での揺れ）は測っていない（M4 の 4-3）。

### 25.1-d 日本語の埋め込みでの類似度の分布と、閾値 0.5 の妥当性（I-8 の更新）

`nomic-embed-text:latest` で、各質問に対する**最上位のチャンク**のコサイン類似度。四分位と中央値は**最近順位**（位置が 2 つの値の間にあるときは大きい方。n = 8 の中央値は 5 番目の値）で、平均をとる通常の定義とは少し違う。評価コーパスに答えがある質問（質問セット 32 問）と、答えが無い質問（固定の 8 問: 天気、料理、スポーツ、地理、交通、ペット、税、楽器）を比べた。

| 質問 | 件数 | 最小 | 第 1 四分位 | 中央値 | 第 3 四分位 | 最大 | 0.5 以上 |
|---|---|---|---|---|---|---|---|
| コーパスに答えがある | 32 | 0.710 | 0.762 | 0.822 | 0.858 | 0.938 | 32/32 |
| コーパスに答えが無い | 8 | 0.627 | 0.684 | 0.706 | 0.711 | 0.746 | **8/8** |

（2026-10-14 に、現在のテストで類似度のテストだけを再実行し、**両方の行を 1 回の実行で得た**。コマンド: `cd packages/eval-suite && AI_RUN_MODE=local AI_TEST_RUN_MODE=local AI_TEST_SUITE=local pnpm exec vitest run tests/capability/rag-retrieval.local.test.ts -t "top-1 cosine"`、所要 5 秒、LLM は使わず埋め込みだけを使う。値は 2026-10-13 に別々の実行で得た値と一致した。出力は `console.table` の形で、以前は答えが無い行の生の出力を保存しておらず、この再実行がその裏付けである。答えが無い行は質問数の制限（`RAG_EVAL_QUESTIONS`）に依存しない。）

- **既定の閾値 0.5 では「該当なし」が一度も起きなかった。** 答えが無い質問でも最上位の類似度が 0.627〜0.746 で、8/8 が閾値以上だった。I-8 の測定（英語では 0.5 付近で分離、日本語は 0.53〜0.67 と 0.64〜0.79 で重なる）より悪く、**日本語の `nomic-embed-text` では 0.5 は事実上素通し**だった。
- 2 つの分布は 0.710〜0.746 で重なる。**単一の閾値では分けられない**（閾値を 0.75 付近に置くと、答えが無い 8 問は全部落ちるが、答えがある質問の一部（最小 0.710）も落ちる。8 問での観察で、一般化できない）。
- **決定**: 既定値は 0.5 のまま（要件の既定。ADR-9 #1）、解説 2-1・2-2 に「`local` の日本語では閾値が弱い防御」「測ってから決める」と明記する。既定値を上げるかは、埋め込みモデルごとの測定と母集団（質問の種類）を増やしてから別に判断する（本タスクの範囲外）。「該当なし」の最終的な防御は、回答プロンプトの指示（資料が無ければ該当なしと答える）と、引用を人が確かめられる UI。

### 25.2 Role-Based Cooperation と単一エージェントのトークン使用量

同じタスクを、`runPatternDemo("role-based-cooperation")`（リサーチャー → コーダー → レビュアーの 3 役割。リサーチャーは `currentTime`、コーダーは `calculator` を持つ）と、M1 の単一エージェント（`createGuardedAgent`、同じ 2 つのツールを全部持つ）で 3 回ずつ実行した。モデルは用途 `chat` の既定（`granite4.2:latest`）。上限は 1 実行あたり `maxSteps = 10`、`maxTotalTokens = 50000`。

- **比較対象の注意（レビュー F-4）**: タスク 25.2 は「M1 の `/agent`（単一エージェント + ツール）」との比較を求めたが、実測では `createGuardedAgent` に**このタスクに要る 2 つのツールだけ**を持たせ、ペルソナのシステムプロンプトも付けなかった。実際の `/agent` は 5 つのツール（`currentTime`、`calculator`、`currencyConvert`、`weather`、`webSearch`）とペルソナを持つので、ステップごとの入力トークンはもっと大きい。したがって**ここでの単一エージェントの合計は `/agent` より小さく、比 1.26 は `/agent` との比より大きく出ている**（向きは推測で、`/agent` では測っていない）。実測に使った一時テストは削除したため、再現できない。`/agent` との比較は「人が行うこと」に残す。
- **タスク**: 「今の時刻を確かめ、1 日 8 時間の作業を 12 日続けたときの合計時間を計算して、報告を一文でまとめてください。」

| 試行 | 役割ごとの入出力トークン（リサーチャー / コーダー / レビュアー） | Role-Based の合計 | 単一エージェントの合計（3 ステップ） | 比 |
|---|---|---|---|---|
| 1 | 1071 / 743 / 1067 | 2881 | 1927 | 1.50 |
| 2 | 1067 / 630 / 574 | 2271 | 1920 | 1.18 |
| 3 | 1094 / 640 / 414 | 2148 | 1931 | 1.11 |
| 平均 | — | 2433 | 1926 | **1.26** |

- どの試行も、単一エージェントは 2 つのツール（`currentTime`、`calculator`）を呼んで 96 時間と正しく答えて完了した。Role-Based も 3 役割とも完了し、最後の役割（レビュアー）の出力は「承認します」と整合の確認で、答えそのものは前の役割の出力に含まれる。
- **この単純なタスクでは、単一エージェントで足りる。** Role-Based は約 1.26 倍のトークンを使い、最終出力は成果物ではなくレビューのコメントだった（`cooperateByRole` は `final` に最後の役割の出力を入れ、デモの最後の役割はレビュアーで「承認するか、直す点を短く述べる」よう指示されているため）。**これは Req 4.7（「最終成果物」を返す）に対する隙間として `traceability.md` に記録した**: デモの `final` が成果物にならない。plan C12 は `final` を「最後の役割の出力」とは定義していないので、(a) レビュアーが承認した成果物を返すようデモを直す、または (b) C12 で `final` を最後の役割の出力と定義し、解説 2-4 に成果物は `outputs` の最後から 2 番目にあると書く、のどちらかを後続で決める（M2 の範囲外。W4 のコードと承認済みの plan に触れるため、人の判断に残す）。役割に分ける利点（役割ごとのツールの絞り込み、指示の簡潔さ、検査の分離）は、このタスクの大きさでは費用に見合わなかった。憲章 原則 1 に沿い、単純なタスクは単一エージェントを選ぶ。**Role-Based Cooperation の実装は残す**（plan の確定済みの扱い）。
- 言えないこと: 3 試行、1 つのタスク、1 つのモデル。ツールが多く、役割ごとの指示が長い大きなタスクでは差が逆転するかもしれない（未測定）。

### 人が行うこと（W6 時点）

1. Docker を起動して `mise run test:db` を実行し、本ファイルの「W2 5.3 の記録」の表を埋める（実 Postgres 17 + pgvector、`*.pg.test.ts`）。
2. `COHERE_API_KEY` を設定して Rerank を有効にし、`/rag` で動作を確かめる。`rag-retrieval.local.test.ts` を再実行すると、Rerank を含む 2 行（`naive+rerank`、`all+rerank`）が表に加わる。
3. **推奨**: `rag-retrieval.local.test.ts` を全問（Ollama が空いていれば約 26 分）で再実行し、緑の実行で 25.1-a の表を裏付けて更新する（初回は完了後のアサーションが評価されていない。25.1-a の実行時間の注）。
4. 25.2 を `/agent` と同じ 5 つのツールとペルソナで測り直すか、制限として受け入れるかを決める（25.2 の「比較対象の注意」）。
5. 25.2 で見つかった、デモの `final` が成果物にならない点（Req 4.7）の扱いを決める。
