# ドラフトとの差分

清書時に、設計ドラフト（2026-09-27 にリポジトリから削除）の記述を spec 001〜004 と 001 の plan / research の決定に合わせて改めた点を記録する。「根拠」の列は、その決定を定める文書を指す。

各モジュールの解説に載せる移植時の変更点（001 Req 7.4）は、この記録と実装時の実測を元に書く。ドラフトはリポジトリに残していないため、ドラフトの記述を確かめる必要がある場合も、この記録を正とする。

## 1. 構成と範囲

| ドラフトの記述 | 確定版 | 根拠 |
|---|---|---|
| 4 フェーズ・全 16 モジュール（マスター §1） | 4 フェーズ・19 モジュール。「16」は誤記で、マスターの本文は 14 モジュール。他のドラフトから5モジュール（1-0、2-4、3-5、3-6、4-5）を復元した | 001 Clarifications（Session 2026-09-26、2026-09-26 (2)） |
| 第1週〜第14週の週割り | 週割りは定めない。マイルストーン（M1〜M4）単位で進め、後続 spec の要件は先行マイルストーンの実装後に承認する | 001 Overview、constitution 原則 9 |
| 対象者: フルスタックエンジニア・アーキテクトの育成、非エンジニアや機械学習の初学者 | Python / LangChain で LLM アプリを学んだ（学ぼうとしている）エンジニアが、一人で設計・構築・評価できるようになること | 001 Overview |
| 書籍・Web Book の改訂ロードマップ（各ドラフトの末尾） | カリキュラムとリファレンス実装のマイルストーンに置き換えた | 001 Overview |
| Vercel へのデプロイ、エッジランタイム、サーバーレスのタイムアウト対策 | 対象外（任意の付録扱い）。ローカル完結を前提とする | 001 Clarifications、Out of Scope |
| Clerk によるユーザー認証、Upstash Redis による分散レート制限 | 認証は対象外。レート制限は `live` モードで、単一プロセス内で行う | 001 Req 3.11、Out of Scope |
| 章ごとの完成版を Git ブランチで配布 | モジュールの完成時点をタグ（`module/<phase>-<n>`）で提供する | 001 Req 7.11、plan C22 |
| 状態の DB への退避・復元、耐久ワークフロー | セッションをまたいだ永続化と耐久的な中断・再開は扱わない | 001 Out of Scope、004 Req 4.5 |
| MCP 以外のエージェント間連携 | A2A / ACP は対象外。MCP との役割の違いを 003 の解説で触れる | 001 Out of Scope |

## 2. 技術スタックと版

| ドラフトの記述 | 確定版 | 根拠 |
|---|---|---|
| 版の下限指定（`v26.10+`、`v16.4+`、`v7.0+` 等） | 実装時点の最新安定版を完全一致で固定する。確認済みの版は research の External dependencies に記録する | 001 Technical Constraints、research |
| ドラフトごとに異なる実行環境（Node.js 20 / 22、Bun、TypeScript 5.x、Zod 3、Next.js 15） | Node.js v26、TypeScript 7.1 先行版（全ワークスペース、完全一致）、Zod 4、Next.js 16 に統一する | 001 Technical Constraints、research I-8 |
| 「React Compiler 19.3」 | React 19 と React Compiler（Babel プラグイン）は別のパッケージとして固定する | research External dependencies |
| TypeScript の版の扱いに規定なし | 非互換のツールまたはワークスペースに限って TypeScript 6.x へ後退できる。範囲・理由・解除条件を記録する。コンパイラ API に依存するツールは採らない | 001 Technical Constraints、research ADR-2 |
| 提供者を OpenAI / Anthropic / Google の3社とする | 実行モードを `mock` / `local`（Ollama）/ `live` の3層にする。`live` は Anthropic / OpenAI / Azure OpenAI / Google。IBM watsonx.ai は AI SDK v7 対応の実装がある場合だけ提供し、2026-09 時点ではスキップする | 001 Req 2、research I-7 |
| コード例と本文に具体的なモデル ID を書く | モデル ID はモデルカタログだけに書く。用途（チャット、構造化出力、埋め込み、評価器）ごとの既定モデルもカタログで決める | 001 Req 2.8、2.17、2.18、constitution 原則 8 |

## 3. AI SDK の API

