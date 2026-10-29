# domain-agents — Gap Analysis

調査日: 2026-10-16 ／ 対象: `specs/003-domain-agents/spec.md`（Req 1〜6、受け入れ基準 60 件）

本書は情報と選択肢の提示であり、実装の決定ではない。決定は `/sdd-plan` の段階で行う。

## 1. 分析サマリー

- **対象と充足状況**: 60 件のうち、充足 3 件（1.15 ツール数上限、1.16 リスク区分、1.17 書き込みツールの登録拒否）、部分的に充足 19 件、未実装 38 件。土台は `ai-core` の ACI、`createGuardedAgent`、`generateValidated`、`cooperateByRole` と `orchestrate` にある。
- **最大の課題（C1）**: サンドボックス（Req 3.8）と stdio MCP サーバーの起動（Req 1.7）には子プロセスか Docker ソケットが要る。一方 `no-dynamic-eval` は `child_process` の import を例外なく禁止している。ルールの例外の方式を、constitution 原則 6 との整合とあわせて plan で決める必要がある。
- **次に大きい課題**: 致命的エラーで run を止める経路がない（Req 1.3、C2）。MCP のツールは `defineAciTool` を通らないため、リスク区分を付けるアダプターが要る（Req 1.8、C3）。階層型と合議の UI は、単一エージェント前提の `createAgentUIStreamResponse` では足りない（C6）。
- **外部依存は未導入**: MCP は `@ai-sdk/mcp` 2.0.77（現在は推移的依存のみ）と MCP SDK v2 の 2.2.0 が候補。E2B、arXiv、表計算（`exceljs` 4.4.0 が候補）、チャート描画はいずれも未導入。peer 互換、advisory、公開日の一部は未確認。
- **推奨（情報提供）**: アプローチ C（ハイブリッド）。純粋なロジック（計画の DAG 検証、失敗の分類、Replanner の型、コーパス照合）は `ai-core` に置く。子プロセス、Docker、外部 API の実装は `ports/` の本番実装に分け、ルールの例外を一か所に絞る。計画は R1（ルールの例外）の判断から始めるとよい。

## 2. 要件と能力の対応（要件ごとの分類）

凡例: ✅ 充足（根拠の file:line を示す）／ 🔧 部分的に充足（既存資産を拡張する）／ 🆕 未実装

集計: ✅ 3 件、🔧 19 件、🆕 38 件（計 60 件）

### Requirement 1: ACI ツール設計と MCP 連携

