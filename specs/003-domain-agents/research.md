# 003-domain-agents — Discovery & Research Log

`/sdd-plan` で作成。設計に影響する調査、判断、リスクを記録する。各項目は日付と根拠（ファイル・URL・コマンド出力）付き。
調査日: 2026-10-16（11:55 UTC 時点のレジストリを参照）。

## Discovery type

**New feature (full)**。外部依存（MCP サーバー、E2B サンドボックス、ローカルコンテナ、arXiv API、スプレッドシート解析）が多く、
既存の `ai-core` にない領域（ツール接続、サンドボックス、チケット永続化）を含むため、フルディスカバリーを行った。

## Investigations

### I-1: ツールのエラー経路（C2、Req 1.3）

- **Question**: 致命的なツールエラーで Run を停止理由 `error` にできるか。
- **Findings**: `aci/define-tool.ts` の `failureFrom` は `ToolExecutionError` / `PlatformError` / その他の例外をすべて
  `kind: "recoverable"` に変換する。`timeout` だけが別経路。`ToolFailureKind` の `fatal` は型にあるが生成箇所がない。
  `executeWithGuards` は `catch` で例外を握りつぶして `ToolOutcome` を返すため、ツールの失敗は例外として Run へ伝わらず、
  Run は `completed` で終わる。さらに `ai@7.0.137` の `executeToolCall` は、ツールの `execute` が投げた例外を捕捉して
  `{ type: "tool-error" }` の出力に変換し（モデルにはテキストで返る）、ループを止めない。不正な入力も同じく `tool-error` になる。
  したがって「例外を再送出して Run を止める」方式は成立しない。`finalise` は `abort === undefined && error !== undefined`
  のときだけ `errored` とし、abort を error より優先するので、致命的エラーは Run 単位の経路で `finalise` に伝える必要がある。
- **Evidence**: `packages/ai-core/src/aci/define-tool.ts:81-100`（`failureFrom`）、`:112-140`（`executeWithGuards`）、
  `packages/ai-core/src/agents/guarded-agent.ts:249-273`（`finalise`）、`packages/ai-core/src/agents/stop-reason.ts`、
  `node_modules/ai@7.0.137/dist/index.js` の `executeToolCall`（ツール例外の捕捉と `tool-error` 化）。

### I-2: 既存の再利用資産（ACI、Agent、Ports）

- **Findings**:
  - `defineAciTool`（`risk` 必須、`inputSchema` は Zod）、`buildToolSet`、`GuardedToolSet`（ブランド型）、`assertRegistrable`（`read-only` 以外を拒否）。
  - `createGuardedAgent`（`ToolLoopAgent` を作る唯一の場所）、`LoopLimits`、`AgentRunSummary`、`RunObserver`、`MAX_AGENT_TOOLS = 20`（`assertToolCount`）。
  - `createStopConditionRecord`（実行ごとに作る停止条件の記録）。`deriveStopReason` の優先順位は abort → error → 停止条件。
  - `patterns/role-based-cooperation.ts` は `agents/` を import できる唯一のパターンファイル。合議の基礎にする。
  - `ports/http.ts`（`HttpFetcher`）は arXiv に流用できる。`ports/clock.ts` の `Clock` / `FakeClock` は 3 秒間隔制限とアイドル判定に使える。
  - `rag/db/schema.ts` は drizzle + PGlite（gate）/ Postgres（hands-on）の二層構成。チケット表はこの基盤に載せる。
- **Evidence**: `packages/ai-core/src/aci/{define-tool,tool-set,types,index}.ts`、`packages/ai-core/src/agents/{guarded-agent,stop-conditions}.ts`、
  `packages/ai-core/src/ports/{clock,http}.ts`、`packages/ai-core/src/rag/db/schema.ts`。

### I-3: 環境変数スキーマと機能の必要条件

- **Findings**: `config/env-schema.ts` の `optionalString` で任意の鍵を受ける。`ENV_KEYS` は `Object.keys(envSchema.shape)` から作られるので、
  新しい鍵は同じ方式で追加できる。`FEATURE_REQUIREMENTS` には `live-*`、`web-search`、`rerank` のみあり、GitHub、E2B、ローカルコンテナは未登録。
- **Evidence**: `packages/ai-core/src/config/env-schema.ts:11-66`、`packages/ai-core/src/config/feature-requirements.ts`。

### I-4: 既存ツールの記述規約（R9、Req 1.1、1.11、1.13）

- **Findings**: `aci/tools/web-search.ts` は `*_TOOL_NAME` 定数、`description`、`risk: "read-only"` を持つ。説明文は日本語で「〜するときに使ってください」の形。
  ツール名は `TOOL_NAME` 正規表現（英字始まり、64 字以内、英数字・`_`・`-`）。新ツールも同じ形式に揃える。
  Req 1.11 の「いつ使うか / いつ使わないか」は説明文の必須要素として文言検査（テスト）で保証する。
- **Evidence**: `packages/ai-core/src/aci/tools/web-search.ts:26-30`、`packages/ai-core/src/aci/tools/weather.ts:135`、`packages/ai-core/src/aci/define-tool.ts`（`assertValidDefinition`）。

### I-5: arXiv API（R7、Req 4.3、4.7）

- **Findings**（一次情報: arXiv User Manual と Terms of Use を取得。VERIFIED）:
  - ToU: 1 リクエスト / 3 秒以上、接続は 1 本。制限は利用者の全マシンに跨る。同じ検索は 1 日 1 回以上取得しない。
  - 応答は Atom 1.0 のみ（エラーも Atom）。文書化されたエラー状態は HTTP 400 のみ。429 / 503 / `Retry-After` は文書になし（UNVERIFIED）。
  - `max_results` は 1 回 2000 件まで、総数 30000 件まで。`id` は `http://arxiv.org/abs/<id>vN` の形で、版番号 `vN` を除去する。
  - ToU: メタデータの保存と共有は可。e-print（PDF）は自前サーバーから配信しない。arXiv の推奨を示唆しない。
  - 解析: `fast-xml-parser` 5.11.2（2026-09-29 公開、MIT、依存 6、install script なし）。`processEntities` を無効にし、`isArray` で `entry` / `author` / `link` を配列化する。
  - advisory: GHSA-8r6m-32jq-jx6q（修正 5.10.1）と GHSA-gh4j-gqv2-49f6（修正 5.7.0）は 5.11.2 で解消。2026 年の他の advisory の修正版は個別確認していない（UNVERIFIED）。
- **実測（2026-10-19、`curl` で `export.arxiv.org` に 8 回。10〜15 秒間隔にしても 429 が続いた）**:
  - **429**: `content-type: text/html`、本文は `Rate exceeded.`（14 バイト）。`Retry-After` は付かない。Atom ではないので解析に回してはならない（クライアントはステータスで先に分岐し、解析に渡さない）。
  - **503**: `content-type: text/html`、本文は 126 バイトの HTML（`<title>503</title>`）。`Retry-After: 0` が付いた。0 秒の指示は 3 秒の間隔で打ち消される（`client.test.ts` の既存テスト）。
  - **301**: `http://` は `https://export.arxiv.org/...` へ。`Location` は絶対 URL で、`Retry-After: 0` が付く。
  - **正常系（1 件）**: 200、`application/atom+xml; charset=utf-8`。応答に約 10 秒かかり、複数件・0 件の取得は 60 秒でタイムアウトした。`arxiv:comment`、`arxiv:primary_category`、`category`、`rel="related"` の PDF リンクが付き、`parse.ts` はそのまま解析できる（`fixtures/arxiv/live-single.xml` と `parse.test.ts`）。
  - **検索語**: `all:attention is all you need` は OR に展開され、期待した論文を返さなかった。フレーズを求めるなら `ti:"..."` の形が要る。
  - **未実測**: 複数件・0 件の正常系、HTTP 400 のエラーフィード（429 / 503 / タイムアウトに阻まれた）。リダイレクトの追従はガード付き fetch の挙動を未確認。429 の連続は、混雑または私の連続リクエストが原因かを切り分けていない。
- **Evidence**: https://info.arxiv.org/help/api/user-manual.html、https://info.arxiv.org/help/api/tou.html、`npm view fast-xml-parser time --json`、上記の `curl`（2026-10-19）。

### I-6: スプレッドシートと CSV の解析（R6、Req 3.1、3.9）

- **Findings**（レジストリと OSV で確認。VERIFIED）:
  - `exceljs` 4.4.0: 2023-10-19 公開で長期間未更新。依存の木が古い（archiver 5、unzipper 0.10）。**採用しない**。
  - `xlsx`（SheetJS）0.18.5: 2022-03-24 公開。ReDoS と prototype pollution の advisory に npm 上の修正版なし。**却下**。
  - `read-excel-file` 9.3.12: 2026-10-07 公開。repo 規則（24 時間）は満たすが、advisory の網羅性を確認できず、`.xls` は読めない。**採用しない**（ホスト解析をしないため不要）。
  - `csv-parse`: ホストでの解析は行わないため**不要**。
  - 結論: **ホストで解析しない**。ホストは拡張子、20 MB 上限、マジックバイトの検査だけを行い、生バイトをサンドボックスへ渡して pandas / openpyxl（`.xls` は xlrd）で解析する。
  - マジックバイト: xlsx / zip は `50 4B 03 04`、`.xls` は `D0 CF 11 E0 A1 B1 1A E1`、csv は NUL バイトなしかつ UTF-8 として妥当（UNVERIFIED、一般的な形式知識）。`.xlsx` と `.docx` は同じ PK ヘッダーを持つので、拡張子との一致を確認する。
  - E2B のプリインストール済みライブラリは未確認（UNVERIFIED）。テンプレートで用意するか、起動時に `pip install openpyxl xlrd` するかを spike で決める。
- **Evidence**: `registry.npmjs.org/<pkg>/latest`、`api.osv.dev`、`/tmp/sdd-003/research-data-ui.md` §1。

### I-7: グラフと表の描画（R8、Req 3.5）

- **Findings**（VERIFIED）:
  - `recharts` 3.10.1: 2026-07-25 公開、MIT、React 19 の peer に対応。推移依存を含めて 11。直接の advisory はなし。クライアント専用（`"use client"`）。
  - shadcn の `chart` は Recharts v3 の上に作られ、`pnpm dlx shadcn@latest add chart` でソースをコピーできる。テーマは `--chart-N` 変数、`accessibilityLayer` で a11y に対応。
  - 結論: 本マイルストーンでは**描画ライブラリを追加しない**（新規依存 0）。画像は `<img src="data:image/png;base64,...">`（`alt` 必須、サイズ上限）、表は素の `<table>`（`caption`、`th scope`、行数上限と「N 件中 M 件」表示）。
    サンドボックス由来の SVG / HTML は描画しない（`dangerouslySetInnerHTML` 禁止）。
  - 対話的グラフが必要になった時点で `recharts` を追加する（ADR-2）。
- **Evidence**: https://ui.shadcn.com/docs/components/chart、`/tmp/sdd-003/research-data-ui.md` §3。

### I-8: リポジトリの依存規約（憲章原則 7、10）

- **Findings**: `apps/web/package.json` は全依存を完全固定（`^` なし）。`pnpm-workspace.yaml` は `minimumReleaseAge: 1440`（**24 時間**の規則）、
  `allowBuilds` は `@biomejs/biome: false` のみ。新規依存は計画書に理由とともに宣言する（憲章原則 10）。
- **Evidence**: `apps/web/package.json`、`pnpm-workspace.yaml`。

### I-9: MCP クライアント（R2、Req 1.7、1.8、1.10）

