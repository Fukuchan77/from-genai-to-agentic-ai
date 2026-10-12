# 1-3 構造化出力と要約パイプライン

- **フェーズ**: Phase 1 基礎編。IBM 成熟度モデルの Level 1（Generative AI）の水準です。入力に対して要約を返して完了する受動的な生成で、環境の状態は変えません（[phase-1.md](../phases/phase-1.md)）
- **要件**: [spec 001](../../specs/001-agentic-ai-platform/spec.md) の Requirement 4（4.1〜4.12）。解説の必須事項として Requirement 2.16、7.2〜7.6、7.9、7.10
- **実装**: `packages/ai-core/src/summarize/`、`apps/web/app/api/summarize/`、`apps/web/components/summarize/`、`apps/web/app/summarize/`

## 学習目標

このモジュールを終えると、次のことができます。

- 正規表現やプロンプトの指示によるパースに頼らず、Zod スキーマと `Output.object` で型付きの要約オブジェクトを得られる。
- スキーマ検証を通過した値だけを「確定値」として返し、検証に失敗したときの再生成（最大2回）と、画面に出していた暫定表示の破棄を設計できる。
- 入力を分割すべきかを、コンテキスト上限・出力の予約・トークン推定の誤差から判断し、その判断と根拠のトークン数を結果に残せる。
- プロンプトキャッシュの原理（先頭からの一致）を説明し、キャッシュ位置を明示するプロバイダと自動で効くプロバイダの違いを、コストの計算と合わせて述べられる。
- `mock` モードの埋め込みが検索精度の評価に使えない理由を説明できる。

## 主要トピック

扱う概念は次の7つです。

1. スキーマ駆動の構造化出力（`Output.object` と Zod）
2. 部分オブジェクトは暫定表示で、確定値は検証後だけという境界
3. 検証失敗の再生成と、再生成してはいけない失敗
4. 入力の取得（Web 記事、YouTube 字幕）と、LLM を呼ぶ前に失敗させる設計
5. Map-Reduce が不要になった理由と、分割が必要になる境界
6. プロンプトキャッシュの原理とコスト
7. `mock` の埋め込みと検索精度

### スキーマ駆動の構造化出力（`Output.object` と Zod）

要約の形は Zod スキーマ `summarySchema`（`summarize/schema.ts`）が決めます。`title`、ちょうど3件の `keyPoints`、1〜8件の `tags`、0〜10件の `actionItems`、そして字幕のように時刻を持つ入力だけが必須にする `chapters`（見出しと開始秒）です。

```ts
// packages/ai-core/src/summarize/pipeline.ts (abridged)
const result = streamText({
	model: context.deps.model,
	instructions: prompt.instructions,
	messages: prompt.messages,
	output: Output.object({ schema: context.schema }),
	maxOutputTokens: Math.min(OUTPUT_RESERVE_TOKENS, context.deps.entry.maxOutputTokens),
	onError: ({ error }) => {
		streamErrors.push(error); // rethrown later; the default handler would log the content
	},
});
for await (const partial of result.partialOutputStream) {
	if (emitPartials) yield { type: "partial", summary: partial };
}
const value = await result.output; // validated against the schema, or NoObjectGeneratedError
```

ポイントは3つです。

- **`generateObject` / `streamObject` は使いません。** `generateText` / `streamText` の `output` に `Output.object(...)` を渡します（[changes-from-drafts.md](../../specs/curriculum/changes-from-drafts.md) §3）。非推奨の API を新規コードに入れないための規則で、`mise run check:repo-rules` の `no-deprecated-object-api` が検査します。
- **モデルに任意項目を求めません。** `summarySchemaFor({ withChapters })` は、時刻付きの入力なら `chapters` を1件以上必須にしたスキーマを、そうでなければ `chapters` のないスキーマを渡します。「あれば入れて」という任意項目は、入れたり入れなかったりのばらつきを生みます。
- **`.describe()` がスキーマの説明文になります。** 各フィールドの日本語の説明（例: 「ちょうど3件の要点（1件1文）」）は、プロバイダへ渡る JSON Schema に含まれ、プロンプトの一部として働きます。

Python の `with_structured_output(PydanticModel)` と同じ発想ですが、TypeScript では同じ Zod スキーマが、(1) モデルへ渡す JSON Schema、(2) 出力の実行時検証、(3) 画面側の型（`z.infer`）の3つを兼ねます。

### 部分オブジェクトは暫定表示、確定値は検証後だけ

`partialOutputStream` が返す部分オブジェクト（`DeepPartial<Summary>`）は、**スキーマ検証を経ていません。** 描画を早く始めるための暫定値です。`streamSummary` は4種類のイベントを出します。

| イベント | 意味 | UI の扱い |
|---|---|---|
| `partial` | 生成中の暫定値 | 確定した項目から順にカードへ描画する。未確定の項目はスケルトン |
| `restart` | 検証に失敗し、再生成が始まる | 暫定表示を破棄して、新しい試行を待つ |
| `final` | スキーマ検証を通過した要約 | 「生成中」を解除し、確定値として扱う |
| `meta` | 処理方式、トークン数、キャッシュ読み出し量、試行回数 | 処理情報パネルに表示する |

