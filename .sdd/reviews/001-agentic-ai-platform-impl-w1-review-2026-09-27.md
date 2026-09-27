# 001-agentic-ai-platform 実装 W1（Task 1〜5）敵対的レビュー — 2026-09-27

- 対象: W1 基盤（Task 1.1〜5.5）。`git diff 080a8e6..HEAD -- . ':!specs' ':!.sdd'`（Dependabot のマージ分を含む）
- 実施: 新規コンテキストの `adversarial-review`（constitution 原則 9、tasks.md「波ごとの敵対的レビュー」）
- 参照: constitution 1.0.2、steering、spec.md（Req 1・2、NFR）、plan.md（C1〜C3、C18、C20、mise タスク、環境変数）、research.md、tasks.md（W1）、tasks-w2〜w5、既存レビュー（1.1/1.2/1.3/3.1/3.2/4.1）、`pdca/do.md`（PROVE 証跡の確認のみ）
- 作業ツリー: レビュー中の一時変異・一時プローブはすべて `git restore` / 削除で戻し、`git status` はクリーン

## Risk trigger の解決

**Trigger**: 波の締め（5.5）完了後の必須レビュー（原則 9）。W1 は W2〜W5 が継承する基盤。

**結論: 確認した（移行は保留すべき）**。`mise run gate` は成功する（Biome 21 files、Model ID 13 files、W1 4規則、root test 48/48。ただし既定の実行は Turborepo のキャッシュ再生で、`--force` でも 48/48 passed を確認）。一方で、次の2種類の問題を実測で確認した。

1. 空振り検出や規約検査の一部が、実際には検出できない（count-tsc、gate:repeat、frozen-lockfile、no-dynamic-eval の未検証の分岐）。
2. W2〜W5 の予定コードで誤検出・誤動作が確定しているもの（`gpt-tokenizer` の import、Ollama 既定 URL の遮断、turbo strict env による `AI_MODEL_*` の欠落、`inputTokens` のログ）。

そのため、W1 を `tasks-comp-w1.md` へ移す前に HIGH の解消を求める。

## 検証の実施記録（抜粋）

| 検証 | 結果 |
|---|---|
| `mise run gate` | exit 0。`//:test: cache hit, replaying logs 39d8514bedbcd583` |
| `turbo run test --force` | 48/48 passed、`executed=48` |
| `mise run typecheck` | 1/1 successful |
| `node scripts/check-repo-rules.mjs`（全9規則） | W2/W3 の5規則は 0 FILES で失敗（想定どおり） |
| 変異: `no-dynamic-eval` の `child_process` 検査と `new Function` 検査を無効化 | `check-repo-rules.test.mjs` 19/19 **passed**（生き残り） |
| 変異: `frozen-lockfile` を常に違反、`actions-pinned` を常に違反 | 19/19 **passed**（生き残り） |
| 変異: `gate-reporter` の条件を `suite === "gate"` だけに変更 | `gate-reporter.test.ts` 7/7 **passed**（生き残り） |
| 変異: `vitest.config.ts` の `setupFiles` を空にする | root 48/48 **passed**（遮断の登録が検証されていない） |
| プローブ: `count-tsc` に `error TS18003 ...` の1行だけを渡す | `1 files`、exit 0 |
| プローブ: `tsc -p tsconfig.json --listFilesOnly` | 出力の大半は `node_modules` の lib / @types。プロジェクトのファイルは6件だけ |
| プローブ: `checkModelIds` に `import { countTokens } from "gpt-tokenizer"` | 違反 `gpt-tokenizer` |
| プローブ: `apps/web/lib/catalog.ts` にモデル ID | 走査対象外（除外） |
| プローブ: `OLLAMA_BASE_URL` 未設定、`AI_TEST_RUN_MODE=local` で `fetch("http://127.0.0.1:11434/api/tags")` | `NetworkBlockedError`（global-setup-local の既定 URL は同じ URL） |
| プローブ: `AI_MODEL_CHAT=probe-model turbo run test --force` | テスト内の `process.env.AI_MODEL_CHAT` は `undefined` |
| プローブ: 全件 skip の gate 実行 | exit 1、`Gate reporter error: no tests executed in the gate suite.`（正常） |
| プローブ: `node scripts/check-repo-rules.mjs --only ,` | 規則を1つも実行せずに exit 0 |
| プローブ: シンボリックリンク経由で各 CLI を起動 | `check-repo-rules`・`check-model-ids`・`count-biome` が何も実行せずに exit 0 |

## Findings 一覧

