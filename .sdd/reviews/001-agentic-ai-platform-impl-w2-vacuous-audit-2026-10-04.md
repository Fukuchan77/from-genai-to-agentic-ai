# 001-agentic-ai-platform W2 テスト非空虚性監査（2026-10-04）

- 対象: spec `001-agentic-ai-platform` Wave 2（Task 6〜13）のテスト。`packages/ai-core/src/**/*.test.ts` 18 files と `scripts/check-web-theme.test.mjs`
- 種別: 読み取り専用の監査。ソースとテストは変更していない
- 基準: `~/.claude/skills/test-strategy/tdd-workflow.md` Phase 3.5（PROVE と false-green パターン）、adversarial-review の Zero-Tolerance List
- 参照した過去レビュー: `001-agentic-ai-platform-impl-w2-review-2026-09-30{,-r2,-r3}.md`、`agentic-ai-platform-11.md`、`agentic-ai-platform-10.3-10.4.md`、`001-agentic-ai-platform-impl-w1-vacuous-audit-2026-09-27.md`

## 独立に実行した確認

- `AI_TEST_RUN_MODE=mock AI_TEST_SUITE=gate mise exec -- pnpm --filter @platform/ai-core exec vitest run --reporter=verbose`
  - `Test Files 18 passed (18)`、`Tests 110 passed | 2 skipped (112)`。do.md 3013 の ai-core `executed=110 passed=110 skipped=2` と一致する
  - skip は `src/testing/local-only.test.ts` の2件だけ。理由は `[Local tests require AI_TEST_RUN_MODE=local.]`
  - 全テスト名が verbose 出力に個別に出ている。収集件数0の parametrization はなかった
  - Coverage: All files lines 94.05%。`recording.ts` lines 80.59% / branches 48.97% が最も低い。`local-only.ts` line 27（`reason ?? "Local model is unavailable."` のフォールバック）は未実行
- `mise exec -- pnpm exec vitest run scripts/check-web-theme.test.mjs --reporter=verbose` → `Tests 23 passed (23)`
- `git status --short` → 実行後も clean

## 1. PROVE 証拠（ファイル別）

以下の行番号は `specs/001-agentic-ai-platform/pdca/do.md` のもの。

| テストファイル | テスト数 | PROVE | do.md の該当範囲 | 実行証拠（件数の増分・テスト名・カバレッジ） |
|---|---|---|---|---|
| `src/errors.test.ts` | 3 | **あり** | 1781–1794（3件それぞれの破壊と失敗メッセージ）、1889–1893（語彙テストを書き直した後の破壊） | 1796–1803（0 → 3、lines 100%）、1938–1943 |
| `src/models/catalog.test.ts` | 7 | **あり** | 2391–2396、2406–2421（7件すべての破壊と失敗メッセージの表） | 2398–2404（verbose 実行で7件を名前で確認、`catalog.ts` lines 100%）、2423–2430 |
| `src/ports/clock.test.ts` | 3 | **あり** | 2489–2491 | 2504–2510（4 files 12/12） |
| `src/ports/http.test.ts` | 2 | **あり** | 2492–2493 | 2504–2510 |
| `src/ports/transcript.test.ts` | 22 | **あり** | 2494–2498、2545–2556、2578–2588、2598–2601（22ケースすべてに対応する行がある） | 2560–2566（22 → 31）、2591（→ 44）、2605（→ 46）、`transcript.ts` lines 96% |
| `src/ports/web-search.test.ts` | 8 | **あり**（細部に不足） | 2499–2500、2553–2556、2587–2588、2602 | 同上、`web-search.ts` lines 100%。最後のテストの「caller abort で reject」部分には専用の破壊記録がない |
| `src/testing/mock-models.test.ts` | 3 | **あり**（細部に不足） | 2654–2656 | 2664–2670（46 → 51）。3件とも generate 側だけを壊しており、stream 側の assertion を壊した記録はない |
| `src/testing/local-only.test.ts` | 6（実行4 / skip 2） | **一部** | 2657–2658（`createLocalTestApi` の2件）、2678–2682（fake clock の再公開）、2694（`globalSetup` を外すと collection が失敗する RED） | 2699–2701（53 passed / 2 skipped）。公開 integration の2件はどのレーンでも実行されない（M-1） |
| `src/config/env-schema.test.ts` | 9 | **あり**（失敗メッセージは代表例のみ） | 2765–2775（21 mutations、各回 `Tests 1 failed`） | 2777–2784（53 → 74、`env-schema.ts` 100%） |
| `src/config/feature-requirements.test.ts` | 3 | **あり** | 2772（3件の失敗メッセージ） | 同上 |
| `src/config/run-mode.test.ts` | 4 | **あり** | 2773、2805–2806（M1） | 2810–2815（74 → 77） |
| `src/config/load.test.ts` | 8 | **あり** | 2774、2805–2807（M1/M2） | 2777–2784、2810–2815（`load.ts` 89.74% → 92.3%） |
| `src/mock/request-key.test.ts` | 4 | **一部** | 2846（`providerOptions` の除外を壊した1件だけ） | 2906–2916（77 → 106）。`changes when %s changes` の3ケースに PROVE がない（M-3） |
| `src/mock/scenario-model.test.ts` | 3 | **あり**（壊し方が粗い） | 2847 | 同上。応答の内容を `BROKEN` にした1回の破壊で3件が失敗しただけで、`stepIndex` / `toolResultFor` の導出は壊していない |
| `src/mock/resolve.test.ts` | 6 | **一部** | 2848–2849、2957–2959、2985 | 2964–2970、2989–2994。`exposes only keys and scenario ids in missing-fixture diagnostics` には PROVE がない |
| `src/mock/recording.test.ts` | 8 | **あり**（記録はまとめてで、テストとの対応がない） | 2901、2960–2961、2986 | 2906–2916、3013（`recording.ts` lines 80.59%） |
| `src/mock/deterministic-embedding.test.ts` | 5 | **あり** | 2902 | 2906–2916 |
| `src/mock/fixtures.test.ts` | 7 | **あり** | 2903（「全7テスト」）、2961 | 2906–2916 |
| `scripts/check-web-theme.test.mjs` | 23 | **一部** | 2174–2183（border）、2200–2209（ring）、2304–2306・2315–2324（opaque outline） | 2351（root 257 件、+23）。text 4.5:1 の16件は RED の時点から green で、破壊を一度もしていない（M-4） |

