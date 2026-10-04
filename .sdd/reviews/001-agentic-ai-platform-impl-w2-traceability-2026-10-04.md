# 001 agentic-ai-platform W2 トレーサビリティ検証（2026-10-04）

- 対象: W2（大タスク 6〜13、`specs/001-agentic-ai-platform/tasks.md` 116〜426 行）
- 方法: 読み取りのみ。spec.md の受け入れ基準 → tasks / traceability.md → 実装（file:line）→ テスト（ファイル + テスト名）を突き合わせた。残りの部分は `tasks-w3.md`〜`tasks-w5.md` で割り当て先を確認した。
- 設計の整合: plan.md の C4、C5、C7、C10、C18 の公開インターフェースを `packages/ai-core/src` と照合した。
- 外部仕様の確認: Vitest 5 の inline project が root の `plugins` / `resolve` を継承するか（`apps/web/vitest.config.ts` の妥当性）を Context7 `/websites/main_vitest_dev`（guide/projects、guide/migration、blog/vitest-5）で確認した。Vitest 5 では `extends: true` が既定で、継承する。欠陥ではない。

## 集計

| 分類 | 件数 | 項目 |
|---|---|---|
| Covered | 12 | 1.1, 1.2, 2.4, 2.5, 2.8, 2.12, 2.14, 2.17, 2.18, NFR-05, NFR-06, NFR-07 |
| Partially covered | 17 | 1.4, 1.9, 1.13, 1.14, 1.15, 2.1, 2.2, 2.10, 2.13, 2.15, 2.16, 5.7, 6.1, NFR-02, NFR-03, NFR-09, NFR-13 |
| Not traceable | 0 | — |

Partially covered のうち、残りが 001 の後続タスクに割り当てられていないもの:
- **NFR-13**: 推定コストの「表示」（評価レポートとトレース）。plan C5 の Does NOT own で 004 に委ねている。001 のタスクはない（設計上の意図）。
- **2.15**: arXiv、Rerank、E2B、MCP の fixture。plan C7 の Does NOT own で 002 / 003 に委ねている（設計上の意図）。
- （AC ではなく設計の項目）plan C7 の「同梱 fixture に曖昧な述語がないこと」の検査は未実装で、後続タスクにも割り当てがない（下記 D3）。
- （AC ではなく設計の項目）`PlatformError` をどの公開サブパスから export するか。traceability.md Gaps（T-6 の ship）は「T-21.1 までに決める」としているが、tasks-w4.md の 21.1 の本文にこの決定は書かれていない（下記 D11）。

---

## 1. 受け入れ基準のマトリクス

凡例: Impl = 実装の根拠、Test = テストの根拠（ファイル + テスト名）、Rest = W2 の範囲外の残りと割り当て先。

### Requirement 1

