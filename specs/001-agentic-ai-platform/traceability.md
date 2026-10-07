# agentic-ai-platform（Milestone 1）— トレーサビリティ

`/sdd-tasks` が生成（骨格）し、`/sdd-analyze`（2026-09-27）の指摘を反映して更新した。2回目の `/sdd-analyze` の
H-1〜H-3、M-1〜M-4 と、3回目の H-1、M-1〜M-4、L-1〜L-3 も反映した。Test と Commit の列は
`/sdd-ship` が実装完了後に埋める。

ID 規約は `tasks.md` の「ID 対応表」を参照する（この spec の plan.md/spec.md は
`REQ-###`/`DES-#.#` の見出しを持たないため、`REQ-001`〜`REQ-007`・`NFR-01`〜`NFR-13` を
要件グループ／NFR単位の安定IDとして定義し、設計リンクには plan.md に実在する `C1`〜`C22` を
そのまま使う）。タスクは波ごとのファイル（`tasks.md`、`tasks-w2.md`〜`tasks-w5.md`、完了後は
`tasks-comp-w*.md`）に分かれているが、タスク番号は全ファイルで一意なので、番号だけで参照する。

- **Requirement**: spec.md の受け入れ基準番号（`X.Y`）または `NFR-##`
- **REQ-ID**: 上記の粗粒度な安定ID（要件グループ単位）
- **Design**: plan.md のコンポーネントID（`C1`〜`C22`）
- **Task**: タスクID（`T-#` は大タスク、`T-#.#` はサブタスク）
- **Test** / **Commit**: `/sdd-ship` が実装後に記入する

## Requirement 1: モノレポ基盤と品質ゲート

| Requirement | Design | Task | Test | Commit |
|---|---|---|---|---|
| 1.1 | C1, C13, C21 | T-1.2, T-7.1, T-8.1, T-8.2, T-8.3, T-19.1 | T-1.2: `mise run setup`、Turbo pnpm-workspace dry-run、T-7.1: `mise run setup`（frozen lockfile、eval-suite importer）・eval-suite `tsc --noEmit`、T-8.1〜T-8.3: `mise run setup`（frozen lockfile）・`mise run typecheck`（web `next typegen && tsc --noEmit`）・`pnpm peers check` | T-1.2: `10c3b48`、修正（T-1.2）: `01dc364`、T-7.1: `0f587c5`、T-8.1〜T-8.3: `1b456fb` |
| 1.2 | C1 | T-6.1, T-6.3 | T-6.1: `mise run setup`（frozen lockfile）、T-6.3: `errors.test.ts` 3件（UI 依存なしの ai-core から import） | T-6.1/T-6.3: `930f464` |
| 1.3 | C1 | T-1.1, T-1.2 | T-1.1: `mise tasks validate`（23件）、T-1.2: frozen install | T-1.1/T-1.2: `10c3b48`、修正（T-1.1/T-1.2）: `01dc364` |
| 1.4 | C1 | T-1.1, T-1.4, T-5.5, T-13.7, T-19.3, T-29.1 | T-1.1: 初期gate、T-1.4: Vitest/Stryker構造検査・`tsc`、T-5.5: W1 gate 4段・10/10反復、T-13.7: W2 gate に `typecheck` 段（tsconfig 4件の非空走査） | T-1.1: `10c3b48`、T-1.4: `ee05b10`、修正（T-1.1/T-1.4）: `01dc364`、T-5.5: `e18f7dd`、T-13.7: `f1713d3` |
| 1.5 | C1, C18 | T-4.1, T-29.2 | T-4.1: hermetic network guard 9件・API key不要のmock実行 | T-4.1: `2085577` |
| 1.6 | C1 | T-1.3 | unused-import 負例、`tsc --noEmit`、`mise run gate` | T-1.3: `10c3b48` |
| 1.7 | C2 | T-2.1, T-19.3, T-29.1 | T-2.1: CI構造検査、`ci-status` 成功/失敗シミュレーション | T-2.1: `f9e7aca`、修正（T-2.1）: `956b3df` |
| 1.8 | C3, C22 | T-3.1, T-3.2, T-28.5 | T-3.1: Compose構造34 assertion・6/6 healthy・Langfuse health/UI、T-3.2: 新規volumeでentrypoint自動実行・`vector`・カスタムDB・wiring PROVE | T-3.1/T-3.2: `dbf1300` |
| 1.9 | C4, C13 | T-12.2, T-12.4, T-20.2 | T-12.2: `feature-requirements.test.ts` 3件（全機能が1件以上・全変数がスキーマに存在・閉じた型）、T-12.4: `load.test.ts`（不足変数と機能名の列挙、`ConfigError` が `PlatformError`） | T-12.2/T-12.4: `5ca6a98` |
| 1.10 | C2, C13, C14, C16, C20 | T-20.1, T-21.1, T-25.2, T-29.1 |  |  |
| 1.11 | C1 | T-1.1, T-29.2 | T-1.1: offline lint-only gate（Docker/API key 不要） | T-1.1: `10c3b48` |
| 1.12 | C1, C18 | T-1.4, T-4.3 | T-1.4: test suffix include/exclude構成検査、T-4.3: 実行/skip理由/DB未実行件数7件 | T-1.4: `ee05b10`、修正（T-1.4）: `01dc364`、T-4.3: `2085577` |
| 1.13 | C6, C18, C21 | T-4.2, T-7.2, T-7.3, T-11.1, T-11.2, T-14.5, T-19.1, T-19.2 | T-4.2: local availability一時単体5件・globalSetup統合1件、T-7.2: eval-suite の `AI_TEST_SUITE` 選択の直接確認（空 gate は exit 1、空 local/pg は exit 0、未知値は読込時 exit 1）、T-7.3: README（レビューで確認）、T-11.1: `mock-models.test.ts` 3件（text / tool-call / object の generate・stream）、T-11.2: `local-only.test.ts` 6件（fake clock 再公開・`globalSetup` 登録・不可時の理由付き skip・既定の skip 理由・可時の実行・公開 helper の実行記録と `localAvailability` の照合）+ 公開 helper の実 Vitest 結線2件、T-14.5: `catalog.local.test.ts` 2件（`describeLocal`。既定モデルのツール呼び出しと構造化出力。gate では理由 `Local tests require AI_TEST_RUN_MODE=local.`、Ollama のない local レーンでは `Ollama is unavailable at …` で skip。`describe` に置き換えると2件とも `OllamaUnavailableError` で失敗する PROVE） | T-4.2: `2085577`、T-7.2/T-7.3: `0f587c5`、T-11.1/T-11.2: `cbb94bd`、`bdc1584`、T-14.5: `f671813` |
| 1.14 | C18, C21 | T-4.2, T-4.3, T-7.2, T-11.2, T-14.5, T-19.2, T-29.2 | T-4.2: 理由付きavailability、T-4.3: skip理由集計・全件skipのgate/local統合probe、T-7.2: eval-suite への `global-setup-local`・`gate-reporter` 登録（実テストでの確認は T-19.2）、T-11.2: `local-only.test.ts`（`describeLocal`/`itLocal` が gate で理由 `Local tests require AI_TEST_RUN_MODE=local.` 付き skip 2件、`gate-reporter` が理由別に集計）、T-14.5: `catalog.local.test.ts` の skip 2件を gate-reporter が理由別に集計 | T-4.2/T-4.3: `2085577`、T-7.2: `0f587c5`、T-11.2: `cbb94bd`、`bdc1584`、T-14.5: `f671813` |
| 1.15 | C1, C18, C19, C20 | T-1.4, T-4.3, T-5.2, T-5.4, T-5.5, T-13.7, T-19.3, T-25.3, T-29.1 | T-1.4: `passWithNoTests: false`・reporter登録、T-4.3: gate実行0件のexit 1、T-5.2: 9規則19件、T-5.4: count 4件、T-5.5: 各段件数・0件exit 1、T-13.7: W2 4規則・`count-tsc` の走査件数表示 | T-1.4: `ee05b10`、修正（T-1.4）: `01dc364`、T-4.3: `2085577`、T-5.2/T-5.4/T-5.5: `e18f7dd`、T-13.7: `f1713d3` |
| 1.16 | C1, C2, C18 | T-1.4, T-4.3, T-19.3, T-29.3 | T-1.4: Stryker対象・runner・閾値の構造検査、T-4.3: 集計/空実行/DB件数のPROVE 5種 | T-1.4: `ee05b10`、T-4.3: `2085577` |
| 1.17 | C2, C19 | T-25.1, T-25.3, T-26.1, T-26.2, T-27.1, T-27.2, T-29.1 |  |  |
| 1.18 | C1, C2 | T-1.5, T-2.1, T-29.3 | T-1.5: staged dummy secret rejection（redact）、T-2.1: `fetch-depth: 0`・`mise run secret-scan` | T-1.5: `d9cec30`、T-2.1: `f9e7aca` |
| 1.19 | C19 | T-26.3, T-27.3 |  |  |

