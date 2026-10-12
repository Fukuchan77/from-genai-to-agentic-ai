# agentic-ai-platform（Milestone 1）— 実装タスク（索引と現在の波）

`/sdd-tasks` が生成し、`/sdd-analyze`（2026-09-27）の指摘を反映して、実装の波（W1〜W5）ごとに分割した。
2回目の `/sdd-analyze`（2026-09-27）の H-1〜H-3、M-1〜M-4 と、3回目の H-1、M-1〜M-4、L-1〜L-3 も反映した。
ルールは `~/.claude/sdd/rules/tasks-generation.md` と `~/.claude/sdd/rules/tasks-parallel-analysis.md` に従う。
並列モード（`--sequential` 未指定）。

## ファイル構成

| ファイル | 内容 |
|---|---|
| `tasks.md`（本ファイル） | 表記規約、ID 対応表、進捗、gate と CI の段階的な結線、**現在の波**のタスク全文 |
| `tasks-comp-w1.md`〜`tasks-comp-w5.md` | 完了した波の保管先。波の完了時に作る（現在は `tasks-comp-w1.md`〜`tasks-comp-w4.md`） |
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
| W5 E2E・解説・最終統合 | 25 E2E 生成・検査スクリプト、26 E2E 基盤、27 E2E シナリオ、28 解説ドキュメント、29 最終統合と NFR 検証 | 着手（現在の波。25.1〜25.3、26.1、27.1、27.3 は W4 の実サーバー確認で先行して完了） | 本ファイル |

波の順序は依存関係で決まる。W4 は 21 を 20 より先に行う（20.1 がレート制限器を組み立てるため）。

モジュールの完成タグ（Req 7.11、plan C22）は、そのモジュールのリファレンス実装が完了した波の中で付ける:
`module/1-1` は 14.6（W3）、`module/1-2` は 23.5（W4）、`module/1-3` は 24.4（W4）。29.4 は3つのタグの検証と
push だけを行う。`module/1-2`・`module/1-3` は 2026-10-12 にローカルで付けた（`7cc27cc`）。`module/1-1` のタグはまだない。

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

---

# 現在の波: W5 E2E・解説・最終統合（大タスク 25〜29）

順序: 25 → 26 → 27、28 は並行、29 が最後。25.1〜25.3、26.1、27.1、27.3 は、W4 の実サーバー確認のために先に完了した
（26 は 25 に依存するが、26.1 の設定と axe ヘルパだけを前倒しした）。残りは 26.2、26.3 の `latency-probe.ts`、27.2、27.4、28、29。

---

## 25. E2E 生成・検査スクリプト（C19・C20 続き）

実際の Route Handler の出力から E2E fixture を生成し、ビルド済みクライアントバンドルと
Playwright 結果を検査する。

_Boundary:_ `scripts/e2e/generate-sse-fixtures.mjs`, `apps/web/app/api/chat/route.test.ts`, `apps/web/app/api/agent/tools/route.test.ts`, `apps/web/app/api/summarize/route.test.ts`, `scripts/check-client-bundle.mjs`, `scripts/check-client-bundle.test.mjs`, `scripts/gate/assert-playwright-nonempty.mjs`, `scripts/gate/assert-playwright-nonempty.test.mjs`
_Depends:_ 22, 23, 24
_Requirements:_ 1.10, 1.15, 1.17
_Traces:_ REQ-001, C19, C20

- [x] 25.1 `scripts/e2e/generate-sse-fixtures.mjs`: `mock` モードの Route Handler を C7 のシナリオで実行した出力から `.sse` fixture を生成する（手書きしない）。先に3つの `route.test.ts` に「生成済み fixture と現在の出力が一致する」検査を加えて失敗を確認し（RED）、生成して通す（GREEN）
  _Boundary:_ `scripts/e2e/generate-sse-fixtures.mjs`, `apps/web/app/api/chat/route.test.ts`, `apps/web/app/api/agent/tools/route.test.ts`, `apps/web/app/api/summarize/route.test.ts`
  _Depends:_ 22, 23, 24
  _Requirements:_ 1.17
  _Traces:_ REQ-001, C19
- [x] 25.2 (P) `scripts/check-client-bundle.mjs`: `next build` 後の `.next/static` に秘密情報の環境変数名と番兵値が含まれないことを検査する + `check-client-bundle.test.mjs`（fixture ディレクトリで検出・非検出・走査0件での失敗）
  _Boundary:_ `scripts/check-client-bundle.mjs`, `scripts/check-client-bundle.test.mjs`
  _Depends:_ 20
  _Requirements:_ 1.10
  _Traces:_ REQ-001, C20
- [x] 25.3 (P) `scripts/gate/assert-playwright-nonempty.mjs`: Playwright の JSON 結果で「収集0件」「全件スキップ」を失敗にする + `assert-playwright-nonempty.test.mjs`
  _Boundary:_ `scripts/gate/assert-playwright-nonempty.mjs`, `scripts/gate/assert-playwright-nonempty.test.mjs`
  _Depends:_ 1
  _Requirements:_ 1.15, 1.17
  _Traces:_ REQ-001, C19

