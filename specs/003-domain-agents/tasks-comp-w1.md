# domain-agents（Milestone 3）— 実装タスク（索引）

`/sdd-tasks` が生成した。承認済みの [spec.md](spec.md)（WHAT）と [plan.md](plan.md)（HOW、C1〜C16、Implementation Waves spike・W1〜W8）から、
実装の波ごとに分割した。ルールは `~/.claude/sdd/rules/tasks-generation.md` と `~/.claude/sdd/rules/tasks-parallel-analysis.md`
に従う。並列モード（`--sequential` 未指定）。002 の `tasks.md` と同じ運用（索引 + 現在の波の全文、未着手の波は `tasks-wN.md`、
完了した波は `tasks-comp-wN.md`）を採る。

## ファイル構成

| ファイル | 内容 |
|---|---|
| `tasks.md`（本ファイル） | 表記規約、ID 対応表、進捗、gate への段階的な結線、004 への引き継ぎ事項、**現在の波**（spike と W1）のタスク全文 |
| `tasks-w2.md`〜`tasks-w8.md` | 未着手の波のタスク全文。波が現在の波になるとき `tasks.md` へ移す |
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
| spike・W1 基盤 | 1 spike と依存の宣言、2 設定・ゲートウェイ、3 致命的エラーとラッチ、4 ACI の検査と補助、5 TokenLedger と観測口、6 ポート・規則・枠、7 W1 の締め | 未着手（本ファイル） | [tasks.md](tasks.md) |
| W2 MCP・ファイル | 8 ファイル操作と自作 MCP サーバー、9 MCP クライアントアダプター、10 MCP の HTTP 入口、11 実サーバー確認と W2 の締め | 未着手 | [tasks-w2.md](tasks-w2.md) |
| W3 ヘルプデスク | 12 純関数とワークフロー部品、13 DB と永続化、14 runHelpdesk、15 HTTP 入口、16 W3 の締め | 未着手 | [tasks-w3.md](tasks-w3.md) |
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

---

## 現在の波: spike・W1 基盤（大タスク 1〜7）

依存の宣言、spike の最小実験、設定・環境変数・機能の必要条件、致命的エラーのラッチ、ACI の検査と補助、`TokenLedger` と観測口、
サンドボックスのポート、リポジトリ規則、`test:container` の枠を揃える。この波の終わりに `pnpm audit` が 0 件であること（ADR-4、憲章 原則 7）と、
`allowBuilds` の警告が出ないことを確かめる。

1.1・1.2 は並列に進められる。2.1・4.1・4.3・4.5・5.1・6.1・6.2・6.3・6.4 は互いに独立で並列に進められる。3.x は 1.1（S-1）の後、
4.2 は 1.1 の後、4.7 は 4.1・4.2・4.6 の後に行う。7.x は最後に行う。

---

## 1. spike と依存の宣言

plan「先に確かめること」の 6 件を最小の実験で確かめて research.md に追記し、M3 の依存 4 件を宣言する。実験のコードはスクラッチパッドに置き、リポジトリへ
コミットしない（結果を固定するテストは 3.3 と 8.4 が持つ）。キー（`E2B_API_KEY`、`GITHUB_TOKEN`）や Docker が無い環境では、該当 spike を「未実測」と
research.md に記録し、plan の退き方に従って先へ進む。

_Boundary:_ `specs/003-domain-agents/research.md`, `packages/ai-core/package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`
_Depends:_ none
_Requirements:_ 1.2, 1.3, 1.7, 1.8, 1.9, 3.1, 3.2, 3.8
_Traces:_ REQ-001, REQ-003, C1, C2, C5, C6, S-1〜S-6

- [x] 1.1 S-1: ラッチ + 内部 `AbortController` で `ToolLoopAgent` が止まり、停止理由が `error` になること（`generate` と `stream` の両方）を、AI SDK v7 の最小の実験で確かめる。あわせて CL-2（入力検証の失敗が `tool-error` として返るときの文言を、Zod の違反一覧から作る形式へ差し替えられるか）を確かめる。結果と採用する退き方（`stopWhen` にラッチの状態だけを読む条件を加える、`generateText` のツールループへ切り替える）を research.md に追記する。結果を追記するまで 3.x に着手しない
  _Boundary:_ `specs/003-domain-agents/research.md`
  _Depends:_ none
  _Requirements:_ 1.2, 1.3
  _Traces:_ REQ-001, C2, C3, S-1
  _Verify:_ research.md に S-1 の節（実験の手順、`generate` / `stream` それぞれの停止理由、CL-2 の可否、採用する退き方）があり、数値と挙動は実測である