## Requirement 2: LLM プロバイダと実行モード

| Requirement | Design | Task | Test | Commit |
|---|---|---|---|---|
| 2.1 | C4, C6 | T-12.1, T-14.1, T-14.4 | T-12.1: `env-schema.test.ts` 9件（既定値・型変換・不正値6件の拒否・キー一覧）、T-14.1: `gateway.test.ts`（`mock` / `local` / `live` の解決、`AI_MODEL_*` と要求の `modelId`）、T-14.4: 公開サブパス `@platform/ai-core/models` の型・値の import（一時テストで value export 17件を確認、未コミット） | T-12.1: `5ca6a98`、T-14.1: `c8b60e8`、T-14.4: `96450e6` |
| 2.2 | C5, C6 | T-9.2, T-14.1 | T-9.2: `catalog.test.ts` 7件（6プロバイダ・watsonx 除外）、T-14.1: `gateway.test.ts`（プロバイダファクトリの対応表で anthropic / openai / azure / google / ollama を生成） | T-9.1/T-9.2: `9b4631b`、T-14.1: `c8b60e8` |
| 2.3 | C6 | T-14.2, T-14.5 | T-14.2: `ollama-preflight.test.ts` 8件・`gateway.test.ts` の `local` の解決、T-14.5: `catalog.local.test.ts` 2件（理由付き skip） | T-14.2: `f633ca3`、T-14.5: `f671813` |
| 2.4 | C7 | T-13.1, T-13.2 | T-13.1: `request-key.test.ts` 4件（キー順・provider options 不変、prompt/tool/purpose で変化）、T-13.2: `scenario-model.test.ts` 3件（述語照合・生成/ストリーム・構造化出力） | T-13.1/T-13.2: `db707f9` |
| 2.5 | C4, C18 | T-4.1, T-12.3 | T-4.1: mock既定でfetch/net/dnsを遮断、T-12.3: `run-mode.test.ts`（`VITEST` 内は `AI_TEST_RUN_MODE ?? "mock"`、空文字は未設定） | T-4.1: `2085577`、T-12.3: `5ca6a98` |
| 2.6 | C6 | T-14.1 | T-14.1: `gateway.test.ts`（`ProviderCredentialsMissingError` のプロバイダ名と変数名、`local` で `live` 専用 ID の `ModelSelectionError`（D9）） | T-14.1: `c8b60e8` |
| 2.7 | C6 | T-14.2 | T-14.2: `ollama-preflight.test.ts` 8件（接続失敗・HTTP 状態・モデル未取得・`:latest` の正規化・成功のみ 5 秒キャッシュ・同時検査の共有・2 秒のタイムアウト）、`gateway.test.ts` の `OllamaUnavailableError`（接続先 URL と起動方法の案内） | T-14.2: `f633ca3` |
| 2.8 | C4, C5 | T-9.2, T-12.1 | T-9.2: `catalog.test.ts` 7件（用途別既定値の実在・機能一致）、T-12.1/T-12.4: 用途別モデルの env override と、カタログ外 ID の `ConfigError` | T-9.1/T-9.2: `9b4631b`、T-12.1/T-12.4: `5ca6a98` |
| 2.9 | C6 | T-14.3 | T-14.3: `gateway.test.ts`（`CapabilityUnsupportedError`、`purpose-mismatch`） | T-14.3: `1d8b91e` |
| 2.10 | C5, C6, C20, C22 | T-5.3, T-9.2, T-14.3, T-28.5 | T-5.3: registry fixture 4件（新build・24時間待機・AI SDK v7互換）、T-9.2: `catalog.test.ts`（provider 集合に watsonx なし）、T-14.3: `gateway.test.ts`（カタログのプロバイダだけを解決） | T-5.3: `e18f7dd`、T-9.2: `9b4631b`、T-14.3: `1d8b91e` |
| 2.11 | C18 | T-4.1 | T-4.1: fetch/net/dns/Resolver遮断・接続先error・local限定例外9件 | T-4.1: `2085577` |
| 2.12 | C4 | T-12.3 | T-12.3: `run-mode.test.ts` 4件（テストランナー内 `mock` 既定・通常 `local` 既定・空文字は未設定・不正値の拒否） | T-12.3: `5ca6a98` |
| 2.13 | C4, C6, C7, C13 | T-12.4, T-13.4, T-14.3, T-20.1 | T-12.4: `load.test.ts`（`AI_RECORD=1` + `mock` の拒否、`local` での録画許可）、T-13.4: `recording.test.ts` 8件（LLM と3種の外部サービスの伏せ字化、伏せ字化した Web 検索の hits のリテラル照合、実 factory での再生、キャンセル時の非保存）、T-14.3: `gateway.test.ts`（`config.recording` が真のときだけ録画を合成、`recordedWith` が実行モード、`config.credentials` 由来の伏せ字化） | T-12.4: `5ca6a98`、T-13.4: `db707f9`、`bdc1584`、T-14.3: `1d8b91e` |
| 2.14 | C7 | T-13.3 | T-13.3: `resolve.test.ts` 8件（シナリオ→カセット→`MockFixtureMissingError`、曖昧な述語、同梱シナリオの各ターンの最小の要求の一意性、保存キーの拒否、並行書き込み、v1 検証） | T-13.3: `db707f9`、`bdc1584` |
| 2.15 | C7, C10 | T-10.2, T-10.3, T-10.4, T-13.6 | T-10.2: `http.test.ts` 2件（写像・signal 伝播）、T-10.3: `transcript.test.ts` 23件（no-captions/private/fetch-failed・Zod 検証・中断）、T-10.4: `web-search.test.ts` 8件（SearchHit 写像・fail-closed・中断）、T-13.6: `fixtures.test.ts` 7件（手書き・録画 fixture の再生、未登録で `MockFixtureMissingError`、HTTP の method/body 区別） | T-10.2〜T-10.4: `fb60281`、T-13.6: `db707f9` |
| 2.16 | C7, C22 | T-13.5, T-28.7 | T-13.5: `deterministic-embedding.test.ts` 5件（決定性・次元数・L2 正規化） | T-13.5: `db707f9` |
| 2.17 | C5 | T-9.1, T-9.2 | T-9.2: `catalog.test.ts` 7件（整合性・Zod 非依存型） | T-9.1/T-9.2: `9b4631b` |
| 2.18 | C1, C4, C5, C20 | T-1.5, T-5.1, T-9.2, T-12.4 | T-1.5: pre-commit順序、T-5.1: モデルID検査5件・gate 13 files、T-5.5: pre-commit常時実行、T-9.2: 同梱カセットの `modelId` 照合、T-12.4: `load.test.ts`（カタログ外のモデル ID の拒否） | T-1.5: `d9cec30`、T-5.1/T-5.5: `e18f7dd`、T-9.2: `9b4631b`、T-12.4: `5ca6a98` |