Req 4.3 は「スキーマに適合したオブジェクトのみを UI とライブラリ利用者へ返す」ことを求めます。ライブラリ利用者向けの `summarize()` は `streamSummary` を最後まで消費し、`final` だけを返します。UI が暫定表示を出すのは Req 4.5（逐次描画）のためで、暫定表示を確定した要約として保存・利用してはいけません。生成を途中で止めたときは、カードに「暫定」と表示します。

### 検証失敗の再生成（最大2回）と、再生成してはいけない失敗

`withRegeneration`（`summarize/retry.ts`）は、検証に失敗した試行を最大2回（`MAX_REGENERATIONS`）やり直します。3回目も失敗したら `SummaryValidationError`（`code: "output-invalid"`）を、各試行の検証エラーの一覧つきで投げます。エラーには生成された本文を入れません。

再生成のたびに、前回の検証エラー（`path: message` 形式）を指示文の後ろへ別パートとして足します。「前回の出力はスキーマ検証に失敗しました。次の点を直して…」という形です。

**再生成の対象は、スキーマと JSON の失敗だけです。** プロバイダの障害（過負荷、認証、通信）は、元のエラーのまま1回で伝えます。ストリームの途中に `error` パートが来ると、`result.output` も `NoObjectGeneratedError` で reject されるため、収集したプロバイダのエラーがあれば検証より先にそれを投げます。これを怠ると、障害を3回繰り返して課金だけが増えます。

### 入力の取得と、LLM を呼ぶ前に失敗させる設計

入力は3種類です（`SummaryInput`）。Web 記事の URL、YouTube の URL、字幕テキストの貼り付けです。

- **記事**: HTTP で取得し、`@mozilla/readability` と `jsdom` で本文を抽出します。リダイレクトは自分で最大5回たどり、行き先ごとに検査します。http / https 以外、ループバックやプライベートアドレス、メタデータ用アドレスは取得しません。15 秒の時間上限と 5 MiB の本文上限もあります。
- **YouTube**: `TranscriptSource` ポートの背後（`youtubei.js`）から、タイムスタンプ付きのセグメントを取得します。要約に渡すときは `[90s] 本文` のように、各行の先頭へ開始秒を付けます。モデルはその秒数を `chapters` の `startSeconds` に使います。
- **字幕テキスト**: 貼り付けられたテキストをそのまま使います。時刻はないので `chapters` は求めません。

取得に失敗したときは、**LLM を呼ぶ前に** 理由つきで失敗させます（Req 4.7、4.11）。記事は `SourceFetchError`（`http-status`、`empty-body`、`network`、`disallowed-url`、`timeout`、`too-large`）、字幕は `TranscriptUnavailableError`（`no-captions`、`private`、`fetch-failed`）です。Route Handler は、ストリームを開始する前に取得を済ませるので、これらは 422 の通常の JSON 応答になります。ストリームの途中で失敗を伝える設計より、画面側の分岐が単純です。

本文は `<source>` と `</source>` で囲み、本文とタイトルの中の `source` タグは `&lt;…&gt;` に置き換えます。取得した本文は信頼できない入力であり、「本文の中の指示」で区切りを閉じてプロンプトを書き換えられないようにするためです。

### Map-Reduce が不要になった理由と分割が必要な境界

#### Map-Reduce が担っていた役割

元教材（`1_llm-agent` 第8章）の `MapReduceDocumentsChain` は、長い文書を分割して、(1) **Map**: 各分割をそれぞれ要約し、(2) **Reduce**: 部分要約を結合して最終要約を作る、という二段の構成です。この構成が必要だった理由は1つで、**文書がモデルのコンテキストに収まらなかった** からです。当時の主力モデルのコンテキストは数千〜1万数千トークンで、長い記事や1時間の動画の字幕は入りませんでした。

#### 不要になった理由

モデルカタログ（`packages/ai-core/src/models/catalog.ts`）の `contextWindow` は、いまの `live` / `local` のモデルで次のとおりです。

| 実行環境 | `contextWindow` | 入力の予算（後述の式） |
|---|---|---|
| Anthropic（`live` の既定） | 1,000,000 | 795,904 |
| OpenAI、Azure OpenAI | 400,000 | 315,904 |
| Google | 1,048,576 | 834,764 |
| Ollama（`local` の既定） | 32,768 | 22,118 |
| `mock` | 131,072 | 100,761 |

典型的な記事や数時間分の字幕は、`live` なら1回の呼び出しに収まります。Map-Reduce には、収まる入力でも失うものがあります。

- **情報の欠落**: 部分要約は元の文書より情報が少なく、分割の境界をまたぐ文脈（前半の伏線と後半の結論）が切れます。Reduce 段が見るのは部分要約だけです。
- **呼び出し回数**: 分割数 N に対し N + 1 回以上の呼び出しになり、遅延とエラーの機会が増えます。
- **実装の複雑さ**: 分割、並べ替え、再帰的な統合（Reduce 自体が収まらないとき）を持つことになります。

そこで本リポジトリは **「収まるなら全文を1回で」** を既定にしました（Req 4.6）。

#### 分割が必要な境界

それでも分割が必要になる境界は、次の3つの量から決まります。

