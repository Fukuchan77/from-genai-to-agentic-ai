# rag-and-workflows（Milestone 2）— 完了した実装タスク W5: 画面と E2E（大タスク 20〜23）

完了した波（2026-10-13 に移行）。表記規約、ID 対応表、進捗、gate への段階的な結線、完了した波の移行手順は
[tasks.md](tasks.md) を参照する。波の敵対的レビューの記録は
`.sdd/reviews/002-rag-and-workflows-impl-w5-review-2026-10-13.md`（1 ラウンド。指摘への対応を追記済み）。
コミット: `b40870d`、`3574034`、`5968504`、`7e00dc4`。

---

## W5 画面と E2E（大タスク 20〜23）

W4（大タスク 16〜19）は完了し [tasks-comp-w4.md](tasks-comp-w4.md) に移した。

`/rag` と `/workflows` の画面、SSE fixture の生成、axe・キーボード操作、実サーバー E2E の拡張を作る。UI は shadcn/ui の既存の部品
（`apps/web/components/ui/`）と標準の HTML 要素で組む（新しい shadcn 部品の追加は plan の範囲外）。色はテーマトークン経由（コントラストはルートのテストが検査する）。
M1 W4 の教訓として、フォーカス指示子が見えること、スタイルが実サーバーで適用されることを E2E で確かめる。

20.1・20.2・20.3・21.1 は並列に進められる。20.4 は 20.1〜20.3 の後、21.2 は 21.1 の後、21.3 は 21.2 の後に行う。

---

## 20. RAG 画面の部品（C14）

取り込み、質問、手法のスイッチ、段階の進行、中間結果、回答と引用の対応付けを表示する。引用の照合はサーバーが確定した `data-rag-result` を
表示するだけで、クライアントは再検証しない（二重実装を避ける）。

_Boundary:_ `apps/web/components/rag/AnswerView.tsx`, `apps/web/components/rag/AnswerView.test.tsx`, `apps/web/components/rag/CitationList.tsx`, `apps/web/components/rag/CitationList.test.tsx`, `apps/web/components/rag/StageProgress.tsx`, `apps/web/components/rag/StageProgress.test.tsx`, `apps/web/components/rag/TraceView.tsx`, `apps/web/components/rag/TraceView.test.tsx`, `apps/web/components/rag/MethodSwitches.tsx`, `apps/web/components/rag/MethodSwitches.test.tsx`, `apps/web/components/rag/IngestPanel.tsx`, `apps/web/components/rag/IngestPanel.test.tsx`, `apps/web/components/rag/RagPanel.tsx`, `apps/web/components/rag/RagPanel.test.tsx`
_Depends:_ 8.6, 10.3, 11.1, 15.3, 15.4
_Requirements:_ 1.5, 1.10, 2.7, 2.8, 2.11
_Traces:_ REQ-001, REQ-002, C14

- [x] 20.1 (P) `components/rag/AnswerView.tsx`・`CitationList.tsx`: 回答本文の脚注 `[n]` を引用カードへの参照（アンカー。キーボードで到達・操作でき、移動先のカードにフォーカスが移る）として描画する。引用カードは文書名、ページまたは見出しパス、抜粋、`cited` の区別（色だけに頼らず「引用あり」「取得のみ」の文字で示す）、サーバーが除去した範囲外の引用があればその旨を表示する。対応するカードが無い脚注はリンクにせずそのまま表示する。ストリーム中は本文の差分を表示し、`data-rag-result` を受けたら `answer` に置き換える + `AnswerView.test.tsx`・`CitationList.test.tsx` に、脚注と引用カードの対応、Enter/Space での移動、カードが無い脚注、`cited` の文字表示、除去の通知、該当なし（`noEvidence`）の表示、コードブロック内の `[n]` をリンクにしないことを先に足す
  _Boundary:_ `apps/web/components/rag/AnswerView.tsx`, `apps/web/components/rag/AnswerView.test.tsx`, `apps/web/components/rag/CitationList.tsx`, `apps/web/components/rag/CitationList.test.tsx`
  _Depends:_ 11.1
  _Requirements:_ 1.5, 1.10
  _Traces:_ REQ-001, C14
