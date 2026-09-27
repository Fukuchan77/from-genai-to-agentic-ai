# agentic-ai-platform（Milestone 1）— 実装タスク W4: apps/web（大タスク 20〜24）

未着手の波。表記規約、ID 対応表、進捗、gate と CI の段階的な結線、完了した波の移行手順は [tasks.md](tasks.md) を参照する。
W3 の完了後に、本ファイルの本文を `tasks.md` の「現在の波」へ移し、本ファイルは削除する。

順序: 21 → 20 → 22・23・24（並列）。20.1 が 21.2 のレート制限器を組み立てるため、21 を先に行う。
完成タグ `module/1-2`（23.5）は 22 と 23 の完了後に、`module/1-3`（24.4）は 24 の完了後に付ける。
W4 は gate の構成を変えない（`apps/web` のテストは 21.1 で加える `test` スクリプトにより、既存の `test` 段に入る）。

---

## 21. RequestGuard（C14）

LLM を呼ぶ前に、リクエストを安い順に検査して拒否する。`CHAT_RATE_LIMIT_*` は 1.5 の `.env.example` に含まれる。

_Boundary:_ `apps/web/package.json`, `apps/web/lib/server/errors.ts`, `apps/web/lib/server/errors.test.ts`, `apps/web/lib/server/guard.ts`, `apps/web/lib/server/guard.test.ts`
_Depends:_ 8, 10
_Requirements:_ 1.10, 3.11
_Traces:_ REQ-001, REQ-003, C14

- [ ] 21.1 `lib/server/errors.ts`: `PlatformError` から HTTP エラーレスポンス（`{ error: { code, message } }`）とストリームエラーへの変換 + `errors.test.ts`（`code` ごとのステータス、スタックや `details` の秘密値を応答に含めない）。`apps/web/package.json` に `test`・`test:coverage`（`vitest run --coverage.enabled --coverage.reporter=html`）スクリプトを加える（apps/web の最初のテスト）
  _Boundary:_ `apps/web/lib/server/errors.ts`, `apps/web/lib/server/errors.test.ts`, `apps/web/package.json`
  _Depends:_ 8
  _Requirements:_ 1.10, 3.11
  _Traces:_ REQ-001, REQ-003, C14
- [ ] 21.2 `lib/server/guard.ts`・`guard.test.ts`: `guardRequest`（本文サイズ413→`z.strictObject`400→件数・長さ・画像400→`live`のときだけレート制限429）、`createRateLimiter`（プロセス内固定窓）。検査順序、各拒否コード、`live` 以外でレート制限しないことを検証する
  _Boundary:_ `apps/web/lib/server/guard.ts`, `apps/web/lib/server/guard.test.ts`
  _Depends:_ 21.1, 10
  _Requirements:_ 3.11
  _Traces:_ REQ-003, C14

### Implementation Notes

---

## 20. AppShell と platform.ts 組み立て（C13）

日本語UIのレイアウト、起動時の設定検証、依存の組み立てを1か所で行う。

_Boundary:_ `apps/web/instrumentation.ts`, `apps/web/instrumentation.test.ts`, `apps/web/app/layout.tsx`, `apps/web/app/page.tsx`, `apps/web/lib/server/platform.ts`, `apps/web/lib/server/platform.test.ts`, `apps/web/components/ui/*.tsx`
_Depends:_ 8, 10, 12, 13, 14, 15, 21
_Requirements:_ 1.9, 1.10, 2.13, 3.8, 6.4, NFR-09, NFR-12
_Traces:_ REQ-001, REQ-002, REQ-003, REQ-006, C13

