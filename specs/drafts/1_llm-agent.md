# Web Book 刷新設計書
## 『つくりながら学ぶ！モダンAIアプリ開発入門 - Next.js & Vercel AI SDK による LLM アプリケーション徹底活用』

---

## 1. 刷新の背景と基本方針

### 1.1 背景と課題認識（2023年版からの変化）
元本（2023年7月公開）は、Python / Streamlit / LangChain という当時の最速プロトタイピング構成を用いて、非エンジニアや機械学習初学者にAIアプリ開発の楽しさを伝えた名著です。しかし、現在の生成AIエコシステムにおいては以下の乖離が生じています。

| 項目 | 2023年（元本）の状況 | 現在（刷新版）の状況 |
| :--- | :--- | :--- |
| **主要フレームワーク** | LangChain（肥大化・破壊的変更が多発） | **Vercel AI SDK**（薄い抽象化・高パフォーマンス・標準準拠） |
| **フロントエンド** | Streamlit（全行再実行モデル、自由度制限） | **Next.js (App Router) + React**（差分レンダリング、本番品質） |
| **モデル環境** | GPT-3.5-turbo（4k/16k、低精度、低速度） | **GPT-4o / Claude 3.5 / Gemini 2.0**（マルチモーダル、超長文、安価） |
| **データ連携** | レガシーな Map-Reduce / RetrievalQA | **Tool Calling（Function Calling）、Structured Outputs (Zod)** |
| **配信・UI** | テキストの一括表示または手動ジェネレータ | **Data Stream Protocol、Server-Sent Events、Generative UI** |

### 1.2 刷新のコアコンセプト
1. **「Python & Streamlit の手軽さ」を「Next.js & Vercel AI SDK の堅牢さ・本番品質」へ昇格**
   - Streamlit から Next.js への移行に伴う学習コストを最小化するため、コンポーネントライブラリ（shadcn/ui）や `useChat` フックを活用し、コード行数を最小限に抑えた直感的な実装を提案します。
2. **過度な抽象化（LangChain Chain地獄）からの脱却**
   - Vercel AI SDK の中核である `streamText`, `generateText`, `generateObject` を採用し、TypeScript の型安全性（Type-Safety）と Zod スキーマ駆動のモダンな設計を叩き込みます。
3. **長文コンテキストとマルチモーダルへの適応**
   - 元本執筆当時には制約の多かった「画像認識」「長時間動画処理」「PDF解析」を、現行LLMのコンテキスト長拡大とTool Calling機能に合わせて再定義します。

---

## 2. 技術スタック移行マッピング

| 領域 | 旧スタック（元本） | 新スタック（刷新版） | 移行理由・メリット |
| :--- | :--- | :--- | :--- |
| **言語** | Python 3.10+ | **TypeScript 5.x** | クライアントからサーバーまで一気通貫の型安全性。 |
| **Webフレームワーク** | Streamlit | **Next.js (App Router)** | 再実行オーバーヘッドの解消、最適化されたストリーミングレンダリング。 |
| **UIライブラリ** | Streamlit標準ウィジェット | **Tailwind CSS + shadcn/ui** | 美しくカスタマイズ可能なUIを即座に構築可能。 |
| **LLMライブラリ** | LangChain (`langchain`) | **Vercel AI SDK (`ai`)** | 軽量、プロバイダ非依存（OpenAI/Anthropic/Google）、標準Web Streams対応。 |
| **プロバイダ接続** | `langchain.chat_models.ChatOpenAI` | `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google` | 1行の差し替えでマルチモデル対応が可能。 |
| **構造化出力** | LangChain `PydanticOutputParser` | AI SDK `generateObject` + **Zod** | 堅牢なJSON Mode / Structured Outputsの直接利用。 |
| **メモリ（会話履歴）**| `ConversationBufferMemory` | `useChat` / UIMessage スキーマ | クライアント側での自然な状態保持と永続化の容易さ。 |
| **デプロイ環境** | Streamlit Community Cloud | **Vercel** | Git pushによる即時デプロイ、エッジ関数・サーバーレスの自動最適化。 |
| **ベクトルDB / RAG** | Chroma (ローカル) / FAISS | **Supabase pgvector / Upstash Vector** | サーバーレス環境と親和性の高いモダンなベクトル検索。 |

---

## 3. 新旧チャプター対応表と詳細設計

### 章構成一覧

