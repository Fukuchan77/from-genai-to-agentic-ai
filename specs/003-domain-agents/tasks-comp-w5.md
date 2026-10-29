# domain-agents（Milestone 3）— 実装タスク（索引）

`/sdd-tasks` が生成した。承認済みの [spec.md](spec.md)（WHAT）と [plan.md](plan.md)（HOW、C1〜C16、Implementation Waves spike・W1〜W8）から、
実装の波ごとに分割した。ルールは `~/.claude/sdd/rules/tasks-generation.md` と `~/.claude/sdd/rules/tasks-parallel-analysis.md`
に従う。並列モード（`--sequential` 未指定）。002 の `tasks.md` と同じ運用（索引 + 現在の波の全文、未着手の波は `tasks-wN.md`、
完了した波は `tasks-comp-wN.md`）を採る。

## ファイル構成

| ファイル | 内容 |
|---|---|
| `tasks.md`（本ファイル） | 表記規約、ID 対応表、進捗、gate への段階的な結線、004 への引き継ぎ事項、**現在の波**（W5）のタスク全文 |
| `tasks-w6.md`〜`tasks-w8.md` | 未着手の波のタスク全文。波が現在の波になるとき `tasks.md` へ移す |
| `tasks-comp-w1.md`〜 | 完了した波の保管先。波の完了時に作る |
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
| W5 リサーチ | 21 arXiv クライアント、22 Supervisor とサブエージェント、23 HTTP 入口、24 W5 の締め | 着手中 | [tasks.md](tasks.md) |
| W6 要件・マーケティング | 25 要件インタビュー、26 マーケティング、27 HTTP 入口、28 W6 の締め | 未着手 | [tasks-w6.md](tasks-w6.md) |
| W7 画面と E2E | 29 MCP 画面、30 ヘルプデスク画面、31 分析画面、32 リサーチ画面、33 要件画面、34 マーケティング画面、35 トップ導線と E2E、36 W7 の締め | 未着手 | [tasks-w7.md](tasks-w7.md) |
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

## 現在の波: W5 リサーチ（大タスク 21〜24）

arXiv のクライアント（キュー、キャッシュ、再試行、解析）、研究ツール、予算、サブエージェント、Supervisor、引用の照合、`/api/research`、`m3-4` のシナリオを作る。
前提は spike S-2（1.3。サブエージェントのツールの受け渡し）の結果。W4 の完了後に着手する（共有ファイルの順序。tasks.md「波の依存」）。

21.2・22.1 は並列に進められる。

---

## 21. arXiv クライアント（C8）

arXiv の Atom API を利用規約（3 秒間隔、単一接続、日単位のキャッシュ）に従って呼び、論文の集合を返す。

_Boundary:_ `packages/ai-core/src/research/arxiv/**`, `packages/ai-core/src/research/tools.ts`, `packages/ai-core/src/research/tools.test.ts`, `packages/ai-core/fixtures/arxiv/*.xml`
_Depends:_ 1.2, 2.1, 4.7
_Requirements:_ 1.16, 4.3, 4.7
_Traces:_ REQ-001, REQ-004, C8, C15, ADR-3

- [x] 21.1 `research/arxiv/types.ts`・`parse.ts` と `fixtures/arxiv/{search-multi,search-single,search-empty,error}.xml`: `ArxivPaper` の Zod スキーマ（`arxivId` は `vN` を除いた形）と、`parseArxivFeed(xml)`（`fast-xml-parser`、`processEntities` 無効、`isArray` で `entry`・`author`・`link` を配列にする）を作る。DOCTYPE を含むフィードは解析せず失敗として扱う + `parse.test.ts` に、複数・1 件のみ（配列化）・空のフィード、エラーのフィード（`entry` に `Error` の要約）、DOCTYPE と実体の展開を試みるフィード、旧形式の ID（`cs/0501001`）と `vN` の除去を先に書く
  _Boundary:_ `packages/ai-core/src/research/arxiv/types.ts`, `packages/ai-core/src/research/arxiv/parse.ts`, `packages/ai-core/src/research/arxiv/parse.test.ts`, `packages/ai-core/fixtures/arxiv/search-multi.xml`, `packages/ai-core/fixtures/arxiv/search-single.xml`, `packages/ai-core/fixtures/arxiv/search-empty.xml`, `packages/ai-core/fixtures/arxiv/error.xml`
  _Depends:_ 1.2
  _Requirements:_ 4.3
  _Traces:_ REQ-004, C8, C15, ADR-3
