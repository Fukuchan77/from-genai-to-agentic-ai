# domain-agents（Milestone 3）— 実装タスク（索引）

`/sdd-tasks` が生成した。承認済みの [spec.md](spec.md)（WHAT）と [plan.md](plan.md)（HOW、C1〜C16、Implementation Waves spike・W1〜W8）から、
実装の波ごとに分割した。ルールは `~/.claude/sdd/rules/tasks-generation.md` と `~/.claude/sdd/rules/tasks-parallel-analysis.md`
に従う。並列モード（`--sequential` 未指定）。002 の `tasks.md` と同じ運用（索引 + 現在の波の全文、未着手の波は `tasks-wN.md`、
完了した波は `tasks-comp-wN.md`）を採る。

## ファイル構成

| ファイル | 内容 |
|---|---|
| `tasks.md`（本ファイル） | 表記規約、ID 対応表、進捗、gate への段階的な結線、004 への引き継ぎ事項、**現在の波**（W4）のタスク全文 |
| `tasks-w5.md`〜`tasks-w8.md` | 未着手の波のタスク全文。波が現在の波になるとき `tasks.md` へ移す |
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
| W4 サンドボックス・分析 | 17 サンドボックス提供者、18 データ分析、19 HTTP 入口、20 実サーバー確認と W4 の締め | 実装完了・レビュー対応済み（コミットと `tasks-comp-w4.md` への移行は `/sdd-ship` で行う） | [tasks.md](tasks.md) |
| W5 リサーチ | 21 arXiv クライアント、22 Supervisor とサブエージェント、23 HTTP 入口、24 W5 の締め | 未着手 | [tasks-w5.md](tasks-w5.md) |
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

## 現在の波: W4 サンドボックス・分析（大タスク 17〜20）

提供者の選択、E2B・Docker・疑似の提供者、tar・demux・Engine API、`docker/sandbox/Dockerfile` と `sandbox:build`、アップロードの検査、出力の分離、修正ループ、
`runPython`、`/api/analysis*`、`m3-3` のシナリオを作る。前提は spike S-4・S-5（1.5、1.6）の結果。生成コードはホストで実行しない（`sandbox-import-scope`、憲章 原則 6）。

17.1・17.2・17.3・17.5 は並列に進められる。18.1・18.2 は並列に進められる。19.2・19.3 は並列に進められる。

---

## 17. サンドボックス提供者（C6）

E2B、ローカルのコンテナ、疑似実装の 3 提供者を `SandboxProvider` の背後に置き、セッションごとの作成とアイドル破棄を行う。

_Boundary:_ `packages/ai-core/src/sandbox/**`, `packages/ai-core/fixtures/sandbox/*`, `docker/sandbox/Dockerfile`, `mise.toml`, `specs/003-domain-agents/research.md`
_Depends:_ 6.1, 1.5, 1.6, 2.1
_Requirements:_ 3.1, 3.2, 3.7, 3.8, 3.10
_Traces:_ REQ-003, C6, C15, ADR-6

- [x] 17.1 (P) `sandbox/mock.ts` と `fixtures/sandbox/mock-{success,error}.json`: 定義済みの標準出力・エラー出力・小さな PNG（base64）を返す疑似提供者を作る。実際のコードは実行しない + `mock.test.ts` に、成功と失敗の応答、コードの内容に応じた応答の切り替え、`close` 後の `runPython` の失敗を先に書く
  _Boundary:_ `packages/ai-core/src/sandbox/mock.ts`, `packages/ai-core/src/sandbox/mock.test.ts`, `packages/ai-core/fixtures/sandbox/mock-success.json`, `packages/ai-core/fixtures/sandbox/mock-error.json`
  _Depends:_ 6.1
  _Requirements:_ 3.10
  _Traces:_ REQ-003, C6, C15
- [x] 17.2 (P) `sandbox/select.ts`: `selectSandboxProvider({ env, dockerProbe })` が E2B の鍵 → ローカルのコンテナ（疎通と画像の有無）→ 無効の順に選び、無効のときは理由と有効化に必要な設定の案内（`sandbox:build` を含む）を返す + `select.test.ts` に、選択の順序、鍵あり・Docker なし、鍵なし・Docker あり、画像なし、すべて無し（案内文）を先に書く
  _Boundary:_ `packages/ai-core/src/sandbox/select.ts`, `packages/ai-core/src/sandbox/select.test.ts`
  _Depends:_ 6.1, 2.1
  _Requirements:_ 3.8
  _Traces:_ REQ-003, C6, ADR-6
