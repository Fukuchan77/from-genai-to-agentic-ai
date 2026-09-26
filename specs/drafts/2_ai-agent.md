# 書籍『LangChain と LangGraph による RAG・AI エージェント［実践］入門』
## Vercel AI SDK 移行＆最新化リニューアル設計書

---

## 1. 企画概要と移行の基本方針

### 1.1 背景と課題認識
元本（2024年11月刊）は、Python エコシステムにおける **LangChain / LangGraph** を用いて、チャット API の基礎から RAG、評価、そして 18 のエージェントデザインパターンまでを網羅した名著です。
しかし、Web アプリケーションの実プロダクション開発の現場においては、以下の課題やパラダイムの変化が顕著になっています。

1. **Python から TypeScript / フルスタックへのシフト**
   - モダンな AI アプリケーションは、UI（Next.js / React）、エッジ実行（Vercel, Cloudflare, Node.js）、ストリーミング UX と密結合しており、TypeScript 単一言語でのエンドツーエンド開発需要が急速に高まっています。
2. **LangChain の過剰な抽象化（Over-Abstraction）の回避**
   - LCEL（LangChain Expression Language）の学習コストやデバッグの難しさに対し、Web 標準（Fetch, ReadableStream, AsyncIterable）に基づいた**薄く・予測可能で・型安全なラッパー**が選好されるようになっています。
3. **モデル機能（Tool Calling / Structured Outputs）の標準化**
   - プロンプトハックや複雑なパーサーを使わずとも、LLM 側のネイティブ機能（JSON Schema / Tool Calling）を Zod などの型定義ライブラリで直感的にバインドできるようになりました。
4. **Vercel AI SDK（v4+）の台頭**
   - `ai` パッケージ（AI SDK Core）による統一されたプロバイダ層、`ai/react` による強力なストリーミング・Generative UI 連携、`maxSteps` やマルチステップツール呼び出しによる軽量エージェント構築など、Web 時代の標準デファクトとなっています。

### 1.2 リニューアルのコア・コンセプト
- **「抽象化の壁を取り払い、Web 標準と型安全性で AI エージェントを飼いならす」**
- 言語：**TypeScript 5.x**（Node.js 20+ / Bun / Next.js App Router）
- 主要ライブラリ：**Vercel AI SDK (Core / UI)**、**Zod**、**Drizzle ORM / pgvector**
- 設計思想：ブラックボックスなフレームワークに頼らず、**「素の TypeScript コード ＋ AI SDK の薄いプリミティブ」** で自律型エージェントとステートマシンを構築する。

---

## 2. 技術スタック・アーキテクチャ対照表

| 領域 | 元本（LangChain / LangGraph 版） | 刷新後（Vercel AI SDK 版） | 移行によるメリット |
| :--- | :--- | :--- | :--- |
| **主言語・実行環境** | Python 3.11+ / Google Colab | TypeScript / Node.js & Next.js App Router | 型安全（End-to-End Type Safety）、Web/UI との完全親和性 |
| **LLM 接続レイヤー** | `langchain-openai`, `langchain-anthropic` | `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google` | 統一プロバイダ規格、プロバイダ固有の無駄なラッパー排除 |
| **基本呼び出し** | `chat_model.invoke()`, `.stream()` | `generateText()`, `streamText()` | Web 標準の `ReadableStream`、シンプルな Promise ベース |
| **構造化出力** | `PydanticOutputParser`, `with_structured_output` | `generateObject()`, `streamObject()` (Zod) | スキーマと TypeScript 型の完全一致、部分生成のストリーミング |
| **連鎖・パイプライン** | LCEL (`\|`, `RunnableSequence`, `RunnableParallel`) | 素の TypeScript 関数合成, `Promise.all` | 特殊構文の学習コストゼロ、通常のデバッガがそのまま使える |
| **ツール定義** | `@tool` デコレータ, `DynamicStructuredTool` | `tool({ description, parameters: z.object({...}), execute })` | Zod によるパラメータ検証と型推論の一体化 |
| **エージェントループ** | `create_react_agent`, AgentExecutor | `generateText({ tools, maxSteps: N })` | わずか数行で Multi-step Tool Calling ループが完結 |
| **ステートマシン** | `StateGraph`, `START/END`, 条件付きエッジ | 型安全な State 駆動ループ または Lightweight State Machine | グラフのブラックボックス化を防ぎ、状態遷移の追跡が自明に |
| **ベクターストア** | Chroma, FAISS, `langchain-community` | PostgreSQL (`pgvector`), Supabase, Pinecone | プロダクションで実用される DB と SQL の直感的操作 |
| **Embedding** | `OpenAIEmbeddings` | `embed()`, `embedMany()` | 超高速かつ配列操作がシンプルな標準 API |
| **可観測性・トレース** | LangSmith | OpenTelemetry (OTel) ＋ Langfuse / Braintrust | ベンダーロックインのない標準 OTel テレメトリ |
| **UI 統合** | Streamlit, Gradio, LangServe | `useChat`, `useCompletion`, Generative UI | 本格的な Web フロントエンドとリアルタイム描画 |