| AC | 要件（要約） | W2 の範囲 | Impl | Test | 分類 / Rest |
|---|---|---|---|---|---|
| 1.1 | Web アプリ、エージェント基盤、評価スイートを独立したワークスペースパッケージとして提供する | 3つのワークスペースの scaffold（7.1、8.1〜8.3） | `packages/ai-core/package.json:2`、`packages/eval-suite/package.json:2,10`（`@platform/ai-core` に依存）、`apps/web/package.json:2,14`、`apps/web/next.config.ts:3-7` | `mise run setup`（frozen lockfile）と `mise run typecheck`（`mise.toml:31-43`、count-tsc が root / ai-core / eval-suite / web の4件を走査。do.md の 2026-09-30 22:55 の記録）。ワークスペースの自動テストは T-19.1 | **Covered**。eval-suite のテストは T-19.1 で加わる（構造上の要件は充足） |
| 1.2 | エージェント基盤を UI フレームワークに依存させず、Web 以外からも import できるようにする | ai-core の依存とサブパス `exports`、UI 依存の検査 | `packages/ai-core/package.json:6-16,22-35`（React / Next なし）、`scripts/check-repo-rules.mjs:686`（`ai-core-no-ui-deps`）、`mise.toml:155` | `scripts/check-repo-rules.test.mjs` の "detects %s"（`ai-core-no-ui-deps`）と "checks ai-core source imports as well as package dependencies"、`packages/ai-core/src/errors.test.ts` の "preserves the closed error code, Japanese message, and structured details" | **Covered**。ただし 9 個の `exports` のうち 5 個（`./models`、`./agents`、`./aci`、`./chat`、`./summarize`）は、参照先のファイルがまだ存在しない（D2。14.4、15.x、16.x、17.x、18.x が作る） |
| 1.4 | `mise run gate` で lint、format、typecheck、テストを全ワークスペースに実行し、失敗時は非ゼロで終了する | W2 の締め（13.7）で `typecheck` 段を加える | `mise.toml:74-82`（lint → check:model-ids → check:repo-rules → typecheck → test）、`mise.toml:31-43`（`turbo run typecheck` + count-tsc）、`turbo.json:44-46`（`//#typecheck`） | `scripts/gate/count.test.mjs` の "count-tsc exits 1 when a tsconfig scanned zero files" と "fails when any tsconfig output contains zero files"。gate の実行記録（do.md 22:55: TypeScript root 10 / ai-core 49 / eval-suite 1 / web 8 files） | **Partially covered**。`docs:check` 段は T-29.1。eval-suite と web の `test` スクリプトは T-19.1、T-21.1 で加わる（それまで gate の `test` 段はこの2ワークスペースを実行しない） |
| 1.9 | 必須の環境変数が不足した状態で起動した場合、不足変数名と機能名を示すエラーを出す | ai-core の `ConfigError` と、機能と必須変数の対応表 | `packages/ai-core/src/config/feature-requirements.ts:3-14`、`packages/ai-core/src/config/load.ts:18-25,62-71,138-143` | `load.test.ts` の "lists every missing variable with the feature that requires it"、`feature-requirements.test.ts` の "maps every feature to at least one environment variable" と "references only variables declared by the environment schema" | **Partially covered**。Web アプリ起動時の整形出力は T-20.2（`instrumentation.ts#register`）。エージェント CLI の起動経路は 001 にない |
| 1.13 | 各モジュールの自動テストを `mock` で完走できるようにし、比較・品質評価のテストは `local` が使えるときだけ実行する | testing ヘルパ（11.1、11.2）、eval-suite の Vitest 設定と README（7.2、7.3） | `packages/ai-core/src/testing/mock-models.ts:40,65,88`、`packages/ai-core/src/testing/local-only.ts:31-60`、`packages/ai-core/vitest.config.ts:3-26`、`packages/eval-suite/vitest.config.ts:3-27`、`packages/eval-suite/tests/capability/README.md:23-32` | `mock-models.test.ts` の "returns the configured text for generation and streaming"、"returns the configured tool call for generation and streaming"、"serializes the configured object for generation and streaming"。`local-only.test.ts` の "runs local suites and tests when local models are available" | **Partially covered**。実際の local 限定テストは T-14.5（`catalog.local.test.ts`）、T-19.2。eval-suite の mock テストは T-19.1 |
| 1.14 | local で実行できない比較・品質評価テストは、理由付きの「スキップ」として報告し、合格に数えない | `describeLocal` / `itLocal` の理由付きスキップ、ai-core と eval-suite への `global-setup-local` / `gate-reporter` の登録 | `packages/ai-core/src/testing/local-only.ts:26-50`、`packages/ai-core/vitest.config.ts:24-25`、`packages/eval-suite/vitest.config.ts:24-25` | `local-only.test.ts` の "skips local suites and tests with the unavailable reason"、"registers the local availability global setup"、"describeLocal public integration"、"itLocal public integration runs when local models are available"（gate では理由付きで 2 件スキップ） | **Partially covered**。eval-suite での実テストは T-19.2。Ollama を止めた状態での統合確認は T-29.2 |
| 1.15 | 品質ゲートの各段で、実行数または走査数が 0 なら失敗させる | W2 の `typecheck` 段（count-tsc）と W2 の4規則の走査件数。ai-core の gate で `passWithNoTests: false` | `mise.toml:42`、`mise.toml:155`、`scripts/check-repo-rules.mjs:622,656,686,979`、`packages/ai-core/vitest.config.ts:26` | `count.test.mjs` の "count-tsc exits 1 when a tsconfig scanned zero files"。`check-repo-rules.test.mjs:206-207`（"scanned 2 FILES" の出力を確認） | **Partially covered**。`tool-risk-declared` は T-19.3、`docs:check` は T-29.1、Playwright の非空検査は T-25.3 / T-29.1 |

### Requirement 2

