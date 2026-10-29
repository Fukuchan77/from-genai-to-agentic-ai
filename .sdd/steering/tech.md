# Technology

技術上の判断と規約を記す永続知識。依存の網羅的な一覧ではない。
版の実測値と ADR の詳細は `specs/001-agentic-ai-platform/research.md`、コンポーネントの契約は
同 `plan.md` にある。

> **状態（2026-10-29）**: M1（001）と M2（002）は実装済み。M3（003）も実装済み（W1〜W8、完成タグ `module/3-1`〜`3-6`）。以下は承認済みの plan.md / research.md の決定と実測値で、実装で版などが変われば更新する。
> M2 の決定の詳細は `specs/002-rag-and-workflows/research.md`（ADR-1〜12）、M3 は `specs/003-domain-agents/research.md`（ADR-1〜10）にある。

## Stack

| Layer | Choice | Notes |
|-------|--------|-------|
| Runtime | Node.js 26 | `mise.toml` で固定（先行版の採用は方針） |
| Language | TypeScript 7.1 先行版 | 全ワークスペースで完全一致の版に固定。型検査は `tsc --noEmit`（ADR-2） |
| Monorepo | pnpm workspaces + Turborepo | 入口は mise タスク。turbo は `typecheck` / `test` / `build` を依存順に実行（ADR-1） |
| Web | Next.js（App Router、Turbopack、React Compiler、`typedRoutes`） | UI は shadcn/ui + Tailwind CSS v4 の基本部品と自前のチャット部品（ADR-11） |
| AI | Vercel AI SDK v7 + Zod | プロバイダ: Anthropic（`live` 既定）/ OpenAI / Azure / Google / Ollama |
| Data store | 二層: PGlite + pgvector（インプロセス。gate と `mock` の Web アプリ）と Postgres 17 + pgvector（Docker Compose。`local` / `live` のハンズオンと `test:db`） | M2 から。型付きクエリは `drizzle-orm`。検索は pgvector（コサイン）+ 全文検索 + Reciprocal Rank Fusion（TypeScript の純関数）。ベクトルは 768 次元に統一 |
| Rerank | Cohere（`@ai-sdk/cohere`）。`mock` は語の重なりによる疑似実装 | キー名 `COHERE_API_KEY`。キーが無い `local` / `live` では Rerank 段をスキップして記録する（ADR-7） |
| Observability | OpenTelemetry（OTLP）+ Langfuse | 受信基盤（Compose の `trace` プロファイル）は M1 で用意し、計測とエクスポートは M4 |
| Sandbox | E2B（`E2B_API_KEY` があるとき。`@e2b/code-interpreter`）、なければローカル Docker（Engine API を unix socket 越しに `node:http` で叩く。`dockerode` は使わない）。どちらも無ければ機能は起動しない | LLM 生成コードの実行専用（M3 から）。イメージは `mise run sandbox:build`、残骸は `sandbox:clean`（ADR-4、6） |
| MCP | `@ai-sdk/mcp`（クライアント）、`@modelcontextprotocol/server`（自作の stdio サーバー） | 依存は完全一致で固定。`@ai-sdk/mcp` は 24 時間規則のため plan 時に 2.0.76 を採った（現在の `package.json` は 2.0.83）。GitHub の MCP は `GITHUB_TOKEN` が無ければ接続しない |
| arXiv | `HttpFetcher` + `fast-xml-parser`（`processEntities` 無効） | 利用規約: 3 秒に 1 リクエスト、日単位のキャッシュ。制限は複数インスタンスに跨らない（ADR-3） |
| Testing | Vitest（単体・回帰）、Playwright（3エンジン E2E）、Stryker（ミューテーション） | `@axe-core/playwright` で WCAG 2.2 AA。Stryker は TypeScript 7・Vitest 5 に未対応のため、`tsconfigFile` の回避と `@stryker-mutator/vitest-runner` へのパッチ（`patchedDependencies`）で動かす。対応版が出たら外す（plan C18） |
| Lint / Format | Biome（リポジトリ全体で単一規約） | `noUnusedVariables` / `noUnusedImports` は `error` |
| Tooling | mise → `pnpm exec` | 素のツールを直接実行しない |

