# 3-4 階層型リサーチエージェント

- **フェーズ**: Phase 3 実践編。IBM 成熟度モデルの Level 2〜3 を扱います。専門のサブエージェントを Supervisor のツールとして束ねる、階層型のマルチエージェントを作ります
- **要件**: [spec 003](../../specs/003-domain-agents/spec.md) の Requirement 4（4.1、4.4、4.5、4.6、4.7、4.8、4.10）。解説の必須事項として 001 の Requirement 7.2〜7.6、7.9
- **実装**: `packages/ai-core/src/research/`、`packages/ai-core/src/research/arxiv/`、`packages/ai-core/src/agents/token-ledger.ts`、`apps/web/app/api/research/`

## 学習目標

このモジュールを終えると、次のことができます。

- Supervisor が 3 つのサブエージェント（検索、手法精読、市場影響評価）を、入力スキーマ付きのツールとして呼び出す構成（Agent-as-a-Tool）を説明できる。
- サブエージェントが「内部のやり取り」ではなく「要約」だけを Supervisor に返す理由と、その境界がコードのどこにあるかを示せる。
- 呼び出し回数の上限と共有トークン予算が、どの順で効き、上限に達したときにレポートにどう現れるかを、テストで確かめられる。
- レポート中の arXiv ID とリンクを、検索で取得した論文の集合と照合して、集合にない言及を除去する仕組みと、その限界を説明できる。
- arXiv の利用規約（3 秒間隔、単一接続）を守るクライアントの設計（直列キュー、日単位のキャッシュ、再試行）を説明できる。
- 階層化が単一エージェントよりトークンを使うことを、使用量の内訳で確かめ、その比較がどこまで言えるかを述べられる。

## 主要トピック

扱う概念は次の 6 つです。

1. Supervisor と 3 つのサブエージェント（Agent-as-a-Tool）
2. サブエージェントは要約だけを返す境界
3. 共有トークン予算と呼び出し回数の上限
4. 引用の照合
5. arXiv の利用規約（3 秒間隔、キャッシュ、再試行）
6. 単一エージェントとのトークン使用量の比較

### Supervisor と 3 つのサブエージェント（Agent-as-a-Tool）

階層型のマルチエージェントには、Supervisor が子を呼ぶ形が複数あります。本リポジトリは **Agent-as-a-Tool** を採ります。サブエージェントを、入力スキーマ付きのツールとして Supervisor に渡す形です（Req 4.1、ADR-8）。単一プロセスの中で、Supervisor の `ToolLoopAgent` が通常のツール呼び出しとしてサブエージェントを動かします。

| サブエージェント | ツール名 | 役割 | 持つツール |
|---|---|---|---|
| 論文検索（`search`） | `searchPapers` | arXiv から論文を探す | `searchArxiv`（読み取り専用） |
| 論文精読（`reading`） | `readPapers` | 指定された論文の手法を読む | `getPaperAbstract`（検索が取得した論文の集合からだけ読む） |
| 市場影響評価（`market`） | `assessMarketImpact` | 調査結果から市場への影響を評価する | なし（受け取った `findings` だけを材料にする） |

`Supervisor` と各サブエージェントは、すべて `createGuardedAgent` で作ります（3 種の停止条件が付きます）。ツールの説明文には「いつ使うか、いつ使わないか、入力の例」を書き、モデルが呼び分けられるようにします（モジュール 3-1 の ACI 設計の応用です）。呼び分けを決めるのはモデルで、コードは順序を固定しません。固定の順序で良いなら、これは階層型エージェントではなくワークフローで書くべきです（憲章 原則 1）。

多エージェントを採る理由は、検索、精読、市場評価の観点を分けて、各サブエージェントの文脈を小さく保つことです。代償は、トークンが増えることです（後述）。

Supervisor が 1 ステップで複数のツールを同時に呼んでも、ツール集合は順に実行します。サブエージェントが 1 つずつ動くので、共有予算の残量が正確に保たれます。

### サブエージェントは要約だけを返す境界

