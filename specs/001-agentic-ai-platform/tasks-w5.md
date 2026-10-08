# agentic-ai-platform（Milestone 1）— 実装タスク W5: E2E・解説・最終統合（大タスク 25〜29）

未着手の波。表記規約、ID 対応表、進捗、gate と CI の段階的な結線、完了した波の移行手順は [tasks.md](tasks.md) を参照する。
W4 の完了後に、本ファイルの本文を `tasks.md` の「現在の波」へ移し、本ファイルは削除する。

---

## 25. E2E 生成・検査スクリプト（C19・C20 続き）

実際の Route Handler の出力から E2E fixture を生成し、ビルド済みクライアントバンドルと
Playwright 結果を検査する。

_Boundary:_ `scripts/e2e/generate-sse-fixtures.mjs`, `apps/web/app/api/chat/route.test.ts`, `apps/web/app/api/agent/tools/route.test.ts`, `apps/web/app/api/summarize/route.test.ts`, `scripts/check-client-bundle.mjs`, `scripts/check-client-bundle.test.mjs`, `scripts/gate/assert-playwright-nonempty.mjs`, `scripts/gate/assert-playwright-nonempty.test.mjs`
_Depends:_ 22, 23, 24
_Requirements:_ 1.10, 1.15, 1.17
_Traces:_ REQ-001, C19, C20

- [ ] 25.1 `scripts/e2e/generate-sse-fixtures.mjs`: `mock` モードの Route Handler を C7 のシナリオで実行した出力から `.sse` fixture を生成する（手書きしない）。先に3つの `route.test.ts` に「生成済み fixture と現在の出力が一致する」検査を加えて失敗を確認し（RED）、生成して通す（GREEN）
  _Boundary:_ `scripts/e2e/generate-sse-fixtures.mjs`, `apps/web/app/api/chat/route.test.ts`, `apps/web/app/api/agent/tools/route.test.ts`, `apps/web/app/api/summarize/route.test.ts`
  _Depends:_ 22, 23, 24
  _Requirements:_ 1.17
  _Traces:_ REQ-001, C19
- [ ] 25.2 (P) `scripts/check-client-bundle.mjs`: `next build` 後の `.next/static` に秘密情報の環境変数名と番兵値が含まれないことを検査する + `check-client-bundle.test.mjs`（fixture ディレクトリで検出・非検出・走査0件での失敗）
  _Boundary:_ `scripts/check-client-bundle.mjs`, `scripts/check-client-bundle.test.mjs`
  _Depends:_ 20
  _Requirements:_ 1.10
  _Traces:_ REQ-001, C20
- [ ] 25.3 (P) `scripts/gate/assert-playwright-nonempty.mjs`: Playwright の JSON 結果で「収集0件」「全件スキップ」を失敗にする + `assert-playwright-nonempty.test.mjs`
  _Boundary:_ `scripts/gate/assert-playwright-nonempty.mjs`, `scripts/gate/assert-playwright-nonempty.test.mjs`
  _Depends:_ 1
  _Requirements:_ 1.15, 1.17
  _Traces:_ REQ-001, C19

### Implementation Notes

---

## 26. E2E テスト基盤（C19 一部）

3エンジンでの実行環境、モックAPIのサポート、遅延計測とアクセシビリティ検査のヘルパを用意する。

_Boundary:_ `apps/web/playwright.config.ts`, `apps/web/e2e/support/mock-api.ts`, `apps/web/e2e/support/latency-probe.ts`, `apps/web/e2e/support/axe.ts`, `apps/web/e2e/fixtures/*.sse`
_Depends:_ 25
_Requirements:_ 1.17, 1.19, NFR-04, NFR-09, NFR-10
_Traces:_ REQ-001, C19

- [ ] 26.1 `playwright.config.ts`: projects（chromium/firefox/webkit）、`webServer`（`next start`、`AI_RUN_MODE=mock`）、JSON レポーター
  _Boundary:_ `apps/web/playwright.config.ts`
  _Depends:_ 25
  _Requirements:_ 1.17, NFR-10
  _Traces:_ REQ-001, C19
  _Verify:_ 27 のシナリオを3エンジンで実行し、25.3 の検査が0件・全件スキップでないことを確認する