- [x] 21.2 (P) `research/arxiv/queue.ts`: `Clock` による 3 秒間隔・同時 1 接続の直列キューを作る + `queue.test.ts`（`FakeClock`）に、間隔の境界値（2,999 ms で待ち、3,000 ms で実行）、並行呼び出しが直列化されること、先行の失敗が後続を止めないことを先に書く
  _Boundary:_ `packages/ai-core/src/research/arxiv/queue.ts`, `packages/ai-core/src/research/arxiv/queue.test.ts`
  _Depends:_ none
  _Requirements:_ 4.7
  _Traces:_ REQ-004, C8
- [x] 21.3 `research/arxiv/client.ts`: `createArxivClient({ fetcher, clock, cache, options })` の `search(query, { maxResults })` と `getAbstract(arxivId)`（キャッシュ済みの集合からだけ返す）を作る。クエリ単位のキャッシュ（正規化したクエリ、有効期間 1 日）、再試行（最大 3 回、`Retry-After` があれば従い無ければ指数待機、待機は `Clock`）、応答サイズ上限（2 MB）、解析失敗の扱い（失敗として再試行の対象）を持つ。通信は M1 の `HttpFetcher` を使い、ネットワークへ直接接続しない + `client.test.ts` に、キャッシュ命中で通信しないこと、`Retry-After`、3 回で諦めて失敗を返すこと、429 / 503 / 5xx / ネットワーク失敗 / HTTP 400、サイズ超過、空のフィードがエラーでないこと、中断で待機が止まることを先に書く
  _Boundary:_ `packages/ai-core/src/research/arxiv/client.ts`, `packages/ai-core/src/research/arxiv/client.test.ts`
  _Depends:_ 21.1, 21.2
  _Requirements:_ 4.3, 4.7
  _Traces:_ REQ-004, C8, ADR-3
- [x] 21.4 `research/tools.ts`: `createResearchTools({ client })` が `searchArxiv`（検索サブエージェント用）と `getPaperAbstract`（精読サブエージェント用）を `defineAciTool` で定義する。どちらも `risk: "read-only"`、説明文は 4.1 の形式。取得した要旨は外部コンテンツとして `RunObserver` の記録口（5.2）に種別と出所だけを記録する + `tools.test.ts` に、検索結果の各項目（タイトル、著者、公開日、arXiv ID、要旨）、`risk`、説明文が `checkDescription` を通ること、記録口の呼び出し、`getAbstract` が検索結果の集合に無い ID で `undefined` を返すことを先に書く
  _Boundary:_ `packages/ai-core/src/research/tools.ts`, `packages/ai-core/src/research/tools.test.ts`
  _Depends:_ 21.3, 4.7, 5.2
  _Requirements:_ 1.16, 4.3
  _Traces:_ REQ-001, REQ-004, C8, CL-10

### Implementation Notes