サブエージェントは自分の中で何ステップも動き、ツールの結果（論文の要旨など）を読みます。**Supervisor のコンテキストへ返すのは、モデルの最終回答（要約）と、見つけた論文の ID だけ**です（Req 4.4）。内部のトランスクリプト、ツール呼び出し、要旨の全文は返しません。要約の長さには上限があります（`DEFAULT_RESEARCH.subagentSummaryCharacters`、既定 800 文字）。

この境界には 2 つの意味があります。

- Supervisor の文脈が、呼び出しのたびに膨らみません。3 つのサブエージェントが読んだ要旨をすべて抱えると、階層化の目的（文脈を小さく保つ）が成り立ちません。
- 論文の要旨は外部の文章で、中に指示が混ざる可能性があります。サブエージェントは `<task>` などのタグの中をデータとして扱い、その中の指示に従わないよう指示されます。取り込んだ要旨は、ID だけを外部コンテンツの記録に残します。

境界の代償として、**Supervisor は論文の要旨そのものを見ません**。引用の照合（後述）が、Supervisor ではなく、検索サブエージェントが取得した論文の集合を基準にするのはこのためです。要旨の全文は、実行ごとの論文の集合（コレクター）に集められます。

サブエージェントが失敗したときは、失敗したサブエージェントの名前と理由を Supervisor に返します。Supervisor は残りの結果でレポートを作り、欠落した観点をレポートの「調査できなかった観点」に明記します（Req 4.6）。子の生のエラー文はレポートに入れません。サブエージェントが 1 つも結果を返さなかったときは、Supervisor の文面を信用せず、「調査できなかった」旨と欠落の一覧だけを返します。

### 共有トークン予算と呼び出し回数の上限

上限は 2 つあり、どちらも**コードが数えて**止めます（Req 4.8、CL-17）。

| 上限 | 既定 | 数える方法 |
|---|---|---|
| Supervisor によるサブエージェントの呼び出し回数 `maxSubagentCalls` | 8 | 実行ごとのカウンタ（`createBudget` の `takeCall`） |
| Supervisor と子の合計トークン `maxTotalTokens` | 80,000 | 役割別の台帳（`agents/token-ledger.ts`）。子は呼び出しのたびに「残り」だけを上限として渡される |

上限に達したあとの呼び出しは、**実行されず、数えられず、トークンも使いません**。Supervisor には「実行しませんでした」という理由が返り、その観点は `missing` に載ります。呼び出し回数の上限が先に判定されます。

共有トークンのうち半分（最大 20,000）は、Supervisor の取り分として予約されます。Supervisor は子が動いている間も使い、終わったときに初めて台帳に記録されるので、予約がないと子が使い切ってしまうためです。子は、予約を除いた残りを上限として呼ばれます。残りが少なければ、最後に動く子は残りまで切り詰められ、次の子は開始されません。

`AI_RUN_MODE=mock` の回帰テストが、この挙動を `maxSubagentCalls` と `maxTotalTokens` を変えながら固定しています。テストの `m3-4` シナリオは、Supervisor に検索、検索、精読、市場の 4 回を呼ばせる台本です。台本は上限に関係なく同じなので、上限を超えた呼び出しは、プラットフォームが断った呼び出しになります。

予算は暴走を止める上限で、どの役割にいくら使うかの配分ではありません。使用量は、Supervisor と各サブエージェントの内訳と合計として実行結果に含め、画面にも表示します（Req 4.10）。プロバイダが使用量を報告しなかった呼び出しは、推定で埋めず「不明」と記録します。

### 引用の照合

LLM は、存在しない論文をもっともらしく書きます。レポートを出す前に、本文中の**すべての arXiv ID とリンクを、検索サブエージェントが取得した論文の集合と照合**します（Req 4.5）。`checkCitations` は文字列だけを見る純粋関数で、モデルを呼びません。

- 集合に含まれる論文の言及は残します。バージョン接尾辞（`v2`）は比較の前に外します。
- 集合に含まれない ID と、arXiv や既知の論文サイト（DOI など）へのリンクは除去します。除去の単位は、箇条書きなら項目、表なら行、文章なら該当の文です。ただし、同じ文に集合内の論文の言及があれば、その言及だけを除きます。
- 除去したら、除去した ID を並べた警告をレポートに付けます。警告は `warnings` にも返ります。
- `arXiv:` という接頭辞や DOI の形が付いていれば、月が不正でも ID として扱い、除去します。