| AC | 要件（要約） | W2 の範囲 | Impl | Test | 分類 / Rest |
|---|---|---|---|---|---|
| 2.1 | `mock` / `local` / `live` の3モードを設定だけで切り替えられるようにする | 環境変数のスキーマと実行モードの解決 | `packages/ai-core/src/config/env-schema.ts:12-13`、`run-mode.ts:11-16`、`load.ts:122-126,150` | `env-schema.test.ts` の "applies runtime, provider, URL, agent, and rate-limit defaults"、"rejects an invalid %s value"。`run-mode.test.ts` の4件 | **Partially covered**。モードに応じたモデルの生成は T-14.1、T-14.4（ModelGateway） |
| 2.2 | `live` では Anthropic、OpenAI、Azure OpenAI、Google を選べるようにし、watsonx.ai は v7 対応の実装があるときだけ選べるようにする | カタログの provider と `AI_LIVE_PROVIDER` の列挙 | `packages/ai-core/src/models/types.ts:1`、`catalog.ts:19-200,221-244`、`env-schema.ts:14-17` | `catalog.test.ts` の "keeps model IDs, entries, providers, modes, and live pricing consistent"（6 プロバイダ、watsonx なし） | **Partially covered**。プロバイダファクトリは T-14.1 |
| 2.4 | `mock` ではネットワークを使わず、シナリオまたはカセットから、同一入力に毎回同一の内容を返す | 13.1、13.2 | `packages/ai-core/src/mock/request-key.ts:14-52`、`scenario.ts:57-96`、`scenario-model.ts:47-135`、`resolve.ts:50-77` | `request-key.test.ts` の "normalizes object key order and ignores provider-specific options" と "changes when %s changes"（3件）。`scenario-model.test.ts` の "binds purpose and deterministically returns text for generate and stream"、"derives stepIndex and the trailing tool result name from the prompt"、"returns tool calls and structured objects" | **Covered**。gateway からの利用は T-14.1 |
| 2.5 | テストランナーの中では、明示的な上書きがない限り `mock` にする | `resolveRunMode` | `packages/ai-core/src/config/run-mode.ts:12-14` | `run-mode.test.ts` の "defaults to mock inside the test runner and honors only the test override"、"treats empty run-mode values as unset" | **Covered** |
| 2.8 | 用途ごとのモデルを設定で指定できるようにし、モデル ID をアプリケーションコードに書かない | 用途別の既定値と `AI_MODEL_*` の上書き | `catalog.ts:204-245,271-282`、`env-schema.ts:18-21`、`load.ts:93-120` | `catalog.test.ts` の "keeps every declared default present and compatible with its mode, provider, and purpose"。`load.test.ts` の "uses explicit catalog model IDs and rejects IDs outside the catalog" | **Covered**。gateway がこの設定を使う（T-14.1）。`AI_MODEL_STRUCTURED` / `EMBEDDING` / `JUDGE` の上書きは個別に検証していない（`CHAT` だけ）。D9 を参照 |
| 2.10 | watsonx.ai の v7 対応実装がなければ、選択肢と設定から除外し、理由を解説に書く | カタログと設定スキーマから watsonx を除外 | `types.ts:1`、`env-schema.ts:14-17` | `catalog.test.ts` の "keeps model IDs, entries, providers, modes, and live pricing consistent"（`not.toContain("watsonx")`） | **Partially covered**。解説の記載は T-28.5。v7 対応の検出（`check-updates`）は W1 の T-5.3 で実装済み |
| 2.12 | Web アプリとハンズオンの既定のモードを `local` にし、`mock` はテストと明示指定だけで使う | `resolveRunMode` の既定値 | `run-mode.ts:15`、`env-schema.ts:12` | `run-mode.test.ts` の "defaults to local outside the test runner and honors the application override"。`load.test.ts` の "loads the unedited .env.example template as local defaults" | **Covered**。Web アプリでの使用は T-20.1 |
| 2.13 | 録画モードで要求と応答の組をカセットに記録し、秘密情報を除外する | 設定の検査（12.4）、録画ミドルウェア、3つのポートの録画用ラッパ、伏せ字化（13.4） | `load.ts:144-148`、`packages/ai-core/src/mock/recording.ts:169-226,232-320`、`redactor.ts:1-81` | `load.test.ts` の "rejects recording in mock mode"、"accepts recording in local mode"。`recording.test.ts` の "redacts configured secrets, known key formats, and sensitive headers recursively"、"records generate output as a redacted version-1 cassette without request or response headers"、"records stream parts after consumption while returning the original stream data"、"does not persist a partial cassette when the stream consumer cancels"、"records an HTTP fixture with a redacted URL, body, and response headers"、"records transcript fixtures that replay to the same result"、"records web-search fixtures that replay to the same result without secrets"、"replays recorded port fixtures with the original inputs and distinguishes HTTP bodies" | **Partially covered**。`wrapLanguageModel` での合成は T-14.3、ポートを録画用ラッパで包むのは T-20.1。`mise run record` が `mock` で起動しないことの確認は、`instrumentation.ts` の T-20.2 に依存する（`mise.toml:140-143`） |
| 2.14 | `mock` で一致するシナリオもカセットもなければ、ネットワークへフォールバックせず、不足を示すエラーを返す | 13.3 | `resolve.ts:26-35,50-77`、`cassette-store.ts:104-148`、`fixtures.ts:190-192,210-276` | `resolve.test.ts` の "prefers the first matching scenario over a cassette"、"falls back to cassette by request key and never to a network"、"detects ambiguous scenario predicates without changing first-match runtime behavior"、"exposes only keys and scenario ids in missing-fixture diagnostics"、"rejects unsafe storage keys and supports concurrent writes to one cassette"、"validates cassette JSON at the filesystem boundary"。`fixtures.test.ts` の "throws MockFixtureMissingError for an unregistered %s request" | **Covered**。ただし `nearest` は「近いもの」ではなく、先頭5件のシナリオ ID である（D5） |
| 2.15 | 外部サービス（Web ページ取得、YouTube 字幕、arXiv、Web 検索、Rerank、E2B、MCP）を `mock` では fixture か疑似実装に置き換える | C10 のポート（10.2〜10.4）と、M1 の3サービスの fixture 実装（13.6） | `packages/ai-core/src/ports/http.ts:9-26`、`transcript.ts:21-23,74-85,151-`、`web-search.ts:14-16,45-83`、`mock/fixtures.ts:210-314`、`packages/ai-core/fixtures/{http,transcripts,web-search}/*.json` | `http.test.ts` の "maps status, headers, and body from the injected fetch"、"passes the caller AbortSignal to fetch without replacing it"。`transcript.test.ts` の "maps youtubei transcript segments to timestamped text"、"maps youtubei failures to %s"、"rejects with the caller abort reason instead of a transcript failure"。`web-search.test.ts` の "maps Tavily results to stable SearchHit values"、"wraps Tavily SDK failures as source-unavailable"、"passes AbortSignal to the client and rejects when the caller aborts"。`fixtures.test.ts` の "returns registered HTTP, transcript, and web-search fixtures"、"loads handwritten fixtures and recorded fixtures under cassettes"、"ships M1 scenarios, JSON fixtures, and cassette save directories" | **Partially covered**。実行モードでの切り替えは T-20.1。arXiv、Rerank、E2B、MCP は 002 / 003 が担う（plan C7 の Does NOT own。**001 のタスクには割り当てがない**、設計上の意図） |
| 2.16 | `mock` の埋め込みを入力から決定論的に導いたダミーベクトルにし、検索精度の評価に使えないことを解説に書く | 13.5 | `packages/ai-core/src/mock/deterministic-embedding.ts:35-64` | `deterministic-embedding.test.ts` の "returns the same embeddings for the same inputs"、"returns exactly %i dimensions"、"L2-normalizes every embedding" | **Partially covered**。解説の記載は T-28.7。`resolveEmbedding` での利用は T-14.3 |
| 2.17 | モデル ID、対応機能、コンテキスト上限、単価を1つのカタログで管理する | 9.1、9.2 | `models/types.ts:19-50`、`catalog.ts:19-202` | `catalog.test.ts` の全7件（"exposes Zod-independent client-safe catalog types" を含む） | **Covered**。2.9、4.6、4.8 からの参照は W3 |
| 2.18 | カタログと設定スキーマ以外にモデル ID の文字列があれば gate で失敗させる | W1 の `check:model-ids` に加え、カセットの `modelId` の照合とカタログ外 ID の拒否 | `scripts/check-model-ids.mjs`（W1）、`mise.toml:78,149-151`、`load.ts:73-78` | `catalog.test.ts` の "keeps every bundled cassette model ID in the catalog"、`load.test.ts` の "uses explicit catalog model IDs and rejects IDs outside the catalog"、`scripts/check-model-ids.test.mjs`（W1） | **Covered** |

