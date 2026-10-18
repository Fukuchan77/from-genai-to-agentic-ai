# domain-agents（Milestone 3）— 実装タスク W2: MCP・ファイル（大タスク 8〜11）

未着手の波。表記規約、ID 対応表、進捗、gate への段階的な結線、共有ファイルの編集者は [tasks.md](tasks.md) を参照する。

許可ワークスペース内のファイル操作ツール、自作 MCP サーバー（stdio）、MCP クライアントアダプター（許可リスト、リスク区分、接続状態、GitHub の設定）、
`/api/mcp/*`、実サーバーでのバンドルと子プロセス起動の確認（リスク R-1）を作る。前提は spike S-2・S-3・S-6（1.3、1.4）の結果。

8.1・8.2・9.1 は並列に進められる。10.3・10.4・10.5 は 10.1・10.2 の後に並列に進められる。

---

## 8. ファイル操作ツールと自作 MCP サーバー（C4）

許可されたワークスペースの内側だけでファイルを操作するツールを `defineAciTool` で定義し、同じツールを公式 MCP SDK で公開する stdio サーバーを提供する。

_Boundary:_ `.gitignore`, `workspace/README.md`, `packages/ai-core/src/files/**`
_Depends:_ 1.3, 3.1, 4.7
_Requirements:_ 1.1, 1.4, 1.5, 1.6, 1.7, 1.11, 1.12, 1.13, 1.16, 1.17
_Traces:_ REQ-001, C4

- [ ] 8.1 (P) `.gitignore` に `workspace/*` を足して `workspace/README.md` だけを追跡し、`workspace/README.md`（許可ルートであること、置いてよいファイル、パスの制約を日本語で説明する）を作る
  _Boundary:_ `.gitignore`, `workspace/README.md`
  _Depends:_ none
  _Requirements:_ 1.7
  _Traces:_ REQ-001, C4, CL-5
  _Verify:_ `git check-ignore -q workspace/sample.txt` が成功し、`git check-ignore -q workspace/README.md` が失敗する（追跡される）
- [ ] 8.2 (P) `files/path.ts`: `resolveWorkspacePath(root, input)` が `Result<string, PathError>`（`relative | outside-root | not-found | invalid`）を返す。相対パスを拒否し、正規化し、シンボリックリンクを解決した実パスが `root` と同一または配下（パス区切り単位）であることを検査する + `path.test.ts` に、相対パス、`..`、ルートと同じ接頭辞を持つ**兄弟ディレクトリ**（`root` と `root-evil`）、シンボリックリンクによる脱出（一時ディレクトリ）、存在しないパス、形式の誤りを先に書く
  _Boundary:_ `packages/ai-core/src/files/path.ts`, `packages/ai-core/src/files/path.test.ts`
  _Depends:_ none
  _Requirements:_ 1.4, 1.5
  _Traces:_ REQ-001, C4, CL-1
- [ ] 8.3 `files/tools.ts`: `createFileTools({ root, clock })` が `listFiles`、`readFile`（`format` を持つ）、`searchFiles`、`findAndReadFiles`（高水準。一覧と読み取りを 1 回で行う）、`writeFile`（`write`）、`deleteFile`（`destructive`）を `defineAciTool` で定義する。読み取り系はすべて `risk: "read-only"`。許可ルートの外は `FatalToolError`（`not-allowed`、許可ルートのパスを含む学習者向けの文言）、相対パスと存在しないパスは回復可能（修正ガイド）。`concise` は 4.3 の `applyResponseFormat` で切り詰め、一覧の識別子は 4.4 の `ShortIdIndex`（名称と 0 始まりの索引）を使う + `tools.test.ts` に、各ツールの正常系、相対パスの回復可能な拒否、脱出の致命的な分類（許可ルートを含む文言）、`concise` の切り詰めと全文の案内、出力に UUID の形が現れないこと、`findAndReadFiles` が単一の呼び出しで完了することを先に書く
  _Boundary:_ `packages/ai-core/src/files/tools.ts`, `packages/ai-core/src/files/tools.test.ts`
  _Depends:_ 8.2, 3.1, 4.3, 4.4, 4.7
  _Requirements:_ 1.1, 1.4, 1.5, 1.6, 1.11, 1.12, 1.13, 1.16, 1.17
  _Traces:_ REQ-001, C4, CL-1
