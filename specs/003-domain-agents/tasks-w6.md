# domain-agents（Milestone 3）— 実装タスク W6: 要件・マーケティング（大タスク 25〜28）

未着手の波。表記規約、ID 対応表、進捗、gate への段階的な結線、共有ファイルの編集者は [tasks.md](tasks.md) を参照する。

面接のワークフロー、要件定義書、合議（`onRoleOutput` の追加）、プロファイル、レコメンド、`0003_marketing.sql`、カタログ、初期投入、
`/api/requirements/*`、`/api/marketing/*`、`m3-5`・`m3-6` のシナリオを作る。ペルソナ、面接、モデレーター、プロファイル抽出は構造化出力の
ワークフローで、`ToolLoopAgent` と `createGuardedAgent` を import しない（ADR-9）。合議だけが `cooperateByRole`（M2）を使う。

25.1・26.1・26.4・26.6 は並列に進められる。27.5・27.6 と 27.7・27.8 はそれぞれ並列に進められる。

---

## 25. 要件インタビュー（C11）

概要からペルソナを作り、ペルソナの視点で固定の往復の面接を進め、回答から要件を抽出し、十分性を判定して、固定の章立ての Markdown を作る。

_Boundary:_ `packages/ai-core/src/requirements/**`
_Depends:_ 2.1, 4.1
_Requirements:_ 5.1, 5.2, 5.3, 5.4, 5.5, 5.6
_Traces:_ REQ-005, C11, ADR-9

- [ ] 25.1 (P) `requirements/session.ts`: 面接の状態（回答、要件、ラウンド数、完了の有無）の型と遷移の純関数を作る(CL-11)。回答が要件に結び付かないとき要件を変えない + `session.test.ts` に、ラウンドの進行、完了後の遷移の拒否、要件を変えない回答、上限到達の判定を先に書く
  _Boundary:_ `packages/ai-core/src/requirements/session.ts`, `packages/ai-core/src/requirements/session.test.ts`
  _Depends:_ none
  _Requirements:_ 5.3, 5.5
  _Traces:_ REQ-005, C11, CL-11
- [ ] 25.2 `requirements/personas.ts`: `generatePersonas({ model, overview, count })` が、想定利用者のペルソナを `generateValidated` で構造化出力として生成する（既定 3、`DEFAULT_INTERVIEW`、範囲 1〜5）。`ToolLoopAgent` を import しない + `personas.test.ts` に、件数の設定、構造化出力が壊れたときの再生成、3 回失敗で `output-invalid` になること、範囲外の件数の拒否を先に書く
  _Boundary:_ `packages/ai-core/src/requirements/personas.ts`, `packages/ai-core/src/requirements/personas.test.ts`
  _Depends:_ 25.1
  _Requirements:_ 5.1
  _Traces:_ REQ-005, C11
- [ ] 25.3 `requirements/interview.ts`: `askRound`（ペルソナごとの質問。不足項目があるときは不足項目に焦点を当てる）、`extractRequirements`（機能・非機能・制約・未確認事項を、各項目に出所のペルソナ ID を付けて抽出する。抽出に失敗したら直前の要件を保つ）、`judgeSufficiency`（`sufficient`・`missing`・`forcedEnd`。構造化出力の `sufficient` が真でも `missing` が空でなければ不十分、上限到達で `forcedEnd`）を作る。`ToolLoopAgent` を import しない + `interview.test.ts` に、不足項目への質問、雑談の回答で要件が変わらず未確認事項に足されること、`sufficient: true` かつ `missing` 非空を不十分とすること、上限未満での継続と上限到達の強制終了、抽出失敗時に直前の要件を保つことを先に書く
  _Boundary:_ `packages/ai-core/src/requirements/interview.ts`, `packages/ai-core/src/requirements/interview.test.ts`
  _Depends:_ 25.1, 25.2
  _Requirements:_ 5.2, 5.3, 5.4, 5.5
  _Traces:_ REQ-005, C11, ADR-9