| ID | Severity | Location | Issue | Evidence | Required fix |
|---|---|---|---|---|---|
| H-1 | HIGH | `scripts/gate/count-tsc.mjs:21-27` | 空でない行をすべて「ファイル」として数えるため、0件の検出が働かない | lib / @types の行とエラー行（`error TS18003`）も数える。プローブで `1 files`、exit 0 | プロジェクトのファイルだけを数える（`node_modules` と lib の `.d.ts` を除き、tsconfig のディレクトリ配下に限る）。`error TS` 行があれば失敗させる。fixture に lib だけのケースとエラー行のケースを加える |
| H-2 | HIGH | `scripts/check-model-ids.mjs:15-16` | 計画済みの依存 `gpt-tokenizer` をモデル ID として検出する | プローブで違反 `gpt-tokenizer`。Task 18.3 が `summarize/tokens.ts` で import する（plan C12、research I-10） | パッケージ名の誤検出を防ぐ許可リスト（import 元の文字列、または既知のパッケージ名）を設計し、テストに加える |
| H-3 | HIGH | `tooling/vitest/setup-hermetic.ts:68-71`、`tooling/vitest/global-setup-local.ts:3,103` | `OLLAMA_BASE_URL` が未設定のとき、global setup は既定 URL を「到達可能」と判定するが、hermetic guard は同じ URL を遮断する | プローブで `NetworkBlockedError`。`.env.example` は値が空で、plan の既定値は `http://127.0.0.1:11434` | 既定 URL を1か所で定義し、両方のファイルで使う。「未設定の local モードでも既定の Ollama を許可する」テストを加える |
| H-4 | HIGH | `turbo.json:12-28`、`tooling/vitest/global-setup-local.ts:64-72` | turbo の strict env が `AI_MODEL_*` を落とすため、`mise run test:local` での必要モデルの確認が常に空集合になる | プローブで `chat: undefined` | `test` と `//#test` の `env` に `AI_MODEL_*`（と `AI_RUN_MODE` 等の必要な変数）を宣言する。カタログの既定モデルも必要モデルに含める設計を W2 に引き継ぐ |
| H-5 | HIGH | `mise.toml:72-79`、`turbo.json:25-28` | `gate:repeat` の test 段がキャッシュの再生になり、NFR-02 の決定性の検証として意味を持たない | `cache hit, replaying logs`。do.md の「10/10 successful」を決定性の証拠として使えない | `gate:repeat` では `TURBO_FORCE=1`（または `--force`）で毎回実行する。do.md の証跡を取り直す |
| H-6 | HIGH | `scripts/check-repo-rules.mjs:343-361`、`scripts/check-repo-rules.test.mjs:53` | W1 規則 `no-dynamic-eval` の `new Function` と `child_process` の検出がテストされていない | 変異で両方の分岐を無効化しても 19/19 passed。PROVE は `eval` だけ | `new Function(`、`import ... from "node:child_process"`、`"child_process"`、動的 `import("node:child_process")` の違反 fixture を加え、PROVE を記録する |
| H-7 | HIGH | `tooling/vitest/setup-hermetic.ts:196-213` | 遮断は例外を投げるだけなので、被テストコードが例外を捕捉すると、未モックの接続を試みたテストが緑になる | Req 2.11「接続先を含むエラーでテストを失敗させる」。予定の C12 は fetch の失敗を `source-unavailable`（`network`/`fetch-failed`）に写像する | 遮断した接続先をモジュール内に記録し、setup ファイルの `afterEach` で記録があればテストを失敗させる（期待する遮断はヘルパで明示する） |
| M-1 | MEDIUM | `scripts/check-model-ids.mjs:6-10,39-41,140` | 許可場所をファイル名だけで判定するため、任意の `catalog.ts`・`env-schema.ts` が除外される。埋め込みモデル ID も検出できない | プローブで `apps/web/lib/catalog.ts` は走査対象外。`text-embedding-3-small`・`nomic-embed-text`・`embeddinggemma` を検出しない | 許可場所をリポジトリ相対の完全なパス（`packages/ai-core/src/models/catalog.ts` 等）で判定する。接頭辞を catalog の実際の系列（埋め込みを含む）と同期する |
| M-2 | MEDIUM | `scripts/check-repo-rules.mjs:448-469` | `frozen-lockfile` は現在の CI では空振りする。`mise run setup` の中身も検査しない | ci.yml に `pnpm install` の行はない。`--frozen-lockfile=false`、`npm install`、`pnpm -r install` を見逃す。「常に違反」への変異も生き残る | `mise.toml` の `setup` の `--frozen-lockfile` も検査するか、「インストール手順が `mise run setup` か frozen」を肯定的に検査する。回避例と合格例のテストを加える |
| M-3 | MEDIUM | `scripts/check-repo-rules.mjs:409-446` | `actions-pinned` は `permissions:` の有無しか見ない。`.yaml` のワークフローも走査しない | `permissions: write-all` と `deploy.yaml` の未固定 `uses:` がどちらも合格する | 許可する権限の範囲（`contents: read`）を検査するか、少なくとも `write-all` を拒否する。`.yaml` も走査する（plan C20 の表を同時に改訂する） |
| M-4 | MEDIUM | `vitest.config.ts:28` | hermetic setup の登録そのものを検証するテストがない | `setupFiles: []` にしても 48/48 passed。W2 で3つの設定が同じ登録を必要とする | 別のテストファイルで「install を呼ばずに `fetch` が `NetworkBlockedError` になる」ことを検査する（各ワークスペースにも同じテストを置く） |
| M-5 | MEDIUM | `scripts/check-repo-rules.mjs:72-93,146-154` | 字句解析がテンプレートの `${...}` を丸ごと読み飛ばし、`+` の後などの正規表現を除算と誤認する | `` `${eval(src)}` ``、`` console.log(`p=${prompt}`) ``、`x + /"/.test(y)` の後の `child_process` の import を見逃す | `${}` の中をコードとして解析する。正規表現を開始できる直前トークンの集合を広げる（演算子とキーワード）。回避例のテストを加える |
| M-6 | MEDIUM | `scripts/check-repo-rules.mjs:501` | `no-sensitive-logging` が、ログ方針で許可されたトークン数（`usage.inputTokens`）も違反とする | プローブで検出。plan のロギング方針はトークン数の出力を許可している | `input` の一致を単語境界またはプロパティ名の許可リスト（`inputTokens` 等）で絞る。W2 で結線する前にテストへ加える |
| M-7 | MEDIUM | `scripts/check-repo-rules.mjs:578`、`scripts/check-model-ids.mjs:177`、`scripts/gate/count-biome.mjs:47`、`scripts/gate/count-tsc.mjs:56`、`scripts/check-updates.mjs:178` | CLI の起動判定が `argv[1]` の文字列一致なので、シンボリックリンク経由では何も実行せずに exit 0 になる | プローブで3つの CLI が exit 0 | `realpathSync(process.argv[1])` と比較するか、CLI 用のエントリファイルを分ける |
| M-8 | MEDIUM | `tooling/vitest/global-setup-local.ts:99-153` | 永続的なテストがない（RED/PROVE の一時テストは削除された）。`/api` 付きの URL の扱いが setup-hermetic のテストと食い違う | do.md「Temporary test ... 削除」。setup-hermetic のテストは `OLLAMA_BASE_URL=http://127.0.0.1:11434/api`、global-setup は `${base}/api/tags` を組み立てる | global-setup-local の単体テストを恒久化する（W2 の 11.2 を待たない）。`/api` 付きの値を正規化するか、拒否して理由を示す |
| M-9 | MEDIUM | `package.json:19` | `@types/node` が plan・research で宣言されずに追加された（原則 10） | research の依存表と plan の File Structure にない。記録は do.md だけ | plan / research の依存表に追記する（版と理由） |
| M-10 | MEDIUM | `.env.example:1`、`README.md:23`、`mise.toml:102-112` | `.env.local` へのコピーを案内するが、Compose も mise も `.env.local` を読まない | Compose が自動で読むのは `.env` だけ。そのため `POSTGRES_*`・`LANGFUSE_*` の設定が効かず、弱い既定の秘密値が使われる | `services:*` タスクに `--env-file .env.local` を付けるか、案内を実際の読み込み経路に合わせる |
| M-11 | MEDIUM | `tooling/vitest/gate-reporter.test.ts:86-114`、`tooling/vitest/gate-reporter.ts:107-114` | 全件 skip のケースと、空でない gate の合格のケースを単体テストしていない。I/O エラーを握りつぶす。ルートの実行単位がワークスペースの pg テストも数える | 変異が生き残る（7/7）。`catch { return 0; }`。ルートは `vitest.config.root` 配下を再帰で走査する | 全件 skip → exit 1 と、executed>0 → 終了コードを設定しない、の2ケースを加える。catch は ENOENT に限る。ルートの走査からワークスペース（`apps/`・`packages/`）を除く |
| M-12 | MEDIUM | `compose.yaml:54,79,95,108,130,153` | イメージが可変タグ（minio はタグなし）(prior: 3.1 で MEDIUM、先送り) | 新しい証拠なし | digest で固定するか、Dependabot の `docker-compose` で追跡する |
| M-13 | MEDIUM | `scripts/check-repo-rules.mjs:247-281,366-407` | W2/W3 規則の回避と誤検出: 名前空間 import の `ai.generateObject`、別名の `new A`、`defineAciTool<...>(` の見逃し、`risk` 省略記法の誤検出 | プローブの結果: ns-import・alias-agent・generic-tool は合格、shorthand-risk は検出 | 結線（13.7、19.3）の前に、各回避例をテストに加えて修正する |
| M-14 | MEDIUM | `tooling/vitest/setup-hermetic.ts:68-71`、`mise.toml:44-48` | `test:db`（mock モード）では Postgres への接続も遮断されるため、002 の `*.pg.test.ts` は必ず失敗する。`services:up:db` も healthy を待たない | 例外は local モードの Ollama だけ。`docker compose --profile db up -d` に `--wait` がない | `AI_TEST_SUITE=pg` のときだけ `POSTGRES_*` の接続先を許可する設計を plan C18 に加える。`up -d --wait` にする |
| L-1 | LOW | `scripts/check-repo-rules.mjs:532-544` | `--only ,` が規則を1つも実行せずに成功する | プローブで exit 0 | 空の選択を拒否する |
| L-2 | LOW | `scripts/check-model-ids.mjs:15-16,108-114` | `phi`・`command-r`・`o3` が一般の語（`philosophy`、`command-runner`）にも一致する。行番号の計算が違反ごとに O(n) | プローブで docs の誤検出 | 境界の条件を厳しくする。行頭の索引を1回だけ作る |
| L-3 | LOW | `scripts/check-repo-rules.mjs:471-496` | `allowBuilds` の flow 形式や4スペースのインデントを見逃す | プローブで合格 | YAML を構文として解析するか、未対応の形式を拒否する |
| L-4 | LOW | `scripts/check-model-ids.mjs:24-37`、`scripts/check-repo-rules.mjs:48-70`、`.gitignore` | 走査が生成物のディレクトリ（`.next`、`coverage`、`dist`、実体の `node_modules`）を除外しない。`.stryker-tmp/` が ignore されていない | 実装を確認 | 共通の除外リストを持つ。`.stryker-tmp/` を `.gitignore` に加える |
| L-5 | LOW | `.github/dependabot.yml:34-37`、`research.md:182,201` | Actions の更新に cooldown がない。Dependabot のマージ後に research の版の記録が古いまま | TS `20260926.1`、Vitest 5.0.2、checkout v7.0.1、mise-action v4.3.0 が research と一致しない | Actions にも `cooldown` を設定する。先行版の「なぜこの版か」を research に追記する |
| L-6 | LOW | `scripts/check-updates.mjs:6` | 監視対象が `7.1.0-*` だけで、7.1.0 の安定版が出ても報告しない。fetch にタイムアウトがない | 実装を確認 | 7.1.x の安定版も報告する。`AbortSignal.timeout` を付ける |
| L-7 | LOW | `mise.toml:15-24` | lint の失敗時に Biome の JSON をそのまま表示するため、学習者が読みにくい | 実装を確認 | 失敗時は既定の reporter で再実行して表示する |
| L-8 | LOW | `.githooks/pre-commit:4-6` | `check:model-ids` はステージ済みの内容ではなく作業ツリーを走査する | 実装を確認 | 制約として README に記載するか、ステージ済みの内容を検査する |
| L-9 | LOW | commit `5f3dc08`、`0544330`、`288d91b` | Task 5 の docs commit が Task 1.5 の境界（`AGENTS.md`、`README.md`）を編集した。承認済みの plan と tasks-w2〜w4 を実装中に改訂したが、再承認の記録がない | `git log --stat` | 変更理由と承認者を記録する |
| L-10 | LOW | `specs/001-agentic-ai-platform/tasks.md`（進捗表） | W1 の状態が「未着手（現在の波）」のまま | 全サブタスクは `[x]` | 移行のコミットで更新する |
| L-11 | LOW | `tooling/vitest/setup-hermetic.ts:124-126` | `dgram` と `dns.lookupService` を遮断しない。plan の File Structure にある「実行モードの固定」も持たない（C4 の 12.3 に依存） | 実装を確認 | 対象外である旨を明記するか、遮断を加える |
| L-12 | LOW | `stryker.config.mjs:15-18` | 作業ディレクトリがルートのままなので、ai-core の設定の `include` がルート相対で解決され、テストが0件になるおそれがある（low confidence） | 未実測 | 29.3 の前にドライランで確認する |
| L-13 | LOW | tasks.md Task 3 Implementation Notes | Rancher Desktop の共有設定の手順が、Git の追跡対象外の `.serena` にしか記録されていない | Notes の3項目目 | 1-1 の解説または README に移す |

