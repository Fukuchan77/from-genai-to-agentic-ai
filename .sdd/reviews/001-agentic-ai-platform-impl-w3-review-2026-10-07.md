# 001-agentic-ai-platform W3 実装 敵対的レビュー（2026-10-07）

- 対象: `git diff 86575ae..f8379f7`（`compose.yaml` を除く）。タスク 14〜19、`output-invalid` の追加、Stryker の修正（`30d4437`）、W3 の締め（`79c5eec`）、および `w3-reports.md` の Implementation Notes と plan 変更案
- 実施者: W3 の実装に関わっていない新規コンテキスト（`sdd-reviewer`、`adversarial-review` skill）
- 実測: `mise run gate` 成功（`tool-risk-declared: scanned 13 FILES`、ai-core 523 passed / 4 skipped、eval-suite 3 passed / 1 skipped（理由付き））。`mise run test:mutation` 成功（スコア 88.80、閾値 70）。作業ツリーは終了時に `git status` が空であることを確認した
- 独立 probe: 一時ファイル（`packages/ai-core/src/zzrev3probe/`、終了時に削除）で挙動を確認し、既存テストの有効性は実装を一時的に壊して（バックアップから復元）確認した。adapt-history の同一プロバイダ判定、request-schema の strict、metadata の `toolsCalled`、Ollama 事前検査の TTL、空本文の拒否、`finish` での確定、`raceWithAbort`、D9 のモード検査、risk 検査、ツール数上限はいずれも既存テストが失敗して検出した（偽の合格ではない）
- risk_trigger: なし（手動の波レビュー）。prior_reviews（W2）の指摘は W3 のコードで再発していないため再掲しない

## Critique

### [HIGH] 要約パイプラインがストリーム途中のプロバイダエラーをスキーマ検証失敗として扱い、2回再生成したうえで `output-invalid` に化けさせる
**Location**: packages/ai-core/src/summarize/pipeline.ts:86-110
**Issue**: プロバイダがストリームの途中で `error` パートを返すと、`result.output` は `NoObjectGeneratedError` で reject するため、`streamErrors` に記録した本当の原因を捨てて「JSON として解析できませんでした」の検証失敗として再生成し、3回呼んだ後に `SummaryValidationError`（`output-invalid`）を投げる。
**Evidence**: `if (!NoObjectGeneratedError.isInstance(error)) throw streamErrors[0] ?? error;` のため、`NoObjectGeneratedError` のときは `streamErrors` を見ない。独立 probe で `[{type:"stream-start"},{type:"error",error:new Error("upstream 529 overloaded")}]` を返す `MockLanguageModelV4` を渡すと、結果は `SummaryValidationError output-invalid 要約がスキーマ検証に 3 回失敗しました。`、`doStreamCalls` は 3、イベントは `restart, restart` だった。Req 4.4 の再生成はスキーマ検証の失敗だけが対象で、実装者自身のノートも「プロバイダのエラーは再生成せずにそのまま投げる」としている。Anthropic の `overloaded_error` や Ollama のエラーはストリーム途中の `error` パートで届くため、現実に踏む経路である。既存テスト「propagates a provider failure without regenerating」は `doStream` が reject する形しか検査していない。
**Confidence**: high
**Fix**: `streamErrors.length > 0` なら `NoObjectGeneratedError` より先に `streamErrors[0]` を投げる（再生成しない）。ストリーム途中の `error` パートで、再生成せず元のエラー（または `provider-unavailable` の `PlatformError`）が伝わり、`doStreamCalls` が 1 であるテストを追加する。

