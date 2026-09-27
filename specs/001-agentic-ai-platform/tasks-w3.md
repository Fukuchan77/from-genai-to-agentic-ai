# agentic-ai-platform（Milestone 1）— 実装タスク W3: ai-core の機能（大タスク 14〜19）

未着手の波。表記規約、ID 対応表、進捗、gate と CI の段階的な結線、完了した波の移行手順は [tasks.md](tasks.md) を参照する。
W2 の完了後に、本ファイルの本文を `tasks.md` の「現在の波」へ移し、本ファイルは削除する。

14、15、16、18 は並列に進められる。ただし 16.3 は 15.2 の後に行う（`GuardedToolSet` を使うため）。17 は 16 の後、19 は 14〜18 の後に行う。14.6（`module/1-1` のタグ）は 14.5 の直後に付ける。

---

## 14. ModelGateway（C6）(P)

用途とモデルIDから、実行モードに応じた `LanguageModel`/`EmbeddingModel` を返す。返す前に認証情報・
接続・機能対応を検査する。各サブタスクは `gateway.test.ts` にテストを先に足してから実装する。

_Boundary:_ `packages/ai-core/src/models/providers.ts`, `packages/ai-core/src/models/ollama-preflight.ts`, `packages/ai-core/src/models/ollama-preflight.test.ts`, `packages/ai-core/src/models/gateway.ts`, `packages/ai-core/src/models/errors.ts`, `packages/ai-core/src/models/index.ts`, `packages/ai-core/src/models/gateway.test.ts`, `packages/ai-core/src/models/catalog.local.test.ts`
_Depends:_ 9, 11, 12, 13
_Requirements:_ 1.13, 1.14, 2.1, 2.2, 2.3, 2.6, 2.7, 2.9, 2.10, 2.13, 3.2, 3.9, 7.11
_Traces:_ REQ-001, REQ-002, REQ-003, REQ-007, C6, C22

- [ ] 14.1 `models/errors.ts`・`providers.ts`・`gateway.ts`: エラー型（`ProviderCredentialsMissingError`・`OllamaUnavailableError`・`CapabilityUnsupportedError`）、プロバイダファクトリの対応表（anthropic/openai/azure/google/`ollama-ai-provider-v2`）、`createModelGateway` の `resolve` の骨格（`mock` はシナリオモデル、`live` は認証情報を検査してから生成）+ `gateway.test.ts`（モード別の解決、`ProviderCredentialsMissingError` のプロバイダ名と変数名、ネットワークなしで `mock` が動く）
  _Boundary:_ `packages/ai-core/src/models/errors.ts`, `packages/ai-core/src/models/providers.ts`, `packages/ai-core/src/models/gateway.ts`, `packages/ai-core/src/models/gateway.test.ts`
  _Depends:_ 9, 12, 13
  _Requirements:_ 2.1, 2.2, 2.6
  _Traces:_ REQ-002, C6
- [ ] 14.2 `models/ollama-preflight.ts`: `GET {baseUrl}/api/tags` による接続とモデル取得済みの事前検査（短時間キャッシュ）+ `ollama-preflight.test.ts`、`gateway.ts` の `local` の解決 + `gateway.test.ts` に `OllamaUnavailableError`（接続先 URL と起動方法の案内）を追加
  _Boundary:_ `packages/ai-core/src/models/ollama-preflight.ts`, `packages/ai-core/src/models/ollama-preflight.test.ts`, `packages/ai-core/src/models/gateway.ts`, `packages/ai-core/src/models/gateway.test.ts`
  _Depends:_ 14.1
  _Requirements:_ 2.3, 2.7
  _Traces:_ REQ-002, C6
- [ ] 14.3 `gateway.ts`: 機能への対応の検査（`CapabilityUnsupportedError`）、`resolveEmbedding`、`availableModels`（認証情報のそろったプロバイダだけ）、録画時だけの `recordingMiddleware` の合成 + `gateway.test.ts` に各ケースを追加
  _Boundary:_ `packages/ai-core/src/models/gateway.ts`, `packages/ai-core/src/models/gateway.test.ts`
  _Depends:_ 14.2
  _Requirements:_ 2.9, 2.10, 2.13, 3.2, 3.9
  _Traces:_ REQ-002, REQ-003, C6
