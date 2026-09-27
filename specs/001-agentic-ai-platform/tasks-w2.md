# agentic-ai-platform（Milestone 1）— 実装タスク W2: ai-core の土台（大タスク 6〜13）

未着手の波。表記規約、ID 対応表、進捗、gate と CI の段階的な結線、完了した波の移行手順は [tasks.md](tasks.md) を参照する。
W1 の完了後に、本ファイルの本文を `tasks.md` の「現在の波」へ移し、本ファイルは削除する。

6.1 → 7.1 → 8.1 は、どれも `pnpm-lock.yaml` を更新するため順に行う（`(P)` を付けない）。それぞれの後続
サブタスク（6.2〜、7.2〜、8.2〜）は並列に進められる。

---

## 6. ai-core パッケージ scaffold と共通エラー型（C1）(P)

`@platform/ai-core` ワークスペースの骨格と、全独自エラーの基底クラスを用意する。

_Boundary:_ `packages/ai-core/package.json`, `packages/ai-core/tsconfig.json`, `packages/ai-core/vitest.config.ts`, `packages/ai-core/src/errors.ts`, `packages/ai-core/src/errors.test.ts`
_Depends:_ 1, 4
_Requirements:_ 1.2, NFR-05, NFR-06
_Traces:_ REQ-001, C1, C18

- [ ] 6.1 `package.json`（plan の File Structure Plan に列挙した M1 の依存をすべて宣言し、サブパス `exports` の骨格を置く。`test` スクリプトは最初のテストと同時に 6.3 で加える）、`tsconfig.json`（ベース設定の継承）
  _Boundary:_ `packages/ai-core/package.json`, `packages/ai-core/tsconfig.json`
  _Depends:_ 1
  _Requirements:_ 1.2
  _Traces:_ REQ-001, C1
  _Verify:_ `mise run setup` がロックファイルを更新して成功する。UI 依存がないことは 13.7 で gate に入る `ai-core-no-ui-deps` が検査する
- [ ] 6.2 `vitest.config.ts`（node 環境、`setup-hermetic` と `gate-reporter` の登録、`AI_TEST_SUITE` によるテストの選択、カバレッジを常に有効にした行カバレッジ80%の閾値。Stryker もこの設定を使う。plan C18）
  _Boundary:_ `packages/ai-core/vitest.config.ts`
  _Depends:_ 6.1, 4
  _Requirements:_ NFR-06
  _Traces:_ REQ-001, C18
  _Verify:_ 6.3 で `test` スクリプトを加えた後、閾値を下回る状態で `mise run test` が失敗することを1回確認する
- [ ] 6.3 `src/errors.ts`: `PlatformError` 基底クラス（`code`・日本語 `message`・`details`）と閉じた語彙の `PlatformErrorCode` + `errors.test.ts`。`packages/ai-core/package.json` に `test` スクリプトを加える（ai-core の最初のテスト）
  _Boundary:_ `packages/ai-core/src/errors.ts`, `packages/ai-core/src/errors.test.ts`, `packages/ai-core/package.json`
  _Depends:_ 6.2
  _Requirements:_ 1.2, NFR-05
  _Traces:_ REQ-001, C1

### Implementation Notes

---

## 7. eval-suite パッケージ scaffold（C21）(P)

`@platform/eval-suite` ワークスペースの骨格（評価の実体は M4）を用意する。

_Boundary:_ `packages/eval-suite/package.json`, `packages/eval-suite/tsconfig.json`, `packages/eval-suite/vitest.config.ts`, `packages/eval-suite/tests/capability/README.md`
_Depends:_ 4, 6.1
_Requirements:_ 1.1, 1.13, 1.14
_Traces:_ REQ-001, C21

- [ ] 7.1 `package.json`（`@platform/ai-core` に依存）、`tsconfig.json`。`test` スクリプトは最初のテストと同時に 19.1 で加える（テスト0件のプロジェクトで gate の `test` 段が失敗するのを防ぐ）
  _Boundary:_ `packages/eval-suite/package.json`, `packages/eval-suite/tsconfig.json`
  _Depends:_ 6.1
  _Requirements:_ 1.1
  _Traces:_ REQ-001, C21
  _Verify:_ `mise run setup` と `mise run typecheck` が成功する
