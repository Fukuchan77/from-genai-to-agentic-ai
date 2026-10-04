## Critique

### [HIGH] 公開 `CassetteStore.put()` が保存先ディレクトリ外へ任意ファイルを書ける
**Location**: packages/ai-core/src/mock/cassette-store.ts:26-33,43-51
**Issue**: 公開 API の `put(key: string, value: unknown)` が `../` を含むキーを無検証で `path.join()` するため、呼び出し側が cassette root 外へ JSON を書き出せる。
**Evidence**: 実装は `key.includes("/") ? key : \`llm/${key}\`` をそのまま結合している。独立 probe で `createCassetteStore(root).put("../escaped", { escaped: true })` を実行すると、`root` の兄弟に `escaped.json` が作成され内容も読み取れた。C7 は `createCassetteStore` を `@platform/ai-core/mock` の後続 spec 向け公開契約としているため、内部専用という前提では防御できない。
**Confidence**: high
**Fix**: 許可するキー形式を閉じた形式（`llm/<64hex>` または種類別の `<kind>/<64hex>`）で検証し、`path.resolve()` 後の保存先が cassette root 配下であることを確認する。`CassetteStore.put` も `RequestKey`/種類別メソッドへ狭め、`../`、絶対パス、区切り文字変種の拒否テストを追加する。

### [HIGH] 同一キーの並行録画が固定一時ファイル名の競合で正常リクエストを失敗させる
**Location**: packages/ai-core/src/mock/cassette-store.ts:43-51
**Issue**: 一時ファイル名が `${target}.${process.pid}.tmp` 固定なので、同一プロセス内で同じ request key を並行録画すると一方の `rename()` が `ENOENT` になり、成功済みの LLM/外部サービス呼び出しまで失敗へ変わる。
**Evidence**: 独立 probe で同じ store に `Promise.allSettled([put("same", ...), put("same", ...)])` を実行すると、一方が `ENOENT ... llm/same.json.<pid>.tmp -> llm/same.json`、他方だけが fulfilled となった。`recordingMiddleware` と各 port wrapper は `await store.put(...)` しているため、この競合は録画だけでなく利用者のリクエスト結果にも伝播する。
**Confidence**: high
**Fix**: 一時名へ暗号学的ランダム値または単調カウンタを含め、同一 target の書込みを per-key で直列化する。少なくとも同一キー二重書込みと異なるキー並行書込みの恒久テストを追加する。

### [HIGH] 秘密値を含む入力を伏せ字化して保存するため、同じ呼び出しを fixture runtime で再生できない
**Location**: packages/ai-core/src/mock/recording.ts:249-258,274-289,302-318; packages/ai-core/src/mock/fixtures.ts:131-177; packages/ai-core/src/mock/recording.test.ts:244-269
**Issue**: 録画側は URL・videoId・query 自体を伏せ字化して fixture の照合キーへ保存する一方、再生側は実行時入力との完全一致だけを見るため、秘密値を含む元の呼び出しは必ず `MockFixtureMissingError` になる。
**Evidence**: HTTP は `url: redactedUrl`、Web 検索は `query: recordedQuery` を保存するが、fixture factory は `byUrl.get(url)` / `byQuery.get(query)` で未正規化入力を引く。テストも元の `"query session-secret"` ではなく、わざわざ `"query [REDACTED]"` で手製 replay を成功させており、Task 13.4 の「録画した fixture を 13.6 の fixture 実装で再生すると同じ結果」の契約を満たしていない。API key を query parameter に持つ HTTP API はこの経路を現実に踏む。
**Confidence**: high
**Fix**: 秘密値を保存せず照合できる安定した request identity を設計する。例えば sensitive query parameter は値を除外して canonical key を作り、録画側と再生側で同じ canonicalizer を共有する。元入力で録画→ファイル保存→`loadFixtureSet`→実 factory 再生まで通す統合テストを追加する。