- **再試行は「初回 + 3 回 = 最大 4 回の要求」と読んだ**（Req 4.7「最大 3 回まで再試行」。`maxRetries: 3`）。待機は `Retry-After`（秒または HTTP 日付、上限 `maxRetryWaitMs` 30 秒）が先で、無ければ 3 s・6 s・12 s の指数待機。どの待機のあとも、キューが「前の要求の*終了*から 3 秒」を保つ（開始から数える読みより慎重）。400 を含む 200 以外の応答、ネットワークの失敗、解析の失敗、エラーのフィードはすべて再試行の対象。**応答サイズ超過だけは再試行しない**（同じ応答が返るだけのため）。
- **`HttpFetcher` は本文を文字列で読み切って返す**ため、2 MB の上限は「解析しない」ことしか保証しない（メモリ上の読み込みは止められない）。上限の実効は、ストリームを読む `HttpFetcher` への変更が要る（M1 のポートの変更は M3 の範囲外。005 の本番の境界）。要求ごとの時間切れ（`requestTimeoutMs` 15 秒）を足した: 単一接続のキューが 1 つの固まった接続で止まらないため（計画に無い追加）。
- **計画からの差**: `createResearchTools` は配列でなく `{ searchArxiv, getPaperAbstract }` を返す（子ごとに渡すツールが違うため）。`onPapers`（実行ごとの論文の集合の収集口。引用の照合 Req 4.5 の「検索サブエージェントが取得した論文の集合」）と `externalContent`（5.2 の記録口）を依存に足した。`getAbstract` は共有キャッシュだけを引き、要求を出さない。キャッシュは `createArxivCache`（既定 200 件、古い順に捨てる）。
- **フィクスチャは arXiv の文書化された形式から作った**（実測ではない。24.2 と research.md に明記する）。`fast-xml-parser` は `processEntities: false` で実体を展開しないので、5 つの定義済み実体と数値参照だけを 1 回の置換で戻す（二重にデコードしない）。DOCTYPE を含むフィードは解析しない。
- **PROVE で見つけたもの**: `listOf` が単一要素を包み直していたため、`isArray` を外しても通っていた（冗長）→ `isArray` に一本化。`<id>` の URL 検査はパターン検査と重なり、`errors#` の ID 検査は冗長だったので除いた。キューは、先行の実行中に待っている呼び出しの中断が即時に返ること（`raceWithAbort`）と、`fetcher` が signal を無視しても時間切れで切れること（`raceWithAbort` を外すと殺される）をテストで固定した。等価と判断して残したもの: DOCTYPE 検査の大文字小文字無視フラグ、ループ側の中断検査（最終試行の失敗と中断が同時に来る窓のための保険）。

---

## 22. Supervisor・サブエージェント・予算（C9）

階層型リサーチの Supervisor と 3 つのサブエージェントを束ね、呼び出し回数と共有トークン予算を数え、要約だけを返し、引用を照合して、役割ごとのトークン内訳を集計する。

_Boundary:_ `packages/ai-core/src/research/budget.ts`, `packages/ai-core/src/research/budget.test.ts`, `packages/ai-core/src/research/citations.ts`, `packages/ai-core/src/research/citations.test.ts`, `packages/ai-core/src/research/subagents.ts`, `packages/ai-core/src/research/subagents.test.ts`, `packages/ai-core/src/research/supervisor.ts`, `packages/ai-core/src/research/supervisor.test.ts`, `packages/ai-core/src/research/index.ts`, `packages/ai-core/fixtures/scenarios/m3-4.ts`, `packages/ai-core/src/models/gateway.ts`, `packages/ai-core/src/models/gateway.test.ts`, `packages/ai-core/src/mock/index.ts`, `packages/ai-core/src/mock/m3-scenarios.test.ts`
_Depends:_ 21.4, 5.1, 5.2, 3.3, 1.3
_Requirements:_ 4.1, 4.2, 4.4, 4.5, 4.6, 4.8, 4.9, 4.10
_Traces:_ REQ-004, C9, C15, ADR-8

- [x] 22.1 (P) `research/budget.ts`: `createBudget({ maxCalls, maxTotalTokens })` の `takeCall()`（上限に達したら `false`）、`remainingTokens()`、`recordUsage(role, usage)` を作る。残量が 0 の呼び出しは実行させず、予算切れを返す(CL-17) + `budget.test.ts` に、呼び出し回数の上限の境界、残量 0 の子を**実行しない**こと、役割別の内訳の合計が全体と一致すること、使用量が取れない役割の扱いを先に書く
  _Boundary:_ `packages/ai-core/src/research/budget.ts`, `packages/ai-core/src/research/budget.test.ts`
  _Depends:_ none
  _Requirements:_ 4.8, 4.10
  _Traces:_ REQ-004, C9, CL-17
