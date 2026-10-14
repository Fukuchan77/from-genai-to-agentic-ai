# 2-3 5大ワークフローパターン

- **フェーズ**: Phase 2 発展編。IBM 成熟度モデルの Level 1（Generative AI）から Level 2（AI Agents）への移行の水準です。ワークフローは「コードが制御フローを決める」ので Level 1 の延長にあり、エージェント（LLM が制御フローを決める）との境界をこのモジュールで確かめます（[phase-2.md](../phases/phase-2.md)）
- **要件**: [spec 002](../../specs/002-rag-and-workflows/spec.md) の Requirement 3（3.1〜3.13）。解説の必須事項として 001 の Requirement 7.2〜7.6、7.9
- **実装**: `packages/ai-core/src/workflows/`、`apps/web/app/api/workflows/`、`apps/web/components/workflows/`、`apps/web/app/workflows/`

## 学習目標

このモジュールを終えると、次のことができます。

- LangGraph などのグラフ抽象を使わず、Anthropic の5大ワークフローパターンを、素の TypeScript と AI SDK の `generateText` で、それぞれ独立して呼び出せる関数として実装できる。
- 要件（予測可能性、レイテンシ、精度、コスト）に応じてパターンを選び、利点とトレードオフを説明できる。
- 「ワークフロー」と「エージェント」を、制御フローを誰が決めるかで区別し、`ToolLoopAgent` を使わない理由を述べられる。
- 検証や合格の判定を LLM の自己申告に任せず、コードが数値や条件で行う設計にできる。
- 並列実行の上限と中断（`AbortSignal`）、一部のワーカーが失敗したときの扱いを設計できる。

## 主要トピック

扱う概念は次の7つです。

1. ワークフローとエージェントの峻別
2. Prompt Chaining: 直列のステップとステップ間のコードの検証
3. Routing: 分類による振り分けとフォールバック、難度による軽量モデルと高性能モデルの使い分け
4. Parallelization: Sectioning と Voting
5. Orchestrator-Workers: 実行時のタスク分解
6. Evaluator-Optimizer: 数値の合格基準による改善ループ
7. 5パターンの利点とトレードオフ、グラフ抽象を使わない理由、耐久実行を扱わないこと

### ワークフローとエージェントの峻別

| | ワークフロー | エージェント |
|---|---|---|
| 制御フローを決めるもの | コード。事前に書いた分岐とループ | LLM。次に何を呼ぶか、いつ止めるかをモデルが動的に決める |
| 向く場面 | 予測可能性、低レイテンシ、再現性が要る場合 | 分岐を事前に予測できないオープンエンドな場合 |
| 本リポジトリでの実装 | `generateText` / `streamText` を TypeScript の関数で合成する。**`ToolLoopAgent` を使わない** | `createGuardedAgent`（M1）が `ToolLoopAgent` を生成する。3種の停止条件が必須 |

ここでの規約は、**ワークフローの制御フローをコードとして読めること**です（Req 3.13）。`if` と `for` と `Promise.all` で書かれた手順は、読めば分岐が分かり、テストで全分岐を通せます。一方、エージェントのループはモデルの出力で分岐が変わるため、決定論的なテストで全体を固定できません。

この境界は、リポジトリ規則 `workflow-no-agent-loop`（`mise run check:repo-rules`）が機械的に守ります。`packages/ai-core/src/workflows/` と `patterns/` の全ファイルが、`../agents`、`@platform/ai-core/agents`、`ToolLoopAgent` を参照すると失敗します。走査したファイルが 0 件でも失敗します。許可は `patterns/role-based-cooperation.ts`（2-4 で扱う、役割ごとにエージェントを作るパターン）の1か所だけです。

Anthropic の指針は「最もシンプルな設計から始める」ことです。決定論的なコードパスで解ける問題に、自律型のエージェントを使いません。エージェントに切り替えるのは、手順を事前に書き下せないと分かってからです。

### Prompt Chaining: 直列のステップとステップ間のコードの検証

