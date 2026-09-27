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