- [ ] 7.2 `vitest.config.ts`（`setup-hermetic`/`global-setup-local`/`gate-reporter` の登録、`AI_TEST_SUITE` によるテストの選択。ルートからは集約しない。plan C18「テストの実行単位」）
  _Boundary:_ `packages/eval-suite/vitest.config.ts`
  _Depends:_ 7.1, 4
  _Requirements:_ 1.13, 1.14
  _Traces:_ REQ-001, C21
  _Verify:_ 19.1・19.2 のテストの実行で確認する
- [ ] 7.3 `tests/capability/README.md`: Capability / Regression の配置規約と 004 への引き継ぎ事項
  _Boundary:_ `packages/eval-suite/tests/capability/README.md`
  _Depends:_ 7.1
  _Requirements:_ 1.13
  _Traces:_ REQ-001, C21
  _Verify:_ 文書のみ。レビューで確認する

### Implementation Notes

---

## 8. apps/web ワークスペース scaffold（C13 一部）(P)

Next.js アプリのワークスペース骨格（機能ロジックは含まない）を用意する。

_Boundary:_ `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/next.config.ts`, `apps/web/vitest.config.ts`, `apps/web/components.json`, `apps/web/app/globals.css`
_Depends:_ 7.1
_Requirements:_ 1.1, NFR-09
_Traces:_ REQ-001, C13

- [ ] 8.1 `package.json`（plan の File Structure Plan の `apps/web/package.json` の行に列挙した依存・開発依存をすべて宣言する。Next.js・React・`@ai-sdk/react`・`babel-plugin-react-compiler`・`server-only`・Tailwind CSS・shadcn/ui の生成部品の実行時依存・`jsdom`・Testing Library・`@vitejs/plugin-react`・`vite-tsconfig-paths`・Playwright・axe。`typecheck`（`next typegen && tsc --noEmit`）等のスクリプト。`test` スクリプトは 21.1 で加える）、`tsconfig.json`
  _Boundary:_ `apps/web/package.json`, `apps/web/tsconfig.json`
  _Depends:_ 7.1
  _Requirements:_ 1.1
  _Traces:_ REQ-001, C13
  _Verify:_ `mise run setup` と `mise run typecheck` が成功する
- [ ] 8.2 `next.config.ts`（`reactCompiler: true`、`typedRoutes: true`、`serverExternalPackages`（jsdom 等））
  _Boundary:_ `apps/web/next.config.ts`
  _Depends:_ 8.1
  _Requirements:_ 1.1
  _Traces:_ REQ-001, C13
  _Verify:_ `mise run typecheck` が成功する。`next build` の成功は 25.2 で確認する
- [ ] 8.3 `vitest.config.ts`（jsdom 環境のコンポーネントテストと node 環境の Route Handler テストの2プロジェクト。両方に `setup-hermetic` と `gate-reporter` を登録し、`AI_TEST_SUITE` によるテストの選択（plan C18「テストの実行単位」）を適用する。`@vitejs/plugin-react`、`vite-tsconfig-paths`、`server-only` の空モジュールへの別名解決）、`components.json`（shadcn/ui 生成設定）、`app/globals.css`（Tailwind CSS v4、`tw-animate-css`、WCAG 2.2 AA のコントラスト）
  _Boundary:_ `apps/web/vitest.config.ts`, `apps/web/components.json`, `apps/web/app/globals.css`
  _Depends:_ 8.1
  _Requirements:_ 1.1, NFR-09
  _Traces:_ REQ-001, C13
  _Verify:_ Vitest の構成は 21.1 以降のテストの実行で、コントラストは 27.3 の axe 検査で確認する

### Implementation Notes

---

## 9. ModelCatalog（C5）

モデルID、対応機能、コンテキスト上限、単価、用途別既定モデルを1か所で定義する。

_Boundary:_ `packages/ai-core/src/models/types.ts`, `packages/ai-core/src/models/catalog.ts`, `packages/ai-core/src/models/catalog.test.ts`
_Depends:_ 6
_Requirements:_ 2.2, 2.8, 2.10, 2.17, 2.18, NFR-13
_Traces:_ REQ-002, C5