### [MEDIUM] Task 13.4 の replay テストが実際の Task 13.6 factory を一度も呼ばない fake-pass になっている
**Location**: packages/ai-core/src/mock/recording.test.ts:220-269; packages/ai-core/src/mock/fixtures.test.ts:26-76; specs/001-agentic-ai-platform/tasks.md:403
**Issue**: 明示された統合契約をテスト内の手製 `TranscriptSource` / `WebSearchProvider` で再実装しており、録画形式と実 fixture schema/factory がずれてもテストが通る。
**Evidence**: Task 13.4 は「録画した字幕・Web 検索を 13.6 の fixture 実装で再生すると同じ結果になること」を要求するが、テストは `const fixture = writes[0]?.value as ...` と型 assertion した後、独自 replay object を構築している。`createFixtureTranscriptSource`、`createFixtureWebSearch`、`loadFixtureSet` は import されず、PDCA の PROVE も保存停止だけを壊してこの結線を証明していない。
**Confidence**: high
**Fix**: 録画 store を一時 cassette directory に接続し、生成 JSON を `loadFixtureSet` で読み、実 `createFixtureTranscriptSource` / `createFixtureWebSearch` から元入力を再生するテストへ置換する。録画側と再生側の fixture 型も単一定義から import する。

### [MEDIUM] LLM cassette の JSON 境界が無検証で、constitution の Zod 境界規則に違反する
**Location**: packages/ai-core/src/mock/cassette-store.ts:35-40; packages/ai-core/src/mock/scenario-model.ts:104-108
**Issue**: `JSON.parse(...) as Cassette` だけで version、key、purpose、parts、recordedWith を検証せず、破損・古い版・手編集された cassette を信頼して model stream へ流す。
**Evidence**: `.sdd/steering/tech.md` は「システム境界は Zod で検証」と定め、fixture loader は実際に Zod parse しているが、LLM cassette store だけが unchecked cast である。`partsFor()` はその `parts` をそのまま返すため、不正 part は利用箇所まで遅延して不明瞭に壊れる。version 1 を宣言していても version mismatch の拒否テストはない。
**Confidence**: high
**Fix**: Cassette v1 の厳格 Zod schema を定義し、`get()` で parse する。unknown field 方針、version mismatch、key/filename 不一致、不正 stream part、catalog 外 model ID の診断をテストする。

### [MEDIUM] HTTP fixture の identity が URL だけで、method/body/header が異なる要求を誤再生する
**Location**: packages/ai-core/src/ports/http.ts:1-10; packages/ai-core/src/mock/recording.ts:243-259; packages/ai-core/src/mock/fixtures.ts:131-143
**Issue**: `HttpFetcher` は完全な `RequestInit` を受け取るのに、録画・索引は URL だけなので、同一 URL の GET/POST、異なる POST body、content negotiation が同じ fixture として衝突する。
**Evidence**: recording は `init` を inner へ渡すだけで fixture へ保持せず、保存キーも `digest(redactedUrl)` だけである。再生側も `init` を abort signal 以外無視し `byUrl.get(url)` する。C7 はこの形式を後続 spec も使う公開契約としているため、RAG/MCP 等の POST API 追加時に誤った deterministic pass を作る。
**Confidence**: high
**Fix**: method（既定 GET）、canonical headers の必要部分、body digest を含む HTTP request key/schema を定義し、録画と再生で共有する。URL 同一・method/body 相違の fixture を識別するテストを追加する。

### [LOW] ストリームを最後まで消費しない通常の中断経路では cassette が保存されない
**Location**: packages/ai-core/src/mock/recording.ts:218-233
**Issue**: cassette 保存が `TransformStream.flush()` にしかなく、consumer cancellation・接続切断・途中停止時は録画が消える。
**Evidence**: `transform()` は parts を蓄積するだけで、`cancel`/abort/finally 相当の保存経路がない。Task 13.4 のテストは必ず reader を EOF まで消費しており、中断ケースの PROVE もない。
**Confidence**: medium
**Fix**: 完了 cassette だけを保存する契約なら中断を明示記録・テストし、部分 cassette も必要なら cancellation 時の安全な保存形式を定義する。少なくとも reader cancellation が無言で録画を失う現状を恒久テストで固定または是正する。

## Verdict
REQUEST_CHANGES

## Hallucination Signal
forced: false
