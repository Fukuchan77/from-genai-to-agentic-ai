# domain-agents（Milestone 3）— 実装タスク（索引）

`/sdd-tasks` が生成した。承認済みの [spec.md](spec.md)（WHAT）と [plan.md](plan.md)（HOW、C1〜C16、Implementation Waves spike・W1〜W8）から、
実装の波ごとに分割した。ルールは `~/.claude/sdd/rules/tasks-generation.md` と `~/.claude/sdd/rules/tasks-parallel-analysis.md`
に従う。並列モード（`--sequential` 未指定）。002 の `tasks.md` と同じ運用（索引 + 現在の波の全文、未着手の波は `tasks-wN.md`、
完了した波は `tasks-comp-wN.md`）を採る。

## ファイル構成

| ファイル | 内容 |
|---|---|
| `tasks.md`（本ファイル） | 表記規約、ID 対応表、進捗、gate への段階的な結線、004 への引き継ぎ事項、**現在の波**（W3）のタスク全文 |
| `tasks-w4.md`〜`tasks-w8.md` | 未着手の波のタスク全文。波が現在の波になるとき `tasks.md` へ移す |
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
| W3 ヘルプデスク | 12 純関数とワークフロー部品、13 DB と永続化、14 runHelpdesk、15 HTTP 入口、16 W3 の締め | 着手中（本ファイル） | [tasks.md](tasks.md) |
| W4 サンドボックス・分析 | 17 サンドボックス提供者、18 データ分析、19 HTTP 入口、20 実サーバー確認と W4 の締め | 未着手 | [tasks-w4.md](tasks-w4.md) |
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

plan「人が行うこと」のとおり。Docker での `mise run sandbox:build` と `mise run test:container`（17.8、39.3）、E2B のキーを使う分析と GitHub のトークンを使う
MCP のハンズオンの確認と記録（任意。1.4、1.5、39.3）、spike の結果の確認（特に S-1 と S-5）、Clarifications の★の承認、完成タグの push。

## W1・W2 からの持ち越し

W1・W2 の敵対的レビューの指摘のうち、対応先の波へ送ったもの（`.sdd/reviews/003-domain-agents-impl-w1-review-2026-10-18.md` の「Responses」と、`.sdd/reviews/003-domain-agents-impl-w2-review-2026-10-18.md`）。

- W1 F-16（`test:container` のスキップ補助とネットワーク遮断の例外）: 17.x の境界に `tooling/vitest/*` を足して対応する。
- W1 F-17（`WORKFLOW_FILES` の取りこぼし）: 16.1 と 28.1 で走査件数の検査を足す。
- W1 F-10・F-11（`TokenLedger` の `RunObserver` 接続、取り込み記録の `source` の上限）: 22.x。
- W1 F-14（M1 の説明文の改訂で録画のキーが変わる）: 40.1 の 3-1 の「移植時の変更点」に書く。
- W2 で意図して持ち越した制約（plan C5 に記載）: F-1（ファイルサーバー 1 プロセスにつき索引 1 つ。単一の学習者前提）、F-3（再接続なし。再起動まで）、F-10（確認と使用の間の窓。`writeFile`・`deleteFile` はエージェントに登録しない）、F-15（`allowImportingTsExtensions` が workspace 全体）、F-16（何も読まなかった比較実行も `completed`）。W2 の修正の fresh な再レビューは未実施。

## 現在の波: W3 ヘルプデスク（大タスク 12〜16）

計画・再計画・判断のワークフロー、スケジューラ、認証情報の形状検査、チケットストア、`0002_helpdesk.sql`、初期投入、`/api/helpdesk*`、`m3-2` のシナリオを作る。
計画・再計画・判断は構造化出力のワークフローで、`ToolLoopAgent` と `createGuardedAgent` を import しない（ADR-9）。`createGuardedAgent` を使うのは `helpdesk/run.ts` のタスク実行だけ。

12.1・12.3 は並列に進められる。12.4・12.5 は 12.1 の後に並列に進められる。13.1 は 12.x と独立に進められる。15.4 は 15.2 の後に 15.3 と並列に進められる。

---

## 12. 計画・スケジューラ・判断の部品（C10）

計画の検査、差分、スケジューラ、認証情報の形状検査、計画・再計画・タスク実行を、純関数とワークフローとして作る。

