# 1-2 AI SDK v7 Core とツール呼び出し

- **フェーズ**: Phase 1 基礎編。主に IBM 成熟度モデルの Level 1（Generative AI）を扱い、ツール呼び出しで Level 2（AI Agents）の入口に立つ（[phase-1.md](../phases/phase-1.md)）
- **要件**: [spec 001](../../specs/001-agentic-ai-platform/spec.md) Requirement 3、5、6（および 7.2〜7.6、7.9、7.10）
- **実装**: `packages/ai-core/src/{chat,agents,aci}/`、`apps/web/app/api/{chat,agent/tools}/`、`apps/web/components/{chat,agent}/`

## 学習目標

このモジュールを終えると、次のことができます。

- `streamText` によるストリーミングチャットと、`ToolLoopAgent` によるツール呼び出しループを、「コードが制御フローを決める処理」と「LLM が決める処理」として使い分けられる。
- system / user / assistant / tool の4ロールが AI SDK のメッセージ型でどう表れるかを説明し、システムプロンプトをサーバー側のテンプレートとして組み立てられる。
- 会話の途中でモデルを切り替えても履歴を保てる理由と、そのとき推論パートを送らない理由を説明できる。
- ツールの実行状況と結果を、型付きのカード（Generative UI）として描画し、未登録のツールは JSON にフォールバックさせられる。
- 3種の停止条件と6種の停止理由を説明し、トークン上限と時間上限が「ステップ完了時の近似」であることを、テストの数字で示せる。
- LangChain の `AgentExecutor` を、`ToolLoopAgent` のどの機能に置き換えるかを表で対応づけられる。

## 主要トピック

扱う概念は次のとおりです。このうち、見出しになっているものは spec 001 Requirement 7.9 の必須トピックです。

| 話題 | 実装の入口 | 要件 |
|---|---|---|
| ロール設計、テンプレート、Few-shot / CoT、推論モデル | `chat/personas/`、`chat/adapt-history.ts` | 3.3、3.4、3.10、7.9 |
| UI メッセージストリームと停止操作の伝播 | `app/api/chat/route.ts` | 3.1、3.5、3.6 |
| ツール定義（ACI）、Clock の注入、ツールのエラーはツール結果 | `aci/define-tool.ts`、`aci/tool-set.ts` | 5.2、5.7、5.8、6.4 |
| `ToolLoopAgent`、3種の停止条件、停止理由 | `agents/guarded-agent.ts` | 5.1、6.1〜6.3 |
| Generative UI（ツール結果のカード描画） | `components/agent/` | 5.5 |

### ロール設計（system / user / assistant / tool）

LLM への入力は「ロール付きのメッセージ列」です。ロールは単なるラベルではなく、**誰がその内容を書いたか＝どこまで信頼できるか**を表します。AI SDK には、メッセージの型が2系統あります。

| 系統 | 使う場所 | ロール | 特徴 |
|---|---|---|---|
| `UIMessage` | ブラウザ（`useChat`）とサーバー間 | `system` / `user` / `assistant` | `parts` の配列（`text`、`reasoning`、`file`、`tool-<name>` など）。表示用の `metadata` を持てる |
| `ModelMessage` | サーバーからモデルへ | `system` / `user` / `assistant` / `tool` | プロバイダに送る形。ツール結果は `tool` ロールで独立する |

`tool` ロールは `UIMessage` には現れません。UI 側ではツールの呼び出しと結果が、assistant メッセージの中の1つの `tool-<name>` パート（`state` が `input-available` → `output-available` と変わる）にまとまっています。`convertToModelMessages` がこれを展開します。実測では、次のようになります。

```text
UIMessage  : user[text] / assistant[step-start, tool-weather(output-available), step-start, text]
ModelMessage: user / assistant[tool-call] / tool[tool-result] / assistant[text]
```

このリポジトリのロールの使い方には、3つの決まりがあります。

1. **system はサーバーだけが書く。** `chatRequestSchema` のメッセージの `role` は `user` と `assistant` だけで、クライアントが送った `system` メッセージは拒否されます（Req 3.10）。システムプロンプトは、ペルソナ ID からサーバーが `persona.render(...)` で作ります。AI SDK v7 も、`messages` の中の system メッセージを既定で拒否します（`allowSystemInMessages`）。v7 では `system` オプションが `instructions` に改名されました。
2. **user と assistant の履歴はクライアント由来なので信頼しない。** Route は `validateUIMessages` で形を検証し、`adaptHistoryForModel` でプロバイダ固有のフィールドや推論パートを取り除いてから `convertToModelMessages` に渡します。
3. **tool ロールの中身は `ToolOutcome` に統一する。** ツールの成功は `{ ok: true, data }`、失敗は `{ ok: false, failure: { kind, summary, nextAction } }` です。例外を投げずに結果として返すので、モデルは失敗を読んで次の手を選べます（Req 5.8）。

LangChain との対応では、`ChatPromptTemplate.from_messages([("system", ...), ("human", ...)])` の `system` / `human` / `ai` / `tool` が、`instructions` / `user` / `assistant` / `tool` に当たります。`human` は `user`、`ai` は `assistant` と名前が変わるだけです。

### テンプレートによるプロンプト構築

元教材（LangChain）では `PromptTemplate` / `ChatPromptTemplate` の `{variable}` に値を埋めます。このリポジトリは、テンプレートエンジンを使わず、**データ + 純粋関数**で書きます。ペルソナは「バージョン付きのデータ」として定義し、`render` が実行時の情報を足します。

