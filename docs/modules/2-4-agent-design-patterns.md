# 2-4 エージェントデザインパターン

- **フェーズ**: Phase 2 発展編。IBM 成熟度モデルの Level 2（AI Agents）の入口です。計画・内省・協調といった設計の型を学び、そのうち6つを TypeScript の関数として実装します（[phase-2.md](../phases/phase-2.md)）
- **要件**: [spec 002](../../specs/002-rag-and-workflows/spec.md) の Requirement 4（4.1〜4.8）。解説の必須事項として 001 の Requirement 7.2〜7.6、7.9
- **実装**: `packages/ai-core/src/patterns/`、`apps/web/app/api/workflows/`（`kind: "pattern"`）、`apps/web/components/workflows/`、`apps/web/app/workflows/`

## 学習目標

このモジュールを終えると、次のことができます。

- Liu らのエージェントデザインパターンのカタログ（18 パターン）の体系を説明し、自分の課題にどのパターンが効くかを選べる。
- 6つの主要パターン（Passive Goal Creator、Prompt/Response Optimizer、Single-Path Plan Generator、Multi-Path Plan Generator、Self-Reflection / Cross-Reflection、Role-Based Cooperation）を、グラフ抽象なしで、独立して呼び出せる関数として使える。
- 情報が不足した指示に対して、推測で進まず、不足項目と確認の質問を返す設計にできる。
- Self-Reflection と Cross-Reflection の違い（批評するのが生成と同じモデルか、別のモデルか）を、批評と修正の履歴で示せる。
- 複数の役割のエージェントに作業を受け渡すときの、共有予算とコストの考え方を説明できる。

## 主要トピック

扱う概念は次の5つです。

1. 18 パターンの体系
2. 実装する6パターン
3. 18 パターンとリファレンス実装の対応表
4. LangGraph のグラフ定義で書く場合と TypeScript の関数で書く場合の比較
5. Role-Based Cooperation のコストと共有予算

### 18 パターンの体系

元教材（`2_ai-agent` の第 11 章）が採る体系は、Liu らの *Agent Design Pattern Catalogue*（arXiv:2405.10467）の 18 パターンです。基盤モデルを使うエージェントの設計上の判断を、目的別に型としてまとめたものです。

| 目的 | パターン |
|---|---|
| ゴールの作成 | Passive Goal Creator、Proactive Goal Creator |
| プロンプト・応答の最適化 | Prompt/Response Optimizer |
| 知識の取得 | Retrieval Augmented Generation（RAG） |
| 問い合わせの仕方 | One-Shot Model Querying、Incremental Model Querying |
| 計画の生成 | Single-Path Plan Generator、Multi-Path Plan Generator |
| 内省 | Self-Reflection、Cross-Reflection、Human Reflection |
| 協調 | Voting-Based Cooperation、Role-Based Cooperation、Debate-Based Cooperation |
| ツールとエージェントの管理 | Tool/Agent Registry、Agent Adapter |
| 安全 | Multimodal Guardrails |
| 評価 | Agent Evaluator |

パターンは**選択肢のカタログ**であり、全部を使うものではありません。「どの判断をどこに置くか」を共通の名前で話せるようにするのが価値です。たとえば、ゴールが曖昧なら Passive Goal Creator（ユーザーの指示から受け身で目標を作る）か Proactive Goal Creator（文脈から先回りして目標を推測する）かを、利用シーンとアクセシビリティの要件で選びます。

### 実装する6パターン

6つは、いずれも `packages/ai-core/src/patterns/` の独立した関数です。`createPassiveGoal`、`optimizePromptOrResponse`、`planSinglePath`、`planMultiPath`、`reflect`、`cooperateByRole` で、モデルは引数で受け取ります。構造化出力は M2 の共通部品 `generateValidated`（不正な出力を最大2回まで再生成）が担います。

**Passive Goal Creator**（Req 4.2）は、曖昧な指示から、目的・制約・成功基準を持つ目標仕様を構造化出力で返します。**情報が不足している場合は、不足項目と確認用の質問を併せて返します。** 不足があるのに質問が無い、質問があるのに不足が無い、という矛盾した出力は不正な出力として再生成されます。モデルが勝手に空欄を埋めて進むのを、型と検証で防ぎます。

