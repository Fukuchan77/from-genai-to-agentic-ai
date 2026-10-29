# domain-agents（Milestone 3）— 実装タスク（索引）

`/sdd-tasks` が生成した。承認済みの [spec.md](spec.md)（WHAT）と [plan.md](plan.md)（HOW、C1〜C16、Implementation Waves spike・W1〜W8）から、
実装の波ごとに分割した。ルールは `~/.claude/sdd/rules/tasks-generation.md` と `~/.claude/sdd/rules/tasks-parallel-analysis.md`
に従う。並列モード（`--sequential` 未指定）。002 の `tasks.md` と同じ運用（索引 + 現在の波の全文、未着手の波は `tasks-wN.md`、
完了した波は `tasks-comp-wN.md`）を採る。

## ファイル構成

| ファイル | 内容 |
|---|---|
| `tasks.md`（本ファイル） | 表記規約、ID 対応表、進捗、gate への段階的な結線、004 への引き継ぎ事項、**現在の波**（W8）のタスク全文 |
| `tasks-comp-w1.md`〜`tasks-comp-w7.md` | 完了した波の保管先。波の完了時に作る |
| `traceability.md` | 要件 → 設計 → タスク → テスト → コミット（Test と Commit は `/sdd-ship` が埋める） |

タスク番号は全ファイルで一意で、移動しても変えない。`_Depends:_` と `traceability.md` は、ファイルをまたいで番号だけで参照する。

### 完了した波の移行手順

002 の `tasks.md`「完了した波の移行手順」と同じである（2 つのコミットに分け、1 つ目は `git mv tasks.md tasks-comp-wN.md` だけ、
2 つ目は `git mv tasks-w(N+1).md tasks.md` の後に索引の節を移す）。移行の条件は次のとおり。

1. その波の全サブタスクが `[x]` で、各大タスクの Implementation Notes が記入済みである。
2. 波の締めのタスク（下記「gate への段階的な結線」）が完了し、`mise run gate` と CI の `ci-status` が成功している。
3. その波の敵対的レビュー（憲章 原則 9。新規コンテキストで `sdd-reviewer` と `adversarial-review` skill）の記録が
   `.sdd/reviews/003-domain-agents-impl-wN-review-YYYY-MM-DD.md`（1 ラウンド 1 ファイル）にあり、指摘への対応が追記されている。

## 表記規約

- `- [ ]` 未着手、`- [x]` 完了、`- [ ]*` 任意・後回し可のテスト（この spec では使っていない）。
- `(P)` = 並列実行可（依存なし・境界の重複なし）。同じ波の中で、依存関係の同じ段にあるタスクの間でだけ付ける。共有ファイルの編集者（下記）は `(P)` を付けない。
- 各タスク（大タスク・サブタスクの両方）は `_Boundary:_`、`_Depends:_`、`_Requirements:_`、`_Traces:_` を必ず持つ。
- **テスト先行（憲章 原則 4）**: 実装を含むサブタスクは、対応するテストファイルを同じ `_Boundary:_` に含め、RED（失敗の確認）→
  GREEN → REFACTOR を 1 つのサブタスクの中で行う。設定・文書・実験など単独のテストを持たないサブタスクは、検証手段を `_Verify:_` に書く。
- `_Requirements:_` は spec.md の受け入れ基準番号（例: `1.1`）を数値のみでカンマ区切りに列挙する。基盤の作業で対応する
  受け入れ基準が plan の部品表（`Requirements` 行）にあるものは、それを書く。
- `_Traces:_` は安定リンク ID を持つ。この spec は `spec.md`/`plan.md` に `REQ-###`/`DES-#.#` 形式の見出しを持たないため、
  下記の対応表で実在する見出しに固定する（001・002 と同じ扱い）。
