# 『現場で活用するためのAIエージェント実践入門』最新化 & Vercel AI SDK 移行計画書

本書籍のサンプル実装および解説構成を、Python / LangChain / LangGraph 中心のエコシステムから、**TypeScript / Vercel AI SDK (Core & UI)** を基軸としたモダンなWebネイティブ・AIエージェント開発スタックへと全面改訂・最新化するためのアーキテクチャ移行計画書です。

---

## 1. 移行の背景とビジョン

### 1.1 背景
元書籍（講談社サイエンティフィック、2025年刊）は、ヘルプデスク、データ分析、論文探索、マーケティングといった実務ユースケースを題材に、AIエージェントのコア概念（プロファイル、計画、ツール呼び出し、自己修正、評価）を体系化した優れた実践書です。
一方で、近年のAIエージェント開発現場では以下のパラダイムシフトが起きています。

1. **プロダクト統合とフロントエンド親和性**: エージェントの価値は推論ループだけでなく、**ストリーミングUI、Generative UI、Human-in-the-Loop（人間の介在・承認）** を含むユーザー体験（UX）に直結している。
2. **フレームワークの軽量化と型安全性**: LangChainの複雑な抽象化レイヤーから、Web標準（Streams API）に準拠し、Zodによる厳格な型推論を提供する **Vercel AI SDK** への移行が進んでいる。
3. **外部連携のオープン標準化**: プロプライエタリなツール定義から、**Model Context Protocol (MCP)** による標準プロトコルへの移行。
4. **最新推論モデルの浸透**: 推論モデル（OpenAI o1/o3/o4、Claude 3.7 Sonnet Thinking、Gemini 2.5 Flash/Pro 等）の登場による、プロンプト主導型計画からモデルネイティブな推論・計画への進化。

### 1.2 改訂の目的
* **TypeScript / Full-Stack エンジニアへの門戸開放**: Next.js / Node.js 開発者が現場で即使えるアーキテクチャを提供。
* **LangGraph から AI SDK へのパターン再定義**: 複雑なステートグラフを、シンプルな関数合成・マルチステップツールループ・耐久ワークフローへ再解釈。
* **「動くUI」を含めた体験の提供**: CUI / ノートブック中心から、リアルタイムに進捗が可視化されるWebアプリケーションとしてのサンプル提供。

---

## 2. 技術スタック対照表（Before / After）

| 領域 | 元書籍 (Before) | 移行後 (After: Vercel AI SDK) | 移行メリット・変更理由 |
| :--- | :--- | :--- | :--- |
| **開発言語** | Python 3.11+ | TypeScript 5.5+ (Node 22 / Bun) | 型安全性、フロントエンドコードとの共有、Web標準準拠 |
| **コアSDK** | LangChain Core / Community | `ai` (Vercel AI SDK Core) | 軽量、余分なラップが不要、Web Streams APIネイティブ |
| **スキーマ定義** | Pydantic v2 | Zod v3 | TypeScriptにおける業界デファクト、クライアント/サーバー共通化 |
| **オーケストレーション** | LangGraph (StateGraph) | AI SDK `maxSteps` + TypeScript関数パイプライン / ステートマシン | 過度な抽象化を排し、デバッグ容易性と制御性を向上 |
| **UI連携** | なし (CLI / Jupyter / Streamlit) | `@ai-sdk/react` (`useChat`, Generative UI) + Next.js App Router | ストリーミング表示、中間状態の可視化、承認ボタンの実装 |
| **ツールプロトコル** | LangChain Tool / Custom BaseTool | AI SDK `tool()` + `@modelcontextprotocol/sdk` (MCP) | ツール定義の業界標準規格 (MCP) にネイティブ対応 |
| **コード実行環境** | E2B Code Interpreter (Python SDK) | E2B Code Interpreter (`@e2b/code-interpreter` TS SDK) | サンドボックス実行の安全性を維持したままTSから制御 |
| **評価フレームワーク** | Ragas / LLM-as-a-Judge (Python) | Braintrust / Langfuse SDK + Vitest | CI/CDに組み込みやすいテスト自動化と評価スイート |
| **可視化 / 追跡** | LangSmith / LangGraph Studio | Langfuse / OpenTelemetry (`experimental_telemetry`) | ベンダーロックインのない標準的な計装 (OTel) |

---

## 3. 章ごとの詳細移行・最新化プラン

### 第Ⅰ部 AIエージェントを知る

