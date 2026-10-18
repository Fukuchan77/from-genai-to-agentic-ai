# domain-agents（Milestone 3）— 実装タスク W3: ヘルプデスク（大タスク 12〜16）

未着手の波。表記規約、ID 対応表、進捗、gate への段階的な結線、共有ファイルの編集者は [tasks.md](tasks.md) を参照する。

計画・再計画・判断のワークフロー、スケジューラ、認証情報の形状検査、チケットストア、`0002_helpdesk.sql`、初期投入、`/api/helpdesk*`、`m3-2` のシナリオを作る。
計画・再計画・判断は構造化出力のワークフローで、`ToolLoopAgent` と `createGuardedAgent` を import しない（ADR-9）。`createGuardedAgent` を使うのは `helpdesk/run.ts` のタスク実行だけ。

12.1・12.3 は並列に進められる。12.4・12.5 は 12.1 の後に並列に進められる。13.1 は 12.x と独立に進められる。15.4 は 15.2 の後に 15.3 と並列に進められる。

---

## 12. 計画・スケジューラ・判断の部品（C10）

計画の検査、差分、スケジューラ、認証情報の形状検査、計画・再計画・タスク実行を、純関数とワークフローとして作る。

_Boundary:_ `packages/ai-core/src/helpdesk/plan-schema.ts`, `packages/ai-core/src/helpdesk/plan-schema.test.ts`, `packages/ai-core/src/helpdesk/scheduler.ts`, `packages/ai-core/src/helpdesk/scheduler.test.ts`, `packages/ai-core/src/helpdesk/credentials.ts`, `packages/ai-core/src/helpdesk/credentials.test.ts`, `packages/ai-core/src/helpdesk/planner.ts`, `packages/ai-core/src/helpdesk/planner.test.ts`, `packages/ai-core/src/helpdesk/replanner.ts`, `packages/ai-core/src/helpdesk/replanner.test.ts`, `packages/ai-core/src/helpdesk/run.ts`, `packages/ai-core/src/helpdesk/run.test.ts`, `packages/ai-core/fixtures/helpdesk/plans/*.json`
_Depends:_ 2.1, 3.3, 5.2
_Requirements:_ 2.1, 2.2, 2.3, 2.4, 2.8, 2.10
_Traces:_ REQ-002, C10, C15, ADR-9

- [ ] 12.1 (P) `helpdesk/plan-schema.ts` と `fixtures/helpdesk/plans/{cycle,missing-dependency,empty,valid}.json`: `Plan`・`PlanDiff` の Zod スキーマ（タスク ID は計画内で一意、1〜8 タスク）、`validatePlan`（`cycle`、`missing-dependency`、`empty` を返す純関数）、`diffPlan(before, after)`（`added`・`removed`・`changed` の ID 一覧。同じ ID で説明か依存が変わったものが `changed`。CL-13）を作る + `plan-schema.test.ts` に、循環（自己依存を含む）、存在しない依存、空の計画、9 タスク、差分の追加・削除・変更・変更なし、ID の保持を先に書く
  _Boundary:_ `packages/ai-core/src/helpdesk/plan-schema.ts`, `packages/ai-core/src/helpdesk/plan-schema.test.ts`, `packages/ai-core/fixtures/helpdesk/plans/*.json`
  _Depends:_ none
  _Requirements:_ 2.1, 2.3, 2.10
  _Traces:_ REQ-002, C10, C15, CL-13
- [ ] 12.2 `helpdesk/scheduler.ts`: `nextRunnable(plan, completed)` が、依存が全て完了しているタスクの先頭を返し、依存未完了のタスクを返さない純関数を作る + `scheduler.test.ts` に、依存順、複数の実行可能なタスクから先頭、全完了で `undefined`、依存が未完了のものだけが残るときの `undefined` を先に書く
  _Boundary:_ `packages/ai-core/src/helpdesk/scheduler.ts`, `packages/ai-core/src/helpdesk/scheduler.test.ts`
  _Depends:_ 12.1
  _Requirements:_ 2.2
  _Traces:_ REQ-002, C10
- [ ] 12.3 (P) `helpdesk/credentials.ts`: `detectCredentialShapes(text)` が、平文のパスワード、一時パスワード、API キー、アクセストークンの形状の種別だけを返す（値は返さない）純関数を作る + `credentials.test.ts` に、各種別の検出、日本語の文脈（「パスワードは」「仮パスワード:」など）、検出しない通常の文、値が戻り値に含まれないことを先に書く。検査の例の値は実在しない明らかな偽の値にする
  _Boundary:_ `packages/ai-core/src/helpdesk/credentials.ts`, `packages/ai-core/src/helpdesk/credentials.test.ts`
  _Depends:_ none
  _Requirements:_ 2.8
  _Traces:_ REQ-002, C10