**Prompt/Response Optimizer**（Req 4.3）は、プロンプトまたは回答を改善し、改善前、改善後、改善の理由を返します。「改善前」はモデルが言い直したものではなく、**呼び出し側が渡した原文**を返します。

**Single-Path Plan Generator**（Req 4.4）は、ゴールから順序付きのステップ一覧を生成し、順に実行して、ステップごとの結果を返します。計画の長さには上限があり、超えた計画は再生成されます。実行は直列で、各ステップには、ゴールとそれまでの結果を渡します。ステップが失敗したら、後続を実行せず、失敗したステップを示します。

**Multi-Path Plan Generator**（Req 4.5）は、複数の候補計画（既定 3、上限あり）を**並列に**生成し、評価器が1つを選びます。結果には、選ばれた計画、選択理由、全候補の評価を含めます。評価器の出力が「範囲外の候補を選ぶ」「全候補を1回ずつ評価していない」場合は、再生成されます。

**Self-Reflection / Cross-Reflection**（Req 4.6）は、生成 → 批評 → 修正を最大反復回数（既定 3）まで繰り返し、各反復の批評と修正の履歴を返します。批評者が「修正不要」と言えば、そこで早く終わります。上限はコードが持ち、批評者は早く終わらせることしかできません。2つの違いは批評する側のモデルだけです。

| | Self-Reflection | Cross-Reflection |
|---|---|---|
| 批評するモデル | 生成と同じモデル | 生成と**異なるカタログ ID** のモデル（用途 `judge`） |
| 利点 | 追加の設定が要らない | 同じモデルの癖（自分の誤りに気づきにくい）を避けやすい |
| 注意 | 自己評価は甘くなりうる | `AI_MODEL_JUDGE` の設定が必須 |

Cross-Reflection で生成側と批評側が**同じカタログ ID** になる構成は、呼び出す前に `invalid-request` で拒否し、`AI_MODEL_JUDGE` の設定方法を案内します（CL-5）。`live` の Anthropic の既定は、用途ごとの既定がすべて同じモデルなので、`AI_MODEL_JUDGE` を設定しないと Cross-Reflection は動きません。

**Role-Based Cooperation**（Req 4.7）は、役割（例: リサーチャー、コーダー、レビュアー）ごとの `ToolLoopAgent` に作業を順に受け渡します。前の役割の出力が次の役割の入力になり、結果には役割ごとの出力と最終成果物を含めます。本リポジトリで `workflows/` と `patterns/` のうち**唯一エージェントのループを作るパターン**で、`createGuardedAgent` を使うので、各役割に3種の停止条件が付きます。

### 18 パターンとリファレンス実装の対応表

「実装」はリファレンス実装のモジュールと関数、「解説のみ」はこの解説（と、扱う後続モジュール）で説明するだけで、コードを持たないものです（Req 4.8）。

