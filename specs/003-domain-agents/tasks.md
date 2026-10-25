# domain-agents（Milestone 3）— 実装タスク（索引）

`/sdd-tasks` が生成した。承認済みの [spec.md](spec.md)（WHAT）と [plan.md](plan.md)（HOW、C1〜C16、Implementation Waves spike・W1〜W8）から、
実装の波ごとに分割した。ルールは `~/.claude/sdd/rules/tasks-generation.md` と `~/.claude/sdd/rules/tasks-parallel-analysis.md`
に従う。並列モード（`--sequential` 未指定）。002 の `tasks.md` と同じ運用（索引 + 現在の波の全文、未着手の波は `tasks-wN.md`、
完了した波は `tasks-comp-wN.md`）を採る。

## ファイル構成

| ファイル | 内容 |
|---|---|
| `tasks.md`（本ファイル） | 表記規約、ID 対応表、進捗、gate への段階的な結線、004 への引き継ぎ事項、**現在の波**（W7）のタスク全文 |
| `tasks-w8.md` | 未着手の波のタスク全文。波が現在の波になるとき `tasks.md` へ移す |
| `tasks-comp-w1.md`〜`tasks-comp-w6.md` | 完了した波の保管先。波の完了時に作る |
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
| W7 画面と E2E | 29 MCP 画面、30 ヘルプデスク画面、31 分析画面、32 リサーチ画面、33 要件画面、34 マーケティング画面、35 トップ導線と E2E、36 W7 の締め | 着手中 | [tasks.md](tasks.md) |
| W8 評価・解説・統合 | 37 回帰テスト、38 能力テスト、39 `local`・`container` での実測、40 解説、41 トレーサビリティ・ステアリング、42 最終統合 | 未着手 | [tasks-w8.md](tasks-w8.md) |

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

## 現在の波: W7 画面と E2E（大タスク 29〜36）

6 つの画面（`/mcp`、`/helpdesk`、`/analysis`、`/research`、`/requirements`、`/marketing`）、ダッシュボード、Agent Inspector、プレビュー、SSE fixture の生成、
axe（light / dark）、キーボード、実サーバー E2E の拡張、トップページの導線を作る。W2〜W6 の API に依存する。画面は判断と検査を持たない（サーバーで行う）。
M1・M2 の画面の部品（shadcn/ui の基本部品、`ErrorBanner`、`useChat` の `parts` から縮約する方式）を再利用し、Tailwind v4 のテーマトークンの契約（root のコントラストテスト）を保つ。

各画面の部品タスクは互いに独立で、並列に進められる（29.x、30.x、31.x、32.x、33.x、34.x の部品タスク）。ページのタスクは同じ画面の部品の後に行う。

---

## 29. MCP 画面（`/mcp`）

チャット、サーバーの状態と読み込んだ・拒否したツール、許可リストの編集、比較の表示。

_Boundary:_ `apps/web/components/mcp/*`, `apps/web/app/mcp/page.tsx`
_Depends:_ 10.5
_Requirements:_ 1.3, 1.7, 1.10, 1.12, 1.15, 1.17
_Traces:_ REQ-001, C14

- [ ] 29.1 (P) `components/mcp/{ServerStatusList,AllowListEditor,CompareView}.tsx` + 各 `*.test.tsx`: サーバーごとの状態（`connected` / `unavailable` と理由）、読み込んだツールと拒否したツール（`write` / `destructive` / 注釈なし・説明文の形式の理由）、許可リストの編集（20 個の上限の表示）、高水準と低レベルの比較（ステップ数・トークン数・比率、失敗した側の表示）を作る。通知は `aria-live`、キーボードで操作できる。テストは `aria-live`、拒否の理由の表示、20 個の上限、キーボード操作を検査する
  _Boundary:_ `apps/web/components/mcp/ServerStatusList.tsx`, `apps/web/components/mcp/AllowListEditor.tsx`, `apps/web/components/mcp/CompareView.tsx`, `apps/web/components/mcp/ServerStatusList.test.tsx`, `apps/web/components/mcp/AllowListEditor.test.tsx`, `apps/web/components/mcp/CompareView.test.tsx`
  _Depends:_ 10.3, 10.5
  _Requirements:_ 1.7, 1.10, 1.12, 1.15, 1.17
  _Traces:_ REQ-001, C14
