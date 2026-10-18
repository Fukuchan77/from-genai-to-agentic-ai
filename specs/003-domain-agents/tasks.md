# domain-agents（Milestone 3）— 実装タスク（索引）

`/sdd-tasks` が生成した。承認済みの [spec.md](spec.md)（WHAT）と [plan.md](plan.md)（HOW、C1〜C16、Implementation Waves spike・W1〜W8）から、
実装の波ごとに分割した。ルールは `~/.claude/sdd/rules/tasks-generation.md` と `~/.claude/sdd/rules/tasks-parallel-analysis.md`
に従う。並列モード（`--sequential` 未指定）。002 の `tasks.md` と同じ運用（索引 + 現在の波の全文、未着手の波は `tasks-wN.md`、
完了した波は `tasks-comp-wN.md`）を採る。

## ファイル構成

| ファイル | 内容 |
|---|---|
| `tasks.md`（本ファイル） | 表記規約、ID 対応表、進捗、gate への段階的な結線、004 への引き継ぎ事項、**現在の波**（W2）のタスク全文 |
| `tasks-w3.md`〜`tasks-w8.md` | 未着手の波のタスク全文。波が現在の波になるとき `tasks.md` へ移す |
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
| spike・W1 基盤 | 1 spike と依存の宣言、2 設定・ゲートウェイ、3 致命的エラーとラッチ、4 ACI の検査と補助、5 TokenLedger と観測口、6 ポート・規則・枠、7 W1 の締め | 完了（2026-10-18） | [tasks-comp-w1.md](tasks-comp-w1.md) |
| W2 MCP・ファイル | 8 ファイル操作と自作 MCP サーバー、9 MCP クライアントアダプター、10 MCP の HTTP 入口、11 実サーバー確認と W2 の締め | 着手中（本ファイル） | [tasks.md](tasks.md) |
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

## W1 からの持ち越し

W1 の敵対的レビューの LOW 指摘のうち、対応先の波へ送ったもの（`.sdd/reviews/003-domain-agents-impl-w1-review-2026-10-18.md` の「Responses」）。

- F-7（401/403 の判定）と F-15（`failureFrom` と `classifyToolError` の二重化）: 9.x（MCP クライアントアダプター）。アダプターが `FatalToolError("auth-failed")` を明示的に投げ、無ラッチ時の要約文をテストで固定する。
- F-16（`test:container` のスキップ補助とネットワーク遮断の例外）: 17.x の境界に `tooling/vitest/*` を足して対応する。
- F-17（`WORKFLOW_FILES` の取りこぼし）: 16.1 と 28.1 で走査件数の検査を足す。
- F-10・F-11（`TokenLedger` の `RunObserver` 接続、取り込み記録の `source` の上限）: 22.x。
- F-14（M1 の説明文の改訂で録画のキーが変わる）: 40.1 の 3-1 の「移植時の変更点」に書く。

## 現在の波: W2 MCP・ファイル（大タスク 8〜11）

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