## Requirement 3: ストリーミングチャット

| Requirement | Design | Task | Test | Commit |
|---|---|---|---|---|
| 3.1 | C15 | T-22.1, T-22.2 |  |  |
| 3.2 | C6, C15 | T-14.3, T-22.3 | T-14.3: `gateway.test.ts`（`availableModels` が現在の実行モードと認証情報のそろったプロバイダのモデルだけを返す。D9） | T-14.3: `1d8b91e` |
| 3.3 | C11, C15, C19 | T-17.2, T-22.1, T-27.2 | T-17.2: `adapt-history.test.ts` 22件（別プロバイダ・推論非対応での推論の除外、プロバイダ固有フィールドの除去（user パートは常に）、画像非対応モデルへの画像の置き換え、結果のないツール呼び出しの除外、承認系の状態の保持、入力を変えない。`convertToModelMessages` の出力に推論・署名・画像データが残らない） | T-17.2: `30bc262` |
| 3.4 | C15 | T-22.2 |  |  |
| 3.5 | C15 | T-22.1, T-22.2 |  |  |
| 3.6 | C15 | T-22.1, T-22.4 |  |  |
| 3.7 | C11, C15 | T-17.3, T-22.4 | T-17.3: `metadata.test.ts` 13件（モデル ID・表示名・プロバイダの写し、使用量の写し替え（キャッシュ読み出し・推論、報告された 0 の保持、未報告の合計は 0）、`start` で usage なし、JSON 化可能で凍結） | T-17.3: `6f7a049` |
| 3.8 | C13, C15 | T-20.1, T-20.3, T-22.1 |  |  |
| 3.9 | C6, C15 | T-14.3, T-22.1, T-22.3 | T-14.3: `gateway.test.ts`（要求機能に非対応のモデルを呼び出し前に拒否） | T-14.3: `1d8b91e` |
| 3.10 | C11, C15 | T-17.1, T-17.3, T-22.3 | T-17.1: `personas.test.ts` 23件（ID の一意性、semver、描画結果、未知の ID の `PlatformError`、凍結）、T-17.3: `request-schema.test.ts` 49件（chat / agent の両スキーマで未知のフィールド・カタログ外のモデル ID・未知のペルソナ ID・`system` ロールの拒否、`DefaultChatTransport` の `trigger`/`messageId` の受け付け、`./chat` の公開 API）、`metadata.test.ts`（`personaId`/`personaVersion`） | T-17.1: `a753e4b`、T-17.3: `6f7a049`、`175a05b` |
| 3.11 | C14, C15 | T-21.1, T-21.2, T-22.1 |  |  |

## Requirement 4: 構造化出力と要約パイプライン