- [ ] 14.4 `models/index.ts`: `./models` の公開API（クライアントへ渡すのは Zod を含まない型だけ）
  _Boundary:_ `packages/ai-core/src/models/index.ts`
  _Depends:_ 14.3
  _Requirements:_ 2.1
  _Traces:_ REQ-002, C6
  _Verify:_ 17・19・20 のテストが公開サブパス `@platform/ai-core/models` から import して通る
- [ ] 14.5 `models/catalog.local.test.ts`: `local` 限定で、既定モデルが実際にツール呼び出しと構造化出力に応答することを確認する（`describeLocal`。Ollama がなければ理由付きでスキップ）
  _Boundary:_ `packages/ai-core/src/models/catalog.local.test.ts`
  _Depends:_ 14.4, 11
  _Requirements:_ 1.13, 1.14, 2.3
  _Traces:_ REQ-001, REQ-002, C6, C18
- [ ] 14.6 完成タグ `module/1-1`: モジュール 1-1（Req 1、2 のリファレンス実装: モノレポ基盤、品質ゲート、実行モード、モデルカタログ、ゲートウェイ、モック）が完了した統合ブランチのコミットに、注釈付きタグをローカルで付ける（plan C22）。タグの push は 29.4 で人間の承認後に行う
  _Boundary:_ git タグのみ（ファイルの変更なし）
  _Depends:_ 1〜13, 14.1, 14.2, 14.3, 14.4, 14.5
  _Requirements:_ 7.11
  _Traces:_ REQ-007, C22
  _Verify:_ タグのコミットで `mise run gate`（その時点の構成）が成功する。タグのメッセージに、そのコミットに含まれる後続モジュールの途中の実装（並列に進めた 15〜18）を列挙する

### Implementation Notes

---

## 15. AciToolkit とサンプルツール（C9）(P)

ツール定義の共通規約（リスク区分、タイムアウト、エラーのツール結果化、Clock 注入）と M1 の
サンプルツールを提供する。`TAVILY_API_KEY` は 1.5 の `.env.example` に含まれる。

_Boundary:_ `packages/ai-core/src/aci/types.ts`, `packages/ai-core/src/aci/define-tool.ts`, `packages/ai-core/src/aci/tool-set.ts`, `packages/ai-core/src/aci/tools/current-time.ts`, `packages/ai-core/src/aci/tools/calculator.ts`, `packages/ai-core/src/aci/tools/currency.ts`, `packages/ai-core/src/aci/tools/rates.json`, `packages/ai-core/src/aci/tools/weather.ts`, `packages/ai-core/src/aci/tools/web-search.ts`, `packages/ai-core/src/aci/index.ts`, `packages/ai-core/src/aci/define-tool.test.ts`, `packages/ai-core/src/aci/tool-set.test.ts`, `packages/ai-core/src/aci/tools/calculator.test.ts`, `packages/ai-core/src/aci/tools/tools.test.ts`
_Depends:_ 10, 12, 13
_Requirements:_ 5.2, 5.3, 5.4, 5.7, 5.8, 6.4
_Traces:_ REQ-005, REQ-006, C9

- [ ] 15.1 (P) `aci/types.ts`・`define-tool.ts`: `ToolRisk`・`ToolOutcome`・`ToolFailure`・`ToolRuntime`（`clock`、`toolTimeoutMs`）・`GuardedToolSet`（`unique symbol` のブランド型。plan C9）・`defineAciTool`（`AciTool` を返す。AI SDK の `Tool` への変換は `ToolRuntime` を受け取って行い、実効のタイムアウトは `min(definition.timeoutMs ?? runtime.toolTimeoutMs, runtime.toolTimeoutMs)`、中断は `AbortSignal.any([options.abortSignal, runtime.clock.timeoutSignal(実効値)])` で合成する。例外とタイムアウトのツール結果化）+ テスト（fake Clock で、実効タイムアウトの選択（定義なし・定義が短い・定義が長い）、タイムアウトと例外のツール結果化、呼び出し元の中断の伝播）
  _Boundary:_ `packages/ai-core/src/aci/types.ts`, `packages/ai-core/src/aci/define-tool.ts`, `packages/ai-core/src/aci/define-tool.test.ts`
  _Depends:_ 10
  _Requirements:_ 5.8, 6.4
  _Traces:_ REQ-005, REQ-006, C9
