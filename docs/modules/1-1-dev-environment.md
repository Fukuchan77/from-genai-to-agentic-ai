# 1-1 開発環境とモダンスタック基盤

- **フェーズ**: Phase 1 基礎編（[phase-1.md](../phases/phase-1.md)）。成熟度は主に Level 1（Generative AI）。このモジュールは、以降のすべてが載る土台（モノレポ、品質ゲート、実行モード、モデルカタログ）を作ります。
- **要件**: [spec 001](../../specs/001-agentic-ai-platform/spec.md) Requirement 1、2。解説としては Requirement 7.2〜7.6、7.9、7.10 を満たします。
- **実装**: リポジトリのルート（`mise.toml`、`turbo.json`、`pnpm-workspace.yaml`、`biome.json`、`compose.yaml`）、`scripts/`、`tooling/vitest/`、`packages/ai-core/src/{config,models,mock,testing}/`、`apps/web/{instrumentation.ts,lib/server/}`

## 学習目標

このモジュールを終えると、次のことができます。

- pnpm workspaces + Turborepo のモノレポを、mise のタスク（`mise run <task>`）経由で操作できる。
- 1コマンドの品質ゲート `mise run gate` を、API キー・Docker・ネットワークなしで完走させ、各段が「0 件を走査したら失敗する」理由を説明できる。
- コードを変えずに、環境変数だけで実行モード `mock` / `local` / `live` を切り替えられ、テストでは `mock` に固定されることを説明できる。
- API キーがサーバー側（`server-only` と Route Handler）でだけ読まれ、ブラウザのバンドルに入らない仕組みを説明できる。
- Streamlit の「全行再実行」と App Router + `useChat` の「イベント駆動 + 差分描画」を、状態の置き場所の違いとして説明できる。
- ローカル依存サービス（Postgres + pgvector、Langfuse）に必要なリソースと、watsonx.ai をスキップした理由、TypeScript 7.1 先行版の方針を説明できる。

## 主要トピック

### モノレポ・mise・品質ゲートの全体像

構成は `apps/web`（Next.js）、`packages/ai-core`（`@platform/ai-core`、UI 非依存のエージェント基盤）、`packages/eval-suite`（`@platform/eval-suite`、評価）の3つのワークスペースです（Req 1.1）。依存の向きは一方向で、`apps/web` と `eval-suite` が `ai-core` に依存し、逆はありません。`ai-core` が `react` / `react-dom` / `next` / `@ai-sdk/react` を依存に持つと、`check:repo-rules` の `ai-core-no-ui-deps` 規則がゲートで失敗させます（Req 1.2）。利用側は `package.json#exports` のサブパス（例: `@platform/ai-core/models`）だけを import します。

入口は Turborepo ではなく mise のタスクです。Turborepo は `typecheck` / `test` を依存順に実行する層に徹します（[research ADR-1](../../specs/001-agentic-ai-platform/research.md)）。ツールの版は `mise.toml` に完全一致で固定されています（Node.js、pnpm、gitleaks）。

`mise run gate` は次の段を順に実行し、どれかが失敗すると非ゼロで終了します（Req 1.4）。

| 段 | 内容 | 0 件のときの扱い |
|---|---|---|
| `lint` | `biome ci`（lint と format。未使用の変数・import はエラー） | 走査ファイル数が 0 なら失敗（`scripts/gate/count-biome.mjs`） |
| `check:model-ids` | モデル ID の文字列がカタログ以外に書かれていないか（`docs/` と `README.md` も対象） | 走査ファイルが 0 なら失敗 |
| `check:repo-rules` | リポジトリの規則（9 規則。例: `frozen-lockfile`、`ai-core-no-ui-deps`、`tool-risk-declared`） | 規則ごとに検査 |
| `typecheck` | `turbo run typecheck` に続けて、tsconfig ごとの走査ファイル数を数える | tsconfig が 0 ファイルなら失敗（`scripts/gate/count-tsc.mjs`） |
| `test` | `mock` モードで全ワークスペースの Vitest を1回ずつ実行 | 実行件数が 0 なら失敗（`gate-reporter`） |

本書の執筆時点では、`docs:check`（本書を含む解説の構造検査）は W5 の締めのタスク（29.1）で `gate` の最後の段として結線される予定です。それまでは `mise run docs:check` を単独で実行します。E2E（`mise run test:e2e`）、クライアントバンドル検査（`mise run check:client-bundle`）、ミューテーションテスト（`mise run test:mutation`）も `gate` の外にあり、CI の別ジョブで実行します。`gate` に Docker は要りません（Req 1.11）。Docker が要るテストは `*.pg.test.ts` に分け、`mise run test:db` でだけ実行します。