- [ ] 8.4 `files/server.ts`・`files/stdio.ts`・`files/index.ts`: `createFilesServer({ root })` が `@modelcontextprotocol/server` で 8.3 のツールを公開する。`writeFile` と `deleteFile` も公開するが注釈は `readOnlyHint: false`、読み取り系は `readOnlyHint: true`（Req 1.17 の実例。1.3 の結果に従う）。ツールの失敗は例外にせず、`isError: true` と `_meta["agentic-ai/error"]`（許可ルートの外は `kind: "fatal"`・`code: "not-allowed"`、相対パスと存在しないパスは `kind: "recoverable"`）を持つ結果で返す（CL-24。`_meta` が届かない場合は 1.3 の結果に従い `structuredContent` に載せる）。`stdio.ts` は `MCP_FS_ROOT` を起動時に実パスへ解決して `StdioServerTransport` で接続し、ルートが存在しなければ作らずに理由を示して終了する。`erasableSyntaxOnly` を満たす書き方にする（CL-3）。`files/index.ts` は `@platform/ai-core/files` の公開 API を再エクスポートする + `server.test.ts` に、同一プロセスの接続（インメモリのトランスポート）でのツール一覧と注釈の取得、読み取り系の呼び出し、`writeFile` / `deleteFile` の注釈、許可ルートの外のパスが `kind: "fatal"` の結果で返り、相対パスが `kind: "recoverable"` で返ることを先に書く
  _Boundary:_ `packages/ai-core/src/files/server.ts`, `packages/ai-core/src/files/server.test.ts`, `packages/ai-core/src/files/stdio.ts`, `packages/ai-core/src/files/index.ts`
  _Depends:_ 8.3, 1.3
  _Requirements:_ 1.7, 1.17
  _Traces:_ REQ-001, C4, CL-3, CL-5, CL-24, S-3
  _Verify:_ `mise run gate` が成功する。`node packages/ai-core/src/files/stdio.ts` が型除去で起動し、存在しない `MCP_FS_ROOT` で理由を示して終了する（子プロセス起動の実サーバーでの確認は 11.1）

### Implementation Notes

---

## 9. MCP クライアントアダプター（C5）

設定された MCP サーバーへ接続し、サーバーごとの状態を記録し、エージェントごとの許可リストで絞ったツールを `AciTool` と同じ形へ変換する。

_Boundary:_ `packages/ai-core/src/mcp/**`
_Depends:_ 1.3, 1.4, 3.1, 4.7, 8.4
_Requirements:_ 1.1, 1.7, 1.8, 1.9, 1.10, 1.11, 1.15, 1.16, 1.17
_Traces:_ REQ-001, C5

- [ ] 9.1 (P) `mcp/types.ts` と `mcp/risk.ts`: `McpServerConfig`・`McpServerStatus`・`AgentId` の型と、`riskFromAnnotations(annotations)`（`readOnlyHint === true` だけを `read-only`、それ以外は注釈なしを含めて `destructive`）を作る + `risk.test.ts` に、注釈なし → `destructive`、`readOnlyHint: true` のみ `read-only`、`destructiveHint` だけ → `destructive`、`readOnlyHint: false`、注釈が不正な型を先に書く
  _Boundary:_ `packages/ai-core/src/mcp/types.ts`, `packages/ai-core/src/mcp/risk.ts`, `packages/ai-core/src/mcp/risk.test.ts`
  _Depends:_ none
  _Requirements:_ 1.16, 1.17
  _Traces:_ REQ-001, C5, ADR-7
- [ ] 9.2 `mcp/allow-list.ts`: エージェントごとの許可リストから `client.tools({ schemas })` に渡すオブジェクトを組み立てる（許可リストに無いツールは読み込まれず、空の許可リストは何も読み込まない）+ `allow-list.test.ts` に、許可リストに無いツールが読み込まれないこと、空の許可リスト、サーバーが公開していない許可リストのツール名の扱いを先に書く
  _Boundary:_ `packages/ai-core/src/mcp/allow-list.ts`, `packages/ai-core/src/mcp/allow-list.test.ts`
  _Depends:_ 9.1
  _Requirements:_ 1.8
  _Traces:_ REQ-001, C5