### Implementation Notes

- 2026-10-12: 25.3 `assert-playwright-nonempty.mjs`（7件）。収集0件・全件スキップ・必須プロジェクトの実行0件を失敗にし、`--projects` で3エンジンを要求する。`mise run test:e2e` が Playwright の JSON 結果（`apps/web/test-results/results.json`）をこれに渡す。実際の結果で `executed=81 (chromium=27 firefox=27 webkit=27)` を確認した。PROVE: 全件スキップの検査・収集0件の検査・必須プロジェクトの検査・スキップを実行に数える変異の4つがすべて検出された。
- 25.2 `check-client-bundle.mjs`（6件）。秘密の変数名は `env-schema.ts` から `API_KEY|SECRET|PASSWORD|SALT|AUTH|ENCRYPTION_KEY` を含む名前を抽出する（13件）。`mise run check:client-bundle` が番兵値（`changeme-bundle-sentinel-*`）を環境変数に入れて `next build` し、`.next/static`（16ファイル）を検査して通した。0ファイルの走査は失敗にする。PROVE: 名前の検査・番兵値の検査・0件の許可・再帰の停止の変異を検出。名前の公開例外（`LANGFUSE_PUBLIC_KEY`）は、パターンに一致しないため冗長と分かり削除した。
- 25.1 `generate-sse-fixtures.mjs`（5件）は `.sse` を扱う唯一の場所（`verifyOrWriteFixture`）。`scripts/` は `child_process` を使えないため、生成は Route Handler のテスト自身が行う: `SSE_FIXTURES=write`（`mise run e2e:fixtures`）で書き、通常は完全一致を要求する。先に3つの `route.test.ts` へ一致検査を足して「fixture が無い」で失敗する RED を確認し、生成して GREEN にした。生成を2回行い差分が出ない（決定論的）ことと、fixture の1語を書き換えると `stale (line 7: ...)` で失敗することを確認した。fixture は共有の M1_2 / M1_3 シナリオから作る（実サーバーの mock 応答と同じ）。
- `_Boundary:_` の外: `scripts/e2e/generate-sse-fixtures.test.mjs`、`scripts/check-client-bundle*.mjs` は規約どおり隣にテストを置いた。`mise.toml` に `check:client-bundle`・`e2e:fixtures` を足し、`test:e2e` を変更した。gate・CI への結線は 29 の締めで行う。`mise run gate` → exit 0: root 275、ai-core 687、eval-suite 3、web 301。
- 26.1 の `_Verify:_`（3エンジンで27のシナリオを実行し、25.3 が0件・全件スキップでないことを確認）を満たしたためチェックした。26.2（`mock-api.ts`）と 26.3 の `latency-probe.ts` は未着手。

---

## 26. E2E テスト基盤（C19 一部）

3エンジンでの実行環境、モックAPIのサポート、遅延計測とアクセシビリティ検査のヘルパを用意する。

_Boundary:_ `apps/web/playwright.config.ts`, `apps/web/e2e/support/mock-api.ts`, `apps/web/e2e/support/latency-probe.ts`, `apps/web/e2e/support/axe.ts`, `apps/web/e2e/fixtures/*.sse`
_Depends:_ 25
_Requirements:_ 1.17, 1.19, NFR-04, NFR-09, NFR-10
_Traces:_ REQ-001, C19

- [x] 26.1 `playwright.config.ts`: projects（chromium/firefox/webkit）、`webServer`（`next start`、`AI_RUN_MODE=mock`）、JSON レポーター
  _Boundary:_ `apps/web/playwright.config.ts`
  _Depends:_ 25
  _Requirements:_ 1.17, NFR-10
  _Traces:_ REQ-001, C19
  _Verify:_ 27 のシナリオを3エンジンで実行し、25.3 の検査が0件・全件スキップでないことを確認する
- [x] 26.2 `e2e/support/mock-api.ts`: `page.route("/api/**")` による fixture の返却、`e2e/fixtures/*.sse` の生成物配置
  _Boundary:_ `apps/web/e2e/support/mock-api.ts`, `apps/web/e2e/fixtures/*.sse`
  _Depends:_ 26.1
  _Requirements:_ 1.17
  _Traces:_ REQ-001, C19
  _Verify:_ 27.2 と 27.4 のシナリオで使う
- [x] 26.3 `e2e/support/latency-probe.ts`・`axe.ts`: チャンク受信からDOM反映までの遅延計測（`MutationObserver`）と `AxeBuilder.withTags(["wcag2a","wcag2aa","wcag21aa","wcag22aa"])`
  _Boundary:_ `apps/web/e2e/support/latency-probe.ts`, `apps/web/e2e/support/axe.ts`
  _Depends:_ 26.1
  _Requirements:_ 1.19, NFR-04, NFR-09
  _Traces:_ REQ-001, C19
  _Verify:_ 27.3 と 27.4 で使う。遅延を意図的に入れた fixture で 27.4 が失敗することを1回確認する

