# Plan Review: 001-agentic-ai-platform（2026-09-27、ラウンド 2）

- 対象: `specs/001-agentic-ai-platform/plan.md`、`research.md`（ラウンド 1 の指摘 P-1〜P-10 の反映後）
- 基準: `~/.claude/sdd/rules/plan-review.md`、`.sdd/memory/constitution.md` v1.0.1、`.sdd/steering/`（product / structure / tech）
- 判定: **GO（条件付き）**。CRITICAL はない。R2-1 と R2-2 は `/sdd-tasks` の前に plan へ反映することを推奨する
- ラウンド 1 の指摘: P-1〜P-10 はすべて plan に反映済みであることを確認した

## 指摘

### [HIGH] R2-1 中断・タイムアウト時にサマリを確定する経路が、AI SDK v7 の API と合っていない

- Where: C8 GuardedAgent「サマリの確定経路」3〜5、ADR-6、Req 6.2 / 6.3 / 6.5
- Problem: plan は、中断とタイムアウトのときに `onError`（`createAgentUIStreamResponse` のストリームエラー）でサマリを確定するとしている。`ai@7.0.113` の型定義を確認すると、次のとおりだった。
  - `ToolLoopAgentSettings` には `onAbort` も `onError` もない。コールバックは `onStart`、`onStepStart`、`onStepEnd`、`onEnd` など（`dist/index.d.ts:5237-5400`）。
  - `UIMessageStreamOptions.onError` は、エラーをストリームに載せる文言に変換する関数（`(error) => string`）である。中断はエラーとして扱われないので、中断では呼ばれない想定になる（`:2783`）。
  - 中断を受け取れるのは、UI ストリームの `onEnd({ isAborted, isCancelled? })`（`:2651-2672`）と、`streamText` の `onAbort`（`:3818`）である。
  - `messageMetadata` は `start` と `finish` でだけ呼ばれる（`:2748-2753`）。
- Impact: `aborted` と `timeout` の実行で、サマリが確定しない。そのため `done` が解決されず、`RunObserver.onRunEnd` も呼ばれない。004 のトレースと評価レポート（Req 6.5）はこの observer に接続する計画なので、そこで停止理由が失われる。サーバー側のタイムアウトでは、クライアントがまだ接続しているのに `finish` が送られない場合がある。この場合 UI には `timeout` が届かず、`aborted` と区別できない（Req 6.2）。`guarded-agent.test.ts` の「応答しない LLM 呼び出しが `timeout` になる」は、テストが確定経路を直接呼ぶなら通ってしまい、実経路の欠陥を見逃す可能性がある。
- Suggested fix:
  1. サマリの確定は、UI ストリームの `onEnd({ isAborted })` で行う。`isAborted` が true なら `abortSignal.reason` で `aborted` と `timeout` を分ける。正常終了の場合も同じ `onEnd` で確定する。こうすると終端のフックが1つになる。`createAgentUIStreamResponse` を使わない呼び出し元（テスト、CLI）のために、`abortSignal` の `abort` イベントでも確定する予備の経路を置き、1回だけ確定する規則は残す。
  2. エラーは `onError` の中で記録してから文言を返す。確定そのものは `onEnd` に任せる。
  3. UI への停止理由の配信は、`createAgentUIStream` を `createUIMessageStream` で包み、終端で `data-run-summary` パートを書き込む方式を検討する。`finish` のメタデータには頼らない。採否は research.md に I-2 の追記として記録する。
  4. `guarded-agent.test.ts` には、`createAgentUIStreamResponse` を実際に通して、中断とタイムアウトのそれぞれで `done` が解決することを検証するケースを加える。

### [HIGH] R2-2 `.sse` fixture との一致検査が、非決定的な値のために不安定になる

- Where: C19（fixture の生成と `route.test.ts` の一致検査）、C13 `lib/server/platform.ts`、NFR 決定性
- Problem: `route.test.ts` は gate で実行される。そこで、Route Handler の出力が生成済みの `.sse` と一致するかを検査する。しかし出力には、実行ごとに変わる値が含まれる。具体的には、メッセージ ID（`generateMessageId` を注入しないと生成されない、または乱数になる）、ツール呼び出し ID、`AgentRunSummary.elapsedMs`（`platform.ts` が `systemClock` を組み立てる）である。
- Impact: gate が決定的でなくなる（10 回連続で同じ合否という NFR と constitution 原則 3 に反する）。あるいは、一致検査を緩めた結果として fixture のずれを見逃す。
- Suggested fix: Route Handler の依存（`Clock`、`generateMessageId`、ID 生成器）を `platform.ts` から注入できるようにする。`route.test.ts` と `generate-sse-fixtures.mjs` では、fake Clock と固定の ID 生成器を使う。シナリオのツール呼び出しには固定の `toolCallId` を持たせる。そのうえで、比較の前に SSE を正規化する規則（どのフィールドを伏せるか）を C19 に明記する。