- [ ] 20.1 `lib/server/platform.ts`: 設定・ゲートウェイ・ポート・Clock・レート制限器・ツールの実行時設定（`ToolRuntime`: `clock` と `AGENT_TOOL_TIMEOUT_MS` 由来の `toolTimeoutMs`）の組み立て（`server-only` を import する唯一の場所）。`mock` ではポートを 13.6 の fixture 実装に、`AI_RECORD=1`（`local`/`live`）では3つのポートを 13.4 の録画用ラッパで包む + `platform.test.ts`（`mock` の設定から各依存が組み立てられる、`AI_RECORD=1` でポートが録画用ラッパになる、`ToolRuntime` に設定値が入る）
  _Boundary:_ `apps/web/lib/server/platform.ts`, `apps/web/lib/server/platform.test.ts`
  _Depends:_ 8, 10, 12, 13, 14, 15, 21.2
  _Requirements:_ 1.10, 2.13, 3.8, 6.4
  _Traces:_ REQ-001, REQ-002, REQ-003, REQ-006, C13
- [ ] 20.2 `instrumentation.ts#register`: `loadPlatformConfig({ features })` の呼び出しと `ConfigError` の整形出力 + `instrumentation.test.ts`（不足変数名・機能名が列挙される）
  _Boundary:_ `apps/web/instrumentation.ts`, `apps/web/instrumentation.test.ts`
  _Depends:_ 20.1
  _Requirements:_ 1.9
  _Traces:_ REQ-001, C13
- [ ] 20.3 `app/layout.tsx`（`<html lang="ja">`）・`app/page.tsx`: 日本語レイアウト、ナビゲーション（`/chat`/`/agent`/`/summarize`）、モジュール一覧と実行モードの表示
  _Boundary:_ `apps/web/app/layout.tsx`, `apps/web/app/page.tsx`
  _Depends:_ 20.1
  _Requirements:_ 3.8, NFR-12
  _Traces:_ REQ-003, C13
  _Verify:_ 27.1（実サーバーでの表示）、27.3（キーボード操作と axe 検査）で確認する
- [ ] 20.4 (P) `components/ui/*.tsx`: shadcn/ui の基本部品（button/textarea/select/dialog/card/badge/skeleton/alert。WCAG 2.2 AA のコントラストとキーボード操作）。生成物に plan 未宣言の依存が増えた場合は、先に research.md と plan を改訂する（constitution 原則 10）
  _Boundary:_ `apps/web/components/ui/*.tsx`
  _Depends:_ 8
  _Requirements:_ NFR-09
  _Traces:_ REQ-003, C13
  _Verify:_ 生成物のため単独のテストは持たない。22〜24 のコンポーネントテストと 27.3 の axe 検査で確認する

### Implementation Notes

---

## 22. ChatFeature（C15）(P)

モデル・ペルソナを切り替えられるストリーミングチャットを提供する。

_Boundary:_ `apps/web/app/chat/page.tsx`, `apps/web/app/api/chat/route.ts`, `apps/web/app/api/chat/route.test.ts`, `apps/web/components/chat/ChatPanel.tsx`, `apps/web/components/chat/MessageList.tsx`, `apps/web/components/chat/MessageList.test.tsx`, `apps/web/components/chat/ReasoningDisclosure.tsx`, `apps/web/components/chat/ModelSelector.tsx`, `apps/web/components/chat/PersonaSelector.tsx`, `apps/web/components/chat/ImageAttachButton.tsx`, `apps/web/components/chat/selectors.test.tsx`, `apps/web/components/chat/MessageMeta.tsx`, `apps/web/components/chat/MessageMeta.test.tsx`, `apps/web/components/chat/ErrorBanner.tsx`, `apps/web/components/chat/ErrorBanner.test.tsx`
_Depends:_ 14, 17, 20, 21
_Requirements:_ 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 6.3
_Traces:_ REQ-003, REQ-006, C15

- [ ] 22.1 `app/api/chat/route.ts`・`route.test.ts`: `guardRequest`→`gateway.resolve`→`adaptHistoryForModel`（切り替え先モデルに合わせた履歴の変換）→`streamText`（`request.signal` を `abortSignal` に、`sendReasoning: true`、`messageMetadata`）。`mock` でのストリーム内容・メタデータ・中断・エラー変換と、モデル切り替え後の送信で推論パートが除外されることを検証する
  _Boundary:_ `apps/web/app/api/chat/route.ts`, `apps/web/app/api/chat/route.test.ts`
  _Depends:_ 14, 17, 20, 21
  _Requirements:_ 3.1, 3.3, 3.5, 3.6, 3.8, 3.9, 3.11, 6.3
  _Traces:_ REQ-003, REQ-006, C15
