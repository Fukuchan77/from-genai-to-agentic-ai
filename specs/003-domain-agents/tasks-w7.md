# domain-agents（Milestone 3）— 実装タスク W7: 画面と E2E（大タスク 29〜36）

未着手の波。表記規約、ID 対応表、進捗、gate への段階的な結線、共有ファイルの編集者は [tasks.md](tasks.md) を参照する。

6 つの画面（`/mcp`、`/helpdesk`、`/analysis`、`/research`、`/requirements`、`/marketing`）、ダッシュボード、Agent Inspector、プレビュー、SSE fixture の生成、
axe（light / dark）、キーボード、実サーバー E2E の拡張、トップページの導線を作る。W2〜W6 の API に依存する。画面は判断と検査を持たない（サーバーで行う）。
M1・M2 の画面の部品（shadcn/ui の基本部品、`ErrorBanner`、`useChat` の `parts` から縮約する方式）を再利用し、Tailwind v4 のテーマトークンの契約（root のコントラストテスト）を保つ。

各画面の部品タスクは互いに独立で、並列に進められる（29.x、30.x、31.x、32.x、33.x、34.x の部品タスク）。ページのタスクは同じ画面の部品の後に行う。

---

## 29. MCP 画面（`/mcp`）

チャット、サーバーの状態と読み込んだ・拒否したツール、許可リストの編集、比較の表示。

_Boundary:_ `apps/web/components/mcp/*`, `apps/web/app/mcp/page.tsx`
_Depends:_ 10.5
_Requirements:_ 1.3, 1.7, 1.10, 1.12, 1.15, 1.17
_Traces:_ REQ-001, C14

- [ ] 29.1 (P) `components/mcp/{ServerStatusList,AllowListEditor,CompareView}.tsx` + 各 `*.test.tsx`: サーバーごとの状態（`connected` / `unavailable` と理由）、読み込んだツールと拒否したツール（`write` / `destructive` / 注釈なし・説明文の形式の理由）、許可リストの編集（20 個の上限の表示）、高水準と低レベルの比較（ステップ数・トークン数・比率、失敗した側の表示）を作る。通知は `aria-live`、キーボードで操作できる。テストは `aria-live`、拒否の理由の表示、20 個の上限、キーボード操作を検査する
  _Boundary:_ `apps/web/components/mcp/ServerStatusList.tsx`, `apps/web/components/mcp/AllowListEditor.tsx`, `apps/web/components/mcp/CompareView.tsx`, `apps/web/components/mcp/ServerStatusList.test.tsx`, `apps/web/components/mcp/AllowListEditor.test.tsx`, `apps/web/components/mcp/CompareView.test.tsx`
  _Depends:_ 10.3, 10.5
  _Requirements:_ 1.7, 1.10, 1.12, 1.15, 1.17
  _Traces:_ REQ-001, C14
- [ ] 29.2 `components/mcp/McpPanel.tsx` と `app/mcp/page.tsx` + `McpPanel.test.tsx`: チャットの入力と応答、`finish` の停止理由（致命的エラーでは `error` と許可ルートのパスを含む学習者向けの文言）、思考ツールの切り替え、サーバー状態の取得と表示、入力例（`mock` のシナリオに対応する文）を作る。ページはサーバーで初期値（サーバー状態）を取得して渡す。テストは `error` の表示、思考ツールの切り替え、入力例を検査する
  _Boundary:_ `apps/web/components/mcp/McpPanel.tsx`, `apps/web/components/mcp/McpPanel.test.tsx`, `apps/web/app/mcp/page.tsx`
  _Depends:_ 29.1, 10.4
  _Requirements:_ 1.3, 1.7, 1.10
  _Traces:_ REQ-001, C14

### Implementation Notes

---

## 30. ヘルプデスク画面（`/helpdesk`）

問い合わせ、3 項目のダッシュボード（現在のタスク・完了タスク・修正された計画）、チケットの履歴。

_Boundary:_ `apps/web/components/helpdesk/*`, `apps/web/app/helpdesk/page.tsx`
_Depends:_ 15.4
_Requirements:_ 2.3, 2.4, 2.5, 2.6, 2.7
_Traces:_ REQ-002, C14

