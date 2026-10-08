# agentic-ai-platform（Milestone 1）— 完了した実装タスク W3: ai-core の機能（大タスク 14〜19）

完了した波（2026-10-07 に移行）。表記規約、ID 対応表、進捗、gate と CI の段階的な結線、完了した波の移行手順は
[tasks.md](tasks.md) を参照する。波の敵対的レビューの記録は
`.sdd/reviews/001-agentic-ai-platform-impl-w3-review-2026-10-07.md`（第1ラウンド）、`-r2.md`（第2ラウンド）、
`-r3.md`（第3ラウンド、APPROVE）。

14、15、16、18 は並列に進められる。ただし 16.3 は 15.2 の後に行う（`GuardedToolSet` を使うため）。17 は 16 の後、19 は 14〜18 の後に行う。14.6（`module/1-1` のタグ）は 14.5 の直後に付ける。

---

## 14. ModelGateway（C6）(P)

用途とモデルIDから、実行モードに応じた `LanguageModel`/`EmbeddingModel` を返す。返す前に認証情報・
接続・機能対応を検査する。各サブタスクは `gateway.test.ts` にテストを先に足してから実装する。

_Boundary:_ `packages/ai-core/src/models/providers.ts`, `packages/ai-core/src/models/ollama-preflight.ts`, `packages/ai-core/src/models/ollama-preflight.test.ts`, `packages/ai-core/src/models/gateway.ts`, `packages/ai-core/src/models/errors.ts`, `packages/ai-core/src/models/index.ts`, `packages/ai-core/src/models/gateway.test.ts`, `packages/ai-core/src/models/catalog.local.test.ts`
_Depends:_ 9, 11, 12, 13
_Requirements:_ 1.13, 1.14, 2.1, 2.2, 2.3, 2.6, 2.7, 2.9, 2.10, 2.13, 3.2, 3.9, 7.11
_Traces:_ REQ-001, REQ-002, REQ-003, REQ-007, C6, C22

- [x] 14.1 `models/errors.ts`・`providers.ts`・`gateway.ts`: エラー型（`ProviderCredentialsMissingError`・`OllamaUnavailableError`・`CapabilityUnsupportedError`）、プロバイダファクトリの対応表（anthropic/openai/azure/google/`ollama-ai-provider-v2`）、`createModelGateway` の `resolve` の骨格（`mock` はシナリオモデル、`live` は認証情報を検査してから生成）。解決するカタログの entry の `modes` に現在の実行モードが含まれることを検査し、含まれなければ拒否する（`AI_MODEL_*` で明示指定した ID も対象。C4 の `loadPlatformConfig` はカタログに実在するかだけを検査するため。2026-10-04、W2 `/sdd-validate-impl` の D9。エラーの型は実装時に決めて plan C6 に記録する）+ `gateway.test.ts`（モード別の解決、`ProviderCredentialsMissingError` のプロバイダ名と変数名、ネットワークなしで `mock` が動く、`local` で `live` 専用の ID を `AI_MODEL_CHAT` に指定すると拒否する）
  _Boundary:_ `packages/ai-core/src/models/errors.ts`, `packages/ai-core/src/models/providers.ts`, `packages/ai-core/src/models/gateway.ts`, `packages/ai-core/src/models/gateway.test.ts`
  _Depends:_ 9, 12, 13
  _Requirements:_ 2.1, 2.2, 2.6
  _Traces:_ REQ-002, C6
- [x] 14.2 `models/ollama-preflight.ts`: `GET {baseUrl}/api/tags` による接続とモデル取得済みの事前検査（短時間キャッシュ）+ `ollama-preflight.test.ts`、`gateway.ts` の `local` の解決 + `gateway.test.ts` に `OllamaUnavailableError`（接続先 URL と起動方法の案内）を追加
  _Boundary:_ `packages/ai-core/src/models/ollama-preflight.ts`, `packages/ai-core/src/models/ollama-preflight.test.ts`, `packages/ai-core/src/models/gateway.ts`, `packages/ai-core/src/models/gateway.test.ts`
  _Depends:_ 14.1
  _Requirements:_ 2.3, 2.7
  _Traces:_ REQ-002, C6
- [x] 14.3 `gateway.ts`: 機能への対応の検査（`CapabilityUnsupportedError`）、`resolveEmbedding`、`availableModels`（現在の実行モードを `modes` に含み、認証情報のそろったプロバイダのものだけ。D9）、録画時だけの `recordingMiddleware` の合成 + `gateway.test.ts` に各ケースを追加
  _Boundary:_ `packages/ai-core/src/models/gateway.ts`, `packages/ai-core/src/models/gateway.test.ts`
  _Depends:_ 14.2
  _Requirements:_ 2.9, 2.10, 2.13, 3.2, 3.9
  _Traces:_ REQ-002, REQ-003, C6
- [x] 14.4 `models/index.ts`: `./models` の公開API（クライアントへ渡すのは Zod を含まない型だけ）
  _Boundary:_ `packages/ai-core/src/models/index.ts`
  _Depends:_ 14.3
  _Requirements:_ 2.1
  _Traces:_ REQ-002, C6
  _Verify:_ 17・19・20 のテストが公開サブパス `@platform/ai-core/models` から import して通る
- [x] 14.5 `models/catalog.local.test.ts`: `local` 限定で、既定モデルが実際にツール呼び出しと構造化出力に応答することを確認する（`describeLocal`。Ollama がなければ理由付きでスキップ）
  _Boundary:_ `packages/ai-core/src/models/catalog.local.test.ts`
  _Depends:_ 14.4, 11
  _Requirements:_ 1.13, 1.14, 2.3
  _Traces:_ REQ-001, REQ-002, C6, C18