- [ ] 26.2 `e2e/support/mock-api.ts`: `page.route("/api/**")` による fixture の返却、`e2e/fixtures/*.sse` の生成物配置
  _Boundary:_ `apps/web/e2e/support/mock-api.ts`, `apps/web/e2e/fixtures/*.sse`
  _Depends:_ 26.1
  _Requirements:_ 1.17
  _Traces:_ REQ-001, C19
  _Verify:_ 27.2 と 27.4 のシナリオで使う
- [ ] 26.3 `e2e/support/latency-probe.ts`・`axe.ts`: チャンク受信からDOM反映までの遅延計測（`MutationObserver`）と `AxeBuilder.withTags(["wcag2a","wcag2aa","wcag21aa","wcag22aa"])`
  _Boundary:_ `apps/web/e2e/support/latency-probe.ts`, `apps/web/e2e/support/axe.ts`
  _Depends:_ 26.1
  _Requirements:_ 1.19, NFR-04, NFR-09
  _Traces:_ REQ-001, C19
  _Verify:_ 27.3 と 27.4 で使う。遅延を意図的に入れた fixture で 27.4 が失敗することを1回確認する

### Implementation Notes

---

## 27. E2E シナリオテスト（C19 続き）

主要な画面操作を3エンジンで検証し、アクセシビリティとストリーミングの反映遅延を計測する。

_Boundary:_ `apps/web/e2e/real-server.spec.ts`, `apps/web/e2e/chat.spec.ts`, `apps/web/e2e/agent-tools.spec.ts`, `apps/web/e2e/summarize.spec.ts`, `apps/web/e2e/keyboard.spec.ts`, `apps/web/e2e/a11y.spec.ts`, `apps/web/e2e/latency.spec.ts`
_Depends:_ 26
_Requirements:_ 1.17, 1.19, 3.3, NFR-04, NFR-09, NFR-10
_Traces:_ REQ-001, REQ-003, C19

- [ ] 27.1 (P) `real-server.spec.ts`: `page.route` を使わず `AI_RUN_MODE=mock` の実際の Route Handler を通してチャット・ツール・要約を1往復ずつ確認する（RequestGuard、ゲートウェイ、シナリオモデルを含む結合確認）
  _Boundary:_ `apps/web/e2e/real-server.spec.ts`
  _Depends:_ 26
  _Requirements:_ 1.17, NFR-10
  _Traces:_ REQ-001, C19
- [ ] 27.2 (P) `chat.spec.ts`・`agent-tools.spec.ts`・`summarize.spec.ts`: 送信・逐次表示・モデル切替（切り替え後も会話履歴の表示が残る）・停止・エラー再送、ツール状態表示とカード描画、カードの逐次描画と取得失敗表示
  _Boundary:_ `apps/web/e2e/chat.spec.ts`, `apps/web/e2e/agent-tools.spec.ts`, `apps/web/e2e/summarize.spec.ts`
  _Depends:_ 26
  _Requirements:_ 1.17, 3.3, NFR-10
  _Traces:_ REQ-001, REQ-003, C19
- [ ] 27.3 (P) `keyboard.spec.ts`・`a11y.spec.ts`: 主要操作をキーボードだけで行えること、各画面の axe 検査（WCAG 2.2 AA）。代表的な focusable component を focus し、`getComputedStyle` の outline / ring 実効色と隣接背景のコントラストが3:1以上であることを3エンジンで検証する
  _Boundary:_ `apps/web/e2e/keyboard.spec.ts`, `apps/web/e2e/a11y.spec.ts`
  _Depends:_ 26
  _Requirements:_ 1.19, NFR-09
  _Traces:_ REQ-001, C19
- [ ] 27.4 (P) `latency.spec.ts`: 応答チャンク受信からDOM反映までが100ms以内であることを計測する
  _Boundary:_ `apps/web/e2e/latency.spec.ts`
  _Depends:_ 26
  _Requirements:_ NFR-04
  _Traces:_ REQ-001, C19

### Implementation Notes

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