---

## 3. 全章再構成シラバス（新旧対比と詳細設計）

### 第1部：モダン AI アプリケーションの土台（第1章〜第3章）

#### 第1章：LLM アプリケーション開発の現在地
- **元本の内容**：生成 AI の現状、Copilot vs AI エージェント、エージェントの知識地図。
- **最新化方針**：
  - Reasoning モデル（OpenAI o1/o3-mini, DeepSeek-R1）の台頭と、プランニング・思考プロセスの変化を解説。
  - フロントエンドとバックエンドの境界が溶ける AI ネイティブなシステム構成図を提示。
  - なぜ今、Python 単体から TypeScript / Vercel AI SDK への潮流が生まれているのかを論理的に解説。

#### 第2章：Vercel AI SDK Core による LLM 呼び出しの基本
- **元本の内容**：OpenAI API（Completions, Function Calling, Structured Outputs）。
- **最新化方針**：
  - AI SDK Core の 4 大プリミティブ（`generateText`, `streamText`, `generateObject`, `streamObject`）の徹底解説。
  - マルチプロバイダの切り替え（OpenAI / Anthropic / Google Gemini）を 1 行で実現するコード。
  - Zod を用いた型安全な Structured Outputs。
  - Tool Calling の仕組みと、モデルによる動的ツール選択のフロー。

#### 第3章：型安全なプロンプト設計とコンテキスト管理
- **元本の内容**：プロンプトエンジニアリング（Zero-shot, Few-shot, CoT）。
- **最新化方針**：
  - テンプレート文字列を活用した TypeScript 的プロンプト構築。
  - `system`, `user`, `assistant`, `tool` メッセージの型定義とロール設計。
  - Reasoning トークン（思考プロセス）のストリーミングハンドリング。

---

### 第2部：RAG（検索拡張生成）の実践と評価（第4章〜第7章）

#### 第4章：Vercel AI SDK で構築する RAG パイプライン
- **元本の内容**：LangChain の DocumentLoader, TextSplitter, VectorStore, LCEL RAG。
- **最新化方針**：
  - LangChain の重厚な Loader を廃止し、Node.js ネイティブなチャンキング手法を実装。
  - `embed` / `embedMany` を用いたベクトル化。
  - pgvector（Drizzle ORM または Prisma 経由）を用いたベクトル類似度検索（コサイン類似度・内積）。
  - `streamText` に検索コンテキストを注入し、回答と引用元（Citations）をストリーミングする実装。

#### 第5章：TypeScript によるパイプライン合成とストリーミング制御
- **元本の内容**：LCEL 徹底解説（RunnableSequence, RunnableParallel, RunnableLambda 等）。
- **最新化方針**：
  - **LCEL を完全脱却**。TypeScript の言語機能（`async/await`, ジェネレータ, 高階関数）による明快なパイプライン構築。
  - AI SDK の `toDataStreamResponse()` や `createDataStream` によるカスタムストリーミング（思考中ステータス、検索中ログ、メタデータの同時送信）。
  - 並列実行（`Promise.allSettled`）による堅牢なエラーハンドリング。

#### 第6章：Advanced RAG の実践テクニック
- **元本の内容**：HyDE, Multi-Query, RAG-Fusion, Cohere Rerank, ハイブリッド検索。
- **最新化方針**：
  - **HyDE（仮説生成）**：`generateText` で仮想回答を生成してから検索。
  - **Multi-Query / RAG-Fusion**：`generateObject` を使い、Zod 配列スキーマでクエリを一括展開。Reciprocal Rank Fusion (RRF) を素の TypeScript で実装。
  - **Reranker**：Cohere Rerank API（公式 TS クライアント）を組み込んだ 2 段階フィルタリング。
  - **ハイブリッド検索**：PostgreSQL の Full-Text Search（tsvector / pg_trgm）＋ pgvector の融合。

#### 第7章：可観測性と RAG 評価（OpenTelemetry & Langfuse）
- **元本の内容**：LangSmith, Ragas による合成データ生成・オフライン評価。
- **最新化方針**：
  - Vercel AI SDK の `experimental_telemetry` 機能を用いた OpenTelemetry (OTel) 統合。
  - オープンソースの LLM 可観測性基盤 **Langfuse** または **Braintrust** との接続。
  - 評価指標（Faithfulness, Answer Relevance）を TypeScript スクリプトで実装し、CI/CD パイプラインに組み込む自動評価テストの実践。