| Requirement | Design | Task | Test | Commit |
|---|---|---|---|---|
| 4.1 | C12 | T-18.1, T-18.2 | T-18.1: `schema.test.ts` 47件（要点がちょうど3件、文字数・件数の上限、チャプターの必須化、要約リクエストの未知フィールドの拒否、YouTube のホストの検査）、T-18.2: `source.test.ts` 21件（記事・YouTube・字幕テキストの3種の入力） | T-18.1: `50653b6`、T-18.2: `e1b66ed` |
| 4.2 | C12 | T-18.2 | T-18.2: `source.test.ts`（13.6 の記事 fixture から Readability で本文を抽出、ナビゲーションだけの文書） | T-18.2: `e1b66ed` |
| 4.3 | C12 | T-18.1, T-18.6 | T-18.1: `schema.test.ts`（`summarySchema` と `summarySchemaFor`）、T-18.6: `pipeline.test.ts` 21件（`final` だけが検証済みの要約、`partial` の順序） | T-18.1: `50653b6`、T-18.6: `ecb35bf` |
| 4.4 | C12 | T-18.5 | T-18.5: `retry.test.ts` 7件（1回目・2回目の失敗後の成功、3回失敗で全試行の issues を持つ `SummaryValidationError`、`restart` イベント、前回の issues の引き継ぎ）、`schema.test.ts`（`SummaryValidationError` の `code` が `output-invalid`） | T-18.5: `bc0f92d`、修正（T-18.1/T-18.5）: `1367ee4` |
| 4.5 | C12, C17 | T-18.6, T-24.2 | T-18.6: `pipeline.test.ts`（`partial` → `final` → `meta` の順序、`chunkSize` のある streamed シナリオで複数の `partial`） | T-18.6: `ecb35bf` |
| 4.6 | C12 | T-18.3 | T-18.3: `plan.test.ts` 9件（80% の境界で `whole`／超過で `staged`、安全係数 1.2、出力予約 4096、長い行の強制分割、チャンクの詰め方、最小予算 256 未満の `capability-unsupported`） | T-18.3: `1d33288` |
| 4.7 | C12, C17 | T-18.2, T-24.1 | T-18.2: `source.test.ts`（HTTP 失敗・空本文で `SourceFetchError`、LLM を呼ばない。中断の再 throw、`PlatformError` の素通し） | T-18.2: `e1b66ed` |
| 4.8 | C12, C17 | T-18.4, T-18.6, T-24.3 | T-18.4: `cache-policy.test.ts` 15件（`anthropic` は先頭のソースパートだけに `cacheControl`、自動系は記録のみ、`ollama`・`mock` はなし、カタログの `promptCache: "none"` を優先、再送でソースパートが変わらない、`</source>` の無害化）、T-18.6: `pipeline.test.ts`（キャッシュ読み出し量の記録。指定のないプロバイダでは記録しない） | T-18.4: `ff72071`、T-18.6: `ecb35bf` |
| 4.9 | C12 | T-18.2 | T-18.2: `source.test.ts`（字幕テキストの直接入力の受け付け） | T-18.2: `e1b66ed` |
| 4.10 | C12, C17 | T-18.1, T-18.6, T-24.3 | T-18.1: `schema.test.ts`（時刻付きのソースでチャプターが1件以上）、T-18.6: `pipeline.test.ts`（`fixture:summary-chapters` の YouTube ソースでチャプターを生成） | T-18.1: `50653b6`、T-18.6: `ecb35bf` |
| 4.11 | C12, C17 | T-18.2, T-24.1, T-24.3 | T-18.2: `source.test.ts`（字幕なし・非公開・取得失敗を `TranscriptUnavailableError` に写像、空の segment の除外、LLM を呼ばない） | T-18.2: `e1b66ed` |
| 4.12 | C12, C17 | T-18.3, T-18.6, T-24.3 | T-18.3: `plan.test.ts`（判断に用いた推定トークン数の記録）、T-18.6: `pipeline.test.ts`（`meta` の戦略・チャンク数・全呼び出しの入力トークンの合計） | T-18.3: `1d33288`、T-18.6: `ecb35bf` |

## Requirement 5: ツール呼び出しと ToolLoopAgent

| Requirement | Design | Task | Test | Commit |
|---|---|---|---|---|
| 5.1 | C8, C16 | T-16.3, T-16.4, T-23.1, T-23.2 | T-16.3: `guarded-agent.test.ts` 23件（シナリオモデルでツール呼び出しの反復、ツール数20は可・21は `ConfigError`、生の `ToolSet` は `@ts-expect-error`）、T-16.4: 公開サブパス `@platform/ai-core/agents`（一時の probe で export の一覧と `expectTypeOf` を確認、未コミット。17.3 の `metadata.ts` と 19.1 の回帰テストが公開サブパスから import） | T-16.3: `2140b87`、T-16.4: `18990d7` |
| 5.2 | C9 | T-15.3, T-15.4, T-15.5 | T-15.3: `calculator.test.ts` 34件（優先順位・右結合のべき乗・括弧・0 除算・ネストの上限・不正な式のエラー結果）、`tools.test.ts` の現在時刻3件（fake Clock）、T-15.4: `tools.test.ts`（為替・天気・Web 検索）、T-15.5: 公開サブパス `@platform/ai-core/aci` の import（一時テストで runtime export 22件を確認、未コミット。19.1 の回帰テストも公開サブパスから import） | T-15.3: `65e0f16`、T-15.4: `ab7a569`、T-15.5: `e5dd66b` |
| 5.3 | C9 | T-15.4 | T-15.4: `tools.test.ts` 25件（Open-Meteo の fixture・HTTP 状態・signal の伝播、Web 検索の fixture プロバイダと最大5件、レート表の検証） | T-15.4: `ab7a569` |
| 5.4 | C9, C16 | T-15.2, T-23.1, T-23.4 | T-15.2: `tool-set.test.ts` 10件（キー未設定の Web 検索が `disabled` に入り `requiredEnv: ["TAVILY_API_KEY"]`、`read-only` 以外の拒否、`GuardedToolSet` の型と凍結） | T-15.2: `c7cfd13` |
| 5.5 | C16 | T-23.2, T-23.3 |  |  |
| 5.6 | C8, C11, C16 | T-16.3, T-17.3, T-23.4 | T-16.3: `guarded-agent.test.ts`（`toolsCalled` が呼び出し順・重複込み、知識のみの回答で空、`finish` だけに `run` のメタデータ）、T-17.3: `metadata.test.ts`（`toolsCalled` をトップレベルに置く。明示の値を優先、`run` から、ツールなしの回答で `[]`、素のチャットではキーなし） | T-16.3: `2140b87`、T-17.3: `6f7a049` |
| 5.7 | C9, C10 | T-10.1, T-15.3 | T-10.1: `clock.test.ts` 3件（fake の決定論的進行・期限での `TimeoutError`）、T-15.3: `tools.test.ts`（現在時刻ツールが注入した Clock を使う。`Date.now()` に置き換えると2件失敗する PROVE） | T-10.1: `fb60281`、T-15.3: `65e0f16` |
| 5.8 | C9 | T-15.1 | T-15.1: `define-tool.test.ts` 22件（例外・タイムアウトのツール結果化、`ToolExecutionError` の summary/nextAction、想定外の例外の message を出さない） | T-15.1: `90bc262` |

## Requirement 6: ループ制御と強制停止条件