- 各大タスクの末尾の `### Implementation Notes` は生成時は空。大タスクの完了後に、実装者が学びを 1〜3 項目追記する。
- **Boundary の対象**: plan の File Structure Plan にあるファイルに限る（`{a,b}` の記法はファイルごとに分け、`*` の glob は plan の複数ファイルを指す）。次の例外だけを許す。
  (1) 生成物 `pnpm-lock.yaml`（1.2）。(2) `specs/003-domain-agents/` 配下の spec 文書（`research.md` への実測の追記、`traceability.md`、spike の結果）。
  (3) M1 の `aci/tools/*.test.ts` のうち、説明文の形式の変更（4.6）で壊れる既存テスト（4.6 の RED で特定する）。
  (4) `packages/ai-core/src/rag/db/client.pg.test.ts`: plan の Test Strategy が「`0002`、`0003` を既存の `runMigrations` で適用する 1 ケースを足す」と
  定めるが File Structure Plan に載っていない記載漏れである。M2 の既存ファイルへ 1 ケースを足すだけに限る（13.1、26.2）。
  (5) W1 の実装で判明した境界外の変更（2026-10-18 に事後承認して記録。敵対的レビュー W1 F-8）。各サブタスクの `_Boundary:_` に明記した。
  `aci/define-tool.ts` のラッチを立てる処理（3.2。`executeWithGuards` が投げられたエラーを結果に変換するため、`tool-set.ts` からは分類できない）、
  `scripts/check-client-bundle.mjs` の `SECRET_NAME`（6.3。`GITHUB_TOKEN` が秘密名として検出されない実在の穴）、
  `testing/tool-description.ts` と `testing/index.ts`（4.7。登録時の説明文検査を通す `describeTool`）、
  `patterns/role-based-cooperation.test.ts`（4.7。使い捨てのツールの説明文）、`aci/types.ts` の `inputSchema`（4.7）、
  `docs/modules/1-2-ai-sdk-core-and-tools.md`（4.6。スニペットを CL-18 の形式にする）。
  (6) W2 の実装で判明した境界外の変更（2026-10-18 に記録。人の事後承認を待つ。W2 の敵対的レビューの対象にする）。`tsconfig.base.json` の `allowImportingTsExtensions` と `files/operations.ts`
  （8.3・8.4。`stdio.ts` を Node の型除去で直接起動するため、`.ts` 拡張子付きの import だけで到達できる処理の本体を分けた）、
  `aci/types.ts`・`aci/define-tool.ts`・`aci/define-tool.test.ts` の `externalInputSchema`（9.3。外部の JSON Schema を持つツールを `defineAciTool` で登録するため。既存のテストは変えず追記のみ）、
  `mcp/request-schema.ts`・`mcp/chat.ts`・`mcp/types.ts` の `publicMcpStatus` とそのテスト（10.4・10.5。`apps/web` に `zod` がなく、本文スキーマと文面は ai-core に置く）。
  詳細は `pdca/do.md` と plan の C3・C4・C5・File Structure Plan に同期した。
  (7) W3 の実装で判明した境界外の変更（2026-10-18 に記録。W3 の敵対的レビューで確認済み）。`helpdesk/request-schema.ts`（15.3。`apps/web` に `zod` がない）、`lib/server/errors.ts` の `toNotFoundResponse` と `lib/server/helpdesk-json.ts`（15.4。初めての 404、ルートファイルはハンドラ以外を export できない）、`fixtures/scenarios/m2-1.ts`（15.1。M2 のターンがユーザー文の条件を持たず M3-2 と衝突）、`rag/db/index.ts`（13.1）、`scripts/check-repo-rules.test.mjs`（16.1。W1 F-17）。
  (8) W4 の実装で判明した境界外の変更（2026-10-18 に記録。W4 の敵対的レビューの対象にする）。`tooling/vitest/network-guard.ts` と `setup-hermetic.test.ts`（17.8。W1 F-16 の予定どおり、`container` スイートだけ Docker のソケット 3 か所への接続を許す）、`packages/ai-core/src/testing/container-only.ts`・`container-only.test.ts` と `testing/index.ts` の再エクスポート（17.8。F-16 のスキップ補助 `describeContainer`）、`docker/sandbox/requirements.txt`（17.8。依存の全件固定。Dockerfile が読む）。`sandbox/file-name.ts`・`sandbox/docker/fake-socket.ts` は `sandbox/**` の中の追加ファイル。
  (9) W4 の 19.x で判明した境界外の変更（2026-10-18 に記録。W4 の敵対的レビューの対象にする）。`apps/web/lib/server/guard.ts`（`rateLimitRejection` の切り出し。`guardRequest` が使う同じ処理を、本文を自分で読むアップロードのルートが使う）、`apps/web/lib/server/errors.ts`（`provider-unavailable` の `details.guidance` だけをブラウザへ出す。固定文で、サンドボックス無効の案内に使う）、`packages/ai-core/src/sandbox/docker/local.ts`（`createLocalDockerProvider`。`socketPath` を `sandbox/docker/` の外に出さないため）、`analysis/upload-check.ts` の `uploadKindOf` の公開（18.4 が使う）。
  (10) W4 のレビュー（F-7）で記録した境界外の変更。`scripts/check-repo-rules.mjs` と `check-repo-rules.test.mjs`（20.2。`sandbox-import-scope` の `docker.sock` / `socketPath` の検査から、コンテナのテスト基盤の 4 ファイルだけを除く。plan C16 に同期）。レビューの修正で触れた `packages/ai-core/src/aci/fatal.ts`（致命的エラーの語彙に `sandbox-unavailable`）、`config/defaults.ts`（`DEFAULT_SANDBOX.maxSessions`）、`apps/web/lib/server/platform.ts` の `invalidateSandboxSelection`。
  (11) W5 の実装で判明した境界外の変更（2026-10-19 に記録。W5 の敵対的レビューの対象にする）。`agents/token-ledger.ts`（`usageFromRun`）、`agents/observer.ts`（`forAgent`、`source` の 512 文字の上限）、`agents/index.ts` とそれぞれのテスト（22.3。W1 の敵対的レビュー F-10・F-11 の持ち越し）、`research/request-schema.ts` とそのテスト（23.3。`apps/web` に `zod` がなく、本文スキーマは ai-core に置く。(7) のヘルプデスクと同じ）、`research/scenarios.test.ts`（22.5。m3-4 の通しテスト）、`mock/arxiv-fixtures.ts` とそのテストと `mock/index.ts` の再エクスポート（22.5、23.1。`mock` の arXiv の fetcher。API の URL 以外は拒否）、`research/tools.ts` の `onCall`・`onFailure`、`research/subagents.ts` の `failureReasonOf`、`research/supervisor.ts` の `onUsage`（23.2・23.3。画面へ流す配線と、arXiv に届かない検索を欠落にする規則）。詳細は `pdca/do.md` と plan の C8・C9・File Structure Plan に同期した。
  (12) W6 の実装で判明した境界外の変更（2026-10-24 に記録。W6 の敵対的レビュー F-7 への対応）。`apps/web` に `zod` がないため、本文スキーマを ai-core に置いた（(7)・(11) と同じ）: `requirements/request-schema.ts`・`messages-schema.ts`、`marketing/request-schema.ts`・`recommend-request-schema.ts` とそれぞれのテスト（27.4、27.5、27.7、27.8）。面接のセッションの型と、別のルートが同じレジストリを引くための取得口 `requirements/web-session.ts`（Route Handler のファイルは handler 以外を export できない。27.4）。`rag/db/index.ts` への `marketingProducts`・`marketingPersonas` の再エクスポート（26.3）。`requirements/index.ts`・`marketing/index.ts` への上記の再エクスポート。`requirements/scenarios.test.ts`・`marketing/scenarios.test.ts`（27.1。m3-5・m3-6 の通しテスト）。`scripts/check-repo-rules.test.mjs` の走査対象の一覧に W6 の 6 ファイルを足した（28.1。W1 F-17）。plan の「ストリームのパート」に `data-requirements-questions` を足し、`domain-stream.ts` に `writeRequirementsQuestions` を足した（27.5 の判断。次のラウンドの質問をストリームで返す部品が表に無かった）。**2026-10-24 に人が承認した**（例外 (12) の全体と、plan に足した `data-requirements-questions` と `/recommend` の `text` パート）。
  (13) W7 の実装で判明した境界外の変更（2026-10-25 に記録。**2026-10-25 に人が承認した**（例外 (13) の全体。plan への同期も同日に行った: C2・C13・C14・C16 と、409 の `details.reason`）。W7 の敵対的レビュー F-10 への対応）。(a) 35.2: 新しいルートの `route.test.ts` 12 本に「generated SSE fixture」のケースを足した（fixture は各ルートのテストが実際の応答から書き出す流儀で、`scripts/e2e/generate-sse-fixtures.mjs` 単体では生成できない。既存の fixture には差分なし）。`.json` の fixture 5 本（`analysis-status`、`helpdesk-tickets`、`mcp-compare`、`mcp-servers`、`requirements-session`）を足した。要件のセッション ID は `crypto.randomUUID` を固定値に差し替えて決定的にし、MCP の許可ルート（`mkdtemp` の一時ディレクトリ）は `/srv/mcp-workspace` に置換した（置換以外の加工はない）。(b) `biome.json`: 生成した fixture（`apps/web/e2e/fixtures`）を対象から外した。`JSON.stringify` の出力は Biome の整形と一致せず、生成物を手で整形しない規則と衝突するため。(c) 35.5 の実サーバー確認で見つかった実バグ: `/mcp` のページが先に描画されると、ページ側のバンドルが作った MCP レジストリのツールを、Route Handler 側のバンドルの `buildToolSet` が「`defineAciTool` で定義されていない」として 400 で拒否した。`packages/ai-core/src/aci/define-tool.ts` の定義済みツールの印を `globalThis` の `Symbol.for` キーの `WeakSet` に移した（テスト付き。モジュールが複数コピーになる前提の 2 コピーのテスト）。(d) `FigureView`・`TableView` が上限のために `@platform/ai-core/config` を import し、その `index` が環境変数スキーマの秘密名（`LANGFUSE_*`）をブラウザのバンドルに引き込んだ（`client-bundle` が検出）。上限を props にし、ページ（サーバー）から渡す形にした（`AnalysisPanel` の `limits`）。(e) `CouncilPanel` のペルソナのチェックボックスにフォーカスの輪郭（2px 以上）を足した（`keyboard.spec.ts` の 3:1 検査が検出）。(f) W7 の敵対的レビュー（`.sdd/reviews/003-domain-agents-impl-w7-review-2026-10-25.md`、REQUEST_CHANGES）の修正で触れた範囲。F-1: `apps/web/lib/server/platform.ts` の `getHelpdeskStore` が `mock` のときだけ FAQ を投入する（`ensureMockFaq`。サンプルのチケットは入れず、最初のチケットは `T-0001` のまま。`local`・`live` は投入しない）。F-4: 要件のメッセージ API の 409 に `error.details.reason`（`completed` / `busy`）を足した（`messages/route.ts`、`lib/server/errors.ts` の公開 details の許可リスト）。F-6: `aci/define-tool.ts` の定義済みツールの印を、置き換え不可・削除不可の `globalThis` のホルダーにし、本物の `WeakSet` 以外は拒否する（`define-tool-holder.test.ts`）。F-7: `errors.ts` の `PlatformError` に `Symbol.for` の印と `Symbol.hasInstance` を足し、ページとルートで別コピーになったモジュール間でも `instanceof PlatformError` が成り立つようにした（エラーの分類のためで、セキュリティ境界ではない）。`aci/tool-set.ts` の `latchOfToolSet` はコメントだけ（組み立てとエージェントの生成が同じコピーにある前提）。F-8: `mcp-servers.json` を手書きの値ではなく本物の `connectMcpServers` から生成する形にし、`e2e/mcp.spec.ts` の文言を製品の文言に直した。