- [x] 17.3 (P) `sandbox/lifecycle.ts`: `createSandboxRegistry({ provider, clock, idleTimeoutMs })` が `acquire(sessionId)`（既存のセッションは再利用し、`isAlive()` が偽なら 1 回だけ作り直す）、`touch`、`release`（冪等）、`sweep`（アイドル 10 分で破棄）を持つ。時刻は `Clock` から + `lifecycle.test.ts`（`FakeClock`）に、アイドルの境界値（10 分ちょうどと +1 ms）、明示解放の冪等、期限切れの作り直しが 1 回で止まること、`sweep` が実行中のセッションを破棄しないことを先に書く
  _Boundary:_ `packages/ai-core/src/sandbox/lifecycle.ts`, `packages/ai-core/src/sandbox/lifecycle.test.ts`
  _Depends:_ 6.1
  _Requirements:_ 3.7
  _Traces:_ REQ-003, C6, CL-8
- [x] 17.4 `sandbox/e2b.ts`: `createE2bProvider({ apiKey, sdk })`（`@e2b/code-interpreter` を import する唯一のファイル。SDK を注入できる形で、キーが無ければ読み込まない）が、`create` / `writeFile` / `runPython` / `isAlive` / `close` を SDK に写す。偽 SDK の形は 1.5 の結果に合わせる + `e2b.test.ts` に、偽 SDK での作成・書き込み・実行・標準出力と標準エラーとエラーの写像、期限切れ、`create` の失敗が `provider-unavailable` になること、キーが例外の文言に現れないことを先に書く
  _Boundary:_ `packages/ai-core/src/sandbox/e2b.ts`, `packages/ai-core/src/sandbox/e2b.test.ts`
  _Depends:_ 6.1, 1.5
  _Requirements:_ 3.1, 3.2
  _Traces:_ REQ-003, C6, S-4
- [x] 17.5 (P) `sandbox/docker/tar.ts` と `sandbox/docker/demux.ts`: 1 ファイルの tar を 512 バイトのヘッダで作る純関数と、8 バイトのヘッダの多重化ストリームを標準出力と標準エラーに分ける純関数を作る（`tar-stream` は使わない）+ `tar.test.ts`・`demux.test.ts` に、ヘッダのチェックサムとパディング、長いファイル名の拒否、ストリームが途中で切れたとき読めた分までを返し警告を付けること、標準出力と標準エラーの混在を先に書く
  _Boundary:_ `packages/ai-core/src/sandbox/docker/tar.ts`, `packages/ai-core/src/sandbox/docker/tar.test.ts`, `packages/ai-core/src/sandbox/docker/demux.ts`, `packages/ai-core/src/sandbox/docker/demux.test.ts`
  _Depends:_ none
  _Requirements:_ 3.2
  _Traces:_ REQ-003, C6, ADR-4
- [x] 17.6 `sandbox/docker/probe.ts` と `sandbox/docker/engine.ts`: `probeDockerSocket(env)`（`DOCKER_HOST`、`~/.docker/run/docker.sock`、`/var/run/docker.sock` の順に疎通を確かめる）と、Engine API の薄いクライアント（`node:http` の `socketPath`。create / start / archive / wait / logs / delete）を作る。`dockerode` は使わない（ADR-4）+ `probe.test.ts`・`engine.test.ts` に、探索の順序、疎通の失敗の扱い、要求の形（パス、メソッド、本文）を偽のソケット（インメモリのストリーム）で、各呼び出しの失敗が `provider-unavailable` になることを先に書く。実ソケットへは接続しない
  _Boundary:_ `packages/ai-core/src/sandbox/docker/probe.ts`, `packages/ai-core/src/sandbox/docker/probe.test.ts`, `packages/ai-core/src/sandbox/docker/engine.ts`, `packages/ai-core/src/sandbox/docker/engine.test.ts`
  _Depends:_ 1.6
  _Requirements:_ 3.2, 3.8
  _Traces:_ REQ-003, C6, ADR-4, S-5
