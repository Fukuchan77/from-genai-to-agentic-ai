# 3-6 マーケティング支援エージェント

- **フェーズ**: Phase 3。IBM 成熟度モデルの Level 2〜3 の入口です。複数のペルソナの合議と、会話から利用者プロファイルを抽出するレコメンドを、ワークフローとして組み立てます
- **要件**: [spec 003](../../specs/003-domain-agents/spec.md) の Requirement 6（6.1〜6.6。この解説は 6.1、6.2、6.4、6.5 を扱う）。解説の必須事項として 001 の Requirement 7.2〜7.6、7.9
- **実装**: `packages/ai-core/src/marketing/`、`apps/web/app/api/marketing/`、`apps/web/components/marketing/`、`apps/web/app/marketing/`

## 学習目標

このモジュールを終えると、次のことができます。

- 複数のペルソナが他の発言を踏まえて順に意見を述べるラウンドロビンの合議を、ラウンドの反復と終了の規則をコードに置いて実装できる。
- 合意の判定を「モデルの宣言」と「コードの検査」に分け、モデルが「合意した」と言っても、未解決の反対が残っていれば合意としない設計を説明できる。
- 会話から利用者プロファイルを逐次抽出し、新しい値で上書きしつつ、欠けた値で既存の値を消さないマージを書ける。
- レコメンドの候補を商品カタログからだけ選び、表示の前に商品 ID を照合して、存在しない商品を除去し、除去したことを記録できる。
- 合議と単一エージェントのトークン使用量を比べ、その測定が何を言えて何を言えないかを説明できる。

## 主要トピック

扱う概念は次の5つです。

1. ラウンドロビンの合議
2. 合意の判定（モデルの宣言とコードの検査）
3. 利用者プロファイルのマージ
4. 商品カタログとの照合
5. 単一エージェントとのトークン使用量の比較

### ラウンドロビンの合議

元教材（`3_genai-agent` の第7章）は、ペルソナ別のディベート・評価・改善を LangGraph のグラフで書きます。ここでは `runCouncil`（`packages/ai-core/src/marketing/council.ts`）が、**ラウンドの反復をプレーンな TypeScript のループ**で持ちます（ADR-9。憲章 原則 1 の「ワークフローとエージェントの分離」）。エージェントのループ（`ToolLoopAgent`）は使いません。ペルソナはツールを持たず、`council.ts` は `agents/` を直接 import しません（`workflow-no-agent-loop` の検査対象です）。

- ペルソナの既定は3名（辛口なマーケター、一般消費者、SEO スペシャリスト。`DEFAULT_COUNCIL.personaIds`）で、数と役割は設定できます（2〜5名を受け付けます）。定義は `marketing_personas` テーブルにあり、`mise run seed:samples` で投入します。
- 各ラウンドで、ペルソナは序数（ordinal）の順に発言します。各ペルソナは、下書き、自分の視点、そこまでの他のペルソナの発言を受け取ります。発言は、意見と、`<draft>` ブロックに入れた改善案です。最後に書かれた `<draft>` ブロックが次の下書きになります。使える `<draft>` が無ければ下書きを持ち越します。
- 終了理由は3つです。`agreed`（合意）、`max-rounds`（最大ラウンド数。既定 3）、`budget-exhausted`（トークン予算の消費）。結果には、改善後の文案、ラウンドごと・ペルソナごとの発言、終了理由、トークンの内訳が入ります（Req 6.2）。
- 発言が得られなかったペルソナ（失敗、空の発言、予算不足で呼ばれなかった）は、そのラウンドの `missing` に記録し、次のラウンドでもう一度呼びます。全員が失敗したら `provider-unavailable` で止まります。

**M2 の Role-Based Cooperation との関係。** 各発言には、M2 の `cooperateByRole`（[2-4](2-4-agent-design-patterns.md)）を使います。ただし合議は、**発言1名ごとに `cooperateByRole` を1回呼ぶ**（役割を1つずつ渡す）ので、M2 の「前の役割の出力を次の役割へ受け渡す」仕組みは名目上のものです。実際の受け渡し（他のペルソナの発言をプロンプトに入れること）は、`council.ts` が行います。これは plan に記録し、承認済みの設計です（W6 レビューの F-14）。

### 合意の判定（モデルの宣言とコードの検査）

合意の確定は、モデレーター（`judgeAgreement`、`moderator.ts`）が各ラウンドの終わりに1回行います（CL-12）。