- [x] 22.2 `research/citations.ts`: `checkCitations(report, papers)` が、本文の arXiv ID とリンク（`arxiv.org/abs/…v2`、`pdf`、`http` / `https` の違いを同一視）を論文の集合と照合し、集合に無い論文への言及を除去して `removed` と警告を返す純関数を作る。ID が付かない論文への言及も警告に載せる + `citations.test.ts` に、集合に無い ID とリンクの除去と警告、版違い（`v2`）の正規化、書式違いの同一視、全論文に ID が付くこと、集合に含まれる言及を壊さないことを先に書く
  _Boundary:_ `packages/ai-core/src/research/citations.ts`, `packages/ai-core/src/research/citations.test.ts`
  _Depends:_ 21.1
  _Requirements:_ 4.5
  _Traces:_ REQ-004, C9
- [x] 22.3 `research/subagents.ts`: `createSubagent(kind, deps)`（`search` / `reading` / `market`）が、子の `createGuardedAgent` を内部で作り、入力スキーマ付きのツール（`AciTool`）として Supervisor に渡す。戻り値は要約（`SubagentResult`、800 文字以内、`paperIds`）だけで、内部のトランスクリプトを返さない。呼び出しの前に予算を確認し、残量 0 なら実行せず予算切れを返す。失敗は名前と理由を返す（例外にしない）。ツールの渡し方は 1.3（S-2）の結果に従う + `subagents.test.ts` に、要約だけが返り内部の文が含まれないこと、要約の長さ上限、予算切れの子を実行しないこと、失敗の名前と理由、子の上限に残量が渡ることを先に書く
  _Boundary:_ `packages/ai-core/src/research/subagents.ts`, `packages/ai-core/src/research/subagents.test.ts`
  _Depends:_ 21.4, 22.1, 3.3, 5.1, 5.2, 1.3
  _Requirements:_ 4.1, 4.4, 4.6, 4.8
  _Traces:_ REQ-004, C9, ADR-8, S-2
- [x] 22.4 `research/supervisor.ts` と `research/index.ts`: `runResearch({ theme, model, arxiv, observer, limits, signal })` が、Supervisor を `createGuardedAgent` で作り、3 つのサブエージェントをツールとして渡し、Markdown のレポートを返す。呼び出し回数（既定 8）と共有トークン予算（既定 80,000）を数え、失敗を `missing` に集約してレポートに欠落した観点を明記する（全サブエージェントが失敗した場合は「調査できなかった」旨と `missing` だけを返す）。レポートは `checkCitations` で照合してから返し、`TokenLedger` が役割別（`supervisor` / `search` / `reading` / `market`）の内訳を集計する。各イベントに `agent` 名を付ける。`index.ts` は `@platform/ai-core/research` の公開 API を再エクスポートする + `supervisor.test.ts` に、`mock` の完走、呼び出し回数の上限、トークン予算の尽きた後の扱い、子の失敗でも継続して欠落が明記されること、未知の arXiv ID の除去、内訳の合計、`agent` 付きのイベントの順序、中断を先に書く
  _Boundary:_ `packages/ai-core/src/research/supervisor.ts`, `packages/ai-core/src/research/supervisor.test.ts`, `packages/ai-core/src/research/index.ts`
  _Depends:_ 22.2, 22.3
  _Requirements:_ 4.1, 4.2, 4.5, 4.6, 4.8, 4.9, 4.10
  _Traces:_ REQ-004, C9, ADR-8, CL-17
