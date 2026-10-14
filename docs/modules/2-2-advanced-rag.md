# 2-2 Advanced RAG

- **フェーズ**: Phase 2 発展編。IBM 成熟度モデルの Level 1（Generative AI）の水準で、検索の質を上げる手法の組み合わせを作り、効果を比べます（[phase-2.md](../phases/phase-2.md)）
- **要件**: [spec 002](../../specs/002-rag-and-workflows/spec.md) の Requirement 2（2.1〜2.12）。解説の必須事項として 001 の Requirement 7.2〜7.6、7.9
- **実装**: `packages/ai-core/src/rag/retrieve/`、`rag/eval/`、`packages/eval-suite/tests/`、`apps/web/app/api/rag/`、`apps/web/components/rag/`

## 学習目標

このモジュールを終えると、次のことができます。

- ナイーブなベクトル検索の限界（質問と文書の言葉の不一致、固有名詞の取りこぼし）を、検索手法の組み合わせで補う設計を説明できる。
- HyDE、Multi-Query、ハイブリッド検索（RRF）、Rerank を、それぞれ個別に有効・無効にできるパイプラインとして実装し、中間結果を示して違いを説明できる。
- Rerank の API キーが無い環境、Rerank が失敗した環境でも、統合後の順位で回答を続けられる設計にできる。
- 同じ質問セットで、手法の組み合わせごとの recall@k を比べ、LLM-as-a-Judge で忠実性と回答関連性を採点できる。
- gate の緑が保証する範囲と、`local` の評価だけが示す範囲を区別して述べられる。

## 主要トピック

扱う概念は次の7つです。

1. HyDE と Multi-Query
2. ハイブリッド検索と Reciprocal Rank Fusion
3. Rerank とキーがないときのスキップ
4. パイプラインの中間結果のストリーミング
5. RAG の評価（検索精度と LLM-as-a-Judge）
6. `mock` の緑が保証しないもの
7. 日本語の埋め込みでの閾値の限界

### HyDE と Multi-Query

どちらも、**質問を検索に向く形へ変換**してから検索する手法です。

- **HyDE**（Hypothetical Document Embeddings、Req 2.1）: 質問に対する**仮想の回答**をモデルに書かせ、その仮想回答の埋め込みでベクトル検索します。質問文より、文書の言葉づかいに近い文で検索できます。仮想回答は事実でなくてよく、検索のためだけに使います。回答の根拠には使いません。
- **Multi-Query**（Req 2.2）: 1 つの質問から、観点の違う **3 件のサブクエリ**を構造化出力で生成し、それぞれの検索を並列に実行します。1 つのクエリでは拾えない文書を回収します。

3 件ちょうどであること、空でないこと、互いに異なること（大文字小文字・幅・空白だけが違うものは同じ）は、**コードが検証**します（`expandQuery`）。満たさない出力は `generateValidated` が前回の問題点を添えて最大 2 回まで再生成し、なお不正なら `output-invalid` で失敗します。モデルが「ちょうど 3 件」を守れない場合に備えた仕組みで、守れないと再生成の回数が増えます。守る割合は `local` の評価に出力します（下の「RAG の評価」）。この環境の実測では、32 問すべてが 1 回目で有効でした（再生成 0 回）。

2 つを両方有効にすると、仮想回答を作り、その仮想回答からサブクエリを作る順に進みます（HyDE の結果が Multi-Query の入力になります）。

### ハイブリッド検索と Reciprocal Rank Fusion

ベクトル検索は言い換えに強い一方、固有名詞や型番のような**特定の語**を正確に探すのは苦手です。語の一致を見る全文検索を併用し、2 つのランキングを RRF で 1 つにまとめます（Req 2.3）。

RRF は、各ランキングでの順位 `rank`（1 始まり）から、チャンクごとに `1 / (k + rank)` を足し合わせます（`k` は既定 60）。**スコアの尺度が違う**（コサイン類似度と `ts_rank`）2 つの検索を、順位だけで公平に混ぜられるのが利点です。

