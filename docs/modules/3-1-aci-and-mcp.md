# 3-1 ACI と MCP

- **フェーズ**: Phase 3。IBM 成熟度モデルの Level 2〜3 に向けて、エージェントが使う道具（ツール）の設計と、MCP による標準的な接続を学びます（[phase-3.md](../../specs/curriculum/phase-3.md)）
- **要件**: [spec 003](../../specs/003-domain-agents/spec.md) の Requirement 1（1.1、1.3、1.5、1.7、1.8、1.12、1.16、1.17）。解説の必須事項として 001 の Requirement 7.2〜7.6、7.9
- **実装**: `packages/ai-core/src/aci/`、`packages/ai-core/src/mcp/`、`packages/ai-core/src/files/`、`apps/web/app/api/mcp/`、`apps/web/app/mcp/`

## 学習目標

このモジュールを終えると、次のことができます。

- ツールの説明文を「用途の1文 + 使うとき + 使わないとき + 例」の形式で書き、入力の各項目に意味を付けられる。
- 入力が不正なときに、ツール本体を実行せず、違反した項目と正しい形を示す修正ガイドを返す設計を説明できる。
- ツールの出力で、UUID ではなく 0 始まりの短い番号を使う理由と、`concise` / `detailed` を切り替える理由を説明できる。
- ファイルを扱う MCP サーバーを公式 SDK で自作し、許可リストと注釈（アノテーション）から、エージェントが呼べるツールを絞り込める。
- 致命的なエラーを Run 単位のラッチで伝え、停止理由 `error` で止める仕組みと、書き込み系のツールをこのマイルストーンで登録しない理由を説明できる。

## 主要トピック

扱う概念は次の14個です。最初の3つが ACI（Agent-Computer Interface）の考え方、続く6つが ACI の設計の指針、後半の5つが MCP です。

1. ACI の失敗の多くはモデルではなくツール定義に起因する
2. Ground Truth に基づく進行
3. エージェント設計の3原則
4. ツール説明文の形式
5. 入力の修正ガイド
6. `concise` と `detailed`
7. 意味のある識別子
8. 思考ツール
9. 高水準ツール
10. 自作の MCP サーバー
11. 許可リスト
12. 注釈とリスク区分
13. 致命的エラーのラッチ
14. 書き込み系ツールを登録しない理由

### ACI の失敗の多くはモデルではなくツール定義に起因する

仕様が曖昧なツールや、低レベルすぎるツールでは、高性能なモデルでも迷走します。エージェントが誤った引数を渡す、似たツールを取り違える、といった失敗の多くは、モデルを替えるより、ツールの名前、説明文、入力スキーマ、出力を直すほうが効きます。人間向けの画面（UI）に気を配るのと同じ重みで、エージェント向けの画面（ACI）を設計します。以降の節は、この考えを具体的な設計の指針にしたものです。元教材のように、ツールを「関数に説明を付けたもの」として扱うと、この段階で差が出ます。

### Ground Truth に基づく進行

エージェントは、思い込みではなく、ツールの戻り値、検索結果、ファイルの中身、テストの成否といった**客観的な事実（Ground Truth）**を取り込んで、次の一歩を決めます。この考えが、ツールの設計に3つの要請を出します。事実は**欠けずに**返す（空の結果は空と明示する）、失敗は**事実として**返す（次に取る行動を添える）、モデルの推測を事実に混ぜない（思考ツールは何も返さない）。本リポジトリでは、`readFile` が空のファイルを空文字列ではなく明示の通知で返す点や、`searchFiles` が一致なしを失敗にせず「一致なし」と返す点に表れています。

### エージェント設計の3原則

Anthropic のガイダンスにある3原則です。(1) **シンプルな設計を保つ**（Maintain Simplicity）。ツールは少なく、数は1エージェントにつき20個以下（Req 1.15）。(2) **思考と計画を可視化する**（Prioritize Transparency）。思考ツールや停止理由の表示がこれに当たります。(3) **ツール仕様を磨き込む**（Carefully Craft ACI）。以降の節の説明文の形式、修正ガイド、`concise` / `detailed` がこれに当たります。3つ目に最も時間を割く、というのが ACI 工学の主張です。

### ツール説明文の形式

ACI は、人間向けの UI に当たる「エージェント向けの画面」です。モデルはツールの名前、説明文、入力スキーマだけを頼りに、いつ・どう呼ぶかを決めます。元教材の LangChain の `Tool`（名前と短い説明）に当たる部分を、本リポジトリでは `defineAciTool`（`packages/ai-core/src/aci/define-tool.ts`）で定義し、説明文の形式をコードで検査します（Req 1.1、CL-18）。