- [ ] 12.4 (P) `helpdesk/planner.ts`: `planTasks({ model, ticket, knowledge, feedback?, signal })` が `generateValidated` で計画を作り、`validatePlan` が問題を返したら問題点を付けて再生成する（上限 `maxPlanRegenerations`、既定 2。超えたら呼び出し側が `escalated` にできるよう、不正の内容を結果で返す）。`ToolLoopAgent` を import しない + `planner.test.ts` に、正常な計画、循環・存在しない依存・空のフィードバック付き再生成、再生成 2 回で止まること、中断で後続の LLM 呼び出しが始まらないことを先に書く
  _Boundary:_ `packages/ai-core/src/helpdesk/planner.ts`, `packages/ai-core/src/helpdesk/planner.test.ts`
  _Depends:_ 12.1
  _Requirements:_ 2.1, 2.10
  _Traces:_ REQ-002, C10, ADR-9
- [ ] 12.5 (P) `helpdesk/replanner.ts`: `decideNext({ model, plan, completed, lastResult, signal })` が `continue` / `replan` / `finish` を判断理由とともに構造化出力で返す。`replan` では残りのタスクだけを再生成し、完了済みタスクの ID を保ち、`validatePlan` を通す（通らなければ 12.4 と同じ再生成）。`ToolLoopAgent` を import しない + `replanner.test.ts` に、3 値それぞれ、再計画で完了済み ID が保たれること、不正な再計画の再生成、構造化出力が壊れたときの再生成を先に書く
  _Boundary:_ `packages/ai-core/src/helpdesk/replanner.ts`, `packages/ai-core/src/helpdesk/replanner.test.ts`
  _Depends:_ 12.1
  _Requirements:_ 2.3
  _Traces:_ REQ-002, C10, ADR-9, CL-13
- [ ] 12.6 `helpdesk/run.ts`: `runTask({ task, knowledge, model, observer, signal })` が `createGuardedAgent` でタスクを実行する。ツールはナレッジ検索（M2 の `createSearchKnowledgeBaseTool`）の読み取りだけ。結果は `TaskResult`（`summary` 600 文字以内、`sources`）で返し、失敗は回復可能なら結果に失敗を記録して返す + `run.test.ts` に、検索ツールだけが登録されること、要約の長さ上限、失敗の記録、停止理由が `createGuardedAgent` の語彙で返ることを先に書く
  _Boundary:_ `packages/ai-core/src/helpdesk/run.ts`, `packages/ai-core/src/helpdesk/run.test.ts`
  _Depends:_ 12.1, 3.3, 5.2
  _Requirements:_ 2.2, 2.4
  _Traces:_ REQ-002, C10

### Implementation Notes

---

## 13. DB と永続化（C10、C15）

チケットと計画の改訂を DB に保存する。マイグレーションは `0002_helpdesk.sql`、`reset` は M3 の表だけを空にする。

_Boundary:_ `packages/ai-core/drizzle/0002_helpdesk.sql`, `packages/ai-core/src/rag/db/schema.ts`, `packages/ai-core/src/rag/db/schema.db.test.ts`, `packages/ai-core/src/rag/db/client.pg.test.ts`, `packages/ai-core/src/helpdesk/ticket-store.ts`, `packages/ai-core/src/helpdesk/ticket-store.db.test.ts`, `packages/ai-core/src/helpdesk/seed.ts`, `packages/ai-core/src/helpdesk/seed.db.test.ts`, `packages/ai-core/fixtures/helpdesk/faq/*.md`, `packages/ai-core/fixtures/helpdesk/tickets.json`, `scripts/seed-samples.ts`, `mise.toml`
_Depends:_ 12.1
_Requirements:_ 2.1, 2.3, 2.4, 2.6, 2.7, 2.8, 2.9
_Traces:_ REQ-002, C10, C15, C16, ADR-10