- [ ] 9.1 `models/types.ts`: `ProviderId`・`ModelId`・`Capability`・`ModelPurpose`・`ModelEntry` の Zod 非依存の型（クライアントからも import 可能）
  _Boundary:_ `packages/ai-core/src/models/types.ts`
  _Depends:_ 6
  _Requirements:_ 2.17
  _Traces:_ REQ-002, C5
  _Verify:_ 型のみ。`mise run typecheck` と 9.2 のテストで確認する
- [ ] 9.2 `models/catalog.ts`・`catalog.test.ts`: `MODEL_CATALOG`（`as const satisfies ModelCatalog`）、`getModelEntry`、`listModels`、`defaultModelFor`、`estimateCost`。watsonx.ai は含めない。テストはカタログ整合性（既定モデルの実在、機能と用途の一致、`live` の単価の存在）と、同梱カセットの `modelId` がカタログに実在することを検証する。モデル ID の値は実装時に各社公式ドキュメントで確認する（constitution 原則 8）
  _Boundary:_ `packages/ai-core/src/models/catalog.ts`, `packages/ai-core/src/models/catalog.test.ts`
  _Depends:_ 9.1
  _Requirements:_ 2.2, 2.8, 2.10, 2.17, 2.18, NFR-13
  _Traces:_ REQ-002, C5

### Implementation Notes

---

## 10. Ports（C10）(P)

時刻と外部サービスへのアクセスをインターフェースとして定義し、実装を差し替え可能にする。
録画用ラッパ（`recordingHttpFetcher`・`recordingTranscriptSource`・`recordingWebSearch`）は C7 に属する（13.4）。

_Boundary:_ `packages/ai-core/src/ports/clock.ts`, `packages/ai-core/src/ports/clock.test.ts`, `packages/ai-core/src/ports/http.ts`, `packages/ai-core/src/ports/http.test.ts`, `packages/ai-core/src/ports/transcript.ts`, `packages/ai-core/src/ports/transcript.test.ts`, `packages/ai-core/src/ports/web-search.ts`, `packages/ai-core/src/ports/web-search.test.ts`, `packages/ai-core/src/ports/index.ts`
_Depends:_ 6
_Requirements:_ 2.15, 5.7
_Traces:_ REQ-002, REQ-005, C10

- [ ] 10.1 (P) `ports/clock.ts`: `Clock`、`systemClock`、`createFakeClock()` + `clock.test.ts`（時刻の進行、`timeoutSignal` の中断）
  _Boundary:_ `packages/ai-core/src/ports/clock.ts`, `packages/ai-core/src/ports/clock.test.ts`
  _Depends:_ 6
  _Requirements:_ 5.7
  _Traces:_ REQ-005, C10
- [ ] 10.2 `ports/http.ts`: `HttpFetcher` と `createNodeHttpFetcher()` + `http.test.ts`（注入した `fetch` で、ステータス・ヘッダー・本文の写像と `AbortSignal` の伝播）
  _Boundary:_ `packages/ai-core/src/ports/http.ts`, `packages/ai-core/src/ports/http.test.ts`
  _Depends:_ 10.1
  _Requirements:_ 2.15
  _Traces:_ REQ-002, C10
- [ ] 10.3 `ports/transcript.ts`: `TranscriptSource` と `createYoutubeiTranscriptSource()` + `transcript.test.ts`（異常理由 `no-captions`/`private`/`fetch-failed` の写像を、`youtubei.js` の応答を模したテスト内のスタブで検証する。C7 の fixture 実装には依存しない）
  _Boundary:_ `packages/ai-core/src/ports/transcript.ts`, `packages/ai-core/src/ports/transcript.test.ts`
  _Depends:_ 10.1
  _Requirements:_ 2.15
  _Traces:_ REQ-002, C10
- [ ] 10.4 `ports/web-search.ts`・`index.ts`: `WebSearchProvider` と `createTavilySearch(apiKey)`、`./ports` の公開API + `web-search.test.ts`（注入した Tavily クライアントのスタブで `SearchHit` への写像と `AbortSignal` の伝播）
  _Boundary:_ `packages/ai-core/src/ports/web-search.ts`, `packages/ai-core/src/ports/web-search.test.ts`, `packages/ai-core/src/ports/index.ts`
  _Depends:_ 10.2, 10.3
  _Requirements:_ 2.15
  _Traces:_ REQ-002, C10