説明文は、先頭の「用途の1文」と、行頭の3つの見出しからなります。

```text
次の行動の前に、考えを整理するための場所。外部の情報は取得せず、何も変更しない。
使うとき: ツールの結果を受けて方針を決め直すとき、…
使わないとき: 外部の情報が必要なとき（検索や取得のツールを使う）、…
例: thought="結果が 2 件ある。条件に合う方を選んでから回答する。"
```

- 見出しは `使うとき:`、`使わないとき:`、`例:` の3つ（`DESCRIPTION_HEADINGS`）。全角コロンも受け付けます。
- 見出しは**行頭**に置きます。文の途中の言及は見出しと数えません。本文が空の見出しも不正です。
- 入力スキーマの**すべての項目**に `.describe()` が要ります。ネストしたオブジェクトや配列の中も検査します。
- 検査に落ちた定義は `defineAciTool` が例外で拒否し、足りない見出しや項目名を示します。M1 の6ツールも、この形式に書き直しました。

「使わないとき」には、**代わりに使うツール**を書きます。モデルが似たツールの間で迷う場面を、説明文で減らすためです。

### 入力の修正ガイド

入力が Zod スキーマに違反したとき、`defineAciTool` はツール本体を実行しません（Req 1.2）。代わりに、`formatInputGuide`（`aci/input-guide.ts`）が作る修正ガイドを、モデルに返します。ガイドには、違反した項目名、期待する型、取りうる値、そして**スキーマから作った正しい入力例**が入ります。受け取った値は再掲せず、スタックトレースや Zod の JSON ダンプも含みません。

AI SDK は、入力の検証に失敗すると `tool-error` を返して続行します。既定の文言は Zod の違反一覧の JSON で、モデルには直し方が分かりにくいため、`inputSchema` を `jsonSchema(…, { validate })` で包み、失敗時に修正ガイドを返すようにしました（CL-2、spike の実測は research.md の「CL-2」）。AI SDK が付ける `Invalid input for tool …` の前置きは消せませんが、修正ガイドの全文はモデルに届きます。

実行中のエラーは、2種類に分けます（Req 1.3）。**回復可能**（入力の誤り、一時的な失敗、タイムアウト）は、エラーの要約と次に取る行動を結果として返し、run は続きます。**致命的**（認証失敗、設定不備、許可されない操作）は run を止めます（後述の「致命的エラーのラッチ」）。どちらでも、生のメッセージやスタックトレースはモデルに渡しません。

### `concise` と `detailed`

出力が長いツールには、`response_format` に当たる引数 `format`（`concise` / `detailed`）を持たせます（Req 1.6）。`applyResponseFormat`（`aci/response-format.ts`）は、`concise` ならコードポイント単位で上限（既定 1,000 文字）に切り詰め、省略した文字数と、全文の取り方（「`format: detailed` でもう一度呼ぶ」）を末尾に付けます。サロゲートペアを途中で切りません。`detailed` は全文を返します。

要は、コンテキストを節約しつつ、**足りなければ自分で取りに行ける**ことです。切り詰めるだけで案内が無いと、モデルは情報が無いと思い込みます。

### 意味のある識別子

ツールがモデルに見せる識別子は、UUID ではなく、名前または 0 始まりの短い番号にします（Req 1.13）。`ShortIdIndex`（`aci/short-id.ts`）は、項目に `{ index, label }` を割り当て、モデルが返した番号を実体に戻します。範囲外、負数、小数は `undefined` です。ファイルのツールでは、`listFiles` / `searchFiles` が返す `[0] README.md` の番号を `readFile` に渡せます。長い UUID はトークンを食い、モデルが写し間違える原因になります。

### 思考ツール

`think`（`createThinkTool`、`aci/think-tool.ts`）は、何も取得せず、何も変更せず、受け取った考えを**保存も返却もしない**ツールです（Req 1.14）。ツールの結果を受けて方針を決め直す場面で、考えを書き出す場所をモデルに与えます。設定で無効にすると、ツール一覧から外れます。リスク区分は `read-only` です。

### 高水準ツール

複数の低レベルの操作を要する業務操作は、1つの高水準ツールにまとめられます（Req 1.12）。ファイルのツールでは、`findAndReadFiles`（検索して、一致したファイルを読む）が、`searchFiles` と `readFile` を組み合わせた操作の代わりになります。読むファイルの数には上限（`maxFiles`）があり、読まなかった件数も伝えます。

比較は `compareApproaches`（`aci/high-level-compare.ts`）が計算し、`/api/mcp/compare` と `/mcp` の画面で見られます。`mock` では手順数が固定値です。実モデルでの観察は、research.md の「W8 の実測」の 38.1 にあります。

