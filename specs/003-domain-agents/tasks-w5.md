# domain-agents（Milestone 3）— 実装タスク W5: リサーチ（大タスク 21〜24）

未着手の波。表記規約、ID 対応表、進捗、gate への段階的な結線、共有ファイルの編集者は [tasks.md](tasks.md) を参照する。

arXiv のクライアント（キュー、キャッシュ、再試行、解析）、研究ツール、予算、サブエージェント、Supervisor、引用の照合、`/api/research`、`m3-4` のシナリオを作る。
前提は spike S-2（1.3。サブエージェントのツールの受け渡し）の結果。W4 の完了後に着手する（共有ファイルの順序。tasks.md「波の依存」）。

21.2・22.1 は並列に進められる。

---

## 21. arXiv クライアント（C8）

arXiv の Atom API を利用規約（3 秒間隔、単一接続、日単位のキャッシュ）に従って呼び、論文の集合を返す。

_Boundary:_ `packages/ai-core/src/research/arxiv/**`, `packages/ai-core/src/research/tools.ts`, `packages/ai-core/src/research/tools.test.ts`, `packages/ai-core/fixtures/arxiv/*.xml`
_Depends:_ 1.2, 2.1, 4.7
_Requirements:_ 1.16, 4.3, 4.7
_Traces:_ REQ-001, REQ-004, C8, C15, ADR-3

- [ ] 21.1 `research/arxiv/types.ts`・`parse.ts` と `fixtures/arxiv/{search-multi,search-single,search-empty,error}.xml`: `ArxivPaper` の Zod スキーマ（`arxivId` は `vN` を除いた形）と、`parseArxivFeed(xml)`（`fast-xml-parser`、`processEntities` 無効、`isArray` で `entry`・`author`・`link` を配列にする）を作る。DOCTYPE を含むフィードは解析せず失敗として扱う + `parse.test.ts` に、複数・1 件のみ（配列化）・空のフィード、エラーのフィード（`entry` に `Error` の要約）、DOCTYPE と実体の展開を試みるフィード、旧形式の ID（`cs/0501001`）と `vN` の除去を先に書く
  _Boundary:_ `packages/ai-core/src/research/arxiv/types.ts`, `packages/ai-core/src/research/arxiv/parse.ts`, `packages/ai-core/src/research/arxiv/parse.test.ts`, `packages/ai-core/fixtures/arxiv/search-multi.xml`, `packages/ai-core/fixtures/arxiv/search-single.xml`, `packages/ai-core/fixtures/arxiv/search-empty.xml`, `packages/ai-core/fixtures/arxiv/error.xml`
  _Depends:_ 1.2
  _Requirements:_ 4.3
  _Traces:_ REQ-004, C8, C15, ADR-3
- [ ] 21.2 (P) `research/arxiv/queue.ts`: `Clock` による 3 秒間隔・同時 1 接続の直列キューを作る + `queue.test.ts`（`FakeClock`）に、間隔の境界値（2,999 ms で待ち、3,000 ms で実行）、並行呼び出しが直列化されること、先行の失敗が後続を止めないことを先に書く
  _Boundary:_ `packages/ai-core/src/research/arxiv/queue.ts`, `packages/ai-core/src/research/arxiv/queue.test.ts`
  _Depends:_ none
  _Requirements:_ 4.7
  _Traces:_ REQ-004, C8
- [ ] 21.3 `research/arxiv/client.ts`: `createArxivClient({ fetcher, clock, cache, options })` の `search(query, { maxResults })` と `getAbstract(arxivId)`（キャッシュ済みの集合からだけ返す）を作る。クエリ単位のキャッシュ（正規化したクエリ、有効期間 1 日）、再試行（最大 3 回、`Retry-After` があれば従い無ければ指数待機、待機は `Clock`）、応答サイズ上限（2 MB）、解析失敗の扱い（失敗として再試行の対象）を持つ。通信は M1 の `HttpFetcher` を使い、ネットワークへ直接接続しない + `client.test.ts` に、キャッシュ命中で通信しないこと、`Retry-After`、3 回で諦めて失敗を返すこと、429 / 503 / 5xx / ネットワーク失敗 / HTTP 400、サイズ超過、空のフィードがエラーでないこと、中断で待機が止まることを先に書く
  _Boundary:_ `packages/ai-core/src/research/arxiv/client.ts`, `packages/ai-core/src/research/arxiv/client.test.ts`
  _Depends:_ 21.1, 21.2
  _Requirements:_ 4.3, 4.7
  _Traces:_ REQ-004, C8, ADR-3