まとめ: 全19ファイルのうち「あり」が15、「一部」が4（`local-only`、`request-key`、`resolve`、`check-web-theme`）、「なし」は0。実行証拠（件数の増分と、テスト名・カバレッジ）は全ファイルで記録されており、今回の再実行結果とも一致した。

## 2. false-green の走査

| パターン | 結果 |
|---|---|
| Def-time default binding | 該当なし。config 系のテストはすべて env を明示的に渡しており、`process.env` に依存していない（`loadPlatformConfig({})` が Vitest 内で `local` を返すことで確認できる） |
| Always-true assertion | **該当あり**: `local-only.test.ts:21`、`:28`（M-1） |
| Assertion on the mock | **実質的に該当**: `recording.test.ts:311`。テスト内で自作した replay が `fixture.result` を返し、それを `fixture.result` と比べている（M-2） |
| Swallowed exception | 該当なし。`load.test.ts:53–61` は try/catch で受けた値を後で assert している。`catalog.test.ts:152–165` は try/finally で後片付けをしているだけ |
| Empty or skipped body | **条件付き skip が2件**: `local-only.test.ts:19–30`。理由付きの skip で、Req 1.14 の設計どおりなので skip 自体は正当。ただし、どのレーンでも実行されることがない（M-1） |
| Zero-case parametrization | `it.each` は全部リテラル配列で、0件のものはない。0件になるループが1つある: `catalog.test.ts:160` の `bundledIds` は、カセットのディレクトリに `.gitkeep` しかないため常に0件（L-1） |
| Target never imported | 該当なし。全ファイルが対象 module を import して呼んでいる。`check-web-theme.test.mjs` は CSS を静的に検査するテストで、`globals.css` を読み込んでいる |

## Critique