| 方式 | ステップ（最小-中央-最大） | トークン（最小-中央-最大） | 呼ばれたツール |
|---|---|---|---|
| `findAndReadFiles`（高水準） | 2-2-2 | 1,839-1,894-1,900 | `findAndReadFiles` |
| `searchFiles` + `readFile`（低レベル） | 4-4-4 | 5,444-5,641-5,696 | `searchFiles > readFile > readFile` |

3回ずつの実行で、高水準のほうが中央値でステップが2、トークンが3,747少なく（トークン比 0.34）、全6回が `completed` でした。**これは小さなローカルモデル（モデル名は research.md の「W8 の実測」に記録）での少数回の観察であり、手法の優劣の根拠ではありません。** 分散は見ておらず、タスクは「README を含むファイルを探して読む」の1つだけです。自分のモデルとタスクで測り直してください（ハンズオンの手順 3）。

### 自作の MCP サーバー

MCP（Model Context Protocol）は、ツールを標準的な形でモデルへ渡す規約です。元教材ではコラムでしたが、本カリキュラムは本編に昇格させました。ローカルのファイルシステムを扱うツール群を、公式の MCP SDK（`@modelcontextprotocol/server`）で自作し、stdio で接続します（Req 1.7）。

- サーバーは `packages/ai-core/src/files/server.ts` の `createFilesServer` です。`listFiles`、`readFile`、`searchFiles`、`findAndReadFiles`、`writeFile`、`deleteFile` の6ツールを `registerTool` で公開します。
- `stdio.ts` が起動ファイルで、`filesServerConfig` が、現在の Node の型除去でこれを子プロセスとして起動します（CL-3、`tsx` 不要）。許可ルートは環境変数 `MCP_FS_ROOT` で渡し、存在しないディレクトリを作らずに終了します（打ち間違いを新しい場所に変えないため）。
- パスは絶対パスだけを受け付けます（Req 1.4）。シンボリックリンクを解決した実パスが、許可ルートと同一かその配下でなければ拒否します。判定は**パス区切り単位**で、`/work/root-evil` のようにルートと接頭辞だけが同じ別ディレクトリも拒否します（Req 1.5、`files/path.ts`）。存在しないパスでも、ルートの外へ出るなら「ルート外」と答え、外側の存在を漏らしません。
- 失敗は例外ではなく `isError: true` の結果で返し、`_meta["agentic-ai/error"]` に `{ kind, code }` を載せます（CL-24）。クライアントは、自分たちが書いたこのサーバーの `_meta` だけを信じます。

クライアント側は AI SDK v7 の MCP クライアント（`@ai-sdk/mcp`）です。`connectMcpServers`（`mcp/connect.ts`）が、サーバーごとの接続、ツール一覧の取得、登録を担います。接続の失敗や切断は、サーバー名と原因（エラー名だけ）を添えて「利用不可」とし、他のサーバーは動かし続けます（Req 1.10）。1つのエージェントに登録できるツールは、MCP のものを含めて20個までで、超える構成は起動時に拒否します（Req 1.15）。

GitHub の公式ホスト型 MCP サーバー（`githubServerConfig`）は、`GITHUB_TOKEN` があるときだけ接続します（Req 1.9）。トークンは `Authorization` ヘッダだけに載り、URL にも許可リストにもエラー文にも出ません。トークンが無ければ、そのサーバーは一覧に出ず、他に影響しません。

### 許可リスト

サーバーが公開するツールのうち、エージェントが呼べるのは、そのエージェントの**許可リスト**に名前がある（完全一致）ものだけです（Req 1.8）。`buildAllowedSchemas`（`mcp/allow-list.ts`）が、許可された名前の入力スキーマだけを `client.tools({ schemas })` に渡すので、許可されないツールはクライアントがツールとして作ることすらしません。

- サーバーが公開しない名前が許可リストにあれば、黙って無視せず「公開されていない」と報告します（打ち間違いや、サーバーが消したツールに気づくため）。
- `__proto__` のような名前も、ただのキーとして扱います（プロトタイプを触りません）。
- ツールの説明文が CL-18 の形式を満たさなければ、そのツールは登録されず、理由が状態に出ます。外部サーバーの説明文は、設定の `descriptions` で上書きできます（CL-25。GitHub の既定の許可リストが使っています）。

### 注釈とリスク区分

すべてのツールに、リスク区分（`read-only` / `write` / `destructive`）を付けます（Req 1.16）。自作のツールは `defineAciTool` の必須の引数で宣言します。MCP のツールは、サーバーが付ける注釈から決めます（`riskFromAnnotations`、`mcp/risk.ts`、ADR-7）。