### Implementation Notes

---

## 11. ai-core testing ヘルパ（C18・ai-core/testing）

`@platform/ai-core/testing` サブパスとして、モックモデルのファクトリと `local` 限定テストの
ヘルパを提供する。

_Boundary:_ `packages/ai-core/src/testing/index.ts`, `packages/ai-core/src/testing/mock-models.ts`, `packages/ai-core/src/testing/mock-models.test.ts`, `packages/ai-core/src/testing/local-only.ts`, `packages/ai-core/src/testing/local-only.test.ts`
_Depends:_ 10
_Requirements:_ 1.13, 1.14
_Traces:_ REQ-001, C18

- [ ] 11.1 `testing/mock-models.ts`: `createTextStreamModel`・`createToolCallingModel`・`createObjectModel`（`MockLanguageModelV4` + `simulateReadableStream`）+ `mock-models.test.ts`（生成とストリームの両方で指定した内容を返す）
  _Boundary:_ `packages/ai-core/src/testing/mock-models.ts`, `packages/ai-core/src/testing/mock-models.test.ts`
  _Depends:_ 10
  _Requirements:_ 1.13
  _Traces:_ REQ-001, C18
- [ ] 11.2 `testing/local-only.ts`・`index.ts`: `describeLocal`/`itLocal`（`localAvailability` 不可時は理由付きスキップ）と `createFakeClock` の再公開 + `local-only.test.ts`（不可なら理由付きでスキップ、可なら実行）
  _Boundary:_ `packages/ai-core/src/testing/local-only.ts`, `packages/ai-core/src/testing/local-only.test.ts`, `packages/ai-core/src/testing/index.ts`
  _Depends:_ 11.1
  _Requirements:_ 1.13, 1.14
  _Traces:_ REQ-001, C18

### Implementation Notes

---

## 12. PlatformConfig（C4）

環境変数を Zod で検証し、実行モード・プロバイダ・用途別モデル・上限値を型付きの設定として返す。
環境変数名の一覧（`.env.example`）は 1.5 で作成済み。

_Boundary:_ `packages/ai-core/src/config/env-schema.ts`, `packages/ai-core/src/config/env-schema.test.ts`, `packages/ai-core/src/config/feature-requirements.ts`, `packages/ai-core/src/config/feature-requirements.test.ts`, `packages/ai-core/src/config/defaults.ts`, `packages/ai-core/src/config/run-mode.ts`, `packages/ai-core/src/config/run-mode.test.ts`, `packages/ai-core/src/config/load.ts`, `packages/ai-core/src/config/load.test.ts`, `packages/ai-core/src/config/index.ts`
_Depends:_ 9
_Requirements:_ 1.9, 2.1, 2.5, 2.8, 2.12, 2.13, 2.18, 6.1, NFR-07
_Traces:_ REQ-001, REQ-002, REQ-006, C4

- [ ] 12.1 `config/env-schema.ts`・`defaults.ts`: 環境変数の Zod スキーマと既定値（停止条件、レート制限、入力上限）+ `env-schema.test.ts`（既定値、型の変換、不正値の拒否）
  _Boundary:_ `packages/ai-core/src/config/env-schema.ts`, `packages/ai-core/src/config/defaults.ts`, `packages/ai-core/src/config/env-schema.test.ts`
  _Depends:_ 9
  _Requirements:_ 2.1, 2.8, 6.1, NFR-07
  _Traces:_ REQ-002, REQ-006, C4
- [ ] 12.2 `config/feature-requirements.ts`: 機能IDと必須環境変数の対応表 + `feature-requirements.test.ts`（全変数がスキーマに存在し、全機能が1件以上の変数を持つ）
  _Boundary:_ `packages/ai-core/src/config/feature-requirements.ts`, `packages/ai-core/src/config/feature-requirements.test.ts`
  _Depends:_ 12.1
  _Requirements:_ 1.9
  _Traces:_ REQ-001, C4