- [ ] 29.2 `components/mcp/McpPanel.tsx` と `app/mcp/page.tsx` + `McpPanel.test.tsx`: チャットの入力と応答、`finish` の停止理由（致命的エラーでは `error` と許可ルートのパスを含む学習者向けの文言）、思考ツールの切り替え、サーバー状態の取得と表示、入力例（`mock` のシナリオに対応する文）を作る。ページはサーバーで初期値（サーバー状態）を取得して渡す。テストは `error` の表示、思考ツールの切り替え、入力例を検査する
  _Boundary:_ `apps/web/components/mcp/McpPanel.tsx`, `apps/web/components/mcp/McpPanel.test.tsx`, `apps/web/app/mcp/page.tsx`
  _Depends:_ 29.1, 10.4
  _Requirements:_ 1.3, 1.7, 1.10
  _Traces:_ REQ-001, C14

### Implementation Notes

---

## 30. ヘルプデスク画面（`/helpdesk`）

問い合わせ、3 項目のダッシュボード（現在のタスク・完了タスク・修正された計画）、チケットの履歴。

_Boundary:_ `apps/web/components/helpdesk/*`, `apps/web/app/helpdesk/page.tsx`
_Depends:_ 15.4
_Requirements:_ 2.3, 2.4, 2.5, 2.6, 2.7
_Traces:_ REQ-002, C14

- [ ] 30.1 (P) `components/helpdesk/{PlanDashboard,TicketList}.tsx` + 各 `*.test.tsx`: 「現在のタスク」「完了タスク」「修正された計画」（変更前後の差分）、ステップ数と判断理由、チケット一覧（状態、解決の回答、未解決の理由、上限到達の `open`）を作る。状態の更新は `aria-live`。テストは 3 項目の表示、差分の表示、ステップ上限到達の未完了タスクの一覧、`aria-live` を検査する
  _Boundary:_ `apps/web/components/helpdesk/PlanDashboard.tsx`, `apps/web/components/helpdesk/TicketList.tsx`, `apps/web/components/helpdesk/PlanDashboard.test.tsx`, `apps/web/components/helpdesk/TicketList.test.tsx`
  _Depends:_ 15.4
  _Requirements:_ 2.3, 2.4, 2.5, 2.6, 2.7
  _Traces:_ REQ-002, C14
- [ ] 30.2 `components/helpdesk/HelpdeskPanel.tsx` と `app/helpdesk/page.tsx` + `HelpdeskPanel.test.tsx`: 問い合わせの入力（4000 文字の上限）、`data-helpdesk-*` の縮約、最終結果（認証情報が検出されたときは種別だけを表示し値を表示しない）、入力例を作る。ページはサーバーでチケット一覧の初期値を取得して渡す。テストは入力の上限、結果の表示、認証情報の種別表示を検査する
  _Boundary:_ `apps/web/components/helpdesk/HelpdeskPanel.tsx`, `apps/web/components/helpdesk/HelpdeskPanel.test.tsx`, `apps/web/app/helpdesk/page.tsx`
  _Depends:_ 30.1, 15.3
  _Requirements:_ 2.5, 2.6, 2.7
  _Traces:_ REQ-002, C14

### Implementation Notes

---

## 31. 分析画面（`/analysis`）

アップロード、試行履歴、画像（`alt` 付き）、表（行上限の表示）、無効化の案内。

_Boundary:_ `apps/web/components/analysis/*`, `apps/web/app/analysis/page.tsx`
_Depends:_ 19.7
_Requirements:_ 3.4, 3.5, 3.6, 3.7, 3.8, 3.9
_Traces:_ REQ-003, C14