```text
[新旧対照一覧]
Ch 01: はじめに                      -> Ch 01: はじめに：AI Webアプリの新時代
Ch 02: まずは環境準備をしよう         -> Ch 02: モダン開発環境の構築（Next.js + AI SDK）
Ch 03: 最初のAIチャットアプリを作ろう   -> Ch 03: 最小コードで作るストリーミングチャット
Ch 04: AIチャットアプリを作り込もう     -> Ch 04: チャットUIの洗練とマルチモデル・画像対応
Ch 05: AIチャットアプリをデプロイしよう -> Ch 05: Vercelへのデプロイと運用基礎
Ch 06: はじめてのAIアプリ - WEBサイト要約 -> Ch 06: Web要約と構造化出力（Structured Outputs）
Ch 07: Youtube動画の要約をしよう      -> Ch 07: YouTube動画要約アプリ（字幕取得とリアルタイム要約）
Ch 08: 長時間Youtube動画を要約しよう  -> Ch 08: 超長文処理のモダンアプローチ（Map-Reduceからの脱却）
Ch 09: PDFに質問しよう (前編: 埋め込み) -> Ch 09: PDFナレッジの解析とEmbeddingパイプライン
Ch 10: PDFに質問しよう (後編: RAG)    -> Ch 10: Agentic RAG（Tool Callingによるスマート検索）
Ch 11: [新規追加章]                  -> Ch 11: 外部ツール連携とAIエージェント構築
Ch 12: あとがき & 今後のステップ       -> Ch 12: 本番運用への道（Langfuse / 評価 / コスト最適化）
```

---

### 各章の詳細設計

#### Chapter 01: はじめに：AI Webアプリの新時代
- **旧内容**: LLMアプリ開発の動向、Python/Streamlitの選定理由。
- **刷新内容**:
  - なぜ今「Next.js + Vercel AI SDK」なのか？
  - プロトタイピングと本番開発の境界線が消えた理由（手軽さと拡張性の両立）。
  - LangChainの課題（ブラックボックス化、デバッグの難しさ）と、AI SDKの設計思想（薄いラッパー、Web標準ストリームAPI準拠）。
  - 本書で作成する成果物の全体像（チャット、構造化要約ツール、動画要約、Agentic RAG）。

#### Chapter 02: モダン開発環境の構築（Next.js + AI SDK）
- **旧内容**: Python環境（pyenv/venv）、`pip install streamlit langchain`、OpenAI APIキー取得。
- **刷新内容**:
  - Node.js (v20+)、pnpm / npm のセットアップ。
  - `create-next-app` による TypeScript / Tailwind CSS 環境構築。
  - `ai`, `@ai-sdk/openai`, `zod` のインストール。
  - shadcn/ui の導入（ボタンや入力欄などのUIコンポーネントを数秒でセットアップ）。
  - 環境変数管理（`.env.local`）と安全なAPIキーの扱い方。
  - **Pythonエンジニア向けミニコラム**: Next.js App Router（Server Component と Client Component）の勘所。

#### Chapter 03: 最初のAIチャットアプリを作ろう
- **旧内容**: Streamlitのシンプルな入力フォーム、LangChainの `LLMChain` / `ConversationChain`。
- **刷新内容**:
  - **API Route**: `app/api/chat/route.ts` で `streamText` を呼び出し、SSE形式でレスポンスを返す。
  - **Client Component**: `app/page.tsx` で `useChat()` フックを使い、数行でストリーミング表示、ローディング制御、ユーザー入力処理を実装。
  - Streamlitの「画面全体リロード」とReactの「差分レンダリング」の挙動差を体感する。

#### Chapter 04: チャットUIの洗練とマルチモデル・画像対応
- **旧内容**: LangChain Memoryの追加、CSSカスタム、Streamlitチャットメッセージのスタイリング。
- **刷新内容**:
  - `useChat` の標準機能であるメッセージ履歴管理と自動スクロール。
  - システムプロンプト（ペルソナ設定）の動的切り替え。
  - **マルチモーダル入力**: `useChat` の添付ファイル機能（`attachments`）を使った画像アップロードと画像認識（GPT-4o / Claude 3.5 Sonnet）。
  - **プロバイダの即時切り替え**: `@ai-sdk/anthropic` や `@ai-sdk/google` を追加し、同一UI上でモデルをドロップダウンで変更できるようにする。

#### Chapter 05: Vercelへのデプロイと運用基礎
- **旧内容**: Streamlit Community CloudへのGitHub連携デプロイ。
- **刷新内容**:
  - GitHubリポジトリ作成から Vercel へのワンクリックデプロイ。
  - Vercelダッシュボードでの環境変数（`OPENAI_API_KEY`）の設定。
  - サーバーレスタイムアウト制限（Hobbyプランの10秒〜60秒）の知識と、AI SDKのストリーミングによるタイムアウト回避の仕組み。