### [MEDIUM] `describeLocal` / `itLocal` の公開 integration テストが、どのレーンでも実行されず、本体も常に真
**Location**: packages/ai-core/src/testing/local-only.test.ts:19-30
**Issue**: 2件の本体は `localExpect(true).toBe(true)` だけです。gate（`AI_TEST_RUN_MODE=mock`）では必ず skip され、`test:local`（`AI_TEST_SUITE=local`）では include の `src/**/*.local.test.ts` に `local-only.test.ts` が当てはまらないため収集されません。このため「available のときに本体が実行される」という主張は一度も実行されていません。さらに、unavailable のときの skip も assertion ではなく reporter の表示を見ているだけです。
**Evidence**: `localIt("runs its body when local models are available", ({ expect: localExpect }) => { localExpect(true).toBe(true); });`、mise.toml `[tasks."test:local"] env = { AI_TEST_RUN_MODE = "local", AI_TEST_SUITE = "local" }`、vitest.config.ts `include: [\`src/**/*.${suite.suffix}.ts\`]`（local の suffix は `local.test`）。例として、`local-only.ts:56` の実際の `beforeEach` adapter を `() => {}` に退行させると、describeLocal の integration は skip されずに実行され、常に真の本体で green になります。`createLocalTestApi` の単体テストは自前の registrar を使うので、この退行は検出されません。gate は `112 passed / 0 skipped` で成功してしまいます。
**Confidence**: high
**Fix**: 本体で `expect(inject("localAvailability").available).toBe(true)` のように前提を確かめるか、`expect.hasAssertions()` に加えて副作用（spy）を assert するようにしてください。あわせて、unavailable 側を実 Vitest 上で assert するテストを追加してください。たとえば `onTestFinished` か `ctx.task.result?.state === "skip"` を確認する子テストや、`createVitest` を使ったプログラム実行で `skip` と note を検査する方法があります。available 側は、`*.local.test.ts` に移して `test:local` で実行されるようにしてください。（prior: `agentic-ai-platform-11.md` Round 2 は「available 時は通常実行される構成」と判断して解消扱いにしていました。今回、include の glob によってどのレーンでも実行されないことを新しい証拠として確認しました）

### [MEDIUM] web-search の録画テストの replay assertion が自分自身との比較になっている
**Location**: packages/ai-core/src/mock/recording.test.ts:302-311
**Issue**: テスト内で自作した `replay.search()` は `fixture.result` をそのまま返します。それを `toEqual(fixture.result)` で比べているので、確かめているのは「`query` が一致し、`result` が配列であること」だけです。録画された内容（伏せ字にした後の hits）が正しいかは検証していません。
**Evidence**: `async search(query) { if (fixture.query !== query || !Array.isArray(fixture.result)) throw ...; return fixture.result; }` … `expect(await replay.search("query [REDACTED]")).toEqual(fixture.result);`。`result: []` を保存する退行があってもこのテストは通ります。統合テスト（:364）は秘密値を含まない hits しか使わないので、伏せ字にした後の title / url / snippet / score の形はどこでも検証されていません。
**Confidence**: high
**Fix**: 期待値を要件から導いたリテラルにしてください（`[{ title: "Result", url: "https://example.test/result?token=[REDACTED]", snippet: "secret [REDACTED]", score: 0.9 }]`。`url` のエンコード規則は redactor の仕様に合わせる）。手製の replay は削除し、`createFixtureWebSearch([fixture])` を使ってください。（prior: W2 r1 の MEDIUM「replay テストの fake-pass」は r2 で統合テストの追加により解消扱いになり、「古い手製 replay テストは残る」と記録されていました。今回は、この行が自分自身と比べているという新しい観察を示します）

### [MEDIUM] `requestKey` の「入力が変わればキーも変わる」3ケースに PROVE がない
**Location**: packages/ai-core/src/mock/request-key.test.ts:37-51
**Issue**: キーが定数になる退行（すべての入力に同じ hash を返す）を止めているのはこの `it.each` だけですが、do.md 2843–2850 の PROVE は `providerOptions` の除外を壊した1件しか記録していません。
**Evidence**: do.md 2846「`providerOptions` の除外を破壊 → request normalization test が `expected ... to deeply equal ...` で失敗」。`changes when prompt/tool name/purpose changes` への破壊は記録されていません。最初のテストは形式（`/^[a-f0-9]{64}$/`）と2つのキーが等しいことしか見ていないので、定数キーでも通ります。
**Confidence**: medium（コードを読む限り、3ケースは定数キーで失敗するはずです。ただし証拠として記録されていません）
**Fix**: `requestKey` を定数 hash に置き換える、`normalizeRequest` から `prompt` / `tools` / `purpose` を1つずつ外す、の各破壊を行い、該当ケースの失敗メッセージを do.md に記録してください。