タスクを直列のステップに分け、各ステップの出力を次のステップの入力にします（`workflows/prompt-chaining.ts` の `runPromptChain`）。ステップは `{ name, run, validate? }` で、`validate` は問題の一覧を返す純関数です。**検証に失敗したら後続のステップを実行せず**、失敗したステップ名と検証エラーを結果として返します（Req 3.2）。

```ts
// packages/ai-core/src/workflows/prompt-chaining.ts (abridged)
for (const step of params.steps) {
	signal?.throwIfAborted();
	const output = await step.run(current, signal);
	const errors = step.validate?.(output) ?? [];
	records.push({ name: step.name, output, errors });
	if (errors.length > 0) {
		return { status: "failed", failedStep: step.name, errors, steps: records };
	}
	current = output;
}
```

検証失敗は例外ではなく**結果**です。呼び出し側が「どのステップで止まったか」を画面に出せます。ステップが投げた例外（中断を含む）は、そのまま伝わります。アウトラインを作って本文を書く例では、本文がアウトラインの見出しをすべて含むか、という検証をコードで書きます。「モデルに自己チェックさせる」のではなく、数えられる条件はコードで確かめます。

### Routing: 分類による振り分けとフォールバック

入力を事前に定義した分類（`categories`）のいずれか1つに振り分け、その分類の処理だけを実行します（`route`）。結果には分類と選択理由を含めます（Req 3.3）。分類が定義済みのどれにも当たらない場合は、既定のフォールバックを実行し、`matched: false` を返します（Req 3.4）。

分類結果は「モデルの出力」なので、信用せずに照合します。ハンドラは**自分自身のキー**として引くので、モデルが `"constructor"` のような文字列を返しても、継承されたプロパティを呼べません。

Routing の応用が**難度による振り分け**です（`routeByDifficulty`、Req 3.12）。軽量モデルが入力を `easy` / `hard` に分類し、`easy` は軽量モデル、`hard` は高性能モデルで答えます。結果には、振り分け先のモデル名とトークン使用量を含めます。軽量・高性能の2つは**ティア**としてカタログに置いてあり（`MODEL_TIERS`）、`ModelPurpose` は増やしていません。プロバイダが1つしかチャット用のモデルを持たない構成（`live` の Anthropic の既定など）では2つのティアが同じモデルになり、結果の `distinct` が `false` になります。振り分けの効果（コストの削減）は、この構成では得られません。

### Parallelization: Sectioning と Voting

複数の LLM 呼び出しを並列に実行します。2つの型があります。

- **Sectioning**（`parallelSections`、Req 3.5）: タスクを独立した観点に分けて並列に実行し、結果を**観点の順**に並べて統合します。どれかが失敗したら、他の観点を中断し、失敗した観点の名前を返します。観点の数には上限があります（`DEFAULT_WORKFLOW_LIMITS.maxSections`）。
- **Voting**（`parallelVote`、Req 3.6）: 同じタスクを N 回（既定 3、上限 9）並列に実行し、多数決をとります。`normalize` で票の表記ゆれを同じラベルに寄せてから数え、**最多票が同数なら結論を選ばず「同数」を返します**。特定の結論を選ぶ規則（先に出たものを採る、など）を入れると、偏りが気づかれないまま混ざるからです。

並列にした分だけ、トークンは比例して増えます。Voting は確信度を上げる代わりに、N 倍のコストがかかります。

### Orchestrator-Workers: 実行時のタスク分解

オーケストレーターが**実行時に**サブタスクを決め、各サブタスクをワーカーへ並列に委譲し、最後に統合します（`orchestrate`、Req 3.7）。サブタスクの数と内容は入力に依存するため、事前に書き下せません。Prompt Chaining との違いはここにあります。

オーケストレーターは構造化出力で計画を返します。サブタスクの数が上限（`maxSubtasks`）を超える計画は不正な出力として再生成され（`generateValidated`、最大2回）、なお不正なら失敗します。**一部のワーカーが失敗した場合**は、残りの結果から統合し、失敗を記録します。全ワーカーが失敗したときだけ、統合せずに失敗を返します。呼び出し側が「どのサブタスクが失敗したか」を知れる設計です。