### [MEDIUM] R2-3 `mock` モードの Web アプリが、シナリオをどこから読み込むかが決まっていない

- Where: C6 `GatewayDeps`、C7、`packages/ai-core/package.json#exports`、C19 `real-server.spec.ts`
- Problem: `next start`（`AI_RUN_MODE=mock`）で動く `real-server.spec.ts` と `generate-sse-fixtures.mjs` は、ゲートウェイがシナリオ一覧を持っていることを前提にしている。ところが `GatewayDeps` の中身は定義されていない。`packages/ai-core/fixtures/` はサブパスの `exports` に含まれていない。本番のバンドルに fixture を入れるかどうかも書かれていない。
- Impact: 実装時に、深いパスの import（structure.md の規約違反）や、fixture が本番ビルドに混入する形で場当たり的に解決されるおそれがある。
- Suggested fix: `GatewayDeps` に `scenarios?: readonly ScenarioDefinition[]` と `cassettes?: CassetteStore` を明記する。M1 のシナリオを公開するサブパス（例: `@platform/ai-core/fixtures`）を `exports` に追加する。`platform.ts` は `mode === "mock"` のときだけ、そのサブパスを動的 import する。これで `mock` 以外のモードでは fixture を読み込まない。

### その他（1行ずつ）

| ID | 重大度 | 指摘 |
|---|---|---|
| R2-4 | LOW | Constitution Compliance 表のステアリング行が「⚠️ 未作成」のままになっている。`.sdd/steering/` は作成済みなので ✅ に更新する |
| R2-5 | LOW | Data Model に「fixture は JSON で保存する」とあるが、シナリオは `fixtures/scenarios/m1-2.ts`（TS。カタログの定数を import する）である。記述を「シナリオは TS、カセット・HTTP・字幕は JSON」に直す |
| R2-6 | LOW | `requestKey()` がモデル ID をキーに含めないため、同じプロンプトを別のモデルで録画するとカセットが衝突する。キーに `modelId` を含めるか、含めない理由を ADR-5 に書く |
| R2-7 | LOW | `check:model-ids` の接頭辞照合（`llama`、`mistral`、`gemma` 等）が、解説の本文にある製品名（例: 「Llama 系モデル」）を誤検知する。照合対象を ID の形（例: `llama3.2:3b`、`claude-…-\d`）の字句に限定し、誤検知のテストを `check-model-ids.test.mjs` に加える |
| R2-8 | LOW | `no-sensitive-logging` 規則の識別子名 `input` は範囲が広すぎて誤検知が多くなる。`toolInput` / `args` などに絞るか、違反を例外扱いにする注記の書式を定める |
| R2-9 | LOW | `instrumentation.ts#register` で例外を投げても、`next start` が起動を止めるとは限らない（Req 1.9）。足場づくりのタスクで挙動を実測し、止まらない場合は `process.exit(1)` などの代替を決める |
| R2-10 | LOW | `latency.spec.ts`（100 ms 以内）は、CI の3エンジンで不安定になりやすい。gate の外なので決定性の NFR には影響しないが、再試行の方針（`retries` を使わず、計測を複数回行って中央値で判定する等）を C19 に書く |

## 評価できる点

- ラウンド 1 の 10 件がすべて、具体的なコンポーネント・テスト・検査規則に落とし込まれている（C20 の規則表、ADR-5 / ADR-6 の改訂、P-4 のための constitution 1.0.1）
- 後続 spec への契約表が明確で、M1 が型と拡張点だけを用意する範囲（原則 9）を守っている
- Req 1.1〜7.11 と NFR のトレーサビリティに欠けがない。「Does NOT own」が tasks の `_Boundary:_` として使える粒度になっている
- 版と API を `node_modules` の d.ts と公式ドキュメントで確認しており、未検証の組み合わせ（Turborepo × pnpm 12、Stryker × Vitest 5、WebKit）には後退先が決めてある

## 次の手順

1. R2-1 と R2-2 を plan.md の C8 / C19 / C13 と research.md の ADR-6 に反映する（R2-3〜R2-10 は同時に反映するか、tasks の注記に回す）
2. `/sdd-tasks agentic-ai-platform` でタスクを生成する（constitution 原則 9 により、承認は人間が行う）