---

## Critique

### [HIGH] count-tsc の0件検出が空振りする
**Location**: scripts/gate/count-tsc.mjs:21-27
**Issue**: `::tsconfig::` 以降の空でない行をすべて走査ファイルとして数えるため、lib・@types の `.d.ts` の行や tsc のエラー行だけでも1件以上になり、Req 1.15 の「0件で失敗」を検出できない。
**Evidence**: `printf '::tsconfig::packages/empty/tsconfig.json\nerror TS18003: No inputs were found in config file.\n' | node scripts/gate/count-tsc.mjs` の結果は `TypeScript packages/empty/tsconfig.json: 1 files`、exit 0。root の `tsc --listFilesOnly` の出力はほとんどが `node_modules` の行で、プロジェクトのファイルは6件だけ。テストの fixture も lib を1件として数えている（`count: 2`）。
**Confidence**: high
**Fix**: 数える対象を tsconfig のディレクトリ配下のプロジェクトのファイルに限る（`node_modules` を除く）。`error TS` 行があれば失敗させる。fixture を「lib だけ → 失敗」「エラー行 → 失敗」に改める。W2 の 13.7 の境界は `mise.toml` だけなので、W1 のうちに直す必要がある。

### [HIGH] check-model-ids が計画済みの依存 `gpt-tokenizer` を違反にする
**Location**: scripts/check-model-ids.mjs:15-16
**Issue**: `gpt-` 接頭辞がパッケージ名 `gpt-tokenizer` に一致するため、Task 18.3（W3）の import が gate と pre-commit を失敗させる。
**Evidence**: プローブの結果は `{"file":"packages/ai-core/src/chat/tokens.ts","modelId":"gpt-tokenizer"}`。plan C12 の Owns「トークン推定（`gpt-tokenizer`）」、tasks-w3 18.3。
**Confidence**: high
**Fix**: import / export 元の文字列はパッケージ名として扱って除外するか、既知の依存名の許可リストを設ける。テストに `import ... from "gpt-tokenizer"` の合格例を加える。