| ID | 分類 | 要旨 | 根拠・不足 |
|---|---|---|---|
| 1.1 | 🔧 | 説明文とスキーマ検証の入力定義 | `packages/ai-core/src/aci/define-tool.ts:150`（`defineAciTool`）が入力スキーマを受ける。ユースケースと使用例を含む説明文の規約が既存 6 ツールで統一されているかは未確認 |
| 1.2 | 🔧 | スキーマ違反時の修正ガイド | `define-tool.ts:80-95`（`failureFrom`）は `nextAction` 付きの回復可能エラーを返す。違反したパラメータ名と正しい形式を示す案内は未実装 |
| 1.3 | 🔧 | エラーの分類と致命的エラーでの停止 | `aci/types.ts:11` に `fatal` の型があるが、`failureFrom` は `recoverable`、タイムアウトは `timeout` しか作らない（`types.ts:10` の注記）。致命的エラーで run を止める経路はない |
| 1.4 | 🆕 | 相対パスの拒否 | ファイル操作ツールがない（`aci/tools/` の 6 件は検索・計算・時刻・天気・為替・Web 検索） |
| 1.5 | 🆕 | シンボリックリンク解決後の包含判定 | 1.4 と同じ |
| 1.6 | 🆕 | `concise` / `detailed` と上限での切り詰め | 応答形式パラメータを持つツールがない |
| 1.7 | 🆕 | 自作 MCP サーバー（stdio） | MCP SDK が未導入（`packages/ai-core/package.json`、`apps/web/package.json` に依存なし） |
| 1.8 | 🔧 | MCP ツールの取得と許可リストでの登録 | `@ai-sdk/mcp` は `@ai-sdk/react` の推移的依存のみ（直接依存なし）。許可リストは未実装。`buildToolSet` の `assertRegistrable`（`aci/tool-set.ts:24-29`）は `defineAciTool` 以外を拒否するため、MCP ツールは包んで `risk` を付ける必要がある |
| 1.9 | 🆕 | GitHub トークンによる GitHub MCP | `config/env-schema.ts` に該当項目がない。書き込み系ツールは 1.17 により登録できない |
| 1.10 | 🆕 | 接続失敗・切断時の利用不可扱いと通知 | MCP 接続がない |
| 1.11 | 🔧 | 「いつ使うか / 使わないか」を含む説明文 | 既存ツールの説明文の書式は未確認。規約を検査する仕組みはない |
| 1.12 | 🆕 | 高水準ツールとステップ・トークンの比較 | 高水準ツールも比較の仕組みもない |
| 1.13 | 🔧 | 意味のある識別子（UUID 不使用） | `search-knowledge-base.ts` などの出力 ID の形式は未確認 |
| 1.14 | 🆕 | Think ツールと設定による切り替え | なし |
| 1.15 | ✅ | ツール数の上限 20 | `packages/ai-core/src/agents/guarded-agent.ts:20`（`MAX_AGENT_TOOLS`）、`:167-174`（`assertToolCount`）。MCP ツールを合算する処理は MCP 導入時に必要 |
| 1.16 | ✅ | 全ツールへのリスク区分の付与 | `defineAciTool` の `risk` は必須（`aci/types.ts` の `TOOL_RISKS`）。`scripts/check-repo-rules.mjs` の `tool-risk-declared` が機械検査する |
| 1.17 | ✅ | 承認ゲート前の書き込みツールの登録拒否 | `aci/tool-set.ts:24-29`。read-only 以外を登録時に拒否する |

### Requirement 2: ヘルプデスク・エージェント

| ID | 分類 | 要旨 | 根拠・不足 |
|---|---|---|---|
| 2.1 | 🔧 | 依存付きタスク計画の構造化出力 | `packages/ai-core/src/structured/generate-validated.ts:87`（`generateValidated`）が生成と検証を担う。計画のスキーマは未実装 |
| 2.2 | 🆕 | 依存順の実行制御 | `workflows/orchestrator-workers.ts:59`（`orchestrate`）は並列ワーカーへの分配であり、依存順の実行ではない |
| 2.3 | 🆕 | Replanner（continue / replan / finish）と差分記録 | なし |
| 2.4 | 🔧 | ステップ上限と未完了タスクの返却 | `agents/guarded-agent.ts:23-29`（`LoopLimits.maxSteps`）と `workflows/limits.ts`。未完了タスク一覧の返却は未実装 |
| 2.5 | 🆕 | ダッシュボードへの 1 秒以内の反映 | ダッシュボード UI がない。状態変化の配信は `RunObserver`（`guarded-agent.ts:80-82`）を流用できる見込み |
| 2.6 | 🆕 | チケット状態 `resolved` と回答の保存 | チケットの保存先がない。DB 基盤は `rag/` の drizzle（PGlite / Postgres）を流用できる |
| 2.7 | 🆕 | `escalated` と未解決理由の記録 | 2.6 と同じ |
| 2.8 | 🆕 | 認証情報の形状検査と再作成 | 検査がない。`generateValidated` の `validate` フックで再生成の枠組みは流用できる |
| 2.9 | 🆕 | ヘルプデスクのサンプル投入 | なし。`rag/` の投入処理を参考にできる |
| 2.10 | 🔧 | 不正な計画の検証と再生成（上限 2 回） | `structured/generate-validated.ts:7`（`DEFAULT_MAX_REGENERATIONS = 2`）が直接対応する。循環と存在しない依存の検査（DAG 検証）は未実装 |

### Requirement 3: データ分析エージェント