- [ ] 22.2 `app/chat/page.tsx`・`components/chat/ChatPanel.tsx`（停止ボタンを含む）・`MessageList.tsx`・`ReasoningDisclosure.tsx`（+`MessageList.test.tsx`）: `useChat` + `DefaultChatTransport` による送受信、パート種別ごとの描画、推論の折りたたみ
  _Boundary:_ `apps/web/app/chat/page.tsx`, `apps/web/components/chat/ChatPanel.tsx`, `apps/web/components/chat/MessageList.tsx`, `apps/web/components/chat/ReasoningDisclosure.tsx`, `apps/web/components/chat/MessageList.test.tsx`
  _Depends:_ 22.1
  _Requirements:_ 3.1, 3.4, 3.5
  _Traces:_ REQ-003, C15
- [ ] 22.3 (P) `components/chat/ModelSelector.tsx`・`PersonaSelector.tsx`・`ImageAttachButton.tsx` + `selectors.test.tsx`: モデル一覧、ペルソナ切替、画像添付（画像入力対応モデルのときだけ有効）
  _Boundary:_ `apps/web/components/chat/ModelSelector.tsx`, `apps/web/components/chat/PersonaSelector.tsx`, `apps/web/components/chat/ImageAttachButton.tsx`, `apps/web/components/chat/selectors.test.tsx`
  _Depends:_ 22.2
  _Requirements:_ 3.2, 3.9, 3.10
  _Traces:_ REQ-003, C15
- [ ] 22.4 (P) `components/chat/MessageMeta.tsx`・`ErrorBanner.tsx` + `MessageMeta.test.tsx`・`ErrorBanner.test.tsx`: モデル名・トークン数表示、エラーと再送
  _Boundary:_ `apps/web/components/chat/MessageMeta.tsx`, `apps/web/components/chat/MessageMeta.test.tsx`, `apps/web/components/chat/ErrorBanner.tsx`, `apps/web/components/chat/ErrorBanner.test.tsx`
  _Depends:_ 22.2
  _Requirements:_ 3.6, 3.7
  _Traces:_ REQ-003, C15

### Implementation Notes

---

## 23. ToolAgentFeature（C16）(P)

`ToolLoopAgent` によるツール呼び出しの過程と結果を、型付きのUI部品として表示する。

_Boundary:_ `apps/web/app/agent/page.tsx`, `apps/web/app/api/agent/tools/route.ts`, `apps/web/app/api/agent/tools/route.test.ts`, `apps/web/components/agent/ToolAgentPanel.tsx`, `apps/web/components/agent/ToolPartView.tsx`, `apps/web/components/agent/ToolPartView.test.tsx`, `apps/web/components/agent/renderers.tsx`, `apps/web/components/agent/renderers.test.tsx`, `apps/web/components/agent/cards/TimeCard.tsx`, `apps/web/components/agent/cards/CalculationCard.tsx`, `apps/web/components/agent/cards/CurrencyCard.tsx`, `apps/web/components/agent/cards/WeatherCard.tsx`, `apps/web/components/agent/cards/SearchResultsList.tsx`, `apps/web/components/agent/RawJsonView.tsx`, `apps/web/components/agent/DisabledToolsNotice.tsx`, `apps/web/components/agent/DisabledToolsNotice.test.tsx`, `apps/web/components/agent/RunSummaryBadge.tsx`, `apps/web/components/agent/RunSummaryBadge.test.tsx`
_Depends:_ 14, 15, 16, 20, 21
_Requirements:_ 5.1, 5.4, 5.5, 5.6, 6.2, 6.3, 6.4, 7.11
_Traces:_ REQ-005, REQ-006, REQ-007, C16, C22