- [x] 17.7 `sandbox/docker/provider.ts` と `sandbox/index.ts`: `createDockerProvider({ engine, image })` が、ネットワークなし（`NetworkMode: none`）・読み取り専用ルート・tmpfs の `/work`・メモリと CPU の制限・PID 上限・capability の全削除・`no-new-privileges`・非 root のコンテナを作り、`writeFile`（tar）→ 実行 → ログの取得 → **必ず削除**（`force` + `v`、`finally`）を行う。タイムアウトでコンテナを強制削除する。`sandbox/index.ts` は `@platform/ai-core/sandbox` の公開 API を再エクスポートする + `provider.test.ts` に、作成要求の制限の内容（設定値の検査）、成功・失敗・タイムアウトのいずれでもコンテナが削除されること、`create` / `archive` / `start` / `wait` / `logs` の各失敗、ログの途中切れの警告を、偽のエンジンで先に書く
  _Boundary:_ `packages/ai-core/src/sandbox/docker/provider.ts`, `packages/ai-core/src/sandbox/docker/provider.test.ts`, `packages/ai-core/src/sandbox/index.ts`
  _Depends:_ 17.1, 17.2, 17.3, 17.4, 17.5, 17.6
  _Requirements:_ 3.1, 3.2, 3.8
  _Traces:_ REQ-003, C6, ADR-6, CL-20
- [x] 17.8 `docker/sandbox/Dockerfile` と `mise.toml` の `sandbox:build`、`fixtures/sandbox/sample-analysis.py`、`sandbox/docker/provider.container.test.ts`: pandas、openpyxl、xlrd、matplotlib を 1.6 で固定した版で含む非 root の画像（名前 `agentic-ai-sandbox:local`）を作り、実 Docker で、ネットワークなし、読み取り専用ルート、タイムアウト、コンテナの削除、分析スクリプトが目印の行（`__PNG__:`、`__TABLE__:`）を出すことを検証する。Docker が無い環境では `*.container.test.ts` が理由付きでスキップされる。初回の `mise run sandbox:build` と `mise run test:container` の実行（Docker を起動できる環境で、人が行う）の所要時間と Docker のバージョンを research.md に追記する
  _Boundary:_ `docker/sandbox/Dockerfile`, `mise.toml`, `packages/ai-core/fixtures/sandbox/sample-analysis.py`, `packages/ai-core/src/sandbox/docker/provider.container.test.ts`, `specs/003-domain-agents/research.md`
  _Depends:_ 17.7, 6.3
  _Requirements:_ 3.1, 3.2, 3.8
  _Traces:_ REQ-003, C6, C15, CL-9, CL-20
  _Verify:_ `mise run sandbox:build` が成功し、`mise run test:container` が実 Docker で成功する（Docker が無い環境では「人が行うこと」として未実行を research.md に明記し、スキップを合格に数えない）。`mise run gate` が `*.container.test.ts` を実行しない

### Implementation Notes

- **plan の Docker の想定は実機で外れた**: 読み取り専用ルートでは、`Tmpfs` の `/work` にも `--mount type=tmpfs` にも archive で入力を置けない（403、または tmpfs の下に入って見えない）。匿名ボリュームの `/work` だけが起動前の archive を受ける。流れは create → archive → start → wait → logs → delete で、`/tmp` は tmpfs、`/work` は非 root から書けない。詳細は research.md「W4 の実測」。plan C6 に同期した。
- **使い捨てのコンテナ**: 実行ごとに作って必ず消す。セッションは入力ファイルをメモリに持つ。これで「削除の `finally`」「タイムアウトで強制削除」が単純になり、残ったコンテナは `onWarning` と `close` の再削除で扱う。`SandboxRegistry.acquire` は `SandboxLease`（`session`、`recreated`、`done()`）を返す。使用中の貸出がある間は `sweep` が破棄しない。
- **PROVE が見つけたもの**: Docker のコンテナテストは、設定の検査（単体テスト）だけでは見えない点を実機で観測した。`CapEff` は非 root だと `CapDrop` なしでも 0 なので、`CapBnd`（束縛集合）で確かめる。「セッションを閉じる前にコンテナが消える」は、`close` が肩代わりして隠れていたため、閉じる前に確かめるテストを足した。PROVE のスタブが漏らした匿名ボリュームは手で片付けた（自分が作った分だけ）。


---

## 18. データ分析（C7）

アップロードを検査し、サンドボックスでコードを実行して失敗を修正しながら分析を進める修正ループと、出力の分離を提供する。

_Boundary:_ `packages/ai-core/src/analysis/**`, `packages/ai-core/fixtures/analysis/sales.csv`, `packages/ai-core/fixtures/scenarios/m3-3.ts`, `packages/ai-core/src/models/gateway.ts`, `packages/ai-core/src/models/gateway.test.ts`, `packages/ai-core/src/mock/index.ts`, `packages/ai-core/src/mock/m3-scenarios.test.ts`
_Depends:_ 6.1, 3.3, 4.7, 5.2, 17.1
_Requirements:_ 3.1, 3.3, 3.4, 3.5, 3.6, 3.9, 3.10
_Traces:_ REQ-003, C7, C15