- [ ] 13.1 `drizzle/0002_helpdesk.sql` と `rag/db/schema.ts`: `helpdesk_tickets`（`status` と `answer` / `escalation_reason` / `stopped_reason` の組み合わせの CHECK 制約）と `helpdesk_plan_revisions`（`(ticket_id, revision)` の主キー、`revision = 0` のとき `diff` が NULL の CHECK、`ON DELETE CASCADE`）を作り、Drizzle のスキーマを広げる。SQL に `now()` を書かず、`CREATE EXTENSION` を足さない + `schema.db.test.ts` に、適用後の `information_schema.columns` との照合に M3 の表を足し、CHECK 制約（矛盾する組み合わせの拒否）を先に書く。`client.pg.test.ts`（Boundary の例外 (4)）に、`0002` を既存の `runMigrations` で実 Postgres に適用できる 1 ケースを足す
  _Boundary:_ `packages/ai-core/drizzle/0002_helpdesk.sql`, `packages/ai-core/src/rag/db/schema.ts`, `packages/ai-core/src/rag/db/schema.db.test.ts`, `packages/ai-core/src/rag/db/client.pg.test.ts`
  _Depends:_ none
  _Requirements:_ 2.6, 2.7
  _Traces:_ REQ-002, C10, ADR-10
  _Verify:_ `mise run gate` が PGlite で成功する。`mise run test:db`（Docker Postgres）で `0002` の適用が成功する（Docker が無ければ人が実行する）
- [ ] 13.2 `helpdesk/ticket-store.ts`: `createTicketStore(db)` の `create`（`T-` + 4 桁の連番を最大値から決定論的に採番し、衝突時はトランザクション内で再試行）、`setStatus`（`open` → `resolved` / `escalated` のみ。戻る遷移をストアと CHECK の両方で拒否）、`recordRevision`（追記のみ）、`get`、`list`（新しい順、50 件まで）を作る。`created_at` / `updated_at` は `Clock` から設定する + `ticket-store.db.test.ts` に、採番の決定論、状態遷移と戻る遷移の拒否、`resolved` の回答保存と `escalated` の理由、`stopped_reason`（`step-limit` / `aborted`）、改訂の追記と更新の拒否、`reset` が M3 の表だけを空にして `rag_*` を消さないことを先に書く
  _Boundary:_ `packages/ai-core/src/helpdesk/ticket-store.ts`, `packages/ai-core/src/helpdesk/ticket-store.db.test.ts`
  _Depends:_ 13.1, 12.1
  _Requirements:_ 2.1, 2.3, 2.4, 2.6, 2.7, 2.8
  _Traces:_ REQ-002, C10, CL-6, CL-14
- [ ] 13.3 `helpdesk/seed.ts` と `fixtures/helpdesk/{faq/*.md,tickets.json}`: `seedHelpdesk({ db, knowledge })` が冪等な初期投入を行う（FAQ・手順書は M2 の取り込みを使い、過去チケットは `tickets.json` から）。`reset` 引数は M3 の表だけを空にする。FAQ は日本語で見出し構造を持つ + `seed.db.test.ts` に、2 回実行しても行が増えないこと、`reset` の範囲、FAQ の取り込み失敗が M2 の `skipped` と同じ扱いになることを先に書く
  _Boundary:_ `packages/ai-core/src/helpdesk/seed.ts`, `packages/ai-core/src/helpdesk/seed.db.test.ts`, `packages/ai-core/fixtures/helpdesk/faq/*.md`, `packages/ai-core/fixtures/helpdesk/tickets.json`
  _Depends:_ 13.2
  _Requirements:_ 2.9
  _Traces:_ REQ-002, C10, C15
- [ ] 13.4 `scripts/seed-samples.ts`（`seedHelpdesk` を呼ぶ入口。Node 26 の型除去で直接起動する）と、`mise.toml` のタスク `seed:samples` を作る。マーケティングの投入は 27.9 が足す
  _Boundary:_ `scripts/seed-samples.ts`, `mise.toml`
  _Depends:_ 13.3
  _Requirements:_ 2.9
  _Traces:_ REQ-002, C16, CL-3
  _Verify:_ `mise run seed:samples` を 2 回実行しても投入件数が増えない（PGlite または Docker Postgres）。`mise tasks validate` が成功する

### Implementation Notes

---

## 14. runHelpdesk（C10）

計画 → 実行 → 判断の制御フローを、ステップの計数と最終回答の検査を含めて組み立てる。

_Boundary:_ `packages/ai-core/src/helpdesk/helpdesk.ts`, `packages/ai-core/src/helpdesk/helpdesk.test.ts`, `packages/ai-core/src/helpdesk/index.ts`
_Depends:_ 12.6, 13.2
_Requirements:_ 2.1, 2.2, 2.3, 2.4, 2.6, 2.7, 2.8, 2.10
_Traces:_ REQ-002, C10