#### 第1章: AIエージェントの概要
* **元本の内容**: エージェントの定義、Agent-Tuning、推論と学習の役割、開発フレームワークの俯瞰。
* **改訂・最新化内容**:
  * 推論モデル（Reasoning Models）がエージェントアーキテクチャに与えた影響の追加（暗黙的Chain-of-Thought vs 明示的Planning）。
  * エージェント開発スタックの現在地：Python一強から「バックエンド/UIが統合されたTypeScript/Full-Stackスタック」へのシフト。
  * Vercel AI SDKの設計思想（UI主導型エージェント開発、Web Streamsネイティブ）の解説。

#### 第2章: AIエージェントの構成
* **元本の内容**: プロファイル、ツール呼び出し、計画、自己修正、メモリ、シングル/マルチエージェント。コラムでMCPに言及。
* **改訂・最新化内容**:
  * **MCP (Model Context Protocol)** をコラムから**本編の最重要トピック**へ昇格。エージェントとツール、リソース、プロンプトの疎結合アーキテクチャを体系化。
  * **メモリの再定義**: 揮発性短期メモリ（メッセージ配列）、セマンティック長期メモリ（ベクトル検索）、外部状態ストア（Redis / KV / Postgres）の役割整理。
  * **ワークフロー分類の整理**: 単純なTool Loop（ReAct）から、ルーティング、並列実行、オーケストレーター・ワーカー型へのマッピング。

---

### 第Ⅱ部 AIエージェントを作る

#### 第3章: 開発準備
* **元本の内容**: OpenAI Chat Completions、Function Calling、Embedding、Assistants API、LangGraphの基礎。
* **改訂・最新化内容**:
  * **Vercel AI SDK Coreの基礎**: `generateText`、`streamText`、`generateObject`、`streamObject` の完全マスター。
  * **プロバイダ抽象化**: OpenAI (`@ai-sdk/openai`), Anthropic (`@ai-sdk/anthropic`), Google (`@ai-sdk/google`) の即時切り替え。
  * **Zodを用いたツール定義**:
    ```typescript
    import { tool } from 'ai';
    import { z } from 'zod';

    export const weatherTool = tool({
      description: '指定された都市の天気を取得する',
      parameters: z.object({
        city: z.string().describe('都市名（例: 東京都、大阪市）'),
      }),
      execute: async ({ city }) => {
        // API呼び出し
        return { city, temperature: 22, condition: 'Sunny' };
      },
    });
    ```
  * **MCP クライアントの導入**: Claude Desktopや各種MCPサーバー（Filesystem, GitHub, Brave Searchなど）とAI SDKのブリッジ設定。

---

#### 第4章: ヘルプデスク担当者を支援する（Plan-and-Execute型）
* **元本のアプローチ**: LangGraphの`StateGraph`を用い、Plan作成ノード、Tool選択、Tool実行、Self-Correction、Final Answerノードを明示的に配線。
* **移行設計**:
  * **Plan-and-Execute パターン in AI SDK**:
    1. **Planner (`generateObject`)**: Zodスキーマで `tasks: { id: number, description: string, status: 'pending' }[]` を構造化生成。
    2. **Executor (`streamText` + tools)**: 各サブタスクに対してツール（社内マニュアル検索、過去QAベクトル検索）をバインドして自律実行。
    3. **Replanner / Reflector**: 各ステップの実行結果を評価し、計画の修正または最終回答の生成を判断。
  * **ベクトル検索 (RAG)**: LangChainのVectorStoreから、Supabase (`pgvector`) または Turso / Qdrant + AI SDK `embed` / `embedMany` によるモダンなRAGパイプラインへ刷新。
  * **ストリーミングUI**: 実行中の計画ステータス（進行中・完了・修正）がブラウザ上でリアルタイムに更新されるNext.js UIの提供。

---

#### 第5章: データ分析者を支援する（Code Interpreter & Reflection）
* **元本のアプローチ**: Python環境 + E2B Python SDK を使い、データセットに対するコード生成・実行・リフレクションのループを構築。
* **移行設計**:
  * **TypeScriptからのE2B制御**:
    * `@e2b/code-interpreter` (Node.js SDK) を使用し、クラウドサンドボックス上でPythonコードを実行。
    * エージェントはTypeScript側で動作し、コード生成・実行結果（ログ・標準出力・エラー・グラフ画像）の受け取りをオーケストレーション。
  * **Self-Correction (自己修正ループ)**:
    * E2Bのエラー出力（Traceback）を即座にAI SDKのメッセージ履歴へフィードバックし、最大試行回数内でコードを再生成させるリフレクション機構。
  * **Generative UI による可視化**:
    * E2Bが生成したグラフ（Base64 PNG / Chart.js用JSONデータ）を、Next.jsのクライアントコンポーネントでリッチに描画。

