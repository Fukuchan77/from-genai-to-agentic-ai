# rag-and-workflows（Milestone 2）— トレーサビリティ

`/sdd-tasks` が生成した骨格（2026-10-12）。Requirement / Design / Task の列は `tasks-comp-w1.md`・`tasks-comp-w2.md`・`tasks-comp-w3.md`・`tasks-comp-w4.md`・`tasks-comp-w5.md`・`tasks.md`（W6）の
`_Requirements:_` と plan.md「Requirements Traceability」から機械的に作った。Test と Commit の列は `/sdd-ship` が実装後に埋める
（Test の列は 27.1 でも、解説のレビューで検証するものを含めて埋める）。

ID 規約は `tasks.md` の「ID 対応表」を参照する（この spec の plan.md/spec.md は `REQ-###`/`DES-#.#` の見出しを持たないため、
`REQ-001`〜`REQ-004` を要件グループ（Requirement 1〜4）の安定 ID とし、設計リンクには plan.md に実在する `C1`〜`C18` をそのまま使う）。

- **Requirement**: spec.md の受け入れ基準番号（`X.Y`）。`REQ-00N` は Requirement N のグループ ID
- **Design**: plan.md の部品 ID（`C1`〜`C18`。001 の `C1`〜`C22` とは別の番号）
- **Task**: タスク ID（`T-#.#` はサブタスク。波ごとのファイル `tasks-comp-w1.md`、`tasks-comp-w2.md`、`tasks-comp-w3.md`、`tasks-comp-w4.md`、`tasks-comp-w5.md`、`tasks.md`（W6）を番号で引く）
- **Test** / **Commit**: `/sdd-ship` が実装後に記入する。plan の検証の略号（G = gate、DB = PGlite、PG = `test:db`、L = `test:local`、E = Playwright、D = 解説のレビュー）は、各行の下の「検証の計画」に残した


## Requirement 1: RAG ナレッジベースと引用付き回答（REQ-001）