- [ ] 23.1 `app/api/agent/tools/route.ts`・`route.test.ts`: 20.1 の `ToolRuntime` で `buildToolSet` を呼び、リクエストごとに `createGuardedAgent({ ..., signal: request.signal })` を生成し `createAgentUIStreamResponse` へ渡す。ツールパートの順序、停止理由のメタデータ、無効化ツールの通知、リクエストごとに別の `GuardedAgent` が生成されること、`AGENT_TOOL_TIMEOUT_MS` を超えたツールがタイムアウトのツール結果になりループが続くことを検証する
  _Boundary:_ `apps/web/app/api/agent/tools/route.ts`, `apps/web/app/api/agent/tools/route.test.ts`
  _Depends:_ 14, 15, 16, 20, 21
  _Requirements:_ 5.1, 5.4, 6.2, 6.3, 6.4
  _Traces:_ REQ-005, REQ-006, C16
- [ ] 23.2 `app/agent/page.tsx`・`components/agent/ToolAgentPanel.tsx`・`ToolPartView.tsx`（+`ToolPartView.test.tsx`）: `tool-<name>` パートの `state` ごとの表示切替
  _Boundary:_ `apps/web/app/agent/page.tsx`, `apps/web/components/agent/ToolAgentPanel.tsx`, `apps/web/components/agent/ToolPartView.tsx`, `apps/web/components/agent/ToolPartView.test.tsx`
  _Depends:_ 23.1
  _Requirements:_ 5.1, 5.5
  _Traces:_ REQ-005, C16
- [ ] 23.3 (P) `components/agent/renderers.tsx`・`cards/*.tsx`・`RawJsonView.tsx` + `renderers.test.tsx`: ツール名と表示部品の対応表（`TimeCard`/`CalculationCard`/`CurrencyCard`/`WeatherCard`/`SearchResultsList`）、未登録ツール用の生JSON表示
  _Boundary:_ `apps/web/components/agent/renderers.tsx`, `apps/web/components/agent/renderers.test.tsx`, `apps/web/components/agent/cards/TimeCard.tsx`, `apps/web/components/agent/cards/CalculationCard.tsx`, `apps/web/components/agent/cards/CurrencyCard.tsx`, `apps/web/components/agent/cards/WeatherCard.tsx`, `apps/web/components/agent/cards/SearchResultsList.tsx`, `apps/web/components/agent/RawJsonView.tsx`
  _Depends:_ 23.2
  _Requirements:_ 5.5
  _Traces:_ REQ-005, C16
- [ ] 23.4 (P) `components/agent/DisabledToolsNotice.tsx`・`RunSummaryBadge.tsx` + 各テスト: 無効ツールと有効化に必要な設定の表示（サーバー由来の値のみ使用）、停止理由・ステップ数・トークン・経過時間・呼び出したツールの表示（`run` 未到達時は中断/エラー表示）
  _Boundary:_ `apps/web/components/agent/DisabledToolsNotice.tsx`, `apps/web/components/agent/DisabledToolsNotice.test.tsx`, `apps/web/components/agent/RunSummaryBadge.tsx`, `apps/web/components/agent/RunSummaryBadge.test.tsx`
  _Depends:_ 23.2
  _Requirements:_ 5.4, 5.6, 6.2, 6.3
  _Traces:_ REQ-005, REQ-006, C16
- [ ] 23.5 完成タグ `module/1-2`: モジュール 1-2（Req 3、5、6 のリファレンス実装: ChatCore、GuardedAgent、AciToolkit、ChatFeature、ToolAgentFeature）が完了した統合ブランチのコミットに、注釈付きタグをローカルで付ける（plan C22）。タグの push は 29.4 で人間の承認後に行う
  _Boundary:_ git タグのみ（ファイルの変更なし）
  _Depends:_ 14.6, 15, 16, 17, 22, 23.1, 23.2, 23.3, 23.4
  _Requirements:_ 7.11
  _Traces:_ REQ-007, C22
  _Verify:_ タグのコミットで `mise run gate` が成功し、`module/1-1` と異なるコミットを指す。タグのメッセージに、そのコミットに含まれる他モジュールの途中の実装を列挙する

### Implementation Notes

---

## 24. SummaryFeature（C17）(P)

入力（記事URL/YouTube URL/字幕テキスト）を受け取り、確定したフィールドから順にカードを描画する。