- [x] 1.2 (P) `packages/ai-core/package.json`: plan「依存の宣言」の 4 件（`@ai-sdk/mcp` 2.0.76、`@modelcontextprotocol/server` 2.3.1、`@e2b/code-interpreter` 2.9.0、`fast-xml-parser` 5.11.2）を完全一致で足し、`exports` に `./files`、`./mcp`、`./sandbox`、`./analysis`、`./research`、`./helpdesk`、`./requirements`、`./marketing`（`./src/<領域>/index.ts`）を足す。`pnpm install` で `pnpm-lock.yaml` を更新し、`pnpm audit` が 0 件であることと `allowBuilds` の警告が出ないことを確かめる。警告が出た依存だけ `pnpm-workspace.yaml` に理由付きで追記する（出なければ変更しない）。各依存の公開が 24 時間以上前であることを `pnpm view <name>@<version> time` で確認する（憲章 原則 7。`@ai-sdk/mcp` が 2.0.76 である根拠は plan に記録済み）
  _Boundary:_ `packages/ai-core/package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`
  _Depends:_ none
  _Requirements:_ 1.7, 1.8, 1.9, 3.1, 4.3
  _Traces:_ REQ-001, REQ-003, REQ-004, C1
  _Verify:_ `mise run setup`（`--frozen-lockfile`）が成功し、`pnpm audit` が 0 件、`mise run gate` が成功する。`exports` の参照先の `index.ts` は後続の各領域の最後のタスクが作るので、それまで import されない（`mise run typecheck` に影響しない）ことを確認する
- [x] 1.3 S-2・S-3: (S-2) `ToolLoopAgent` に `client.tools({ schemas })` の戻り値を渡せること、自作サーバーを `command: process.execPath` と Node 26 の型除去（`erasableSyntaxOnly`）で直接起動できること（CL-3）。あわせて、ツール結果の `isError` と `_meta["agentic-ai/error"]`（無ければ `structuredContent`）がクライアントの `execute` の戻りまで届くこと（CL-24）。(S-3) `registerTool` が `annotations`（`readOnlyHint` など）を受け、クライアントの `tools/list` に載ること。結果と退き方（`adaptMcpTool` で AI SDK のツールへ包み直す、`tools/list` の応答を自前で組み立てる）を research.md に追記する
  _Boundary:_ `specs/003-domain-agents/research.md`
  _Depends:_ 1.1, 1.2
  _Requirements:_ 1.7, 1.8, 1.16
  _Traces:_ REQ-001, C4, C5, S-2, S-3, CL-3
  _Verify:_ research.md に S-2・S-3 の節があり、実際に起動した自作サーバーのツール一覧と注釈を含む。型除去で起動できない場合は CL-3 を改める案を併記する
- [x] 1.4 S-6: GitHub の公式ホスト型 MCP（HTTP、`Authorization` ヘッダ）のエンドポイントと、各ツールの `readOnlyHint` 注釈、既定の許可リストに載せる読み取り専用ツールの名前と入力スキーマ（説明文の上書きの対象、CL-25）を確かめる。`GITHUB_TOKEN`（読み取り専用）が無い環境では「未実測」と記録し、ドキュメント上のエンドポイントと、注釈が無いツールは `destructive` のため登録されないこと（ADR-7）を根拠に退き方を書く。トークンの値は research.md に書かない
  _Boundary:_ `specs/003-domain-agents/research.md`
  _Depends:_ 1.3
  _Requirements:_ 1.9, 1.17
  _Traces:_ REQ-001, C5, S-6, CL-4, CL-25
  _Verify:_ research.md に S-6 の節があり、許可リストに載せられる読み取り専用ツールの件数（実測または未実測）が書かれている。トークンの値が含まれない
- [x] 1.5 S-4: E2B の `@e2b/code-interpreter` の型（`runCode` の戻り、`onStdout` / `onStderr`、期限切れ、事前投入のライブラリ）と、**サンドボックスの外向き通信の既定**を確かめる。`E2B_API_KEY` が無い環境では「未実測」と記録し、ドキュメントと型定義を根拠に偽 SDK の形（17.4）を決める。外向き通信が可能なら、CL-21 のとおり「004 への引き継ぎ事項」（本ファイルの同名の節）に実測結果を反映する
  _Boundary:_ `specs/003-domain-agents/research.md`
  _Depends:_ 1.4
  _Requirements:_ 3.1, 3.2, 3.8
  _Traces:_ REQ-003, C6, S-4, CL-21
  _Verify:_ research.md に S-4 の節があり、偽 SDK の形（メソッド名と戻り値）と外向き通信の既定（実測または未実測）が書かれている
  _状態（2026-10-18）:_ 型は `.d.ts` で確認した。外向き通信の既定は E2B の文書による（実機は未）
- [x] 1.6 S-5: Docker Engine API の流れ（create → archive で入力を配置 → start → wait → logs → delete）と macOS のソケットパス（`DOCKER_HOST`、`~/.docker/run/docker.sock`、`/var/run/docker.sock`）を `node:http` の `socketPath` で確かめる。Docker が無い環境では「未実測」と記録し、Req 3.8 の無効化経路へ落ちる前提を明記する。画像（pandas、openpyxl、xlrd、matplotlib）の Python 側の版を公開日 24 時間以上で選び、CL-20 のとおり版を research.md に固定する
  _Boundary:_ `specs/003-domain-agents/research.md`
  _Depends:_ 1.5
  _Requirements:_ 3.1, 3.2, 3.8
  _Traces:_ REQ-003, C6, S-5, CL-20
  _Verify:_ research.md に S-5 の節があり、API の呼び出し順、ソケットの探索結果、Python 側の版（公開日付き）が書かれている

