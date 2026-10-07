# agentic-ai-platform — Discovery & Research Log

`/sdd-plan` で作成。設計判断の根拠となる調査、決定、リスクを記録する。日付と根拠を付ける（調査日: 2026-09-27）。同日の plan レビュー（`.sdd/reviews/001-agentic-ai-platform-plan-review-2026-09-27.md`）を受けて ADR-5、ADR-6 を改訂した。

> 注: 下の Discovery type の「コンストィテューション未作成」は調査時点の状態。constitution v1.0.0 はその後に制定され、plan.md の Constitution Compliance で原則 1〜11 に対して検査した。

## Discovery type

New feature（greenfield、full discovery）。リポジトリにはソースコードがなく、ステアリング（`.sdd/steering/`）とコンストィテューション（`.sdd/memory/constitution.md`）も未作成。既存パターンの参照元は、spec の Related Repositories に挙げたローカルの2リポジトリ（`next-agentic-stack`、`vaz-agentic-ai-next`）とする。

## Investigations

調査環境の制約: 本セッションでは WebSearch ツールが使えなかった（API エラー `web_search_20250305 not supported`）。そのため、根拠は (1) ローカルの参照リポジトリにインストール済みのパッケージ（`node_modules/*/package.json` と `.d.ts`）、(2) Context7 の ai-sdk.dev ドキュメント、(3) WebFetch による npm レジストリ・公式ドキュメント・GitHub の直接取得、に限った。検証できなかった項目は [Risks & open questions](#risks--open-questions) に挙げる。

### I-1: AI SDK v7 のバージョンと改名

- **Question**: ドラフトのコード例（`parameters`、`maxSteps`、`generateObject`、`toDataStreamResponse()`、`system`）は v7 でどう変わったか。
- **Findings**: `ai@7.0.113` が最新系列（依存: `@ai-sdk/provider@4.0.18`、`@ai-sdk/provider-utils@5.0.x`）。v7 の主な変更点:
  - `stepCountIs` → `isStepCount`（旧名は別名として残る）。`system` → `instructions`、`onFinish` → `onEnd`、`onStepFinish` → `onStepEnd`、`experimental_telemetry` → `telemetry`、`fullStream` → `stream`（旧名は非推奨の別名）。
  - `ToolCallOptions` → `ToolExecutionOptions`（別名なし）。`usage.cachedInputTokens` → `usage.inputTokenDetails.cacheReadTokens`、`usage.reasoningTokens` → `usage.outputTokenDetails.reasoningTokens`（別名なし）。
  - `experimental_output` は廃止され、`output: Output.object({ schema })` と `result.output` を使う。`generateObject` / `streamObject` は残っているが、spec の決定（Clarifications 2026-09-26 (2)）に従い使わない。
  - `streamText` 結果の `toUIMessageStreamResponse()` などは非推奨。トップレベルの `toUIMessageStream({ stream })`、`createUIMessageStreamResponse`、エージェント用の `createAgentUIStreamResponse` を使う。
  - `usage` や `content` などの結果フィールドはステップ横断で集計される（最終ステップだけの値は `finalStep`）。`prompt` / `messages` 内の system メッセージは既定で拒否される（`allowSystemInMessages`）。
  - Node.js 22 以上、ESM のみ。
- **Evidence**: `next-agentic-stack/node_modules/ai/package.json`（7.0.113）、`ai/dist/index.d.ts:1917-1933`（`StopCondition`、`isStepCount`、`isLoopFinished`）、ai-sdk.dev Migration Guide 7.0（Context7 `/websites/ai-sdk_dev`）。

### I-2: ToolLoopAgent と停止条件（Req 5、Req 6）

- **Question**: 3種の停止条件（ステップ数、累積トークン、実行時間）と停止理由をどう実装するか。
- **Findings**:
  - `new ToolLoopAgent({ model, instructions, tools, stopWhen, prepareStep, output, telemetry, toolApproval, experimental_toolApprovalSecret, onStepEnd, onEnd, ... })`。`stopWhen` の既定は `isStepCount(20)`。
  - `StopCondition = (options: { steps: StepResult[] }) => boolean | PromiseLike<boolean>`。`stopWhen` は配列を受け付け、いずれかが true で停止する（OR）。判定はステップ完了時なので、トークン・時間上限は「近似」になる（Req 6.1 の記述と一致）。
  - `agent.stream({ abortSignal, timeout, ... })` / `agent.generate(...)` は `abortSignal` を受け付ける。`createAgentUIStreamResponse({ agent, uiMessages, abortSignal, onStepEnd, messageMetadata, sendReasoning, ... })` が `Promise<Response>` を返す。
  - `TimeoutConfiguration` と `getToolTimeoutMs` が SDK にあるが、ツール単位のタイムアウトを「ツール結果として返しループを継続する」（Req 6.4）挙動は確認できなかった。そのため、ツール側のラッパで実装する（ADR-6）。
  - 参照実装 `vaz-agentic-ai-next/packages/agents/src/stop-reason.ts` は、`{ finishReason, totalUsage, steps, budget, maxSteps }` から閉じた語彙の停止理由を純粋関数で導出している。トークンは `inputTokens + outputTokens` を合算する（`totalTokens` は推論トークンを含み得るため）。
- **Evidence**: `ai/dist/index.d.ts:5237-5525`（`ToolLoopAgentSettings`、`ToolLoopAgent`）、`:5521`（`createAgentUIStreamResponse`）、`/Users/Shared/codes/vaz-agentic-ai-next/packages/agents/src/chat-agent.ts`、`stop-reason.ts`。

### I-3: ツール定義、エラー、承認（Req 5、003/004 への予約）

- **Findings**:
  - `tool({ description, inputSchema, execute, toModelOutput?, needsApproval? })`。`execute(input, options)` の `options: ToolExecutionOptions` は `toolCallId`、`messages`、`abortSignal?`、`context` を持つ。`toModelOutput` は `{ output }` を受け取る。`outputSchema` は確認できなかった（使わない）。
  - ツールの例外は `tool-error` 系のストリームパートになる。UI の tool パートの状態は `input-streaming` / `input-available` / `approval-requested` / `approval-responded` / `output-available` / `output-error` / `output-denied`。
  - 承認: ツール単位の `needsApproval` と、エージェント単位の `toolApproval`（優先）、HMAC 署名用の `experimental_toolApprovalSecret`。M1 では使わないが、004 で差し込める形を保つ。
- **Evidence**: `ai/dist/index.d.ts:2155-2260`（tool パートの `state`）、`:1304`、`:1333`（`ToolApprovalRequestOutput` / `ResponseOutput`）、`@ai-sdk/provider-utils/dist/index.d.ts:1851`（`ToolExecutionOptions`）。

### I-4: 構造化出力のストリーミングと再生成（Req 4）

- **Findings**: `Output.object({ schema, name?, description? })`。`streamText` の結果に `partialOutputStream`（`experimental_partialOutputStream` は非推奨の別名）がある。検証失敗時のエラー型は `NoObjectGeneratedError` / `NoOutputGeneratedError`。クライアントへは `createUIMessageStream({ execute({ writer }) })` の型付きデータパート（`DataUIPart`）で部分オブジェクトとメタデータを送れる。`@ai-sdk/react` の `useObject` もあるが、メタデータ（分割戦略、トークン数、キャッシュ読み出し）を同じストリームで送るため、UI メッセージストリーム + データパートを採用する（ADR-8）。
- **Evidence**: `ai/dist/index.d.ts:2972-2978`（`partialOutputStream`）、`:7433`、`:7466`（エラー型）、`:6240`（`createUIMessageStream`）、`:2133`（`DataUIPart`）、`@ai-sdk/react/dist/index.d.ts:91`（`useObject`）。

### I-5: チャット UI とモデル切り替え（Req 3）

- **Findings**:
  - `useChat({ transport: new DefaultChatTransport({ api }) })` は `messages`、`sendMessage`、`stop()`、`regenerate()`、`status`、`error` を返す（`@ai-sdk/react@4.0.116`）。
  - メッセージ単位のメタデータは `messageMetadata` コールバック（UI メッセージストリームのオプション）で送る。推論は `sendReasoning` で送信を制御する。
  - 履歴の変換: `convertToModelMessages(messages, { tools, ignoreIncompleteToolCalls, convertDataPart })` と `pruneMessages({ messages, reasoning: 'all' | 'before-last-message' | 'none', toolCalls, emptyMessages })`。プロバイダ固有メタデータの除去は SDK の単一オプションでは行えないため、UI パートのフィルタを自前で持つ（ADR-7）。
- **Evidence**: `@ai-sdk/react/dist/index.d.ts:85`（`stop`）、`ai/dist/index.d.ts:2751`、`:2758`、`:5903`、`:6457`。

### I-6: テスト用モックとミドルウェア（Req 2.4、2.13〜2.16）

- **Findings**:
  - `ai/test` が `MockLanguageModelV4`、`MockEmbeddingModelV4`、`MockProviderV4`、`mockValues` を提供する。`simulateReadableStream` は `ai` 本体から import する（`ai/test` の同名は非推奨）。
  - `LanguageModelV4StreamPart` の `type` は `stream-start`、`response-metadata`、`text-start` / `text-delta` / `text-end`、`reasoning-start` / `reasoning-delta` / `reasoning-end`、`tool-input-start` / `tool-input-delta` / `tool-input-end`、`finish`、`error`、`raw` など。カセットはこのパート列を JSON で保存し、再生時に `simulateReadableStream` で返す。
  - `wrapLanguageModel({ model, middleware })` のミドルウェアは `transformParams`、`wrapGenerate`、`wrapStream` を持つ（`LanguageModelV4Middleware`）。録画はこの層に置く。`createProviderRegistry(providers, { languageModelMiddleware })` もある。
  - 参照実装 `next-agentic-stack/tests/helpers/mockModel.ts` が `MockLanguageModelV4` + `simulateReadableStream` のファクトリを持つ。
- **Evidence**: `ai/dist/test/index.d.ts:23-300`、`@ai-sdk/provider@4.0.18/dist/index.d.ts:3043-3122`。

### I-7: プロバイダパッケージの v7 対応（Req 2.2、2.3、2.10）

- **Findings**（npm レジストリ、2026-09-27）:

| パッケージ | 版 | v7 対応 | 根拠 |
|---|---|---|---|
| `@ai-sdk/anthropic` | 4.0.65 | 対応 | `@ai-sdk/provider@4.0.18` に依存 |
| `@ai-sdk/openai` | 4.0.74 以上 | 対応 | `ai@7.0.113` の devDependency |
| `@ai-sdk/azure` | 4.0.82 | 対応 | `@ai-sdk/provider@4.0.18` に依存 |
| `@ai-sdk/google` | 4.0.79 以上 | 対応 | `ai@7.0.113` の devDependency |
| `ollama-ai-provider-v2` | 4.0.1 | 対応 | peerDependencies `ai: ^7.0.0` |
| `@ai-sdk/openai-compatible` | 3.0.57 | 対応 | Ollama の代替経路 |
| `watsonx-ai-provider` | 2.0.0 | **非対応** | peerDependencies `ai: ^6.0.0`、`@ai-sdk/provider: ^3.0.8` |
| `@ibm-cloud/watsonx-ai-provider` | — | 存在しない | レジストリが 404 |

  - Anthropic のプロンプトキャッシュは `providerOptions.anthropic.cacheControl: { type: 'ephemeral' }` をメッセージパートまたは system に付ける。読み出し量は `usage.inputTokenDetails.cacheReadTokens`、書き込み量は `cacheWriteTokens`。
- **Decision**: watsonx.ai は Req 2.10 に従い、M1 時点ではプロバイダ選択肢から除外する（ADR-4）。`mise run outdated` で `watsonx-ai-provider` の peerDependencies を検査し、`ai@^7` 対応版が出たら再評価する。

### I-8: ツールチェーンの版と TypeScript 7 の互換性

- **Findings**:
  - `next-agentic-stack` は Node 26.10.0 / pnpm 12.6.0 / `typescript@7.1.0-dev.20260923.1`（パッケージ名は `typescript`、バイナリは `tsc`）/ `next@16.4.0-canary.40` / `react@19.3.0` / Vitest 5.0.1 / Biome 2.5.14 / `@playwright/test@1.64.0-alpha-2026-09-23` で動作している。型検査は `next typegen && tsc --noEmit && tsc --noEmit -p tests` で行い、`next build` 内蔵の型検査には頼らない。
  - `vaz-agentic-ai-next` はモノレポ全体を TypeScript 6.x / Vitest 4.x に留めている（Vitest は「5.x の mock state reset が認証 spec を壊す」ため。next-auth 起因で、本 spec の M1 には該当しない）。
  - JS コンパイラ API に依存するため避けるツール: `@stryker-mutator/typescript-checker`、`ts-morph`、型情報を使う `typescript-eslint` ルール。
  - Turborepo は 2.11.4（2026-09-24）が最新安定版。リリースノートに pnpm 12 対応の明記はない。参照リポジトリはどちらも Turborepo を使わず、mise + `pnpm -r` で運用している。
  - pnpm 12 のサプライチェーン設定は `pnpm-workspace.yaml` の `minimumReleaseAge: 1440` と `allowBuilds`（パッケージごとの true/false）。
  - Vitest の `passWithNoTests` は既定で `false`（テストファイル 0 件で失敗する）。ただし「ファイルはあるが全件スキップ」は合格になるため、独自の検査が必要（ADR-10）。
- **Evidence**: `/Users/Shared/codes/next-agentic-stack/package.json`、`mise.toml`、`pnpm-workspace.yaml`、`AGENTS.md`、`/Users/Shared/codes/vaz-agentic-ai-next/AGENTS.md`、https://registry.npmjs.org/turbo/latest 、https://github.com/vercel/turborepo/releases 、https://vitest.dev/config/passwithnotests 。

### I-9: ローカル依存サービス（Req 1.8、1.12）

- **Findings**:
  - Langfuse の現行版は v4。セルフホストの Docker Compose 構成は `langfuse-web`、`langfuse-worker`、`postgres`（17）、`clickhouse`（25.12）、`redis`（7）、`minio` の6サービス。推奨リソースは 4 コア / 16 GiB メモリ / ストレージ 100 GiB。UI は 3000 番。
  - OTLP の受信は HTTP のみ（HTTP/JSON、HTTP/protobuf）で、gRPC は未対応。エンドポイントは `/api/public/otel`（トレース専用は `/api/public/otel/v1/traces`）。認証は `Authorization: Basic base64(公開キー:秘密キー)`。v4 のデータモデルでは `x-langfuse-ingestion-version: 4` の付与が推奨される。
  - PGlite の pgvector 拡張は別パッケージ `@electric-sql/pglite-pgvector`（`extensions: { vector }` + `CREATE EXTENSION vector`）。PGlite 本体は 0.5.8。M1 には DB を使う機能がないため、品質ゲートの規約（Req 1.12）だけを定め、採用は 002 で確定する。
- **Evidence**: https://langfuse.com/self-hosting/deployment/docker-compose 、https://raw.githubusercontent.com/langfuse/langfuse/main/docker-compose.yml 、https://langfuse.com/integrations/native/opentelemetry 、https://pglite.dev/extensions/ 。

### I-10: 要約パイプラインの外部依存（Req 4）

- **Findings**:
  - 本文抽出: `@mozilla/readability@0.6.0`（DOM 実装が必要。参照リポジトリのテストで実績のある `jsdom` と組み合わせる）。
  - YouTube 字幕: `youtubei.js@18.1.0`（活発に更新されている。`stable-v1` タグは 1.4.5）、`youtube-transcript@1.3.1`（小規模）。どちらも非公式 API に依存するため、`TranscriptSource` ポートの背後に置き、差し替え可能にする（ADR-9）。
  - トークン数の見積もり: `gpt-tokenizer@4.0.0`。Ollama にはトークン数 API がないため、全プロバイダで同じ方法を使えるローカル推定を採用し、安全係数を掛ける（ADR-9）。
- **Evidence**: npm レジストリ（`@mozilla/readability`、`youtubei.js`、`youtube-transcript`、`gpt-tokenizer`）。

### I-11: Web 検索ツールの提供元（Req 5.3）

- **Findings**: `@tavily/core@0.7.13`（2026-09-18 公開）は活発に更新されている。一方、公式の AI SDK アダプタ `@tavily/ai-sdk@0.5.0` の peerDependencies は `ai: ^5.0.0 || ^6.0.0` で、v7 に対応していない。
- **Decision**: Tavily を採用し、`@tavily/core` を自前の `tool()` 定義でラップする（アダプタは使わない）。
- **Evidence**: https://registry.npmjs.org/@tavily/ai-sdk/latest 、https://registry.npmjs.org/@tavily/core/latest 。

### I-12: 品質ゲートの補助ツール（Req 1.7、1.15〜1.19）

- **Findings**:
  - シークレットスキャン: `gitleaks@8.30.1`。`gitleaks git --redact`（全履歴。CI では `fetch-depth: 0`）と `gitleaks git --staged --redact`（コミット前）。`gitleaks dir` はビルド成果物を走査するため使わない（参照リポジトリの実測: dir 265 件、git 242 件）。
  - フック: 参照リポジトリは lefthook / husky を使わず、`.githooks/` + `git config core.hooksPath` で運用している。
  - 依存監査: `pnpm audit --audit-level=moderate`（参照リポジトリで 2026-09 に稼働実績あり）。
  - ミューテーションテスト: `@stryker-mutator/core@10.0.0` + `@stryker-mutator/vitest-runner@10.0.0`（peerDependencies `vitest >=2.0.0`、Node 22 以上）。`typescript-checker` プラグインは TypeScript 7 と非互換のため使わない。
  - アクセシビリティ: `@axe-core/playwright@^4.13.0`（`vaz-agentic-ai-next` で稼働）。
  - E2E の既知の問題: pnpm 12 では `pnpm start` が `next-server` に終了シグナルを転送せず、Playwright が終了しない。`pnpm exec playwright test` から起動する。
  - Dependabot は Playwright の alpha 版の版文字列を誤って順序付けし、ダウングレード PR を出す。`@playwright/test` は Dependabot の対象から外し、`mise run outdated` で確認する。
- **Evidence**: `/Users/Shared/codes/vaz-agentic-ai-next/mise.toml`、`.github/workflows/tests.yml`、`next-agentic-stack/.github/dependabot.yml`、`AGENTS.md`、npm レジストリ（`@stryker-mutator/*`）。

### I-13: UI 基盤

- **Findings**: `shadcn@4.21.0`（CLI）、`ai-elements@1.9.0`（shadcn/ui 上のレジストリ。ソースをプロジェクトへコピーする方式）。参照リポジトリはどちらも shadcn/ui を使っていない（Carbon と CSS Modules）。`ai-elements` の AI SDK v7 対応は確認できなかった。
- **Decision**: UI の基本部品は shadcn/ui（Tailwind CSS v4）とする。チャット、推論、ツール表示の部品は、教材としてコードを読ませるために自前で実装する。`ai-elements` は参考実装として解説で紹介するに留める（ADR-11）。
- **Evidence**: https://registry.npmjs.org/shadcn/latest 、https://registry.npmjs.org/ai-elements/latest 。
- **追記（2026-09-27、`/sdd-analyze` C-2。2026-09-28 実測で更新）**: shadcn 4.21.0 の生成コード（`button.tsx` は `class-variance-authority` と `radix-ui` の `Slot` を import する）と手動インストール手順（`tw-animate-css`、`lucide` のアイコン）から、生成した部品の実行時依存を確認した。`apps/web` のコンポーネントテストは、Next.js の Vitest ガイド（`vitest`、`@vitejs/plugin-react`、`jsdom`、`@testing-library/react`、`@testing-library/dom`）に従う。パス別名は、実装時の Vite 8.3.1 が `vite-tsconfig-paths` を非推奨として native `resolve.tsconfigPaths` を案内することを実測したため、そちらを採用する。どちらも [External dependencies](#external-dependencies) に宣言した（constitution 原則 8、10）。Evidence: Context7 `/shadcn-ui/ui/shadcn_4.21.0`（`apps/v4/content/docs/installation/manual.mdx`、`registry/new-york-v4/ui/button.tsx`）、`/vercel/next.js`（`docs/01-app/02-guides/testing/vitest.mdx`）、Vitest 5 / Vite 8.3.1 config load。

### I-14: ドラフト・レビュー・後続 spec からの設計入力

- **Findings**:
  - マスターカリキュラム §3 のディレクトリ構成（確定版の [changes-from-drafts.md §5](../curriculum/changes-from-drafts.md#5-リポジトリ構成)）を採用する。M1 で作るのは `apps/web` のチャット・エージェント・要約と、`packages/ai-core` の基盤部分。`workflows/`、`agents/`、`harness/` は M2〜M4 の拡張点として予約する。
  - 後続 spec が 001 に依存する契約は11項目: モデルカタログ、実行モード・シナリオ・カセット、停止理由の型、ツールエラーの形式（003 Req 1.3）、ツールのリスク区分（003 Req 1.16）、承認機構を差し込める経路形状（004 Req 4）、テレメトリ（004 Req 5）、評価レポートが消費する実行サマリ（004 Req 3.10）、解説ドキュメントの枠組み（Req 7）、テストのタグ規約（Req 1.13）、コスト算出のための単価（NFR）。
  - ドラフトの古い API の用例（Req 7.4 の差分表の入力）は、確定版の [changes-from-drafts.md](../curriculum/changes-from-drafts.md) の §3（AI SDK の API）、§4（設定ファイル）、§7（設計の修正）に集約した。
  - Review M-2: ドラフトは 2 スペース・シングルクォートを提案しているが、参照リポジトリは両方ともタブ・ダブルクォート・行幅 100 を使っている（ADR-3）。
  - Review H-12: Langfuse のセルフホストは、学習者1人のローカル環境には重い（I-9 で 16 GiB 推奨を確認した）。
  - 7段階閉ループとモジュールの対応表は、どのドラフトにもない。解説を書く時点で新たに作る（Req 7.8）。
  - （2026-09-27 追記）ドラフトは確定版 [`specs/curriculum/`](../curriculum/README.md) に清書し、リポジトリから削除した（001 Clarifications Session 2026-09-27 (3)）。本項の調査時にはドラフトの原文を読んだ。
- **Evidence**: 設計ドラフト 5 本（調査時点。現在は削除済みで、内容は `specs/curriculum/` に清書）、`specs/001-agentic-ai-platform/review-2026-09-26.md`、`specs/00{2,3,4}-*/spec.md`。

## Existing patterns to reuse

本リポジトリにはコードがないため、参照リポジトリのパターンを移植する。移植時は本 spec の要件に合わせて変える点を併記する。

| Pattern | Location | Why reuse |
|---------|----------|-----------|
| 版の完全一致固定と `minimumReleaseAge: 1440`、`allowBuilds` | `next-agentic-stack/package.json`、`pnpm-workspace.yaml` | 本 spec と同じ先行版の組み合わせ（Node 26 / TS 7.1 / Next 16.4 canary / AI SDK 7 / Vitest 5）で動作実績がある |
| `ToolLoopAgent` + `isStepCount` + `InferAgentUIMessage` + `createAgentUIStreamResponse` | `next-agentic-stack/src/lib/ai/agent.ts`、`chat-handler.ts` | v7 の API 名で書かれた最小構成。停止条件はトークン・時間を追加する |
| 停止条件の配列（OR）と、停止理由の純粋関数による導出 | `vaz-agentic-ai-next/packages/agents/src/chat-agent.ts`、`stop-reason.ts` | Req 6.2 の閉じた語彙に置き換えて使う（`timeout`、`aborted` を追加） |
| `MockLanguageModelV4` + `simulateReadableStream` のファクトリ | `next-agentic-stack/tests/helpers/mockModel.ts` | シナリオモデル（Req 2.4 (a)）の土台 |
| `globalThis.fetch` を置き換えるネットワーク遮断 | `vaz-agentic-ai-next/tests/setup/hermetic-network.ts` | Req 2.11 の土台。Req 2.11 は名前解決も対象のため、`node:dns` と `node:net` の遮断を追加する |
| モデル ID の単一ソース（`satisfies Record<Provider, ...>`）と、カタログ外のモデル ID を検出するスクリプト | `vaz-agentic-ai-next/packages/config/src/model-allowlist.ts`、`provider.ts`、`scripts/forbid-model-ids.sh` | Req 2.17、2.18。スクリプトは bash から Node に移し、機能・単価・コンテキスト上限の項目を加える |
| リクエスト検査の順序（レート制限 → 本文サイズ → 厳格スキーマ → 件数・長さ）と `Clock` の注入 | `next-agentic-stack/src/lib/ai/chat-handler.ts`、`rate-limit.ts`、`limits.ts`、`clock.ts` | Req 3.11、5.7。レート制限は `live` のときだけ適用する |
| 注入可能な `env` 引数で Zod 検証する設定読み込み | `vaz-agentic-ai-next/packages/schemas/src/env.ts`、`next-agentic-stack/src/lib/ai/env.ts` | Req 1.9。テストで偽の env を渡せる |
| Zod を含まないクライアント共有型と、サーバー専用モジュールの分離 | `next-agentic-stack/AGENTS.md`（`providers.ts`） | Req 1.10、3.8 |
| `next typegen && tsc --noEmit` による型検査 | `next-agentic-stack/package.json#typecheck` | TypeScript 7 のもとで Next.js の型検査を通す実績のある手順 |
| ワークスペースごとの Vitest 設定とカバレッジ閾値 | `vaz-agentic-ai-next/vitest.config.ts` | ワークスペースごとのテスト環境（node / jsdom）とネットワーク遮断を分けられる。本 spec はルートの `projects` による集約を採らず、turbo がワークスペースごとに1回ずつ実行する（plan C18「テストの実行単位」） |
| Playwright の `page.route` による LLM のモックと、0 件検出のガード | `next-agentic-stack/playwright.config.ts`、`vaz-agentic-ai-next/.github/workflows/tests.yml` | Req 1.17、1.15。本 spec では WebKit を加えて3エンジンにする |
| SHA 固定の Actions、`permissions: contents: read`、独立ジョブ + 必須の集約ジョブ | `vaz-agentic-ai-next/.github/workflows/tests.yml` | Req 1.7、NFR サプライチェーン |
| `gitleaks git --redact` と `--staged`、`.githooks/` + `core.hooksPath` | 両リポジトリの `mise.toml`、`vaz-agentic-ai-next/package.json#prepare` | Req 1.18。依存が増えない |
| Dependabot のグループ化（`ai-sdk`、`prerelease-toolchain`）と `cooldown` | `next-agentic-stack/.github/dependabot.yml` | NFR サプライチェーン |
| 先行版の新しいビルドを公開日時で検査するスクリプト | `next-agentic-stack/scripts/check-updates.mjs` | Technical Constraints（`mise run outdated`） |
| `pgvector/pgvector:pg17` + healthcheck の Compose 定義 | `vaz-agentic-ai-next/docker-compose.yml` | Req 1.8 |

## External dependencies

版は 2026-09-27 時点で確認したもの。実装時は Technical Constraints に従い最新安定版（先行版はビルド公開から 24 時間以上経過したもの）を完全一致で固定し直す。

| Dependency | Version | Purpose | Verified |
|------------|---------|---------|----------|
| Node.js | 26.10 | ランタイム（`mise.toml`） | yes（参照リポジトリ） |
| pnpm | 12.6 | パッケージマネージャ | yes（参照リポジトリ） |
| typescript | 7.1.0-dev.20260926.1 | 型検査（Go ネイティブ `tsc`）。2026-09-27 に Dependabot の `prerelease-toolchain` グループで 20260923.1 から更新した（公開から24時間以上経過したビルド。5.4 で `--listFilesOnly` を実測済み） | yes（参照リポジトリ、実測） |
| turbo | 2.11.4 | ワークスペース横断のタスク実行 | partial（pnpm 12 との組み合わせは未検証） |
| next | 16.4.0-canary.40 | Web アプリ（App Router、Turbopack、`reactCompiler`、`typedRoutes`） | yes（参照リポジトリ） |
| react / react-dom | 19.3.0 | UI | yes |
| babel-plugin-react-compiler | 1.0.x | React Compiler | yes（`vaz-agentic-ai-next`） |
| ai | 7.0.113 | AI SDK Core | yes（d.ts を直接確認） |
| @ai-sdk/react | 4.0.116 | `useChat` | yes |
| @ai-sdk/anthropic | 4.0.65 | Anthropic | yes（レジストリ） |
| @ai-sdk/openai | 4.0.74 以上 | OpenAI | partial（`ai` の devDependency から推定） |
| @ai-sdk/azure | 4.0.82 | Azure OpenAI | yes（レジストリ） |
| @ai-sdk/google | 4.0.79 以上 | Google（Gemini API） | partial（同上） |
| ollama-ai-provider-v2 | 4.0.1 | Ollama（`local`） | yes（peerDependencies `ai: ^7`） |
| @ai-sdk/otel | 1.0.x | OpenTelemetry 連携（004 で使用。M1 は予約のみ） | yes（レジストリ） |
| zod | 4.6.5 | スキーマ | yes |
| @tavily/core | 0.7.13 | Web 検索（Req 5.3） | yes（レジストリ） |
| @mozilla/readability + jsdom | 0.6.0 / 30.x | 記事本文の抽出 | partial（組み合わせは未検証） |
| youtubei.js | 18.1.0 | YouTube 字幕の取得 | partial（字幕 API の形状は未検証） |
| gpt-tokenizer | 4.0.0 | トークン数の推定 | yes（レジストリ） |
| @biomejs/biome | 2.5.14 | lint / format | yes |
| vitest / @vitest/coverage-v8 | 5.0.2 | 単体テスト、カバレッジ。2026-09-27 に Dependabot の `dev-tooling` グループで 5.0.1 から更新した | yes |
| @types/node | 26.6.3 | ルートの `tooling/`・`scripts/` の TypeScript が `node:net`・`node:dns` 等の型を参照するため（Task 1.4 で追加。2026-09-27 の W1 レビュー M-9 で記録） | yes（レジストリ） |
| @playwright/test | 1.64.0-alpha-2026-09-23 | E2E（Chromium / Firefox / WebKit） | yes（WebKit は参照リポジトリで未実施） |
| @axe-core/playwright | 4.13.x | アクセシビリティ検査 | yes |
| @stryker-mutator/core + vitest-runner | 10.0.0 | ミューテーションテスト（Req 1.16） | partial（Vitest 5 との組み合わせは未検証） |
| gitleaks | 8.30.1 | シークレットスキャン（mise で導入） | yes |
| shadcn（CLI）/ Tailwind CSS | 4.21.0 / 4.x | UI の基本部品 | partial（Next 16.4 canary との組み合わせは未検証） |
| radix-ui / class-variance-authority / clsx / tailwind-merge / lucide-react | 実装時に確定 | shadcn/ui が生成する基本部品の実行時依存（アクセシブルな基本要素、バリアント、クラス結合、アイコン） | partial（shadcn 4.21.0 の生成コードと手動インストール手順で確認。版はレジストリで確定する） |
| tw-animate-css | 実装時に確定 | shadcn/ui の Tailwind v4 用アニメーション（`tailwindcss-animate` の後継） | partial（同上） |
| server-only | 実装時に確定 | `apps/web/lib/server/` をクライアントから import できないようにする（Req 1.10） | partial（Next.js 公式ドキュメント） |
| @testing-library/react / @testing-library/dom | 16.3.3 / 10.4.2 | `apps/web` のコンポーネントテスト（jsdom） | yes（2026-09-28、registry と peerDependencies を実測） |
| @vitejs/plugin-react | 6.1.1 | Vitest で TSX（Next.js の `jsx: preserve`）を変換する | yes（2026-09-28、Vite 8.3.1 と config load を実測）。`@/` は Vite 8 の native `resolve.tsconfigPaths` を使う。旧 plan の `vite-tsconfig-paths` は非保守の `tsconfck` と TypeScript 7 の未充足 peer を導入するため不採用 |
| pgvector/pgvector | pg17 | Postgres + pgvector（Docker） | yes（参照リポジトリ） |
| Langfuse | v4（web / worker / clickhouse 25.12 / redis 7 / minio） | トレース収集基盤（Docker） | yes（公式 Compose） |
| Ollama | v0.34.4（2026-09-23） | ローカル LLM | yes（GitHub Releases） |
| @electric-sql/pglite + pglite-pgvector | 0.5.8 | インプロセス DB（002 で採用を確定） | partial |
| watsonx-ai-provider | 2.0.0 | IBM watsonx.ai | **no（`ai@^6` のみ）** |

## Architecture decisions

### ADR-1: タスク実行は mise → Turborepo → pnpm workspaces の3層にする

- **Context**: AGENTS.md と Req 1.4 は、入口を `mise run gate` にすることを求める。マスターカリキュラムは Turborepo（`turbo.json`）を前提とする。参照リポジトリは Turborepo を使っておらず、pnpm 12 との組み合わせは未検証。
- **Decision**: 学習者と CI の入口は mise のタスクとする。ワークスペース横断の `lint` 以外の段（`typecheck`、`test`、`build`）は `turbo run` で依存順に実行する。Biome はリポジトリ全体を1回で走査するため、turbo を経由せずルートで実行する。
- **Alternatives**: (a) mise + `pnpm -r` のみ（参照リポジトリの方式）。実績はあるが、カリキュラムが教える Turborepo のタスクグラフとキャッシュを体験できない。(b) Nx。カリキュラムと合わない。
- **Consequences**: 実装の最初のタスクで、Turborepo 2.11 が pnpm 12 のロックファイルとワークスペースを解決できることを確認する。解決できない場合は (a) に後退し、理由を `package.json` のコメントと 1-1 の解説に記録する。

### ADR-2: TypeScript 7.1 先行版を全ワークスペースで使い、型検査は `tsc --noEmit` で行う

- **Context**: Technical Constraints。TypeScript 7 は JS コンパイラ API を持たない。
- **Decision**: ルートの `package.json` で `typescript` を完全一致で固定し、全ワークスペースで共有する。各ワークスペースは `typecheck` スクリプトを持つ（`apps/web` は `next typegen && tsc --noEmit`）。コンパイラ API に依存するツール（`typescript-eslint` の型付きルール、`ts-morph`、Stryker の `typescript-checker`）は採用しない。
- **Alternatives**: モノレポ全体を 6.x に留める（`vaz-agentic-ai-next` の方式）。先行版を採用する方針に反する。
- **Consequences**: M1 の時点で TypeScript 6.x へ後退するワークスペースはない。002 で Drizzle のコード生成などが非互換だった場合は、そのツールだけを後退させる。

### ADR-3: Biome の書式はタブ・ダブルクォート・行幅 100・セミコロンありとする

- **Context**: Req 1.6 は具体的なスタイルを設計に委ねている。ドラフトは 2 スペース・シングルクォートを提案した。参照リポジトリは2つともタブ・ダブルクォート・行幅 100 を使っている（Review M-2）。
- **Decision**: 参照リポジトリの書式に揃える。`noUnusedVariables` と `noUnusedImports` は `recommended` の既定に頼らず、明示的に `error` を指定する。`domains` で `next`、`react`、`test` の推奨ルールを有効にする。
- **Alternatives**: ドラフトの 2 スペース案。参照リポジトリからコードを移植するたびに差分が大きくなる。
- **Consequences**: AGENTS.md の「ドラフトの提案」の記述は、本 ADR の値へ更新した（2026-09-27）。実装時に採用した値が変わった場合は、再度更新する。

### ADR-4: 実行モードとモデル解決を `ai-core` のモデルゲートウェイに集約する

- **Context**: Req 2.1〜2.18。アプリケーションコードを変えずに `mock` / `local` / `live` を切り替える。モデル ID はカタログにだけ書く。
- **Decision**: `packages/ai-core/src/models/` に、型付きのモデルカタログ（`as const satisfies`）と、`resolve({ purpose, modelId? })` を公開するゲートウェイを置く。ゲートウェイは実行モードに応じて、シナリオ / カセットのモックモデル、`ollama-ai-provider-v2`、各商用プロバイダのいずれかを返す。返す前に、認証情報（Req 2.6）、Ollama への接続（Req 2.7）、機能への対応（Req 2.9）を検査する。録画用のミドルウェアは `wrapLanguageModel` で同じ場所に合成する。レート制限はリクエスト単位で Web 側の検査（RequestGuard）が行う。既定の `live` プロバイダは Anthropic とする（プロンプトキャッシュを明示的に指定する方式を Req 4.8 で教材にできるため）。watsonx.ai は、v7 対応のプロバイダ実装が出るまで、カタログの型から除外する。
- **Alternatives**: `createProviderRegistry` だけを使う方式。モード切替、事前検査、エラーメッセージの要件（2.6、2.7、2.9）を満たすには、結局ラッパが要る。レジストリはゲートウェイの内部で使う。
- **Consequences**: M2〜M4 のすべての LLM 呼び出しがゲートウェイを通る。埋め込みと評価器（Judge）のモデルも、同じカタログの「用途」で解決する。

### ADR-5: `mock` はシナリオスクリプトとカセットの2方式を1つのリゾルバで扱う

- **Context**: Req 2.4、2.13、2.14、Review C-7。
- **Decision**: シナリオは TypeScript で書く宣言的な台本（照合条件 → 応答のパート列）とする。カセットは `local` / `live` で録画した JSON ファイル（リクエストの正規化キー → `LanguageModelV4StreamPart` 列）とする。照合の方式は2つで異なる。
  1. **シナリオは述語で照合する**。`match` の条件（`lastUserTextIncludes`、`stepIndex`、`toolResultFor`、`purpose`。すべて AND）を定義順に評価し、最初に一致したターンを使う。
  2. **カセットはキーで照合する**。シナリオが一致しなかったときだけ、要求を正規化したキー（プロンプト、ツール名一覧、出力スキーマ、モデル用途の正規化 JSON を SHA-256 でハッシュ化）でカセットを探す。
  3. どちらにもなければ、キーと最も近いシナリオ ID を含む `MockFixtureMissingError` を投げる（ネットワークへはフォールバックしない）。
  
  `LanguageModelV4CallOptions` は用途もステップ番号も持たないため、`purpose` はゲートウェイがモックモデルを生成する時点で束縛する。`stepIndex` は、プロンプト内で最後の user メッセージより後にある assistant メッセージの数から導く。どちらもエージェントの内部状態に依存しないので、同じ要求には常に同じ応答が返る（NFR 決定性）。（2026-09-27 の plan レビューで、述語による照合とキーによる照合の記述が食い違っていた点を修正した）外部サービス（Web 取得、字幕、Web 検索、天気）も、ポート（インターフェース）越しに同じ方式で fixture に差し替える。
- **Alternatives**: HTTP 層（msw 等）での録画。プロバイダごとの HTTP 形式に依存し、SDK の更新に弱い。
- **Consequences**: 録画時の秘密情報の除外（Req 2.13）はミドルウェアで行う（ヘッダーは保存しない。env の秘密値と既知のキー形式を伏せ字にする）。

### ADR-6: エージェントはガード付きのファクトリで生成し、ツールは共通ラッパで定義する

- **Context**: Req 5、Req 6、003 Req 1.3、003 Req 1.16。
- **Decision**: `createGuardedAgent(options)` は、`ToolLoopAgent` に3種の停止条件（`isStepCount`、累積トークン、`Clock` による経過時間）を必ず設定し、停止理由を導出する。`defineAciTool(definition)` は `tool()` をラップして、(1) リスク区分（`read-only` / `write` / `destructive`）を必須項目とし、(2) ツール単位の時間上限を `AbortSignal` の合成で実装し、(3) 例外とタイムアウトを `ToolFailure`（回復可能 / 致命的、要約、次の修正アクション）としてツール結果に変換する。M1 のツールはすべて `read-only`。
- **実行ごとの状態**（2026-09-27 の plan レビューで追加）: `stopWhen` の条件関数は `ToolLoopAgent` の生成時に束縛されるため、開始時刻と停止条件の成立記録は実行ごとに持つ必要がある。そこで `createGuardedAgent` は**1回の実行につき1回呼ぶ**ファクトリとし、状態をインスタンスの内部に閉じる（Route Handler ではリクエストごとに生成する）。生成コストは、設定オブジェクトとクロージャを作る程度で小さい。サマリは `onStepEnd` で加算し、`onEnd`／`finish` の `messageMetadata`（正常終了）、合成した `abortSignal` の `abort` イベント（中断・タイムアウト。AI SDK v7 は中断を `onError` ではなく `abort` パートで通知する）、`onError`（ストリームエラー。settings 経由で `streamText` に渡し、AI SDK 既定の `console.error` を置き換える）、`agent.generate()` の例外のうち、最初の1つで1回だけ確定させる。`messageMetadata` の `finish` で UI へ送る（2026-10-07、T-16.3 で改訂。v7 では UI ストリームの `finish` が `onEnd` より先に届くことがあり、`ToolLoopAgentSettings` に `onAbort` / `onError` がないため。当初の「`onEnd` または `onError` の先に呼ばれた方」では、正常終了の `finish` にサマリが付かず、中断では確定しなかった。同日の W3 敵対的レビュー r1 の H3・L15 を受けて、settings の `onError` と `generate()` の経路を加えた。`AgentRunSummary.error` は閉じた `code` と固定文言だけを持つ（H2））。ツール数は 20 以下とし、超えたら生成を拒否する（constitution 原則 2）。
- **実行時間上限の強制**: `stopWhen` はステップの完了時にしか評価されないため、応答しない LLM 呼び出しには効かない。そこで `AbortSignal.any([呼び出し元のシグナル, clock.timeoutSignal(maxDurationMs)])` を合成して LLM 呼び出しとツールに渡す。中断の理由（`AbortSignal.reason`）から、`timeout` と `aborted` を区別する。
- **Alternatives**: (a) ToolLoopAgent を直接使う。停止条件の付け忘れを型で防げない。(b) エージェントを使い回し、実行コンテキストを `prepareStep` や call options から注入する。生成コストはわずかに減るが、並行実行で状態が混ざらないことをコードの規約に頼ることになり、教材としても追いにくい。
- **Consequences**: 既定値はステップ 10、累積トークン 50,000、実行時間 120 秒、ツール 1 回 15 秒とし、設定で上書きできる。根拠: M1 のサンプルツールは1問あたり2〜4回の呼び出しで完了し、ローカルの小型モデルでも 1 ステップ 10 秒程度に収まる想定。値は `local` モードの実測で見直す。

### ADR-7: モデル切り替え時の履歴変換は、UI パートの許可リストで行う

- **Context**: Req 3.3、Review H-5。`convertToModelMessages` の `ignoreIncompleteToolCalls` は、不完全なツール呼び出しを除くだけで、推論やプロバイダ固有メタデータは除かない。
- **Decision**: 送信直前に `adaptHistoryForModel(messages, target)` を適用する。履歴はクライアントが送るため、`providerMetadata`・`providerReference`・`callProviderMetadata`・`resultProviderMetadata` と `custom` パートは常に除く。推論パートは、メッセージの `metadata.modelId` がカタログにあり、その provider が切り替え先と同じで、切り替え先が推論に対応する場合だけ残す（2026-10-07、W3 敵対的レビュー r1 の M4 で改訂。クライアントが名乗る `metadata.provider` は信頼しない。サーバーが発行した metadata の署名検証は将来の拡張とする）。画像入力に非対応のモデルへは画像パートを「画像は省略されました」というテキストに置き換える。変換はサーバーで送信時にだけ行い、クライアントの表示用履歴は変えない。結果のないツール呼び出し（`input-streaming` / `input-available`）も、同じプロバイダであっても除く（プロバイダが結果のない tool-call を拒否するため。2026-10-07、T-17.2 で追記）。
- **Consequences**: 変換規則は純粋関数で、単体テストで網羅できる。同じプロバイダへの推論の再送は署名がないと効かない（Anthropic は署名のない推論を警告付きで捨てる）。

### ADR-8: 要約は UI メッセージストリームのデータパートで逐次配信する

- **Context**: Req 4.3〜4.5、4.12。
- **Decision**: `/api/summarize` は `createUIMessageStream` を使い、`partialOutputStream` の部分オブジェクトを `data-summary` パートとして、戦略・トークン数・キャッシュ読み出し量・再生成回数を `data-summary-meta` パートとして送る。最終オブジェクトはスキーマ検証を通過したものだけを確定値として送る。検証に失敗したら最大2回まで再生成し、クライアントには再生成の開始を通知して表示を初期化させる。
- **Alternatives**: `useObject` と `toTextStreamResponse`。同じストリームでメタデータを送れない。

### ADR-9: 長文の分割判断は、ローカルのトークン推定とカタログのコンテキスト上限で行う

- **Context**: Req 4.6、4.12。Ollama にはトークン数 API がない。
- **Decision**: `gpt-tokenizer` で入力トークン数を推定し、安全係数 1.2 を掛ける。「推定値 + 指示文 + 出力予約（4,096）」がカタログのコンテキスト上限の 80% 以下なら全文を1回で要約し、超える場合は上限内のチャンクに分割して段階的に要約する（各チャンクの部分要約 → 統合要約。どちらも同じスキーマ）。判断結果と推定トークン数を結果に含める。
- **Consequences**: 推定はプロバイダの実際のトークナイザと一致しない。そのため安全係数を掛け、実測値（`usage.inputTokens`）もメタデータに併記する。

### ADR-10: 品質ゲートの「空振り」は各段の件数検査で防ぐ

- **Context**: Req 1.13〜1.15、Review C-7。Vitest はファイル 0 件で失敗するが、全件スキップは合格になる。
- **Decision**: Vitest の独自レポーター（`gate-reporter`）が、実行件数・スキップ件数（理由別）・未実行件数（DB 依存）を集計する。実行件数が 0 なら失敗させる。Biome、`tsc`、ドキュメント参照検査、モデル ID 検査も、走査したファイル数を出力し、0 なら失敗させる。`local` 限定のテストは `describeLocal` / `itLocal` ヘルパで書く（ファイル名は `*.local.test.ts`）。`local` が使えない場合は、理由付きでスキップする。
- **Consequences**: スキップ理由の表示は Vitest のタスクのメタデータ経由で行う。形状は実装時に Vitest 5 で確認する。

### ADR-11: UI は shadcn/ui の基本部品 + 自前のチャット部品とする

- **Context**: マスターカリキュラムは shadcn/ui を指定している。`ai-elements` の v7 対応は未確認。
- **Decision**: shadcn/ui（Tailwind CSS v4）でボタン・ダイアログなどの基本部品を生成する。メッセージ一覧、推論の折りたたみ、ツール状態、Generative UI のカードは `apps/web/components/` に自前で実装する。
- **Consequences**: アクセシビリティ（キーボード操作、コントラスト）は Radix ベースの基本部品と axe の検査で担保する。

### ADR-12: ローカル依存サービスは Compose のプロファイルで分ける

- **Context**: Req 1.8。Langfuse v4 は6サービス・16 GiB 推奨で重い（Review H-12）。
- **Decision**: `compose.yaml` に `db`（pgvector）と `trace`（Langfuse 一式）のプロファイルを定義する。`mise run services:up` は両方を起動する（Req 1.8）。`mise run services:up:db` は DB だけを起動する。Langfuse 用の Postgres は pgvector イメージの同一インスタンスに別データベースとして同居させ、メモリを抑える。必要なリソースは 1-1 の解説に明記する。
- **Consequences**: OTLP のエクスポート先は環境変数で差し替えられる。Jaeger などの軽量な代替は 004 の解説で扱う。

## Risks & open questions

- ⚠️ Turborepo 2.11 と pnpm 12 の組み合わせが未検証 — mitigation: 最初のタスクで検証する。失敗したら mise + `pnpm -r` へ後退する（ADR-1）。
- ⚠️ Vitest 5 の mock 状態リセットの挙動変更（`vaz-agentic-ai-next` で認証 spec を壊した） — mitigation: M1 は next-auth を使わない。`vi.restoreAllMocks` などの利用規約をテストヘルパに集約する。
- ⚠️ Stryker 10 と Vitest 5 / TypeScript 7 の組み合わせが未検証 — mitigation: `typescript-checker` なしで実行する。動かない場合は、手書きの「壊した制御ロジック」fixture によるテスト（Req 1.16 の代替手段）へ切り替える。（2026-10-07、T-19.3 で実測: そのままでは動かなかった。TypeScript 7 に JS API がないため `tsconfigFile` の書き換えで停止し、`@stryker-mutator/vitest-runner` 10.0.0 の `testNamePattern` が Vitest 5 の `suite > test` に一致せず全変異が生き残った（8.40%）。`tsconfigFile` の回避と `pnpm patch` のパッチで 88.80% になった。外す条件は plan C18）
- ⚠️ TypeScript 7.1 先行版（ネイティブ `tsc`）が `--listFilesOnly` を持つかは未検証 — mitigation: 5.4 で実測する。持たない場合は、`count-tsc` が tsconfig の `files`・`include`・`exclude` を `node:fs` で展開して数える（plan C20）。
- ⚠️ Playwright の WebKit エンジンは参照リポジトリで実績がない（両リポジトリとも Chromium と Firefox のみ） — mitigation: CI のマトリクスで早期に実行する。
- ⚠️ YouTube 字幕の取得は非公式 API に依存し、仕様変更で壊れやすい — mitigation: `TranscriptSource` ポートの背後に置く。`mock` では fixture を使う。取得失敗は Req 4.11 のエラーとして扱う。
- ⚠️ `watsonx-ai-provider` が `ai@^6` のみ対応 — mitigation: Req 2.10 に従い除外する。`mise run outdated` で peerDependencies を監視する。
- ⚠️ `@ai-sdk/openai` と `@ai-sdk/google` の最新版はレジストリで直接確認していない — mitigation: 依存導入時に確認する。
- ⚠️ shadcn/ui CLI と Next.js 16.4 canary / Tailwind v4 の組み合わせが未検証 — mitigation: 足場づくりのタスクで生成を確認する。
- ⚠️ 本セッションは WebSearch が使えず、一般的な Web 情報（Ollama の推奨モデル、Tavily と Exa / Brave の比較など）を検証できていない — mitigation: 実装時に Context7 と公式ドキュメントで確認し、解説に反映する。
- ❓ Ollama の既定モデル（ツール呼び出しと構造化出力に対応する小型モデル、埋め込みモデル）— to resolve in: 実装（1-1 のタスク）。カタログの `local` 既定値として `ollama.com/library` で確認する。
- ❓ `live` の各プロバイダのモデル ID と単価 — to resolve in: 実装。各プロバイダの公式ドキュメントで確認してカタログへ記載する（Req 2.17）。
- ❓ Evals の実行頻度と予算上限（spec の「設計フェーズで決定」）— to resolve in: 004 の設計。M1 には Evals の実体がないため、本 plan では決めない。