### [HIGH] 既定の Ollama URL を global setup は許可し、hermetic guard は遮断する
**Location**: tooling/vitest/setup-hermetic.ts:68-71, tooling/vitest/global-setup-local.ts:3,103
**Issue**: `OLLAMA_BASE_URL` が未設定の `mise run test:local` では、global setup が既定の `http://127.0.0.1:11434` を「利用可能」と判定する。一方、ワーカーの guard はすべての接続を遮断するため、`*.local.test.ts` は理由付きの skip にならず `NetworkBlockedError` で失敗する（Req 1.13/1.14）。
**Evidence**: `if (process.env.AI_TEST_RUN_MODE !== "local" || !process.env.OLLAMA_BASE_URL) return undefined;`。プローブの結果は `NetworkBlockedError | ... http://127.0.0.1:11434/api/tags`。`.env.example` の `OLLAMA_BASE_URL=` は空。
**Confidence**: high
**Fix**: 既定 URL を共通の定数にし、guard も未設定時は既定値を許可する。テストに「local モード、URL 未設定 → 既定の origin は許可、ほかは遮断」を加える。

### [HIGH] turbo の strict env が `AI_MODEL_*` を落とし、必要モデルの確認が空振りする
**Location**: turbo.json:12-28, tooling/vitest/global-setup-local.ts:64-72
**Issue**: `mise run test:local` は `turbo run test` を経由し、`env` に宣言した3変数以外は Vitest に渡らない。そのため `requiredModels(env)` は常に空になり、「必要なモデルが取得済み」の判定（Req 1.13）が働かない。
**Evidence**: `AI_MODEL_CHAT=probe-model ... turbo run test --force` の結果は `expected { chat: undefined, ... }`。turbo.json の env は `["AI_TEST_RUN_MODE", "AI_TEST_SUITE", "OLLAMA_BASE_URL"]` だけ。
**Confidence**: high
**Fix**: `test` / `test:coverage` / `//#test` の `env` に `AI_MODEL_CHAT`・`AI_MODEL_STRUCTURED`・`AI_MODEL_EMBEDDING`・`AI_MODEL_JUDGE`（必要なら `AI_LIVE_PROVIDER` 等）を加える。W2 でカタログができたら、既定の local モデルも必要モデルに含める。

### [HIGH] gate:repeat がキャッシュの再生で、決定性（NFR-02）を検証していない
**Location**: mise.toml:72-79, turbo.json:25-28
**Issue**: `gate:repeat` の10回はいずれも `turbo run test` のキャッシュ再生で終わるため、test 段が実行されず、原則 3 の検証手段が空振りする。
**Evidence**: `mise run gate` の出力は `//:test: cache hit, replaying logs 39d8514bedbcd583`、`Cached: 1 cached, 1 total`。do.md の「`mise run gate:repeat`: 10/10 runs successful」はこの状態での結果。
**Confidence**: high
**Fix**: `gate:repeat`（できれば `gate` も）で `TURBO_FORCE=true` または `--force` を指定し、毎回実行する。証跡を取り直す。

### [HIGH] no-dynamic-eval の `new Function`・`child_process` の検出が非空虚でない
**Location**: scripts/check-repo-rules.mjs:343-361, scripts/check-repo-rules.test.mjs:53
**Issue**: W1 で gate に結線した規則のうち2つの検出分岐にテストがなく、壊しても gate は緑のまま（原則 3「非空虚」）。
**Evidence**: 2つの分岐を `false` に変異させても `Tests 19 passed (19)`。do.md の 5.2 の PROVE は「`eval` 検出を無効化」だけ。
**Confidence**: high
**Fix**: `new Function(...)`、`import { exec } from "node:child_process"`、`import cp from "child_process"`、`await import("node:child_process")` の違反 fixture を `test.each` に加え、変異での失敗を do.md に記録する。