「空振りの合格」を防ぐ仕組みが、このゲートの核です（Req 1.15）。Vitest の既定は、テストファイルが 1 件もなければ失敗しますが、ファイルがあって全件スキップなら合格にします。`gate-reporter`（`tooling/vitest/gate-reporter.ts`）は実行件数・成功・失敗・スキップ（理由別）を表示し、実行件数が 0 の実行単位を失敗にします。Ollama がなくてスキップされた `local` 限定のテストは「スキップ」として理由付きで報告され、合格には数えません（Req 1.14）。

### 実行モードとモデルカタログ

実行モードは3種です（Req 2.1）。

| モード | 呼び出し先 | 既定になる場面 |
|---|---|---|
| `mock` | ネットワークに出ない。シナリオ（述語照合）→ カセット（キー照合）→ エラー、の順に解決する。どちらにも一致しなければ、ネットワークへフォールバックせずエラーにする（Req 2.14） | テスト（Vitest 内） |
| `local` | Ollama のローカルモデル | Web アプリとハンズオン（`AI_RUN_MODE` 未設定時） |
| `live` | 商用 API。Anthropic / OpenAI / Azure OpenAI / Google を `AI_LIVE_PROVIDER` で選ぶ | 明示的に選んだとき |

モードの決定は `resolveRunMode`（`packages/ai-core/src/config/run-mode.ts`）の数行です。Vitest 内では `AI_TEST_RUN_MODE`（未設定なら `mock`）だけを見て、それ以外では `AI_RUN_MODE`（未設定なら `local`）を見ます。つまりテストの最中は、環境に `AI_RUN_MODE=live` が設定されていても `mock` になります（Req 2.5）。

用途（`chat` / `structured` / `embedding` / `judge`）ごとのモデルは、**モデルカタログ**（`packages/ai-core/src/models/catalog.ts`）の1か所で管理します。モデル ID、対応機能（ツール、構造化出力、推論、画像入力、埋め込み、プロンプトキャッシュ）、コンテキスト上限、トークン単価がそこにあります（Req 2.17）。既定は `MODEL_DEFAULTS[モード][プロバイダ][用途]` で引き、本書では `catalog: live.anthropic.chat` のように書きます。カタログ以外にモデル ID を書くと `check:model-ids` が失敗します（Req 2.18）。モデルを入れ替えても変更箇所はカタログの1か所で済み、解説の本文も腐りません。

アプリのコードは `createModelGateway` の `resolve({ purpose })` でモデルを受け取ります。ゲートウェイはモデルを作る前に、次の順で検査します。

1. カタログとモードの整合（カタログ外の ID や、`local` で `live` 専用 ID を指定した場合は `ModelSelectionError`）
2. 要求された機能に対応しているか（非対応なら、機能名とモデル名を含むエラー。Req 2.9）
3. 認証情報（未設定なら、プロバイダ名と必要な環境変数名を含むエラー。Req 2.6）
4. `local` なら Ollama の事前検査（接続できなければ、接続先 URL と `ollama serve` の案内を含むエラー。Req 2.7）

どの検査もモデル生成の前に行うので、失敗したときに外部への呼び出しは起きません。

### 環境変数の検証

環境変数は Zod のスキーマ（`config/env-schema.ts`）で検証し、機能ごとの必須変数は `FEATURE_REQUIREMENTS` に集約しています。必須の変数が不足していると、`ConfigError` が不足した変数名とそれを必要とする機能名を列挙します（Req 1.9）。たとえば `live` + Azure で Tavily も使う構成なら、`AZURE_API_KEY`（`live-azure`）、`AZURE_RESOURCE_NAME`（`live-azure`）、`TAVILY_API_KEY`（`web-search`）がまとめて報告されます。1つずつ直しては起動し直す往復をなくすためです。

Web アプリでは `apps/web/instrumentation.ts` の `register()` が、サーバーの起動時に `loadPlatformConfig` を呼びます。設定の誤りは最初のリクエストではなく起動時に、値を出力せずに（変数名と機能名だけ）報告されます。変数名の一覧は `.env.example` にあり（値は空）、`.env.local` にコピーして使います。`.env.local` はバージョン管理の対象外です。

### Streamlit の全行再実行モデルと App Router の差分ストリーミング

Streamlit は、ウィジェットを操作するたびに**スクリプトを先頭から最後まで再実行**します。画面は「スクリプトの出力そのもの」で、再実行をまたいで残したい値は `st.session_state` に置きます。書き手は状態遷移を考えずに「上から下へ読める」手続きを書けます。代わりに、1回の操作のたびに全体を再計算し（重い処理は `@st.cache_*` で避ける）、応答の途中経過を出すには `st.write_stream` などの専用の仕組みが要ります。

App Router + React では、モデルが違います。画面は**状態の関数**で、状態が変わったコンポーネントだけが再描画され、React が前回との差分を DOM に反映します。操作は**イベントハンドラ**で受け、「何が変わるか」を状態の更新として書きます。

本リポジトリのチャットの流れで、この違いを確かめます。

