# **次世代AIエージェントシステムの設計と実装：生成AIからAgentic AIへの工学的展開**

## **研修カリキュラムの構成と学習指針**

本ドキュメントは、生成AIのプロンプティングからAgentic AI（自律型AIエージェント）のシステム設計・実装への移行を目的とした体系的な学習リソースである。単なるライブラリの使い方にとどまらず、AnthropicおよびIBMが提唱する「コアな設計思想」「実運用の失敗から得られた工学的原則」「測定可能な評価手法」を網羅する1。

## **モジュール1：AIエージェントの概念体系とパラダイムシフト（生成AI vs Agentic AI）**

### **1\. 学習目標**

* 生成AI（受動型）とAgentic AI（能動型）の構造的差異を理解する。  
* IBMが定義するAgentic AIの7段階ライフサイクルモデルを把握する。  
* なぜ「プロンプトエンジニアリング」から「コンテキスト・アーキテクチャ設計」への転換が必要かを説明できるようになる。

### **2\. コア思想・哲学**

* **「テキストの生成」から「状態の変更（State Mutation）」へ**: 従来の生成AIは、入力プロンプトに対して静的なコンテンツを出力して停止する受動的（Reactive）なシステムである3。一方、Agentic AIは「自律的な主体的行為能力（Agency）」を持ち、最小限の人間の監視下で長期的な目標を達成するため、自ら推論し、外部ツールを実行して環境の状態を能動的（Proactive）に変更し続ける3。  
* **LLMは「知性そのもの」ではなく「認知・計画エンジン」**: Agentic AIにおいて、LLMは全体システムの中核的な意思決定エンジンとして機能し、決定論的なコード（API、データベース、シェル）と組み合わされることで初めて実世界タスクを完遂できる2。

### **3\. 主要引用元・リファレンス**

* **IBM Think**: *What is Agentic AI?*  
  \[cite: 3\]  
* **IBM Think**: *Agentic AI vs. Generative AI: What's the Difference?*  
  \[cite: 4\]  
* **IBM Cloud Docs**: *Deploy Agentic AI Overview*  
  \[cite: 5\]

### **4\. 設計・開発における重要ポイント**

#### **Agentic AIの7段階閉ループサイクル（IBMモデル）**

> 1. **知覚（Perception）**: API、センサー、DB、ユーザーログ等から環境情報を取得3。  
> 2. **推論（Reasoning）**: 取得情報を自然言語処理やパターン認識で解析し、制約を把握3。  
> 3. **目標設定（Goal Setting）**: 高次の目標を達成可能なサブゴール群に分解3。  
> 4. **意思決定（Decision-Making）**: コスト、安全性、確信度を評価し最適な行動経路を選択3。  
> 5. **実行（Execution）**: 外部ツールの関数呼び出し（Tool Calling）やコマンド実行3。  
> 6. **学習・適応（Learning & Adaptation）**: 実行結果やエラーをフィードバックし計画を再修正3。  
> 7. **オーケストレーション（Orchestration）**: 複数エージェントやリソース配分、状態遷移の統括3。

#### **生成AIとAgentic AIのアーキテクチャ比較マトリクス**

| 比較次元 | 生成AI（Generative AI） | Agentic AI |
| :---- | :---- | :---- |
| **主目的** | プロンプトに対するコンテンツ生成・要約・翻訳4 | 定義された長期目標の自律的達成、タスク実行3 |
| **動作形態** | 反応型（Reactive）：1ステップで応答完了4 | 能動型（Proactive）：目標達成までループ実行4 |
| **自律性水準** | 限定的（ステップごとに人間の指示が必要）4 | 高度（多段階の推論・行動決定を自律実行）3 |
| **環境対話** | モデルの内部知識および静的コンテキストに依存3 | API、DB、シェル、ウェブなどを能動的に操作3 |
| **エラー自己回復** | ユーザーの再指示やプロンプト修正に依存4 | 環境からの客観的事実（Ground Truth）で自己修正2 |
| **開発の主眼** | プロンプト設計、RAGパイプライン、出力スキーマ6 | ワークフロー制御、ACI設計、ハーネス、状態管理2 |