### [HIGH] 遮断の例外を捕捉されると、未モックの接続を試みたテストが成功する
**Location**: tooling/vitest/setup-hermetic.ts:196-213
**Issue**: guard は例外を投げるだけで、試行を記録しない。そのため被テストコードの try/catch（予定の SummaryPipeline の `fetch-failed` への写像など）が捕捉すると、テストは緑になり、Req 2.11「テストを失敗させる」を満たさない。
**Evidence**: `globalThis.fetch = async (...) => { ... throw new NetworkBlockedError(destination.display); }`。plan の HTTP API 表は `source-unavailable`（`reason: "network" | "fetch-failed"`）への写像を定める。
**Confidence**: medium
**Fix**: 遮断した接続先を配列に記録し、setup ファイルで `afterEach` を登録して、記録があれば `NetworkBlockedError` の一覧で失敗させる。遮断を意図的に検証するテスト用に、記録を消費するヘルパを用意する。

### [MEDIUM] モデル ID の許可場所をファイル名だけで判定している。埋め込みモデル ID を検出しない
**Location**: scripts/check-model-ids.mjs:6-10, 39-41, 140
**Issue**: 任意のディレクトリにある `catalog.ts` を除外し、任意の `env-schema.ts` の `.default()` を許可する。さらに `text-embedding-*`・`nomic-embed-*`・`embeddinggemma` などの ID を検出しないため、Req 2.18 に抜け道がある。
**Evidence**: プローブで `apps/web/lib/catalog.ts`（`"claude-sonnet-4"`）は走査数に入らず、埋め込み ID の配列も違反0件。plan C20「許可する場所: C5 の `catalog.ts`、C4 の `env-schema.ts`」。
**Confidence**: high
**Fix**: 許可場所を `packages/ai-core/src/models/catalog.ts`、`packages/ai-core/src/config/env-schema.ts`、`scripts/check-model-ids{,.test}.mjs` の相対パスで判定する。接頭辞の一覧を catalog の系列と同期させ、テストで検証する。

### [MEDIUM] frozen-lockfile は現在の CI では空振りする
**Location**: scripts/check-repo-rules.mjs:448-469
**Issue**: 検査するのは `pnpm install|i` を含む行だけ。ci.yml はすべて `mise run setup` を使うため、実際に検査されるインストール手順は0件であり、`mise.toml` の `setup` が frozen かどうかも見ていない。
**Evidence**: プローブの結果は `--frozen-lockfile=false`・`npm install`・`pnpm -r install` のいずれも合格。「常に違反」への変異も 19/19 passed。
**Confidence**: high
**Fix**: 各ジョブのインストール手順を肯定的に検査する（`mise run setup` を使うか、frozen 付きの pnpm であること）。`mise.toml` の `setup` に `--frozen-lockfile` があることも検査する。合格例と回避例のテストを加える。

### [MEDIUM] actions-pinned は権限の有無しか見ず、`.yaml` のワークフローも走査しない
**Location**: scripts/check-repo-rules.mjs:409-446
**Issue**: 原則 7「permissions: を最小にする」に対し、`write-all` を合格とする。GitHub が有効なワークフローとして扱う `.yaml` も走査しない。
**Evidence**: プローブの結果は write-all・yaml-ext のどちらも `PASSED (not detected)`。
**Confidence**: high
**Fix**: `write-all` と、許可リスト外の `: write` を拒否する。`.yaml` も走査する（plan C20 の表の「`*.yml`」を同時に改訂する）。

### [MEDIUM] setup-hermetic の登録そのものを検証するテストがない
**Location**: vitest.config.ts:28
**Issue**: setup-hermetic.test.ts は install を自分で呼ぶため、設定から setup を外しても全テストが成功し、Req 2.11 の gate での強制を検出できない。
**Evidence**: `setupFiles: []` に変異させても `Tests 48 passed (48)`。
**Confidence**: high
**Fix**: install を呼ばない別のテストファイルで、`fetch` と `net.connect` が遮断されることを検査する。W2 の各ワークスペースにも同じテストを置く規約にする。

### [MEDIUM] 字句解析がテンプレートの式と一部の正規表現を誤って扱い、違反を見逃す
**Location**: scripts/check-repo-rules.mjs:72-93, 146-154
**Issue**: テンプレートの `${}` の中はコードだが読み飛ばしている。また、`+`・`typeof`・`in` などの後の `/.../` を除算と誤認し、クォートで字句の同期が崩れて、後続の違反を隠す。
**Evidence**: プローブの結果は template-expr、template-log（`` console.log(`p=${prompt}`) ``）、regex-after-plus（後続の `node:child_process` の import）のいずれも見逃し。
**Confidence**: high
**Fix**: テンプレートの `${` と `}` の対応を追ってコードとして字句解析する。正規表現を開始できる直前トークンに算術・比較の演算子とキーワードを加える。回避例のテストを加える。

### [MEDIUM] no-sensitive-logging が、許可されたトークン数のログを違反とする
**Location**: scripts/check-repo-rules.mjs:501
**Issue**: `/(?:prompt|messages|input|apiKey)/i` の部分一致が `inputTokens`・`inputSchema` に当たるため、plan のロギング方針が許可する「トークン数」の出力が W2 の結線後に gate を失敗させる。
**Evidence**: `console.info(usage.inputTokens)` を検出する。plan の Error Handling「ログに出してよいのは…件数・トークン数・経過時間などの数値」。
**Confidence**: high
**Fix**: camelCase の語の単位で `input` を照合し、`inputTokens` 等の許可リストを設ける。テストに合格例を加える。