1. 送信ボタンの `onSubmit` が `sendMessage()` を呼ぶ（`apps/web/components/chat/ChatPanel.tsx`）。ページ全体は再実行されません。
2. `useChat` が `/api/chat` の Route Handler に POST する。Route Handler は `streamText` の結果を **UI メッセージストリーム**（SSE）として返します。
3. トークンが届くたびに `useChat` が `messages` の状態を更新し、React が**変わった末尾のメッセージだけ**を DOM に反映します。入力欄、モデル選択、過去のメッセージは再描画されても内容は変わりません。

ここで注意するのは、トークンの逐次表示を担っているのは Server Components のストリーミング描画ではなく、**クライアント側の `useChat` が受ける UI メッセージストリーム**だという点です。App Router の RSC ペイロードも差分で届きます（遷移時に変わったセグメントだけを取得し、`Suspense` の境界ごとに HTML を順次流します）が、チャットの応答はそれとは別の経路です。本書で言う「差分ストリーミング」は、(1) サーバーからはチャンクの列として届き、(2) クライアントでは状態の差分として画面に反映される、という2段を指します。

Streamlit の手軽さ（状態遷移を意識しなくてよい）は、移植で諦めたものの1つです。代わりに、操作ごとに全体を再計算しないこと、応答の途中経過をそのまま扱えること、サーバーとクライアントの責務を分けられることを得ます。

### Server / Client Components の境界

App Router のコンポーネントは、既定で **Server Components** です。サーバーだけで実行され、そのコードと依存はブラウザに送られません。`"use client"` を先頭に書いたファイルから先が **Client Components** で、ブラウザで実行され、`useState` や `useChat` などのフックとイベントハンドラを使えます。

本リポジトリの実際の境界は次のとおりです。

| 場所 | 種類 | 役割 |
|---|---|---|
| `apps/web/app/chat/page.tsx` | Server Component（`async`、`dynamic = "force-dynamic"`） | `getPlatform()` でゲートウェイを取り、利用可能なモデルの一覧を計算して、Client Component へ props で渡す |
| `apps/web/components/chat/ChatPanel.tsx` | Client Component（`"use client"`） | `useChat`、入力欄、モデル・ペルソナの選択状態 |
| `apps/web/components/ui/` の `dialog` / `select` | Client Component | Radix ベースの部品 |
| `apps/web/app/api/*/route.ts` | Route Handler（サーバー） | リクエストの検証、モデル解決、ストリーム生成 |
| `apps/web/lib/server/platform.ts` | `import "server-only"` | 設定・ゲートウェイ・ポートの組み立て |

境界を越えるのは、**シリアライズできる値だけ**です。`ChatPanel` へ渡す `models` は、`gateway.availableModels()` が返す `ModelOption`（ID、表示名、プロバイダ、対応機能、コンテキスト上限）で、認証情報やクライアントオブジェクトを含みません。この性質は `createModelGateway availableModels` のテストが確かめています。型定義 `models/types.ts` が Zod 非依存であるのも、Client Component から import できるようにするためです。

判断の目安は次のとおりです。状態・イベント・ブラウザ API が要るなら Client、データ取得・秘密情報・重い依存（`jsdom` など）が要るなら Server。迷ったら Server に置き、`"use client"` は「葉」に近い小さなコンポーネントに限ります。

なお、`next.config.ts` の `reactCompiler: true` により **React Compiler** が自動でメモ化します。手書きの `useMemo` / `useCallback` を前提にしません（Python の `@st.cache_data` に当たる最適化を、コンパイラに任せる感覚です）。

### API キーのサーバー側実行

API キーは3つの層でサーバー側に閉じます（Req 1.10）。

1. **読む場所を限る。** キーは環境変数から `loadPlatformConfig` が読み、`PlatformConfig.credentials` に入れます。この読み取りが行われるのは `lib/server/platform.ts`（`server-only`）の経由だけです。`NEXT_PUBLIC_` を付けた変数（付けるとブラウザに配信されます）は、秘密情報には使いません。
2. **境界を越えさせない。** Client Component には `ModelOption` のようなキーを含まない値だけを渡します。クライアントのコードは環境変数名を書きません。
3. **ビルド成果物を検査する。** `mise run check:client-bundle` が、秘密情報の番兵値（`changeme-bundle-sentinel-*`）を注入して `next build` し、`.next/static`（ブラウザへ配信される側）を走査します。キーの変数名（`API_KEY`、`SECRET`、`PASSWORD` などを含む名前）か番兵値が見つかれば失敗し、見つかった値は出力しません。走査したファイルが 0 件でも失敗します。

エラーメッセージにも注意が要ります。プロバイダの例外メッセージにはリクエストの内容やキーが含まれ得るので、`/api/chat` はクライアントに固定の日本語メッセージだけを返します。

### 版の方針: TypeScript 7.1 先行版と後退の記録