1. **モデルの宣言。** モデレーターは構造化出力で `agreed`（真偽）、`reason`、`remainingObjections`（残っている反対の一覧）を返します。不正な出力は `generateValidated` が再生成します。未知のキーや長すぎる項目も不正として再生成されます。
2. **コードの検査。** `agreed` が真でも、`remainingObjections` に空白でない項目が残っていれば、**合意としません**（再生成もしません。矛盾した判定は壊れた判定ではないためです）。空白だけの項目は無視されます。
3. **ラウンド側の条件。** そのラウンドで発言が得られなかったペルソナがいれば、`agreed` が真でも合意とせず、固定の理由を付けて次のラウンドへ進みます（上限なら `max-rounds`）。

モデルは「合意した」と言うことしかできず、**終了を確定するのはコード**です。上限（`maxRounds`、トークン予算）もコードが持ちます。

注意点として、「合意の判定」と「文案の改善」は別の事柄としてコードに置いてあります（合意はモデレーターの判定、改善後の文案は `<draft>` ブロックから取ります）。後述の実測は、この2つの関係を示すものではありません（理由は実測の節に書きます）。合意率は、改善の質の指標にはなりません。

### 利用者プロファイルのマージ

`/api/marketing/recommend` は、会話ごとに `extractProfile` で利用者プロファイル（関心事、予算、懸念点）を構造化出力として抽出し、画面のプロファイル表示とレコメンド表示を更新します（Req 6.4。Generative UI）。マージ規則は `mergeProfile`（`profile.ts`、純関数）にあります。

- **配列（関心事、懸念点）**: 新しい項目を既存の後ろに追加します。大文字小文字、前後の空白、全角半角の違いは同じ項目とみなして重複を捨て、最初の項目の位置と表記を残します。空の項目は捨てます。上限を超えたら新しい項目を残します。
- **予算**: 新しい値があれば上書きします（`0` も値です）。`null` や欠けた値は、既存の予算を消しません。
- **抽出の失敗**: 再生成を使い切っても、前のプロファイルをそのまま返します。中断（abort）やプロバイダの障害は、失敗として隠さず投げ直します。
- 会話の本文とクライアントから受け取った前回のプロファイルは、区切りタグの中のデータとして渡します。

### 商品カタログとの照合

`recommend`（`recommend.ts`）は、候補を DB の `marketing_products` からだけ選びます（Req 6.5、CL-15）。

- モデルには、カタログの商品だけを見せます。モデルが返すのは商品 ID と推薦理由で、**商品名と価格はカタログから取り**、モデルの出力からは取りません（スキーマは厳格で、余計なキーを受け付けません）。
- 表示の前に、商品 ID をカタログと照合します（`has()`）。存在しない ID は除去し、**除去した件数を `dropped` に記録**します（同じ ID の重複は、除去の件数に数えず1件にまとめます）。一覧にあっても `has()` が拒否した ID は除去します。
- すべて除去された場合や、モデルが何も選ばなかった場合は、固定の理由を付けて空のレコメンドを返します。予算を超える商品には、コードが理由に注記を足します。
- カタログが空なら、モデルを呼びません。

### 単一エージェントとのトークン使用量の比較

憲章 原則 1 は、マルチエージェント構成を採る前に、単一エージェントで足りないことを実測で示すよう求めます。ただし 003 Req 6.1 のように、承認済みの spec が教材の対象として要求する構成は、実測を採否の条件にせず、**コスト上限の設計記録と、単一エージェントとの比較の実測を解説に記録すること**で足ります（憲章 v1.1.0）。ここはその記録です。

コスト上限の設計は、`maxRounds`（既定 3）と合議全体の `maxTotalTokens`（既定 50,000。全ラウンドで共有し、発言とモデレーターの両方を数える）の2つです。`maxTotalTokens` の4分の1はモデレーターのために予約し、各呼び出しは「それまでで最大の1回分」が残っているときだけ始めます。**この上限は、同程度の大きさの呼び出しが続く限りの上限（ソフトキャップ）**で、種類ごとの最初の1回は残量を超えうるため、上限を超えないことの保証ではありません。

実測（2026-10-29、`local`、小さなローカルモデル（名前は research.md に記録）、同じ下書きで2回。[research.md の「W8 の実測」38.4](../../specs/003-domain-agents/research.md)）:

| 方式 | 回 | トークン | ラウンド | 合意 | 文案が変わった |
|---|--:|--:|--:|---|---|
| 合議 | 1 | 5,249 | 1 | 合意 | いいえ |
| 合議 | 2 | 20,002 | 2 | 合意 | いいえ |
| 単一 | 1 | 435 | 1 | — | はい |
| 単一 | 2 | 769 | 1 | — | はい |

合議の平均は 12,626 トークン、単一の平均は 602 トークンで、合議は単一の**約 21 倍**でした。合意に達した割合は 2/2 でしたが、合議の2回とも `improvedDraft` は下書きと同じでした。

**この数値は、小さなローカルモデルでの2回だけの観察です（憲章 原則 1 の⚠ 1）。** 反復が2回で分散は見ておらず、手法の優劣の根拠にはなりません。「合議が単一より悪い」とも「合議は常に約 21 倍かかる」とも言えません。**「文案が変わった」の測り方は、この表の2方式で揃っていません。** 合議は、ペルソナが解釈可能な `<draft>` ブロックを出したときだけ設定される `improvedDraft` を比べ、単一は出力の生の全文を比べています。このため、「合意したのに文案は変わらなかった、だから合意と改善は別」という結論は、この実測からは言えません（小さなモデルが `<draft>` タグを書かなかっただけかもしれません）。`<draft>` 形式を守れていたかは、この実測では測っていません（形式遵守は不明）。能力テストは、その後、単一側にも合議と同じ `<draft>` の抽出を適用し、`<draft>` を含むペルソナの発言の数と、予算の超過量（消費 − 上限）を出力するよう直しましたが、この表はその前の測定のままです。改善の質も評価していません。自分のモデルと下書きで、手順 3 の方法で比べてください。

## ハンズオン手順

### 手順 1: サンプルデータを投入し、合議を実行する

- 実行モード: `local`（既定）。`mock` でも完走するが、発言は固定の応答になる。`live` も可
- 外部サービス: `local` は Ollama（`catalog: local.ollama.chat` のモデルの取得）と、Docker の Postgres（`mise run services:up:db`）。`mock` はなし（使い捨てのメモリ内 DB）。`live` は選んだプロバイダの API キー

```text
mise run services:up:db
mise run seed:samples      # 商品カタログとペルソナ定義を投入する。何度実行してもよい
mise run dev               # http://localhost:3000/marketing を開く
```

広告コピーを入力して合議を実行し、ペルソナ名付きの発言が順にストリーミングされ、ラウンドごとの合意の判定と終了理由が表示されることを確かめます。

**ローカルモデルでの注意。** 合議はペルソナを1人ずつ呼びます。1つのローカルモデルでの実測では、ペルソナの各呼び出しが既定の上限 60 秒に達し、トークンは 0 と記録されました。原因は特定していません（「確認できていないこと」を参照）。全員が失敗すると、合議は `provider-unavailable`（「どのペルソナも発言できませんでした」）で止まります。

### 手順 2: 会話でプロファイルとレコメンドを更新する

- 実行モード: `local` または `live`
- 外部サービス: 手順 1 と同じ（Ollama と Postgres、または API キー）

`/marketing` のチャットで「予算は1万円で、軽い素材が好き」のように話しかけ、プロファイル表示（関心事、予算、懸念点）が更新され、レコメンドに商品 ID と推薦理由が付くことを確かめます。続けて「やっぱり予算は 5,000 円」と話し、予算だけが上書きされ、関心事が消えないことを確かめます。

### 手順 3: 合議と単一エージェントのトークン使用量を比べる

- 実行モード: `local`
- 外部サービス: Ollama（`loadSamplePersonas` は fixture ファイルを読むので、Postgres は要りません）

```text
AI_MODEL_CHAT=<使うモデルのカタログ ID> mise run test:local   # tests/capability/council-agreement.local.test.ts を含む
```

能力テスト `council-agreement.local.test.ts` は、同じ下書きで合議と単一エージェントを繰り返し実行し、合意の割合とトークン数を出力します。Ollama に到達できない環境では、理由付きでスキップされます（合格には数えません）。`roleLimits.maxDurationMs` をこのテストは 300 秒に上げていますが、アプリの既定は 60 秒のままです。結果は自分のモデルでの観察であり、上の表とは比べられません。

### 手順 4: 回帰テストを読み、合意とカタログ照合を壊してみる

- 実行モード: `mock`
- 外部サービス: なし