- [x] 20.2 (P) `components/rag/StageProgress.tsx`・`TraceView.tsx`: 段階の進行状況（サブクエリ生成中、検索中、統合中、Rerank 中。`running`/`done`/`skipped` と理由。`aria-live="polite"`）と、各段の中間結果（仮想回答、サブクエリ、ベクトル / 全文の候補、統合後、Rerank 後。Rerank が `skipped` のときはその理由）の折りたたみ表示 + `StageProgress.test.tsx`・`TraceView.test.tsx` に、段の状態の更新、スキップの理由の表示、`aria-live` の領域、折りたたみのキーボード操作、候補が 0 件の表示、手法が無効な段を表示しないことを先に足す
  _Boundary:_ `apps/web/components/rag/StageProgress.tsx`, `apps/web/components/rag/StageProgress.test.tsx`, `apps/web/components/rag/TraceView.tsx`, `apps/web/components/rag/TraceView.test.tsx`
  _Depends:_ 10.3
  _Requirements:_ 2.8, 2.11
  _Traces:_ REQ-002, C14
- [x] 20.3 (P) `components/rag/MethodSwitches.tsx`・`IngestPanel.tsx`: 手法のスイッチ（HyDE、Multi-Query、ハイブリッド、Rerank、Agentic RAG）と k・類似度の閾値の入力（範囲を満たさない値を送らない。Rerank は `rerank.available` が偽のとき、キー未設定でスキップされる旨を注記する）。取り込みパネル（取り込み元の選択、ファイルの選択、結果 — 取り込み済みの件数とスキップされたファイル名と理由 — の表示。`reset: true`（ナレッジベース全体の削除）は実行前の確認ダイアログ（標準の `<dialog>`。既定でキャンセル、キーボードで操作・Esc で閉じる）を通す）+ `MethodSwitches.test.tsx`・`IngestPanel.test.tsx` に、スイッチの状態の伝播、範囲外の入力の拒否、Rerank の注記、取り込み結果の表示（スキップ理由 5 種）、リセットの確認が既定でキャンセルになりキャンセルでは送信されない、キーボード操作を先に足す
  _Boundary:_ `apps/web/components/rag/MethodSwitches.tsx`, `apps/web/components/rag/MethodSwitches.test.tsx`, `apps/web/components/rag/IngestPanel.tsx`, `apps/web/components/rag/IngestPanel.test.tsx`
  _Depends:_ 8.6
  _Requirements:_ 2.7, 1.5
  _Traces:_ REQ-001, REQ-002, C14
- [x] 20.4 `components/rag/RagPanel.tsx`: 質問フォーム（1〜2000 文字）、`useChat` で `/api/rag/query`（通常）または `/api/rag/agent`（Agentic モード）へ送信し、`parts` から `data-rag-stage`・`data-rag-trace`・`data-rag-result` を縮約する `selectRagView(messages)`、停止ボタン（`request.signal` の中断）、エラー表示（`code` と日本語メッセージ）、Agentic モードの「検索したか」（`messageMetadata.rag`）と停止理由（M1 の `RunSummaryBadge` と同じ語彙）の表示を組み立てる。20.1〜20.3 の部品を組み合わせる + `RagPanel.test.tsx` に、`selectRagView` の縮約（同じ `id` の上書き、結果前後の本文の置き換え）、送信先の切り替え、手法の設定がリクエストに載る、停止、エラーの表示、検索しなかった回答の表示を先に足す
  _Boundary:_ `apps/web/components/rag/RagPanel.tsx`, `apps/web/components/rag/RagPanel.test.tsx`
  _Depends:_ 20.1, 20.2, 20.3, 15.3, 15.4
  _Requirements:_ 1.5, 1.10, 2.7, 2.8, 2.11
  _Traces:_ REQ-001, REQ-002, C14

### Implementation Notes