```ts
// packages/ai-core/src/rag/retrieve/rrf.ts (idea, abridged)
const score = new Map<string, number>();
for (const ranking of rankings) {
	ranking.forEach((id, index) => {
		score.set(id, (score.get(id) ?? 0) + 1 / (k + index + 1));
	});
}
// the same id appears once; ties are broken by id so the result does not depend on input order
```

- **同じチャンクは統合後に 1 回だけ**含めます（Req 2.4）。両方の検索に出たチャンクは、片方にしか出ないチャンクより上位になりやすくなります。RRF は SQL に書かず、TypeScript の純関数にしているので、DB なしでテストできます。
- 全文検索は、`Intl.Segmenter` で日本語を分かち書きして保存し、PostgreSQL の `simple` 設定の `tsvector` を GIN で引きます。順位は `ts_rank` で、BM25 ではありません。助詞のような、ひらがなだけの短い語は検索語から外します（全文書に出る語が順位を汚すため）。
- **「該当なし」を決めるのはベクトル検索の閾値だけ**です（CL-1）。全文検索だけが当たっても、ベクトル検索が閾値に届かなければ、「該当なし」として回答を生成しません。キーワードの一致は、根拠の十分さを保証しないからです。

### Rerank とキーがないときのスキップ

Rerank は、質問と候補の本文を**一緒に読む**モデルで、統合後の候補を並べ直します（Req 2.5）。検索（埋め込みの近さ）より精度が高い代わりに、候補の数だけ読むので遅く、外部 API の費用がかかります。本リポジトリは Cohere（`@ai-sdk/cohere` と AI SDK の `rerank()`）を使い、キーは `COHERE_API_KEY` です。Rerank のモデルは、モデルカタログ（`models/catalog.ts`）の Rerank の項目にだけ書いてあります。

| 状況 | Rerank 段の扱い | 結果の記録 |
|---|---|---|
| キーがある（`local` / `live`）、Rerank を有効にした | 統合後の候補を並べ直し、上位 k 件を使う | `applied` |
| キーが無い（`local` / `live`） | 段をスキップして、統合後の上位 k 件を使う | `skipped`（理由 `api-key-missing`） |
| Rerank を無効にした | 何もしない | `disabled` |
| 呼び出しが失敗した | 統合後の順位にフォールバックして回答を続ける（CL-11） | `skipped`（理由 `provider-error`） |
| `mock` | 語の重なりによる疑似実装を使う（キー不要、決定論的） | `applied` |

キーが無くても**パイプラインは止まりません**（Req 2.6）。スキップは結果に記録され、画面にも理由が出ます。「効いていないのに効いているように見える」ことを避けるためです。中断（`AbortSignal`）は、フォールバックせずに伝えます。

### パイプラインの中間結果のストリーミング

検索は数段あり、HyDE や Multi-Query を使うとモデルの呼び出しで数秒かかります。完了まで画面が止まらないように、**各段の進行状況と中間結果を、回答の本文とは別のデータ**として UI へ流します（Req 2.11）。

| 段 | 内容 |
|---|---|
| `hyde` | 仮想回答の生成 |
| `multi-query` | サブクエリの生成 |
| `vector-search` / `full-text-search` | 各検索（サブクエリごとの候補） |
| `fusion` | RRF による統合 |
| `rerank` | 並べ直し |

`runRetrieval` は、段が始まる・終わる・スキップされるたびにイベント（`running` / `done` / `skipped`）を出し、終わるたびにその時点までの**トレース**（設定、仮想回答、サブクエリ、各検索の候補、統合後、Rerank 後、最終）を出します。トレースは累積で、最後のものが完全です（Req 2.8）。トレースの型は Zod を含まない素のデータで、`data-*` パートとして AI SDK の UI メッセージストリームに載り、画面の `StageProgress`（進行）と `TraceView`（中間結果）が描画します。段の所要時間は注入された `Clock` で測るので、テストでは固定できます。

### RAG の評価（検索精度と LLM-as-a-Judge）

手法を足すと良くなる、という期待は、**測らないと分かりません**。評価は 2 つあります。