### Implementation Notes

- 2026-10-12（先行実施。25 の前）: 26.1 の `playwright.config.ts` と、26.3 の `axe.ts`（`latency-probe.ts` は未着手）だけを、27.1・27.3 のために先に作った。26 は 25 に依存するため順序を外れている。25.3（0件・全件スキップの検査）が未実装なので、26.1 の `_Verify:_` は満たしていない。チェックは付けない。
- webServer は `next build && next start -p 3100`（`AI_RUN_MODE=mock`、`NODE_ENV=production`）。呼び出し側のシェルが `NODE_ENV=development` を export していると `next build` が `/_global-error` のプリレンダーで失敗するため、`env` で上書きする。`gracefulShutdown` を指定しないと `next-server` が残ってポートを握り続ける。
- 3エンジン（chromium・firefox・webkit）で実行して通した。webkit は `pnpm exec playwright install webkit` で導入した。
- 2026-10-12: 26.2・26.3 を実装した（サブエージェントが実施し、メインが検証）。`route.fulfill` はストリームを返せないため、`mock-api.ts` は応答の計画（`paceMs`、`holdAfter`）をヘッダーで渡し、ページ内の `fetch` ラッパーが1イベントずつ再送する。`latency-probe.ts` はストリームを即時に読んでチャンクの受信時刻を記録し、`MutationObserver` が累積テキストの反映時刻を記録する（引き込み式だとバックプレッシャーの遅延が隠れる）。
- 遅延の実測（NFR-04、上限 100 ms、160 チャンク/エンジン）: 最大 chromium 6.8 ms／firefox 26.0 ms／webkit 15.0 ms。PROVE: 2チャンク目の描画に 150 ms の停止を入れると `latency.spec.ts` が `latencyMs: 150.3` のチャンクを指して失敗した。ヘルパー側の変異（`holdNext` 未設定、`transform` 無視、プローブ照合、モデル一覧の正規表現）もそれぞれ検出された。
- mock モードのチャットモデルは1つだけなので、モデル切替の spec は `/chat` の文書を転送中に書き換えて2つ目のモデルを加える（`offerAlternativeModel`。Next の埋め込み形式が変われば明示的に失敗する）。「`page.route("/api/**")` だけ」からの逸脱である。サーバー側の履歴変換は ai-core の単体テストが担当し、spec は送信本文と画面上の履歴の残存を確認する。`getByRole("alert")` は Next のルートアナウンサーにも一致するため、タイトル文言で絞る。

---

## 27. E2E シナリオテスト（C19 続き）

主要な画面操作を3エンジンで検証し、アクセシビリティとストリーミングの反映遅延を計測する。

_Boundary:_ `apps/web/e2e/real-server.spec.ts`, `apps/web/e2e/chat.spec.ts`, `apps/web/e2e/agent-tools.spec.ts`, `apps/web/e2e/summarize.spec.ts`, `apps/web/e2e/keyboard.spec.ts`, `apps/web/e2e/a11y.spec.ts`, `apps/web/e2e/latency.spec.ts`
_Depends:_ 26
_Requirements:_ 1.17, 1.19, 3.3, NFR-04, NFR-09, NFR-10
_Traces:_ REQ-001, REQ-003, C19

- [x] 27.1 (P) `real-server.spec.ts`: `page.route` を使わず `AI_RUN_MODE=mock` の実際の Route Handler を通してチャット・ツール・要約を1往復ずつ確認する（RequestGuard、ゲートウェイ、シナリオモデルを含む結合確認）
  _Boundary:_ `apps/web/e2e/real-server.spec.ts`
  _Depends:_ 26
  _Requirements:_ 1.17, NFR-10
  _Traces:_ REQ-001, C19
- [x] 27.2 (P) `chat.spec.ts`・`agent-tools.spec.ts`・`summarize.spec.ts`: 送信・逐次表示・モデル切替（切り替え後も会話履歴の表示が残る）・停止・エラー再送、ツール状態表示とカード描画、カードの逐次描画と取得失敗表示
  _Boundary:_ `apps/web/e2e/chat.spec.ts`, `apps/web/e2e/agent-tools.spec.ts`, `apps/web/e2e/summarize.spec.ts`
  _Depends:_ 26
  _Requirements:_ 1.17, 3.3, NFR-10
  _Traces:_ REQ-001, REQ-003, C19
- [x] 27.3 (P) `keyboard.spec.ts`・`a11y.spec.ts`: 主要操作をキーボードだけで行えること、各画面の axe 検査（WCAG 2.2 AA）。代表的な focusable component を focus し、`getComputedStyle` の outline / ring 実効色と隣接背景のコントラストが3:1以上であることを3エンジンで検証する
  _Boundary:_ `apps/web/e2e/keyboard.spec.ts`, `apps/web/e2e/a11y.spec.ts`
  _Depends:_ 26
  _Requirements:_ 1.19, NFR-09
  _Traces:_ REQ-001, C19