| 注釈の状態 | リスク区分 |
|---|---|
| `readOnlyHint: true` だけ | `read-only` |
| 注釈なし、形が不正、`readOnlyHint: false` | `destructive` |
| `destructiveHint: true`（`readOnlyHint: true` を併記していても） | `destructive` |

注釈は**サーバーが自分について言うヒント**で、信頼の境界の外にあります。そのため、明示的な `readOnlyHint: true` だけを `read-only` と認め、それ以外（欠落、型違い、矛盾を含む）は、安全側の `destructive` にします。自分のオブジェクトのプロパティだけを読み、継承された `readOnlyHint` は信じません。自作サーバーの `writeFile` と `deleteFile` は、`readOnlyHint: false` を付けて公開します。

### 致命的エラーのラッチ

AI SDK のツールループは、ツールの例外を `tool-error` に変えて**続行**します。認証失敗や許可されない操作のように、再試行しても直らないエラーで run を止めるには、例外では足りません（ADR-5、Req 1.3）。

- `FatalToolError`（`aci/fatal.ts`）は、閉じた語彙の `code`（`auth-failed`、`config-missing`、`not-allowed`、`attempt-limit`、`sandbox-unavailable`）と、学習者向けの文言を持ちます。
- `FatalLatch` は、1回の run が持つ「最初の致命的エラーを覚える」入れ物です。2件目以降は無視し、run ごとに1つ作ります。
- `buildToolSet` は、ラッチが立った後は**ツール本体を実行しません**。同じステップで同時に始まる呼び出しも、ラッチがあるときは1件ずつ実行して、後続を拒否します（並行性を手放す代わりに）。
- `createGuardedAgent` は、`stopWhen` に「ラッチが立っているか」だけを読む条件を足します。止まった run は、停止理由 `error` と学習者向けの文言を返します。

ラッチと同時に内部で abort する案は採りませんでした。spike S-1 で、`stream` と UI ストリームが `abort` で終わり、`finish` と `onEnd` が来ない（`run` サマリを載せる経路が使えなくなる）ことが分かったためです。`stopWhen` で止めると、`generate`、`stream`、UI ストリームのどれも正常終了の経路を通ります。

MCP のツールの失敗は、`adaptMcpTool` が同じ形に変えます。自作サーバーの「ルート外」は `not-allowed` のラッチになり、HTTP 401 / 403 は `auth-failed` になります。外部サーバーの文言は学習者向けの文言に取り込まず、設定で決めた固定の文言を使います。

### 書き込み系ツールを登録しない理由

自作サーバーは `writeFile` と `deleteFile` も**公開します**が、エージェントには登録しません（Req 1.17）。理由は、書き込みと破壊的な操作に対する承認ゲート（HITL）が、マイルストーン4（004 Req 4）で初めて実装されるからです。承認の無い状態で、モデルがファイルを書き換えたり消したりできる経路を作らない、という判断です。M3 のハンズオンとテストは、読み取り専用のツールだけで完結します。

実装では、3つの層が重なります。

1. **許可リスト**: `filesServerConfig` の許可リストに、読み取りの4ツールだけを入れる（`writeFile` / `deleteFile` は無い）。
2. **リスク区分**: 許可リストに入っても、`read-only` でないツールは登録しない。注釈の無い外部ツールも `destructive` なので登録されない。
3. **状態の説明**: 登録しなかったツールは、`registered: false` と理由を、`/api/mcp/servers` と `/mcp` の画面に出す。

`writeFile` と `deleteFile` の実装とテスト（`files/tools.test.ts`）は残してあり、004 で承認ゲートと一緒に有効にする想定です。

## ハンズオン手順

### 手順 1: 自作サーバーのツールを `mock` で動かす

- 実行モード: `mock`（完走する）
- 外部サービス: なし

```text
mise run dev          # http://localhost:3000/mcp を開く
```

`files` サーバーが接続済みで、読み込まれたツールが `findAndReadFiles`、`listFiles`、`readFile`、`searchFiles` の4つであること、`writeFile`（`destructive`）が「登録されない」と理由つきで表示されることを確かめます。許可ルートは `MCP_FS_ROOT`（既定は `workspace/`）です。許可ルートの外のパスを読ませる例を実行すると、run が停止理由 `error` で止まり、ツールが再び呼ばれないことを確かめます。

### 手順 2: 説明文と修正ガイドを自分のツールで確かめる

- 実行モード: `mock`
- 外部サービス: なし

`packages/ai-core/src/aci/tools/calculator.ts` を読み、説明文の3つの見出しと、入力項目の `.describe()` を確認します。見出しを1つ消して `mise run test` を実行し、`defineAciTool` が何が足りないかを示して拒否することを確かめます。続いて、不正な入力（`expression` に数値を渡すなど）のテストを書き、ツール本体が呼ばれずに、修正ガイドが返ることを確かめます。