- [ ] 31.1 (P) `components/analysis/{UploadForm,SandboxNotice,AttemptList}.tsx` + 各 `*.test.tsx`: ファイルの選択（受け入れ形式と 20 MB の表示）と指示の入力、サンドボックスが無効のときの入力の無効化と有効化の案内（`guidance`）、試行履歴（コード、標準出力、エラー、修正回数、`attempt-limit` で最後のコードとエラーの強調）を作る。テストは無効時の入力の無効化と案内、`attempt-limit` の表示、キーボード操作を検査する
  _Boundary:_ `apps/web/components/analysis/UploadForm.tsx`, `apps/web/components/analysis/SandboxNotice.tsx`, `apps/web/components/analysis/AttemptList.tsx`, `apps/web/components/analysis/UploadForm.test.tsx`, `apps/web/components/analysis/SandboxNotice.test.tsx`, `apps/web/components/analysis/AttemptList.test.tsx`
  _Depends:_ 19.5
  _Requirements:_ 3.4, 3.6, 3.8, 3.9
  _Traces:_ REQ-003, C14
- [ ] 31.2 (P) `components/analysis/{FigureView,TableView}.tsx` + 各 `*.test.tsx`: PNG の画像（`data:image/png;base64`。`alt` が空の図は描画しない。SVG や HTML は描画しない）と、素の `<table>`（キャプション、200 行までの描画と「N 件中 M 件を表示」）を作る。テストは `alt` の有無、行上限の表示、PNG 以外を描画しないことを検査する
  _Boundary:_ `apps/web/components/analysis/FigureView.tsx`, `apps/web/components/analysis/TableView.tsx`, `apps/web/components/analysis/FigureView.test.tsx`, `apps/web/components/analysis/TableView.test.tsx`
  _Depends:_ 19.4
  _Requirements:_ 3.5
  _Traces:_ REQ-003, C14, ADR-2
- [ ] 31.3 `components/analysis/AnalysisPanel.tsx` と `app/analysis/page.tsx` + `AnalysisPanel.test.tsx`: アップロード → ストリームの縮約 → 試行・図・表・結果の表示、明示的な終了操作（`DELETE /api/analysis/sessions/[id]`）、`sessionId`（クライアントが生成する UUID）、サンドボックスが作り直された旨の通知を作る。ページはサーバーでサンドボックスの選択結果を取得して渡す。テストは終了操作、再作成の通知、無効時の入力の無効化を検査する
  _Boundary:_ `apps/web/components/analysis/AnalysisPanel.tsx`, `apps/web/components/analysis/AnalysisPanel.test.tsx`, `apps/web/app/analysis/page.tsx`
  _Depends:_ 31.1, 31.2, 19.6, 19.7
  _Requirements:_ 3.5, 3.6, 3.7, 3.8
  _Traces:_ REQ-003, C14

### Implementation Notes

---

## 32. リサーチ画面（`/research`）

テーマ入力、主体別のイベント（Agent Inspector）、トークン内訳と呼び出し回数、レポートと警告。

_Boundary:_ `apps/web/components/research/*`, `apps/web/app/research/page.tsx`
_Depends:_ 23.3
_Requirements:_ 4.2, 4.5, 4.6, 4.8, 4.9, 4.10
_Traces:_ REQ-004, C14

- [ ] 32.1 (P) `components/research/{AgentInspector,UsageBreakdown,ReportView}.tsx` + 各 `*.test.tsx`: どの主体（`supervisor` / `search` / `reading` / `market`）のものかを区別したイベント（呼び出し、ツール、要約、論文サマリーカード、エラー）、役割別のトークン内訳と合計と呼び出し回数（使用量が取れない主体は `unknown`）、Markdown のレポート・警告（除去した旨）・欠落した観点を作る。テストは主体の区別表示、内訳の合計、`unknown` の表示、警告と欠落の表示を検査する
  _Boundary:_ `apps/web/components/research/AgentInspector.tsx`, `apps/web/components/research/UsageBreakdown.tsx`, `apps/web/components/research/ReportView.tsx`, `apps/web/components/research/AgentInspector.test.tsx`, `apps/web/components/research/UsageBreakdown.test.tsx`, `apps/web/components/research/ReportView.test.tsx`
  _Depends:_ 23.2
  _Requirements:_ 4.5, 4.6, 4.8, 4.9, 4.10
  _Traces:_ REQ-004, C14