- **Findings**（`/tmp/sdd-003/research-mcp-sandbox.md` §1。Context7 `/vercel/ai` と raw ソースで確認）:
  - `@ai-sdk/mcp` の最新 2.0.77 は 2026-10-15T18:10Z 公開で、repo 規則（24 時間）に抵触する。**2.0.76（2026-10-15T03:22Z 公開）を採る**。
  - peerDependencies は `zod ^3.25.76 || ^4.1.8` のみ。`ai` の peer はない。provider 4.0.28 と provider-utils 5.0.61 は `ai` 7.0.142 と同じ世代（`ai` 7.0.137 の依存は未取得、UNVERIFIED）。
  - stdio は `Experimental_StdioMCPTransport`（`@ai-sdk/mcp/mcp-stdio`）。プロセスは `@ai-sdk/mcp` の内部（cross-spawn）が起動する。**本リポジトリのコードは `child_process` を import しない**。
  - `client.tools({ schemas })` は**許可リスト**として働く。`schemas` に名前のないツールは読み込まれない（ソース確認）。既定の `'automatic'` は全ツールを読むので使わない。
  - 注釈（`readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint`）は `tool.metadata.annotations` に載る。サーバー提供のヒントで、信頼境界の外（ADR-7）。
  - 注釈なしのツールの扱いは SDK の既定では決まらない。本計画で `destructive` と解釈する（004 Req 4.14）。
  - `isError` の結果は例外ではなく戻り値として返る。接続断は保留中の呼び出しを `MCPClientError("Connection closed")` で拒否する。`close()` は冪等。
  - **UNVERIFIED**: `ToolLoopAgent({ tools })` に MCP ツールを渡せるか（ドキュメントは `generateText` / `streamText` のみ）。spike S-2 で確認する。
  - **UNVERIFIED**: `Experimental_StdioMCPTransport` の `env` / `cwd` オプション（型定義を確認する）。
- **Evidence**: `registry.npmjs.org/@ai-sdk/mcp/latest`、`npm view @ai-sdk/mcp time --json`、https://raw.githubusercontent.com/vercel/ai/main/content/docs/03-ai-sdk-core/16-mcp-tools.mdx。

### I-10: MCP サーバー SDK（R3、Req 1.7）

- **Findings**（VERIFIED）:
  - `@modelcontextprotocol/server` 2.3.1: 2026-10-05 公開、Apache-2.0、依存は `zod ^4.2.0` と `@modelcontextprotocol/core` のみ。README で「安定版の系列」とされる。stdio は `@modelcontextprotocol/server/stdio`。
  - `@modelcontextprotocol/sdk` 1.32.1（v1）: 2026-10-05 公開、依存が重い（express、hono など）。**採用しない**。
  - **UNVERIFIED**: v2 の `registerTool` が `annotations` を受けるか（型定義を確認する。spike S-3）。受けない場合は `tools/list` の応答を直接組み立てる。
- **Evidence**: `npm view @modelcontextprotocol/server time --json`、https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/main/README.md。

### I-11: サンドボックス（R1、R4、R5、C1、Req 3.7、3.8）

- **Findings**（VERIFIED、ただし記載の箇所は除く）:
  - E2B: `@e2b/code-interpreter` 2.9.0（2026-10-13 公開、MIT、依存 `e2b ^2.56.0`、Node 22.19 以上）。鍵は `E2B_API_KEY`。
    `Sandbox.create({ apiKey, timeoutMs })`、既定 5 分（Hobby 上限 1 時間）、`setTimeout`、`kill()`、`isRunning()`。
    `runCode(code, { onStdout, onStderr, timeoutMs, requestTimeoutMs })`。結果は `execution.results[]`（`png` は base64、`text` / `json` / `chart`）、`execution.logs`、`execution.error`（`name` / `value` / `traceback`）。
    ファイルは `sbx.files.write(path, buffer)`。
    **UNVERIFIED**: `onResult` と `envs` の名前、`logs` の配列型、期限切れの専用エラー型、プリインストール済みライブラリ。spike S-4 で確認する。
  - ローカルコンテナ（Docker Engine API）: `dockerode` は**採用しない**。`node:http` の `socketPath` で Unix ソケットに直接接続すると、依存ゼロで済む。
    `NetworkMode: "none"`、`Memory`、`NanoCpus`、`ReadonlyRootfs`、`PidsLimit`、`CapDrop`、`SecurityOpt` は Engine API の仕様で確認（swagger）。
    出力は多重化ストリーム（8 バイトのヘッダー `[type,0,0,0,size(u32 BE)]`、1 = stdout、2 = stderr）。
    **UNVERIFIED**: 起動後の `PUT /containers/{id}/archive` による入力転送（ReadonlyRootfs と Tmpfs の組み合わせ）、macOS の既定ソケットパス（`~/.docker/run/docker.sock` は未確認、`DOCKER_HOST` を優先する）。spike S-5 で確認する。
  - R1（`no-dynamic-eval` と stdio MCP）の解消: 本コードは `child_process` を import しない。stdio MCP の起動は `@ai-sdk/mcp` の内部が行い、起動するのは本リポジトリの信頼できるサーバー（固定コマンド）だけ。
    サンドボックスは E2B の SDK か `node:http` で扱う。したがって**規則の例外は不要**（ADR-4）。
- **Evidence**: `registry.npmjs.org/@e2b/code-interpreter/latest`、https://docs.e2b.dev/faq/sandbox-lifetime、https://docs.e2b.dev/quickstart/upload-download-files、
  `https://raw.githubusercontent.com/moby/moby/master/api/swagger.yaml`、https://docs.docker.com/desktop/setup/install/mac-install/（ソケットの説明）。

### I-12: 依存のリリース年齢（憲章原則 7）

- **Findings**（`npm view <pkg> time --json`、2026-10-16 11:55Z 時点）:
  | パッケージ | 採用版 | 公開時刻 | 経過 | 判定 |
  |---|---|---|---|---|
  | `@ai-sdk/mcp` | 2.0.76 | 2026-10-15 03:22Z | 約 32 時間 | ✅（2.0.77 は約 18 時間で ❌） |
  | `@modelcontextprotocol/server` | 2.3.1 | 2026-10-05 11:52Z | 11 日 | ✅ |
  | `@e2b/code-interpreter` | 2.9.0 | 2026-10-13 15:03Z | 3 日 | ✅ |
  | `fast-xml-parser` | 5.11.2 | 2026-09-29 04:45Z | 17 日 | ✅ |
  | `undici` | 8.12.2 | 2026-10-15 15:05Z | 約 21 時間 | ❌（本計画では不使用） |
- **Evidence**: `npm view <pkg> time --json`。

## Existing patterns to reuse

| Pattern | Location | Why reuse |
|---------|----------|-----------|
| `defineAciTool` + 必須 `risk` | `packages/ai-core/src/aci/define-tool.ts` | 全ツールの統一入口。MCP 由来のツールも `risk` を付けて同じ型に変換する（C3） |
| `buildToolSet` / `GuardedToolSet` / `assertRegistrable` | `packages/ai-core/src/aci/tool-set.ts` | 非 read-only の登録を型と実行時の両方で拒否する（Req 1.17） |
| `createGuardedAgent`（唯一の `ToolLoopAgent` 生成点） | `packages/ai-core/src/agents/guarded-agent.ts` | 3 停止条件、停止理由、観測を再利用する |
| `RunObserver` | `packages/ai-core/src/agents/guarded-agent.ts` | トレース、トークン内訳（C9）、Agent Inspector の記録に使う |
| `STOP_REASONS` / `deriveStopReason` | `packages/ai-core/src/agents/stop-reason.ts` | 停止理由の閉じた語彙。`error` は致命的エラーのラッチ経路で到達する（ADR-5） |
| `RoleCooperation` | `packages/ai-core/src/patterns/role-based-cooperation.ts` | マーケティングの合議の基礎（`agents/` を import できる唯一のパターン） |
| `generateValidated` | `packages/ai-core/src/structured/` | 実行計画、Replanner、ペルソナ、判定の構造化出力と再生成 |
| `HttpFetcher` | `packages/ai-core/src/ports/http.ts` | arXiv 取得。テストは fixture で差し替える |
| `Clock` / `FakeClock` | `packages/ai-core/src/ports/clock.ts` | 3 秒間隔制限、サンドボックスのアイドル判定 |
| drizzle + PGlite / Postgres | `packages/ai-core/src/rag/db/schema.ts`、`drizzle/` | チケットの永続化（R10）。マイグレーションは手書き SQL |
| `loadPlatformConfig` / `envSchema` | `packages/ai-core/src/config/env-schema.ts` | 新しい鍵と設定値を同じ方式で追加する |
| `FEATURE_REQUIREMENTS` | `packages/ai-core/src/config/feature-requirements.ts` | 新機能の必要条件（鍵、モード、コンテナ）を宣言する |
| mock fixture（scenarios / cassettes / http） | `packages/ai-core/fixtures/` | 外部サービスの応答をテストで固定する |
| `scripts/check-repo-rules.mjs` | `scripts/` | 規約の機械検査。新規則を追加する（ADR-4、ADR-7） |

## External dependencies

| Dependency | Version | Purpose | Verified |
|------------|---------|---------|----------|
| `@ai-sdk/mcp` | 2.0.76 | MCP クライアント（許可リスト、stdio、HTTP） | ✅ レジストリ・ソース。⚠️ `ToolLoopAgent` 連携は spike S-2 |
| `@modelcontextprotocol/server` | 2.3.1 | 自作のファイル操作 MCP サーバー（Req 1.7） | ✅ レジストリ。⚠️ `annotations` は spike S-3 |
| `@e2b/code-interpreter` | 2.9.0 | E2B サンドボックス（Req 3.1、3.8） | ✅ レジストリ・docs。⚠️ 型と期限切れエラーは spike S-4 |
| `fast-xml-parser` | 5.11.2 | arXiv Atom の解析（Req 4.3） | ✅ レジストリ・OSV（2 件の修正版を確認） |
| `recharts` | 3.10.1 | **本マイルストーンでは採用しない**（ADR-2） | — |
| `dockerode` | 5.0.1 | **採用しない**（`node:http` の socketPath で代替、ADR-4） | — |
| `exceljs` / `xlsx` / `read-excel-file` / `csv-parse` | — | **採用しない**（ADR-1） | ✅ レジストリ・OSV |
| Docker Engine API | v1.47 | ローカルコンテナ（Req 3.8） | ✅ swagger。⚠️ 入力転送は spike S-5 |

## Architecture decisions

### ADR-1: 解析はホストで行わず、サンドボックスで行う（R6、Req 3.1、3.2、3.9）

- **Context**: CSV / Excel は zip と XML を含み、展開攻撃、ReDoS、prototype pollution の影響を受ける。ホストは長寿命のサーバーである。
  LLM が生成したコードを実行する場所はホストにできない（憲章原則 6）。
- **Decision**: ホストは拡張子、20 MB 上限、マジックバイトの検査だけを行い、生バイトをサンドボックスへ渡す。解析は pandas / openpyxl（`.xls` は xlrd）で行う。
  ホスト側のプレビューは行わず、プレビューもサンドボックスが返す。
- **Alternatives**: `exceljs`（保守停止）、`xlsx`（修正版なしの advisory）、`read-excel-file`（advisory 未確認）、`csv-parse`（ホストで解析する理由がなくなる）。
- **Consequences**: サンドボックスの可用性に依存する。E2B のプリインストール済みライブラリは未確認（S-4）。

### ADR-2: グラフは画像、表は HTML の `<table>` で描画する（R8、Req 3.5）

