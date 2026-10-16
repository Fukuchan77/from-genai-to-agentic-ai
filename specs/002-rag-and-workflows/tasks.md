# rag-and-workflows（Milestone 2）— 実装タスク（索引）

`/sdd-tasks` が生成した。承認済みの [spec.md](spec.md)（WHAT）と [plan.md](plan.md)（HOW、C1〜C18、Implementation Waves W1〜W6）から、
実装の波ごとに分割した。ルールは `~/.claude/sdd/rules/tasks-generation.md` と `~/.claude/sdd/rules/tasks-parallel-analysis.md`
に従う。並列モード（`--sequential` 未指定）。001 の `tasks.md` と同じ運用（索引 + 現在の波の全文、未着手の波は `tasks-wN.md`、
完了した波は `tasks-comp-wN.md`）を採る。

## ファイル構成

| ファイル | 内容 |
|---|---|
| `tasks.md`（本ファイル） | 表記規約、ID 対応表、進捗、gate への段階的な結線、**現在の波**のタスク全文（M2 は W1〜W6 がすべて完了し、現在の波はない） |
| `tasks-comp-w1.md`〜`tasks-comp-w6.md` | 完了した波の保管先。波の完了時に作る（W1〜W6 のすべてがある） |
| `traceability.md` | 要件 → 設計 → タスク → テスト → コミット（Test と Commit は `/sdd-ship` が埋める） |

タスク番号は全ファイルで一意で、移動しても変えない。`_Depends:_` と `traceability.md` は、ファイルをまたいで
番号だけで参照する。

### 完了した波の移行手順

001 の `tasks.md`「完了した波の移行手順」と同じである（2 つのコミットに分け、1 つ目は `git mv tasks.md tasks-comp-wN.md` だけ、
2 つ目は `git mv tasks-w(N+1).md tasks.md` の後に索引の節を移す）。移行の条件は次のとおり。

1. その波の全サブタスクが `[x]` で、各大タスクの Implementation Notes が記入済みである。
2. 波の締めのタスク（下記「gate への段階的な結線」）が完了し、`mise run gate` と CI の `ci-status` が成功している。
3. その波の敵対的レビュー（憲章 原則 9。新規コンテキストで `sdd-reviewer` と `adversarial-review` skill）の記録が
   `.sdd/reviews/002-rag-and-workflows-impl-wN-review-YYYY-MM-DD.md`（1 ラウンド 1 ファイル）にあり、指摘への対応が追記されている。

## 表記規約

- `- [ ]` 未着手、`- [x]` 完了、`- [ ]*` 任意・後回し可のテスト（この spec では使っていない）。
- `(P)` = 並列実行可（依存なし・境界の重複なし）。同じ波の中で、依存関係の同じ段にあるタスクの間でだけ付ける。
- 各タスク（大タスク・サブタスクの両方）は `_Boundary:_`、`_Depends:_`、`_Requirements:_`、`_Traces:_` を必ず持つ。
- **テスト先行（憲章 原則 4）**: 実装を含むサブタスクは、対応するテストファイルを同じ `_Boundary:_` に含め、RED（失敗の確認）→
  GREEN → REFACTOR を 1 つのサブタスクの中で行う。設定・文書・ガイドなど単独のテストを持たないサブタスクは、検証手段を
  `_Verify:_` に書く。
- `_Requirements:_` は spec.md の受け入れ基準番号（例: `1.1`）を数値のみでカンマ区切りに列挙する。基盤の作業で対応する
  受け入れ基準が plan の部品表（`Requirements` 行）にあるものは、それを書く。
- `_Traces:_` は安定リンク ID を持つ。この spec は `spec.md`/`plan.md` に `REQ-###`/`DES-#.#` 形式の見出しを持たないため、
  下記の対応表で実在する見出しに固定する（001 と同じ扱い）。
- 各大タスクの末尾の `### Implementation Notes` は生成時は空。大タスクの完了後に、実装者が学びを 1〜3 項目追記する。
- **Boundary の対象**: plan の File Structure Plan にあるファイルに限る。次の例外だけを許す。(1) 生成物 `pnpm-lock.yaml`
  （1.1）。(2) `specs/002-rag-and-workflows/` 配下の spec 文書（`research.md` への実測の追記、`traceability.md`）。
  (3) plan C1「既知の影響」が明示する、`mock:judge-v1` の追加で影響を受ける `apps/web` の既存テスト（2.2 の RED で特定）。
- **共有ファイルの編集者**: `mise.toml` は 1.2（`client-bundle` のセンチネル）と各波の締めのタスクだけが編集する。
  `stryker.config.mjs` は各波の締めのタスクだけが編集する。`packages/ai-core/package.json` は 1.1 だけが編集する（`exports` の
  4 サブパス `./structured`、`./rag`、`./workflows`、`./patterns` を含む。参照先の `index.ts` は各領域の最初のタスクが作る）。
  `packages/ai-core/src/models/gateway.ts` の `mock` 既定シナリオへの追加は、シナリオを作る 14.2（M2-1/M2-2）と 18.1・18.2（M2-3/M2-4）だけが行う。
  `packages/ai-core/src/rag/index.ts` は 8.3（初期）と 13.4（最終）、`apps/web/lib/server/platform.ts` は 8.4 と 15.1 だけが編集する。