- [x] 18.1 (P) `analysis/upload-check.ts` と `fixtures/analysis/sales.csv`: `checkUpload({ name, bytes, declaredLength? })` が、拡張子（`.csv` / `.xlsx` / `.xls`）、マジックバイト（xlsx は zip、xls は OLE2）、20 MB（20 MiB ちょうどは許容、+1 バイトで拒否）、CSV の NUL と UTF-8 の不正、空ファイルを検査する純関数を作る + `upload-check.test.ts` に、`.xlsx` の名前の `.docx`、`.csv` の名前の PNG、20 MB の境界、`declaredLength` が小さく実体が大きい場合、空ファイル、非対応形式を先に書く
  _Boundary:_ `packages/ai-core/src/analysis/upload-check.ts`, `packages/ai-core/src/analysis/upload-check.test.ts`, `packages/ai-core/fixtures/analysis/sales.csv`
  _Depends:_ none
  _Requirements:_ 3.9
  _Traces:_ REQ-003, C7, C15
- [x] 18.2 (P) `analysis/prelude.ts` と `analysis/output-parser.ts`: `analysisPrelude`（`show_figure(alt)`、`show_table(df, caption)` を定義する Python の断片）と、`parseSandboxOutput(stdout, limits)`（目印の行 `__PNG__:` / `__TABLE__:` を取り出し、PNG のマジックバイト・1 MB・`alt` の 1〜200 文字、表の 200 行を検査して `figures` / `tables` / `rejected` と画面用の `text` を返し、目印の行を `text` から除く純関数）を作る。目印の行は切り詰めの前に取り出す + `prelude.test.ts`・`output-parser.test.ts` に、PNG でない画像、大きさの超過、`alt` が空、デコード不能、200 行超（`totalRows` の保持）、目印の行が画面の標準出力から除かれること、標準出力が巨大でも目印の行が失われないこと、SVG や HTML を描画対象にしないことを先に書く
  _Boundary:_ `packages/ai-core/src/analysis/prelude.ts`, `packages/ai-core/src/analysis/prelude.test.ts`, `packages/ai-core/src/analysis/output-parser.ts`, `packages/ai-core/src/analysis/output-parser.test.ts`
  _Depends:_ none
  _Requirements:_ 3.5
  _Traces:_ REQ-003, C7, CL-19, ADR-2
- [x] 18.3 `analysis/attempts.ts` と `analysis/run-python-tool.ts`: `AnalysisAttempt`（コード 8000 文字まで、標準出力、標準エラー、エラーの要約）と試行履歴の組み立て、`createRunPythonTool` が `runPython` を `risk: "read-only"`（作用はサンドボックスの中だけ。CL-21）で定義し、サンドボックスのセッションをポート `SandboxSession` の型だけで受け取る（`sandbox/` の具象を import しない）。エラーの出力は標準エラーとトレースバックを 8000 文字までモデルに返し、4 回目の実行は行わず `FatalToolError`（`attempt-limit`）で止める + `attempts.test.ts`・`run-python-tool.test.ts` に、コード長の切り詰め、成功で止まること、3 回の修正の後に 4 回目の実行が**起きない**こと、タイムアウトがエラーとして扱われること、`risk` が `read-only` であることを先に書く
  _Boundary:_ `packages/ai-core/src/analysis/attempts.ts`, `packages/ai-core/src/analysis/attempts.test.ts`, `packages/ai-core/src/analysis/run-python-tool.ts`, `packages/ai-core/src/analysis/run-python-tool.test.ts`
  _Depends:_ 6.1, 18.2, 3.1, 4.7
  _Requirements:_ 3.3, 3.4, 3.6
  _Traces:_ REQ-003, C7, CL-21
- [x] 18.4 `analysis/agent.ts` と `analysis/index.ts`: `runAnalysis({ sandbox, file, instruction, model, options, observer, signal })` が、ファイルを生バイトのままサンドボックスへ書き込み（ホストで解析しない。ADR-1）、`analysisPrelude` を投入し、`createGuardedAgent` で `runPython` を使って分析する。失敗の修正は最大 3 回で、超えたら `attempt-limit`（最後のコード、エラー、試行履歴を返す）。壊れた xlsx は「ファイルを読めない」という結果で終える（修正ループに入れない）。結果は `AnalysisResult`（`status`、`attempts`、`figures`、`tables`、`text`）。`index.ts` は `@platform/ai-core/analysis` の公開 API を再エクスポートする + `agent.test.ts` に、疑似提供者（17.1）での成功、失敗 → 修正 → 成功、3 回失敗で `attempt-limit` と最後のコード・履歴、4 回目の実行が起きないこと、画像と表の取り出し、コード・標準出力・エラー・修正回数のイベント、中断で後続の実行が始まらないこと、`sandbox/` の具象を import していないことを先に書く
  _Boundary:_ `packages/ai-core/src/analysis/agent.ts`, `packages/ai-core/src/analysis/agent.test.ts`, `packages/ai-core/src/analysis/index.ts`
  _Depends:_ 18.3, 17.1, 3.3, 5.2
  _Requirements:_ 3.1, 3.3, 3.4, 3.5, 3.6, 3.10
  _Traces:_ REQ-003, C7, ADR-1