`packages/eval-suite/tests/regression/marketing-council.test.ts` と `marketing-catalog.db.test.ts` を読みます。`moderator.ts` の「`remainingObjections` が残っていれば合意としない」検査を外すと、`packages/ai-core/src/marketing/moderator.test.ts` のどのテストが失敗するかを確かめ、`mise run test` で元に戻ります。

## 習熟度判定チェックリスト

自動テストで確かめられる項目にはテストへの参照があります。**参照するテストはすべて `mock`（PGlite を含む）で実行される gate のテストです。** `local` 専用の能力テスト（`council-agreement.local.test.ts`）は、Ollama に到達できない環境ではスキップされるため、チェックリストの参照には使いません。

- [ ] 合議は、ペルソナが序数の順に発言し（参照するテストは、テスト用のペルソナ a・b・c で確かめます）、毎ラウンド終わりにモデレーターが判定する <!-- test: packages/ai-core/src/marketing/council.test.ts#has the personas speak in ordinal order, then the moderator judges, every round -->
- [ ] 誰も合意しない下書きでは、既定の3ラウンドを実行し、`max-rounds` で終わる <!-- test: packages/eval-suite/tests/regression/marketing-council.test.ts#runs exactly three rounds when nobody ever agrees, and ends with max-rounds -->
- [ ] 3ラウンドは既定値であり、明示した `maxRounds` が優先される <!-- test: packages/eval-suite/tests/regression/marketing-council.test.ts#is a default, not a fixed count: an explicit maxRounds is honoured -->
- [ ] モデレーターが `agreed` を宣言しても、未解決の反対が残っていれば合意としない（CL-12） <!-- test: packages/ai-core/src/marketing/moderator.test.ts#returns agreed false without regenerating when agreed is true but an objection remains (CL-12) -->
- [ ] ラウンドで発言できなかったペルソナがいるときは、合意を受け付けない <!-- test: packages/ai-core/src/marketing/council.test.ts#does not end on an agreement in a round where a persona failed, but does once all speak -->
- [ ] 共有予算を使い切ったら、次のラウンドを始めず `budget-exhausted` と報告する <!-- test: packages/ai-core/src/marketing/council.test.ts#does not start another round once the shared budget is spent, and says 'budget-exhausted' -->
- [ ] 予算の4分の1をモデレーターのために残し、発言が多い合議でも判定が行われる <!-- test: packages/eval-suite/tests/regression/marketing-council.test.ts#holds a quarter back for the moderator, so even a council that talks a lot is still judged -->
- [ ] プロファイルの予算は新しい値で上書きされ、欠けた値は既存の予算を消さない <!-- test: packages/ai-core/src/marketing/profile.test.ts#keeps the existing budget when the new one is null or missing -->
- [ ] プロファイルの配列は、新しい項目を後ろに足し、重複を捨てる <!-- test: packages/ai-core/src/marketing/profile.test.ts#appends new items after the existing ones -->
- [ ] 抽出に失敗したら、前のプロファイルをそのまま返す <!-- test: packages/ai-core/src/marketing/profile.test.ts#returns the very same previous object after the regenerations are used up -->
- [ ] レコメンドの商品 ID は、投入済みのカタログに存在するものだけである <!-- test: packages/eval-suite/tests/regression/marketing-catalog.db.test.ts#returns only product ids that exist in the catalog -->
- [ ] カタログに無い ID を除去し、除去した件数を記録する <!-- test: packages/eval-suite/tests/regression/marketing-catalog.db.test.ts#removes the ids the catalog does not have and records how many (a repeat counts once) -->
- [ ] 商品名と価格は、モデルではなくカタログから取る <!-- test: packages/eval-suite/tests/regression/marketing-catalog.db.test.ts#takes the name and the price from the catalog, never from the model -->
- [ ] すべての ID が除去されたら、レコメンドなしと理由を返す <!-- test: packages/eval-suite/tests/regression/marketing-catalog.db.test.ts#returns no items, says why and records the count when every id was removed -->
- [ ] 合議と単一エージェントのトークン使用量を、自分の環境で比べ、「合意」と「改善」が別であることを説明できる（手で確かめる。`local` 専用の能力テストを使う）

## リファレンス実装とテストの所在