- [ ] 12.3 `config/run-mode.ts`: `resolveRunMode`（テストランナー内は `AI_TEST_RUN_MODE ?? "mock"`、それ以外は `AI_RUN_MODE ?? "local"`）+ テスト
  _Boundary:_ `packages/ai-core/src/config/run-mode.ts`, `packages/ai-core/src/config/run-mode.test.ts`
  _Depends:_ 12.1
  _Requirements:_ 2.5, 2.12
  _Traces:_ REQ-002, C4
- [ ] 12.4 `config/load.ts`・`index.ts`: `loadPlatformConfig`・`ConfigError`（不足変数名と機能名の列挙）。`AI_RECORD=1` と実行モード `mock` の組み合わせは `ConfigError` で拒否する（録画は `local`/`live` だけ。`mise run record` はこの検査で `mock` での起動を止める）+ テスト（不足変数の列挙、既定値、カタログ外のモデル ID の拒否、`AI_RECORD=1` + `mock` の拒否、`.env.example` の変数名とスキーマの一致）
  _Boundary:_ `packages/ai-core/src/config/load.ts`, `packages/ai-core/src/config/index.ts`, `packages/ai-core/src/config/load.test.ts`
  _Depends:_ 12.2, 12.3
  _Requirements:_ 1.9, 2.13, 2.18, NFR-07
  _Traces:_ REQ-001, REQ-002, C4

### Implementation Notes

---

## 13. MockRuntime（C7）

`mock` モードで、ネットワークを使わずに決定論的な応答を返す。`local`/`live` の録画（LLM と外部サービス）も扱う。
W2 の締めとして gate を結線する。

_Boundary:_ `packages/ai-core/src/mock/request-key.ts`, `packages/ai-core/src/mock/request-key.test.ts`, `packages/ai-core/src/mock/scenario.ts`, `packages/ai-core/src/mock/cassette-store.ts`, `packages/ai-core/src/mock/resolve.ts`, `packages/ai-core/src/mock/scenario-model.ts`, `packages/ai-core/src/mock/recording.ts`, `packages/ai-core/src/mock/redactor.ts`, `packages/ai-core/src/mock/deterministic-embedding.ts`, `packages/ai-core/src/mock/fixtures.ts`, `packages/ai-core/src/mock/index.ts`, `packages/ai-core/src/mock/scenario-model.test.ts`, `packages/ai-core/src/mock/resolve.test.ts`, `packages/ai-core/src/mock/recording.test.ts`, `packages/ai-core/src/mock/deterministic-embedding.test.ts`, `packages/ai-core/src/mock/fixtures.test.ts`, `packages/ai-core/fixtures/scenarios/m1-2.ts`, `packages/ai-core/fixtures/scenarios/m1-3.ts`, `packages/ai-core/fixtures/http/*.json`, `packages/ai-core/fixtures/transcripts/*.json`, `packages/ai-core/fixtures/web-search/*.json`, `packages/ai-core/fixtures/cassettes/.gitkeep`, `mise.toml`
_Depends:_ 9, 10（13.7 は 6〜12 にも依存する）
_Requirements:_ 1.4, 1.15, 2.4, 2.13, 2.14, 2.15, 2.16, NFR-02, NFR-03
_Traces:_ REQ-001, REQ-002, C7, C1

- [ ] 13.1 `mock/request-key.ts`: 呼び出しパラメータの正規化と `requestKey()`（正規化JSONのSHA-256）+ `request-key.test.ts`（キー順やプロバイダ固有オプションで値が変わらず、プロンプト・ツール名・用途で変わる）
  _Boundary:_ `packages/ai-core/src/mock/request-key.ts`, `packages/ai-core/src/mock/request-key.test.ts`
  _Depends:_ 9
  _Requirements:_ 2.4, NFR-02
  _Traces:_ REQ-002, C7
- [ ] 13.2 `mock/scenario.ts`・`scenario-model.ts`: `defineScenario`・`createScenarioModel`（述語照合、`stepIndex`/`toolResultFor`/`purpose` の導出と束縛、生成・ストリームの決定論的応答）+ テスト
  _Boundary:_ `packages/ai-core/src/mock/scenario.ts`, `packages/ai-core/src/mock/scenario-model.ts`, `packages/ai-core/src/mock/scenario-model.test.ts`
  _Depends:_ 13.1
  _Requirements:_ 2.4, NFR-02
  _Traces:_ REQ-002, C7