この照合は**形を見るだけ**です。ID もリンクもタイトルも付けずに、実在しない論文を文章で述べた場合は検出できません。要件 4.5 の「言及するすべての論文に arXiv ID またはリンクを付与する」は、Supervisor への指示で求めており、コードでは強制できません。「確認できていないこと」にも書きます。

### arXiv の利用規約（3 秒間隔、キャッシュ、再試行）

arXiv の API の利用規約は、**3 秒に 1 リクエスト、単一の接続**を求め、この制限は利用者の全マシンに跨ります（ADR-3）。クライアントは次のように守ります。

| 項目 | 設計 | 既定 |
|---|---|---|
| 間隔 | 直列のキュー。1 つの要求が**終わってから** 3 秒後に次を始める。同時に 2 つは飛ばさない | `minIntervalMs` 3,000 |
| キャッシュ | 問い合わせ（大文字小文字と空白を正規化）ごとに日単位。失敗はキャッシュしない。同時の同一検索は 1 回の要求にまとめる | `cacheTtlMs` 86,400,000（1 日） |
| 再試行 | 429 やエラーは待機を挟んで最大 3 回（最大 4 リクエスト）。`Retry-After`（秒と HTTP 日付）に従うが、3 秒の間隔を下回らず、長すぎる指定は上限（30 秒）で切る | `maxRetries` 3 |
| 応答の大きさ | 上限を超える本文は、再試行せずに失敗にする | 2 MiB |
| 解析 | `fast-xml-parser`（エンティティ展開は無効） | — |

再試行しても失敗したときは、検索サブエージェントの失敗として扱い（Req 4.7）、上の「欠落した観点の明記」（Req 4.6）に従います。応答の本文やサーバーの文言は、エラーにも学習者向けの文言にも入れません。

**プロセス内のキューは、複数のインスタンスで動かすと規約を守れません。** 本リポジトリは単一の学習者のプロセスを前提にしています。複数のインスタンスや複数のマシンから使う本番の設計は、本リポジトリの範囲外です（005 の「本番実装との境界」。下の「本番ではどう作るか」）。

### 単一エージェントとのトークン使用量の比較

階層化はトークンを増やします。多エージェント構成を教材の対象として求める要件（Req 4.1）は、実測を採否の条件にせず、コスト上限の設計と、単一エージェントとの比較の実測を解説に記録することで足ります（憲章 原則 1 の⚠ 1）。次は、その記録です。

**実測（2026-10-29、`local`、小さなローカルモデル（`AI_MODEL_CHAT` で既定から差し替えたもの。モデル名は research.md の記録を参照）で実行、各質問 1 回ずつ、約 189 秒。[research.md の「W8 の実測」](../../specs/003-domain-agents/research.md) の 38.3）**

| 方式 | トークン（平均） | レポートの出どころ（モデル作成 / 定型の代替） | 引用が見つかった論文だけ | 見つかった論文を引用した |
|---|---|---|---|---|
| 階層（Supervisor + 3 つ） | 2,433 | 1 / 2 | 3/3（うち 2 件は定型の代替レポートで、引用がないため必ず有効） | 1/3 |
| 単一エージェント | 1,555 | 3 / 0 | 0/3 | 0/3 |

読み取れる範囲は次のとおりです。

- 階層は単一の約 1.6 倍のトークンを使いました（2,433 対 1,555）。
- **Supervisor は、このモデルではほとんど呼び分けませんでした。** 広い質問と市場の質問ではサブエージェントを 1 つも呼ばず、手法の質問で `search` を 1 回呼んだだけでした。階層型の利点（呼び分け）はほとんど観察できていません。
- **階層の「3/3」は、ほぼ空の数値です。** 広い質問と市場の質問ではサブエージェントが 1 つも成功せず、レポートはプラットフォームが返す定型の「調査できませんでした」でした。この文面には引用がないので、引用の検査は必ず有効になります。モデルが書いたレポートで引用が有効だったのは、手法の質問の 1 件だけです。単一側の「0/3」と並べて、階層のほうが引用が良いとは読めません。テストは今後、モデルが書いたレポートだけを数え、出どころの列を別に出します。
- 「単一 0/3」は、引用検査が単一側の出力を有効と判定しなかったという意味です。**品質の比較ではありません。単一側の出力の読み方は未検証です。**
- arXiv の検索は fixture で、全クエリに同じ 3 件を返します。