_Boundary:_ `packages/ai-core/src/helpdesk/plan-schema.ts`, `packages/ai-core/src/helpdesk/plan-schema.test.ts`, `packages/ai-core/src/helpdesk/scheduler.ts`, `packages/ai-core/src/helpdesk/scheduler.test.ts`, `packages/ai-core/src/helpdesk/credentials.ts`, `packages/ai-core/src/helpdesk/credentials.test.ts`, `packages/ai-core/src/helpdesk/planner.ts`, `packages/ai-core/src/helpdesk/planner.test.ts`, `packages/ai-core/src/helpdesk/replanner.ts`, `packages/ai-core/src/helpdesk/replanner.test.ts`, `packages/ai-core/src/helpdesk/run.ts`, `packages/ai-core/src/helpdesk/run.test.ts`, `packages/ai-core/fixtures/helpdesk/plans/*.json`
_Depends:_ 2.1, 3.3, 5.2
_Requirements:_ 2.1, 2.2, 2.3, 2.4, 2.8, 2.10
_Traces:_ REQ-002, C10, C15, ADR-9

- [ ] 12.1 (P) `helpdesk/plan-schema.ts` と `fixtures/helpdesk/plans/{cycle,missing-dependency,empty,valid}.json`: `Plan`・`PlanDiff` の Zod スキーマ（タスク ID は計画内で一意、1〜8 タスク）、`validatePlan`（`cycle`、`missing-dependency`、`empty` を返す純関数）、`diffPlan(before, after)`（`added`・`removed`・`changed` の ID 一覧。同じ ID で説明か依存が変わったものが `changed`。CL-13）を作る + `plan-schema.test.ts` に、循環（自己依存を含む）、存在しない依存、空の計画、9 タスク、差分の追加・削除・変更・変更なし、ID の保持を先に書く
  _Boundary:_ `packages/ai-core/src/helpdesk/plan-schema.ts`, `packages/ai-core/src/helpdesk/plan-schema.test.ts`, `packages/ai-core/fixtures/helpdesk/plans/*.json`
  _Depends:_ none
  _Requirements:_ 2.1, 2.3, 2.10
  _Traces:_ REQ-002, C10, C15, CL-13
- [ ] 12.2 `helpdesk/scheduler.ts`: `nextRunnable(plan, completed)` が、依存が全て完了しているタスクの先頭を返し、依存未完了のタスクを返さない純関数を作る + `scheduler.test.ts` に、依存順、複数の実行可能なタスクから先頭、全完了で `undefined`、依存が未完了のものだけが残るときの `undefined` を先に書く
  _Boundary:_ `packages/ai-core/src/helpdesk/scheduler.ts`, `packages/ai-core/src/helpdesk/scheduler.test.ts`
  _Depends:_ 12.1
  _Requirements:_ 2.2
  _Traces:_ REQ-002, C10
- [ ] 12.3 (P) `helpdesk/credentials.ts`: `detectCredentialShapes(text)` が、平文のパスワード、一時パスワード、API キー、アクセストークンの形状の種別だけを返す（値は返さない）純関数を作る + `credentials.test.ts` に、各種別の検出、日本語の文脈（「パスワードは」「仮パスワード:」など）、検出しない通常の文、値が戻り値に含まれないことを先に書く。検査の例の値は実在しない明らかな偽の値にする
  _Boundary:_ `packages/ai-core/src/helpdesk/credentials.ts`, `packages/ai-core/src/helpdesk/credentials.test.ts`
  _Depends:_ none
  _Requirements:_ 2.8
  _Traces:_ REQ-002, C10
- [ ] 12.4 (P) `helpdesk/planner.ts`: `planTasks({ model, ticket, knowledge, feedback?, signal })` が `generateValidated` で計画を作り、`validatePlan` が問題を返したら問題点を付けて再生成する（上限 `maxPlanRegenerations`、既定 2。超えたら呼び出し側が `escalated` にできるよう、不正の内容を結果で返す）。`ToolLoopAgent` を import しない + `planner.test.ts` に、正常な計画、循環・存在しない依存・空のフィードバック付き再生成、再生成 2 回で止まること、中断で後続の LLM 呼び出しが始まらないことを先に書く
  _Boundary:_ `packages/ai-core/src/helpdesk/planner.ts`, `packages/ai-core/src/helpdesk/planner.test.ts`
  _Depends:_ 12.1
  _Requirements:_ 2.1, 2.10
  _Traces:_ REQ-002, C10, ADR-9