- [ ] 13.3 `mock/cassette-store.ts`・`resolve.ts`: シナリオ→カセット→`MockFixtureMissingError` の解決順序（ネットワークへフォールバックしない）+ テスト（曖昧な述語の検出を含む）
  _Boundary:_ `packages/ai-core/src/mock/cassette-store.ts`, `packages/ai-core/src/mock/resolve.ts`, `packages/ai-core/src/mock/resolve.test.ts`
  _Depends:_ 13.2
  _Requirements:_ 2.14
  _Traces:_ REQ-002, C7
- [ ] 13.4 `mock/redactor.ts`・`recording.ts`: 録画ミドルウェアと、C10 の3つのポートを包む録画用ラッパ（`recordingHttpFetcher`・`recordingTranscriptSource`・`recordingWebSearch`）、秘密値・ヘッダーの伏せ字化。`youtubei.js` と `@tavily/core` は `HttpFetcher` を通らないため、字幕と Web 検索はポートの入出力（`videoId`→`TranscriptResult`、`query`→`SearchHit[]`）を、13.6 の fixture 実装がそのまま読める形式（`TranscriptFixture`・`WebSearchFixture`）で録画する + テスト（LLM と3種の外部サービスの録画に秘密情報とヘッダーが残らないこと、録画した字幕・Web 検索を 13.6 の fixture 実装で再生すると同じ結果になること）
  _Boundary:_ `packages/ai-core/src/mock/redactor.ts`, `packages/ai-core/src/mock/recording.ts`, `packages/ai-core/src/mock/recording.test.ts`
  _Depends:_ 10, 13.1
  _Requirements:_ 2.13
  _Traces:_ REQ-002, C7
- [ ] 13.5 `mock/deterministic-embedding.ts`: ハッシュ由来の決定論的な埋め込みモデル（L2正規化）+ テスト（決定性・次元数・正規化）
  _Boundary:_ `packages/ai-core/src/mock/deterministic-embedding.ts`, `packages/ai-core/src/mock/deterministic-embedding.test.ts`
  _Depends:_ 13.1
  _Requirements:_ 2.16
  _Traces:_ REQ-002, C7
- [ ] 13.6 `mock/fixtures.ts`・`index.ts`・`packages/ai-core/fixtures/*`: HTTP・字幕・Web検索の fixture 実装（手書きの fixture と、`fixtures/cassettes/` 配下に録画した fixture の両方を読む）、M1 のシナリオ・cassette 保存先、公開API + `fixtures.test.ts`（登録済みの要求に fixture を返し、未登録で `MockFixtureMissingError`）
  _Boundary:_ `packages/ai-core/src/mock/fixtures.ts`, `packages/ai-core/src/mock/fixtures.test.ts`, `packages/ai-core/src/mock/index.ts`, `packages/ai-core/fixtures/scenarios/m1-2.ts`, `packages/ai-core/fixtures/scenarios/m1-3.ts`, `packages/ai-core/fixtures/http/*.json`, `packages/ai-core/fixtures/transcripts/*.json`, `packages/ai-core/fixtures/web-search/*.json`, `packages/ai-core/fixtures/cassettes/.gitkeep`
  _Depends:_ 10, 13.3, 13.4, 13.5
  _Requirements:_ 2.15, NFR-03
  _Traces:_ REQ-002, C7
- [ ] 13.7 W2 の締め: `mise.toml` の `gate` に W2 の段と規則（[tasks.md](tasks.md)「gate と CI の段階的な結線」）を加える
  _Boundary:_ `mise.toml`
  _Depends:_ 6, 7, 8, 9, 10, 11, 12, 13.1, 13.2, 13.3, 13.4, 13.5, 13.6
  _Requirements:_ 1.4, 1.15
  _Traces:_ REQ-001, C1
  _Verify:_ `mise run gate` が成功し、`typecheck` 段（ルートの `//#typecheck` を含む）と追加した4規則が走査件数を出力する。ai-core の行カバレッジが80%以上である

### Implementation Notes