- [ ] 15.2 `aci/tool-set.ts`: `buildToolSet(tools, availability, runtime: ToolRuntime)`（`runtime` で各 `AciTool` を AI SDK の `Tool` に変換し、`GuardedToolSet` として返す。無効化ツールの一覧、`risk` が `read-only` 以外は `ConfigError` で拒否）+ テスト（`runtime.toolTimeoutMs`（`AGENT_TOOL_TIMEOUT_MS` 由来）と `runtime.clock` が全ツールに届くこと、戻り値が `GuardedToolSet` であること）
  _Boundary:_ `packages/ai-core/src/aci/tool-set.ts`, `packages/ai-core/src/aci/tool-set.test.ts`
  _Depends:_ 15.1, 12
  _Requirements:_ 5.4
  _Traces:_ REQ-005, C9
- [ ] 15.3 `aci/tools/current-time.ts`・`calculator.ts`: 現在時刻ツール（Clock 注入）と再帰下降パーサの計算ツール（`eval` を使わない）+ `calculator.test.ts`
  _Boundary:_ `packages/ai-core/src/aci/tools/current-time.ts`, `packages/ai-core/src/aci/tools/calculator.ts`, `packages/ai-core/src/aci/tools/calculator.test.ts`
  _Depends:_ 15.1
  _Requirements:_ 5.2, 5.7
  _Traces:_ REQ-005, C9
- [ ] 15.4 `aci/tools/currency.ts`・`rates.json`・`weather.ts`・`web-search.ts`: 為替・天気（Open-Meteo）・Web検索（Tavily、キー未設定時は登録しない）ツール + `tools.test.ts`（fake Clock と 13.6 の fixture 実装を使う）
  _Boundary:_ `packages/ai-core/src/aci/tools/currency.ts`, `packages/ai-core/src/aci/tools/rates.json`, `packages/ai-core/src/aci/tools/weather.ts`, `packages/ai-core/src/aci/tools/web-search.ts`, `packages/ai-core/src/aci/tools/tools.test.ts`
  _Depends:_ 10, 13, 15.1
  _Requirements:_ 5.2, 5.3
  _Traces:_ REQ-005, C9
- [ ] 15.5 `aci/index.ts`: `./aci` の公開API集約
  _Boundary:_ `packages/ai-core/src/aci/index.ts`
  _Depends:_ 15.2, 15.3, 15.4
  _Requirements:_ 5.2
  _Traces:_ REQ-005, C9
  _Verify:_ 19.1 と 23.1 のテストが公開サブパス `@platform/ai-core/aci` から import して通る

### Implementation Notes

---

## 16. GuardedAgent（C8）(P)

3種の停止条件と停止理由を必ず持つ `ToolLoopAgent` を生成し、実行サマリを返す。

_Boundary:_ `packages/ai-core/src/agents/stop-conditions.ts`, `packages/ai-core/src/agents/stop-reason.ts`, `packages/ai-core/src/agents/guarded-agent.ts`, `packages/ai-core/src/agents/index.ts`, `packages/ai-core/src/agents/stop-conditions.test.ts`, `packages/ai-core/src/agents/stop-reason.test.ts`, `packages/ai-core/src/agents/guarded-agent.test.ts`
_Depends:_ 11, 12, 13（16.3 は 15.2 にも依存する）
_Requirements:_ 5.1, 5.6, 6.1, 6.2, 6.3, 6.5
_Traces:_ REQ-005, REQ-006, C8

- [ ] 16.1 (P) `agents/stop-conditions.ts`: `stepLimit`（`isStepCount` ラッパ）・`tokenBudget`・`deadline`（Clock 経過）+ テスト（境界値: ちょうど上限、上限の1つ手前）
  _Boundary:_ `packages/ai-core/src/agents/stop-conditions.ts`, `packages/ai-core/src/agents/stop-conditions.test.ts`
  _Depends:_ 11
  _Requirements:_ 6.1
  _Traces:_ REQ-006, C8
- [ ] 16.2 `agents/stop-reason.ts`: `deriveStopReason`（優先順位: `aborted`→`error`→成立した停止条件→`completed`）+ テスト（6種の網羅）
  _Boundary:_ `packages/ai-core/src/agents/stop-reason.ts`, `packages/ai-core/src/agents/stop-reason.test.ts`
  _Depends:_ 16.1
  _Requirements:_ 6.2
  _Traces:_ REQ-006, C8