- [ ] 12.5 (P) `helpdesk/replanner.ts`: `decideNext({ model, plan, completed, lastResult, signal })` が `continue` / `replan` / `finish` を判断理由とともに構造化出力で返す。`replan` では残りのタスクだけを再生成し、完了済みタスクの ID を保ち、`validatePlan` を通す（通らなければ 12.4 と同じ再生成）。`ToolLoopAgent` を import しない + `replanner.test.ts` に、3 値それぞれ、再計画で完了済み ID が保たれること、不正な再計画の再生成、構造化出力が壊れたときの再生成を先に書く
  _Boundary:_ `packages/ai-core/src/helpdesk/replanner.ts`, `packages/ai-core/src/helpdesk/replanner.test.ts`
  _Depends:_ 12.1
  _Requirements:_ 2.3
  _Traces:_ REQ-002, C10, ADR-9, CL-13
- [ ] 12.6 `helpdesk/run.ts`: `runTask({ task, knowledge, model, observer, signal })` が `createGuardedAgent` でタスクを実行する。ツールはナレッジ検索（M2 の `createSearchKnowledgeBaseTool`）の読み取りだけ。結果は `TaskResult`（`summary` 600 文字以内、`sources`）で返し、失敗は回復可能なら結果に失敗を記録して返す + `run.test.ts` に、検索ツールだけが登録されること、要約の長さ上限、失敗の記録、停止理由が `createGuardedAgent` の語彙で返ることを先に書く
  _Boundary:_ `packages/ai-core/src/helpdesk/run.ts`, `packages/ai-core/src/helpdesk/run.test.ts`
  _Depends:_ 12.1, 3.3, 5.2
  _Requirements:_ 2.2, 2.4
  _Traces:_ REQ-002, C10

### Implementation Notes

---

## 13. DB と永続化（C10、C15）

チケットと計画の改訂を DB に保存する。マイグレーションは `0002_helpdesk.sql`、`reset` は M3 の表だけを空にする。

_Boundary:_ `packages/ai-core/drizzle/0002_helpdesk.sql`, `packages/ai-core/src/rag/db/schema.ts`, `packages/ai-core/src/rag/db/schema.db.test.ts`, `packages/ai-core/src/rag/db/client.pg.test.ts`, `packages/ai-core/src/helpdesk/ticket-store.ts`, `packages/ai-core/src/helpdesk/ticket-store.db.test.ts`, `packages/ai-core/src/helpdesk/seed.ts`, `packages/ai-core/src/helpdesk/seed.db.test.ts`, `packages/ai-core/fixtures/helpdesk/faq/*.md`, `packages/ai-core/fixtures/helpdesk/tickets.json`, `scripts/seed-samples.ts`, `mise.toml`
_Depends:_ 12.1
_Requirements:_ 2.1, 2.3, 2.4, 2.6, 2.7, 2.8, 2.9
_Traces:_ REQ-002, C10, C15, C16, ADR-10

- [ ] 13.1 `drizzle/0002_helpdesk.sql` と `rag/db/schema.ts`: `helpdesk_tickets`（`status` と `answer` / `escalation_reason` / `stopped_reason` の組み合わせの CHECK 制約）と `helpdesk_plan_revisions`（`(ticket_id, revision)` の主キー、`revision = 0` のとき `diff` が NULL の CHECK、`ON DELETE CASCADE`）を作り、Drizzle のスキーマを広げる。SQL に `now()` を書かず、`CREATE EXTENSION` を足さない + `schema.db.test.ts` に、適用後の `information_schema.columns` との照合に M3 の表を足し、CHECK 制約（矛盾する組み合わせの拒否）を先に書く。`client.pg.test.ts`（Boundary の例外 (4)）に、`0002` を既存の `runMigrations` で実 Postgres に適用できる 1 ケースを足す
  _Boundary:_ `packages/ai-core/drizzle/0002_helpdesk.sql`, `packages/ai-core/src/rag/db/schema.ts`, `packages/ai-core/src/rag/db/schema.db.test.ts`, `packages/ai-core/src/rag/db/client.pg.test.ts`
  _Depends:_ none
  _Requirements:_ 2.6, 2.7
  _Traces:_ REQ-002, C10, ADR-10
  _Verify:_ `mise run gate` が PGlite で成功する。`mise run test:db`（Docker Postgres）で `0002` の適用が成功する（Docker が無ければ人が実行する）
