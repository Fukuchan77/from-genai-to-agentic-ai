# 001-agentic-ai-platform W3 実装 敵対的レビュー round 2（2026-10-07）

- 対象: round 1（`.sdd/reviews/001-agentic-ai-platform-impl-w3-review-2026-10-07.md`、REQUEST_CHANGES、16件）の修正コミット `436ac42..e93f840`（14件）と、docs の修正 `82c1f99..41e48a9`・`a16462b`（`docs(sdd): record W3 review round 1 fixes`）。最終的な HEAD は `a16462b`
- 実施者: W3 の実装にも修正にも関わっていない新しいコンテキスト（`sdd-reviewer`、`adversarial-review` skill）
- 実測:
  - `mise run gate` は e93f840 と a16462b の両方で成功した（root 257/257、ai-core 651 passed / 4 skipped、lines 97.84%、eval-suite 3 passed / 1 skipped（理由付き）、`tool-risk-declared: scanned 13 FILES`）。turbo のキャッシュから再生された結果だが、下記の probe で関係するテストファイルを個別に実行して確認した
  - `mise run test:mutation` は成功した（スコア 90.37、閾値 70）
- 独立 probe:
  - 一時ディレクトリ `packages/ai-core/src/zzrev3r2probe/` に検証用テストを置いて実行し、終了時に削除した
  - 実装を一時的に壊して既存テストが失敗するかを確かめた。対象は H1（`streamErrors` の再送出）、H3（settings の `onError`）、L15（`generate()` の finalise）、M4（provider フィールドの除去）、L9（タグの正規表現）。いずれも `mktemp` のバックアップから復元し、`cmp` で一致を確認した。壊したどの変更でも対応するテストが失敗し、偽の合格はなかった
  - 終了時に `git status --short` が空であることを確認した
- risk_trigger: なし（手動の round 2）。prior_reviews は round 1

## Round 1 指摘の対応確認

