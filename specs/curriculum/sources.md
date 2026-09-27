# 元教材とモジュールの対応

移植元の3冊の教材と Guide について、章ごとの本カリキュラムでの扱いを示す。各モジュールの解説に載せる元教材との対照表（001 Req 7.3）は、この対応を元に書く。

「扱い」の列の意味は次のとおり。

- **モジュール番号**: そのモジュールで扱う。括弧内は対応する要件。
- **解説**: 主に解説のトピックとして扱う（001 Req 7.9）。
- **除外**: 意図的に扱わない。理由は 001 の [Out of Scope / Future Work](../001-agentic-ai-platform/spec.md#out-of-scope--future-work) にある。

## 1. 教材一覧

| 略称 | 元教材 |
|---|---|
| 1_llm-agent | 教材 A『つくりながら学ぶ！AIアプリ開発入門』（Web Book。Python / Streamlit / LangChain） |
| 2_ai-agent | 教材 B『LangChain と LangGraph による RAG・AI エージェント［実践］入門』（Python / LangChain / LangGraph） |
| 3_genai-agent | 教材 C『現場で活用するためのAIエージェント実践入門』（Python / LangChain / LangGraph） |
| Guide | Anthropic / IBM の知見による概念モジュール（モジュール1〜5、総合演習） |
| マスター | 上の4本を統合した 4 フェーズ・14 モジュールの案 |

略称は、清書前の各移植設計（ドラフト）の名前に由来する。ドラフトはリポジトリから削除したため、章の内容は本書の表を正とする。ドラフトから改めた点は [changes-from-drafts.md](changes-from-drafts.md) にある。

## 2. 教材 A（1_llm-agent）

章番号は移植設計での新しい章立て。

| 章 | 元本の内容 | 本カリキュラムでの内容 | 扱い |
|---|---|---|---|
| 第1章 はじめに | LLM アプリ開発の動向、Python / Streamlit を選んだ理由 | AI SDK の設計思想（薄い抽象、Web 標準のストリーム）、LangChain の課題 | 解説（1-0、1-1） |
| 第2章 開発環境 | pyenv / venv、`pip install`、API キーの取得 | Node.js と pnpm のモノレポ、環境変数の管理、Server / Client Components の勘所 | 1-1（001 Req 1、7.9） |
| 第3章 最初のチャット | Streamlit の入力フォーム、`LLMChain` / `ConversationChain` | Route Handler の `streamText` と `useChat` によるストリーミングチャット。全画面の再実行と差分レンダリングの比較 | 1-2（001 Req 3.1） |
| 第4章 チャットの作り込み | LangChain Memory、CSS、メッセージのスタイル | 履歴の管理、ペルソナの切り替え、画像入力、プロバイダの即時切り替え | 1-2（001 Req 3.2、3.9、3.10） |
| 第5章 デプロイ | Streamlit Community Cloud | Vercel へのデプロイ、サーバーレスのタイムアウト | 除外（デプロイ）。コスト暴走の防止は 1-2 のレート制限（001 Req 3.11） |
| 第6章 Web 要約 | `WebBaseLoader`、`load_summarize_chain` | 本文の取得と、スキーマ駆動の構造化要約をカードで描画 | 1-3（001 Req 4.1〜4.5） |
| 第7章 YouTube 要約 | `YoutubeLoader` による字幕の取得 | タイムスタンプ付きの字幕の取得と、目次（チャプター）の生成 | 1-3（001 Req 4.9〜4.11） |
| 第8章 長時間動画の要約 | `MapReduceDocumentsChain` | Map-Reduce からの脱却: 長文の直接投入、分割が必要になる境界、プロンプトキャッシュ | 1-3（001 Req 4.6、4.8、4.12） |
| 第9章 PDF の埋め込み | `PyPDFLoader`、`OpenAIEmbeddings`、Chroma / FAISS | PDF のテキスト抽出、見出しを意識したチャンク分割、`embed` / `embedMany`、pgvector | 2-1（002 Req 1.1〜1.3）。マネージドなベクトルストアは除外 |
| 第10章 PDF への質問（RAG） | `RetrievalQA` | Agentic RAG（検索をツールにして必要なときだけ呼ぶ）、引用の表示 | 2-1（002 Req 1.5、1.9、1.10） |
| 第11章 外部ツール連携（新規） | 紙書籍版の AgentExecutor | `ToolLoopAgent` による天気・計算・為替・Web 検索のツールエージェント | 1-2（001 Req 5） |
| 第12章 本番運用への道 | LangSmith の紹介 | オブザーバビリティ、評価、コストの可視化 | 4-3、4-4（004 Req 3、5）、001 NFR コスト可視化。認証（Clerk）と分散レート制限（Upstash Redis）は除外 |
| §5 移行サポート | — | Streamlit との対比コラム、章ごとの完成状態への復帰手段 | 001 Req 7.10、7.11（ブランチではなくタグで提供する） |

## 3. 教材 B（2_ai-agent）

章番号は移植設計での新しい章立て（第13章は新設）。

| 章 | 元本の内容 | 本カリキュラムでの内容 | 扱い |
|---|---|---|---|
| 第1章 LLM アプリ開発の現在地 | 生成 AI の現状、Copilot と AI エージェント | 推論モデルの台頭と、計画・思考プロセスの変化 | 解説（1-2） |
| 第2章 LLM 呼び出しの基本 | OpenAI API（Completions、Function Calling、Structured Outputs） | `generateText` / `streamText`、`Output.object`、マルチプロバイダ、ツール呼び出しの流れ | 1-2（001 Req 3、5） |
| 第3章 プロンプト設計 | Zero-shot、Few-shot、CoT | テンプレートによるプロンプト構築、ロール設計、推論トークンの扱い | 1-2（001 Req 3.4、3.10、7.9） |
| 第4章 RAG パイプライン | DocumentLoader、TextSplitter、VectorStore、LCEL の RAG | Node.js のチャンク分割、pgvector の類似度検索、引用付きのストリーミング | 2-1（002 Req 1） |
| 第5章 パイプラインの合成とストリーミング | LCEL（RunnableSequence、RunnableParallel 等） | 非同期関数の合成、`Promise.allSettled`、進行状況と中間結果のカスタムストリーミング | 2-1、2-2（002 Req 2.11） |
| 第6章 Advanced RAG | HyDE、Multi-Query、RAG-Fusion、Cohere Rerank、ハイブリッド検索 | 同じ手法を素の TypeScript と構造化出力で実装し、RRF で統合 | 2-2（002 Req 2.1〜2.8） |
| 第7章 可観測性と RAG 評価 | LangSmith、Ragas | OpenTelemetry と Langfuse、忠実性・回答関連性の評価 | 2-2（002 Req 2.9、2.10）、4-4（004 Req 5）。Braintrust は除外 |
| 第8章 エージェントの進化論 | ReAct、AutoGPT、crewAI、マルチエージェント | ワークフローと自律型エージェントの区別、過度な自律性の失敗 | 解説（2-3、4-5） |
| 第9章 自律エージェントの基礎 | LangGraph（State、Node、Edge、Checkpointer） | 複数ステップのツール呼び出しループ、Human-in-the-Loop | 1-2（001 Req 5）、4-4（004 Req 4）。セッション状態の DB への退避・復元（耐久的な中断・再開）は除外 |
| 第10章 要件定義書生成エージェント | LangGraph によるインタビュー・評価・生成 | 4つの役割（ペルソナ生成、インタビュー、情報の評価、文書生成）の TypeScript 実装 | 3-5（003 Req 5）。PDF 出力は除外（Markdown のみ） |
| 第11章 18 のデザインパターン | 18 パターンの理論 | 体系を継承し、LangGraph と TypeScript の書き方を比較 | 2-4（002 Req 4.8、001 Req 7.9） |
| 第12章 パターンの実装 | 7つの主要パターンの Python 実装 | 6パターンの TypeScript 実装（Self-Reflection と Cross-Reflection を1つにまとめる） | 2-4（002 Req 4.1〜4.7） |
| 第13章 Generative UI とデプロイ（新設） | — | ツールの結果を型付きの UI コンポーネントとして描画する。デプロイ、エッジランタイム、レート制限 | Generative UI は 1-2（001 Req 5.5）、3-3、3-6。レート制限は 001 Req 3.11。デプロイとエッジランタイムは除外 |

## 4. 教材 C（3_genai-agent）

章番号は元書籍の章立て。

| 章 | 元本の内容 | 本カリキュラムでの内容 | 扱い |
|---|---|---|---|
| 第1章 AI エージェントの概要 | エージェントの定義、推論と学習の役割、フレームワークの俯瞰 | 推論モデルがエージェント設計に与えた影響（暗黙の CoT と明示的な計画） | 解説（1-2） |
| 第2章 AI エージェントの構成 | プロファイル、ツール呼び出し、計画、自己修正、メモリ。コラムで MCP | MCP を本編へ昇格、メモリの3分類、ワークフローの分類 | 3-1（003 Req 1）、4-1（004 Req 1.7）、2-3 |
| 第3章 開発準備 | OpenAI API、Function Calling、Embedding、Assistants API、LangGraph の基礎 | AI SDK Core の基礎、Zod によるツール定義、MCP クライアント | 1-2、3-1 |
| 第4章 ヘルプデスク | LangGraph の StateGraph による Plan-and-Execute | Planner（構造化出力）、Executor（ツールを使うエージェント）、Replanner、進捗のダッシュボード | 3-2（003 Req 2）。ベクトル検索は pgvector に統一 |
| 第5章 データ分析 | E2B Python SDK によるコード生成・実行・リフレクション | TypeScript から E2B を操作、エラーからの自己修正、チャートの Generative UI | 3-3（003 Req 3） |
| 第6章 情報収集（arXiv） | LangGraph のマルチエージェント、LangGraph Studio | Agent-as-a-Tool の階層型マルチエージェント、Agent Inspector UI | 3-4（003 Req 4） |
| 第7章 マーケティング | ペルソナ別のディベート・評価・改善、会話型レコメンド | ロールプレイによる合議、利用者プロファイルの逐次抽出とレコメンド | 3-6（003 Req 6） |
| 第8章 評価 | LLM-as-a-Judge、エージェントの能力評価、エラー分析 | Vitest による回帰評価、構造化出力による合成テストデータ | 4-3（004 Req 3、3.15）。Braintrust 連携は除外 |
| 第9章 UX・運用・セキュリティ | UX、プロンプトインジェクション、AgentOps、LangSmith | ストリーミング、中間状態の可視化、キャンセル、承認ダイアログ、OpenTelemetry、出力のサニタイズとインジェクション検知 | 1-2（001 Req 3.5、6.3）、4-4（004 Req 4、5） |
| 第10章 導入事例とアーキテクチャ | 企業の実務知見 | プロンプトキャッシュ、軽量モデルとフロンティアモデルのハイブリッドルーティング | 1-3（001 Req 4.8）、2-3（002 Req 3.12）。導入事例とサーバーレス基盤の選定は除外 |

## 5. Guide（Agentic AI Development Guide）

| モジュール | 内容 | 扱い |
|---|---|---|
| モジュール1 概念体系 | 生成 AI と Agentic AI、IBM の7段階閉ループ、比較マトリクス | 1-0（001 Req 7.8）。[concepts.md §1](concepts.md#1-生成-ai-から-agentic-ai-へ) |
| モジュール2 ワークフローと5大パターン | ワークフローとエージェントの区別、Start Simple、5パターン | 2-3（002 Req 3、001 Req 7.9）。[concepts.md §2](concepts.md#2-ワークフローとエージェント) |
| モジュール3 ACI 工学 | Ground Truth、3原則、思考の余地、低レベル API の包み方、ポカヨケ、行動を促すエラー | 3-1（003 Req 1.11〜1.14）。[concepts.md §3](concepts.md#3-aciagent-computer-interface工学) |
| モジュール4 コンテキストと長時間実行 | Context Rot、Goldilocks Zone、3技法、2層ハーネス | 4-1、4-2（004 Req 1、2）。[concepts.md §4](concepts.md#4-コンテキストエンジニアリング)、[§5](concepts.md#5-長時間実行ハーネス) |
| モジュール5 Evals・信頼性・安全設計 | Outcome の評価、4要素、グレーダー、運用のライフサイクル、ブラスト半径、強制停止条件 | 4-3、4-4（004 Req 3、4、001 Req 6）。[concepts.md §6](concepts.md#6-agent-evals)、[§7](concepts.md#7-安全設計ブラスト半径の制御) |
| 総合演習 | アーキテクチャ選定の判断フロー | 4-5（004 Req 6）。[concepts.md §8](concepts.md#8-アーキテクチャ選定フロー) |

## 6. Python → TypeScript の置き換え対照

3冊の技術スタックの移行を1つにまとめた。「移植で失うもの」の列は、各モジュールの対照表の「移植で諦めたもの」（001 Req 7.3）の元になる。

| 領域 | 元教材 | 本カリキュラム | 移植で失うもの・注記 |
|---|---|---|---|
| 言語・実行環境 | Python、Google Colab、Jupyter | TypeScript（strict）、Node.js、Next.js App Router | ノートブックでの対話的な試行 |
| Web / UI | Streamlit、Gradio、LangServe | Next.js + React、shadcn/ui、`useChat` | 全行再実行モデルの手軽さ（イベントハンドラと状態管理を書く必要がある） |
| LLM ライブラリ | LangChain Core / Community | AI SDK Core（`ai`） | LangChain の統合パッケージ群 |
| プロバイダ接続 | `langchain-openai`、`langchain-anthropic` | `@ai-sdk/*` と Ollama のプロバイダを、モデルカタログとゲートウェイ経由で解決 | — |
| 基本呼び出し | `invoke()`、`stream()` | `generateText`、`streamText` | — |
| 構造化出力 | `PydanticOutputParser`、`with_structured_output` | `output: Output.object({ schema })`（Zod） | — |
| パイプライン | LCEL（`\|`、`RunnableSequence`、`RunnableParallel`） | 非同期関数の合成、`Promise.all` / `Promise.allSettled` | LCEL の宣言的な合成と、自動のバッチ・リトライ |
| ツール定義 | `@tool`、`DynamicStructuredTool`、`BaseTool` | `tool({ description, inputSchema, execute })` をリスク区分付きのラッパで定義 | — |
| エージェントループ | `create_react_agent`、AgentExecutor | `ToolLoopAgent`（3種の停止条件を強制するファクトリ経由） | — |
| ステートマシン | LangGraph（`StateGraph`、条件付きエッジ、reducer、checkpointer、`interrupt`） | 型付きの状態を持つ TypeScript のループと関数 | reducer による状態のマージ、checkpointer と `interrupt` による耐久的な中断・再開 |
| 会話履歴 | `ConversationBufferMemory` | `useChat` の UI メッセージ（永続化しない） | セッションをまたいだ履歴の永続化 |
| ベクトルストア | Chroma、FAISS、`langchain-community` の各ストア | Postgres + pgvector（Drizzle ORM） | マネージドなベクトルストアとの統合 |
| 埋め込み | `OpenAIEmbeddings` | `embed`、`embedMany` | — |
| ツールプロトコル | LangChain Tool | MCP（公式 SDK のサーバー + AI SDK の MCP クライアント） | — |
| コード実行 | E2B Code Interpreter（Python SDK） | E2B（TypeScript SDK）。キーがなければローカルのコンテナ | — |
| 評価 | Ragas、Python の LLM-as-a-Judge | Vitest の評価スイート（Code-based と LLM-as-a-Judge） | Ragas の既製の指標 |
| 可観測性 | LangSmith、LangGraph Studio | OpenTelemetry（OTLP）+ Langfuse、Agent Inspector UI | LangGraph Studio によるグラフの可視化とデバッグ |
| デプロイ | Streamlit Community Cloud | 対象外（ローカルで完結） | — |