- `@platform/ai-core/rag` is server-only (DB drivers), so client components import its types only. Two consequences for 22.1: the page must pass `QUERY_REQUEST_LIMITS` (as `limits` / `questionMaxLength`) and the `DEFAULT_RAG` defaults into `RagPanel`, and `IngestPanel` takes the `GET /api/rag/knowledge` body as `initial` (`KnowledgeInfo`) and refreshes it itself after an ingest. The footnote grammar of `resolveCitations` is copied into `AnswerView` (a client-safe tokenizer), pinned by its tests.
- `/api/rag/agent` reuses the conversation schema, which requires `personaId`; `RagPanel` takes `agentPersonaId` (the page passes `DEFAULT_PERSONA_ID`) and sends only the newest user message, so each question is answered on its own in both modes. The panel clears the screen when the Agentic switch flips and renders by the mode that was sent, not by the switches as they are now.
- A `<details>` has no accessible name in testing-library: tests find sections by their `<summary>` text. jsdom has no `<dialog>` behaviour (polyfilled in `IngestPanel.test.tsx`); Escape and the focus ring must be confirmed in the real browser E2E (23.3).

---

## 21. ワークフロー画面の部品（C14）

パターンの選択、入力、実行、中断と、パターン固有の結果（履歴、スコア、票の内訳、サブタスク一覧など）の表示。

_Boundary:_ `apps/web/components/workflows/WorkflowResultView.tsx`, `apps/web/components/workflows/WorkflowResultView.test.tsx`, `apps/web/components/workflows/WorkflowPanel.tsx`, `apps/web/components/workflows/WorkflowPanel.test.tsx`
_Depends:_ 16.8, 17.7, 19.1
_Requirements:_ 3.1, 3.2, 3.3, 3.6, 3.7, 3.9, 3.10, 3.12, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7
_Traces:_ REQ-003, REQ-004, C14

- [x] 21.1 (P) `components/workflows/WorkflowResultView.tsx`（ワークフロー 7 種）: `prompt-chaining`（各ステップの結果。失敗したステップ名と検証エラー）、`routing`（分類・理由・`matched`）、`model-routing`（`tier`・モデル名・トークン使用量・`distinct` が偽のときの注記）、`parallel-sectioning`（区画ごとの結果）、`parallel-voting`（票の内訳と、同数のとき「同数」と表示し結論を示さない）、`orchestrator-workers`（サブタスク一覧と失敗したワーカー）、`evaluator-optimizer`（反復ごとのスコアとフィードバックの履歴、`passed: false` の明示）を、`name` ごとの判別可能な union で描画する + `WorkflowResultView.test.tsx` に、各種類の表示、同数の表示、未合格の明示、失敗の表示、`distinct: false` の注記を先に足す
  _Boundary:_ `apps/web/components/workflows/WorkflowResultView.tsx`, `apps/web/components/workflows/WorkflowResultView.test.tsx`
  _Depends:_ 16.8
  _Requirements:_ 3.2, 3.3, 3.6, 3.7, 3.9, 3.10, 3.12
  _Traces:_ REQ-003, C14
- [x] 21.2 `WorkflowResultView.tsx`（パターン 7 種）: `passive-goal-creator`（目標仕様と不足項目・確認用の質問）、`prompt-response-optimizer`（改善前後と理由）、`single-path-plan`（ステップごとの結果）、`multi-path-plan`（全候補の評価と選ばれた計画・理由）、`self-reflection`/`cross-reflection`（反復ごとの批評と修正、生成側と批評側のモデル ID）、`role-based-cooperation`（役割ごとの出力と、`stopped` — 共有予算の枯渇など — の表示）を足す + `WorkflowResultView.test.tsx` に、各種類の表示、不足項目の表示、予算枯渇の表示を先に足す
  _Boundary:_ `apps/web/components/workflows/WorkflowResultView.tsx`, `apps/web/components/workflows/WorkflowResultView.test.tsx`
  _Depends:_ 21.1, 17.7
  _Requirements:_ 4.2, 4.3, 4.4, 4.5, 4.6, 4.7
  _Traces:_ REQ-004, C14