| Requirement | Design | Task | Test | Commit |
|---|---|---|---|---|
| 6.1 | C4, C8, C22 | T-12.1, T-16.1, T-16.3, T-28.6 | T-12.1: `env-schema.test.ts`（停止条件の既定値 10 / 50,000 / 120,000 / 15,000 と正の整数検証）、T-16.1: `stop-conditions.test.ts` 18件（`stepLimit`・`tokenBudget`・`deadline` の境界値（ちょうど上限・1つ手前）、run ごとの新しい記録、正の整数の検証）、T-16.3: `guarded-agent.test.ts`（step-limit・token-budget・fake Clock の経過、応答しない LLM 呼び出しの `timeout`、`LoopLimits` の 0・-1・1.5・NaN の拒否） | T-12.1: `5ca6a98`、T-16.1: `0fb44ee`、T-16.3: `2140b87` |
| 6.2 | C8, C16 | T-16.2, T-16.3, T-23.1, T-23.4 | T-16.2: `stop-reason.test.ts` 14件（6種の停止理由と各優先順位の組）、T-16.3: `guarded-agent.test.ts`（completed・step-limit・token-budget・timeout・aborted・error の通し実行） | T-16.2: `265f6ec`、T-16.3: `2140b87` |
| 6.3 | C8, C15, C16 | T-16.3, T-22.1, T-23.1, T-23.4 | T-16.3: `guarded-agent.test.ts`（呼び出し元の停止で `aborted`、生成前に中断済みのシグナル、中断後の `onError` が中断理由を保つ） | T-16.3: `2140b87` |
| 6.4 | C4, C9, C13, C16 | T-15.1, T-15.2, T-20.1, T-23.1 | T-15.1: `define-tool.test.ts`（実効タイムアウト `min(定義, runtime)` の3通り、呼び出し元の中断の伝播）、T-15.2: `tool-set.test.ts`（`runtime.toolTimeoutMs` と `runtime.clock` が全ツールに届く） | T-15.1: `90bc262`、T-15.2: `c7cfd13` |
| 6.5 | C8 | T-16.3 | T-16.3: `guarded-agent.test.ts`（停止時のステップ数、`cacheRead`・`reasoning` を含むトークンの合計、並行する2実行の `steps`・`toolsCalled`・`elapsedMs` の分離、確定1回・observer 1回・凍結） | T-16.3: `2140b87` |

## Requirement 7: モジュール解説ドキュメント

| Requirement | Design | Task | Test | Commit |
|---|---|---|---|---|
| 7.1 | C22 | T-28.3 |  |  |
| 7.2 | C22 | T-28.2, T-28.4, T-28.5, T-28.6, T-28.7 |  |  |
| 7.3 | C22 | T-28.2, T-28.4, T-28.5, T-28.6, T-28.7 |  |  |
| 7.4 | C22 | T-28.2, T-28.4, T-28.5, T-28.6, T-28.7 |  |  |
| 7.5 | C22 | T-28.2, T-28.4, T-28.5, T-28.6, T-28.7 |  |  |
| 7.6 | C22 | T-28.1, T-28.5, T-28.6, T-28.7 |  |  |
| 7.7 | C22 | T-28.3 |  |  |
| 7.8 | C22 | T-28.4 |  |  |
| 7.9 | C22 | T-28.1, T-28.2, T-28.4, T-28.5, T-28.6, T-28.7 |  |  |
| 7.10 | C22 | T-28.2, T-28.4, T-28.5, T-28.6, T-28.7 |  |  |
| 7.11 | C22 | T-14.6, T-23.5, T-24.4, T-28.2, T-29.4 | T-14.6: 注釈付きタグ `module/1-1`（ローカル。対象 `f671813`、メッセージに含むもの・含まないものを列挙。push は T-29.4） | T-14.6: タグ対象 `f671813` |

## Non-Functional Requirements

本 spec の NFR は spec 001〜004 すべてに適用する横断要件。M1（本 spec）のタスクが担う部分のみ
Task 列に記載する。

| Requirement | Design | Task | Test | Commit |
|---|---|---|---|---|
| NFR-01（検証速度） | C1 | T-29.2 |  |  |
| NFR-02（決定性） | C1, C7 | T-13.1, T-13.2, T-29.2 | T-13.1/T-13.2: 同一入力で同一キー・同一応答 | T-13.1/T-13.2: `db707f9` |
| NFR-03（オフライン動作） | C7, C18 | T-4.1, T-13.6, T-29.2 | T-4.1: mock hermetic network guard 9件、T-13.6: fixture のオフライン再生（ネットワーク非フォールバック） | T-4.1: `2085577`、T-13.6: `db707f9` |
| NFR-04（ストリーミング応答性） | C19 | T-26.3, T-27.4 |  |  |
| NFR-05（型安全性） | C1 | T-1.3, T-6.3 | T-1.3: TypeScript 7.1 strict root typecheck、T-6.3: 閉じた `PlatformErrorCode` の tuple/union 完全一致・ai-core `tsc --noEmit` | T-1.3: `10c3b48`、修正（T-1.3）: `01dc364`、T-6.3: `930f464` |
| NFR-06（テストカバレッジ） | C18 | T-6.2 | T-6.2: gate の行80%閾値（101% で失敗する PROVE）、`local`/`pg` の0件許可、`test:coverage` の閾値なし HTML レポート | T-6.2: `930f464` |
| NFR-07（秘密情報） | C1, C4 | T-1.5, T-12.1, T-12.4 | T-1.5: names-only env・gitleaks redact、T-12.1/T-12.4: 秘密変数は任意の空値で配布、`.env.example` と schema のキー一致・無編集テンプレートの読み込み | T-1.5: `d9cec30`、修正（T-1.5）: `01dc364`、T-12.1/T-12.4: `5ca6a98` |
| NFR-08（隔離実行） | — | **未割当（下記 Gaps 参照）** |  |  |
| NFR-09（アクセシビリティ） | C13, C19 | T-8.3, T-20.4, T-26.3, T-27.3 | T-8.3: `scripts/check-web-theme.test.mjs`（23件。light/dark の text 4.5:1、border/input/ring 3:1、不透明 focus outline） | T-8.3: `1b456fb` |
| NFR-10（対応ブラウザ） | C19 | T-26.1, T-27.1, T-27.2 |  |  |
| NFR-11（サプライチェーン） | C1, C2 | T-1.2, T-1.5, T-2.1, T-2.2 | T-1.2: frozen lockfile、T-1.5: staged secret hook、T-2.1: SHA/permissions/frozen setup、T-2.2: Dependabot構造検査 | T-1.2: `10c3b48`、T-1.5: `d9cec30`、修正（T-1.2）: `01dc364`, `9418a09`、T-2.1/T-2.2: `f9e7aca`、修正（T-2.1）: `956b3df` |
| NFR-12（UI言語） | C13, C22 | T-20.3, T-28.2 |  |  |
| NFR-13（コスト可視化） | C5 | T-9.2 | T-9.2: `catalog.test.ts` 7件（`estimateCost`、`live` の単価必須） | T-9.1/T-9.2: `9b4631b` |