1. **検索精度（recall@k、Req 2.9）**: ラベル付きの質問セット（`fixtures/rag/eval-set.json`、20 問以上）の各質問に、**正解のチャンク ID**（1 つ以上）を付けてあります。手法の組み合わせごとに上位 k 件を取り、正解がどれだけ含まれるかの平均（recall@k）と、1 つでも含まれる質問の割合（ヒット率）を比べます。
2. **LLM-as-a-Judge（Req 2.10）**: 回答の**忠実性**（主張が取得したチャンクに裏付けられているか）と**回答関連性**（質問に答えているか）を、軸ごとに別のプロンプトで採点します（`judgeRagAnswer`）。判定は `pass` / `fail` / `unknown`（根拠が足りず判断できない）で、1〜5 の点も付けます。取得したチャンクが 1 件も無いときは、忠実性を `unknown` にしてモデルを呼びません（比べる対象が無いため）。

```text
質問セット（20 問以上）──▶ 手法の組み合わせごとに検索 ──▶ recall@k の表
                              └──▶ 回答を生成 ──▶ Judge（忠実性・回答関連性）
```

評価は、**専用のインメモリ DB（PGlite）に評価用コーパスだけを取り込んで**行います。稼働中のナレッジベースや、あなたの `knowledge/` の文書には触れません。学習者の文書が増えて recall が変わる、ということが起きません。

評価は 2 つの層に分かれます。

- **gate が保証する「配管」**（`rag-eval-set.db.test.ts`）: 質問セットが 20 問以上で、正解チャンク ID がすべてコーパスに実在し、`mock` の埋め込みで「質問 = チャンク本文」のとき recall@1 が 1.0 になること。評価の仕組みが壊れていないことの検査で、**手法の優劣は主張しません**。
- **`local` だけが示す「効果」**（`rag-retrieval.local.test.ts`、`rag-judge.local.test.ts`）: 実際の Ollama で、手法の組み合わせごとの recall@k の表、Judge の採点、小型モデルの構造化出力と脚注の遵守率を出力します。Ollama が無い環境では、理由付きでスキップされ、合格には数えません。

M2 の Judge は RAG 専用の最小実装です。Judge の共有・校正・コスト記録・レポートは、モジュール 4-3 の評価基盤（M4）で扱います。

#### 実測の例（2026-10-13、`local`、質問 32 問、recall@5）

数値は [research.md の「M2 実測（W6）」](../../specs/002-rag-and-workflows/research.md)（25.1-a）から引いています。評価用コーパス 6 文書、`local` の埋め込みとクエリ展開のモデル（`catalog: local.ollama.embedding`、`catalog: local.ollama.structured`）、閾値 0、上位 5 件です。

| 組み合わせ | 平均 recall@5 | ヒット率@5 |
|---|---|---|
| ナイーブ | 70.8% | 75.0% |
| ハイブリッド | **89.1%** | **93.8%** |
| HyDE | 65.6% | 71.9% |
| Multi-Query | 63.5% | 68.8% |
| HyDE + Multi-Query + ハイブリッド | 68.8% | 68.8% |
| Rerank を含む組み合わせ | **未実測**（`COHERE_API_KEY` が無い環境のため） | — |

読み取れること: この質問セットでは、ハイブリッド検索が最も効きました（ヒット 30/32 対 ナイーブ 24/32）。サンプリングを含まない比較はこれだけで、頑健な差です。HyDE（23/32）と Multi-Query（22/32）はナイーブをわずかに下回りましたが、**差は 1〜2 問**で、手法の出力は温度 1 の既定のサンプリングで揺れ、実行は 1 回だけです。「手法を足せば必ず良くなる」とは限らない例として読み、「効かない」とまでは言えません。原因は確かめていません。候補は 2 つです。(1) 小型のモデルが書く仮想回答やサブクエリが質問の意図から外れた。(2) このパイプラインは、HyDE か Multi-Query を有効にすると**元の質問そのものを検索せず**、両方を有効にするとサブクエリを質問ではなく**仮想回答から**作ります（`runRetrieval`）。質問ごとの結果の表（テストが出力します）で、どの質問が外れたかを確かめられます。言えないことは、手法の一般的な優劣です（32 問・6 文書・1 つのモデルでの観察で、長い文書群や曖昧な質問、大きなモデルでは変わりえます）。