```ts
// packages/ai-core/src/chat/personas/index.ts (abridged)
function renderPrompt(instructions: string, vars: PersonaVars): string {
	const context: string[] = [];
	if (vars.modelName !== undefined) context.push(`- モデル名: ${vars.modelName}`);
	if (vars.today !== undefined) context.push(`- 今日の日付: ${vars.today}`);
	if (context.length === 0) return instructions;
	return [instructions, "", "# 実行時の情報", ...context].join("\n");
}
```

設計上の要点は次の4つです。

- **固定部と可変部を分ける。** 固定の方針文（`# 方針`）は各ペルソナのデータで、可変部（`# 実行時の情報`）は `render` が末尾に足します。固定部が変わらない限り、プロンプトの先頭は同じ文字列になります（1-3 で扱うプロンプトキャッシュの前提でもあります）。
- **変数の値は信頼できる出所だけ。** `modelName` はモデルカタログの `displayName`、`today` は注入された `Clock` から作ります。リクエスト本文の値は、プロンプトに差し込みません（プロンプトインジェクションの入口を作らない）。
- **バージョンを持つ。** `PersonaTemplate.version` は semver で、`render` の出力を変えたら上げます。応答の `metadata`（`buildResponseMetadata`）に `personaId` と `version` が入るので、「どの版のプロンプトで答えたか」を後から追えます。
- **ペルソナは `satisfies PersonaSource` のデータ。** 追加は1ファイルで済み、`PersonaId` の型、リクエストスキーマの `z.enum`、セレクタの選択肢に反映されます。

ペルソナは3つあります。`general-assistant`（汎用）、`python-mentor`（Python 経験者に TypeScript を教える。Python の対応概念と対比して説明する）、`strict-reviewer`（重大度順に根拠付きで指摘する）です。同じ質問への応答がどう変わるかを、ハンズオン手順 1 で確かめます。

### Few-shot / CoT と、このリポジトリでの置き場所

元教材（2_ai-agent 第3章）の Zero-shot / Few-shot / CoT を、AI SDK のメッセージモデルに置き直します。

| 手法 | 意味 | AI SDK / このリポジトリでの書き方 |
|---|---|---|
| Zero-shot | 指示だけで例を与えない | `instructions`（ペルソナ）だけ。M1 の3ペルソナはすべてこれ |
| Few-shot | 入出力の例を数個与える | 2通り。(a) `instructions` の中に例の節を書く。(b) `user` / `assistant` のメッセージ対を、履歴の先頭に**サーバー側で**挿入する |
| CoT | 段階的に考えさせる | 推論モデルでは不要（次節）。非推論モデルには「結論の前に手順を書いて」と `instructions` に書く |

**M1 のペルソナに Few-shot の例は入っていません。** 必要になったら、(b) のほうがモデルにとって自然です（モデルは自分の過去の発言の形式に従いやすい）。ただし、(b) の対を作る場所は、クライアントが触れないサーバー側に限ります。クライアントが送る履歴は信頼しないため、Few-shot の例をクライアントの履歴に混ぜると、攻撃者が「お手本」を差し込めてしまいます。書き方の例（リポジトリには含まれません）を示します。

```ts
// Illustrative: server-side few-shot pairs placed before the validated history.
const fewShot: UIMessage[] = [
	{ id: "fs-u1", role: "user", parts: [{ type: "text", text: "1 USD は何円？" }] },
	{ id: "fs-a1", role: "assistant", parts: [{ type: "text", text: "為替ツールで確認します。" }] },
];
const modelMessages = await convertToModelMessages(
	adaptHistoryForModel([...fewShot, ...messages], entry),
);
```

Few-shot が効くのは「出力の形式や口調を揃えたい」ときです。ツール選択の精度を上げたいなら、例ではなく**ツールの `description` と `inputSchema` の `.describe()`** を直すほうが効きます（`currentTime` ツールの説明文が「日付や時刻、曜日を答えるときに使ってください」と使いどころを書いているのが一例です。3-1 の ACI で詳しく扱います）。

CoT の「考える過程を書かせる」役割は、ツールエージェントでは**ループそのもの**が担っています。「ツール呼び出し → 結果 → 次の判断」の繰り返しは、ReAct（Thought → Action → Observation）の構造化版です。元教材の AgentExecutor では `Action:` / `Observation:` というテキスト形式を解析していましたが、ネイティブのツール呼び出しではテキスト解析が不要です。

### 推論モデルが計画に与えた影響

推論モデルは、最終回答の前に**推論トークン**（思考過程）を出力します。エージェントの設計に、次の4つの影響があります。

1. **明示的な計画が不要になりやすい。** 以前は「まず計画を立てよ」「一歩ずつ考えよ」とプロンプトで促し、Plan-and-Execute のように計画用の呼び出しを分けていました。推論モデルは、1回の呼び出しの中で暗黙に計画します。プロンプトに CoT の足場を足すと、冗長になるだけのことがあります。計画を**外に出して検査したい**場合（3-2 の Planner / Executor）にだけ、構造化出力で計画を明示します。
2. **思考過程は表示用と運用用に分けて扱う。** Route は `sendReasoning: true` で推論パートをブラウザへ送り、`ReasoningDisclosure`（`<details>`）が折りたたんで表示します（Req 3.4）。最終回答と視覚的に分け、キーボードで開閉できます。
3. **コストと停止条件に効く。** 推論トークンは出力側のトークンとして課金されます。`AgentRunSummary.totalTokens.reasoning` が内訳を別に集計し、`RunSummaryBadge` が 0 でないときだけ表示します。トークン上限（`maxTotalTokens`）の判定は `inputTokens + outputTokens` の合計なので、推論の多いモデルでは上限に早く達しやすくなります（推論トークンが `outputTokens` に含まれるかはプロバイダの報告によります）。
4. **履歴に戻さない。** 次のターン以降、推論パートはモデルへ送りません（次の節）。