- **共有ファイルの編集者**（波をまたぐファイルは、列挙したタスクだけが編集し、記載の順に行う。各タスクは前のタスクの完了後に行う。この順序が波をまたぐ依存になるため、W2〜W6 は並行せず、W2 → W3 → W4 → W5 → W6 の順に進める）。
  - `packages/ai-core/package.json`: 1.2 だけ（依存 4 件と `exports` の 8 サブパス。参照先の `index.ts` は各領域の最後のタスクが作る）。
  - `mise.toml`: 6.3（`test:container`、センチネル）→ 11.2（`check:repo-rules --only` に `mcp-import-scope`）→ 13.4（`seed:samples`）→ 17.8（`sandbox:build`）→ 20.2（`check:repo-rules --only` に `sandbox-import-scope`）（この順）。
  - `stryker.config.mjs`: 各波の締めの 7.1 → 11.2 → 16.1 → 20.2 → 24.1 → 28.1 → 42.2 だけ（この順）。
  - `packages/ai-core/src/models/gateway.ts` と `gateway.test.ts`: 2.2（秘匿の対象）と、シナリオを作る 10.1、15.1、18.5、22.5、27.1（この順）。
  - `packages/ai-core/src/mock/index.ts` と `mock/m3-scenarios.test.ts`: 6.4 と、上記のシナリオのタスク（同じ順）。
  - `apps/web/lib/server/platform.ts` と `platform.test.ts`: 10.2、15.2、19.1、23.1、27.2（この順）。
  - `apps/web/lib/server/domain-stream.ts` と `domain-stream.test.ts`: 15.2（作成）、19.4、23.2、27.3（この順）。
  - `apps/web/next.config.ts` と `apps/web/e2e/real-server.spec.ts`: 11.1、20.1、23.4、35.5（この順）。
  - `packages/ai-core/src/rag/db/schema.ts`、`schema.db.test.ts`、`client.pg.test.ts`: 13.1、26.2（この順）。
  - `packages/ai-core/src/aci/index.ts`: 3.1、4.8。`packages/ai-core/src/agents/index.ts`: 5.2。`scripts/seed-samples.ts`: 13.4、27.9。
  - `.sdd/steering/`、`AGENTS.md`、`specs/curriculum/changes-from-drafts.md`: 41.x だけ。
  - `specs/003-domain-agents/research.md`: 追記のみ（セクションを足す。既存の記述を書き換えない）。

### ID 対応表

| ID | 対応する見出し |
|---|---|
| `REQ-001`〜`REQ-006` | spec.md の `### Requirement 1`〜`### Requirement 6`（要件グループ単位。受け入れ基準単位の詳細は `_Requirements:_` を見る） |
| `C1`〜`C16` | plan.md の `### C_N <名前>`（実在する見出し。`DES-#.#` の代わりにこの一次 ID を使う。001 の `C1`〜`C22`、002 の `C1`〜`C18` とは別の番号） |
| `CL-1`〜`CL-23` | plan.md「Clarifications」の決定 |
| `ADR-1`〜`ADR-10`、`R-1`、`S-1`〜`S-6` | research.md の決定とリスク、plan「先に確かめること」の spike |

## 進捗

| 波 | 大タスク | 状態 | ファイル |
|---|---|---|---|
| spike・W1 基盤 | 1 spike と依存の宣言、2 設定・ゲートウェイ、3 致命的エラーとラッチ、4 ACI の検査と補助、5 TokenLedger と観測口、6 ポート・規則・枠、7 W1 の締め | 完了（2026-10-18） | [tasks-comp-w1.md](tasks-comp-w1.md) |
| W2 MCP・ファイル | 8 ファイル操作と自作 MCP サーバー、9 MCP クライアントアダプター、10 MCP の HTTP 入口、11 実サーバー確認と W2 の締め | 完了（2026-10-18） | [tasks-comp-w2.md](tasks-comp-w2.md) |
| W3 ヘルプデスク | 12 純関数とワークフロー部品、13 DB と永続化、14 runHelpdesk、15 HTTP 入口、16 W3 の締め | 完了（2026-10-18） | [tasks-comp-w3.md](tasks-comp-w3.md) |
| W4 サンドボックス・分析 | 17 サンドボックス提供者、18 データ分析、19 HTTP 入口、20 実サーバー確認と W4 の締め | 完了（2026-10-18） | [tasks-comp-w4.md](tasks-comp-w4.md) |
| W5 リサーチ | 21 arXiv クライアント、22 Supervisor とサブエージェント、23 HTTP 入口、24 W5 の締め | 完了（2026-10-19） | [tasks-comp-w5.md](tasks-comp-w5.md) |
| W6 要件・マーケティング | 25 要件インタビュー、26 マーケティング、27 HTTP 入口、28 W6 の締め | 完了（2026-10-25 に移行） | [tasks-comp-w6.md](tasks-comp-w6.md) |
| W7 画面と E2E | 29 MCP 画面、30 ヘルプデスク画面、31 分析画面、32 リサーチ画面、33 要件画面、34 マーケティング画面、35 トップ導線と E2E、36 W7 の締め | 完了（2026-10-29 に移行） | [tasks-comp-w7.md](tasks-comp-w7.md) |
| W8 評価・解説・統合 | 37 回帰テスト、38 能力テスト、39 `local`・`container` での実測、40 解説、41 トレーサビリティ・ステアリング、42 最終統合 | 着手中 | [tasks.md](tasks.md) |