- [ ] 16.3 `agents/guarded-agent.ts`・`guarded-agent.test.ts`: `createGuardedAgent`（1回の実行に束縛、`tools` は 15.2 の `GuardedToolSet` だけを受け付ける、ツール数20超で `ConfigError`、`abortSignal = AbortSignal.any([signal, timeoutSignal])` の合成、`onStepEnd`/`onEnd`/`onError` によるサマリの1回だけの確定、`RunObserver.onRunEnd`）。テストはシナリオモデル（13）で、ツール呼び出しの反復、知識のみの回答（ツールを呼ばず `toolsCalled` が空）、並行する2実行の状態分離、ツール数21件での生成拒否、生の `ToolSet` を `tools` に渡すと型エラーになること（`@ts-expect-error`）、応答しないLLM呼び出しの `timeout` 化、学習者の停止による `aborted`、サマリ確定が1回だけであることを検証する
  _Boundary:_ `packages/ai-core/src/agents/guarded-agent.ts`, `packages/ai-core/src/agents/guarded-agent.test.ts`
  _Depends:_ 16.2, 15.2, 12, 13
  _Requirements:_ 5.1, 5.6, 6.1, 6.2, 6.3, 6.5
  _Traces:_ REQ-005, REQ-006, C8
- [ ] 16.4 `agents/index.ts`: `./agents` の公開API
  _Boundary:_ `packages/ai-core/src/agents/index.ts`
  _Depends:_ 16.3
  _Requirements:_ 5.1
  _Traces:_ REQ-005, C8
  _Verify:_ 17.3・19.1・23.1 のテストが公開サブパス `@platform/ai-core/agents` から import して通る

### Implementation Notes

---

## 17. ChatCore（C11）

ペルソナのテンプレート、モデル切り替え時の履歴変換、応答メタデータの組み立てを提供する。

_Boundary:_ `packages/ai-core/src/chat/personas/index.ts`, `packages/ai-core/src/chat/personas/general-assistant.ts`, `packages/ai-core/src/chat/personas/python-mentor.ts`, `packages/ai-core/src/chat/personas/strict-reviewer.ts`, `packages/ai-core/src/chat/adapt-history.ts`, `packages/ai-core/src/chat/metadata.ts`, `packages/ai-core/src/chat/request-schema.ts`, `packages/ai-core/src/chat/index.ts`, `packages/ai-core/src/chat/adapt-history.test.ts`, `packages/ai-core/src/chat/personas/personas.test.ts`, `packages/ai-core/src/chat/metadata.test.ts`, `packages/ai-core/src/chat/request-schema.test.ts`
_Depends:_ 9, 16
_Requirements:_ 3.3, 3.7, 3.10, 5.6
_Traces:_ REQ-003, REQ-005, C11

- [ ] 17.1 (P) `chat/personas/*`: 汎用アシスタント・Python講師・厳密レビュアの3テンプレート（`id`/`version`/`title`/`render`）+ テスト（ID一意性、版の形式、描画結果）
  _Boundary:_ `packages/ai-core/src/chat/personas/index.ts`, `packages/ai-core/src/chat/personas/general-assistant.ts`, `packages/ai-core/src/chat/personas/python-mentor.ts`, `packages/ai-core/src/chat/personas/strict-reviewer.ts`, `packages/ai-core/src/chat/personas/personas.test.ts`
  _Depends:_ 9
  _Requirements:_ 3.10
  _Traces:_ REQ-003, C11
- [ ] 17.2 (P) `chat/adapt-history.ts`: `adaptHistoryForModel`（推論・プロバイダ固有メタデータ・非対応画像の除外・変換、表示用履歴は変えない）+ テスト
  _Boundary:_ `packages/ai-core/src/chat/adapt-history.ts`, `packages/ai-core/src/chat/adapt-history.test.ts`
  _Depends:_ 9
  _Requirements:_ 3.3
  _Traces:_ REQ-003, C11
