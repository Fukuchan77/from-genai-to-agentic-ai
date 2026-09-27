# 001-agentic-ai-platform 実装 W1 敵対的レビュー 第2ラウンド — 2026-09-27

- 対象: 第1ラウンド（`001-agentic-ai-platform-impl-w1-review-2026-09-27.md`）の指摘に対する修正。未コミットの作業ツリー（`git diff HEAD`、未追跡の `scripts/lib/`、`tooling/vitest/{network-guard.ts,ollama.ts,hermetic-registration.test.ts,global-setup-local.test.ts}`）
- 実施: 新規コンテキストの `adversarial-review`（原則 9）。第1ラウンドのプローブと変異を再実行し、新しいコード・テスト・plan の改訂を確認した
- 作業ツリーの保全:
  - 開始時の内容のハッシュ（`git diff HEAD` と未追跡ファイル）は `91d1fc6c…5266`。
  - 変更・未追跡の33ファイルを `/tmp/w1r2-backup.8iKA` に退避した。一時変異は退避したコピーから `cp -p` で戻し、`cmp` で確かめた。
  - 一時プローブのテストファイルは削除した。
  - 終了時のハッシュは開始時と一致し、33ファイルすべてが退避分と一致した。
  - `git restore` は使っていない。
- 遮断の PROVE: 外部ホストには接続していない。遮断されなかった場合に実際に通信するプローブは、ループバックの未使用ポート（`127.0.0.1:1`）だけを使った。M-4 の「`setupFiles` を空にする」変異は、既存テストが `example.com` へ実際に接続してしまうため再実行せず、H-7 の `afterEach` 除去の変異で代えた（N-3 を参照）

## 検証の実施記録

| 検証 | 結果 |
|---|---|
| `mise run gate` | 成功。Biome 28、Model ID 20、W1規則は 19/1/2/1 FILES、root test は 208 件実行（207 passed + 1 expected fail）。test 段はキャッシュの再生 |
| `mise run gate:repeat` | exit 0。`force executing` 10回、`cache hit` 0回、`executed=208 passed=208` 10回 |
| `mise run typecheck` / `check-model-ids` / 全9規則 | 1/1 成功 / 20 files / W1 の4規則は1件以上を走査（W2/W3 の規則は想定どおり 0 FILES） |
| H-1: `error TS18003` の行、lib だけの行、実際の root 出力を count-tsc に渡す | exit 1 / exit 1（`scanned 0 files`）/ `10 files`、exit 0 |
| H-2 / M-1: model-ids のプローブ | `gpt-tokenizer`・`ollama-ai-provider-v2` は検出しない。`apps/web/lib/catalog.ts`・`apps/web/lib/env-schema.ts` は違反になる。`node_modules` は走査しない |
| H-3: 既定 URL の許可を外す変異（`|| !env.OLLAMA_BASE_URL`） | `× allows the default Ollama origin ...`（1 failed） |
| H-4: `AI_MODEL_CHAT`・`POSTGRES_PORT` を与えた `turbo run test --force` | テスト内で値が見える（passed） |
| H-6: `child_process`、`new Function`、`Function()`、`eval` の各分岐を無効化 | それぞれ 10 / 1 / 1 / 3 件が失敗 |
| H-7: setup-hermetic の `afterEach` を除去 | `× fails a test that swallows a NetworkBlockedError`（it.fails が失敗） |
| M-2 / M-3: SHA の常時違反・無違反、インストール検査の無効化、mise の frozen 必須の無効化、`write-all` 検査の無効化 | 1 / 2 / 16 / 1 / 2 件が失敗 |
| M-7 / L-1: シンボリックリンク経由の4つの CLI、`--only ,` | すべて exit 1 |
| M-8: `findMissingModels` を常に `[]` に変える変異 | 2 件が失敗 |
| M-11: gate-reporter の条件を `suite === "gate"` だけに変える変異 | 2 件が失敗 |

## 第1ラウンドの指摘の確認