版は「実装時点の最新安定版を、完全一致で固定する」のが原則です（範囲指定は使いません）。そのうえで次世代志向として、Node.js v26 と TypeScript 7.1 先行版を先行採用しています（spec 001 Technical Constraints）。

- **完全一致の固定**: 4つの `package.json`（ルート、`apps/web`、`packages/ai-core`、`packages/eval-suite`）で、`typescript` は同じ先行版ビルドに固定しています（本書の執筆時点では `7.1.0-dev.20261009.1`）。
- **24 時間ルール**: `pnpm-workspace.yaml` の `minimumReleaseAge: 1440` により、公開から 24 時間未満の版は解決されません。インストールスクリプトの実行は `allowBuilds` で理由を付けて許可したパッケージに限ります。
- **コンパイラ API に依存するツールは採らない**: TypeScript 7 はネイティブ実装で、JS のコンパイラ API を持ちません。`ts-morph`、型情報を使う `typescript-eslint` のルール、Stryker の `typescript-checker` は使いません。
- **確認手段**: `mise run outdated` が、先行版の新しいビルドや正式版の公開（`scripts/check-updates.mjs`）と、`watsonx-ai-provider` の `ai@^7` 対応を報告します。
- **後退の条件**: 先行版に起因する非互換があり、代替もない場合に限り、影響するツールまたはワークスペースだけを TypeScript 6.x 安定版へ後退させ、範囲・理由・解除条件を記録します。

**後退の記録（M1 時点）**: TypeScript 6.x へ後退したワークスペースとツールは**ありません**（[research ADR-2](../../specs/001-agentic-ai-platform/research.md)）。代わりに、TypeScript 7 と Vitest 5 の組み合わせで起きた Stryker の非互換には、後退ではなく**局所的な回避**を取りました。内容と解除条件は次のとおりです。

| 回避 | 理由 | 解除条件 |
|---|---|---|
| `stryker.config.mjs` の `tsconfigFile` を存在しないファイルに向ける | Stryker は `tsconfigFile` を TypeScript の JS API（`ts.parseConfigFileTextToJson`）で書き換えるが、TypeScript 7 にその API がない | Stryker が TypeScript 7 に対応したら外す |
| `pnpm patch` で `@stryker-mutator/vitest-runner` を修正（`patchedDependencies`） | 変異ごとのテスト名の絞り込みが `suite test`（空白区切り）で、Vitest 5 の `suite > test` に一致せず、全変異が生き残る（実測 8.40%）。回避後は 88.80% | Stryker が Vitest 5 に対応したら外す |
| `overrides` で `typed-rest-client>qs` を引き上げる | Stryker の推移的依存の脆弱性（GHSA）を避けるため | Stryker が修正版の依存を取り込んだら外す |

各エントリの直前には、理由と外す条件のコメントが `pnpm-workspace.yaml` にあります。コメントのない `allowBuilds` / `overrides` / `patchedDependencies` は、`check:repo-rules` が失敗させます。

### watsonx.ai をスキップした理由

IBM watsonx.ai は、AI SDK v7 に対応したプロバイダ実装が存在する場合に限って提供する方針でした（Req 2.2）。2026-09-27 にレジストリで実測した結果は次のとおりです（[research I-7](../../specs/001-agentic-ai-platform/research.md)）。

- `watsonx-ai-provider` 2.0.0 は、`peerDependencies` が `ai: ^6.0.0` と `@ai-sdk/provider: ^3.0.8` で、AI SDK v7 に**非対応**。
- IBM 公式を名乗る `@ibm-cloud/watsonx-ai-provider` は存在しない（レジストリが 404）。

そのため M1 では watsonx.ai を、プロバイダの選択肢（`AI_LIVE_PROVIDER` は anthropic / openai / azure / google のみ）、モデルカタログ、設定項目から除外しています（Req 2.10）。復活の条件は、`ai@^7` に対応した版が出ることです。`mise run outdated` がその状況を報告します。v6 用の実装を v7 に無理に合わせるより、スキップを明示するほうが、学習者の環境で壊れる箇所が少なくなります。

### ローカル依存サービスと Langfuse の必要リソース

ハンズオン用の依存サービスは `compose.yaml` に、2つのプロファイルで定義しています。**品質ゲートには不要**で、M2 以降（RAG、トレース）の準備です。

| プロファイル | コンテナ | 起動するタスク |
|---|---|---|
| `db` | `postgres`（pgvector 入り、PostgreSQL 17） | `mise run services:up:db` |
| `trace` | `langfuse-web`、`langfuse-worker`、`clickhouse`、`redis`、`minio`（Langfuse 4 系の構成。`postgres` を共用） | `mise run services:up`（`db` と `trace` の両方） |

停止は `mise run services:down` です。