### Evaluator-Optimizer: 数値の合格基準による改善ループ

生成器の出力を評価器が 0〜100 点とフィードバックで採点し、**合格基準（既定 85 点）に達するか、最大反復回数（既定 3 回）に達するまで**改善を繰り返します（`evaluateAndOptimize`、Req 3.8）。結果には、最終生成物、反復回数、各反復のスコアとフィードバックの履歴を含めます（Req 3.9）。

設計の要点は次の4つです。

1. **合格の判定はコードが行います。** 評価器は点数を返し、`score >= passScore` の比較はコードです。LLM に「合格ですか」と聞くと、自己申告が甘くなります。
2. **複数の専門評価器**（セキュリティ、パフォーマンスなど）は並列に実行し、**統合スコアは評価器ごとのスコアの最小値**です（Req 3.11）。平均にすると、1つの評価器が不合格でも他が高得点なら合格になります。
3. 最大反復回数に達しても合格しなければ、**最高スコアの生成物**を返し、結果に未合格（`passed: false`）を明示します（Req 3.10）。最高スコアが同点なら、最も早い反復の生成物を返します。
4. 反復回数には上限（`maxIterationsCap`）があります。改善ループには必ず上限を置きます。

### 5パターンの利点とトレードオフ

| パターン | 利点 | トレードオフ | 選ぶ場面 |
|---|---|---|---|
| Prompt Chaining | 各ステップの焦点が絞れて精度が上がる。ステップ間をコードで検証できる | 直列のため、レイテンシがステップ数に比例して積み上がる | 手順が固定で、途中の出力を検証できるとき |
| Routing | 関心の分離で精度が上がる。軽量モデルへの振り分けでコストが下がる | 分類を誤ると誤った処理に送られる。フォールバックの設計が要る | 入力の種類で処理が大きく変わるとき |
| Parallelization | Sectioning は時間を短縮し、Voting は確信度を上げる | 並列数に比例してトークンを消費する。同数の扱いを決める必要がある | 独立した観点があるとき（Sectioning）、1回の判断が不安定なとき（Voting） |
| Orchestrator-Workers | 入力に応じて分解の仕方が変わる場合に効く | オーケストレーターの計画が品質を左右する。呼び出し回数が事前に確定しない（上限で縛る） | サブタスクが入力に依存して予測できないとき |
| Evaluator-Optimizer | 明文化された基準があれば、反復で品質が上がる | 反復の分だけコストと時間が増える。基準が曖昧だと機能しない | 評価基準を数値と文章で書けるとき |

### LangGraph 的なグラフ抽象を使わない理由

元教材の LangGraph は、ノードとエッジで状態遷移を宣言します。本リポジトリは次の理由で、この抽象を使いません。

- **制御フローが TypeScript の構文で読めます。** 分岐は `if`、繰り返しは `for`、並列は `Promise.all` です。グラフ定義を読み替える層がなく、デバッガーとスタックトレースがそのまま使えます。
- **テストが関数の単体テストで済みます。** 5つのパターンは、それぞれ独立した関数で、モデルは引数で受け取ります。`mock` のモデルを渡せば、決定論的に全分岐を通せます。
- **失うものもあります。** 状態の永続化（checkpointer）、プロセスをまたぐ中断と再開（`interrupt`）、可視化は、グラフ抽象のほうが優れています。これらを使う場合の考え方は、次の「耐久実行を扱わないこと」と、2-4 の比較で説明します。

### 耐久実行を扱わないこと（本番との境界）

このモジュールのワークフローは**プロセス内の関数**です。ステップの結果を永続化せず、プロセスが再起動すると途中までの実行は失われ、失敗したステップを後でスケジュールして再試行することもしません。制御フローをコードとして読み、組み立てられることが学習目標であり、ジョブの耐久実行は本リポジトリの対象外です（[005 Req 1.3](../../specs/005-hub-alignment/spec.md)）。本番で必要になったときの判断は、次の節のリンク先にあります。