| ID | 分類 | 要旨 | 根拠・不足 |
|---|---|---|---|
| 3.1 | 🆕 | 分析コードの生成と隔離実行 | サンドボックスがない。`scripts/check-repo-rules.mjs:808-851` の `no-dynamic-eval` が `child_process` の import を全域で禁止している |
| 3.2 | 🆕 | ホスト環境での直接実行の禁止 | 設計上の制約。現状はコード実行の経路がないため違反はないが、保証する仕組みもない |
| 3.3 | 🆕 | エラー出力を使った修正ループ（最大 3 回） | なし。ループ上限は `LoopLimits` の考え方を流用できる |
| 3.4 | 🆕 | 失敗時の停止と試行履歴の表示 | なし |
| 3.5 | 🆕 | 画像・表のストリーミングとチャート・表の描画 | 描画部品がない。`apps/web/components/agent/renderers.tsx` の `TOOL_RENDERERS` は既存ツールだけ。チャートライブラリは未調査 |
| 3.6 | 🆕 | コード・標準出力・エラー出力・修正回数の確認 UI | なし |
| 3.7 | 🆕 | セッション単位のサンドボックスと 10 分のアイドル破棄 | なし。接続の途絶を検知する仕組みが必要 |
| 3.8 | 🆕 | E2B 未設定時のコンテナ代替と無効化の案内 | `config/feature-requirements.ts` と `config/env-schema.ts` に E2B もコンテナ検出もない |
| 3.9 | 🆕 | 非対応形式とサイズ上限（20 MB）の事前検査 | 表計算パーサーがない（依存に spreadsheet 系なし） |
| 3.10 | 🔧 | `mock` 用の疑似サンドボックス | `packages/ai-core/src/mock/` のシナリオ・カセット機構（`fixtures/`）を流用できる。サンドボックスの fake は未作成 |

### Requirement 4: 階層型リサーチエージェント

| ID | 分類 | 要旨 | 根拠・不足 |
|---|---|---|---|
| 4.1 | 🔧 | サブエージェントを入力スキーマ付きツールとして公開 | `guarded-agent.ts:88` が `GuardedToolSet` を受けるため、エージェントを包むツールは `defineAciTool` で作れる見込み。Supervisor と 3 つのサブエージェントは未実装 |
| 4.2 | 🆕 | Supervisor による Markdown レポート生成 | なし |
| 4.3 | 🆕 | arXiv 検索と論文メタデータの返却 | arXiv のポートがない（`ports/` は clock、http、rerank、transcript、web-search）。`ports/http.ts` は流用できる |
| 4.4 | 🆕 | 要約結果だけを親のコンテキストへ返す | なし。`AgentRunSummary`（`guarded-agent.ts:65-77`）は要約の形の参考になる |
| 4.5 | 🔧 | 引用の集合照合と除去・警告 | `rag/` の citations を流用できる可能性（未確認）。除去と警告は未実装 |
| 4.6 | 🆕 | サブエージェント失敗時の縮退と欠落観点の明記 | なし |
| 4.7 | 🔧 | レート制限時の待機と最大 3 回の再試行 | `ports/clock.ts` で待機を制御できる。再試行ロジックはない |
| 4.8 | 🔧 | サブエージェント呼び出し回数の上限 | `LoopLimits`（ステップ・トークン・時間）は run 単位で働く。呼び出し回数の上限は未実装 |
| 4.9 | 🆕 | サブエージェント別のストリーミング（Agent Inspector） | `RunObserver` は run 単位。エージェントを区別するイベントと UI は未実装 |
| 4.10 | 🔧 | Supervisor とサブエージェントのトークン内訳 | `AgentRunSummary.totalTokens`（`guarded-agent.ts:70`）は単一エージェントの合計。内訳の集計は未実装 |

### Requirement 5: 要件定義書生成エージェント