| # | 重大度 | 指摘 | 対応確認 | 根拠 |
|---|---|---|---|---|
| 1 | HIGH | 要約でストリーム途中のプロバイダエラーが `output-invalid` に化ける | fixed | pipeline.ts:129 で `streamErrors` があれば `NoObjectGeneratedError` の判定より先に再送出する。テスト「propagates an error part sent mid-stream unchanged」は round 1 の probe と同じ形で、`doStreamCalls` 1・`restart` なしを検査する。L129 を消すとこのテストを含む2件が失敗した |
| 2 | HIGH | 生のエラー文が `finish` の `messageMetadata.run.error` に載る | fixed | `runError()` は `{ code, message: AGENT_RUN_ERROR_MESSAGE }` を返す。probe（`sk-ant-PROBE999` を含む途中の `error` パート）で、全チャンクの JSON に秘密が含まれず、`run.error` が `{"code":"unexpected","message":"エージェントの実行中にエラーが発生しました。"}` であることを確認した |
| 3 | HIGH | エージェント経路で AI SDK 既定の `onError` が `console.error` に出す | fixed | settings に `onError` を渡す（型の外なのでキャストする）。`node_modules/ai/dist/index.js:10290` の `prepareCall` は `onError` を `settingsWithoutCallbacks` に残して `streamText` へ展開する。`createAgentUIStream` は `agent.stream` に `onError` を渡さないので上書きされない。probe で `console.error` の呼び出しは0回だった。settings の `onError` を消すと3件のテストが失敗した。`generateText` では `onError` が `...settings` に入るだけで、警告も挙動の変化もないことを probe で確認した |
| 4 | MEDIUM | クライアントの `metadata.provider` を信頼している | fixed（副作用は新規指摘 N1） | provider フィールドは出所に関係なく常に除く。出所は `metadata.modelId` をカタログで引いて判定し、`provider` がカタログと矛盾すれば出所不明とする。除去のループを消すと7件のテストが失敗した。偽った出所で残せるのは推論テキストと `providerExecuted` のツールパートだけで、その中身は元からクライアントが書けるテキストと同等 |
| 5 | MEDIUM | Ollama に `num_ctx` を渡していない | fixed（要約の経路だけ） | `runtimeOptions()` で `providerOptions.ollama.options.num_ctx = contextWindow` を渡す。`ollama-ai-provider-v2@4.0.1` の `buildBaseArgs` が `options` を要求本文へ入れることをソースで確認し、本文に入ることを検査するテスト（pipeline.test.ts:392）もある。チャットとエージェントで未対応のことは traceability の既知の制約 (3) に記録されている（N4） |
| 6 | MEDIUM | 記事 URL の SSRF、タイムアウト、サイズ上限がない | fixed（部分的。残りは受け入れたリスクとして記録） | 下の probe 結果を参照。DNS 経由の迂回と、全量を読んだ後のサイズ検査は traceability の既知の制約 (1)(2) に記録されている（N2、N3） |
| 7 | MEDIUM | Stryker の回避が `_Boundary:_` の外にあり、plan に宣言されていない | fixed | plan C1（plan.md:101）と C18（plan.md:323）に、パッチの理由と外す条件がある。File Structure（plan.md:558、566）にも記載がある。tasks.md:345、361 の `_Boundary:_` に4ファイルを事後で追加し、その旨を注記している |
| 8 | MEDIUM | plan と tasks.md が W3 の実装に追随していない | fixed | tasks.md の `- [ ]` は0件。`output-invalid` は plan の Error Handling と HTTP API（plan.md:490、494）にある。`a16462b` で C8、C9、C11、C12、Data Model、Error Handling を修正後のコードに合わせた（`AgentRunSummary.error` は code と固定文言、settings の `onError`、`generate()` のサブクラス、`url-guard`、`num_ctx`、統合の段階化）。tasks.md の T-18 の `_Boundary:_` に `url-guard` を追加している。ADR-7 の Consequences の記述だけは不足している（N1） |
| 9 | LOW | `</source>` の変種とタイトルを無害化していない | fixed | `/<(\s*\/?\s*source\b[^>]*)>/giu` をタイトルと本文の両方に適用する。7つの変種のテストがあり、正規表現を元に戻すと7件すべて失敗した |
| 10 | LOW | `module/1-1` タグが local テスト未実行のまま付いている | fixed（記録で対応） | tasks.md:170、370 に「実 Ollama では未実行。29.4 の push 前に `mise run test:local` を実行する」と明記されている。実測そのものは未実施のまま |
| 11 | LOW | `onRunEnd` の例外を握りつぶしている | fixed | `onObserverError(error, observer)` へ渡し、コールバック自身の例外だけを無視する。テストは3件 |
| 12 | LOW | `AnyAciTool` が構造型で、手書きのオブジェクトが通る | fixed | `unique symbol` の型ブランドと、モジュール内の `WeakSet` による実行時の確認がある。手書き・複製・機能無効の3通りの拒否と、`@ts-expect-error` のテストがある。ツールの定義と `buildToolSet` は同じ ai-core の中にあり、eval-suite も `defineAciTool` を経由するので、二重読み込みで WeakSet が分かれる心配はない。gate も緑 |
| 13 | LOW | `summarizeRequestSchema.modelId` がカタログの ID に制限されていない | fixed | カタログの `z.enum` を使い、`modelIdMaxLength` を削除した。リポジトリ内に `modelIdMaxLength` の残りの参照はない |
| 14 | LOW | 段階要約の統合プロンプトが予算を検査しない | fixed（テストは一部弱い。N6） | `integrationGroups` が予算内に分けて、`mergeUntilOneGroup` が段階的に統合する。停止性は成り立つ。2件以上の部分要約がある段では、少なくとも1つのグループが2件以上を含む（そうでなければ例外になる）ため、件数は段ごとに必ず減る。部分要約1件だけで予算を超える場合は `contextTooSmall` |
| 15 | LOW | `agent.generate()` の例外で `done` が永久に解決しない | fixed | `GuardedToolLoopAgent.generate` が finalise してから再送出する。`#finalise` を外すとテストが失敗した。`stream()` の経路は settings の `onError` で解決する（probe で確認） |
| 16 | LOW | `MIN_CHUNK_TOKENS` の境界の変異が生き残る | fixed | テスト「stages at exactly MIN_CHUNK_TOKENS per chunk and refuses one token below」が4件の変異を殺した。`plan.ts:185` は生存一覧にない |