**Langfuse の必要リソース**は、公式の推奨で **4 コア / 16 GiB メモリ / ストレージ 100 GiB** です（[research I-9](../../specs/001-agentic-ai-platform/research.md)）。構成サービスは、`langfuse-web`（UI。既定のポートは 3000）、`langfuse-worker`、`clickhouse`（トレースの分析用ストア）、`redis`（キューとキャッシュ）、`minio`（S3 互換のオブジェクトストア）、`postgres`（メタデータ）の6つです。学習者1人のノート PC には重い構成なので、次の工夫をしています（[ADR-12](../../specs/001-agentic-ai-platform/research.md)）。

- プロファイルを分け、`services:up:db` では pgvector の1コンテナだけを起動する。M2 の RAG はこれで足ります。
- Langfuse 用のデータベースを別のサーバーではなく、`postgres` コンテナ内の別データベース（`infra/postgres/init/01-extensions.sql` が作成）に同居させ、メモリを抑える。
- すべてのポートを `127.0.0.1` にだけ公開する。

`compose.yaml` が参照する版（イメージはダイジェストで固定）は、`clickhouse` が 26.6、`redis` が 8、PostgreSQL が 17 です。research に記録された調査時点の版（clickhouse 25.12、redis 7）とは異なるため、実際の構成は `compose.yaml` を正としてください。メモリの実消費は、本書の執筆では計測していません。16 GiB 未満の環境では、`docker stats` で確かめてから使ってください。Langfuse の認証情報（`LANGFUSE_NEXTAUTH_SECRET` など）の既定値は開発用の仮の値なので、ポートを外部に公開する場合は必ず変更します。OTLP でトレースを送る実装は M4（spec 004）で扱います。M1 では起動と必要リソースの把握までです。

## ハンズオン手順

各手順の「実行モード」と「外部サービス」を確かめてから始めます。実行はリポジトリのルートで行います。

### 手順 1: クリーンな clone で品質ゲートを通す

- 実行モード: `mock`
- 外部サービス: なし（API キー、Docker、ネットワークは不要。依存のインストール時だけネットワークを使う）

```bash
mise install
mise run setup
mise run gate
```

`mise run setup` は `pnpm install --frozen-lockfile` とフックの設定を行います。`gate` の各段が走査した件数（Biome のファイル数、tsconfig ごとのファイル数、`Gate test summary: executed=… passed=… failed=… skipped=…`）を読み、`skipped` の理由（Ollama がない `local` 限定テストなど）を確かめます。`mise run gate:repeat` は 10 回連続で同じ結果になることを確かめます（時間がかかるため任意）。

### 手順 2: Ollama を起動し、既定の `local` モードで Web アプリを動かす

- 実行モード: `local`
- 外部サービス: Ollama（起動と、`catalog: local.ollama.chat` のモデルの取得）

```bash
ollama serve                      # 別のターミナルで
cp .env.example .env.local        # 値は空のままでよい（local の既定で動く）
mise exec -- pnpm --filter web dev
```

`http://localhost:3000/chat` を開いてメッセージを送ります。モデルの取得が済んでいないと、事前検査が取得すべきモデル名を示します。Ollama を止めてから送ると、接続先 URL と起動方法を含むエラーが出ることも確かめます。`mise run test:local` は `local` 限定のテスト（`catalog.local.test.ts` など）を実行します。

### 手順 3: 必須の環境変数を外して起動し、エラーを確かめる

- 実行モード: `live`（認証情報を意図的に外すため、LLM の呼び出しは発生しない）
- 外部サービス: なし

```bash
AI_RUN_MODE=live AI_LIVE_PROVIDER=anthropic mise exec -- pnpm --filter web dev
```

`ANTHROPIC_API_KEY` を設定していない状態では、起動時に `[設定エラー]` と、不足した変数名とその機能名（`live-anthropic`）が出力されます。`AI_LIVE_PROVIDER=azure` に変えて、変数名が複数列挙されることも確かめます。キーの値がどこにも出力されないことを確認します。

### 手順 4: ローカル依存サービスをコンテナで起動し、リソースを確かめる

- 実行モード: `mock`（サービスを起動するだけで、LLM は呼ばない）
- 外部サービス: Docker（`pgvector/pgvector` と Langfuse 一式のイメージ。初回はイメージの取得にネットワークを使う）

```bash
mise run services:up:db     # pgvector だけ
docker stats --no-stream
mise run services:up        # Langfuse 一式を追加（16 GiB 推奨）
docker stats --no-stream
mise run services:down
```

追加で起動したコンテナの数と、メモリ使用量の増え方を比べます。Langfuse の UI は `http://localhost:3000` です（Web アプリの開発サーバーと同じ 3000 番のため、同時に使う場合は `LANGFUSE_PORT` か Next.js 側のポートを変えます）。

### 手順 5: クライアントバンドルに秘密情報が入らないことを確かめる

- 実行モード: `mock`
- 外部サービス: なし

```bash
mise run check:client-bundle
```