- [ ] 13.2 `helpdesk/ticket-store.ts`: `createTicketStore(db)` の `create`（`T-` + 4 桁の連番を最大値から決定論的に採番し、衝突時はトランザクション内で再試行）、`setStatus`（`open` → `resolved` / `escalated` のみ。戻る遷移をストアと CHECK の両方で拒否）、`recordRevision`（追記のみ）、`get`、`list`（新しい順、50 件まで）を作る。`created_at` / `updated_at` は `Clock` から設定する + `ticket-store.db.test.ts` に、採番の決定論、状態遷移と戻る遷移の拒否、`resolved` の回答保存と `escalated` の理由、`stopped_reason`（`step-limit` / `aborted`）、改訂の追記と更新の拒否、`reset` が M3 の表だけを空にして `rag_*` を消さないことを先に書く
  _Boundary:_ `packages/ai-core/src/helpdesk/ticket-store.ts`, `packages/ai-core/src/helpdesk/ticket-store.db.test.ts`
  _Depends:_ 13.1, 12.1
  _Requirements:_ 2.1, 2.3, 2.4, 2.6, 2.7, 2.8
  _Traces:_ REQ-002, C10, CL-6, CL-14
- [ ] 13.3 `helpdesk/seed.ts` と `fixtures/helpdesk/{faq/*.md,tickets.json}`: `seedHelpdesk({ db, knowledge })` が冪等な初期投入を行う（FAQ・手順書は M2 の取り込みを使い、過去チケットは `tickets.json` から）。`reset` 引数は M3 の表だけを空にする。FAQ は日本語で見出し構造を持つ + `seed.db.test.ts` に、2 回実行しても行が増えないこと、`reset` の範囲、FAQ の取り込み失敗が M2 の `skipped` と同じ扱いになることを先に書く
  _Boundary:_ `packages/ai-core/src/helpdesk/seed.ts`, `packages/ai-core/src/helpdesk/seed.db.test.ts`, `packages/ai-core/fixtures/helpdesk/faq/*.md`, `packages/ai-core/fixtures/helpdesk/tickets.json`
  _Depends:_ 13.2
  _Requirements:_ 2.9
  _Traces:_ REQ-002, C10, C15
- [ ] 13.4 `scripts/seed-samples.ts`（`seedHelpdesk` を呼ぶ入口。Node 26 の型除去で直接起動する）と、`mise.toml` のタスク `seed:samples` を作る。マーケティングの投入は 27.9 が足す
  _Boundary:_ `scripts/seed-samples.ts`, `mise.toml`
  _Depends:_ 13.3
  _Requirements:_ 2.9
  _Traces:_ REQ-002, C16, CL-3
  _Verify:_ `mise run seed:samples` を 2 回実行しても投入件数が増えない（PGlite または Docker Postgres）。`mise tasks validate` が成功する

### Implementation Notes

---

## 14. runHelpdesk（C10）

計画 → 実行 → 判断の制御フローを、ステップの計数と最終回答の検査を含めて組み立てる。

_Boundary:_ `packages/ai-core/src/helpdesk/helpdesk.ts`, `packages/ai-core/src/helpdesk/helpdesk.test.ts`, `packages/ai-core/src/helpdesk/index.ts`
_Depends:_ 12.6, 13.2
_Requirements:_ 2.1, 2.2, 2.3, 2.4, 2.6, 2.7, 2.8, 2.10
_Traces:_ REQ-002, C10