- **Context**: コア機能はグラフの対話操作を要求していない。描画ライブラリは依存を増やし、クライアントの負荷も上げる。
- **Decision**: サンドボックスの PNG を `<img>` で表示する（`alt` 必須、サイズ上限、PNG マジックバイトの検査）。表は素の `<table>` で描画する。SVG と HTML は描画しない。
- **Alternatives**: `recharts`（依存 1 と推移依存 11）、`chart.js`（Canvas で a11y と SSR に不利）。
- **Consequences**: ホバーや凡例の切り替えはできない。必要になった時点で `recharts` を追加する。

### ADR-3: arXiv は `HttpFetcher` と `fast-xml-parser` で取得・解析する（R7、Req 4.3、4.7）

- **Context**: arXiv ToU は 3 秒 1 リクエストと単一接続を求め、制限は利用者の全マシンに跨る。
- **Decision**: ai-core に直列キュー（3 秒間隔）と日単位のキャッシュを置く。プロセス内の制限は複数インスタンスでは守れないため、
  本番の境界として 005 の「本番実装との境界」に従い、計画書で明記する。解析は `fast-xml-parser` 5.11.2（`processEntities` 無効、`isArray` 指定）。
- **Alternatives**: 手書きの正規表現（ネストした tag、CDATA、複数行の summary に弱い）。OAI-PMH（一括取得向け、本マイルストーンの範囲外）。
- **Consequences**: 検索の遅延が最大で数秒増える。テストは fixture で固定し、ネットワークを使わない。

### ADR-4: `no-dynamic-eval` の例外を作らない（R1、C1、R5）

- **Context**: `scripts/check-repo-rules.mjs` は `child_process` の import を全ワークスペースで禁じる。サンドボックスと stdio MCP はプロセス起動を要するように見える。
- **Decision**: 本リポジトリのコードは `child_process` を import しない。
  1. stdio MCP は `@ai-sdk/mcp` の `Experimental_StdioMCPTransport` に固定コマンドを渡し、起動は SDK 内部が行う（起動対象は本リポジトリのファイル操作サーバーだけ）。
  2. E2B は SDK の HTTP で扱う。
  3. ローカルコンテナは Docker Engine API を `node:http` の `socketPath` で叩く。`dockerode` は使わない（依存と監査面を増やさないため）。
  規則の例外は作らないため、`no-dynamic-eval` は変更しない。
- **Alternatives**: allow-list の例外（規則の穴になる）、`dockerode`（推移依存が大きい）、`undici` の socket（新規依存、24 時間規則に抵触する版がある）。
- **Consequences**: 入力転送と多重化ストリームの処理を自前で書く。Docker の動作は spike S-5 で実機確認する。

### ADR-5: 致命的ツールエラーは Run 単位のラッチで伝え、停止理由 `error` にする（C2、Req 1.3）

- **Context**: 現在の `executeWithGuards` は全失敗を `recoverable` に変換するため、致命的エラーで Run を止められない。
  AI SDK 7.0.137 はツールが投げた例外を `tool-error` 出力に変換してループを続けるので、例外の再送出では止まらない（I-1）。
- **Decision**: `FatalToolError`（学習者に見せてよい短い文言だけを持つ）と、Run 単位の `FatalLatch`（最初の致命的エラーを 1 件だけ保持する）を導入する。
  `createGuardedAgent` が Run ごとに `FatalLatch` を作って `ToolRuntime` 経由でツールラッパーへ渡す。`executeWithGuards` は `FatalToolError` を捕まえて
  ラッチに記録し、内部の `AbortController` を abort して以降のステップを止め、モデルには安全な短い文言だけを `tool-error` として返す。
  `finalise` はラッチを先に調べる。ラッチが立っていれば abort の種別にかかわらず `errored = true` とし、停止理由は既存の `deriveStopReason` で `error` になる
  （呼び出し元の abort とタイムアウトの abort は従来どおり区別する）。停止理由の閉じた語彙は変えない。`ToolFailureKind` の `fatal` は戻り値として使わない。
- **Alternatives**: `ToolOutcome` に `fatal` を載せて `ToolLoopAgent` の `stopWhen` で止める（ツール単位の判断を停止条件に載せると責務が混ざるため、第一案にしない）。
  ただし、**`stopWhen` が Run 単位の `FatalLatch` の状態だけを読む条件**は、ツールの結果ではなく Run の状態を読むので責務は混ざらない。これを S-1 の退き方とする（下記）。
  例外の再送出（SDK が握りつぶすため不成立）。
- **Consequences**: `ToolRuntime` と `createGuardedAgent` の両方に小さな変更が入る（後方互換。ラッチがなければ従来どおり）。内部 abort が `abortCause()` の
  `caller` に誤分類されないよう、ラッチの判定を `finalise` の先頭に置く。
- **Verification**: 既存の `guarded-agent` テストに、致命的エラーで停止理由 `error` になるケース、呼び出し元の abort と競合したケース、
  ラッチ後に追加のツール呼び出しが起きないケースを足す（テストファースト）。spike S-1 は、この out-of-band 経路が実際の SDK で次のステップを止めることの確認に使う。
  **S-1 が失敗した場合**: ラッチの状態だけを読む停止条件（`latchTripped`）を `createStopConditionRecord` に加える。それでも止まらなければ `generateText` のツールループへ切り替え、本 ADR を改める。**S-1 の結果を research.md に追記するまで、C2 の実装タスクに着手しない。**

### ADR-6: サンドボックスは提供者を起動時に選び、アイドルは Clock で数える（R10 系、Req 3.7、3.8）

- **Context**: E2B のキーがあれば E2B、なければローカルコンテナ、どちらもなければ分析エージェントを無効にする（Req 3.8）。学習者が離れた時に破棄する必要がある（Req 3.7）。
- **Decision**: `ports/sandbox` に `SandboxProvider` を定義し、E2B 実装、Docker 実装、`mock` の疑似実装を置く。選択は `lib/server/platform.ts` の 1 か所で行う。
  セッションのアイドル判定は `Clock` を使う `sandbox/lifecycle.ts` が担い、既定 10 分で破棄する。E2B 側の寿命（`timeoutMs`）は、アイドルの 3 倍（既定 30 分）の安全網とする（実装は `lifetimeMs ?? idleTimeoutMs * 3`。当初は「15 分」と書いたが、2026-10-29 に実装に合わせて直した。W8 レビュー）。
- **Alternatives**: E2B の寿命だけに任せる（クライアント切断を検知できない）。
- **Consequences**: 接続断の検知は Route Handler の `request.signal` に依存する。

### ADR-7: MCP ツールのリスク区分は注釈から決め、注釈がなければ `destructive` とする（C3、Req 1.8、1.16、1.17）

- **Context**: MCP ツールは `defineAciTool` を通らず、注釈はサーバーが提供する信頼できないヒントである。
- **Decision**: `mcp/` のアダプターは `readOnlyHint === true` のものを `read-only`、`destructiveHint === true` または注釈なしのものを `destructive` とする。
  `destructive` と `write` は登録しない（`buildToolSet` が拒否する）。許可リストは `schemas` に載せたツールだけにする。
  `check-repo-rules` に「`@ai-sdk/mcp` を `mcp/` と `ports/` 以外から import しない」規則を追加する。
- **Alternatives**: 注釈を信じずにすべて `read-only` とする（不採用、安全側に倒れない）。
- **Consequences**: GitHub の書き込み系ツール（issue 作成など）は M3 では使えない。

### ADR-8: 階層型リサーチは Agent-as-a-Tool の単一プロセスとし、サブエージェントの呼び出し数に上限を設ける（Req 4.1、4.4、4.8）

- **Context**: 階層化は token 量を増やす。憲章は多エージェントに正当化の記録を求める（原則 1）。
- **Decision**: `research/supervisor.ts` が `createGuardedAgent` で Supervisor を作り、3 つのサブエージェントを入力スキーマ付きのツールとして渡す。
  サブエージェントは要約だけを返す（Req 4.4）。呼び出し数は実行ごとのカウンタで上限を設ける（Req 4.8）。
  トークンは `agents/token-ledger.ts`（`RunObserver`）で役割別に集計する（C9、Req 4.10）。
  多エージェントを採る理由: 検索、精読、市場評価の観点を分けて、各サブエージェントの文脈を小さく保つため。トークン増加は 4.10 の内訳で示す。
- **Alternatives**: 単一エージェントに 3 つのツールを持たせる（文脈が膨らむ）、ワークフロー（観点の順序が固定されず、Supervisor の判断を学ぶ目的に合わない）。
- **Consequences**: 共有トークン予算（002 CL-8）は、Run 全体の上限を Supervisor が子に分配する形で実装する（❓ 下記）。

### ADR-9: 要件定義書とヘルプデスクの計画はワークフロー、個別の判断は構造化出力とする（憲章原則 1、Req 2、5）

- **Context**: 計画の作成、実行、Replanner の判断は手順が固定されている。ツールを選んで行動するのではない。
- **Decision**: ヘルプデスクの計画と Replanner は `generateValidated` で構造化出力を得て、実行は依存順の純粋なスケジューラが行う。
  各タスクの実行だけを `createGuardedAgent`（ツールを使うため）で行う。要件のインタビューは固定の往復を行うワークフロー（`requirements/interview.ts`）とする。
- **Alternatives**: 計画全体を 1 つの `ToolLoopAgent` にする（計画の不正検査と再生成の上限が Run の停止条件と混ざる）。
- **Consequences**: `workflow-no-agent-loop` 規則（`workflows/` が `ToolLoopAgent` を import しない）に従うため、ワークフローに置くのは計画と判断の構造化呼び出しだけになる。

### ADR-10: チケットの永続化は既存の rag の drizzle 基盤を使う（R10、Req 2.6、2.7）

- **Context**: チケットの状態と最終回答を保存する必要がある。承認待ちの永続化と再開は 005 の範囲外。
- **Decision**: `packages/ai-core/src/rag/db/schema.ts`（CL-23 の配置）に `helpdesk_tickets` と `helpdesk_plan_revisions` を定義し、手書き SQL のマイグレーションを `drizzle/0002_helpdesk.sql` に置く。
  テストは PGlite（`*.db.test.ts`）、hands-on は Postgres。ナレッジ（FAQ・手順書）は既存の `rag` の取り込みを使う（Req 2.9）。
- **Alternatives**: 新しい DB（ワークスペースを増やす）、ブラウザのストレージ（学習者の再読込みで消え、Req 2.6 を満たせない）。
- **Consequences**: 単一の学習者を前提とし、認証と行の共有は扱わない（005 Req 1.3）。

## Risks & open questions

- ⚠️ `ToolLoopAgent` に MCP ツールを渡せるか未確認（I-9）— mitigation: spike S-2 で確認し、失敗時は `generateText` のツールループへ切り替える。
- ⚠️ `registerTool` の `annotations` が v2 にあるか未確認（I-10）— mitigation: spike S-3。なければ `tools/list` を直接組み立てる。
- ⚠️ AI SDK はツールの例外を `tool-error` に変換して続行する（ADR-5、確認済み）— mitigation: 例外ではなく Run 単位のラッチと内部 abort で止める。ラッチ後にループが確実に止まることは spike S-1 で確認する。
- ⚠️ Docker の入力転送（ReadonlyRootfs と Tmpfs）と多重化ストリームは未確認（I-11）— mitigation: spike S-5。失敗時はローカルコンテナを必須にせず、Req 3.8 の無効化経路へ落とす。
- ⚠️ E2B の型（`onResult`、`logs`）と期限切れエラーが未確認（I-11）— mitigation: spike S-4。
- ⚠️ arXiv の複数件・0 件・HTTP 400 の実応答が未確認（I-5）。429 / 503 / `Retry-After` / 301 は 2026-10-19 に実測した — mitigation: 指数待機は実装済みで、実測の本文を `parse.test.ts` で固定した。
- ⚠️ MCP の注釈はサーバーが提供する信頼できないヒント（ADR-7）— mitigation: 注釈がない、または `destructive` のものは登録しない。
- ⚠️ arXiv のレート制限が複数インスタンスで跨る（I-5）— mitigation: 本番の境界に明記する（005）。
- ❓ 致命的エラーの分類（Req 1.3 の「許可されない操作」）と、パス検査（Req 1.5）の拒否の扱い。Req 1.5 は「エラーを返す」と書くため回復可能として扱うが、Req 1.3 との整合は人が確認する — to resolve in: 人の確認（CL）。
- ❓ E2B の `result.chart` の形式と `results[].png` の有無 — to resolve in: spike S-4。
- ❓ 共有トークン予算（002 CL-8）を Supervisor の子エージェントへ分配する方式 — to resolve in: Plan（ADR-8 の詳細）。
- ❓ チケットの永続化を M3 でどこまで行うか（Req 2.6 / 2.7）— to resolve in: 人の確認（CL）。
- ❓ 専用のテストサフィックス（`*.sandbox.test.ts`、`mise run test:sandbox`）を追加するか — to resolve in: 人の確認（CL）。

