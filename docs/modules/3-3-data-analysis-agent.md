# 3-3 データ分析エージェント

- **フェーズ**: Phase 3 現場実践編。IBM 成熟度モデルの Level 2（AI Agents）の水準で、LLM が書いたコードを隔離環境で実行し、失敗を自分で直して図表を返すエージェントを作ります
- **要件**: [spec 003](../../specs/003-domain-agents/spec.md) の Requirement 3（3.1〜3.5、3.7〜3.9）。解説の必須事項として 001 の Requirement 7.2〜7.6、7.9
- **実装**: `packages/ai-core/src/sandbox/`、`packages/ai-core/src/analysis/`、`docker/sandbox/`、`apps/web/app/api/analysis/`、`apps/web/components/analysis/`、`apps/web/app/analysis/`

## 学習目標

このモジュールを終えると、次のことができます。

- LLM が生成したコードをホストで実行してはならない理由を述べ、E2B のクラウドサンドボックスとローカルの Docker コンテナのどちらで動かすかが、環境変数と Docker の状態で決まる順序を説明できる。
- アップロードされたファイルを、サンドボックスを起動する前に拡張子・サイズ・先頭バイトで拒否する検査を、ホストで解析せずに書ける。
- 「初回の実行 + 修正 3 回 = 最大 4 回の実行」という修正ループの数え方を説明し、上限に達したときに最後のコード・エラー・試行履歴が残ることをテストで確かめられる。
- サンドボックスの標準出力に出した目印の行から、図（PNG）と表を取り出して UI へ渡す仕組みを説明できる。
- アイドル破棄の仕組みを説明し、この教材のサンドボックスが「何を保証せず、何を確かめていないか」を具体的に挙げられる。

## 主要トピック

扱う概念は次の6つです。

1. サンドボックスの選択順（E2B、Docker、無効）
2. 隔離の制限
3. アップロードの検査
4. 修正ループ（最大 3 回の修正）
5. 図表の受け渡し（目印の行）
6. アイドル破棄

### サンドボックスの選択順（E2B、Docker、無効）

分析エージェントは、モデルが書いた Python を `runPython` ツールで実行します。このコードは Web アプリのサーバープロセスや学習者のファイルシステムでは**実行しません**（Req 3.2、憲章の「LLM が生成したコードはサンドボックスでのみ実行する」）。実行先は `SandboxProvider`（`ports/sandbox`）の3つの実装のうち1つです。

| 実装 | 使う条件 | 実行の単位 |
|---|---|---|
| E2B（`sandbox/e2b.ts`） | `E2B_API_KEY` が空でない | 分析セッションごとのクラウドのサンドボックス |
| Docker（`sandbox/docker/`） | キーが無く、Docker Engine に接続でき、画像（既定 `agentic-ai-sandbox:local`）がある | 実行ごとに作って消す使い捨てのコンテナ |
| 無効 | どちらも使えない | 分析エージェントを無効として表示し、設定の手順を案内する |

選択は純関数 `selectSandboxProvider` が1か所で行います（ADR-6、Req 3.8）。**E2B のキーを先に見る**ので、キーがあれば Docker が使える環境でも E2B が選ばれます。キーが空白だけのときは未設定として扱います。Docker に接続できても画像が無ければ、無効の理由に画像名と `mise run sandbox:build` を出します。選択の結果にキーの値は含まれません。`mock` モードでは疑似サンドボックス（`sandbox/mock.ts`）が使われ、定義済みの標準出力・エラー出力・図表の目印の行を返します（Req 3.10）。

ホストのコードは `child_process` を import せず、Docker は Docker Engine API を `node:http` の `socketPath` で直接呼びます（ADR-4）。`dockerode` は採用していません。

### 隔離の制限

Docker のコンテナは、実行ごとに次の設定で作ります（`sandbox/docker/provider.ts`）。