- [x] 14.6 完成タグ `module/1-1`: モジュール 1-1（Req 1、2 のリファレンス実装: モノレポ基盤、品質ゲート、実行モード、モデルカタログ、ゲートウェイ、モック）が完了した統合ブランチのコミットに、注釈付きタグをローカルで付ける（plan C22）。タグの push は 29.4 で人間の承認後に行う
  _Boundary:_ git タグのみ（ファイルの変更なし）
  _Depends:_ 1〜13, 14.1, 14.2, 14.3, 14.4, 14.5
  _Requirements:_ 7.11
  _Traces:_ REQ-007, C22
  _Verify:_ タグのコミットで `mise run gate`（その時点の構成）が成功する。タグのメッセージに、そのコミットに含まれる後続モジュールの途中の実装（並列に進めた 15〜18）を列挙する

### Implementation Notes

- D9 のモード検査は `ModelSelectionError`（`code: "invalid-request"`、`reason` は `unknown-model` / `mode-mismatch` / `no-default` / `purpose-mismatch`）で拒否する。`AI_MODEL_*` の ID も要求の `modelId` も、`resolve` の最初の検査で同じように扱う。検査の順序は、カタログと実行モード → 機能（2.9）→ 認証情報（2.6）→ Ollama の事前検査（2.7）とし、すべてモデル生成の前に行う。このため、`local` で `live` 専用の ID を指定しても Ollama へは接続しない。
- Ollama の事前検査は、成功した `/api/tags` の一覧だけを 5 秒キャッシュする。失敗はキャッシュしないので、`ollama serve` を起動すれば次の要求で回復する。同時に来た検査は1回の取得を共有し、タイムアウトは注入した `Clock` の `timeoutSignal(2000)` で付ける。`OLLAMA_BASE_URL` は末尾の `/api` の有無をどちらも受け付け、`ollama-ai-provider-v2` には `${server}/api` を渡す。
- 録画は `config.recording` が真のときだけ `wrapLanguageModel` で合成する（`recordedWith` は実行モード、時刻は `Clock` から取る）。既定の `Redactor` は `process.env` ではなく `config.credentials` から作る（C4 の「`process.env` を読むのは既定引数の1か所」を守るため）。埋め込みは録画の対象外とした（カセットの形式が LanguageModel 専用のため）。
- 14.6: 注釈付きタグ `module/1-1` を 14.5 の統合コミット `f671813` にローカルで付けた（メッセージは「module/1-1: reference implementation of module 1-1 (Req 1, 2)」に続けて、含むもの（タスク 1〜13、14.1〜14.5）、並列に進めた後続モジュールの途中の実装は W2 以外なし、含まないもの（C19 の E2E、C22 の解説）、29.4 で人間の承認後に push する旨）。作業環境は使い捨てのためタグは失われうる。29.4 は同じコミットと同じメッセージで作り直す。`f671813` を `main` に残すため、W3 の PR はマージコミットで取り込む（squash / rebase しない）。local 限定のテスト（14.5 の `catalog.local.test.ts`、19.2 の `summary-quality.local.test.ts`）は、クラウドの作業環境に Ollama がないため理由付きのスキップしか確認しておらず、実 Ollama では未実行である。29.4 でタグを push する前に `mise run test:local` を実 Ollama で実行し、修正が必要になればタグを付け直す（W3 敵対的レビュー r1 の LOW）。

---

## 15. AciToolkit とサンプルツール（C9）(P)

ツール定義の共通規約（リスク区分、タイムアウト、エラーのツール結果化、Clock 注入）と M1 の
サンプルツールを提供する。`TAVILY_API_KEY` は 1.5 の `.env.example` に含まれる。

_Boundary:_ `packages/ai-core/src/aci/types.ts`, `packages/ai-core/src/aci/define-tool.ts`, `packages/ai-core/src/aci/tool-set.ts`, `packages/ai-core/src/aci/tools/current-time.ts`, `packages/ai-core/src/aci/tools/calculator.ts`, `packages/ai-core/src/aci/tools/currency.ts`, `packages/ai-core/src/aci/tools/rates.json`, `packages/ai-core/src/aci/tools/weather.ts`, `packages/ai-core/src/aci/tools/web-search.ts`, `packages/ai-core/src/aci/index.ts`, `packages/ai-core/src/aci/define-tool.test.ts`, `packages/ai-core/src/aci/tool-set.test.ts`, `packages/ai-core/src/aci/tools/calculator.test.ts`, `packages/ai-core/src/aci/tools/tools.test.ts`
_Depends:_ 10, 12, 13
_Requirements:_ 5.2, 5.3, 5.4, 5.7, 5.8, 6.4
_Traces:_ REQ-005, REQ-006, C9