- [ ] 14.1 `helpdesk/helpdesk.ts` と `helpdesk/index.ts`: `runHelpdesk` が、チケットを `open` で保存し（計画が検証を通った後に作る）、`planTasks` → `nextRunnable` → `runTask` → `decideNext` の順に進める。ステップは「タスクの実行 1 回と、計画・再計画の生成 1 回」を数え（CL-14）、上限（既定 12）に達したら未完了タスクの一覧を返してチケットを `open` のまま `stopped_reason = 'step-limit'` にする。再計画のたびに `diffPlan` で差分を `helpdesk_plan_revisions` に追記する。計画の再生成が上限（2 回）で直らなければ `escalated`（理由は計画の不正）。最終回答は `detectCredentialShapes` で検査し、検出時は保存も表示もせず種別だけを記録して 1 回再作成させ、再作成後も検出されたら `escalated`。解決なら `resolved` と回答を保存し、根拠がなければ `finish` で `escalated`（未解決の理由）。中断ではチケットを `open`・`stopped_reason = 'aborted'` にする。`index.ts` は `@platform/ai-core/helpdesk` の公開 API を再エクスポートする + `helpdesk.test.ts` に、依存順の実行、ステップ上限の境界（上限ちょうどで次を実行しない）、再計画の差分の記録、再生成 2 回での `escalated`、認証情報の形状で保存されないこと（再作成 1 回）、再作成後も検出で `escalated`、中断で後続の LLM 呼び出しが始まらないこと、`ToolLoopAgent` を計画に使っていないことを先に書く
  _Boundary:_ `packages/ai-core/src/helpdesk/helpdesk.ts`, `packages/ai-core/src/helpdesk/helpdesk.test.ts`, `packages/ai-core/src/helpdesk/index.ts`
  _Depends:_ 12.2, 12.3, 12.4, 12.5, 12.6, 13.2
  _Requirements:_ 2.1, 2.2, 2.3, 2.4, 2.6, 2.7, 2.8, 2.10
  _Traces:_ REQ-002, C10, CL-6, CL-14
  _Verify:_ 認証情報の形状の検査は、検出時に DB の行に回答が残らないことを `ticket-store` の `*.db.test.ts` 相当（PGlite）で確認する。`mise run gate` が成功する

### Implementation Notes

---

## 15. ヘルプデスクの HTTP 入口（C13 の一部、C15 の m3-2）

シナリオ、組み立て、ストリームの写像、`/api/helpdesk` と `/api/helpdesk/tickets*` を作る。

_Boundary:_ `packages/ai-core/fixtures/scenarios/m3-2.ts`, `packages/ai-core/src/models/gateway.ts`, `packages/ai-core/src/models/gateway.test.ts`, `packages/ai-core/src/mock/index.ts`, `packages/ai-core/src/mock/m3-scenarios.test.ts`, `apps/web/lib/server/platform.ts`, `apps/web/lib/server/platform.test.ts`, `apps/web/lib/server/domain-stream.ts`, `apps/web/lib/server/domain-stream.test.ts`, `apps/web/app/api/helpdesk/**`
_Depends:_ 14.1, 10.1, 10.2
_Requirements:_ 2.1, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.10
_Traces:_ REQ-002, C13, C15

- [ ] 15.1 `fixtures/scenarios/m3-2.ts`: ヘルプデスクの計画・再計画・タスク実行・判断・最終回答のシナリオ（`continue` / `replan` / `finish`、解決と未解決の両方）を作り、`gateway.ts` の `mock` 既定シナリオと `mock/index.ts` の集約に足す + `m3-scenarios.test.ts` の期待件数を更新して曖昧な一致がないことを確かめる
  _Boundary:_ `packages/ai-core/fixtures/scenarios/m3-2.ts`, `packages/ai-core/src/models/gateway.ts`, `packages/ai-core/src/models/gateway.test.ts`, `packages/ai-core/src/mock/index.ts`, `packages/ai-core/src/mock/m3-scenarios.test.ts`
  _Depends:_ 10.1, 14.1
  _Requirements:_ 2.1, 2.3
  _Traces:_ REQ-002, C15