### Requirement 5 / 6

| AC | 要件（要約） | W2 の範囲 | Impl | Test | 分類 / Rest |
|---|---|---|---|---|---|
| 5.7 | 現在時刻に依存するツールに Clock を注入し、システム時刻を直接読まない | Clock ポートと fake 実装 | `packages/ai-core/src/ports/clock.ts:1-64`、`testing/index.ts:1` | `clock.test.ts` の "advances fake time deterministically"、"aborts timeout signals only after their deadline"、"uses the system clock and native timeout signals in production" | **Partially covered**。ツールへの注入は T-15.3（`createCurrentTimeTool(clock)`） |
| 6.1 | すべての `ToolLoopAgent` に3種の停止条件を設定し、既定値は設定で変更できる。近似であることを解説に書く | 既定値（10 / 50,000 / 120,000 / 15,000）と正の整数の検証 | `packages/ai-core/src/config/defaults.ts:1-6`、`env-schema.ts:8-9,40-43`、`load.ts:173-178` | `env-schema.test.ts` の "applies runtime, provider, URL, agent, and rate-limit defaults"、"rejects an invalid %s value"（`AGENT_MAX_STEPS=0`、`AGENT_MAX_TOTAL_TOKENS=1.5`） | **Partially covered**。停止条件の本体は T-16.1、T-16.3。解説は T-28.6 |

### NFR