| # | パターン | 扱い | 対応先 |
|---|---|---|---|
| 1 | Passive Goal Creator | 実装 | `patterns/passive-goal-creator.ts` の `createPassiveGoal` |
| 2 | Proactive Goal Creator | 解説のみ | 文脈から先回りして目標を推測する型。推測が外れる危険と確認の設計を、Passive との比較で説明する |
| 3 | Prompt/Response Optimizer | 実装 | `patterns/prompt-optimizer.ts` の `optimizePromptOrResponse` |
| 4 | Retrieval Augmented Generation | 実装 | `rag/`（M2 の 2-1、2-2）の `streamRagQuery` ほか |
| 5 | One-Shot Model Querying | 実装 | 計画の全体を 1 回の問い合わせで作る。`patterns/single-path-plan.ts` の `planSinglePath`（構造化出力の呼び出しを 1 回）。その下の `structured/generate-validated.ts` の `generateValidated` が、検証付きの再生成を担う |
| 6 | Incremental Model Querying | 実装（2-3 の部品） | 段階的な問い合わせ。`workflows/prompt-chaining.ts` の `runPromptChain` |
| 7 | Single-Path Plan Generator | 実装 | `patterns/single-path-plan.ts` の `planSinglePath` |
| 8 | Multi-Path Plan Generator | 実装 | `patterns/multi-path-plan.ts` の `planMultiPath` |
| 9 | Self-Reflection | 実装 | `patterns/reflection.ts` の `reflect`（`mode: "self"`） |
| 10 | Cross-Reflection | 実装 | `patterns/reflection.ts` の `reflect`（`mode: "cross"`） |
| 11 | Human Reflection | 解説のみ | 人が批評する型。承認ゲートと一緒にモジュール 4-4 で扱う |
| 12 | Voting-Based Cooperation | 実装（2-3 の部品） | `workflows/parallelization.ts` の `parallelVote`（同数は「同数」を返す） |
| 13 | Role-Based Cooperation | 実装 | `patterns/role-based-cooperation.ts` の `cooperateByRole` |
| 14 | Debate-Based Cooperation | 解説のみ | 複数のエージェントが議論して合意する型。トークン使用量が議論の回数で増える点を、Role-Based との比較で説明する |
| 15 | Multimodal Guardrails | 解説のみ | 入出力の安全確認。モジュール 4-4（安全設計）で扱う |
| 16 | Tool/Agent Registry | 実装（M1 の部品） | `aci/` の `defineAciTool` と `buildToolSet`（リスク区分付きのツールの登録と上限）。モジュール 3-1 で拡張 |
| 17 | Agent Adapter | 解説のみ | 外部のエージェントやツールとの接続の変換層。MCP を扱うモジュール 3-1 で説明する |
| 18 | Agent Evaluator | 実装（部品） | `workflows/evaluator-optimizer.ts` の評価器と `rag/eval/judge.ts` の `judgeRagAnswer`。評価基盤は 4-3 |

18 行のうち、2-4 のために新しく書いたのは 1、3、7、8、9、10、13 の6パターン（9 と 10 は1つの関数）です。5、6、12、16、18 は M1・2-3 など既存の部品が型を満たしており、4 は 2-1・2-2 で実装しました。残りの 2、11、14、15、17 は解説のみです。

### LangGraph のグラフ定義で書く場合と TypeScript の関数で書く場合の比較

元教材は、これらのパターンを LangGraph の `StateGraph`（状態、ノード、エッジ、条件付きエッジ）で書きます。たとえば Self-Reflection は「生成ノード → 批評ノード → 条件付きエッジ（修正が要れば生成へ戻る）」のグラフです。

```ts
// packages/ai-core/src/patterns/reflection.ts (idea, abridged)
let output = await generate(task);
for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
	const critique = await critic(task, output); // structured: { critique, needsRevision }
	history.push({ iteration, critique: critique.critique });
	if (!critique.needsRevision) break;
	output = await revise(task, output, critique.critique);
}
```

| 観点 | LangGraph（グラフ定義） | TypeScript の関数 |
|---|---|---|
| 制御フロー | ノードとエッジの宣言。実行順はグラフから読み取る | `for` と `if`。上から読める |
| 状態 | `State` 型と reducer で更新を宣言する | 変数と戻り値。履歴は配列に積む |
| 上限 | 再帰上限などのグラフ側の設定 | 引数の `maxIterations` とコードの上限（`maxIterationsCap`）。超える指定はモデルを呼ぶ前に拒否する |
| テスト | グラフ全体を実行するか、ノード単位で分ける | 関数に `mock` のモデルを渡す。批評者の呼び出し有無を数えられる |
| 失うもの | — | 状態の永続化（checkpointer）、`interrupt` による耐久的な中断と再開、可視化 |

本リポジトリは、学習目標が「制御フローをコードとして読み、組み立てられること」なので、関数で書きます。耐久的な中断と再開が要る本番の設計は、次の「本番ではどう作るか」から先に進みます。

### Role-Based Cooperation のコストと共有予算

役割ごとにエージェントを作ると、各役割がツールの説明とこれまでの出力を毎回読み直します。同じ作業を**単一のエージェント（ツールを全部持つ）**でも解ける場合、役割に分けるほどトークン使用量が増えます。分けて得られるのは、役割ごとの指示の簡潔さ、ツールの絞り込み（役割ごとに必要なツールだけを持つ）、出力の検査の分離です。