| 項目（`local`） | 結果 |
|---|---|
| Multi-Query の「ちょうど 3 件」を 1 回目で守った割合（`catalog: local.ollama.structured`） | 32/32（再生成 0 回） |
| 回答に範囲内の脚注 `[n]` を付けた割合、10 問（`catalog: local.ollama.chat`） | 9/10（範囲外の脚注は 0/10） |
| Judge（`catalog: local.ollama.judge`）の固定 3 ケース | 根拠のある回答は忠実性 pass、チャンクに無い主張を足した回答は忠実性 fail、質問に答えていない回答は回答関連性 fail |

Rerank の行は、`COHERE_API_KEY` を設定して再実行すると加わります（未実測を実測済みと読まないでください）。

### `mock` の緑が保証しないもの

`mock` の埋め込みは意味を持たない乱数ベクトル（同じ文は 1.0、異なる文はほぼ 0）です。したがって、`mise run gate` の緑が保証するのは、RRF の算術、重複の排除、閾値の境界、recall の計算、制御フロー（スキップ、フォールバック、中断）、型、SQL の正しさ（PGlite）です。

保証**しない**のは次のとおりです。

- **手法の効果の差。** HyDE、Multi-Query、ハイブリッド、Rerank のどれが recall を上げるか。**`*.local.test.ts` だけ**が示し、gate ではスキップされます。
- **Judge の判定。** モデルの出力であり、同じ入力でも変わりえます。
- **`local` のモデルが構造化出力（3 件）や脚注を守る割合。**
- **日本語の埋め込みの品質、閾値の妥当性。**
- **実 Postgres での挙動**（`*.pg.test.ts`、`mise run test:db`）と、**Cohere の実際の呼び出し**（手動のハンズオン）。

「手法を有効にしたテストが緑」は、「手法が効く」ことを意味しません。

### 日本語の埋め込みでの閾値の限界

「該当なし」の判定はベクトル検索の閾値（既定 0.5）だけで行うので、閾値が効くかどうかが安全性に直結します。`local` の日本語の埋め込みでは、関連する質問と無関係な質問の類似度が重なり、単一の閾値では分けられません（[research I-8](../../specs/002-rag-and-workflows/research.md)）。

2026-10-13 に、評価用コーパス（6 文書）に対して、各質問の最上位のチャンクのコサイン類似度を測りました（[research.md の「M2 実測（W6）」](../../specs/002-rag-and-workflows/research.md)、25.1-d）。

| 質問 | 件数 | 最小 | 中央値 | 最大 | 閾値 0.5 以上 |
|---|---|---|---|---|---|
| コーパスに答えがある | 32 | 0.710 | 0.822 | 0.938 | 32/32 |
| コーパスに答えが無い（天気、料理など） | 8 | 0.627 | 0.706 | 0.746 | **8/8** |

**既定の閾値 0.5 では、答えが無い質問でも「該当なし」になりませんでした。** 2 つの分布は 0.71〜0.75 で重なり、単一の閾値では分けられません。この数値は `local` の埋め込みモデル（`catalog: local.ollama.embedding`）が決める性質で、このコーパスと質問での観察です。別の埋め込みモデルや文書では変わるので、自分の環境で測ってください（`rag-retrieval.local.test.ts` の類似度のテストが分布を出力します。LLM を使わず数秒で終わります）。四分位と中央値は最近順位です。2 つの行は同じ 1 回の実行（2026-10-14 の再実行）で測りました。

この限界があるため、検索手法の比較は**閾値の分離力に依存しない** recall@k で行います（評価の `local` テストは閾値を 0 にして順位だけを見ます）。閾値は要件どおり実装し、リクエストで変更できます。**閾値だけに頼らず**、回答プロンプトの「根拠が無ければ該当なし」と、引用を人が確かめられる UI を併用してください。

## ハンズオン手順

### 手順 1: 手法を個別に切り替えて、中間結果を読む