**波の依存**（plan「Implementation Waves」）: 波は spike・W1 → W2 → W3 → W4 → W5 → W6 → W7 → W8 の順に 1 つずつ進め、波の間では並行しない。
W2〜W6 は、共有ファイルを編集するタスクの順序（上記「共有ファイルの編集者」）が波をまたぐ `_Depends:_` になっているため、互いに独立ではない
（例: シナリオ 10.1 → 15.1 → 18.5 → 22.5 → 27.1、組み立て 10.2 → 15.2 → 19.1 → 23.1 → 27.2、ストリームの写像 15.2 → 19.4 → 23.2 → 27.3、
実サーバー確認 11.1 → 20.1 → 23.4 → 35.5）。W7 は W2〜W6 の API に、W8 は W7 に依存する。
spike は依存する波の着手前に終える（S-1 は 3.x の前、S-2・S-3・S-6 は W2 の前、S-4・S-5 は W4 の前、S-2 は W5 の前）。
並行してよいのは、同じ波の中で `(P)` を付けたタスクだけである。

**plan の波の割り当てからの調整**:

- `docs:check` の必須トピック（`scripts/check-docs.mjs` の `REQUIRED_TOPICS` に `3-1`〜`3-6`）は plan では W1 だが、解説が無い間に足すと `docs:check`
  （`gate` の最終段）が失敗するため、解説が揃う W8 の 40.8 に移した。
- `apps/web/lib/server/sessions.ts` と `upload.ts` は、最初の利用者である W4（分析）の 19.2・19.3 で作る（W2 に置いても使われない）。
  要件インタビュー（W6）は 19.3 の `createSessionRegistry` を再利用する。
- `serverExternalPackages` の確定（リスク R-1）は、W2 の 11.1 で `@ai-sdk/mcp` と `@modelcontextprotocol/server`、W4 の 20.1 で `@e2b/code-interpreter`、
  W5 の 23.4 で `fast-xml-parser` の順に、関わる波の中で行う。6 画面の実サーバー確認は W7 の 35.5 に置く（画面は W7 で作るため）。
- 完成タグ（`module/3-1`〜`3-6`）は、解説の完成後に W8 の 42.3 でローカルに付け、push は人が行う。

## gate への段階的な結線

gate の各段は「走査 0 件で失敗」するため、検査対象がまだない規則を最初から入れると、実装の途中で必ず失敗する（001・002 と同じ）。
規則そのものは W1 の 6.2 で実装して単体テストで守り、`mise.toml` の `check:repo-rules --only` へは、走査対象が揃う波の締めで加える。
一度加えた規則は外さない。`gate` の段の順序は変えない。

| 時点 | 締めのタスク | `check:repo-rules --only` に加える規則 | その他の結線 |
|---|---|---|---|
| W1 の締め | 7.1、7.2 | —（`workflow-no-agent-loop` の対象拡張は 6.2 で実装済み。対象ファイルが無い間は存在するものだけを走査する） | `stryker.config.mjs` に `description-check.ts` |
| W2 の締め | 11.2 | `mcp-import-scope`（`mcp/` が揃う） | `stryker.config.mjs` に `files/path.ts`、`mcp/risk.ts` |
| W3 の締め | 16.1 | —（`workflow-no-agent-loop` が `helpdesk/` の対象ファイルを走査することを確かめる） | `stryker.config.mjs` に `helpdesk/plan-schema.ts`、`scheduler.ts` |
| W4 の締め | 20.2 | `sandbox-import-scope`（`sandbox/` が揃う） | `stryker.config.mjs` に `analysis/upload-check.ts`、`output-parser.ts` |
| W5 の締め | 24.1 | — | `stryker.config.mjs` に `research/citations.ts`、`budget.ts` |
| W6 の締め | 28.1 | —（`workflow-no-agent-loop` が `requirements/`、`marketing/` の対象ファイルを走査することを確かめる） | `stryker.config.mjs` に `marketing/moderator.ts`、`recommend.ts` |
| W7 の締め | 36.1 | — | — |
| W8 の締め | 42.1、42.2 | — | `docs:check` は 40.8 で 3-1〜3-6 を必須にした状態で成功する。`stryker.config.mjs` の最終確認 |

## 004 への引き継ぎ事項

plan CL-21 の定めにより、次を記録する。解説（`docs/modules/3-3-data-analysis-agent.md` の「確認できていないこと」）にも同じ内容を書く（40.3）。

- **E2B のサンドボックスの外向き通信**: `runPython`（`risk: "read-only"`）はサンドボックスの中だけで作用するが、E2B の外向き通信の既定が許可なら、
  サンドボックス内のコードが学習者のデータを外部へ送れる。**S-4（1.5）の結果: E2B の文書は「既定で外向き通信が可能」と述べる**
  （`allowInternetAccess: false` で無効にできる。キーが無く実測は未。`research.md` の S-4 の節）。004 Req 4（承認ゲート）で `runPython` のリスク区分と
  ネットワーク制限を再検討する。Docker は `NetworkMode: none` のため該当しない。
- **外部コンテンツの汚染状態**（CL-10）: M3 は取り込みの記録口（5.2）だけを置く。判定と遮断は 004 Req 4.8 で実装する。
- **MCP の注釈は信頼しない前提**（ADR-7）: 注釈のないツールは `destructive` として登録しない。004 の承認ゲートが `risk` を入力にする。

## 人が行うこと

plan「人が行うこと」のとおり。Docker での `mise run sandbox:build` と `mise run test:container`（17.8、39.3。W4 では Rancher Desktop の Docker で実行済み。Rancher Desktop のソケットは `~/.rd/docker.sock` で探索先に無いため、`DOCKER_HOST=unix://$HOME/.rd/docker.sock` を設定する。Docker Desktop や Linux のネイティブでの確認は人が行う）、E2B のキーを使う分析と GitHub のトークンを使う
MCP のハンズオンの確認と記録（任意。1.4、1.5、39.3）、spike の結果の確認（特に S-1 と S-5）、Clarifications の★の承認、完成タグの push。

## W1・W2 からの持ち越し