| 項目 | パス |
|---|---|
| 合議のラウンドの反復、予算、終了理由 | `packages/ai-core/src/marketing/council.ts` |
| 合意の判定（モデレーター） | `packages/ai-core/src/marketing/moderator.ts` |
| プロファイルの抽出とマージ | `packages/ai-core/src/marketing/profile.ts` |
| レコメンドとカタログの照合 | `packages/ai-core/src/marketing/recommend.ts` |
| 商品とペルソナの読み取り、サンプルの投入 | `packages/ai-core/src/marketing/catalog.ts`、`packages/ai-core/src/marketing/seed.ts`、`packages/ai-core/fixtures/marketing/` |
| 既定値（ラウンド数、予算、ペルソナ） | `packages/ai-core/src/config/defaults.ts`（`DEFAULT_COUNCIL`） |
| Route Handler | `apps/web/app/api/marketing/council/route.ts`、`apps/web/app/api/marketing/recommend/route.ts` |
| 画面 | `apps/web/app/marketing/page.tsx`、`apps/web/components/marketing/` |
| 実装の隣の単体テスト | `packages/ai-core/src/marketing/*.test.ts` |
| 回帰テスト（gate） | `packages/eval-suite/tests/regression/marketing-council.test.ts`、`packages/eval-suite/tests/regression/marketing-catalog.db.test.ts` |
| 能力テスト（`local` 専用。gate の外） | `packages/eval-suite/tests/capability/council-agreement.local.test.ts` |
| 実測の記録 | `specs/003-domain-agents/research.md`（「W8 の実測」38.4） |

## 本番ではどう作るか

本リポジトリの実装は学習用で、本番の判断と運用はハブ `vaz-agentic-ai-next` の手法ページにあります（文書の転載はしません。確認日 2026-10-29）。