## Key Decisions

- **エージェントは `ToolLoopAgent`、ワークフローは素の TS** — `generateText` / `streamText` を
  合成するワークフローで `ToolLoopAgent` を使わない。構造化出力は `output: Output.object(...)`、
  ツール入力は `inputSchema`。`generateObject` / `streamObject` は使わない。
- **エージェント生成は `createGuardedAgent` に一本化** — 3種の停止条件と停止理由を強制し、
  1回の実行につき1回生成する（状態をリクエスト間で共有しない）。ツールは 20 個以下（ADR-6）。
  渡せるツールは `buildToolSet` の戻り値 `GuardedToolSet`（ブランド型）だけで、リスク区分の検査を
  迂回できない（plan C8、C9）。
- **後続 milestone は拡張点から差し込む** — トレース（004 Req 5）と評価レポートは
  `createGuardedAgent` の `observers`（`RunObserver.onRunEnd(summary)`）を実装して接続する。承認ゲート
  （004 Req 4）は `toolApproval` 等を `createGuardedAgent` の options に足すだけで、`/api/agent/tools`
  の UI ストリームの形は変えない（plan「後続 spec への契約」）。
- **モデル切り替え時の履歴は許可リストで変換する** — 送信直前に `adaptHistoryForModel` を適用し、他
  プロバイダの推論パートと `providerMetadata` を除き、画像非対応モデルには画像をテキストに置き換える。
  変換はサーバーの送信時だけで、クライアントの表示用履歴は変えない（ADR-7）。
- **トークン数はローカルで推定する** — `gpt-tokenizer` の推定値に安全係数 1.2 を掛け、カタログの
  コンテキスト上限の 80% を超えるなら分割して段階的に要約する。実測の `usage` も併記する（ADR-9）。
- **ツールは `defineAciTool` で定義** — リスク区分（`read-only` / `write` / `destructive`）が必須。
  例外とタイムアウトは `ToolOutcome` としてツール結果に変換し、ループを継続させる。
- **モデル解決はゲートウェイに集約** — 機能は `gateway.resolve({ purpose, modelId? })` だけを呼ぶ。
  モデル ID はモデルカタログ（`models/catalog.ts`）にだけ書く（ADR-4）。
- **LLM 実行モードは3層** — `mock`（テスト専用・決定論的）、`local`（Ollama。Web とハンズオンの
  既定）、`live`（商用 API）。コードを変えずに環境変数で切り替える。
- **`mock` はシナリオ（述語照合）→ カセット（キー照合）→ エラー** — ネットワークへフォールバック
  しない（ADR-5）。
- **Biome の書式はタブ・ダブルクォート・行幅 100・セミコロンあり**（ADR-3）。ドラフトの
  2スペース・シングルクォート案は採らない。
- **データ層は二層で、SQL は 1 回だけ書く**（M2、ADR-1）— ストアは Drizzle のクエリビルダーで書き、`PgDatabase` を受け取る。
  `*.db.test.ts`（gate）は PGlite、`*.pg.test.ts`（`mise run test:db`）は Compose の Postgres に同じストア関数を実行する。
  手書き SQL を使うのは `rag/db/migrate.ts` だけで、`sql.raw` はリポジトリ規則 `no-sql-raw` が他で禁止する。
- **マイグレーションは手書き SQL + 自前のマイグレーター。`drizzle-kit` は採らない**（M2、ADR-2）— `packages/ai-core/drizzle/NNNN_<name>.sql`
  を順に適用し、`rag_migrations` に記録する。`drizzle-kit` は `npm audit` の中程度 4 件を持ち込むため入れない。`schema.ts` との乖離は
  スキーマ照合テストが検出する。