### Implementation Notes

- `pnpm install` は最初に自動モードの分類器に拒否された（「Untrusted Code Integration」）。利用者が許可した後に 1.2 → 1.3 → 1.5 を行った（`pnpm audit` 0 件、`allowBuilds` の警告なし）。
- S-1 の実測で、plan が主経路にした「ラッチ + 内部 abort」は `stream` の `finish` と `onEnd` を落とすと分かった。plan の退き方（`stopWhen` にラッチの状態だけを読む条件）を主経路に採った。`research.md`「spike の実測（W1）」。
- S-4、S-5、S-6 は鍵と Docker が無い環境のため文書による記録（未実測）で、外向き通信の既定は E2B の文書で「可能」だった（004 への引き継ぎ事項に反映済み）。

---

## 2. 設定・環境変数・機能・ゲートウェイの拡張（C1）

M3 が必要とする設定値、環境変数の名前、機能の必要条件を、M1・M2 の公開契約（`ModelPurpose` の語彙、cassette スキーマ）を変えずに足す。
各サブタスクは該当するテストを先に足してから実装する。

_Boundary:_ `packages/ai-core/src/config/**`, `.env.example`, `packages/ai-core/src/models/gateway.ts`, `packages/ai-core/src/models/gateway.test.ts`
_Depends:_ none
_Requirements:_ 1.7, 1.8, 1.9, 1.15, 2.4, 2.10, 3.7, 3.8, 3.9, 4.7, 4.8, 4.10, 5.1, 5.5, 6.2
_Traces:_ REQ-001, REQ-002, REQ-003, REQ-004, REQ-005, REQ-006, C1

- [x] 2.1 (P) `config/`: `DEFAULT_TOOLS`（`maxToolsPerAgent` 20、`conciseMaxCharacters` 1,000、`thinkEnabled` true。`MAX_AGENT_TOOLS` は M1 の定数を再利用）、`DEFAULT_HELPDESK`、`DEFAULT_SANDBOX`、`DEFAULT_ANALYSIS`、`DEFAULT_ARXIV`、`DEFAULT_RESEARCH`、`DEFAULT_INTERVIEW`、`DEFAULT_COUNCIL` を plan「設定値」の値で足す。`E2B_API_KEY`、`GITHUB_TOKEN`、`MCP_FS_ROOT`、`DOCKER_HOST`、`DOCKER_SANDBOX_IMAGE`（すべて任意）を `env-schema.ts` と `.env.example`（キー名と説明だけ。鍵なしで動く範囲を含む）に、機能 `e2b-sandbox` → `E2B_API_KEY`、`github-mcp` → `GITHUB_TOKEN` を `feature-requirements.ts` に、`PlatformConfig.credentials.e2b`・`credentials.github` と `mcpFsRoot`、`docker`（`DOCKER_HOST`、画像名）を `load.ts` に足し、`index.ts` から再エクスポートする（Docker は環境変数ではなくソケットの疎通で判定するため機能表に入れない）+ `env-schema.test.ts`・`feature-requirements.test.ts`・`load.test.ts` に、任意変数の受理、機能と変数の対応（既存の「全機能が 1 件以上・全変数がスキーマに存在」の不変条件を保つ）、既定値と上書き、`credentials.e2b` / `credentials.github` の有無を先に足す
  _Boundary:_ `packages/ai-core/src/config/defaults.ts`, `packages/ai-core/src/config/env-schema.ts`, `packages/ai-core/src/config/feature-requirements.ts`, `packages/ai-core/src/config/load.ts`, `packages/ai-core/src/config/index.ts`, `packages/ai-core/src/config/env-schema.test.ts`, `packages/ai-core/src/config/feature-requirements.test.ts`, `packages/ai-core/src/config/load.test.ts`, `.env.example`
  _Depends:_ none
  _Requirements:_ 1.7, 1.8, 1.9, 1.15, 2.4, 2.10, 3.7, 3.8, 3.9, 4.7, 4.8, 4.10, 5.1, 5.5, 6.2
  _Traces:_ REQ-001, REQ-002, REQ-003, REQ-004, REQ-005, REQ-006, C1
- [x] 2.2 `models/gateway.ts`: `credentialSecrets` に `E2B_API_KEY` と `GITHUB_TOKEN` を足し、録画の秘匿の対象にする（M2 の `COHERE_API_KEY` と同じ扱い）+ `gateway.test.ts` に、秘匿の対象が増えたこと（cassette に両方の値が現れない）のテストを先に足す。`mock` の既定シナリオへの M3 の追加は、シナリオを作る各タスク（10.1 ほか）が行う
  _Boundary:_ `packages/ai-core/src/models/gateway.ts`, `packages/ai-core/src/models/gateway.test.ts`
  _Depends:_ 2.1
  _Requirements:_ 1.9, 3.8
  _Traces:_ REQ-001, REQ-003, C1