### ID 対応表

| ID | 対応する見出し |
|---|---|
| `REQ-001`〜`REQ-004` | spec.md の `### Requirement 1`〜`### Requirement 4`（要件グループ単位。受け入れ基準単位の詳細は `_Requirements:_` を見る） |
| `C1`〜`C18` | plan.md の `### C_N <名前>`（実在する見出し。`DES-#.#` の代わりにこの一次 ID を使う。001 の `C1`〜`C22` とは別の番号） |
| `CL-1`〜`CL-12` | plan.md「Clarifications」の決定 |
| `ADR-1`〜`ADR-12`、`R-1`/`R-2` | research.md の決定とリスク |

## 進捗

| 波 | 大タスク | 状態 | ファイル |
|---|---|---|---|
| W1 基盤 | 1 依存と設定ファイル、2 設定・カタログ・ゲートウェイの拡張、3 共通部品（Rerank ポート、`generateValidated`）、4 リポジトリ検査 | 完了（2026-10-12 に移行） | [tasks-comp-w1.md](tasks-comp-w1.md) |
| W2 ナレッジベース | 5 DB 層、6 取り込みの部品、7 埋め込みとストア、8 取り込みの組み立てと HTTP 入口、9 コーパスと実サーバー確認 | 完了（2026-10-12 に移行） | [tasks-comp-w2.md](tasks-comp-w2.md) |
| W3 検索・回答・Agentic | 10 検索パイプライン、11 回答と引用、12 Agentic RAG、13 RAG の評価、14 評価データとシナリオ、15 RAG の HTTP 入口 | 完了（2026-10-12 に移行） | [tasks-comp-w3.md](tasks-comp-w3.md) |
| W4 ワークフロー・パターン | 16 ワークフロー、17 エージェントデザインパターン、18 シナリオとデモ、19 ワークフローの HTTP 入口 | 完了（2026-10-13 に移行） | [tasks-comp-w4.md](tasks-comp-w4.md) |
| W5 画面と E2E | 20 RAG 画面の部品、21 ワークフロー画面の部品、22 ページ、23 E2E | 完了（2026-10-13 に移行） | [tasks-comp-w5.md](tasks-comp-w5.md) |
| W6 評価・解説・統合 | 24 評価テスト、25 `local` での実測、26 解説、27 トレーサビリティ・ステアリング、28 最終統合 | 完了（2026-10-16 に移行） | [tasks-comp-w6.md](tasks-comp-w6.md) |

**波の依存**（plan「Implementation Waves」）: W2 は W1 に、W3 は W2 に、W5 は W3 と W4 に、W6 は W5 に依存する。W4 は W1 のみに依存するため
W2・W3 と並行できるが、W3 と W4 は `gateway.ts`・`mock/index.ts`・`src/mock/m2-scenarios.test.ts` を共有するので、シナリオとデモのタスク
（18）は 14.2 の後に行う。関数そのもののタスク（16、17）は W2・W3 と並行してよい。

**plan の波の割り当てからの調整**: コーパス 6 本（plan では W3）を W2 の 9.1 に前倒しした。W2 の実サーバー確認（リスク R-1）が
「取り込み → 検索」を通すにはコーパスが要るためである。ラベル付き質問セット（`eval-set.json`）は plan のとおり W3 の 14.1 で、コーパスを固めた後に書く。
完成タグ（`module/2-1`〜`2-4`）は、解説の完成後に W6 の 28.3 でローカルに付け、push は人が行う。

## gate への段階的な結線

gate の各段は「走査 0 件で失敗」するため、検査対象がまだない規則を最初から入れると、実装の途中で必ず失敗する（001 と同じ）。
規則そのものは W1 の 4.1 で実装して単体テストで守り、`mise.toml` の `check:repo-rules --only` へは、走査対象が揃う波の締めで加える。
一度加えた規則は外さない。`gate` の段の順序は変えない（plan C17）。

| 時点 | 締めのタスク | `check:repo-rules --only` に加える規則 | その他の結線 |
|---|---|---|---|
| W1 の締め | 4.4 | `no-sql-raw`（`ai-core/src` は常に走査対象がある） | — |
| W2 の締め | 9.3 | — | `stryker.config.mjs` に `markdown.ts`、`chunk.ts`、`search-text.ts` |
| W3 の締め | 15.5 | — | `stryker.config.mjs` に `rrf.ts`、`citations.ts`、`recall.ts` |
| W4 の締め | 19.2 | `workflow-no-agent-loop`（`workflows/` と `patterns/` が揃う） | `stryker.config.mjs` に `parallelization.ts`、`evaluator-optimizer.ts` |
| W5 の締め | 23.4 | — | — |
| W6 の締め | 28.1 | — | `docs:check` は 001 から結線済み。2-1〜2-4 の解説が加わった状態で成功することを確かめる |