- [x] 15.1 (P) `aci/types.ts`・`define-tool.ts`: `ToolRisk`・`ToolOutcome`・`ToolFailure`・`ToolRuntime`（`clock`、`toolTimeoutMs`）・`GuardedToolSet`（`unique symbol` のブランド型。plan C9）・`defineAciTool`（`AciTool` を返す。AI SDK の `Tool` への変換は `ToolRuntime` を受け取って行い、実効のタイムアウトは `min(definition.timeoutMs ?? runtime.toolTimeoutMs, runtime.toolTimeoutMs)`、中断は `AbortSignal.any([options.abortSignal, runtime.clock.timeoutSignal(実効値)])` で合成する。例外とタイムアウトのツール結果化）+ テスト（fake Clock で、実効タイムアウトの選択（定義なし・定義が短い・定義が長い）、タイムアウトと例外のツール結果化、呼び出し元の中断の伝播）
  _Boundary:_ `packages/ai-core/src/aci/types.ts`, `packages/ai-core/src/aci/define-tool.ts`, `packages/ai-core/src/aci/define-tool.test.ts`
  _Depends:_ 10
  _Requirements:_ 5.8, 6.4
  _Traces:_ REQ-005, REQ-006, C9
- [x] 15.2 `aci/tool-set.ts`: `buildToolSet(tools, availability, runtime: ToolRuntime)`（`runtime` で各 `AciTool` を AI SDK の `Tool` に変換し、`GuardedToolSet` として返す。無効化ツールの一覧、`risk` が `read-only` 以外は `ConfigError` で拒否）+ テスト（`runtime.toolTimeoutMs`（`AGENT_TOOL_TIMEOUT_MS` 由来）と `runtime.clock` が全ツールに届くこと、戻り値が `GuardedToolSet` であること）
  _Boundary:_ `packages/ai-core/src/aci/tool-set.ts`, `packages/ai-core/src/aci/tool-set.test.ts`
  _Depends:_ 15.1, 12
  _Requirements:_ 5.4
  _Traces:_ REQ-005, C9
- [x] 15.3 `aci/tools/current-time.ts`・`calculator.ts`: 現在時刻ツール（Clock 注入）と再帰下降パーサの計算ツール（`eval` を使わない）+ `calculator.test.ts`
  _Boundary:_ `packages/ai-core/src/aci/tools/current-time.ts`, `packages/ai-core/src/aci/tools/calculator.ts`, `packages/ai-core/src/aci/tools/calculator.test.ts`
  _Depends:_ 15.1
  _Requirements:_ 5.2, 5.7
  _Traces:_ REQ-005, C9
- [x] 15.4 `aci/tools/currency.ts`・`rates.json`・`weather.ts`・`web-search.ts`: 為替・天気（Open-Meteo）・Web検索（Tavily、キー未設定時は登録しない）ツール + `tools.test.ts`（fake Clock と 13.6 の fixture 実装を使う）
  _Boundary:_ `packages/ai-core/src/aci/tools/currency.ts`, `packages/ai-core/src/aci/tools/rates.json`, `packages/ai-core/src/aci/tools/weather.ts`, `packages/ai-core/src/aci/tools/web-search.ts`, `packages/ai-core/src/aci/tools/tools.test.ts`
  _Depends:_ 10, 13, 15.1
  _Requirements:_ 5.2, 5.3
  _Traces:_ REQ-005, C9
- [x] 15.5 `aci/index.ts`: `./aci` の公開API集約
  _Boundary:_ `packages/ai-core/src/aci/index.ts`
  _Depends:_ 15.2, 15.3, 15.4
  _Requirements:_ 5.2
  _Traces:_ REQ-005, C9
  _Verify:_ 19.1 と 23.1 のテストが公開サブパス `@platform/ai-core/aci` から import して通る

### Implementation Notes

- AI SDK v7 の `Tool<INPUT, OUTPUT>` は `INPUT`・`OUTPUT` について不変（`needsApproval` と `execute` の引数位置、`inputSchema` が両方向に現れる）。そのため `AciTool<{expression:string}, R>` は `AciTool<unknown, unknown>` に代入できず、型の異なるツールの配列を受ける `buildToolSet` の引数には、`toTool(): Tool`（SDK の消去型）を持つ `AnyAciTool` を別に定義した。出力も不変なので、`readonly SearchHit[]` を返す web-search は `defineAciTool<IN, OUT>` の型引数を明示する。
- 実効タイムアウトと呼び出し元の中断は `AbortSignal.any` の `reason` で判別する（`reason === timeoutSignal.reason` のときだけ `kind: "timeout"` のツール結果にし、それ以外の中断は理由をそのまま再 throw して `aborted` をエージェントへ伝える）。`execute` がシグナルを無視しても fake Clock で確定するよう、`raceWithAbort`（`ports/abort.ts`）で競わせる。想定外の例外の `message` は秘密情報を含みうるため、ツール結果に入れるのはエラー名だけにする。学習者向けの文言は `ToolExecutionError`（summary/nextAction）か `PlatformError` の message（学習者向けの日本語文言が規約）だけを使い、`details`（`cause` を含む）は送らない。
- `tool-risk-declared` の走査は `defineAciTool<...>(` を呼び出しとして扱うため、`function defineAciTool<INPUT, OUTPUT>(` という宣言自体を違反と判定した。宣言を `export const defineAciTool = <INPUT, OUTPUT>(...) =>` に変えて回避した。天気の URL は、録画済み fixture の URL（`current=temperature_2m,weather_code`）と一致させるため、`URLSearchParams`（カンマを `%2C` にする）を使わず手で組み立てる。
- `AnyAciTool` は構造型のため、型だけでは手書きのオブジェクトを防げない（W3 敵対的レビュー r1 の L12）。`defineAciTool` の戻り値をモジュール内の `WeakSet` に記録し、`buildToolSet` が実行時に生成元を検査して `ConfigError` で拒否する。型レベルでも export しない `unique symbol` のブランドを付け、手書きのオブジェクトを型エラーにした。スプレッドしたコピーは型検査を通るが、実行時の検査で拒否される。

---