---

### 第3部：AI エージェントと自律ワークフロー（第8章〜第10章）

#### 第8章：AI エージェントのアーキテクチャ進化論
- **元本の内容**：エージェントの歴史、ReAct, AutoGPT, crewAI, マルチエージェント。
- **最新化方針**：
  - 2025〜2026 年現在の最新トレンド（Anthropic "Building Effective Agents" で提唱された ワークフロー vs 自律エージェントの峻別）。
  - 「過度な自律性」の失敗と、「予測可能なワークフロー ＋ 局所的エージェント」の重要性。

#### 第9章：Vercel AI SDK で作る自律エージェント基礎
- **元本の内容**：LangGraph の概要（State, Node, Edge, Checkpointer）。
- **最新化方針**：
  - **Multi-step Tool Calling**：`streamText` の `maxSteps` オプションによる、ReAct ループの最小実装（モデルが満足するまで自動でツールを実行・考察）。
  - **Tool の動的実行と人間承認（Human-in-the-loop）**：危険なツール実行前の確認ステップの実装。
  - **状態永続化**：セッション状態をデータベース（Redis / PostgreSQL）へ安全に退避・復元する設計パターン。

#### 第10章：実案件実践：要件定義書生成 AI エージェントの開発
- **元本の内容**：LangGraph による要件定義エージェント（インタビュー、評価、生成）。
- **最新化方針**：
  - 要件定義エージェントを Next.js App Router ＋ Vercel AI SDK でフルスクラッチ構築。
  - **4 つの役割モジュール**（PersonaGenerator, InterviewConductor, InformationEvaluator, DocumentGenerator）を型安全な TypeScript クラス/関数として実装。
  - ユーザーとのリアルタイム対話（ヒアリング）とバックグラウンドでの要件構造化を並行処理するアーキテクチャ。
  - 最終成果物を Markdown / PDF としてダウンロードできるフルスタック実装。

---

### 第4部：エージェントデザインパターンの TypeScript 実装（第11章〜第12章）

#### 第11章：18 のエージェントデザインパターン体系
- **元本の内容**：18 のデザインパターン（ゴール生成、リフレクション、協調など）の理論解説。
- **最新化方針**：
  - 理論的枠組みは元本の優れた分類（18 パターン）を継承。
  - 各パターンについて「LangGraph のグラフ定義で書く場合」と「TypeScript の関数型・ステートマシンで書く場合」の比較視点を追加。

#### 第12章：AI SDK によるエージェントパターンの実践実装
- **元本の内容**：LangChain/LangGraph による 7 つの主要パターンの Python 実装。
- **最新化方針**：主要パターンを Vercel AI SDK で完全再実装。
  1. **Passive Goal Creator**：曖昧な指示から構造化された目標仕様書を生成（`generateObject`）。
  2. **Prompt/Response Optimizer**：自己改善ループ（入力プロンプトの洗練と回答の自己修正）。
  3. **Single-Path Plan Generator**：Step-by-step な順次タスク計画と実行。
  4. **Multi-Path Plan Generator**：複数シナリオを並列生成（`Promise.all`）し、評価器が最適解を選択。
  5. **Self-Reflection / Cross-Reflection**：批判モジュール（Critic）による推敲ループ。
  6. **Role-Based Cooperation（マルチエージェント協調）**：リサーチャー、コーダー、レビュアーの協調動作。

#### 【新設】第13章：Generative UI と本番デプロイ
- **元本にない独自章（AI SDK の真価を発揮）**：
  - AI がテキストではなく React コンポーネント（チャート、カード、フォーム）を直接クライアントに描画する **Generative UI** のハンズオン。
  - Vercel へのデプロイ、エッジランタイムでのストリーミング最適化、Rate Limit 対策。

---

## 4. コア実装のコード置換比較ガイド

### 4.1 基本呼び出しと構造化出力（第2章・第4章相当）

#### 過去のコード（LangChain Python）
```python
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import PydanticOutputParser
from langchain_openai import ChatOpenAI
from pydantic import BaseModel, Field

class Recipe(BaseModel):
    title: str = Field(description="料理名")
    ingredients: list[str] = Field(description="材料リスト")
    steps: list[str] = Field(description="調理手順")

parser = PydanticOutputParser(pydantic_object=Recipe)
prompt = ChatPromptTemplate.from_messages([
    ("system", "料理のレシピを考えてください。\n{format_instructions}"),
    ("user", "{ingredient}を使った料理")
])
model = ChatOpenAI(model="gpt-4o", temperature=0.7)
chain = prompt | model | parser

result = chain.invoke({
    "ingredient": "トマト",
    "format_instructions": parser.get_format_instructions()
})
print(result.title)
```