- `NetworkMode: "none"`（接続も名前解決もできない）、`ReadonlyRootfs`、`CapDrop: ["ALL"]`、`no-new-privileges`、非 root のユーザー
- メモリ 512 MiB（スワップなし）、CPU 1、プロセス数 128、`/tmp` は tmpfs（64 MiB、`noexec`）
- 実行時間は 60 秒。超えるとコンテナを強制削除する

W4 の実測（Rancher Desktop の Docker Engine 29.5.3）で、ネットワークが使えないこと、ルートが読み取り専用で `/tmp` だけ書けること、権限が落ちていること、プロセス数とメモリの上限、タイムアウトでの削除、実行後にコンテナとボリュームが残らないことを、実コンテナの中から観測しました（`mise run test:container`）。plan の想定と違い、読み取り専用ルートのコンテナへ入力を置くには `/work` を**匿名ボリューム**にして、**起動前に** archive で置く必要がありました。

隔離には限界があります。**ここで書いたことは「確認できていないこと」の節と合わせて読んでください。**

- Docker のコンテナはホストのカーネルを共有します。コンテナの設定が正しくても、カーネルやランタイムの脆弱性による脱出は防げません。信頼できないコードの本格的な隔離が要る本番では、マイクロ VM などの別の層を検討します。
- E2B はクラウド側の隔離で、ホストとは分離されますが、**外向き通信の既定が許可**です（文書による。下の「確認できていないこと」）。
- 実行時間・メモリ・出力の上限は暴走を止めるためのもので、悪意のあるコードを防ぐ保証ではありません。

### アップロードの検査

`checkUpload`（`analysis/upload-check.ts`）は、**サンドボックスを起動する前に**、ファイルが CSV か Excel かを純関数で判定します（Req 3.9）。拒否理由は `extension`、`size`、`empty`、`magic`、`encoding` の閉じた集合です。

- 拡張子は `.csv`、`.xlsx`、`.xls`（大文字小文字は区別しない。語幹の無い `.csv` は拒否）。拡張子を最初に調べます。
- サイズ上限は 20 MiB（既定）。実際のバイト数と、クライアントが申告した `Content-Length` の**大きいほう**で判定します。ぴったり上限は受け入れ、1 バイト超えると拒否します。
- 内容が拡張子と合っているかを、先頭バイトで調べます。`.xlsx` は zip の署名を持ち、中央ディレクトリを**展開せずに一覧だけ読んで** `xl/workbook.xml` があること。`.xls` は OLE2 の署名を持ち、"Workbook" か "Book" のストリーム名があること。`.csv` は PNG・JPEG・GIF・PDF・zip・OLE2 の署名で始まらず、NUL バイトを含まず、UTF-8 として正しいこと（Shift_JIS や UTF-16 は拒否）。

ホストはファイルを**解析しません**（ADR-1）。zip と XML の展開攻撃、ReDoS、prototype pollution を長寿命のサーバーに持ち込まないため、生のバイトをそのままサンドボックスへ渡し、pandas / openpyxl（`.xls` は xlrd）による解析もサンドボックスの中で行います。ファイル名はモデルへ渡さず、種類から決めた固定名（`data.csv`、`data.xlsx` など）でサンドボックスに置きます。

### 修正ループ（最大 3 回の修正）

`runPython` が失敗すると、エラー出力（標準エラーの末尾 8,000 文字まで）がツール結果としてモデルへ戻り、モデルが直したコードで再実行します（Req 3.3）。**修正の数え方は CL-26 で確定しています**（2026-10-19 に人が確認）。

- 「修正」は、失敗した実行の**次の実行**です。
- 1 回の失敗に対する修正は `maxFixAttempts`（既定 3）回までです。したがって**初回の実行 + 修正 3 回 = 最大 4 回の実行**です。通算 4 回目（3 回目の修正）が失敗した時点で `attempt-limit` として止め、5 回目の実行は求めません。
- 数えるのは**失敗ごと**です。成功した実行で失敗は終わり、その後の新しい失敗には改めて 3 回の修正があります。分析全体の長さは、エージェントのステップ上限（既定 12）が抑えます。