- [ ] 14.1 `helpdesk/helpdesk.ts` と `helpdesk/index.ts`: `runHelpdesk` が、チケットを `open` で保存し（計画が検証を通った後に作る）、`planTasks` → `nextRunnable` → `runTask` → `decideNext` の順に進める。ステップは「タスクの実行 1 回と、計画・再計画の生成 1 回」を数え（CL-14）、上限（既定 12）に達したら未完了タスクの一覧を返してチケットを `open` のまま `stopped_reason = 'step-limit'` にする。再計画のたびに `diffPlan` で差分を `helpdesk_plan_revisions` に追記する。計画の再生成が上限（2 回）で直らなければ `escalated`（理由は計画の不正）。最終回答は `detectCredentialShapes` で検査し、検出時は保存も表示もせず種別だけを記録して 1 回再作成させ、再作成後も検出されたら `escalated`。解決なら `resolved` と回答を保存し、根拠がなければ `finish` で `escalated`（未解決の理由）。中断ではチケットを `open`・`stopped_reason = 'aborted'` にする。`index.ts` は `@platform/ai-core/helpdesk` の公開 API を再エクスポートする + `helpdesk.test.ts` に、依存順の実行、ステップ上限の境界（上限ちょうどで次を実行しない）、再計画の差分の記録、再生成 2 回での `escalated`、認証情報の形状で保存されないこと（再作成 1 回）、再作成後も検出で `escalated`、中断で後続の LLM 呼び出しが始まらないこと、`ToolLoopAgent` を計画に使っていないことを先に書く
  _Boundary:_ `packages/ai-core/src/helpdesk/helpdesk.ts`, `packages/ai-core/src/helpdesk/helpdesk.test.ts`, `packages/ai-core/src/helpdesk/index.ts`
  _Depends:_ 12.2, 12.3, 12.4, 12.5, 12.6, 13.2
  _Requirements:_ 2.1, 2.2, 2.3, 2.4, 2.6, 2.7, 2.8, 2.10
  _Traces:_ REQ-002, C10, CL-6, CL-14
  _Verify:_ 認証情報の形状の検査は、検出時に DB の行に回答が残らないことを `ticket-store` の `*.db.test.ts` 相当（PGlite）で確認する。`mise run gate` が成功する

### Implementation Notes

---

## 15. ヘルプデスクの HTTP 入口（C13 の一部、C15 の m3-2）

シナリオ、組み立て、ストリームの写像、`/api/helpdesk` と `/api/helpdesk/tickets*` を作る。

_Boundary:_ `packages/ai-core/fixtures/scenarios/m3-2.ts`, `packages/ai-core/src/models/gateway.ts`, `packages/ai-core/src/models/gateway.test.ts`, `packages/ai-core/src/mock/index.ts`, `packages/ai-core/src/mock/m3-scenarios.test.ts`, `apps/web/lib/server/platform.ts`, `apps/web/lib/server/platform.test.ts`, `apps/web/lib/server/domain-stream.ts`, `apps/web/lib/server/domain-stream.test.ts`, `apps/web/app/api/helpdesk/**`
_Depends:_ 14.1, 10.1, 10.2
_Requirements:_ 2.1, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.10
_Traces:_ REQ-002, C13, C15

- [ ] 15.1 `fixtures/scenarios/m3-2.ts`: ヘルプデスクの計画・再計画・タスク実行・判断・最終回答のシナリオ（`continue` / `replan` / `finish`、解決と未解決の両方）を作り、`gateway.ts` の `mock` 既定シナリオと `mock/index.ts` の集約に足す + `m3-scenarios.test.ts` の期待件数を更新して曖昧な一致がないことを確かめる
  _Boundary:_ `packages/ai-core/fixtures/scenarios/m3-2.ts`, `packages/ai-core/src/models/gateway.ts`, `packages/ai-core/src/models/gateway.test.ts`, `packages/ai-core/src/mock/index.ts`, `packages/ai-core/src/mock/m3-scenarios.test.ts`
  _Depends:_ 10.1, 14.1
  _Requirements:_ 2.1, 2.3
  _Traces:_ REQ-002, C15