## Spike items (before W1)

| ID | Question | Method | Blocks |
|----|----------|--------|--------|
| S-1 | ツール内でラッチを立てて内部 abort した後、`ToolLoopAgent` が次のステップへ進まず、`finalise` が `error` を返すか（`generate` と `stream` の両方） | 最小のツールと mock モデルで確認 | ADR-5、C2 |
| S-2 | `ToolLoopAgent({ tools })` に `client.tools({ schemas })` の結果を渡せるか | `@ai-sdk/mcp` 2.0.76 で最小の stdio サーバーを接続 | C3、Req 1.8 |
| S-3 | `@modelcontextprotocol/server` 2.3.1 の `registerTool` が `annotations` を受けるか | `.d.ts` の確認 | Req 1.16 |
| S-4 | E2B の `runCode` の型、`onResult`、`logs`、期限切れ、プリインストール | 型定義の確認と実機の 1 回の実行（hands-on の鍵） | Req 3.1、3.5 |
| S-5 | Docker の create / archive / exec / logs の流れと macOS のソケットパス | 実機の Docker Desktop で `node:http` から確認 | Req 3.8 |
| S-6 | GitHub の公式ホスト型 MCP のエンドポイントと、各ツールの `readOnlyHint` 注釈の有無（読み取り専用の許可リストに載せられるツール） | `GITHUB_TOKEN` で `@ai-sdk/mcp` の HTTP トランスポートから `tools/list` を 1 回呼ぶ（hands-on の鍵） | Req 1.9、1.16 |

## ツールチェーンの版の更新（2026-10-18、憲章 原則 8）

M3 の着手前に、Node.js と pnpm を M3 着手時点の最新安定版へ上げた。版の方針は M1 と同じで、下限指定ではなく、実装時点の最新安定版を完全一致で固定する（`docs/modules/1-1-dev-environment.md` の「版の方針」）。

| ツール | 旧 | 新 | 公開日（UTC） | 根拠 |
|---|---|---|---|---|
| Node.js | 26.10.0 | 26.12.0 | 2026-10-14 | `https://nodejs.org/dist/index.json`。26.11.0（2026-10-07）と 26.12.0 は、どちらも `security: false`（セキュリティ修正の版ではない）。公開から 24 時間以上たっている |
| pnpm | 12.6.0 | 12.13.0 | 2026-10-13T08:26:30Z | `pnpm view pnpm@12.13.0 time`。公開から 24 時間以上たっている |

- **揃えた箇所**: `mise.toml` の `[tools]`、ルートの `package.json` の `packageManager`（`pnpm@12.13.0`）と `engines`、`AGENTS.md`。pnpm 12 は `packageManager` の版に切り替えて動くため、`mise.toml` だけを上げると `mise exec -- pnpm --version` は 12.6.0 のままになることを実測で確かめた（揃えた後は 12.13.0）。
- **lockfile**: `pnpm install` で変わったのは、`pnpm-lock.yaml` の先頭の文書の `packageManagerDependencies`（`pnpm` と `@pnpm/exe.*` が 12.6.0 から 12.13.0 に変わった）だけである。通常の依存の解決は変わっていない。`pnpm install --frozen-lockfile` は成功した。
- **TypeScript 6.x への後退**: 無い。
- **検証**（2026-10-18、Node 26.12.0 / pnpm 12.13.0）: `pnpm install --frozen-lockfile` が成功した。`mise run gate` が終了コード 0 で成功し、所要時間は 40.9 秒（`real`）だった。テストの件数は、ルート 352 件（失敗 0、うち 1 件は意図した失敗のテスト）、`@platform/ai-core` 1,732 件（スキップ 4 件）、`@platform/eval-suite` 7 件（スキップ 8 件。`local` 専用のテスト）、`web` 733 件で、`docs:check` は 8 文書・110 件のテスト参照を確かめた。CI の `ci-status` と `test:e2e`（3 エンジン）は、この記録の時点では未実行である。

## spike の実測（W1）

実験のコードはスクラッチパッドに置き、リポジトリへはコミットしていない（結果を固定するテストは tasks 3.3 と 8.4 が持つ）。環境は Node 26.12.0、`ai` 7.0.137、`zod` 4.6.5、`MockLanguageModelV4`（`ai/test`）。

### S-1: ラッチによる停止と停止理由（2026-10-18、実測）

**実験の手順**: 1 ステップに 2 回のツール呼び出しを返す mock モデルと、実行されると「ラッチを立てる（`latch.error` に値を入れる）」ツールを用意し、`ToolLoopAgent` を `generate` と `stream` で動かした。モデルは毎ステップ同じ呼び出しを返し続けるので、止まらなければ `isStepCount(10)` まで進む。止め方を 3 通り比べた: (a) ラッチを立てると同時に内部の `AbortController` を abort する（`abortSignal` を `generate` / `stream` に渡す）、(b) `stopWhen` に「ラッチが立っているか」だけを読む条件を足す、(c) 両方。

| 止め方 | `generate` | `stream`（`fullStream`） | UI ストリーム（`createAgentUIStream`） |
|---|---|---|---|
| (a) abort のみ | 拒否される（`Error: fatal-latch`、abort の理由）。モデル呼び出し 1 回、ツール実行 2 回 | `abort` パートで終わる。`finish` も `onEnd` も `onError` も呼ばれない。ツールの結果パートが出ない | チャンクは `abort` で終わり、`finish` が無い。`messageMetadata` は `part.type === "abort"` で呼ばれるが、`finish` ではないので `run` を載せられない |
| (b) `stopWhen` のみ | 正常に解決する（`steps` 1、`finishReason` は `tool-calls`）。モデル呼び出し 1 回 | `finish-step` → `finish` で正常に終わり、`onEnd` が 1 回呼ばれる。モデル呼び出し 1 回 | `tool-output-available` → `finish-step` → `finish` で終わる。`messageMetadata` が `finish` で呼ばれる。モデル呼び出し 1 回 |
| (c) 両方 | (a) と同じ（abort が先に効いて拒否される） | (a) と同じ | — |

- **同じステップの残りのツールは止まらない**: どの方法でも、同じステップに 2 件あったツール呼び出しは 2 件とも実行された（`toolExecutions=2`）。ラッチが立った後の実行を止めるのは `buildToolSet` の配線（task 3.2）であり、AI SDK のループではない。3.2 のテストが「ラッチ後は本体が呼ばれない」を実行回数で固定する。
- **結論**: `ToolLoopAgent` は、ラッチ + 内部 abort でも止まる（次のステップへ進まない）が、`stream` と UI ストリームでは `abort` で終わり、`finish` と `onEnd` が来ない。学習者向けの文言を `finish` の `messageMetadata`（`run` サマリ）に載せる M1 の経路が使えなくなる。`generate` は拒否されるため、呼び出し側が `error` の分類を別に持つ必要が出る。
- **採用する退き方**: plan の退き方（S-1 の行）のとおり、**`stopWhen` に `FatalLatch` の状態だけを読む条件を加える**。内部 `AbortController` の abort はラッチでは行わない（abort は呼び出し元の signal と `maxDurationMs` のタイムアウトだけが起こす）。`generateText` のツールループへ切り替える必要はない（ADR-5 は改めない）。これにより `generate` / `stream` / UI ストリームのいずれも正常終了の経路（`onEnd`、`finish`）を通り、`finalise` の先頭でラッチを判定して停止理由 `error` を返せる。
  - `finalise` の判定順は「ラッチ → 呼び出し元 / タイムアウトの abort → 一般のエラー → 停止条件」とする（ラッチが立っていれば、直後に abort が重なっても `error`）。
  - ラッチの条件は `stopWhen` の配列の末尾に足す。ステップ数・トークン・時間の停止条件の記録（`createRunStopConditions` の `record`）には混ぜない（責務を分ける）。
  - 3.3 のテストは、`generate` と `stream` の両方で、ラッチが立ったステップの次にモデルが呼ばれないこと（モデル呼び出し回数）と、停止理由が `error` であることを固定する。

### CL-2: 入力検証の失敗の文言（2026-10-18、実測）

- **既定の挙動**: 入力が Zod スキーマに違反すると、AI SDK は `tool-error` を返し、モデルには `AI_InvalidToolInputError: Invalid input for tool <name>: AI_TypeValidationError: Type validation failed: Value: {...}. Error message: [ { "expected": "number", "code": "invalid_type", "path": ["count"], "message": "Invalid input: expected number, received string" } ]` の形（`output.type === "error-text"`）で見える。Zod の違反一覧の JSON がそのまま入り、期待する型と例が分かりにくい。
- **差し替えの経路（可）**: ツールの `inputSchema` を `jsonSchema(z.toJSONSchema(schema), { validate })` で包み、`validate` が失敗時に `{ success: false, error: new Error(<修正ガイド>) }` を返すと、モデルに見える文言は `AI_InvalidToolInputError: Invalid input for tool <name>: AI_TypeValidationError: Type validation failed: Value: {...}. Error message: Error: <修正ガイド>` になる。つまり、修正ガイドの全文はモデルに届くが、`Invalid input for tool …` の前置きと入力値の再掲は AI SDK が付けるため消せない。実験は 2 ステップ（`isStepCount(2)`）で、各ステップが `tool-error` を 1 件返した（計 2 件）。
- **採用**: CL-2 は「可」。`aci/input-guide.ts` の `formatInputGuide` が修正ガイドを作り、`define-tool.ts`（task 4.7）が `inputSchema` を上記の `jsonSchema` + `validate` で包む。前置きが残ることを `define-tool.test.ts` で固定する（修正ガイドが含まれること）。AI SDK が付ける前置きを完全に消す経路（`experimental_repairToolCall` で `null` を返すなど）は採らない。入力値の再掲に秘密が入る可能性は、ツールの入力が学習者のデータであることから許容する（ログには出さない、`tech.md` の Logging の規約）。
- **JSON Schema 化の注意**: `z.toJSONSchema` は M1 の `inputSchema`（Zod）の全フィールドの `.describe()` を `description` に写す。task 4.7 のテストで、描画された JSON Schema にフィールド説明が残ることを確かめる。

### S-6: GitHub の公式ホスト型 MCP（2026-10-18、未実測。文書による）