| NFR | 要件（要約） | W2 の範囲 | Impl | Test | 分類 / Rest |
|---|---|---|---|---|---|
| NFR-02 決定性 | `mock` で gate を10回実行して10回とも同じ合否にする | `requestKey` とシナリオ応答の決定性 | `request-key.ts:16-52`、`scenario-model.ts:47-80`、`deterministic-embedding.ts:12-42` | `request-key.test.ts` の2件、`scenario-model.test.ts` の3件、`deterministic-embedding.test.ts` の "returns the same embeddings for the same inputs" | **Partially covered**。`mise run gate:repeat` の10回実行は T-29.2。同梱シナリオに曖昧な述語がないことの検査はない（D3） |
| NFR-03 オフライン動作 | ネットワークがない状態でも `mock` の gate を実行できる | fixture のオフライン再生、ネットワークへのフォールバックなし | `resolve.ts:70-76`、`fixtures.ts:210-276`、`tooling/vitest/setup-hermetic.ts`（W1） | `resolve.test.ts` の "falls back to cassette by request key and never to a network"、`fixtures.test.ts` の "throws MockFixtureMissingError for an unregistered %s request"、`tooling/vitest/setup-hermetic.test.ts`（W1） | **Partially covered**。ネットワークを切断した状態での実測は T-29.2 |
| NFR-05 型安全性 | strict モードで型検査を通し、公開 API に `any` を含めない | ai-core の strict typecheck と閉じた `PlatformErrorCode` | `tsconfig.base.json:7-9`、`packages/ai-core/tsconfig.json:1-7`、`errors.ts:1-24`、`mise.toml:31-43` | `errors.test.ts` の "exposes the documented M1 PlatformErrorCode vocabulary"、`catalog.test.ts` の "exposes Zod-independent client-safe catalog types"（`not.toBeAny()`）。`packages/ai-core` の grep で明示的な `any` は0件 | **Covered**（W2 の範囲）。公開 API に `any` がないことの機械的な検査は、Biome の `recommended`（`biome.json:20`）と grep に頼っている |
| NFR-06 テストカバレッジ | エージェント基盤の行カバレッジを80%以上に保つ | gate で閾値80%を強制する | `packages/ai-core/vitest.config.ts:27-40` | gate の実行記録（ai-core の lines 94.05%、`src/mock` 92.21%。tasks.md:426、do.md 22:55）。T-6.2 の PROVE（101% で失敗） | **Covered** |
| NFR-07 秘密情報 | API キーを環境変数だけから読み、秘密情報の設定ファイルを VCS から除外し、名前だけのサンプルを提供する | env スキーマ、`process.env` を読むのは既定引数の1か所だけ、`.env.example` との一致 | `load.ts:129`（`process.env` の唯一の参照）、`env-schema.ts:34-39`、`.gitignore:69-71` | `load.test.ts` の "keeps the sample environment variable names identical to the schema"、"loads the unedited .env.example template as local defaults"。W1 の T-1.5（gitleaks） | **Covered** |
| NFR-09 アクセシビリティ | キーボードだけで操作でき、WCAG 2.2 AA のコントラストを満たす | テーマトークンのコントラスト（8.3） | `apps/web/app/globals.css`、`biome.json:38-42` | `scripts/check-web-theme.test.mjs` の "keeps %s / %s text contrast at 4.5:1 or higher"、"keeps %s / %s non-text contrast at 3:1 or higher"、"uses an opaque focus outline so the token contrast is the rendered contrast" | **Partially covered**。UI 部品は T-20.4、axe とキーボード操作は T-26.3、T-27.3 |
| NFR-13 コスト可視化 | `live` で、評価レポートとトレースにトークン使用量からの推定コストを表示する | 算出元（`estimateCost`、`live` の単価は必須） | `catalog.ts:284-300`、`types.ts:28-33,52-64` | `catalog.test.ts` の "estimates input, output, and cache-read cost in USD and omits unpriced modes"、"keeps model IDs, entries, providers, modes, and live pricing consistent" | **Partially covered**。表示は 004 の担当（plan C5 の Does NOT own）。**001 の後続タスクには割り当てがない**（設計上の意図） |

---

## 2. 設計の整合（plan.md と `packages/ai-core/src`）

### C4 PlatformConfig（plan.md:123-132）

| plan の指定 | 実装 | 判定 |
|---|---|---|
| `loadPlatformConfig(env?: EnvSource, options?: { features?: readonly FeatureId[] }): PlatformConfig` | `config/load.ts:128-131` | 一致 |
| `resolveRunMode(env)`: `VITEST` が定義されていれば `AI_TEST_RUN_MODE ?? "mock"`、それ以外は `AI_RUN_MODE ?? "local"`。空文字は未設定 | `config/run-mode.ts:7-16` | 一致 |
| `class ConfigError extends PlatformError { missing: readonly { variable: string; feature: FeatureId }[] }` | `config/load.ts:13-25`（`variable` は `RequiredEnvVariable` に絞り込んでいる） | 一致（互換性のある絞り込み。D7） |
| `env-schema.ts`、`feature-requirements.ts`、`defaults.ts` | 3ファイルとも存在する | 一致 |
| `AI_RECORD=1` + `mock` を `ConfigError` で拒否する | `config/load.ts:144-148` | 一致 |
| スキーマの検証を実行モードの解決より先に行う | `config/load.ts:132-136` | 一致 |
| `process.env` を直接読むのは既定引数の1か所だけ | `config/load.ts:129`（`src` の grep で唯一） | 一致 |
| `./config` の公開 | `package.json:15`、`config/index.ts:1-19` | 一致 |

### C5 ModelCatalog（plan.md:134-140）

| plan の指定 | 実装 | 判定 |
|---|---|---|
| `MODEL_CATALOG`（`as const satisfies ModelCatalog`） | `models/catalog.ts:19,200` | 一致 |
| `getModelEntry(id: CatalogModelId): ModelEntry` | `catalog.ts:247-251` | 一致 |
| `listModels(filter: { mode; provider?; capability? })` | `catalog.ts:258-269` | 一致 |
| `defaultModelFor(mode, provider, purpose): CatalogModelId`。宣言のない組み合わせは `RangeError` | `catalog.ts:271-282` | 一致 |
| `estimateCost(usage, entry): CostEstimate \| undefined` | `catalog.ts:284-300` | 一致 |
| `types.ts` は Zod に依存せず、`catalog.ts` にも依存しない。`ModelId = string` | `models/types.ts:1-64`（import なし） | 一致 |
| `CatalogModelId` は `catalog.ts` が export する | `catalog.ts:202` | 一致 |
| `./models` の公開 | `package.json:7` が `./src/models/index.ts` を指すが、**ファイルは存在しない** | 逸脱（一時的。D2。T-14.4 が作る） |
| （plan にない追加） | `MODEL_DEFAULTS` の export（`catalog.ts:204`） | 情報（D8） |