- [ ] 15.2 `lib/server/domain-stream.ts`（作成。ヘルプデスクの写像）と `platform.ts`: `data-helpdesk-plan`（状態、`id: "plan"`）、`data-helpdesk-progress`（状態、`id: "progress"`）、`data-helpdesk-result`（イベント）への写像を作り、状態パートは同じ `id` で上書き、イベントは連番にする。`getHelpdeskStore()` を組み立てる + `domain-stream.test.ts` に、状態変化ごとにパートが書き出される順序と上書きの `id`、`credentialKinds` が種別だけで値を含まないことを先に書き、`platform.test.ts` に組み立てのテストを足す。DB に接続できない場合は 503 `provider-unavailable`（`mock` は PGlite のため発生しない）
  _Boundary:_ `apps/web/lib/server/domain-stream.ts`, `apps/web/lib/server/domain-stream.test.ts`, `apps/web/lib/server/platform.ts`, `apps/web/lib/server/platform.test.ts`
  _Depends:_ 10.2, 14.1
  _Requirements:_ 2.5, 2.6
  _Traces:_ REQ-002, C13
- [ ] 15.3 `POST /api/helpdesk`: `z.strictObject`（`inquiry` 1〜4000 文字、`modelId?`、`maxSteps?` 1〜30）を検査し（413 → 400 形式 → 400 件数・長さ → `live` のみ 429）、構造化出力に対応しないモデルとツール非対応のモデルを `capability-unsupported` で LLM を呼ぶ前に拒否し、`runHelpdesk` の進行を `data-helpdesk-*` として即時に書き出す（状態変化から 1 秒以内を満たす条件として、変化のたびにすぐ書き出すことを検査する）。完了時に `{ ticketId; status }` を返す。`request.signal` を伝播する + `route.test.ts` に、検査順、各拒否のコード、`mock` での完走（解決と未解決）、ステップ上限での `open`、計画が不正で再生成が尽きたときの `escalated`、中断、DB の行の確認を先に書く
  _Boundary:_ `apps/web/app/api/helpdesk/route.ts`, `apps/web/app/api/helpdesk/route.test.ts`
  _Depends:_ 15.1, 15.2
  _Requirements:_ 2.1, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.10
  _Traces:_ REQ-002, C13
- [ ] 15.4 (P) `GET /api/helpdesk/tickets`（クエリ `status?`、新しい順 50 件）と `GET /api/helpdesk/tickets/[id]`（チケットと `revisions`）を作る + `route.test.ts` に、状態の絞り込み、404 `invalid-request`、503、計画の改訂と差分の取得を先に書く
  _Boundary:_ `apps/web/app/api/helpdesk/tickets/route.ts`, `apps/web/app/api/helpdesk/tickets/route.test.ts`, `apps/web/app/api/helpdesk/tickets/[id]/route.ts`, `apps/web/app/api/helpdesk/tickets/[id]/route.test.ts`
  _Depends:_ 15.2
  _Requirements:_ 2.3, 2.6, 2.7
  _Traces:_ REQ-002, C13

### Implementation Notes

---

## 16. W3 の締め

_Boundary:_ `stryker.config.mjs`, `specs/003-domain-agents/research.md`
_Depends:_ 15.4
_Requirements:_ 2.2, 2.3, 2.10
_Traces:_ REQ-002, C16

- [ ] 16.1 `stryker.config.mjs` に `helpdesk/plan-schema.ts` と `helpdesk/scheduler.ts` を足す。`workflow-no-agent-loop` が `helpdesk/planner.ts`・`replanner.ts`・`helpdesk.ts` を走査し、`ToolLoopAgent` を import する違反例で落ちること（6.2 のテスト）を、実ファイルが揃った状態で `mise run check:repo-rules` により確認する
  _Boundary:_ `stryker.config.mjs`
  _Depends:_ 14.1, 6.2
  _Requirements:_ 2.2, 2.3, 2.10
  _Traces:_ REQ-002, C16
  _Verify:_ `mise run test:mutation` の対象に含まれ、閾値 70 を満たす。`mise run check:repo-rules` が成功する
- [ ] 16.2 W3 の gate を実測して記録する。`mise run gate` の成功を引用し、所要時間を research.md に追記する。追加した `*.db.test.ts` による gate の時間の増分も書く
  _Boundary:_ `specs/003-domain-agents/research.md`
  _Depends:_ 16.1
  _Requirements:_ 2.6
  _Traces:_ REQ-002, C16
  _Verify:_ `mise run gate` の成功と所要時間を research.md に記録した。W3 の敵対的レビューの記録が `.sdd/reviews/003-domain-agents-impl-w3-review-*.md` にある

### Implementation Notes
