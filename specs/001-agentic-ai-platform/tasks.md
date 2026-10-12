# agentic-ai-platform（Milestone 1）— 実装タスク（索引）

`/sdd-tasks` が生成し、`/sdd-analyze`（2026-09-27）の指摘を反映して、実装の波（W1〜W5）ごとに分割した。
2回目の `/sdd-analyze`（2026-09-27）の H-1〜H-3、M-1〜M-4 と、3回目の H-1、M-1〜M-4、L-1〜L-3 も反映した。
ルールは `~/.claude/sdd/rules/tasks-generation.md` と `~/.claude/sdd/rules/tasks-parallel-analysis.md` に従う。
並列モード（`--sequential` 未指定）。

## ファイル構成

| ファイル | 内容 |
|---|---|
| `tasks.md`（本ファイル） | 表記規約、ID 対応表、進捗、gate と CI の段階的な結線、**現在の波**のタスク全文（M1 は W1〜W5 がすべて完了し、現在の波はない） |
| `tasks-comp-w1.md`〜`tasks-comp-w5.md` | 完了した波の保管先。波の完了時に作る（W1〜W5 のすべてがある） |
| `traceability.md` | 要件 → 設計 → タスク → テスト → コミット |

タスク番号は全ファイルで一意で、移動しても変えない。`_Depends:_` と `traceability.md` は、ファイルをまたいで
番号だけで参照する。

### 完了した波の移行手順

1. 移行の条件: その波の全サブタスクが `[x]`、各大タスクの Implementation Notes が記入済み、波の締めのタスク
   （下記「gate と CI の段階的な結線」）が完了し、`mise run gate` と CI の `ci-status` が成功している。加えて、
   その波の敵対的レビューの記録が `.sdd/reviews/` にある（下記「波ごとの敵対的レビュー」）。
2. 1つ目のコミット（例: `docs(tasks): archive wave N`）では、`git mv tasks.md tasks-comp-wN.md` だけを行い、
   本文を変えない。
3. 2つ目のコミット（例: `docs(tasks): promote wave N+1`）では、`git mv tasks-w(N+1).md tasks.md` の後、索引の節
   （本ファイルの「現在の波」より前）を `tasks-comp-wN.md` から `tasks.md` の先頭へ移す。`tasks-comp-wN.md` には
   「現在の波」の本文だけを、本文を変えずに残す。
4. 同じコミットで、下記「進捗」の状態とファイルの列を更新する。
5. 2つのコミットは波の締めの後に続けて行い、同じ PR に含める。並列作業の途中では移行しない。2つに分けるのは、
   Git がリネームを記録せず、削除されたパスだけを内容の類似度で追跡するためである。1つのコミットでは
   `tasks.md` が前後に存在するため、完了した波の履歴を `tasks-comp-wN.md` から `git log --follow` で追えなくなる
   （2026-09-27、W1 の移行で改訂）。

完了分は波ごとに1ファイルに分かれるため、保管先のファイルは最大でも約300行に収まる。

### 波ごとの敵対的レビュー（constitution 原則 9）

原則 9 の「各実装フェーズの完了後に、新規コンテキストで敵対的レビューを1回行う」の「実装フェーズ」は、
本 spec では**実装の波（W1〜W5）**を指す。マイルストーン単位の1回だけでは、W1 の基盤の誤りが W2〜W5 に
継承されるため、波ごとに行う。

- 時点: 波の締めのタスクが完了し、`mise run gate` が成功した後、移行のコミットより前。
- 実施者: その波の実装に関わっていない新規コンテキスト（`sdd-reviewer` サブエージェント、`adversarial-review` skill）。
- 対象: その波で追加・変更したコード、テスト、設定、`tasks.md` の Implementation Notes。
- 記録: `.sdd/reviews/001-agentic-ai-platform-impl-wN-review-YYYY-MM-DD.md`（1ラウンド1ファイル。過去の
  ラウンドを上書きしない）。指摘への対応が完了したことをその記録に追記してから、移行する。