| ID | 判定 | 根拠 |
|---|---|---|
| H-1 | 解消を確認 | 上記の3プローブ。plan C20 の記述と一致する |
| H-2 | 解消を確認 | モジュール指定子を除外し、`gpt-` は数字か `oss` のときだけ検出する |
| H-3 | 解消を確認 | 既定 URL を `ollama.ts` の1か所で定義し、変異で失敗する |
| H-4 | 解消を確認 | turbo の env に宣言し、プローブで値が渡る。ただし `.env.local` との関係は N-2 |
| H-5 | 解消を確認 | 10回とも force で実行された |
| H-6 | 解消を確認 | 各分岐の変異で失敗する。`require`・`import =`・`Function()` も検出する |
| H-7 | 解消を確認 | `afterEach` の除去で it.fails が失敗する。最後のテストの後の遮断は N-4 |
| M-1 | 解消を確認（検出範囲は N-1） | パスで判定する。埋め込み系列を検出する |
| M-2 | 解消を確認 | `--frozen-lockfile=false`・npm・`pnpm -r`・複数行・mise の setup を検出する |
| M-3 | ほぼ解消 | `write-all`・`<scope>: write`・`.yaml` を検出する。flow 形式の `uses` と4スペースの jobs の見逃しが残る（N-5） |
| M-4 | 解消を確認（論理と H-7 の変異による） | install を呼ばない登録テストがある。外部ホストの問題は N-3 |
| M-5 | ほぼ解消 | `${}` の中、ネストしたテンプレート、`+` の後の正規表現を扱える。`if (x) /re/` と JSX テキスト内の `//` が残る（N-5） |
| M-6 | 解消を確認（N-6 に注記） | `inputTokens` は許可、`promptText`・`toolInput`・テンプレート内の `prompt` は違反 |
| M-7 | 解消を確認 | 実パスで比較する。リンク経由で exit 1 |
| M-8 | 解消を確認 | `/api` を正規化し、恒久テストは32件。変異で失敗する |
| M-9 | 解消を確認 | research の依存表と plan の File Structure に記載された |
| M-10 | 解消を確認（副作用は N-2） | `--env-file .env.local`。README に記載 |
| M-11 | 解消を確認 | 変異で失敗する。ENOENT に限定。ルートはワークスペースを除外する |
| M-12 | 解消を確認（N-7 に注記） | index digest で固定。Dependabot の `docker-compose` で追跡する |
| M-13 | ほぼ解消 | 名前空間・別名・型引数・省略記法の `risk` を正しく扱う。サブクラスの `new X` が残る（N-5） |
| M-14 | 解消を確認 | pg スイートでだけ `127.0.0.1`/`localhost`:`POSTGRES_PORT` を許可し、`--wait` を付けた |
| L-1〜L-8、L-11、L-13 | 解消を確認 | 上記のプローブと diff。L-2 は N-1 で自己訂正する |
| L-9 | 未完了（記録済み） | ユーザーの確認は移行の前に行う予定 |
| L-10、L-12 | 先送り（妥当） | 移行のコミット、19.3 の前のドライラン |

## Findings 一覧（第2ラウンドの新しい指摘）