## ハンズオン手順

### 手順 1: `/workflows` 画面で5パターンを実行する

- 実行モード: `mock`（キー・Docker・Ollama なしで完走する）。実モデルで確かめるときは `local`（`mise run dev` と `AI_RUN_MODE=local`）または `live`
- 外部サービス: `mock` はなし。`local` は Ollama の起動と、`catalog: local.ollama.chat` のモデルの取得。`live` は選んだプロバイダの API キー

```text
mise run dev          # http://localhost:3000/workflows を開く
```

パターンの種別で「ワークフロー」を選び、一覧から Prompt Chaining、Routing、モデル振り分け、Sectioning、Voting、Orchestrator-Workers、Evaluator-Optimizer を順に実行します。各結果が、パターンごとの形（ステップ、分類と理由、投票の内訳、サブタスク一覧、反復の履歴）で表示されます。Prompt Chaining では「本文の検証に失敗する例」を選び、**後続のステップが実行されずに失敗したステップ名が出る**ことを確かめます。

### 手順 2: Evaluator-Optimizer で合格基準と反復を観察する

- 実行モード: `mock`、続いて `local` / `live`
- 外部サービス: `mock` はなし。`local` / `live` は手順 1 と同じ

入力の例から「改善して合格する例」を選んで実行します。初稿が基準に届かず、反復を重ねて合格します。次に「改善が進まず未合格になる例」を選びます。最大反復回数に達しても基準（既定 85 点）に届かず、**最高スコアの生成物が未合格として返ります**。どちらも、反復の履歴（スコアとフィードバック）が画面に並ぶことを確かめます。合格基準と最大反復回数のフィールドを変えて、結果の変わり方も確かめます。

### 手順 3: 関数として呼び出し、テストを書く

- 実行モード: `mock`
- 外部サービス: なし

`packages/ai-core/src/workflows/*.test.ts` を読み、`mock` のモデルまたは固定の関数を渡して、自分の `ChainStep` を `runPromptChain` に渡すテストを書きます。`mise run test` で通ることを確かめます。

```text
mise run test
```

### 手順 4: 境界の規則を壊して確かめる

- 実行モード: `mock`
- 外部サービス: なし

`workflows/` のファイルに `import { createGuardedAgent } from "../agents";` を一時的に書き、`mise run check:repo-rules` が `workflow-no-agent-loop` で失敗してファイルと行を示すことを確かめてから、元に戻します。

## 習熟度判定チェックリスト

自動テストで確かめられる項目にはテストへの参照があります。`local` 専用のテストを参照する項目は、Ollama がない環境ではスキップされます（このモジュールの参照は、すべて `mock` で実行される gate のテストです）。