**実測の例**（2026-10-13、`local`、`catalog: local.ollama.chat`、同じタスクを 3 回ずつ。[research.md の「M2 実測（W6）」](../../specs/002-rag-and-workflows/research.md)、25.2）。タスクは「今の時刻を確かめ、1 日 8 時間の作業を 12 日続けたときの合計時間を計算して、報告を一文でまとめてください」で、リサーチャーが `currentTime`、コーダーが `calculator`、レビュアーがツールなしです。単一エージェントは、このタスクに要る同じ 2 つのツールだけを持ちます（**実際の `/agent` は 5 つのツールとペルソナを持つので、ここでの単一エージェントの合計は `/agent` より小さく、比は `/agent` との比より大きく出ています**。`/agent` では測っていません）。

| 試行 | Role-Based の合計（入力 + 出力） | 単一エージェントの合計 | 比 |
|---|---|---|---|
| 1 | 2881 | 1927 | 1.50 |
| 2 | 2271 | 1920 | 1.18 |
| 3 | 2148 | 1931 | 1.11 |
| 平均 | 2433 | 1926 | **1.26** |

どちらも 96 時間と正しく答えましたが、**この単純なタスクでは単一エージェントで足りました。** Role-Based は約 1.26 倍のトークンを使いました。また、最後の役割がレビュアーなので、`final`（最後の役割の出力）は成果物ではなく承認のコメントでした。成果物は `outputs` の最後から 2 番目にあります（この扱いは、要件 4.7 に対する未決の隙間として記録しています）。結論は「Role-Based Cooperation の実装は残すが、単純なタスクには単一エージェントを選ぶ」です。3 試行・1 タスク・1 モデルの観察なので、ツールが多く指示の長い大きなタスクで差が逆転するかは測っていません。

**共有予算の考え方**（CL-8）: 全役割で `maxTotalTokens` を1つ共有します。役割 A が使った分だけ、役割 B に渡す残りの予算が減ります。他の上限（ステップ数、実行時間、ツールの時間）は役割ごとに適用します。予算を使い切ったら、次の役割は開始せず、結果の `stopped` に `budget-exhausted` と記録します。最後の役割が残りを使い切った場合は、`budget-exhausted` にはしません。予算は暴走を止める上限であり、どの役割にいくら使うかの配分ではない点に注意してください。

## ハンズオン手順

### 手順 1: パターンを1つずつ実行する

- 実行モード: `mock`（完走する）。実モデルで確かめるときは `local` / `live`
- 外部サービス: `mock` はなし。`local` は Ollama の起動と、`catalog: local.ollama.chat` と `catalog: local.ollama.judge` のモデルの取得。`live` は選んだプロバイダの API キー

```text
mise run dev          # http://localhost:3000/workflows を開き、種別で「エージェントパターン」を選ぶ
```

「曖昧な指示」の例で Passive Goal Creator を実行し、**不足項目と確認の質問が返る**ことを確かめます。続いて「十分な指示」では、不足項目が空になります。Multi-Path Plan Generator では、全候補の評価と選択理由が並びます。

### 手順 2: Cross-Reflection に批評用のモデルを設定する

- 実行モード: `local` または `live`
- 外部サービス: `local` は Ollama。`live` は API キー（生成側と批評側で別のモデルを使うので、2 つのモデルを使えるキー）

Cross-Reflection は、生成側とは**異なるカタログ ID** の批評側が必須です。`local` の既定は用途ごとに別のモデル（`catalog: local.ollama.chat` と `catalog: local.ollama.judge`）なので、そのまま動きます。`live` の Anthropic の既定は用途ごとの既定がすべて同じモデルなので、**未設定のまま実行すると `invalid-request` になります**。環境変数 `AI_MODEL_JUDGE` に、生成とは異なるカタログ ID（`.env.example` を参照）を設定してから実行します。

```text
# .env.local の例（値はカタログの ID に置き換える）
AI_MODEL_JUDGE=<生成側とは異なるカタログの ID>
```

### 手順 3: Role-Based Cooperation を実行し、トークン使用量を比べる

- 実行モード: `local` / `live`（`mock` でも完走するが、使用量は固定値で比較にならない）
- 外部サービス: Ollama または API キー

