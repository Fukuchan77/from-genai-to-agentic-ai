# domain-agents（Milestone 3）— 実装タスク（索引）

`/sdd-tasks` が生成した。承認済みの [spec.md](spec.md)（WHAT）と [plan.md](plan.md)（HOW、C1〜C16、Implementation Waves spike・W1〜W8）から、
実装の波ごとに分割した。ルールは `~/.claude/sdd/rules/tasks-generation.md` と `~/.claude/sdd/rules/tasks-parallel-analysis.md`
に従う。並列モード（`--sequential` 未指定）。002 の `tasks.md` と同じ運用（索引 + 現在の波の全文、未着手の波は `tasks-wN.md`、
完了した波は `tasks-comp-wN.md`）を採る。

## ファイル構成

| ファイル | 内容 |
|---|---|
| `tasks.md`（本ファイル） | 表記規約、ID 対応表、進捗、gate への段階的な結線、004 への引き継ぎ事項、**現在の波**（W6）のタスク全文 |
| `tasks-w7.md`、`tasks-w8.md` | 未着手の波のタスク全文。波が現在の波になるとき `tasks.md` へ移す |
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
| W6 要件・マーケティング | 25 要件インタビュー、26 マーケティング、27 HTTP 入口、28 W6 の締め | 実装・出荷済み（2026-10-24）。CI の `ci-status` の成功と `tasks-comp-w6.md` への移行は未 | [tasks.md](tasks.md) |
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

## W5 からの持ち越し

W5 の敵対的レビュー（`.sdd/reviews/003-domain-agents-impl-w5-review-2026-10-19.md`）の修正後の fresh な再レビューは未実施。

- arXiv の実応答と 429 / 503 / `Retry-After` の実挙動は未実測で、フィクスチャは仕様と推測に基づく（research.md に明記）。
- CL-26 は 2026-10-19 に確定済み（W4 の持ち越しを参照）。

## 現在の波: W6 要件・マーケティング（大タスク 25〜28）

面接のワークフロー、要件定義書、合議（`onRoleOutput` の追加）、プロファイル、レコメンド、`0003_marketing.sql`、カタログ、初期投入、
`/api/requirements/*`、`/api/marketing/*`、`m3-5`・`m3-6` のシナリオを作る。ペルソナ、面接、モデレーター、プロファイル抽出は構造化出力の
ワークフローで、`ToolLoopAgent` と `createGuardedAgent` を import しない（ADR-9）。合議だけが `cooperateByRole`（M2）を使う。

25.1・26.1・26.4・26.6 は並列に進められる。27.5・27.6 と 27.7・27.8 はそれぞれ並列に進められる。

## 25. 要件インタビュー（C11）

概要からペルソナを作り、ペルソナの視点で固定の往復の面接を進め、回答から要件を抽出し、十分性を判定して、固定の章立ての Markdown を作る。

_Boundary:_ `packages/ai-core/src/requirements/**`
_Depends:_ 2.1, 4.1
_Requirements:_ 5.1, 5.2, 5.3, 5.4, 5.5, 5.6
_Traces:_ REQ-005, C11, ADR-9

- [x] 25.1 (P) `requirements/session.ts`: 面接の状態（回答、要件、ラウンド数、完了の有無）の型と遷移の純関数を作る(CL-11)。回答が要件に結び付かないとき要件を変えない + `session.test.ts` に、ラウンドの進行、完了後の遷移の拒否、要件を変えない回答、上限到達の判定を先に書く
  _Boundary:_ `packages/ai-core/src/requirements/session.ts`, `packages/ai-core/src/requirements/session.test.ts`
  _Depends:_ none
  _Requirements:_ 5.3, 5.5
  _Traces:_ REQ-005, C11, CL-11