- [ ] 25.4 `requirements/document.ts` と `requirements/index.ts`: `renderRequirementDocument(requirements, { forcedEnd, missing })` が固定の章立ての Markdown を作る純関数（上限到達の終了では「未確認事項」の章に `missing` を列挙し、`missing` が空なら「なし」と書く）。`index.ts` は `@platform/ai-core/requirements` の公開 API を再エクスポートする + `document.test.ts` に、固定の章立て、上限到達で未確認事項の章に不足項目が載ること、`missing` が空のとき「なし」、入力由来の文字がファイル名やヘッダーに影響しないこと（本文のみ）を先に書く
  _Boundary:_ `packages/ai-core/src/requirements/document.ts`, `packages/ai-core/src/requirements/document.test.ts`, `packages/ai-core/src/requirements/index.ts`
  _Depends:_ 25.1, 25.3
  _Requirements:_ 5.6
  _Traces:_ REQ-005, C11

### Implementation Notes

---

## 26. マーケティング合議とレコメンド（C12）

複数ペルソナのラウンドロビン合議を `cooperateByRole` で進め、ラウンドごとに合意を確定し、会話から利用者プロファイルを逐次更新し、カタログからだけレコメンドを選ぶ。

_Boundary:_ `packages/ai-core/src/patterns/role-based-cooperation.ts`, `packages/ai-core/src/patterns/role-based-cooperation.test.ts`, `packages/ai-core/drizzle/0003_marketing.sql`, `packages/ai-core/src/rag/db/schema.ts`, `packages/ai-core/src/rag/db/schema.db.test.ts`, `packages/ai-core/src/rag/db/client.pg.test.ts`, `packages/ai-core/fixtures/marketing/*.json`, `packages/ai-core/src/marketing/**`
_Depends:_ 13.1, 2.1
_Requirements:_ 6.1, 6.2, 6.3, 6.4, 6.5, 6.6
_Traces:_ REQ-006, C12, C15, ADR-9

- [ ] 26.1 (P) `patterns/role-based-cooperation.ts`: 役割ごとの発言の通知 `onRoleOutput` を任意の引数として足す（M2 の公開契約は変えない）+ `role-based-cooperation.test.ts` に、通知の呼び出し順（ラウンドロビンの順序）、通知を渡さないとき M2 の挙動が変わらないことを先に足す。M2 のテストが緑のままであることを確認する
  _Boundary:_ `packages/ai-core/src/patterns/role-based-cooperation.ts`, `packages/ai-core/src/patterns/role-based-cooperation.test.ts`
  _Depends:_ none
  _Requirements:_ 6.1, 6.3
  _Traces:_ REQ-006, C12
- [ ] 26.2 `drizzle/0003_marketing.sql`・`rag/db/schema.ts` と `fixtures/marketing/{products,personas}.json`: `marketing_products`（`P-` + 3 桁の ID、`price_yen >= 0` の CHECK、`tags text[]`）と `marketing_personas`（`ordinal` の UNIQUE）を作り、Drizzle のスキーマを広げ、初期データ（既定の 3 ペルソナ ID `marketer-strict` / `consumer` / `seo-specialist` を含む）を作る + `schema.db.test.ts` に、M3 の表の `information_schema.columns` との照合と CHECK / UNIQUE を足し、`client.pg.test.ts`（Boundary の例外 (4)）に `0003` を実 Postgres に適用できる 1 ケースを足す
  _Boundary:_ `packages/ai-core/drizzle/0003_marketing.sql`, `packages/ai-core/src/rag/db/schema.ts`, `packages/ai-core/src/rag/db/schema.db.test.ts`, `packages/ai-core/src/rag/db/client.pg.test.ts`, `packages/ai-core/fixtures/marketing/products.json`, `packages/ai-core/fixtures/marketing/personas.json`
  _Depends:_ 13.1
  _Requirements:_ 6.5, 6.6
  _Traces:_ REQ-006, C12, C15, CL-23
  _Verify:_ `mise run gate` が PGlite で成功する。`mise run test:db` で `0003` の適用が成功する（Docker が無ければ人が実行する）