## **モジュール2：決定論的ワークフローと5大アーキテクチャパターン**

### **1\. 学習目標**

* 決定論的「ワークフロー（Workflows）」と自律型「エージェント（Agents）」の明確な境界を定義できる。  
* Anthropicが提示する5大ワークフローパターンの構造、利点、トレードオフを理解する。  
* タスクの複雑性と不確実性に応じて最適なパターンを選択できる。

### **2\. コア思想・哲学**

* **「最もシンプルな設計から始める（Start Simple）」**: 多くの開発者が最初から過度に複雑な自律マルチエージェントフレームワークを採用して失敗している2。システムに与える自律性の高さは、不確実性とデバッグ難易度の増大に直結する2。ハードコードされたコードパス（決定論的ワークフロー）で解ける問題に自律エージェントを投入してはならない2。  
* **Augmented LLMがすべての基本**: エージェント的システムの最小単位は、検索（Retrieval）・ツール（Tools）・メモリ（Memory）で補強された単一のLLMである2。

### **3\. 主要引用元・リファレンス**

* **Anthropic Engineering**: *Building effective agents* (Dec 2024\)2

### **4\. 設計・開発における重要ポイント**

#### **ワークフローとエージェントの峻別**

* **ワークフロー（Workflows）**: LLMとツールが事前にハードコードされた決定論的コードパスで連携するシステム。高予測可能性、低レイテンシ、再現性が要求される場合に最適2。  
* **エージェント（Agents）**: LLM自らが実行ステップ数、ツール呼び出し順序を動的に決定し、ループを回すシステム。オープンエンドで事前の分岐予測が不可能な場合に最適2。

#### **5大ワークフローパターンの仕様と適用指針**

| パターン名 | 動作メカニズム | 主なユースケース | トレードオフ・実装の要点 |
| :---- | :---- | :---- | :---- |
| **Prompt Chaining** | タスクを直列ステップに分解し、出力を後続へ渡す。ステップ間にプログラム検証ゲートを配置可能2。 | ・アウトライン作成から本文執筆 ・テキスト生成後の翻訳とフォーマット変換2 | 各ステップの焦点を絞り精度を最大化。直列処理のため累積レイテンシが増大する2。 |
| **Routing** | 入力を分類器が判定し、特化した専門タスクや最適モデルへ分岐させる2。 | ・顧客対応の問い合わせ分類 ・難度に応じたモデル選定（Haiku vs Sonnet）2 | 関心の分離により精度向上。安価な軽量モデルへルーティングすることで大幅にコスト削減2。 |
| **Parallelization** | 複数のLLM呼び出しを並列実行。タスクを分ける「Sectioning」と同一タスクを複数試行する「Voting」がある2。 | ・Sectioning: ガードレール検査と回答の並列実行 ・Voting: コードの脆弱性監査、コンテンツ審査2 | Sectioningは時間短縮。Votingは多数決で確信度向上と誤判定率を制御。並列数に応じてトークン消費増2。 |
| **Orchestrator-Workers** | 中央のオーケストレーターが動的にタスクを分解し、複数ワーカーへ並列委譲、最後に統合する2。 | ・複数ファイルにまたがるコードベース修正 ・多角的な情報収集と総合調査レポート作成2 | サブタスクが入力依存で事前予測不能な場合に威力。親エージェントの委譲指示の具体性が品質を左右2。 |
| **Evaluator-Optimizer** | 生成器LLMの出力に対し、評価器LLMが客観的ルーブリックでフィードバックを与え、ループ改善する2。 | ・専門分野の文芸・学術翻訳推敲 ・情報充足度を判定しながらの反復Web検索2 | 明文化された評価基準がある場合に自己改善が機能。無限ループ防止のための最大反復数設定が必須2。 |

## **モジュール3：自律型エージェントの設計思想とACI（Agent-Computer Interface）工学**

### **1\. 学習目標**