上限に達すると実行を止め、**最後のコード、エラー内容、すべての試行の履歴**を画面に出します（Req 3.4）。試行ごとのコード・標準出力・エラー出力・その時点の修正回数は、成功したときも見られます（Req 3.6）。タイムアウトは「コードの誤り」として扱い、モデルが速いコードに直せるようにします。一方、サンドボックス自体が使えなくなったとき（`provider-unavailable`）は修正できないので、致命的エラーとして1回のモデル呼び出しのうちに止め、`sandbox-unavailable` を返します。結果の `status` は、最後の実行が成功したときだけ `succeeded` です。失敗の後で修正せずに答えただけなら `incomplete` になり、成功とは数えません。

### 図表の受け渡し（目印の行）

サンドボックスの中のコードは、事前に置かれた補助関数 `show_figure(alt)` と `show_table(df, caption)` を呼びます（`analysis/prelude.ts`、CL-19）。この2つは標準出力へ**目印付きの1行**を書くだけです。

```text
__PNG__:{"alt":"月別売上の折れ線","base64":"iVBORw0..."}
__TABLE__:{"caption":"月別の合計","columns":["month","total"],"rows":[["2026-01",1200]],...}
```

ホストは `parseSandboxOutput`（`analysis/output-parser.ts`）で、行の先頭が目印の行だけを取り出し、画面に出す標準出力から除きます。サンドボックスは信頼できないので、目印の行は人が打ち込んだものとして検査します。

- 図は PNG のマジックバイトを持つこと、デコード後 1 MiB 以下、`alt`（代替テキスト）が 1〜200 文字であること。SVG と HTML は描画せず、普通のテキストとして残します（ADR-2）。
- 表は列数・行数（200 行まで）・セルの長さに上限があり、超えた行は落として実際の行数（`totalRows`）を保ちます。NaN と無限大は `null` にします。
- 1 回の実行で保つ図と表は、それぞれ 10 個までです。

E2B の `results[].png` は使いません。E2B と Docker で経路を分けず、どちらでも同じ目印の行を使うので、疑似サンドボックスでも同じ経路をテストできます。UI は、図を `<img>`（`alt` 必須）、表を素の `<table>` で描画します（グラフの対話操作は扱いません。必要になったら `recharts` を足します）。

### アイドル破棄

サンドボックスは**分析セッションごと**に1つ作り、`SandboxRegistry`（`sandbox/lifecycle.ts`）が寿命を管理します（Req 3.7）。

- 同じセッションの要求は直列に処理し、同時の要求が2つのサンドボックスを作る競合を防ぎます。
- アイドル判定は `Clock` を使います（テストでは偽の時計）。最後の操作から 10 分（既定。ちょうど 10 分は残し、1 ミリ秒超えると破棄）続いたセッションを `sweep` が閉じます。**実行中（lease が開いている）のセッションは、どれだけ長くても閉じません。**
- 学習者の明示的な終了操作（`DELETE /api/analysis/sessions/[id]`）でも閉じます。クライアントとの接続が途絶えたときは、Route Handler の `request.signal` の abort でサンドボックスを閉じ、追加のコードを実行しません。
- 同時に生きるサンドボックスは 8 個まで。超える新しいセッションは、最も長く使われていないアイドルのものを追い出し、全部が使用中なら断ります。
- サンドボックスが期限切れで消えていたら、一度だけ作り直し、そのことを画面に出します。E2B 側の寿命は、リークの安全網として、アイドル時間の3倍を渡します。

## ハンズオン手順

### 手順 1: `mock` でキーも Docker もなく通しで動かす

- 実行モード: `mock`
- 外部サービス: なし

```text
mise run dev          # http://localhost:3000/analysis を開く
```