「利用状況の調査と集計」を実行し、役割ごとのトークン使用量を読みます。同じタスクを `/agent`（M1 の単一エージェント + ツール）にも渡し、合計を比べます。**上の表とは、タスクも単一エージェントの構成（ツールの数、ペルソナ）も違う**ので、数値はそのまま比べられません。自分の比で、役割に分ける費用が見合うかを判断してください。

### 手順 4: 6パターンを関数として呼び出し、テストを書く

- 実行モード: `mock`
- 外部サービス: なし

`packages/ai-core/src/patterns/*.test.ts` を読み、`mock` のモデルで `reflect` の履歴を検査するテストを書きます。`mise run test` で通ることを確かめます。

## 習熟度判定チェックリスト

自動テストで確かめられる項目にはテストへの参照があります。このモジュールの参照は、すべて `mock` で実行される gate のテストです（`local` 専用のテストを参照する項目はありません）。

- [ ] 十分な指示では、目的・制約・成功基準を持つ目標仕様を返す <!-- test: packages/ai-core/src/patterns/passive-goal-creator.test.ts#returns the objective, constraints and success criteria for a sufficient instruction -->
- [ ] 曖昧な指示では、不足項目と確認の質問を併せて返す <!-- test: packages/ai-core/src/patterns/passive-goal-creator.test.ts#returns the missing items together with clarifying questions for an ambiguous instruction -->
- [ ] Prompt/Response Optimizer は、改善前、改善後、改善の理由を返す <!-- test: packages/ai-core/src/patterns/prompt-optimizer.test.ts#returns the original, the improved text and the reasons -->
- [ ] Single-Path Plan Generator は、ステップを直列に実行して各ステップの結果を返す <!-- test: packages/ai-core/src/patterns/single-path-plan.test.ts#plans the steps, runs them and returns each step's result -->
- [ ] Multi-Path Plan Generator は、既定で3候補を作り、選ばれた計画・理由・全評価を返す <!-- test: packages/ai-core/src/patterns/multi-path-plan.test.ts#generates three candidates by default and returns the one the evaluator chose, its reason and every evaluation -->
- [ ] Self-Reflection は、既定の3回まで批評と修正を繰り返し、履歴を返す <!-- test: packages/ai-core/src/patterns/reflection.test.ts#critiques and revises up to the default of 3 iterations and returns the history -->
- [ ] Cross-Reflection は、生成側と異なるカタログ ID のモデルで批評し、両方の ID を記録する <!-- test: packages/ai-core/src/patterns/reflection.test.ts#critiques with a model that has a different catalog ID and records both IDs -->
- [ ] Cross-Reflection は、同じモデルを呼ぶ前に拒否し、`AI_MODEL_JUDGE` の設定方法を案内する <!-- test: packages/ai-core/src/patterns/reflection.test.ts#rejects the same model before calling anything, and says how to configure the judge -->
- [ ] Role-Based Cooperation は、役割ごとのエージェントに作業を順に受け渡し、役割ごとの出力と最終成果物を返す <!-- test: packages/ai-core/src/patterns/role-based-cooperation.test.ts#returns each role's output and run summary and the last role's output as the final result -->
- [ ] 共有予算を使い切ったら、次の役割を開始せず、そのことを結果に記録する <!-- test: packages/ai-core/src/patterns/role-based-cooperation.test.ts#does not run the next role once the shared budget is spent, and says so -->
- [ ] `patterns/` のうち、エージェントのループを許可するのは `role-based-cooperation.ts` だけである <!-- test: scripts/check-repo-rules.test.mjs#allows the agent loop in patterns/role-based-cooperation.ts only -->
- [ ] 18 パターンのそれぞれが、実装か解説のみかを、対応表から答えられる（手で確かめる）
- [ ] Role-Based Cooperation と単一エージェントのトークン使用量を、自分の環境で比べて説明できる（手で確かめる）

## リファレンス実装とテストの所在