* 自律実行ループにおける「客観的事実（Ground Truth）」の重要性を理解する。  
* 人間向けUIと同様にツール定義（ACI）を設計・最適化する技術を習得する。  
* ポカヨケ（Poka-Yoke）思想に基づくエラー防止インターフェースを実装できる。

### **2\. コア思想・哲学**

* **「エージェントの失敗の多くは、モデルではなくACIの不備である」**: ツール定義や引数の仕様が曖昧であったり、低レベルすぎたりすると、フロンティアモデルであっても迷走する8。  
* **客観的事実（Ground Truth）に基づく進行**: エージェントは自身の思い込みではなく、ツールの戻り値、コンパイル結果、テスト成否などの物理的な事実を取り込んで次の一歩を決定する2。  
* **エージェント設計の3大原則（Anthropic）**:  
  1. *Maintain Simplicity*（シンプルな設計を貫く）2。  
  2. *Prioritize Transparency*（思考ステップと計画の可視化）2。  
  3. *Carefully Craft ACI*（ツール仕様の徹底した磨き込み）2。

### **3\. 主要引用元・リファレンス**

* **Anthropic Engineering**: *Building effective agents*  
  \[cite: 2\]  
* **Anthropic Engineering**: *Writing tools for AI agents* (Sep 2025\)9  
* **Anthropic Engineering**: *How we built our multi-agent research system*  
  \[cite: 8\]

### **4\. 設計・開発における重要ポイント**

#### **ACI設計のベストプラクティスとアンチパターン**

* **思考の余地を与える（Give Room to Think）**: ツール呼び出し直前に、エージェントが計画や仮説を出力できる思考領域（CoTやThinkingブロック）を確保する。推論を行ってからツールを呼ぶことで、誤ったパラメータ入力を大幅に抑止できる2。  
* **低レベルAPIの無批判なラッピングの禁止**: REST APIのCRUDをそのまま1対1でツール化すると、エージェントは数十回のAPI往復を強いられトークンとステップを浪費する9。list\_users, list\_events, create\_event を個別に渡すのではなく、業務ロジックをまとめた高水準ツール schedule\_meeting を提供すべきである9。  
* **ポカヨケ（エラー防止設計）の実装**:  
  * *相対パスの禁止*: ファイル操作ツールでは絶対パスのみを必須パラメータとする（カレントディレクトリの誤認識による迷走を原理的に防ぐ）2。  
  * *セマンティックな識別子*: 機械的なUUIDではなく、プレーンな名称や0から始まるシンプルなインデックスを返すことで、ハルシネーションを防ぐ9。  
  * *詳細度の制御*: response\_format: "concise" | "detailed" 引数を設け、エージェントが必要最小限のトークンのみを取得できるようにする9。  
* **アクション可能なエラーレスポンス**: バリデーション失敗時に生のエラースタックトレースを返してはならない。「どの引数が不正か」「正しい入力フォーマットの具体例」を含むガイド文を返すことで、エージェントは自律的にリカバリできる9。

## **モジュール4：コンテキストエンジニアリングと長時間実行ハーネス**

### **1\. 学習目標**

* コンテキスト劣化（Context Rot）と注意バジェット（Attention Budget）の概念を理解する。  
* コンパクション、構造化ノートテイク、段階的開示によるコンテキスト管理を実装できる。  
* セッションをまたぐ長時間稼働ハーネス（Long-Running Harnesses）のアーキテクチャを理解する。

### **2\. コア思想・哲学**

* **「コンテキストは有限の計算・注意リソースである」**: コンテキストウィンドウが数百万トークンに拡張されても、無駄な情報が蓄積されるとモデルの注意が散漫になり指示追従性が急激に低下する（Context Rot）10。  
* **シフト勤務エンジニアのメタファー**: 長時間に及ぶ複雑タスク（数時間〜数日）を自律実行する場合、「前任者の記憶が完全にリセットされた交代勤務のエンジニア」がスムーズに作業を引き継げるようなファイル構造と状態追跡の仕組みをシステム側で提供しなければならない11。

### **3\. 主要引用元・リファレンス**