- **日本語の全文検索は `Intl.Segmenter` + `simple` + 助詞の除去**（M2、ADR-3）— 取り込み時に分かち書きして `search_text` に保存し、
  生成列 `tsv` を GIN で引く。順位は `ts_rank`（BM25 ではない）。「該当なし」の判定はベクトル検索の閾値だけで行う（CL-1）。
- **埋め込みは 768 次元に統一し、`rag_meta` にモデルを記録する**（M2、ADR-4）— 別のモデルでの取り込み・検索は
  `reset: true` で作り直すまで `invalid-request`。閾値の既定は 0.5 だが、`local` の日本語の埋め込みでは関連と無関係の類似度が重なる（research I-8）。
- **引用は序数の脚注 `[n]`**（M2、ADR-6）— サーバーが範囲外の序数を除去して記録し、取得した全チャンクを `cited` 付きで返す。
  チャンク ID は内容ハッシュ（ADR-5）で、評価セットの正解 ID はそれに依存する。
- **`structured/` の `generateValidated` が構造化出力の再生成を担う**（M2、ADR-8）— Multi-Query、Judge、ルーター、評価器、パターンが使う。
  M1 の `summarize/retry.ts`（ストリーム用）とは統合せず、重複を許容する（W6 27.3 の判断）。
- **`workflows/` と `patterns/` は `agents/` を import しない**（M2、憲章 原則 1）— 制御フローはコードで書く。規則 `workflow-no-agent-loop` が
  検査し、例外は `patterns/role-based-cooperation.ts`（`createGuardedAgent` で役割ごとのエージェントを作る）だけ。
- **PGlite は `serverExternalPackages` に置く**（M2）— Server Component のページが `getKnowledgeBase()` を実行すると、
  SSR 層のバンドルでは pgvector の tarball を読めず失敗する（Route Handler では動く）。`next.config.ts` に
  `@electric-sql/pglite` と `@electric-sql/pglite-pgvector` を列挙し、全レイヤで `node_modules` から読む。Vitest では
  検出できないので、実サーバー E2E（`real-server.spec.ts`）が回帰を守る。
- **MCP ツールのリスク区分は注釈から決める**（M3、ADR-7）— `readOnlyHint === true` だけが `read-only`。それ以外（注釈なしを含む）は
  `destructive` で、`write` / `destructive` は `buildToolSet` が登録を拒む（書き込み系の MCP ツールは使えない）。許可リスト（`schemas`）に載せた
  ツールだけをエージェントごとに渡し、ツール数は 20 個以下に数える。注釈はサーバーが提供する信頼できないヒントとして扱う。
  自作サーバーは `files/`（stdio、許可ルートの外に出ない）で、`trustErrorMeta` を真にするのはこれだけ。
- **`child_process` を import しない**（M3、ADR-4）— `no-dynamic-eval` に例外を作らず、stdio MCP は SDK の transport、E2B は SDK の HTTP、
  Docker は Engine API（`node:http` の `socketPath`）で扱う。サンドボックスの提供者は `ports/sandbox.ts` の `SandboxProvider` で、
  選択は `lib/server/platform.ts` の1か所。アイドルは `Clock` で数え（既定 10 分）、E2B 側の寿命は実装ではアイドル × 3（既定 30 分）。ADR-6 も同じ値に直した（2026-10-29）。
- **致命的ツールエラーは Run 単位のラッチで伝える**（M3、ADR-5）— `FatalToolError` を `FatalLatch` に記録し、**abort ではなく停止条件（`stopWhen`）で**ループを止めて、停止理由を `error` にする（abort は `finish` パートと `onEnd` を落とす。spike S-1）。
  停止理由の閉じた語彙は変えない。
- **モジュールのコピーをまたぐ状態は `globalThis` のホルダーに置く**（M3）— Next.js ではページと Route Handler のバンドルが別のモジュール
  コピーになる。モジュール内の `WeakSet` に「`defineAciTool` で定義済み」を持つと、ページが作った MCP ツールを Route Handler の `buildToolSet` が
  拒否した（E2E が検出）。定義済みツールの記録と、セッションレジストリ（`sessions.ts`）、`platform.ts` の組み立て結果は `globalThis` に1つだけ置く。