W1・W2 の敵対的レビューの指摘のうち、対応先の波へ送ったもの（`.sdd/reviews/003-domain-agents-impl-w1-review-2026-10-18.md` の「Responses」と、`.sdd/reviews/003-domain-agents-impl-w2-review-2026-10-18.md`）。

- W1 F-16（`test:container` のスキップ補助とネットワーク遮断の例外）: 17.x の境界に `tooling/vitest/*` を足して対応する。
- W1 F-17（`WORKFLOW_FILES` の取りこぼし）: 16.1 と 28.1 で走査件数の検査を足す。
- W1 F-10・F-11（`TokenLedger` の `RunObserver` 接続、取り込み記録の `source` の上限）: 22.x。
- W1 F-14（M1 の説明文の改訂で録画のキーが変わる）: 40.1 の 3-1 の「移植時の変更点」に書く。
- W2 で意図して持ち越した制約（plan C5 に記載）: F-1（ファイルサーバー 1 プロセスにつき索引 1 つ。単一の学習者前提）、F-3（再接続なし。再起動まで）、F-10（確認と使用の間の窓。`writeFile`・`deleteFile` はエージェントに登録しない）、F-15（`allowImportingTsExtensions` が workspace 全体）、F-16（何も読まなかった比較実行も `completed`）。W2 の修正の fresh な再レビューは未実施。

## W3 からの持ち越し

W3 の敵対的レビュー（`.sdd/reviews/003-domain-agents-impl-w3-review-2026-10-18.md`）のうち、修正せず送ったもの。

- F-8: `mock` の Web アプリの知識ベースに FAQ が入らず、画面とサンプルの問い合わせが「根拠なし」になる。35.x（画面・E2E）で、`mock` の DB 作成時に FAQ を投入する。
- F-9: 投入した FAQ が `kb:` の名前空間を学習者の文書と共有する。F-12: 検出した認証情報の種別は DB に残らない（ストリームとログのみ）。F-20: ヘルプデスク全体の時間・トークンの予算なし。F-21: 全文書名をプランナーへ渡す。F-22: 停止したチケットを後で完了できる点と「再開は行わない」の関係。
- 受け入れた制限: 改訂の追記のみは API 上の保証で DB の trigger はない（F-5）。ID 採番の競合は実際の並行書き込みでは未検証（F-15）。

## W4 からの持ち越し

W4 の敵対的レビュー（`.sdd/reviews/003-domain-agents-impl-w4-review-2026-10-18.md`）のうち、修正せず送ったもの。修正後の fresh な再レビューは未実施。

- CL-26（修正回数の数え方。初回 + 3 回の修正 = 最大 4 回の実行）は 2026-10-19 に人が確認し、この読みで確定した（`maxFixAttempts` は 3 のまま）。
- F-14（`.xls` の検査が OLE2 内の "Book" の UTF-16LE バイト列で通る）と F-15（20 MiB のアップロードのメモリ上のコピーが約 5 つ）は受け入れた制限。F-17（E2B の外向き通信）は 004 へ。
- F-18（E2B は実行間で状態を保ち、タイムアウトで途中の出力を落とす）は文書化のみ。F-21（接続断で実際の Next.js サーバーが `request.signal` を abort するか）は未検証で、35.x の E2E で確かめる。

## W5 からの持ち越し

W5 の敵対的レビュー（`.sdd/reviews/003-domain-agents-impl-w5-review-2026-10-19.md`）の修正後の fresh な再レビューは未実施。

- arXiv の実応答と 429 / 503 / `Retry-After` の実挙動は未実測で、フィクスチャは仕様と推測に基づく（research.md に明記）。
- CL-26 は 2026-10-19 に確定済み（W4 の持ち越しを参照）。

## W6 からの持ち越し

W6 の敵対的レビュー（`.sdd/reviews/003-domain-agents-impl-w6-review-2026-10-24.md`、REQUEST_CHANGES）の修正後の fresh な再レビュー（`...-2026-10-25.md`）は、修正 9 件の成立を確かめ、記録の不備を主に指摘した（REQUEST_CHANGES、ドキュメントのみ）。持ち越し先は次のとおり（括弧内は 1 回目のレビューの番号）。

- 37.x（W8）: 既定のラウンド数を定数だけで確かめるテスト（F-16）を、合意しない下書きで 3 ラウンドと `max-rounds` を確かめるものに直す。予算の INVARIANT テストが skip する組み合わせ（モデレーターが大きいケース。2 回目 F-7）を埋める。`recommend` の往復テストは `readUIMessageStream` で組み立てた assistant メッセージを使う（2 回目 F-8）。
- 41.x（W8）: `CouncilRound`・`data-council-result` の plan との型の差（F-20）を plan の Data Model とストリームの表に同期する。`council.ts` の PROVE と、Stryker の対象に入れるかの判断（2 回目 F-13）。
- 35.x（W7）: 確定されなかったラウンドのプレビューを、ストリームのエラー時に破棄する（F-17、2 回目 F-4）。文書は生の HTML を描画しない（F-18）。
- 40.x（W8、3-6 の解説）: 合議は `cooperateByRole` を 1 役割ずつ呼ぶため、M2 の hand-off は名目上である（2 回目 F-14。plan に記録・承認済み）。
- 受け入れた制限: モデルの自由記述が対象外の商品や価格に触れうる（F-19）、雑談メモが「未確認事項」に残る（F-22）、`seedMarketing` が id だけで upsert する（F-23）、予算不足で呼ばれなかったペルソナが `missing` に入らない・欠けたラウンドでもモデレーターを呼ぶ（2 回目 F-5、F-6）、`/messages` のロックが module スコープ（2 回目 F-9）、セッション上限の競合と mock / local で枠を埋められること（2 回目 F-10）、council ルートは 429 より前に DB を読む（F-13、2 回目 F-3）。
- 修正済み（2 回目 F-2、F-11）: plan の矛盾と古いコメント。

## W7 からの持ち越し

W7 の敵対的レビュー（`.sdd/reviews/003-domain-agents-impl-w7-review-2026-10-25.md`、REQUEST_CHANGES）の修正後の fresh な再レビューは未実施。

- F-11（実サーバーで、ブラウザの切断が `request.signal` を abort するか。W4 F-21 の続き）: モックのサンドボックスが速すぎて観測できない。遅いモックのシナリオか、分析のストリームの間隔の指定が要る。42.x の前に決める。
- F-17（入力例と上限の重複）・F-18（未投入の判定を文言でなく `details` で行う）: 40.x（W8）で扱う。
- 例外 (13) の人の事後承認と plan への同期は 2026-10-25 に完了した。
- 受け入れた制限: `/recommend` の再試行の送信本文に重複がないことは、`useChat` をモックしたテストでは確かめていない。F-7 は HTTP 経由で再現できず、単体テストだけが守る。
## 現在の波: W8 評価・解説・統合（大タスク 37〜42）