- [x] 21.3 `components/workflows/WorkflowPanel.tsx`: パターンの選択（`kind` と `name`。名前ごとに、`mock` のシナリオに対応する入力例を提示する）、入力（1〜4000 文字）、`options` の入力（上限を超える値を送らない）、実行、中断（`AbortController`）、エラー表示（`code` と日本語メッセージ）、結果の表示（`WorkflowResultView`）を組み立てる。フェッチは `/api/workflows` へ + `WorkflowPanel.test.tsx` に、選択の切り替えで入力例が変わる、実行中の二重送信の防止、中断、エラーの表示、`options` の上限の検査を先に足す
  _Boundary:_ `apps/web/components/workflows/WorkflowPanel.tsx`, `apps/web/components/workflows/WorkflowPanel.test.tsx`
  _Depends:_ 21.2, 19.1
  _Requirements:_ 3.1, 4.1
  _Traces:_ REQ-003, REQ-004, C14

### Implementation Notes

- The result shapes are the ai-core types themselves (`import type` from `/workflows` and `/patterns`), so a change to a result type fails `tsc` here; the JSON is cast, as in M1, because it comes from our own route. `WorkflowPanel` takes `names`, `samples` and `limits` as props: 22.2 must build them from `WORKFLOW_DEMO_NAMES` / `PATTERN_DEMO_NAMES`, `M2_3_SAMPLE_TASKS` / `M2_4_SAMPLE_TASKS` (exported from `@platform/ai-core/mock`) and `DEFAULT_WORKFLOW_LIMITS`, so the screen cannot drift from the server.
- Option parsing duplicates the server's limits on purpose (a request the server would refuse is never sent); `Number.isFinite` and an in-flight ref guard were removed as redundant (NaN fails the range comparison; a discrete React event re-renders before the next submit), which PROVE had shown to be equivalent mutants.
- `role="group"` on a plain `<div>` is rejected by Biome (`useSemanticElements`); a labelled `<section>` (role region) is the replacement, and `getByLabelText` also matches `aria-label`, so a label like "入力例" collides with a field labelled "入力" unless the query is exact.

---

## 22. ページ（C14）

`/rag` と `/workflows` のページを作り、ホームのモジュール一覧にリンクを足す。ページ自体は単独のユニットテストを持たず、E2E（23）で検証する。

_Boundary:_ `apps/web/app/rag/page.tsx`, `apps/web/app/workflows/page.tsx`, `apps/web/app/page.tsx`
_Depends:_ 20.4, 21.3
_Requirements:_ 1.5, 2.7, 3.1, 4.1
_Traces:_ REQ-001, REQ-002, REQ-003, REQ-004, C14

- [x] 22.1 `app/rag/page.tsx`: `/rag` のページ。モデル一覧と知識ベースの状態をサーバーで取得して `RagPanel`・`IngestPanel` に渡す。`mock` のサーバーの再起動で PGlite のナレッジベースが消えたときは、空の状態を示して「取り込みが必要」と案内する
  _Boundary:_ `apps/web/app/rag/page.tsx`
  _Depends:_ 20.4
  _Requirements:_ 1.5, 2.7
  _Traces:_ REQ-001, REQ-002, C14
  _Verify:_ `mise run typecheck` と `next build` が成功する。ページの挙動は 23.2・23.3 の E2E で検証する（ページ自体は単独のユニットテストを持たない）
- [x] 22.2 `app/workflows/page.tsx`（`WorkflowPanel` を置く）と `app/page.tsx`（モジュール一覧に RAG とワークフローへのリンクを足す。既存のリンクの並びと見出し構造を保つ）
  _Boundary:_ `apps/web/app/workflows/page.tsx`, `apps/web/app/page.tsx`
  _Depends:_ 21.3
  _Requirements:_ 3.1, 4.1
  _Traces:_ REQ-003, REQ-004, C14
  _Verify:_ `mise run typecheck` と `next build` が成功する。ホームの既存のテストと E2E が壊れていない。ページの挙動は 23.2・23.3 の E2E で検証する