### Implementation Notes

- `DEFAULT_TOOLS.maxToolsPerAgent` は `config` が `agents` を import できないためリテラルの 20 で、`MAX_AGENT_TOOLS` と同じ値であることをテストが固定する。
- 定数 `DEFAULT_MCP_FS_ROOT` を計画の一覧に無い追加として `config/defaults.ts` に置いた（M2 の `DEFAULT_DATABASE` と同じ扱い）。

---

## 3. 致命的エラーとラッチ（C2）

ツールのエラーを回復可能と致命的に分け、致命的なエラーを Run 単位で 1 件保持して、以降のツール実行を止める。spike S-1（1.1）の結果に従う。

_Boundary:_ `packages/ai-core/src/aci/fatal.ts`, `packages/ai-core/src/aci/fatal.test.ts`, `packages/ai-core/src/aci/types.ts`, `packages/ai-core/src/aci/tool-set.ts`, `packages/ai-core/src/aci/tool-set.test.ts`, `packages/ai-core/src/aci/index.ts`, `packages/ai-core/src/agents/guarded-agent.ts`, `packages/ai-core/src/agents/guarded-agent.test.ts`
_Depends:_ 1.1
_Requirements:_ 1.3, 1.5, 3.4
_Traces:_ REQ-001, REQ-003, C2, ADR-5

- [x] 3.1 `aci/fatal.ts`: `FatalToolError`（`code`: `auth-failed` / `config-missing` / `not-allowed` / `attempt-limit`、学習者に見せてよい `learnerMessage`）、`FatalLatch`（最初の 1 件だけを保持し、後続を無視）、`classifyToolError`（回復可能は要約と次の修正アクション、致命的は `FatalToolError`。スタックトレースを含めない）を作る。`aci/types.ts` の `ToolRuntime` に任意の `fatal: FatalLatch` を足す（省略時は M1 と同じ）。`aci/index.ts` から `FatalToolError`・`FatalLatch`・`classifyToolError` を再エクスポートする + `fatal.test.ts` に、最初の 1 件だけの保持、タイムアウトと一時的な失敗が回復可能、認証失敗・許可外の操作が致命的、文言にスタックトレースが出ないことを先に書く
  _Boundary:_ `packages/ai-core/src/aci/fatal.ts`, `packages/ai-core/src/aci/fatal.test.ts`, `packages/ai-core/src/aci/types.ts`, `packages/ai-core/src/aci/index.ts`
  _Depends:_ 1.1
  _Requirements:_ 1.3, 1.5
  _Traces:_ REQ-001, C2, ADR-5, CL-1
- [x] 3.2 `aci/tool-set.ts`: 実行時のラッチの配線を足す。ツールが `FatalToolError` を投げたらラッチに載せ、ラッチが立った後のツール実行（同じステップの残りを含む）は本体を実行せず拒否する。回復可能なエラーは `classifyToolError` の要約と次の修正アクションを結果として返す + `tool-set.test.ts` に、ラッチが立った後の次のツール呼び出しが**実行されない**こと（実行回数のカウンタを検査）、回復可能なエラーが要約を返して続行すること、`fatal` を渡さない場合に M1 と同じ挙動であることを先に足す
  _Boundary:_ `packages/ai-core/src/aci/tool-set.ts`, `packages/ai-core/src/aci/tool-set.test.ts`, `packages/ai-core/src/aci/define-tool.ts`（例外 (5)：ラッチを立てる処理だけ）
  _Depends:_ 3.1
  _Requirements:_ 1.3
  _Traces:_ REQ-001, C2
- [x] 3.3 `agents/guarded-agent.ts`: Run ごとのラッチの生成、内部 `AbortController` による停止、`finalise` の先頭でのラッチの判定（停止理由 `error`）を足す。1.1 の結果が退き方を示す場合は、それに従う。`STOP_REASONS` は変えない + `guarded-agent.test.ts` に、`generate` と `stream` の両方で、致命的エラーの後に停止理由が `error` になり、学習者向けの文言が `finish` 相当の結果に載ること、`attempt-limit` が同じ経路で止まること、ラッチが立たない Run の挙動が変わらないことを先に書く
  _Boundary:_ `packages/ai-core/src/agents/guarded-agent.ts`, `packages/ai-core/src/agents/guarded-agent.test.ts`
  _Depends:_ 3.2
  _Requirements:_ 1.3, 3.4
  _Traces:_ REQ-001, REQ-003, C2, S-1

### Implementation Notes