`eval-suite` のテスト（回帰と能力）、`local` と `container` での実行と結果の記録（高水準と低レベルの比較、修正ループ、引用の遵守、合意に達する割合、
単一エージェントとのトークン比較）、解説 3-1〜3-6、`phase-3.md`、`traceability.md`、ステアリングと `AGENTS.md` の更新、`changes-from-drafts.md` への差分、
`gate:repeat`、完成タグを作る。`local` と `container` の結果は gate の外であることを解説に明記する（スキップを合格に数えない）。

37.1〜37.4 は並列に進められる。38.1〜38.4 は並列に進められる。40.1〜40.6 は 39.x の後に並列に進められる。

---

## 37. 回帰テスト（gate、`mock`）

配管を `mock` で決定論的に検証する。品質の評価ではない。

_Boundary:_ `packages/eval-suite/tests/regression/*`
_Depends:_ 11.1, 15.3, 19.6, 22.4, 27.8
_Requirements:_ 1.3, 1.5, 2.1, 2.6, 2.7, 4.8, 6.5
_Traces:_ REQ-001, REQ-002, REQ-004, REQ-006, C16

- [ ] 37.1 (P) `tests/regression/mcp-fatal-stop.test.ts`: 致命的エラー（許可ルート外のパスの読み取り）でツール呼び出しが止まり、停止理由が `error` になり、後続のツールが実行されない配管を、`mock` と自作サーバー（同一プロセスの接続）で検証する
  _Boundary:_ `packages/eval-suite/tests/regression/mcp-fatal-stop.test.ts`
  _Depends:_ 10.4, 8.4
  _Requirements:_ 1.3, 1.5
  _Traces:_ REQ-001, C16
- [ ] 37.2 (P) `tests/regression/helpdesk-plan.db.test.ts`: 問い合わせ → 計画 → 実行 → 判断 → チケット保存（`resolved` と `escalated`）の配管を、`mock` と PGlite で検証する
  _Boundary:_ `packages/eval-suite/tests/regression/helpdesk-plan.db.test.ts`
  _Depends:_ 14.1, 15.1
  _Requirements:_ 2.1, 2.6, 2.7
  _Traces:_ REQ-002, C16
- [ ] 37.3 (P) `tests/regression/research-budget.test.ts`: Supervisor の呼び出し回数と共有トークン予算の上限（`maxSubagentCalls: 2` に下げて検証する）を `mock` で検証する
  _Boundary:_ `packages/eval-suite/tests/regression/research-budget.test.ts`
  _Depends:_ 22.5
  _Requirements:_ 4.8
  _Traces:_ REQ-004, C16
- [ ] 37.4 (P) `tests/regression/marketing-catalog.db.test.ts`: レコメンドがカタログの商品 ID だけを返し、カタログ外の ID が除去されて件数が記録される配管を、`mock` と PGlite で検証する
  _Boundary:_ `packages/eval-suite/tests/regression/marketing-catalog.db.test.ts`
  _Depends:_ 27.1, 26.7
  _Requirements:_ 6.5
  _Traces:_ REQ-006, C16

### Implementation Notes

- W6 からの持ち越し（tasks.md「W6 からの持ち越し」）: 既定のラウンド数のテスト（F-16）、INVARIANT の skip、recommend の往復テスト。

---

## 38. 能力テスト（`local` 専用）

実モデルの品質を観察する。gate では理由付きでスキップされ、合格に数えない。

_Boundary:_ `packages/eval-suite/tests/capability/*`
_Depends:_ 37.1, 37.2, 37.3, 37.4
_Requirements:_ 1.12, 3.3, 4.2, 4.5, 6.2
_Traces:_ REQ-001, REQ-003, REQ-004, REQ-006, C16

- [ ] 38.1 (P) `tests/capability/mcp-compare.local.test.ts`: 高水準ツール（`findAndReadFiles`）と低レベルの組み合わせのステップ数・トークン数の比較を観察する（Req 1.12）
  _Boundary:_ `packages/eval-suite/tests/capability/mcp-compare.local.test.ts`
  _Depends:_ 10.5
  _Requirements:_ 1.12
  _Traces:_ REQ-001, C16
- [ ] 38.2 (P) `tests/capability/analysis-fix.local.test.ts`: 実モデルが誤ったコードを修正して完走する割合を観察する。サンドボックスは疑似でなく、`local` で利用可能な提供者（Docker）を使い、無ければ理由付きでスキップする
  _Boundary:_ `packages/eval-suite/tests/capability/analysis-fix.local.test.ts`
  _Depends:_ 18.4, 17.8
  _Requirements:_ 3.3
  _Traces:_ REQ-003, C16
- [ ] 38.3 (P) `tests/capability/research-quality.local.test.ts`: Supervisor が子を呼び分け、未知の論文を引用しない割合を観察し、同じ課題を単一エージェントで行った場合とのトークン使用量を比較する（3-4 の解説に使う。憲章 原則 1）
  _Boundary:_ `packages/eval-suite/tests/capability/research-quality.local.test.ts`
  _Depends:_ 22.4
  _Requirements:_ 4.2, 4.5
  _Traces:_ REQ-004, C16
- [ ] 38.4 (P) `tests/capability/council-agreement.local.test.ts`: 合議が上限内で合意に達する割合を観察し、単一エージェントで同じ文案を改善した場合とのトークン使用量を比較する（3-6 の解説に使う。憲章 原則 1）
  _Boundary:_ `packages/eval-suite/tests/capability/council-agreement.local.test.ts`
  _Depends:_ 26.7
  _Requirements:_ 6.2
  _Traces:_ REQ-006, C16
- [ ] 38.5 `tests/capability/README.md`: M3 の評価の置き場所と gate / `local` / `container` の線引きを足す
  _Boundary:_ `packages/eval-suite/tests/capability/README.md`
  _Depends:_ 38.1, 38.2, 38.3, 38.4
  _Requirements:_ 1.12
  _Traces:_ REQ-001, C16
  _Verify:_ README の記述と、実在するテストのファイル名が一致する（`mise run docs:check` が成功する）

### Implementation Notes

---

## 39. `local`・`container` での実測と記録

gate の外にある実機の結果を research.md と解説の根拠に記録する。実行できない環境では「未実行」と明記する。

_Boundary:_ `specs/003-domain-agents/research.md`
_Depends:_ 38.5
_Requirements:_ 1.12, 3.1, 3.3, 4.2, 6.2
_Traces:_ REQ-001, REQ-003, REQ-004, REQ-006, C16