- **実測の状態**: `GITHUB_TOKEN` が無い環境のため、`tools/list` を呼べていない。以下は公式の文書（`github/github-mcp-server` の `docs/remote-server.md` と `README.md`）の記述で、ハンズオンで確かめるまで確定しない。トークンの値はこの文書に書かない。
- **エンドポイント**: `https://api.githubcopilot.com/mcp/`（HTTP）。読み取り専用への絞り込みは、ヘッダ `X-MCP-Readonly`（空、`false`、`f`、`no`、`n`、`0`、`off` 以外は真）か、URL の末尾に `/readonly` を付ける方法が文書にある。認証ヘッダの形式は当該ページに書かれていない（`Authorization: Bearer <token>` を想定し、ハンズオンで確かめる）。
- **ツール名（README に見えた範囲）**: `issue_read`、`list_issues`（入力は `owner`、`repo`（必須）、`state`、`labels`、`perPage`、`after` など）、`search_issues`、`pull_request_read`、`list_pull_requests`、`search_pull_requests`、`get_file_contents`（`X-MCP-Tools` の例に出る）。書き込みのツール（`create_branch`、`create_or_update_file`、`issue_write`、`create_pull_request`、`merge_pull_request` など）も同じサーバーにある。`search_code`、`list_commits` の入力は見えなかった。
- **注釈**: `readOnlyHint` の記述は文書に見つからなかった。**注釈が無いツールは `destructive` として扱い登録しない**（ADR-7）ので、実機で注釈が付いていなければ、許可リストのツールは 0 件になる。
- **退き方（plan の記載どおり）**: 既定の許可リストは、文書にある読み取り専用のツール名 `get_file_contents`、`issue_read`、`list_issues`、`pull_request_read`、`search_issues` から始め、`McpServerConfig.descriptions` の上書き（CL-25）を CL-18 の形式で書く。入力スキーマは `list_issues` 以外が未確認のため、上書きの文言は `checkJsonSchemaDescription` を通る範囲（プロパティ名を説明文に含める）で書き、ハンズオンで入力名を確かめて直す。許可リストに載るツールが 0 件のとき、GitHub の接続は「接続できるが何も登録されない」ことを解説に書く。
- **許可リストに載せられる読み取り専用ツールの件数**: 未実測（候補 5 件。注釈が付いているかは未確認）。

### S-4: E2B のサンドボックス（2026-10-18、未実測。文書による）

- **実測の状態**: `E2B_API_KEY` が無い環境で、`@e2b/code-interpreter` はまだ入れていない（`pnpm install` が拒否された。1.2 を見る）。型定義は読めていない。以下は E2B の公式文書の記述で、偽 SDK の形（17.4）を決めるための仮の根拠である。W4 の 17.4 の前に、依存を入れたうえで `.d.ts` と突き合わせる。
- **`runCode`**: `runCode(code: string, opts?: RunCodeOpts): Promise<Execution>`。`RunCodeOpts` は `envs`、`onStdout` / `onStderr`（`OutputMessage`）、`onResult`（`Result`）、`onError`（`ExecutionError`）、`timeoutMs`（既定 60,000）、`requestTimeoutMs`（既定 30,000）、`language`、`context`。`Execution` の形（`logs.stdout`、`logs.stderr`、`error`、`results`）は、今回読んだページには無かった（未確認）。
- **作成と期限**: `Sandbox.create({ ... })` の `timeoutMs`、`apiKey` は未確認。期限切れ後の挙動（`isRunning` の戻り、実行時の例外の種類）は未確認。
- **事前投入のライブラリ**: 文書のページは一覧を動的に描画しており、`pandas`、`matplotlib`、`openpyxl` が入っているかは読めなかった。`e2b-dev/code-interpreter` の `template/requirements.txt` が一次情報。CL-19 のとおり、`show_figure` / `show_table` の補助関数はコードの先頭で投入するので、ライブラリが無い場合の `ImportError` は分析エージェントの修正ループが扱う。
- **外向き通信の既定（CL-21）**: 文書に「Every sandbox has outbound access to the internet by default.」とある。`Sandbox.create({ allowInternetAccess: false })`（Python は `allow_internet_access=False`）で無効にでき、これは `network.denyOut: ["0.0.0.0/0"]` と同じで、起動後は `updateNetwork` で切り替えられる。したがって **E2B の既定は外向き通信が可能**（文書による。実測は未）。CL-21 により、`tasks.md` の「004 への引き継ぎ事項」と解説の「確認できていないこと」に記録する。M3 は `runPython` を `read-only` のままにするが、17.4 で `allowInternetAccess: false` を既定にできるかを検討する（Docker の `NetworkMode: none` と揃う。ただし `pip install` などが必要な場合に使えなくなる）。

### S-5: Docker Engine API と画像の版（2026-10-18、未実測）

- **Docker**: この環境には Docker が無い（`docker info` が失敗し、`~/.docker/run/docker.sock` も `/var/run/docker.sock` も存在しない。`DOCKER_HOST` は未設定）。Engine API の流れ（create → archive で入力を配置 → start → wait → logs → delete）と macOS のソケットの探索は**未実測**である。Req 3.8 のとおり、コンテナ提供者を必須にせず、E2B の鍵もコンテナも無いときは分析エージェントを無効にして案内する経路へ落ちる前提で W4 を進める。実機での確認は 17.8、39.3（人が行う）に残る。
- **Python 側の版（CL-20、`pypi.org` の JSON より。公開日は実測、画像のビルドは未実施）**:

| パッケージ | 版 | 公開日（UTC） | `requires_python` |
|---|---|---|---|
| pandas | 3.0.6 | 2026-09-17 | >=3.11 |
| openpyxl | 3.1.5 | 2024-06-28 | >=3.8 |
| xlrd | 2.0.2 | 2025-06-14 | 古い Python も可（2.x は `.xls` のみ読める） |
| matplotlib | 3.11.2 | 2026-09-11 | >=3.11 |

  いずれも公開から 24 時間以上たっている（憲章 原則 7）。pandas と matplotlib が Python 3.11 以上を要するので、ベース画像は Python 3.11 以上にする。ベース画像のタグと、各パッケージの依存（numpy など）の固定は、Docker のある環境で `Dockerfile` をビルドする 17.8 で確定する（今は固定していない）。`.xls`（xlrd）は xlrd 2.x の制約により `.xlsx` を読めないので、`.xlsx` は openpyxl で読む。

## gate の所要時間

| 時点 | 結果 | 所要時間 | 備考 |
|---|---|---|---|
| W1（2026-10-18、依存 4 件の追加前） | `mise run gate` が終了コード 0（ルート 399、`@platform/ai-core` 1,884（スキップ 4）、`@platform/eval-suite` 7（スキップ 8）、`web` 733） | `real` 31.3 秒 | `env -u NODE_ENV`。5 分以内。`mise run test:mutation` は 86.71 点（閾値 70）、9 分 3 秒（gate の外）。依存 4 件の追加後に再実行して終了コード 0（件数は同じ）。`pnpm audit` は 0 件、`allowBuilds` の警告なし |
| W2（2026-10-18） | `mise run gate` が終了コード 0（ルート 410、`@platform/ai-core` 2,107（スキップ 4）、`@platform/eval-suite` 7（スキップ 8）、`web` 771、`Docs: 8 module documents, 110 test references verified`、`mcp-import-scope: scanned 426 FILES`） | `real` 約 37 秒 | `env -u NODE_ENV`。`GITHUB_TOKEN` なしで成功（`mock` は GitHub に接続しない）。`mise run test:mutation` は 86.71→86.61 点（閾値 70。`files/path.ts` 77.78、`mcp/risk.ts` 100） |
| W3（2026-10-18） | `mise run gate` が終了コード 0（ルート 412、`@platform/ai-core` 2,341（スキップ 4）、`web` 830） | `real` 41.0 秒 | `env -u NODE_ENV`。W2 の締めから約 +4 秒 |
| W4（2026-10-18） | `mise run gate` が終了コード 0（ルート 419（1 件は期待された失敗）、`@platform/ai-core` 2,778（スキップ 4）、`@platform/eval-suite` 7（スキップ 8）、`web` 959、`Docs: 8 module documents, 110 test references verified`、`sandbox-import-scope: scanned 511 FILES`、型検査の対象は ai-core 332・web 155 ファイル） | `real` 53.5 秒（レビューの修正後。修正前は 45.3 秒） | `env -u NODE_ENV`。W3 の締めから約 +4〜12 秒。Docker なし・鍵なしで成功し、`*.container.test.ts` は実行されない。`test:container`（実 Docker）は 17 件で約 20 秒（画像がある場合）。3 エンジンの E2E は 393 件で 1.8 分 |

### S-2・S-3: MCP クライアントと自作サーバー（2026-10-18、実測）

依存 4 件を入れた後（`@ai-sdk/mcp` 2.0.76、`@modelcontextprotocol/server` 2.3.1。`pnpm install` 成功、`pnpm audit` 0 件、`allowBuilds` の警告なし）、スクラッチパッドのスクリプトを一時的に `packages/ai-core/` に置いて実行し、削除した。

- **自作サーバーの起動（CL-3）**: TypeScript のサーバー（`McpServer` + `StdioServerTransport`（`@modelcontextprotocol/server/stdio`）、`registerTool` に Zod の `z.object` を渡す形）を、`Experimental_StdioMCPTransport`（`@ai-sdk/mcp/mcp-stdio`）の `command: process.execPath`、`args: ["./server.ts"]` で、`tsx` なしの Node 26.12 の型除去だけで起動できた。**CL-3 は可**。
- **`ToolLoopAgent` への受け渡し（S-2）**: `client.tools()` の戻り（`readFile` など）を `ToolLoopAgent` の `tools` に渡して、`generate` が 2 ステップで完了し、ツール結果が `{ content: [{type:"text", text}], isError: false }` で返った。`client.tools({ schemas })` の `schemas` 指定は、この実験では使っていない（`automatic`）。
- **エラーの伝達（CL-24）**: 失敗を `{ isError: true, content, structuredContent: {kind, code}, _meta: {"agentic-ai/error": {kind, code}} }` で返すと、クライアントの `execute` の戻りに `_meta`、`structuredContent`、`isError: true` がすべてそのまま届いた。`adaptMcpTool` で `tools/call` を自前で呼ぶ退き方は不要。
- **注釈（S-3）**: `registerTool` の `config.annotations`（`ToolAnnotations`）を受け、クライアントの `tools/list` に `readOnlyHint: true`、`destructiveHint: true` として載った。注釈の無いツールは `annotations` が無い。`client.tools()` の各ツールの `_meta` にも `annotations` が入る（`McpToolAnnotations`）。ADR-7 のとおり、注釈の無いツールは `destructive` として登録しない。
- **入力スキーマ**: Zod の `.describe()` は `tools/list` の `inputSchema.properties.<name>.description` に写った（`checkJsonSchemaDescription` の入力）。

### S-4（追記）: `@e2b/code-interpreter` 2.9.0 の型（`.d.ts` を読んだ。実機の実行は未）

- `Execution { results: Result[]; logs: { stdout: string[]; stderr: string[] }; error?: ExecutionError | undefined }`、`ExecutionError { name; value; traceback }`。`Sandbox.runCode(code, opts?)` の `RunCodeOpts` に `onStdout`、`onStderr`（`OutputMessage`）、`onResult`、`onError`、`timeoutMs`、`envs`、`language`、`context`。したがって偽 SDK の形は `runCode` → `{ logs: { stdout: string[], stderr: string[] }, error?: { name, value, traceback }, results: [] }` とし、ポートの `SandboxRunResult`（`stdout: string`、`stderr: string`、`error?: { name, message, traceback }`）へは `logs.stdout.join("")`、`value → message` で写す。
- `allowInternetAccess?: boolean` が `e2b` パッケージの型に存在する（作成時のオプション）。文書の「既定で外向き通信が可能」と一致する。実機で外向きの通信が通るかは未実測。

### 訂正（W1 のレビュー後、2026-10-18、追記）