* **Anthropic Engineering**: *Effective context engineering for AI agents* (Sep 2025\)10  
* **Anthropic Engineering**: *Effective harnesses for long-running agents* (Nov 2025\)11  
* **Anthropic Engineering**: *Code execution with MCP*  
  \[cite: 12\]

### **4\. 設計・開発における重要ポイント**

#### **システムプロンプトの「適正高度（Goldilocks Zone）」**

* **低すぎる高度（アンチパターン）**: ガチガチの if-else 条件分岐をプロンプト内に網羅する。仕様変更に極めて脆弱になり、予期せぬ例外状況でフリーズする10。  
* **高すぎる高度（アンチパターン）**: 「優秀なリサーチャーとして最善を尽くせ」といった抽象的指示のみ。評価基準や安全境界が伝わらず迷走する10。  
* **適正高度（ベストプラクティス）**: 達成すべきゴール、許容されない行動境界、優先順位のヒューリスティクスを明記し、具現的な手順はモデルの動的推論に委ねる10。

#### **コンテキスト最適化の3大技法**

> 1. **コンパクション（Compaction）**: 上限に近づいた会話履歴から、未解決のバグ・設計決定・重要変数のみを要約抽出して新規コンテキストへ移行し、古いツール呼び出しログを破棄する10。  
> 2. **構造化ノートテイク（Structured Note-Taking）**: コンテキスト外の永続ファイル（NOTES.md や TODO.json）に進捗や発見を書き出させ、必要な時に読み出させる10。  
> 3. **コード実行環境による段階的開示（Progressive Disclosure）**: 数千行のAPI出力やDBダンプを直接LLMに渡さず、サンドボックス内のスクリプトやパイプライン（grep/jq等）で絞り込み、要約された最小限のトークンのみをコンテキストに返す12。

#### **2層エージェントハーネス（Long-Running Harness）**

長時間タスクにおける「コンテキスト枯渇」と「中途半端な状態での早期完了宣言（勝利宣言の誤謬）」を防ぐため、Anthropicが導入したアーキテクチャ11。

| コンポーネント | 役割と責務 | 格納アーティファクト |
| :---- | :---- | :---- |
| **Initializer Agent** （初回セッション） | ・仕様を200項目以上の詳細なE2E要件に分解 ・環境構築スクリプトとGit初期リポジトリを生成11 | ・feature\_list.json（全項目を "passes": false で初期化） ・init.sh（環境起動・健全性確認） ・claude-progress.txt \[cite: 11\] |
| **Coding Agent** （第2セッション以降） | ・単一の未完了機能のみを選択して実装 ・前セッションの破壊がないか init.sh で事前テスト ・実機テスト（Puppeteer等）成功後にのみステータスを更新11 | ・feature\_list.json（テスト合格時に "passes": true へ） ・claude-progress.txt への追記 ・Gitコミットログによる引き継ぎ11 |

## **モジュール5：本番運用の評価（Agent Evals）・信頼性・安全設計**

### **1\. 学習目標**

* 単一プロンプト評価とエージェント評価（Evals）の構造的違いを理解する。  
* 3種類のグレーダー（コード、LLM-as-a-Judge、人間）の適切な使い分けを習得する。  
* 能力評価（Capability）と回帰評価（Regression）を分離した評価運用サイクルを構築できる。  
* サンドボックスとHuman-in-the-loopを用いたブラスト半径（Blast Radius）の制御ができる。

### **2\. コア思想・哲学**

* **「過程（Path）ではなく、環境の最終結果（Outcome）を評価せよ」**: エージェントは非決定論的であるため、開発者の想定とは異なるツール呼び出し順序であっても正しく課題を解決する場合がある。ツールの実行順序を縛るのではなく、最終的なDB状態やファイル生成結果などの客観的アウトカムをグレーディングすべきである1。  
* **「早期にEvalsを作り、実失敗から20〜50問で始める」**: 何百問もの巨大なデータセットが揃うのを待つ必要はない。初期開発では20〜50問のリアルな失敗ケースを集めるだけで、システム改善の効果を明確に測定できる1。