- [x] 22.5 `fixtures/scenarios/m3-4.ts`: Supervisor と 3 つの子のシナリオ（検索 → 精読 → 市場影響 → レポート。未知の arXiv ID を含む引用、子の失敗を含む）を作り、`gateway.ts` の `mock` 既定シナリオと `mock/index.ts` の集約に足す。`mock` のシナリオは 4 回の呼び出しで完了する(DEFAULT_RESEARCH の根拠) + `m3-scenarios.test.ts` の期待件数を更新して曖昧な一致がないことを確かめる
  _Boundary:_ `packages/ai-core/fixtures/scenarios/m3-4.ts`, `packages/ai-core/src/models/gateway.ts`, `packages/ai-core/src/models/gateway.test.ts`, `packages/ai-core/src/mock/index.ts`, `packages/ai-core/src/mock/m3-scenarios.test.ts`
  _Depends:_ 18.5, 22.4
  _Requirements:_ 4.2, 4.5
  _Traces:_ REQ-004, C15

### Implementation Notes

- **サブエージェントは一度に 1 つ**: Supervisor のツール集合に `FatalLatch` を渡すと、`buildToolSet` が 1 ステップの複数のツール呼び出しを順に実行する（M1 のラッチの副作用）。これで共有トークン予算の残量が正確になる（並行だと 2 つの子が同じ残量を見る）。子の側にはラッチを渡さない（致命的エラーを投げるツールが無く、PROVE で不要と分かった）。Supervisor 自身のトークンは終了時に予算へ足すため、合計は `maxTotalTokens` を Supervisor の使用分だけ超えうる（`runResearch` の説明に明記）。
- **引用の照合は「行」「文」「語」の順に除く**: 一覧・表の行は丸ごと、段落の文は文ごと、同じ文に集合内の論文があるときは言及（と包む括弧）だけを除き、「内容を確認してください」の警告を付ける。月が不正な裸の ID（`1234.5678`）は ID と見なさず、`arXiv:` ラベル付きなら月を問わず ID と見なす。照合後の本文へ警告の節を足すのは `attachCitationWarnings`（`checkCitations` は本文を変えるだけ）。集合に無い論文を ID も既知のタイトルも付けずに書いた場合は検出できない（`et al.` や `(2023)` を持つ行への警告で補う。plan の Req 4.5 の読みの限界として解説に書く）。
- **計画に足したもの（境界外の変更、2026-10-19）**: `agents/token-ledger.ts` の `usageFromRun`（W1 F-10。実行の `totalTokens` を台帳の形にし、使用量が無い実行は不明）、`agents/observer.ts` の `forAgent` と `source` の 512 文字上限（W1 F-11）、`research/tools.ts` の `onCall`（Agent Inspector の `tool` イベント）、`research/scenarios.test.ts`（m3-4 の通しテスト）、`mock/arxiv-fixtures.ts` とそのテスト（`mock` の arXiv 用の fetcher。API の URL 以外は拒否）。`createResearchTools` は配列でなく `{ searchArxiv, getPaperAbstract }` を返す。
- **m3-4 の台本**: 子の呼び出しは「検索 2 回 + 精読 + 市場影響」の 4 回（plan の「4 回で完了」）。Supervisor の台本の照合は `<research-theme>` のタグ込みの文字列（市場影響の子の `<theme>` と部分一致しない）。部分失敗の台本は、精読の子が空の答えで終わる。台本が無いテーマは `mock` でエラー（作り話をしない）。

---

## 23. リサーチの HTTP 入口（C13 の一部）

_Boundary:_ `apps/web/lib/server/platform.ts`, `apps/web/lib/server/platform.test.ts`, `apps/web/lib/server/domain-stream.ts`, `apps/web/lib/server/domain-stream.test.ts`, `apps/web/app/api/research/**`, `apps/web/next.config.ts`, `apps/web/e2e/real-server.spec.ts`, `specs/003-domain-agents/research.md`
_Depends:_ 22.5, 19.1, 19.4
_Requirements:_ 4.2, 4.6, 4.8, 4.9, 4.10
_Traces:_ REQ-004, C13, R-1