- [ ] 32.2 `components/research/ResearchPanel.tsx` と `app/research/page.tsx` + `ResearchPanel.test.tsx`: テーマの入力（500 文字の上限）、呼び出し回数の上限の指定、`data-research-*` の縮約、入力例を作る。テストは入力の上限、上限回数の指定、結果の表示を検査する
  _Boundary:_ `apps/web/components/research/ResearchPanel.tsx`, `apps/web/components/research/ResearchPanel.test.tsx`, `apps/web/app/research/page.tsx`
  _Depends:_ 32.1, 23.3
  _Requirements:_ 4.2, 4.8, 4.9
  _Traces:_ REQ-004, C14

### Implementation Notes

---

## 33. 要件画面（`/requirements`）

質問と回答、要件プレビュー、判定とダウンロード。

_Boundary:_ `apps/web/components/requirements/*`, `apps/web/app/requirements/page.tsx`
_Depends:_ 27.6
_Requirements:_ 5.1, 5.2, 5.3, 5.4, 5.7
_Traces:_ REQ-005, C14

- [ ] 33.1 (P) `components/requirements/{RequirementsPreview,DocumentDownload}.tsx` + 各 `*.test.tsx`: 要件プレビュー（機能・非機能・制約・未確認事項、回答ごとの更新を `aria-live` で通知）、十分性の判定（不足項目）とダウンロードのボタン（生成前は無効、`requirements.md`）を作る。テストは回答ごとの更新、不足項目の表示、生成前の無効化を検査する
  _Boundary:_ `apps/web/components/requirements/RequirementsPreview.tsx`, `apps/web/components/requirements/DocumentDownload.tsx`, `apps/web/components/requirements/RequirementsPreview.test.tsx`, `apps/web/components/requirements/DocumentDownload.test.tsx`
  _Depends:_ 27.3
  _Requirements:_ 5.3, 5.4, 5.7
  _Traces:_ REQ-005, C14
- [ ] 33.2 `components/requirements/InterviewPanel.tsx` と `app/requirements/page.tsx` + `InterviewPanel.test.tsx`: 概要の入力（2000 文字の上限）、ペルソナと質問の表示、ペルソナ別の回答欄（1〜10 件）、ラウンドの進行、完了の表示、セッション切れ（404）時の案内を作る。テストは回答の送信、ペルソナ別の質問、セッション切れの案内を検査する
  _Boundary:_ `apps/web/components/requirements/InterviewPanel.tsx`, `apps/web/components/requirements/InterviewPanel.test.tsx`, `apps/web/app/requirements/page.tsx`
  _Depends:_ 33.1, 27.4, 27.5
  _Requirements:_ 5.1, 5.2, 5.3
  _Traces:_ REQ-005, C14

### Implementation Notes

---

## 34. マーケティング画面（`/marketing`）

文案の入力、ペルソナ名付きの発言、レコメンドとプロファイル。

_Boundary:_ `apps/web/components/marketing/*`, `apps/web/app/marketing/page.tsx`
_Depends:_ 27.8
_Requirements:_ 6.1, 6.2, 6.3, 6.4, 6.5
_Traces:_ REQ-006, C14

- [ ] 34.1 (P) `components/marketing/{CouncilTimeline,ProfileView}.tsx` + 各 `*.test.tsx`: ラウンドごと・ペルソナ名付きの発言、ラウンドごとの合意判定と終了理由、改善後の文案、プロファイル（関心事・予算・懸念点。更新を `aria-live` で通知）を作る。テストはペルソナ名の表示、ラウンドの区切りと判定、終了理由、プロファイルの更新を検査する
  _Boundary:_ `apps/web/components/marketing/CouncilTimeline.tsx`, `apps/web/components/marketing/ProfileView.tsx`, `apps/web/components/marketing/CouncilTimeline.test.tsx`, `apps/web/components/marketing/ProfileView.test.tsx`
  _Depends:_ 27.3
  _Requirements:_ 6.2, 6.3, 6.4
  _Traces:_ REQ-006, C14