- [ ] Prompt Chaining は、検証に失敗したら後続のステップを実行せず、失敗したステップ名とエラーを返す <!-- test: packages/ai-core/src/workflows/prompt-chaining.test.ts#does not run later steps when a validation fails, and reports the failed step and errors -->
- [ ] Routing は、分類の処理だけを実行し、分類と理由を返す <!-- test: packages/ai-core/src/workflows/routing.test.ts#runs only the handler of the classified category and returns the category and reason -->
- [ ] Routing は、分類が定義済みのどれにも当たらなければフォールバックを実行し、`matched=false` を返す <!-- test: packages/ai-core/src/workflows/routing.test.ts#runs the fallback with matched=false when the category is not predefined, and no handler -->
- [ ] 難度による振り分けは、振り分け先のモデル名とトークン使用量を結果に含める <!-- test: packages/ai-core/src/workflows/model-tier.test.ts#runs an easy input on the light model and reports the model name and token usage -->
- [ ] Sectioning は、すべての観点を完了を待たずに開始する <!-- test: packages/ai-core/src/workflows/parallelization.test.ts#starts every section before any of them finishes -->
- [ ] Voting は、最多票が同数なら結論を選ばず「同数」を返す <!-- test: packages/ai-core/src/workflows/parallelization.test.ts#returns a tie without choosing a conclusion when the top counts are equal -->
- [ ] Orchestrator-Workers は、サブタスクを実行時にタスクから決める <!-- test: packages/ai-core/src/workflows/orchestrator-workers.test.ts#decides the subtasks at run time from the task -->
- [ ] Evaluator-Optimizer は、統合スコアが合格基準（既定 85）に達した時点で止まる <!-- test: packages/ai-core/src/workflows/evaluator-optimizer.test.ts#stops as soon as the combined score reaches the default pass score of 85 -->
- [ ] Evaluator-Optimizer は、既定の 3 回で止まり、最高スコアの生成物を未合格として返す <!-- test: packages/ai-core/src/workflows/evaluator-optimizer.test.ts#stops at the default of 3 iterations and returns the best output with passed=false -->
- [ ] 複数の評価器の統合スコアは、平均ではなく最小値である <!-- test: packages/ai-core/src/workflows/evaluator-optimizer.test.ts#uses the lowest evaluator score as the combined score, not the average -->
- [ ] `workflows/` と `patterns/` のエージェントループの参照を、リポジトリ規則が検出する <!-- test: scripts/check-repo-rules.test.mjs#also scans patterns/ and reports the file and line -->
- [ ] 許可されたエージェントループは `patterns/role-based-cooperation.ts` だけである <!-- test: scripts/check-repo-rules.test.mjs#allows the agent loop in patterns/role-based-cooperation.ts only -->
- [ ] `/workflows` 画面が、Evaluator-Optimizer の各反復と未合格を表示する <!-- test: apps/web/e2e/workflows.spec.ts#workflows: the Evaluator-Optimizer shows each iteration and says the pass score was missed -->
- [ ] 5パターンのうち、自分の課題にどれを選ぶか、利点とトレードオフを根拠に説明できる（手で確かめる）
- [ ] ワークフローとエージェントの違いを、制御フローを決めるものの違いで説明できる（手で確かめる）

## リファレンス実装とテストの所在

| 項目 | パス |
|---|---|
| Prompt Chaining | `packages/ai-core/src/workflows/prompt-chaining.ts`（テスト: 隣の `.test.ts`） |
| Routing、難度による振り分け | `workflows/routing.ts`、`workflows/model-tier.ts` |
| Parallelization（Sectioning / Voting） | `workflows/parallelization.ts` |
| Orchestrator-Workers | `workflows/orchestrator-workers.ts` |
| Evaluator-Optimizer | `workflows/evaluator-optimizer.ts` |
| 上限と WorkflowStepError | `workflows/limits.ts`、`workflows/errors.ts` |
| HTTP 用の固定の組み立て（7つのデモ） | `workflows/demos.ts` |
| `mock` のシナリオ | `packages/ai-core/fixtures/scenarios/m2-3.ts` |
| Route Handler | `apps/web/app/api/workflows/route.ts` |
| 画面 | `apps/web/app/workflows/page.tsx`、`apps/web/components/workflows/` |
| 境界の規則 | `scripts/check-repo-rules.mjs`（`workflow-no-agent-loop`） |
| E2E | `apps/web/e2e/workflows.spec.ts` |

## 本番ではどう作るか

本リポジトリの実装は学習用で、本番の判断と運用はハブ `vaz-agentic-ai-next` の手法ページにあります（文書の転載はしません。確認日 2026-10-13）。