- [x] 25.2 `requirements/personas.ts`: `generatePersonas({ model, overview, count })` が、想定利用者のペルソナを `generateValidated` で構造化出力として生成する（既定 3、`DEFAULT_INTERVIEW`、範囲 1〜5）。`ToolLoopAgent` を import しない + `personas.test.ts` に、件数の設定、構造化出力が壊れたときの再生成、3 回失敗で `output-invalid` になること、範囲外の件数の拒否を先に書く
  _Boundary:_ `packages/ai-core/src/requirements/personas.ts`, `packages/ai-core/src/requirements/personas.test.ts`
  _Depends:_ 25.1
  _Requirements:_ 5.1
  _Traces:_ REQ-005, C11
- [x] 25.3 `requirements/interview.ts`: `askRound`（ペルソナごとの質問。不足項目があるときは不足項目に焦点を当てる）、`extractRequirements`（機能・非機能・制約・未確認事項を、各項目に出所のペルソナ ID を付けて抽出する。抽出に失敗したら直前の要件を保つ）、`judgeSufficiency`（`sufficient`・`missing`・`forcedEnd`。構造化出力の `sufficient` が真でも `missing` が空でなければ不十分、上限到達で `forcedEnd`）を作る。`ToolLoopAgent` を import しない + `interview.test.ts` に、不足項目への質問、雑談の回答で要件が変わらず未確認事項に足されること、`sufficient: true` かつ `missing` 非空を不十分とすること、上限未満での継続と上限到達の強制終了、抽出失敗時に直前の要件を保つことを先に書く
  _Boundary:_ `packages/ai-core/src/requirements/interview.ts`, `packages/ai-core/src/requirements/interview.test.ts`
  _Depends:_ 25.1, 25.2
  _Requirements:_ 5.2, 5.3, 5.4, 5.5
  _Traces:_ REQ-005, C11, ADR-9
- [x] 25.4 `requirements/document.ts` と `requirements/index.ts`: `renderRequirementDocument(requirements, { forcedEnd, missing })` が固定の章立ての Markdown を作る純関数（上限到達の終了では「未確認事項」の章に `missing` を列挙し、`missing` が空なら「なし」と書く）。`index.ts` は `@platform/ai-core/requirements` の公開 API を再エクスポートする + `document.test.ts` に、固定の章立て、上限到達で未確認事項の章に不足項目が載ること、`missing` が空のとき「なし」、入力由来の文字がファイル名やヘッダーに影響しないこと（本文のみ）を先に書く
  _Boundary:_ `packages/ai-core/src/requirements/document.ts`, `packages/ai-core/src/requirements/document.test.ts`, `packages/ai-core/src/requirements/index.ts`
  _Depends:_ 25.1, 25.3
  _Requirements:_ 5.6
  _Traces:_ REQ-005, C11

### Implementation Notes

- 面接の状態は `round` を「閉じたラウンド数」とし、`judgeSufficiency` には `state.round + 1` を渡して `closeRound` へそのまま渡す。十分性の規則（`sufficient` でも `missing` が空でなければ不十分）の持ち主は `judgeSufficiency` の 1 か所だけにした。
- 抽出の失敗は「雑談で要件が変わらない」と区別する（W6 レビュー F-4）。失敗は `StructuredOutputError` を投げ、ルートが `output-invalid` で止めてラウンドを確定しない。
- ペルソナの ID はコードが `persona-N` と振る。モデルの出力に ID を含めると、スキーマ違反として再生成する。

---

## 26. マーケティング合議とレコメンド（C12）

複数ペルソナのラウンドロビン合議を `cooperateByRole` で進め、ラウンドごとに合意を確定し、会話から利用者プロファイルを逐次更新し、カタログからだけレコメンドを選ぶ。

_Boundary:_ `packages/ai-core/src/patterns/role-based-cooperation.ts`, `packages/ai-core/src/patterns/role-based-cooperation.test.ts`, `packages/ai-core/drizzle/0003_marketing.sql`, `packages/ai-core/src/rag/db/schema.ts`, `packages/ai-core/src/rag/db/schema.db.test.ts`, `packages/ai-core/src/rag/db/client.pg.test.ts`, `packages/ai-core/fixtures/marketing/*.json`, `packages/ai-core/src/marketing/**`
_Depends:_ 13.1, 2.1
_Requirements:_ 6.1, 6.2, 6.3, 6.4, 6.5, 6.6
_Traces:_ REQ-006, C12, C15, ADR-9