### [HIGH] エージェントの生のエラーメッセージが `finish` の `messageMetadata.run.error.message` としてクライアントへ送られる
**Location**: packages/ai-core/src/agents/guarded-agent.ts:147-151,194-201,256-258; packages/ai-core/src/chat/metadata.ts:75
**Issue**: `runError()` が `error.message`（200字まで）をそのまま `AgentRunSummary.error` に入れ、ストリーム途中のエラーでも `finish` が送られるため、そのサマリが UI メッセージストリームでブラウザへ届く。
**Evidence**: 独立 probe で、`text-delta` の後に `{type:"error", error:new Error("Invalid x-api-key sk-ant-SECRET123 for org acme")}` を返すモデルを `createAgentUIStream` で実行すると、チャンク列は `{"type":"error","errorText":"エージェントの実行中にエラーが発生しました。"}` の後に `{"type":"finish","finishReason":"error","messageMetadata":{"run":{"stopReason":"error",...,"error":{"name":"Error","message":"Invalid x-api-key sk-ant-SECRET123 for org acme"}}}}` を含んだ。plan「HTTP API」は「ストリームの途中で起きたエラーは、`onError` で `PlatformError` の `code` と日本語のメッセージだけに変換して送る（内部の詳細は送らない）」、Error Handling は「サーバーは `code` と `message` だけをクライアントへ返し、スタックトレースと秘密情報を送らない」と定める。`onError` の文言は固定化しているが、同じ情報が metadata 経由で漏れる。15 のノート（「想定外の例外の message は秘密情報を含みうるため、ツール結果に入れるのはエラー名だけ」）とも矛盾する。既存テスト「records error with the error name and message for a stream error」の `not.toContain("provider exploded")` は、`doStream` が reject して `finish` が送られない形でだけ成り立つ。
**Confidence**: high
**Fix**: `AgentRunSummary.error.message` には `PlatformError` の `message` だけを入れ、それ以外はエラー名と固定文言にする（生の message が必要なら observer 専用の別フィールドにし、`messageMetadata` へは載せない）。ストリーム途中の `error` パートで `finish` の metadata に生の文言が含まれないことを検査するテストを追加する。plan Data Model の `AgentRunSummary.error` の説明も合わせて直す。

### [HIGH] エージェント経路で AI SDK 既定の `onError` が生のエラー（要求本文を含む）を `console.error` に出す
**Location**: packages/ai-core/src/agents/guarded-agent.ts:233-243
**Issue**: `ToolLoopAgent` の settings に `onError` がないため、`streamText` の既定 `onError: ({ error }) => console.error(error)` が使われ、プロバイダの `APICallError`（`requestBodyValues` に生のプロンプト・メッセージ・ツール引数を持つ）がサーバーログへそのまま出る。
**Evidence**: `node_modules/ai/dist/index.js:8652-8654` の `const onError = onErrorArg ?? (({ error }) => { console.error(error); });`。上記 probe で、テスト実行の stderr に `Error: Invalid x-api-key sk-ant-SECRET123 for org acme` とスタックが出力された。constitution 原則 7 は「生のプロンプト、ツール引数の値、秘密情報をログに出力しない」（MUST）。要約側（pipeline.ts:94-97）はこの問題を認識して no-op の収集関数で置き換えているが、C8 では実装者が Risks に書いただけで対処していない。`ToolLoopAgent.prepareCall` は `settingsWithoutCallbacks` を `streamText` へ展開するため（index.js:10290-10295）、settings に `onError` を渡せば抑止できる。
**Confidence**: high
**Fix**: `createGuardedAgent` の settings に、エラー名だけを記録するか何もしない `onError` を加える（型の外なので、`streamText` へ届くことをテストで固定する）。`console.error` が呼ばれないことを `vi.spyOn(console, "error")` で検査するテストを追加する。C15 の `/api/chat` も同じ規則にすることを plan に明記する。