| ID | Severity | Location | Issue | Evidence | Required fix |
|---|---|---|---|---|---|
| N-1 | MEDIUM | `scripts/check-model-ids.mjs:37`（o 系列・`gpt-`）、`scripts/check-model-ids.test.mjs:199`、plan C20 | 単独の `o1`/`o3`/`o4` や `gpt-image-1`・`gpt-realtime`・`chatgpt-4o-latest` を検出しなくなった。テストは docs の `o3` を合格として固定している。原因は第1ラウンドの L-2 で `o3` を誤検出と分類した私の誤り | プローブで `"o3"`・`"o1"`・`"gpt-image-1"` は違反0件。test:199 `"... before o3 lint."` を合格にしている | 単独の `o<数字>` をモデル ID として検出する（直前・直後が英数字でないとき）。`gpt-` は既知のパッケージ名（`gpt-tokenizer`）だけを除く方式にする。test:199 の期待値と plan C20 を改める |
| N-2 | MEDIUM | `mise.toml:40-49,105-127`、`turbo.json:14-25` | `.env.local` を読むのは Compose だけで、`test:db`・`test:local` のテストプロセスは読まない。`POSTGRES_PORT`・`AI_MODEL_*` を `.env.local` に書くと、Compose だけに反映され、guard とテストは既定値（5432 など）を使う | mise.toml に `[env] _.file` がない。H-4 の値は、シェルの環境変数から turbo 経由で渡る分だけ | `test:db`・`test:local`（と `services:*`）が同じ env ファイルを読むように、mise の `_.file`（`.env.local` があるときだけ）を設けるか、README に「シェルで export する」と明記する |
| N-3 | MEDIUM | `tooling/vitest/hermetic-registration.test.ts:18-35`、`tooling/vitest/setup-hermetic.test.ts`（dgram・lookupService） | 遮断が壊れたときに、テストが実際に外部ホストへ接続する | do.md「W1 Review Remediation」の注意に、`example.com` への HTTP（200）と UDP の送信が各1回発生したとある。接続先は `example.com`・`8.8.8.8:53`・`1.1.1.1:53` など | 遮断を確かめる接続先を、ループバックの未使用ポート（`127.0.0.1:1`）に統一する（名前解決の検査には `*.invalid` を使い、guard が壊れていても外へ出ない構成にする） |
| N-4 | LOW | `tooling/vitest/setup-hermetic.ts:21-23` | 最後のテストの `afterEach` より後（`afterAll`、タイマー）に起きた遮断は報告されない | プローブ: `afterAll` と、最後のテストが予約した `setTimeout` の中で捕捉された fetch は、どちらも失敗にならない（`beforeAll` の分は最初のテストで失敗する） | `afterAll` でも `assertNoUnconsumedBlockedConnections()` を呼ぶ |
| N-5 | LOW | `scripts/check-repo-rules.mjs`（字句解析、no-dynamic-eval、guarded-agent-only、actions-pinned、frozen-lockfile、allow-builds-reasoned） | 残る回避例 | プローブ: `(0, eval)(s)`、`eval?.(s)`、`node:vm`、`` import(`node:child_process`) ``、`if (x) /"/.test(y)` の後の import、JSX テキスト内の `https://` の後の `eval`、`class X extends ToolLoopAgent` の後の `new X`、`- { uses: ...@v4 }`、permissions のない4スペースの jobs、CI の `pnpm add`、中身のない `#` の理由コメントは、いずれも合格する | 規則を結線する波（W2/W3）の前に、優先度を付けて対応するか、plan C20 に既知の近似として記録する |
| N-6 | LOW | `scripts/check-repo-rules.mjs`（no-sensitive-logging）、plan C20 の表 | ログ方針が許可する件数の出力 `messages.length` を違反にする | プローブで `sensitive identifier messages` | 直後のプロパティ `.length`・`.size` もメタデータ語として扱うか、plan に「件数は `messageCount` などの変数で渡す」と明記する |
| N-7 | LOW | `compose.yaml`、do.md（M-12） | digest で固定した後に起動を確かめたのは db プロファイルだけ | do.md「`services:up:db` で起動を確認」 | `mise run services:up`（trace を含む）で6サービスが healthy になることを確かめる |
| N-8 | LOW | `mise.toml:64-71` | `mise run gate` の test 段は、同じ入力ならキャッシュの再生になる（`gate:repeat` だけが force） | `//:test: cache hit, replaying logs` | 意図として plan C1 に記録するか、`gate` でも force にする |

## Critique

### [MEDIUM] o 系列と一部の gpt 系列のモデル ID を検出しなくなった（第1ラウンド L-2 の自己訂正）
**Location**: scripts/check-model-ids.mjs:37, scripts/check-model-ids.test.mjs:199
**Issue**: L-2 への対応で o 系列は `o<数字>-<英字>` だけ、`gpt-` は数字か `oss` のときだけになった。そのため、実在するモデル ID の `o3`・`o1`・`gpt-image-1` などが、コードでも docs でも検出されない（Req 2.18、原則 8）。
**Evidence**: プローブで `"o3"`・`"o1"`・`"gpt-image-1"`・`"gpt-realtime"`・`"chatgpt-4o-latest"` は違反0件。test:199 は docs の「before o3 lint」を合格と固定している。第1ラウンドの L-2 で `o3` を誤検出の例に挙げたのは私の誤りで、docs の `o3` は検出すべき記述だった。
**Confidence**: high
**Fix**: 単独の `o[1-9]` を、前後が英数字でない場合に検出する。`gpt-` は既知のパッケージ名だけを除外する（モジュール指定子の除外は既にある）。テストと plan C20 の系列の記述を合わせて改める。