画面の状態表示が「疑似サンドボックス」になっていることを確かめ、サンプルの CSV（`packages/ai-core/fixtures/analysis/sales.csv`）と指示で分析を実行します。試行（コード・標準出力）、`alt` 付きの図、表、説明が並びます。`mock` のシナリオ（`fixed`、`attempt-limit`）は、1 回目の失敗の後で修正が成功して**2 つの試行が見える**こと、**4 回の実行（初回 + 修正 3 回）の後に止まり**最後のコードとエラーが残ることを示します。画面からこれらのシナリオを選ぶ操作は、この解説では確認していません。同じ流れは `apps/web/e2e/analysis.spec.ts` が検査します。

### 手順 2: Docker のサンドボックスと `local` のモデルで修正ループを見る

- 実行モード: `local`（`AI_RUN_MODE=local`）
- 外部サービス: Ollama（`catalog: local.ollama.chat` のモデルの取得）と Docker。`E2B_API_KEY` は設定しない

```text
mise run sandbox:build         # 画像 agentic-ai-sandbox:local を作る（Docker とネットワークが要る）
mise run dev                   # /analysis の状態表示が「ローカルの Docker コンテナ」になる
```

Rancher Desktop の Docker は、ソケットが `~/.rd/docker.sock` にあり、探索先に含まれません。この場合は `DOCKER_HOST=unix://$HOME/.rd/docker.sock` を設定してから実行します（Docker Desktop や Linux のネイティブでの確認は、まだ人が行っていません）。画像が無いと、状態表示は無効になり、`mise run sandbox:build` を案内します。

存在しない列を読むような誤りを含む指示を送り、エラーが出て、モデルが直し、再実行される様子を試行の一覧で観察します。

### 手順 3: E2B のサンドボックスを使う（任意）

- 実行モード: `live` または `local`（モデルは自由。サンドボックスだけ E2B）
- 外部サービス: `E2B_API_KEY`（任意。キーが無ければ手順 2 の Docker に落ちる）

`.env.local` に `E2B_API_KEY` を設定して `mise run dev` を再起動すると、状態表示が「E2B のクラウドサンドボックス」になります。**この手順は、本リポジトリでまだ一度も実機で実行していません**（キーが無い）。実行したら、外向き通信が通るか（例: 外部の URL へ `urllib` で接続するコードを実行する）も確かめ、結果を `research.md` の S-4 に追記してください。

### 手順 4: コンテナのテストと `local` の評価を実行する

- 実行モード: `mock`（テストの既定）。`local` の評価は Ollama と Docker が要る
- 外部サービス: Docker（`test:container`）。`analysis-fix.local.test.ts` は Ollama と Docker の両方を要しますが、両方を許すレーンがまだ無く、現状はどのレーンでも実行されず、理由付きでスキップされます

```text
mise run test:container   # 実コンテナの隔離テスト。Docker に接続できなければ理由付きでスキップ
mise run test:local       # analysis-fix.local.test.ts を含むが、現状は必ずスキップされる（local のネットワーク制限が Docker のソケットを意図的に塞ぐため）
```

`DOCKER_HOST` の設定が要る環境では、同じ変数を付けて実行します。`analysis-fix.local.test.ts` の実行には、Ollama と Docker の両方を許すレーンが要ります。eval-suite にはコンテナのレーンが無く、レーンを足すかどうかは M4 で扱います（2026-10-29 に、今は足さないと決めました）。スキップされたテストは「通った」ではなく「確かめていない」と読んでください。

## 習熟度判定チェックリスト

自動テストの参照が付いた項目のうち、`*.container.test.ts` と `*.local.test.ts` を指す項目は、**Docker や Ollama が使えない環境ではスキップされることがあります**。スキップは合格を意味しません。