#### 切り替え時に、なぜ推論パートを送らないのか

`adaptHistoryForModel` は、どのモデルへ切り替えるときも**推論パートを常に除きます**。表示用の履歴は変えず、モデルへ送る写しだけを変えます（Req 3.3）。理由は3つあります。

- 推論を再送できるのは、プロバイダ固有のメタデータ（Anthropic の署名、OpenAI の項目 ID や暗号化済み内容）が付いているときだけです。
- そのメタデータは、クライアントが送る履歴では**信頼できません**。サーバーが発行したことを証明する署名がまだないため、`providerMetadata` などは出所に関係なく常に取り除きます。
- メタデータのない推論パートは、どのプロバイダも読み捨てます。OpenAI のプロバイダは、捨てる推論パートを**テキストごと警告に出力**するため、送るとログに推論内容が漏れます（W3 敵対的レビュー r2 の N1）。

同じ関数が、画像を受け付けないモデルへの切り替えでは画像パートをテキスト `[画像は省略されました]` に置き換え、結果のないツール呼び出しを除き、プロバイダが実行したツール（`providerExecuted`）は出所が同じプロバイダのときだけ残します。同一リクエスト内の、ステップ間の受け渡しは SDK の担当で、この関数の対象外です。

### ストリーミングと停止操作の伝播

`/api/chat` は `streamText` の結果を UI メッセージストリーム（`x-vercel-ai-ui-message-stream: v1` の SSE）で返します。流れは「ガード → モデル解決 → 履歴の検証と適応 → ストリーム」です。

```ts
// apps/web/app/api/chat/route.ts (abridged)
const result = streamText({
	model,
	instructions: persona.render({ modelName: entry.displayName, today }),
	messages: modelMessages,
	abortSignal: request.signal,
	onError: () => {}, // the SDK default logs the raw error
});
return result.toUIMessageStreamResponse({ sendReasoning: true, messageMetadata, onError });
```

- **停止の伝播。** ブラウザの `stop()` は fetch を中断し、サーバーでは `request.signal` が中断します。それが `abortSignal` として LLM 呼び出しに届き、生成が止まります。受信済みのテキストは `useChat` の `messages` に残ります（Req 3.5）。
- **エラー。** `onError: () => {}` は、AI SDK の既定（生のエラーを `console.error`）を止めるためです。プロバイダのエラーには要求本文（生のプロンプト）や認証情報が入ることがあるため、ストリームには `{ code, message }` の固定形式だけを流します。`ErrorBanner` が再送（`regenerate`）を出し、送信済みの学習者メッセージは失われません（Req 3.6）。
- **メタデータ。** `start` で使用モデルとペルソナ、`finish` で入出力トークン数を送り、`MessageMeta` が表示します（Req 3.7）。

### ツール定義（ACI）と Clock、ツールのエラーはツール結果

ツールは `tool()` を直接使わず、`defineAciTool` で定義します。`name`、`description`、`inputSchema`（Zod。旧 `parameters` から改名）、**必須の `risk`**（`read-only` / `write` / `destructive`）、`execute` を持ちます。

```ts
// packages/ai-core/src/aci/tools/current-time.ts (abridged)
export function createCurrentTimeTool(clock: Clock) {
	return defineAciTool({
		name: "currentTime",
		description: "現在の日時を返します。日付や時刻、曜日を答えるときに使ってください。",
		inputSchema: currentTimeInputSchema,
		risk: "read-only",
		execute: ({ timeZone }) => describeInstant(clock.now(), timeZone ?? DEFAULT_TIME_ZONE),
	});
}
```

- **Clock を注入する（Req 5.7）。** ツールはシステム時刻を直接読みません。テストでは固定の Clock を渡すので、「いま何時」の回答が再現できます。時間の判定が絡む停止条件も同じ Clock を使います。
- **例外は結果にする（Req 5.8）。** `defineAciTool` が包む `execute` は、`ToolExecutionError` や例外を `ToolOutcome` の `failure` に変えて返します。ループは中断せず、モデルが失敗を読んで再試行するか、ツールなしで答えます。想定外の例外のメッセージは結果に含めません（エラー名だけ）。
- **ツール単位の時間上限（Req 6.4）。** `AGENT_TOOL_TIMEOUT_MS` を超えた実行は打ち切られ、`kind: "timeout"` の失敗結果としてモデルに返ります。ツール個別の `timeoutMs` は上限を**短くすることだけ**ができます。学習者の停止は、結果にせず中断として伝播します。
- **`buildToolSet` を通す。** `defineAciTool` の産物だけが `buildToolSet` を通り、戻り値の型 `GuardedToolSet` だけがエージェントに渡せます。M1 は `read-only` 以外を登録できず（承認ゲートは M4）、キーが未設定のツール（Web 検索）は登録せず `disabled` に理由と必要な環境変数を載せます（Req 5.4）。

### LangChain AgentExecutor と `ToolLoopAgent` の対比

