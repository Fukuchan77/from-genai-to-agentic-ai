# 3-2 ヘルプデスク・エージェント（Plan-and-Execute）

- **フェーズ**: Phase 3。IBM 成熟度モデルの Level 2〜3 を扱います。実行の前に計画を立て、進捗に応じて計画を組み替える Plan-and-Execute を、チケットの永続化と合わせて実装します（[phase-3.md](../../specs/curriculum/phase-3.md)）
- **要件**: [spec 003](../../specs/003-domain-agents/spec.md) の Requirement 2（2.1、2.2、2.3、2.4、2.6、2.7、2.8、2.10）。解説の必須事項として 001 の Requirement 7.2〜7.6、7.9
- **実装**: `packages/ai-core/src/helpdesk/`、`apps/web/app/api/helpdesk/`、`apps/web/components/helpdesk/`、`apps/web/app/helpdesk/`

## 学習目標

このモジュールを終えると、次のことができます。

- 問い合わせから実行計画（依存関係を持つタスクの一覧）を構造化出力で作り、不正な計画（循環、存在しないタスクへの依存、空の計画）を実行せずに再生成させる設計にできる。
- 依存先が完了していないタスクを実行しないスケジューラを、純関数として書ける。
- タスクの完了ごとに `continue` / `replan` / `finish` を判断させ、再計画の前後の差分と判断理由を記録できる。
- ステップ数の上限で実行を止め、未完了のタスクを返せる。チケットの `open` / `resolved` / `escalated` の遷移を説明できる。
- 認証情報の形状を最終回答の保存前に検査し、検出したら保存せずに回答を作り直させる設計を説明できる。
- 計画の制御を `ToolLoopAgent` ではなくコードで書く理由（ADR-9）と、憲章の原則 1 でこの構成が⚠ として人の確認を受けた経緯を説明できる。

## 主要トピック

扱う概念は次の8つです。

1. Plan-and-Execute の流れ
2. 計画の検査と再生成
3. スケジューラ: 依存順の実行
4. continue / replan / finish と計画の差分
5. チケットとステップ上限
6. 認証情報の形状検査
7. 計画をワークフローで書き ToolLoopAgent を使わない理由（ADR-9）
8. 憲章 原則 1 の⚠ 2 の記録

### Plan-and-Execute の流れ

Plan-and-Execute は、**実行の前に計画を作り、計画のタスクを順に実行し、結果を見て計画を見直す**構成です。1 回の問い合わせの流れは `runHelpdesk`（`helpdesk/helpdesk.ts`）に書かれています。

1. `planTasks` が問い合わせから計画を作る（構造化出力、Req 2.1）。計画が有効になってから、チケットを作る。
2. `nextRunnable` が、次に実行できるタスクを選ぶ（Req 2.2）。`runTask` が、そのタスクだけを実行する。
3. タスクが終わるたびに `decideNext` が `continue` / `replan` / `finish` を判断する（Req 2.3）。
4. 最終回答を作り、認証情報の形状を検査してから、チケットを `resolved` か `escalated` にする（Req 2.6〜2.8）。

元教材は、これを LangGraph の `StateGraph`（Planner、Executor、Replanner のノードと条件付きエッジ）で書きます。本リポジトリでは、`for` ループと `if` で書いた関数 `runHelpdesk` です。各ノードに相当する部品は独立した関数で、モデルは引数で受け取るので、`mock` のモデルを渡して部品ごとにテストできます。

```ts
// packages/ai-core/src/helpdesk/helpdesk.ts (idea, abridged)
const planned = await planTasks({ model, ticket: { inquiry }, knowledge, signal });
if (!planned.ok) return escalate(INVALID_PLAN_REASON); // Req 2.10
for (;;) {
	const task = nextRunnable(plan, completed); // Req 2.2
	if (!task) break;
	if (steps >= maxSteps) return stop("step-limit"); // Req 2.4
	const { result } = await runTask({ task, inquiry, knowledge, model, limits, clock, signal });
	steps += 1;
	completed.add(task.id);
	const next = await decideNext({ model, plan, completed, lastResult: result, signal });
	if (next.decision === "finish") break;
	if (next.decision === "replan") {
		/* keep the completed tasks, adopt the regenerated rest, record the revision and its diff */
	}
}
```

各状態変化は、`onEvent` を通じて `plan`（タスクの `pending` / `running` / `done` と差分）、`progress`（ステップ数、現在のタスク、判断と理由）、`result` のイベントとして、次の LLM 呼び出しの前に書き出されます（Req 2.5）。画面では、これが「現在のタスク」「完了タスク」「修正された計画」の表示になります。