## 16. GuardedAgent（C8）(P)

3種の停止条件と停止理由を必ず持つ `ToolLoopAgent` を生成し、実行サマリを返す。

_Boundary:_ `packages/ai-core/src/agents/stop-conditions.ts`, `packages/ai-core/src/agents/stop-reason.ts`, `packages/ai-core/src/agents/guarded-agent.ts`, `packages/ai-core/src/agents/index.ts`, `packages/ai-core/src/agents/stop-conditions.test.ts`, `packages/ai-core/src/agents/stop-reason.test.ts`, `packages/ai-core/src/agents/guarded-agent.test.ts`
_Depends:_ 11, 12, 13（16.3 は 15.2 にも依存する）
_Requirements:_ 5.1, 5.6, 6.1, 6.2, 6.3, 6.5
_Traces:_ REQ-005, REQ-006, C8

- [x] 16.1 (P) `agents/stop-conditions.ts`: `stepLimit`（`isStepCount` ラッパ）・`tokenBudget`・`deadline`（Clock 経過）+ テスト（境界値: ちょうど上限、上限の1つ手前）
  _Boundary:_ `packages/ai-core/src/agents/stop-conditions.ts`, `packages/ai-core/src/agents/stop-conditions.test.ts`
  _Depends:_ 11
  _Requirements:_ 6.1
  _Traces:_ REQ-006, C8
- [x] 16.2 `agents/stop-reason.ts`: `deriveStopReason`（優先順位: `aborted`→`error`→成立した停止条件→`completed`）+ テスト（6種の網羅）
  _Boundary:_ `packages/ai-core/src/agents/stop-reason.ts`, `packages/ai-core/src/agents/stop-reason.test.ts`
  _Depends:_ 16.1
  _Requirements:_ 6.2
  _Traces:_ REQ-006, C8
- [x] 16.3 `agents/guarded-agent.ts`・`guarded-agent.test.ts`: `createGuardedAgent`（1回の実行に束縛、`tools` は 15.2 の `GuardedToolSet` だけを受け付ける、ツール数20超で `ConfigError`、`abortSignal = AbortSignal.any([signal, timeoutSignal])` の合成、`onStepEnd`/`onEnd`/`onError` によるサマリの1回だけの確定、`RunObserver.onRunEnd`）。テストはシナリオモデル（13）で、ツール呼び出しの反復、知識のみの回答（ツールを呼ばず `toolsCalled` が空）、並行する2実行の状態分離、ツール数21件での生成拒否、生の `ToolSet` を `tools` に渡すと型エラーになること（`@ts-expect-error`）、応答しないLLM呼び出しの `timeout` 化、学習者の停止による `aborted`、サマリ確定が1回だけであることを検証する
  _Boundary:_ `packages/ai-core/src/agents/guarded-agent.ts`, `packages/ai-core/src/agents/guarded-agent.test.ts`
  _Depends:_ 16.2, 15.2, 12, 13
  _Requirements:_ 5.1, 5.6, 6.1, 6.2, 6.3, 6.5
  _Traces:_ REQ-005, REQ-006, C8
- [x] 16.4 `agents/index.ts`: `./agents` の公開API
  _Boundary:_ `packages/ai-core/src/agents/index.ts`
  _Depends:_ 16.3
  _Requirements:_ 5.1
  _Traces:_ REQ-005, C8
  _Verify:_ 17.3・19.1・23.1 のテストが公開サブパス `@platform/ai-core/agents` から import して通る

### Implementation Notes

- AI SDK v7 の `isStopConditionMet` は `Promise.all` で全停止条件を同時に評価する。そのため同じステップで複数の条件が成立しうるし、`stepLimit` を `isStepCount`（戻り値の型が `PromiseLike | boolean`）に委譲して async にしたことで、記録の「成立した順」がマイクロタスクの順に左右された。そこで `fired()` は成立順ではなく `STOP_CONDITION_NAMES` の固定順で返し、停止理由は `deriveStopReason` の固定優先順位（timeout → token-budget → step-limit）だけで決める。`ToolLoopAgentSettings.stopWhen` は readonly 配列を受け付けないため、`createRunStopConditions` は実行ごとに新しい mutable 配列を返し、条件の引数型は `{ usage }` だけの構造型にした（`any` なしでどの `TOOLS` の `StopCondition` にも代入できる。`expectTypeOf` で固定）。呼び出し元の中断と実行時間上限の中断は 16.3 が `AbortSignal.reason` で判定して `StopReasonInput.abort: "caller" | "timeout"` として渡し、`deriveStopReason` は純粋関数のままにした（どちらの中断も error より上）。
- v7 の `createAgentUIStream(Response)` では、UI ストリームの `finish` が `streamText` の `onEnd` より先に届くことがある（`onEnd` はイベント処理の flush で呼ばれる）。そのため `messageMetadata` の `finish` でもサマリを確定する。`finish` の時点で全ステップの `onStepEnd` と停止条件の評価は済んでいるので、`onEnd` で確定した場合と同じ値になる。確定は最初の1回だけ採用する。
- v7 では中断が `onError` に来ない。`streamText` は中断を `abort` パートに変換し、`onAbort` も出すが、`ToolLoopAgentSettings` に `onAbort` / `onError` はない。そこで合成した `abortSignal` の `abort` イベントでサマリを確定する（タイムアウトか呼び出し元かは `reason` の一致で判定）。生成時に既に中断済みの場合は、その場で `aborted` として確定する。`onError` は中断済みなら中断理由、そうでなければ `error` として確定し、学習者向けの固定文言を返す（生のエラー文はストリームに出さない）。`abortSignal` は settings ではなく呼び出しごとの引数なので、route は `guarded.abortSignal` を `createAgentUIStreamResponse` に渡す。`ToolsContextSettings<TOOLS>` は generic な TOOLS では解決できないため、settings は `as unknown as ToolLoopAgentSettings<never, TOOLS>` で渡す。`finish` はストリーム途中のエラーの後でもクライアントへ送られるため、`AgentRunSummary.error` は閉じた `code`（`PlatformError` の code、`APICallError` は `provider-unavailable`、それ以外は `unexpected`）と固定の日本語文言だけにし、生の `message` とエラー名は持たない（W3 敵対的レビュー r1 の H2。15 のツール結果と同じ規則）。
- AI SDK v7 の `streamText` は `onError` がないと `console.error(error)` を既定で使い、`APICallError` の要求本文（生のプロンプト）がログに出る（同 H3）。`ToolLoopAgent` の settings 型に `onError` はないが、`prepareCall` が `streamText` へそのまま展開するので、settings に渡して抑止する（実装は `finalise(error)` だけで、何も出力しない）。この `onError` は UI ストリームの `onError` より先に呼ばれ、`agent.stream()` を直接消費したときにストリーム途中の `error` パートの後で `onEnd` が `completed` で確定してしまう問題も防ぐ。`generateText` には `onError` がないため、`ToolLoopAgent` のサブクラスで `generate()` の例外を捕まえて確定してから再送出する（同 L15）。observer の例外は他の observer と `done` に影響させず、任意の `onObserverError(error, observer)` へ渡す（同 L11。既定は何もしない）。