- [x] 18.5 `fixtures/scenarios/m3-3.ts`: 分析（コード生成 → 実行 → 成功、失敗 → 修正 → 成功、3 回失敗）のシナリオを作り、`gateway.ts` の `mock` 既定シナリオと `mock/index.ts` の集約に足す + `m3-scenarios.test.ts` の期待件数を更新して曖昧な一致がないことを確かめる
  _Boundary:_ `packages/ai-core/fixtures/scenarios/m3-3.ts`, `packages/ai-core/src/models/gateway.ts`, `packages/ai-core/src/models/gateway.test.ts`, `packages/ai-core/src/mock/index.ts`, `packages/ai-core/src/mock/m3-scenarios.test.ts`
  _Depends:_ 15.1, 18.4
  _Requirements:_ 3.3, 3.10
  _Traces:_ REQ-003, C15

### Implementation Notes

- **修正回数の数え方（読み方の確認が要る）**: Req 3.3「修正を最大 3 回まで繰り返す」を、**初回の実行 1 回 + 修正の実行 3 回 = 最大 4 回の実行**と読んだ。計画の「3 回の修正の後に 4 回目の実行が起きない」の「4 回目」は 4 回目の*修正*（通算 5 回目）と解釈している。通算 4 回目に失敗した時点（最後の修正の失敗）で `attempt-limit` を投げ、モデルへ 5 回目を求めない。別の読み（通算 3 回）なら `maxFixAttempts` を 2 にする。`createAttemptLog` が数え（失敗した実行の次の実行 = 修正）、成功した実行のあとの実行は修正に数えない。**許容は失敗ごと**（成功で失敗は終わり、新しい失敗には改めて 3 回。W4 のレビュー F-3 で分析全体の累積から改めた）。成功の判定も改め、最後の実行が成功したときだけ `succeeded`、そうでなければ `incomplete`（レビュー F-2）。サンドボックス自体が使えなくなったら `sandbox-unavailable` で止める（F-1）。plan の CL-26 に記録した。
- **ヘルパー関数は 1 本のモジュール `sandbox_helpers.py`**: `analysisPrelude` をそのファイルの内容として最初に書き込み、各実行のコードの先頭に `from sandbox_helpers import show_figure, show_table` の 1 行だけを足す。Docker は実行ごとに別プロセスなので毎回 import が要り、コードの前に長い断片を連結するより行番号のずれが 1 行で済む。トレースバックの行番号は 1 行ずれる（エラーのソース行も出るため、モデルは文面で対応づけられる）。実コンテナでのテストが、NaN・NaT・inf を `null` にすること、200 行で切ること、図を閉じることを確かめた。
- **壊れた Excel は修正ループに入れない**: `.xlsx` / `.xls` だけ、モデルを呼ぶ前に openpyxl / xlrd で開く 1 回の下調べ（試行にも修正にも数えない）を行い、失敗なら `status: "unreadable"` で終える。CSV は下調べせず、読み方（`sep`、エンコーディング）はモデルが直す。plan の `AnalysisResult.status`（`succeeded` / `attempt-limit`）に `unreadable`（読めない）と `stopped`（ステップ・トークン・時間の上限）を足した。
- **アップロード検査の限界**: CSV は UTF-8 のみ受ける（Excel の日本語版が保存する Shift_JIS の CSV は `encoding` で拒否する。plan のとおり。受け付けるかは別の判断）。`.xlsx` は zip の中央ディレクトリの名前だけを読んで `xl/workbook.xml` の有無を見る（展開しない。ADR-1）。`.xls` は OLE2 の署名と `Workbook` / `Book` のストリーム名を見る。
- **PROVE で見つけたもの**: 検査の冗長な行（ZIP64 の事前検査、`acquire` 時の `lastActive`）は生き残った等価なスタブから分かり、取り除いた。パーサーは `base64` の長さと文字種の検査が互いに隠し合っていたため、拒否の*理由の文面*を検査して区別した。