| ID | 分類 | 要旨 | 根拠・不足 |
|---|---|---|---|
| 5.1 | 🔧 | ペルソナの構造化生成 | `generateValidated`（`structured/generate-validated.ts:87`） |
| 5.2 | 🆕 | ペルソナごとの質問と対話形式のインタビュー | なし |
| 5.3 | 🆕 | 回答ごとの要件プレビュー更新 | なし |
| 5.4 | 🔧 | 十分性判定の構造化出力 | `generateValidated` で判定の型を定義できる |
| 5.5 | 🆕 | 不足項目への追加質問と 5 ラウンドの上限 | なし。ラウンド数は自前の状態で管理する必要がある |
| 5.6 | 🆕 | 固定章立ての Markdown 生成と「未確認事項」 | なし |
| 5.7 | 🆕 | Markdown ファイルのダウンロード | なし。Route Handler の応答ヘッダーで実装できる見込み |

### Requirement 6: マーケティング支援エージェント

| ID | 分類 | 要旨 | 根拠・不足 |
|---|---|---|---|
| 6.1 | 🔧 | ペルソナのラウンドロビン合議 | `packages/ai-core/src/patterns/role-based-cooperation.ts:89`（`cooperateByRole`）が逐次の引き継ぎを行う。他のペルソナの発言を参照する形は `Role` / `RoleOutput` で表せる |
| 6.2 | 🔧 | 合意判定と終了理由 | `cooperateByRole` のラウンド上限と共有トークン予算は流用できる。合意判定と終了理由の型は未実装 |
| 6.3 | 🆕 | ペルソナ名付きのストリーミング表示 | 単発の出力のみで、ストリーミングと UI はない |
| 6.4 | 🆕 | 会話からの利用者プロファイルの逐次抽出と Generative UI | なし |
| 6.5 | 🆕 | 商品カタログとの照合によるレコメンド | カタログがない |
| 6.6 | 🆕 | 商品カタログとペルソナのサンプル投入 | なし |

## 3. 調査結果（根拠）

### 3.1 既存資産

- **ACI（`packages/ai-core/src/aci/`）**: `defineAciTool`（`define-tool.ts:150`）、実行の保護（タイムアウトと中断、`define-tool.ts:100`）、失敗の分類（`failureFrom`、`define-tool.ts:80-95`）、`buildToolSet` と読み取り専用の制限（`tool-set.ts:24-29`）、`GuardedToolSet` の型での強制（`types.ts`）。
- **エージェント（`packages/ai-core/src/agents/guarded-agent.ts`）**: `MAX_AGENT_TOOLS = 20`（`:20`）、`LoopLimits`（`:23-29`）、`AgentRunSummary`（`:65-77`）、`RunObserver`（`:80-82`）、`createGuardedAgent`（`:218`）。3 つの停止条件と複合 `AbortSignal` による時間上限（`:229-230`）を持つ。停止理由 `error` はあるが、ツールの致命的エラーからの経路はない。
- **構造化出力（`packages/ai-core/src/structured/`）**: `generateValidated`（`generate-validated.ts:87`）と既定の再生成 2 回（`:7`）。Req 2.10、5.1、5.4 の土台になる。
- **協調とワークフロー（`patterns/`、`workflows/`）**: `cooperateByRole`（`patterns/role-based-cooperation.ts:89`）、`orchestrate`（`workflows/orchestrator-workers.ts:59`）、上限の解決（`workflows/limits.ts`）。`workflows/` と `patterns/` は `agents/` を import しない（`role-based-cooperation.ts` だけが例外）。
- **ポート（`packages/ai-core/src/ports/`）**: clock、http、rerank、transcript、web-search（Tavily のパターン）。arXiv、サンドボックス、MCP のポートはない。
- **モック（`packages/ai-core/src/mock/`、`fixtures/`）**: シナリオとカセットの仕組み。Req 3.10 の疑似サンドボックスの土台になる。
- **RAG（`packages/ai-core/src/rag/`）**: drizzle と PGlite / Postgres。ヘルプデスクのチケットとサンプル投入の土台になる可能性がある。
- **Web（`apps/web/app/api/agent/tools/route.ts`、`apps/web/components/agent/renderers.tsx`）**: guard → resolve → buildToolSet → createGuardedAgent → createAgentUIStreamResponse の流れ。`TOOL_RENDERERS` は既存ツールだけを描画する。ダッシュボード、チャート、表、Agent Inspector の部品はない。