### 計画の検査と再生成

計画は `PlanSchema`（`tasks` の配列。各タスクは `id`、`description`、`dependsOn`）の構造化出力です。スキーマで検査するのは**形**だけです。次の問題は、あえてスキーマではなく `validatePlan`（純関数）で検査し、問題の文言をモデルへ返します。

| 問題 | `kind` | 備考 |
|---|---|---|
| 空の計画 | `empty` | Req 2.10 |
| 存在しないタスクへの依存 | `missing-dependency` | 対象のタスク ID と、存在しない ID の両方を名指す |
| 依存の循環（自己依存を含む） | `cycle` | 循環上のタスクを `A → B → A` の形で示す。共有された依存（ダイヤモンド）は循環ではない |
| タスク数が上限（`DEFAULT_HELPDESK.maxPlanTasks` = 8）を超える | `too-many-tasks` | |
| タスク ID の重複 | `duplicate-id` | |
| タスクの説明に認証情報の形状が含まれる | `credential-shape` | 説明は保存・配信されるため |

スキーマではなく `validatePlan` に置く理由は、**問題を日本語の文でモデルへフィードバックして再生成するため**です。スキーマ違反の `output-invalid` で終わると、エスカレーションの経路（Req 2.10）に乗りません。再生成は M2 の共通部品 `generateValidated` が行い、問題の文言を次のプロンプトに入れて、`maxPlanRegenerations`（既定 2 回）まで繰り返します。それでも不正なら、`planTasks` は `ok: false` と問題の一覧を返し、`runHelpdesk` はチケットを `escalated` にして、タスクを 1 つも実行しません。出力がスキーマに最後まで合わない場合だけは、他の機能と同じく `output-invalid` の例外になり、チケットは作られません。

### スケジューラ: 依存順の実行

`nextRunnable(plan, completed)`（`helpdesk/scheduler.ts`）は 12 行の純関数です。**未完了で、かつ依存先がすべて完了しているタスクのうち、計画の並びで最初のもの**を返します。計画の並びではなく依存順に従うので、依存先が後ろに書かれた計画でも、依存先が先に実行されます。残りが「永遠に完了しないものを待っている」場合も `undefined` を返すので、ループは終わります（検査済みの計画では起きませんが、再計画の結果もこの関数に渡るため、防御として意味があります）。

実行は直列です。並列に走らせる設計もありえますが、ローカルの Ollama は 1 スロットで直列になり、ステップ数の計数（後述）と進捗表示も単純なほうが読みやすいためです。

タスクの実行 `runTask`（`helpdesk/run.ts`）は、ナレッジ検索のツール（読み取り専用）1 つだけを持つ `createGuardedAgent` です。結果は、600 文字までの要約と、根拠にした文書（`sources`）です。タスクが失敗しても（ステップ上限、致命的なツールエラー、時間切れ）、例外ではなく `failure` を記録して返すので、Replanner が失敗を見て `replan` を選べます。

### continue / replan / finish と計画の差分

タスクが終わるたびに `decideNext`（`helpdesk/replanner.ts`）が、次の3つのいずれかを判断理由とともに構造化出力で返します（Req 2.3）。

| 判断 | 意味 | 次の動き |
|---|---|---|
| `continue` | 計画どおりに続行 | 次の `nextRunnable` へ |
| `replan` | 結果を見ると、残りのタスクでは解決できない | 残りのタスクだけを再生成する |
| `finish` | 最終回答に十分な根拠がそろった、またはこれ以上調べても見つからない | 残りのタスクを実行せず、最終回答へ進む |

`replan` では、**完了したタスクはそのまま残し、残りのタスクだけを再生成**します。再生成の出力は完了済みの ID を使えず（使うと問題として返して再生成させます）、残りのタスクは完了済みのタスクの ID を `dependsOn` に書けます。新しい計画は「完了済みのタスク + 再生成された残り」を結合したもので、結合した計画全体を `validatePlan` で検査します。再生成が上限（既定 2 回）まで不正なら、チケットを `escalated` にします。

変更前後の差分は `diffPlan(before, after)`（純関数）が計算します。タスク ID は再計画をまたいで保たれ（CL-13）、差分は次の3つです。

- `added`: 後の計画にだけある ID
- `removed`: 前の計画にだけある ID
- `changed`: 両方にあり、説明または依存（集合として比較）が違う ID。依存の並び順が違うだけでは変更にしない