- [ ] 26.3 `marketing/catalog.ts` と `marketing/seed.ts`: `createCatalogRepo(db)`（`listProducts`、`listPersonas`、`has(productId)`）と、`seedMarketing({ db })`（冪等な初期投入。`reset` は M3 の表だけ）を作る + `catalog.db.test.ts`・`seed.db.test.ts` に、2 回実行しても行が増えないこと、`has` の真偽、ペルソナの順序（`ordinal`）、`reset` の範囲、未投入のときの扱いを先に書く
  _Boundary:_ `packages/ai-core/src/marketing/catalog.ts`, `packages/ai-core/src/marketing/catalog.db.test.ts`, `packages/ai-core/src/marketing/seed.ts`, `packages/ai-core/src/marketing/seed.db.test.ts`
  _Depends:_ 26.2
  _Requirements:_ 6.5, 6.6
  _Traces:_ REQ-006, C12, CL-15, CL-23
- [ ] 26.4 (P) `marketing/moderator.ts`: `judgeAgreement({ model, round, turns, signal })` が `agreed`・`reason`・`remainingObjections` を `generateValidated` で返す。`agreed` が真でも `remainingObjections` が非空なら合意としない（コードの検査。CL-12）。`ToolLoopAgent` を import しない + `moderator.test.ts` に、反対が残る合意の拒否、`agreed: false`、判定が壊れたときの再生成、再生成が尽きたときの `output-invalid` を先に書く
  _Boundary:_ `packages/ai-core/src/marketing/moderator.ts`, `packages/ai-core/src/marketing/moderator.test.ts`
  _Depends:_ none
  _Requirements:_ 6.2
  _Traces:_ REQ-006, C12, CL-12, ADR-9
- [ ] 26.5 `marketing/council.ts`: `runCouncil({ draft, personas, model, maxRounds, maxTotalTokens, observer, signal })` が、ラウンドの反復と合意の確定をコード（ワークフロー）で行い、ラウンドごとに `cooperateByRole`（役割は既定 3 名、ツールなし）で各ペルソナに他のペルソナの発言を踏まえさせ、`onRoleOutput` で発言を通知し、ラウンドの終わりに `judgeAgreement` で合意を確定する。合議全体のトークン予算（`DEFAULT_COUNCIL.maxTotalTokens`）を全ラウンドで共有し、各ラウンドの `budget.maxTotalTokens` に残量を渡す。合意、最大ラウンド（既定 3）、予算切れのいずれかで終了し、`CouncilResult`（`improvedDraft`、`rounds`、`endReason: "agreed" | "max-rounds" | "budget-exhausted"`、`usage`）を返す。`agents/` と `ToolLoopAgent` を直接 import しない（plan「構成の補足」の分類表、`workflow-no-agent-loop` の対象）。1 つのペルソナの発言が失敗したら欠落として記録して続行し、全員が失敗したらエラー + `council.test.ts` に、ラウンドロビンの順序、他者の発言を踏まえること、合意での終了、最大ラウンドでの `max-rounds`、予算切れで次のラウンドを始めず `budget-exhausted` になること、各ラウンドに残量が渡ること、1 名の失敗での継続と全員失敗、中断で後続の発言と判定が始まらないことを先に書く
  _Boundary:_ `packages/ai-core/src/marketing/council.ts`, `packages/ai-core/src/marketing/council.test.ts`
  _Depends:_ 26.1, 26.3, 26.4
  _Requirements:_ 6.1, 6.2, 6.3
  _Traces:_ REQ-006, C12