### 3.2 依存関係の現状

- MCP: `@ai-sdk/mcp` は `@ai-sdk/react` 経由の推移的依存のみ（lockfile 上）。直接依存、MCP SDK、E2B、表計算ライブラリ、チャートライブラリはない。
- 環境設定: `config/env-schema.ts` と `config/feature-requirements.ts` に、GitHub トークン、E2B、サンドボックス関連の項目がない。
- 静的検査: `scripts/check-repo-rules.mjs` の `no-dynamic-eval`（`:808-851`）は `packages/`、`apps/`、`scripts/`、`tooling/` 全域で `child_process` と `node:child_process` の import を禁止し、例外の許可リストを持たない。

### 3.3 外部依存の調査（sdd-reader による、2026-10-16 時点）

調査は npm レジストリと公式ドキュメントで行い、リポジトリのファイルは変更していない。`node_modules` に該当パッケージはなく、npm の公開日時（`time` フィールド）は一部しか取得できなかった。

| 対象 | 確認できたこと | 未確認 |
|---|---|---|
| AI SDK v7 の MCP クライアント | `@ai-sdk/mcp` 2.0.77（`ai` 本体とは別パッケージ）。HTTP、SSE、stdio（`@ai-sdk/mcp/mcp-stdio`）、カスタムの各 transport。`client.tools({schemas})` で列挙したツールだけを読み込める（許可リストに使える）。終了は `client.close()` | `@ai-sdk/mcp` 2.0.77 と `ai` 7.0.137 の peer 互換。推移的に入っている 2.0.73 との差 |
| 公式 MCP TypeScript SDK | v1 は `@modelcontextprotocol/sdk` 1.32.1（2026-10-05 公開）。v2 は `@modelcontextprotocol/server` 2.3.1（同日）。2.2.0 は 09-28 公開で、2 週間ルール（1440 分）を満たす。2.3.0 は 10-02 公開で境界上。v2 の stdio API は `McpServer` と `StdioServerTransport`（`@modelcontextprotocol/server/stdio`） | v2 のクライアント側パッケージ名。2.2.0 の正確な公開時刻 |
| E2B | `@e2b/code-interpreter` 2.9.0、`e2b` 2.56.0。`Sandbox.create({timeoutMs})` と `runCode` で、結果に stdout、stderr、エラー、text、png（base64）、json、chart を含む。`kill()` で終了。認証は `E2B_API_KEY` が必須で、ネットワークを使う | 公開日時。既定のタイムアウト値 |
| arXiv API | `http://export.arxiv.org/api/query`。Atom 1.0 の XML のみで、JSON はない。推奨は 3 秒の間隔とキャッシュ。1 リクエストの最大件数は 2000 | 厳密なレート制限の数値。XML パーサーの候補（`fast-xml-parser` は未検証） |
| 表計算の解析 | `exceljs` 4.4.0（MIT、npm 配布）が候補。`xlsx`（SheetJS）は npm 版が 0.18.5 で止まり deprecated、0.18.6 以降は CDN の tarball のみ | `exceljs` の advisory とメンテ状況。`read-excel-file` は未検証。SheetJS の advisory の主張は調査者の知識に基づき、検証していない |
| ローカルコンテナ | `dockerode` 5.0.1（Apache-2.0）は Docker のソケットに接続する。import 規則（`no-dynamic-eval`）は回避できる | Docker ソケットへの権限の扱い。macOS の Docker Desktop での動作 |

## 4. 統合上の課題