**これは小さなローカルモデルでの、1 質問あたり 1 回ずつの観察です。** 分散は見ておらず、手法の優劣の根拠ではありません。階層型を採るべきとも、採るべきでないとも、この数値からは言えません（憲章 原則 1 の⚠ 1 の記録としては、「この実行は、階層化がトークンを増やす方向に働くか減らす方向に働くかのどちらも示していない。呼び分けが起きた場合の数値は取れていない」までが言える範囲です）。自分の環境と自分のテーマで、ハンズオンの手順 3 の方法で測り直してください。

## ハンズオン手順

各手順に、必要な実行モードと外部サービスを書きます。

### 手順 1: `mock` で通しの実行を確かめる

- 実行モード: `mock`
- 外部サービス: なし（arXiv の応答は `packages/ai-core/src/mock/arxiv-fixtures.ts` のフィクスチャ）

```text
mise run dev          # http://localhost:3000/research を開き、サンプルのテーマで実行する
```

Supervisor、検索・精読・市場影響の 3 つの子、論文のカード、使用量の内訳が、役割ごとに区別されて流れます。レポートの末尾に、引用の確認の節（除去した ID）が付くサンプルのテーマと、「調査できなかった観点」が付くサンプルのテーマがあります。`mock` はシナリオの台本どおりに動くので、挙動の確認には向きますが、モデルの呼び分けや品質の評価には使えません。

### 手順 2: 呼び出し回数とトークンの上限を変えて、欠落の現れ方を見る

- 実行モード: `mock`
- 外部サービス: なし

回帰テストを実行し、上限を変えたときにどの観点が欠落するかを確かめます。

```text
env -u NODE_ENV AI_TEST_RUN_MODE=mock AI_TEST_SUITE=gate mise exec -- pnpm --filter @platform/eval-suite exec vitest run tests/regression/research-budget.test.ts
```

`maxSubagentCalls` が 2 のとき精読と市場が欠落し、`maxTotalTokens` が 7,000 のとき共有トークンが尽きて同じ 2 つが欠落することを、テストと読み比べます。

### 手順 3: 実モデルで、階層型と単一エージェントのトークンを比べる

- 実行モード: `local`（既定）。`live` でも実行できます
- 外部サービス: `local` は Ollama の起動と、`catalog: local.ollama.chat` のモデルの取得。`live` はプロバイダの API キー。arXiv は、このリポジトリの評価テストでは fixture です

```text
mise run test:local   # research-quality.local.test.ts を含む。Ollama が無ければスキップされる
```

同じ質問を階層と単一エージェントに渡し、トークンの内訳、Supervisor の呼び分け（どのサブエージェントを何回呼んだか）、引用の有効性を読みます。**まず呼び分けが起きているかを見てください。** 呼び分けが起きていない実行の比は、階層化の費用の比べ方として意味が薄くなります。

### 手順 4: arXiv へ実際に接続する（`live` のみ）

- 実行モード: `live`
- 外部サービス: `export.arxiv.org` へのネットワーク接続（API キーは不要）

実接続は `live` でしか確かめません。`mock` と gate はネットワークを使いません。接続するときは、3 秒間隔と単一接続（上の表）を守り、同じ問い合わせを繰り返さずにキャッシュに任せます。User-Agent は、用途が分かるものを送ります。429 や 503 を受けたときの応答の形は 2026-10-19 に測りましたが、再試行が実サーバーに対してどう働くかは測っていません（「確認できていないこと」）。

## 習熟度判定チェックリスト

自動テストで確かめられる項目にはテストへの参照があります。このモジュールの参照は、`local` 専用の 1 件（`*.local.test.ts`。Ollama が無い環境ではスキップされる）を除いて、`mock` で実行される gate のテストです。