- [ ] 26.6 (P) `marketing/profile.ts`: `extractProfile({ model, messages, previous, signal })` が、関心事・予算・懸念点を構造化出力で逐次抽出し、新しい値で上書きして欠けた値で既存を消さない。抽出に失敗したら直前のプロファイルを保つ。`ToolLoopAgent` を import しない + `profile.test.ts` に、欠けた値で既存を消さないこと、新しい値での上書き、抽出失敗時に直前を保つこと、配列のマージを先に書く
  _Boundary:_ `packages/ai-core/src/marketing/profile.ts`, `packages/ai-core/src/marketing/profile.test.ts`
  _Depends:_ none
  _Requirements:_ 6.4
  _Traces:_ REQ-006, C12, ADR-9
- [ ] 26.7 `marketing/recommend.ts` と `marketing/index.ts`: `recommend({ model, profile, catalog, message, signal })` が、候補を `catalog` からだけ選び、商品 ID と推薦理由を付け、表示の前に商品 ID を照合してカタログに無いものを除去し `dropped` の件数を返す。全件が除去されたときは推薦なしと理由を返す。予算を超える商品は理由に明記する。`index.ts` は `@platform/ai-core/marketing` の公開 API を再エクスポートする + `recommend.test.ts` に、カタログ外 ID の除去と件数、全件除去、カタログ外の商品を作らないこと、予算超過の明記、`has` による照合を先に書く
  _Boundary:_ `packages/ai-core/src/marketing/recommend.ts`, `packages/ai-core/src/marketing/recommend.test.ts`, `packages/ai-core/src/marketing/index.ts`
  _Depends:_ 26.3, 26.5, 26.6
  _Requirements:_ 6.4, 6.5
  _Traces:_ REQ-006, C12, CL-15

### Implementation Notes

---

## 27. 要件・マーケティングの HTTP 入口（C13 の一部、C15 の m3-5・m3-6）

_Boundary:_ `packages/ai-core/fixtures/scenarios/m3-5.ts`, `packages/ai-core/fixtures/scenarios/m3-6.ts`, `packages/ai-core/src/models/gateway.ts`, `packages/ai-core/src/models/gateway.test.ts`, `packages/ai-core/src/mock/index.ts`, `packages/ai-core/src/mock/m3-scenarios.test.ts`, `apps/web/lib/server/platform.ts`, `apps/web/lib/server/platform.test.ts`, `apps/web/lib/server/domain-stream.ts`, `apps/web/lib/server/domain-stream.test.ts`, `apps/web/app/api/requirements/**`, `apps/web/app/api/marketing/**`, `scripts/seed-samples.ts`
_Depends:_ 25.4, 26.7, 22.5, 23.1, 23.2, 19.3
_Requirements:_ 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6
_Traces:_ REQ-005, REQ-006, C13, C15

- [ ] 27.1 `fixtures/scenarios/m3-5.ts` と `m3-6.ts`: ペルソナ・質問・要件の抽出・十分性の判定（不十分 → 十分と、上限到達）のシナリオと、合議の発言・合意の判定（反対が残る → 合意）・プロファイル・レコメンド（カタログ外の ID を含む）のシナリオを作り、`gateway.ts` の `mock` 既定シナリオと `mock/index.ts` の集約に足す + `m3-scenarios.test.ts` の期待件数を更新して曖昧な一致がないことを確かめる
  _Boundary:_ `packages/ai-core/fixtures/scenarios/m3-5.ts`, `packages/ai-core/fixtures/scenarios/m3-6.ts`, `packages/ai-core/src/models/gateway.ts`, `packages/ai-core/src/models/gateway.test.ts`, `packages/ai-core/src/mock/index.ts`, `packages/ai-core/src/mock/m3-scenarios.test.ts`
  _Depends:_ 22.5, 25.3, 26.5, 26.7
  _Requirements:_ 5.1, 5.3, 5.4, 6.2, 6.4
  _Traces:_ REQ-005, REQ-006, C15