- 計画は配線を `aci/tool-set.ts` に置いたが、`defineAciTool` が投げられたエラーを結果に変換するため、ラッチを立てる処理は `define-tool.ts` に置いた（Boundary の逸脱。`do.md` に記録）。`tool-set.ts` は「ラッチ後の拒否」だけを持つ。
- ラッチは呼び出し側が作り、`buildToolSet` の `runtime.fatal` と `createGuardedAgent` の `fatal` の両方に同じ実体を渡す。渡し忘れを型で防ぐ仕組みは無い（15.2 の組み立てで 1 か所に集める）。
- 1 ステップの複数ツール呼び出しは同時に始まるため、すでに始まった兄弟の呼び出しは止められない。拒否されるのはラッチの後に始まる呼び出しだけ。

---

## 4. ACI 設計の検査と補助（C3）

ツールの説明文と入力の検査、修正ガイド、応答形式、索引 ID、思考用ツール、比較の計算を、ツールの実行経路の外の純関数として提供し、`defineAciTool` に検査を配線する。

_Boundary:_ `packages/ai-core/src/aci/description-check.ts`, `packages/ai-core/src/aci/description-check.test.ts`, `packages/ai-core/src/aci/input-guide.ts`, `packages/ai-core/src/aci/input-guide.test.ts`, `packages/ai-core/src/aci/response-format.ts`, `packages/ai-core/src/aci/response-format.test.ts`, `packages/ai-core/src/aci/short-id.ts`, `packages/ai-core/src/aci/short-id.test.ts`, `packages/ai-core/src/aci/think-tool.ts`, `packages/ai-core/src/aci/think-tool.test.ts`, `packages/ai-core/src/aci/high-level-compare.ts`, `packages/ai-core/src/aci/high-level-compare.test.ts`, `packages/ai-core/src/aci/define-tool.ts`, `packages/ai-core/src/aci/define-tool.test.ts`, `packages/ai-core/src/aci/tools/*.ts`, `packages/ai-core/src/aci/index.ts`
_Depends:_ 1.1, 3.1
_Requirements:_ 1.1, 1.2, 1.6, 1.11, 1.12, 1.13, 1.14, 1.16
_Traces:_ REQ-001, C3

- [x] 4.1 (P) `aci/description-check.ts`: `checkDescription(description, inputSchema)` が、見出し行（`使うとき:`、`使わないとき:`、`例:`）の欠落と、入力スキーマの全フィールドの `.describe()` の欠落を `DescriptionIssue[]` で返す（CL-16、CL-18）。MCP 由来のツール用に、同じ見出し行の規則を共有する `checkJsonSchemaDescription(description, inputSchema)`（JSON Schema の全プロパティに `description` がある、またはプロパティ名が説明文に現れる）を作る（CL-25） + `description-check.test.ts` に、見出し行ごとの欠落、`.describe()` の欠落（ネストしたフィールドを含む）、すべて満たす説明文が空の結果を返すこと、`checkJsonSchemaDescription` で `description` もなく名前も説明文に無いプロパティの検出を先に書く
  _Boundary:_ `packages/ai-core/src/aci/description-check.ts`, `packages/ai-core/src/aci/description-check.test.ts`
  _Depends:_ none
  _Requirements:_ 1.1, 1.11
  _Traces:_ REQ-001, C3, CL-16, CL-18, CL-25
- [x] 4.2 (P) `aci/input-guide.ts`: `formatInputGuide(error, inputSchema)` が、違反したパラメータ名、期待する型、例を含む修正ガイドを作る。1.1 の結果（CL-2）が示す差し替えの経路に合わせる + `input-guide.test.ts` に、必須フィールドの欠落、型の不一致、列挙値の違反、複数の違反が一覧になることを先に書く
  _Boundary:_ `packages/ai-core/src/aci/input-guide.ts`, `packages/ai-core/src/aci/input-guide.test.ts`
  _Depends:_ 1.1
  _Requirements:_ 1.2
  _Traces:_ REQ-001, C3, CL-2
- [x] 4.3 (P) `aci/response-format.ts`: `applyResponseFormat(text, { format, maxCharacters, fullTextHint })` が、`concise` で上限を超えた場合に切り詰めて全文の取得方法を付け、`detailed` は切り詰めない + `response-format.test.ts` に、上限ちょうど・+1 文字の境界、`detailed` の無加工、全文の案内が付くことを先に書く
  _Boundary:_ `packages/ai-core/src/aci/response-format.ts`, `packages/ai-core/src/aci/response-format.test.ts`
  _Depends:_ none
  _Requirements:_ 1.6
  _Traces:_ REQ-001, C3
- [x] 4.4 `aci/short-id.ts` と `aci/think-tool.ts`: `ShortIdIndex<T>`（`assign` が 0 始まりの索引と名称を返し、`resolve` が範囲外で `undefined`。UUID を使わない）と、`createThinkTool({ enabled })`（内容を保持せず、呼び出しを記録して確認の文言を返す。無効なら `undefined`。説明文は 4.1 の検査を通る形式）を作る + `short-id.test.ts`・`think-tool.test.ts` に、範囲外と未割り当ての `resolve`、出力に UUID の形が現れないこと、思考ツールが内容を保持しないこと、有効・無効の切り替え、説明文が `checkDescription` を通ることを先に書く
  _Boundary:_ `packages/ai-core/src/aci/short-id.ts`, `packages/ai-core/src/aci/short-id.test.ts`, `packages/ai-core/src/aci/think-tool.ts`, `packages/ai-core/src/aci/think-tool.test.ts`
  _Depends:_ 4.1
  _Requirements:_ 1.13, 1.14
  _Traces:_ REQ-001, C3