- **階層型リサーチは Agent-as-a-Tool、計画と面接はワークフロー**（M3、ADR-8、9）— Supervisor が3つのサブエージェントをツールとして呼び、
  呼び出し数に上限を置き、トークンは `agents/token-ledger.ts`（`RunObserver`）で役割別に集計する。ヘルプデスクの計画・Replanner は
  `generateValidated` の構造化出力と依存順の純粋なスケジューラ、要件インタビューは固定往復で、各タスクの実行だけが `createGuardedAgent`。
- **チケットは rag の drizzle 基盤に置く**（M3、ADR-10）— `helpdesk_tickets` などを `rag/db/schema.ts` に定義し、`drizzle/0002_helpdesk.sql`・
  `0003_marketing.sql` で作る。単一の学習者が前提で、認証と行の共有は扱わない。

## Conventions

- **Typing**: strict。`packages/ai-core` の公開 API に `any` を含めない（Biome `noExplicitAny`）。
  システム境界（HTTP、ツール入力、構造化出力、環境変数、外部 API の応答）は Zod で検証し、内部では
  検証済みの型を信頼する。クライアントへ渡す型は Zod を含まない型にする。
- **Errors**: 独自エラーは `PlatformError`（`code` は閉じた語彙、`message` は日本語、`details`）を
  継承する。クライアントへは `code` と `message` だけを返し、スタックトレースと秘密情報を送らない。
- **Logging**: ログに出してよいのはエラーの `code`・名前、モデル ID、ツール名、数値だけ。生の
  プロンプト、メッセージ本文、ツール引数・結果、秘密情報は出さない。
- **Dependency injection**: 時刻と外部サービスはポート（`Clock`、`HttpFetcher`、
  `TranscriptSource`、`WebSearchProvider`）越しに注入する。`process.env` を直接読むのは設定読み込みの
  既定引数の1か所だけ。
- **Testing**: TDD（RED → GREEN → REFACTOR）。テストは実装の隣に置く。M2 の評価は `packages/eval-suite/tests/` に置き、
  gate が保証するのは評価の配管（質問セットの検証、`mock` の埋め込みでの recall@1）まで。手法の効果の差と Judge の判定は
  `*.local.test.ts` だけが示し、結果は `specs/002-rag-and-workflows/research.md`「M2 実測（W6）」に記録する。命名で実行経路が決まる:
  - `*.test.ts` — gate で実行（`mock`）
  - `*.local.test.ts` — 比較・品質評価。`local` のときだけ実行し、なければ理由付きスキップ
  - `*.db.test.ts` — インプロセス DB で gate に含める
  - `*.pg.test.ts` — Docker の Postgres が必要。`mise run test:db` だけで実行
  - `*.container.test.ts` — Docker のサンドボックスが必要。`mise run test:container` だけで実行し、Docker に届かなければ理由付きスキップ。
    通常の遮断は Docker の socket も塞ぐ（`local` 経路では意図して開けない）。`container` の経路だけが Engine の socket を許可する
  - テスト中は `fetch`・`node:net`・`node:dns` を遮断する。未モックの接続はテストを失敗させる。
- **Non-vacuous gate**: 各段で実行件数・走査件数が 0 なら失敗。スキップは合格に数えない。
- **Language**: spec・解説・UI 文言は日本語。コード、識別子、コメント、コミット、PR は英語。
- **Commands**: `mise run <task>` → `pnpm exec <cmd>` の順。
- **Gate command**: `mise run gate`。`lint`（Biome の非空走査を含む）→ `check:model-ids` →
  `check:repo-rules`（13規則。M2 で `workflow-no-agent-loop` と `no-sql-raw`、M3 で `mcp-import-scope`（`@ai-sdk/mcp` は `src/mcp/` の外で import しない）と
  `sandbox-import-scope`（`@e2b/code-interpreter` は `sandbox/e2b.ts`、Docker の socket は `sandbox/docker/` の外で使わない）を追加）→ `typecheck`（tsc の対象ファイル数を検査）→ `test`（`mock`）→
  `docs:check`。Docker・API キー・ネットワーク不要。後続 milestone で規則や段を足すときも「0 件なら失敗」を保つ。