### **3\. 主要引用元・リファレンス**

* **Anthropic Engineering**: *Demystifying evals for AI agents* (Jan 2026\)1  
* **Anthropic Engineering**: *Building effective agents*  
  \[cite: 2\]

### **4\. 設計・開発における重要ポイント**

#### **エージェント評価の4層構造**

* **Task（タスク）**: 明確な入力と成功基準を持つ最小のテストケース1。  
* **Trial（試行）**: モデルの確率的揺らぎを捉えるための同一タスクの複数回実行1。  
* **Transcript（トランスクリプト）**: 推論過程、ツール呼び出し、戻り値の全実行トレース1。  
* **Outcome（アウトカム）**: 試行終了時の外部環境の物理的状態（DB更新、作成ファイル等）1。

#### **グレーダーの分類と選定基準**

| 分類 | 手法例 | メリット | デメリット・注意点 |
| :---- | :---- | :---- | :---- |
| **コードベース（確定的）** | 単体テスト、型チェック、正規表現、DBクエリ整合性1 | 高速、安価、完全な決定性と再現性1 | 柔軟性に欠け、予期せぬ妥当な別解を弾く恐れ1 |
| **モデルベース（LLM-as-a-Judge）** | 明確なルーブリックによる採点、自然言語アサーション1 | 表現の揺らぎや自由記述コードを柔軟に評価可能1 | 確率的変動、ジャッジ自身のハルシネーションリスク1 |
| **人間ベース（SME Review）** | 専門家によるサンプリング監査、A/Bテスト1 | 評価のゴールドスタンダード、実業務感覚の反映1 | 高コスト、低速。常時CI/CDには不適1 |

※LLM-as-a-Judge運用の極意: 1つのプロンプトで複数の評価基準を同時に判定させず、評価軸ごとにプロンプトを分離すること。また、情報不足の際に無理に採点させず「判定不能（Unknown）」を返せる選択肢を設けることでハルシネーションを防ぐ1。

#### **評価スイートの運用ライフサイクル**

> 1. **能力評価（Capability Evals）**: 現在のエージェントが解けない挑戦的なタスク。初期合格率は低く、改善の進捗を測る目標となる1。  
> 2. **回帰評価（Regression Evals）**: 過去に解決済みとなった重要タスク。常時100%近い合格率を維持し、プロンプト変更によるデグレを検知1。  
> 3. **卒業と飽和対策**: 能力評価で安定して解けるようになったタスクは回帰評価スイートへ昇格させ、能力評価にはより高度な課題を常に追加して評価の飽和（Saturation）を防ぐ1。  
> 4. **過剰トリガー（Overtriggering）防止**: ツールを使うべき問題だけでなく、「ツールを使ってはならない問題（内部知識で即答すべき平易な問い合わせ等）」を評価セットに同等に含める1。

#### **ブラスト半径（Blast Radius）の制御と安全性**

* **隔離サンドボックス**: コード実行やファイル変更を伴うエージェントは、本番環境から切り離された使い捨てコンテナ内で動作させる2。  
* **Human-in-the-Loopの権限ゲート**: 情報取得（Read-Only）は完全自律を許可し、外部送信・ファイル削除・DB変更・課金発生などの不可逆操作には人間の承認を必須とする2。  
* **強制停止条件**: 最大ループ回数（Max Turns）、タイムアウト、最大トークン消費量をハードコードし、無限ループによる暴走を物理的に遮断する2。

## **総合演習：アーキテクチャ選定フレームワーク（学習チェックリスト）**

受講者や開発者が新規アプリケーションを設計する際、どのアーキテクチャを採用すべきかを判断するための意思決定フローである2。

> 1. **ステップ1：単一プロンプト＋Augmented LLMで解決可能か？**  
   * 高品質なプロンプト、Few-Shotの具体例、検索拡張（RAG）のみで要件を満たせるか検証する。満たせるなら、これが最も信頼性が高く低コストな解である2。  