---

## 17. ChatCore（C11）

ペルソナのテンプレート、モデル切り替え時の履歴変換、応答メタデータの組み立てを提供する。

_Boundary:_ `packages/ai-core/src/chat/personas/index.ts`, `packages/ai-core/src/chat/personas/general-assistant.ts`, `packages/ai-core/src/chat/personas/python-mentor.ts`, `packages/ai-core/src/chat/personas/strict-reviewer.ts`, `packages/ai-core/src/chat/adapt-history.ts`, `packages/ai-core/src/chat/metadata.ts`, `packages/ai-core/src/chat/request-schema.ts`, `packages/ai-core/src/chat/index.ts`, `packages/ai-core/src/chat/adapt-history.test.ts`, `packages/ai-core/src/chat/personas/personas.test.ts`, `packages/ai-core/src/chat/metadata.test.ts`, `packages/ai-core/src/chat/request-schema.test.ts`
_Depends:_ 9, 16
_Requirements:_ 3.3, 3.7, 3.10, 5.6
_Traces:_ REQ-003, REQ-005, C11

- [x] 17.1 (P) `chat/personas/*`: 汎用アシスタント・Python講師・厳密レビュアの3テンプレート（`id`/`version`/`title`/`render`）+ テスト（ID一意性、版の形式、描画結果）
  _Boundary:_ `packages/ai-core/src/chat/personas/index.ts`, `packages/ai-core/src/chat/personas/general-assistant.ts`, `packages/ai-core/src/chat/personas/python-mentor.ts`, `packages/ai-core/src/chat/personas/strict-reviewer.ts`, `packages/ai-core/src/chat/personas/personas.test.ts`
  _Depends:_ 9
  _Requirements:_ 3.10
  _Traces:_ REQ-003, C11
- [x] 17.2 (P) `chat/adapt-history.ts`: `adaptHistoryForModel`（推論・プロバイダ固有メタデータ・非対応画像の除外・変換、表示用履歴は変えない）+ テスト
  _Boundary:_ `packages/ai-core/src/chat/adapt-history.ts`, `packages/ai-core/src/chat/adapt-history.test.ts`
  _Depends:_ 9
  _Requirements:_ 3.3
  _Traces:_ REQ-003, C11
- [x] 17.3 `chat/metadata.ts`・`request-schema.ts`・`index.ts`: `buildResponseMetadata`、`chatRequestSchema`/`agentRequestSchema`（`z.strictObject`）、`./chat` の公開API + `metadata.test.ts`（使用量の写し替え、`run` と `toolsCalled` の有無）・`request-schema.test.ts`（未知フィールド・カタログ外のモデル ID・未知のペルソナ ID の拒否）
  _Boundary:_ `packages/ai-core/src/chat/metadata.ts`, `packages/ai-core/src/chat/metadata.test.ts`, `packages/ai-core/src/chat/request-schema.ts`, `packages/ai-core/src/chat/request-schema.test.ts`, `packages/ai-core/src/chat/index.ts`
  _Depends:_ 17.1, 17.2, 16
  _Requirements:_ 3.7, 3.10, 5.6
  _Traces:_ REQ-003, REQ-005, C11

### Implementation Notes