- **CL-2 の実装**: 上の「CL-2」の節は `jsonSchema(z.toJSONSchema(schema), { validate })` と書いたが、採用した形は `jsonSchema(() => zodSchema(schema).jsonSchema, { validate })`（`ai` の `zodSchema`）である。生の `z.toJSONSchema` は `io: "input"`、`target: "draft-7"`、`additionalProperties` の補正を持たず、モデルに送る JSON Schema とカセットのキーが変わるため、AI SDK 自身の変換を使う。
- **S-1 の「同じステップの残りのツール」**: AI SDK のループは止めない。同じステップの呼び出しは同時に始まるため、`buildToolSet` は、ラッチがあるときだけツール呼び出しを 1 件ずつ実行し、ラッチが立った後に始まる呼び出しを拒否する（並行性を手放す）。2 件を同時に呼ぶテストが固定する。
- **説明文の変更とカセット**: 「カセットのキーが変わらない」は入力スキーマについてである。M1 の 6 ツールの説明文を CL-18 の形式に改めたため、ツールを含むリクエストのキーは変わる。既存のシナリオはキーを使わず述語で照合するので影響はなく、M1・M2 のカセットでツール定義を含むものは gate で全件通っている。

## W2 の実サーバー確認（R-1、2026-10-18、実測）

`mise` の Node 26.12、`next build`（Next.js 16.4.0、Turbopack）と `next start -p 3100`（`AI_RUN_MODE=mock`）で、`apps/web/e2e/real-server.spec.ts` の `mcp:` の 4 ケースを chromium で実行した（`pnpm --filter web exec playwright test e2e/real-server.spec.ts --project=chromium -g "mcp:"`、4 件成功）。確認した内容は次のとおり。

- **`serverExternalPackages` に足した集合は空**。`@ai-sdk/mcp` と `@modelcontextprotocol/server` は Turbopack のバンドルに入ったまま、ビルドと実行が通った。`/api/mcp/servers` は自作サーバー（`files`）を `connected` で返し、読み込んだツールは `findAndReadFiles` / `listFiles` / `readFile` / `searchFiles` の 4 つ、`writeFile`（`destructive`）は `registered: false`。`/api/mcp/chat` の mock 完走（`listFiles` → `readFile` の結果に `[0] README.md`）、許可ルート外の読み取りが停止理由 `error`（`code: "not-allowed"`）、`/api/mcp/compare`（手順数 2 対 3）も実サーバーで成功した。したがって足す理由のあるパッケージはなく、`next.config.ts` は変えていない（理由を書けない追加はしない）。
- **自作サーバーの子プロセス**: `process.execPath`（`next start` を動かしている Node 26.12）が、リポジトリの実ファイル `packages/ai-core/src/files/stdio.ts` を型除去で起動した。ファイルの場所は `platform.ts` が `DEFAULT_FIXTURE_DIRECTORY`（フィクスチャのディレクトリ）から導く。テスト終了後に `files/stdio.ts` のプロセスと 3100 番の待ち受けは残っていない（`ps`、`lsof` で確認）。
- **最初のビルドは失敗した**: `mcp/github.ts` の `fileURLToPath(new URL("../files/stdio.ts", import.meta.url))` を Turbopack が「ファイル資産の参照」として扱い、`Failed to collect configuration for /chat … The "path" argument must be of type string or an instance of URL. Received an instance of URL` で落ちた。M1 の `DEFAULT_FIXTURE_DIRECTORY`（`mock/fixtures.ts`）と同じ原因で、`resolve(dirname(fileURLToPath(import.meta.url)), "..", "files", "stdio.ts")` の形に直した。Vitest はバンドラーを通らないため、この失敗は単体テストでは検出できず、実サーバーのビルドだけが見つけた。
- **`.ts` 拡張子の import**: `files/operations.ts`・`server.ts`・`stdio.ts` は Node の型除去で起動するため `.ts` 拡張子付きの import を使う（`tsconfig.base.json` の `allowImportingTsExtensions`）。Turbopack は `@platform/ai-core/files`・`/mcp` 経由でこれらを読んでも問題なくビルドした。
- 未確認: `next dev`（Turbopack の開発モード）での同じ流れ、`GITHUB_TOKEN` を使う GitHub の接続（`mock` は接続しない設計。ハンズオンで確かめる、S-6）。

## W3 の gate 実測（16.2、2026-10-18）

`env -u NODE_ENV mise run gate`（`mise` の Node 26.12、Docker なし）: **exit 0、41.0 s（wall）**。W2 の締めの 37 s から **+約 4 s**。件数は次のとおり。

| 領域 | W2 の締め | W3 の締め | 差 |
|---|---|---|---|
| ルート | 410（1 expected fail を含む） | 412（411 passed + 1 expected fail） | +2（`check-repo-rules.test.mjs` の実ツリーの 2 件） |
| `@platform/ai-core` | 2,112（4 skipped） | 2,341（4 skipped、116 ファイル） | +229 |
| `@platform/eval-suite` | 7（8 skipped） | 7（8 skipped） | 0 |
| `web` | 771 | 830 | +59 |

- `Docs: 8 module documents, 110 test references verified`、`tool-risk-declared: scanned 277 FILES`、`workflow-no-agent-loop: scanned 37 FILES`（`planner.ts`・`replanner.ts`・`helpdesk.ts` を含む）、`TypeScript packages/ai-core/tsconfig.json: 287 files`、`apps/web/tsconfig.json: 145 files`。
- **`*.db.test.ts` による増分**: W3 が足した PGlite の DB テストは `schema.db.test.ts`（ヘルプデスクの表の 21 件）、`ticket-store.db.test.ts`（32）、`seed.db.test.ts`（13）と、実 PGlite を使う `helpdesk.test.ts`（35）、`apps/web` の `route.test.ts` 3 本（26・10・11）。PGlite の起動（約 1 s）は各ファイルで 1 回で、ファイル内は `TRUNCATE` で初期化する。gate 全体の増分が約 4 s にとどまるのは、これらが並列のワーカーで動くためである。5 分の予算（憲章 原則 3）に対しては余裕がある。
- **ミューテーション**: `stryker run --mutate packages/ai-core/src/helpdesk/plan-schema.ts,…/scheduler.ts` で 91.41（plan-schema 90.83、scheduler 100.00。生き残り 10 は `describe` 文言の文字列リテラルなど）。閾値 70 を満たす。全体の `mise run test:mutation` は実行していない。
- **`check:client-bundle`**: `next build` が成功し、`/api/helpdesk`・`/api/helpdesk/tickets`・`/api/helpdesk/tickets/[id]` がルート一覧に出た。`helpdesk/seed.ts` が `new URL(…, import.meta.url)` ではなく `path.resolve(dirname(fileURLToPath(import.meta.url)), …)` でフィクスチャを指すのは、W2 の教訓（Turbopack がファイル資産の参照として扱う）による。クライアントバンドルの走査は 20 ファイルで、秘密名・センチネルは検出されなかった。
- **E2E は W3 では走らせていない**（画面は W7）。`mise run test:db`（Docker Postgres で `0002_helpdesk.sql` を適用する `client.pg.test.ts` の 1 ケース）と、Docker Postgres での `mise run seed:samples` の 2 回実行は Docker が無く未実施で、人が行う。

### W3 で分かったこと

- **mock の埋め込みは疑似乱数で、既定の類似度（0.5）では検索が常に空になる**。ヘルプデスクは根拠（`sources`）が無いとき `escalated` にするため、`mock` のルートは `minSimilarity: -1`（上位 k 件をそのまま返す）で検索する。`local` / `live` は既定のままである。
- **シナリオの曖昧さ**: M2 の Agentic RAG のターン（`stepIndex: 1` と `toolResultFor: "searchKnowledgeBase"` だけで一致）は、同じツールを使うヘルプデスクのタスクの応答にも一致してしまう。`mock/m3-scenarios.test.ts` の検出器が見つけ、M2 側に質問文の条件を足して解消した。以後、`searchKnowledgeBase` を使う M3 のシナリオは、ユーザー文の条件を必ず持つ。
- **Node の型除去でスクリプトを起動する**: ai-core のソースは拡張子なしで相互に import するため、`scripts/seed-samples.ts` は `module.registerHooks` の resolve フック（`.ts`、`/index.ts` を補う）を自分で登録してから動的 import する。`tsx` は不要（CL-3）。Node 26.12 で確認した。

## W4 の実測: Docker サンドボックス（S-5、17.6〜17.8、2026-10-18、実測）

Rancher Desktop の Docker Engine **29.5.3**（API 1.54、aarch64）で、Engine API を直接（`node:http` + `socketPath`）叩いて確かめた。使ったコンテナは `rancher/mirrored-library-busybox:1.37.0`（ネットワーク不要）。

- **ソケット**: Rancher Desktop のソケットは `~/.rd/docker.sock` で、plan の探索先（`DOCKER_HOST`、`~/.docker/run/docker.sock`、`/var/run/docker.sock`）のどれにも無い。`docker context` の `rancher-desktop` が指すだけである。したがって Rancher Desktop では `DOCKER_HOST=unix://$HOME/.rd/docker.sock` を設定する（探索先は plan のまま変えていない）。
- **入力の転送（plan の想定が外れた）**: 読み取り専用ルート（`ReadonlyRootfs`）のコンテナへ `PUT /containers/{id}/archive` で入力を置く方法を 4 通り試した。

  | `/work` の作り方 | 起動前の archive | 起動後の archive | 結果 |
  |---|---|---|---|
  | `Tmpfs`（`--tmpfs`） | 403 `container rootfs is marked read-only` | 同左 | **不可** |
  | `--mount type=tmpfs` | 200 | 200 | 不可。置いたファイルは tmpfs のマウントの下に入り、コンテナからは見えない |
  | tmpfs 裏打ちの `local` ボリューム（`size=1m`） | 200 | — | 不可。同様に見えない（サイズ上限と `uid=` は効く） |
  | **匿名ボリューム**（`Mounts: [{ Type: "volume", Target: "/work" }]`） | **200** | — | **可**。起動後に `cat /work/in.txt` で読めた |

  plan C6 の「tmpfs の `/work`」と、17.6 の「起動後の archive」の想定は成り立たない。**採用: `/work` は匿名ボリューム、`/tmp` は tmpfs（`rw,noexec,nosuid,size=64m`）、入力は起動前に archive で置く**（create → archive → start → wait → logs → delete）。匿名ボリュームは root 所有（755）で、非 root のコードは `/work` に書けない（書けるのは `/tmp` の 64 MiB だけ）ため、ディスクを埋められない。ボリュームは `DELETE …?force=1&v=1` で一緒に消える（コンテナテストが、実行の前後で未使用ボリュームの数が増えないことを確かめる）。