### C7 MockRuntime（plan.md:155-180）

| plan の指定 | 実装 | 判定 |
|---|---|---|
| `defineScenario(scenario): ScenarioDefinition` | `mock/scenario.ts:50-55` | 一致 |
| `createScenarioModel(options: { scenarios; cassettes? }): LanguageModelV4` | `mock/scenario-model.ts:111-135`: `{ purpose（必須）; scenarios; cassettes? }` を受け取り、`MockLanguageModelV4`（`ai/test`）を返す | **逸脱（D1）**。plan.md:174 は `createScenarioModel({ ..., purpose })` と書いており、plan の中で矛盾している。NO-GO の解消でも揃えていない |
| `createCassetteStore(dir)`（`get(key: RequestKey)`、`put(key: string, value)`）。保存キーの規則、裸のキーへの `llm/` の補完、`../` の拒否 | `mock/cassette-store.ts:14-15,99-110,125-148` | 一致 |
| UUID 付きの一時ファイルから rename する | `cassette-store.ts:137-146` | 一致 |
| `get` は v1 を Zod で検証する（ストリームパートは `type` ごとの必須フィールドまで）。キーの不一致を拒否し、`response-metadata.timestamp` を `Date` に戻す | `cassette-store.ts:23-83,112-123` | 一致 |
| `recordingMiddleware(store: RecordingStore, redactor, options?)`。既定は `purpose: "chat"`、`recordedWith: "live"`、`now`。完了したストリームだけを録画する | `mock/recording.ts:40-42,58-62,189-226` | 一致 |
| `createRedactor(env: EnvSource): Redactor` | `mock/redactor.ts:16-18,74-81` | 一致 |
| `recordingHttpFetcher` / `recordingTranscriptSource` / `recordingWebSearch`（inner, store, redactor） | `recording.ts:232-253,259-288,290-320` | 一致 |
| `requestKey(params, purpose): RequestKey`（正規化 JSON の SHA-256） | `mock/request-key.ts:42-52` | 一致 |
| `createDeterministicEmbeddingModel({ dimensions }): EmbeddingModelV4`（SHA-256 をシードにした PRNG、L2 正規化） | `mock/deterministic-embedding.ts:35-64` | 一致 |
| `class MockFixtureMissingError extends PlatformError { key; nearest }` | `mock/resolve.ts:26-35` | 一致（`nearest` の中身は D5） |
| `createFixtureHttpFetcher` / `createFixtureTranscriptSource` / `createFixtureWebSearch`、`loadFixtureSet(dir?)`（ディレクトリがなければ空）、`DEFAULT_FIXTURE_DIRECTORY`、`CASSETTE_FIXTURE_DIRECTORY` | `mock/fixtures.ts:125-126,210-276,278-314` | 一致 |
| `httpFixtureRequestKey(url, init)`、`transcriptFixtureRequestKey`、`webSearchFixtureRequestKey`、`describeHttpFixtureRequest`。まず `requestKey` で照合し、`requestKey` のない手書き fixture だけを URL / videoId / query で照合する | `fixtures.ts:136-184,210-266` | 一致 |
| 解決規則: シナリオ（述語、定義順の最初）→ カセット（キー）→ `MockFixtureMissingError`。ネットワークへのフォールバックなし | `resolve.ts:50-77` | 一致 |
| 照合に使う値（`stepIndex` = 最後の user 以降の assistant の数、`toolResultFor` = 末尾の tool メッセージ、`lastUserTextIncludes`、`purpose` の束縛） | `scenario.ts:57-96`、`scenario-model.ts:116-122` | 一致 |
| 公開 API（`@platform/ai-core/mock`）: `normalizeRequest`、`resolveMockResponse`、`findAmbiguousScenarioMatches`、`deriveScenarioContext`、`scenarioMatches`、`M1_2_SCENARIOS`、`M1_3_SCENARIOS`、型の一覧 | `mock/index.ts:1-50`。plan に列挙された名前はすべて export されている | 一致 |
| `resolve.test.ts` で「同梱 fixture に曖昧な述語がないこと」を検査する（plan.md:170、637） | `resolve.test.ts:94-106` は合成シナリオで検出器を検査するだけで、`M1_2_SCENARIOS` / `M1_3_SCENARIOS` に対しては実行していない | **欠落（D3）**。後続タスクに割り当てがない |
| カセット JSON の `request.modelId` がカタログに実在することを `catalog.test.ts` が検査する | `catalog.test.ts:146-166` | 一致 |
| Data Model: Cassette（`cassettes/llm/<key>.json`）、HttpFixture の `requestKey?` / `request?`、TranscriptFixture、WebSearchFixture | `cassette-store.ts:85-97`、`recording.ts:186`、`fixtures.ts:90-117` | 一致（`Cassette` の型が2か所にある。D4） |

### C10 Ports（plan.md:215-221）