| 観点 | LangChain `AgentExecutor` | AI SDK `ToolLoopAgent`（このリポジトリでは `createGuardedAgent` 経由） |
|---|---|---|
| 位置づけ | 旧来の実行器。新規は LangGraph の `create_react_agent` が勧められている | `ai` パッケージのクラス。LLM が制御フローを決める処理に使い、コードが決める処理は `generateText` / `streamText` の合成で書く |
| ループの単位 | イテレーション（Action → Observation） | ステップ（1回のモデル呼び出し + そのステップのツール実行）。ツール呼び出しがなくなるか、`stopWhen` が成立するまで続く |
| 回数の上限 | `max_iterations`（既定値は版で変わる） | `stopWhen`。SDK の既定は `isStepCount(20)` だが、ここでは **3種を必ず設定** |
| 時間の上限 | `max_execution_time`（反復の間で判定） | `deadline` 条件（ステップ完了時）+ 合成した `abortSignal`（応答しない LLM 呼び出しを強制中断） |
| トークンの上限 | 標準にない（コールバックで自作） | `tokenBudget` 条件（全ステップの `inputTokens + outputTokens` の合計） |
| 上限到達時 | `early_stopping_method`（`force` は固定文、`generate` は最後に1回まとめを生成） | 停止理由を返して止まる。最終回答が出ないまま止まることがある（回帰テストで確認） |
| 停止理由 | 戻り値の文字列から推測する | 閉じた6語彙 `completed` / `step-limit` / `token-budget` / `timeout` / `aborted` / `error` |
| ツール定義 | `@tool`、`Tool` | `defineAciTool` + `inputSchema`（Zod）+ `risk`。生の `tool()` は型エラー |
| ツールの失敗 | `handle_tool_error` などで文字列化 | `ToolOutcome` の `failure`（`kind`、`summary`、`nextAction`） |
| 出力の解析 | テキスト形式の `Action:` を解析し、失敗は `handle_parsing_errors` | ネイティブのツール呼び出し（構造化）なので不要 |
| 観測 | `callbacks`（`on_tool_start` など）、`return_intermediate_steps` | SDK の `onStepEnd` / `onEnd`。このリポジトリは `RunObserver.onRunEnd(summary)` を1回呼ぶ。UI は assistant メッセージの `tool-*` パートを読む |
| 状態 | 実行器が `memory` / `chat_history` を持ち得る | 実行（run）内の messages だけ。会話履歴はクライアントの `useChat`、`GuardedAgent` は **1リクエストに1つ** |
| 中断 | 実装依存 | `abortSignal` を LLM 呼び出しとツールの両方へ伝播（`aborted`） |

#### 3種の停止条件と停止理由

`createGuardedAgent` は、次の3条件を `stopWhen` に必ず入れます（Req 6.1）。上限は `LoopLimits`（既定 `maxSteps` 10、`maxTotalTokens` 50,000、`maxDurationMs` 120,000、`toolTimeoutMs` 15,000）で、環境変数 `AGENT_MAX_STEPS`、`AGENT_MAX_TOTAL_TOKENS`、`AGENT_MAX_DURATION_MS`、`AGENT_TOOL_TIMEOUT_MS` で変えられます。上限は正の整数で、そうでなければ `ConfigError` です。1つのエージェントに登録できるツールは 20 個までです。

| 条件 | 判定 | 停止理由 |
|---|---|---|
| `stepLimit(n)` | 完了したステップ数が `n` に達した（SDK の `isStepCount` に委譲） | `step-limit` |
| `tokenBudget(n)` | 全ステップの `inputTokens + outputTokens` の合計が `n` 以上 | `token-budget` |
| `deadline(clock, ms)` | `clock.now() - startedAt` が `ms` 以上 | `timeout` |

AI SDK v7 は全条件を同時に評価するため、同じステップで複数が成立することがあります。`deriveStopReason` は優先順位で1つに決めます: 中断（`aborted` / `timeout`）→ `error` → 成立した条件（`timeout` → `token-budget` → `step-limit`）→ `completed`。結果は `AgentRunSummary`（停止理由、ステップ数、累積トークン、経過時間、呼び出したツール）として、`finish` チャンクの `messageMetadata.run` で UI に届きます（Req 6.2、6.5）。

#### 停止条件の近似性の注意（Req 6.1）

> **トークン上限と実行時間上限の判定は、ステップの完了時に行う近似です。上限を超えたステップは、完了まで実行されます。**

`StopCondition` は「完了したステップの配列」を受け取る関数で、ステップの途中では呼ばれません。したがって上限は**超過してから**検出されます。`stop-conditions.test.ts` の結合テストが、その数字を示しています。1ステップが 40 トークン（入力 30 + 出力 10）で、`maxTotalTokens` が 100 の場合です。

```text
step 1: 合計  40  (< 100)  → 続行
step 2: 合計  80  (< 100)  → 続行
step 3: 合計 120  (>= 100) → 停止  ← 3 ステップ目は上限を 20 超えて完了している
```

実行時間は、`deadline` がステップ完了時にしか評価されないため、**1回の LLM 呼び出しが応答しない**と効きません。これを補うため、`AbortSignal.any([呼び出し元のsignal, clock.timeoutSignal(maxDurationMs)])` を合成し、LLM 呼び出しとツールの両方へ渡します。タイムアウト側のシグナルが先に中断したときは、学習者の停止（`aborted`）ではなく `timeout` と記録します（`AbortSignal.reason` で判別）。ただし、中断された時点までに受信した内容は戻せませんし、ツール側の外部副作用は取り消せません。「物理的な遮断」と呼べるのは、この合成シグナルが届く範囲までです。

その他の注意があります。