---

#### 第6章: 情報収集者を支援する（マルチエージェント arXiv探索）
* **元本のアプローチ**: LangGraphによるマルチエージェント（ResearchAgent, PaperSearchAgent, PaperAnalyzerAgent） + LangGraph Studio による可視化。
* **移行設計**:
  * **階層型マルチエージェント (Supervisor / Sub-agents)**:
    * Vercel AI SDKにおける最新のマルチエージェントパターンを採用。
    * **Supervisor Agent** は各専門エージェントを「ツール」として呼び出す設計（Agent-as-a-Tool パターン）:
      ```typescript
      const paperSearchTool = tool({
        description: 'arXivから指定クエリに関連する論文メタデータを検索・抽出する専門エージェント',
        parameters: z.object({ query: z.string(), maxResults: z.number().default(5) }),
        execute: async (args) => await runPaperSearchSubAgent(args),
      });
      ```
  * **LangGraph Studioの代替**:
    * LangGraph Studio（プロプライエタリな可視化ツール）の代わりに、**オープンソースの Web ダッシュボード (Next.js)** を提供。
    * 各サブエージェントの思考ログ、実行ツール、中間成果物（論文サマリーカード）をストリーミング表示する「Agent Inspector UI」を構築。

---

#### 第7章: マーケティングを支援する（ロールプレイング & レコメンド）
* **元本のアプローチ**: ペルソナ別マルチエージェントによるディベート・評価・改善ループ、会話型レコメンド。
* **移行設計**:
  * **Role-Playing Consensus Pattern**:
    * 複数ペルソナ（「辛口なマーケター」「一般消費者ペルソナ」「SEOスペシャリスト」）の `streamText` をパイプラインで接続。
    * 互いの発言を踏まえて改善案をイテレーションするラウンドロビン方式の対話制御。
  * **リアルタイム・パーソナライズ**:
    * 会話中に抽出されたユーザープロファイル（関心事、予算、懸念点）を `streamObject` で随時抽出し、UI側のレコメンドスロットへ即時反映。

---

### 第Ⅲ部 AIエージェントを現場で使う

#### 第8章: AIエージェントの評価
* **元本の内容**: LLM-as-a-Judge、エージェント能力評価指標、エラー分析。
* **改訂・最新化内容**:
  * **TypeScript/Vitest によるCI/CD統合評価**:
    * Pythonスクリプトではなく、Web開発者になじみのあるテストランナー（Vitest）でエージェントの自動回帰テストを実行。
  * **合成データ生成とベンチマーク**:
    * AI SDKの `generateObject` を使ったシナリオテストデータの自動生成。
  * **Braintrust / Langfuse 連携**:
    * スコアリング（正確性、ツール呼び出し妥当性、コスト/レイテンシ）をダッシュボードで追跡。

#### 第9章: AIエージェントのUX・運用・セキュリティ
* **元本の内容**: UX、プロンプトインジェクション、AgentOps、LangSmith。
* **改訂・最新化内容**:
  * **Agent UXの黄金律**:
    * ストリーミング、中間状態の可視化、キャンセル処理（`AbortController`）、Human-in-the-Loop（ツール実行前の承認ダイアログ）。
  * **OpenTelemetryネイティブな追跡**:
    * Vercel AI SDK の `experimental_telemetry` を活用し、Langfuse や Datadog / OpenTelemetry Collector への完全エクスポート。
  * **型レベルのセキュリティ**:
    * Zodによる出力サニタイズ、プロンプトインジェクション検知ガードの組み込み。

#### 第10章: プロダクション導入事例とアーキテクチャ
* **元本の内容**: 電通総研、Algomatic、ジェネラティブエージェンツの実務知見。
* **改訂・最新化内容**:
  * Webサービスにエージェントを本格組み込みする際のサーバーレスアーキテクチャ（Vercel, AWS ECS/Lambda, Cloudflare Workers）の選定基準。
  * コスト最適化: キャッシュ戦略（Prompt Caching）、軽量モデルとフロンティアモデルのハイブリッドルーティング。

---

## 4. コアパターンの実装リファレンス（TypeScript / AI SDK）

### 4.1 Plan-and-Execute パターン（ヘルプデスクエージェント）