- [ ] 17.3 `chat/metadata.ts`・`request-schema.ts`・`index.ts`: `buildResponseMetadata`、`chatRequestSchema`/`agentRequestSchema`（`z.strictObject`）、`./chat` の公開API + `metadata.test.ts`（使用量の写し替え、`run` と `toolsCalled` の有無）・`request-schema.test.ts`（未知フィールド・カタログ外のモデル ID・未知のペルソナ ID の拒否）
  _Boundary:_ `packages/ai-core/src/chat/metadata.ts`, `packages/ai-core/src/chat/metadata.test.ts`, `packages/ai-core/src/chat/request-schema.ts`, `packages/ai-core/src/chat/request-schema.test.ts`, `packages/ai-core/src/chat/index.ts`
  _Depends:_ 17.1, 17.2, 16
  _Requirements:_ 3.7, 3.10, 5.6
  _Traces:_ REQ-003, REQ-005, C11

### Implementation Notes

---

## 18. SummaryPipeline（C12）(P)

記事URL・YouTube URL・字幕テキストから本文を取得し、分割の要否を判断して、スキーマ検証済みの
要約オブジェクトを逐次生成する。

_Boundary:_ `packages/ai-core/src/summarize/schema.ts`, `packages/ai-core/src/summarize/schema.test.ts`, `packages/ai-core/src/summarize/source.ts`, `packages/ai-core/src/summarize/tokens.ts`, `packages/ai-core/src/summarize/plan.ts`, `packages/ai-core/src/summarize/cache-policy.ts`, `packages/ai-core/src/summarize/cache-policy.test.ts`, `packages/ai-core/src/summarize/prompts.ts`, `packages/ai-core/src/summarize/retry.ts`, `packages/ai-core/src/summarize/pipeline.ts`, `packages/ai-core/src/summarize/errors.ts`, `packages/ai-core/src/summarize/index.ts`, `packages/ai-core/src/summarize/source.test.ts`, `packages/ai-core/src/summarize/plan.test.ts`, `packages/ai-core/src/summarize/retry.test.ts`, `packages/ai-core/src/summarize/pipeline.test.ts`
_Depends:_ 9, 10, 11, 13
_Requirements:_ 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 4.12
_Traces:_ REQ-004, C12

- [ ] 18.1 `summarize/schema.ts`・`errors.ts`: 要約スキーマ（`title`/`keyPoints`ちょうど3件/`tags`/`actionItems`/`chapters?`）、`summarizeRequestSchema`（`z.strictObject`）と `SourceFetchError`・`TranscriptUnavailableError`・`SummaryValidationError` + `schema.test.ts`（要点が3件でない、上限超過、要約リクエストの未知フィールドの拒否）
  _Boundary:_ `packages/ai-core/src/summarize/schema.ts`, `packages/ai-core/src/summarize/schema.test.ts`, `packages/ai-core/src/summarize/errors.ts`
  _Depends:_ 9
  _Requirements:_ 4.1, 4.3, 4.10
  _Traces:_ REQ-004, C12
- [ ] 18.2 `summarize/source.ts`: 記事本文抽出（`@mozilla/readability` + `jsdom`）、YouTube URL 解析と字幕取得、字幕テキストの直接入力の受付 + テスト（13.6 の fixture 実装で、HTTP失敗・空本文・字幕なしでLLMを呼ばないこと）
  _Boundary:_ `packages/ai-core/src/summarize/source.ts`, `packages/ai-core/src/summarize/source.test.ts`
  _Depends:_ 18.1, 10, 13
  _Requirements:_ 4.1, 4.2, 4.7, 4.9, 4.11
  _Traces:_ REQ-004, C12
- [ ] 18.3 (P) `summarize/tokens.ts`・`plan.ts`: `gpt-tokenizer` によるトークン推定（安全係数1.2）と全文/分割の判断（コンテキスト上限の80%境界）+ テスト
  _Boundary:_ `packages/ai-core/src/summarize/tokens.ts`, `packages/ai-core/src/summarize/plan.ts`, `packages/ai-core/src/summarize/plan.test.ts`
  _Depends:_ 18.1
  _Requirements:_ 4.6, 4.12
  _Traces:_ REQ-004, C12