#### Chapter 06: Web要約と構造化出力（Structured Outputs）
- **旧内容**: `WebBaseLoader` でURLからスクレイピングし、`load_summarize_chain` で要約。
- **刷新内容**:
  - Webページのクローリング（Cheerio または Jina Reader API `https://r.jina.ai/{url}` によるMarkdown化）。
  - **AI SDKのキラー機能 `generateObject`**:
    - LangChainの文字列パースではなく、Zodスキーマを渡すことで、型安全なJSONを100%保証して取得。
    - 出力定義例：タイトル、要約文（3点箇条書き）、重要度タグ、アクションプラン。
  - 取得したJSONを shadcn/ui の `Card` / `Badge` でリッチに表示。

#### Chapter 07: YouTube動画要約アプリ
- **旧内容**: `YoutubeLoader` を使った字幕取得とLangChainプロンプトによる要約。
- **刷新内容**:
  - `youtube-transcript` npm パッケージを使用した字幕（Transcript）の取得。
  - `streamText` を使ったリアルタイム要約の生成。
  - タイムスタンプ付きの目次（チャプター）自動生成機能の実装。

#### Chapter 08: 超長文処理のモダンアプローチ（Map-Reduceからの脱却）
- **旧内容**: GPT-3.5のトークン制限（4,096トークン）のため、テキストを分割して各個撃破する `MapReduceDocumentsChain`。
- **刷新内容**:
  - **2023年と現代のパラダイムシフト**:
    - なぜMap-Reduceは時代遅れになったのか？（コンテキスト長の急拡大：128k〜2Mトークン、Map-Reduceによる文脈分断とコスト増の弊害）。
  - 長文モデル（Gemini 2.0 Flash / Pro や Claude 3.5 Sonnet）へのダイレクトインジェクション。
  - コスト削減の切り札：**Prompt Caching（プロンプトキャッシュ）**の仕組みとAI SDKでの活用法。
  - 本当にテキスト分割（Chunking）が必要になる境界線の見極め。

#### Chapter 09: PDFナレッジの解析とEmbeddingパイプライン
- **旧内容**: `PyPDFLoader`、`OpenAIEmbeddings`、Chroma/FAISSのローカル保存。
- **刷新内容**:
  - `unpdf` または `pdf-parse` を用いたサーバーサイドでのPDFテキスト抽出。
  - チャンク分割のベストプラクティス（文字数だけでなくセクション・Markdown意識の分割）。
  - Vercel AI SDK の `embed` / `embedMany` を用いたベクトル化（`text-embedding-3-small`）。
  - ベクトルストアの選定と構築：サーバーレスで無料枠のある **Supabase (pgvector)** または **Upstash Vector** への格納。

#### Chapter 10: Agentic RAG（Tool Callingによるスマート検索）
- **旧内容**: LangChain の `RetrievalQA` チェーンに質問を投げ、回答を得る。
- **刷新内容**:
  - 単純な「検索してプロンプトに埋め込むだけ（ナイーブRAG）」の限界。
  - **Tool Callingを活用したAgentic RAG**:
    - LLMに「知識ベース検索ツール」を持たせ、ユーザーの質問がPDFの内容に関係ある時だけ自律的に検索を実行させる。
  - 引用元のページ番号やチャンクテキストをUI上にカード表示（ソースの透明性確保）。

#### Chapter 11: 【新規】外部ツール連携とAIエージェント構築
- **旧内容**: （元本には未収録、紙書籍版でAgentExecutorを導入）
- **刷新内容**:
  - LangChainのAgentExecutorを使わず、Vercel AI SDK の `tools` と `maxSteps` だけでエージェントを作る。
  - 実装例：
    1. 天気予報・最新Web検索ツール（Tavily / DuckDuckGo / Exa）
    2. 計算・為替レート変換ツール
  - LLMが「思考 -> ツール実行 -> 結果確認 -> 回答」を自動でループするストリーミングエージェントの完成。

#### Chapter 12: 本番運用への道（オブザーバビリティ・評価・次のステップ）
- **旧内容**: あとがき、LangSmith紹介、おまけ。
- **刷新内容**:
  - **オブザーバビリティ**: Langfuse や Helicone と Vercel AI SDK の統合（トークン数、レイテンシ、コストの可視化）。
  - **認証とレート制限**: Clerkによるユーザー認証と Upstash Redis によるAPI呼び出し制限。
  - 今後学ぶべき発展技術（ワークフロー管理、自律型マルチエージェント）。

---

## 4. コード比較による刷新インパクト

### 4.1 基本チャットAPIの比較

#### 【旧】LangChain + Streamlit (Python)
```python
# app.py (旧来型)
import streamlit as st
from langchain.chat_models import ChatOpenAI
from langchain.schema import HumanMessage, AIMessage

st.title("AI Chat")
if "messages" not in st.session_state:
    st.session_state.messages = []

for msg in st.session_state.messages:
    st.chat_message(msg["role"]).write(msg["content"])

if prompt := st.chat_input():
    st.session_state.messages.append({"role": "user", "content": prompt})
    st.chat_message("user").write(prompt)
    
    chat = ChatOpenAI(model_name="gpt-3.5-turbo", streaming=True)
    # 当時はコールバックハンドラや複雑な記述が必要だった
    response = chat([HumanMessage(content=prompt)])
    st.session_state.messages.append({"role": "assistant", "content": response.content})
    st.chat_message("assistant").write(response.content)
```