## 表記規約

- `- [ ]` 未着手、`- [x]` 完了、`- [ ]*` 任意・後回し可のテスト。
- `(P)` = 並列実行可（依存なし・境界の重複なし）。大タスクの見出しに付けた `(P)` は、その大タスクが同じ波の
  他の大タスクと並列に進められることを示す。
- 各タスク（大タスク・サブタスクの両方）は `_Boundary:_` と `_Depends:_` を必ず持つ。
- **テスト先行（constitution 原則 4）**: 実装を含むサブタスクは、対応するテストファイルを同じ `_Boundary:_` に
  含み、RED（失敗の確認）→ GREEN → REFACTOR を1つのサブタスクの中で行う。設定ファイル・生成物・公開 API の
  集約など、単独のテストを持たないサブタスクは、検証手段を `_Verify:_` に書く。
- `_Requirements:_` は spec.md の受け入れ基準番号（例: `1.1`）をカンマ区切りの数値のみで列挙する。
  NFR（数値番号を持たない）は `NFR-01`〜`NFR-13`（下記の対応表）で同じ書式に揃えて記載する。
- `_Traces:_` は安定リンクIDを持つ。この spec は `spec.md`/`plan.md` に `REQ-###`/`DES-#.#` 形式の
  見出しを持たないため、以下の対応表で実在する見出しに固定する。
- 各大タスクの末尾の `### Implementation Notes` は生成時は空。大タスクの完了後に、実装者が学びを1〜3項目
  追記する。
- 共有ファイルの編集者を1つに絞る: `.env.example`（1.5 が全変数を一度に作る）、`packages/ai-core/package.json`
  （6.1 が M1 の依存を一度に宣言する。`test`・`test:coverage` スクリプトだけは 6.3 が、`exports` の `./errors` だけは 21.1 が加える）、`apps/web/package.json`（8.1。`test`・`test:coverage` スクリプトだけは 21.1 が加える）、`packages/eval-suite/package.json`（7.1。`test`・`test:coverage` スクリプトだけは 19.1 が加える）、
  `mise.toml`（1.1 と各波の締めのタスクだけが編集する）、`.github/workflows/ci.yml`（2.1 と、ジョブを加える
  波の締めのタスク 19.3・29.1 だけが編集する）。

### ID 対応表

| ID | 対応する見出し |
|---|---|
| `REQ-001`〜`REQ-007` | spec.md の `### Requirement 1`〜`### Requirement 7`（要件グループ単位。AC単位の詳細は `_Requirements:_` を見る） |
| `NFR-01`〜`NFR-13` | spec.md `## Non-Functional Requirements` の箇条書き順（01検証速度、02決定性、03オフライン動作、04ストリーミング応答性、05型安全性、06テストカバレッジ、07秘密情報、08隔離実行、09アクセシビリティ、10対応ブラウザ、11サプライチェーン、12UI言語、13コスト可視化） |
| `C1`〜`C22` | plan.md の `#### C_N <名前>`（実在する見出し。`DES-#.#` の代わりにこの一次IDを使う） |

## 進捗