- 停止条件の記録・ステップ数・開始時刻は `GuardedAgent` の内部に閉じます。インスタンスを使い回すと、前の実行の停止理由が混ざるため、**必ず1リクエストに1つ作ります**。
- `ToolLoopAgent` を生成してよいのは `agents/guarded-agent.ts` だけです（`check:repo-rules` の `guarded-agent-only`）。
- ストリーム途中のエラーでも、`run.error` は閉じたコードと固定の日本語文だけを持ちます。

### Generative UI: ツール結果をカードで描画する

Generative UI は、「AI が React を生成する」ことではなく、**ツールの結果を、登録した型付きのコンポーネントで描画する**ことです。assistant メッセージの `tool-<name>` パートは `state` を持つので、`ToolPartView` が `state` ごとに表示を切り替えます。

| `state` | 表示 |
|---|---|
| `input-streaming` | 「引数を生成しています」と、途中の引数 |
| `input-available` | 「実行しています」と、引数 |
| `output-available` | 成功ならカード + 「生の JSON を表示」。失敗（`ok: false`）なら種別・概要・次の行動 |
| `output-error` | 固定形式のエラー文（生の文面は表示しない） |

カードは `TOOL_RENDERERS`（ツール名 → コンポーネント）に登録します。`currentTime` は `TimeCard`、`calculator` は `CalculationCard`、`currencyConvert` は `CurrencyCard`、`weather` は `WeatherCard`、`webSearch` は `SearchResultsList` です。ストリームは信頼できない入力なので、カードの `data` は `unknown` で受け、形が合わなければ `RawJsonView`（JSON をテキストとして表示。マークアップとして解釈しない）にフォールバックします。未登録のツールも同じです。

## ハンズオン手順

### 手順 1: モデルとペルソナを切り替えられるストリーミングチャットを作る

- 実行モード: `local`（既定。`live` でも可。キーなしで挙動だけ見るなら `mock`）
- 外部サービス: `local` は Ollama（カタログ `local.ollama.chat` のモデルを取得済みであること）。`live` はプロバイダの API キー（`.env.local` の `ANTHROPIC_API_KEY` など。プロバイダは `AI_LIVE_PROVIDER`）

リポジトリのルートの `.env.local` に `AI_RUN_MODE=local` を書き、`mise run dev` で起動して `/chat` を開きます（`mise run dev` がこのファイルを読み込みます。以降の手順で `.env.local` を書き換えたら、`mise run dev` を起動し直します）。

`local` では、チャットとエージェントも要約と同じ `num_ctx`（カタログの `contextWindow`、既定のモデルで 32,768）を Ollama に渡します（`@platform/ai-core/models` の `ollamaRuntimeOptions`）。呼び出しごとに値が違うと Ollama がモデルを読み込み直し、1回ごとに数秒かかるためです。代わりに、既定のモデルでは約 10 GB のメモリが常駐します。

1. 質問を送り、チャンクが届くたびに表示が伸びることを確かめる（Req 3.1）。
2. ペルソナを `general-assistant` から `python-mentor`、`strict-reviewer` に切り替え、同じ質問の答え方の違いを比べる。応答の下のモデル名とトークン数も確かめる（Req 3.7）。
3. 画像を扱えるモデルに切り替えて画像を添付する。画像を扱えないモデルでは、添付ボタンが理由付きで無効になることを確かめる（Req 3.9）。
4. 生成中に停止ボタンを押し、受信済みのテキストが残ることを確かめる（Req 3.5）。
5. Ollama を止めて送信し、エラーと再送ボタンが出ること、再送で同じメッセージが再生成されることを確かめる（Req 3.6）。
6. 会話の途中でモデルを切り替え、次の応答が履歴を踏まえて返ることを確かめる（Req 3.3）。

### 手順 2: サンプルツールを持つツールエージェントを作り、状態と結果をカードで描画する

- 実行モード: `local`（`live` でも可。キーなしの確認は `mock`）
- 外部サービス: `local` は Ollama（ツール呼び出しに対応したモデル）。天気ツールは公開の天気 API へ HTTP で問い合わせる（キー不要）。時刻・計算・為替は外部通信なし。`mock` は固定シナリオと HTTP fixture を使う

`/agent` を開き、次の順に確かめます。

1. 「東京の天気を教えて」: `weather` の `tool-*` パートが `input-available` から `output-available` に変わり、`WeatherCard` が描画される。「生の JSON を表示」で `ToolOutcome` の中身を見る。
2. 「いま何時？」: `TimeCard`。同じ質問を `mock` の固定 Clock のテストと比べ、時刻を注入する意味を確かめる。
3. 「(1 + 2) * 3 と火星の天気を教えて」: 計算は成功し、天気は「座標が登録されていません」という `recoverable` の失敗として返り、ループは続く（Req 5.8）。
4. 「こんにちは」: ツールを呼ばずに答え、実行サマリの呼び出したツールが「なし」になる（Req 5.6）。

### 手順 3: Web 検索ツールを、API キーがあるときだけ登録する

- 実行モード: `local`（`live` でも可）
- 外部サービス: Tavily の API キー（`TAVILY_API_KEY`）。キーなしの状態も確かめる

1. `TAVILY_API_KEY` を設定せずに `/agent` を開く。Web 検索が無効であること、必要な環境変数名が画面に出ることを確かめる（Req 5.4）。環境変数名はサーバーから届いた値で、クライアントのコードには書かれていません。
2. キーを `.env.local` に書いて再起動する。通知が消え、検索結果が `SearchResultsList` に出ることを確かめる。
3. リクエスト本文で「有効」と偽っても登録されないことを、テスト `never takes tool availability from the request body` で確かめる。