- [ ] 9.3 `mcp/adapt.ts`: `adaptMcpTool(name, tool, { risk, description, trustErrorMeta })` が MCP のツールを `AciTool` へ変換し、実効の説明文（`McpServerConfig.descriptions` の上書き、無ければサーバーの説明文）を 4.1 の `checkJsonSchemaDescription` に通す。通らないツールは登録せず、`McpServerStatus.tools[].disabledReason` に「説明文の形式」を記録する（CL-25）。実行結果は純関数 `classifyMcpToolResult(result, { serverId, trustErrorMeta, learnerMessageFor })` で判定し、`trustErrorMeta` が真で `code` が C2 の閉じた語彙の `kind: "fatal"` だけを `FatalToolError` にする。それ以外の `isError` は回復可能（要約と次の修正アクション）とし、学習者向けの文言にサーバーの文字列を使わない（CL-24）+ `adapt.test.ts` に、リスクの付与、上書きのある外部ツールが登録されること、上書きが無く検査に通らないツールが登録されず理由が残ること、入力スキーマの変換、自作サーバーの `kind: "fatal"` で `FatalToolError` になること、`trustErrorMeta` の無いサーバーの `kind: "fatal"` と語彙外の `code` が回復可能になること、学習者向けの文言にサーバーの文字列が入らないことを先に書く
  _Boundary:_ `packages/ai-core/src/mcp/adapt.ts`, `packages/ai-core/src/mcp/adapt.test.ts`
  _Depends:_ 9.1, 4.7
  _Requirements:_ 1.1, 1.3, 1.5, 1.11, 1.16
  _Traces:_ REQ-001, C5, CL-24, CL-25
- [ ] 9.4 `mcp/github.ts`: `githubServerConfig(env)` が `Authorization` ヘッダに `GITHUB_TOKEN` を入れる HTTP 設定（`trustErrorMeta: false`、既定の許可リストの読み取り専用ツールと、その CL-18 の形式の説明文の上書き `descriptions`。ツールの一覧は 1.4 の結果に従う）を返し（トークンが無ければ `{ reason: "token-missing" }`）、`filesServerConfig({ root })` が自作サーバーの stdio 設定（`command: process.execPath`、引数はサーバーのファイル、環境変数 `MCP_FS_ROOT`、`trustErrorMeta: true`）を返す。トークンは `Authorization` にだけ入れ、状態・ログ・例外の文言に含めない + `github.test.ts` に、トークンの有無、ヘッダの形、設定のシリアライズやエラー文言にトークンが現れないこと、`allow` が読み取り専用ツールだけであること（1.4 の結果に従う）、`allow` の各ツールに `descriptions` の上書きがあり `checkJsonSchemaDescription` を通ること、`trustErrorMeta` の値を先に書く
  _Boundary:_ `packages/ai-core/src/mcp/github.ts`, `packages/ai-core/src/mcp/github.test.ts`
  _Depends:_ 9.1, 1.4
  _Requirements:_ 1.7, 1.9
  _Traces:_ REQ-001, C5, CL-3, CL-4, CL-24, CL-25, S-6
- [ ] 9.5 `mcp/connect.ts` と `mcp/index.ts`: `connectMcpServers(configs, { signal })` が各サーバーへ接続し、失敗を例外にせず `McpServerStatus`（`connected` / `unavailable` と理由）に記録して他のサーバーに影響させない。`McpRegistry` は `status()`、`toolsFor(agentId)`（許可リストで絞り、`adaptMcpTool` で変換し、`buildToolSet` に渡せる形にする）、`close()` を持つ。`write` / `destructive` は登録されず `disabled` に入り、1 つのエージェントのツールが 21 個以上（MCP 由来を含む）なら起動時に拒否する。実行中の切断は、サーバー名と原因を含む回復可能な結果としてモデルへ返し、状態を `unavailable` にする。`index.ts` は `@platform/ai-core/mcp` の公開 API を再エクスポートする + `connect.test.ts` に、接続失敗が他のサーバーに影響しないこと、切断の通知（サーバー名と原因）、`write` / `destructive` が `disabled` に入り理由が残ること、ツール 20 個の許容と 21 個の拒否、トークンが状態・例外の文言に出ないこと、同一プロセスの接続での自作サーバーのツール取得を先に書く
  _Boundary:_ `packages/ai-core/src/mcp/connect.ts`, `packages/ai-core/src/mcp/connect.test.ts`, `packages/ai-core/src/mcp/index.ts`
  _Depends:_ 9.2, 9.3, 9.4, 8.4, 1.3, 3.1
  _Requirements:_ 1.7, 1.8, 1.10, 1.15, 1.17
  _Traces:_ REQ-001, C5, S-2