差分と判断理由は、`helpdesk_plan_revisions` に**版（revision）として追記**されます。最初の計画が版 0 で、再計画のたびに版が 1 つ増え、版 1 以降は差分が必須です。画面の「修正された計画」は、この差分から描かれます。判断理由はモデルの出力なので、保存・配信の前に認証情報の形状の検査（後述）を通し、該当すれば固定の文言に置き換えます。

### チケットとステップ上限

チケットは `helpdesk_tickets` に保存します（ADR-10。M2 の `rag` と同じ drizzle 基盤、テストは PGlite、ハンズオンは Postgres）。状態は次の遷移だけです。

```text
open ──→ resolved   (最終回答を保存。Req 2.6)
open ──→ escalated  (解決できない理由を記録。Req 2.7、2.8、2.10)
open ──→ open       (上限または中断で止まった。stopped_reason に step-limit / aborted を記録)
```

`open` からの遷移は、`WHERE status = 'open'` を付けた 1 回の UPDATE で行い、2 つの書き込みが同じチケットを終わらせることはできません。`resolved` と `escalated` から戻すことはできません。ID は `T-0001` のように、保存されている最大の番号に 1 を足して決定論的に付けます（乱数も時刻も使いません）。

**`escalated` になる場合**は次のとおりです。

| 理由 | 根拠 |
|---|---|
| 計画が不正で、再生成の上限（既定 2 回）に達した | Req 2.10 |
| 再計画が不正で、再生成の上限に達した | Req 2.10 |
| どのタスクもナレッジに根拠（`sources`）を見つけられなかった | 根拠のない回答を作らない |
| モデルが最終回答で「解決できない」と判断した（`unresolved`） | Req 2.7 |
| 最終回答に認証情報の形状があり、作り直しても残った | Req 2.8 |
| 処理中の想定外のエラー | 固定の理由を記録し、例外は上へ通す |

**ステップ数の上限**（Req 2.4、CL-14）は、`maxSteps`（既定 `DEFAULT_HELPDESK.maxSteps` = 12、API では 1〜30）です。「ステップ」は、**タスクの実行 1 回**と**計画・再計画の生成 1 回**を数えます。上限に達したら、次のタスクを開始せず、チケットを `open` のまま `stopped_reason = 'step-limit'` を記録して、未完了のタスクの一覧を返します。`escalated` にしないのは、上限は「解決できない」ではなく「予算が足りなかった」という別の事実だからです。すべてのタスクを終えた最後のステップで上限に達した場合は、そのまま最終回答へ進みます。中断（`AbortSignal`）は `stopped_reason = 'aborted'` で、中断後に LLM 呼び出しは始まりません。

**注意**: 停止したチケットは `open` のままなので、API の上では後から `resolved` にできます（実行の再開は行いません。003 plan の CL-6、005 の範囲外）。

### 認証情報の形状検査

ヘルプデスクの回答は、パスワードの再設定のような話題を扱います。モデルが文面に値を書いてしまうと、その値が DB、画面、ログに残ります。`detectCredentialShapes`（`helpdesk/credentials.ts`）は、**値ではなく種別だけを返す**純関数で、最終回答の保存・表示の前に検査します（Req 2.8）。

| 種別 | 例 |
|---|---|
| `plaintext-password` | 「パスワードは `Xy9!abc123`」のように、ラベルの後ろに値が続く形 |
| `temporary-password` | 「仮パスワード」「一時パスワード」「temporary password」などのラベルと値。一時パスワードは平文のパスワードとは二重に数えない |
| `api-key` | 「API キー」のラベルと値、`sk-`、`tvly-`、`AKIA…`、`AIza…` などの固有の形 |
| `access-token` | 「アクセストークン」「Bearer …」のラベルと値、`ghp_…`、`xox…-`、JWT の形 |

案内の文は検出しません。「パスワードは設定画面から変更できます」、リンク（`https://…/reset`）、プレースホルダ（`<password>`、`****`）、小文字だけの普通の単語は、見つけても認証情報にしません。パターンは長さに上限があり、長い行でも破滅的なバックトラックを起こしません。

検出時の流れは次のとおりです。

1. 最終回答に認証情報の形があれば、**保存も表示もしません。**
2. 検出した種別だけをストリームで伝え、モデルに「前回の回答には○○の形が含まれていた。値は書かず、手順や案内だけで回答する」と指示して、回答を**1 回だけ再作成**させる。前回の回答の本文はモデルに見せません。
3. 再作成した回答が清潔なら保存して `resolved` にする（検出した種別は結果に付ける）。
4. 再作成した回答にも認証情報の形があれば、チケットを `escalated` にする。