### 手順 3: 高水準ツールと低レベルの組み合わせを実モデルで比べる

- 実行モード: `local`（既定）または `live`
- 外部サービス: `local` は Ollama の起動と、`catalog: local.ollama.chat` のモデルの取得（ツール呼び出しに対応していること）。`live` は選んだプロバイダの API キー

```text
mise run dev          # /mcp の比較画面で、同じタスクを2つの方式で実行する
```

手順数とトークン数を読み、上の表の観察と比べます。モデルもタスクも違うので、数値はそのまま比べられません。自分の比で、高水準ツールを作る費用が見合うかを判断してください。ブラウザを使わずに確かめるなら、`*.local.test.ts` の1つ（チェックリストを参照）が、Ollama に接続できるときだけ同じ比較を実行します。

### 手順 4: GitHub の MCP サーバーへ接続する（任意）

- 実行モード: `live`（GitHub への接続のみ。モデルは `local` でも可）
- 外部サービス: 環境変数 `GITHUB_TOKEN`（読み取り専用の権限のトークン。任意）。無ければこの手順は飛ばせます

`.env.local` に `GITHUB_TOKEN` を設定して `mise run dev` を実行し、`/mcp` に `github` サーバーが現れること、**許可リストのツールのうち何件が登録されたか**を読みます。0 件でも不具合ではありません。GitHub のホスト型サーバーのツールに `readOnlyHint` が付いていなければ、ADR-7 により登録されないためです（次の「確認できていないこと」を参照）。トークンの値を、画面、ログ、コミットに載せないでください。

### 手順 5: サーバーの切断を観察する

- 実行モード: `mock`
- 外部サービス: なし

`packages/ai-core/src/mcp/connect.test.ts` の切断のテストを読み、サーバーが実行中に切断されたとき、そのサーバーのツールが利用不可になり、サーバー名と原因がモデルに伝えられることを確かめます。`mise run test` で通ることも確かめます。

## 習熟度判定チェックリスト

自動テストで確かめられる項目には、テストへの参照を付けます。`*.local.test.ts` の項目は、Ollama に接続できないときはスキップされます（「実行された」ことの証拠にはなりません）。