#### 【新】Next.js + Vercel AI SDK (TypeScript)
```typescript
// app/api/chat/route.ts (バックエンド: わずか15行)
import { openai } from '@ai-sdk/openai';
import { streamText } from 'ai';

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = streamText({
    model: openai('gpt-4o-mini'),
    system: 'あなたは親切なAIアシスタントです。',
    messages,
  });

  return result.toDataStreamResponse();
}
```

```tsx
// app/page.tsx (フロントエンド: 状態管理・ストリーミング・自動更新が完結)
'use client';

import { useChat } from 'ai/react';

export default function ChatPage() {
  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat();

  return (
    <main className="max-w-2xl mx-auto p-4 flex flex-col h-screen">
      <div className="flex-1 overflow-y-auto space-y-4">
        {messages.map(m => (
          <div key={m.id} className={m.role === 'user' ? 'text-right' : 'text-left'}>
            <span className={`inline-block p-3 rounded-lg ${m.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}>
              {m.content}
            </span>
          </div>
        ))}
      </div>
      <form onSubmit={handleSubmit} className="flex gap-2 py-4">
        <input
          value={input}
          onChange={handleInputChange}
          placeholder="メッセージを入力..."
          className="flex-1 border p-2 rounded"
        />
        <button type="submit" disabled={isLoading} className="bg-black text-white px-4 py-2 rounded">
          送信
        </button>
      </form>
    </main>
  );
}
```

---

### 4.2 構造化出力（要約アプリ）の比較

#### 【旧】LangChain PydanticOutputParser
複雑なプロンプト注入と正規表現によるパース失敗時のリトライ処理が必要でした。

#### 【新】Vercel AI SDK `generateObject`
```typescript
// app/api/summarize/route.ts
import { openai } from '@ai-sdk/openai';
import { generateObject } from 'ai';
import { z } from 'zod';

export async function POST(req: Request) {
  const { content } = await req.json();

  const { object } = await generateObject({
    model: openai('gpt-4o-mini'),
    schema: z.object({
      title: z.string().describe('記事の魅力的な要約タイトル'),
      takeaways: z.array(z.string()).describe('主要な学びや要点3つ'),
      sentiment: z.enum(['positive', 'neutral', 'negative']),
      readingTimeMinutes: z.number().describe('推定読了時間'),
    }),
    prompt: `以下のWeb記事を分析して要約してください:\n\n${content}`,
  });

  return Response.json(object);
}
```
フロントエンド側では `object.title`, `object.takeaways` が完全に型推論された状態でUIへ反映できます。

---

## 5. Pythonエンジニアのための「挫折しない」移行サポート設計

読者の多くは元本のターゲット層である「Pythonは書けるがフロントエンド（JS/TS）には不慣れなエンジニアやデータサイエンティスト」です。ここでの脱落を防ぐため、以下の工夫を各章に盛り込みます。

1. **「Streamlitならこう書く」対比コラムの設置**
   - 「Streamlitの `st.session_state` は Reactの `useState` や `useChat` でどう置き換わるのか」
   - 「Streamlitのボタンクリック時再実行と、Next.jsのイベントハンドラ（`onClick`, `onSubmit`）の違い」
2. **UI構築の自動化（コピペで動くコンポーネント集）**
   - CSSを一から書かせず、Tailwind CSS と shadcn/ui のコマンド1発インストールで画面が完成する手順を整備。
3. **完成版リポジトリのブランチ別配布**
   - 各章ごとに `chapter-03`, `chapter-06` などのGitブランチを用意し、途中で躓いても差分比較ですぐ復帰できる導線を用意。

---

## 6. 改訂・公開ロードマップ案

- **フェーズ 1：基礎編の改訂（Ch 01 〜 Ch 05）**
  - Next.js + AI SDK のプロジェクトテンプレート作成
  - チャットアプリ、マルチモーダル、Vercelデプロイまでの執筆と動作検証
- **フェーズ 2：実践アプリ編の改訂（Ch 06 〜 Ch 08）**
  - Zodを用いた構造化出力要約（Web & YouTube）
  - 長文コンテキスト＆プロンプトキャッシュ解説の執筆
- **フェーズ 3：高度な機能編の改訂（Ch 09 〜 Ch 12）**
  - Supabase / Upstash を用いたベクトル検索パイプライン
  - Tool Calling による Agentic RAG 実装
  - 監視・ログ（Langfuse）の導入と全体リファクタリング