- **C1 子プロセスの禁止と隔離要件の衝突（最重要）**: Req 3.8 のローカルコンテナと Req 1.7 の stdio MCP サーバー起動はどちらも子プロセスか Docker ソケットを必要とする。`no-dynamic-eval` は子プロセスの import を例外なく禁止している。ルールに許可リストを足すのか、`dockerode` のようにソケットを使うのか、どちらも constitution の原則 6（LLM 生成コードはホストで実行しない）と 003 の spec の記述に照らして判断が要る。stdio MCP の子プロセスは `node_modules` 側にあり、ルールの走査対象外だが、設定の作成と起動は `packages/` 側で行う。
- **C2 致命的エラーの経路がない（Req 1.3）**: `failureFrom` は回復可能エラーとタイムアウトしか作らない。致命的エラーで run を `error` で止めるには、ツール実行の結果を停止条件へ伝える経路が要る。`guarded-agent.ts` の停止条件は step、トークン、時間の 3 種類だけである。
- **C3 MCP ツールの取り込み口（Req 1.8、1.15、1.16）**: MCP のツールは `defineAciTool` を通っていないため、`buildToolSet` が拒否する。アダプターでリスク区分を付ける必要があり、リスクは MCP の一覧からは分からない。許可リストで読み取り専用に限るなら、アダプターで検査する。ツール数は MCP のツールを含めて 20 以下に収める。
- **C4 書き込みツールと承認ゲートの関係（Req 1.9、1.17、2.6）**: GitHub の issue 作成、回答送信、ファイル削除は 1.17 で登録できない。Req 1.9 の GitHub MCP は読み取り専用のツールに限られる。承認ゲート（004 Req 4）が実装されるまでの扱いを spec で明確にする必要がある。
- **C5 計画実行とエージェント階層の置き場所（Req 2、4）**: Plan-and-Execute は `workflows/` に、Supervisor は `agents/` に置くのが自然だが、`patterns/` と `workflows/` のルールがある。Supervisor が `createGuardedAgent` で作ったサブエージェントをツールとして呼ぶ構成は、`agents/` の中で完結させるのが安全。`scripts/check-repo-rules.mjs` の `workflow-no-agent-loop` 規則との整合も確認が要る。
- **C6 UI の多主体ストリーミング（Req 2.5、3.5、4.9、6.3、6.4）**: `createAgentUIStreamResponse` は単一のエージェントを前提にしている。サブエージェントや合議のペルソナを区別するには、データ部品（data parts）でイベントを送る設計が要る。ダッシュボード、チャート、表、Agent Inspector の部品は新規に作る必要があり、005 の共有 HITL UI とテーマトークンに従う必要がある。
- **C7 チケットの永続化（Req 2.6、2.7、2.9）**: `resolved` と `escalated` の状態を保存する表が必要。承認待ちの永続化は本 spec の範囲外（005 Req 1.3）なので、チケットの表だけで足りる。
- **C8 サンドボックスの寿命（Req 3.7）**: アイドル 10 分の判定には接続の状態を追跡する仕組みが要る。E2B の寿命は `Sandbox.create({timeoutMs})` と `setTimeout` で設定でき、`kill()` で必ず破棄する必要がある。
- **C9 トークン内訳の集計（Req 4.10）**: `AgentRunSummary` は 1 エージェントの合計である。Supervisor とサブエージェントの内訳には、run の識別子を持つ集計を追加する必要がある。
- **C10 テストモードとネットワーク遮断**: テストは `fetch`、`node:net`、`node:dns` を遮断する。E2B と arXiv の SDK はネットワークを使うため、`mock` では SDK を直接使わず、ポートと fake を介して検証する。`local` と `live` の範囲も決める必要がある。
- **C11 サプライチェーン**: `minimumReleaseAge: 1440` と exact pin に従う。`@ai-sdk/mcp` 2.0.77 と `ai` 7.0.137 の peer 互換を、依存を追加する前に確認する。MCP SDK は 2.2.0 が候補になるが、v1 系と v2 系のどちらを選ぶかは plan で決める。

## 5. 実装アプローチの選択肢