- [ ] 説明文に、足りない見出しがあれば、すべてまとめて報告される <!-- test: packages/ai-core/src/aci/description-check.test.ts#reports every missing heading at once -->
- [ ] 見出しや入力項目の説明が足りないツールは、`defineAciTool` が名前を示して拒否する <!-- test: packages/ai-core/src/aci/define-tool.test.ts#rejects a description without the three heading lines and names what is missing -->
- [ ] 入力が不正なとき、ツール本体を実行せず、修正ガイドをモデルに返す <!-- test: packages/ai-core/src/aci/define-tool.test.ts#does not run the tool body for an invalid input and shows the model a fix guide -->
- [ ] 修正ガイドは、スキーマから作った正しい入力例で終わる <!-- test: packages/ai-core/src/aci/input-guide.test.ts#ends with a valid example input built from the schema -->
- [ ] 受け取った値を修正ガイドに再掲しない <!-- test: packages/ai-core/src/aci/input-guide.test.ts#does not echo the received values (they may be private) -->
- [ ] `concise` は上限を超えた分を切り詰め、全文の取り方を案内する <!-- test: packages/ai-core/src/aci/response-format.test.ts#truncates concise text one character over the limit and appends the hint -->
- [ ] `detailed` は、どれだけ長くても切り詰めない <!-- test: packages/ai-core/src/aci/response-format.test.ts#does not truncate detailed text, however long -->
- [ ] モデルに見せる割り当てに UUID や項目の ID が入らない <!-- test: packages/ai-core/src/aci/short-id.test.ts#never puts a UUID or an item id in the assignment shown to the model -->
- [ ] 思考ツールは、考えを保存も返却もせず、受け取ったことだけを返す <!-- test: packages/ai-core/src/aci/think-tool.test.ts#acknowledges the call without echoing or storing the thought -->
- [ ] 思考ツールは、無効にするとツール一覧から外れる <!-- test: packages/ai-core/src/aci/think-tool.test.ts#returns undefined when disabled -->
- [ ] 高水準ツールは、一覧と読み取りを1回の呼び出しで行う <!-- test: packages/ai-core/src/files/tools.test.ts#lists and reads the matching files in one call -->
- [ ] 高水準と低レベルのステップ数・トークン数の差と、トークン比を計算できる <!-- test: packages/ai-core/src/aci/high-level-compare.test.ts#returns how many steps and tokens the high-level tool saved, and the token ratio -->
- [ ] ルートと接頭辞だけが同じ別ディレクトリを拒否する <!-- test: packages/ai-core/src/files/path.test.ts#rejects a sibling directory that shares the root's prefix -->
- [ ] 許可ルートの外を指すシンボリックリンクを拒否する <!-- test: packages/ai-core/src/files/path.test.ts#rejects a symbolic link that points to a directory outside the root -->
- [ ] 自作サーバーは、6つのツールを、どれが無人で動いてはいけないかを示す注釈つきで公開する <!-- test: packages/ai-core/src/files/server.test.ts#lists the six tools with annotations that say which ones may not run unattended -->
- [ ] 自作サーバーを、現在の Node で子プロセスとして起動し、ファイルを読める <!-- test: packages/ai-core/src/mcp/connect.test.ts#starts `files/stdio.ts` with the current Node and reads a file through it -->
- [ ] 許可リストにあるツールだけが、クライアントにロードされる <!-- test: packages/ai-core/src/mcp/allow-list.test.ts#makes the client load only the allowed tools, and never the others -->
- [ ] 注釈の無いツールは `destructive` として扱う <!-- test: packages/ai-core/src/mcp/risk.test.ts#treats a tool without annotations as destructive -->
- [ ] `readOnlyHint` が厳密に `true` のときだけ `read-only` と認める <!-- test: packages/ai-core/src/mcp/risk.test.ts#is read-only only when readOnlyHint is exactly true -->
- [ ] 書き込み系・破壊的・注釈なしのツールは登録されず、理由が示される <!-- test: packages/ai-core/src/mcp/connect.test.ts#keeps write, destructive and unannotated tools out and says why -->
- [ ] 自作サーバーから読み取りの4ツールだけをロードし、書き込み・削除のツールはロードしない <!-- test: packages/ai-core/src/mcp/connect.test.ts#loads the four read-only tools and none of the write or delete tools -->
- [ ] 21個のツールの構成は、一部だけロードせず、組み立ての時点で拒否される <!-- test: packages/ai-core/src/mcp/connect.test.ts#refuses a configuration of 21 tools when the registry is built, instead of loading some of them -->
- [ ] 実行中に切断されたサーバーのツールは落とされ、サーバー名と原因がモデルに伝わる <!-- test: packages/ai-core/src/mcp/connect.test.ts#tells the model the server's name and cause, marks the server unavailable and drops its tools -->
- [ ] ルート外のパスは、致命的エラーとしてラッチを立て、学習者向けの文言はルートから作る <!-- test: packages/ai-core/src/mcp/connect.test.ts#trips the latch for a path outside the root, with the learner's message built from the root -->
- [ ] ラッチが立った後は、どのツールの本体も実行されない <!-- test: packages/ai-core/src/aci/tool-set.test.ts#does not run any tool after the latch is tripped, and says why -->
- [ ] 致命的エラーのステップの後で `generate()` が止まり、停止理由 `error` を返す <!-- test: packages/ai-core/src/agents/guarded-agent.test.ts#stops generate() after the step with the fatal error and reports stop reason error -->
- [ ] MCP のツールを使う run が、許可ルート外を読んだ後、次のステップに進まず停止理由 `error` で止まる <!-- test: packages/eval-suite/tests/regression/mcp-fatal-stop.test.ts#stops with reason error after reading a path outside the allowed root, so the next step never runs -->
- [ ] `GITHUB_TOKEN` が無い、空、空白のときは、GitHub の設定を作らない <!-- test: packages/ai-core/src/mcp/github.test.ts#returns token-missing when GITHUB_TOKEN is not set, empty or blank -->
- [ ] GitHub の許可リストは読み取り専用のツールだけである <!-- test: packages/ai-core/src/mcp/github.test.ts#allows only read-only tools (Req 1.17) -->
- [ ] ローカルモデルで、`findAndReadFiles` と `searchFiles` + `readFile` のステップ数とトークン数を観察できる（Ollama に接続できないときはスキップされる） <!-- test: packages/eval-suite/tests/capability/mcp-compare.local.test.ts#observes steps and tokens of findAndReadFiles versus searchFiles + readFile -->
- [ ] 自分のツールの説明文を、「使うとき」「使わないとき」に代わりのツール名を入れて書ける（手で確かめる）
- [ ] 高水準ツールが有利でない場面（例: 結果の大半を使わない）を挙げられる（手で確かめる）
- [ ] GitHub に接続して、登録されたツールの件数と、注釈の有無を自分の環境で確かめた（手で確かめる。`GITHUB_TOKEN` が要る）