_Boundary:_ `apps/web/app/summarize/page.tsx`, `apps/web/app/api/summarize/route.ts`, `apps/web/app/api/summarize/route.test.ts`, `apps/web/components/summarize/SummaryPanel.tsx`, `apps/web/components/summarize/SummaryForm.tsx`, `apps/web/components/summarize/SummaryCard.tsx`, `apps/web/components/summarize/SummaryCard.test.tsx`, `apps/web/components/summarize/ChapterList.tsx`, `apps/web/components/summarize/ChapterList.test.tsx`, `apps/web/components/summarize/SummaryMetaPanel.tsx`, `apps/web/components/summarize/SummaryMetaPanel.test.tsx`, `apps/web/components/summarize/SourceErrorView.tsx`, `apps/web/components/summarize/SourceErrorView.test.tsx`
_Depends:_ 14, 18, 20, 21
_Requirements:_ 4.5, 4.7, 4.8, 4.10, 4.11, 4.12, 7.11
_Traces:_ REQ-004, REQ-007, C17, C22

- [ ] 24.1 `app/api/summarize/route.ts`・`route.test.ts`: `summarizeRequestSchema` で検査し、`streamSummary` を `data-summary`/`data-summary-meta`/`data-summary-restart` にマッピングする Route Handler。データパートの順序、取得失敗時にLLMを呼ばないことを検証する
  _Boundary:_ `apps/web/app/api/summarize/route.ts`, `apps/web/app/api/summarize/route.test.ts`
  _Depends:_ 14, 18, 20, 21
  _Requirements:_ 4.7, 4.11
  _Traces:_ REQ-004, C17
- [ ] 24.2 `app/summarize/page.tsx`・`components/summarize/SummaryPanel.tsx`・`SummaryForm.tsx`・`SummaryCard.tsx`（+`SummaryCard.test.tsx`）: 入力フォーム、ストリームの受信、部分オブジェクトの逐次描画（未確定フィールドはスケルトン、`restart` で暫定表示を破棄）
  _Boundary:_ `apps/web/app/summarize/page.tsx`, `apps/web/components/summarize/SummaryPanel.tsx`, `apps/web/components/summarize/SummaryForm.tsx`, `apps/web/components/summarize/SummaryCard.tsx`, `apps/web/components/summarize/SummaryCard.test.tsx`
  _Depends:_ 24.1
  _Requirements:_ 4.5
  _Traces:_ REQ-004, C17
- [ ] 24.3 `components/summarize/ChapterList.tsx`・`SummaryMetaPanel.tsx`・`SourceErrorView.tsx` + 各テスト: チャプター表示（`MM:SS`）、戦略・トークン・キャッシュ・再生成回数の表示、取得失敗理由の表示
  _Boundary:_ `apps/web/components/summarize/ChapterList.tsx`, `apps/web/components/summarize/ChapterList.test.tsx`, `apps/web/components/summarize/SummaryMetaPanel.tsx`, `apps/web/components/summarize/SummaryMetaPanel.test.tsx`, `apps/web/components/summarize/SourceErrorView.tsx`, `apps/web/components/summarize/SourceErrorView.test.tsx`
  _Depends:_ 24.2
  _Requirements:_ 4.8, 4.10, 4.11, 4.12
  _Traces:_ REQ-004, C17
- [ ] 24.4 完成タグ `module/1-3`: モジュール 1-3（Req 4 のリファレンス実装: SummaryPipeline、SummaryFeature）が完了した統合ブランチのコミットに、注釈付きタグをローカルで付ける（plan C22）。タグの push は 29.4 で人間の承認後に行う
  _Boundary:_ git タグのみ（ファイルの変更なし）
  _Depends:_ 14.6, 18, 24.1, 24.2, 24.3
  _Requirements:_ 7.11
  _Traces:_ REQ-007, C22
  _Verify:_ タグのコミットで `mise run gate` が成功する。22・23 より先に完了した場合は `module/1-2` と異なるコミットを指す。タグのメッセージに、そのコミットに含まれる他モジュールの途中の実装を列挙する

### Implementation Notes