- [x] 27.4 (P) `latency.spec.ts`: 応答チャンク受信からDOM反映までが100ms以内であることを計測する
  _Boundary:_ `apps/web/e2e/latency.spec.ts`
  _Depends:_ 26
  _Requirements:_ NFR-04
  _Traces:_ REQ-001, C19

### Implementation Notes

- 2026-10-12: `real-server.spec.ts`（3ページの 200・スタイル適用・ブラウザエラー0、チャット／ツール／要約の1往復）、`a11y.spec.ts`（3ページ × light/dark）、`keyboard.spec.ts`（スキップリンク、チャットと要約のキーボードだけの操作、フォーカス指示子のコントラスト 3:1 を6要素 × light/dark）を実装した。dark は `.dark` クラスを `<html>` に付けて検査する。
- 実行結果: 3エンジン × 27 件 = 81 件が通過（`playwright test`）。WebKit（Safari）は既定でリンクとボタンを Tab で飛ばすため、`keyboard.spec.ts` は WebKit だけ Option+Tab（`Alt+Tab`）を使う。
- PROVE（変異 → 失敗）: `fixtures.ts` を `new URL` 形式に戻す → `next build` が `Module not found` で webServer が起動しない／`postcss.config.mjs` を外す → スタイル適用の3件が失敗／`<html lang>` を外す → axe の6件が失敗／`applyColorScheme` が dark を付けない → dark の3件が失敗。すべて復元済み。
- 発見と修正: Firefox ではスキップリンクがフォーカスを受けると outline の色が `currentcolor`（本文色 `lab(98.26 0 0)`）になり、ページ背景とのコントラストが 1.0 で指示子が見えなかった（keyboard.spec の2件が失敗）。`globals.css` に `:focus-visible { @apply outline-ring; }` を足して解消した。
- 27.1 の「ツール」は天気ツール1回、「要約」は字幕テキスト入力で確認している（記事・YouTube は 27.2 の範囲）。
- 2026-10-12: 27.2（`chat`・`agent-tools`・`summarize`。各4件）と 27.4（`latency`。2件）を実装した。`summarize.spec.ts` には、ブリーフ外の実経路の確認（`http://localhost/article` が 422 `disallowed-url`）と、字幕なし（422、Req 4.11）を加えた。RED: spec を先に書き、ヘルパーがない `TS2307` と、`next build` の型検査で webServer が起動しない失敗を確認した。PROVE（アプリ側の変異 → 失敗）: 停止ボタンを無効化／モデル切替で `setModelId` を外す／「再送信」の文言変更／生成中のパートを隠す／ツール状態の文言変更／カードの題名変更／`aria-busy` 固定／取得失敗の文言変更の13件が、それぞれの assertion で失敗した。復元済み（`git diff apps/web/components` が空）。
- 実行結果: `mise run test:e2e` を2回続けて `executed=123 skipped=0 (chromium=41 firefox=41 webkit=41)`。新規4 spec は `--repeat-each=10` で 420 件通過（不安定 0）。アプリ本体の不具合は見つからなかった。

---

## 28. モジュール解説ドキュメント（C22）

19モジュール共通の解説テンプレートと Phase 1（1-0〜1-3）の解説を日本語で提供し、その構造と
参照を機械的に検査する。各モジュールの解説は、テンプレートの必須節（7.2〜7.5）、Req 7.9 の表のそのモジュールの
必須トピック、Python / Streamlit 経験者向けコラム（7.10）を含み、習熟度チェックリストから実在するテストを
参照する（7.6）。採用したモデルはモデル ID ではなくカタログへの参照で書く（7.4、constitution 原則 8）。

_Boundary:_ `scripts/check-docs.mjs`, `scripts/check-docs.test.mjs`, `docs/README.md`, `docs/modules/_template.md`, `docs/modules/index.md`, `docs/phases/phase-1.md`, `docs/modules/1-0-intro.md`, `docs/modules/1-1-dev-environment.md`, `docs/modules/1-2-ai-sdk-core-and-tools.md`, `docs/modules/1-3-structured-output-and-summaries.md`
_Depends:_ 27, 19
_Requirements:_ 1.8, 2.10, 2.16, 6.1, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 7.11, NFR-12
_Traces:_ REQ-001, REQ-002, REQ-006, REQ-007, C22

- [x] 28.1 `scripts/check-docs.mjs`・`check-docs.test.mjs`: 必須節・必須トピック見出し・チェックリストのテスト参照実在（`describe`/`it`/`test`/`describeLocal`/`itLocal` の文字列リテラルからの静的抽出）を検査し、参照0件で失敗する
  _Boundary:_ `scripts/check-docs.mjs`, `scripts/check-docs.test.mjs`
  _Depends:_ 27
  _Requirements:_ 7.6, 7.9
  _Traces:_ REQ-007, C22