- [ ] 34.2 `components/marketing/{CouncilPanel,RecommendPanel}.tsx` と `app/marketing/page.tsx` + 各 `*.test.tsx`: 文案の入力（2000 文字の上限）と参加ペルソナの選択（2〜5 件）、レコメンド用のチャットと、商品 ID・推薦理由・除去の件数の表示（Generative UI）、未投入のときの `seed:samples` の案内を作る。ページはサーバーでペルソナ定義を取得して渡す。テストは入力の上限、ペルソナの選択、除去の件数の表示、未投入の案内を検査する
  _Boundary:_ `apps/web/components/marketing/CouncilPanel.tsx`, `apps/web/components/marketing/RecommendPanel.tsx`, `apps/web/components/marketing/CouncilPanel.test.tsx`, `apps/web/components/marketing/RecommendPanel.test.tsx`, `apps/web/app/marketing/page.tsx`
  _Depends:_ 34.1, 27.7, 27.8
  _Requirements:_ 6.1, 6.3, 6.4, 6.5
  _Traces:_ REQ-006, C14

### Implementation Notes

---

## 35. トップ導線と E2E

モジュール一覧への導線、SSE fixture の生成、各画面の E2E、axe（light / dark）・キーボード・実サーバーの拡張を行う。

_Boundary:_ `apps/web/app/page.tsx`, `scripts/e2e/generate-sse-fixtures.mjs`, `apps/web/e2e/fixtures/*.sse`, `apps/web/e2e/support/mock-api.ts`, `apps/web/e2e/*.spec.ts`
_Depends:_ 29.2, 30.2, 31.3, 32.2, 33.2, 34.2
_Requirements:_ 1.3, 1.10, 2.5, 3.4, 3.5, 3.6, 3.8, 4.9, 4.10, 5.3, 5.7, 6.3, 6.4
_Traces:_ REQ-001, REQ-002, REQ-003, REQ-004, REQ-005, REQ-006, C14

- [ ] 35.1 (P) `app/page.tsx` のモジュール一覧に 6 画面へのリンクを足す + 既存のページのテスト（あれば）に、6 つのリンクの存在とラベルを先に足す
  _Boundary:_ `apps/web/app/page.tsx`
  _Depends:_ 29.2, 30.2, 31.3, 32.2, 33.2, 34.2
  _Requirements:_ 1.7
  _Traces:_ REQ-001, C14
  _Verify:_ `mise run gate` が成功し、トップから 6 画面に遷移できる（35.5 の E2E で確認）
- [ ] 35.2 `scripts/e2e/generate-sse-fixtures.mjs` と `apps/web/e2e/fixtures/{helpdesk,analysis,research,requirements,marketing-council,marketing-recommend}.sse`、`e2e/support/mock-api.ts`: 新しい Route Handler から固定応答を生成する対象を足し、新しいエンドポイントの差し替え（`/api/mcp/*`、`/api/analysis/status` など）を足す。fixture は Route Handler の実際の出力から生成し、手書きしない
  _Boundary:_ `scripts/e2e/generate-sse-fixtures.mjs`, `apps/web/e2e/fixtures/helpdesk.sse`, `apps/web/e2e/fixtures/analysis.sse`, `apps/web/e2e/fixtures/research.sse`, `apps/web/e2e/fixtures/requirements.sse`, `apps/web/e2e/fixtures/marketing-council.sse`, `apps/web/e2e/fixtures/marketing-recommend.sse`, `apps/web/e2e/support/mock-api.ts`
  _Depends:_ 15.3, 19.6, 23.3, 27.5, 27.7, 27.8
  _Requirements:_ 2.5, 3.5, 4.9, 5.3, 6.3, 6.4
  _Traces:_ REQ-002, REQ-003, REQ-004, REQ-005, REQ-006, C14
  _Verify:_ 生成を 2 回実行しても差分が出ない（決定論）。`mise run gate` が成功する