タスクは番兵値を環境変数に注入して `next build` し、`.next/static` を走査します。成功時に出る走査ファイル数が 0 でないことを確かめます。次に、試しに Client Component（例: `ChatPanel.tsx`）で `process.env.ANTHROPIC_API_KEY` を参照するコードを書き、再実行してどう検出されるかを観察します（確かめたら元に戻します）。

## 習熟度判定チェックリスト

自動テストで確かめられる項目には、テストへの参照を付けています。

- [ ] クリーンな clone から、キーなしで `mise run gate` を成功させられる（手順 1。Req 1.3〜1.5、1.11）
- [ ] ゲートの `test` 段が、全件スキップを合格にせず、実行件数 0 を失敗にする理由を説明できる <!-- test: tooling/vitest/gate-reporter.test.ts#fails a gate execution unit whose tests were all skipped -->
- [ ] lint 段が、走査したファイル数 0 を失敗にする理由を説明できる <!-- test: scripts/gate/count.test.mjs#fails when Biome scanned zero files -->
- [ ] テストの実行中は、`AI_RUN_MODE` の設定に関わらず実行モードが `mock` になる <!-- test: packages/ai-core/src/config/run-mode.test.ts#defaults to mock inside the test runner and honors only the test override -->
- [ ] モックされていない通信（`fetch`、ソケット、名前解決）が、接続先を含むエラーでテストを失敗させる <!-- test: tooling/vitest/hermetic-registration.test.ts#blocks fetch, net.connect, and dns.lookup without an explicit install -->
- [ ] 必須の環境変数が不足すると、不足した変数名と機能名が列挙される <!-- test: packages/ai-core/src/config/load.test.ts#lists every missing variable with the feature that requires it -->
- [ ] Web アプリの起動時に、不足した変数名と機能名が報告され、起動が止まる <!-- test: apps/web/instrumentation.test.ts#lists every missing variable with its feature and stops startup -->
- [ ] 認証情報のないプロバイダは、モデルを作る前に、プロバイダ名と環境変数名を含むエラーになる <!-- test: packages/ai-core/src/models/gateway.test.ts#rejects a provider without credentials before building any model -->
- [ ] 非対応の機能を要求すると、呼び出し前に、機能名とモデル名を含むエラーになる <!-- test: packages/ai-core/src/models/gateway.test.ts#rejects an unsupported capability with the capability and model names -->
- [ ] Ollama に接続できないと、接続先 URL と起動方法を含むエラーになる <!-- test: packages/ai-core/src/models/gateway.test.ts#raises OllamaUnavailableError with the URL and start guidance before building a model -->
- [ ] Client Component に渡すモデルの一覧が、認証情報を含まないシリアライズ可能な値である <!-- test: packages/ai-core/src/models/gateway.test.ts#returns plain serializable options for the client -->
- [ ] クライアントバンドルに秘密情報の番兵値が入ると検査が失敗し、値は出力されない <!-- test: scripts/check-client-bundle.test.mjs#detects a sentinel secret value without echoing the value -->
- [ ] モデル ID の文字列が、`docs/` を含むカタログ以外の場所にあると検査が失敗する <!-- test: scripts/check-model-ids.test.mjs#scans every declared source and documentation location in deterministic order -->
- [ ] Streamlit の再実行モデルと、App Router + `useChat` の状態更新・差分描画の違いを、状態の置き場所で説明できる
- [ ] 任意のコンポーネントについて、Server と Client のどちらに置くかを理由付きで決められる
- [ ] Langfuse の構成サービス、推奨リソース、`db` と `trace` のプロファイルを分けた理由を説明できる
- [ ] watsonx.ai をスキップした理由と、復活の条件を説明できる
- [ ] TypeScript 7.1 先行版の方針（完全一致、24 時間ルール、後退の条件）と、Stryker の回避の理由を説明できる

## リファレンス実装とテストの所在

| 項目 | パス |
|---|---|
| mise タスク（`gate`、`services:*`、`test:*`） | `mise.toml` |
| ワークスペース・版・サプライチェーン設定 | `pnpm-workspace.yaml`、`package.json`、`turbo.json`、`tsconfig.base.json`、`biome.json` |
| ローカル依存サービス | `compose.yaml`、`infra/postgres/init/01-extensions.sql` |
| CI | `.github/workflows/ci.yml` |
| 環境変数のスキーマと機能別の必須変数 | `packages/ai-core/src/config/{env-schema,feature-requirements,load,run-mode}.ts` |
| 環境変数・実行モードのテスト | `packages/ai-core/src/config/*.test.ts` |
| モデルカタログとゲートウェイ | `packages/ai-core/src/models/{catalog,gateway,ollama-preflight,providers,types}.ts` |
| カタログ・ゲートウェイのテスト | `packages/ai-core/src/models/{catalog,gateway,ollama-preflight}.test.ts`、`catalog.local.test.ts`（`local` 限定） |
| モックの実行基盤（シナリオ、カセット、決定論的な埋め込み） | `packages/ai-core/src/mock/`、`packages/ai-core/fixtures/` |
| 起動時の設定検証 | `apps/web/instrumentation.ts`、`apps/web/instrumentation.test.ts` |
| サーバー側の組み立て（`server-only`） | `apps/web/lib/server/platform.ts` |
| Server / Client の境界の実例 | `apps/web/app/chat/page.tsx`、`apps/web/components/chat/ChatPanel.tsx` |
| ネットワーク遮断・空振り検査 | `tooling/vitest/{setup-hermetic,network-guard,gate-reporter}.ts` とそのテスト |
| ゲート補助スクリプト | `scripts/gate/{count-biome,count-tsc}.mjs`、`scripts/check-{model-ids,repo-rules,client-bundle,updates,docs}.mjs` とそのテスト |
| Stryker の回避 | `stryker.config.mjs`、`patches/` |