## Gaps

- 2026-10-07 の `/sdd-ship`（T-18.1〜T-18.6）では、要件ギャップは検出しなかった。ai-core の gate テストに `src/summarize` の6ファイル 120件（`schema` 47、`source` 21、`cache-policy` 15、`plan` 9、`retry` 7、`pipeline` 21）が加わり、`src/summarize` の行カバレッジは100%（分岐 88.2%）。`PlatformErrorCode` に「出力がスキーマを満たさない」を表すコードがなく `SummaryValidationError` が `provider-unavailable` を使っていたため、`output-invalid` を語彙に加えて使うよう修正した（`1367ee4`。HTTP の写像は 502）。spec drift として、plan C12 の `streamSummary(plan, deps)` の `deps`、追加の公開 API（`summarizeSource`、`summarySchemaFor`、`parseYoutubeVideoId` 等）、v7 が system メッセージを `messages` に置けないことによるプロンプトの形、分割と予算の具体値、`SummaryMeta` の集計の範囲を、plan C12・Data Model・HTTP API・Error Handling に記録した。`jsdom` の `createRequire` での読み込みは Next/Turbopack では未確認（`serverExternalPackages` には含まれる。T-24 で確認する）。チャンクが非常に多いときの統合プロンプトの予算は検査していない。
- 2026-10-07 の `/sdd-ship`（T-17.1〜T-17.3）では、要件ギャップは検出しなかった。ai-core の gate テストに `src/chat` の4ファイル 107件（`personas` 23、`adapt-history` 22、`metadata` 13、`request-schema` 49）が加わり、`src/chat` の行カバレッジは100%（分岐 98.24%）。spec drift として、plan の `POST /api/chat` の本文（4フィールドの `z.strictObject`）では `DefaultChatTransport` が既定で付ける `trigger`・`messageId` のために既定の `useChat` の送信がすべて 400 になることを検出し、2フィールドを任意で受け付けるよう HTTP API の表を改めた。plan C11（`PersonaVars`・`PERSONA_IDS`・`isPersonaId`・`DEFAULT_PERSONA_ID`、`adaptHistoryForModel` の規則、`buildResponseMetadata` の `persona`・`disabledTools`・任意の `usage`、エンベロープだけの検査と `validateUIMessages`）、Data Model の応答メタデータ（`usage` の省略、`toolsCalled` の行）、C15 の Route の注意、research.md ADR-7（結果のないツール呼び出しの除外、生成元の判定）を実装に合わせた。`metadata.provider` はクライアントが改ざんできる値であり、画像以外のファイルはそのまま送られる（plan C11 の制約に記録。対応が要るかは T-22 で判断する）。
- 2026-10-07 の `/sdd-ship`（T-16.1〜T-16.4）では、要件ギャップは検出しなかった。ai-core の gate テストに `src/agents` の3ファイル 55件（`stop-conditions` 18、`stop-reason` 14、`guarded-agent` 23）が加わり、`src/agents` の行カバレッジは100%（`guarded-agent.ts` の分岐 88.09%）。spec drift として、AI SDK v7 では UI ストリームの `finish` が `onEnd` より先に届き、中断は `onError` ではなく `abort` パートで通知されるため、plan C8 と research.md ADR-6 のサマリの確定経路（「`onEnd` または `onError` の先に呼ばれた方」）が実装と食い違っていた。plan C8（停止条件の引数、`createRunStopConditions`、`StopReasonInput`、確定経路、`GuardedAgent` の追加のメンバー、公開 API）、Data Model（`AgentRunSummary.error`）、ADR-6 を改訂した。`guarded.agent.generate()` / `.stream()` を直接呼んでエラーになると `done` が解決しないこと、`streamText` の既定のエラー処理が生のエラーを `console.error` に出すことは、T-23.1（C16 の Route）で扱う。
- 2026-10-07 の `/sdd-ship`（T-15.1〜T-15.5）では、要件ギャップは検出しなかった。ai-core の gate テストに `src/aci` の4ファイル 91件（`define-tool` 22、`tool-set` 10、`calculator` 34、`tools` 25）が加わり、`src/aci` の行カバレッジは100%。spec drift として、plan C9 に未定義だった `ToolAvailability`（`FeatureId` → boolean と `requiredFeature`）、`AnyAciTool`・`BuiltToolSet`・`GuardedToolSet<TOOLS>` の形、中断とエラーのツール結果化の規則、`ConfigError` の対象、ツール名と天気の入力・URL、追加の公開 API を、plan C9 と Error Handling に記録した。Web 検索ツールはキーがなくても `WebSearchProvider` を要する（T-20.1 の `platform.ts` が渡す）。`rates.json` の `with { type: "json" }` を Next/Turbopack でビルドできるかは T-20 以降で確認する。
- 2026-10-07 の `/sdd-ship`（T-14.1〜T-14.6）では、要件ギャップは検出しなかった。W2 から引き継いだ D9（明示指定したモデル ID と実行モードの整合）は T-14.1 / T-14.3 で `ModelSelectionError` として実装し、plan C6（`GatewayDeps`・`ModelOption`・検査の順序・エラー）、Error Handling、File Structure を実装に合わせた。ai-core の gate テストは 114件から150件に増えた（`gateway.test.ts` 28件、`ollama-preflight.test.ts` 8件。`catalog.local.test.ts` 2件は理由付き skip）。`gateway.ts` の未到達の分岐（`withRecording` の中の `mode === "mock"`。設定が `mock` での録画を禁じるための防御）が1つ残る。`module/1-1` のタグはローカルにだけあり、push と再作成は T-29.4 で行う。
- 2026-10-04 の W2 `/sdd-validate-impl` と `/sdd-ship` では、要件ギャップは検出しなかった（追跡できない AC は0件）。非空虚性の監査で見つかった fake pass 2件と PROVE の欠落2件、同梱シナリオの曖昧な述語の検査がないこと（D3）を `bdc1584` で修正し、ai-core の gate テストは110件から114件に増えた（lines 94.05%、branches 78.47%）。plan C7 の `createScenarioModel` のシグネチャ（D1）と曖昧さの検査の基準を、実装に合わせて書き直した。`PlatformError` は新設の `./errors` サブパスから公開すると決めた（D11）。追加は T-21.1 で行う。明示指定したモデル ID と実行モード・プロバイダの整合（D9）は、T-14.1 / T-14.3 で扱う。
- 2026-09-30 の `/sdd-ship`（T-13.1〜T-13.7）では、要件ギャップは検出しなかった。ai-core の gate テストは77件から110件に増え（skip 2件は理由付き）、`src/mock` の行カバレッジは92.21%（ai-core 全体 94.05%）。W2 の敵対的レビュー（`.sdd/reviews/001-agentic-ai-platform-impl-w2-review-2026-09-30*.md`、Round 3 APPROVE）の修正で加わった契約（外部サービス fixture の `requestKey` と HTTP の method・ヘッダー・body による同一性、カセットの保存キー規則と v1 の Zod 検証、`recordingMiddleware` の `options`、`./mock` の公開 API）を spec drift として検出し、承認を得て plan C7・Data Model・File Structure を実装に合わせた。`fixtures/cassettes/` の種類別 `.gitkeep` 4件が境界外と判定されたため、T-13・T-13.6 の `_Boundary:_` を `fixtures/cassettes/**/.gitkeep` に広げた。W2 gate に `typecheck` 段と4規則を結線し、W2 の移行（archive / promote）は続くコミットで行う。
- 2026-09-30 の `/sdd-ship`（T-12.1〜T-12.4）では、要件ギャップは検出しなかった。ai-core の gate テストは53件から77件に増え、`src/config` の行カバレッジは94.73%（`run-mode.ts` 100%、`load.ts` 92.3%）。1回目の ship で `.env.example`（全変数が空値）の無編集コピーが `resolveRunMode` の生の `ZodError` で失敗する不具合を検出して NO-GO とし、`/sdd-impl` で空文字を未設定として扱う修正と、スキーマ検証を実行モード解決より先に行う順序変更（+3 tests、PROVE 済み）を加えた。spec drift として空文字の扱いと検証順序が plan C4 に記述されていなかったため、承認を得て plan C4 を実装に合わせた。`instrumentation.ts` での `ConfigError` 整形出力は T-20.2 で確認する。
- 2026-09-29 の `/sdd-ship`（T-11.1〜T-11.2）では、要件ギャップは検出しなかった。ai-core の gate テストは46件から53件に増え（skip 2件は理由付き）、`src/testing` の行カバレッジは100%（分岐83.33%）。VDD レビュー（`.sdd/reviews/agentic-ai-platform-11.md`、Round 2 APPROVE）の指摘により、`packages/ai-core/vitest.config.ts` への `global-setup-local` 登録を T-11・T-11.2 の `_Boundary:_` と plan C18・File Structure に加えた。T-4.2 から引き継いだ受け取り側 skip の恒久テストはこの ship で充足し、Ollama 停止時の統合確認は T-29.2 に残る。available 分岐の公開 helper 実行は `mise run test:local` で確認する。
- 2026-09-28 の `/sdd-ship`（T-10.1〜T-10.4）では、要件ギャップは検出しなかった。ai-core の gate テストは10件から46件に増え、`src/ports` の行カバレッジは97.14%（分岐87.67%）。spec drift として、plan C10 に記述のなかった失敗の契約（`TranscriptSourceError` の公開、Tavily の `source-unavailable` と fail-closed）、注入用の省略可能な引数、Tavily SDK の HTTP 要求が中断されない制約を検出し、承認を得て plan C10 を実装に合わせた。C12 の `TranscriptUnavailableError` への写像は T-18.1 以降で、実 YouTube の文言（"Private video"）の確認は C7 の録画で行う。
- 2026-09-28 の `/sdd-ship`（T-9.1〜T-9.2）では、要件ギャップは検出しなかった。ai-core の gate テストは3件から10件に増え、`catalog.ts` の行カバレッジは100%（分岐は82.35%）。spec drift として、plan C5 の ModeDefault が provider ごとに全用途を必須としていた点（Anthropic・Azure には埋め込みモデルがない）と、`ModelId` をリテラル union としていた点を検出し、承認を得て plan を実装（用途は `Partial`、`ModelId = string` とリテラル union の `CatalogModelId` の分離）に合わせた。同梱カセットの `modelId` 照合は、カセットを追加する T-11 以降で実データに対して働く。
- 2026-09-28 の `/sdd-ship`（T-8.1〜T-8.3）では、新しい要件・設計ギャップは検出しなかった。root の gate テストは234件から257件へ23件（`check-web-theme.test.mjs`）増加した。`vite-tsconfig-paths` を Vite 8 native `resolve.tsconfigPaths` に置き換えた設計変更は、plan・research に反映済みである。focus ring の computed style のコントラストは T-27.3 のブラウザ検査に、Web の Vitest execution unit の実テストでの確認は T-21.1 に引き継ぐ。
- 2026-09-28 の `/sdd-ship`（T-7.1〜T-7.3）では、新しい要件・設計ギャップは検出しなかった。eval-suite はテスト0件のため `test` スクリプトを置かず gate の実行単位に入らない（T-19.1 で最初のテストと同時に加える）。7.2 の構成は suite 別の直接実行で確認し、実テストでの確認は T-19.1・T-19.2 に引き継ぐ。敵対的レビューの LOW（README の `*.db.test.ts` 欠落）は修正済み。
- 2026-09-28 の `/sdd-ship`（T-6.1〜T-6.3）では、新しい要件・設計ギャップは検出しなかった。ai-core の gate テストは0件から3件に増え、`errors.ts` の行カバレッジは100%（6/6）。`/sdd-validate-impl` で `pnpm-lock.yaml` が境界外と判定されたため、T-6・T-7・T-8 と T-6.1・T-7.1・T-8.1 の `_Boundary:_` に加えた。`test:coverage` のスクリプト文面を plan C18 と mise タスク表（閾値の強制は gate の `test` 段）に合わせて `--coverage.thresholds.lines=0` 付きにそろえた（T-6.3、T-19.1、T-21.1）。`PlatformError` をどの公開サブパスから再 export するかは T-21.1 までに決める（2026-10-04 の W2 `/sdd-validate-impl` で、新設の `./errors` に決定。追加は T-21.1 で行う）。
- 2026-09-27 の `/sdd-ship`（T-5.1〜T-5.5）では、新しい要件・設計ギャップは検出しなかった。恒久テストは16件から48件へ32件増加し、新規スクリプト5ファイルのstatement coverageは合計84.50%。W1 gateは4段すべてで非空件数を表示し、10/10回同じ成功判定だった。`mise run test:coverage`のworkspace taskはW2のT-6.3以降で結線されるため現時点では0 taskであり、ship検証ではroot Vitestを直接coverage実行した。
- 2026-09-27 の `/sdd-ship`（T-4.1〜T-4.3）では、新しい要件・設計ギャップは検出しなかった。hermetic network guard、local availability、gate reporterを20件のship検証（恒久16件 + T-4.2一時4件）と行カバレッジ93.56%で確認した。T-4.2の恒久的な受け取り側skipテストとOllama停止時統合確認は、承認済みタスクどおりT-11.2/T-29.2へ引き継ぐ。
- 2026-09-27 の `/sdd-ship`（T-3.1〜T-3.2）では、新しい要件・設計ギャップは検出しなかった。Composeは6サービスのhealthy状態とLangfuse UI/health、Postgresは新規volumeからのinit SQL自動実行・`vector`・カスタムLangfuse DBを実測した。Rancher Desktopの`/Users/Shared` mount手順は端末ローカルのGit除外memoryにのみ保存した。
- 2026-09-27 の `/sdd-ship`（T-2.1〜T-2.2）では、新しい要件・設計ギャップは検出しなかった。PR の `ci-status` と GitHub Insights の Dependabot 設定確認は、設定を push した後のホスト側検証として残る。
- 2026-09-27 の `/sdd-ship`（T-1.1〜T-1.3）では、新しい要件・設計ギャップは検出しなかった。`pnpm-lock.yaml` は T-1.2 の frozen install を成立させる派生成物として追跡する（2026-09-27 の `/sdd-validate-impl` で境界外と判定し、T-1・T-1.2 の `_Boundary:_` と plan のルートの表に加えた）。
- 2026-09-27 の `/sdd-ship`（T-1.4〜T-1.5）でも新しい要件・設計ギャップは検出しなかった。Vitest hook と mutation の実行検証は、承認済みタスクどおり T-4.1/T-4.3/T-29.3 へ引き継ぐ。
- **NFR-08（隔離実行）は M1 に意図的な未割当**: plan.md の Requirements Traceability が明記する
  とおり「M1には該当する機能がない（003、004で適用）」。M1 には LLM 生成コードを実行する機能
  （データ分析、長時間実行ハーネス）が存在しないため、対応するタスクを割り当てていない。003
  （データ分析エージェント）と 004（長時間実行ハーネス）の tasks.md がこの NFR を引き継ぐ。