1. **コンテキスト上限（入力側）**。`planSummary` は、推定入力トークン + プロンプトの固定部分が **上限の 80% から出力の予約 4,096 を引いた予算** 以下なら `whole`、超えたら `staged` にします。境界ちょうどは `whole` です。

   ```ts
   // packages/ai-core/src/summarize/plan.ts (abridged)
   export const CONTEXT_USAGE_RATIO = 0.8;
   export const OUTPUT_RESERVE_TOKENS = 4_096;

   export function contextBudgetTokens(entry: ModelEntry): number {
   	return Math.floor(entry.contextWindow * CONTEXT_USAGE_RATIO) - OUTPUT_RESERVE_TOKENS;
   }

   // whole when the estimate plus the prompt overhead fits the budget (ADR-9)
   if (estimatedInputTokens + wholeOverheadTokens(source) <= contextBudgetTokens(entry)) {
   	return { strategy: "whole", chunks: [text], ...common };
   }
   ```

2. **トークン数の推定誤差**。Ollama にはトークン数の API がなく、プロバイダごとのトークナイザも異なります。そこで全プロバイダで `gpt-tokenizer`（o200k 系）の数え方を使い、**安全係数 1.2** を掛けます（research の ADR-9）。80% の余白と 1.2 倍の係数は別の役割です。80% は推定が外れたときの逃げ場、1.2 倍はトークナイザの違いを見込んだ見積もりの補正です。固定部分（システムプロンプト、区切り、指示文）のトークン数は、空の本文で実際のプロンプトを組み立てて数えるので、指示文を変えても判断に自動で反映されます。

3. **出力の量**。要約は出力が小さい（`maxOutputTokens` は `min(4096, モデルの上限)`）ので、入力側だけが制約になります。翻訳や書き起こしの整形のように **出力が入力に比例する課題** では、出力の上限が先に尽きるため、コンテキストに収まっても分割が要ります。同じ「長文処理」でも、課題の形で境界が変わります。

境界の外側では、小さいコンテキストのモデルが現実の問題になります。Ollama は呼び出しごとに `num_ctx` を指定しないとサーバーの既定（数千トークン）で動き、**長すぎるプロンプトを黙って切り詰めます**。計画の予算（カタログの 32,768）と実行時の長さが食い違うと、エラーも出ずに本文の後半が消えた要約ができます。このため `streamSummary` は、Ollama の全呼び出しに `providerOptions.ollama.options.num_ctx` としてカタログの `contextWindow` を渡します。

**品質は、このリポジトリの分割の判断には入っていません。** 入力が非常に長いと、収まっていても重要な情報への注意が薄れる現象（Context Rot）が知られており、「収まる」と「うまく要約できる」は別の問いです。ただし、その閾値はモデルと課題に依存するので、固定の数字を決めず、評価で測る立場を取ります（[4-1](../../specs/curriculum/phase-4.md) の Context Rot、4-3 の評価）。本モジュールでは、判断した戦略と推定トークン数を `SummaryMeta` に残す（Req 4.12）ことで、あとから「全文投入と分割で結果の質が変わるか」を比べられるようにしています。

#### 段階要約の設計

`staged` では、`splitIntoChunks` が行境界で貪欲に詰めてチャンクを作ります。1行が予算を超えるときは、予算に収まる最長の接頭辞で強制的に切ります（`fittingEnd`。トークン数は長さに対して単調でないため、補間で探索して「収まり、1文字足すと超える」位置を見つけます）。チャンクの予算が 256 トークン（`MIN_CHUNK_TOKENS`）未満になるモデルは `capability-unsupported` で拒否します。

その後は、各チャンクを **順番に** 要約し（再生成の規則は `whole` と同じ。イベントは出さない）、部分要約を統合して最終要約を作ります。統合プロンプトも予算に収まらなければ、部分要約をグループに分けて統合し、1グループになるまで繰り返します（`integrationGroups`）。2件を1グループにもできない場合は `capability-unsupported` です。ユーザーに見えるのは最後の統合だけで、そのときだけ `partial` / `restart` を出します。

LangChain の Map-Reduce との違いをまとめます。

| 観点 | `MapReduceDocumentsChain` | 本リポジトリの `staged` |
|---|---|---|
| 分割するか | 常に分割する | 予算を超えたときだけ |
| 判断の記録 | なし | `strategy`、推定トークン、チャンク数、実測トークンを結果に残す |
| 各部分の出力 | 自由な文章 | 同じ Zod スキーマの要約オブジェクト（検証・再生成つき） |
| Map の実行 | 並列にできる | 順番に実行する（単純さとレート制限を優先） |
| 統合が収まらないとき | 再帰的に畳む | グループ化して再帰的に統合。畳めなければ拒否 |

汎用の Map-Reduce ワークフロー（並列化、任意の Map / Reduce 関数）は、M2 の 002 Req 3 で扱います。ここで実装したのは要約専用の最小限です。

### プロンプトキャッシュの原理とコスト

#### 原理: 先頭からの一致

プロンプトキャッシュは、**リクエストの先頭から途中までが、前回と1バイトも違わず一致したとき、その部分の計算結果を再利用する** 仕組みです。途中の1文字が変われば、そこから後ろはすべて再計算されます。このため設計は「**変わらないものを先頭に、変わるものを後ろに**」の一点に尽きます。

本リポジトリのプロンプトは、この順に組まれます（`summarize/prompts.ts`）。