行・イベント・結果には、種別だけが入り、値は入りません。

### 計画をワークフローで書き ToolLoopAgent を使わない理由（ADR-9）

ヘルプデスクの計画、Replanner、最終回答は、**手順が固定されています。** 「計画を作る → 検査する → 実行する → 判断する → 答える」という順序は、コードが決めています。LLM が決めるのは、構造化出力として返す中身（計画のタスク、`continue` / `replan` / `finish`、回答の文面）だけです。ツールを選んで行動するわけではないので、憲章の原則 1（ワークフローとエージェントを峻別する）に従うと、ワークフローです。

ADR-9 は、計画全体を 1 つの `ToolLoopAgent` にする案を退けました。理由は、**計画の不正検査と再生成の上限が、エージェントの Run の停止条件と混ざる**ためです。たとえば、不正な計画の再生成が 2 回で終わる規則（Req 2.10）と、ステップ数の上限（Req 2.4）、トークンの上限、時間の上限は、数える単位も、上限に達したときの帰結（`escalated` か `open` か）も違います。1 つのループに入れると、どの上限で止まったのかが読み取れなくなります。

決定は次のとおりです。

| 部分 | 種別 | 制御するもの | `ToolLoopAgent` |
|---|---|---|---|
| 計画（`planner.ts`）、判断と再計画（`replanner.ts`）、全体の制御と最終回答（`helpdesk.ts`） | ワークフロー | コード（依存順のスケジューラ、ステップ上限、再生成の上限） | 使わない |
| タスクの実行（`run.ts`） | エージェント | LLM（ナレッジ検索をいつ何回呼ぶか） | `createGuardedAgent` 経由 |

この境界は、規則 `workflow-no-agent-loop`（`mise run check:repo-rules`、`gate` の一部）が機械的に守らせます。`planner.ts`、`replanner.ts`、`helpdesk.ts` が `ToolLoopAgent` や `createGuardedAgent` を import すると、gate が失敗します。タスクの実行にだけ `createGuardedAgent` を使うので、タスクごとに M1 の 3 種の停止条件（ステップ数、トークン、時間）が付きます。

ワークフローに置いたことで、ひとつ得るものがあります。**エージェントが判断する部分が、ナレッジ検索の回数だけに絞られる**ことです。ステップ上限を超えて走ること、不正な計画を実行すること、認証情報を含む回答を保存することは、コードが禁じています。

### 憲章 原則 1 の⚠ 2 の記録

[憲章](../../.sdd/memory/constitution.md)の原則 1 は、「最もシンプルな設計から始め、複雑さは実測で正当化できるときだけ足す」という方針です。003 の plan の Constitution Compliance は、この原則に⚠ を 3 つ付け、人が承認時に確認する項目として記録しました。このモジュールに関わるのは**⚠ 2** です。

- **⚠ 2 の内容**: ヘルプデスクの Plan-and-Execute は、計画をコードが実行する構造で、**単一エージェントのループを分割する形**です。同じ問い合わせを、検索ツールを持つ単一のエージェント 1 つで解く設計もありえます。計画を立てて実行を分けるのは、その単純な設計より複雑です。
- **対応**: 教材の対象として要件が求める構成です（Req 2.1〜2.3）。そこで、複雑さを次の3点で抑えます。(a) タスクの実行にだけ `createGuardedAgent` を使い、他はコードにする（ADR-9）。(b) ステップ数に上限を設ける（CL-14、既定 12）。(c) 人が承認時に確認する。
- **⚠ 1 との違い**: ⚠ 1 は Supervisor（3-4）と合議（3-6）のマルチエージェント構成で、憲章 v1.1.0 の例外により、単一エージェントとの**トークン使用量の比較の実測を解説に記録**することが求められます。⚠ 2 の記録には、その比較の義務は付いていません。
- **単一エージェントとの比較は測っていません。** W8 の評価（[research.md の「W8 の実測」](../../specs/003-domain-agents/research.md)）は、高水準ツールの比較、修正ループ、階層型リサーチ、合議を対象にし、ヘルプデスクの Plan-and-Execute と単一エージェントのトークン比較は含みません。したがって、「計画を立てると単一エージェントより効く（または高くつく）」とは、このモジュールでは言えません。自分の環境で比べる方法は、ハンズオンの手順 4 に書きました。

## ハンズオン手順

### 手順 1: 画面でヘルプデスクを動かす

- 実行モード: `mock`（完走する）
- 外部サービス: なし（`mock` はインメモリの PGlite を使い、同梱の FAQ を知識ベースに投入する）