| 波 | 大タスク | 状態 | ファイル |
|---|---|---|---|
| W1 基盤 | 1 ツールチェーン、2 CI、3 ローカル依存サービス、4 テスト基盤、5 リポジトリ規約検査 | 完了（2026-09-27。敵対的レビュー2ラウンド） | [tasks-comp-w1.md](tasks-comp-w1.md) |
| W2 ai-core の土台 | 6 ai-core scaffold、7 eval-suite scaffold、8 apps/web scaffold、9 ModelCatalog、10 Ports、11 testing ヘルパ、12 PlatformConfig、13 MockRuntime | 完了（2026-09-30。敵対的レビュー3ラウンド、2026-10-04 の検証で追加の修正） | [tasks-comp-w2.md](tasks-comp-w2.md) |
| W3 ai-core の機能 | 14 ModelGateway、15 AciToolkit、16 GuardedAgent、17 ChatCore、18 SummaryPipeline、19 評価スイート | 完了（2026-10-07。敵対的レビュー3ラウンド） | [tasks-comp-w3.md](tasks-comp-w3.md) |
| W4 apps/web | 21 RequestGuard、20 AppShell、22 ChatFeature、23 ToolAgentFeature、24 SummaryFeature | 完了（2026-10-12。敵対的レビュー1ラウンド。実サーバーの確認で Turbopack・Tailwind・フォーカス指示子の欠陥を追加で修正） | [tasks-comp-w4.md](tasks-comp-w4.md) |
| W5 E2E・解説・最終統合 | 25 E2E 生成・検査スクリプト、26 E2E 基盤、27 E2E シナリオ、28 解説ドキュメント、29 最終統合と NFR 検証 | 完了（2026-10-12。敵対的レビュー3ラウンド。完成タグ3つを push） | [tasks-comp-w5.md](tasks-comp-w5.md) |

波の順序は依存関係で決まる。W4 は 21 を 20 より先に行う（20.1 がレート制限器を組み立てるため）。

モジュールの完成タグ（Req 7.11、plan C22）は、そのモジュールのリファレンス実装が完了した波の中で付ける:
`module/1-1` は 14.6（W3）、`module/1-2` は 23.5（W4）、`module/1-3` は 24.4（W4）。29.4 は3つのタグの検証と
push だけを行う。`module/1-2`・`module/1-3` は 2026-10-12 に `7cc27cc` に付け、`module/1-1` は 29.4 で `f671813` に作り直した。3つとも 29.4 で push 済み。

## gate と CI の段階的な結線

gate の各段は「走査0件で失敗」するため、検査対象がまだない段を最初から入れると、実装の途中で必ず失敗する
（plan C1「gate と CI の段階的な結線」、C20）。CI のジョブも同じで、対象（Stryker の変異対象、Playwright の設定、
クライアントバンドル検査のスクリプト）がないジョブを最初から入れると、`ci-status` が W5 まで失敗し続け、
PR のステータス（Req 1.7）が信号として機能しない。そこで波の締めのタスクが、対象が揃った段、
`check:repo-rules --only` の規則、CI のジョブ（と `ci-status` の `needs`）を加える。波の途中では、直前の波の
締めで確定した構成を使う。一度加えた段・規則・ジョブは外さない。

| 時点 | 締めのタスク | gate に加える段 | `check:repo-rules --only` に加える規則 | CI に加えるジョブ |
|---|---|---|---|---|
| 初期 | 1.1（CI は 2.1） | `lint`（`biome ci` のみ） | — | `gate`、`secret-scan`、`audit`、集約 `ci-status` |
| W1 の締め | 5.5 | `lint` への `count-biome` の付加、`check:model-ids`、`check:repo-rules`、`test`（`tooling/`・`scripts/` のテスト） | `no-dynamic-eval`、`actions-pinned`、`frozen-lockfile`、`allow-builds-reasoned` | — |
| W2 の締め | 13.7 | `typecheck`（`count-tsc` 付き。ルートの `//#typecheck` を含む） | `no-deprecated-object-api`、`guarded-agent-only`、`ai-core-no-ui-deps`、`no-sensitive-logging` | — |
| W3 の締め | 19.3 | — | `tool-risk-declared` | `mutation`（Stryker の変異対象がすべて W3 までにそろう） |
| W4 | （締めのタスクなし） | — | — | — |
| W5 の締め | 29.1 | `docs:check`。これで plan C1 の全段（`lint` → `check:model-ids` → `check:repo-rules` → `typecheck` → `test` → `docs:check`）と全9規則がそろう | — | `e2e`（3エンジン）、`client-bundle`。これで plan C2 の全ジョブがそろう |

各規則の走査対象と除外は plan C20 の規則表が正本である。