- [x] 28.2 `docs/README.md`・`docs/modules/_template.md`: 解説の読み方、実行モード・外部サービスの表記規約、チェックリストから参照するテストは固定文字列の名前にする規約、19モジュール共通テンプレート（学習目標・主要トピック・ハンズオン手順・習熟度チェックリスト・実装とテストの所在・対照表「移植で諦めたもの」列・移植時の変更点・Python/Streamlitコラム・完成タグ）
  _Boundary:_ `docs/README.md`, `docs/modules/_template.md`
  _Depends:_ 28.1
  _Requirements:_ 7.2, 7.3, 7.4, 7.5, 7.9, 7.10, 7.11, NFR-12
  _Traces:_ REQ-007, C22
- [x] 28.3 `docs/modules/index.md`・`docs/phases/phase-1.md`: 19モジュールの一覧と状態、Phase 1 が扱う IBM 3段階成熟度モデルの水準
  _Boundary:_ `docs/modules/index.md`, `docs/phases/phase-1.md`
  _Depends:_ 28.2
  _Requirements:_ 7.1, 7.7
  _Traces:_ REQ-007, C22
- [x] 28.4 (P) `docs/modules/1-0-intro.md`: IBM 3段階成熟度モデル、Agentic AI の7段階閉ループ、生成AIとの比較マトリクス、7段階とモジュールの対応表。必須トピック: 7段階閉ループ、「テキストの生成」から「状態の変更」へ、LLM は認知・計画エンジン
  _Boundary:_ `docs/modules/1-0-intro.md`
  _Depends:_ 28.2
  _Requirements:_ 7.2, 7.3, 7.4, 7.5, 7.8, 7.9, 7.10
  _Traces:_ REQ-007, C22
- [x] 28.5 (P) `docs/modules/1-1-dev-environment.md`: モノレポ・品質ゲート・実行モード、Langfuse の必要リソース、watsonx.ai をスキップした理由、TypeScript 先行版の方針と後退の記録。必須トピック: Streamlit の全行再実行モデルと App Router の差分ストリーミング、Server / Client Components の境界、API キーのサーバー側実行
  _Boundary:_ `docs/modules/1-1-dev-environment.md`
  _Depends:_ 28.2
  _Requirements:_ 1.8, 2.10, 7.2, 7.3, 7.4, 7.5, 7.6, 7.9, 7.10
  _Traces:_ REQ-001, REQ-002, REQ-007, C22
- [x] 28.6 (P) `docs/modules/1-2-ai-sdk-core-and-tools.md`: ストリーミングチャット・ToolLoopAgent・Generative UI、停止条件の近似性の注意。必須トピック: ロール設計（system / user / assistant / tool）、テンプレートによるプロンプト構築、Few-shot / CoT、推論モデルが計画に与えた影響、LangChain AgentExecutor と `ToolLoopAgent` の対比
  _Boundary:_ `docs/modules/1-2-ai-sdk-core-and-tools.md`
  _Depends:_ 28.2
  _Requirements:_ 6.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.9, 7.10
  _Traces:_ REQ-006, REQ-007, C22
- [x] 28.7 (P) `docs/modules/1-3-structured-output-and-summaries.md`: 構造化出力・分割の境界・プロンプトキャッシュ、`mock` の埋め込みが検索精度の評価に使えないことの明記。必須トピック: Map-Reduce が不要になった理由と分割が必要な境界、プロンプトキャッシュの原理とコスト
  _Boundary:_ `docs/modules/1-3-structured-output-and-summaries.md`
  _Depends:_ 28.2
  _Requirements:_ 2.16, 7.2, 7.3, 7.4, 7.5, 7.6, 7.9, 7.10
  _Traces:_ REQ-002, REQ-007, C22

### Implementation Notes

- spec [`005-hub-alignment`](../005-hub-alignment/spec.md) が承認された場合、本タスクは次の影響を受ける（001 Clarifications Session 2026-10-04）。005 の承認後に plan C22・C20 と本タスクを改訂してから着手し、未承認の間は現行の定義のまま進める。
  - 28.2 のテンプレートと 28.4〜28.7 の各解説に「本番ではどう作るか」節を加え、[`specs/curriculum/README.md`](../curriculum/README.md)「本番実装との対応」の表が割り当てたハブの手法ページへリンクする（1-1 はハブの `CLAUDE.md` / `AGENTS.md`）。ハブの本文は転載しない（005 Req 2.2、2.5）
  - 解説内のリンク先の文字列を対応表と照合する検査を、ネットワークに接続しないリポジトリ規則として加える。走査 0 件で失敗し、解説が未作成のモジュールは一覧として出力する（005 Req 2.3、2.4）。`check:repo-rules` の規則数（現行の全9規則）と tasks.md「gate と CI の段階的な結線」の表もあわせて改訂する
  - `apps/web` のテーマトークン（大タスク 8.3 の `app/globals.css` とコントラスト検査）を、ハブが参照する元として文書化する（005 Req 3.3、3.4）