```text
mise run dev    # http://localhost:3000/helpdesk を開く
```

サンプルの問い合わせを送り、「現在のタスク」が `pending` → `running` → `done` と変わること、判断（`continue` など）と理由が出ることを確かめます。`mock` の応答は固定なので、品質の評価には使えません。

### 手順 2: サンプルを投入して `local` で動かす

- 実行モード: `local`（Ollama）。`live` でも動く
- 外部サービス: Ollama の起動と、`catalog: local.ollama.chat` と `catalog: local.ollama.embedding` のモデルの取得。Docker の Postgres（`mise run services:up:db`）。`live` は選んだプロバイダの API キー

```text
mise run services:up:db   # Compose の Postgres を起動する
mise run seed:samples     # FAQ・手順書とサンプルのチケットを投入する（冪等。--reset でヘルプデスクの表を空にしてから）
AI_RUN_MODE=local mise run dev
```

`mock` では `seed:samples` はプロセスの終了とともに消えるインメモリの DB に投入するだけで、動作の確認用です。`local` と `live` では、投入した FAQ は学習者の文書と同じ知識ベースに入ります（`kb:` の名前空間を共有します）。

### 手順 3: 不正な計画と再計画を観察する

- 実行モード: `mock`
- 外部サービス: なし

`packages/ai-core/fixtures/helpdesk/plans/` の、循環・存在しない依存・空の計画のフィクスチャと、`packages/ai-core/src/helpdesk/helpdesk.test.ts` の「invalid plan」と「replanning」のテストを読みます。再生成の回数と、`escalated` になる条件を、自分の言葉で説明してください。続けて `helpdesk_plan_revisions` の版と差分を、`GET /api/helpdesk/tickets/[id]` の `revisions` で読みます。

```text
mise run test    # helpdesk のテストを含む。DB のテストは PGlite で動く
```

### 手順 4: 単一エージェントとのトークン使用量を比べる（任意）

- 実行モード: `local` / `live`
- 外部サービス: Ollama または API キー

同じ問い合わせを `/helpdesk` と、検索ツールを持つ単一エージェントの `/agent`（M1。ツールの構成は違う）に渡し、それぞれのトークン使用量を読みます。**このリポジトリは比較を測っていません**。タスクの数、ツールの数、モデルで結果が変わるので、自分の環境の数字で、計画を立てる費用が見合うかを判断してください。

## 習熟度判定チェックリスト

自動テストで確かめられる項目にはテストへの参照があります。このモジュールの参照は、すべて `mock` で実行される gate のテスト（PGlite を使う `*.db.test.ts` を含む）で、`local` / `container` / `pg` 専用のテストを参照する項目はありません。Ollama や Docker の Postgres を使う実行は、gate の外にあり、このチェックリストでは確かめません。