| plan の指定 | 実装 | 判定 |
|---|---|---|
| `interface Clock { now(); timeoutSignal(ms) }`、`systemClock`、`createFakeClock()` | `ports/clock.ts:1-64`（`createFakeClock(initialTime = 0)` と `advanceBy` / `set`） | 一致 |
| `interface HttpFetcher { fetch(url, init?: FetchInit): Promise<HttpResponse> }`、`createNodeHttpFetcher(fetch?)` | `ports/http.ts:1-26` | 一致 |
| `interface TranscriptSource { fetchTranscript(videoId, signal?) }`、`createYoutubeiTranscriptSource({ createClient? })` | `ports/transcript.ts:21-23,70-72,151-` | 一致 |
| `TranscriptSourceError`（`source-unavailable`、`reason`）を `./ports` から公開する | `transcript.ts:74-85`、`ports/index.ts:14` | 一致 |
| `interface WebSearchProvider { search(query, signal?) }`、`createTavilySearch(apiKey, { client? })`。SDK の例外と Zod の失敗を `source-unavailable`（`provider: "tavily"`）にし、http/https 以外の URL は全体を拒否する | `ports/web-search.ts:14-16,18-28,45-83` | 一致 |
| 呼び出し元の中断では `reason` で即時に reject する。`abort.ts` は公開しない | `ports/abort.ts:2`、`ports/index.ts`（`abort` の export なし） | 一致 |

### C18 TestHarness（ai-core 側の W2 部分。plan.md:293-307）

| plan の指定 | 実装 | 判定 |
|---|---|---|
| `@platform/ai-core/testing`: `describeLocal`、`itLocal`、`createTextStreamModel`、`createToolCallingModel`、`createObjectModel`、`createFakeClock` | `testing/index.ts:1-8`、`testing/local-only.ts:59-60`、`testing/mock-models.ts:40,65,88` | 一致 |
| ai-core の `vitest.config.ts`: `setup-hermetic`、`global-setup-local`、`gate-reporter`、`AI_TEST_SUITE` による選択、`passWithNoTests` は gate のときだけ false、カバレッジは常に有効で `lines: 80` | `packages/ai-core/vitest.config.ts:3-41` | 一致（閾値は gate のときだけ。plan C18 の「閾値の強制は gate」と矛盾しない） |
| eval-suite の `vitest.config.ts`: 3つの登録（集約しない） | `packages/eval-suite/vitest.config.ts:17-27` | 一致 |
| apps/web の `vitest.config.ts`: 2 project、両方に `setup-hermetic`、root に `gate-reporter` | `apps/web/vitest.config.ts:21-56` | 一致。Vitest 5 の inline project は root の `plugins` / `resolve` を継承する（Context7 で確認） |
| `test:coverage` は閾値 0 で HTML レポートだけを作る | `packages/ai-core/package.json:19` | 一致 |

### `package.json#exports` と plan

`packages/ai-core/package.json:6-16` は plan の9サブパス（`models`、`agents`、`aci`、`chat`、`summarize`、`mock`、`ports`、`testing`、`config`）をすべて宣言している。参照先のファイルが存在するのは `mock`、`ports`、`testing`、`config` の4つだけである。残りの5つは W3 のタスクが作る（`models` は 14.4、`aci` は 15.x、`agents` は 16.x、`chat` は 17.x、`summarize` は 18.x。tasks-w3.md:35,62,87-88,102,122-123,137,153,167,198）。

### 逸脱と所見の一覧