| Requirement | Design | Task | Test | Commit |
|---|---|---|---|---|
| 1.1 | C4, C5, C6, C13 | T-1.2, T-5.1, T-5.2, T-5.3, T-6.2, T-6.4, T-6.5, T-6.6, T-7.1, T-7.2, T-8.1, T-8.2, T-8.3, T-8.4, T-8.5, T-8.6, T-9.1, T-9.2 | W2: migrate.db / schema.db / ingest.db / store.db / loader / pdf / platform / ingest route tests; real-server.spec.ts | W1: b5f32ab, f5f9490, f4b73f1; W2: 5cd0a52 (ai-core), b904eff (web), 4f01313 (stryker) |
| 1.2 | C5 | T-6.1, T-6.2, T-9.1, T-9.3 | W2: markdown.test.ts; chunk.test.ts; ingest.db.test.ts (corpus) | W2: 5cd0a52 (ai-core), b904eff (web), 4f01313 (stryker) |
| 1.3 | C5, C6 | T-5.1, T-7.2, T-7.4, T-8.1, T-8.6 | W2: migrate.db / store.db / ingest.db (replace, no duplicates, on-disk name ID) / ingest route tests | W2: 5cd0a52 (ai-core), b904eff (web), 4f01313 (stryker) |
| 1.4 | C6, C7, C8, C13 | T-2.1, T-7.3, T-10.5, T-11.2, T-11.3, T-11.4, T-15.2, T-15.3, T-23.1, T-23.2, T-23.3 | W1: 2.1 config/*.test.ts; W2: store.db.test.ts (vector search); W3: pipeline.db.test.ts, prompt.test.ts, request-schema.test.ts, query.db.test.ts, rag-stream.test.ts, rag/query/route.test.ts; W5: rag/*.test.tsx, workflows/*.test.tsx, ErrorBanner.test.tsx, e2e/{rag,workflows,real-server,a11y,keyboard}.spec.ts, api/{rag,workflows}/route.test.ts | W1: b5f32ab, f5f9490, f4b73f1; W2: 5cd0a52 (ai-core), b904eff (web), 4f01313 (stryker); W3: 634d0f9 (ai-core), 0fe5024 (web), 8bb3229 (stryker); W5: b40870d (screens), 3574034 (next.config), 5968504 (e2e) |
| 1.5 | C8, C13, C14 | T-11.1, T-11.2, T-11.4, T-15.2, T-15.3, T-20.1, T-20.3, T-20.4, T-22.1, T-23.1, T-23.2, T-24.3 | W3: citations.test.ts, prompt.test.ts, query.db.test.ts, rag-stream.test.ts, rag/query/route.test.ts; W5: rag/*.test.tsx, workflows/*.test.tsx, ErrorBanner.test.tsx, e2e/{rag,workflows,real-server,a11y,keyboard}.spec.ts, api/{rag,workflows}/route.test.ts; W6: rag-judge.local.test.ts (footnote compliance observed, L) | W3: 634d0f9 (ai-core), 0fe5024 (web), 8bb3229 (stryker); W5: b40870d (screens), 3574034 (next.config), 5968504 (e2e); W6: 6c5ef81 (eval-suite) |
| 1.6 | C6, C7, C13 | T-7.3, T-7.4, T-10.5, T-11.3 | W2: store.db.test.ts (threshold, filters); W3: pipeline.db.test.ts, request-schema.test.ts | W2: 5cd0a52 (ai-core), b904eff (web), 4f01313 (stryker); W3: 634d0f9 (ai-core), 0fe5024 (web), 8bb3229 (stryker) |
| 1.7 | C6, C7, C8 | T-2.1, T-7.3, T-10.5, T-10.6, T-11.2, T-11.4, T-15.3, T-25.1 | W1: 2.1 config/*.test.ts; W2: store.db.test.ts (full-text, filters); W3: pipeline.db.test.ts, prompt.test.ts, query.db.test.ts, rag/query/route.test.ts; W6: rag-retrieval.local.test.ts (top-1 similarity vs the 0.5 threshold, L); research I-8 update (25.1) | W1: b5f32ab, f5f9490, f4b73f1; W2: 5cd0a52 (ai-core), b904eff (web), 4f01313 (stryker); W3: 634d0f9 (ai-core), 0fe5024 (web), 8bb3229 (stryker); W6: 09400e3 (docs/steering) |
| 1.8 | C5, C13 | T-6.4, T-6.5, T-6.6, T-8.1, T-8.2, T-8.6 | W2: pdf / loader / ingest.db / ingest route tests (5 skip reasons, unreadable files) | W2: 5cd0a52 (ai-core), b904eff (web), 4f01313 (stryker) |
| 1.9 | C9, C13 | T-12.1, T-12.2, T-15.4, T-23.2 | W3: search-knowledge-base.test.ts, agentic.db.test.ts, rag/agent/route.test.ts; W5: rag/*.test.tsx, workflows/*.test.tsx, ErrorBanner.test.tsx, e2e/{rag,workflows,real-server,a11y,keyboard}.spec.ts, api/{rag,workflows}/route.test.ts | W3: 634d0f9 (ai-core), 0fe5024 (web), 8bb3229 (stryker); W5: b40870d (screens), 3574034 (next.config), 5968504 (e2e) |
| 1.10 | C9, C13, C14 | T-12.2, T-15.4, T-20.1, T-20.4, T-23.2 | W3: agentic.db.test.ts, rag/agent/route.test.ts; W5: rag/*.test.tsx, workflows/*.test.tsx, ErrorBanner.test.tsx, e2e/{rag,workflows,real-server,a11y,keyboard}.spec.ts, api/{rag,workflows}/route.test.ts | W3: 634d0f9 (ai-core), 0fe5024 (web), 8bb3229 (stryker); W5: b40870d (screens), 3574034 (next.config), 5968504 (e2e) |
| 1.11 | C8, C9 | T-11.1, T-11.4, T-12.2, T-15.4, T-15.5 | W3: citations.test.ts, query.db.test.ts, agentic.db.test.ts, rag/agent/route.test.ts, test:mutation (score 86.46) | W3: 634d0f9 (ai-core), 0fe5024 (web), 8bb3229 (stryker) |
| 1.12 | C4, C6 | T-1.1, T-4.1, T-4.3, T-4.4, T-5.1, T-5.2, T-5.3, T-7.4, T-9.2, T-14.2, T-26.1, T-27.1, T-28.1, T-28.2 | W1: 4.1 check-repo-rules.test.mjs; 4.3 check-docs.test.mjs; 4.4 mise run gate; W2: schema.db.test.ts; client.pg / store.pg tests written, NOT run (no Docker; human step); W3: m2-scenarios.test.ts; W6: docs 2-1 (D; docs:check), the 「gate が保証しないもの」 section below | W1: b5f32ab, f5f9490, f4b73f1; W2: 5cd0a52 (ai-core), b904eff (web), 4f01313 (stryker); W3: 634d0f9 (ai-core), 0fe5024 (web), 8bb3229 (stryker); W6: 09400e3 (docs/steering) |

検証の計画（plan「Requirements Traceability」の検証の列）:

- 1.1: DB（保存内容）、G（分割・パース）、PG
- 1.2: G（見出し境界、フェンス内の `#`）
- 1.3: DB（再取り込みで置換、失敗時に既存が残る）、PG
- 1.4: DB（上位 k 件）、G（イベントの順序）、E
- 1.5: G（`resolveCitations`）、E（脚注と引用カードの対応付け）
- 1.6: DB（`tags` と文書名のフィルタ）、PG
- 1.7: DB（閾値の境界値）、G（LLM を呼ばない）
- 1.8: G（スキップ理由 5 種）、DB
- 1.9: G・DB（ツール、レジストリ）、E
- 1.10: G（`searched`）、E。無関係な質問で検索しないことの実効性は L
- 1.11: G（範囲外の除去と記録。非空虚）
- 1.12: DB・PG（分類）、D（根拠の記録）

## Requirement 2: Advanced RAG（REQ-002）

| Requirement | Design | Task | Test | Commit |
|---|---|---|---|---|
| 2.1 | C7 | T-10.4, T-10.7 | W3: hyde.test.ts, multi-query.test.ts, pipeline.db.test.ts | W3: 634d0f9 (ai-core), 0fe5024 (web), 8bb3229 (stryker) |
| 2.2 | C3, C7 | T-3.2, T-10.4, T-10.7, T-24.2, T-25.1, T-27.3 | W1: 3.2 structured/generate-validated.test.ts; W3: hyde.test.ts, multi-query.test.ts, pipeline.db.test.ts; W6: rag-retrieval.local.test.ts (Multi-Query compliance, L); ADR-8 judgement (27.3, D) | W1: b5f32ab, f5f9490, f4b73f1; W3: 634d0f9 (ai-core), 0fe5024 (web), 8bb3229 (stryker); W6: 6c5ef81 (eval-suite), 09400e3 (docs/steering) |
| 2.3 | C6, C7 | T-6.3, T-7.3, T-10.1, T-10.6 | W2: search-text.test.ts; store.db.test.ts; W3: rrf.test.ts, pipeline.db.test.ts | W2: 5cd0a52 (ai-core), b904eff (web), 4f01313 (stryker); W3: 634d0f9 (ai-core), 0fe5024 (web), 8bb3229 (stryker) |
| 2.4 | C7 | T-10.1, T-10.6, T-15.5 | W3: rrf.test.ts, pipeline.db.test.ts, test:mutation (score 86.46) | W3: 634d0f9 (ai-core), 0fe5024 (web), 8bb3229 (stryker) |
| 2.5 | C2, C7 | T-1.1, T-2.1, T-2.2, T-2.3, T-3.1, T-4.2, T-10.2, T-10.8, T-15.1 | W1: 2.1 config/*.test.ts; 2.2 models/catalog.test.ts, gateway.test.ts; 2.3 models/gateway.test.ts; 3.1 ports/rerank.test.ts; 4.2 check-model-ids.test.mjs; W3: lexical-rerank.test.ts, pipeline.db.test.ts, platform.test.ts | W1: b5f32ab, f5f9490, f4b73f1; W3: 634d0f9 (ai-core), 0fe5024 (web), 8bb3229 (stryker) |
| 2.6 | C2, C7, C13 | T-2.1, T-2.3, T-3.1, T-10.8, T-15.1, T-15.3 | W1: 2.1 config/*.test.ts; 2.3 models/gateway.test.ts; 3.1 ports/rerank.test.ts; W3: pipeline.db.test.ts, platform.test.ts, rag/query/route.test.ts | W1: b5f32ab, f5f9490, f4b73f1; W3: 634d0f9 (ai-core), 0fe5024 (web), 8bb3229 (stryker) |
| 2.7 | C7, C13, C14 | T-10.7, T-10.8, T-11.3, T-20.3, T-20.4, T-22.1, T-23.3 | W3: pipeline.db.test.ts, request-schema.test.ts; W5: rag/*.test.tsx, workflows/*.test.tsx, ErrorBanner.test.tsx, e2e/{rag,workflows,real-server,a11y,keyboard}.spec.ts, api/{rag,workflows}/route.test.ts | W3: 634d0f9 (ai-core), 0fe5024 (web), 8bb3229 (stryker); W5: b40870d (screens), 3574034 (next.config), 5968504 (e2e) |
| 2.8 | C7, C13 | T-10.3, T-10.5, T-10.6, T-10.7, T-10.8, T-15.2, T-15.3, T-20.2, T-20.4, T-23.1, T-23.2 | W3: trace.test.ts, pipeline.db.test.ts, rag-stream.test.ts, rag/query/route.test.ts; W5: rag/*.test.tsx, workflows/*.test.tsx, ErrorBanner.test.tsx, e2e/{rag,workflows,real-server,a11y,keyboard}.spec.ts, api/{rag,workflows}/route.test.ts | W3: 634d0f9 (ai-core), 0fe5024 (web), 8bb3229 (stryker); W5: b40870d (screens), 3574034 (next.config), 5968504 (e2e) |
| 2.9 | C10, C16 | T-13.1, T-13.4, T-15.5, T-24.1, T-24.2, T-24.4, T-25.1, T-26.2 | W3: recall.test.ts, rag/index.test.ts, test:mutation (score 86.46); W6: rag-eval-set.db.test.ts (DB, plumbing); rag-retrieval.local.test.ts (L); docs 2-2 (D) | W3: 634d0f9 (ai-core), 0fe5024 (web), 8bb3229 (stryker); W6: 6c5ef81 (eval-suite), 09400e3 (docs/steering) |
| 2.10 | C10, C16 | T-13.3, T-13.4, T-14.2, T-24.3, T-24.4, T-25.1, T-26.2 | W3: judge.test.ts, rag/index.test.ts, m2-scenarios.test.ts; W6: rag-judge.local.test.ts (L); docs 2-2 (D) | W3: 634d0f9 (ai-core), 0fe5024 (web), 8bb3229 (stryker); W6: 6c5ef81 (eval-suite), 09400e3 (docs/steering) |
| 2.11 | C7, C8, C13, C14 | T-10.3, T-10.5, T-10.8, T-11.4, T-15.2, T-15.3, T-20.2, T-20.4, T-23.1, T-23.2, T-23.4 | W3: trace.test.ts, pipeline.db.test.ts, query.db.test.ts, rag-stream.test.ts, rag/query/route.test.ts; W5: rag/*.test.tsx, workflows/*.test.tsx, ErrorBanner.test.tsx, e2e/{rag,workflows,real-server,a11y,keyboard}.spec.ts, api/{rag,workflows}/route.test.ts | W3: 634d0f9 (ai-core), 0fe5024 (web), 8bb3229 (stryker); W5: b40870d (screens), 3574034 (next.config), 5968504 (e2e) |
| 2.12 | C10, C15, C16, C13 | T-8.5, T-8.6, T-9.1, T-13.2, T-14.1, T-24.1 | W2: knowledge route / ingest route tests; real-server.spec.ts; W3: dataset.test.ts, dataset.test.ts (eval-set); W6: rag-eval-set.db.test.ts (DB: 20+ questions, gold IDs exist, recall@1 = 1.0 with the mock embedding) | W2: 5cd0a52 (ai-core), b904eff (web), 4f01313 (stryker); W3: 634d0f9 (ai-core), 0fe5024 (web), 8bb3229 (stryker); W6: 6c5ef81 (eval-suite) |

検証の計画（plan「Requirements Traceability」の検証の列）:

- 2.1: G（仮想回答の埋め込みで検索）。効果は L
- 2.2: G（3 件、重複で再生成、並列）。小型モデルの遵守は L
- 2.3: DB（全文 + ベクトル）、G（RRF）。日本語の全文は DB
- 2.4: G（重複排除。非空虚、性質テスト）
- 2.5: G（Rerank 後の上位 k 件、疑似実装）。Cohere の実呼び出しは手動のハンズオン
- 2.6: G（スキップと記録）
- 2.7: G（手法 16 通り）、DB、E（スイッチ）
- 2.8: G・DB（`RetrievalTrace` の中身）
- 2.9: G（recall の算術）、DB（配管）、L（手法の比較）
- 2.10: G（フェイク Judge、軸の分離、`unknown`）、L（実モデルの採点）
- 2.11: G（`stage`・`trace` イベント）、E（段階表示）
- 2.12: DB（質問セット 20 問以上、正解 ID の実在）

## Requirement 3: ワークフローパターン（REQ-003）

| Requirement | Design | Task | Test | Commit |
|---|---|---|---|---|
| 3.1 | C11 | T-16.2, T-16.3, T-16.5, T-16.6, T-16.7, T-16.8, T-18.3, T-19.1, T-21.3, T-22.2, T-26.3 | W4: workflows/*.test.ts, patterns/*.test.ts, mock/m2-scenarios.test.ts, models/gateway.test.ts, api/workflows/route.test.ts; W5: rag/*.test.tsx, workflows/*.test.tsx, ErrorBanner.test.tsx, e2e/{rag,workflows,real-server,a11y,keyboard}.spec.ts, api/{rag,workflows}/route.test.ts; W6: docs 2-3 (D; docs:check) | W4: fc0d67d (ai-core), 690fcf4 (web), 1f72bcd (repo); W5: b40870d (screens), 3574034 (next.config), 5968504 (e2e); W6: 09400e3 (docs/steering) |
| 3.2 | C11 | T-16.2, T-18.1, T-21.1 | W4: workflows/*.test.ts, patterns/*.test.ts, mock/m2-scenarios.test.ts, models/gateway.test.ts, api/workflows/route.test.ts; W5: rag/*.test.tsx, workflows/*.test.tsx, ErrorBanner.test.tsx, e2e/{rag,workflows,real-server,a11y,keyboard}.spec.ts, api/{rag,workflows}/route.test.ts | W4: fc0d67d (ai-core), 690fcf4 (web), 1f72bcd (repo); W5: b40870d (screens), 3574034 (next.config), 5968504 (e2e) |
| 3.3 | C11 | T-3.2, T-16.3, T-18.1, T-21.1 | W1: 3.2 structured/generate-validated.test.ts; W4: workflows/*.test.ts, patterns/*.test.ts, mock/m2-scenarios.test.ts, models/gateway.test.ts, api/workflows/route.test.ts; W5: rag/*.test.tsx, workflows/*.test.tsx, ErrorBanner.test.tsx, e2e/{rag,workflows,real-server,a11y,keyboard}.spec.ts, api/{rag,workflows}/route.test.ts | W1: b5f32ab, f5f9490, f4b73f1; W4: fc0d67d (ai-core), 690fcf4 (web), 1f72bcd (repo); W5: b40870d (screens), 3574034 (next.config), 5968504 (e2e) |
| 3.4 | C11 | T-16.3 | W4: workflows/*.test.ts, patterns/*.test.ts, mock/m2-scenarios.test.ts, models/gateway.test.ts, api/workflows/route.test.ts | W4: fc0d67d (ai-core), 690fcf4 (web), 1f72bcd (repo) |
| 3.5 | C11 | T-2.1, T-16.1, T-16.5, T-18.1 | W1: 2.1 config/*.test.ts; W4: workflows/*.test.ts, patterns/*.test.ts, mock/m2-scenarios.test.ts, models/gateway.test.ts, api/workflows/route.test.ts | W1: b5f32ab, f5f9490, f4b73f1; W4: fc0d67d (ai-core), 690fcf4 (web), 1f72bcd (repo) |
| 3.6 | C11 | T-2.1, T-16.1, T-16.5, T-18.1, T-21.1 | W1: 2.1 config/*.test.ts; W4: workflows/*.test.ts, patterns/*.test.ts, mock/m2-scenarios.test.ts, models/gateway.test.ts, api/workflows/route.test.ts; W5: rag/*.test.tsx, workflows/*.test.tsx, ErrorBanner.test.tsx, e2e/{rag,workflows,real-server,a11y,keyboard}.spec.ts, api/{rag,workflows}/route.test.ts | W1: b5f32ab, f5f9490, f4b73f1; W4: fc0d67d (ai-core), 690fcf4 (web), 1f72bcd (repo); W5: b40870d (screens), 3574034 (next.config), 5968504 (e2e) |
| 3.7 | C11 | T-2.1, T-16.1, T-16.6, T-18.1, T-21.1 | W1: 2.1 config/*.test.ts; W4: workflows/*.test.ts, patterns/*.test.ts, mock/m2-scenarios.test.ts, models/gateway.test.ts, api/workflows/route.test.ts; W5: rag/*.test.tsx, workflows/*.test.tsx, ErrorBanner.test.tsx, e2e/{rag,workflows,real-server,a11y,keyboard}.spec.ts, api/{rag,workflows}/route.test.ts | W1: b5f32ab, f5f9490, f4b73f1; W4: fc0d67d (ai-core), 690fcf4 (web), 1f72bcd (repo); W5: b40870d (screens), 3574034 (next.config), 5968504 (e2e) |
| 3.8 | C11 | T-2.1, T-3.2, T-16.1, T-16.7, T-18.1, T-27.3 | W1: 2.1 config/*.test.ts; 3.2 structured/generate-validated.test.ts; W4: workflows/*.test.ts, patterns/*.test.ts, mock/m2-scenarios.test.ts, models/gateway.test.ts, api/workflows/route.test.ts; W6: ADR-8 judgement (27.3, D) | W1: b5f32ab, f5f9490, f4b73f1; W4: fc0d67d (ai-core), 690fcf4 (web), 1f72bcd (repo); W6: 09400e3 (docs/steering) |
| 3.9 | C11 | T-16.7, T-21.1, T-23.2 | W4: workflows/*.test.ts, patterns/*.test.ts, mock/m2-scenarios.test.ts, models/gateway.test.ts, api/workflows/route.test.ts; W5: rag/*.test.tsx, workflows/*.test.tsx, ErrorBanner.test.tsx, e2e/{rag,workflows,real-server,a11y,keyboard}.spec.ts, api/{rag,workflows}/route.test.ts | W4: fc0d67d (ai-core), 690fcf4 (web), 1f72bcd (repo); W5: b40870d (screens), 3574034 (next.config), 5968504 (e2e) |
| 3.10 | C11 | T-16.7, T-21.1 | W4: workflows/*.test.ts, patterns/*.test.ts, mock/m2-scenarios.test.ts, models/gateway.test.ts, api/workflows/route.test.ts; W5: rag/*.test.tsx, workflows/*.test.tsx, ErrorBanner.test.tsx, e2e/{rag,workflows,real-server,a11y,keyboard}.spec.ts, api/{rag,workflows}/route.test.ts | W4: fc0d67d (ai-core), 690fcf4 (web), 1f72bcd (repo); W5: b40870d (screens), 3574034 (next.config), 5968504 (e2e) |
| 3.11 | C11 | T-16.7 | W4: workflows/*.test.ts, patterns/*.test.ts, mock/m2-scenarios.test.ts, models/gateway.test.ts, api/workflows/route.test.ts | W4: fc0d67d (ai-core), 690fcf4 (web), 1f72bcd (repo) |
| 3.12 | C1, C11 | T-2.2, T-16.4, T-18.1, T-21.1 | W1: 2.2 models/catalog.test.ts, gateway.test.ts; W4: workflows/*.test.ts, patterns/*.test.ts, mock/m2-scenarios.test.ts, models/gateway.test.ts, api/workflows/route.test.ts; W5: rag/*.test.tsx, workflows/*.test.tsx, ErrorBanner.test.tsx, e2e/{rag,workflows,real-server,a11y,keyboard}.spec.ts, api/{rag,workflows}/route.test.ts | W1: b5f32ab, f5f9490, f4b73f1; W4: fc0d67d (ai-core), 690fcf4 (web), 1f72bcd (repo); W5: b40870d (screens), 3574034 (next.config), 5968504 (e2e) |
| 3.13 | C11, C17 | T-4.1, T-4.4, T-16.2, T-16.3, T-16.5, T-16.6, T-16.7, T-18.3, T-19.2, T-26.3 | W1: 4.1 check-repo-rules.test.mjs; 4.4 mise run gate; W4: workflows/*.test.ts, patterns/*.test.ts, mock/m2-scenarios.test.ts, models/gateway.test.ts, api/workflows/route.test.ts; W6: docs 2-3 (D; docs:check) | W1: b5f32ab, f5f9490, f4b73f1; W4: fc0d67d (ai-core), 690fcf4 (web), 1f72bcd (repo); W6: 09400e3 (docs/steering) |

検証の計画（plan「Requirements Traceability」の検証の列）:

- 3.1: G（5 関数の独立した呼び出し）
- 3.2: G（検証失敗で後続を実行しない）
- 3.3: G
- 3.4: G（フォールバック）
- 3.5: G（並列、順序、区画の失敗）
- 3.6: G（多数決、同数。非空虚）
- 3.7: G（動的なサブタスク、並列、一部失敗）
- 3.8: G（合格・最大反復。合格判定はコード）
- 3.9: G（履歴）
- 3.10: G（最高スコア、同点で最初。CL-4）
- 3.11: G（最小値の統合スコア。並列実行）
- 3.12: G（振り分け先、使用量、`distinct`）
- 3.13: G（規則 `workflow-no-agent-loop` の違反例）、`check:repo-rules`

## Requirement 4: エージェントデザインパターン（REQ-004）

| Requirement | Design | Task | Test | Commit |
|---|---|---|---|---|
| 4.1 | C12 | T-17.1, T-17.2, T-17.3, T-17.4, T-17.5, T-17.6, T-17.7, T-18.4, T-19.1, T-21.3, T-22.2, T-23.3 | W4: workflows/*.test.ts, patterns/*.test.ts, mock/m2-scenarios.test.ts, models/gateway.test.ts, api/workflows/route.test.ts; W5: rag/*.test.tsx, workflows/*.test.tsx, ErrorBanner.test.tsx, e2e/{rag,workflows,real-server,a11y,keyboard}.spec.ts, api/{rag,workflows}/route.test.ts | W4: fc0d67d (ai-core), 690fcf4 (web), 1f72bcd (repo); W5: b40870d (screens), 3574034 (next.config), 5968504 (e2e) |
| 4.2 | C12 | T-3.2, T-17.1, T-18.2, T-21.2 | W1: 3.2 structured/generate-validated.test.ts; W4: workflows/*.test.ts, patterns/*.test.ts, mock/m2-scenarios.test.ts, models/gateway.test.ts, api/workflows/route.test.ts; W5: rag/*.test.tsx, workflows/*.test.tsx, ErrorBanner.test.tsx, e2e/{rag,workflows,real-server,a11y,keyboard}.spec.ts, api/{rag,workflows}/route.test.ts | W1: b5f32ab, f5f9490, f4b73f1; W4: fc0d67d (ai-core), 690fcf4 (web), 1f72bcd (repo); W5: b40870d (screens), 3574034 (next.config), 5968504 (e2e) |
| 4.3 | C12 | T-17.2, T-18.2, T-21.2 | W4: workflows/*.test.ts, patterns/*.test.ts, mock/m2-scenarios.test.ts, models/gateway.test.ts, api/workflows/route.test.ts; W5: rag/*.test.tsx, workflows/*.test.tsx, ErrorBanner.test.tsx, e2e/{rag,workflows,real-server,a11y,keyboard}.spec.ts, api/{rag,workflows}/route.test.ts | W4: fc0d67d (ai-core), 690fcf4 (web), 1f72bcd (repo); W5: b40870d (screens), 3574034 (next.config), 5968504 (e2e) |
| 4.4 | C12 | T-17.3, T-18.2, T-21.2 | W4: workflows/*.test.ts, patterns/*.test.ts, mock/m2-scenarios.test.ts, models/gateway.test.ts, api/workflows/route.test.ts; W5: rag/*.test.tsx, workflows/*.test.tsx, ErrorBanner.test.tsx, e2e/{rag,workflows,real-server,a11y,keyboard}.spec.ts, api/{rag,workflows}/route.test.ts | W4: fc0d67d (ai-core), 690fcf4 (web), 1f72bcd (repo); W5: b40870d (screens), 3574034 (next.config), 5968504 (e2e) |
| 4.5 | C12 | T-2.1, T-17.4, T-18.2, T-21.2 | W1: 2.1 config/*.test.ts; W4: workflows/*.test.ts, patterns/*.test.ts, mock/m2-scenarios.test.ts, models/gateway.test.ts, api/workflows/route.test.ts; W5: rag/*.test.tsx, workflows/*.test.tsx, ErrorBanner.test.tsx, e2e/{rag,workflows,real-server,a11y,keyboard}.spec.ts, api/{rag,workflows}/route.test.ts | W1: b5f32ab, f5f9490, f4b73f1; W4: fc0d67d (ai-core), 690fcf4 (web), 1f72bcd (repo); W5: b40870d (screens), 3574034 (next.config), 5968504 (e2e) |
| 4.6 | C12 | T-2.1, T-2.2, T-17.5, T-18.2, T-18.4, T-21.2 | W1: 2.1 config/*.test.ts; 2.2 models/catalog.test.ts, gateway.test.ts; W4: workflows/*.test.ts, patterns/*.test.ts, mock/m2-scenarios.test.ts, models/gateway.test.ts, api/workflows/route.test.ts; W5: rag/*.test.tsx, workflows/*.test.tsx, ErrorBanner.test.tsx, e2e/{rag,workflows,real-server,a11y,keyboard}.spec.ts, api/{rag,workflows}/route.test.ts | W1: b5f32ab, f5f9490, f4b73f1; W4: fc0d67d (ai-core), 690fcf4 (web), 1f72bcd (repo); W5: b40870d (screens), 3574034 (next.config), 5968504 (e2e) |
| 4.7 | C12 | T-17.6, T-18.2, T-21.2, T-25.2 | W4: workflows/*.test.ts, patterns/*.test.ts, mock/m2-scenarios.test.ts, models/gateway.test.ts, api/workflows/route.test.ts; W5: rag/*.test.tsx, workflows/*.test.tsx, ErrorBanner.test.tsx, e2e/{rag,workflows,real-server,a11y,keyboard}.spec.ts, api/{rag,workflows}/route.test.ts; W6: research 「M2 実測（W6）」 token comparison (25.2, L/manual) | W4: fc0d67d (ai-core), 690fcf4 (web), 1f72bcd (repo); W5: b40870d (screens), 3574034 (next.config), 5968504 (e2e); W6: 09400e3 (docs/steering) |
| 4.8 | C18 | T-4.3, T-26.4, T-26.5, T-27.2, T-28.3 | W1: 4.3 check-docs.test.mjs; W6: docs 2-4 18-pattern table (D; docs:check), phase-2.md, modules/index.md, steering (D) | W1: b5f32ab, f5f9490, f4b73f1; W6: 09400e3 (docs/steering) |

検証の計画（plan「Requirements Traceability」の検証の列）:

- 4.1: G（6 関数の独立した呼び出し）
- 4.2: G（不足項目と質問）
- 4.3: G
- 4.4: G（順序実行、ステップ上限）
- 4.5: G（既定 3、並列生成、選択）
- 4.6: G（反復、履歴、cross の同一モデル拒否。CL-5）
- 4.7: G（役割ごとの `createGuardedAgent`、受け渡し、共有予算。CL-8）
- 4.8: D、`docs:check`（`2-4` の必須トピックと参照テストの実在）

## gate が保証しないもの

`mise run gate`（`mock`）の緑が保証するのは、算術、制御フロー、型、SQL の正しさ（PGlite）と、評価の配管である。次のものは gate では確認されない（憲章 原則 3、11）。確認の手段と、本書の時点の状態を示す。

| gate が保証しないもの | 確認する手段 | 状態 |
|---|---|---|
| 検索手法（HyDE、Multi-Query、ハイブリッド、Rerank）の効果の差 | `packages/eval-suite/tests/capability/rag-retrieval.local.test.ts`（`mise run test:local`、Ollama） | 実測の結果は research.md「M2 実測（W6）」 |
| Judge（忠実性・回答関連性）の判定 | `packages/eval-suite/tests/capability/rag-judge.local.test.ts`（`mise run test:local`、Ollama） | 同上 |
| `local` モデルの構造化出力（Multi-Query の 3 件）と脚注の遵守率 | `rag-retrieval.local.test.ts`（再生成の回数）、`rag-judge.local.test.ts`（脚注） | 同上 |
| 日本語の埋め込みでの閾値の妥当性（Req 1.7） | `rag-retrieval.local.test.ts`（top-1 の類似度の分布）、research I-8 | 同上 |
| 実 Postgres（PostgreSQL 17 + pgvector）での挙動 | `*.pg.test.ts`（`mise run test:db`、Docker）。research「W2 5.3 の記録」の表を埋める | 未実行（この環境では Docker が起動できなかった）。**人が行う** |
| Cohere の実際の Rerank 呼び出し | 手動のハンズオン（`COHERE_API_KEY` を設定して `/rag` で Rerank を有効にする）。解説 2-2 の手順 2 | 未実施。**人が行う** |
| Role-Based Cooperation と単一エージェントのトークン使用量の差 | research.md「M2 実測（W6）」の実測（25.2） | 実測済み（3 試行、1 タスク）。ただし比較対象は 2 ツールの単一エージェントで、実際の `/agent`（5 ツール + ペルソナ）ではない。`/agent` との比較は**人が決める** |
| 解説の文面の正しさ（`docs:check` が保証するのは必須節、必須トピック、テスト名の実在まで） | 解説のレビュー（D） | 人が読んで確認する |

## Gaps

- 要件に対応するタスクが無い受け入れ基準: なし（45/45 が 1 つ以上のサブタスクの `_Requirements:_` に現れる）。
- 受け入れ基準を持たないタスク: なし（全サブタスクが `_Requirements:_` を持つ）。
- `_Boundary:_` が plan の File Structure Plan に無いパス（意図した例外。`tasks.md`「表記規約」に列挙）: 生成物 `pnpm-lock.yaml`（1.1）、`specs/002-rag-and-workflows/` 配下の spec 文書（5.3、7.4、25、27、28）、`mock:judge-v1` の追加で影響を受ける `apps/web` の既存テストと E2E（2.2。plan C1「既知の影響」）、git タグのみのタスク（28.3）。W6 で境界の外を触ったもの（レビュー F-15、F-16、F-7。いずれも意図した小さな変更）: `packages/ai-core/vitest.config.ts` と `apps/web/vitest.config.ts` の `hookTimeout: 60_000`（PGlite の WASM 起動が並列実行で 10 秒の既定を超え、`gate:repeat` 6/10 回目が失敗した。失敗は隠れず、固まったフックは 60 秒で落ちる）、`docs/README.md`（解説の一覧の更新）、`docs/modules/1-1-dev-environment.md`（規則の数 9 → 11）。
- 「gate が保証しないもの」（検索手法の効果の差、Judge の判定、`local` モデルの脚注の遵守率、実 Postgres での挙動、Cohere の実呼び出し）の一覧は、27.1 が本ファイルの「gate が保証しないもの」の節として追加した（W6、2026-10-13）。
- **Req 4.7 の隙間（W6 の 25.2 とレビュー F-5 で判明、未決）**: Role-Based Cooperation のデモは最後の役割がレビュアー（「承認するか、直す点を短く述べる」）で、`cooperateByRole` は `final` に最後の役割の出力を入れるので、デモの `final` は成果物ではなく承認のコメントになる。Req 4.7 は「最終成果物」を返すとある。(a) レビュアーが承認した成果物を返すようデモを直す（W4 のコード）か、(b) plan C12 で `final` を最後の役割の出力と定義して解説 2-4 に成果物の場所を書くか、を人が決める（W4 のコードと承認済みの plan に触れるため、W6 では変更していない。解説 2-4 には現状を明記した）。
- W1（1.1〜4.4）の Test / Commit 列は W1 のタスクが担う分だけ記入した（`W1:` 接頭辞）。後続の波が同じ行に追記する。W2（5.1〜9.3）は `W2:` 接頭辞で、W3（10.1〜15.5）は `W3:` 接頭辞で、W4（16.1〜19.2）は `W4:` 接頭辞で追記した。W4 のテストは `mise run test:mutation` を最後に 86.45 で通した後に 4 本足した（再実行なし）。W2 の `*.pg.test.ts` は未実行（Docker なし。人が `mise run test:db` で確かめる）。1.1・1.2 はマニフェストと設定のみでテストを持たない（証拠は `pnpm audit` と gate）。 W5（20.1〜23.4）は `W5:` 接頭辞で追記した（`mise run test:e2e` 363 件・skipped 0、`check:client-bundle` 成功。敵対的レビューの未対応 LOW は F-2、F-6、F-8〜F-13、F-17、F-18 で、`.sdd/reviews/002-rag-and-workflows-impl-w5-review-2026-10-13.md` に記録）。
- W6（24.1〜28.3）は `W6:` 接頭辞で追記した（`/sdd-ship` 2026-10-14）。コミットは 6c5ef81（eval-suite のテスト）、1001e4c（`hookTimeout`）、09400e3（解説・ステアリング）。仕様・追跡文書のコミットは自身のハッシュを持てないため列に載せない。境界外の 4 編集は ship 時に人が承認した。 28.2（CI）: PR #39 と main の HEAD `0ba762e`（PR #42）で `ci-status` を含む全ジョブが成功した（#40・#41 は E2E の fill 修正前で main が赤だった）。28.3: 注釈付きタグ `module/2-1`〜`2-4` を `0ba762e` にローカルで付けた（push は人が行う。タグ後の gate は exit 0）。