## 元教材との対照表

| 元教材（Python / LangChain / LangGraph）の対応箇所 | TypeScript / AI SDK 版での置き換え | 移植で諦めたもの |
|---|---|---|
| 1_llm-agent 第1章 はじめに（LLM アプリ開発の動向、Python / Streamlit を選んだ理由） | 解説（1-0、本書）で、AI SDK の設計思想と Next.js を選んだ理由を扱う | なし |
| 1_llm-agent 第2章 開発環境（pyenv / venv、`pip install`、API キーの取得） | mise による Node.js・pnpm の固定、pnpm workspaces + Turborepo、`.env.local`、`mise run gate` | ノートブック（Colab / Jupyter）での対話的な試行 |
| Streamlit の入力フォームとスクリプトの再実行（第3章の画面部分） | Next.js App Router、Server / Client Components、`useChat`（1-2 で実装） | 全行再実行モデルの手軽さ。イベントハンドラと状態管理を自分で書く必要がある |
| `st.session_state`、`st.secrets`、`.env` | React の状態（`useState`、`useChat`）、サーバー側の環境変数と `server-only` | セッションをまたぐ状態の永続化（`useChat` の履歴は保存しない） |
| プロバイダ別の接続（`langchain-openai`、`langchain-anthropic` など） | `@ai-sdk/*` と Ollama のプロバイダを、モデルカタログとゲートウェイ経由で解決 | LangChain の統合パッケージ群。watsonx.ai（v7 対応の実装がないためスキップ） |
| 手動の動作確認と、テストの不在 | `mock` / `local` / `live` の3層、シナリオ・カセット、ネットワーク遮断、1コマンドの `gate` | なし |
| LangSmith、LangGraph Studio による観察 | OpenTelemetry + Langfuse（M1 では起動と必要リソースの把握まで。送信は M4） | LangGraph Studio によるグラフの可視化とデバッグ。LangGraph の reducer・checkpointer・`interrupt` による耐久的な中断・再開は、このモジュールの範囲外 |
| デプロイ（Streamlit Community Cloud） | 対象外（ローカルで完結） | クラウドへの公開 |

## 移植時の変更点

[changes-from-drafts.md](../../specs/curriculum/changes-from-drafts.md) と実装時の実測から、このモジュールに関わる変更点を示します（Req 7.4）。

- **版の方針（§2）**: 版の下限指定（`v26.10+` など）ではなく、実装時点の最新安定版を完全一致で固定します。実行環境は Node.js v26、TypeScript 7.1 先行版（全ワークスペース）、Zod 4、Next.js 16 に統一します。React 19 と React Compiler（Babel プラグイン）は別のパッケージとして固定します。TypeScript の後退は条件付きで、M1 時点で後退したものはありません（前掲の記録）。
- **実行モード（§2）**: 提供者を OpenAI / Anthropic / Google の3社とする記述を、`mock` / `local`（Ollama）/ `live`（Anthropic / OpenAI / Azure OpenAI / Google）の3層に改めました。watsonx.ai は v7 対応の実装がないためスキップしています。
- **モデル ID（§2）**: コード例と本文に具体的なモデル ID を書く方式をやめ、モデルカタログに集約しました。用途別の既定もカタログで決めます。本書はカタログへの参照（`catalog: live.anthropic.chat` など）だけを書きます。採用したモデルの実体は `catalog.ts` を見てください。
- **設定ファイル（§4）**: Biome は、タブ・ダブルクォート・行幅 100・セミコロンあり（ドラフトの 2 スペース・シングルクォートは採用しない）。`noUnusedVariables` と `noUnusedImports` は `error`。`next.config.ts` は `reactCompiler: true` と `typedRoutes: true`（ドラフトの `turbo: {}` と `experimental.reactCompiler` は使わない）。学習者と CI の入口は `turbo.json` ではなく mise のタスクです。
- **リポジトリ構成（§5）**: パッケージ名は `@agentic/ai-core` ではなく `@platform/ai-core`、`@platform/eval-suite`、`web`（非公開）。3_genai-agent の `packages/agents/*` の構成は採らず、`packages/ai-core` に領域を足します。
- **外部サービス（§6）**: ベクトルストアは、ローカルの Postgres + pgvector（Docker Compose）に統一しました。トレースは OTLP でエクスポートし、既定の収集先を Langfuse とします（Braintrust 連携は対象外）。
- **実測で確定した事項**: pnpm 12 と Turborepo の組み合わせで `turbo run` が動くこと。TypeScript 7.1 先行版でも `tsc -p <tsconfig> --listFilesOnly` が使え、走査件数の検査（`count-tsc`）に利用できること。Stryker と Vitest 5 / TypeScript 7 の非互換と回避（前掲）。Langfuse の構成は research の調査時点から版が上がっていること（前掲）。