### 手順 4: 停止条件に達したときの停止理由と実行サマリを確かめる

- 実行モード: `mock`（決定論的に再現するため。同じ設定は `local` でも試せる）
- 外部サービス: なし

1. `.env.local` に `AI_RUN_MODE=mock` と `AGENT_MAX_STEPS=1` を書いて再起動し、`/agent` で「東京の天気を教えて」を送る。実行サマリが `step-limit`、ステップ数 1、ツール `weather` となり、最終回答が出ないまま止まることを確かめる。
2. 近似性をテストの数字で確かめる。`mise exec -- pnpm --filter @platform/ai-core exec vitest run --coverage.enabled=false src/agents/stop-conditions.test.ts` を実行し、`stops the loop once the token budget is reached and records why` のコメント（80 → 120）を読む。上限 100 を 20 超えたステップが完了している。
3. `stop-conditions.ts` の `tokenBudget` の判定を `>=` から `>` に変えてテストを実行し、どのテストが失敗するかを見て、元に戻す。
4. `guarded-agent.test.ts` の `turns an unresponsive LLM call into timeout when maxDurationMs elapses` を読み、応答しない LLM 呼び出しが、`deadline` 条件ではなく合成した `abortSignal` で止まる仕組みを説明する。

## 習熟度判定チェックリスト

自動テストで確かめられる項目には、テストへの参照を付けています。

- [ ] 応答のチャンク（テキストと推論）とメッセージのメタデータを、受信するたびに表示できる <!-- test: apps/web/app/api/chat/route.test.ts#streams text, reasoning and message metadata in mock mode (Req 3.1, 3.4, 3.7) -->
- [ ] システムプロンプトはペルソナのテンプレートから、カタログのモデル名を差し込んで作られる <!-- test: apps/web/app/api/chat/route.test.ts#uses the persona prompt with the catalog model name as the system prompt (Req 3.10) -->
- [ ] クライアントが送った `system` ロールのメッセージは拒否される <!-- test: packages/ai-core/src/chat/request-schema.test.ts#rejects a client-supplied system message; the persona is the only system prompt -->
- [ ] 会話の途中でモデルを切り替えても履歴を保てて、推論パートはモデルへ送られない <!-- test: apps/web/app/api/chat/route.test.ts#drops reasoning from the history sent after a model switch (Req 3.3) -->
- [ ] ツールが不要な質問ではツールを呼ばずに答え、呼び出したツールの一覧が空で返る <!-- test: packages/ai-core/src/agents/guarded-agent.test.ts#answers from knowledge without tools and leaves toolsCalled empty -->
- [ ] ツールの例外が、ループを止めずにツール結果としてエージェントへ返る <!-- test: packages/ai-core/src/aci/define-tool.test.ts#returns a failing tool's outcome as a tool result so the agent loop can continue -->
- [ ] 停止理由が閉じた6語彙で、優先順位が決まっている <!-- test: packages/ai-core/src/agents/stop-reason.test.ts#is the closed vocabulary of Req 6.2 -->
- [ ] ステップ数の上限で止まり、停止理由が `step-limit` になる（手順 4 の 1）
- [ ] トークン上限と実行時間上限が「ステップ完了時の近似」であることを、数字で説明できる <!-- test: packages/ai-core/src/agents/stop-conditions.test.ts#stops the loop once the token budget is reached and records why -->
- [ ] 応答しない LLM 呼び出しも、実行時間の上限で `timeout` として止まる <!-- test: packages/ai-core/src/agents/guarded-agent.test.ts#turns an unresponsive LLM call into timeout when maxDurationMs elapses -->
- [ ] 学習者の停止が、実行中の LLM 呼び出しとツールへ伝わり、停止理由が `aborted` になる <!-- test: apps/web/app/api/agent/tools/route.test.ts#aborts the run and the running tool when the request is aborted (Req 6.3) -->
- [ ] 登録されたツールの成功結果は専用のカードで、未登録のツールは JSON で表示される <!-- test: apps/web/components/agent/ToolPartView.test.tsx#shows raw JSON for a tool without a registered renderer (Req 5.5) -->
- [ ] `AgentExecutor` と `ToolLoopAgent` の対比を、ループの単位・上限・停止理由・観測・状態の5点で説明できる
- [ ] 推論パートをモデルへ再送しない理由を、プロバイダ固有メタデータの信頼性とログへの漏えいの観点で説明できる
- [ ] Few-shot の例をサーバー側にだけ置く理由を説明できる

## リファレンス実装とテストの所在