- [ ] 30.1 (P) `components/helpdesk/{PlanDashboard,TicketList}.tsx` + 各 `*.test.tsx`: 「現在のタスク」「完了タスク」「修正された計画」（変更前後の差分）、ステップ数と判断理由、チケット一覧（状態、解決の回答、未解決の理由、上限到達の `open`）を作る。状態の更新は `aria-live`。テストは 3 項目の表示、差分の表示、ステップ上限到達の未完了タスクの一覧、`aria-live` を検査する
  _Boundary:_ `apps/web/components/helpdesk/PlanDashboard.tsx`, `apps/web/components/helpdesk/TicketList.tsx`, `apps/web/components/helpdesk/PlanDashboard.test.tsx`, `apps/web/components/helpdesk/TicketList.test.tsx`
  _Depends:_ 15.4
  _Requirements:_ 2.3, 2.4, 2.5, 2.6, 2.7
  _Traces:_ REQ-002, C14
- [ ] 30.2 `components/helpdesk/HelpdeskPanel.tsx` と `app/helpdesk/page.tsx` + `HelpdeskPanel.test.tsx`: 問い合わせの入力（4000 文字の上限）、`data-helpdesk-*` の縮約、最終結果（認証情報が検出されたときは種別だけを表示し値を表示しない）、入力例を作る。ページはサーバーでチケット一覧の初期値を取得して渡す。テストは入力の上限、結果の表示、認証情報の種別表示を検査する
  _Boundary:_ `apps/web/components/helpdesk/HelpdeskPanel.tsx`, `apps/web/components/helpdesk/HelpdeskPanel.test.tsx`, `apps/web/app/helpdesk/page.tsx`
  _Depends:_ 30.1, 15.3
  _Requirements:_ 2.5, 2.6, 2.7
  _Traces:_ REQ-002, C14

### Implementation Notes

---

## 31. 分析画面（`/analysis`）

アップロード、試行履歴、画像（`alt` 付き）、表（行上限の表示）、無効化の案内。

_Boundary:_ `apps/web/components/analysis/*`, `apps/web/app/analysis/page.tsx`
_Depends:_ 19.7
_Requirements:_ 3.4, 3.5, 3.6, 3.7, 3.8, 3.9
_Traces:_ REQ-003, C14

- [ ] 31.1 (P) `components/analysis/{UploadForm,SandboxNotice,AttemptList}.tsx` + 各 `*.test.tsx`: ファイルの選択（受け入れ形式と 20 MB の表示）と指示の入力、サンドボックスが無効のときの入力の無効化と有効化の案内（`guidance`）、試行履歴（コード、標準出力、エラー、修正回数、`attempt-limit` で最後のコードとエラーの強調）を作る。テストは無効時の入力の無効化と案内、`attempt-limit` の表示、キーボード操作を検査する
  _Boundary:_ `apps/web/components/analysis/UploadForm.tsx`, `apps/web/components/analysis/SandboxNotice.tsx`, `apps/web/components/analysis/AttemptList.tsx`, `apps/web/components/analysis/UploadForm.test.tsx`, `apps/web/components/analysis/SandboxNotice.test.tsx`, `apps/web/components/analysis/AttemptList.test.tsx`
  _Depends:_ 19.5
  _Requirements:_ 3.4, 3.6, 3.8, 3.9
  _Traces:_ REQ-003, C14
- [ ] 31.2 (P) `components/analysis/{FigureView,TableView}.tsx` + 各 `*.test.tsx`: PNG の画像（`data:image/png;base64`。`alt` が空の図は描画しない。SVG や HTML は描画しない）と、素の `<table>`（キャプション、200 行までの描画と「N 件中 M 件を表示」）を作る。テストは `alt` の有無、行上限の表示、PNG 以外を描画しないことを検査する
  _Boundary:_ `apps/web/components/analysis/FigureView.tsx`, `apps/web/components/analysis/TableView.tsx`, `apps/web/components/analysis/FigureView.test.tsx`, `apps/web/components/analysis/TableView.test.tsx`
  _Depends:_ 19.4
  _Requirements:_ 3.5
  _Traces:_ REQ-003, C14, ADR-2
- [ ] 31.3 `components/analysis/AnalysisPanel.tsx` と `app/analysis/page.tsx` + `AnalysisPanel.test.tsx`: アップロード → ストリームの縮約 → 試行・図・表・結果の表示、明示的な終了操作（`DELETE /api/analysis/sessions/[id]`）、`sessionId`（クライアントが生成する UUID）、サンドボックスが作り直された旨の通知を作る。ページはサーバーでサンドボックスの選択結果を取得して渡す。テストは終了操作、再作成の通知、無効時の入力の無効化を検査する
  _Boundary:_ `apps/web/components/analysis/AnalysisPanel.tsx`, `apps/web/components/analysis/AnalysisPanel.test.tsx`, `apps/web/app/analysis/page.tsx`
  _Depends:_ 31.1, 31.2, 19.6, 19.7
  _Requirements:_ 3.5, 3.6, 3.7, 3.8
  _Traces:_ REQ-003, C14