- [x] 4.5 (P) `aci/high-level-compare.ts`: `compareApproaches({ highLevel, lowLevel })` が、計測値（ステップ数とトークン数）を受け取って差と比率を返す（実行はしない）+ `high-level-compare.test.ts` に、比率の計算、ゼロ除算の扱い（低レベルが 0 のとき比率を計算しない）、片方が失敗した計測のときに比率を計算しないことを先に書く
  _Boundary:_ `packages/ai-core/src/aci/high-level-compare.ts`, `packages/ai-core/src/aci/high-level-compare.test.ts`
  _Depends:_ none
  _Requirements:_ 1.12
  _Traces:_ REQ-001, C3
- [x] 4.6 M1 のツールの説明文の改訂: `aci/tools/{calculator,currency,current-time,weather,web-search,search-knowledge-base}.ts` の説明文を CL-18 の形式（用途の 1 文 + `使うとき:`、`使わないとき:`、`例:`）に改め、全入力フィールドに `.describe()` を付ける。M1・M2 の既存テストが説明文を固定している場合は、RED で特定して最小限に更新する（`aci/tools/*.test.ts`。Boundary の例外 (3)）。ツールの挙動は変えない
  _Boundary:_ `packages/ai-core/src/aci/tools/*.ts`, `docs/modules/1-2-ai-sdk-core-and-tools.md`（例外 (5)：スニペットの説明文だけ）
  _Depends:_ 4.1
  _Requirements:_ 1.1, 1.11
  _Traces:_ REQ-001, C3, CL-18
  _Verify:_ 6 ツールすべてが `checkDescription` の空の結果を返すことを、4.7 の `define-tool.test.ts` と `mise run test` で確認する。`mise run gate` が成功する
- [x] 4.7 `aci/define-tool.ts`: 登録時に `checkDescription` を呼んで違反をエラーにし、入力検証の失敗の文言を `formatInputGuide` に差し替える（1.1 の結果に従う）+ `define-tool.test.ts` に、見出し行の欠落で登録が失敗すること、検証に失敗した入力でツール本体が実行されず修正ガイドが返ること、`risk` が必須のままであることを先に足す
  _Boundary:_ `packages/ai-core/src/aci/define-tool.ts`, `packages/ai-core/src/aci/define-tool.test.ts`, `packages/ai-core/src/aci/types.ts`（`inputSchema`）, `packages/ai-core/src/testing/tool-description.ts`, `packages/ai-core/src/testing/index.ts`, `packages/ai-core/src/patterns/role-based-cooperation.test.ts`（例外 (5)）
  _Depends:_ 4.1, 4.2, 4.6
  _Requirements:_ 1.1, 1.2, 1.11, 1.16
  _Traces:_ REQ-001, C3
- [x] 4.8 `aci/index.ts`: C3 の公開 API（`checkDescription`、`formatInputGuide`、`applyResponseFormat`、`ShortIdIndex`、`createThinkTool`、`compareApproaches`）を再エクスポートする
  _Boundary:_ `packages/ai-core/src/aci/index.ts`
  _Depends:_ 3.1, 4.3, 4.4, 4.5, 4.7
  _Requirements:_ 1.1, 1.2, 1.6, 1.12, 1.13, 1.14
  _Traces:_ REQ-001, C2, C3
  _Verify:_ `mise run typecheck` と `mise run gate` が成功し、`@platform/ai-core/aci` から上記の API を import できる

### Implementation Notes

- 入力検証の修正ガイドは、AI SDK 自身の JSON Schema（`zodSchema`）をそのまま使い、`validate` だけを差し替えた。リクエストの JSON Schema は変わらないので、既存のカセットのキーは動かない。AI SDK が付ける `Invalid input for tool <name>:` の前置きは残る。
- `defineAciTool` が説明文を検査するようになったため、既存テストのツール定義が壊れた。`testing/describeTool` を足して直した（`guarded-agent.test.ts` ほか。既存テストの変更として `do.md` に列挙）。
- `AciTool` に Zod の `inputSchema` を公開した。004 のツール定義の読み取りと、`checkDescription` の入力に使える。

---

## 5. TokenLedger と観測口（C9 の基盤）

役割別のトークン集計と、外部コンテンツの取り込みの記録口、イベントへの `agent` 名の付与を、`RunObserver` の公開契約を変えずに足す。

_Boundary:_ `packages/ai-core/src/agents/token-ledger.ts`, `packages/ai-core/src/agents/token-ledger.test.ts`, `packages/ai-core/src/agents/observer.ts`, `packages/ai-core/src/agents/observer.test.ts`, `packages/ai-core/src/agents/index.ts`
_Depends:_ none
_Requirements:_ 4.9, 4.10
_Traces:_ REQ-004, C9, CL-10