- [ ] 27.2 `platform.ts`: `getCatalogRepo()` を組み立てる（DB は M2 の基盤。未投入のとき 503 `provider-unavailable` と `mise run seed:samples` の案内）+ `platform.test.ts` に、実行モード別の組み立てと未投入の扱いを先に足す
  _Boundary:_ `apps/web/lib/server/platform.ts`, `apps/web/lib/server/platform.test.ts`
  _Depends:_ 23.1, 26.3
  _Requirements:_ 6.5, 6.6
  _Traces:_ REQ-006, C13
- [ ] 27.3 `lib/server/domain-stream.ts`: `data-requirements-preview`（状態、`id: "preview"`）、`data-requirements-judgement`、`data-council-turn`（1 発言ごとに 1 パート）、`data-council-verdict`、`data-council-result`、`data-marketing-profile`（状態、`id: "profile"`）、`data-marketing-recommendation` への写像を足す + `domain-stream.test.ts` に、状態パートの上書き、発言ごとに 1 パートでペルソナ名が付くこと、イベントの連番を先に足す
  _Boundary:_ `apps/web/lib/server/domain-stream.ts`, `apps/web/lib/server/domain-stream.test.ts`
  _Depends:_ 23.2, 25.4, 26.5
  _Requirements:_ 5.3, 5.4, 6.2, 6.3, 6.4, 6.5
  _Traces:_ REQ-005, REQ-006, C13
- [ ] 27.4 `POST /api/requirements/sessions`: `z.strictObject`（`overview` 1〜2000 文字、`modelId?`、`personaCount?` 1〜5、`maxRounds?` 1〜10）を検査し、構造化出力に対応しないモデルを `capability-unsupported` で拒否し、ペルソナを生成して面接のセッション（19.3 のレジストリ）を作り、`{ sessionId, personas, questions }` を返す + `route.test.ts` に、検査順、各拒否、ペルソナの構造化出力が 3 回失敗したときの 502 `output-invalid`、`mock` での完走を先に書く
  _Boundary:_ `apps/web/app/api/requirements/sessions/route.ts`, `apps/web/app/api/requirements/sessions/route.test.ts`
  _Depends:_ 25.2, 27.1, 27.3, 19.3
  _Requirements:_ 5.1, 5.2
  _Traces:_ REQ-005, C13
- [ ] 27.5 (P) `POST /api/requirements/sessions/[id]/messages`: `{ answers: { questionId; text }[] }`（1〜10 件、各 1〜2000 文字）を検査し、1 ラウンドを進めて `data-requirements-preview` を回答ごとに更新し、`data-requirements-judgement` を返し、不足と上限未満なら追加の質問、十分または上限到達で要件定義書を生成する。存在しない・破棄済みのセッションは 404、完了済みは 409 `invalid-request`、存在しない `questionId` は 400。**別のルートで作ったセッションを参照できる**ことを検査する + `route.test.ts` に、ラウンドの進行、プレビューの更新、判定、上限到達の強制終了、404 / 409 / 400、`/api/requirements/sessions` が作ったセッションに 404 にならないことを先に書く
  _Boundary:_ `apps/web/app/api/requirements/sessions/[id]/messages/route.ts`, `apps/web/app/api/requirements/sessions/[id]/messages/route.test.ts`
  _Depends:_ 27.4, 25.3, 25.4
  _Requirements:_ 5.2, 5.3, 5.4, 5.5, 5.6
  _Traces:_ REQ-005, C13, CL-8, CL-11
- [ ] 27.6 (P) `GET /api/requirements/sessions/[id]/document`: `text/markdown; charset=utf-8` と `Content-Disposition: attachment; filename="requirements.md"`（ファイル名は固定。入力由来の文字を含めない）で要件定義書を返す。まだ生成されていなければ 409、破棄済みは 404 + `route.test.ts` に、ヘッダ、固定のファイル名、409 / 404、本文の章立てを先に書く
  _Boundary:_ `apps/web/app/api/requirements/sessions/[id]/document/route.ts`, `apps/web/app/api/requirements/sessions/[id]/document/route.test.ts`
  _Depends:_ 27.4, 25.4
  _Requirements:_ 5.7
  _Traces:_ REQ-005, C13