### [MEDIUM] `adaptHistoryForModel` がクライアントの送る `metadata.provider` を信頼し、プロバイダ固有フィールドの除去を迂回できる
**Location**: packages/ai-core/src/chat/adapt-history.ts:24-30,91; packages/ai-core/src/chat/request-schema.ts:26-31
**Issue**: 履歴はすべてクライアントが送るのに、assistant メッセージの `metadata.provider` を切り替え先と同じ値に書き換えるだけで `sameProvider` が真になり、任意の `providerMetadata`・`providerReference`・推論・`custom` パートがプロバイダへそのまま渡る。
**Evidence**: `uiMessageSchema` は `metadata: z.unknown().optional()` で中身を検査せず、`originProvider()` はその文字列だけで判定する。ADR-7 は「切り替え先と異なるプロバイダが生成した推論パートと `providerMetadata` を除く」ことを目的とし、実装者も 17.2・17.3 の Risks に「client-claimed metadata.provider」と書いている。例えば OpenAI の `providerOptions.openai.itemId` 相当の参照や Anthropic の `cacheControl` を、クライアントが任意の位置に注入できる。
**Confidence**: medium
**Fix**: サーバーが発行した metadata だけを信頼する仕組み（`ResponseMetadata` に HMAC 署名を付けて Route で検証する等）を設けるか、署名がない間はプロバイダ固有フィールドと推論を常に除く（`sameProvider` を常に偽とする）方針に倒す。どちらにするかを ADR-7 と plan C11・C15 に記録し、偽の `metadata.provider` で除去が効くことを検査するテストを加える。

### [MEDIUM] `local` で Ollama の実行時コンテキスト長（`num_ctx`）を設定しておらず、カタログの `contextWindow` に基づく全文／分割の判断が成り立たない
**Location**: packages/ai-core/src/models/providers.ts:78-84; packages/ai-core/src/summarize/plan.ts:87-89,150-166
**Issue**: `qwen3:8b` のカタログ値 40,960 から予算 28,672 トークンで「全文」と判断しても、Ollama はリクエストに `num_ctx` がなければサーバー既定（数千トークン）で動き、超過分のプロンプトを黙って切り詰めるため、Req 4.6・4.12 の判断と実際の投入内容が一致しない。
**Evidence**: リポジトリ全体に `num_ctx`・`OLLAMA_CONTEXT_LENGTH` の指定がない（grep で0件）。`ollama-ai-provider-v2` は `providerOptions.ollama.options.num_ctx` を受け付ける（`dist/index.d.ts` に `num_ctx` がある）。14.5・19.2 の local テストは実 Ollama で一度も実行されていないため、この差は検出されていない。
**Confidence**: medium
**Fix**: Ollama のモデルを生成するとき（または要約・エージェントの呼び出し時）に、カタログの `contextWindow` を `num_ctx` として渡すか、カタログの `local` の `contextWindow` を既定の実行時値に合わせる。どちらかを research.md に実測で記録し（constitution 原則 8）、長文の要約を `*.local.test.ts` で確認する。

### [MEDIUM] 記事 URL の取得に、内部アドレスの拒否・タイムアウト・本文サイズの上限がない
**Location**: packages/ai-core/src/summarize/source.ts:137-154; packages/ai-core/src/summarize/plan.ts:97-144
**Issue**: 学習者が入力した任意の http/https URL（`http://127.0.0.1:11434/...`、`http://169.254.169.254/...`、LAN 内のホスト）をそのまま取得し、本文を LLM 経由で要約として返すため、SSRF で内部の応答を読み出せる。加えて取得にタイムアウトがなく、`response.text()` は無制限に読み、巨大な1行の本文は同期 CPU を長時間占有する。
**Evidence**: `deps.http.fetch(url, deps.signal ? { signal: deps.signal } : undefined)` は呼び出し元の中断だけを渡し、`createNodeHttpFetcher` は `await response.text()` で全量を読む（リダイレクトも既定で追従）。独立 probe で、2 MB の1行の記事本文（`"word ".repeat(400_000)`）に対する `planSummary` が 2,458 ms かかった（`hardSplit` が各探索で残りの全文をトークン化するため）。spec の前提は「ローカル完結・認証なし」だが、`next dev`/`next start` は既定で全インターフェースで待ち受けるため、同じ LAN の第三者もこの経路を使える。
**Confidence**: medium
**Fix**: 取得前に名前解決後のアドレスがループバック・リンクローカル・プライベートでないことを検査する（リダイレクト先も同様。少なくとも `redirect: "manual"` で再検査）。`Clock.timeoutSignal` による取得のタイムアウトと、本文の最大バイト数（超過は `SourceFetchError`）を設ける。`hardSplit` の探索上限を `start + budget * 定数` 文字に絞る。方針を plan C12 と Error Handling に追記する。