- [ ] 39.1 `mise run test:local`（Ollama）で 38.1〜38.4 を実行し、結果（高水準と低レベルのステップ数・トークン数、修正ループの完走率、引用の遵守率、合意に達する割合、単一エージェントとのトークン比較）を、使用したモデルとともに research.md に追記する。Ollama が使えない環境では未実行と明記し、解説にはその旨を書く（実測値を捏造しない）
  _Boundary:_ `specs/003-domain-agents/research.md`
  _Depends:_ 38.5
  _Requirements:_ 1.12, 3.3, 4.2, 6.2
  _Traces:_ REQ-001, REQ-003, REQ-004, REQ-006, C16
  _Verify:_ research.md に実行日、モデル、各観察値（または「未実行」と理由）が書かれている
- [ ] 39.2 `mise run sandbox:build` と `mise run test:container`（Docker）の結果、macOS のソケットの結果（S-5）、E2B（`E2B_API_KEY`）と GitHub の MCP（`GITHUB_TOKEN`）のハンズオンの結果（任意）を、research.md の該当 spike の節に追記する。人が実行する項目で、実行されなかったものは「未実行」と書く
  _Boundary:_ `specs/003-domain-agents/research.md`
  _Depends:_ 39.1
  _Requirements:_ 3.1, 3.8
  _Traces:_ REQ-001, REQ-003, C16, S-4, S-5, S-6
  _Verify:_ research.md の S-4・S-5・S-6 の節に実行日と結果（または「未実行」）が書かれている

### Implementation Notes

---

## 40. 解説（モジュール 3-1〜3-6、C16）

各モジュールの解説を日本語で書く。ハンズオンは `local` / `live` を原則とし、必要なサービス（Ollama、Docker、`E2B_API_KEY`、`GITHUB_TOKEN`）を各手順に明示する。
習熟度チェックリストはテスト名を参照し、`local` と `container` 専用のテストを参照する項目はスキップされうることを明記する。「本番ではどう作るか」節でハブ
`vaz-agentic-ai-next` の手法ページへリンクし、「確認できていないこと」に gate が保証しないものを書く。

_Boundary:_ `docs/modules/3-1-aci-and-mcp.md`, `docs/modules/3-2-helpdesk-agent.md`, `docs/modules/3-3-data-analysis-agent.md`, `docs/modules/3-4-hierarchical-research.md`, `docs/modules/3-5-requirements-interview.md`, `docs/modules/3-6-marketing-support.md`, `docs/phases/phase-3.md`, `docs/modules/index.md`, `scripts/check-docs.mjs`, `scripts/check-docs.test.mjs`
_Depends:_ 36.1, 39.2
_Requirements:_ 1.1, 1.17, 2.1, 3.1, 4.1, 5.1, 6.1
_Traces:_ REQ-001, REQ-002, REQ-003, REQ-004, REQ-005, REQ-006, C16

- [ ] 40.1 (P) `docs/modules/3-1-aci-and-mcp.md`: ACI 設計（説明文の形式、修正ガイド、`concise` / `detailed`、意味のある識別子、思考ツール、高水準ツール）、MCP（自作サーバー、許可リスト、注釈とリスク区分、致命的エラーのラッチ、書き込み系を登録しない理由）を、移植時の変更点・本番ではどう作るか（`docs/guide/mcp.md`）・確認できていないこと（GitHub の MCP の注釈、S-6）とともに書く
  _Boundary:_ `docs/modules/3-1-aci-and-mcp.md`
  _Depends:_ 36.1, 39.2
  _Requirements:_ 1.1, 1.3, 1.5, 1.7, 1.8, 1.12, 1.16, 1.17
  _Traces:_ REQ-001, C16
- [ ] 40.2 (P) `docs/modules/3-2-helpdesk-agent.md`: Plan-and-Execute（計画の検査、スケジューラ、`continue` / `replan` / `finish`、差分）、チケットとステップ上限、認証情報の形状検査、計画をワークフローで書き `ToolLoopAgent` を使わない理由（ADR-9）、憲章 原則 1 の⚠ 2 の記録を書く
  _Boundary:_ `docs/modules/3-2-helpdesk-agent.md`
  _Depends:_ 36.1, 39.2
  _Requirements:_ 2.1, 2.2, 2.3, 2.4, 2.6, 2.7, 2.8, 2.10
  _Traces:_ REQ-002, C16
- [ ] 40.3 (P) `docs/modules/3-3-data-analysis-agent.md`: サンドボックス（E2B と Docker の選択順、隔離の制限）、アップロードの検査、修正ループ（3 回）、図表の受け渡し（目印の行）、アイドル破棄を書く。**「確認できていないこと」に E2B の外向き通信の既定（S-4）と、004 への引き継ぎ事項（`runPython` のリスク区分とネットワーク制限の再検討。CL-21）を書く**
  _Boundary:_ `docs/modules/3-3-data-analysis-agent.md`
  _Depends:_ 36.1, 39.2
  _Requirements:_ 3.1, 3.2, 3.3, 3.4, 3.5, 3.7, 3.8, 3.9
  _Traces:_ REQ-003, C16, CL-21
- [ ] 40.4 (P) `docs/modules/3-4-hierarchical-research.md`: Supervisor と 3 つのサブエージェント（Agent-as-a-Tool）、要約だけを返す境界、共有予算と呼び出し回数、引用の照合、arXiv の利用規約（3 秒間隔、キャッシュ）を書き、**単一エージェントとのトークン使用量の比較（39.1 の実測または「未実行」）を記録する**（憲章 原則 1 の⚠ 1）
  _Boundary:_ `docs/modules/3-4-hierarchical-research.md`
  _Depends:_ 36.1, 39.1
  _Requirements:_ 4.1, 4.4, 4.5, 4.6, 4.7, 4.8, 4.10
  _Traces:_ REQ-004, C16
- [ ] 40.5 (P) `docs/modules/3-5-requirements-interview.md`: ペルソナ面接、十分性の判定（`missing` の検査）、ラウンド上限、固定の章立ての要件定義書、状態をセッションに置く理由を書く
  _Boundary:_ `docs/modules/3-5-requirements-interview.md`
  _Depends:_ 36.1, 39.2
  _Requirements:_ 5.1, 5.2, 5.3, 5.4, 5.5, 5.6
  _Traces:_ REQ-005, C16
- [ ] 40.6 (P) `docs/modules/3-6-marketing-support.md`: ラウンドロビンの合議、合意の判定（モデルの宣言とコードの検査）、プロファイルのマージ、カタログ照合を書き、**単一エージェントとのトークン使用量の比較（39.1 の実測または「未実行」）を記録する**（憲章 原則 1 の⚠ 1）
  _Boundary:_ `docs/modules/3-6-marketing-support.md`
  _Depends:_ 36.1, 39.1
  _Requirements:_ 6.1, 6.2, 6.4, 6.5
  _Traces:_ REQ-006, C16