### Implementation Notes

---

## 10. MCP の HTTP 入口（C13 の一部、C15 の m3-1）

`/api/mcp/servers`、`/api/mcp/chat`、`/api/mcp/compare` と、その `mock` 完走用のシナリオ、組み立てを作る。

_Boundary:_ `packages/ai-core/fixtures/scenarios/m3-1.ts`, `packages/ai-core/src/models/gateway.ts`, `packages/ai-core/src/models/gateway.test.ts`, `packages/ai-core/src/mock/index.ts`, `packages/ai-core/src/mock/m3-scenarios.test.ts`, `apps/web/lib/server/platform.ts`, `apps/web/lib/server/platform.test.ts`, `apps/web/app/api/mcp/**`
_Depends:_ 2.2, 5.2, 6.4, 8.3, 9.5, 3.3, 4.5
_Requirements:_ 1.3, 1.7, 1.8, 1.10, 1.12, 1.14, 1.15, 1.17
_Traces:_ REQ-001, C13, C15

- [ ] 10.1 `fixtures/scenarios/m3-1.ts`: MCP チャット（一覧 → 読み取り）と、高水準ツールと低レベルの組み合わせの比較（`mock` で固定した手順）のシナリオを作り、`models/gateway.ts` の `mock` 既定シナリオと `mock/index.ts` の集約に足す + `m3-scenarios.test.ts` の期待件数を更新して、曖昧な一致がないことを確かめる
  _Boundary:_ `packages/ai-core/fixtures/scenarios/m3-1.ts`, `packages/ai-core/src/models/gateway.ts`, `packages/ai-core/src/models/gateway.test.ts`, `packages/ai-core/src/mock/index.ts`, `packages/ai-core/src/mock/m3-scenarios.test.ts`
  _Depends:_ 6.4, 2.2
  _Requirements:_ 1.10, 1.12
  _Traces:_ REQ-001, C15
- [ ] 10.2 `apps/web/lib/server/platform.ts`: `getMcpRegistry()` を組み立てる（自作サーバーの stdio 設定は `MCP_FS_ROOT`、GitHub は `GITHUB_TOKEN` があるときだけ。組み立ては `globalThis` のホルダーで 1 回）+ `platform.test.ts` に、実行モード別の組み立て、`GITHUB_TOKEN` が無いとき GitHub のサーバーが一覧に出ないこと、接続の組み立ての失敗が 503 `provider-unavailable` になることを先に足す
  _Boundary:_ `apps/web/lib/server/platform.ts`, `apps/web/lib/server/platform.test.ts`
  _Depends:_ 9.5
  _Requirements:_ 1.7, 1.8, 1.10
  _Traces:_ REQ-001, C13
- [ ] 10.3 (P) `GET /api/mcp/servers`: `{ servers: McpServerStatus[]; limits: { maxTools: 20 }; think: { enabled } }` を返す。秘密（ヘッダの値）を含めない + `route.test.ts` に、サーバー状態（`connected` / `unavailable`、読み込んだツールと拒否したツールの理由）、トークンが応答に現れないこと、接続の組み立ての失敗が 503 になることを先に書く
  _Boundary:_ `apps/web/app/api/mcp/servers/route.ts`, `apps/web/app/api/mcp/servers/route.test.ts`
  _Depends:_ 10.2
  _Requirements:_ 1.7, 1.10, 1.15
  _Traces:_ REQ-001, C13
- [ ] 10.4 (P) `POST /api/mcp/chat`: `z.strictObject` の本文（`id`、`messages`、`modelId?`、`allow?`、`think?`）を検査し（413 → 400 形式 → 400 件数・長さ → `live` のみ 429）、許可リストに無いサーバー・ツール名、ツール数が 20 を超える構成、`write` / `destructive` のツールを含む指定を 400 `invalid-request` で拒否し、ツール非対応のモデルを `capability-unsupported` で拒否する。M1 と同じエージェントの UI メッセージストリームを返し、`finish` の `messageMetadata` に `{ run, mcp }` を載せる。致命的なツールエラーは停止理由 `error` と学習者向けの文言として `finish` に載せる。モデルは `gateway.resolve({ purpose })` で解決する + `route.test.ts` に、検査順、各拒否のコード、`mock` での完走、致命的エラーの停止（許可ルート外のパスの読み取り）の `finish`、`request.signal` の伝播を先に書く
  _Boundary:_ `apps/web/app/api/mcp/chat/route.ts`, `apps/web/app/api/mcp/chat/route.test.ts`
  _Depends:_ 10.1, 10.2, 3.3, 5.2
  _Requirements:_ 1.3, 1.8, 1.14, 1.15, 1.17
  _Traces:_ REQ-001, C13