### [MEDIUM] `.env.local` を Compose だけが読み、テストプロセスは読まない
**Location**: mise.toml:40-49, 105-127
**Issue**: M-10 の対応で `services:*` は `.env.local` を読むようになったが、`test:db`・`test:local` の環境にはこのファイルが入らない。そのため、学習者が `.env.local` に書いた `POSTGRES_PORT`・`POSTGRES_PASSWORD`・`AI_MODEL_*` は、Compose には反映されてもテストには反映されない（M-14 の許可ポートと実際の公開ポートがずれる）。
**Evidence**: mise.toml に `[env]` がない。turbo の `env` はプロセス環境の値を渡すだけである。
**Confidence**: high
**Fix**: mise の `[env] _.file = { path = ".env.local", ... }`（ファイルがない場合に失敗しない設定）で全タスクに読み込ませるか、テスト用の変数はシェルで export する旨を README に明記する。

### [MEDIUM] 遮断のテストが外部ホストを接続先にしている
**Location**: tooling/vitest/hermetic-registration.test.ts:18-35, tooling/vitest/setup-hermetic.test.ts（dgram・lookupService のテスト）
**Issue**: guard や登録が壊れた状態で実行すると、テストが `example.com` への HTTP や `8.8.8.8:53` への UDP を実際に送る。原則 3（gate はネットワークを必要としない）と、非空虚の確認の安全性に反する。
**Evidence**: do.md「W1 Review Remediation」は、実際に `example.com` への HTTP（200）と UDP の送信が発生したことを記録している。
**Confidence**: high
**Fix**: 遮断を確かめる接続先を `127.0.0.1:1` などのループバックの未使用ポートと予約アドレスに置き換え、壊れた場合もホストの外へ出ないようにする。

### [LOW] 最後のテストより後の遮断が報告されない
**Location**: tooling/vitest/setup-hermetic.ts:21-23
**Issue**: 検査は `afterEach` だけなので、`afterAll` や遅延タイマーの中で捕捉された遮断は失敗にならない。
**Evidence**: 一時プローブ（`127.0.0.1:1` 宛て）で、`afterAll` と最後のテスト後の `setTimeout` の遮断は失敗にならなかった。
**Confidence**: high
**Fix**: setup ファイルで `afterAll` にも同じ検査を登録する。

### [LOW] 字句解析と規則の回避例が残っている
**Location**: scripts/check-repo-rules.mjs
**Issue**: 間接の eval、オプショナル呼び出しの eval、`node:vm`、テンプレートの動的 import、`)` の後の正規表現、JSX テキスト内の `//`、サブクラス化した ToolLoopAgent、flow 形式の `uses`、permissions のない4スペースの jobs、CI の `pnpm add`、中身のない理由コメントを見逃す。
**Evidence**: 一時ディレクトリでのプローブで、いずれも `PASS`。
**Confidence**: high
**Fix**: 結線する波の前に対応するか、既知の近似として plan C20 に記録する。

### [LOW] `messages.length` を違反にする
**Location**: scripts/check-repo-rules.mjs（no-sensitive-logging）
**Issue**: ログ方針は件数の出力を許可するが、`console.info(messages.length)` を違反にする。
**Evidence**: プローブの結果 `sensitive identifier messages must not be logged`。
**Confidence**: high
**Fix**: 直後のプロパティ名もメタデータ語として判定するか、plan に書き方の規約を記録する。

### [LOW] trace プロファイルのイメージを digest 固定後に起動していない
**Location**: compose.yaml
**Issue**: 起動確認は db プロファイルだけだった。
**Evidence**: do.md の M-12 の記述。
**Confidence**: medium
**Fix**: `mise run services:up` で6サービスが healthy になることを確かめて記録する。