- [ ] 問い合わせから計画を作り、依存順にタスクを実行し、タスクごとに判断し、回答して `resolved` にする <!-- test: packages/ai-core/src/helpdesk/helpdesk.test.ts#plans, runs the tasks in dependency order, asks after each task, answers and resolves -->
- [ ] 依存の循環を、循環上のタスクとともに検出する <!-- test: packages/ai-core/src/helpdesk/plan-schema.test.ts#reports a cycle with the tasks on it -->
- [ ] 存在しないタスクへの依存を、両方の ID を挙げて検出する <!-- test: packages/ai-core/src/helpdesk/plan-schema.test.ts#reports a dependency on a task that does not exist, naming both ids -->
- [ ] 空の計画を検出する <!-- test: packages/ai-core/src/helpdesk/plan-schema.test.ts#reports an empty plan -->
- [ ] 不正な計画は 2 回再生成し、それでも不正ならチケットを `escalated` にして、何も実行しない <!-- test: packages/ai-core/src/helpdesk/helpdesk.test.ts#regenerates twice, then escalates the ticket with a reason and runs nothing -->
- [ ] スケジューラは、リストの並びではなく依存順に従う <!-- test: packages/ai-core/src/helpdesk/scheduler.test.ts#follows dependency order, not list order -->
- [ ] 依存先が一部しか完了していないタスクは、返さない <!-- test: packages/ai-core/src/helpdesk/scheduler.test.ts#does not return a task whose dependency is only partly done -->
- [ ] `finish` では、残りのタスクを実行せずに最終回答へ進む <!-- test: packages/ai-core/src/helpdesk/helpdesk.test.ts#finishes early on `finish` without running the remaining tasks -->
- [ ] `replan` では、残りを再生成し、差分と理由を版として記録し、再計画を 1 ステップに数える <!-- test: packages/ai-core/src/helpdesk/helpdesk.test.ts#regenerates the rest, records the revision with its diff and reason, and counts the replan as a step -->
- [ ] 再計画で、完了したタスクとその ID を保つ <!-- test: packages/ai-core/src/helpdesk/replanner.test.ts#regenerates only the remaining tasks and keeps the completed task and its id -->
- [ ] 計画の差分は、追加と削除を ID で列挙する <!-- test: packages/ai-core/src/helpdesk/plan-schema.test.ts#lists added and removed ids -->
- [ ] 依存の並び替えだけでは、変更とみなさない <!-- test: packages/ai-core/src/helpdesk/plan-schema.test.ts#does not count a reordered dependency list as a change -->
- [ ] ステップ上限に達したら次のタスクを開始せず、チケットを `open` のまま、未完了のタスクを返す <!-- test: packages/ai-core/src/helpdesk/helpdesk.test.ts#does not start another task once the limit is reached, and leaves the ticket open with the unfinished tasks -->
- [ ] ステップ上限の既定は 12 である <!-- test: packages/ai-core/src/helpdesk/helpdesk.test.ts#uses the default limit of 12 -->
- [ ] モデルが解決できないと判断したら、理由を記録して `escalated` にする <!-- test: packages/ai-core/src/helpdesk/helpdesk.test.ts#escalates with the model's own reason when it cannot resolve the inquiry (Req 2.7) -->
- [ ] 認証情報の形がある回答は保存せず、1 回作り直させて、清潔な回答を保存する <!-- test: packages/ai-core/src/helpdesk/helpdesk.test.ts#does not store or show an answer with a credential shape: it asks once more, and saves the clean one -->
- [ ] 作り直しても認証情報の形が残る場合は `escalated` にし、値を行・イベント・結果に残さない <!-- test: packages/ai-core/src/helpdesk/helpdesk.test.ts#escalates when the re-created answer still has a credential shape, and keeps the value out of the row, the events and the outcome -->
- [ ] 再設定のリンクの案内は、認証情報とみなさない <!-- test: packages/ai-core/src/helpdesk/helpdesk.test.ts#answers a password-reset question with a link, which is guidance and not a credential -->
- [ ] 認証情報の検出は、値ではなく種別の名前だけを返す <!-- test: packages/ai-core/src/helpdesk/credentials.test.ts#never returns the value, only the kind names -->
- [ ] `helpdesk/` でエージェントのループを作るのは `run.ts` だけである <!-- test: packages/ai-core/src/helpdesk/helpdesk.test.ts#only run.ts creates an agent loop in helpdesk/ -->
- [ ] タスクの実行は、ナレッジ検索（読み取り）の 1 つだけをツールに持つ <!-- test: packages/ai-core/src/helpdesk/run.test.ts#registers the knowledge search and nothing else (read-only, one tool) -->
- [ ] 規則 `workflow-no-agent-loop` は、ヘルプデスクの対象ファイルだけを走査して数える <!-- test: scripts/check-repo-rules.test.mjs#scans only the listed files that exist and counts them -->
- [ ] チケットの ID は `T-0001`、`T-0002` と、最大の番号から決定論的に採番される <!-- test: packages/ai-core/src/helpdesk/ticket-store.db.test.ts#numbers tickets T-0001, T-0002 … from the largest existing number -->
- [ ] 計画の版は追記だけで、以前の版を変更しない <!-- test: packages/ai-core/src/helpdesk/ticket-store.db.test.ts#appends numbered revisions and never changes an earlier one -->
- [ ] 初期投入は冪等で、2 回目に行を足さない <!-- test: packages/ai-core/src/helpdesk/seed.db.test.ts#is idempotent: a second run adds no row -->
- [ ] 問い合わせから計画、実行、判断を経て、解決したチケットと回答が保存される（回帰） <!-- test: packages/eval-suite/tests/regression/helpdesk-plan.db.test.ts#resolves: runs the planned tasks in dependency order and saves the answer on the ticket -->
- [ ] 解決できない問い合わせは、理由が保存され、回答は保存されない（回帰） <!-- test: packages/eval-suite/tests/regression/helpdesk-plan.db.test.ts#escalates: records the unresolved reason on the ticket and saves no answer -->
- [ ] 計画を立てることと、単一エージェントで直接解くことのトークン使用量の違いを、自分の環境で比べて説明できる（手で確かめる）
- [ ] ADR-9 と憲章の⚠ 2 を、自分の言葉で説明できる（手で確かめる）