- LE（ループとワークフローの設計）: [`loop-engineering.md`](https://github.com/Fukuchan77/vaz-agentic-ai-next/blob/main/docs/guide/loop-engineering.md)
- AE（エージェンティックエンジニアリング）: [`agentic-engineering.md`](https://github.com/Fukuchan77/vaz-agentic-ai-next/blob/main/docs/guide/agentic-engineering.md)

本リポジトリが簡略化している点は、**耐久実行**（ステップの永続化、プロセス再起動後の再開、失敗したステップの再試行のスケジューリング）です。本番の対応先は、ハブの `docs/adr/0005-durable-workflow-engine.md` と `packages/agents/src/supervisor.ts` です。

## 元教材との対照表

| 元教材（Python / LangChain / LangGraph）の対応箇所 | TypeScript / AI SDK 版での置き換え | 移植で諦めたもの |
|---|---|---|
| LangGraph の `StateGraph` によるワークフロー（ノード、エッジ、条件付きエッジ） | `generateText` / `streamText` を合成する関数。分岐は `if`、並列は `Promise.all` | グラフの宣言的な可視化、LangGraph Studio、状態の reducer、checkpointer による永続化、`interrupt` による耐久的な中断と再開 |
| Prompt Chaining（LCEL のパイプ演算子） | `runPromptChain`。ステップ間の検証をコードで書き、失敗したステップ名を結果で返す | LCEL の組み込みのバッチ・ストリーミング・リトライ |
| Routing（条件付きエッジ、`RunnableBranch`） | `route`（分類 → 自分自身のキーで引くハンドラ → フォールバック）と、難度による振り分け `routeByDifficulty` | なし |
| Parallelization（`RunnableParallel`） | `parallelSections` / `parallelVote`（上限、中断、同数の扱い付き） | なし |
| Orchestrator-Workers（`Send` API による動的な分岐） | `orchestrate`（構造化出力の計画、並列のワーカー、部分失敗の記録、統合） | `Send` による実行時のグラフ分岐の宣言 |
| Evaluator-Optimizer（ループするグラフ） | `evaluateAndOptimize`（コードによる合格判定、評価器の最小値、最高スコアの返却） | ループの各状態の永続化と巻き戻し |

## 移植時の変更点

[changes-from-drafts.md](../../specs/curriculum/changes-from-drafts.md) の §9 に記録された変更のうち、このモジュールに関わるものと、実装時に確定したことです（Req 7.4）。採用したモデルはモデル ID ではなくカタログへの参照で示します（ワークフローの生成は用途 `chat`、計画や分類などの構造化出力は用途 `structured`、`local` なら `catalog: local.ollama.chat`）。

- **LangGraph を使わず、関数の合成で書きます。** 制御フローがコードとして読め、`ToolLoopAgent` を使わない境界を `workflow-no-agent-loop` が守ります（Req 3.13）。
- **合格の判定はコードです。** Evaluator-Optimizer の `passed` は、スコアと合格基準を比べた結果です。モデルが「合格」と書いても、それは判定になりません。
- **上限を必ず置きます。** 観点・投票・サブタスク・候補・反復の各数には `DEFAULT_WORKFLOW_LIMITS` の上限があり、呼び出し側の指定が上限を超えると、モデルを呼ぶ前に `invalid-request` で拒否します。モデルの出力が上限を超える場合は、スキーマで不正な出力として再生成します。
- **振り分けにはティアを使います。** 軽量・高性能のモデルは `MODEL_TIERS` に置き、`live` の Anthropic の既定では2つが同じモデルになります（結果の `distinct: false`）。
- **同点の扱い。** Evaluator-Optimizer が同じ最高スコアを複数の反復で出したときは、最も早い反復の生成物を返します（plan の決定 CL-4）。
- **構造化出力の再生成は `generateValidated` が担います。** M1 の要約の再生成（`summarize/retry.ts`、ストリーム用）とは統合せず、重複を許容しました（[research ADR-8](../../specs/002-rag-and-workflows/research.md)）。

## 完成時点のタグ

- **タグ**: `module/2-3`
- **含まれるもの**: `workflows/` の5パターンと難度による振り分け、`/api/workflows` と `/workflows` 画面（ワークフロー7種）、`mock` のシナリオ、リポジトリ規則 `workflow-no-agent-loop`、この解説
- **含まれないもの**: 耐久実行（ステップの永続化と再開）。2-4 の6パターン（同じ画面の「エージェントパターン」で動くが、解説は 2-4）。`local` / `live` での実測の評価（4-3 の評価基盤）