### [MEDIUM] Stryker の修正が 19.3 の `_Boundary:_` 外のファイルと第三者依存へのパッチを含み、plan への宣言も変更案もない
**Location**: pnpm-workspace.yaml:17-23; patches/@stryker-mutator__vitest-runner@10.0.0.patch; pnpm-lock.yaml; stryker.config.mjs:6-10（コミット 30d4437）
**Issue**: 19.3 の `_Boundary:_` は `mise.toml` と `.github/workflows/ci.yml` だけだが、`patchedDependencies` による `@stryker-mutator/vitest-runner` の改変、ロックファイル、`stryker.config.mjs` の `tsconfigFile` の差し替えが加わっており、`w3-reports.md` の plan 変更案にも含まれていない。
**Evidence**: `git diff 86575ae..f8379f7 -- pnpm-workspace.yaml patches stryker.config.mjs` で確認。plan C1 は `pnpm-workspace.yaml` を `minimumReleaseAge`・`allowBuilds` を持つものとして定義し、constitution 原則 10「依存は plan に宣言してから追加する」とサプライチェーン（原則 7）の観点で、配布物を書き換えるパッチは宣言の対象である。修正自体は有効（変異スコア 88.80 を実測。パッチなしでは全変異が生き残るという説明と整合）。
**Confidence**: high
**Fix**: plan C1（`pnpm-workspace.yaml` の `patchedDependencies` と `patches/`、外す条件）、C18（`tsconfigFile` の回避と理由）、research.md の Risks（Stryker の Vitest 5・TypeScript 7 非対応）に追記し、tasks.md の 19.3 の `_Boundary:_` に事後で加えるか Implementation Notes に境界外の変更として記録する。`check-updates` の監視対象に Stryker の対応版の出現を加えることも検討する。

### [MEDIUM] plan と tasks.md が W3 の実装に追随しておらず、移行条件を満たしていない
**Location**: specs/001-agentic-ai-platform/tasks.md:132-346; specs/001-agentic-ai-platform/plan.md（C6、C8、C9、C11、C12、Data Model、HTTP API、Error Handling）; packages/ai-core/src/errors.ts:6
**Issue**: W3 の全サブタスクが `- [ ]` のまま、各 Implementation Notes が空で、実装と異なる公開シグネチャ（`GatewayDeps`、`ModelSelectionError`、`stepLimit(n, record)`、`buildToolSet(AnyAciTool[])`、`buildResponseMetadata` の `persona`/`disabledTools`、`/api/chat` の `trigger`/`messageId`、`streamSummary(plan, { model, entry })`）と新しいエラーコード `output-invalid` が plan に反映されていない。
**Evidence**: tasks.md「完了した波の移行手順」1 は「全サブタスクが `[x]`、各大タスクの Implementation Notes が記入済み」を条件とする。plan の Error Handling は `SummaryValidationError` の code を定めておらず、HTTP API の拒否一覧にも `output-invalid` がない（`PlatformErrorCode` の閉じた語彙の拡張は W2 所有の `errors.ts` の変更でもある）。`w3-reports.md` の変更案のうち、15 の「エラー名だけ」と 16 の「`error.message` を 200 字で保持」は相互に矛盾しており（上記 HIGH）、そのまま転記すると plan が矛盾する。
**Confidence**: high
**Fix**: 本レビューの指摘への対応を反映したうえで、`w3-reports.md` の plan 変更案を plan.md に、ノートを tasks.md に転記し、チェックボックスを更新する。`output-invalid` を Error Handling（`SummaryValidationError`）と HTTP API（`/api/summarize` のストリームエラー）に追記する。上記 Stryker の境界外変更もここで記録する。