## リファレンス実装とテストの所在

| 項目 | パス |
|---|---|
| 計画・差分のスキーマ、`validatePlan`、`diffPlan` | `packages/ai-core/src/helpdesk/plan-schema.ts` |
| スケジューラ `nextRunnable` | `packages/ai-core/src/helpdesk/scheduler.ts` |
| 計画の生成（検査と再生成） `planTasks` | `packages/ai-core/src/helpdesk/planner.ts` |
| 判断と再計画 `decideNext` | `packages/ai-core/src/helpdesk/replanner.ts` |
| タスクの実行 `runTask`（唯一の `createGuardedAgent`） | `packages/ai-core/src/helpdesk/run.ts` |
| 全体の制御 `runHelpdesk` | `packages/ai-core/src/helpdesk/helpdesk.ts` |
| 認証情報の形状検査 `detectCredentialShapes` | `packages/ai-core/src/helpdesk/credentials.ts` |
| チケットと計画の版 `createTicketStore` | `packages/ai-core/src/helpdesk/ticket-store.ts`、マイグレーション `packages/ai-core/drizzle/0002_helpdesk.sql` |
| 初期投入 `seedHelpdesk` | `packages/ai-core/src/helpdesk/seed.ts`、`scripts/seed-samples.ts`（`mise run seed:samples`） |
| フィクスチャ | `packages/ai-core/fixtures/helpdesk/`（FAQ、チケット、不正な計画の例） |
| Route Handler | `apps/web/app/api/helpdesk/route.ts`、`apps/web/app/api/helpdesk/tickets/` |
| 画面 | `apps/web/app/helpdesk/page.tsx`、`apps/web/components/helpdesk/` |
| 回帰テスト | `packages/eval-suite/tests/regression/helpdesk-plan.db.test.ts` |
| E2E | `apps/web/e2e/helpdesk.spec.ts` |
| テスト | 各ファイルの隣の `.test.ts`、`*.db.test.ts` |

## 元教材との対照表

| 元教材（Python / LangChain / LangGraph）の対応箇所 | TypeScript / AI SDK 版での置き換え | 移植で諦めたもの |
|---|---|---|
| 第4章 ヘルプデスク: Planner のノード | `planTasks`（`generateValidated` + `validatePlan`、問題をフィードバックして再生成） | LangGraph の `StateGraph` による定義 |
| Executor のノード（ツールを使うエージェント） | `runTask`（`createGuardedAgent`、ナレッジ検索の 1 ツール） | ツールの多さ（マニュアル検索と過去の QA 検索の 2 系統を、ナレッジ検索 1 つにまとめた） |
| Replanner のノードと条件付きエッジ | `decideNext`（`continue` / `replan` / `finish` の構造化出力）と `runHelpdesk` の `for` ループ | 状態の reducer、checkpointer、`interrupt` による耐久的な中断と再開 |
| 進捗のダッシュボード | `data-helpdesk-plan` / `data-helpdesk-progress` / `data-helpdesk-result` のストリームと `/helpdesk` | LangGraph Studio による可視化 |
| ベクトル検索 | pgvector + RRF（M2 の `rag/`）に統一 | 元教材の別のベクトルストア |

## 移植時の変更点

[changes-from-drafts.md](../../specs/curriculum/changes-from-drafts.md) に記録された変更のうち、このモジュールに関わるものと、実装時に確定したことです（Req 7.4）。採用したモデルはモデル ID ではなくカタログへの参照で示します（計画・判断・タスクの実行・回答は、すべて用途 `chat` の 1 つのモデルです。`local` なら `catalog: local.ollama.chat`）。

- **計画をコードが実行します。** LangGraph のグラフ定義ではなく、`runHelpdesk` の制御フローです（ADR-9）。ノードの間の状態は変数と戻り値で、チケットの状態と計画の版だけを DB に永続化します（ADR-10、CL-6）。
- **不正な計画の検査は、スキーマではなく `validatePlan` に置きました。** 空の計画、タスク数の超過、ID の重複、説明の中の認証情報の形も、循環と同じ経路（フィードバックして再生成 → 上限で `escalated`）に乗せるためです。
- **ステップの数え方は CL-14 です。** タスクの実行 1 回と、計画・再計画の生成 1 回が 1 ステップです。上限は `escalated` ではなく `open` + `stopped_reason` です。
- **タスク ID は再計画をまたいで保ちます**（CL-13）。差分が ID で取れるのはこのためです。
- **ID の採番は決定論的です。** 乱数と時刻を使わず、最大の番号に 1 を足します。競合したら新しいトランザクションで再試行します。
- **`mock` の検索は、上位 k 件をそのまま返します。** `mock` の埋め込みは疑似乱数で、既定の類似度（0.5）では検索が常に空になり、サンプルの問い合わせがすべて根拠なしで `escalated` になるためです。`local` / `live` は既定のままです。