- 実行モード: `local` / `live`（`mock` でも画面の流れは確かめられる。ただし `mock` の埋め込みは、チャンクの本文と完全に同じ文字列の質問にしか類似度が出ないので、質問には評価用コーパスの段落をコピーして貼る。自然な質問は「該当なし」になる）
- 外部サービス: `local` は Ollama の起動と、`catalog: local.ollama.chat`、`catalog: local.ollama.structured`、`catalog: local.ollama.embedding` のモデルの取得、Docker の Postgres。`live` は選んだプロバイダのキー。Rerank は `COHERE_API_KEY`（**任意**）

```text
mise run services:up:db
mise run dev          # http://localhost:3000/rag
```

評価用コーパスを取り込み、質問セット（`packages/ai-core/fixtures/rag/eval-set.json`）から選んだ質問を、手法のスイッチ（HyDE、Multi-Query、ハイブリッド、Rerank）を変えながら送ります。段の進行が順に表示され、トレースに仮想回答、サブクエリ、各検索の候補、統合後、Rerank 後が出ます。**ナイーブと、全部有効の結果の上位 k 件を比べます。**

### 手順 2: Rerank のキーが無い場合を確かめる

- 実行モード: `local`
- 外部サービス: `COHERE_API_KEY` を**設定しない**

Rerank を有効にして質問します。Rerank 段が `スキップ` と表示され、トレースに「Rerank の API キーが未設定のため、スキップしました。」と出て、統合後の順位で回答が続くことを確かめます。`COHERE_API_KEY` を `.env.local` に設定すると、Rerank が `applied` になります（キーは任意で、無くてもこのモジュールの他の手順は完走します）。

### 手順 3: 手法の組み合わせを recall@k で比べる

- 実行モード: `local`
- 外部サービス: Ollama（Docker は不要。評価は PGlite で行う）。Rerank の行は `COHERE_API_KEY` がある場合だけ

```text
mise run test:local
```

`rag-retrieval.local.test.ts` が、組み合わせごとの recall@k の表（質問ごとの表も）と、Multi-Query の構造化出力の遵守、類似度の分布を出力します。**全問の比較は、Ollama が空いていても約 26 分、他の処理と並走すると 1 時間以上かかります。**短く確かめるときは、環境変数 `RAG_EVAL_QUESTIONS=3` で質問を先頭の 3 問に絞ります（約 2.5 分）。類似度の分布だけなら `-t "top-1 cosine"` で絞ります（数秒）。質問ごとの表で、**どの手法が、どの質問で効いたか**を確かめます。

### 手順 4: Judge で回答を採点する

- 実行モード: `local`
- 外部サービス: Ollama（`catalog: local.ollama.judge` のモデルを取得しておく）

`rag-judge.local.test.ts` が、根拠のある回答、チャンクに無い内容を足した回答、質問に答えていない回答を採点し、判定と理由を表に出します。**判定が揺れる**ことがあるので、複数回実行して見比べます。

### 手順 5: 評価の配管を壊して、gate が落ちることを確かめる

- 実行モード: `mock`
- 外部サービス: なし

`eval-set.json` の正解チャンク ID を 1 つ書き換えて `mise run test` を実行し、`rag-eval-set.db.test.ts` が落ちることを確かめてから、元に戻します。

## 習熟度判定チェックリスト

自動テストで確かめられる項目にはテストへの参照があります。`local` 専用のテストを参照する項目は、Ollama が無い環境ではスキップされます（`mise run test:local` でだけ実行されます）。