- [ ] 15.2 `lib/server/domain-stream.ts`（作成。ヘルプデスクの写像）と `platform.ts`: `data-helpdesk-plan`（状態、`id: "plan"`）、`data-helpdesk-progress`（状態、`id: "progress"`）、`data-helpdesk-result`（イベント）への写像を作り、状態パートは同じ `id` で上書き、イベントは連番にする。`getHelpdeskStore()` を組み立てる + `domain-stream.test.ts` に、状態変化ごとにパートが書き出される順序と上書きの `id`、`credentialKinds` が種別だけで値を含まないことを先に書き、`platform.test.ts` に組み立てのテストを足す。DB に接続できない場合は 503 `provider-unavailable`（`mock` は PGlite のため発生しない）
  _Boundary:_ `apps/web/lib/server/domain-stream.ts`, `apps/web/lib/server/domain-stream.test.ts`, `apps/web/lib/server/platform.ts`, `apps/web/lib/server/platform.test.ts`
  _Depends:_ 10.2, 14.1
  _Requirements:_ 2.5, 2.6
  _Traces:_ REQ-002, C13
- [ ] 15.3 `POST /api/helpdesk`: `z.strictObject`（`inquiry` 1〜4000 文字、`modelId?`、`maxSteps?` 1〜30）を検査し（413 → 400 形式 → 400 件数・長さ → `live` のみ 429）、構造化出力に対応しないモデルとツール非対応のモデルを `capability-unsupported` で LLM を呼ぶ前に拒否し、`runHelpdesk` の進行を `data-helpdesk-*` として即時に書き出す（状態変化から 1 秒以内を満たす条件として、変化のたびにすぐ書き出すことを検査する）。完了時に `{ ticketId; status }` を返す。`request.signal` を伝播する + `route.test.ts` に、検査順、各拒否のコード、`mock` での完走（解決と未解決）、ステップ上限での `open`、計画が不正で再生成が尽きたときの `escalated`、中断、DB の行の確認を先に書く
  _Boundary:_ `apps/web/app/api/helpdesk/route.ts`, `apps/web/app/api/helpdesk/route.test.ts`
  _Depends:_ 15.1, 15.2
  _Requirements:_ 2.1, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.10
  _Traces:_ REQ-002, C13
- [ ] 15.4 (P) `GET /api/helpdesk/tickets`（クエリ `status?`、新しい順 50 件）と `GET /api/helpdesk/tickets/[id]`（チケットと `revisions`）を作る + `route.test.ts` に、状態の絞り込み、404 `invalid-request`、503、計画の改訂と差分の取得を先に書く
  _Boundary:_ `apps/web/app/api/helpdesk/tickets/route.ts`, `apps/web/app/api/helpdesk/tickets/route.test.ts`, `apps/web/app/api/helpdesk/tickets/[id]/route.ts`, `apps/web/app/api/helpdesk/tickets/[id]/route.test.ts`
  _Depends:_ 15.2
  _Requirements:_ 2.3, 2.6, 2.7
  _Traces:_ REQ-002, C13

### Implementation Notes

---

## 16. W3 の締め

_Boundary:_ `stryker.config.mjs`, `specs/003-domain-agents/research.md`
_Depends:_ 15.4
_Requirements:_ 2.2, 2.3, 2.10
_Traces:_ REQ-002, C16

- [ ] 16.1 `stryker.config.mjs` に `helpdesk/plan-schema.ts` と `helpdesk/scheduler.ts` を足す。`workflow-no-agent-loop` が `helpdesk/planner.ts`・`replanner.ts`・`helpdesk.ts` を走査し、`ToolLoopAgent` を import する違反例で落ちること（6.2 のテスト）を、実ファイルが揃った状態で `mise run check:repo-rules` により確認する
  _Boundary:_ `stryker.config.mjs`
  _Depends:_ 14.1, 6.2
  _Requirements:_ 2.2, 2.3, 2.10
  _Traces:_ REQ-002, C16
  _Verify:_ `mise run test:mutation` の対象に含まれ、閾値 70 を満たす。`mise run check:repo-rules` が成功する
- [ ] 16.2 W3 の gate を実測して記録する。`mise run gate` の成功を引用し、所要時間を research.md に追記する。追加した `*.db.test.ts` による gate の時間の増分も書く
  _Boundary:_ `specs/003-domain-agents/research.md`
  _Depends:_ 16.1
  _Requirements:_ 2.6
  _Traces:_ REQ-002, C16
  _Verify:_ `mise run gate` の成功と所要時間を research.md に記録した。W3 の敵対的レビューの記録が `.sdd/reviews/003-domain-agents-impl-w3-review-*.md` にある

### Implementation Notes