- **CI**: `gate`、`secret-scan`、`audit`、`mutation`、`client-bundle`、`e2e`（3エンジン）の各ジョブを
  `ci-status` が集約する。E2E は `mise run test:e2e`、SSE fixture は Route Handler から
  `mise run e2e:fixtures` で生成する。
- **Dev command**: `mise run dev`（ルートの `.env.local` を読み込んで `next dev` を起動する。Next.js は `apps/web` の env ファイルしか読まない）。
- **Preflight command**: なし。`local` の可否は Vitest の global setup が Ollama の到達性で判定する。

## Constraints

- **決定性**: 同一コミットで `gate` を 10 回実行して同じ合否。依存インストール済みの開発機で 5 分以内。
- **隔離実行**: LLM 生成コード（データ分析、ハーネスの実装・テスト）はホストで実行しない。隔離環境が
  なければその機能は起動しない（M3 の分析は E2B か Docker のどちらかが必要）。`eval` / `new Function` / `child_process` は許可リスト外で禁止。
- **承認ゲート**（constitution 原則 6、004 Req 4）: 承認要否はコミット済みのサーバー側コードで決め、
  クライアントの値や実行時のヒューリスティックで決めない。承認要求はサーバーが発行し、ツール呼び出し
  ID と引数に束縛して署名し、1 回だけ消費できる。承認・再開のリクエストは未知フィールドを拒否する厳格な
  スキーマで検証し、会話履歴・モデル・トークン使用量を受け付けない。
- **秘密情報**: API キーは環境変数からサーバー側でのみ参照（`server-only`）。`NEXT_PUBLIC_` を秘密に
  使わない。`.env` はコミットせず、キー名だけの `.env.example` を置く。
- **外部サービスの規約**: arXiv は 3 秒 1 リクエストを直列キューで守り、同じ検索は日単位でキャッシュする。429 / 503 は HTML なので解析に渡さない。
- **サプライチェーン**: 公開 24 時間未満の版を採らない（`minimumReleaseAge: 1440`）。`allowBuilds` は
  理由コメント付き。`overrides`・`patchedDependencies` も直前のコメントに理由と外す条件を書く。CI は `--frozen-lockfile`、Actions は SHA 固定・最小 `permissions`。
- **依存の追加**: `plan.md` に宣言してから追加する。API キーが要る外部サービスは、キーがない場合の
  スキップまたは代替を必ず持つ。
- **先行版**: 範囲指定でなく完全一致で固定し、理由を記録する。非互換で TypeScript 6.x に後退する
  場合は、範囲・理由・解除条件を記録する。コンパイラ API 依存のツール（`ts-morph`、型付き
  `typescript-eslint`、Stryker `typescript-checker`）は採らない。
- **品質目標**: `packages/ai-core` の行カバレッジ 80% 以上、WCAG 2.2 AA とキーボード操作、最新安定版の
  Chrome / Firefox / Safari、`mock` でのストリーミング反映 100 ms 以内。
- **予算と費用の上限（M3 の決定、2026-10-29）**: 共有トークン予算（`createBudget`）はソフトな上限で、合計は
  `maxTotalTokens` を超えうる（1 回目の呼び出しは予測できない）。厳密な費用上限が要るなら、ステップの途中で中断する
  ハードな上限を M4 で別に設計する。サンドボックスの外向き通信（E2B は既定で許可）と `runPython` のリスク区分も M4 で再検討する。
- **検証の書き方**: スタブ単位の変異検証だけでは全体の不変条件は見つからない。機能ごとに「実行全体の規則」と終端状態を
  主張するテストを置く。テストが走るレーンと、記録した因果の裏取りを、完了の前に確認する（`specs/*/pdca/act.md`）。