### M6 の probe（`fetchableUrl` とリダイレクト）

- **拒否された**:
  - IPv4 の各表記: `127.1`、`0x7f000001`、`2130706433`、`0177.0.0.1`
  - localhost の各表記: `localhost.`、全角の `ｌｏｃａｌｈｏｓｔ`、`localhost%2e`、`loc%61lhost`
  - IPv6: `[::1]`、`[::ffff:127.0.0.1]`、`[0:0:0:0:0:ffff:7f00:1]`、`[::127.0.0.1]`、`[fd00:ec2::254]`、`[::]`
  - その他のアドレス: `169.254.169.254`、`100.100.100.200`、`0`、`255.255.255.255`
  - 名前: `host.docker.internal`、`foo.localhost`、単一ラベルの `ollama`
  - userinfo を使った形（`example.com@127.0.0.1`）と、`http:/\127.0.0.1/` 等の表記揺れ
- **許可された（迂回できる）**:
  - DNS で内部へ向く名前: `127.0.0.1.nip.io`、`localtest.me`
  - LAN の名前: `router.lan`、`myhost.home.arpa`、`kubernetes.default.svc`
  - IPv4 を埋め込む IPv6 の変種: `[::ffff:0:7f00:1]`（SIIT）、`[2002:7f00:1::]`（6to4）、`[64:ff9b:1::7f00:1]`（ローカル用の NAT64）、Teredo
- **リダイレクト**:
  - private や IPv6 の mapped 形式、プロトコル相対の `//169.254.169.254/`、大文字の `Location` ヘッダーは、いずれも `disallowed-url`
  - 相対パスは追従する
  - ループは6回取得した後に `http-status`
  - 無効な `Location`（`http://[`）は **`TypeError: Invalid URL` がそのまま漏れる**（N5）
- **タイムアウト**: シグナルを無視する fetcher でも、fake clock を 15 秒進めると `SourceFetchError("timeout")` になる。放置した要求が後で reject しても、unhandled rejection は出なかった

## Critique（新規指摘）

### [MEDIUM] N1: M4 の修正（provider フィールドを常に除く）の結果、OpenAI / Azure への同じプロバイダの推論の再送が、生の推論テキストを含む警告として stderr に出る
**Location**: packages/ai-core/src/chat/adapt-history.ts:60,68; `@ai-sdk/openai@4.0.84` dist/index.js:5006-5009; `ai@7.0.128` dist/index.js:582-603
**Issue**: 推論パートを同じプロバイダ（`metadata.modelId` が `gpt-5.1` など）向けに残す一方で、`providerMetadata.openai.itemId` / `reasoningEncryptedContent` を必ず除くため、`@ai-sdk/openai` は推論パートを捨てて、パート全体の JSON を本文に入れた警告を出す。AI SDK はこの警告を、既定（`AI_SDK_LOG_WARNINGS` が未設定。リポジトリ内に設定箇所はない）で `process.emitWarning` から stderr に出す。
**Evidence**: probe で次を確認した。
- `adaptHistoryForModel` の出力は `{"type":"reasoning","text":"REASONING ABOUT USER SECRET PLAN"}`（itemId なし）
- `generateText` に `createOpenAI` の Responses モデルを渡すと、警告が `Non-OpenAI reasoning parts are not supported. Skipping reasoning part: {"type":"reasoning","text":"REASONING ABOUT USER SECRET PLAN"}.` になり、要求本文に推論は含まれなかった