- [ ] 呼び出し回数の上限が 2 のとき、3 回目以降のサブエージェントは実行されず、そのままレポートが出る <!-- test: packages/eval-suite/tests/regression/research-budget.test.ts#stops running sub-agents after the second call when maxSubagentCalls is 2, and still reports -->
- [ ] 断られた呼び出しは、トークンを使わない（回数に数えられないことは、1 つ上の項目のテストが `calls` で確かめる） <!-- test: packages/eval-suite/tests/regression/research-budget.test.ts#does not count a refused call against the cap or spend any tokens on it -->
- [ ] 共有トークンが残っていないサブエージェントは開始されず、理由が記録される <!-- test: packages/eval-suite/tests/regression/research-budget.test.ts#refuses a sub-agent that would start with no shared tokens left and says why -->
- [ ] トークン予算を小さくすると、実行されるサブエージェントは増えない <!-- test: packages/eval-suite/tests/regression/research-budget.test.ts#never runs more sub-agents when it is given fewer tokens -->
- [ ] 予算が十分なら、計画された呼び出しをすべて実行し、予算の内側に収まる <!-- test: packages/eval-suite/tests/regression/research-budget.test.ts#runs every planned call and stays inside the budget when it is ample -->
- [ ] サブエージェントは、内部の要旨やツール呼び出しを返さず、要約と論文の ID だけを返す <!-- test: packages/ai-core/src/research/subagents.test.ts#returns nothing of the child's inside: no abstract, no tool call, no earlier text -->
- [ ] サブエージェントの失敗を Supervisor が受け、残りの結果でレポートを作り、欠落した観点を明記する <!-- test: packages/ai-core/src/research/supervisor.test.ts#goes on with the rest and names the gap in the report (Req 4.6) -->
- [ ] 検索で取得していない論文は、レポートから除かれ、本文と警告でそのことが示される <!-- test: packages/ai-core/src/research/supervisor.test.ts#removes a paper that no search returned, and says so in the report and the warnings -->
- [ ] 集合にない ID を引用した箇条書きの項目は、周りを残して除去される <!-- test: packages/ai-core/src/research/citations.test.ts#removes a list item that cites an unknown ID, and nothing around it -->
- [ ] 集合にない DOI などの論文サイトへのリンクも除去される <!-- test: packages/ai-core/src/research/citations.test.ts#removes a DOI or other paper-site link that no paper in the set has -->
- [ ] トークン使用量が、Supervisor と各サブエージェントの内訳に分かれ、合計と一致する <!-- test: packages/ai-core/src/research/supervisor.test.ts#breaks the tokens down by role and the roles add up to the total -->
- [ ] arXiv への要求は、1 つが終わってから 3 秒後に次を始め、同時に 2 つは飛ばない <!-- test: packages/ai-core/src/research/arxiv/client.test.ts#waits three seconds after one request ends before the next search starts -->
- [ ] 同じ問い合わせは、1 日のあいだキャッシュから返り、要求を飛ばさない <!-- test: packages/ai-core/src/research/arxiv/client.test.ts#serves from the cache until a day has passed and asks again at exactly one day -->
- [ ] サーバーが待機の長さを示さないとき、3 秒、6 秒、12 秒と待って再試行し、3 回の再試行で諦める <!-- test: packages/ai-core/src/research/arxiv/client.test.ts#backs off 3 s, 6 s and 12 s when the server names no wait -->
- [ ] ローカルモデルで、階層型と単一エージェントのトークンと呼び分けを観察できる（`local` 専用のテスト。Ollama が無い環境ではスキップされることがある） <!-- test: packages/eval-suite/tests/capability/research-quality.local.test.ts#observes sub-agent routing, citation validity and cost against a single agent -->
- [ ] 上の比較の数値が、何を言えて何を言えないかを、自分の言葉で述べられる（手で確かめる）
- [ ] 引用の照合が検出できない場合（ID もリンクもない言及）を例示できる（手で確かめる）

## リファレンス実装とテストの所在