### Implementation Notes

---

## 32. リサーチ画面（`/research`）

テーマ入力、主体別のイベント（Agent Inspector）、トークン内訳と呼び出し回数、レポートと警告。

_Boundary:_ `apps/web/components/research/*`, `apps/web/app/research/page.tsx`
_Depends:_ 23.3
_Requirements:_ 4.2, 4.5, 4.6, 4.8, 4.9, 4.10
_Traces:_ REQ-004, C14

- [ ] 32.1 (P) `components/research/{AgentInspector,UsageBreakdown,ReportView}.tsx` + 各 `*.test.tsx`: どの主体（`supervisor` / `search` / `reading` / `market`）のものかを区別したイベント（呼び出し、ツール、要約、論文サマリーカード、エラー）、役割別のトークン内訳と合計と呼び出し回数（使用量が取れない主体は `unknown`）、Markdown のレポート・警告（除去した旨）・欠落した観点を作る。テストは主体の区別表示、内訳の合計、`unknown` の表示、警告と欠落の表示を検査する
  _Boundary:_ `apps/web/components/research/AgentInspector.tsx`, `apps/web/components/research/UsageBreakdown.tsx`, `apps/web/components/research/ReportView.tsx`, `apps/web/components/research/AgentInspector.test.tsx`, `apps/web/components/research/UsageBreakdown.test.tsx`, `apps/web/components/research/ReportView.test.tsx`
  _Depends:_ 23.2
  _Requirements:_ 4.5, 4.6, 4.8, 4.9, 4.10
  _Traces:_ REQ-004, C14
- [ ] 32.2 `components/research/ResearchPanel.tsx` と `app/research/page.tsx` + `ResearchPanel.test.tsx`: テーマの入力（500 文字の上限）、呼び出し回数の上限の指定、`data-research-*` の縮約、入力例を作る。テストは入力の上限、上限回数の指定、結果の表示を検査する
  _Boundary:_ `apps/web/components/research/ResearchPanel.tsx`, `apps/web/components/research/ResearchPanel.test.tsx`, `apps/web/app/research/page.tsx`
  _Depends:_ 32.1, 23.3
  _Requirements:_ 4.2, 4.8, 4.9
  _Traces:_ REQ-004, C14

### Implementation Notes

---

## 33. 要件画面（`/requirements`）

質問と回答、要件プレビュー、判定とダウンロード。

_Boundary:_ `apps/web/components/requirements/*`, `apps/web/app/requirements/page.tsx`
_Depends:_ 27.6
_Requirements:_ 5.1, 5.2, 5.3, 5.4, 5.7
_Traces:_ REQ-005, C14

- [ ] 33.1 (P) `components/requirements/{RequirementsPreview,DocumentDownload}.tsx` + 各 `*.test.tsx`: 要件プレビュー（機能・非機能・制約・未確認事項、回答ごとの更新を `aria-live` で通知）、十分性の判定（不足項目）とダウンロードのボタン（生成前は無効、`requirements.md`）を作る。テストは回答ごとの更新、不足項目の表示、生成前の無効化を検査する
  _Boundary:_ `apps/web/components/requirements/RequirementsPreview.tsx`, `apps/web/components/requirements/DocumentDownload.tsx`, `apps/web/components/requirements/RequirementsPreview.test.tsx`, `apps/web/components/requirements/DocumentDownload.test.tsx`
  _Depends:_ 27.3
  _Requirements:_ 5.3, 5.4, 5.7
  _Traces:_ REQ-005, C14
- [ ] 33.2 `components/requirements/InterviewPanel.tsx` と `app/requirements/page.tsx` + `InterviewPanel.test.tsx`: 概要の入力（2000 文字の上限）、ペルソナと質問の表示、ペルソナ別の回答欄（1〜10 件）、ラウンドの進行、完了の表示、セッション切れ（404）時の案内を作る。テストは回答の送信、ペルソナ別の質問、セッション切れの案内を検査する
  _Boundary:_ `apps/web/components/requirements/InterviewPanel.tsx`, `apps/web/components/requirements/InterviewPanel.test.tsx`, `apps/web/app/requirements/page.tsx`
  _Depends:_ 33.1, 27.4, 27.5
  _Requirements:_ 5.1, 5.2, 5.3
  _Traces:_ REQ-005, C14