### [LOW] `gate` の test 段がキャッシュの再生になる
**Location**: mise.toml:64-71
**Issue**: `gate:repeat` 以外の `gate` は、入力が同じならテストを実行しない。
**Evidence**: `//:test: cache hit, replaying logs 1aa52488f92973ba`。
**Confidence**: high
**Fix**: 意図として plan C1 に記録するか、`gate` でも `TURBO_FORCE` を使う。

## Plan の改訂と実装の一致

- C18（setup-hermetic、network-guard、ollama、pg の許可、afterEach、登録テスト、global-setup-local のテスト）: 実装と一致する。
- C20（model-ids のパス判定・系列・モジュール指定子、count-tsc、各規則の表）: 実装と一致する。ただし系列の定義は N-1 の問題を含む。no-sensitive-logging の「メタデータ語」は、識別子の中の語について実装と一致するが、プロパティへのアクセス（N-6）については表の記述が曖昧である。
- research（TypeScript 20260926.1、Vitest 5.0.2、`@types/node`）と File Structure: 実装と一致する。
- tasks.md の境界の追記: 追加したファイルを列挙している。`mise.toml` は Task 5 の境界に含まれる。

## Verdict

APPROVE_WITH_NOTES

HIGH 7件はいずれも、プローブまたは変異で解消を確認した。新しい CRITICAL / HIGH はない。W1 の移行の前に、N-1（検出の後退）と N-3（外部に出るテスト）の対応を推奨する。N-2 は 002 の開始前までに対応すればよい。

## Hallucination Signal

forced: false

## 対応状況


2026-09-27、メインセッションが対応した。証跡は `specs/001-agentic-ai-platform/pdca/do.md`「W1 Re-review Remediation」。

| ID | 状態 | 対応 |
|---|---|---|
| N-1 | 修正 | 単独の `o<数字>`、`gpt-image`・`gpt-realtime`・`gpt-audio`、`chatgpt-` を検出する（`o3lint`・`foo3`・`gpt-tokenizer` は検出しない）。テストの docs 中の `o3` を違反側へ移した。RED→GREEN→PROVE（旧パターンへの戻しと `image|realtime|audio`・`chatgpt-` の削除でそれぞれ失敗）。plan C20 を更新 |
| N-2 | 先送り | 002 の開始前に、`test:db`・`test:local` のテストプロセスへ `.env.local` を渡す方式を決める（gate は `.env.local` に依存させない）。W2 以降の該当タスクに引き継ぐ |
| N-3 | 修正 | `setup-hermetic.test.ts`・`hermetic-registration.test.ts` の宛先を `localhost`・`127.0.0.1`・`127.0.0.2` に置き換え、`dns.setServers` と各 `Resolver` をループバックに向けた。`setupFiles: []` の PROVE で2件失敗し、発生した通信はローカルの `http://localhost/`（404）だけだった |
| N-4 | 先送り（LOW） | `afterAll` や最後のテスト後のタイマーでの遮断の報告は、W2 の `@platform/ai-core/testing`（11.x）でテストのライフサイクルに合わせて扱う |
| N-5 | 記録（LOW） | 名前ベースの検査の限界として受け入れる。do.md に回避例の一覧を残し、該当規則を結線する波（W2 の締め 13.7、W3 の締め 19.3）の前に再評価する |
| N-6 | 修正 | 機密の識別子への `.length`・`.size`・`.count` のアクセスを許可する（`messages[0]`・`messages.map`・`prompt.text` は違反のまま）。RED→GREEN→PROVE。plan C20 を更新 |
| N-7 | 確認 | `mise run services:up` で6サービス（postgres、redis、clickhouse、minio、langfuse-web、langfuse-worker）がすべて healthy。確認後に `services:down` |
| N-8 | 記録 | 通常の `gate` のキャッシュ再生は検証速度（NFR-01）のための意図した動作で、決定性は `gate:repeat`（`TURBO_FORCE`）で検証すると plan の mise タスク表に記録した |

最終検証: `mise run gate` 成功（Biome 28、Model ID 20、W1規則 19/1/2/1 files、208件+4件 = executed=212 passed=212）、`mise run gate:repeat` 10/10（10回とも `force executing`）、`mise run typecheck` 1/1。