| ID | 重大度 | 内容 | 場所 | 割り当て |
|---|---|---|---|---|
| D1 | Low（文書のずれ） | `createScenarioModel` のシグネチャが plan の Public interface と違う。`purpose` が必須で、戻り値の型は `LanguageModelV4` ではなく `MockLanguageModelV4`（`ai/test` の型を公開 API に出している）。plan の中でも、plan.md:159（`purpose` なし）と plan.md:174（`purpose` あり）が食い違っている | `scenario-model.ts:111-115` / `plan.md:159,174` | なし。plan C7 を実装に合わせることを推奨する |
| D2 | Info（一時的） | `exports` の5つのサブパスが、存在しないファイルを指している。`@platform/ai-core/models` を import すると現在は解決に失敗する | `packages/ai-core/package.json:7-11` | 14.4、15.x、16.x、17.x、18.x |
| D3 | Medium-Low | plan の「同梱 fixture に曖昧な述語がないこと」の検査がない。`findAmbiguousScenarioMatches` を `M1_2_SCENARIOS` / `M1_3_SCENARIOS` に対して実行するテストがない（たとえば "こんにちは、東京の天気は？" は `m1-2/chat` と `m1-2/weather-tool` の両方の turn 0 に一致する） | `resolve.test.ts:94-106`、`fixtures/scenarios/m1-2.ts:8,20` / `plan.md:170,637` | **割り当てなし**（tasks-w3〜w5 に「曖昧」の記述はない） |
| D4 | Low | `Cassette` の interface が2か所で別々に定義されている。将来ずれる余地がある | `recording.ts:44-56`、`cassette-store.ts:85-97` | なし |
| D5 | Low | `MockFixtureMissingError` の診断値。シナリオでは `nearest` が先頭5件のシナリオ ID で、「近いもの」ではない。fixture では `key` が `fixtureKey(kind, request)` で、HTTP の照合に実際に使うキー（`httpFixtureRequestKey`）と違う値になる。メッセージ本文には key がない（`details` にはある） | `resolve.ts:73-76`、`fixtures.ts:186-192` | なし。2.14 の「不足しているシナリオを示す」は `details.key` で満たしている |
| D6 | Trivial | Data Model は「Mock の fixture を JSON で保存する」と書いているが、シナリオは TS（`fixtures/scenarios/*.ts`。File Structure の plan.md:706-707 とは一致する） | `plan.md:442` | なし |
| D7 | Info | `ConfigError.missing[].variable` の型を `string` から `RequiredEnvVariable` に絞り込んでいる（互換性あり） | `load.ts:13-16` | なし |
| D8 | Info | `MODEL_DEFAULTS` を export しているが、plan の Public interface にはない | `catalog.ts:204` | なし |
| D9 | Info（C6 へのリスク） | `AI_MODEL_*` の明示指定は、カタログに実在するかだけを検査し、モード・プロバイダとの整合を検査しない（`local` で `AI_MODEL_CHAT=<live のモデル>` を受け付ける） | `load.ts:73-78,112-118` | 14.1 / 14.3 で扱う必要がある（現在のタスク本文には明記されていない） |
| D10 | Info | シナリオモデルの `modelId` は `mock:${purpose}` で、カタログの `mock:general-v1` と一致しない | `scenario-model.ts:125` | 14.1 で、メタデータにカタログの entry を使えば影響しない |
| D11 | Low（未決定） | `PlatformError` を export する公開サブパスがない（`./config` の `ConfigError`、`./ports` の `TranscriptSourceError`、`./mock` の `MockFixtureMissingError` だけ）。traceability.md の Gaps（T-6.1/6.3）は「T-21.1 までに決める」としているが、tasks-w4.md:21 の 21.1 の本文にはこの決定がない | `errors.ts`、`package.json:6-16` / `traceability.md:168` | **明示的な割り当てなし** |

---

## 3. do.md の「Ship Gate NO-GO: Spec Drift in Mock Runtime Contracts」（do.md:3003-3008）の解消の確認

| ずれの項目 | plan への反映 | コードとの一致 |
|---|---|---|
| 外部サービス fixture の `requestKey` と、HTTP の `request`（method、ヘッダーと body のダイジェスト）による同一性 | plan.md:167（C7「外部サービスの fixture の同一性」）、Data Model の plan.md:455-458 | `fixtures.ts:136-184,210-227`。テストは `recording.test.ts` の "replays recorded port fixtures with the original inputs and distinguishes HTTP bodies" |
| `CassetteStore` の保存キーの規則と v1 の Zod 検証 | plan.md:160 | `cassette-store.ts:14-15,23-83,104-123`。テストは `resolve.test.ts` の "rejects unsafe storage keys and supports concurrent writes to one cassette"、"validates cassette JSON at the filesystem boundary" |
| `recordingMiddleware` の第3引数 `options` | plan.md:161 | `recording.ts:58-62,190-199` |
| `./mock` の追加の公開 API | plan.md:168 | `mock/index.ts:1-50`（plan に列挙された名前はすべてある） |
| 境界: `fixtures/cassettes/**/.gitkeep` | plan.md:711、tasks.md:379（T-13）、tasks.md:410（T-13.6） | `fixtures/cassettes/{.gitkeep,llm,http,transcripts,web-search}/.gitkeep` の5ファイルがある |

結論: NO-GO で挙げた4項目と境界の修正は、plan とコードの両方に反映されている。ただし同じ C7 の Public interface の `createScenarioModel` のシグネチャ（D1）は、このときに揃えておらず、ずれが残っている。plan C7 の File Structure にある「同梱 fixture に曖昧な述語がないこと」（D3）も未実装のままである。

## 対応状況（2026-10-04）

- 対応済み
  - M-1〜M-4、D1、D3、D11（D11 は文書の決定だけを行い、`./errors` の export は T-21.1 で加える）。
  - RED / PROVE / gate の証拠は `specs/001-agentic-ai-platform/pdca/do.md` の「2026-10-04 W2 Validation Remediation」にある。
- D3 の検査の基準
  - 述語は部分文字列の AND なので、どの2つのターンも、両方の文字列を含む入力で同時に一致しうる。このため、同梱シナリオでも「曖昧さが一切ない」ことは検査として成り立たない。
  - そこで、各ターンの最小の要求がそのターン1つにだけ一致することを検査する。基準は plan C7 に明記した。
  - 「こんにちは、東京の天気は？」は、定義順で先にある `m1-2/chat` に解決される。これは plan の解決規則どおりである。
- 未対応（LOW / Info）
  - 監査の L-1〜L-8、D2、D4〜D10。
  - D9（明示指定したモデル ID と実行モード・プロバイダの整合）は、W3 の T-14.1 / T-14.3 で扱うことを推奨する（タスクの本文にはまだ書かれていない）。