- [x] 26.1 (P) `patterns/role-based-cooperation.ts`: 役割ごとの発言の通知 `onRoleOutput` を任意の引数として足す（M2 の公開契約は変えない）+ `role-based-cooperation.test.ts` に、通知の呼び出し順（ラウンドロビンの順序）、通知を渡さないとき M2 の挙動が変わらないことを先に足す。M2 のテストが緑のままであることを確認する
  _Boundary:_ `packages/ai-core/src/patterns/role-based-cooperation.ts`, `packages/ai-core/src/patterns/role-based-cooperation.test.ts`
  _Depends:_ none
  _Requirements:_ 6.1, 6.3
  _Traces:_ REQ-006, C12
- [x] 26.2 `drizzle/0003_marketing.sql`・`rag/db/schema.ts` と `fixtures/marketing/{products,personas}.json`: `marketing_products`（`P-` + 3 桁の ID、`price_yen >= 0` の CHECK、`tags text[]`）と `marketing_personas`（`ordinal` の UNIQUE）を作り、Drizzle のスキーマを広げ、初期データ（既定の 3 ペルソナ ID `marketer-strict` / `consumer` / `seo-specialist` を含む）を作る + `schema.db.test.ts` に、M3 の表の `information_schema.columns` との照合と CHECK / UNIQUE を足し、`client.pg.test.ts`（Boundary の例外 (4)）に `0003` を実 Postgres に適用できる 1 ケースを足す
  _Boundary:_ `packages/ai-core/drizzle/0003_marketing.sql`, `packages/ai-core/src/rag/db/schema.ts`, `packages/ai-core/src/rag/db/schema.db.test.ts`, `packages/ai-core/src/rag/db/client.pg.test.ts`, `packages/ai-core/fixtures/marketing/products.json`, `packages/ai-core/fixtures/marketing/personas.json`
  _Depends:_ 13.1
  _Requirements:_ 6.5, 6.6
  _Traces:_ REQ-006, C12, C15, CL-23
  _Verify:_ `mise run gate` が PGlite で成功する。`mise run test:db` で `0003` の適用が成功する（Docker が無ければ人が実行する）
- [x] 26.3 `marketing/catalog.ts` と `marketing/seed.ts`: `createCatalogRepo(db)`（`listProducts`、`listPersonas`、`has(productId)`）と、`seedMarketing({ db })`（冪等な初期投入。`reset` は M3 の表だけ）を作る + `catalog.db.test.ts`・`seed.db.test.ts` に、2 回実行しても行が増えないこと、`has` の真偽、ペルソナの順序（`ordinal`）、`reset` の範囲、未投入のときの扱いを先に書く
  _Boundary:_ `packages/ai-core/src/marketing/catalog.ts`, `packages/ai-core/src/marketing/catalog.db.test.ts`, `packages/ai-core/src/marketing/seed.ts`, `packages/ai-core/src/marketing/seed.db.test.ts`
  _Depends:_ 26.2
  _Requirements:_ 6.5, 6.6
  _Traces:_ REQ-006, C12, CL-15, CL-23
- [x] 26.4 (P) `marketing/moderator.ts`: `judgeAgreement({ model, round, turns, signal })` が `agreed`・`reason`・`remainingObjections` を `generateValidated` で返す。`agreed` が真でも `remainingObjections` が非空なら合意としない（コードの検査。CL-12）。`ToolLoopAgent` を import しない + `moderator.test.ts` に、反対が残る合意の拒否、`agreed: false`、判定が壊れたときの再生成、再生成が尽きたときの `output-invalid` を先に書く
  _Boundary:_ `packages/ai-core/src/marketing/moderator.ts`, `packages/ai-core/src/marketing/moderator.test.ts`
  _Depends:_ none
  _Requirements:_ 6.2
  _Traces:_ REQ-006, C12, CL-12, ADR-9