```text
instructions   固定のシステムプロンプト
user message
  ├─ part 1    <source>…長い本文…</source>   ← キャッシュの印はここだけ
  ├─ part 2    指示文（全文／チャンク n/N／統合）
  └─ part 3    （再生成のときだけ）前回の検証エラー
```

再生成で足される検証エラーは **最後の別パート** に置くので、印を付けた本文のパートは再送しても1バイトも変わりません（テストで固定しています）。再生成と、同じ本文に別の指示を重ねる呼び出しが、キャッシュの読み出しに当たります。

#### プロバイダ別の「有効化」

`cachePolicyFor(entry)` が、カタログの `capabilities.promptCache` とプロバイダから方針を決めます（Req 4.8）。

| 方針 | プロバイダ | やること |
|---|---|---|
| `explicit`（位置を明示） | Anthropic | 長い本文のパートに `providerOptions.anthropic.cacheControl: { type: "ephemeral" }` を付ける |
| `automatic`（自動） | OpenAI、Azure OpenAI、Google | プロバイダが長い先頭を自動でキャッシュする。印は付けず、読み出しトークン数の記録だけを行う |
| `none` | Ollama、`mock` | キャッシュなし。`cacheReadTokens` は記録しない（`undefined`） |

```ts
// packages/ai-core/src/summarize/cache-policy.ts (abridged)
case "anthropic":
	return {
		mode: "explicit",
		recordsCacheReads: true,
		sourcePartProviderOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
	};
```

読み出し量は `usage.inputTokenDetails.cacheReadTokens` から取り、全 LLM 呼び出し（チャンク、統合、再生成）の合計を `SummaryMeta.cacheReadTokens` に入れます（旧名の `usage.cachedInputTokens` は v7 で改名されました）。0 は「記録したが当たらなかった」値、`undefined` は「そのプロバイダでは記録しない」値で、画面でも区別して表示します。

#### コスト

カタログ（`catalog.ts`）には、キャッシュ読み出しの単価 `cacheReadPerMTok` があります。2026-09-28 にプロバイダの文書で確認した値で、単位は USD / 100万トークンです。

| プロバイダ（カタログの `live` 既定） | 入力 | キャッシュ読み出し | 比 |
|---|---|---|---|
| Anthropic | 3 | 0.3 | 1/10 |
| OpenAI | 1.25 | 0.125 | 1/10 |
| Azure OpenAI | 1.75 | 0.175 | 1/10 |
| Google | 0.3 | 0.03 | 1/10 |

どのプロバイダでも、**当たった部分の入力は通常の 1/10 の単価** です。ただし次の3点は、カタログに持たず、プロバイダの文書で確認する必要があります。

- **書き込みの割増**。Anthropic は、キャッシュに書き込んだトークンに入力単価の 1.25 倍（TTL 5 分の場合。1 時間の TTL は 2 倍）がかかります（Anthropic の文書、2026-10-12 に確認。リポジトリ内には根拠がない値です）。読み出しだけが安いわけではなく、**最初の1回は通常より高い** のです。
- **最小の長さ**。キャッシュ対象の先頭が短いと、印を付けてもエラーなく書き込まれません。最小長はモデルごとに異なります（Anthropic は 512〜4,096 トークンの幅があります）。本文が短い要約では `cacheReadTokens` が 0 のままになります。
- **TTL**。Anthropic の既定は 5 分で、読み出すたびに延長されます。5 分以上空くと最初からやり直しです。

簡単な試算です（100,000 トークンの本文を、5 分以内に繰り返し要約する。出力と指示文は無視。Anthropic のカタログ単価を使った計算で、実測ではありません）。

| 回数 | キャッシュなし | キャッシュあり |
|---|---|---|
| 1回 | 0.1 × 3 = $0.30 | 0.1 × 3 × 1.25 = $0.375 |
| 2回 | $0.60 | $0.375 + 0.1 × 0.3 = $0.405 |
| 3回 | $0.90 | $0.375 + 2 × $0.03 = $0.435 |

2回目で元が取れ、3回目以降は1回あたり $0.03 です。逆に **1回きりの呼び出しでは、キャッシュを有効にすると入力が 25% 高くなります。** 本リポジトリは `explicit` のプロバイダでは常に印を付けます。再生成（最大2回）と、学習者が同じ入力を繰り返す使い方を想定した選択です。

読み取りながら気づく設計上の限界が2つあります。

- `staged` では、各チャンクのプロンプトにも印が付きますが、チャンクは毎回内容が違うので読み出しに当たりません（再生成のときだけ当たります）。書き込みの割増を払うだけになりえます。
- カタログの `estimateCost` は読み出しの単価を持ちますが、書き込みの割増の項はありません。Anthropic の最初の1回は、画面の概算より高くなります。

どちらも「動かして確かめた事実」ではなく、コードを読んだ結論です。手順3で `live` の実測値と比べてみてください。

### `mock` の埋め込みは検索精度の評価に使えない

このモジュールの要約は埋め込みを使いません。それでもここで明記するのは（Req 2.16）、`mock` モードの限界を最初に学ぶ場所だからで、M2 の RAG（2-1、2-2）で同じ落とし穴が再び現れます。

`createDeterministicEmbeddingModel`（`mock/deterministic-embedding.ts`）は、入力テキストの SHA-256 をシードにした乱数でベクトルを作り、L2 正規化して返します。