### [MEDIUM] CLI の起動判定がシンボリックリンク経由だと何もせずに成功する
**Location**: scripts/check-repo-rules.mjs:578, scripts/check-model-ids.mjs:177, scripts/gate/count-biome.mjs:47, scripts/gate/count-tsc.mjs:56, scripts/check-updates.mjs:178
**Issue**: `import.meta.url`（実パス）と `argv[1]`（与えられたパス）の文字列比較なので、リンクを経由するとメイン処理が走らず、失敗すべき入力でも exit 0 になる（gate の空振り）。
**Evidence**: `/tmp/fgaa-link/scripts/check-repo-rules.mjs --only tool-risk-declared` は exit 0。`count-biome` に 0 files の JSON を渡しても exit 0。
**Confidence**: medium（mise 経由は物理パスなので、発生する経路は限られる）
**Fix**: `realpathSync(process.argv[1])` と `fileURLToPath(import.meta.url)` を比較する。

### [MEDIUM] global-setup-local に恒久的なテストがなく、`/api` 付きの URL の扱いが食い違う
**Location**: tooling/vitest/global-setup-local.ts:99-153
**Issue**: RED/PROVE に使った一時テストを削除したため、判定ロジック（tags の解析、不足モデル、HTTP エラー）の退行を検出できない。setup-hermetic のテストは `/api` 付きの URL を前提にしているが、global-setup は `${base}/api/tags` を組み立てるので、`/api` 付きの値では 404 になり、local テストがすべて skip される。
**Evidence**: do.md「Temporary test: `tooling/vitest/.task-4-2.test.ts`（Task 4.2完了時に削除）」。setup-hermetic.test.ts:160 `vi.stubEnv("OLLAMA_BASE_URL", "http://127.0.0.1:11434/api")`。
**Confidence**: medium
**Fix**: `global-setup-local.test.ts` を恒久化する（境界の追加は plan / tasks に記録する）。`/api` の接尾辞は正規化するか、明示的に拒否する。

### [MEDIUM] plan に宣言のない依存 `@types/node`
**Location**: package.json:19
**Issue**: 原則 10「plan に宣言されていない第三者依存の追加を禁ずる」に反する。
**Evidence**: research の依存表・plan の File Structure に `@types/node` がない。記録は do.md:399 だけ。
**Confidence**: high
**Fix**: research の依存表と plan の root `package.json` の行に、`@types/node@26.6.3` と理由を追記する。

### [MEDIUM] `.env.local` の案内と、Compose・mise が実際に読むファイルが一致しない
**Location**: .env.example:1, README.md:23, mise.toml:102-112
**Issue**: `cp .env.example .env.local` と案内しているが、Compose が自動で読むのは `.env` だけ。`POSTGRES_*`・`LANGFUSE_*` を設定しても反映されず、弱い既定の秘密値で起動する。
**Evidence**: `services:up` は `docker compose --profile db --profile trace up -d`（`--env-file` なし）。compose.yaml は `${POSTGRES_PASSWORD:-postgres}` などの既定値を持つ。
**Confidence**: high
**Fix**: `services:*` に `--env-file .env.local` を付ける（ファイルがない場合の扱いも決める）か、README の案内を読み込み経路ごとに分ける。

### [MEDIUM] gate-reporter の単体テストの不足、例外の握りつぶし、二重計上
**Location**: tooling/vitest/gate-reporter.test.ts:86-114, tooling/vitest/gate-reporter.ts:107-114
**Issue**: plan の File Structure が求める「全件スキップ」のケースと、空でない gate の合格のケースがない。`catch { return 0; }` はすべての I/O エラーを握りつぶす。ルートの実行単位はワークスペースの `*.pg.test.*` も数えるため、W2 以降は未実行の件数を二重に計上する。
**Evidence**: `suite === "gate"` への変異でも 7/7 passed。全件 skip の統合プローブ自体は正常（exit 1）。
**Confidence**: high（テストの不足）、medium（二重計上）
**Fix**: 2ケースを加える。catch は ENOENT に限る。ルートの走査からワークスペースのディレクトリを除く。

### [MEDIUM] Compose のイメージが可変タグ (prior: agentic-ai-platform-3.1 MEDIUM、先送り)
**Location**: compose.yaml:54, 79, 95, 108, 130, 153
**Issue**: 同じコミットでも、将来は別のバイナリが起動する。
**Evidence**: `langfuse:4`、`redis:7`、タグなしの `cgr.dev/chainguard/minio`。新しい証拠はない。
**Confidence**: high
**Fix**: 3.1 の Fix のとおり（digest で固定、または Dependabot の `docker-compose` で追跡）。

### [MEDIUM] W2/W3 で結線する規則の回避と誤検出
**Location**: scripts/check-repo-rules.mjs:247-281, 366-407
**Issue**: `import * as ai from "ai"; ai.generateObject()`、`import { ToolLoopAgent as A }; new A()`、`defineAciTool<In, Out>({...})` を見逃す。`risk` の省略記法（`{ risk }`）は違反とする。
**Evidence**: プローブの結果は ns-import・alias-agent・generic-tool が合格、shorthand-risk が検出。
**Confidence**: high
**Fix**: import の束縛名を追跡する。型引数の `<...>` を読み飛ばしてから `(` を判定する。省略記法の `risk` を許可する。いずれもテストに加える。

### [MEDIUM] `test:db` の pg テストが hermetic guard に遮断される
**Location**: tooling/vitest/setup-hermetic.ts:68-71, mise.toml:44-48
**Issue**: `test:db` は `AI_TEST_RUN_MODE=mock` で実行し、guard は local モードの Ollama 以外をすべて遮断するため、002 の `*.pg.test.ts` は Postgres に接続できずに失敗する。`services:up:db` も healthy を待たない。
**Evidence**: `allowedOllamaDestination()` だけが例外。`docker compose --profile db up -d` に `--wait` がない。
**Confidence**: high（仕組み）、medium（影響は 002 から）
**Fix**: plan C18 に「`AI_TEST_SUITE=pg` のときだけ `127.0.0.1:${POSTGRES_PORT}` を許可する」を加える。`up -d --wait` にする。

### [LOW] `--only ,` が規則を1つも実行せずに成功する
**Location**: scripts/check-repo-rules.mjs:532-544
**Issue**: 空の選択を受け付ける。
**Evidence**: プローブで exit 0、出力なし。
**Confidence**: high
**Fix**: `only.length === 0` なら使い方のエラーにする。