### Implementation Notes

- There is no `mise run build` task: `mise run check:client-bundle` runs `next build` itself (and then scans), so 23.4's "build, then check:client-bundle" is one command. `/rag` is dynamic (`force-dynamic`); `/workflows` prerenders as static because its props are constants.
- `/rag` reads the knowledge-base state through the `GET` handler of `/api/rag/knowledge` (imported, not fetched), so the page and the API cannot disagree, and a 503 becomes an alert instead of a crashed page. `layout.tsx` (the header nav) is outside the plan's file list and was not touched: the two screens are reachable from the home module list only; adding header links is a follow-up for the human to approve.

---

## 23. E2E と W5 の締め（C14、C13）

Route Handler から生成した固定の SSE fixture で画面を検証し、実サーバー（`mock`、PGlite）で 2 画面が起動することを回帰として守る。

_Boundary:_ `scripts/e2e/generate-sse-fixtures.mjs`, `apps/web/e2e/support/mock-api.ts`, `apps/web/e2e/fixtures/rag-query.sse`, `apps/web/e2e/fixtures/rag-query-no-evidence.sse`, `apps/web/e2e/fixtures/workflows-evaluator-optimizer.json`, `apps/web/e2e/rag.spec.ts`, `apps/web/e2e/workflows.spec.ts`, `apps/web/e2e/real-server.spec.ts`, `apps/web/e2e/a11y.spec.ts`, `apps/web/e2e/keyboard.spec.ts`
_Depends:_ 9.2, 15.3, 19.1, 19.2, 22.1, 22.2
_Requirements:_ 1.4, 1.5, 1.9, 1.10, 2.7, 2.8, 2.11, 3.9, 4.1
_Traces:_ REQ-001, REQ-002, REQ-003, REQ-004, C14

- [x] 23.1 SSE fixture の生成: `scripts/e2e/generate-sse-fixtures.mjs` に、`/api/rag/query` の通常の回答（`rag-query.sse`: 段階・中間結果・脚注付きの本文・引用）、該当なし（`rag-query-no-evidence.sse`）、`/api/workflows` の Evaluator-Optimizer（`workflows-evaluator-optimizer.json`）の生成を足し、Route Handler の実際の出力から作る（手書きしない）。`e2e/support/mock-api.ts` に新しいエンドポイント（`/api/rag/knowledge`、`/api/rag/ingest`、`/api/rag/query`、`/api/rag/agent`、`/api/workflows`）の差し替えを足す + 既存の fixture の鮮度検査（M1 の仕組み）が新しい fixture にも効くことを先に確かめる
  _Boundary:_ `scripts/e2e/generate-sse-fixtures.mjs`, `apps/web/e2e/support/mock-api.ts`, `apps/web/e2e/fixtures/rag-query.sse`, `apps/web/e2e/fixtures/rag-query-no-evidence.sse`, `apps/web/e2e/fixtures/workflows-evaluator-optimizer.json`
  _Depends:_ 15.3, 19.1
  _Requirements:_ 1.4, 1.5, 2.8, 2.11
  _Traces:_ REQ-001, REQ-002, C14
  _Verify:_ fixture の生成を再実行して差分が出ない（決定論）。Route Handler の出力を変えると生成物が変わり、鮮度の検査が失敗する
- [x] 23.2 (P) `e2e/rag.spec.ts`・`workflows.spec.ts`: 取り込み → 質問 → 段階の表示 → 脚注と引用カードの対応付け（クリック・キーボードの両方）、該当なしの表示、Agentic モード（検索したか）、リセットの確認ダイアログ（既定でキャンセル）、停止ボタンを、生成した SSE fixture で検証する。`workflows.spec.ts` は Evaluator-Optimizer を代表に、履歴（反復ごとのスコアとフィードバック）と未合格の明示の表示を検証する
  _Boundary:_ `apps/web/e2e/rag.spec.ts`, `apps/web/e2e/workflows.spec.ts`
  _Depends:_ 22.1, 22.2, 23.1
  _Requirements:_ 1.4, 1.5, 1.9, 1.10, 2.8, 2.11, 3.9
  _Traces:_ REQ-001, REQ-002, REQ-003, C14