- [ ] 28.1 `scripts/check-docs.mjs`・`check-docs.test.mjs`: 必須節・必須トピック見出し・チェックリストのテスト参照実在（`describe`/`it`/`test`/`describeLocal`/`itLocal` の文字列リテラルからの静的抽出）を検査し、参照0件で失敗する
  _Boundary:_ `scripts/check-docs.mjs`, `scripts/check-docs.test.mjs`
  _Depends:_ 27
  _Requirements:_ 7.6, 7.9
  _Traces:_ REQ-007, C22
- [ ] 28.2 `docs/README.md`・`docs/modules/_template.md`: 解説の読み方、実行モード・外部サービスの表記規約、チェックリストから参照するテストは固定文字列の名前にする規約、19モジュール共通テンプレート（学習目標・主要トピック・ハンズオン手順・習熟度チェックリスト・実装とテストの所在・対照表「移植で諦めたもの」列・移植時の変更点・Python/Streamlitコラム・完成タグ）
  _Boundary:_ `docs/README.md`, `docs/modules/_template.md`
  _Depends:_ 28.1
  _Requirements:_ 7.2, 7.3, 7.4, 7.5, 7.9, 7.10, 7.11, NFR-12
  _Traces:_ REQ-007, C22
- [ ] 28.3 `docs/modules/index.md`・`docs/phases/phase-1.md`: 19モジュールの一覧と状態、Phase 1 が扱う IBM 3段階成熟度モデルの水準
  _Boundary:_ `docs/modules/index.md`, `docs/phases/phase-1.md`
  _Depends:_ 28.2
  _Requirements:_ 7.1, 7.7
  _Traces:_ REQ-007, C22
- [ ] 28.4 (P) `docs/modules/1-0-intro.md`: IBM 3段階成熟度モデル、Agentic AI の7段階閉ループ、生成AIとの比較マトリクス、7段階とモジュールの対応表。必須トピック: 7段階閉ループ、「テキストの生成」から「状態の変更」へ、LLM は認知・計画エンジン
  _Boundary:_ `docs/modules/1-0-intro.md`
  _Depends:_ 28.2
  _Requirements:_ 7.2, 7.3, 7.4, 7.5, 7.8, 7.9, 7.10
  _Traces:_ REQ-007, C22
- [ ] 28.5 (P) `docs/modules/1-1-dev-environment.md`: モノレポ・品質ゲート・実行モード、Langfuse の必要リソース、watsonx.ai をスキップした理由、TypeScript 先行版の方針と後退の記録。必須トピック: Streamlit の全行再実行モデルと App Router の差分ストリーミング、Server / Client Components の境界、API キーのサーバー側実行
  _Boundary:_ `docs/modules/1-1-dev-environment.md`
  _Depends:_ 28.2
  _Requirements:_ 1.8, 2.10, 7.2, 7.3, 7.4, 7.5, 7.6, 7.9, 7.10
  _Traces:_ REQ-001, REQ-002, REQ-007, C22
- [ ] 28.6 (P) `docs/modules/1-2-ai-sdk-core-and-tools.md`: ストリーミングチャット・ToolLoopAgent・Generative UI、停止条件の近似性の注意。必須トピック: ロール設計（system / user / assistant / tool）、テンプレートによるプロンプト構築、Few-shot / CoT、推論モデルが計画に与えた影響、LangChain AgentExecutor と `ToolLoopAgent` の対比
  _Boundary:_ `docs/modules/1-2-ai-sdk-core-and-tools.md`
  _Depends:_ 28.2
  _Requirements:_ 6.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.9, 7.10
  _Traces:_ REQ-006, REQ-007, C22
- [ ] 28.7 (P) `docs/modules/1-3-structured-output-and-summaries.md`: 構造化出力・分割の境界・プロンプトキャッシュ、`mock` の埋め込みが検索精度の評価に使えないことの明記。必須トピック: Map-Reduce が不要になった理由と分割が必要な境界、プロンプトキャッシュの原理とコスト
  _Boundary:_ `docs/modules/1-3-structured-output-and-summaries.md`
  _Depends:_ 28.2
  _Requirements:_ 2.16, 7.2, 7.3, 7.4, 7.5, 7.6, 7.9, 7.10
  _Traces:_ REQ-002, REQ-007, C22