- [x] 23.1 `platform.ts`: `getArxivClient()` を組み立てる（`HttpFetcher`、`Clock`、キャッシュ。`globalThis` のホルダーで 1 つだけ。`mock` ではフィクスチャを返す fetcher）+ `platform.test.ts` に、実行モード別の組み立て、`mock` で arXiv へ接続しないことを先に足す
  _Boundary:_ `apps/web/lib/server/platform.ts`, `apps/web/lib/server/platform.test.ts`
  _Depends:_ 19.1, 21.3
  _Requirements:_ 4.3, 4.7
  _Traces:_ REQ-004, C13
- [x] 23.2 `lib/server/domain-stream.ts`: `data-research-event`（`agent` と `kind`: `call` / `tool` / `summary` / `card` / `error`）、`data-research-usage`（状態、`id: "usage"`）、`data-research-result` への写像を足す + `domain-stream.test.ts` に、`agent` 付きのイベントの順序、使用量の状態パートが同じ `id` で上書きされること、結果の `report` が照合後であることを先に足す
  _Boundary:_ `apps/web/lib/server/domain-stream.ts`, `apps/web/lib/server/domain-stream.test.ts`
  _Depends:_ 19.4, 22.4
  _Requirements:_ 4.9, 4.10
  _Traces:_ REQ-004, C13
- [x] 23.3 `POST /api/research`: `z.strictObject`（`theme` 1〜500 文字、`modelId?`、`maxSubagentCalls?` 1〜20）を検査し、ツール非対応のモデルを `capability-unsupported` で拒否し、`runResearch` の進行を `data-research-*` として流す。arXiv に到達できない場合は検索の欠落として `missing` に記録して続行する（Supervisor 自体が起動できないときだけエラー）。中断では `data-research-result` を送らない + `route.test.ts` に、検査順、各拒否のコード、`mock` の完走（レポートに警告、`missing`、内訳）、呼び出し回数の上限の変更、中断を先に書く
  _Boundary:_ `apps/web/app/api/research/route.ts`, `apps/web/app/api/research/route.test.ts`
  _Depends:_ 22.5, 23.1, 23.2
  _Requirements:_ 4.2, 4.6, 4.8, 4.9, 4.10
  _Traces:_ REQ-004, C13
- [x] 23.4 実サーバー（`mock`）で、`fast-xml-parser` がバンドルされて起動できること、`/api/research` が `mock` で完走することを `real-server.spec.ts` で確かめ、`next.config.ts` の `serverExternalPackages` を必要最小限に更新する。結果を research.md の R-1 に追記する
  _Boundary:_ `apps/web/next.config.ts`, `apps/web/e2e/real-server.spec.ts`, `specs/003-domain-agents/research.md`
  _Depends:_ 23.3, 20.1
  _Requirements:_ 4.2, 4.3
  _Traces:_ REQ-004, C13, R-1
  _Verify:_ `mise run test:e2e`（実サーバー）が成功する。足した `serverExternalPackages` の理由が research.md にある

### Implementation Notes

- **ルートは短い**: `guard → モデル（`require: ["tools"]`）→ arXiv クライアント → ストリーム`。`runResearch` に `onEvent`（Agent Inspector）と、新しく足した `onUsage`（子が終わるたびと最後に、トークンの内訳と呼び出し回数を状態パートとして流す）を渡す。使用量の状態パートは `id: "usage"` を上書きする。中断は `runResearch` が投げるため、`data-research-result` は流れない（テストが確かめる）。リクエストの本文スキーマは ai-core の `research/request-schema.ts`（`apps/web` に `zod` が無いため。ヘルプデスクと同じ扱いの境界外の追加）。
- **arXiv に届かないときは検索の欠落**（Req 4.7 → 4.6）: 検索ツールの失敗（`source-unavailable`）を子が受けて、論文が 1 件も見つからないまま終われば、子の答えの文面にかかわらず「検索できなかった」失敗として `missing` に記録する（`onFailure` を `createResearchTools` に足した。ルートのテストが、arXiv が落ちていても 200 で完走し、2 回の検索の欠落がレポートに載ることを確かめる）。Supervisor 自体が起動できない（モデルの失敗）ときだけ、`provider-unavailable` のエラーパートになる。
- **実サーバー**: `fast-xml-parser` は外部化せずにバンドルのまま動いた。`next.config.ts` は変えていない（research.md の R-1）。`getArxivClient()` は `globalThis` の 1 つのホルダー（キューとキャッシュを 1 つにするため）。`mock` は 3 秒の間隔を使わず（フィクスチャに間隔は要らない）、`local` / `live` はガード付きの `HttpFetcher`（`AI_RECORD=1` なら arXiv も録画される）。ガード付き fetch は本文を 5 MB まで読んでから返すため、クライアントの 2 MB の上限は「解析しない」ことしか保証しない（M1 のポートの変更は M3 の範囲外）。