```typescript
// packages/agents/helpdesk/src/plan-and-execute.ts
import { generateObject, streamText, tool } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';

// 1. 計画生成スキーマ
const PlanSchema = z.object({
  steps: z.array(z.object({
    id: z.number(),
    description: z.string(),
    requiredTool: z.enum(['manualSearch', 'qaSearch', 'none']),
  })),
});

export async function runHelpdeskAgent(userQuery: string, onUpdate?: (step: any) => void) {
  // ステップ1: 計画立案 (Planner)
  const { object: plan } = await generateObject({
    model: openai('gpt-4o'),
    schema: PlanSchema,
    prompt: `ユーザーからのヘルプデスク問い合わせを解決するためのタスク分解を行ってください。\n問い合わせ: "${userQuery}"`,
  });

  const executionResults: Record<number, string> = {};

  // ステップ2: 計画の実行 (Executor)
  for (const step of plan.steps) {
    onUpdate?.({ status: 'running', stepId: step.id, description: step.description });

    const stepResult = await streamText({
      model: openai('gpt-4o-mini'),
      messages: [
        { role: 'system', content: 'あなたはヘルプデスク支援の実行エージェントです。与えられたサブタスクをツールを用いて解決してください。' },
        { role: 'user', content: `タスク: ${step.description}\nこれまでの実行ログ: ${JSON.stringify(executionResults)}` },
      ],
      tools: {
        manualSearch: tool({
          description: '社内製品マニュアルをセマンティック検索する',
          parameters: z.object({ query: z.string() }),
          execute: async ({ query }) => {
            // ベクトル検索処理
            return `マニュアル抜粋: ${query} に関する仕様...`;
          },
        }),
        qaSearch: tool({
          description: '過去の解決済み問い合わせQAデータベースを検索する',
          parameters: z.object({ query: z.string() }),
          execute: async ({ query }) => {
            return `類似QA: 過去の問い合わせ結果...`;
          },
        }),
      },
      maxSteps: 3, // 自動ReActループ
    });

    executionResults[step.id] = await stepResult.text;
    onUpdate?.({ status: 'completed', stepId: step.id, result: executionResults[step.id] });
  }

  // ステップ3: 最終回答の集約 (Synthesizer)
  return streamText({
    model: openai('gpt-4o'),
    prompt: `以下の実行結果を総合して、ユーザーへの丁寧な最終回答を作成してください。\n問い合わせ: ${userQuery}\n実行結果: ${JSON.stringify(executionResults)}`,
  });
}
```

---

### 4.2 サンドボックス実行 & リフレクション（データ分析エージェント）

```typescript
// packages/agents/data-analyst/src/analyst.ts
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { CodeInterpreter } from '@e2b/code-interpreter';

export async function runDataAnalysisAgent(task: string, datasetPath: string, maxRetries = 3) {
  const sandbox = await CodeInterpreter.create();
  let currentPrompt = `データセット(${datasetPath})を用いて以下の分析を行うPythonコードを作成してください。\nタスク: ${task}`;
  let attempt = 0;

  try {
    while (attempt < maxRetries) {
      attempt++;
      
      // 1. コード生成
      const { text: codeResponse } = await generateText({
        model: openai('gpt-4o'),
        system: 'あなたは優秀なデータサイエンティストです。実行可能なPythonコードのみをコードブロックで出力してください。',
        prompt: currentPrompt,
      });

      const pythonCode = extractCodeBlock(codeResponse);

      // 2. E2Bサンドボックスでの安全なコード実行
      const execution = await sandbox.runCode(pythonCode);

      // 3. エラー評価 & リフレクション
      if (execution.error) {
        console.warn(`[Attempt ${attempt}] 実行エラー検出:`, execution.error.value);
        currentPrompt = `前回のコード実行で以下のエラーが発生しました。コードを修正してください。\nエラー: ${execution.error.value}\nTraceback: ${execution.error.tracebackRaw}\n元コード:\n${pythonCode}`;
        continue;
      }

      // 成功した場合: ログとグラフ画像の抽出
      const charts = execution.results.filter(r => r.png).map(r => r.png);
      return {
        success: true,
        logs: execution.logs.stdout.join('\n'),
        charts, // Base64 PNG
        code: pythonCode,
      };
    }

    throw new Error(`最大試行回数(${maxRetries})を超えてもエラーが解消しませんでした。`);
  } finally {
    await sandbox.kill();
  }
}

function extractCodeBlock(text: string): string {
  const match = text.match(/```(?:python)?\n([\s\S]*?)```/);
  return match ? match[1].trim() : text.trim();
}
```

---

## 5. モダナイズされたリポジトリ構成（Monorepo設計）

PythonのVSCodeワークスペース構成から、**pnpm + Turborepo** によるモダンなフルスタックTypeScriptリポジトリへ移行します。