- [ ] HyDE は、質問ではなく仮想回答の埋め込みで検索する <!-- test: packages/ai-core/src/rag/retrieve/pipeline.db.test.ts#searches with the embedding of the hypothetical answer, not of the question -->
- [ ] Multi-Query は、サブクエリごとに検索し、1 つでも閾値に届けば根拠がある <!-- test: packages/ai-core/src/rag/retrieve/pipeline.db.test.ts#finds evidence when only one sub-query reaches the threshold -->
- [ ] Multi-Query は、同じサブクエリ（大文字小文字・幅・空白の違いだけ）を再生成させる <!-- test: packages/ai-core/src/rag/retrieve/multi-query.test.ts#treats sub-queries that differ only in case, spacing or width as duplicates -->
- [ ] 3 回続けて不正なら失敗し、生成した文をエラーにコピーしない <!-- test: packages/ai-core/src/rag/retrieve/multi-query.test.ts#does not copy the generated sub-queries into the error -->
- [ ] RRF は、複数のランキングに出るチャンクを統合後に 1 回だけ含める <!-- test: packages/ai-core/src/rag/retrieve/rrf.test.ts#returns an id that appears in several rankings exactly once -->
- [ ] ハイブリッドは、両方の検索に出たチャンクを 1 回だけ、単独の検索より上位にする <!-- test: packages/ai-core/src/rag/retrieve/pipeline.db.test.ts#returns a chunk found by both searches once, ranked above single hits -->
- [ ] 全文検索だけが当たっても「該当なし」になる（CL-1） <!-- test: packages/ai-core/src/rag/retrieve/pipeline.db.test.ts#says no evidence when only the full-text search hits (CL-1) -->
- [ ] キーが無いとき、Rerank 段をスキップして理由 `api-key-missing` を記録する <!-- test: packages/ai-core/src/rag/retrieve/pipeline.db.test.ts#skips the stage and records api-key-missing when no provider is configured -->
- [ ] Rerank が失敗したら、統合後の順位にフォールバックして `provider-error` を記録する（CL-11） <!-- test: packages/ai-core/src/rag/retrieve/pipeline.db.test.ts#falls back to the fused order and records provider-error when the provider fails -->
- [ ] 各段の開始・終了・スキップがイベントになり、トレースは累積する <!-- test: packages/ai-core/src/rag/retrieve/trace.test.ts#emits running, done and skipped events in call order -->
- [ ] recall@k は、上位 k 件の重複を 1 件に数え、正解が無いときは 0 を返す <!-- test: packages/ai-core/src/rag/eval/recall.test.ts#is 0 when there is no gold chunk instead of dividing by zero -->
- [ ] 手法の組み合わせごとに、同じ質問セットで平均 recall を比べる <!-- test: packages/ai-core/src/rag/eval/recall.test.ts#reports the mean recall and per-question results for each combination -->
- [ ] Judge は軸ごとに別のプロンプトで採点する <!-- test: packages/ai-core/src/rag/eval/judge.test.ts#judges the two axes with one separate call each -->
- [ ] 取得したチャンクが無いとき、忠実性を `unknown` にしてモデルを呼ばない <!-- test: packages/ai-core/src/rag/eval/judge.test.ts#rates faithfulness `unknown` without calling the model when no chunk was retrieved -->
- [ ] 評価の質問セットの正解チャンク ID が、取り込んだコーパスに実在する（評価の配管） <!-- test: packages/eval-suite/tests/regression/rag-eval-set.db.test.ts#only labels chunk IDs that exist in the ingested evaluation corpus -->
- [ ] 質問がチャンク本文と同じなら、`mock` の埋め込みで recall@1 が 1.0 になる（評価の配管） <!-- test: packages/eval-suite/tests/regression/rag-eval-set.db.test.ts#returns every gold chunk first through compareMethods when the question is the chunk body (recall@1 = 1.0) -->
- [ ] 手法の組み合わせごとの recall@k を実モデルで比べる（`local`。スキップされうる） <!-- test: packages/eval-suite/tests/capability/rag-retrieval.local.test.ts#compares mean recall@k per method combination and runs every question to completion -->
- [ ] Judge が、根拠のない回答を `fail` にする（`local`。スキップされうる） <!-- test: packages/eval-suite/tests/capability/rag-judge.local.test.ts#scores an answer with a claim the chunks do not contain as unfaithful -->
- [ ] 手法の効果の差と Judge の判定が、gate では保証されない理由を説明できる（手で確かめる）

## リファレンス実装とテストの所在