| 項目 | パス |
|---|---|
| Passive Goal Creator | `packages/ai-core/src/patterns/passive-goal-creator.ts` |
| Prompt/Response Optimizer | `patterns/prompt-optimizer.ts` |
| Single-Path / Multi-Path Plan Generator | `patterns/single-path-plan.ts`、`patterns/multi-path-plan.ts` |
| Self-Reflection / Cross-Reflection | `patterns/reflection.ts` |
| Role-Based Cooperation | `patterns/role-based-cooperation.ts` |
| HTTP 用の固定の組み立て（7つのデモ） | `patterns/demos.ts` |
| `mock` のシナリオ | `packages/ai-core/fixtures/scenarios/m2-4.ts` |
| 構造化出力の再生成 | `packages/ai-core/src/structured/generate-validated.ts` |
| Route Handler、画面 | `apps/web/app/api/workflows/route.ts`、`apps/web/components/workflows/` |
| テスト | 各ファイルの隣の `.test.ts` |

## 本番ではどう作るか

本リポジトリの実装は学習用で、本番の判断と運用はハブ `vaz-agentic-ai-next` の手法ページにあります（文書の転載はしません。確認日 2026-10-13）。

- AE（エージェンティックエンジニアリング）: [`agentic-engineering.md`](https://github.com/Fukuchan77/vaz-agentic-ai-next/blob/main/docs/guide/agentic-engineering.md)

本リポジトリのパターンは、プロセス内の関数として一度の実行で完結します。状態の永続化、承認待ちの保持、再開は扱いません（[005 Req 1.3](../../specs/005-hub-alignment/spec.md)）。

## 元教材との対照表

| 元教材（Python / LangChain / LangGraph）の対応箇所 | TypeScript / AI SDK 版での置き換え | 移植で諦めたもの |
|---|---|---|
| 第11章 18 のデザインパターンの理論 | 体系を継承し、18 パターンすべてについて実装か解説のみかを対応表で示す | なし |
| 第12章 7つの主要パターンの Python 実装 | 6パターンの TypeScript 実装（Self-Reflection と Cross-Reflection を1つの `reflect` にまとめた） | LangGraph の `StateGraph` による定義、状態の reducer、checkpointer、`interrupt`、LangGraph Studio |
| Passive Goal Creator（Pydantic の出力パーサ） | `createPassiveGoal`（Zod + `generateValidated`、不足と質問の整合を検証） | なし |
| Role-Based Cooperation（複数のエージェントノードのグラフ） | `cooperateByRole`（役割ごとの `createGuardedAgent`、共有トークン予算） | 役割間の並列実行・動的な再割り当て（受け渡しは固定の順） |
| Reflection（条件付きエッジのループ） | `for` ループ。上限はコードが持つ | 反復ごとの状態の永続化 |

## 移植時の変更点

[changes-from-drafts.md](../../specs/curriculum/changes-from-drafts.md) の §9 に記録された変更のうち、このモジュールに関わるものと、実装時に確定したことです（Req 7.4）。採用したモデルはモデル ID ではなくカタログへの参照で示します（生成は用途 `chat`、批評は用途 `judge`。`local` なら `catalog: local.ollama.chat`、`catalog: local.ollama.judge`）。

- **Cross-Reflection の「異なるモデル」は、カタログ ID が異なること**です。批評側は用途 `judge` のモデルで、`mock` には専用のカタログ項目を足しました。`live` の Anthropic の既定のように同じ ID になる構成は拒否し、設定方法を案内します（CL-5）。
- **反復の上限はコードが持ちます。** 批評者が「修正不要」と言って早く終えることはできますが、上限を超えて続けることはできません。
- **共有予算。** Role-Based Cooperation の `maxTotalTokens` は全役割で1つ、他の上限は役割ごとです（CL-8）。
- **単一エージェントで足りることもあります。** 役割に分ける実装は残しますが、分ける理由（ツールの絞り込み、指示の簡潔さ、検査の分離）が無ければ、単一のエージェントを選びます（憲章 原則 1 の「最もシンプルな設計から」）。

## 完成時点のタグ

- **タグ**: `module/2-4`
- **含まれるもの**: `patterns/` の6パターン、`/api/workflows` の `kind: "pattern"` と `/workflows` 画面（パターン7種）、`mock` のシナリオ、18 パターンの対応表、この解説
- **含まれないもの**: 解説のみとした5パターン（Proactive Goal Creator、Human Reflection、Debate-Based Cooperation、Multimodal Guardrails、Agent Adapter）のコード。状態の永続化と再開