- ペルソナ定義ファイル（`general-assistant.ts` など）はデータ（`id`/`version`/`title`/`instructions`）だけを export し、`personas/index.ts` が `render` 付きの凍結済みテンプレートに組み立てる（定義側から描画関数を import する循環参照を避けるため）。`render(vars)` の `vars` は `modelName`（カタログの表示名）と `today`（Clock から得た `YYYY-MM-DD`）だけで、どちらもリクエスト本文からは受け取らない。プロンプト本文を変えたら `version` を上げる。
- 履歴はすべてクライアントが送るため、`adaptHistoryForModel` は `providerMetadata` などのプロバイダ固有フィールドと `custom` パートを、同じプロバイダでも常に除く（W3 敵対的レビュー r1 の M4。当初は `metadata.provider` を信頼し、名乗るだけで除去を迂回できた）。プロバイダ実行のツールパートは、`metadata.modelId` がカタログにあり、その `provider` が切り替え先と同じときだけ残す（`metadata.provider` がカタログと矛盾すれば出所不明とみなす）。推論は常に除く（同 r2 の N1）: metadata を除いた推論は Anthropic が警告付きで捨て、OpenAI は捨てるパートを生のテキストごと警告に入れて AI SDK が stderr に出すため（実際のプロバイダに fetch を注入して確認した）。不完全なツール呼び出し（`input-streaming`/`input-available`）は、結果のない tool-call をプロバイダが拒否するため常に除き、承認系の状態（`approval-*`、`output-denied`）は SDK の承認フローに必要なので残す。
- `buildResponseMetadata` の入力に `persona`（`id`/`version`）と `disabledTools` を追加し、`usage` は任意にした（`start` ではモデル名とペルソナだけ、`finish` で `part.totalUsage` を渡し、`useChat` が2つをマージする）。`toolsCalled` はトップレベルに置き（Req 5.6）、明示の値、なければ `run.toolsCalled`、どちらもなければキーを省く。`DefaultChatTransport` は既定で本文に `trigger`（`submit-message`/`regenerate-message`）と `messageId` を付けて送る（`HttpChatTransport.sendMessages` で確認）ため、plan どおりの4フィールドだけの `z.strictObject` では既定の `useChat` の送信がすべて 400 になる。この2フィールドは任意で受け付けて Route では使わず、`role: "system"` は拒否する。メッセージはエンベロープだけを strict に検査し、part の中身の検証は C15 の Route の `validateUIMessages` に任せる。

---

## 18. SummaryPipeline（C12）(P)

記事URL・YouTube URL・字幕テキストから本文を取得し、分割の要否を判断して、スキーマ検証済みの
要約オブジェクトを逐次生成する。

_Boundary:_ `packages/ai-core/src/summarize/schema.ts`, `packages/ai-core/src/summarize/schema.test.ts`, `packages/ai-core/src/summarize/source.ts`, `packages/ai-core/src/summarize/tokens.ts`, `packages/ai-core/src/summarize/plan.ts`, `packages/ai-core/src/summarize/cache-policy.ts`, `packages/ai-core/src/summarize/cache-policy.test.ts`, `packages/ai-core/src/summarize/prompts.ts`, `packages/ai-core/src/summarize/retry.ts`, `packages/ai-core/src/summarize/pipeline.ts`, `packages/ai-core/src/summarize/errors.ts`, `packages/ai-core/src/summarize/index.ts`, `packages/ai-core/src/summarize/source.test.ts`, `packages/ai-core/src/summarize/plan.test.ts`, `packages/ai-core/src/summarize/retry.test.ts`, `packages/ai-core/src/summarize/pipeline.test.ts`, `packages/ai-core/src/summarize/url-guard.ts`, `packages/ai-core/src/summarize/url-guard.test.ts`（2026-10-07、W3 敵対的レビュー r1 の M6 の修正で追加）
_Depends:_ 9, 10, 11, 13
_Requirements:_ 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 4.12
_Traces:_ REQ-004, C12

- [x] 18.1 `summarize/schema.ts`・`errors.ts`: 要約スキーマ（`title`/`keyPoints`ちょうど3件/`tags`/`actionItems`/`chapters?`）、`summarizeRequestSchema`（`z.strictObject`）と `SourceFetchError`・`TranscriptUnavailableError`・`SummaryValidationError` + `schema.test.ts`（要点が3件でない、上限超過、要約リクエストの未知フィールドの拒否）
  _Boundary:_ `packages/ai-core/src/summarize/schema.ts`, `packages/ai-core/src/summarize/schema.test.ts`, `packages/ai-core/src/summarize/errors.ts`
  _Depends:_ 9
  _Requirements:_ 4.1, 4.3, 4.10
  _Traces:_ REQ-004, C12
- [x] 18.2 `summarize/source.ts`: 記事本文抽出（`@mozilla/readability` + `jsdom`）、YouTube URL 解析と字幕取得、字幕テキストの直接入力の受付 + テスト（13.6 の fixture 実装で、HTTP失敗・空本文・字幕なしでLLMを呼ばないこと）
  _Boundary:_ `packages/ai-core/src/summarize/source.ts`, `packages/ai-core/src/summarize/source.test.ts`, `packages/ai-core/src/summarize/url-guard.ts`, `packages/ai-core/src/summarize/url-guard.test.ts`（url-guard の2ファイルは W3 敵対的レビュー r1 の M6 の修正で追加）
  _Depends:_ 18.1, 10, 13
  _Requirements:_ 4.1, 4.2, 4.7, 4.9, 4.11
  _Traces:_ REQ-004, C12
- [x] 18.3 (P) `summarize/tokens.ts`・`plan.ts`: `gpt-tokenizer` によるトークン推定（安全係数1.2）と全文/分割の判断（コンテキスト上限の80%境界）+ テスト
  _Boundary:_ `packages/ai-core/src/summarize/tokens.ts`, `packages/ai-core/src/summarize/plan.ts`, `packages/ai-core/src/summarize/plan.test.ts`
  _Depends:_ 18.1
  _Requirements:_ 4.6, 4.12
  _Traces:_ REQ-004, C12