| 項目 | パス |
|---|---|
| Supervisor、実行全体、レポートの組み立て | `packages/ai-core/src/research/supervisor.ts` |
| 3 つのサブエージェント | `packages/ai-core/src/research/subagents.ts` |
| arXiv の検索ツール | `packages/ai-core/src/research/tools.ts` |
| 共有予算と呼び出し回数 | `packages/ai-core/src/research/budget.ts` |
| 引用の照合 | `packages/ai-core/src/research/citations.ts` |
| arXiv クライアント（キュー、キャッシュ、再試行、解析） | `packages/ai-core/src/research/arxiv/` |
| 役割別のトークン台帳 | `packages/ai-core/src/agents/token-ledger.ts` |
| 要求の本文スキーマ | `packages/ai-core/src/research/request-schema.ts` |
| 上限の既定値 | `packages/ai-core/src/config/defaults.ts`（`DEFAULT_RESEARCH`、`DEFAULT_ARXIV`） |
| `mock` のシナリオと arXiv のフィクスチャ | `packages/ai-core/fixtures/`、`packages/ai-core/src/mock/arxiv-fixtures.ts` |
| Route Handler | `apps/web/app/api/research/` |
| ユニットテスト | 各ファイルの隣の `.test.ts` |
| 回帰テスト（呼び出し回数と共有予算） | `packages/eval-suite/tests/regression/research-budget.test.ts` |
| 評価テスト（`local` 専用） | `packages/eval-suite/tests/capability/research-quality.local.test.ts` |

## 本番ではどう作るか

本リポジトリの実装は学習用で、本番の判断と運用はハブ `vaz-agentic-ai-next` の手法ページにあります（文書の転載はしません。確認日 2026-10-29）。