- [ ] キーがあれば E2B を、Docker が使えても優先する <!-- test: packages/ai-core/src/sandbox/select.test.ts#prefers E2B when a key is set, even if the container is ready -->
- [ ] キーも Docker も無いと、理由と設定の案内を持つ「無効」になる <!-- test: packages/ai-core/src/sandbox/select.test.ts#is disabled with a reason and guidance when there is neither a key nor a container -->
- [ ] アップロードは上限ぴったりを受け入れ、1 バイト超えを拒否する <!-- test: packages/ai-core/src/analysis/upload-check.test.ts#accepts exactly the limit and rejects one byte more -->
- [ ] 拡張子が `.csv` でも、中身が PNG・Excel・PDF なら拒否する <!-- test: packages/ai-core/src/analysis/upload-check.test.ts#rejects a .csv that is really a PNG, a workbook or a PDF -->
- [ ] 修正の数え方: 初回 + 修正 3 回で止まり、4 回目の修正は実行されない <!-- test: packages/ai-core/src/analysis/attempts.test.ts#allows the initial run and three fixes, then stops: the fourth fix never runs -->
- [ ] `runPython` は 4 回実行して止まり、5 回目は実行しない <!-- test: packages/ai-core/src/analysis/run-python-tool.test.ts#runs the code four times (the first run and three fixes), then stops the run without a fifth -->
- [ ] 上限に達した実行は、最後のコードとエラーとすべての試行を残す <!-- test: packages/ai-core/src/analysis/run-python-tool.test.ts#keeps every attempt for the learner, with the last code and its error -->
- [ ] `mock` のサンドボックスで、成功の経路が通る <!-- test: packages/ai-core/src/analysis/scenarios.test.ts#success: one run, a figure and a table, and an explanation -->
- [ ] `mock` のサンドボックスで、修正の経路（最初の実行が失敗し、修正が成功する）が通る <!-- test: packages/ai-core/src/analysis/scenarios.test.ts#fixed: the first run fails, the fix succeeds, and the learner sees both -->
- [ ] `mock` のサンドボックスで、上限到達の経路が通る <!-- test: packages/ai-core/src/analysis/scenarios.test.ts#attempt-limit: four failed runs (the first and three fixes), then the run is stopped -->
- [ ] `runPython` のリスク区分は `read-only` で、作用はサンドボックスの中だけ <!-- test: packages/ai-core/src/analysis/run-python-tool.test.ts#is the read-only runPython tool, whose only effect is inside the sandbox -->
- [ ] 目印の行から PNG を取り出し、その行を標準出力から除く <!-- test: packages/ai-core/src/analysis/output-parser.test.ts#extracts a PNG and removes its line from the text -->
- [ ] PNG でない画像（SVG・HTML）は描画せず、理由を出す <!-- test: packages/ai-core/src/analysis/output-parser.test.ts#rejects an image that is not a PNG, including SVG and HTML, and says so -->
- [ ] アイドルがちょうど上限ならサンドボックスを残し、1 ミリ秒超えると閉じる <!-- test: packages/ai-core/src/sandbox/lifecycle.test.ts#keeps a sandbox idle for exactly the timeout, and closes it one millisecond later -->
- [ ] 実行中のセッションは、どれだけ長くても破棄しない <!-- test: packages/ai-core/src/sandbox/lifecycle.test.ts#never closes a session that is in use, however long the run takes -->
- [ ] 接続が切れたら、サンドボックスを閉じて以降のコードを実行しない <!-- test: apps/web/app/api/analysis/route.test.ts#closes the sandbox and runs no further code when the connection is lost -->
- [ ] E2B の作成時に、ネットワークの既定を変更しない（設定したときだけ `allowInternetAccess` を渡す） <!-- test: packages/ai-core/src/sandbox/e2b.test.ts#passes the key and the lifetime to the SDK and does not change its network default -->
- [ ] （`container` 専用。Docker が無ければスキップされる）コンテナの中からネットワークが使えない <!-- test: packages/ai-core/src/sandbox/docker/provider.container.test.ts#has no network: neither a connection nor a name lookup works -->
- [ ] （`local` 専用。**現状はどのレーンでも実行されず、理由付きでスキップされます**。ここでの合格は確認になりません）実モデルが誤ったコードを修正上限内で直す <!-- test: packages/eval-suite/tests/capability/analysis-fix.local.test.ts#repairs deliberately wrong code within the fix limit and finishes the run -->
- [ ] `E2B_API_KEY` を使った実機の分析と、外向き通信の確認（手で確かめる。この教材はまだ実行していない）
- [ ] 自分の環境の Docker（Docker Desktop、Linux のネイティブ）で `mise run test:container` を実行し、結果を記録する（手で確かめる）