- [x] 26.5 `marketing/council.ts`: `runCouncil({ draft, personas, model, maxRounds, maxTotalTokens, observer, signal })` が、ラウンドの反復と合意の確定をコード（ワークフロー）で行い、ラウンドごとに `cooperateByRole`（役割は既定 3 名、ツールなし）で各ペルソナに他のペルソナの発言を踏まえさせ、`onRoleOutput` で発言を通知し、ラウンドの終わりに `judgeAgreement` で合意を確定する。合議全体のトークン予算（`DEFAULT_COUNCIL.maxTotalTokens`）を全ラウンドで共有し、各ラウンドの `budget.maxTotalTokens` に残量を渡す。合意、最大ラウンド（既定 3）、予算切れのいずれかで終了し、`CouncilResult`（`improvedDraft`、`rounds`、`endReason: "agreed" | "max-rounds" | "budget-exhausted"`、`usage`）を返す。`agents/` と `ToolLoopAgent` を直接 import しない（plan「構成の補足」の分類表、`workflow-no-agent-loop` の対象）。1 つのペルソナの発言が失敗したら欠落として記録して続行し、全員が失敗したらエラー + `council.test.ts` に、ラウンドロビンの順序、他者の発言を踏まえること、合意での終了、最大ラウンドでの `max-rounds`、予算切れで次のラウンドを始めず `budget-exhausted` になること、各ラウンドに残量が渡ること、1 名の失敗での継続と全員失敗、中断で後続の発言と判定が始まらないことを先に書く
  _Boundary:_ `packages/ai-core/src/marketing/council.ts`, `packages/ai-core/src/marketing/council.test.ts`
  _Depends:_ 26.1, 26.3, 26.4
  _Requirements:_ 6.1, 6.2, 6.3
  _Traces:_ REQ-006, C12
- [x] 26.6 (P) `marketing/profile.ts`: `extractProfile({ model, messages, previous, signal })` が、関心事・予算・懸念点を構造化出力で逐次抽出し、新しい値で上書きして欠けた値で既存を消さない。抽出に失敗したら直前のプロファイルを保つ。`ToolLoopAgent` を import しない + `profile.test.ts` に、欠けた値で既存を消さないこと、新しい値での上書き、抽出失敗時に直前を保つこと、配列のマージを先に書く
  _Boundary:_ `packages/ai-core/src/marketing/profile.ts`, `packages/ai-core/src/marketing/profile.test.ts`
  _Depends:_ none
  _Requirements:_ 6.4
  _Traces:_ REQ-006, C12, ADR-9
- [x] 26.7 `marketing/recommend.ts` と `marketing/index.ts`: `recommend({ model, profile, catalog, message, signal })` が、候補を `catalog` からだけ選び、商品 ID と推薦理由を付け、表示の前に商品 ID を照合してカタログに無いものを除去し `dropped` の件数を返す。全件が除去されたときは推薦なしと理由を返す。予算を超える商品は理由に明記する。`index.ts` は `@platform/ai-core/marketing` の公開 API を再エクスポートする + `recommend.test.ts` に、カタログ外 ID の除去と件数、全件除去、カタログ外の商品を作らないこと、予算超過の明記、`has` による照合を先に書く
  _Boundary:_ `packages/ai-core/src/marketing/recommend.ts`, `packages/ai-core/src/marketing/recommend.test.ts`, `packages/ai-core/src/marketing/index.ts`
  _Depends:_ 26.3, 26.5, 26.6
  _Requirements:_ 6.4, 6.5
  _Traces:_ REQ-006, C12, CL-15

### Implementation Notes

- 合議の予算は、発言とモデレーターの両方を数え、4 分の 1 をモデレーターのために予約する。1 回の呼び出しの大きさは事前に分からないため、「同程度の呼び出しが続く限りの上限」である（レビュー F-1）。
- 合意は「全ペルソナの発言がそろったラウンド」だけで認める（CL-12 の拡張。レビュー F-3）。
- 区切りタグの無害化は、プロンプトに利用者・モデルの文字を入れるすべての箇所で必要だった。プロファイルの `previous`（クライアントが送る値）が漏れていた。