- [ ] 35.3 (P) `e2e/{mcp,helpdesk,analysis}.spec.ts`: MCP（サーバー状態の表示、拒否したツールの理由、致命的エラーの `error` の表示、通知）、ヘルプデスク（ダッシュボードの 3 項目、修正された計画、チケットの状態）、分析（試行履歴、`alt` 付きの画像、表の行上限、`attempt-limit`、サンドボックス無効時の案内）の主要な流れを、生成した SSE fixture で検証する
  _Boundary:_ `apps/web/e2e/mcp.spec.ts`, `apps/web/e2e/helpdesk.spec.ts`, `apps/web/e2e/analysis.spec.ts`
  _Depends:_ 35.2, 35.1
  _Requirements:_ 1.3, 1.10, 2.5, 3.4, 3.5, 3.6, 3.8
  _Traces:_ REQ-001, REQ-002, REQ-003, C14
- [ ] 35.4 (P) `e2e/{research,requirements,marketing}.spec.ts`: リサーチ（Agent Inspector の主体の区別、トークン内訳、警告と欠落）、要件（プレビューの更新、判定、ダウンロード）、マーケティング（ペルソナ名付きの発言、合意の判定、プロファイルとレコメンドの更新、除去の件数）の主要な流れを、生成した SSE fixture で検証する
  _Boundary:_ `apps/web/e2e/research.spec.ts`, `apps/web/e2e/requirements.spec.ts`, `apps/web/e2e/marketing.spec.ts`
  _Depends:_ 35.2, 35.1
  _Requirements:_ 4.9, 4.10, 5.3, 5.7, 6.3, 6.4
  _Traces:_ REQ-004, REQ-005, REQ-006, C14
- [ ] 35.5 `e2e/real-server.spec.ts`・`e2e/a11y.spec.ts`・`e2e/keyboard.spec.ts`: 6 画面が実サーバー（`mock`）で 200・スタイル適用・ブラウザエラー 0 であること、`/analysis` の `mock` 完走、`/mcp` が自作サーバーを起動することを `real-server.spec.ts` に足し、新しい 6 画面の axe（light / dark）と、入力・送信・タブ移動のキーボード操作を足す。`serverExternalPackages` に変更が要る場合は `next.config.ts` を更新する
  _Boundary:_ `apps/web/e2e/real-server.spec.ts`, `apps/web/e2e/a11y.spec.ts`, `apps/web/e2e/keyboard.spec.ts`, `apps/web/next.config.ts`
  _Depends:_ 35.3, 35.4, 23.4
  _Requirements:_ 1.7, 3.1, 3.8
  _Traces:_ REQ-001, REQ-003, C14, R-1
  _Verify:_ `mise run test:e2e`（3 エンジン）が成功し、axe の重大な違反が 0 件

### Implementation Notes

---

## 36. W7 の締め

_Boundary:_ `specs/003-domain-agents/research.md`
_Depends:_ 35.5
_Requirements:_ 2.5, 3.5
_Traces:_ REQ-002, REQ-003, C14

- [ ] 36.1 W7 の gate と E2E を実測して記録する。`mise run gate` と `mise run test:e2e`（3 エンジン）の成功を引用し、所要時間を research.md に追記する。`client-bundle`（`E2B_API_KEY`、`GITHUB_TOKEN` のセンチネルがバンドルに出ない）の成功も併記する
  _Boundary:_ `specs/003-domain-agents/research.md`
  _Depends:_ 35.5
  _Requirements:_ 2.5, 3.5
  _Traces:_ REQ-002, REQ-003, C14
  _Verify:_ `mise run gate`、`mise run test:e2e`、`mise run check:client-bundle` の成功と所要時間を research.md に記録した。W7 の敵対的レビューの記録が `.sdd/reviews/003-domain-agents-impl-w7-review-*.md` にある

### Implementation Notes