- [ ] 21.4 `research/tools.ts`: `createResearchTools({ client })` が `searchArxiv`（検索サブエージェント用）と `getPaperAbstract`（精読サブエージェント用）を `defineAciTool` で定義する。どちらも `risk: "read-only"`、説明文は 4.1 の形式。取得した要旨は外部コンテンツとして `RunObserver` の記録口（5.2）に種別と出所だけを記録する + `tools.test.ts` に、検索結果の各項目（タイトル、著者、公開日、arXiv ID、要旨）、`risk`、説明文が `checkDescription` を通ること、記録口の呼び出し、`getAbstract` が検索結果の集合に無い ID で `undefined` を返すことを先に書く
  _Boundary:_ `packages/ai-core/src/research/tools.ts`, `packages/ai-core/src/research/tools.test.ts`
  _Depends:_ 21.3, 4.7, 5.2
  _Requirements:_ 1.16, 4.3
  _Traces:_ REQ-001, REQ-004, C8, CL-10

### Implementation Notes

---

## 22. Supervisor・サブエージェント・予算（C9）

階層型リサーチの Supervisor と 3 つのサブエージェントを束ね、呼び出し回数と共有トークン予算を数え、要約だけを返し、引用を照合して、役割ごとのトークン内訳を集計する。

_Boundary:_ `packages/ai-core/src/research/budget.ts`, `packages/ai-core/src/research/budget.test.ts`, `packages/ai-core/src/research/citations.ts`, `packages/ai-core/src/research/citations.test.ts`, `packages/ai-core/src/research/subagents.ts`, `packages/ai-core/src/research/subagents.test.ts`, `packages/ai-core/src/research/supervisor.ts`, `packages/ai-core/src/research/supervisor.test.ts`, `packages/ai-core/src/research/index.ts`, `packages/ai-core/fixtures/scenarios/m3-4.ts`, `packages/ai-core/src/models/gateway.ts`, `packages/ai-core/src/models/gateway.test.ts`, `packages/ai-core/src/mock/index.ts`, `packages/ai-core/src/mock/m3-scenarios.test.ts`
_Depends:_ 21.4, 5.1, 5.2, 3.3, 1.3
_Requirements:_ 4.1, 4.2, 4.4, 4.5, 4.6, 4.8, 4.9, 4.10
_Traces:_ REQ-004, C9, C15, ADR-8

- [ ] 22.1 (P) `research/budget.ts`: `createBudget({ maxCalls, maxTotalTokens })` の `takeCall()`（上限に達したら `false`）、`remainingTokens()`、`recordUsage(role, usage)` を作る。残量が 0 の呼び出しは実行させず、予算切れを返す(CL-17) + `budget.test.ts` に、呼び出し回数の上限の境界、残量 0 の子を**実行しない**こと、役割別の内訳の合計が全体と一致すること、使用量が取れない役割の扱いを先に書く
  _Boundary:_ `packages/ai-core/src/research/budget.ts`, `packages/ai-core/src/research/budget.test.ts`
  _Depends:_ none
  _Requirements:_ 4.8, 4.10
  _Traces:_ REQ-004, C9, CL-17
- [ ] 22.2 `research/citations.ts`: `checkCitations(report, papers)` が、本文の arXiv ID とリンク（`arxiv.org/abs/…v2`、`pdf`、`http` / `https` の違いを同一視）を論文の集合と照合し、集合に無い論文への言及を除去して `removed` と警告を返す純関数を作る。ID が付かない論文への言及も警告に載せる + `citations.test.ts` に、集合に無い ID とリンクの除去と警告、版違い（`v2`）の正規化、書式違いの同一視、全論文に ID が付くこと、集合に含まれる言及を壊さないことを先に書く
  _Boundary:_ `packages/ai-core/src/research/citations.ts`, `packages/ai-core/src/research/citations.test.ts`
  _Depends:_ 21.1
  _Requirements:_ 4.5
  _Traces:_ REQ-004, C9