- **同じテキストには必ず同じベクトル** が返ります。テストが毎回同じ結果になるのは、この性質のおかげです。
- **違うテキストのベクトルは、意味と無関係** です。一文字違いの文でも、シードが別なので別の乱数列になります。高次元の乱数ベクトル同士のコサイン類似度は 0 の近くに散らばります。

手順4で、意味がほぼ同じ2文のコサイン類似度を測ります。1,536 次元で測った例（2026-10-12）では、「犬は庭で遊んでいる。」と「犬が庭で遊んでいる。」で -0.0225、日本語と英語の同じ意味の文で -0.0620、無関係な文で 0.0318 でした。意味の近さと類似度が一切対応していません。

したがって `mock` の埋め込みでは、検索の **精度（再現率、適合率、順位）も、チャンクの大きさ、ハイブリッド検索、Rerank の効果も評価できません。** 使えるのは、配線（次元数、保存、検索 API の呼び出し、境界値）が動くかを確かめるテストまでです。精度の評価は、`local`（Ollama の埋め込みモデル）か `live` で行います。`mock` のテストが緑でも、検索の品質については何も保証されません。

## ハンズオン手順

原則として `local` または `live` で実行します（Req 7.5）。Web アプリは、専用の `dev` タスクがないため `mise exec` で起動します。

### 手順 1: 入力を要約して、確定した項目から順にカードへ描画する

- 実行モード: `local`（既定）または `live`
- 外部サービス: `local` は Ollama の起動とモデルの取得（`OLLAMA_BASE_URL`）。`live` はプロバイダの API キー（`ANTHROPIC_API_KEY` など）。記事の URL を使う場合はインターネット接続

`.env.local` に `AI_RUN_MODE` を設定してから、Web アプリを起動します。

```bash
cp .env.example .env.local   # まだなら。AI_RUN_MODE=local または live を設定する
mise exec -- pnpm --filter web dev
```

ブラウザで `/summarize` を開き、次の3種類の入力を順に試します。

1. Web 記事の URL
2. YouTube の URL（字幕のある動画）
3. 字幕テキストの貼り付け

確認すること:

- カードが、タイトル、3行の要点、タグ、アクション項目の順に埋まっていく（未確定の項目はスケルトン）。
- YouTube と、時刻つきの入力では `chapters` が `MM:SS` の目次として表示される。字幕テキストの貼り付けでは目次が出ない。
- 処理情報パネルに、処理方式（全文／分割）、入力トークンの推定と実測、キャッシュ読み出し、再生成回数が出る。
- `local` で 100,000 文字（Route の上限）に近い字幕テキストを貼ると、処理方式が「分割して段階的に要約」になる。ならなければ、画面の推定トークン数を、本文の表の「入力の予算」（Ollama は 22,118）と見比べる。

### 手順 2: 取得できない入力が、LLM を呼ばずに理由つきで失敗することを確かめる

- 実行モード: `local` または `live`（モデルの解決に実行モードの設定が要るため。LLM の呼び出しは起きない）
- 外部サービス: `local` は Ollama の起動（接続の事前検査まで）。`live` は API キー。字幕のない動画の確認には、インターネット接続

手順 1 の画面で、次を入力します。

- 存在しない記事の URL（例: 404 を返すページ）→ 理由に HTTP ステータスが出る。
- `http://localhost/` や `http://169.254.169.254/` のようなアドレス → 取得せずに「この URL は取得できません」と出る（`disallowed-url`）。
- 字幕のない、または非公開の YouTube 動画 → 字幕を取得できない理由が出て、字幕テキストの貼り付けを勧める。

確認すること: いずれも 422 で、カードは出ず、プロバイダの利用量が増えない（`local` なら Ollama のログに生成リクエストがない）。同じ挙動の自動テストは、`mock` で `route.test.ts` の「422」のテストが検査しています。

### 手順 3: 同じ長い入力でキャッシュ読み出しトークン数を比べる

- 実行モード: `live`（Anthropic。`explicit` のプロバイダ）。OpenAI、Azure OpenAI、Google は `automatic`
- 外部サービス: `ANTHROPIC_API_KEY`（有料）。ほかのプロバイダなら、その API キー

`.env.local` に `AI_RUN_MODE=live` と `AI_LIVE_PROVIDER=anthropic` を設定して起動し、`/summarize` で **同じ長い字幕テキスト** を2回続けて要約します（5 分以内に）。

確認すること:

1. 1回目の「キャッシュ読み出し」が `0 トークン`、2回目が 0 より大きい。
2. 2回目の読み出し量が、本文のトークン数（推定値の 1/1.2 ほど）に近い。
3. 本文を短くすると、読み出しが 0 のままになる（最小長に満たない）。
4. 5 分以上空けると、また 0 に戻る（TTL）。

本文の「コスト」の試算と、プロバイダのダッシュボードの請求を比べ、書き込みの割増が出ているか確かめます。

### 手順 4: `mock` の埋め込みが意味を持たないことを数値で確かめる

- 実行モード: `mock`（コードを直接実行し、実行モードの設定は使わない）
- 外部サービス: なし

