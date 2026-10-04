## Critique

### [HIGH] Cassette 保存先のパストラバーサルは解消済み（prior: resolved）
**Location**: packages/ai-core/src/mock/cassette-store.ts:14-15,74-90; packages/ai-core/src/mock/resolve.test.ts:116-138
**Issue**: prior finding の保存先逸脱は、閉じた storage key allowlist により再現しなくなった。
**Evidence**: `storageKeySchema` は `^(?:llm|http|transcripts|web-search)/[a-f0-9]{64}$` だけを許可し、`fileFor()` は検証済みキーだけを解決済み root に結合する。恒久テストも `store.put("../escaped", {})` の reject を確認しており、second pass のコード確認でも絶対パス・`..`・追加区切りを通す経路はない。
**Confidence**: high
**Fix**: なし。

### [HIGH] 同一キー並行録画の固定一時ファイル競合は解消済み（prior: resolved）
**Location**: packages/ai-core/src/mock/cassette-store.ts:100-108; packages/ai-core/src/mock/resolve.test.ts:116-138
**Issue**: prior finding の `ENOENT` 競合は、一時ファイル名への UUID 追加により解消した。
**Evidence**: 一時名は `${target}.${process.pid}.${randomUUID()}.tmp` で書込みごとに一意になり、同一キーへの2並行 `put()` がともに fulfilled になるテストがある。second pass の独立 probe でも2件とも fulfilled になった。最終値は last-writer-wins だが、prior finding の「正常リクエスト自体が失敗する」障害は再現しない。
**Confidence**: high
**Fix**: なし。

### [HIGH] 伏せ字化 fixture を元入力で再生できない問題は解消済み（prior: resolved）
**Location**: packages/ai-core/src/mock/recording.ts:231-248,258-315; packages/ai-core/src/mock/fixtures.ts:136-184,210-275; packages/ai-core/src/mock/recording.test.ts:291-347
**Issue**: prior finding の録画時入力と replay 時照合値の不一致は、秘密値を本文へ保存しない request key を録画・再生で共有することで解消した。
**Evidence**: HTTP・字幕・Web検索は元入力から `httpFixtureRequestKey` / `transcriptFixtureRequestKey` / `webSearchFixtureRequestKey` を生成し、fixture には hash の `requestKey` と伏せ字化表示値を保存する。統合テストは秘密値を含む元 URL・videoId・query で録画し、filesystem の `loadFixtureSet()` と実 factory を経て同じ元入力で replay し、fixture 全体に秘密文字列がないことも確認する。
**Confidence**: high
**Fix**: なし。

### [MEDIUM] Task 13.4 replay テストの fake-pass は解消済み（prior: resolved）
**Location**: packages/ai-core/src/mock/recording.test.ts:291-347
**Issue**: prior finding の手製 replay object だけに依存する統合契約の未検証は、実 loader/factory を通すテスト追加で解消した。
**Evidence**: 新しい統合テストは `createCassetteStore()` へ録画後、`loadFixtureSet(root)`、`createFixtureHttpFetcher()`、`createFixtureTranscriptSource()`、`createFixtureWebSearch()` を実際に呼び、元入力 replay と HTTP body 相違時の miss を検証する。古い手製 replay テストは残るが、実結線を検証する独立テストが追加されたため prior finding は verdict に影響しない。
**Confidence**: high
**Fix**: なし。

### [MEDIUM] Cassette v1 の Zod 検証は stream part の形を検証しておらず、prior finding は一部未解消
**Location**: packages/ai-core/src/mock/cassette-store.ts:16-53,82-85; packages/ai-core/src/mock/scenario-model.ts:82-107; packages/ai-core/src/mock/resolve.test.ts:140-150
**Issue**: version・key・request の境界検証は追加されたが、`parts` は `type` の列挙だけを確認する loose object なので、必須フィールドを欠く不正 part を受理する。
**Evidence**: `streamPartSchema` は全種共通で `z.looseObject({ type: z.enum(...) })` のみであり、例えば `{ "type": "text-delta" }` に必要な `id` と `delta` を要求しない。second pass の独立 probe では、この part を持つ version 1 JSON を `createCassetteStore(root).get(key)` が `ACCEPTED [{"type":"text-delta"}]` として返した。`generateFromParts()` はその後 `part.id` / `part.delta` を使用するため、境界で拒否されず不正値が runtime まで流れる。追加テストも version 2 の拒否だけで、part shape を検証していない。
**Confidence**: high
**Fix**: AI SDK v4 stream part の discriminated union に対応する Zod schema を定義し、少なくとも replay が利用する各 type の必須フィールドと finish usage/reason を検証する。不正 `text-delta`、不正 `finish`、key/filename 不一致の恒久テストを追加する。

### [MEDIUM] HTTP fixture の URL-only identity は解消済み（prior: resolved）
**Location**: packages/ai-core/src/mock/fixtures.ts:128-175,210-225; packages/ai-core/src/mock/recording.ts:231-248; packages/ai-core/src/mock/recording.test.ts:291-339
**Issue**: prior finding の method/header/body を無視した recorded fixture 衝突は、共有 HTTP request identity の導入で解消した。
**Evidence**: `describeHttpFixtureRequest()` は既定 GET を含む method、機密 header を除いた canonical header digest、body digest を生成し、`httpFixtureRequestKey()` は伏せ字化済み canonical URL と request descriptor を hash する。録画側と replay 側は同じ helper を使い、統合テストは同じ URL・method・header でも body が異なる要求を `MockFixtureMissingError` にする。実装上、method または非機密 header が異なる場合も request key が変わる。
**Confidence**: high
**Fix**: なし。

### [LOW] Stream cancellation 時に cassette を保存しない挙動は、明示契約・恒久テストがなく未解消
**Location**: packages/ai-core/src/mock/recording.ts:206-223; packages/ai-core/src/mock/recording.test.ts:157-201
**Issue**: prior finding の cancellation 経路はコード上そのままで、「完了した応答だけを cassette とする」契約として許容するための明文化とテストも追加されていない。
**Evidence**: 保存処理は引き続き `TransformStream.flush()` だけにあり、既存テストは reader を EOF まで読む正常完了だけを検証する。consumer cancellation 時に未保存となることを意図した仕様として固定する assertion や、tasks/plan の契約記述は見当たらない。
**Confidence**: high
**Fix**: 「正常完了し finish まで受信した応答だけを cassette とし、中断・cancel の部分応答は保存しない」と契約を明記し、reader cancellation 後に `store.put` が呼ばれない恒久テストを追加する。部分 cassette が必要なら別 version/状態を設計する。

## Verdict
REQUEST_CHANGES

## Hallucination Signal
forced: false