---

## 19. 分析の HTTP 入口（C13 の一部）

組み立て、アップロードの受信、セッションのレジストリ、ストリームの写像、`/api/analysis*` を作る。

_Boundary:_ `apps/web/lib/server/platform.ts`, `apps/web/lib/server/platform.test.ts`, `apps/web/lib/server/upload.ts`, `apps/web/lib/server/upload.test.ts`, `apps/web/lib/server/sessions.ts`, `apps/web/lib/server/sessions.test.ts`, `apps/web/lib/server/domain-stream.ts`, `apps/web/lib/server/domain-stream.test.ts`, `apps/web/app/api/analysis/**`
_Depends:_ 17.7, 18.5, 15.2
_Requirements:_ 3.1, 3.5, 3.6, 3.7, 3.8, 3.9
_Traces:_ REQ-003, C13

- [x] 19.1 `platform.ts`: `getSandboxSelection()` を組み立てる（起動時に提供者を選び、`mock` では疑似提供者。提供者とサンドボックスのレジストリは `globalThis` のホルダーで 1 つだけ）+ `platform.test.ts` に、実行モード別の組み立て、鍵が無いときの無効化と案内（`guidance`）を先に足す
  _Boundary:_ `apps/web/lib/server/platform.ts`, `apps/web/lib/server/platform.test.ts`
  _Depends:_ 15.2, 17.2, 17.7
  _Requirements:_ 3.8
  _Traces:_ REQ-003, C13
- [x] 19.2 (P) `lib/server/upload.ts`: `readUpload(request, { maxBytes })` が `multipart/form-data` を受信し、`Content-Length` と受信バイト数の両方で上限（20 MiB）を検査して、超えたら残りを読まずに打ち切る。`file` が 0 個または 2 個以上、`instruction`・`sessionId` の欠落を拒否する + `upload.test.ts` に、宣言が小さく実体が大きい multipart の拒否、20 MiB ちょうどと +1 バイト、`file` の個数、打ち切り後に残りを読まないことを先に書く
  _Boundary:_ `apps/web/lib/server/upload.ts`, `apps/web/lib/server/upload.test.ts`
  _Depends:_ none
  _Requirements:_ 3.9
  _Traces:_ REQ-003, C13, CL-7
- [x] 19.3 (P) `lib/server/sessions.ts`: `createSessionRegistry<T>({ clock, idleTimeoutMs })` が `get`、`create(id, factory)`、`touch`、`dispose(id)` を持ち、アイドル破棄を `Clock` で数える。レジストリの実体は `platform.ts` と同じ `globalThis` のホルダーに 1 つだけ保持する（`getSessionRegistries()`）。ルートごとに別バンドルになりえて dev ではモジュールが再読み込みされるため、モジュールスコープの変数に置かない + `sessions.test.ts` に、アイドルの境界値、`dispose` のフック、あるモジュールインスタンスで作ったセッションを別のインスタンスから取得できること（ホルダーの共有）を先に書く
  _Boundary:_ `apps/web/lib/server/sessions.ts`, `apps/web/lib/server/sessions.test.ts`
  _Depends:_ none
  _Requirements:_ 3.7
  _Traces:_ REQ-003, C13, CL-8
- [x] 19.4 `lib/server/domain-stream.ts`: `data-analysis-attempt`・`data-analysis-figure`・`data-analysis-table`・`data-analysis-result`（イベント）への写像を足す + `domain-stream.test.ts` に、図表の上限（1 MB、200 行）が適用済みであること、`alt` が空の図を流さないこと、`attempt` の順序を先に足す
  _Boundary:_ `apps/web/lib/server/domain-stream.ts`, `apps/web/lib/server/domain-stream.test.ts`
  _Depends:_ 15.2, 18.4
  _Requirements:_ 3.5, 3.6
  _Traces:_ REQ-003, C13
- [x] 19.5 (P) `GET /api/analysis/status`: `{ sandbox: { kind } | { kind: "disabled"; reason; guidance }; upload: { maxBytes; accepts } }` を返す + `route.test.ts` に、E2B・Docker・無効の 3 通り、案内文に有効化に必要な設定が含まれること、秘密が応答に現れないことを先に書く
  _Boundary:_ `apps/web/app/api/analysis/status/route.ts`, `apps/web/app/api/analysis/status/route.test.ts`
  _Depends:_ 19.1
  _Requirements:_ 3.8
  _Traces:_ REQ-003, C13