- 2026-10-12: 28.1 `scripts/check-docs.mjs`（22件）。必須の節、モジュール別の必須トピックの見出し（Req 7.9、1-0 は Req 7.8 の内容も）、ハンズオン手順ごとの `実行モード:`・`外部サービス:`、対照表の「移植で諦めたもの」列、チェックリストの `<!-- test: path#name -->` が指すテストの実在（`describe`/`it`/`test`/`describeLocal`/`itLocal` の文字列リテラルから静的に抽出。`it.each` とテンプレートは参照不可）を検査する。モジュール 0 件・参照 0 件・リポジトリ外を指す参照は失敗にする。PROVE: 11の変異（`itLocal` の除外、補間テンプレートの許可、Python コラムの全モジュール必須化、リポジトリ外参照の許可、0 件の許可 2種、手順ラベルの無検査、トピックの無検査、対照表の列の無検査、テスト名の無検査、チェックリスト外の参照の読み取り）がすべて検出された。
- 28.2〜28.3 は直接執筆。28.4〜28.7 は1文書1サブエージェントで執筆し、メインが `docs:check` で検証した。`mise run docs:check` → `Docs: 4 module documents, 51 test references verified`。解説にモデル ID は書かず（`check:model-ids` 通過）、「本番ではどう作るか」節は 005 の設計が未承認のため加えていない。
- 要確認（サブエージェントの報告）: (1) `module/1-1` タグがローカルにない。1-1 の解説は「14.1〜14.5 の統合コミットに付け、29.4 で再作成する」と書いている。再作成時にタグの内容と突き合わせる。(2) 1-0 の「7段階とモジュールの対応表」は、spec が段階とモジュールを対応づけていないため、phase-2〜4 からの解釈である。(3) 1-3 のプロンプトキャッシュの書き込み倍率・最短長・TTL は Anthropic の文書の値で、カタログにはない（解説が出典と確認日を明記）。(4) 1-3 の解説は、`staged` の各チャンクにもキャッシュ印が付き再読込がないこと、`estimateCost` にキャッシュ書き込み項がないことを、コードの読解から述べている。(5) `module/1-3` の木に `apps/web/e2e` の3 spec が含まれる（コミット順による）。(6) `dev` の mise タスクがないため、解説の起動手順は `mise exec -- pnpm --filter web dev` を使う。

---

## 29. 品質ゲート最終統合と NFR 検証

W5 の締めとして `mise run gate` の全段と CI の全ジョブを結線し、決定性・オフライン動作・実行時間の非機能要件を
実測で確認し、W3・W4 で付けたモジュールの完成タグを検証して push する。

_Boundary:_ `mise.toml`, `vitest.config.ts`, `.github/workflows/ci.yml`
_Depends:_ 5, 13, 19, 25, 26, 27, 28
_Requirements:_ 1.4, 1.5, 1.7, 1.10, 1.11, 1.14, 1.15, 1.16, 1.17, 1.18, 7.11, NFR-01, NFR-02, NFR-03
_Traces:_ REQ-001, REQ-007, C1, C2, C22

- [x] 29.1 W5 の締め: `mise.toml` の `gate` に `docs:check` を加え、plan C1 の全段（`lint`→`check:model-ids`→`check:repo-rules`→`typecheck`→`test`→`docs:check`）と `check:repo-rules` の全9規則がそろったことを確認し、いずれかの失敗で非ゼロ終了することを確認する。`ci.yml` に `e2e`（chromium/firefox/webkit マトリクス。`mise run test:e2e` の後に 25.3 の `assert-playwright-nonempty`）と `client-bundle`（`next build` の後に 25.2 の `check-client-bundle`。秘密情報の番兵値を注入する）を加え、`ci-status` の `needs` を plan C2 の全ジョブにする（[tasks.md](tasks.md)「gate と CI の段階的な結線」）
  _Boundary:_ `mise.toml`, `.github/workflows/ci.yml`
  _Depends:_ 5, 13, 19, 25, 26, 27, 28
  _Requirements:_ 1.4, 1.7, 1.10, 1.15, 1.17
  _Traces:_ REQ-001, C1, C2
  _Verify:_ 各段について、一時的に違反を入れて gate が非ゼロで終了することを1回ずつ確認する。追加したジョブは `actions-pinned`・`frozen-lockfile` 規則を満たす