### Implementation Notes

---

## 34. マーケティング画面（`/marketing`）

文案の入力、ペルソナ名付きの発言、レコメンドとプロファイル。

_Boundary:_ `apps/web/components/marketing/*`, `apps/web/app/marketing/page.tsx`
_Depends:_ 27.8
_Requirements:_ 6.1, 6.2, 6.3, 6.4, 6.5
_Traces:_ REQ-006, C14

- [ ] 34.1 (P) `components/marketing/{CouncilTimeline,ProfileView}.tsx` + 各 `*.test.tsx`: ラウンドごと・ペルソナ名付きの発言、ラウンドごとの合意判定と終了理由、改善後の文案、プロファイル（関心事・予算・懸念点。更新を `aria-live` で通知）を作る。テストはペルソナ名の表示、ラウンドの区切りと判定、終了理由、プロファイルの更新を検査する
  _Boundary:_ `apps/web/components/marketing/CouncilTimeline.tsx`, `apps/web/components/marketing/ProfileView.tsx`, `apps/web/components/marketing/CouncilTimeline.test.tsx`, `apps/web/components/marketing/ProfileView.test.tsx`
  _Depends:_ 27.3
  _Requirements:_ 6.2, 6.3, 6.4
  _Traces:_ REQ-006, C14
- [ ] 34.2 `components/marketing/{CouncilPanel,RecommendPanel}.tsx` と `app/marketing/page.tsx` + 各 `*.test.tsx`: 文案の入力（2000 文字の上限）と参加ペルソナの選択（2〜5 件）、レコメンド用のチャットと、商品 ID・推薦理由・除去の件数の表示（Generative UI）、未投入のときの `seed:samples` の案内を作る。ページはサーバーでペルソナ定義を取得して渡す。テストは入力の上限、ペルソナの選択、除去の件数の表示、未投入の案内を検査する
  _Boundary:_ `apps/web/components/marketing/CouncilPanel.tsx`, `apps/web/components/marketing/RecommendPanel.tsx`, `apps/web/components/marketing/CouncilPanel.test.tsx`, `apps/web/components/marketing/RecommendPanel.test.tsx`, `apps/web/app/marketing/page.tsx`
  _Depends:_ 34.1, 27.7, 27.8
  _Requirements:_ 6.1, 6.3, 6.4, 6.5
  _Traces:_ REQ-006, C14

### Implementation Notes

---

## 35. トップ導線と E2E

モジュール一覧への導線、SSE fixture の生成、各画面の E2E、axe（light / dark）・キーボード・実サーバーの拡張を行う。

_Boundary:_ `apps/web/app/page.tsx`, `scripts/e2e/generate-sse-fixtures.mjs`, `apps/web/e2e/fixtures/*.sse`, `apps/web/e2e/support/mock-api.ts`, `apps/web/e2e/*.spec.ts`
_Depends:_ 29.2, 30.2, 31.3, 32.2, 33.2, 34.2
_Requirements:_ 1.3, 1.10, 2.5, 3.4, 3.5, 3.6, 3.8, 4.9, 4.10, 5.3, 5.7, 6.3, 6.4
_Traces:_ REQ-001, REQ-002, REQ-003, REQ-004, REQ-005, REQ-006, C14

- [ ] 35.1 (P) `app/page.tsx` のモジュール一覧に 6 画面へのリンクを足す + 既存のページのテスト（あれば）に、6 つのリンクの存在とラベルを先に足す
  _Boundary:_ `apps/web/app/page.tsx`
  _Depends:_ 29.2, 30.2, 31.3, 32.2, 33.2, 34.2
  _Requirements:_ 1.7
  _Traces:_ REQ-001, C14
  _Verify:_ `mise run gate` が成功し、トップから 6 画面に遷移できる（35.5 の E2E で確認）
- [ ] 35.2 `scripts/e2e/generate-sse-fixtures.mjs` と `apps/web/e2e/fixtures/{helpdesk,analysis,research,requirements,marketing-council,marketing-recommend}.sse`、`e2e/support/mock-api.ts`: 新しい Route Handler から固定応答を生成する対象を足し、新しいエンドポイントの差し替え（`/api/mcp/*`、`/api/analysis/status` など）を足す。fixture は Route Handler の実際の出力から生成し、手書きしない
  _Boundary:_ `scripts/e2e/generate-sse-fixtures.mjs`, `apps/web/e2e/fixtures/helpdesk.sse`, `apps/web/e2e/fixtures/analysis.sse`, `apps/web/e2e/fixtures/research.sse`, `apps/web/e2e/fixtures/requirements.sse`, `apps/web/e2e/fixtures/marketing-council.sse`, `apps/web/e2e/fixtures/marketing-recommend.sse`, `apps/web/e2e/support/mock-api.ts`
  _Depends:_ 15.3, 19.6, 23.3, 27.5, 27.7, 27.8
  _Requirements:_ 2.5, 3.5, 4.9, 5.3, 6.3, 6.4
  _Traces:_ REQ-002, REQ-003, REQ-004, REQ-005, REQ-006, C14
  _Verify:_ 生成を 2 回実行しても差分が出ない（決定論）。`mise run gate` が成功する