### [MEDIUM] テーマコントラストテストのうち text 4.5:1 の16件が一度も失敗していない
**Location**: scripts/check-web-theme.test.mjs:83-87
**Issue**: RED で失敗したのは border / input の4件だけで、PROVE で壊したのも border、ring、outline の3つだけです。text の組み合わせ16件は、最初から green の状態でしか実行されていません。
**Evidence**: do.md 2176「初回実行は light 1.5649:1、dark 2.1063:1 で4 tests が失敗」、2180–2183 は light `--border` の破壊だけ、2206–2209 は light ring の破壊だけ。text の組み合わせ（`muted-foreground` など）への破壊はありません。OKLCH → sRGB 変換の実装を確認したところ係数は Ottosson の式と一致しており、変換が誤っているという証拠はありません。
**Confidence**: medium
**Fix**: light / dark それぞれで、foreground 系のトークンを1つ背景に近い明度へ変えて失敗することを確認し、do.md に記録してください（例: `--muted-foreground: oklch(0.80 0.02 265)`）。

### [LOW] カセットのモデル ID 照合で、bundled 側のループが常に0件
**Location**: packages/ai-core/src/models/catalog.test.ts:146-166
**Issue**: `fixtures/cassettes/**` には `.gitkeep` しかないので `bundledIds` は `[]` です。照合しているのは、カタログから取った ID を一時ファイルに書いて読み戻したものだけなので、`toHaveProperty` は必ず真になります。カタログ外の ID を検出できるか（負の経路）は一度も確かめられていません。
**Evidence**: `const catalogId = Object.keys(MODEL_CATALOG)[0]; … for (const id of [...bundledIds, ...discoveredIds]) expect(MODEL_CATALOG).toHaveProperty(id);`。do.md 2420 でこの点は意図したものとして記録されており、scanner 自体の PROVE（2417）はあります。
**Confidence**: high
**Fix**: カタログ外の ID（例: `"not-in-catalog"`）を書いた一時カセットについて、照合ヘルパーが失敗する（その ID を報告する）ことを assert する負のケースを追加してください。照合ヘルパーを関数として切り出すと書きやすくなります。

### [LOW] cancel のテストが optional chaining のため、それだけでは何も確かめずに通りうる
**Location**: packages/ai-core/src/mock/recording.test.ts:208-225
**Issue**: `wrapStream` が undefined、または undefined を返す場合でも、`result?.stream`、`reader?.read()`、`reader?.cancel()` はどれも何もせず、`expect(writes).toEqual([])` が成功します。
**Evidence**: `const reader = result?.stream.getReader(); await reader?.read(); await reader?.cancel("user-aborted"); expect(writes).toEqual([]);`。隣のテスト（:191）が `wrapStream` の存在を保証しているので実害は小さいですが、このテストは単独では成立しません。
**Confidence**: high
**Fix**: `if (!result) throw ...` を入れ、最初の `read()` で `{ done: false, value: { type: "text-start" } }` が返ることを assert してください。

### [LOW] resolve の診断テストに PROVE がない
**Location**: packages/ai-core/src/mock/resolve.test.ts:108-114
**Issue**: `MockFixtureMissingError` の message と `details` を固定するテストについて、do.md に破壊の記録がありません。
**Evidence**: do.md 2849 の「missing fixture を generic `Error` に変更」で失敗するのは fallback テスト（:60）です。
**Confidence**: medium
**Fix**: `details` に prompt の本文を含める破壊などで、このテストが失敗することを記録してください。

### [LOW] `toThrow()` / `rejects.toThrow()` が例外の種類を指定していない
**Location**: packages/ai-core/src/config/env-schema.test.ts:63, packages/ai-core/src/config/run-mode.test.ts:23-24, packages/ai-core/src/mock/resolve.test.ts:149, :161
**Issue**: どんな例外でも通ります（入力パスの間違いによる ENOENT や TypeError も含む）。
**Evidence**: `await expect(createCassetteStore(directory).get(key)).rejects.toThrow();`。PROVE（do.md 2959、2985）で「検証を外すと resolve する」ことは確かめられているので、空虚ではありません。
**Confidence**: medium
**Fix**: `toThrow(ZodError)`、`rejects.toBeInstanceOf(...)`、またはメッセージの正規表現で例外を絞ってください。