- [x] 29.2 `mise run gate:repeat`（同一コミットで10回実行し合否が同一）、オフライン実行（依存インストール済みでネットワーク切断時も成功）、API キーなしでの成功、5分以内の完了を実測で確認する。Ollama を止めた状態の `mise run test:local` で、`*.local.test.ts` が理由付きでスキップされることも確認する。Ollama を起動した状態では、要約（`num_ctx` 32,768）とチャット・エージェント（サーバー既定）を交互に呼んだときのモデル再読み込みの時間とメモリ量を実測する（W3 敵対的レビュー r2 の N4。大きければチャットとエージェントにも同じ `num_ctx` を渡す変更を plan C11・C8 に起票する）
  _Boundary:_ `mise.toml`
  _Depends:_ 29.1
  _Requirements:_ 1.5, 1.11, 1.14, NFR-01, NFR-02, NFR-03
  _Traces:_ REQ-001, C1
  _Verify:_ 実測値（実行時間、10回の合否、Ollama の再読み込み時間とメモリ量）を大タスク29の Implementation Notes に記録する
- [ ] 29.3 `mise run secret-scan`・`audit`・`test:mutation` の実行確認と、CI の集約ステータス（`ci-status`）が plan C2 の全ジョブ（`gate`、`e2e`、`secret-scan`、`audit`、`mutation`、`client-bundle`）を反映することの最終確認
  _Boundary:_ `mise.toml`
  _Depends:_ 29.1
  _Requirements:_ 1.16, 1.18
  _Traces:_ REQ-001, C1
  _Verify:_ `test:mutation` の閾値（70）を満たすことと、CI の全ジョブの成功を PR 上で確認する
- [ ] 29.4 完成タグの検証と push: 14.6・23.5・24.4 で付けた `module/1-1`・`module/1-2`・`module/1-3`（1-0 は解説のみのためタグなし。plan C22）を検証し、人間の承認後に push する。タグは付け直さない（完成時点を示すため）。各解説（28.5〜28.7）の「完成時点のタグ」の節が、タグ名と、そのタグに含まれない後続の成果（E2E、解説）を示していることも確認する
  _Boundary:_ git タグのみ（ファイルの変更なし）
  _Depends:_ 14.6, 23.5, 24.4, 29.2, 29.3
  _Requirements:_ 7.11
  _Traces:_ REQ-007, C22
  _Verify:_ `git tag --list 'module/*'` で3つのタグが表示され、`module/1-1` と `module/1-2` が異なるコミットを指し、各タグのコミットで `mise run gate`（その時点の構成）が成功する

- [ ] 29.5 Ollama の `num_ctx` をチャット・エージェント・要約でそろえる（plan C8・C11・C12、2026-10-12 の改訂）: 先にテストを書いて失敗を確認し（RED）、`ollamaRuntimeOptions(entry)` を `models/` に置いて `summarize/pipeline.ts` の既存実装を移し、チャットの Route（C15）とエージェントの `createGuardedAgent`（C8）が同じ値を渡すようにする。Ollama 以外のモデルには何も付けない
  _Boundary:_ `packages/ai-core/src/models/**`, `packages/ai-core/src/summarize/pipeline.ts`, `packages/ai-core/src/agents/**`, `apps/web/app/api/chat/route.ts`, `apps/web/app/api/chat/route.test.ts`, `apps/web/app/api/agent/tools/route.ts`, `apps/web/app/api/agent/tools/route.test.ts`
  _Depends:_ 29.2
  _Requirements:_ 1.5, 3.3
  _Traces:_ REQ-001, REQ-003, C8, C11, C12
  _Verify:_ 3つの経路（チャット・エージェント・要約）の呼び出しが同じ `num_ctx` を渡すことをテストで確認し、Ollama 以外では `providerOptions` が付かないこと、実 Ollama で交互に呼んでも `load_duration` が 100 ms 未満であること（29.2 と同じ手順）を確認する

### Implementation Notes