- [x] 5.1 (P) `agents/token-ledger.ts`: `TokenLedger` の `record(role, usage)` と `breakdown()`（役割別と合計）を作る。使用量が取れない役割は `unknown` とし、合計は取れた分だけで計算する + `token-ledger.test.ts` に、役割別の内訳の合計が全体と一致すること、同じ役割への複数回の記録、使用量が取れない役割が合計に推測値を足さないことを先に書く
  _Boundary:_ `packages/ai-core/src/agents/token-ledger.ts`, `packages/ai-core/src/agents/token-ledger.test.ts`
  _Depends:_ none
  _Requirements:_ 4.10
  _Traces:_ REQ-004, C9
- [x] 5.2 `agents/observer.ts`: 外部コンテンツの取り込みの記録口（種別と出所だけ。内容を保持しない。CL-10）と、イベントへの `agent` 名の付与を、既存の `RunObserver` の契約を変えずに任意の引数として足す。`agents/index.ts` から `TokenLedger` と記録口を再エクスポートする + `observer.test.ts` に、`agent` 名が付くこと、記録口が種別と出所だけを受け取ること、未指定のとき M1 の挙動が変わらないことを先に足す
  _Boundary:_ `packages/ai-core/src/agents/observer.ts`, `packages/ai-core/src/agents/observer.test.ts`, `packages/ai-core/src/agents/index.ts`
  _Depends:_ 5.1
  _Requirements:_ 4.9, 4.10
  _Traces:_ REQ-004, C9, CL-10

### Implementation Notes

- `agents/observer.ts` は計画が「Modify」と書いたが存在せず（`RunObserver` は `guarded-agent.ts` にある）、新規に作った。`RunObserver` の契約は変えず、`createNamedObserver` で包む形にした。

---

## 6. ポート・リポジトリ規則・`test:container` の枠（C6、C15、C16）

サンドボックスのポート、新しい境界を守る規則、`*.container.test.ts` の枠、シナリオの曖昧さを検出する枠を、実装より先に揃える。

_Boundary:_ `packages/ai-core/src/ports/sandbox.ts`, `packages/ai-core/src/ports/index.ts`, `scripts/check-repo-rules.mjs`, `scripts/check-repo-rules.test.mjs`, `packages/ai-core/vitest.config.ts`, `mise.toml`, `scripts/check-client-bundle.test.mjs`, `packages/ai-core/src/mock/index.ts`, `packages/ai-core/src/mock/m3-scenarios.test.ts`
_Depends:_ none
_Requirements:_ 1.16, 1.17, 3.1, 3.2, 3.10
_Traces:_ REQ-001, REQ-003, C6, C15, C16

- [x] 6.1 (P) `ports/sandbox.ts`: `SandboxProvider`（`kind`、`create`）、`SandboxSession`（`writeFile`、`runPython`、`isAlive`、`close`）、`SandboxRunResult` の型を、実装を持たずに定義する。`ports/index.ts` から再エクスポートする
  _Boundary:_ `packages/ai-core/src/ports/sandbox.ts`, `packages/ai-core/src/ports/index.ts`
  _Depends:_ none
  _Requirements:_ 3.1, 3.2, 3.10
  _Traces:_ REQ-003, C6
  _Verify:_ `mise run typecheck` と `mise run gate` が成功し、`@platform/ai-core/ports` から型を import できる。E2B と Docker の型がポートに現れない
- [x] 6.2 (P) `scripts/check-repo-rules.mjs`: 規則 `mcp-import-scope`（`@ai-sdk/mcp` は `mcp/` だけが import する）、`sandbox-import-scope`（`@e2b/code-interpreter` は `sandbox/e2b.ts` だけ、`node:http` による Docker 接続は `sandbox/docker/` だけ）を足し、`workflow-no-agent-loop` の対象に `helpdesk/planner.ts`、`helpdesk/replanner.ts`、`helpdesk/helpdesk.ts`、`requirements/interview.ts`、`requirements/personas.ts`、`marketing/council.ts`、`marketing/moderator.ts`、`marketing/profile.ts`、`marketing/recommend.ts` を足す（`RULE_NAMES` は 13 になる）。対象ファイルがまだ無い間は、存在するものだけを走査する。新しい 2 規則は走査 0 件で失敗する + `check-repo-rules.test.mjs` に、各規則の違反例（`ToolLoopAgent` を import する `planner.ts` を含む）・許可例・走査 0 件の失敗を先に足す。`mise.toml` の `--only` へは足さない（11.2、20.2）
  _Boundary:_ `scripts/check-repo-rules.mjs`, `scripts/check-repo-rules.test.mjs`
  _Depends:_ none
  _Requirements:_ 1.16, 1.17, 3.2
  _Traces:_ REQ-001, REQ-003, C16, ADR-4, ADR-7, ADR-9