---

## 24. W5 の締め

_Boundary:_ `stryker.config.mjs`, `specs/003-domain-agents/research.md`
_Depends:_ 23.4
_Requirements:_ 4.5, 4.8, 4.10
_Traces:_ REQ-004, C16

- [x] 24.1 `stryker.config.mjs` に `research/citations.ts` と `research/budget.ts` を足す
  _Boundary:_ `stryker.config.mjs`
  _Depends:_ 22.4
  _Requirements:_ 4.5, 4.8
  _Traces:_ REQ-004, C16
  _Verify:_ `mise run test:mutation` の対象に含まれ、閾値 70 を満たす
- [x] 24.2 W5 の gate を実測して記録する。`mise run gate` の成功を引用し、所要時間を research.md に追記する。arXiv の 429 / 503 / `Retry-After` の実挙動は未実測であり、フィクスチャは仕様と推測に基づくことを research.md に明記する
  _Boundary:_ `specs/003-domain-agents/research.md`
  _Depends:_ 24.1
  _Requirements:_ 4.7
  _Traces:_ REQ-004, C16
  _Verify:_ `mise run gate` の成功と所要時間を research.md に記録した。W5 の敵対的レビューの記録が `.sdd/reviews/003-domain-agents-impl-w5-review-*.md` にある

### Implementation Notes

- **結線**: `stryker.config.mjs` に `research/citations.ts` と `research/budget.ts`。この 2 ファイルだけの実行で 83.22（citations 82.41、budget 88.89、閾値 70）。全体の `mise run test:mutation` は未実行。
- **敵対的レビュー**（`.sdd/reviews/003-domain-agents-impl-w5-review-2026-10-19.md`: REQUEST_CHANGES、HIGH 0、MEDIUM 5、LOW 9）。MEDIUM はすべてテスト先行で直した（Supervisor のトークンが共有予算の外だった F-1、引用照合の見逃しと誤除去 F-2・F-3、精読が共有キャッシュから読めた F-5）。F-4（行・文単位の除去の限界）と LOW の多くは受け入れて解説（40.4）へ送る。修正後の fresh な再レビューは未実施。
- **実測**: `mise run gate` は exit 0（下の research.md）。3 エンジンの E2E は 402 件成功（chromium / firefox / webkit）。
- **持ち越し**: arXiv の実応答は 2026-10-19 に一部を実測した（429 は本文 `Rate exceeded.` で `Retry-After` なし、503 は `Retry-After: 0` と HTML 本文、`http://` は 301。1 件の正常系は `fixtures/arxiv/live-single.xml` で固定）。**未実測**: 複数件・0 件の正常系、HTTP 400 のエラーフィード（429 とタイムアウトに阻まれた）、ガード付き fetch のリダイレクト追従。これらのフィクスチャは仕様に基づく（`research.md` I-5）。ガード付き fetch は本文を 5 MB まで読んでから返すため 2 MB の上限は解析の拒否だけ。CL-26 は 2026-10-19 に確定した（初回 + 修正 3 回）。