```bash
mise exec -- node --input-type=module -e '
import { createDeterministicEmbeddingModel } from "./packages/ai-core/src/mock/deterministic-embedding.ts";
const model = createDeterministicEmbeddingModel({ dimensions: 1536 });
const texts = ["犬は庭で遊んでいる。", "犬が庭で遊んでいる。", "The dog is playing in the garden.", "量子コンピュータの誤り訂正"];
const { embeddings: e } = await model.doEmbed({ values: texts });
const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);
for (const j of [1, 2, 3]) console.log(`0 vs ${j}:`, dot(e[0], e[j]).toFixed(4));
'
```

確認すること: 3つの値がどれも 0 の近く（絶対値で 0.1 未満）で、意味の近い組と遠い組に差がない。同じテキストを2回埋め込むと同じベクトルになる（`deterministic-embedding.test.ts`）ことも、`dot(e[0], e[0])` が 1 になることで確かめられます。

## 習熟度判定チェックリスト

自動テストで確かめられる項目には、テストへの参照を付けています。参照先は `mise run docs:check` が実在を検査します。

- [ ] スキーマは要点をちょうど3件に固定し、時刻つきの入力だけ `chapters` を必須にする（任意項目をモデルに求めない） <!-- test: packages/ai-core/src/summarize/schema.test.ts#accepts a summary with exactly three key points and optional chapters --> <!-- test: packages/ai-core/src/summarize/schema.test.ts#requires at least one chapter for timestamped sources and omits chapters otherwise -->
- [ ] 部分オブジェクトがスキーマの順に項目ごとに届き、最後が確定値になることを説明できる <!-- test: packages/ai-core/src/summarize/pipeline.test.ts#emits partial objects field by field in schema order, ending at the final value -->
- [ ] 検証に失敗した出力は最大2回再生成され、3回目も失敗したら検証エラーの一覧つきで失敗する <!-- test: packages/ai-core/src/summarize/retry.test.ts#allows at most two regenerations --> <!-- test: packages/ai-core/src/summarize/pipeline.test.ts#fails with SummaryValidationError after three invalid attempts (m1-3/validation-retry) -->
- [ ] プロバイダの障害は再生成せず、元のエラーのまま伝わる理由を説明できる <!-- test: packages/ai-core/src/summarize/pipeline.test.ts#propagates a provider failure without regenerating -->
- [ ] 再生成が始まったら、前の試行の暫定表示を画面から消す <!-- test: apps/web/components/summarize/SummaryPanel.test.tsx#discards the provisional summary of an earlier attempt after a restart (Req 4.4) -->
- [ ] 取得に失敗した URL は、LLM を呼ばずに理由つきの 422 になる <!-- test: apps/web/app/api/summarize/route.test.ts#answers 422 source-unavailable with the reason and never calls the LLM when the fetch fails (Req 4.7) -->
- [ ] 分割の予算が「コンテキスト上限の 80% − 出力の予約 4,096」で、境界ちょうどは全文投入になる <!-- test: packages/ai-core/src/summarize/plan.test.ts#is 80% of the context window minus the 4,096-token output reserve --> <!-- test: packages/ai-core/src/summarize/plan.test.ts#switches from whole to staged exactly at the 80% boundary -->
- [ ] 判断に使った推定トークン数が結果に残り、安全係数 1.2 を掛けた切り上げであることを説明できる <!-- test: packages/ai-core/src/summarize/plan.test.ts#summarizes a short transcript whole, recording the estimate it decided on --> <!-- test: packages/ai-core/src/summarize/plan.test.ts#applies the 1.2 safety factor to the gpt-tokenizer count and rounds up -->
- [ ] 分割した場合は、チャンクごとに要約してから、統合した要約だけをストリームする <!-- test: packages/ai-core/src/summarize/pipeline.test.ts#summarizes each chunk, then streams only the integrated summary -->
- [ ] Ollama では `num_ctx` をカタログのコンテキスト上限に揃える理由（黙って切り詰められること）を説明できる <!-- test: packages/ai-core/src/summarize/pipeline.test.ts#runs every Ollama call with num_ctx set to the catalog context window -->
- [ ] Anthropic では本文のパートにだけキャッシュの印を付け、再生成でもそのパートが変わらない <!-- test: packages/ai-core/src/summarize/cache-policy.test.ts#marks the long source part with anthropic cacheControl for explicit caching --> <!-- test: packages/ai-core/src/summarize/cache-policy.test.ts#keeps the cached source part identical when a regeneration adds feedback -->
- [ ] キャッシュ読み出しトークン数を記録し、自動キャッシュのプロバイダでは記録だけを行い、非対応のプロバイダでは記録しない <!-- test: packages/ai-core/src/summarize/pipeline.test.ts#marks the source for Anthropic and records the cache reads (m1-3/split-summary) --> <!-- test: packages/ai-core/src/summarize/pipeline.test.ts#only records the cache reads for an automatically caching provider --> <!-- test: packages/ai-core/src/summarize/pipeline.test.ts#does not report cache reads for a provider without prompt caching -->
- [ ] `/api/summarize` が、部分オブジェクト → 確定値 → 処理情報の順にデータパートを送る <!-- test: apps/web/app/api/summarize/route.test.ts#streams growing data-summary parts, then the final summary, then data-summary-meta (Req 4.5, 4.8) -->
- [ ] 処理情報パネルに、処理方式、推定と実測の入力トークン、キャッシュ読み出し、再生成回数が出る <!-- test: apps/web/components/summarize/SummaryMetaPanel.test.tsx#shows the whole-input strategy, estimated and measured input tokens, cache reads and regenerations (Req 4.8, 4.12) -->
- [ ] `mock` の埋め込みが、同じ入力に同じベクトルを返す決定論的なダミーであることを示せる <!-- test: packages/ai-core/src/mock/deterministic-embedding.test.ts#returns the same embeddings for the same inputs -->
- [ ] 実モデル（`local`）で、3つの異なる要点を持つスキーマ適合の要約が得られる（`mise run test:local`。Ollama がなければスキップ） <!-- test: packages/eval-suite/tests/capability/summary-quality.local.test.ts#summary quality on a local model -->
- [ ] Map-Reduce が不要になった理由と、それでも分割が必要になる3つの量（コンテキスト上限、推定誤差、出力量）を自分の言葉で説明できる
- [ ] キャッシュの試算（書き込み 1.25 倍、読み出し 1/10）で、何回目の呼び出しで元が取れるかを計算できる
- [ ] `mock` の埋め込みが検索の精度評価に使えない理由を、手順 4 の数値と合わせて説明できる
- [ ] 手順 3 で、`live` のキャッシュ読み出しトークン数が1回目と2回目で変わることを確かめた