- 受け入れ基準（1.1〜7.11、計84件）は全件サブタスクに割り当て済み（100%）。大タスクだけに割り当てた
  受け入れ基準はない（2026-09-27 の `/sdd-analyze` M-4 で 3.3 と 5.6 をサブタスクへ割り当てた）。
- タスク側に対応する要件のないタスク（orphan task）はなし。全タスクの `_Requirements:_` は
  spec.md の受け入れ基準または本ファイルの NFR-## のいずれかに対応する。
- 2026-09-27 の再構成で削除・統合したタスク番号: T-3.3（`.env.example` の編集は T-1.5 に集約）、
  T-9.3（T-9.2 にテストを統合）。T-14.1〜T-14.5 と T-16.3・T-16.4 は内容を組み替えた（テスト先行のため）。
  新設: T-5.5、T-13.7、T-19.3（各波の gate の結線）、T-14.5（`catalog.local.test.ts`）、T-29.4（完成タグ）。
- 2回目の `/sdd-analyze`（2026-09-27）での変更: T-14.6・T-23.5・T-24.4（各モジュールの完了時点の完成タグ）を
  新設し、T-29.4 をタグの検証と push に改めた（H-2）。CI のジョブを波ごとに加えるため、T-2.1 から 1.10・1.16 を
  外し、`mutation` を T-19.3、`e2e`・`client-bundle` を T-29.1 に移した（H-1）。tasks.md の「完了した波の移行手順」に `.sdd/reviews/` の波ごとの
  敵対的レビューを移行条件に加えた（H-3。要件ではなく constitution 原則 9 の手続きのため、本表の行はない）。