| 観点 | A. 拡張（extend） | B. 新規（new） | C. ハイブリッド（hybrid） |
|---|---|---|---|
| 内容 | 既存の `ai-core` の `aci/`、`agents/`、`workflows/`、`patterns/`、`ports/` と `apps/web` に機能を足す | 新しいワークスペース（例: `packages/domain-agents/`）に、MCP、サンドボックス、表計算などの依存をまとめる | 純粋なロジックとポートは `ai-core` に足し、外部接続の実装と UI は `apps/web` か専用の実装に分ける |
| 再利用 | 最大（ガード、観測、構造化出力、モック） | 中（`ai-core` の API を import する） | 大（ロジックは再利用し、実装だけを分ける） |
| 依存の混入 | `ai-core` に子プロセスや MCP SDK が入る。純粋性を損なう | 依存は隔離されるが、`structure.md` は新しいトップレベルのワークスペースを作らない前提で、ワークスペースの追加は steering の変更になる | 子プロセス系は `ports/` の実装か `lib/server/` に閉じ込められる。ルールの例外は最小限にできる |
| 規則との衝突 | `no-dynamic-eval`、`workflow-no-agent-loop`、`patterns/` と `agents/` の import 制限と衝突しやすい | 規則は新しい場所にも同じく適用される。steering の変更が必要 | 例外が必要な箇所（C1）を一か所に絞れる |
| 主なリスク | `ai-core` が肥大化する | 構造の一貫性が崩れる | 境界の判断を誤ると、どちらにも属さない中途半端なコードになる |

**推奨（情報提供）**: C（ハイブリッド）。純粋なロジック（計画の DAG 検証、失敗の分類、Replanner の型、Think ツール、コーパス照合）と、ポート（arXiv、サンドボックス、MCP）の型は `ai-core` に置く。子プロセスや Docker を使う実装は、ルールの例外を一か所に絞ったうえで `ports/` の本番実装として分離する。UI は `apps/web` に置く。最初に決めるべきは C1（サンドボックスとルール例外の方式）で、Req 3 の成否に直結する。新しいワークスペースの追加（B）は steering の変更になるため、必要性が明確になってから検討する。

## 6. 計画フェーズで調べるべき事項

| # | 項目 | 理由 | 状態 |
|---|---|---|---|
| R1 | `no-dynamic-eval` の例外の方式（許可リストか、`dockerode` か）と constitution 原則 6 の解釈 | C1。Req 3.8 と 1.7 の前提になる | 未決定（実装の方式を比較する spike が必要） |
| R2 | `@ai-sdk/mcp` 2.0.77 と `ai` 7.0.137 の peer 互換。`client.tools({schemas})` が許可リストとして期待どおり働くか | C11、Req 1.8 | 一部検証（公式ドキュメントのみ。実際のインストールで確認が必要） |
| R3 | MCP SDK の版（v2 の `@modelcontextprotocol/server` 2.2.0 か、v1 の別版か）と、v2 のクライアント側パッケージ名 | Req 1.7 と 2 週間ルール | 一部検証（公開日は一部のみ取得） |
| R4 | E2B の SDK の版、公開日、既定のタイムアウト、結果の型（png、chart）の Req 3.5 への対応 | Req 3.1、3.5、3.7 | 一部検証 |
| R5 | `dockerode` とソケットの権限、Docker Desktop での動作、`compose.yaml` のプロファイル追加の要否 | Req 3.8 | 未検証 |
| R6 | 表計算の解析ライブラリ（`exceljs` 4.4.0 の advisory とメンテ状況）と CSV の解析（`csv-parse` など） | Req 3.9 | 一部検証（advisory は未確認） |
| R7 | arXiv の XML パーサーと、レート制限の具体的な扱い（3 秒の間隔を `Clock` で制御する設計） | Req 4.3、4.7 | 一部検証 |
| R8 | チャートと表の描画ライブラリ（React 19 と React Compiler との相性を含む） | Req 3.5、4.9 | 未調査 |
| R9 | 既存ツールの説明文の書式と、ID の形式（Req 1.11、1.13） | 既存コードの確認で足りる | 未確認（計画で読む） |
| R10 | チケットの表のスキーマと、`rag/` の drizzle 基盤の流用 | Req 2.6 から 2.9 | 未調査 |
| R11 | 承認ゲート（004 Req 4）の実装時期と、M3 のハンズオンで書き込みツールを使えない場合の代替（Req 1.17） | 計画の前提 | 未確認（004 の計画を参照） |