- [x] 19.6 `POST /api/analysis`: multipart を検査し（413 → 400 形式 → 件数・長さ → `live` のみ 429）、`checkUpload` に失敗したらサンドボックスも LLM も起動せず理由を返し（400 `invalid-request`、20 MB 超は 413）、サンドボックスが無効なら 503 `provider-unavailable` と `guidance` を `details` に含める。検査に通ったらセッションのサンドボックスを取得し（期限切れなら 1 回だけ作り直して通知）、`runAnalysis` の進行を `data-analysis-*` として流す。`request.signal` の abort でサンドボックスを破棄し実行を中断する + `route.test.ts` に、検査順、拒否のとき**サンドボックスが起動しない**こと、無効時の 503、`mock` での完走（成功、修正して成功、`attempt-limit`）、接続断での破棄を先に書く
  _Boundary:_ `apps/web/app/api/analysis/route.ts`, `apps/web/app/api/analysis/route.test.ts`
  _Depends:_ 19.1, 19.2, 19.3, 19.4, 18.4, 18.5
  _Requirements:_ 3.1, 3.5, 3.6, 3.7, 3.8, 3.9
  _Traces:_ REQ-003, C13
- [x] 19.7 `DELETE /api/analysis/sessions/[id]`: サンドボックスを破棄して 204 を返す（存在しない ID も 204。ID の形式が不正なら 400）。**あるルートで作ったセッションを別のルートから破棄できる**ことを検査する + `route.test.ts` に、`/api/analysis` が作ったセッションを DELETE が実際に破棄して提供者の `close` が呼ばれること、冪等、不正な ID を先に書く
  _Boundary:_ `apps/web/app/api/analysis/sessions/[id]/route.ts`, `apps/web/app/api/analysis/sessions/[id]/route.test.ts`
  _Depends:_ 19.6
  _Requirements:_ 3.7
  _Traces:_ REQ-003, C13, CL-8

### Implementation Notes

- **検査の順序**: アップロードの受信（413 は `Content-Length` と受信バイト数の両方、フォームの形 400、`file` の個数）→ 指示と `sessionId`（400、長さは `limit-exceeded`）→ `checkUpload`（400）→ サンドボックスが無効なら 503（`details.guidance`）→ `live` のレート制限（429）→ モデル（`tools` が要る）→ そのセッションのサンドボックス。拒否のたびにサンドボックスもモデルも起動せず、レート制限の枠も使わない（テストが `provider.sessions` と `modelCalls` で確かめる）。
- **プロセスに 1 つのレジストリ**: サンドボックスのレジストリと掃除のタイマーは `globalThis` のホルダーに 1 つ。`DELETE` は別のルートが作ったセッションを実際に閉じる（同じ vitest プロセスでの確認。ルートごとに別バンドルになる実サーバーでの確認は 20.1）。無効な設定は保持せず、Docker を起動すれば次の要求で使われる。
- **接続断と終了**: `request.signal` の abort でそのセッションのサンドボックスを閉じ、`runAnalysis` にも同じ signal を渡す（モデルの次の呼び出しも始まらない）。正常に終えたときはサンドボックスを残し、同じ `sessionId` の次の要求が再利用する（10 分のアイドルか `DELETE` で閉じる）。期限切れなら作り直したことを `data-analysis-notice` で知らせる。
- **計画に足したもの**: ストリームのパート `data-analysis-notice`（捨てた図表の理由、作り直しの通知）。`data-analysis-result` の `status` に `unreadable` と `stopped`。`GET /api/analysis/status` の `kind` に `mock`。
- **`getSessionRegistry`（`sessions.ts`）は W6 の要件インタビューが最初の利用者**: 分析自体は `SandboxRegistry` を使う。


---

## 20. 実サーバー確認と W4 の締め

_Boundary:_ `apps/web/next.config.ts`, `apps/web/e2e/real-server.spec.ts`, `mise.toml`, `stryker.config.mjs`, `specs/003-domain-agents/research.md`
_Depends:_ 19.7, 11.1
_Requirements:_ 3.1, 3.2, 3.7, 3.9
_Traces:_ REQ-003, C13, C16, R-1

- [x] 20.1 実サーバー（`mock`）で、`@e2b/code-interpreter` がバンドルされて起動できること、`/api/analysis` が疑似提供者で完走すること、`/api/analysis` が作ったセッションを `DELETE /api/analysis/sessions/[id]` が実際に破棄すること（ルートをまたいだセッションの共有）を `real-server.spec.ts` で確かめ、`next.config.ts` の `serverExternalPackages` を必要最小限に更新する。結果を research.md の R-1 に追記する
  _Boundary:_ `apps/web/next.config.ts`, `apps/web/e2e/real-server.spec.ts`, `specs/003-domain-agents/research.md`
  _Depends:_ 19.7, 11.1
  _Requirements:_ 3.1, 3.7
  _Traces:_ REQ-003, C13, R-1
  _Verify:_ `mise run test:e2e`（実サーバー）が成功する。足した `serverExternalPackages` の理由が research.md にある