> 2. **ステップ2：タスクを固定の決定論的ステップに分解できるか？**  
   * 直列処理なら **Prompt Chaining**2。  
   * 入力の種別や難度で分岐するなら **Routing**2。  
   * 独立タスクの並行処理や安全検査なら **Parallelization**2。  
   * 明確な基準に基づく推敲ループなら **Evaluator-Optimizer**2。  
> 3. **ステップ3：サブタスクの構成が入力依存で動的に変化するか？**  
   * タスクの全容が事前に予測できない場合は、**Orchestrator-Workers** を採用し、委譲指示の境界条件を厳密に定義する2。  
> 4. **ステップ4：反復回数が予測不能で、環境フィードバック（エラーログ・テスト結果）による試行錯誤が必須か？**  
   * 複数ファイルにわたる自律コーディングやオープンエンドな調査タスクにのみ、**自律型エージェント（Agents）** を採用する2。その際はACIのポカヨケ設計、隔離サンドボックス、状態永続化ハーネスを必ず併設する2。

## **結論**

AIエージェントシステムの成功は、複雑なマルチエージェントフレームワークの導入にあるのではなく、「決定論的なソフトウェア工学」と「確率的な言語モデル」の境界をどこに引くかという冷静な設計判断にかかっている2。

* 決定論的なワークフローで解ける領域には予測可能性と低レイテンシを徹底する2。  
* 自律性が必要な探索領域には、洗練されたACI、注意バジェットを考慮したコンテキスト管理、セッション間ハーネス、そしてアウトカムを測定する厳格な評価体系（Evals）を組み込む1。

この両輪を正しく工学的に統合することこそが、本番環境で真に価値を発揮するAgentic AIアプリケーション開発の核心である1。

#### **Works cited**

> 1. Demystifying evals for AI agents \- Anthropic, [https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)  
> 2. Building Effective AI Agents \- Anthropic, [https://www.anthropic.com/engineering/building-effective-agents](https://www.anthropic.com/engineering/building-effective-agents)  
> 3. What is Agentic AI? \- IBM, [https://www.ibm.com/think/topics/agentic-ai](https://www.ibm.com/think/topics/agentic-ai)  
> 4. Agentic AI vs. Generative AI \- IBM, [https://www.ibm.com/think/topics/agentic-ai-vs-generative-ai](https://www.ibm.com/think/topics/agentic-ai-vs-generative-ai)  
> 5. Deploying agentic AI applications \- IBM Cloud Pak for Data, [https://dataplatform.cloud.ibm.com/docs/content/wsj/analyze-data/deploy-agentic-ai-overview.html?context=wx](https://dataplatform.cloud.ibm.com/docs/content/wsj/analyze-data/deploy-agentic-ai-overview.html?context=wx)  
> 6. Agentic AI vs. Generative AI: Core Differences Explained, [https://www.teampop.com/blog/agentic-ai-vs-generative-ai-core-differences-explained](https://www.teampop.com/blog/agentic-ai-vs-generative-ai-core-differences-explained)  
> 7. Agentic AI vs Generative AI: Differences, Features & Use Cases, [https://75way.com/blog/agentic-ai-vs-generative-ai](https://75way.com/blog/agentic-ai-vs-generative-ai)  
> 8. How we built our multi-agent research system \- Anthropic, [https://www.anthropic.com/engineering/multi-agent-research-system](https://www.anthropic.com/engineering/multi-agent-research-system)  
> 9. Writing effective tools for AI agents—using AI agents \- Anthropic, [https://www.anthropic.com/engineering/writing-tools-for-agents](https://www.anthropic.com/engineering/writing-tools-for-agents)  
> 10. Effective context engineering for AI agents \- Anthropic, [https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)  
> 11. Effective harnesses for long-running agents \- Anthropic, [https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)  
> 12. Code execution with MCP: building more efficient AI agents \- Anthropic, [https://www.anthropic.com/engineering/code-execution-with-mcp](https://www.anthropic.com/engineering/code-execution-with-mcp)  
> 13. Engineering \\ Anthropic, [https://www.anthropic.com/engineering](https://www.anthropic.com/engineering)