#### 刷新後のコード（Vercel AI SDK TypeScript）
```typescript
import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";

const RecipeSchema = z.object({
  title: z.string().describe("料理名"),
  ingredients: z.array(z.string()).describe("材料リスト"),
  steps: z.array(z.string()).describe("調理手順"),
});

// LCEL やフォーマット指示文は不要。ネイティブの Structured Outputs を活用
const { object: recipe } = await generateObject({
  model: openai("gpt-4o"),
  schema: RecipeSchema,
  system: "あなたはプロのシェフです。最高の家庭料理レシピを考案してください。",
  prompt: "トマトを使った美味しいメイン料理のレシピを考えてください。",
});

console.log(recipe.title); // 型安全（RecipeSchema と完全に一致）
```

---

### 4.2 ツール定義と自律エージェントループ（第9章相当）

#### 過去のコード（LangGraph Python）
```python
from typing import TypedDict, Annotated
from langchain_core.tools import tool
from langgraph.graph import StateGraph, START, END
from langgraph.prebuilt import ToolNode

class AgentState(TypedDict):
    messages: list

@tool
def get_weather(location: str) -> str:
    """指定された地域の天気を取得する"""
    return f"{location}の天気は晴れです。"

# グラフの構築、エッジ、コンパイルが必要...
```

#### 刷新後のコード（Vercel AI SDK TypeScript）
```typescript
import { openai } from "@ai-sdk/openai";
import { streamText, tool } from "ai";
import { z } from "zod";

// Zod で入力バリデーションとスキーマ定義を一度に完結
const weatherTool = tool({
  description: "指定された都市の現在の天気を取得する",
  parameters: z.object({
    location: z.string().describe("都市名（例: 東京都, 大阪市）"),
  }),
  execute: async ({ location }) => {
    // 外部 API 呼び出しなどの実処理
    return { location, temperature: 22, condition: "晴れ" };
  },
});

// maxSteps を指定するだけで、Model -> ToolCall -> ToolResult -> Model の ReAct ループが自律駆動
const result = streamText({
  model: openai("gpt-4o"),
  system: "あなたは親切なアシスタントです。必要に応じてツールを使って最新情報を調べてください。",
  prompt: "東京とサンフランシスコの今の天気を調べて比較して",
  tools: {
    getWeather: weatherTool,
  },
  maxSteps: 5, // 最大 5 回までの自動反復を許可
});

for await (const delta of result.textStream) {
  process.stdout.write(delta);
}
```

---

### 4.3 エージェントデザインパターン：Self-Reflection（第12章相当）

#### LangGraph での構造
`Draft Node` $\rightarrow$ `Critique Node` $\rightarrow$ `Condition(点数 >= 80 ? END : Revise Node)` $\rightarrow$ `Critique Node`... というグラフステートマシン。

#### Vercel AI SDK による実装（明快なループ設計）
```typescript
import { openai } from "@ai-sdk/openai";
import { generateObject, generateText } from "ai";
import { z } from "zod";

interface ReflectionResult {
  finalDraft: string;
  iterations: number;
  critiques: string[];
}

export async function runSelfReflection(topic: string, maxIterations = 3): Promise<ReflectionResult> {
  let draft = "";
  const critiques: string[] = [];

  // 初回ドラフトの生成
  const initial = await generateText({
    model: openai("gpt-4o"),
    prompt: `トピック: 「${topic}」について、技術ブログの導入文（300文字程度）を執筆してください。`,
  });
  draft = initial.text;

  // リフレクション（推敲）ループ
  for (let step = 1; step <= maxIterations; step++) {
    // 評価モジュール（Critic）
    const evaluation = await generateObject({
      model: openai("gpt-4o"),
      schema: z.object({
        score: z.number().min(0).max(100).describe("完成度スコア（85点以上で合格）"),
        critique: z.string().describe("改善点の詳細なフィードバック"),
        isPassing: z.boolean().describe("85点以上ならtrue"),
      }),
      prompt: `以下の文章をレビューし、具体性・説得力・読みやすさの観点から採点してください。\n\n【ドラフト】\n${draft}`,
    });

    critiques.push(`[Round ${step}] Score: ${evaluation.object.score} - ${evaluation.object.critique}`);

    if (evaluation.object.isPassing) {
      return { finalDraft: draft, iterations: step, critiques };
    }

    // 修正モジュール（Revise）
    const revised = await generateText({
      model: openai("gpt-4o"),
      prompt: `以下のドラフトをフィードバックに基づいて全面的に推敲・修正してください。\n\n【元ドラフト】\n${draft}\n\n【フィードバック】\n${evaluation.object.critique}`,
    });
    draft = revised.text;
  }

  return { finalDraft: draft, iterations: maxIterations, critiques };
}
```
*メリット：グラフや特殊な State 宣言を使わずに、TypeScript 標準の `for` ループと構造化オブジェクトだけで可読性高く自己改善エージェントが完成します。*