- AE（エージェンティックエンジニアリング）: [`agentic-engineering.md`](https://github.com/Fukuchan77/vaz-agentic-ai-next/blob/main/docs/guide/agentic-engineering.md)
- HE（ハーネスエンジニアリング）: [`harness-engineering.md`](https://github.com/Fukuchan77/vaz-agentic-ai-next/blob/main/docs/guide/harness-engineering.md)

本リポジトリの階層型リサーチは、単一プロセスの中で、一度の実行で完結します。実行の途中の状態の永続化、中断からの再開、ジョブの耐久実行は扱いません（[005 Req 1.3](../../specs/005-hub-alignment/spec.md)）。arXiv の 3 秒間隔もプロセス内のキューが守るだけなので、複数のインスタンスから使う設計は、本番側の課題です。

## 確認できていないこと

gate が保証しないこと、実測していないことです。

- **arXiv の実際の応答は、一部だけ測っています。** 2026-10-19 に `curl` で測ったのは、429（`text/html`、本文 `Rate exceeded.`、`Retry-After` なし）、503（HTML、`Retry-After: 0`）、301（`https://` への移動）と、結果 1 件の正常系です（[research.md](../../specs/003-domain-agents/research.md) の I-5）。**測っていないのは、** 結果が複数件の正常系と 0 件の正常系、HTTP 400 のエラーフィード、リダイレクトを辿らないガード付き fetch との相性、そして実サーバーに対する再試行と待機の挙動です。`packages/ai-core/fixtures/arxiv/` のうち、1 件の正常系と 429 / 503 の本文は実測にもとづきますが、それ以外の応答は文書化された形式に基づく推測で、再試行と待機の設計は、フィクスチャとテストの上でだけ確かめています。
- **合計は `maxTotalTokens` を超えることがあります。** `mock` の `m3-4` シナリオで測った合計は、`maxTotalTokens` が 960 のとき 1,370、7,000 のとき 9,100、10,000 のとき 11,800、20,000 のとき 14,480 でした。20,000 のときだけ上限に収まり、小さい予算では上限を超えています。原因は、子が 1 ステップを終える単位でしか止まらない（ステップの途中で切られない）ことと、Supervisor の予約です。共有予算は**ソフトな上限**として設計されており（plan C9、2026-10-29 に決定）、超過は「`maxTotalTokens` + Supervisor 自身の消費」以内であることをテストが固定しています。厳密な費用の上限としては使えません。実モデルでの超過量は測っていません。
- **回帰テストの予算のしきい値は、`m3-4` フィクスチャの使用量に依存します。** テストの 960、7,000、10,000、20,000 という値は、シナリオの `usage` の数値から導いています。シナリオの使用量を変えると、テストの期待も変わります。
- **トークン使用量の比較は、1 つの小さなローカルモデル・各質問 1 回の観察です。** Supervisor はほとんど呼び分けず、単一側の引用の読み方は未検証です。他のモデル、テーマ、複数回の分散は見ていません。この数値は、階層型の設計を支持も否定もしません。
- **引用の照合は形だけを見ます。** ID もリンクもない言及は検出できません。また「言及するすべての論文に ID またはリンクを付ける」という要件は、Supervisor への指示にとどまります。
- **使用量が「不明」の呼び出し。** プロバイダが使用量を返さない呼び出しは、台帳に「不明」と残り、合計には加わりません。この場合、予算は実際より少なく数えられます。
- **W1 の持ち越し（F-10、F-11）。** 台帳を `RunObserver` に接続すること（役割別の集計）と、外部コンテンツの記録の `source` を 512 文字までに切ることは、このモジュールの実装（W5）で対応しました。実モデルでの `source` の切り詰めの影響は測っていません。
- **`next dev` での `research` の実サーバー確認。** `apps/web/e2e/research.spec.ts` は W7 から 3 つのエンジン（chromium、firefox、webkit）で `mock` に対して動きます。`next dev`（開発サーバー）での確認と、実モデルでの確認は行っていません。

## 元教材との対照表

| 元教材（Python / LangChain / LangGraph）の対応箇所 | TypeScript / AI SDK 版での置き換え | 移植で諦めたもの |
|---|---|---|
| 階層型エージェントの Supervisor とサブエージェント（LangGraph のグラフ） | Supervisor の `ToolLoopAgent` に、サブエージェントを入力スキーマ付きのツールとして渡す（`createGuardedAgent`） | LangGraph のグラフ定義、状態の reducer、checkpointer、`interrupt` による耐久的な中断と再開、LangGraph Studio |
| 論文リサーチのレポート生成（LangChain のチェーン） | `runResearch`（Markdown のレポート、欠落した観点、警告、使用量の内訳） | なし |
| arXiv の検索（Python のライブラリ） | `HttpFetcher` と `fast-xml-parser` による自前のクライアント（直列キュー、日単位のキャッシュ、再試行） | ライブラリが提供する便利な検索 API |
| 引用の確認 | `checkCitations`（取得した論文の集合との照合と除去、警告） | モデルによる事実確認 |

## 移植時の変更点

[changes-from-drafts.md](../../specs/curriculum/changes-from-drafts.md) に記録された変更のうち、このモジュールに関わるものと、実装時に確定したことです（Req 7.4）。採用したモデルはモデル ID ではなくカタログへの参照で示します（用途 `chat`。`local` なら `catalog: local.ollama.chat`）。

- **サブエージェントは要約だけを返します。** 内部のトランスクリプトを返さないため、Supervisor は論文の要旨を見ません。引用の照合は、検索サブエージェントが取得した論文の集合を基準にします（Req 4.4、4.5）。
- **共有予算は、Supervisor の予約と子への残りの分配で実現します。** 002 の CL-8 を階層に当てはめた設計で、Supervisor に半分（最大 20,000）を予約します（CL-17、ADR-8）。
- **arXiv はクライアントを自前で持ちます。** 利用規約の 3 秒間隔と単一接続を守るため、直列のキューと日単位のキャッシュを ai-core に置きます（ADR-3）。
- **1 ステップの複数のツール呼び出しも、順に実行します。** 共有予算の残量を正確に保つためです。
- **多エージェントを採る正当化。** 憲章 原則 1 の⚠ 1 に従い、コスト上限の設計と単一エージェントとの比較の実測を記録します（上の「単一エージェントとのトークン使用量の比較」）。

## 完成時点のタグ

- **タグ**: `module/3-4`
- **含まれるもの**: `research/` の Supervisor、3 つのサブエージェント、共有予算、引用の照合、arXiv クライアント、`/api/research` と `/research` 画面、`mock` のシナリオとフィクスチャ、回帰テスト、E2E テスト、この解説
- **含まれないもの**: arXiv の実接続の測定、複数インスタンスでの利用規約の遵守、状態の永続化と再開。実モデルでの E2E は含みません（`apps/web/e2e/research.spec.ts` は `mock` に対して 3 つのエンジンで動き、含まれます）