| 項目 | パス |
|---|---|
| HyDE、Multi-Query | `packages/ai-core/src/rag/retrieve/hyde.ts`、`multi-query.ts` |
| RRF | `rag/retrieve/rrf.ts` |
| パイプライン、トレース | `rag/retrieve/pipeline.ts`、`rag/retrieve/trace.ts` |
| Rerank | `packages/ai-core/src/ports/rerank.ts`（Cohere）、`rag/lexical-rerank.ts`（`mock`） |
| 構造化出力の再生成 | `packages/ai-core/src/structured/generate-validated.ts` |
| 評価（recall、Judge、質問セット） | `rag/eval/` |
| 評価コーパスと質問セット | `packages/ai-core/fixtures/rag/` |
| 評価テスト | `packages/eval-suite/tests/regression/rag-eval-set.db.test.ts`、`tests/capability/rag-retrieval.local.test.ts`、`tests/capability/rag-judge.local.test.ts` |
| 進行状況・中間結果の画面 | `apps/web/components/rag/`（`StageProgress`、`TraceView`、`MethodSwitches`） |

## 本番ではどう作るか

本リポジトリの実装は学習用で、本番の判断と運用はハブ `vaz-agentic-ai-next` の手法ページにあります（文書の転載はしません。確認日 2026-10-13）。

- CE（コンテキストエンジニアリング）: [`context-engineering.md`](https://github.com/Fukuchan77/vaz-agentic-ai-next/blob/main/docs/guide/context-engineering.md)

## 元教材との対照表

| 元教材（Python / LangChain / LangGraph）の対応箇所 | TypeScript / AI SDK 版での置き換え | 移植で諦めたもの |
|---|---|---|
| 2_ai-agent 第5〜7章（HyDE、Multi-Query、RRF、Rerank） | `runRetrieval` の段（`generateHypotheticalAnswer`、`expandQuery`、`reciprocalRankFusion`、`rerank` ポート） | LangChain の `MultiQueryRetriever`・`EnsembleRetriever` の組み込みの挙動 |
| `CohereRerank`（LangChain） | AI SDK の `rerank()` と `@ai-sdk/cohere`。キーが無ければスキップして記録する | LangChain のコンプレッサのチェーン |
| 構造化出力の失敗を `OutputFixingParser` で直す | `generateValidated`（問題点を添えた再生成、最大 2 回） | なし |
| RAG の評価（RAGAS など） | RAG 専用の最小実装（recall@k と、2 軸の Judge） | 指標の網羅（文脈適合率など）、Judge の校正と再現性（M4 の 4-3 で扱う） |
| 検索の可視化（Streamlit の表示） | `data-*` パートで進行と中間結果を流し、`StageProgress` / `TraceView` で描画 | なし |

## 移植時の変更点

[changes-from-drafts.md](../../specs/curriculum/changes-from-drafts.md) の §9 に記録された変更のうち、このモジュールに関わるものと、実装時に実測で確定したことです（Req 7.4）。採用したモデルはモデル ID ではなくカタログへの参照で示します（HyDE の生成と Multi-Query は用途 `structured`、回答は用途 `chat`、Judge は用途 `judge`）。

- **Rerank のモデルはカタログに置きます。** キー名は `COHERE_API_KEY` です。価格と無料枠は公式ページで確認してください（本書は未確認の数値を書きません）。
- **「ちょうど 3 件」の保証はコードです。** 守れない場合に備えた仕組みで、再生成の回数を `local` の評価で観察します（この環境の実測では 32/32 が 1 回目で有効でした）。
- **Judge は軸ごとに別のプロンプト**で、`unknown`（判断できない）を選択肢に含めます（M4 の Judge の設計に先回りして揃えました）。
- **評価は専用の PGlite**で行い、稼働中のナレッジベースに触れません。
- **「該当なし」はベクトル検索の閾値だけで決めます**（CL-1）。全文検索の一致は閾値の対象外です。

## 完成時点のタグ

- **タグ**: `module/2-2`
- **含まれるもの**: HyDE、Multi-Query、ハイブリッド検索と RRF、Rerank（Cohere と `mock` の疑似実装）、進行状況と中間結果のストリーミング、recall@k と Judge の評価、評価用コーパスと質問セット、この解説
- **含まれないもの**: Judge の共有・校正・レポート（4-3）。実 Postgres と Cohere の実キーによる人の確認（未了なら「人が行うこと」に残す）