- [ ] 35.3 (P) `e2e/{mcp,helpdesk,analysis}.spec.ts`: MCP（サーバー状態の表示、拒否したツールの理由、致命的エラーの `error` の表示、通知）、ヘルプデスク（ダッシュボードの 3 項目、修正された計画、チケットの状態）、分析（試行履歴、`alt` 付きの画像、表の行上限、`attempt-limit`、サンドボックス無効時の案内）の主要な流れを、生成した SSE fixture で検証する
  _Boundary:_ `apps/web/e2e/mcp.spec.ts`, `apps/web/e2e/helpdesk.spec.ts`, `apps/web/e2e/analysis.spec.ts`
  _Depends:_ 35.2, 35.1
  _Requirements:_ 1.3, 1.10, 2.5, 3.4, 3.5, 3.6, 3.8
  _Traces:_ REQ-001, REQ-002, REQ-003, C14
- [ ] 35.4 (P) `e2e/{research,requirements,marketing}.spec.ts`: リサーチ（Agent Inspector の主体の区別、トークン内訳、警告と欠落）、要件（プレビューの更新、判定、ダウンロード）、マーケティング（ペルソナ名付きの発言、合意の判定、プロファイルとレコメンドの更新、除去の件数）の主要な流れを、生成した SSE fixture で検証する
  _Boundary:_ `apps/web/e2e/research.spec.ts`, `apps/web/e2e/requirements.spec.ts`, `apps/web/e2e/marketing.spec.ts`
  _Depends:_ 35.2, 35.1
  _Requirements:_ 4.9, 4.10, 5.3, 5.7, 6.3, 6.4
  _Traces:_ REQ-004, REQ-005, REQ-006, C14
- [ ] 35.5 `e2e/real-server.spec.ts`・`e2e/a11y.spec.ts`・`e2e/keyboard.spec.ts`: 6 画面が実サーバー（`mock`）で 200・スタイル適用・ブラウザエラー 0 であること、`/analysis` の `mock` 完走、`/mcp` が自作サーバーを起動することを `real-server.spec.ts` に足し、新しい 6 画面の axe（light / dark）と、入力・送信・タブ移動のキーボード操作を足す。`serverExternalPackages` に変更が要る場合は `next.config.ts` を更新する
  _Boundary:_ `apps/web/e2e/real-server.spec.ts`, `apps/web/e2e/a11y.spec.ts`, `apps/web/e2e/keyboard.spec.ts`, `apps/web/next.config.ts`
  _Depends:_ 35.3, 35.4, 23.4
  _Requirements:_ 1.7, 3.1, 3.8
  _Traces:_ REQ-001, REQ-003, C14, R-1
  _Verify:_ `mise run test:e2e`（3 エンジン）が成功し、axe の重大な違反が 0 件

### Implementation Notes

---

## 36. W7 の締め

_Boundary:_ `specs/003-domain-agents/research.md`
_Depends:_ 35.5
_Requirements:_ 2.5, 3.5
_Traces:_ REQ-002, REQ-003, C14

- [ ] 36.1 W7 の gate と E2E を実測して記録する。`mise run gate` と `mise run test:e2e`（3 エンジン）の成功を引用し、所要時間を research.md に追記する。`client-bundle`（`E2B_API_KEY`、`GITHUB_TOKEN` のセンチネルがバンドルに出ない）の成功も併記する
  _Boundary:_ `specs/003-domain-agents/research.md`
  _Depends:_ 35.5
  _Requirements:_ 2.5, 3.5
  _Traces:_ REQ-002, REQ-003, C14
  _Verify:_ `mise run gate`、`mise run test:e2e`、`mise run check:client-bundle` の成功と所要時間を research.md に記録した。W7 の敵対的レビューの記録が `.sdd/reviews/003-domain-agents-impl-w7-review-*.md` にある

### Implementation Notes