### [LOW] 要約プロンプトの区切りが、タイトル内の `</source>` と大文字・空白の変種を無害化しない
**Location**: packages/ai-core/src/summarize/prompts.ts:37-42
**Issue**: 本文の `</source>` だけを置換し、記事の `<title>`（攻撃者が制御できる）や `</SOURCE>`・`</source >` はそのまま区切りの内側に入るため、データの区切りを早く閉じる注入が可能である。
**Evidence**: `const body = text.replaceAll("</source>", "</ source>"); const header = title ? \`タイトル: ${title.replaceAll("\n", " ")}\n\n\` : "";`。テスト「neutralizes a closing delimiter inside the source text」は本文の小文字の完全一致だけを検査する。
**Confidence**: high
**Fix**: タイトルにも同じ無害化を適用し、`/<\/\s*source\s*>/giu` で大文字・空白の変種も置換する。タイトルと変種のテストを加える。

### [LOW] `module/1-1` のタグが、実 Ollama で一度も実行していない local テストのまま付いている
**Location**: packages/ai-core/src/models/catalog.local.test.ts; packages/eval-suite/tests/capability/summary-quality.local.test.ts; タグ `module/1-1`（f671813）
**Issue**: 14.5（Req 1.13、1.14、2.3）と 19.2 の本体は、Ollama のない環境で理由付きスキップしか確認されておらず、既定モデルが実際にツール呼び出し・構造化出力に応答することは未実測のまま、タグのメッセージは「reference implementation of module 1-1」としている。
**Evidence**: 実装者の報告に「both tests were skipped ... `skipped=2`」「Unverified on a real model: 19.2's key-point assertions have not run against a real model」とある。constitution 原則 8「事実は実測で確定する」。上記 `num_ctx` の問題も実測していれば検出できた可能性がある。
**Confidence**: high
**Fix**: タグの push（29.4）より前に `mise run test:local` を実 Ollama で実行して結果を Implementation Notes に記録する。それまではタグのメッセージか tasks.md に「local テストは未実測」と明記する。

### [LOW] `RunObserver.onRunEnd` の例外を記録せずに握りつぶす
**Location**: packages/ai-core/src/agents/guarded-agent.ts:204-210
**Issue**: observer の失敗を空の `catch` で捨てるため、004 で接続するトレース・評価レポートの observer が壊れても、どこにも痕跡が残らない。
**Evidence**: `try { observer.onRunEnd(summary); } catch { // An observer must not change the run's outcome ... }`。zero-tolerance の「swallowed exceptions」に該当する。他の observer と `done` を守る判断自体は妥当。
**Confidence**: medium
**Fix**: 例外の名前（値は出さない）を注入可能な logger か `onObserverError` コールバックへ渡す。少なくとも plan C8 に「observer の例外は無視する」契約として明記する。

### [LOW] `AnyAciTool` が構造型のため、`defineAciTool` を通らないオブジェクトが `buildToolSet` を通過できる
**Location**: packages/ai-core/src/aci/types.ts:68-70; packages/ai-core/src/aci/tool-set.ts:36-63
**Issue**: `{ name, description, risk: "read-only", timeoutMs, requiredFeature, toTool: () => rawTool }` という手書きのオブジェクトは型検査も実行時の risk 検査も通り、`defineAciTool` の名前検証・タイムアウト・Outcome 化を迂回した生の `Tool` が `GuardedToolSet` に入る。`tool-risk-declared` も `defineAciTool(` の呼び出ししか走査しない。
**Evidence**: `buildToolSet` は `aciTool.risk` と名前の重複だけを検査して `aciTool.toTool(runtime)` の戻り値をそのまま登録する。plan C8 は「検査を迂回する経路を型で塞ぐ」としている。
**Confidence**: medium
**Fix**: `defineAciTool` の戻り値に非公開の `unique symbol` ブランドを付け、`AnyAciTool` にもそのブランドを要求する（実行時は `WeakSet` で生成元を確認する）。手書きオブジェクトが型エラーになる `@ts-expect-error` テストを加える。