## リファレンス実装とテストの所在

| 項目 | パス |
|---|---|
| ツール定義、説明文の検査 | `packages/ai-core/src/aci/define-tool.ts`、`aci/description-check.ts` |
| 修正ガイド | `packages/ai-core/src/aci/input-guide.ts` |
| `concise` / `detailed`、短い番号、思考ツール | `aci/response-format.ts`、`aci/short-id.ts`、`aci/think-tool.ts` |
| 致命的エラーとラッチ | `aci/fatal.ts`、`aci/tool-set.ts`、`packages/ai-core/src/agents/`（`stopWhen` への配線） |
| 高水準と低レベルの比較 | `aci/high-level-compare.ts`、`packages/ai-core/src/mcp/chat.ts` |
| 自作のファイル MCP サーバー | `packages/ai-core/src/files/`（`server.ts`、`stdio.ts`、`operations.ts`、`path.ts`、`tools.ts`） |
| MCP クライアント、許可リスト、リスク区分 | `packages/ai-core/src/mcp/`（`connect.ts`、`allow-list.ts`、`risk.ts`、`adapt.ts`） |
| GitHub と自作サーバーの設定 | `packages/ai-core/src/mcp/github.ts` |
| Route Handler、画面 | `apps/web/app/api/mcp/`（`chat`、`compare`、`servers`）、`apps/web/app/mcp/page.tsx`、`apps/web/components/mcp/` |
| `local` の観察、停止の回帰テスト | `packages/eval-suite/tests/capability/mcp-compare.local.test.ts`、`packages/eval-suite/tests/regression/mcp-fatal-stop.test.ts` |
| テスト | 各ファイルの隣の `.test.ts` |

## 本番ではどう作るか

本リポジトリの実装は学習用で、本番の判断と運用はハブ `vaz-agentic-ai-next` の手法ページにあります（文書の転載はしません。確認日 2026-10-29）。