### [LOW] モデル ID の接頭辞が一般の語に一致する。行番号の計算が二次
**Location**: scripts/check-model-ids.mjs:15-16, 108-114
**Issue**: `philosophy`・`command-runner`・`o3` を違反とする。`lineNumberAt` を違反ごとに先頭から数える。
**Evidence**: プローブの docs の結果。
**Confidence**: high
**Fix**: 系列ごとに版の形（数字など）を要求する。改行位置の索引を1回だけ作る。

### [LOW] allow-builds-reasoned の書式依存
**Location**: scripts/check-repo-rules.mjs:471-496
**Issue**: flow 形式と4スペースのインデントを見逃す。
**Evidence**: プローブで合格。
**Confidence**: high
**Fix**: 未対応の形式を違反にする。

### [LOW] 走査が生成物のディレクトリを除外しない
**Location**: scripts/check-model-ids.mjs:24-37, scripts/check-repo-rules.mjs:48-70, .gitignore
**Issue**: `.next/types/*.ts`、`dist/*.d.ts`、実体の `node_modules` を走査するため、件数が作業ツリーの状態に依存する。`.stryker-tmp/` が ignore されていない。
**Evidence**: 実装を確認。
**Confidence**: medium
**Fix**: 共通の除外リストを設ける。`.gitignore` に `.stryker-tmp/` を加える。

### [LOW] Actions に cooldown がない。research の版の記録が古い
**Location**: .github/dependabot.yml:34-37, specs/001-agentic-ai-platform/research.md:182,201
**Issue**: NFR-11 の24時間の方針が Actions には適用されない。Dependabot のマージ後、原則 8「なぜこの版か」の記録が更新されていない。
**Evidence**: research の値は `7.1.0-dev.20260923.1` / Vitest 5.0.1、実際の固定は `7.1.0-dev.20260926.1` / 5.0.2、checkout v7.0.1、mise-action v4.3.0。
**Confidence**: high
**Fix**: Actions にも `cooldown` を設定する。research を実測値で更新する。

### [LOW] check-updates が 7.1 の安定版を報告しない。タイムアウトがない
**Location**: scripts/check-updates.mjs:6, 100-106
**Issue**: `/^7\.1\.0-/` は安定版の `7.1.0` に一致しない。レジストリの応答待ちに上限がない。
**Evidence**: 実装を確認。
**Confidence**: high
**Fix**: 安定版を別に報告する。`AbortSignal.timeout` を付ける。

### [LOW] lint の失敗時の表示が JSON
**Location**: mise.toml:15-24
**Issue**: 失敗時は `cat "$report_file"` で Biome の JSON を表示するだけ。
**Evidence**: 実装を確認。
**Confidence**: high
**Fix**: 失敗時は既定の reporter で `biome ci` を再実行して表示する。

### [LOW] pre-commit のモデル ID 検査は作業ツリーを走査する
**Location**: .githooks/pre-commit:4-6
**Issue**: ステージしていない修正で違反が隠れる。
**Evidence**: `mise run check:model-ids` は作業ツリーの全体を走査する。
**Confidence**: medium
**Fix**: 制約を README に記載するか、ステージ済みの内容を検査する。

### [LOW] 境界の越境と、承認済み設計の実装中の改訂
**Location**: commit 5f3dc08（`AGENTS.md`、`README.md`）、0544330・288d91b（plan.md、tasks-w2〜w4）
**Issue**: Task 5 の docs commit が Task 1.5 の境界のファイルを編集した。承認済みの plan / tasks を実装中に改訂したが、再承認の記録がない。
**Evidence**: `git log 080a8e6..HEAD --stat`。do.md に承認者の記録がない。
**Confidence**: medium
**Fix**: 改訂理由と承認の記録を do.md または spec.json に残す。

### [LOW] 進捗表が古い
**Location**: specs/001-agentic-ai-platform/tasks.md（進捗表 W1 行）
**Issue**: 「未着手（現在の波）」のまま。
**Evidence**: 全サブタスクは `[x]`。
**Confidence**: high
**Fix**: 移行のコミットで更新する。

### [LOW] 遮断の範囲と実行モードの固定
**Location**: tooling/vitest/setup-hermetic.ts:124-126
**Issue**: `dgram` と `dns.lookupService` を遮断しない。plan の File Structure にある「テスト中の実行モードの固定」も担っていない（12.3 の `resolveRunMode` に依存する）。
**Evidence**: `isDnsResolverMethod` は `reverse` と `resolve*` だけ。
**Confidence**: medium
**Fix**: 対象外である旨を plan に明記するか、遮断を加える。

### [LOW] Stryker の root の解決（low confidence）
**Location**: stryker.config.mjs:15-18
**Issue**: ルートで `packages/ai-core/vitest.config.ts` を使うと、Vitest の root がルートのままになり、`include` の解決がずれるおそれがある。
**Evidence**: 未実測。
**Confidence**: low
**Fix**: W3 の締め（19.3）の前に `stryker run --dryRunOnly` で確認する。

### [LOW] 環境固有の手順が Git の追跡対象外にしかない
**Location**: specs/001-agentic-ai-platform/tasks.md Task 3 Implementation Notes
**Issue**: Rancher Desktop の `/Users/Shared` 共有の設定手順が `.serena` にしか記録されていない。
**Evidence**: Notes の3項目目。
**Confidence**: medium
**Fix**: 1-1 の解説または README のトラブルシュートに移す。

## 境界・依存・テスト完全性の確認