## リファレンス実装とテストの所在

| 項目 | パス |
|---|---|
| サンドボックスのポート | `packages/ai-core/src/ports/sandbox.ts` |
| 提供者の選択（E2B、Docker、無効） | `packages/ai-core/src/sandbox/select.ts` |
| E2B の提供者 | `packages/ai-core/src/sandbox/e2b.ts` |
| Docker の提供者（Engine API、tar、多重化ストリーム） | `packages/ai-core/src/sandbox/docker/` |
| 疑似サンドボックス | `packages/ai-core/src/sandbox/mock.ts` |
| セッションとアイドル破棄 | `packages/ai-core/src/sandbox/lifecycle.ts` |
| Docker 画像の定義 | `docker/sandbox/` |
| アップロードの検査 | `packages/ai-core/src/analysis/upload-check.ts` |
| 試行の記録と修正回数 | `packages/ai-core/src/analysis/attempts.ts` |
| `runPython` ツール | `packages/ai-core/src/analysis/run-python-tool.ts` |
| 目印の行の投入と解析 | `packages/ai-core/src/analysis/prelude.ts`、`output-parser.ts` |
| 分析の実行 | `packages/ai-core/src/analysis/agent.ts` |
| Route Handler（分析、状態、セッション終了） | `apps/web/app/api/analysis/` |
| 画面 | `apps/web/app/analysis/`、`apps/web/components/analysis/` |
| ユニットテスト（gate） | `packages/ai-core/src/sandbox/*.test.ts`、`packages/ai-core/src/analysis/*.test.ts`、`apps/web/app/api/analysis/route.test.ts` |
| コンテナのテスト（`mise run test:container`） | `packages/ai-core/src/sandbox/docker/provider.container.test.ts` |
| `local` の評価 | `packages/eval-suite/tests/capability/analysis-fix.local.test.ts` |
| E2E | `apps/web/e2e/analysis.spec.ts` |

## 本番ではどう作るか

本リポジトリの実装は学習用で、本番の判断と運用はハブ `vaz-agentic-ai-next` の手法ページにあります（文書の転載はしません。確認日 2026-10-29）。