---

## 27. 要件・マーケティングの HTTP 入口（C13 の一部、C15 の m3-5・m3-6）

_Boundary:_ `packages/ai-core/fixtures/scenarios/m3-5.ts`, `packages/ai-core/fixtures/scenarios/m3-6.ts`, `packages/ai-core/src/models/gateway.ts`, `packages/ai-core/src/models/gateway.test.ts`, `packages/ai-core/src/mock/index.ts`, `packages/ai-core/src/mock/m3-scenarios.test.ts`, `apps/web/lib/server/platform.ts`, `apps/web/lib/server/platform.test.ts`, `apps/web/lib/server/domain-stream.ts`, `apps/web/lib/server/domain-stream.test.ts`, `apps/web/app/api/requirements/**`, `apps/web/app/api/marketing/**`, `scripts/seed-samples.ts`
_Depends:_ 25.4, 26.7, 22.5, 23.1, 23.2, 19.3
_Requirements:_ 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6
_Traces:_ REQ-005, REQ-006, C13, C15

- [x] 27.1 `fixtures/scenarios/m3-5.ts` と `m3-6.ts`: ペルソナ・質問・要件の抽出・十分性の判定（不十分 → 十分と、上限到達）のシナリオと、合議の発言・合意の判定（反対が残る → 合意）・プロファイル・レコメンド（カタログ外の ID を含む）のシナリオを作り、`gateway.ts` の `mock` 既定シナリオと `mock/index.ts` の集約に足す + `m3-scenarios.test.ts` の期待件数を更新して曖昧な一致がないことを確かめる
  _Boundary:_ `packages/ai-core/fixtures/scenarios/m3-5.ts`, `packages/ai-core/fixtures/scenarios/m3-6.ts`, `packages/ai-core/src/models/gateway.ts`, `packages/ai-core/src/models/gateway.test.ts`, `packages/ai-core/src/mock/index.ts`, `packages/ai-core/src/mock/m3-scenarios.test.ts`
  _Depends:_ 22.5, 25.3, 26.5, 26.7
  _Requirements:_ 5.1, 5.3, 5.4, 6.2, 6.4
  _Traces:_ REQ-005, REQ-006, C15
- [x] 27.2 `platform.ts`: `getCatalogRepo()` を組み立てる（DB は M2 の基盤。未投入のとき 503 `provider-unavailable` と `mise run seed:samples` の案内）+ `platform.test.ts` に、実行モード別の組み立てと未投入の扱いを先に足す
  _Boundary:_ `apps/web/lib/server/platform.ts`, `apps/web/lib/server/platform.test.ts`
  _Depends:_ 23.1, 26.3
  _Requirements:_ 6.5, 6.6
  _Traces:_ REQ-006, C13
- [x] 27.3 `lib/server/domain-stream.ts`: `data-requirements-preview`（状態、`id: "preview"`）、`data-requirements-judgement`、`data-council-turn`（1 発言ごとに 1 パート）、`data-council-verdict`、`data-council-result`、`data-marketing-profile`（状態、`id: "profile"`）、`data-marketing-recommendation` への写像を足す + `domain-stream.test.ts` に、状態パートの上書き、発言ごとに 1 パートでペルソナ名が付くこと、イベントの連番を先に足す
  _Boundary:_ `apps/web/lib/server/domain-stream.ts`, `apps/web/lib/server/domain-stream.test.ts`
  _Depends:_ 23.2, 25.4, 26.5
  _Requirements:_ 5.3, 5.4, 6.2, 6.3, 6.4, 6.5
  _Traces:_ REQ-005, REQ-006, C13