### [LOW] `summarizeRequestSchema.modelId` だけがカタログの ID に制限されていない
**Location**: packages/ai-core/src/summarize/schema.ts:117-121
**Issue**: chat と agent のリクエストは `z.enum(CATALOG_MODEL_IDS)` でカタログ外を拒否するが、要約は長さ 200 までの任意の文字列を受け付け、拒否がゲートウェイの `ModelSelectionError` まで遅れる。
**Evidence**: `modelId: z.string().min(1).max(SUMMARY_LIMITS.modelIdMaxLength)`。plan「HTTP API」は3つのエンドポイントとも `modelId: ModelId` としている。
**Confidence**: high
**Fix**: chat と同じカタログの enum を使い、カタログ外 ID の拒否テストを `schema.test.ts` に加える。

### [LOW] 段階要約の統合プロンプトがコンテキスト予算を検査しない
**Location**: packages/ai-core/src/summarize/pipeline.ts:173-177; packages/ai-core/src/summarize/prompts.ts:107-121
**Issue**: チャンク数が多いと、部分要約（最大 50 チャプター × 件数）を JSON で連結した統合プロンプトが予算を超えうるが、検査も多段の統合もない。
**Evidence**: `buildIntegrationPrompt` は `partials.map(JSON.stringify).join("\n")` をそのまま送る。記事本文に上限がないため、チャンク数にも上限がない。実装者の Risks にも「integration prompt for many chunks not budget-checked」とある。
**Confidence**: medium
**Fix**: 統合前に `estimateTokens` で予算を検査し、超える場合は統合を階層化するか `capability-unsupported` で拒否する。境界のテストを加える。

### [LOW] `agent.generate()` で例外が出ると `done` が永久に解決しない
**Location**: packages/ai-core/src/agents/guarded-agent.ts:176-179,238-242,258
**Issue**: エラー時の確定は `createAgentUIStreamResponse` の `onError` と中断イベントにしか結線されておらず、`guarded.agent.generate()`（や `stream()` の消費側で例外を受けた場合）では `onEnd` も `onError` も呼ばれず、`done` を待つ呼び出し側が止まる。
**Evidence**: 実装者の Risks に「direct agent.generate()/stream() errors leave `done` unresolved」とある。`GuardedAgent.agent` は公開されており、19.1 の回帰テストも `agent.stream()` を直接使っている。
**Confidence**: medium
**Fix**: settings に `onError`（上記 HIGH の対応と同じもの）を渡して `finalise(error)` も行うか、「`done` は UI ストリーム経由の実行でだけ解決する」契約を plan C8 と JSDoc に明記する。

### [LOW] 変異テストで分割予算の境界（`budget < MIN_CHUNK_TOKENS`）が検出されない
**Location**: packages/ai-core/src/summarize/plan.ts:158
**Issue**: `<` を `<=` にした変異が生き残っており、`MIN_CHUNK_TOKENS` ちょうどの境界がテストで固定されていない。
**Evidence**: `mise run test:mutation` の出力 `[Survived] EqualityOperator ... if (budget <= MIN_CHUNK_TOKENS) {`。plan.ts は他にも 18 件が生存、10 件がタイムアウト。
**Confidence**: high
**Fix**: 予算がちょうど `MIN_CHUNK_TOKENS` と 1 少ない場合のテストを `plan.test.ts` に加える。

## Verdict
REQUEST_CHANGES

## Hallucination Signal
forced: false