- [ ] 22.3 `research/subagents.ts`: `createSubagent(kind, deps)`（`search` / `reading` / `market`）が、子の `createGuardedAgent` を内部で作り、入力スキーマ付きのツール（`AciTool`）として Supervisor に渡す。戻り値は要約（`SubagentResult`、800 文字以内、`paperIds`）だけで、内部のトランスクリプトを返さない。呼び出しの前に予算を確認し、残量 0 なら実行せず予算切れを返す。失敗は名前と理由を返す（例外にしない）。ツールの渡し方は 1.3（S-2）の結果に従う + `subagents.test.ts` に、要約だけが返り内部の文が含まれないこと、要約の長さ上限、予算切れの子を実行しないこと、失敗の名前と理由、子の上限に残量が渡ることを先に書く
  _Boundary:_ `packages/ai-core/src/research/subagents.ts`, `packages/ai-core/src/research/subagents.test.ts`
  _Depends:_ 21.4, 22.1, 3.3, 5.1, 5.2, 1.3
  _Requirements:_ 4.1, 4.4, 4.6, 4.8
  _Traces:_ REQ-004, C9, ADR-8, S-2
- [ ] 22.4 `research/supervisor.ts` と `research/index.ts`: `runResearch({ theme, model, arxiv, observer, limits, signal })` が、Supervisor を `createGuardedAgent` で作り、3 つのサブエージェントをツールとして渡し、Markdown のレポートを返す。呼び出し回数（既定 8）と共有トークン予算（既定 80,000）を数え、失敗を `missing` に集約してレポートに欠落した観点を明記する（全サブエージェントが失敗した場合は「調査できなかった」旨と `missing` だけを返す）。レポートは `checkCitations` で照合してから返し、`TokenLedger` が役割別（`supervisor` / `search` / `reading` / `market`）の内訳を集計する。各イベントに `agent` 名を付ける。`index.ts` は `@platform/ai-core/research` の公開 API を再エクスポートする + `supervisor.test.ts` に、`mock` の完走、呼び出し回数の上限、トークン予算の尽きた後の扱い、子の失敗でも継続して欠落が明記されること、未知の arXiv ID の除去、内訳の合計、`agent` 付きのイベントの順序、中断を先に書く
  _Boundary:_ `packages/ai-core/src/research/supervisor.ts`, `packages/ai-core/src/research/supervisor.test.ts`, `packages/ai-core/src/research/index.ts`
  _Depends:_ 22.2, 22.3
  _Requirements:_ 4.1, 4.2, 4.5, 4.6, 4.8, 4.9, 4.10
  _Traces:_ REQ-004, C9, ADR-8, CL-17
- [ ] 22.5 `fixtures/scenarios/m3-4.ts`: Supervisor と 3 つの子のシナリオ（検索 → 精読 → 市場影響 → レポート。未知の arXiv ID を含む引用、子の失敗を含む）を作り、`gateway.ts` の `mock` 既定シナリオと `mock/index.ts` の集約に足す。`mock` のシナリオは 4 回の呼び出しで完了する(DEFAULT_RESEARCH の根拠) + `m3-scenarios.test.ts` の期待件数を更新して曖昧な一致がないことを確かめる
  _Boundary:_ `packages/ai-core/fixtures/scenarios/m3-4.ts`, `packages/ai-core/src/models/gateway.ts`, `packages/ai-core/src/models/gateway.test.ts`, `packages/ai-core/src/mock/index.ts`, `packages/ai-core/src/mock/m3-scenarios.test.ts`
  _Depends:_ 18.5, 22.4
  _Requirements:_ 4.2, 4.5
  _Traces:_ REQ-004, C15

### Implementation Notes

---

## 23. リサーチの HTTP 入口（C13 の一部）

_Boundary:_ `apps/web/lib/server/platform.ts`, `apps/web/lib/server/platform.test.ts`, `apps/web/lib/server/domain-stream.ts`, `apps/web/lib/server/domain-stream.test.ts`, `apps/web/app/api/research/**`, `apps/web/next.config.ts`, `apps/web/e2e/real-server.spec.ts`, `specs/003-domain-agents/research.md`
_Depends:_ 22.5, 19.1, 19.4
_Requirements:_ 4.2, 4.6, 4.8, 4.9, 4.10
_Traces:_ REQ-004, C13, R-1