- **コンテナの扱い**: 実行ごとに使い捨てのコンテナを作る。セッションは入力ファイルをメモリに持ち、実行のたびにそのコンテナへ置き直す（状態は実行間で引き継がれず、ファイルだけが残る）。実行の終わりに必ずコンテナを削除する（`finally`、失敗は 2 回まで再試行し、残ったものは `onWarning` で通知して `close` で再度削除する）。
- **API の版**: `v1.44`（Docker 25〜29 が対応する最古の版）に固定した。plan の v1.47 は Docker 27 以降を要する。
- **画像**: `python:3.13-slim` を**ダイジェストで固定**（`sha256:70729b46…`、Python 3.13.16、2026-10-06 作成）。`pip install` の解決結果を `docker/sandbox/requirements.txt` に全件固定した（pandas 3.0.6、openpyxl 3.1.5、xlrd 2.0.2、matplotlib 3.11.2 と、numpy 2.5.4、pillow 13.0.0 など依存 11 件）。全件の公開から 24 時間以上たっている（最も新しい pillow 13.0.0 で 1.6 日、fonttools 4.67.0 が 4.0 日、numpy 2.5.4 が 7.7 日。PyPI の `upload_time` を実測）。日本語のグラフ用に `fonts-ipafont-gothic` を apt で入れた（`IPAGothic` を matplotlib が見つけることを確認）。`mise run sandbox:build` は 15 秒（ベース画像取得後）、画像は 395 MB（aarch64）。
- **コンテナテスト**: `mise run test:container`（`DOCKER_HOST=unix://$HOME/.rd/docker.sock`）で 14 件が成功、約 15 秒。実コンテナの中から、ネットワーク（接続と名前解決の両方）が使えないこと、ルートが読み取り専用で `/work` にも書けず `/tmp` だけ書けること、uid 10001・`CapEff` と `CapBnd` が 0・`NoNewPrivs` 1、プロセス数の上限（`pidsLimit: 16` で 64 個の起動が失敗）、メモリ上限（128 MiB で 512 MiB の確保が `Killed`）、タイムアウトで強制削除されること、1 MB の出力、バイナリの入力が壊れないこと、実行ごと・セッション終了後にコンテナが残らないことを観測した。
- 未確認: x86_64 の Linux と Docker Desktop（macOS）の既定ソケットパス（`~/.docker/run/docker.sock`）での動作。E2B の実機（キーが無い）。


## W4 の実サーバー確認（R-1、20.1、2026-10-18、実測）

`mise` の Node 26.12、`next build`（Next.js 16.4.0、Turbopack）と `next start -p 3100`（`AI_RUN_MODE=mock`）で、`apps/web/e2e/real-server.spec.ts` の `analysis:` の 5 ケースを chromium で実行した（`pnpm exec playwright test e2e/real-server.spec.ts --project=chromium -g "analysis:"`、5 件成功）。

- **`serverExternalPackages` に足した集合は空**。`@e2b/code-interpreter` は Turbopack のバンドルに入ったままビルドと実行が通った（E2B の SDK のソースが `.next/server` のチャンクに含まれることを確認した）。`next.config.ts` は変えていない（理由を書けない追加はしない）。キーの無い `mock` では SDK を読み込まない（`createE2bProvider` が最初の `create` で遅延読み込みする）ため、バンドル後の SDK が E2B の API を呼べるかは未確認（キーが要る。ハンズオン）。代わりに、単体テスト（`e2b.test.ts`）が、実 SDK がプロセスで読み込まれ、`Sandbox.create` が E2B の API へ接続しようとするところまで進むこと（テストの遮断で止まる）を確かめている。
- **確認した内容**: `/api/analysis/status` が疑似サンドボックス（`{ kind: "mock" }`）と上限（20 MiB、`.csv` / `.xlsx` / `.xls`）を返す。`multipart/form-data` の本文を実ランタイムで解析し、`/api/analysis` が疑似提供者で完走する（試行、`alt` 付きの図、表、`succeeded`）。エラーの修正（`KeyError` の後で成功、`fixes: 1`）と `attempt-limit`（`attempts: 4`、`fixes: 3`）。`.txt` と PNG を `.csv` に偽装したファイルは 400、20 MiB + 1 バイトは 413。
- **ルートをまたいだセッションの共有**: `/api/analysis` が作ったセッションを `DELETE /api/analysis/sessions/[id]` が実際に閉じる（応答ヘッダー `x-analysis-session: released`。もう一度で `absent`）。`/api/analysis` と `/api/analysis/sessions/[id]` は別のバンドルになりえるが、レジストリは `globalThis` の 1 つのホルダーにあるため共有される。204 に本文は無いので、閉じたかどうかをヘッダーで返すようにした（W4 で足した）。
- **最初の実行は失敗した**: Playwright が `m3-3.ts`（シナリオ）を Node のネイティブ ESM で読み、そこから `sandbox/mock.ts` が import する JSON（`mock-success.json`）に到達して `needs an import attribute of "type: json"` で落ちた。Vitest とバンドラーは気にしない。シナリオが使う定数 `MOCK_ERROR_MARKER` を JSON を読まない `sandbox/mock-marker.ts` に分けて解消した（`analysis/scenarios.test.ts` が、シナリオが `mock.ts` を import しないことを守る）。M3-1 のシナリオが `mcp/chat` を import しても問題なかったのは、そこに JSON が無いからである。
- 未確認: `next dev`（Turbopack の開発モード）での同じ流れ、firefox / webkit での同じ 5 ケース（W4 の締めの `mise run test:e2e` で 3 エンジン全体を実行する）。

## W5 の実サーバー確認（R-1、23.4、2026-10-19、実測）

`mise` の Node 26.12、`next build`（Next.js 16.4.0、Turbopack）と `next start -p 3100`（`AI_RUN_MODE=mock`）で、`apps/web/e2e/real-server.spec.ts` の `research:` の 3 ケースを chromium で実行した（`pnpm --filter web exec playwright test --project=chromium -g "research"`、3 件成功。ビルドを含めて 42 秒）。

- **事前確認（preflight Step 3.5）**: シェルに `NODE_ENV=development` が漏れていた（`env -u NODE_ENV` で外して実行した）。ポート 3100 に待受は無い。Playwright の 3 エンジン（chromium 1243、firefox 1543、webkit 2359）は導入済み。リポジトリの `.githooks` に `pre-push` は無い（`pre-commit` のみ）。`mock` はキー不要。
- **`serverExternalPackages` に足した集合は空**。`fast-xml-parser` は Turbopack のバンドルに入ったままビルドと実行が通った。`next.config.ts` は変えていない（理由を書けない追加はしない）。`card` イベント（`"kind":"card"`、`"arxivId":"2401.01234"`）がストリームに現れることが、実ランタイムで arXiv のフィクスチャのフィードを解析できた証拠になる。
- **確認した内容**: `/api/research` が `mock` で完走する（Supervisor、検索・精読・市場影響の 3 つの子、`data-research-event` の 4 つの `agent`、`data-research-usage`、`data-research-result`）。引用の照合が実サーバーで働く（`未取得の手法 X` の行は除かれ、レポートの末尾に `## 引用の確認` が付く）。部分失敗のテーマでは `調査できなかった観点` に精読の欠落が載る。`maxSubagentCalls: 2` は使用量の状態パートに `"calls":2,"maxCalls":2` として現れ、空のテーマは 400 `invalid-request`。
- **PROVE**: `parseArxivFeed` を空の配列を返すように壊して同じケースを実行すると、`"kind":"card"` の期待で失敗した（`card` が 1 つも流れない）。壊した変更は戻した。最初の壊し方（常に例外を投げる）は到達不能コードで `next build` の型検査が落ち、サーバーが起動しなかった。到達できる壊し方に直した。
- **arXiv への実接続は一部のみ確認**: 429 / 503 / 301 の応答は 2026-10-19 に実測済み（I-5）。未実測なのは、複数件・0 件の正常系、HTTP 400 のフィード、ライブサーバーに対する再試行の挙動、リダイレクトとガード付き fetch の相性。
- 未確認: `next dev` での同じ流れ、firefox / webkit での同じ 3 ケース（W5 の締めの `mise run test:e2e` で 3 エンジン全体を実行する）。

## W5 の gate 実測（24.2、2026-10-19、実測）

- `env -u NODE_ENV mise run gate`: exit 0、52.1 秒（レビューの修正後）。ルート 419（期待された失敗 1 件）、`@platform/ai-core` 3,278 件成功 / 4 スキップ（W4 の締めは 2,778）、`web` 1,004（959）、`@platform/eval-suite` 7 / 8 スキップ、`Docs: 8 module documents, 110 test references verified`。`tool-risk-declared: scanned 342 FILES`、`TypeScript packages/ai-core/tsconfig.json: 356 files`。
- 3 エンジンの E2E（`mise run test:e2e`）は 402 件成功（修正の前）。修正後に `research:` の 3 件を chromium で再実行して成功。`check:client-bundle` は成功（24 ファイル、16 名前と 5 センチネル）。
- ミューテーション: `research/citations.ts` 82.41、`research/budget.ts` 88.89（2 ファイルだけの実行で 83.22、閾値 70）。
- **arXiv**: 429 / 503 / 301 の応答（`content-type`、本文、`Retry-After`）は I-5 で実測済みで、`parse.test.ts` に固定されている。未実測なのは、複数件・0 件の正常系、HTTP 400 のフィード、ライブサーバーに対する再試行の挙動。

## W6 の実測（2026-10-24）

- `mise run gate`: 終了コード 0。レビュー前 43 秒、レビューの修正後 76 秒（root 419 件、`@platform/ai-core` 3,673 件 / 4 skipped、`web` 1,190 件、`@platform/eval-suite` 7 件 / 8 skipped、`docs:check` は 110 件の参照を確認）。`workflow-no-agent-loop` は 43 ファイルを走査し、W6 の 6 ファイル（`requirements/interview.ts`・`personas.ts`、`marketing/council.ts`・`moderator.ts`・`profile.ts`・`recommend.ts`）を含む（`check-repo-rules.test.mjs` の走査件数の検査を 37 → 43 に更新）。
- `cooperateByRole` に `onRoleOutput` を足しても M2 のテストは緑のまま（`src/patterns` 110 件、`apps/web` の `app/api/workflows`・`components/workflows` 135 件が追加の前後で緑）。
- Stryker（`marketing/moderator.ts`、`recommend.ts` の 2 ファイル、閾値 70）: 修正前 84.73、修正後 82.89（`moderator.ts` 83.84、`recommend.ts` 81.82）。
- 未実施: `mise run test:db`（Docker）で `0003_marketing.sql` を実 Postgres に適用する `client.pg.test.ts` の 1 ケースと、`mise run seed:samples` の実 Postgres での 2 回実行。どちらも書いて PGlite では確かめたが、Docker が無いため人が実行する。
- 合議の予算は「同程度の大きさの呼び出しが続く限り」の上限である（W6 レビュー F-1）。出力の上限がスタックのどこにも無いため、種類ごとの最初の 1 回は残量を超えうる。


## W7 の実測（36.1、2026-10-25、実測）

- `env -u NODE_ENV TURBO_FORCE=true mise run gate`（キャッシュなし）: exit 0、87.9 秒（レビューの修正後）。root 419（期待された失敗 1 件）、`@platform/ai-core` 3,681 件成功 / 4 スキップ（W6 の締めは 3,673）、`web` 1,660（1,190）、`@platform/eval-suite` 7 / 8 スキップ、`Docs: 8 module documents, 110 test references verified`。`workflow-no-agent-loop` は 43 ファイル、`mcp-import-scope`・`sandbox-import-scope` は 647 ファイルを走査した。
- `env -u NODE_ENV mise run test:e2e`（3 エンジン）: exit 0、735 件成功（chromium 245 / firefox 245 / webkit 245、スキップ 0）、3 分 27 秒。W6 の締めは E2E が 402 件（W5 時点）で、W7 が 6 画面の spec、axe（light / dark）、キーボード、実サーバーのページ単位の確認を足した。
- `env -u NODE_ENV mise run check:client-bundle`: 成功（32 ファイル、16 名前と 5 センチネル。`E2B_API_KEY`・`GITHUB_TOKEN` のセンチネルを含む）。
- **E2E が見つけた実バグ 3 件**（いずれも修正済み。`tasks.md` 例外 (13)）。(1) `/mcp` のページが先に描画されると、ページ側のバンドルが作った MCP レジストリのツールを、Route Handler 側の `buildToolSet` が「`defineAciTool` で定義されていない」として拒否した（`define-tool.ts` の `WeakSet` がモジュール内の変数で、Next.js ではページとルートが別のコピーになる）。(2) `FigureView`・`TableView` の `@platform/ai-core/config` の import が、環境変数スキーマの秘密名（`LANGFUSE_*`）をブラウザのバンドルに引き込んだ（`client-bundle` が検出）。(3) マーケティングのペルソナのチェックボックスのフォーカス表示が 1px だった（3:1 検査が検出）。
- WebKit の Playwright は、multipart の `postData()` にファイルの中身を含めない（ヘッダーと空の本文だけ）。`analysis.spec.ts` はファイル名をすべてのエンジンで、中身を WebKit 以外で確かめる。
- **W7 の敵対的レビュー**（`.sdd/reviews/003-domain-agents-impl-w7-review-2026-10-25.md`）: REQUEST_CHANGES（HIGH 1 / MEDIUM 9 / LOW 10）。修正と記録は同ファイルの「Responses」を参照。
- **未実測・未検証**: 実サーバーでブラウザの切断が `request.signal` を abort するか（W4 F-21）。モックのサンドボックスが数ミリ秒で終わり、abort を観測できなかった（raw `http` で応答ヘッダーの直後にソケットを切る試みは、25 回中 25 回とも `released` で、abort の前に実行が終わっていた）。遅いモックのシナリオか、分析のストリームに間隔を指定する手段が要る。Stryker の W7 の対象は無い（画面のコンポーネントは対象外）。