## Python / Streamlit 経験者向けコラム

Streamlit で作ったアプリを移植するとき、手が止まりやすい対応を並べます。

| Streamlit（Python） | Next.js App Router（TypeScript） | 違いの要点 |
|---|---|---|
| スクリプトが操作のたびに先頭から再実行される | 状態が変わったコンポーネントだけが再描画される。操作はイベントハンドラ（`onSubmit` など）で受ける | 「上から下に書けば画面になる」から、「状態とハンドラを定義する」へ。再実行を前提にした書き方（毎回の初期化）を持ち込むと二重に動く |
| `st.session_state["messages"]` | `useChat` の `messages`、`useState` | 状態はコンポーネントごとに持つ。このアプリは会話を保存しないので、再読み込みで消える |
| `st.chat_input` + `st.write_stream` | `useChat` の `sendMessage` と、Route Handler の UI メッセージストリーム | 逐次表示は状態の更新として届く。途中で止める `stop()` と、再送の `regenerate()` も状態の一部 |
| `@st.cache_data` / `@st.cache_resource` | React Compiler の自動メモ化。プロセスで共有する資源は `globalThis` に1回だけ作る（`getPlatform()`） | 手書きの `useMemo` / `useCallback` を前提にしない。開発サーバーのモジュール再読み込みで共有資源が作り直されないよう注意 |
| `st.secrets`、`.streamlit/secrets.toml`、`.env` + `python-dotenv` | `.env.local` + `server-only` + Route Handler / Server Component | **Streamlit は全コードがサーバーで動く**ので、キーがブラウザに出る経路がない。Next.js では Client Component に書いたコードはブラウザに届くため、境界を自分で守る。`NEXT_PUBLIC_` は公開の宣言になる |
| `requirements.txt` / `venv` | `pnpm-lock.yaml`（`--frozen-lockfile`）と mise による Node.js・pnpm の固定 | ロックファイルを CI が検査する。24 時間未満の版は解決されない |
| 起動してから動かないと気づく設定ミス | `instrumentation.ts` が起動時に環境変数を検証し、変数名と機能名を出す | 失敗を最初のリクエストまで遅らせない |
| `pytest` と実 API を叩く手動確認 | `mock` が既定のテスト、通信は遮断。`local` / `live` はハンズオンで | テストが外部に出ようとすると、接続先を含むエラーで失敗する |

境界の考え方を1つだけ挙げると、Streamlit では「画面を作るコード」と「秘密を扱うコード」が同じ場所にあってもかまいませんでした。Next.js では、画面を作るコード（Client Component）は**公開されるコード**だと考えます。秘密はサーバー側のファイルに置き、`server-only` を import して、うっかり Client から参照したときにビルドで失敗させます。

## 完成時点のタグ

- **タグ**: `module/1-1`（注釈付きタグ）。付与はタスク 14.6 で、ModelGateway の完成（14.1〜14.5）までを統合したコミットに対して行います。指すコミットは `f671813` で、タスク 29.4 で人間の承認後にリモートへ push しました（2026-10-12）。`git fetch --tags` で取得し、`git diff module/1-1` で自分の作業と比べられます。
- **含まれるもの**: モジュール 1-1 のリファレンス実装（Req 1、2）。モノレポ基盤（pnpm workspaces、Turborepo、mise タスク、Biome、TypeScript の設定）、品質ゲートとゲート補助スクリプト、ネットワーク遮断とゲートレポーター、`compose.yaml`、`@platform/ai-core` の `config`・`models`（モデルカタログとゲートウェイ）・`mock`・`ports`・`testing`、`@platform/eval-suite` と `apps/web` の土台。
- **含まれないもの**: E2E テスト（`apps/web/e2e`、Playwright）と、本書を含む解説（`docs/`）は含まれません（plan C22）。後続のモジュールの実装（1-2 のストリーミングチャットと `ToolLoopAgent`、1-3 の要約パイプライン、Route Handler と各ページ）も含まれません。