| 項目 | パス |
|---|---|
| ペルソナ（テンプレート） | [packages/ai-core/src/chat/personas/](../../packages/ai-core/src/chat/personas/index.ts) |
| 履歴の適応（モデル切り替え） | [packages/ai-core/src/chat/adapt-history.ts](../../packages/ai-core/src/chat/adapt-history.ts) |
| リクエストスキーマ（system を受け付けない） | [packages/ai-core/src/chat/request-schema.ts](../../packages/ai-core/src/chat/request-schema.ts) |
| 応答メタデータ | [packages/ai-core/src/chat/metadata.ts](../../packages/ai-core/src/chat/metadata.ts) |
| ツール定義の規約（`defineAciTool`） | [packages/ai-core/src/aci/define-tool.ts](../../packages/ai-core/src/aci/define-tool.ts) |
| ツール集合（`buildToolSet`、`GuardedToolSet`） | [packages/ai-core/src/aci/tool-set.ts](../../packages/ai-core/src/aci/tool-set.ts) |
| サンプルツール5種 | [packages/ai-core/src/aci/tools/](../../packages/ai-core/src/aci/tools/current-time.ts) |
| ガード付きエージェント | [packages/ai-core/src/agents/guarded-agent.ts](../../packages/ai-core/src/agents/guarded-agent.ts) |
| 停止条件 3 種 | [packages/ai-core/src/agents/stop-conditions.ts](../../packages/ai-core/src/agents/stop-conditions.ts) |
| 停止理由 | [packages/ai-core/src/agents/stop-reason.ts](../../packages/ai-core/src/agents/stop-reason.ts) |
| チャット Route Handler | [apps/web/app/api/chat/route.ts](../../apps/web/app/api/chat/route.ts) |
| ツールエージェント Route Handler | [apps/web/app/api/agent/tools/route.ts](../../apps/web/app/api/agent/tools/route.ts) |
| チャット画面の部品 | [apps/web/components/chat/](../../apps/web/components/chat/ChatPanel.tsx) |
| ツールエージェント画面とカード | [apps/web/components/agent/](../../apps/web/components/agent/ToolAgentPanel.tsx) |
| 停止条件・停止理由・エージェントのテスト | [packages/ai-core/src/agents/](../../packages/ai-core/src/agents/guarded-agent.test.ts)（`*.test.ts`） |
| ACI・チャットコアのテスト | `packages/ai-core/src/aci/*.test.ts`、`packages/ai-core/src/chat/*.test.ts` |
| Route Handler のテスト | `apps/web/app/api/chat/route.test.ts`、`apps/web/app/api/agent/tools/route.test.ts` |
| 回帰テスト（5ツール構成の通し実行） | [packages/eval-suite/tests/regression/tool-agent-run.test.ts](../../packages/eval-suite/tests/regression/tool-agent-run.test.ts) |

## 元教材との対照表

| 元教材（Python / LangChain / LangGraph）の対応箇所 | TypeScript / AI SDK 版での置き換え | 移植で諦めたもの |
|---|---|---|
| 1_llm-agent 第3章 最初のチャット（Streamlit のフォーム、`ConversationChain`） | Route Handler の `streamText` と `useChat` によるストリーミングチャット | Streamlit の全行再実行モデルの手軽さ（イベントハンドラと状態管理を書く必要がある） |
| 1_llm-agent 第4章 チャットの作り込み（Memory、スタイル、ペルソナ） | `useChat` の `messages`、バージョン付きペルソナ、画像のファイルパート、`adaptHistoryForModel` | `ConversationBufferMemory` 相当のセッションをまたぐ履歴の永続化（リロードで消える） |
| 1_llm-agent 第11章 外部ツール連携（`AgentExecutor`） | `createGuardedAgent`（`ToolLoopAgent`）と5つのサンプルツール、3種の停止条件 | `max_iterations` / `max_execution_time` の意味の完全な再現（`stopWhen` のステップ完了時判定で近似。`early_stopping_method` の「最後にまとめを生成する」動作） |
| 2_ai-agent 第1章 / 3_genai-agent 第1章（推論モデルの台頭） | 推論パートの受信と折りたたみ表示、`reasoning` トークンの集計 | なし（解説のみ） |
| 2_ai-agent 第2章 LLM 呼び出しの基本（Function Calling） | `generateText` / `streamText`、Zod の `inputSchema` によるツール呼び出し | Assistants API 型の、サーバー側で状態を持つスレッド |
| 2_ai-agent 第3章 プロンプト設計（Zero/Few-shot、CoT） | ペルソナのテンプレート、サーバー側でのロール構成、推論トークン | `PromptTemplate` / `ChatPromptTemplate` の宣言的な合成と、`FewShotPromptTemplate` の例選択器（M1 に Few-shot の実装はない） |
| 2_ai-agent 第9章 自律エージェントの基礎（LangGraph の State / Node / Edge / Checkpointer） | 型付きの状態を持つ TypeScript のループ（`ToolLoopAgent`）。承認は 4-4 | reducer による状態のマージ、checkpointer と `interrupt` による耐久的な中断・再開、LangGraph Studio。M1 の実行は、リクエストをまたいで再開できない |
| 2_ai-agent 第13章 Generative UI（新設） | ツール結果を `TOOL_RENDERERS` の型付きカードで描画、未登録は JSON | Streamlit / Gradio の部品を使った手軽な UI |

## 移植時の変更点

[changes-from-drafts.md](../../specs/curriculum/changes-from-drafts.md) の「AI SDK の API」の節に記録された変更のうち、このモジュールに関わるものです。