- [x] 18.4 (P) `summarize/cache-policy.ts`・`prompts.ts`: プロバイダ別のプロンプトキャッシュ指定方法（`anthropic`明示/自動系は記録のみ/`ollama`・`mock`はなし）と要約・部分要約・統合のプロンプト + `cache-policy.test.ts`
  _Boundary:_ `packages/ai-core/src/summarize/cache-policy.ts`, `packages/ai-core/src/summarize/cache-policy.test.ts`, `packages/ai-core/src/summarize/prompts.ts`
  _Depends:_ 18.1
  _Requirements:_ 4.8
  _Traces:_ REQ-004, C12
- [x] 18.5 (P) `summarize/retry.ts`: スキーマ検証失敗時の最大2回までの再生成 + テスト（1回目・2回目の成功、3回目失敗時のエラー内容）
  _Boundary:_ `packages/ai-core/src/summarize/retry.ts`, `packages/ai-core/src/summarize/retry.test.ts`
  _Depends:_ 18.1
  _Requirements:_ 4.4
  _Traces:_ REQ-004, C12
- [x] 18.6 `summarize/pipeline.ts`・`index.ts`: `streamSummary`（`partial`/`restart`/`final`/`meta` のイベント列、`final` だけを検証済み要約として扱う）+ テスト（13.6 の `m1-3` シナリオと 11 のモックモデルで、部分オブジェクトの順序、チャプターの生成、キャッシュ読み出し量の記録）
  _Boundary:_ `packages/ai-core/src/summarize/pipeline.ts`, `packages/ai-core/src/summarize/index.ts`, `packages/ai-core/src/summarize/pipeline.test.ts`
  _Depends:_ 18.2, 18.3, 18.4, 18.5, 11, 13
  _Requirements:_ 4.3, 4.5, 4.8, 4.10, 4.12
  _Traces:_ REQ-004, C12

### Implementation Notes

- AI SDK v7 の `streamText` は `messages` 内の system メッセージを `AI_InvalidPromptError` で拒否するため、要約プロンプトは `{ instructions, messages }`（`SummaryPrompt`）で返す。長文のソースは user メッセージの先頭のテキストパートに `<source>` で区切って置き、Anthropic ではそのパートだけに `providerOptions.anthropic.cacheControl` を付ける。再生成時の検証エラーは後ろに別パートとして足すので、キャッシュ対象の先頭部分は再送しても変わらない。分割判断の指示文トークンは、空のソースで実際のプロンプトを組み立てて推定し、プロンプトを変更しても判断がずれないようにした。
- 構造化出力は `streamText` + `Output.object` で、`partialOutputStream` を `partial` イベントとして送る。`await result.output` が `NoObjectGeneratedError` で失敗したときは、`error.text` を自前で JSON 解析・スキーマ検証して `path: message` 形式の issues を作る。生成本文を含む `cause` は使わず、エラーにも入れない。プロバイダのエラー（ストリーム途中の `error` パートを含む）は再生成せずに元のクラスのまま投げる。途中の `error` パートでも `result.output` は `NoObjectGeneratedError` で reject するため、`onError`（既定は console に出すので収集関数に置き換えた）で集めたエラーがあれば検証より先に投げる（W3 敵対的レビュー r1 の H1）。staged では各チャンクの部分要約（再生成規則は同じ、イベントは出さない）の後、統合の呼び出しだけが `partial` / `restart` を送る。再生成を使い切った `SummaryValidationError` は、当初は合うコードがなく `provider-unavailable` を使っていたため、`PlatformErrorCode` に `output-invalid` を加えて区別した（コーディネーターの修正 `1367ee4`）。
- jsdom には型定義がなく `@types/jsdom` も依存にないため、`createRequire(import.meta.url)("jsdom")` で読み込み、`innerText` がないので Readability の結果をブロック要素ごとに改行してテキスト化する。記事の取得では、WHATWG URL が10進・8進・16進の IPv4 と IPv6 の表記を正規化するため、`hostname` の文字列検査だけで内部アドレスを拒否でき、リダイレクトは `redirect: "manual"` で自分でたどって行き先ごとに同じ検査をする（同 M6）。r2 で `home.arpa`・`lan`、SIIT・6to4 は埋め込みの IPv4 で、ローカル用 NAT64・Teredo は丸ごと拒否を加え（N7）、解析できない `Location` も `disallowed-url` にした（N5）。HttpFetcher に名前解決とストリーミングの段がないため、DNS 経由の内部アドレス（rebinding を含む）と読み込み中の本文の打ち切りは、W4 の 20.1 の本番の HttpFetcher が担う（N2・N3）。分割の探索は二分探索から補間探索に変えた（gpt-tokenizer のトークン数は長さに対して単調ではないので、契約は「収まり、1文字足すと超える接頭辞」）。
- `ollama-ai-provider-v2` の `chat(id, settings)` は settings を捨て、`num_ctx` は呼び出しごとの `providerOptions.ollama.options` だけで届く（注入した fetch の本文で確認した）。要約の計画はカタログの `contextWindow` を予算にするため、要約の呼び出しでは `num_ctx` をその値にそろえた（同 M5）。チャットとエージェントはサーバー既定のままで、40,960 の KV キャッシュのメモリ量と再読み込みは 29.2 で実測する（N4）。段階要約の統合は、予算に収まるグループに分けて段階的に統合する（同 L14。統合の見積もりとチャンク予算の式は r2 の N6 のテストで固定した）。

---

## 19. 評価スイート: 回帰テストと Capability の例（C21 続き）