- [x] 23.3 (P) `e2e/real-server.spec.ts`・`a11y.spec.ts`・`keyboard.spec.ts`: 実サーバー（`mock`、PGlite）で `/rag`・`/workflows` が 200・スタイル適用・ブラウザエラー 0 であることと、評価コーパスの取り込み → 質問が通ること（リスク R-1 の回帰）を足す。新しい 2 画面の axe（light / dark）とキーボード操作（フォーカス指示子が見えること、ダイアログの Esc、引用への移動）を足す
  _Boundary:_ `apps/web/e2e/real-server.spec.ts`, `apps/web/e2e/a11y.spec.ts`, `apps/web/e2e/keyboard.spec.ts`
  _Depends:_ 22.1, 22.2, 23.1, 9.2
  _Requirements:_ 1.4, 2.7, 4.1
  _Traces:_ REQ-001, REQ-002, REQ-004, C14
- [x] 23.4 **W5 の締め**: `mise run gate` と `mise run test:e2e`（3 エンジン）、`mise run build` 後の `mise run check:client-bundle` がすべて成功することを確かめ、それぞれの所要時間を Implementation Notes に記録する。E2E の不具合が見つかった場合は、`e2e/` の該当ファイルだけを直す（実装側の不具合は該当する波のタスクに戻す）。WCAG 2.2 AA（axe の違反 0）を確認する
  _Boundary:_ `apps/web/e2e/rag.spec.ts`, `apps/web/e2e/workflows.spec.ts`, `apps/web/e2e/real-server.spec.ts`, `apps/web/e2e/a11y.spec.ts`, `apps/web/e2e/keyboard.spec.ts`
  _Depends:_ 23.2, 23.3, 19.2
  _Requirements:_ 2.11
  _Traces:_ REQ-002, C14
  _Verify:_ `mise run gate`、`mise run test:e2e`（3 エンジン、skipped 0）、`mise run check:client-bundle` が成功する。所要時間を記録する 波の敵対的レビュー（憲章 原則 9。新規コンテキストで `sdd-reviewer`）を行い、記録 `.sdd/reviews/002-rag-and-workflows-impl-w5-review-YYYY-MM-DD.md` が存在し、指摘への対応が追記されていることを確かめる（波の移行条件 3）

### Implementation Notes

- **The real server found what Vitest could not**: the `/rag` Server Component ran PGlite in the SSR chunk layer and failed with "Extension bundle not found" (the Route Handlers had worked). `serverExternalPackages` now lists `@electric-sql/pglite` and `@electric-sql/pglite-pgvector` (research I-10 has the evidence). This corrects the W2 note "最小の集合は空" and the plan's `postgres` / `unpdf` entries (neither runs outside Route Handlers, so neither was added).
- Boundary amendments, approved by the review of this wave: the three route tests (`/api/rag/query`, `/api/rag/agent`, `/api/workflows`) and `scripts/e2e/generate-sse-fixtures.test.mjs` (fixture generation lives in the route tests; the generator now accepts `.json`), two extra fixtures `rag-agent-search.sse` / `rag-agent-no-search.sse` (23.2's Agentic cases need a real stream, not an invented one), `jsonReply` in `support/mock-api.ts`, `components/chat/ErrorBanner.tsx` (now shows the error `code`, as 20.4 / 21.3 demand), and `next.config.ts`.
- Next.js keeps an empty `role="alert"` route announcer on every page, so specs filter alerts by text. Buttons carry `transition-colors`: a focus-contrast reading right after the theme flip was a mid-transition colour (1.81:1, 1 run in 4), so `readFocusIndicator` waits for finite animations first. Timings: `mise run gate` 31 s (cold, `TURBO_FORCE=true`), `mise run test:e2e` 2.0 min for 363 tests on 3 engines (skipped 0), `mise run check:client-bundle` 47 s fresh.