- **`maxSteps` → `stopWhen`。** ドラフトの `maxSteps: N` は、`ToolLoopAgent` の `stopWhen`（`isStepCount` など）に置き換わりました。ステップ数だけでは暴走を止めきれないため、ステップ数・累積トークン・実行時間の3種を必ず設定し、停止理由を閉じた語彙で返します（Req 6、plan C8）。
- **`parameters` → `inputSchema`。** ツールの入力は `inputSchema` で定義します。さらに、リスク区分と時間上限を強制する `defineAciTool` で包みます（plan C9）。
- **`system` → `instructions`、`onFinish` → `onEnd`、`onStepFinish` → `onStepEnd`。** v7 の改名です。旧名は別名として残る場合がありますが、このリポジトリは新名を使います（research I-1）。
- **`usage` の内訳の改名。** `usage.cachedInputTokens` → `usage.inputTokenDetails.cacheReadTokens`、`usage.reasoningTokens` → `usage.outputTokenDetails.reasoningTokens`（別名なし）。
- **ストリームの API。** `toDataStreamResponse()` / `createDataStream` は、UI メッセージストリームに置き換わりました。エージェントは `createAgentUIStreamResponse`、チャットは `streamText` の結果の `toUIMessageStreamResponse` を使います（research I-1、I-4）。
- **`useChat` の変更。** `ai/react` の `input` / `handleInputChange` / `handleSubmit` / `attachments` は廃止され、`@ai-sdk/react` の `useChat` と `DefaultChatTransport`（`sendMessage`、`stop()`、`regenerate()`、`clearError`）に変わりました。画像はメッセージのファイルパートで送ります（research I-5）。
- **Generative UI の定義。** 「AI が React コンポーネントを直接描画する」という説明をやめ、「ツール結果を、登録した型付きコンポーネントで描画する。未登録は JSON」としました（Req 5.5、plan C16）。
- **実測で確定した点。** `createAgentUIStream` では、UI ストリームの `finish` が `streamText` の `onEnd` より先に届くことがあります。このため `GuardedAgent` は `finish` のメタデータ生成時にも実行サマリを確定します。`ToolLoopAgentSettings` に `onError` の型はないものの、`streamText` に展開されるため、キャストして渡してログへの漏えいを防ぎます（plan C8）。
- **モデルの指定。** 解説とコードにモデル ID は書きません。既定のモデルは `catalog: local.ollama.chat`（`local`）や `catalog: live.anthropic.chat`（`live`）のように、カタログで引きます。

## Python / Streamlit 経験者向けコラム

| Streamlit / LangChain | Next.js + AI SDK | 違い |
|---|---|---|
| `st.session_state.messages`（`{"role", "content"}` の辞書のリスト） | `useChat` の `messages`（`UIMessage` の配列。`parts`、`id`、`metadata` を持つ） | `content` が1つの文字列から `parts` の配列になり、テキスト・推論・画像・ツール呼び出しを同じ列に持つ。履歴の保管場所がサーバーのセッションからブラウザの React の state に移る |
| `st.chat_message("assistant")` で履歴をループ描画 | `MessageList` が `messages` を `map` し、`parts` の `type` ごとに描画 | 描画の更新は、スクリプト全体の再実行ではなく、state の変化で差分の再レンダリングになる |
| `st.write_stream(generator)` | `streamText(...).toUIMessageStreamResponse()` と `useChat` | ジェネレータの文字列ではなく、型付きのチャンク（`text-delta`、`reasoning-delta`、`tool-input-available`、`tool-output-available`、`finish` など）の SSE。ツール呼び出しや使用量のメタデータも同じストリームに載る |
| `ConversationBufferMemory` が履歴を保持 | サーバーは**状態を持たない**。毎回、履歴全体をクライアントが送る | 履歴は信頼できない入力なので、検証（`validateUIMessages`）と適応（`adaptHistoryForModel`）が要る。リロードで履歴は消える |
| 停止ボタン: スクリプトの再実行（中断）に頼る | `stop()` が fetch を中断し、サーバーの `request.signal` → `abortSignal` で LLM とツールまで伝わる | 中断が明示的な API になり、受信済みのテキストは残る |
| `st.secrets` / 環境変数で API キー | サーバーだけが環境変数を読む（Req 3.8） | ブラウザからプロバイダへ直接通信しない。キー名はクライアントのコードに書かない |
| `AgentExecutor(..., max_iterations=...)` | `createGuardedAgent({ limits })` | 上限が3種に増え、停止理由が型になる |

Streamlit では、入力のたびにスクリプトが先頭から再実行され、状態は `st.session_state` に退避していました。React では、再実行されるのはコンポーネントの関数で、状態は `useState` / `useChat` の中に残ります。そのため、「送信ボタンが押されたら関数を呼ぶ」というイベントハンドラ（`handleSubmit`）の形で書き、`status`（`submitted` / `streaming` / `ready` / `error`）で画面を切り替えます。

## 完成時点のタグ

- **タグ**: `module/1-2`（注釈付きタグ。指すコミットは `7cc27cc`）
- **含まれるもの**: ChatCore（`chat/`）、GuardedAgent（`agents/`）、AciToolkit（`aci/`）、チャット機能（`/chat`）、ツールエージェント機能（`/agent`）、リクエストガード。`next dev` / `next start` で `mock` モードで動きます。Turbopack でのビルド修正、Tailwind、フォーカスのアウトライン色の修正を済ませた後に付けたタグで、最初の機能コミット（`64e3a96`、`27112ee`）は Turbopack ではビルドできません。
- **含まれないもの**: E2E テスト（`apps/web/e2e`）と、この解説を含む `docs/`（plan C22）。同じコミットに、要約機能（`module/1-3`）や Playwright の設定が入っていますが、このモジュールの一部ではありません。タグより後の変更として、2026-10-12 の `local` の既定モデルの変更と、チャット・エージェントが要約と同じ Ollama の `num_ctx` を渡す変更（タスク 29.5。モデルの再読み込みを避ける）も含まれません。タグの時点では、チャットとエージェントは Ollama のサーバー既定のコンテキスト長で動きます。
- **公開状況**: タスク 29.4 で、人間の承認後にリモートへ push しました（2026-10-12。`git ls-remote --tags origin 'module/*'` で確認できます）。