- 3回目の `/sdd-analyze`（2026-09-27）での変更: テストの実行単位をワークスペースごとに固定し、ルートの
  `vitest.config.ts` は `tooling/`・`scripts/` だけを対象にした（H-1。T-1.2、T-1.4、T-6.2、T-7.2、T-8.3）。
  ai-core の `test` スクリプトを T-6.3 で加える（M-4）。`count-tsc` の手段を実測で確定する（M-2。T-5.4）。
  `createGuardedAgent` の `tools` を `buildToolSet` の戻り値 `GuardedToolSet` に限った（M-3。T-15.1、T-15.2、
  T-16.3。constitution 原則 6 の手続きのため、本表の行は変えていない）。T-8.1 に `babel-plugin-react-compiler`
  と `jsdom` を加えた（M-1）。NFR-10・NFR-12 の割り当てを大タスクからサブタスクに改めた（L-2）。
- 2026-09-27 の `/sdd-validate-impl`（Task 2）: PR #2 の `ci-status` が `a00f581` で成功し、Dependabot の設定検証チェックも成功した（T-2.1・T-2.2 のホスト側検証を充足。Insights での確認は main へのマージ後）。T-2.1 の `audit` を通すための `qs` の override（`9418a09`）は T-1.2 の境界内の修正として追跡する。`ci.yml` に `persist-credentials: false`、ジョブごとの `timeout-minutes`、PR の古い実行を取り消す `concurrency` を加えた。
- 2026-09-27 の `/sdd-validate-impl`（Task 1）: Vitest の CLI フィルタが `exclude` を戻せないため `test:local`・`test:db` が対象を実行できない欠陥と、Turborepo の strict env モードで `OLLAMA_BASE_URL` がテストに渡らない欠陥を検出した。`AI_TEST_SUITE` によるテストの選択（plan C18）と `turbo.json` の `env` で解消した。影響するタスクの記述（T-4.3、T-5.5、T-6.2、T-7.2、T-8.3）も更新した。
- 2026-09-27 の `/sdd-validate-impl`（Task 1 の再検証）: `turbo.json` に `test:coverage` がなく `mise run test:coverage` が失敗する欠陥を検出し、T-1 の境界内で追加した。各ワークスペースの `test:coverage` スクリプトは、`test` スクリプトと同時に T-6.3（ai-core）・T-19.1（eval-suite）・T-21.1（apps/web）が加える（同日の検証の W-2 で割り当てた。各タスクの `_Boundary:_` は対象の `package.json` を含むため変更なし）。