- [ ] 23.1 `platform.ts`: `getArxivClient()` を組み立てる（`HttpFetcher`、`Clock`、キャッシュ。`globalThis` のホルダーで 1 つだけ。`mock` ではフィクスチャを返す fetcher）+ `platform.test.ts` に、実行モード別の組み立て、`mock` で arXiv へ接続しないことを先に足す
  _Boundary:_ `apps/web/lib/server/platform.ts`, `apps/web/lib/server/platform.test.ts`
  _Depends:_ 19.1, 21.3
  _Requirements:_ 4.3, 4.7
  _Traces:_ REQ-004, C13
- [ ] 23.2 `lib/server/domain-stream.ts`: `data-research-event`（`agent` と `kind`: `call` / `tool` / `summary` / `card` / `error`）、`data-research-usage`（状態、`id: "usage"`）、`data-research-result` への写像を足す + `domain-stream.test.ts` に、`agent` 付きのイベントの順序、使用量の状態パートが同じ `id` で上書きされること、結果の `report` が照合後であることを先に足す
  _Boundary:_ `apps/web/lib/server/domain-stream.ts`, `apps/web/lib/server/domain-stream.test.ts`
  _Depends:_ 19.4, 22.4
  _Requirements:_ 4.9, 4.10
  _Traces:_ REQ-004, C13
- [ ] 23.3 `POST /api/research`: `z.strictObject`（`theme` 1〜500 文字、`modelId?`、`maxSubagentCalls?` 1〜20）を検査し、ツール非対応のモデルを `capability-unsupported` で拒否し、`runResearch` の進行を `data-research-*` として流す。arXiv に到達できない場合は検索の欠落として `missing` に記録して続行する（Supervisor 自体が起動できないときだけエラー）。中断では `data-research-result` を送らない + `route.test.ts` に、検査順、各拒否のコード、`mock` の完走（レポートに警告、`missing`、内訳）、呼び出し回数の上限の変更、中断を先に書く
  _Boundary:_ `apps/web/app/api/research/route.ts`, `apps/web/app/api/research/route.test.ts`
  _Depends:_ 22.5, 23.1, 23.2
  _Requirements:_ 4.2, 4.6, 4.8, 4.9, 4.10
  _Traces:_ REQ-004, C13
- [ ] 23.4 実サーバー（`mock`）で、`fast-xml-parser` がバンドルされて起動できること、`/api/research` が `mock` で完走することを `real-server.spec.ts` で確かめ、`next.config.ts` の `serverExternalPackages` を必要最小限に更新する。結果を research.md の R-1 に追記する
  _Boundary:_ `apps/web/next.config.ts`, `apps/web/e2e/real-server.spec.ts`, `specs/003-domain-agents/research.md`
  _Depends:_ 23.3, 20.1
  _Requirements:_ 4.2, 4.3
  _Traces:_ REQ-004, C13, R-1
  _Verify:_ `mise run test:e2e`（実サーバー）が成功する。足した `serverExternalPackages` の理由が research.md にある

### Implementation Notes

---

## 24. W5 の締め

_Boundary:_ `stryker.config.mjs`, `specs/003-domain-agents/research.md`
_Depends:_ 23.4
_Requirements:_ 4.5, 4.8, 4.10
_Traces:_ REQ-004, C16

- [ ] 24.1 `stryker.config.mjs` に `research/citations.ts` と `research/budget.ts` を足す
  _Boundary:_ `stryker.config.mjs`
  _Depends:_ 22.4
  _Requirements:_ 4.5, 4.8
  _Traces:_ REQ-004, C16
  _Verify:_ `mise run test:mutation` の対象に含まれ、閾値 70 を満たす
- [ ] 24.2 W5 の gate を実測して記録する。`mise run gate` の成功を引用し、所要時間を research.md に追記する。arXiv の 429 / 503 / `Retry-After` の実挙動は未実測であり、フィクスチャは仕様と推測に基づくことを research.md に明記する
  _Boundary:_ `specs/003-domain-agents/research.md`
  _Depends:_ 24.1
  _Requirements:_ 4.7
  _Traces:_ REQ-004, C16
  _Verify:_ `mise run gate` の成功と所要時間を research.md に記録した。W5 の敵対的レビューの記録が `.sdd/reviews/003-domain-agents-impl-w5-review-*.md` にある

### Implementation Notes