- [x] 20.2 W4 の結線: `mise.toml` の `check:repo-rules --only` に `sandbox-import-scope` を足し、`stryker.config.mjs` に `analysis/upload-check.ts` と `analysis/output-parser.ts` を足す
  _Boundary:_ `mise.toml`, `stryker.config.mjs`
  _Depends:_ 20.1, 6.2, 17.7
  _Requirements:_ 3.2, 3.5, 3.9
  _Traces:_ REQ-003, C16
  _Verify:_ `mise run check:repo-rules` が `sandbox-import-scope` を走査 1 件以上で成功する。`mise run test:mutation` が閾値 70 を満たす
- [x] 20.3 W4 の gate を実測して記録する。`mise run gate` の成功を引用し、所要時間を research.md に追記する。`mise run test:container` の結果（実行した場合）を併記し、Docker が無い環境では未実行と明記する
  _Boundary:_ `specs/003-domain-agents/research.md`
  _Depends:_ 20.2
  _Requirements:_ 3.8
  _Traces:_ REQ-003, C16
  _Verify:_ `mise run gate` の成功と所要時間を research.md に記録した。W4 の敵対的レビューの記録が `.sdd/reviews/003-domain-agents-impl-w4-review-*.md` にある

### Implementation Notes

- **Playwright が Node のネイティブ ESM でシナリオを読む**: `m3-3.ts` が `sandbox/mock.ts`（JSON の fixture を import する）に届き、`needs an import attribute of "type: json"` で落ちた。Vitest とバンドラーは気にしないため、実サーバーの確認でしか見つからない。定数 `MOCK_ERROR_MARKER` を JSON を読まない `mock-marker.ts` に分け、シナリオが `mock.ts` を import しないことをテストで守った。
- **`sandbox-import-scope` を配線するときに自分のテスト基盤が引っかかった**: ネットワーク遮断の例外（`tooling/vitest/`）とスキップ補助（`testing/container-only*`）は Docker のソケット名を書く。規則は本番のコードのためのものなので、この 2 か所だけを除外した（他のテストは従来どおり規則の対象で、除外の範囲を狭めるテストがある）。`apps/web` のテストが書いていたソケット名の文字列は、規則を緩めずテスト側を直した。
- **`DELETE` の本文が無い 204 は観測できない**: 実サーバーで「別のバンドルのレジストリを閉じた」ことを確かめるため、応答ヘッダー `x-analysis-session: released | absent` を足した（計画に無い小さな追加）。
- **E2B の SDK**: キーが無いと実機のバンドルは確認できない。単体テストが実 SDK の読み込みと、`Sandbox.create` が `api.e2b.app` へ接続しようとすることまでを確かめる（接続はテスト側で止める）。
- **W4 の結線の実測**: gate 45.3 秒（W3 の締めから +4 秒）、実 Docker の `test:container` 15 件、3 エンジンの E2E 393 件（chromium 131 / firefox 131 / webkit 131）、`check:client-bundle` 成功（20 ファイル、16 名前と 5 センチネル。`E2B_API_KEY` は `config/env-schema` の名前から自動的に対象）、`secret-scan` と `audit` は指摘なし。
- **ミューテーション**: `mise run test:mutation` の全体が 87.14（閾値 70）、18 分 47 秒。`analysis/upload-check.ts` は 94.44、`analysis/output-parser.ts` は 86.09。
- **敵対的レビューと対応**: `.sdd/reviews/003-domain-agents-impl-w4-review-2026-10-18.md`（REQUEST_CHANGES: HIGH 1、MEDIUM 6、LOW 14）。HIGH と MEDIUM はすべてテスト先行で直した（サンドボックスが死んだのに `succeeded` と表示する欠陥 F-1、修正回数の累積 F-3、作成中のコンテナの取りこぼし F-4、ログの上限 F-5、Engine API のタイムアウト F-6、規則の除外範囲 F-7 など）。修正後の gate は 53.5 秒、`test:container` 17 件、3 エンジンの E2E 393 件。修正の再レビューは行っていない。見送った LOW は F-14、F-15、F-17（CL-21）、F-18、F-21（実サーバーでの切断は未確認）。