- [ ] 10.5 (P) `POST /api/mcp/compare`: `{ modelId?; task: "list-and-read" }` を検査し、同じ操作を高水準ツールと低レベルの組み合わせで行って `RunMetrics` を計測し、4.5 の `compareApproaches` で `{ highLevel, lowLevel, comparison }` を返す。一方が失敗したら失敗した側を `error` として返し比率を計算しない + `route.test.ts` に、`mock` での完走（固定の手順）、一方の失敗、拒否のコードを先に書く
  _Boundary:_ `apps/web/app/api/mcp/compare/route.ts`, `apps/web/app/api/mcp/compare/route.test.ts`
  _Depends:_ 10.1, 10.2, 4.5, 8.3
  _Requirements:_ 1.12
  _Traces:_ REQ-001, C13

### Implementation Notes

---

## 11. 実サーバー確認と W2 の締め（リスク R-1）

Vitest はバンドラーを通らないため、`@ai-sdk/mcp` と `@modelcontextprotocol/server` のバンドル失敗や、自作 MCP サーバーの子プロセス起動の失敗を検出できない。
実サーバー（`mock`）で確かめ、`serverExternalPackages` の最小の集合を確定する。

_Boundary:_ `apps/web/next.config.ts`, `apps/web/e2e/real-server.spec.ts`, `mise.toml`, `stryker.config.mjs`, `specs/003-domain-agents/research.md`
_Depends:_ 10.5
_Requirements:_ 1.7, 1.8, 1.16, 1.17
_Traces:_ REQ-001, C13, C16, R-1

- [ ] 11.1 `next build` と実サーバー（`mock`）で `GET /api/mcp/servers` を呼び、`/api/mcp/servers` が自作サーバーを stdio で起動してツール一覧を返すこと、`@ai-sdk/mcp` と `@modelcontextprotocol/server` がバンドルされて起動できることを `real-server.spec.ts` で確かめる。自作サーバーのファイルが Turbopack のバンドルの外にある実ファイルとして `process.execPath` から解決できることを確認し、`next.config.ts` の `serverExternalPackages` に必要な最小の集合を足す。結果を research.md の R-1 に追記する
  _Boundary:_ `apps/web/next.config.ts`, `apps/web/e2e/real-server.spec.ts`, `specs/003-domain-agents/research.md`
  _Depends:_ 10.3
  _Requirements:_ 1.7, 1.8
  _Traces:_ REQ-001, C13, R-1
  _Verify:_ `mise run test:e2e`（実サーバー）が成功し、`/api/mcp/servers` の応答に自作サーバーの読み取りツールが載る。`serverExternalPackages` に足した各パッケージの理由が research.md にある
- [ ] 11.2 W2 の結線: `mise.toml` の `check:repo-rules --only` に `mcp-import-scope` を足し、`stryker.config.mjs` のミューテーション対象に `files/path.ts` と `mcp/risk.ts` を足す
  _Boundary:_ `mise.toml`, `stryker.config.mjs`
  _Depends:_ 11.1, 6.2, 9.5
  _Requirements:_ 1.4, 1.5, 1.16, 1.17
  _Traces:_ REQ-001, C16
  _Verify:_ `mise run check:repo-rules` が `mcp-import-scope` を走査 1 件以上で成功する。`mise run test:mutation` の対象に含まれ、閾値 70 を満たす
- [ ] 11.3 W2 の gate を実測して記録する。`mise run gate` の成功を引用し、所要時間を research.md の「gate の所要時間」に追記する。`GITHUB_TOKEN` が無い状態で gate が成功すること（GitHub の接続を試みない）を確認する
  _Boundary:_ `specs/003-domain-agents/research.md`
  _Depends:_ 11.2
  _Requirements:_ 1.9, 1.10
  _Traces:_ REQ-001, C16
  _Verify:_ `mise run gate` の成功と所要時間を research.md に記録した。W2 の敵対的レビューの記録が `.sdd/reviews/003-domain-agents-impl-w2-review-*.md` にある

### Implementation Notes