### Implementation Notes

- spec [`005-hub-alignment`](../005-hub-alignment/spec.md) が承認された場合、本タスクは次の影響を受ける（001 Clarifications Session 2026-10-04）。005 の承認後に plan C22・C20 と本タスクを改訂してから着手し、未承認の間は現行の定義のまま進める。
  - 28.2 のテンプレートと 28.4〜28.7 の各解説に「本番ではどう作るか」節を加え、[`specs/curriculum/README.md`](../curriculum/README.md)「本番実装との対応」の表が割り当てたハブの手法ページへリンクする（1-1 はハブの `CLAUDE.md` / `AGENTS.md`）。ハブの本文は転載しない（005 Req 2.2、2.5）
  - 解説内のリンク先の文字列を対応表と照合する検査を、ネットワークに接続しないリポジトリ規則として加える。走査 0 件で失敗し、解説が未作成のモジュールは一覧として出力する（005 Req 2.3、2.4）。`check:repo-rules` の規則数（現行の全9規則）と tasks.md「gate と CI の段階的な結線」の表もあわせて改訂する
  - `apps/web` のテーマトークン（大タスク 8.3 の `app/globals.css` とコントラスト検査）を、ハブが参照する元として文書化する（005 Req 3.3、3.4）

---

## 29. 品質ゲート最終統合と NFR 検証

W5 の締めとして `mise run gate` の全段と CI の全ジョブを結線し、決定性・オフライン動作・実行時間の非機能要件を
実測で確認し、W3・W4 で付けたモジュールの完成タグを検証して push する。

_Boundary:_ `mise.toml`, `vitest.config.ts`, `.github/workflows/ci.yml`
_Depends:_ 5, 13, 19, 25, 26, 27, 28
_Requirements:_ 1.4, 1.5, 1.7, 1.10, 1.11, 1.14, 1.15, 1.16, 1.17, 1.18, 7.11, NFR-01, NFR-02, NFR-03
_Traces:_ REQ-001, REQ-007, C1, C2, C22

- [ ] 29.1 W5 の締め: `mise.toml` の `gate` に `docs:check` を加え、plan C1 の全段（`lint`→`check:model-ids`→`check:repo-rules`→`typecheck`→`test`→`docs:check`）と `check:repo-rules` の全9規則がそろったことを確認し、いずれかの失敗で非ゼロ終了することを確認する。`ci.yml` に `e2e`（chromium/firefox/webkit マトリクス。`mise run test:e2e` の後に 25.3 の `assert-playwright-nonempty`）と `client-bundle`（`next build` の後に 25.2 の `check-client-bundle`。秘密情報の番兵値を注入する）を加え、`ci-status` の `needs` を plan C2 の全ジョブにする（[tasks.md](tasks.md)「gate と CI の段階的な結線」）
  _Boundary:_ `mise.toml`, `.github/workflows/ci.yml`
  _Depends:_ 5, 13, 19, 25, 26, 27, 28
  _Requirements:_ 1.4, 1.7, 1.10, 1.15, 1.17
  _Traces:_ REQ-001, C1, C2
  _Verify:_ 各段について、一時的に違反を入れて gate が非ゼロで終了することを1回ずつ確認する。追加したジョブは `actions-pinned`・`frozen-lockfile` 規則を満たす
- [ ] 29.2 `mise run gate:repeat`（同一コミットで10回実行し合否が同一）、オフライン実行（依存インストール済みでネットワーク切断時も成功）、API キーなしでの成功、5分以内の完了を実測で確認する。Ollama を止めた状態の `mise run test:local` で、`*.local.test.ts` が理由付きでスキップされることも確認する。Ollama を起動した状態では、要約（`num_ctx` 40,960）とチャット・エージェント（サーバー既定）を交互に呼んだときのモデル再読み込みの時間とメモリ量を実測する（W3 敵対的レビュー r2 の N4。大きければチャットとエージェントにも同じ `num_ctx` を渡す変更を plan C11・C8 に起票する）
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

### Implementation Notes