- [ ] 18.4 (P) `summarize/cache-policy.ts`・`prompts.ts`: プロバイダ別のプロンプトキャッシュ指定方法（`anthropic`明示/自動系は記録のみ/`ollama`・`mock`はなし）と要約・部分要約・統合のプロンプト + `cache-policy.test.ts`
  _Boundary:_ `packages/ai-core/src/summarize/cache-policy.ts`, `packages/ai-core/src/summarize/cache-policy.test.ts`, `packages/ai-core/src/summarize/prompts.ts`
  _Depends:_ 18.1
  _Requirements:_ 4.8
  _Traces:_ REQ-004, C12
- [ ] 18.5 (P) `summarize/retry.ts`: スキーマ検証失敗時の最大2回までの再生成 + テスト（1回目・2回目の成功、3回目失敗時のエラー内容）
  _Boundary:_ `packages/ai-core/src/summarize/retry.ts`, `packages/ai-core/src/summarize/retry.test.ts`
  _Depends:_ 18.1
  _Requirements:_ 4.4
  _Traces:_ REQ-004, C12
- [ ] 18.6 `summarize/pipeline.ts`・`index.ts`: `streamSummary`（`partial`/`restart`/`final`/`meta` のイベント列、`final` だけを検証済み要約として扱う）+ テスト（13.6 の `m1-3` シナリオと 11 のモックモデルで、部分オブジェクトの順序、チャプターの生成、キャッシュ読み出し量の記録）
  _Boundary:_ `packages/ai-core/src/summarize/pipeline.ts`, `packages/ai-core/src/summarize/index.ts`, `packages/ai-core/src/summarize/pipeline.test.ts`
  _Depends:_ 18.2, 18.3, 18.4, 18.5, 11, 13
  _Requirements:_ 4.3, 4.5, 4.8, 4.10, 4.12
  _Traces:_ REQ-004, C12

### Implementation Notes

---

## 19. 評価スイート: 回帰テストと Capability の例（C21 続き）

M1 のツールエージェントの通し実行を回帰として検証し、`local` 限定の品質評価の適用例を1件置く。
W3 の締めとして gate を結線する。

_Boundary:_ `packages/eval-suite/package.json`, `packages/eval-suite/tests/regression/tool-agent-run.test.ts`, `packages/eval-suite/tests/capability/summary-quality.local.test.ts`, `mise.toml`, `.github/workflows/ci.yml`
_Depends:_ 7, 9, 13, 15, 16, 18（19.3 は 14、17 にも依存する）
_Requirements:_ 1.1, 1.4, 1.7, 1.13, 1.14, 1.15, 1.16
_Traces:_ REQ-001, C21, C1, C2

- [ ] 19.1 `tests/regression/tool-agent-run.test.ts`: `mock` シナリオでツールエージェントを最後まで実行し、停止理由・ツール呼び出し列・最終回答の Outcome を回帰として検証する。`packages/eval-suite/package.json` に `test` スクリプトを加える
  _Boundary:_ `packages/eval-suite/tests/regression/tool-agent-run.test.ts`, `packages/eval-suite/package.json`
  _Depends:_ 7, 13, 15, 16
  _Requirements:_ 1.1, 1.13
  _Traces:_ REQ-001, C21
- [ ] 19.2 `tests/capability/summary-quality.local.test.ts`: `local` 限定で要約が3件の要点を持つことを実モデルで確認する例
  _Boundary:_ `packages/eval-suite/tests/capability/summary-quality.local.test.ts`
  _Depends:_ 7, 18, 11
  _Requirements:_ 1.13, 1.14
  _Traces:_ REQ-001, C21
- [ ] 19.3 W3 の締め: `mise.toml` の `gate` に W3 の規則を、`ci.yml` に `mutation` ジョブ（`mise run test:mutation`）と `ci-status` の `needs` を加える（[tasks.md](tasks.md)「gate と CI の段階的な結線」）
  _Boundary:_ `mise.toml`, `.github/workflows/ci.yml`
  _Depends:_ 14, 15, 16, 17, 18, 19.1, 19.2
  _Requirements:_ 1.4, 1.7, 1.15, 1.16
  _Traces:_ REQ-001, C1, C2
  _Verify:_ `mise run gate` が成功し、`tool-risk-declared` が走査件数を出力する。gate-reporter が `*.local.test.ts` を理由付きのスキップとして数える。`mise run test:mutation` がローカルで閾値（70）を満たし、PR の `ci-status` が `mutation` を含めて成功する

### Implementation Notes