## リファレンス実装とテストの所在

| 項目 | パス |
|---|---|
| 要約スキーマ、入力の検証、YouTube URL の解析 | `packages/ai-core/src/summarize/schema.ts` |
| 記事・字幕の取得、本文抽出、取得失敗の型 | `packages/ai-core/src/summarize/source.ts`、`errors.ts`、`url-guard.ts` |
| 分割の計画（予算、チャンク、統合のグループ） | `packages/ai-core/src/summarize/plan.ts`、`tokens.ts` |
| 生成、再生成、イベント、`SummaryMeta` | `packages/ai-core/src/summarize/pipeline.ts`、`retry.ts` |
| プロンプトの組み立て（本文の区切り、キャッシュの印） | `packages/ai-core/src/summarize/prompts.ts`、`cache-policy.ts` |
| Route Handler（データパートの送出） | `apps/web/app/api/summarize/route.ts` |
| 画面（フォーム、カード、目次、処理情報、取得エラー） | `apps/web/components/summarize/`、`apps/web/app/summarize/page.tsx` |
| モデルカタログ（コンテキスト上限、キャッシュ単価） | `packages/ai-core/src/models/catalog.ts` |
| `mock` の埋め込み | `packages/ai-core/src/mock/deterministic-embedding.ts` |
| シナリオと fixture | `packages/ai-core/fixtures/scenarios/m1-3.ts`、`fixtures/transcripts/`、`fixtures/http/article.json` |
| 要約パイプラインのテスト | `packages/ai-core/src/summarize/*.test.ts` |
| Route Handler のテスト | `apps/web/app/api/summarize/route.test.ts` |
| 画面のテスト | `apps/web/components/summarize/*.test.tsx` |
| `mock` の埋め込みのテスト | `packages/ai-core/src/mock/deterministic-embedding.test.ts` |
| `local` の品質テスト（Ollama があるときだけ） | `packages/eval-suite/tests/capability/summary-quality.local.test.ts` |

## 元教材との対照表

元教材は `1_llm-agent`（『つくりながら学ぶ！AIアプリ開発入門』）の第6〜8章です。章の対応は [sources.md](../../specs/curriculum/sources.md) にあります。

| 元教材（Python / LangChain / LangGraph）の対応箇所 | TypeScript / AI SDK 版での置き換え | 移植で諦めたもの |
|---|---|---|
| 第6章 Web 要約: `WebBaseLoader`、`load_summarize_chain` | `fetch` + `@mozilla/readability` + `jsdom` で本文を取り、`streamText` + `Output.object` でスキーマ駆動の要約を作る。カードで逐次描画 | LangChain の多数のドキュメントローダー（PDF、Notion など）。ローダーの抽象は持たず、記事と字幕の2種類に絞った。LangGraph の reducer・checkpointer・`interrupt`、LangGraph Studio は、このモジュールでは使わない |
| 第7章 YouTube 要約: `YoutubeLoader` | `TranscriptSource` ポート（`youtubei.js`）でタイムスタンプ付きの字幕を取り、`chapters` を生成する | 字幕のない動画の音声文字起こし（字幕がなければ 422 で終了する）。非公式 API に依存するため、ポートの背後に置き差し替え可能にした |
| 第8章 長時間動画の要約: `MapReduceDocumentsChain` | `planSummary` が全文投入（`whole`）と段階要約（`staged`）を選ぶ。判断と推定トークン数を結果に残す。プロンプトキャッシュで再送のコストを下げる | 常に分割する汎用の Map-Reduce、Map 段の並列実行（順番に実行する）。汎用のワークフローは M2（002 Req 3）に回した |
| 構造化出力: Pydantic モデル + 出力パーサー（失敗時の再試行を含む一般的な書き方） | Zod スキーマ + `Output.object`。検証失敗は `withRegeneration` で最大2回再生成 | 出力パーサーが自動で直す方式（`OutputFixingParser` など）。本リポジトリは前回の検証エラーをプロンプトに添えて作り直す方式だけを実装した |
| Streamlit の `st.spinner`、`st.write_stream` | `useChat` + UI メッセージストリームのデータパート（`data-summary` など） | Streamlit のセッション状態によるキャッシュ（`st.cache_data` など）。ブラウザ側のキャッシュは持たない |