- [x] 27.4 `POST /api/requirements/sessions`: `z.strictObject`（`overview` 1〜2000 文字、`modelId?`、`personaCount?` 1〜5、`maxRounds?` 1〜10）を検査し、構造化出力に対応しないモデルを `capability-unsupported` で拒否し、ペルソナを生成して面接のセッション（19.3 のレジストリ）を作り、`{ sessionId, personas, questions }` を返す + `route.test.ts` に、検査順、各拒否、ペルソナの構造化出力が 3 回失敗したときの 502 `output-invalid`、`mock` での完走を先に書く
  _Boundary:_ `apps/web/app/api/requirements/sessions/route.ts`, `apps/web/app/api/requirements/sessions/route.test.ts`
  _Depends:_ 25.2, 27.1, 27.3, 19.3
  _Requirements:_ 5.1, 5.2
  _Traces:_ REQ-005, C13
- [x] 27.5 (P) `POST /api/requirements/sessions/[id]/messages`: `{ answers: { questionId; text }[] }`（1〜10 件、各 1〜2000 文字）を検査し、1 ラウンドを進めて `data-requirements-preview` を回答ごとに更新し、`data-requirements-judgement` を返し、不足と上限未満なら追加の質問、十分または上限到達で要件定義書を生成する。存在しない・破棄済みのセッションは 404、完了済みは 409 `invalid-request`、存在しない `questionId` は 400。**別のルートで作ったセッションを参照できる**ことを検査する + `route.test.ts` に、ラウンドの進行、プレビューの更新、判定、上限到達の強制終了、404 / 409 / 400、`/api/requirements/sessions` が作ったセッションに 404 にならないことを先に書く
  _Boundary:_ `apps/web/app/api/requirements/sessions/[id]/messages/route.ts`, `apps/web/app/api/requirements/sessions/[id]/messages/route.test.ts`
  _Depends:_ 27.4, 25.3, 25.4
  _Requirements:_ 5.2, 5.3, 5.4, 5.5, 5.6
  _Traces:_ REQ-005, C13, CL-8, CL-11
- [x] 27.6 (P) `GET /api/requirements/sessions/[id]/document`: `text/markdown; charset=utf-8` と `Content-Disposition: attachment; filename="requirements.md"`（ファイル名は固定。入力由来の文字を含めない）で要件定義書を返す。まだ生成されていなければ 409、破棄済みは 404 + `route.test.ts` に、ヘッダ、固定のファイル名、409 / 404、本文の章立てを先に書く
  _Boundary:_ `apps/web/app/api/requirements/sessions/[id]/document/route.ts`, `apps/web/app/api/requirements/sessions/[id]/document/route.test.ts`
  _Depends:_ 27.4, 25.4
  _Requirements:_ 5.7
  _Traces:_ REQ-005, C13
- [x] 27.7 (P) `POST /api/marketing/council`: `z.strictObject`（`draft` 1〜2000 文字、`modelId?`、`maxRounds?` 1〜6、`personaIds?` 2〜5 件）を検査し、存在しないペルソナ ID を 400、カタログとペルソナが未投入なら 503 で拒否し、`runCouncil` の進行を `data-council-turn` / `data-council-verdict` / `data-council-result` として流す + `route.test.ts` に、検査順、各拒否、`mock` の完走（反対が残る → 合意）、最大ラウンドでの終了、ペルソナ名付きの発言、中断を先に書く
  _Boundary:_ `apps/web/app/api/marketing/council/route.ts`, `apps/web/app/api/marketing/council/route.test.ts`
  _Depends:_ 27.1, 27.2, 27.3, 26.5
  _Requirements:_ 6.1, 6.2, 6.3
  _Traces:_ REQ-006, C13