- [x] 6.3 (P) `packages/ai-core/vitest.config.ts` に、`*.container.test.*` を `gate` から除外するスイート `container` を足し（`*.pg.test.*` と同じ方式）、`mise.toml` にタスク `test:container`（`*.container.test.ts`）を足し、`check:client-bundle` のセンチネルに `E2B_API_KEY` と `GITHUB_TOKEN` を環境変数と `--sentinel` の両方に同じ値で足す + `scripts/check-client-bundle.test.mjs` に、新しいセンチネル変数がバンドルに出ないことのテストを先に足す。コンテナのテストが 0 件の間は `test:container` が `--passWithNoTests` 相当で成功する
  _Boundary:_ `packages/ai-core/vitest.config.ts`, `mise.toml`, `scripts/check-client-bundle.test.mjs`, `scripts/check-client-bundle.mjs`（例外 (5)：`SECRET_NAME` だけ）
  _Depends:_ none
  _Requirements:_ 3.2
  _Traces:_ REQ-003, C16, CL-9
  _Verify:_ `mise tasks validate` が成功し、`mise run test:container` が（Docker の有無に関わらず）0 件で成功する。`mise run gate` が `*.container.test.ts` を実行しないことを、ダミーのファイルで確認して削除する。センチネルが環境変数と `--sentinel` の両方に同じ値で入っている
- [x] 6.4 (P) `mock/index.ts` に M3 のシナリオの集約（初期は空）を足し、`mock/m3-scenarios.test.ts` に、同じ入力（`purpose` と `lastUserTextIncludes`）に複数のシナリオが一致しないことの検出器と、すべての `fixture:` マーカーが解決できることの検査を作る。検出器自身のテストは合成した曖昧なシナリオで先に書き、集約が空のうちは実集合の検査が空振りにならないよう、期待する件数を各波のシナリオのタスクが更新する形にする
  _Boundary:_ `packages/ai-core/src/mock/index.ts`, `packages/ai-core/src/mock/m3-scenarios.test.ts`
  _Depends:_ none
  _Requirements:_ 3.10
  _Traces:_ REQ-003, C15
  _Verify:_ 合成した曖昧なシナリオで検出器のテストが落ちること（RED）を確認してから、実集合の検査が成功する。`mise run gate` が成功する

### Implementation Notes

- `test:container` は `@platform/ai-core` だけで動かす（他のワークスペースの Vitest 設定は `container` を知らない）。ホスト側のネットワーク遮断（`tooling/vitest/network-guard.ts`）は unix ソケットを止めるので、最初のコンテナのテスト（17.x）の前に、`container` スイートでの許可を足す必要がある（W4 の作業。Boundary の確認が要る）。
- 6.3 のセンチネルのテストで、`GITHUB_TOKEN` が `check-client-bundle` の秘密の名前に入っていないことが分かり、`TOKEN` を単語として一致させる形にした（`AGENT_MAX_TOTAL_TOKENS` は対象外）。
- 新しい 2 規則は `tokenize` がテンプレート文字列の本文を保持しないため、テンプレート内の `docker.sock` は検出できない（`socketPath` の識別子で補う）。

---

## 7. W1 の締め

規則と検査の結線、gate の実測を確かめる。

_Boundary:_ `stryker.config.mjs`, `specs/003-domain-agents/research.md`
_Depends:_ 2.2, 3.3, 4.8, 5.2, 6.1, 6.2, 6.3, 6.4
_Requirements:_ 1.1, 1.3, 1.11
_Traces:_ REQ-001, C16

- [x] 7.1 `stryker.config.mjs`: ミューテーション対象に `aci/description-check.ts` を足す（M3 の純関数は各波の締めで足す）
  _Boundary:_ `stryker.config.mjs`
  _Depends:_ 4.1
  _Requirements:_ 1.1, 1.11
  _Traces:_ REQ-001, C16
  _Verify:_ `mise run test:mutation` の対象に含まれ、閾値 70 を満たす
- [x] 7.2 W1 の gate を実測して記録する。`mise run gate` の成功を引用し、所要時間を research.md の「gate の所要時間」に追記する（5 分以内。超える兆候があればファイルの統合を検討する）。`pnpm audit` が 0 件、`allowBuilds` の警告なしを再確認する
  _Boundary:_ `specs/003-domain-agents/research.md`
  _Depends:_ 7.1
  _Requirements:_ 1.3
  _Traces:_ REQ-001, C16
  _Verify:_ `mise run gate` の成功と所要時間を research.md に記録した。W1 の敵対的レビューの記録が `.sdd/reviews/003-domain-agents-impl-w1-review-*.md` にある

### Implementation Notes

- 実測は `mise run gate` が約 31 秒（5 分の予算に対して十分）、`pnpm audit` 0 件、`allowBuilds` の警告なし。ミューテーションは 86.71 点（閾値 70、gate の外）。
- 敵対的レビュー W1 は HIGH 1 件・MEDIUM 6 件を修正し、LOW は `.sdd/reviews/003-domain-agents-impl-w1-review-2026-10-18.md` の「Responses」に対応先を記録した（W2 以降の「W1 からの持ち越し」）。