## 移植時の変更点

[changes-from-drafts.md](../../specs/curriculum/changes-from-drafts.md) に記録された変更のうち、このモジュールに関わるものと、実装時に実測・確認して確定したことです（Req 7.4）。採用したモデルはモデル ID ではなくカタログへの参照で示します（要約は用途 `structured` のモデルを使います。`live` の Anthropic なら `catalog: live.anthropic.structured`）。

- **`generateObject` / `streamObject` → `streamText` + `Output.object`**（changes-from-drafts §3）。`partialOutputStream` は、旧名 `experimental_partialOutputStream` の別名ではなく正式名を使う。検証失敗のエラーは `NoObjectGeneratedError`（research I-4）。
- **`useObject` は採用せず、UI メッセージストリームのデータパート**（`data-summary`、`data-summary-restart`、`data-summary-meta`）で送る。処理方式・トークン数・キャッシュ読み出しを、部分オブジェクトと同じストリームで運びたいため（research I-4、ADR-8）。
- **`toDataStreamResponse()` → `createUIMessageStream` / `createUIMessageStreamResponse`**（changes-from-drafts §3）。
- **システムプロンプトは `instructions`**。AI SDK v7 の `streamText` は `messages` の中の system メッセージを `AI_InvalidPromptError` で拒否するため、`{ instructions, messages }` の組で組み立てる（実装時に確認）。
- **`usage.cachedInputTokens` → `usage.inputTokenDetails.cacheReadTokens`**（research I-1）。
- **トークン数の推定は `gpt-tokenizer` 4.0.0 + 安全係数 1.2、予算はコンテキスト上限の 80%**（research ADR-9）。Ollama にトークン数の API がないため、全プロバイダで同じ方法を使う。
- **Ollama の `num_ctx`**。`ollama-ai-provider-v2` の `chat(id, settings)` は settings を捨て、呼び出しごとの `providerOptions` だけが届くため、要約の全呼び出しに `num_ctx` を渡す（W3 の敵対的レビューで判明）。
- **モデル ID はカタログだけに書く**。解説にも書かない（Req 2.18。`mise run check:model-ids` が解説も走査する）。
- **記事の取得は SSRF 対策つき**。リダイレクトを自分でたどって検査し、`local` / `live` では接続時に解決後の IP も検査する（`url-guard.ts`、`apps/web/lib/server/platform.ts`）。

## Python / Streamlit 経験者向けコラム

Streamlit で `st.spinner("要約中…")` の中で `chain.invoke(...)` を呼ぶ作りは、**完了するまで画面が止まり、終わった時に結果がまとめて出る** 設計です。スクリプト全体が上から再実行されるモデルでは、途中の状態を画面に出すには、プレースホルダ（`st.empty()`）と `st.write_stream` を組み合わせる必要があります。

この構成では、次のように役割が分かれます。

| Streamlit / LangChain | この構成 |
|---|---|
| `st.spinner` で待たせる。結果は1回で出る | サーバーが `data-summary` パートを何度も送り、`useChat` が受信するたびに React が差分を描画する。待ち時間の間にカードが埋まる |
| 途中の失敗は例外で画面全体が止まる | 検証失敗は `data-summary-restart` で通知し、画面は暫定表示だけを破棄して続行する。取得の失敗は、ストリームの前に 422 で返す |
| `load_summarize_chain(llm, chain_type="map_reduce")` が分割方式を決める | `planSummary` が予算と比べて決め、`SummaryMeta` に判断を残す。コードで読める |
| 出力パーサーが文字列を解析する | Zod スキーマが、モデルへ渡す JSON Schema・検証・型を兼ねる |
| リクエストのたびにスクリプト全体が再実行される | Route Handler は1リクエスト1回の実行。再生成や統合のループは `streamSummary` の中だけにある |

Python の `ValidationError` を捕まえて再試行するコードに慣れているなら、`withRegeneration` は同じ発想です。違いは、**捕まえるのが「スキーマの失敗」だけ** で、プロバイダの障害は再試行しないこと、再試行のたびに前回の検証エラーをプロンプトへ足すことです。

## 完成時点のタグ

- **タグ**: `module/1-3`（ローカルの注釈付きタグ。指すコミットは `7cc27cc`）
- **含まれるもの**: 要約パイプライン（`packages/ai-core/src/summarize/` の取得、計画、生成、再生成、キャッシュ方針）、`POST /api/summarize`、`/summarize` の画面とその単体テスト。`module/1-2` のプラットフォーム（モデルカタログ、ゲートウェイ、`mock` ランタイム、チャットとエージェント）の上に載っています。`module/1-2` と同じコミットで、`mock` モードで `next dev` / `next start` から動かせます
- **含まれないもの**: E2E テスト（`apps/web/e2e`）の完成品と、この解説（`docs/`）です（plan C22）。同じツリーには、コミットの順序の都合で E2E の一部の spec（`a11y`、`keyboard`、`real-server`）が存在しますが、モジュールの一部ではありません
- **公開の状態**: タグはまだ push していません。リモートへの push は、人の承認を得てからタスク 29.4 で行います