- **境界**: 実装のコミットは、各タスクの `_Boundary:_` にほぼ収まっている（10c3b48、ee05b10、d9cec30、01dc364、9418a09 は Task 1。f9e7aca と 956b3df は Task 2。dbf1300 は Task 3。2085577 は Task 4。e18f7dd は Task 5）。例外は L-9（5f3dc08 が `AGENTS.md` と `README.md` を編集）。`mise.toml` は共有ファイルの規則（1.1 と波の締め）に対し、01dc364（Task 1 の是正）でも編集されたが、Task 1 の境界の中である。
- **依存**: 新しい npm 依存のうち、`@types/node` だけが plan に宣言されていない（M-9）。`overrides` の `typed-rest-client>qs` は理由付きで、24時間の方針の内側にある。Actions は SHA で固定され、`mise-action` は `version: 2026.9.14` で固定されている。Compose のイメージは可変タグ（M-12、prior）。
- **テストの完全性**: 既存のテストの変更・削除・skip はない（`git log --diff-filter=MD -- '*.test.*'` は空。`.skip`・`.todo`・`.only` もない）。ただし Task 4.2 の TDD テストは一時ファイルとして削除された（M-8）。
- **非空虚**: 期待値は概ね要件文から導かれている（例: check-updates の24時間の境界 `12:00:00.000Z` / `.001Z`、model-ids の6か所の走査対象）。一方、H-1（lib を含めて数える fixture は実装の出力に合わせた値）、H-6、M-2、M-4、M-11 の変異が生き残る。

## Verdict

REQUEST_CHANGES

## Hallucination Signal

forced: false

## 対応状況

2026-09-27、メインセッションと3つのサブエージェント（ファイルの重ならない A: `check-repo-rules`、B: `check-model-ids`・`gate/count-*`・`check-updates`、C: `tooling/vitest`）がテスト先行で修正した。RED / GREEN / PROVE の証跡は `specs/001-agentic-ai-platform/pdca/do.md`「W1 Review Remediation」。

| ID | 状態 | 対応 |
|---|---|---|
| H-1 | 修正 | tsconfig のディレクトリ配下かつ `node_modules` 外のパスだけを数える。`error TS` 行・パスでない行・0件で失敗。root は 10 files |
| H-2 | 修正 | import / export / `import()` / `require()` のモジュール指定子を走査しない |
| H-3 | 修正 | `tooling/vitest/ollama.ts` に既定 URL を一元化し、local で未設定なら既定 origin だけ許可 |
| H-4 | 修正 | `turbo.json` の test 系 `env` に `AI_RUN_MODE`・`AI_LIVE_PROVIDER`・`AI_MODEL_*`・`POSTGRES_PORT` を宣言。プローブで RED→GREEN |
| H-5 | 修正 | `gate:repeat` に `TURBO_FORCE=true`。10回とも `force executing`、208件実行 |
| H-6 | 修正 | `new Function` / `Function(` / 各形式の `child_process` の違反 fixture。`require()` の検出を追加 |
| H-7 | 修正 | 遮断を記録し、setup の `afterEach` が未消費の記録で失敗させる。`consumeBlockedConnections()`。`it.fails` で配線を証明 |
| M-1 | 修正 | 許可場所を完全な相対パスで判定。埋め込み系列を追加 |
| M-2 | 修正 | 対象に `mise.toml` を追加し、インストール手順を肯定的に検査（frozen-lockfile は 2 files） |
| M-3 | 修正 | `.yaml` も走査。`write-all` と `<scope>: write` を拒否 |
| M-4 | 修正 | `hermetic-registration.test.ts`（install を呼ばない）。遮断本体を `network-guard.ts` に分離 |
| M-5 | 修正 | `${}` の中をコードとして解析。正規表現の開始条件を拡張。文字列・正規表現は改行で終わる |
| M-6 | 修正 | 語単位の照合とメタデータ語の許可（`inputTokens` 可、`promptText` 違反） |
| M-7 | 修正 | `scripts/lib/cli.mjs` の `isMainModule`（実パス比較）を5つの CLI で使用 |
| M-8 | 修正 | `/api` 付きの URL を正規化。`global-setup-local.test.ts`（32件）を恒久化 |
| M-9 | 修正 | research の依存表と plan のルート `package.json` 行に `@types/node` を記録 |
| M-10 | 修正 | `services:*` が `.env.local` を `--env-file` で渡す。README に読み込み経路を記載 |
| M-11 | 修正 | 全件 skip・executed>0 のテスト。catch を ENOENT に限定。root の pg 数からワークスペースを除外 |
| M-12 | 修正 | 6イメージを digest で固定し、Dependabot の `docker-compose` で追跡 |
| M-13 | 修正 | 名前空間 / 別名 import、`defineAciTool<...>(`、省略記法の `risk` |
| M-14 | 修正 | `AI_TEST_SUITE=pg` で `127.0.0.1`/`localhost`:`POSTGRES_PORT` を許可（plan C18 に記録）。`up -d --wait` |
| L-1 | 修正 | 空の `--only` を使い方のエラーにする |
| L-2 | 修正 | 一般の語と衝突する系列にモデル ID の形を要求。行頭索引を1回だけ作る |
| L-3 | 修正 | ブロック形式だけを受け付け、ほかの形式は違反 |
| L-4 | 修正 | `scripts/lib/scan-exclusions.mjs` を両スクリプトで使用。`.gitignore` に `.stryker-tmp/` |
| L-5 | 修正 | Actions にも `cooldown`。research の版を実測値に更新 |
| L-6 | 修正 | 7.1.x 安定版を別に報告。`AbortSignal.timeout` |
| L-7 | 修正 | lint 失敗時は既定の reporter で再実行して表示 |
| L-8 | 修正 | README に制約を記載 |
| L-9 | 承認 | do.md に改訂理由を記録。plan（C1 の mise タスク表・C18・C20・File Structure）と research（依存表）の改訂は、2026-09-27 にユーザーが承認した |
| L-10 | 先送り | W1 移行コミットで進捗表を更新 |
| L-11 | 修正 | `dgram` の `send`/`connect` と `lookupService` を遮断。実行モードの固定は C4（12.3）の担当と plan に明記 |
| L-12 | 先送り | 変異対象の `packages/ai-core` がないため、19.3 の前に `stryker run --dryRunOnly` で確認 |
| L-13 | 修正 | README のトラブルシュートに Rancher Desktop の共有設定を移した |

最終検証: `mise run gate` 成功（Biome 28、Model ID 20、W1規則 19/1/2/1 files、root test 208件実行・208件成功）、`mise run gate:repeat` 10/10、`mise run typecheck` 1/1。再レビューの結果は下に追記する。