修正前は、itemId が残っていれば `store` の既定で `item_reference` になり、警告は出なかった。constitution 原則 7「生のプロンプト…をログに出力しない」に H3 と同じ形で反する。また、ADR-7 の「同じプロバイダの推論は残す」は、Anthropic（署名なしで警告して捨てる）に加えて OpenAI / Azure でも実質的に機能しない。research.md の ADR-7 の Consequences と traceability の既知の制約 (5) は Anthropic しか挙げていない。
**Confidence**: high（OpenAI では実測。Azure は同じ実装を使うと推定）
**Fix**: 署名を検証できる metadata ができるまでは、推論パートを常に除く（`reasoning` / `reasoning-file` → `undefined`）。あわせて、サーバー側で `globalThis.AI_SDK_LOG_WARNINGS` を、warning の `type` だけを記録する関数にするか `false` にする方針を plan C8 / C15 に入れる。推論を常に除くことと、警告が出ないこと（`AI_SDK_LOG_WARNINGS` を関数に差し替えて検査する）をテストで固定し、ADR-7 の Consequences を直す。

### [MEDIUM] N2: 記事 URL の検査はリテラルだけなので、公開 DNS 名で内部アドレスへ到達できる（受け入れたリスクとして記録済み）
**Location**: packages/ai-core/src/summarize/url-guard.ts:7-8; source.ts:278-292
**Issue**: `127.0.0.1.nip.io` や `localtest.me` のように 127.0.0.1 へ解決される公開名が `fetchableUrl` を通るため、round 1 で指摘した SSRF（Ollama の `:11434` や LAN の内部応答を要約として読み出す）は、名前を変えるだけで今も成立する。
**Evidence**: probe で `fetchableUrl("http://127.0.0.1.nip.io/")` が ALLOWED になった。round 1 の Fix は「名前解決後のアドレスを検査する」ことだった。`a16462b` の traceability は、これを既知の制約 (1) として受け入れている。
**Confidence**: high
**Fix**: Node の既定の fetcher（`createNodeHttpFetcher`）で、undici の `Agent({ connect: { lookup } })`（または `dns.lookup` の後に IP を固定して接続する方法）を使い、接続先の IP を `isBlockedHostname` と同じ規則で検査する。これで rebinding も防げる。受け入れたままにする場合は、`next dev` が全インターフェースで待ち受ける前提での脅威（同じ LAN の第三者）を research.md の Risks に明記し、プロダクトの責任者の判断として記録する。

### [LOW] N3: 本文 5 MiB の上限は全量を読んだ後に検査するので、メモリの上限にならない（記録済み）
**Location**: packages/ai-core/src/ports/http.ts:22; source.ts:328
**Issue**: `createNodeHttpFetcher` は `await response.text()` で全量を読み、その後で `Buffer.byteLength` を検査する。15 秒のタイムアウトの間に高速な LAN や悪意のあるサーバーから数百 MB を受け取れる。
**Evidence**: `body: await response.text()`。`Content-Length` の事前検査もない。traceability の既知の制約 (2) に記録済み。
**Confidence**: high
**Fix**: `HttpFetcher.fetch` に `maxBodyBytes` を加え、`response.body` のリーダーで累積バイト数を数えて、超えたら `cancel()` して `too-large` にする。`Content-Length` が上限を超えるときは本文を読まずに拒否する。

### [LOW] N4: Ollama の `num_ctx` を要約にだけ渡しているため、チャット・エージェントと交互に使うとモデルを読み込み直す（記録済み・未実測）
**Location**: packages/ai-core/src/summarize/pipeline.ts:87-92
**Issue**:
- チャットとエージェントはサーバーの既定のコンテキスト長のまま、長い履歴が黙って切り詰められる
- `num_ctx` が要求ごとに変わるため、Ollama はランナーを再読み込みする
- 40,960 の KV キャッシュは、学習者の PC のメモリを圧迫しうる