- AE（エージェンティックエンジニアリング）: [`agentic-engineering.md`](https://github.com/Fukuchan77/vaz-agentic-ai-next/blob/main/docs/guide/agentic-engineering.md)（複数のエージェントに分けるかの判断）

このモジュールの合議とレコメンドに個別に対応するハブのページは、[spec 005](../../specs/005-hub-alignment/spec.md) の対応表には載っていません。ここでは、対応先を作らずに、教材の簡略化だけを書きます。

- 合議はプロセス内の関数として一度の実行で完結します。状態の永続化、承認待ちの保持、再開は扱いません。
- 商品カタログは事前に投入したサンプルだけで、外部の商品 API や在庫・価格の更新は扱いません。
- 合議の予算はソフトキャップです。本番でコストを確実に抑えるには、出力トークンの上限をモデル呼び出しの側で課す必要があります（この実装では、出力の上限がスタックのどこにもありません）。

## 確認できていないこと

`mise run gate` は `mock` で動き、実モデルの品質も、`local` 専用の能力テストの結果も保証しません。次は確認できていないこと、または受け入れた制限です。

- **1つのローカルモデルで、合議のペルソナの呼び出しが既定の上限に達した。** 1つ目のモデルでは、ペルソナの各呼び出しが既定の 60 秒の上限に達し（トークンは 0 と記録）、3人とも `timeout` になって `provider-unavailable` で止まりました。合議はペルソナを1人ずつ呼ぶので、並列の呼び出しが詰まったのではありません。原因は特定していません。除外できていない候補は、このモデルの長い出力や暴走した生成と、同じ Ollama の1スロットに同時に当たった他のローカルテストファイルです（後者は `--no-file-parallelism` で実行して確かめることを勧めます）。能力テストは `roleLimits.maxDurationMs` を 300 秒に上げましたが、**アプリの既定は 60 秒のまま**です。
- **1つ目のモデル（research.md の「W8 の実測」で `granite` 系と記録したもの）は、上限を 300 秒に上げても合議を完走できなかった。** 合議の途中で Ollama が `400 Bad Request` を返しました（本文は取れていません）。同じモデルの単一エージェントも、300 秒で1ステップも終えず出力が空でした。Ollama 自体は正常（短い呼び出しは約 15 秒）でした。原因は特定していません（長い出力の暴走や、コンテキスト 4,096 の超過の疑い。未検証）。このため、合議の実測は、別の小さなモデル（名前は research.md に記録）で行いました。
- **トークン使用量の比較は、小さなモデルでの2回の観察にとどまる。** 上の数値（合議の平均 12,626、単一の平均 602、約 21 倍）は、手法の優劣の根拠ではありません。商用の大きなモデル（`live`）では測っていません。
- **予算はソフトキャップである。** 種類ごと（発言、モデレーター）の最初の1回は、残量を超えうります。出力の上限がスタックのどこにも無いためです。回帰テストは、超過を「モデレーター1回分」までに固定していますが、モデルの出力が極端に長い場合は保証しません。
- **モデルの自由記述が、対象外の商品や価格に触れうる（F-19）。** 照合の対象は商品 ID だけで、推薦理由や総評の自由記述に、カタログに無い商品名や価格が入っても検出しません。名前と価格の欄はカタログから取ります。
- **雑談メモが「未確認事項」に残る（F-22）。** これは要件定義書の面接（[3-5](3-5-requirements-interview.md)）側の制限で、雑談への回答が「未確認事項」の章に残り続けます。このモジュールの対象ではなく、ここでは参照だけを置きます。
- **`seedMarketing` は id だけで upsert する（F-23）。** `ON CONFLICT (id)` だけを見るため、学習者が足したペルソナの `ordinal` が既定の1〜3と重なると、`UNIQUE (ordinal)` 制約に当たって `seed:samples` が `--reset` なしでは失敗します。案内は入れていません。
- 予算不足で呼ばれなかったペルソナが `missing` に入らないこと、欠けたラウンドでもモデレーターを呼ぶことは、W6 の再レビューで受け入れた制限です。
- 実 Postgres での `0003_marketing.sql` の適用（`mise run test:db`）と `seed:samples` の2回実行は、PGlite でのみ確かめました。

## 元教材との対照表

| 元教材（Python / LangChain / LangGraph）の対応箇所 | TypeScript / AI SDK 版での置き換え | 移植で諦めたもの |
|---|---|---|
| 第7章 ペルソナ別のディベート・評価・改善 | `runCouncil`（`for` ループによるラウンドロビン。各発言は `cooperateByRole`。終了はコードが確定） | LangGraph の `StateGraph` による定義、状態の reducer、checkpointer、`interrupt`、LangGraph Studio。ペルソナ間の動的な発言順の変更（序数の固定の順） |
| 合意に達したかの判断 | `judgeAgreement`（構造化出力の `agreed` + コードの `remainingObjections` の検査） | 自由記述のモデレーターの判断のみで終える方式 |
| 会話型レコメンド（利用者の情報の逐次把握） | `extractProfile` + `mergeProfile`（Zod、上書きとマージの規則はコード） | 会話の履歴全体を使った長期の記憶 |
| 商品の推薦 | `recommend`（カタログからだけ選び、ID を照合して除去し、件数を記録） | 外部の商品 API や在庫・価格の更新 |
| Streamlit のチャットと表示 | `useChat` と Generative UI（プロファイル表示、レコメンド表示、ペルソナ名付きのストリーミング） | Streamlit の全行再実行モデル |

## 移植時の変更点

[changes-from-drafts.md](../../specs/curriculum/changes-from-drafts.md) に記録された変更のうち、このモジュールに関わるものと、実装時に確定したことです（Req 7.4）。採用したモデルはモデル ID ではなくカタログへの参照で示します（用途 `chat`。`local` なら `catalog: local.ollama.chat`）。

- **合意の確定はコードが持ちます。** モデルは `agreed` を宣言できますが、未解決の反対があれば無効です。欠けたペルソナがいるラウンドも無効です（CL-12）。
- **ラウンドの反復はワークフローです。** `ToolLoopAgent` を使わず、ペルソナはツールを持ちません（ADR-9）。`cooperateByRole` は1役割ずつ呼ぶので、M2 の hand-off は名目上です。
- **コストの上限は2つです。** `maxRounds` と、発言とモデレーターで共有する `maxTotalTokens` です。モデレーターのために4分の1を予約します（CL-17 と同じ考え方）。
- **商品名と価格はカタログから取ります。** モデルが返した名前と価格は使いません（CL-15）。
- **`cooperateByRole` に任意の引数 `onRoleOutput` を足しました。** 発言ごとにストリームへ流すためで、M2 の公開契約は変えていません。M2 のテストは緑のままです。

## 完成時点のタグ

- **タグ**: `module/3-6`
- **含まれるもの**: `marketing/` の合議・合意の判定・プロファイル抽出・レコメンド・サンプルの投入、`/api/marketing/council` と `/api/marketing/recommend`、`/marketing` 画面、合議と単一エージェントのトークン比較の記録、この解説
- **含まれないもの**: `local` と `container` の実行結果の保証（gate の外であり、スキップを合格に数えない）、承認ゲートと書き込み系のツール（M4）、外部の商品 API、状態の永続化と再開