- 2026-10-12: 29.1 完了。`mise.toml` の `gate` に `docs:check` を加え、plan C1 の全段と `check:repo-rules` の全9規則がそろった。`test:e2e` は `E2E_PROJECTS`（カンマ区切り、既定は3エンジン）を受け取り、CI の `e2e` ジョブ（chromium/firefox/webkit のマトリクス）が1エンジンずつ実行する。`ci.yml` に `e2e` と `client-bundle` を加え、`ci-status` の `needs` を6ジョブにした（`actions-pinned`・`frozen-lockfile` 規則は通過）。検証: `docs/modules/1-0-intro.md` の必須の節を1つ外すと `mise run gate` が exit=1（`1-0-intro.md: missing section: 完成時点のタグ`）。復元後は exit=0。他の段の違反による非ゼロ終了は、各段を結線した波（W1〜W3）で確認済み。
- 29.2（一部）: API キー（ANTHROPIC・OPENAI・TAVILY）を外して `mise run gate:repeat` → 10回すべて成功、合計 1分59秒（`TURBO_FORCE`、1回あたり約12秒。NFR-01 の 5分以内）。ネットワークの実切断は行っていない（テストは `fetch`・`node:net`・`node:dns` を遮断し、未モックの接続は失敗する）。**未完了**: Ollama を止めた状態のスキップ確認と、`num_ctx` の再読み込み時間・メモリ量の実測（環境の操作を伴うため人間の判断に委ねる）。ローカルモデルの既定を変更した（2026-10-12、人間の指示）: カタログの local 既定を `granite4.2:latest`（chat・structured）、`gemma4:e2b`（judge）、`nomic-embed-text:latest`（embedding）にし、`llama3.2:latest` も選べる。`ollama show` で確認した機能（3モデルともツール対応、コンテキスト長 131,072）を反映し、チャットモデルの `contextWindow` は `num_ctx` として使う 32,768 にした（131,072 の KV キャッシュは学習者の PC に重いため）。要約の入力の予算は 32,768×0.8−4,096=22,118 になった。新しい既定で `mise run test:local` → eval-suite 1 件、ai-core 2 件が通過した。
- 29.2（Ollama 実測。2026-10-12、Ollama 0.40.3、granite4.2:latest、メモリ 16 GB、`ollama ps` と `/api/chat` の `load_duration`）: (1) Ollama 停止中の `TURBO_FORCE=true mise run test:local` → ai-core `executed=0 skipped=2`、eval-suite `executed=0 skipped=1`、理由は `Ollama is unavailable at http://127.0.0.1:11434: fetch failed`（exit 0。キャッシュ再生ではないことを `cache bypass` と `0 cached` で確認）。(2) 起動中、要約（`num_ctx` 32,768）とチャット（`num_ctx` なし＝サーバー既定）を交互に3往復: サーバー既定のコンテキストは 4,096。呼び出しのたびにモデルが再読み込みされ、`load_duration` は 2.6〜5.6 秒、壁時計は 3.5〜6.8 秒。常駐サイズは要約側 10 GB、チャット側 5.9〜6.1 GB で、交互に入れ替わる。(3) 対照: 両方に `num_ctx` 32,768 を渡すと、最初の1回以外の `load_duration` は 8〜9 ms、壁時計は 0.5〜1.1 秒で再読み込みなし。常駐サイズは 10 GB 固定（granite4.2 の重み約 5.3 GB に KV キャッシュ約 4.7 GB。16 GB の PC では他のアプリの余裕が小さい）。(4) 判断: 交互の呼び出しで毎回 3〜5 秒の再読み込みが出るため「大きい」に該当する。チャットとエージェントにも同じ `num_ctx` を渡す変更を plan C11・C8・C12 に反映した（2026-10-12、人間の承認済み。コードは未実装で、下の 29.5 で行う）。メモリ 10 GB が重い場合の代案は、カタログの `contextWindow` を下げて全呼び出しで同じ値にそろえること。
- 29.2（オフライン実行。2026-10-12）: `sandbox-exec` で外向きの IP 通信を拒否し（`(deny network-outbound (remote ip))`、ループバックのみ許可）、`TURBO_FORCE=true mise run gate` → exit 0、13秒、`0 cached`（root 297、ai-core 702 skipped 4、eval-suite 3 skipped 1、web 305、docs 51 参照）。同じプロファイルで `fetch('https://registry.npmjs.org/')` が `EPERM` になり、遮断が効いていることを確認した。これで 29.2 の全項目（10回の同一判定、オフライン、API キーなし、5分以内、Ollama 停止時のスキップ、再読み込みの実測）がそろった。
- 29.5（2026-10-12）: `models/runtime-options.ts` に `ollamaRuntimeOptions(entry)` を置き（`@platform/ai-core/models` から公開）、`summarize/pipeline.ts` の `runtimeOptions` を置き換えた。`GuardedAgentOptions.providerOptions` を加えて `ToolLoopAgent` の settings へ渡し、チャットの Route は `streamText` に、エージェントの Route は `createGuardedAgent` に `...ollamaRuntimeOptions(entry)` を渡す。テスト: `runtime-options.test.ts`（カタログの全 Ollama エントリで `num_ctx` = `contextWindow`、他は `{}`）、`guarded-agent.test.ts`（3ステップすべての LLM 呼び出しに `providerOptions` が届く／渡さなければ付かない）、両 Route の `it.each`（Ollama の既定のチャットモデルなら `num_ctx` = `contextWindow`、mock なら `providerOptions` なし）。RED: モジュール未作成と `expected undefined to deeply equal { ollama: … }`。PROVE: `ollamaRuntimeOptions` を常に `{}` にすると新規4件・要約の既存2件・両 Route の Ollama ケースが失敗、`providerOptions` の受け渡しを消すとエージェントのテストとエージェント Route が失敗した（復元済み）。Route のテストはモデル ID リテラルの規則（`check:model-ids`）に従い `defaultModelFor("local", "ollama", "chat")` で引く。**未完了**: 実 Ollama で交互に呼んだときの `load_duration` < 100 ms の確認（このセッションでは Ollama への接続が許可されなかった）。
- 29.3（ローカル分）: `mise run secret-scan` → `162 commits scanned … no leaks found`、`mise run audit` → `No known vulnerabilities found`、`mise run test:mutation` → `Final mutation score of 91.60 … break threshold 70`（exit 0）。**未完了**: CI の全ジョブ成功の PR 上での確認。