**Evidence**: traceability の既知の制約 (3)(4) に記録されている。
**Confidence**: medium
**Fix**: 29.4 の `mise run test:local` で、再読み込みの時間とメモリ量を実測して research.md に記録する。必要なら、チャットとエージェントにも同じ `num_ctx` を渡して値をそろえる。

### [LOW] N5: リダイレクト先の `Location` が無効な URL のとき、`TypeError` がそのまま漏れる
**Location**: packages/ai-core/src/summarize/source.ts:319
**Issue**: `new URL(location, target)` の例外が `SourceFetchError` に変換されないため、plan の Error Handling（記事の取得失敗は LLM を呼ぶ前に 422 `source-unavailable`）から外れて、想定外のエラーになる。
**Evidence**: probe で `location: "http://["` を返すと `TypeError Invalid URL` になった。
**Confidence**: high
**Fix**: `fetchableUrl(new URL(location, target))` を try で囲み、失敗したら `SourceFetchError("disallowed-url")`（または `http-status`）を投げる。テストを1件加える。

### [LOW] N6: 統合のトークン見積もりの変異が生き残っている（L14 の新しいコード）
**Location**: packages/ai-core/src/summarize/plan.ts:206,209,99
**Issue**: `integrationRawTokens` について次の変異が `mise run test:mutation` で生き残った。統合の予算判定（L14 の修正の本体）の境界がテストで固定されていない。
- 空のプロンプトの overhead を `["Stryker was here"]` に変える変異
- 改行の `+ 1` を `- 1` に変える変異
- 既存の `chunkBudgetTokens` の `- overhead` を `+ overhead` に変える変異（plan.ts:99。これは round 1 から継続している可能性がある）

**Evidence**: mutation の出力の `[Survived] plan.ts:206:49`、`209:23`、`99:9`。
**Confidence**: high
**Fix**: 予算ちょうどで1グループに収まり、1トークン超えると2グループに分かれる部分要約の組で、`integrationGroups` の境界テストを加える。`chunkBudgetTokens` が `contextBudgetTokens - overhead` に一致すること（各チャンクのプロンプト全体が予算内に収まること）を検査する。

### [LOW] N7: URL の検査で、LAN 用の特殊な名前と、IPv4 を埋め込む IPv6 の一部の変種が拒否されない
**Location**: packages/ai-core/src/summarize/url-guard.ts:16,75-90
**Issue**: 次の名前とアドレスが許可される。
- `*.home.arpa`（RFC 8375 のホームネットワーク用）、慣習的な `*.lan`
- `::ffff:0:a.b.c.d`（SIIT）
- `2002::/16`（6to4）
- `64:ff9b:1::/48`（RFC 8215 のローカル用の NAT64）
- `2001::/32`（Teredo）

**Evidence**: probe の ALLOWED 一覧（上記）。v4 埋め込みの変種は経路がなければ到達しないため、実害は環境に依存する。
**Confidence**: medium
**Fix**: `.home.arpa` と `.lan` を `BLOCKED_SUFFIXES` に追加する。NAT64 のローカル用プレフィックスと SIIT は埋め込みの IPv4 で判定する。6to4 と Teredo は丸ごと拒否する。

## Verdict
REQUEST_CHANGES

N1 を理由とする。M4 の修正が原則 7（生のプロンプト由来のテキストをログに出さない）の違反を新たに持ち込んでおり、H3 と同じ種類の問題である。N2 は受け入れたリスクとして記録されているが、迂回が容易なため再考を推奨する。round 1 の16件は、部分対応が明記されたものを含めてすべて対応済みと確認した。

## Hallucination Signal
forced: false