- MCP: [`mcp.md`](https://github.com/Fukuchan77/vaz-agentic-ai-next/blob/main/docs/guide/mcp.md)

本リポジトリの MCP 連携は、1つのプロセスの中で、読み取り専用のツールだけを、許可リストで絞って登録します。サーバーの認可、複数ユーザーの資格情報の分離、書き込み系のツールを使うときの承認と監査は、扱いません（[005 Req 1.3](../../specs/005-hub-alignment/spec.md)）。

## 確認できていないこと

`mise run gate` が通っても、次のことは保証されません。

- **GitHub のホスト型 MCP サーバーの注釈（S-6）は、一度も測っていません。** 許可リストの5つのツール（`get_file_contents`、`issue_read`、`list_issues`、`pull_request_read`、`search_issues`）に `readOnlyHint: true` が付いているかは、GitHub の文書にも見つからず、`GITHUB_TOKEN` を使った `tools/list` の実測もありません。付いていなければ、ADR-7 によりどれも登録されず、「接続できるが何も登録されない」状態になります。ツール名、入力の名前、認証ヘッダの形式も、文書に基づく想定で、実機では確かめていません。
- **GitHub への実接続は gate の外です。** `mock` は GitHub に接続しません。gate が確かめるのは、設定の形、許可リスト、トークンの扱い、説明文の上書きまでです。
- **高水準と低レベルの比較は、小さなローカルモデル1種類、1つのタスク、各3回の観察です。** 他のモデル、他のタスク、分散は見ていません。`mock` の手順数は固定値で、比較になりません。
- **`*.local.test.ts` は、Ollama に接続できない環境ではスキップされます。** gate が通っても、実モデルの挙動は確かめられていません。
- **`next dev`（Turbopack の開発モード）で同じ流れを通したか**は、実測していません。実サーバーの確認は `next build` と `next start` で行いました。
- **モデルがツールの説明文の「使わないとき」に従う保証はありません。** 説明文の形式はコードで検査しますが、内容がモデルの選択を良くするかは、評価で確かめる必要があります。
- **外部サーバーの説明文と注釈は、信頼できない入力です。** 本リポジトリは、形式の検査、許可リスト、注釈の安全側の扱いで対処しますが、悪意のあるサーバーに対する十分性は主張しません。

## 元教材との対照表

| 元教材（Python / LangChain / LangGraph）の対応箇所 | TypeScript / AI SDK 版での置き換え | 移植で諦めたもの |
|---|---|---|
| 第2章 ツール呼び出しの構成要素、コラムの MCP | `defineAciTool`（Zod の入力スキーマ、必須のリスク区分）。MCP は本編に昇格し、公式 SDK で自作 | LangChain の `Tool` / `StructuredTool` の継承階層 |
| 第3章 Function Calling、LangChain のツール定義 | AI SDK v7 の `tool` と `inputSchema`（Zod）。入力の検証失敗は修正ガイドで返す | Pydantic のモデルによる検証、`ToolException` の自動処理 |
| ツールプロトコル（LangChain Tool） | MCP（公式 SDK のサーバー + `@ai-sdk/mcp` のクライアント） | LangChain の MCP アダプタ |
| 既製の MCP サーバー（Filesystem、GitHub、Brave Search 等）と Claude Desktop | ファイルのサーバーは自作して stdio で接続。GitHub はトークンがあるときだけ接続 | Claude Desktop や、Brave Search 等の既製サーバーとの接続 |
| ACI 工学（Anthropic のガイダンス。3原則、ポカヨケ、行動を促すエラー） | 説明文の形式の検査、修正ガイド、`concise` / `detailed`、短い番号、思考ツール、高水準ツール | 説明文の良し悪しの自動評価（モジュール 4-3 の評価で扱う） |
| ツールのエラー処理（例外を捕まえて続行） | 回復可能と致命的の2分類。致命的は Run 単位のラッチと `stopWhen` で停止理由 `error` | LangGraph の例外ハンドラ、条件付きエッジによる中断 |

## 移植時の変更点

[changes-from-drafts.md](../../specs/curriculum/changes-from-drafts.md) に記録された変更のうち、このモジュールに関わるものと、実装時に確定したことです（Req 7.4）。採用したモデルはモデル ID ではなくカタログへの参照で示します（`local` なら `catalog: local.ollama.chat`）。

- **M1 の6ツールの説明文を書き直しました。** CL-18 の形式（用途、使うとき、使わないとき、例）に改め、入力項目の `.describe()` を足しました。**この書き直しは、ツールを含むリクエストのカセットのキーを変えます**（W1 のレビュー F-14）。「カセットのキーが変わらない」のは入力スキーマについてだけです。M1・M2 で記録した、ツール定義を含む `local` のカセットがあれば、**再記録が必要**です。現在 `fixtures/cassettes/llm/` は空で、既存のシナリオはキーではなく述語で照合するため、gate には影響しません。
- **MCP は本編に昇格しました。** 元教材ではコラムでした。ファイルのサーバーは公式 SDK で自作し、GitHub はトークンがあるときだけ接続します。Claude Desktop や既製の複数サーバーとの接続は扱いません。
- **入力の検証失敗の文言を差し替えました（CL-2）。** `inputSchema` を `jsonSchema(() => zodSchema(schema).jsonSchema, { validate })` で包みます。生の `z.toJSONSchema` は `io: "input"` などの補正が無く、モデルに送る JSON Schema とカセットのキーが変わるため、AI SDK 自身の変換を使います。
- **致命的エラーは `stopWhen` で止めます（S-1）。** 内部の abort は採りません。`stream` と UI ストリームが `abort` で終わり、`finish` が来なくなるためです。
- **ラッチのあるときだけ、ツールを1件ずつ実行します。** AI SDK のループは、同じステップの残りのツール呼び出しを止めません。
- **注釈が無い MCP ツールは `destructive` として登録しません（ADR-7）。** 注釈はサーバーのヒントで、信頼の境界の外にあります。
- **`serverExternalPackages` に足したパッケージはありません。** `@ai-sdk/mcp` と `@modelcontextprotocol/server` は Turbopack のバンドルのまま、ビルドと実行が通りました。一方、最初のビルドは、`new URL("../files/stdio.ts", import.meta.url)` が「ファイル資産の参照」と扱われて失敗し、`resolve(dirname(fileURLToPath(import.meta.url)), …)` の形に直しました。Vitest はバンドラーを通らないため、単体テストでは検出できず、実サーバーのビルドだけが見つけました。
- **自作サーバーは `.ts` 拡張子付きの import を使います。** Node の型除去で起動するためです（`tsconfig.base.json` の `allowImportingTsExtensions`）。

## 完成時点のタグ

- **タグ**: `module/3-1`
- **含まれるもの**: `aci/` の説明文の検査、修正ガイド、`concise` / `detailed`、短い番号、思考ツール、致命的エラーのラッチ、高水準と低レベルの比較、`files/` の自作 MCP サーバー、`mcp/` のクライアント・許可リスト・リスク区分・GitHub の設定、`/api/mcp/*` と `/mcp` 画面、E2E テスト（`apps/web/e2e/mcp.spec.ts`、3 エンジン）、この解説
- **含まれないもの**: 書き込み系・破壊的なツールのエージェントへの登録（004 の承認ゲートの後）、GitHub の実機での確認、後続のドメインエージェント（3-2〜3-6）