### [LOW] 一部のループの前に件数の assert がない
**Location**: packages/ai-core/src/mock/deterministic-embedding.test.ts:38, packages/ai-core/src/config/load.test.ts:36
**Issue**: `embeddings` や `config.models` が空の場合、ループが0回で終わってテストが成功します。
**Evidence**: `for (const embedding of embeddings) expect(l2Norm(embedding)).toBeCloseTo(1, 12);`（L2 のテストには件数の assert がない）。`for (const id of Object.values(config.models)) …`
**Confidence**: medium
**Fix**: ループの前に `toHaveLength(2)` や `Object.keys(config.models)` の完全一致を assert してください。

### [LOW] 同じテスト名が重複していて、PROVE で `-t` を使ってもテストを1つに絞れない
**Location**: packages/ai-core/src/ports/transcript.test.ts:91
**Issue**: `"maps youtubei failures to %s"` は `fetch-failed` が5件、`private` が2件、同じ名前になります。
**Evidence**: 今回の verbose 出力で `maps youtubei failures to fetch-failed` が5回出ています。
**Confidence**: high
**Fix**: 名前に入力の説明を加え（例: `"maps %s (%s)"`）、ケースを一意に特定できるようにしてください。

### [LOW] mock-models / scenario-model の PROVE が片側だけ、または粗い
**Location**: packages/ai-core/src/testing/mock-models.test.ts:21-30, :47-59, :73-75; packages/ai-core/src/mock/scenario-model.test.ts:34-77
**Issue**: mock-models は generate 側だけを壊しており、stream 側の assertion は失敗させていません。scenario-model は応答の内容を壊しただけで、テスト名が主張する `stepIndex` と末尾の tool result 名の導出は壊していません。
**Evidence**: do.md 2654–2656（generation text / serialization の固定）、2847（text/object を `BROKEN` に固定）。
**Confidence**: medium
**Fix**: stream 側の delta、`stepIndex` の算出（例: 常に0にする）をそれぞれ壊し、失敗を記録してください。

### [LOW] PROVE の記録がまとめて書かれていて、テストとの対応がない
**Location**: specs/001-agentic-ai-platform/pdca/do.md:2901-2903, 2767-2775
**Issue**: 13.4〜13.6 と Task 12 は「代表的な失敗」や「全7テスト」という書き方で、テストごとの破壊と失敗メッセージの対応が残っていません。
**Evidence**: 「13.4: redactor 恒等化、LLM cassette 保存停止、HTTP / transcript / web-search 保存停止の各 mutation で、秘密値不一致または `expected [] to have a length of 1 but got 0` を確認」
**Confidence**: high
**Fix**: 今後は Task 9 / 10 と同じように「Test | Break | Failure」の表で記録してください。

### [LOW] `local-only.ts` の reason フォールバックと `recording.ts` の分岐のカバレッジが低い
**Location**: packages/ai-core/src/testing/local-only.ts:27, packages/ai-core/src/mock/recording.ts（branches 48.97%）
**Issue**: `availability.reason ?? "Local model is unavailable."` のフォールバックを通るテストがありません。`recording.ts` は分岐の約半分が未実行です。
**Evidence**: 今回の coverage 表で `local-only.ts` は Uncovered 27、`recording.ts` は `...78-284,309-316`。
**Confidence**: high
**Fix**: `{ available: false, reason: null }` のケースと、recording のエラー経路（inner が reject した場合など）のテストを追加してください。

## risk_trigger への回答

- 「PROVE 証拠がない」: 全ファイルで何らかの PROVE が記録されており、完全に欠けているファイルはありません。一部だけのファイルは `local-only`、`request-key`、`resolve`、`check-web-theme` の4つです。
- 「cassette ディレクトリが `.gitkeep` だけのときに 0 件の parametrization になる」: `it.each` は該当しません。0件のループは `catalog.test.ts:160` の1か所で、scanner 自体の PROVE と一時カセットで補われていますが、負の経路が未検証です（L-1）。
- 「local-only の skip」: Ollama がないときの理由付き skip は Req 1.14 の設計どおりで正当です。ただし、この2件は include の設定によってどのレーンでも実行されず、本体も常に真なので、回帰を検出する力がありません（M-1）。

## Verdict
REQUEST_CHANGES

gate の green が誤りだったわけではありません。110件は実行されて成功しており、CRITICAL / HIGH はありません。Zero-Tolerance List の「fake pass」（常に真の assertion、自分自身との比較）と「PROVE が欠けていること自体が finding」に当たる MEDIUM が4件あるため、修正を求めます。

## Hallucination Signal
forced: false

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
