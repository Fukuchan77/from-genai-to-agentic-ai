# agentic-ai-platform（Milestone 1）— 実装タスク（索引と現在の波）

`/sdd-tasks` が生成し、`/sdd-analyze`（2026-09-27）の指摘を反映して、実装の波（W1〜W5）ごとに分割した。
2回目の `/sdd-analyze`（2026-09-27）の H-1〜H-3、M-1〜M-4 と、3回目の H-1、M-1〜M-4、L-1〜L-3 も反映した。
ルールは `~/.claude/sdd/rules/tasks-generation.md` と `~/.claude/sdd/rules/tasks-parallel-analysis.md` に従う。
並列モード（`--sequential` 未指定）。

## ファイル構成

| ファイル | 内容 |
|---|---|
| `tasks.md`（本ファイル） | 表記規約、ID 対応表、進捗、gate と CI の段階的な結線、**現在の波**のタスク全文 |
| `tasks-w5.md` | 未着手の波のタスク全文。その波に着手するときに本ファイルへ移す |
| `tasks-comp-w1.md`〜`tasks-comp-w5.md` | 完了した波の保管先。波の完了時に作る（現在は `tasks-comp-w1.md`〜`tasks-comp-w3.md`） |
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
| W4 apps/web | 21 RequestGuard、20 AppShell、22 ChatFeature、23 ToolAgentFeature、24 SummaryFeature | 着手（現在の波） | 本ファイル |
| W5 E2E・解説・最終統合 | 25 E2E 生成・検査スクリプト、26 E2E 基盤、27 E2E シナリオ、28 解説ドキュメント、29 最終統合と NFR 検証 | 未着手 | [tasks-w5.md](tasks-w5.md) |

波の順序は依存関係で決まる。W4 は 21 を 20 より先に行う（20.1 がレート制限器を組み立てるため）。

モジュールの完成タグ（Req 7.11、plan C22）は、そのモジュールのリファレンス実装が完了した波の中で付ける:
`module/1-1` は 14.6（W3）、`module/1-2` は 23.5（W4）、`module/1-3` は 24.4（W4）。29.4 は3つのタグの検証と
push だけを行う。

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

# 現在の波: W4 apps/web（大タスク 20〜24）

順序: 21 → 20 → 22・23・24（並列）。20.1 が 21.2 のレート制限器を組み立てるため、21 を先に行う。
完成タグ `module/1-2`（23.5）は 22 と 23 の完了後に、`module/1-3`（24.4）は 24 の完了後に付ける。
W4 は gate の構成を変えない（`apps/web` のテストは 21.1 で加える `test` スクリプトにより、既存の `test` 段に入る）。

---

## 21. RequestGuard（C14）

LLM を呼ぶ前に、リクエストを安い順に検査して拒否する。`CHAT_RATE_LIMIT_*` は 1.5 の `.env.example` に含まれる。

_Boundary:_ `apps/web/package.json`, `packages/ai-core/package.json`, `apps/web/lib/server/errors.ts`, `apps/web/lib/server/errors.test.ts`, `apps/web/lib/server/guard.ts`, `apps/web/lib/server/guard.test.ts`
_Depends:_ 8, 10
_Requirements:_ 1.10, 3.11
_Traces:_ REQ-001, REQ-003, C14

- [ ] 21.1 `lib/server/errors.ts`: `PlatformError` から HTTP エラーレスポンス（`{ error: { code, message } }`）とストリームエラーへの変換 + `errors.test.ts`（`code` ごとのステータス、スタックや `details` の秘密値を応答に含めない）。`apps/web/package.json` に `test`・`test:coverage`（`vitest run --coverage.enabled --coverage.reporter=html --coverage.thresholds.lines=0`。閾値の強制は gate の `test` 段。plan C18）スクリプトを加える（apps/web の最初のテスト）。`PlatformError`・`PlatformErrorCode` は、`packages/ai-core/package.json` の `exports` に加える `"./errors": "./src/errors.ts"` から import する（plan「依存の方向」。2026-10-04 に決定）
  _Boundary:_ `apps/web/lib/server/errors.ts`, `apps/web/lib/server/errors.test.ts`, `apps/web/package.json`, `packages/ai-core/package.json`
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

_Boundary:_ `apps/web/instrumentation.ts`, `apps/web/instrumentation.test.ts`, `apps/web/app/layout.tsx`, `apps/web/app/page.tsx`, `apps/web/lib/server/platform.ts`, `apps/web/lib/server/platform.test.ts`, `apps/web/components/ui/*.tsx`, `packages/ai-core/src/summarize/index.ts`（20.1 の `isBlockedHostname` の公開のみ）
_Depends:_ 8, 10, 12, 13, 14, 15, 21
_Requirements:_ 1.9, 1.10, 2.13, 3.8, 6.4, NFR-09, NFR-12
_Traces:_ REQ-001, REQ-002, REQ-003, REQ-006, C13

- [ ] 20.1 `lib/server/platform.ts`: 設定・ゲートウェイ・ポート・Clock・レート制限器・ツールの実行時設定（`ToolRuntime`: `clock` と `AGENT_TOOL_TIMEOUT_MS` 由来の `toolTimeoutMs`）の組み立て（`server-only` を import する唯一の場所）。`mock` ではポートを 13.6 の fixture 実装に、`AI_RECORD=1`（`local`/`live`）では3つのポートを 13.4 の録画用ラッパで包む。`local`/`live` の本番の HttpFetcher は、(a) 接続時に名前を解決し、解決後の IP がループバック・プライベート・リンクローカル・メタデータ等（判定は C12 の `isBlockedHostname` を `./summarize` から公開して使う。ただし `isBlockedHostname` は WHATWG URL で正規化済みの hostname を前提とするため、resolver が返す生の IP は `` new URL(`http://${host}/`).hostname ``（`host` は IPv6 なら `[ip]`、IPv4 なら `ip`） で正規化してから渡す。生のまま渡すと `::ffff:10.0.0.1` を通し、公開 IPv6 を拒否する）なら接続せずに `SourceFetchError("disallowed-url")` を投げ（undici は `lookup` の例外を `TypeError: fetch failed` の `cause` に包むため、フェッチャーは `cause` を見て `disallowed-url` に変換し、`network` にしない）（例: undici の `Agent({ connect: { lookup } })`。解決と接続が同じ段なので DNS rebinding も防ぐ）、(b) 本文を読みながら累積バイト数を数えて `ARTICLE_FETCH_LIMITS.maxBodyBytes` を超えた時点で中断し `SourceFetchError("too-large")` を投げる（`Content-Length` が上限超なら本文を読まない）（plan C13、W3 敵対的レビュー r2 の N2・N3）+ `platform.test.ts`（`mock` の設定から各依存が組み立てられる、`AI_RECORD=1` でポートが録画用ラッパになる、`ToolRuntime` に設定値が入る、注入した resolver で公開名が `127.0.0.1`・`169.254.169.254`・`::1`・`::ffff:10.0.0.1` に解決されると接続せずに `disallowed-url`（`network` ではない）、公開 IPv6（`2606:4700::1111`）に解決される名前は通る、1回目は公開・2回目は内部の IP を返す resolver（rebinding）でも接続先は検査済みの IP だけ、上限ちょうどの本文は通り1バイト超で `too-large`、上限超の `Content-Length` では本文を読まない）
  _Boundary:_ `apps/web/lib/server/platform.ts`, `apps/web/lib/server/platform.test.ts`, `packages/ai-core/src/summarize/index.ts`（`isBlockedHostname` の公開のみ）
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