M1 のツールエージェントの通し実行を回帰として検証し、`local` 限定の品質評価の適用例を1件置く。
W3 の締めとして gate を結線する。

_Boundary:_ `packages/eval-suite/package.json`, `packages/eval-suite/tests/regression/tool-agent-run.test.ts`, `packages/eval-suite/tests/capability/summary-quality.local.test.ts`, `mise.toml`, `.github/workflows/ci.yml`, `stryker.config.mjs`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `patches/@stryker-mutator__vitest-runner@10.0.0.patch`（Stryker の4ファイルは 2026-10-07 の W3 敵対的レビュー r1 の MEDIUM で事後に追加。plan C18 の互換性の回避）
_Depends:_ 7, 9, 13, 15, 16, 18（19.3 は 14、17 にも依存する）
_Requirements:_ 1.1, 1.4, 1.7, 1.13, 1.14, 1.15, 1.16
_Traces:_ REQ-001, C21, C1, C2

- [x] 19.1 `tests/regression/tool-agent-run.test.ts`: `mock` シナリオでツールエージェントを最後まで実行し、停止理由・ツール呼び出し列・最終回答の Outcome を回帰として検証する。`packages/eval-suite/package.json` に `test`・`test:coverage`（`vitest run --coverage.enabled --coverage.reporter=html --coverage.thresholds.lines=0`。閾値の強制は gate の `test` 段。plan C18）スクリプトを加える
  _Boundary:_ `packages/eval-suite/tests/regression/tool-agent-run.test.ts`, `packages/eval-suite/package.json`
  _Depends:_ 7, 13, 15, 16
  _Requirements:_ 1.1, 1.13
  _Traces:_ REQ-001, C21
- [x] 19.2 `tests/capability/summary-quality.local.test.ts`: `local` 限定で要約が3件の要点を持つことを実モデルで確認する例
  _Boundary:_ `packages/eval-suite/tests/capability/summary-quality.local.test.ts`
  _Depends:_ 7, 18, 11
  _Requirements:_ 1.13, 1.14
  _Traces:_ REQ-001, C21
- [x] 19.3 W3 の締め: `mise.toml` の `gate` に W3 の規則を、`ci.yml` に `mutation` ジョブ（`mise run test:mutation`）と `ci-status` の `needs` を加える（[tasks.md](tasks.md)「gate と CI の段階的な結線」）
  _Boundary:_ `mise.toml`, `.github/workflows/ci.yml`, `stryker.config.mjs`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `patches/@stryker-mutator__vitest-runner@10.0.0.patch`
  _Depends:_ 14, 15, 16, 17, 18, 19.1, 19.2
  _Requirements:_ 1.4, 1.7, 1.15, 1.16
  _Traces:_ REQ-001, C1, C2
  _Verify:_ `mise run gate` が成功し、`tool-risk-declared` が走査件数を出力する。gate-reporter が `*.local.test.ts` を理由付きのスキップとして数える。`mise run test:mutation` がローカルで閾値（70）を満たし、PR の `ci-status` が `mutation` を含めて成功する

### Implementation Notes

- 19.1: `@platform/eval-suite` が依存しているのは `@platform/ai-core` だけで、`ai` には依存していない（pnpm の厳格な解決）。そのため `createAgentUIStream` や `UIMessageChunk` は import できない。通し実行は `guarded.agent.stream({ prompt, abortSignal: guarded.abortSignal })` の `fullStream` を読んで行い、`tool-result` の `output` を Outcome として集め、最後のステップの `text-delta` を最終回答とする。停止理由とツール列は `await guarded.done` のサマリで検証した。回帰の対象は「M1 の5ツールを `buildToolSet` で組んだ実際の構成」（天気は HTTP の fixture、Web 検索は fixture プロバイダ、時刻は FakeClock）とし、シナリオは公開の `M1_2_SCENARIOS` に加え、ツール列と失敗 Outcome を作るシナリオ1件をテスト内で `defineScenario` している。UI メッセージストリームの `finish` メタデータは C8 の単体テストと 23 の Route Handler テストの責務とし、ここでは重複させない。
- 19.2: `describeLocal` のファクトリは引数に `it` を受け取る（`SuiteFactory`）。理由付きのスキップは `beforeEach` の `context.skip(reason)` で行われ、gate-reporter はその理由ごとに件数を数える。gate レーンでは "Local tests require AI_TEST_RUN_MODE=local."、Ollama がない local レーンでは "Ollama is unavailable at …" になることを確認した。本体はまず `config.mode === "local"` を検査するので、スキップの判定が壊れたときには緑にならず、失敗として表に出る。要点の検査そのものは実モデルで未実行で、`mise run test:local` での確認が要る。
- 19.3: gate の `check:repo-rules --only` に `tool-risk-declared` を加え、CI に `mutation` ジョブ（タイムアウト 30 分）と `ci-status` の `needs`・`MUTATION_RESULT` を加えた。`mise run test:mutation` はこの toolchain で一度も動いていなかった。TypeScript 7 に JS API がないため `stryker.config.mjs` の `tsconfigFile` を存在しないファイルに向け、`@stryker-mutator/vitest-runner` 10.0.0 がテスト名を空白で連結する（Vitest 5 は `suite > test` で照合する）ために絞り込んだ実行が0件になり全変異が生き残っていた（8.40%）のを、`pnpm patch` で `" > "` 区切りにした（`30d4437`。境界外の変更だったため、レビュー後に `_Boundary:_` を広げた）。変異スコアは 88.80%（閾値 70）。