ドラフトは AI SDK v4〜v6 の API 名で書かれている。v7 での対応は research の [I-1](../001-agentic-ai-platform/research.md#i-1-ai-sdk-v7-のバージョンと改名) 〜 I-6 にある。

| ドラフトの記述 | 確定版 | 根拠 |
|---|---|---|
| AI SDK Core の「4大プリミティブ」（`generateText`、`streamText`、`generateObject`、`streamObject`） | `generateText` / `streamText` に `output: Output.object(...)` を渡して構造化出力を得る。`generateObject` / `streamObject` は使わない。エージェントは `ToolLoopAgent` | 001 Clarifications（Session 2026-09-26 (2)）、constitution 原則 1 |
| `tool({ parameters: z.object(...) })` | `inputSchema` で入力を定義する。ツールはリスク区分と時間上限を強制するラッパで定義する | 001 Technical Constraints、plan C9 |
| `maxSteps: N` でエージェントループを回す | `ToolLoopAgent` の `stopWhen`（`isStepCount` 等）に、ステップ数・累積トークン・実行時間の3種の停止条件を必ず設定し、停止理由を閉じた語彙で返す | 001 Req 6、plan C8 |
| `generateText({ tools, maxSteps })` を自律エージェントとして使う | LLM が制御フローを決める処理は `ToolLoopAgent`、コードが決める処理（ワークフロー）は `generateText` / `streamText` の合成、と使い分ける | 001 Clarifications、002 Req 3.13 |
| `toDataStreamResponse()`、`createDataStream` によるストリーム | UI メッセージストリーム（`createUIMessageStream` / `createUIMessageStreamResponse`、エージェントは `createAgentUIStreamResponse`）。進行状況やメタデータは型付きのデータパートで送る | research I-1、I-4、research ADR-8 |
| `ai/react` の `useChat`（`input`、`handleInputChange`、`handleSubmit`、`attachments`） | `@ai-sdk/react` の `useChat` と `DefaultChatTransport`（`sendMessage`、`stop()`、`regenerate()`）。画像はメッセージのファイルパートとして送る | research I-5 |
| `experimental_telemetry` によるトレース | AI SDK の telemetry と OpenTelemetry 連携で、スパンを OTLP でエクスポートする | research I-1、004 Req 5 |
| Generative UI を「AI が React コンポーネントを直接描画する」方式として説明 | ツール呼び出しや構造化出力の結果を、登録した型付きの UI コンポーネントで描画する。表示部品が未登録の結果は JSON で表示する | 001 Req 5.5、plan C16 |

## 4. 設定ファイル

| ドラフトの記述 | 確定版 | 根拠 |
|---|---|---|
| `biome.json`: 2 スペース、シングルクォート、行幅 100、セミコロンあり | タブ、ダブルクォート、行幅 100、セミコロンあり。`noUnusedVariables` と `noUnusedImports` は明示的に `error` | 001 Req 1.6、research ADR-3 |
| `next.config.ts`: `turbo: {}` と `experimental.reactCompiler` | `reactCompiler: true` と `typedRoutes: true` を設定する（ドラフトの `turbo: {}` と `experimental` 配下の指定は使わない） | plan C13 |
| `turbo.json` を入口にする | 学習者と CI の入口は mise のタスク（`mise run gate`）。Turborepo は `typecheck` / `test` / `build` を依存順に実行する層として使う | research ADR-1 |

## 5. リポジトリ構成

| ドラフトの記述 | 確定版 | 根拠 |
|---|---|---|
| マスター §3.1 の構成（`api/agent/helpdesk`、`api/agent/analyst`、`components/agent/*`、`ai-core/src/{workflows,agents,aci,harness}`） | 骨格（`apps/web`、`packages/ai-core`、`packages/eval-suite`）は採用する。M1 の構成は plan の File Structure Plan に従う（`/api/chat`、`/api/agent/tools`、`/api/summarize`、`ai-core/src/{config,models,mock,agents,aci,ports,chat,summarize,testing}`）。`workflows/` と `harness/` は M2・M4 の拡張点として予約する | plan File Structure Plan、research I-14、`.sdd/steering/structure.md` |
| 3_genai-agent の構成（`packages/agents/*`、`packages/core`、`packages/eval`） | 採らない。新しいトップレベルのワークスペースを作らず、`packages/ai-core` に領域を足す | `.sdd/steering/structure.md` |
| パッケージ名 `@agentic/ai-core` | `@platform/ai-core`、`@platform/eval-suite`、`web`（非公開） | plan File Structure Plan |
| `ToolLoopAgent` やツールを各所で直接定義する | エージェントは `createGuardedAgent` だけで生成し、ツールは `defineAciTool` で定義する | plan C8、C9 |

## 6. 外部サービス

| ドラフトの記述 | 確定版 | 根拠 |
|---|---|---|
| Supabase、Upstash Vector、Turso、Qdrant、Pinecone、Chroma 等のベクトルストア | ローカルの Postgres + pgvector（Docker Compose）に統一する。品質ゲートのテストは、インプロセス DB で実行できるものだけを含める | 001 Out of Scope、Req 1.12 |
| Langfuse / Braintrust / Helicone / Datadog のいずれか | OTLP でエクスポートし、既定の収集先を Langfuse とする。Braintrust 連携は対象外 | 001 Req 1.8、004 Req 5.3、Out of Scope |
| Human SME による A/B テストの運用 | レビュー用の出力（トランスクリプトと Outcome の要約）の生成まで | 004 Req 3.6、001 Out of Scope |
| Web 検索に Tavily / DuckDuckGo / Exa / Brave Search | API キーがあるときだけ Web 検索ツールを登録する。提供元は research で Tavily に決めた | 001 Req 5.3、5.4、research I-11 |
| Claude Desktop や既製の MCP サーバー群（Filesystem、GitHub、Brave Search 等）との接続 | ファイルシステムの MCP サーバーは公式 SDK で自作し、stdio で接続する。GitHub の MCP サーバーはトークンがあるときだけ接続する | 003 Req 1.7〜1.9 |
| E2B が前提 | E2B のキーがなければ、ローカルのコンテナをサンドボックスとして使う。どちらもなければ分析エージェントを無効にする | 003 Req 3.8 |
| メモリの外部状態ストアに Redis / KV | 外部状態ストアは DB 等に保存する構造化状態とし、特定の製品を前提にしない | 004 Req 1.7 |

## 7. 設計の修正

ドラフトの設計例のうち、要件と矛盾する、または安全上の欠陥がある点を改めた。

| ドラフトの記述 | 問題 | 確定版 | 根拠 |
|---|---|---|---|
| ファイル読み取りツールで、パスの `startsWith('/')` と、正規化したパスの前方一致で許可ディレクトリを判定する（マスター パターン B） | 同じ接頭辞を持つ別ディレクトリとシンボリックリンクを通してしまう | シンボリックリンクを解決した実パスが、許可ルートと同一またはその配下であることを、パス区切り単位で判定する | 003 Req 1.4、1.5 |
| Evaluator-Optimizer で、評価器の LLM に合否の真偽値（`passes`）を返させる（マスター パターン A） | 合否が LLM の自己申告になる | 合否はコードがスコアと合格基準を比べて決める。複数の評価器ではスコアの最小値を統合スコアとし、未合格なら最高スコアの生成物を未合格と明示して返す | 002 Req 3.8〜3.11 || 回帰テストで `maxSteps` を渡し、最終回答を正規表現で検査する（マスター パターン C） | 停止条件がステップ数だけ。認証情報の検査が評価だけにあり、実装側で防げない | エージェントは3種の停止条件で止める。最終回答の認証情報の形状は、保存前に実装側で検査する。評価は Outcome（チケットの状態等）で判定する | 001 Req 6、003 Req 2.8、004 Req 3.4 |
| 承認はクライアント側で入力を待ち、承認されたらサーバー側で再開する（マスター 4-4） | 承認応答の改ざんや再送を防げない | 承認要求はサーバーが発行し、ツール呼び出し ID と引数に束縛して署名する。1回だけ消費でき、未知のフィールドを拒否する厳格なスキーマで検証する。承認待ちはセッションをまたいで保持しない | 004 Req 4.3、4.5、4.12、4.13 |
| Coding Agent がテストの合格後に `passes: true` へ更新する（Guide モジュール4、マスター 4-2） | 合否が Worker の自己申告になる | `passes` の更新は、ハーネス側で検証テストを実行する専用ツールに限る。Worker は機能リストのファイルを書き換えられない。作業はコンテナ内の別リポジトリで行う | 004 Req 2.3、2.6、2.10、2.11 |
| Initializer が仕様を 200 項目以上の要件に分解する（Guide モジュール4） | 数は要件にない | 機能の数は定めない。全項目を `passes: false` で初期化することを要件とする | 004 Req 2.1 |
| 強制停止条件を「ハードコード」する（Guide モジュール5） | 既定値を変えられない | 3種の停止条件を必ず設定し、既定値は設定で変更できる。トークンと時間の上限は、ステップ完了時の近似判定であることを解説に明記する | 001 Req 6.1 |
| JSON Schema の制約で「100% 型安全」「100% 保証」 | 構造化出力でもスキーマ検証に失敗することがある | スキーマ検証を通過したオブジェクトだけを返し、失敗したら最大2回まで再生成する | 001 Req 4.3、4.4 |
| プロンプトキャッシュで「90% 削減」 | 実測していない数値 | 削減量はプロバイダの単価とキャッシュ読み出しトークン数から示す。単価はモデルカタログで管理する | 001 Req 2.17、4.8、constitution 原則 8 |
| データ分析エージェントのループを、試行回数だけで制御する（3_genai-agent §4.2） | 停止条件と停止理由がない | 修正は最大 3 回まで。エージェントとしての停止条件と停止理由は 001 Req 6 に従う | 003 Req 3.3、001 Req 6 |

## 8. コード例の扱い

確定版には、ドラフトのコード例（マスター §3.2・§3.3、各ドラフトの §4）を載せない。コンポーネントの契約は plan、実装はリファレンス実装を正とする。ドラフトのコード例で使われていた古い API は §3・§4 に、設計上の欠陥は §7 に記録した。解説の差分表にドラフトのモデル ID は書かず、採用したモデルはモデルカタログへの参照で示す（constitution 原則 8）。

## 9. M2 の実装で実測により確定した API・設定（002）

M2（モジュール 2-1〜2-4）の実装で確かめた、ドラフト（Python / LangChain / LangGraph を前提にした記述）との差分を記録する。数値と版の根拠は [002 research.md](../002-rag-and-workflows/research.md) の I-1〜I-10 と ADR-1〜12 にある。2-1〜2-4 の解説「移植時の変更点」はこの節を元に書く。

| ドラフトの記述 | 確定版 | 根拠 |
|---|---|---|
| LCEL（`prompt → llm → parser` のパイプ演算子）や LangChain の Retriever で RAG を組む | 非同期関数の合成。取り込み・検索・回答・引用の各段は、引数と戻り値の型が見える TypeScript の関数で、段の進行は `data-*` パートで UI へ流す | 002 plan C4〜C9、spec Req 1.4、2.11 |
| ベクトルストアに FAISS / Chroma / LangChain の PGVector ラッパを使う | pgvector を `drizzle-orm` の型付きクエリ（`cosineDistance`）で直接引く。ベクトルは 768 次元に統一し、`rag_meta` に埋め込みモデルを記録する。データ層は PGlite（gate と `mock`）と Docker の Postgres 17（`test:db`、ハンズオン）の二層 | research ADR-1、ADR-4、I-1、I-2 |
| スキーマとマイグレーションを ORM のツールに生成させる | 手書き SQL（`packages/ai-core/drizzle/NNNN_<name>.sql`）と自前の小さなマイグレーター。`drizzle-kit` は `npm audit` の中程度 4 件を持ち込むため採らない。`schema.ts` との乖離はスキーマ照合テストで検出する | research ADR-2、I-2 |
| 日本語の全文検索を BM25 ライブラリや形態素解析器で行う | `Intl.Segmenter` で分かち書きして `search_text` に保存し、`to_tsvector('simple', …)` の生成列を GIN で引く。ひらがなだけの 2 文字以下の語は検索語から除く。順位は `ts_rank`（BM25 ではない） | research ADR-3、I-3 |
| `EnsembleRetriever` で検索結果を統合する | Reciprocal Rank Fusion を TypeScript の純関数で実装する（SQL には書かない）。同じチャンクは統合後に 1 回だけ含める | spec Req 2.3、2.4、research Req 1.12 の分類 |
| Rerank に `CohereRerank`（LangChain） | AI SDK v7 の `rerank()` と `@ai-sdk/cohere`。キーは `COHERE_API_KEY`、モデル ID はカタログにだけ書く。キーが無い `local` / `live` では Rerank 段をスキップして結果に記録し、`mock` は語の重なりによる疑似実装を使う | research ADR-7、I-4 |
| 構造化出力の失敗を `OutputFixingParser` や `with_structured_output` に任せる | `generateValidated`（`generateText` + `Output.object` + 追加検証）。前回の問題点を次のプロンプトに添えて最大 2 回再生成し、なお不正なら `StructuredOutputError`。Multi-Query の「ちょうど 3 件」もここで守る | research ADR-8、ADR-9 #2、I-7 |
| 回答の引用を、モデルに構造化出力で返させる | 序数の脚注 `[n]`。サーバーが範囲外の序数を除去して記録し、取得した全チャンクを `cited` 付きで返す。小型モデルは「引用を付けない」ことはあっても偽の ID を作ることは少なかった | research ADR-6、I-7 |
| 「該当なし」を LLM に判断させる | ベクトル検索のコサイン類似度の閾値（既定 0.5）で判定し、閾値以上が 0 件ならモデルを呼ばない。`local` の日本語の埋め込みでは関連と無関係の類似度が重なるため、閾値は弱い防御である | research I-8、ADR-9 #1 |
| LangGraph のグラフ（`StateGraph`）で 5 つのワークフローパターンを組む | `generateText` / `streamText` を合成する関数。`ToolLoopAgent` は使わず、リポジトリ規則 `workflow-no-agent-loop` が `workflows/` と `patterns/` から `agents/` への依存を禁じる（例外は `patterns/role-based-cooperation.ts`） | spec Req 3.13、research ADR-8 |
| Evaluator-Optimizer の合格をモデルの自己申告で決める | 評価器が 0〜100 点とフィードバックを返し、コードがスコアと合格基準（既定 85）を比べる。複数の評価器の統合スコアは最小値、最大反復（既定 3）でも未合格なら最高スコアの生成物を未合格と明示して返す | spec Req 3.8〜3.11、research ADR-9 #4 |
| 軽量モデルと高性能モデルを固定の名前で振り分ける | カタログに「ティア」（`light` / `capable`）を足し、`ModelPurpose` は変えない。`live` の Anthropic では両者が同じモデルになり、結果に `distinct: false` を含める | research ADR-11 |
| Cross-Reflection の批評側を別名のモデルとして直書きする | 批評側は `purpose: "judge"` のモデルで、生成側とカタログ ID が異なることを要求する。同じ ID になる構成（`live` の Anthropic 既定）は `invalid-request` で拒否し、`AI_MODEL_JUDGE` の設定方法を案内する | research ADR-9 #5 |
| RAG の評価を RAGAS などの外部ライブラリで行う | RAG 専用の最小実装（recall@k、忠実性と回答関連性を軸ごとに別プロンプトで採点する Judge、`unknown` を選択肢に含める）。比較と Judge の実行は `eval-suite` の `*.local.test.ts`、gate が保証するのは評価の配管（質問セットの検証と `mock` の埋め込みでの recall@1）まで。評価基盤への統合は M4 | research ADR-10、ADR-12、spec Req 2.9、2.10、2.12 |
| Server Component から DB を使う例（Node の長寿命プロセス前提） | Next.js のサーバービルドでは、PGlite を `serverExternalPackages`（`@electric-sql/pglite`、`@electric-sql/pglite-pgvector`）に置かないと、SSR 層で pgvector の tarball を読めない。Vitest では検出できず、実サーバー E2E が守る | research I-10 |


## 10. M3 の実装で実測により確定した API・設定（003）

M3（モジュール 3-1〜3-6）の実装で確かめた、ドラフト（Python / LangChain / LangGraph / E2B Python SDK を前提にした記述）との差分を記録する。判断の根拠は [003 research.md](../003-domain-agents/research.md) の I-9〜I-12、ADR-1〜10、実測の節（S-1〜S-6、W2〜W8 の実測）と [plan.md](../003-domain-agents/plan.md) の CL にある。3-1〜3-6 の解説「移植時の変更点」はこの節を元に書く。**実機で確かめていないものは「未実測」と書く。** 小さなローカルモデルでの観察値は少数回のもので、手法の優劣の根拠ではない。

### 10.1 サンドボックス（3-3）

| ドラフトの記述 | 確定版 | 根拠 |
|---|---|---|
| Docker の操作に `dockerode` を使う | `dockerode` は採らない。Docker Engine API を `node:http` の `socketPath`（Unix ソケット）で直接叩く。理由は、推移依存と監査面を増やさないこと、`child_process` を import しないため `no-dynamic-eval` に例外を作らずに済むこと。代わりに、入力の転送と多重化ストリーム（8 バイトのヘッダー）の処理を自前で書く。`undici` のソケットも、新規依存であり、調査時点の最新版が公開から 24 時間未満だったため採らない | research I-11、I-12、ADR-4、S-5 |
| サンドボックスは E2B が前提 | 選択順は、(1) `E2B_API_KEY` があれば E2B、(2) なければローカルのコンテナ（ソケットに届き、画像 `agentic-ai-sandbox:local` が存在するとき）、(3) どちらもなければ分析エージェントを無効にして設定を案内する。選択は `lib/server/platform.ts` の 1 か所で行い、`mock` は疑似サンドボックスを使う。画像がないときもコンテナがないときと同じく無効にする | spec Req 3.8、research ADR-6、plan CL-20 |
| Docker のソケットは既定のパスにある | 探索先は `DOCKER_HOST`、`~/.docker/run/docker.sock`、`/var/run/docker.sock`。Rancher Desktop のソケット（`~/.rd/docker.sock`）はどれにも当たらないため、`DOCKER_HOST=unix://$HOME/.rd/docker.sock` が要る（Rancher Desktop の Docker Engine 29.5.3 で実測）。Docker Desktop（macOS）の既定パスと Linux のネイティブは未実測 | research W4 の実測（S-5）、39.2 |
| Engine API の版を新しいものにそろえる | `v1.44` に固定する（Docker 25〜29 が対応する最古の版）。plan の `v1.47` は Docker 27 以降を要するため改めた | research W4 の実測（S-5） |
| 読み取り専用ルートのコンテナの `/work` を tmpfs にし、起動後に `archive` で入力を置く | この方法は成り立たない。`Tmpfs` は 403、`--mount type=tmpfs` と tmpfs 裏打ちのボリュームは 200 を返すがコンテナから見えない。`/work` は**匿名ボリューム**、`/tmp` は tmpfs（`noexec`、64 MiB）にし、入力は**起動前**に `archive` で置く（create → archive → start → wait → logs → delete）。ボリュームは `DELETE …?force=1&v=1` で消す | research W4 の実測（S-5）、plan C6 の想定との差 |
| `pip install` を実行時に行う（Python のノートブック環境） | 実行時のコンテナはネットワークなし（`NetworkMode: none`）なので、画像のビルド時に入れる。`python:3.13-slim` をダイジェストで固定し、解決結果を `docker/sandbox/requirements.txt` に全件固定する（pandas 3.0.6、openpyxl 3.1.5、xlrd 2.0.2、matplotlib 3.11.2 と依存 11 件）。pandas と matplotlib が Python 3.11 以上を要するため、ベース画像は 3.11 以上にする。`.xls` は xlrd 2.x、`.xlsx` は openpyxl で読む（xlrd 2.x は `.xlsx` を読めない）。全件の公開は 24 時間以上前（憲章 原則 7） | plan CL-20、research S-5（Python 側の版）、W4 の実測 |
| 表計算ファイルをホスト側のライブラリで解析する（`exceljs`、`xlsx` など） | ホストは拡張子、20 MB 上限、マジックバイトの検査だけを行い、生バイトをサンドボックスへ渡す。解析は pandas / openpyxl がサンドボックス内で行う。`exceljs` は保守停止、`xlsx` は修正版のない advisory のため採らない | research ADR-1、I-6 |
| グラフを E2B の `results[].png` で受け取る。クライアントのチャートライブラリで描画する | E2B と Docker で経路を分けない。サンドボックスに事前投入した補助関数 `show_figure` / `show_table` が目印付きの 1 行（`__PNG__:` / `__TABLE__:` + JSON）を標準出力へ書き、ホストが純関数で取り出す。画像は `<img>`（`alt` 必須）、表は素の `<table>` で描画し、`recharts` は M3 では採らない | plan CL-19、research ADR-2 |
| 失敗した実行の累積回数で修正を打ち切る（3_genai-agent §4.2 の試行回数） | 修正は**失敗ごと**に数える。失敗した実行 1 回につき修正は最大 3 回（最大 4 回の実行）で、成功すると失敗は終わる。累積で数えると、失敗と成功が交互のときに、修正を受けていない失敗で止まる（W4 のレビュー F-3） | plan CL-26（2026-10-19 確定）、spec Req 3.3 |
| E2B のサンドボックスの外向き通信は遮断されている、またはドラフトは触れない | **既定は許可**（E2B の文書「すべてのサンドボックスは既定でインターネットへの外向き通信が可能」による。`Sandbox.create({ allowInternetAccess: false })` で無効にできる）。型定義に `allowInternetAccess` があることは確かめたが、`E2B_API_KEY` がないため**実機では未実測**。E2B の提供者は設定したときだけこの値を渡し、既定を変えない。Docker は `NetworkMode: none` で遮断する。`runPython` は破棄可能なサンドボックスの中だけで作用するため `read-only` とし、通信の制限は 004 Req 4 で再検討する | research S-4、plan CL-21、`tasks.md`「004 への引き継ぎ事項」 |
| アイドルの破棄を E2B の寿命に任せる | 破棄は `Clock` を使う `sandbox/lifecycle.ts` が数え、既定 10 分で行う（クライアントの切断は Route Handler の `request.signal` で検知する）。E2B 側の `timeoutMs` は安全網で、ADR-6 は 15 分と書くが、実装は `lifetimeMs ?? アイドル時間 × 3`（既定で 30 分）である。ADR-6 の数値は未修正のまま、人の判断を仰いでいる。実サーバーで切断が `request.signal` を abort することは未実測 | research ADR-6、W7・W8 の実測の記録、spec Req 3.7 |

### 10.2 MCP とツール（3-1）

| ドラフトの記述 | 確定版 | 根拠 |
|---|---|---|
| MCP サーバーの全ツールをエージェントに渡す | `client.tools({ schemas })` の `schemas` は**許可リスト**として働き、載っていないツールは読み込まれない。既定の `'automatic'` は全ツールを読むため使わない。1 エージェントのツール数は MCP のツールを含めて 20 以下で、超える構成は起動時に拒否する | research I-9、spec Req 1.8、1.15 |
| MCP ツールのリスクをサーバーが決める、またはすべて読み取り専用とみなす | リスク区分は**注釈から決定論的に写す**。`readOnlyHint === true` は `read-only`、`destructiveHint === true` または**注釈なし**は `destructive`。`write` と `destructive` は登録しない（`buildToolSet` が拒否する）。注釈はサーバーが提供する信頼できないヒントで、信頼境界の外にある。この結果、GitHub の書き込み系ツール（issue の作成など）は M3 では使えない | research ADR-7、spec Req 1.16、1.17、004 Req 4.14 |
| GitHub の MCP サーバーの読み取り専用ツールが使える | 自作サーバーは、公式 SDK（`@modelcontextprotocol/server`）の `registerTool` の `annotations` が `tools/list` に載り、`readOnlyHint` / `destructiveHint` が写ることを実測した。**GitHub の公式ホスト型サーバーの注釈は未実測**（`GITHUB_TOKEN` がなく `tools/list` を呼べていない。文書に `readOnlyHint` の記述が見つからなかった）。注釈がなければ許可リストのツールは 0 件になり、「接続できるが何も登録されない」。既定の許可リスト（`get_file_contents`、`issue_read`、`list_issues`、`pull_request_read`、`search_issues`）は文書による候補で、ハンズオンで確かめる | research S-3、S-6、W8 の 39.2、plan CL-25 |
| `@ai-sdk/mcp` は最新版を使う。Claude Desktop や既製のサーバー群とつなぐ | `@ai-sdk/mcp` を完全一致で固定する。**2.0.76 に固定したのは、互換性の理由ではなく、リポジトリの 24 時間規則（`minimumReleaseAge: 1440`、憲章 原則 7）のため**で、調査時点の最新 2.0.77（2026-10-15T18:10Z 公開）は約 18 時間で窓に入っていた。その後、2026-10-24 の依存更新（監査の指摘の解消、コミット `685162b`）で **2.0.83 へ上げた**。現在の `packages/ai-core/package.json` は 2.0.83 である。stdio は `Experimental_StdioMCPTransport` で、プロセスの起動は SDK の内部が行い、本リポジトリは `child_process` を import しない。MCP サーバー SDK は v2 の `@modelcontextprotocol/server` 2.3.1（stdio は `@modelcontextprotocol/server/stdio`）を採り、依存の重い v1（`@modelcontextprotocol/sdk` 1.32.1）は採らない。`@ai-sdk/mcp` の import は `mcp/` に限り、リポジトリ規則 `mcp-import-scope` が守る | research I-9、I-10、I-12、ADR-4、ADR-7、`pnpm-workspace.yaml` |
| 致命的なツールエラーで内部の `AbortController` を abort して止める | 採らない。`stream` と UI ストリームが `abort` で終わり、`finish` と `onEnd` が来ないため、学習者向けの文言を載せる経路が使えなくなる。Run 単位の `FatalLatch` の状態だけを読む条件を `stopWhen` の末尾に足し、`finalise` がラッチを先に判定して停止理由 `error` を返す。同じステップの残りのツールは AI SDK が止めないため、ラッチがあるときだけツール呼び出しを 1 件ずつ実行する | research S-1、ADR-5（退き方）、W1 レビュー後の訂正 |
| ツール入力の検証失敗を AI SDK の既定の文言で返す | `inputSchema` を `jsonSchema(() => zodSchema(schema).jsonSchema, { validate })` で包み、失敗時の修正ガイドをモデルに届ける。AI SDK が付ける前置き（`Invalid input for tool …`）と入力値の再掲は消せない。生の `z.toJSONSchema` は `io: "input"` などの補正がないため使わない | research CL-2、W1 レビュー後の訂正、spec Req 1.2 |
| ツールの説明文は自由な書式 | 用途の 1 文に、`使うとき:`、`使わないとき:`、`例:` の 3 つの見出し行を含め、全入力フィールドに `.describe()` を付ける（`defineAciTool` が検査する）。外部の MCP ツールは `McpServerConfig.descriptions` で上書きする。M1 の 6 ツールの書き直しは、ツールを含むリクエストのカセットのキーを変える（既存のシナリオは述語で照合するため gate には影響しない） | plan CL-18、CL-25、research W1 レビュー後の訂正 |
| Next.js のバンドラーでも `new URL(…, import.meta.url)` でファイルを指せる | Turbopack は「ファイル資産の参照」として扱い、ビルドが失敗する。`resolve(dirname(fileURLToPath(import.meta.url)), …)` の形にする。Vitest はバンドラーを通らないため単体テストでは検出できず、実サーバーのビルドだけが見つけた。`serverExternalPackages` に足したパッケージはない（`@ai-sdk/mcp`、`@modelcontextprotocol/server`、`@e2b/code-interpreter`、`fast-xml-parser` はバンドルのまま動く） | research W2・W4・W5 の実サーバー確認（R-1） |

### 10.3 エージェントの構成（3-2、3-4〜3-6）

| ドラフトの記述 | 確定版 | 根拠 |
|---|---|---|
| ヘルプデスクの Plan-and-Execute、要件定義書のインタビューを LangGraph のグラフ、または 1 つのエージェントのループで組む | 計画と Replanner の判断は `generateValidated` による構造化出力、実行は依存順の純粋なスケジューラ、インタビューは固定の往復を行うワークフローで、`ToolLoopAgent` を使うのは各タスクの実行（ツールを使う箇所）だけ。マーケティングの合議もワークフローで、ペルソナはツールを持たない。`workflow-no-agent-loop` 規則が `workflows/` からの `ToolLoopAgent` の利用を禁じる。チケットの状態と計画の版は、M2 の drizzle 基盤（PGlite / Postgres）に永続化する | research ADR-9、ADR-10、憲章 原則 1 |
| 階層型リサーチを LangGraph のマルチエージェントと LangGraph Studio で行う | Agent-as-a-Tool の単一プロセス。Supervisor が 3 つのサブエージェントを入力スキーマ付きのツールとして呼び、サブエージェントは要約だけを返し、呼び出し数に上限を設ける。Studio の代わりに Agent Inspector UI。トークンは役割別に集計する | research ADR-8、spec Req 4.4、4.8〜4.10 |
| 多エージェントは精度を上げる、という前提で階層型を採る | 多エージェントは憲章 原則 1 により正当化の記録が要る。ローカルの小型モデル（`llama3.2:latest`、各質問 1 回、約 189 秒）では、階層は単一エージェントの約 1.6 倍のトークンを使い（平均 2,433 対 1,555）、Supervisor の呼び分けはほとんど観察できなかった（広い質問と市場の質問でサブエージェントを呼ばなかった）。**少数回の観察であり、手法の優劣の根拠ではない**。単一側の「0/3」は引用検査が有効と判定しなかったという意味で、品質の比較ではない | research ADR-8、W8 の実測（38.3） |
| 高水準ツールのほうが効率がよい（Guide モジュール3） | 同じ操作を高水準ツール 1 つと低レベルツールの組み合わせで行った比較（`granite4.2:latest`、3 回ずつ）で、中央値はステップ 2 対 4、トークン 1,894 対 5,641（比 0.34）だった。ローカルの小型モデルでの少数回の観察であり、分散は見ていない | spec Req 1.12、research W8 の実測（38.1） |
| arXiv は LangChain の既製ローダーで取得する | `HttpFetcher` と `fast-xml-parser`（5.11.2、`processEntities` 無効）の自前のクライアント。利用規約の 1 リクエスト / 3 秒と単一接続を守る直列キューと日単位のキャッシュを置く。429 / 503 / 301 の応答は実測済み（research I-5）で、未実測なのは複数件・0 件の正常系、HTTP 400 のフィード、ライブサーバーに対する再試行の挙動 | research I-5、ADR-3、W5 の実測 |
| 合議の合意をモデルの宣言で決める。固定のペルソナ名・商品名・価格をモデルに返させる | 合意の確定はコードが持つ（未解決の反対があれば、欠けたペルソナがいるラウンドでは、`agreed` は無効）。コストの上限は最大ラウンドと共有の累積トークンの 2 つで、モデレーター用に一部を予約する。商品名と価格はカタログから取り、モデルが返したものは使わない | spec Req 6.2、6.5、plan CL-12、CL-15、CL-17 |
| 合議は単一エージェントより品質を上げる | ローカルの小型モデル（`llama3.2:latest`、2 回）で、合議は「合意した」と判定したが文案は変わらず、トークンは単一の約 21 倍（平均 12,626 対 602）だった。少数回の観察で、優劣の根拠ではない。また、あるローカルモデルでは、ペルソナ 1 人あたりの既定の上限 60 秒に収まらず `timeout` で止まった（原因は未特定。合議は 1 人ずつ直列に呼ぶ）。「合意した」のに文案が変わらなかった点は、小型モデルが `<draft>` を書かなかっただけの可能性があり、合意の判定と改善が別の事柄かは未測定 | research W8 の実測（38.4） |
| `mock` の検索でも、類似度の閾値（0.5）で根拠を絞る | `mock` の埋め込みは疑似乱数で、既定の閾値では検索が常に空になり、すべての問い合わせが根拠なしで `escalated` になる。ヘルプデスクの `mock` は `minSimilarity: -1`（上位 k 件をそのまま返す）で検索する。`local` / `live` は既定のまま | research W3 で分かったこと |

### 10.4 カリキュラム本文の修正（spec を正とする）

41.4 の点検で、`specs/curriculum/` の本文のうち承認済みの 003 / 001 と食い違う、または実測で誤解を招く記述を、カリキュラム側で直した。

| ファイル | 修正前 | 修正後 | 根拠 |
|---|---|---|---|
| `security.md` §3（ASI05 の行） | 「サンドボックス、ネットワーク遮断」とだけ書き、3-3 の隔離がすべてネットワーク遮断だと読める | ネットワーク遮断はローカルのコンテナ（`NetworkMode: none`）で、E2B は既定で外向き通信が可能（未実測）であり、制限は 004 Req 4 で再検討する、と明記した | research S-4、plan CL-21、spec Req 3.8 |
| `README.md` 技術スタック（サンドボックスの行）、`sources.md` §6（コード実行の行） | 「キーがなければローカルのコンテナ」で終わり、どちらもない場合が書かれていない | 「どちらもなければ分析エージェントを無効にする」を足した | spec Req 3.8、research ADR-6 |

上記以外の本文（`phase-3.md` の 3-1〜3-6、`concepts.md`、`phase-1.md`、`phase-2.md`、`phase-4.md`）は、003 の Req 1〜6 と矛盾する記述を見つけなかった。`phase-3.md` が参照する Python 側の版は存在せず（元教材の Python 版は `sources.md` に「Python / LangChain / LangGraph」とあるだけ）、M3 で実際に固定した Python パッケージの版は 10.1 の画像の記述（research S-5）にだけある。