---

## 5. UI との統合設計（Next.js App Router ＋ React）

元本にない強力なアップデートとして、ブラウザ上でリアルタイムに対話・確認できる Web アプリケーション構成を標準提供します。

```
├── app/
│   ├── api/
│   │   ├── chat/
│   │   │   └── route.ts         # streamText / maxSteps を配備したエンドポイント
│   │   └── agent/
│   │       └── requirements/    # 要件定義エージェントのバックエンド
│   ├── components/
│   │   ├── ChatInterface.tsx    # useChat を用いたリアルタイムストリーミング UI
│   │   ├── ToolExecutionCard.tsx# ツール実行状況のインジケーター
│   │   └── DocumentViewer.tsx   # 生成された要件定義書のリアルタイムプレビュー
│   └── page.tsx
```

### Route Handler 実装（`app/api/chat/route.ts`）
```typescript
import { openai } from "@ai-sdk/openai";
import { streamText } from "ai";

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = streamText({
    model: openai("gpt-4o"),
    messages,
  });

  return result.toDataStreamResponse();
}
```

### クライアント実装（`app/components/ChatInterface.tsx`）
```tsx
"use client";
import { useChat } from "ai/react";

export function ChatInterface() {
  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat();

  return (
    <div className="flex flex-col h-screen max-w-2xl mx-auto p-4">
      <div className="flex-1 overflow-y-auto space-y-4">
        {messages.map((m) => (
          <div key={m.id} className={m.role === "user" ? "text-right" : "text-left"}>
            <div className={`inline-block p-3 rounded-lg ${m.role === "user" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-900"}`}>
              {m.content}
            </div>
          </div>
        ))}
      </div>
      <form onSubmit={handleSubmit} className="mt-4 flex gap-2">
        <input
          value={input}
          onChange={handleInputChange}
          placeholder="質問やタスクを入力..."
          className="flex-1 border p-2 rounded"
          disabled={isLoading}
        />
        <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded">
          送信
        </button>
      </form>
    </div>
  );
}
```

---

## 6. プロジェクト推進・移行ロードマップ

| フェーズ | 期間 | 主要マイルストーン | 成果物 |
| :--- | :--- | :--- | :--- |
| **Phase 1: 基礎移行** | 1〜2ヶ月目 | 第1章〜第4章の執筆・コード刷新<br>OpenAI/Anthropic 呼び出し、Zod 連携、基本 RAG | サンプルリポジトリ（Monorepo/Next.js）、基礎ハンズオン |
| **Phase 2: Advanced RAG と評価** | 3ヶ月目 | 第5章〜第7章の執筆・検証<br>pgvector 実装、Cohere Rerank、Langfuse/OTel 連携 | RAG 評価ベンチマークスクリプト、RRF 実装 |
| **Phase 3: エージェントとパターン** | 4〜5ヶ月目 | 第8章〜第12章の執筆<br>要件定義エージェントの TS 再構築、18 パターンのコード化 | 要件定義書生成 Web アプリ、デザインパターン実装集 |
| **Phase 4: UI・デプロイ・仕上げ** | 6ヶ月目 | 第13章の追加、付録の執筆<br>全コードの E2E テスト、レビューと校正 | 書籍原稿完了、Vercel テンプレート公開 |

---

## 7. まとめと本プランの優位性

1. **極限まで簡潔なコードベース**
   - LCEL や LangGraph 特有のボイラープレートを排除することで、コード行数を元本の約半分に圧縮しつつ、可読性と保守性を飛躍的に高めます。
2. **現代の Web 開発の標準に完全合致**
   - Next.js / TypeScript という世界で最も使われている Web 開発基盤にそのまま組み込めるため、読者が学んだ知識を翌日の業務プロダクトへ直ちに投入できます。
3. **エージェントのブラックボックス化を解除**
   - 「フレームワークが裏で何をやっているかわからない」という LangChain 最大の不満を解消し、モデルの振る舞いと状態遷移を完全に開発者の支配下に置くアーキテクチャを身につけることができます。