- [ ] 40.7 `docs/phases/phase-3.md` と `docs/modules/index.md`: Phase 3 の成熟度の水準（IBM の Level 2〜3）とモジュール一覧、3-1〜3-6 を「提供済み」にし、解説とタグへのリンクを足す
  _Boundary:_ `docs/phases/phase-3.md`, `docs/modules/index.md`
  _Depends:_ 40.1, 40.2, 40.3, 40.4, 40.5, 40.6
  _Requirements:_ 1.1, 2.1, 3.1, 4.1, 5.1, 6.1
  _Traces:_ REQ-001, REQ-002, REQ-003, REQ-004, REQ-005, REQ-006, C16
- [ ] 40.8 `scripts/check-docs.mjs` の `REQUIRED_TOPICS` に `3-1`〜`3-6` を足す + `check-docs.test.mjs` に、新しい必須トピックが欠けたときに失敗すること、習熟度チェックリストのテスト名が実在することを先に足す。`005-hub-alignment` の解説リンクの検査が入っていれば、3-1〜3-6 にも適用されることを確認する
  _Boundary:_ `scripts/check-docs.mjs`, `scripts/check-docs.test.mjs`
  _Depends:_ 40.7
  _Requirements:_ 1.1, 2.1, 3.1, 4.1, 5.1, 6.1
  _Traces:_ REQ-001, REQ-002, REQ-003, REQ-004, REQ-005, REQ-006, C16
  _Verify:_ `mise run docs:check` が成功する。`mise run gate` が成功する

### Implementation Notes

---

## 41. トレーサビリティ・ステアリング・状態の更新

受け入れ基準 → テストの対応、決定の反映、プロジェクトの状態を更新する。

_Boundary:_ `specs/003-domain-agents/traceability.md`, `.sdd/steering/tech.md`, `.sdd/steering/structure.md`, `AGENTS.md`, `specs/curriculum/changes-from-drafts.md`
_Depends:_ 40.8
_Requirements:_ 1.1, 3.8, 6.6
_Traces:_ REQ-001, REQ-003, REQ-006, C16

- [ ] 41.1 `specs/003-domain-agents/traceability.md`: Test の列を、受け入れ基準ごとにテストのファイル名（`*.local.test.ts` と `*.container.test.ts` はスキップされうることを併記）で埋め、「gate が保証しないもの」（E2B の実機、GitHub の MCP の注釈、実 Docker、実モデルの品質、arXiv の実応答、複数インスタンス、認証）を Gaps に明記する。Commit の列は `/sdd-ship` が埋める
  _Boundary:_ `specs/003-domain-agents/traceability.md`
  _Depends:_ 40.8
  _Requirements:_ 1.1, 3.8
  _Traces:_ REQ-001, REQ-003, C16
- [ ] 41.2 `.sdd/steering/tech.md` と `structure.md`: サンドボックス（E2B と Docker の選択）、MCP の決定（注釈からリスクを決める、許可リスト）、arXiv の利用規約、`*.container.test.ts`、新しい規則 `mcp-import-scope`・`sandbox-import-scope`、`ai-core` の新しい領域 8 つ、`apps/web` の新しいルートと `lib/server/` の追加を反映する
  _Boundary:_ `.sdd/steering/tech.md`, `.sdd/steering/structure.md`
  _Depends:_ 41.1
  _Requirements:_ 3.8
  _Traces:_ REQ-003, C16
- [ ] 41.3 `AGENTS.md`: プロジェクトの状態（M3 の実装済みの範囲、`*.container.test.ts`、新しい規則、`workspace/`、`mise run sandbox:build` / `test:container` / `seed:samples`、`gate` の新しい検査数）を更新する。更新後、旧い件数や名前（規則の数 11 など）を grep して残っていないことを確認する
  _Boundary:_ `AGENTS.md`
  _Depends:_ 41.2
  _Requirements:_ 1.1
  _Traces:_ REQ-001, C16
- [ ] 41.4 `specs/curriculum/changes-from-drafts.md`: M3 で実測により確定した API・設定の差分（`dockerode` を採らないこと、MCP の注釈の扱い、`@ai-sdk/mcp` を 2.0.76 に固定した理由、Python 側の版など）を追記する。`specs/curriculum/` の本文が spec と食い違う箇所があれば、spec を正としてカリキュラム側を直す
  _Boundary:_ `specs/curriculum/changes-from-drafts.md`
  _Depends:_ 41.3
  _Requirements:_ 3.8
  _Traces:_ REQ-003, C16

### Implementation Notes

- W6 からの持ち越し（tasks.md「W6 からの持ち越し」）: `CouncilRound`・`data-council-result` の型の同期、`council.ts` の PROVE。

---

## 42. 最終統合

_Boundary:_ `stryker.config.mjs`, `specs/003-domain-agents/research.md`
_Depends:_ 41.4
_Requirements:_ 1.4, 1.5, 3.9, 6.5
_Traces:_ REQ-001, REQ-003, REQ-006, C16

- [ ] 42.1 `mise run gate:repeat`（10 回、同じ判定）、`mise run test:mutation`、`mise run test:e2e`（3 エンジン）、`mise run audit`、`mise run secret-scan` を実行し、結果を research.md に引用する。失敗が M3 以前から存在する場合は、新しい失敗と分けて報告する
  _Boundary:_ `specs/003-domain-agents/research.md`
  _Depends:_ 41.4
  _Requirements:_ 1.5, 3.9
  _Traces:_ REQ-001, REQ-003, C16
  _Verify:_ 各コマンドの成功が research.md に引用されている。`gate:repeat` が 10 回とも同じ判定（成功）である
- [ ] 42.2 `stryker.config.mjs` の最終確認: plan のミューテーション対象（`resolveWorkspacePath`、`riskFromAnnotations`、`checkDescription`、`validatePlan`、`diffPlan`、`nextRunnable`、`parseSandboxOutput`、`checkUpload`、`checkCitations`、`createBudget`、`judgeAgreement`、`recommend` の照合）がすべて含まれていることを確かめ、足りないものを足す
  _Boundary:_ `stryker.config.mjs`
  _Depends:_ 42.1
  _Requirements:_ 1.4, 1.5, 3.9, 6.5
  _Traces:_ REQ-001, REQ-003, REQ-006, C16
  _Verify:_ `mise run test:mutation` が閾値 70 を満たす
- [ ] 42.3 完成タグ `module/3-1`〜`module/3-6` をローカルに付ける（push は人が行う）。すべてのサブタスクが `[x]` で、`mise run gate` と CI の `ci-status` が成功していることを確認してから付ける
  _Boundary:_ `specs/003-domain-agents/research.md`
  _Depends:_ 42.2
  _Requirements:_ 1.1
  _Traces:_ REQ-001, C16
  _Verify:_ `git tag -l 'module/3-*'` に 6 件が並ぶ。W8 の敵対的レビューの記録が `.sdd/reviews/003-domain-agents-impl-w8-review-*.md` にある

### Implementation Notes