```text
genai-agent-book-ts/
├── apps/
│   └── web/                     # Next.js 15+ (App Router) - エージェント統合Web UI
│       ├── app/
│       │   ├── api/
│       │   │   ├── chat/route.ts
│       │   │   └── agents/[agentName]/route.ts
│       │   ├── helpdesk/        # 第4章: ヘルプデスクUI (Plan可視化)
│       │   ├── analyst/         # 第5章: データ分析UI (E2Bチャート描画)
│       │   ├── researcher/      # 第6章: 論文リサーチダッシュボード
│       │   └── marketing/       # 第7章: ディベート & レコメンドUI
│       └── components/          # shadcn/ui + Generative UI コンポーネント群
├── packages/
│   ├── agents/                  # 各章のコアエージェントロジック (Pure TS)
│   │   ├── helpdesk/            # 第4章 ロジック
│   │   ├── data-analyst/        # 第5章 ロジック (E2B連携)
│   │   ├── paper-researcher/    # 第6章 ロジック (arXiv MCP連携)
│   │   └── marketing/           # 第7章 ロジック
│   ├── core/                    # 共通エージェント基盤
│   │   ├── mcp/                 # MCPクライアントラッパー
│   │   ├── memory/              # メモリ抽象化 (Redis / Vector)
│   │   └── telemetry/           # OpenTelemetry / Langfuse 設定
│   └── eval/                    # 第8章: Vitest + Braintrust 評価スイート
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
└── README.md
```

### 開発体験の改善ポイント
* **単一の `pnpm dev`**: Web UIと全エージェントパッケージのホットリロードが同時に立ち上がる。
* **TypeScriptの型共有**: エージェントのZodスキーマ定義を、Next.jsのフロントエンド（フォームバリデーションや表示コンポーネント）で完全再利用可能。
* **環境変数管理**: `.env.example` に `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `E2B_API_KEY`, `LANGFUSE_PUBLIC_KEY` などを集約。

---

## 6. 改訂ロードマップと移行マイルストーン

| フェーズ | 期間目安 | 主なタスク | 成果物 |
| :--- | :--- | :--- | :--- |
| **Phase 1: コアアーキテクチャ刷新** | 1〜2週 | • Monorepo (pnpm + Turborepo) 環境構築<br>• Vercel AI SDK Core + MCP の基本ラッパー作成 (`packages/core`)<br>• 第3章（開発準備）のTS版サンプル作成 | 共通コアライブラリ、開発環境基盤 |
| **Phase 2: 実践エージェント移植 (4〜7章)** | 3〜4週 | • 第4章: Plan-and-Execute + Supabase pgvector 移植<br>• 第5章: E2B TypeScript SDK + Self-Correction 移植<br>• 第6章: arXiv探索マルチエージェント + 独自Inspector UI作成<br>• 第7章: マーケティングディベート実装 | `packages/agents/*`<br>各章のユニットテスト |
| **Phase 3: Web UI & Generative UI 統合** | 2〜3週 | • `apps/web` (Next.js 15) 構築<br>• ストリーミングUI、ステップ実行可視化コンポーネント作成<br>• E2B生成チャートのストリーミング描画対応 | 動作するフルスタックWebアプリケーション |
| **Phase 4: 評価・オブザーバビリティ (8〜9章)** | 1〜2週 | • Vitest によるエージェント自動回帰テスト (`packages/eval`)<br>• Langfuse / OTel トレース連携の整備<br>• エラーハンドリングとセキュリティガードレールの実装 | 評価スクリプト、ダッシュボード設定ガイド |
| **Phase 5: ドキュメント・書籍原稿改訂** | 2週 | • 各章の解説文リライト（Python/LangChain比較コラム含む）<br>• 図版（LangGraph状態図 → AI SDKワークフロー図）の更新<br>• README整備とハンズオン手順書の完成 | 改訂版リポジトリ、書籍改訂原稿 |

---

## 7. 結論・期待される波及効果

本プランに沿って LangChain から Vercel AI SDK へ置き換えることにより、以下の決定的なメリットが得られます。

1. **実用性とプロダクション即応性の向上**:
   PoC止まりになりがちなPythonスクリプトから、企業がそのまま自社サービスに組み込める「Next.js + Vercel AI SDK」による本番水準のコードベースへ進化します。
2. **圧倒的な開発者体験（DX）と可読性**:
   LangGraphのノード・エッジによる重厚な抽象化を排し、TypeScriptのネイティブな制御構造とAI SDKのストリーミングモデルを活用することで、初学者にも構造が極めて理解しやすくなります。
3. **最新のエコシステム（MCP・推論モデル）への追随**:
   2025〜2026年のAI標準である Model Context Protocol や最新の推論モデルをフル活用できる、息の長い書籍・リポジトリへと刷新されます。