- [x] 27.8 (P) `POST /api/marketing/recommend`: `{ id, messages, modelId?, profile? }` を検査し、会話ごとに `extractProfile` でプロファイルを更新して `data-marketing-profile` を流し、`recommend` の結果（除去の件数を含む）を `data-marketing-recommendation` として流す。未投入は 503 + `route.test.ts` に、プロファイルの逐次更新、カタログ外 ID の除去と `dropped`、全件除去の応答、抽出失敗時に画面の更新がないこと、未投入の 503 を先に書く
  _Boundary:_ `apps/web/app/api/marketing/recommend/route.ts`, `apps/web/app/api/marketing/recommend/route.test.ts`
  _Depends:_ 27.1, 27.2, 27.3, 26.7
  _Requirements:_ 6.4, 6.5
  _Traces:_ REQ-006, C13
- [x] 27.9 `scripts/seed-samples.ts` に `seedMarketing` の呼び出しを足す
  _Boundary:_ `scripts/seed-samples.ts`
  _Depends:_ 13.4, 26.3
  _Requirements:_ 6.6
  _Traces:_ REQ-006, C16
  _Verify:_ `mise run seed:samples` を 2 回実行しても、ヘルプデスクと商品・ペルソナの投入件数が増えない

### Implementation Notes

- Route Handler は handler 以外を export できないため、本文スキーマとセッションの取得口は ai-core に置いた（例外 (12)）。別のルートが作ったセッションを引くのは `globalThis` のレジストリで、`vi.resetModules()` の後の import で確かめる（非リテラルの動的 import は `mcp-import-scope` が拒否する）。
- ロックは最初の `await` の前に取る（レビュー F-2）。検査を `await` の前に済ませても、ロックをその後に取ると二重送信が通る。
- `useChat` が返す履歴には前のターンの `data-*` パートが入る。ルートが出さない形のメッセージをテストで自作すると、この往復を見逃す（レビュー F-6）。実際のストリームから作る。

---

## 28. W6 の締め

_Boundary:_ `stryker.config.mjs`, `specs/003-domain-agents/research.md`
_Depends:_ 27.9, 27.8, 27.7, 27.6, 27.5
_Requirements:_ 5.4, 6.2, 6.5
_Traces:_ REQ-005, REQ-006, C16

- [x] 28.1 `stryker.config.mjs` に `marketing/moderator.ts` と `marketing/recommend.ts` を足す。`workflow-no-agent-loop` が `requirements/interview.ts`・`personas.ts`、`marketing/council.ts`・`moderator.ts`・`profile.ts`・`recommend.ts` を走査し、違反例で落ちること（6.2 のテスト）を、実ファイルが揃った状態で `mise run check:repo-rules` により確認する
  _Boundary:_ `stryker.config.mjs`
  _Depends:_ 26.7, 25.4, 6.2
  _Requirements:_ 6.2, 6.5
  _Traces:_ REQ-006, C16
  _Verify:_ `mise run test:mutation` の対象に含まれ、閾値 70 を満たす。`mise run check:repo-rules` が成功する
- [x] 28.2 W6 の gate を実測して記録する。`mise run gate` の成功を引用し、所要時間を research.md に追記する。`cooperateByRole` に `onRoleOutput` を足しても M2 のテストが緑であることを併記する
  _Boundary:_ `specs/003-domain-agents/research.md`
  _Depends:_ 28.1
  _Requirements:_ 5.4
  _Traces:_ REQ-005, C16
  _Verify:_ `mise run gate` の成功と所要時間を research.md に記録した。W6 の敵対的レビューの記録が `.sdd/reviews/003-domain-agents-impl-w6-review-*.md` にある

### Implementation Notes

- W6 のレビュー（REQUEST_CHANGES、MEDIUM 8 件・LOW 15 件）の指摘は、予算（F-1）、二重送信（F-2）、合意の規則（F-3）、抽出失敗（F-4）、判定の流し方（F-5）、再送の往復（F-6）を中心にテスト先行で直した。対応の記録は `.sdd/reviews/003-domain-agents-impl-w6-review-2026-10-24.md` の「Responses」。修正後の fresh な再レビューは未実施。
- 行ごとの変異テスト（Stryker）が緑でも、実行全体の不変条件（予算の合計、二重送信、複数ターンの往復）は見つからない。W5 に続き、レビューが見つけた 3 件はいずれも不変条件の側だった。