## W8 の実測: `local`・`container`（39.1、39.2、2026-10-29、実測）

実行環境: macOS、Ollama（`llama-server -np 1 -c 4096`、同時処理は 1 スロット）。Docker は Rancher Desktop 29.5.3（`DOCKER_HOST=unix://$HOME/.rd/docker.sock`）、画像 `agentic-ai-sandbox:local`（この回では再ビルドしていない）。
**値は小さなローカルモデルでの少数回の観察であり、手法の優劣の根拠ではない。** 反復は 1〜3 回で、分散は見ていない。

### 38.1: 高水準ツールと低レベルの組み合わせ（`granite4.2:latest`、3 回ずつ、約 135 秒）

| 方式 | ステップ（最小-中央-最大） | トークン（最小-中央-最大） | 呼ばれたツール |
|---|---|---|---|
| `findAndReadFiles`（高水準） | 2-2-2 | 1,839-1,894-1,900 | `findAndReadFiles` |
| `searchFiles` + `readFile`（低レベル） | 4-4-4 | 5,444-5,641-5,696 | `searchFiles > readFile > readFile` |

高水準のほうが中央値でステップが 2、トークンが 3,747 少ない（トークン比 0.34）。全 6 回が `completed`。

### 38.2: 修正ループ（`granite4.2:latest` + Docker のサンドボックス、3 回、約 144 秒）

**測定時は、テスト内でネットワークガードを `container` 用に入れ直して Docker のソケットを許可した**（`local` レーンは既定で Docker のソケットを遮断する。`setup-hermetic.test.ts` が固定している設計）。その迂回は `sandbox-import-scope`（動的 import の指定子は文字列リテラル）と型検査（`rootDir`）に反するため、最終のテストからは外した。**最終のテストは `mise run test:local` では「Docker のソケットが遮断される」理由でスキップされ、この表は再現できない**（Ollama と Docker の両方を許すレーンが要る。人の判断）。

3 回とも `succeeded`（完走率 100%、表 1 つ）。修正は 1 回ずつ（平均 1.00。上限 3）、実行は 3〜4 回、1 回あたり 43〜55 秒。誤りは「存在しない `revenue` 列を読む」固定の 1 種類だけなので、一般的な修正能力の値ではない。

### 38.3: 階層型リサーチと単一エージェント（`llama3.2:latest`、各質問 1 回ずつ、約 189 秒）

| 方式 | トークン（平均） | 引用が見つかった論文だけ | 見つかった論文を引用した |
|---|---|---|---|
| 階層（Supervisor + 3 つ） | 2,433 | 3/3 | 1/3 |
| 単一エージェント | 1,555 | 0/3 | 0/3 |

Supervisor の呼び分けは、広い質問と市場の質問でサブエージェントを 1 つも呼ばず、手法の質問で `search` を 1 回呼んだだけだった。**このモデルでは階層型の利点（呼び分け）はほとんど観察できず**、階層は単一の約 1.6 倍のトークンを使った。「単一 0/3」は引用検査が単一側の出力を有効と判定しなかったという意味で、品質の比較ではない（単一側の出力の読み方は未検証）。fixture の arXiv は全クエリで同じ 3 件を返す。

### 38.4: 合議と単一エージェント（`llama3.2:latest`、2 回、約 402 秒）

| 方式 | 回 | トークン | ラウンド | 合意 | 文案が変わった |
|---|--:|--:|--:|---|---|
| 合議 | 1 | 5,249 | 1 | 合意 | いいえ |
| 合議 | 2 | 20,002 | 2 | 合意 | いいえ |
| 単一 | 1 | 435 | 1 | — | はい |
| 単一 | 2 | 769 | 1 | — | はい |

合意に達した割合は 2/2。合議の平均 12,626 トークンは単一の平均 602 の約 21 倍。**合議は「合意した」と判定したが、文案は変わらなかった**（合意の判定と改善は別の事柄）。

### 38.2〜38.4 を実行するときに分かったこと

- **合議のペルソナ呼び出しが、既定の 1 人あたりの上限 60 秒に収まらなかった（原因は未特定）。** 合議は 1 人ずつ直列に呼ぶ（`runCouncil` は `cooperateByRole` を 1 役割ずつ呼び、その中も逐次）ので、「並列の呼び出しが並ぶ」という当初の説明は誤りだった（W8 レビュー F-2）。 `granite4.2:latest` で 3 人とも `timeout`（ステップ 0、トークン 0）になり、`provider-unavailable`（「どのペルソナも発言できませんでした」）で止まった。評価テストは `roleLimits.maxDurationMs` を 300 秒にして対処した。**アプリの既定は 60 秒のまま**で、同じ構成では同じ失敗が起きうる（3-6 の解説の「確認できていないこと」に書く）。原因の候補で除外できていないもの: そのモデルの長い出力（暴走）、同時に走る他の `local` テストファイルが 1 スロットの Ollama を奪い合ったこと（Vitest はファイルを並列に実行する。`--no-file-parallelism` での再測定が要る）。
- `granite4.2:latest` は上限を 300 秒にしても、合議の途中で Ollama から `400 Bad Request` を返した（本文は取れていない）。同じモデルの単一エージェント（各視点を含むプロンプト）は 300 秒でも 1 ステップも終えず出力が空だった。Ollama 自体は正常（短い呼び出しは約 15 秒）。原因は特定していない（長い出力の暴走か、コンテキスト 4,096 の超過の疑い。未検証）。このため 38.3・38.4 は `AI_MODEL_CHAT=llama3.2:latest` で実行した。38.1・38.2 は既定の `granite4.2:latest`。
- 38.3 の反復は 3 → 1、38.4 は 3 → 2 に減らした（所要時間のため。38.3 は 3 回で 18 実行、1 回でも約 3 分）。

### 39.2: `container` と手動の項目

- `mise run test:container`（Rancher Desktop の Docker、`DOCKER_HOST` を設定）: `provider.container.test.ts` 17 件成功、スキップ 0（`executed=17 passed=17 failed=0 skipped=0`）。S-5（Docker Engine API とソケット）の確認は W4 の「W4 の実測: Docker サンドボックス」のとおりで、Rancher Desktop のソケットは探索先に無いため `DOCKER_HOST` が要る。
- `mise run sandbox:build`: この回は**未実行**（画像は W4 でビルド済みのものが存在した）。
- **S-4（E2B）: 未実行**（`E2B_API_KEY` が無い。外向き通信の既定は文書の記述のまま）。
- **S-6（GitHub の MCP の注釈）: 未実行**（`GITHUB_TOKEN` が無い）。
- Docker Desktop・Linux のネイティブでのソケット: 未実行（人が行う）。

### W8 の解説の確認で見つかった食い違い（2026-10-29）

- ADR-6 は E2B 側の `timeoutMs` を「15 分の安全網」とするが、実装（`sandbox/lifecycle.ts`）は `lifetimeMs ?? idleTimeoutMs * 3`（既定のアイドル 10 分なら 30 分）である。3-3 の解説は実装に合わせて「アイドル時間の3倍」と書いた。**2026-10-29 に人の決定で ADR-6 を実装に合わせて直した**（上の ADR-6）。

## W8 の最終統合の実測（42.1、2026-10-29、実測）

- `env -u NODE_ENV TURBO_FORCE=true mise run gate`（キャッシュなし、40 件の `Gate test summary` を含む 10 回）: **`mise run gate:repeat` は 10 回とも成功（exit 0）**。1 回の内訳は root 427、`@platform/ai-core` 3,681 件成功 / 4 スキップ、`web` 1,660、`@platform/eval-suite` 39 件成功 / 12 スキップ（`local` 専用）、`docs:check` 14 文書・245 参照。`check:repo-rules` は 13 規則（`workflow-no-agent-loop` は 43 ファイル、`mcp-import-scope`・`sandbox-import-scope` は 656 ファイルを走査）。
- `mise run test:mutation`（Stryker、閾値 70）: **86.19（成功）**。所要 100 分 40 秒。
- `mise run secret-scan`: 成功（292 コミット、漏えいなし）。
- **`mise run audit`: 失敗（M3 の変更とは無関係）。** 中程度 1 件: `qs`（`>=6.7.0 <=6.16.0`、修正版 `>=6.16.1`）の `qs.stringify` の DoS（GHSA-6pq8-jhm2-2vcw）。経路は `@stryker-mutator/core` → `typed-rest-client` → `qs` の開発用依存のみ。`pnpm-workspace.yaml` にはすでに `"typed-rest-client>qs": "^6.16.0"` の override があり、解決は 6.16.0 である。必要なのは追加ではなく `^6.16.1` への引き上げ。W7 の締め（2026-10-25）以降に出た勧告と見られる。直すには既存の `overrides` の引き上げ（依存の変更）が要り、24 時間規則の確認も要るため、行わず人に委ねる。
- **`mise run test:e2e`（3 エンジン）: 全体が緑の 1 回は得られなかった。** 4 回の全体実行の結果: (1) 731 成功 / 4 失敗（WebKit の `/summarize` の a11y、30 秒タイムアウト）、(2) 719 成功 / 16 失敗（41.2 分）、(3) 727 成功 / 8 失敗（22.8 分。すべて 30 秒または browser launch 180 秒のタイムアウト）、(4) `--workers=2` で 733 成功 / 2 失敗（3.8 分。Firefox ダークの `/workflows`・`/research` の `color-contrast`、ボタンの `hover:bg-primary/90`）。実行ごとに失敗が入れ替わり、**失敗分だけを単独で再実行すると毎回成功**した（(1)(3) の失敗分 8 件が 8/8 成功、(4) の 2 件は 8 回繰り返して 16/16 成功）。実行中のロードアベレージは 25〜31（他のプロセスによる）で、W7 の締め（同じコードで 735 件成功、3 分 27 秒）より極端に遅かった。**判断: 負荷依存の不安定さと見るが、緑の全体実行は未取得。** (4) の `color-contrast` は、ダークへの切り替え直後に色の遷移の途中で axe が測った可能性が高い（未確認）。a11y の仕様が遷移の完了を待たない点は W7 の E2E の改善候補（W8 の境界外）。

- **`mise run test:e2e` の再実行（2026-10-29、負荷が下がった後、実測）: 735 件成功 / スキップ 0（chromium 245、firefox 245、webkit 245）、3.0 分、exit 0。** 直前の 4 回の失敗は、ロードアベレージ 25〜31 の間の負荷依存の不安定さだったことを裏づける（開始時のロードは約 3）。`audit` は `qs` の override 引き上げ後に成功（a212323）。以上で 42.1 の各コマンドの成功が揃った。