## 本番ではどう作るか

本リポジトリの実装は学習用で、本番の判断と運用はハブ `vaz-agentic-ai-next` の手法ページにあります（文書の転載はしません。確認日 2026-10-29）。

- LE（ループとワークフローの設計）: [`loop-engineering.md`](https://github.com/Fukuchan77/vaz-agentic-ai-next/blob/main/docs/guide/loop-engineering.md)
- AE（エージェンティックエンジニアリング）: [`agentic-engineering.md`](https://github.com/Fukuchan77/vaz-agentic-ai-next/blob/main/docs/guide/agentic-engineering.md)

本リポジトリのヘルプデスクは、プロセス内の関数として 1 回の実行で完結します。次は扱いません（[005 Req 1.3](../../specs/005-hub-alignment/spec.md)）。

- 認証・RBAC（チケットは単一の学習者のものとして扱い、行の共有はありません）
- 承認待ちの永続化と再開、ジョブの耐久実行（上限で止まったチケットを後から再開する仕組みは持ちません）
- 本番の監査ログの保管

## 確認できていないこと

`mise run gate` が保証しないこと、実測していないことです。

- **実際のモデルでの Plan-and-Execute の品質は測っていません。** ヘルプデスクの `local` / `live` の評価（計画の質、再計画の妥当性、回答の正しさ）は、W8 の評価に含まれていません。gate のテストは `mock` のシナリオで配管を確かめるだけで、モデルが良い計画を作るかは確かめません。
- **単一エージェントとのトークン使用量の比較は未実施です**（憲章 原則 1 の⚠ 2。上記の記録を参照）。
- **チケット ID の採番の競合は、実際の並行書き込みでは未検証です**（W3 F-15）。「並行する作成が一意になる」テストは PGlite（単一の接続）で動くので、Postgres に複数の接続から同時に書く状況を再現していません。競合時の再試行は、衝突を差し込んだテストで確かめているだけです。`*.pg.test.ts`（`mise run test:db`）はこの用途のテストを持ちません。
- **計画の版が追記だけであることは、API 上の保証であり、DB の trigger ではありません**（W3 F-5）。`ticket-store.ts` に更新の経路はありませんが、SQL を直接書けば版を書き換えられます。
- **検出した認証情報の種別は、DB に残りません**（W3 F-12）。ストリームとログにだけ出るので、後から「どのチケットで何が検出されたか」を DB で調べることはできません。
- **ヘルプデスク全体の時間・トークンの予算はありません**（W3 F-20）。上限があるのは、ステップ数（既定 12）と、タスクごとの停止条件（ステップ、トークン、時間）です。計画・判断・最終回答の構造化出力の呼び出しは、タスクの予算の外にあります。
- **すべての文書名をプランナーに渡します**（W3 F-21）。ナレッジが大きくなると、プロンプトが長くなります。
- **投入した FAQ は、学習者の文書と `kb:` の名前空間を共有します**（W3 F-9）。
- **停止したチケットは、API の上では後から完了できます**（W3 F-22）。「再開は行わない」という方針とは、実行を再開しないという意味でだけ整合します。
- **認証情報の検出はパターンの検査で、完全ではありません。** ラベルの後ろに値が続く形と、固有の接頭辞の形だけを見ます。ラベルのない任意の文字列や、文章に溶け込んだ形は検出できません。
- **ブラウザの切断で実サーバーの `request.signal` が abort されるかは、実サーバーでは未確認です**（W4 F-21、W7 F-11 の続き）。テストは、モックのサンドボックスが速すぎて観測できません。
- **Docker の Postgres での `0002_helpdesk.sql` と `seed:samples` の 2 回実行は、gate では確かめていません。** `mise run test:db` と手動のハンズオンで確かめます。

## 完成時点のタグ

- **タグ**: `module/3-2`
- **含まれるもの**: `helpdesk/` の計画・検査・スケジューラ・Replanner・差分・チケットのストア・認証情報の形状検査・初期投入、`/api/helpdesk` と `/helpdesk` 画面、`mock` のシナリオ、回帰テスト、この解説
- **含まれないもの**: 実際のモデルでの計画の品質評価、単一エージェントとのトークン比較、承認待ちの永続化と再開、ジョブの耐久実行