- AE（エージェンティックエンジニアリング）: [`agentic-engineering.md`](https://github.com/Fukuchan77/vaz-agentic-ai-next/blob/main/docs/guide/agentic-engineering.md)
- HE（ハーネスエンジニアリング）: [`harness-engineering.md`](https://github.com/Fukuchan77/vaz-agentic-ai-next/blob/main/docs/guide/harness-engineering.md)

本リポジトリのサンドボックスは、学習者のコンテナ内で完結し、承認待ちの保持、再開、本番の監査ログ保管を扱いません（[005 Req 1.3](../../specs/005-hub-alignment/spec.md)）。サンドボックスの外向き通信の制限とリスク区分の承認ゲートは、004 で再検討します（下の「確認できていないこと」）。

## 確認できていないこと

`mise run gate` は `mock` で動き、Docker も E2B も使いません。したがって、gate が緑でも次は**保証されていません**。

### E2B の外向き通信の既定（S-4。実測なし）

E2B の文書は「すべてのサンドボックスは、既定でインターネットへの外向き通信が可能」と述べています。`Sandbox.create({ allowInternetAccess: false })` で無効にできます（`e2b` パッケージの型に `allowInternetAccess` が存在することは、型定義を読んで確かめました）。**ただし `E2B_API_KEY` が無く、実機では一度も測っていません。** 文書の記述のまま、既定は許可だと読んでいます。リポジトリの E2B の提供者は、設定したときだけ `allowInternetAccess` を渡し、既定を変えません（テストで固定）。

これは `runPython` の設計に関わります。`runPython` は `risk: "read-only"` です（作用はサンドボックスの中だけ、という理由。CL-21）。しかし E2B の外向き通信が許可されていると、サンドボックスの中のコードが、アップロードされた学習者のデータを外部へ送れます。Docker は `NetworkMode: none` なので該当しません。

### 004 への引き継ぎ事項（CL-21）

- 004 Req 4（承認ゲート）で、**`runPython` のリスク区分（現在 `read-only`）と、サンドボックスのネットワーク制限を再検討する**。`allowInternetAccess: false` を既定にできるか、その場合に `pip install` などが使えなくなる影響も含めて決める。
- 外部コンテンツの汚染状態（CL-10）は、M3 では取り込みの記録口だけを置く。判定と遮断は 004 Req 4.8。

### Docker の隔離の限界

- 確認したのは Rancher Desktop の Docker Engine 29.5.3（aarch64）だけです。Docker Desktop（macOS）、Linux のネイティブ、x86_64 では確かめていません。ソケットの探索先と `DOCKER_HOST` の扱いも同様です。
- コンテナはホストのカーネルを共有します。カーネルやコンテナランタイムの脆弱性による脱出は、この設定では防げません。
- `mise run test:container` は、Docker に接続できない環境ではスキップされます。2026-10-29 の実行（Rancher Desktop、`DOCKER_HOST` を設定）では、`provider.container.test.ts` の 17 件が成功し、スキップは 0 件でした。

### 受け入れた制限

- **F-14**: `.xls` の検査は、OLE2 の署名と、"Workbook" か "Book" の UTF-16LE のバイト列がファイル内に含まれることだけで通ります。壊れた `.xls` や、その文字列を含むだけのファイルを、ホストの検査で完全には弾けません（中身の解析はサンドボックスの中で行い、壊れていればそこで失敗します）。
- **F-15**: 20 MiB のアップロードのメモリ上のコピーが約 5 つできます。同時に多数のアップロードを受けるサーバーには向きません。
- **F-18**: E2B のサンドボックスは**実行の間で Python の状態を保ち**ます（Docker は実行ごとに新しいコンテナで、ファイルだけが残ります）。また、E2B は**タイムアウトで途中までの出力を落とします**。このため、修正ループで前の実行の変数が残って動いてしまう、タイムアウトした実行の途中の出力がモデルに届かない、という違いが出ます。文書化のみで、対応していません。
- 接続断で実際の Next.js サーバーが `request.signal` を abort するか（W4 F-21、W7 F-11）は、実サーバーでは未確認です。単体テストでは abort を渡して確かめています。

### 実測した結果（小さな観察）

2026-10-29 に `research.md` の「W8 の実測」へ記録した結果です。**小さなローカルモデルでの少数回の観察で、手法の優劣や一般的な修正能力の根拠ではありません。**

- 実行環境: `catalog: local.ollama.chat` の既定モデル（モデル名は research.md の「W8 の実測」に記録）、Docker のサンドボックス（Rancher Desktop）、`local`。
- 修正ループ（38.2）: この表は、一時的にネットワーク制限を上書きして一度だけ取ったもので、その上書きはリポジトリにありません。このためリポジトリからは再現できません（Ollama と Docker の両方を許すレーンは、今は足さず M4 で扱います）。3 回とも `succeeded`（完走 3/3）で、修正は 1 回ずつ（上限 3）、表が 1 つ。1 回の所要は約 43〜55 秒。誤りは「存在しない `revenue` 列を読む」固定の1種類だけです。
- `mise run sandbox:build` は、この回は実行していません（W4 でビルドした画像を使用）。E2B の実行（S-4）も未実行です。

## 元教材との対照表

| 元教材（Python / LangChain / LangGraph）の対応箇所 | TypeScript / AI SDK 版での置き換え | 移植で諦めたもの |
|---|---|---|
| E2B の Code Interpreter でコードを実行するエージェント | `SandboxProvider` ポートと、E2B・Docker・疑似の3実装。`runPython` を `defineAciTool` で定義し、`createGuardedAgent` が停止条件を付ける | LangGraph の `StateGraph` とノードの定義、状態の永続化（checkpointer）、`interrupt` による承認待ち |
| エラー時にコードを直して再実行するループ | 修正回数を `AttemptLog` が数える（初回 + 3 回の修正）。ループの本体は `ToolLoopAgent` | LangGraph の条件付きエッジによるループ、LangGraph Studio での可視化 |
| アップロードしたファイルの扱い（Streamlit の `file_uploader`） | Route Handler の `multipart/form-data` と `checkUpload`。解析はサンドボックスの中 | Streamlit の全行再実行モデルでのセッション状態（`st.session_state`）。サーバー側のセッション管理に置き換えた |
| グラフの表示（Streamlit の `st.pyplot` など） | `show_figure` / `show_table` の目印の行と、`<img>`・`<table>` の描画 | 対話的なグラフ（ホバー、凡例の切り替え） |

## 移植時の変更点

[changes-from-drafts.md](../../specs/curriculum/changes-from-drafts.md) に記録された変更のうち、このモジュールに関わるものと、実装時に実測で確定したことです（Req 7.4）。採用したモデルはモデル ID ではなくカタログへの参照で示します（`local` なら `catalog: local.ollama.chat`）。

- **Docker は `dockerode` ではなく Engine API を直接**: `node:http` の `socketPath` で叩き、依存と監査面を増やさず、`child_process` の import 規則に例外を作らない（ADR-4）。
- **入力は匿名ボリューム**: 読み取り専用ルートのコンテナの `/work` を tmpfs にすると、起動前後のどちらの archive でも入力が見えませんでした（W4 の実測）。`/work` は匿名ボリューム、`/tmp` は tmpfs で、入力は起動前に archive で置きます。
- **修正回数の数え方**: 初回 + 修正 3 回 = 最大 4 回の実行で、失敗ごとに数える（CL-26、2026-10-19 確定）。累積で数えると、失敗と成功が交互のときに、修正を受けていない失敗で止まってしまいます（W4 のレビュー F-3）。
- **図表は目印の行**: E2B の `results[].png` を使わず、両提供者で同じ経路にする（CL-19）。
- **API の版**: Docker Engine API は `v1.44` に固定（Docker 25〜29 が対応する最古の版）。画像は `python:3.13-slim` をダイジェストで固定し、Python パッケージの解決結果を全件固定しています。
- **ホストで解析しない**: `exceljs`・`xlsx` などはホストに入れず、pandas / openpyxl をサンドボックス側で使います（ADR-1）。

## Python / Streamlit 経験者向けコラム

Phase 3 の解説では必須ではありません。Phase 1 のコラムを参照してください。

## 完成時点のタグ

- **タグ**: `module/3-3`
- **含まれるもの**: サンドボックスの3実装と選択、アイドル破棄、アップロードの検査、修正ループ、図表の目印の行、`/analysis` 画面と `/api/analysis`、`mock` のシナリオ、コンテナのテストと `local` の評価（ただし `analysis-fix.local.test.ts` は現状スキップされます）、E2E テスト（`apps/web/e2e/analysis.spec.ts`、3 エンジン）、この解説
- **含まれないもの**: E2B の実機での実行と外向き通信の確認、Docker Desktop・Linux のネイティブでの確認、`runPython` のリスク区分とネットワーク制限の再検討（004 Req 4）、`analysis-fix.local.test.ts` を実行できるレーン