- [ ] 27.7 (P) `POST /api/marketing/council`: `z.strictObject`（`draft` 1〜2000 文字、`modelId?`、`maxRounds?` 1〜6、`personaIds?` 2〜5 件）を検査し、存在しないペルソナ ID を 400、カタログとペルソナが未投入なら 503 で拒否し、`runCouncil` の進行を `data-council-turn` / `data-council-verdict` / `data-council-result` として流す + `route.test.ts` に、検査順、各拒否、`mock` の完走（反対が残る → 合意）、最大ラウンドでの終了、ペルソナ名付きの発言、中断を先に書く
  _Boundary:_ `apps/web/app/api/marketing/council/route.ts`, `apps/web/app/api/marketing/council/route.test.ts`
  _Depends:_ 27.1, 27.2, 27.3, 26.5
  _Requirements:_ 6.1, 6.2, 6.3
  _Traces:_ REQ-006, C13
- [ ] 27.8 (P) `POST /api/marketing/recommend`: `{ id, messages, modelId?, profile? }` を検査し、会話ごとに `extractProfile` でプロファイルを更新して `data-marketing-profile` を流し、`recommend` の結果（除去の件数を含む）を `data-marketing-recommendation` として流す。未投入は 503 + `route.test.ts` に、プロファイルの逐次更新、カタログ外 ID の除去と `dropped`、全件除去の応答、抽出失敗時に画面の更新がないこと、未投入の 503 を先に書く
  _Boundary:_ `apps/web/app/api/marketing/recommend/route.ts`, `apps/web/app/api/marketing/recommend/route.test.ts`
  _Depends:_ 27.1, 27.2, 27.3, 26.7
  _Requirements:_ 6.4, 6.5
  _Traces:_ REQ-006, C13
- [ ] 27.9 `scripts/seed-samples.ts` に `seedMarketing` の呼び出しを足す
  _Boundary:_ `scripts/seed-samples.ts`
  _Depends:_ 13.4, 26.3
  _Requirements:_ 6.6
  _Traces:_ REQ-006, C16
  _Verify:_ `mise run seed:samples` を 2 回実行しても、ヘルプデスクと商品・ペルソナの投入件数が増えない

### Implementation Notes

---

## 28. W6 の締め

_Boundary:_ `stryker.config.mjs`, `specs/003-domain-agents/research.md`
_Depends:_ 27.9, 27.8, 27.7, 27.6, 27.5
_Requirements:_ 5.4, 6.2, 6.5
_Traces:_ REQ-005, REQ-006, C16

- [ ] 28.1 `stryker.config.mjs` に `marketing/moderator.ts` と `marketing/recommend.ts` を足す。`workflow-no-agent-loop` が `requirements/interview.ts`・`personas.ts`、`marketing/council.ts`・`moderator.ts`・`profile.ts`・`recommend.ts` を走査し、違反例で落ちること（6.2 のテスト）を、実ファイルが揃った状態で `mise run check:repo-rules` により確認する
  _Boundary:_ `stryker.config.mjs`
  _Depends:_ 26.7, 25.4, 6.2
  _Requirements:_ 6.2, 6.5
  _Traces:_ REQ-006, C16
  _Verify:_ `mise run test:mutation` の対象に含まれ、閾値 70 を満たす。`mise run check:repo-rules` が成功する
- [ ] 28.2 W6 の gate を実測して記録する。`mise run gate` の成功を引用し、所要時間を research.md に追記する。`cooperateByRole` に `onRoleOutput` を足しても M2 のテストが緑であることを併記する
  _Boundary:_ `specs/003-domain-agents/research.md`
  _Depends:_ 28.1
  _Requirements:_ 5.4
  _Traces:_ REQ-005, C16
  _Verify:_ `mise run gate` の成功と所要時間を research.md に記録した。W6 の敵対的レビューの記録が `.sdd/reviews/003-domain-agents-impl-w6-review-*.md` にある

### Implementation Notes
