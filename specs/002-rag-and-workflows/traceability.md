# rag-and-workflows（Milestone 2）— トレーサビリティ

`/sdd-tasks` が生成した骨格（2026-10-12）。Requirement / Design / Task の列は `tasks-comp-w1.md`・`tasks-comp-w2.md`・`tasks-comp-w3.md`・`tasks.md`（W4）・`tasks-w5.md`〜`tasks-w6.md` の
`_Requirements:_` と plan.md「Requirements Traceability」から機械的に作った。Test と Commit の列は `/sdd-ship` が実装後に埋める
（Test の列は 27.1 でも、解説のレビューで検証するものを含めて埋める）。

ID 規約は `tasks.md` の「ID 対応表」を参照する（この spec の plan.md/spec.md は `REQ-###`/`DES-#.#` の見出しを持たないため、
`REQ-001`〜`REQ-004` を要件グループ（Requirement 1〜4）の安定 ID とし、設計リンクには plan.md に実在する `C1`〜`C18` をそのまま使う）。

- **Requirement**: spec.md の受け入れ基準番号（`X.Y`）。`REQ-00N` は Requirement N のグループ ID
- **Design**: plan.md の部品 ID（`C1`〜`C18`。001 の `C1`〜`C22` とは別の番号）
- **Task**: タスク ID（`T-#.#` はサブタスク。波ごとのファイル `tasks-comp-w1.md`、`tasks-comp-w2.md`、`tasks-comp-w3.md`、`tasks.md`（W4）、`tasks-w5.md`〜`tasks-w6.md` を番号で引く）
- **Test** / **Commit**: `/sdd-ship` が実装後に記入する。plan の検証の略号（G = gate、DB = PGlite、PG = `test:db`、L = `test:local`、E = Playwright、D = 解説のレビュー）は、各行の下の「検証の計画」に残した


## Requirement 1: RAG ナレッジベースと引用付き回答（REQ-001）

| Requirement | Design | Task | Test | Commit |
|---|---|---|---|---|
| 1.1 | C4, C5, C6, C13 | T-1.2, T-5.1, T-5.2, T-5.3, T-6.2, T-6.4, T-6.5, T-6.6, T-7.1, T-7.2, T-8.1, T-8.2, T-8.3, T-8.4, T-8.5, T-8.6, T-9.1, T-9.2 | W2: migrate.db / schema.db / ingest.db / store.db / loader / pdf / platform / ingest route tests; real-server.spec.ts | W1: b5f32ab, f5f9490, f4b73f1; W2: 5cd0a52 (ai-core), b904eff (web), 4f01313 (stryker) |
| 1.2 | C5 | T-6.1, T-6.2, T-9.1, T-9.3 | W2: markdown.test.ts; chunk.test.ts; ingest.db.test.ts (corpus) | W2: 5cd0a52 (ai-core), b904eff (web), 4f01313 (stryker) |
| 1.3 | C5, C6 | T-5.1, T-7.2, T-7.4, T-8.1, T-8.6 | W2: migrate.db / store.db / ingest.db (replace, no duplicates, on-disk name ID) / ingest route tests | W2: 5cd0a52 (ai-core), b904eff (web), 4f01313 (stryker) |
| 1.4 | C6, C7, C8, C13 | T-2.1, T-7.3, T-10.5, T-11.2, T-11.3, T-11.4, T-15.2, T-15.3, T-23.1, T-23.2, T-23.3 | W1: 2.1 config/*.test.ts; W2: store.db.test.ts (vector search); W3: pipeline.db.test.ts, prompt.test.ts, request-schema.test.ts, query.db.test.ts, rag-stream.test.ts, rag/query/route.test.ts | W1: b5f32ab, f5f9490, f4b73f1; W2: 5cd0a52 (ai-core), b904eff (web), 4f01313 (stryker); W3: 634d0f9 (ai-core), 0fe5024 (web), 8bb3229 (stryker) |
| 1.5 | C8, C13, C14 | T-11.1, T-11.2, T-11.4, T-15.2, T-15.3, T-20.1, T-20.3, T-20.4, T-22.1, T-23.1, T-23.2, T-24.3 | W3: citations.test.ts, prompt.test.ts, query.db.test.ts, rag-stream.test.ts, rag/query/route.test.ts | W3: 634d0f9 (ai-core), 0fe5024 (web), 8bb3229 (stryker) |
| 1.6 | C6, C7, C13 | T-7.3, T-7.4, T-10.5, T-11.3 | W2: store.db.test.ts (threshold, filters); W3: pipeline.db.test.ts, request-schema.test.ts | W2: 5cd0a52 (ai-core), b904eff (web), 4f01313 (stryker); W3: 634d0f9 (ai-core), 0fe5024 (web), 8bb3229 (stryker) |
| 1.7 | C6, C7, C8 | T-2.1, T-7.3, T-10.5, T-10.6, T-11.2, T-11.4, T-15.3, T-25.1 | W1: 2.1 config/*.test.ts; W2: store.db.test.ts (full-text, filters); W3: pipeline.db.test.ts, prompt.test.ts, query.db.test.ts, rag/query/route.test.ts | W1: b5f32ab, f5f9490, f4b73f1; W2: 5cd0a52 (ai-core), b904eff (web), 4f01313 (stryker); W3: 634d0f9 (ai-core), 0fe5024 (web), 8bb3229 (stryker) |
| 1.8 | C5, C13 | T-6.4, T-6.5, T-6.6, T-8.1, T-8.2, T-8.6 | W2: pdf / loader / ingest.db / ingest route tests (5 skip reasons, unreadable files) | W2: 5cd0a52 (ai-core), b904eff (web), 4f01313 (stryker) |
| 1.9 | C9, C13 | T-12.1, T-12.2, T-15.4, T-23.2 | W3: search-knowledge-base.test.ts, agentic.db.test.ts, rag/agent/route.test.ts | W3: 634d0f9 (ai-core), 0fe5024 (web), 8bb3229 (stryker) |
| 1.10 | C9, C13, C14 | T-12.2, T-15.4, T-20.1, T-20.4, T-23.2 | W3: agentic.db.test.ts, rag/agent/route.test.ts | W3: 634d0f9 (ai-core), 0fe5024 (web), 8bb3229 (stryker) |
| 1.11 | C8, C9 | T-11.1, T-11.4, T-12.2, T-15.4, T-15.5 | W3: citations.test.ts, query.db.test.ts, agentic.db.test.ts, rag/agent/route.test.ts, test:mutation (score 86.46) | W3: 634d0f9 (ai-core), 0fe5024 (web), 8bb3229 (stryker) |
| 1.12 | C4, C6 | T-1.1, T-4.1, T-4.3, T-4.4, T-5.1, T-5.2, T-5.3, T-7.4, T-9.2, T-14.2, T-26.1, T-27.1, T-28.1, T-28.2 | W1: 4.1 check-repo-rules.test.mjs; 4.3 check-docs.test.mjs; 4.4 mise run gate; W2: schema.db.test.ts; client.pg / store.pg tests written, NOT run (no Docker; human step); W3: m2-scenarios.test.ts | W1: b5f32ab, f5f9490, f4b73f1; W2: 5cd0a52 (ai-core), b904eff (web), 4f01313 (stryker); W3: 634d0f9 (ai-core), 0fe5024 (web), 8bb3229 (stryker) |

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
| 2.2 | C3, C7 | T-3.2, T-10.4, T-10.7, T-24.2, T-25.1, T-27.3 |W1: 3.2 structured/generate-validated.test.ts; W3: hyde.test.ts, multi-query.test.ts, pipeline.db.test.ts | W1: b5f32ab, f5f9490, f4b73f1; W3: 634d0f9 (ai-core), 0fe5024 (web), 8bb3229 (stryker) |
| 2.3 | C6, C7 | T-6.3, T-7.3, T-10.1, T-10.6 | W2: search-text.test.ts; store.db.test.ts; W3: rrf.test.ts, pipeline.db.test.ts | W2: 5cd0a52 (ai-core), b904eff (web), 4f01313 (stryker); W3: 634d0f9 (ai-core), 0fe5024 (web), 8bb3229 (stryker) |
| 2.4 | C7 | T-10.1, T-10.6, T-15.5 | W3: rrf.test.ts, pipeline.db.test.ts, test:mutation (score 86.46) | W3: 634d0f9 (ai-core), 0fe5024 (web), 8bb3229 (stryker) |
| 2.5 | C2, C7 | T-1.1, T-2.1, T-2.2, T-2.3, T-3.1, T-4.2, T-10.2, T-10.8, T-15.1 |W1: 2.1 config/*.test.ts; 2.2 models/catalog.test.ts, gateway.test.ts; 2.3 models/gateway.test.ts; 3.1 ports/rerank.test.ts; 4.2 check-model-ids.test.mjs; W3: lexical-rerank.test.ts, pipeline.db.test.ts, platform.test.ts | W1: b5f32ab, f5f9490, f4b73f1; W3: 634d0f9 (ai-core), 0fe5024 (web), 8bb3229 (stryker) |
| 2.6 | C2, C7, C13 | T-2.1, T-2.3, T-3.1, T-10.8, T-15.1, T-15.3 |W1: 2.1 config/*.test.ts; 2.3 models/gateway.test.ts; 3.1 ports/rerank.test.ts; W3: pipeline.db.test.ts, platform.test.ts, rag/query/route.test.ts | W1: b5f32ab, f5f9490, f4b73f1; W3: 634d0f9 (ai-core), 0fe5024 (web), 8bb3229 (stryker) |
| 2.7 | C7, C13, C14 | T-10.7, T-10.8, T-11.3, T-20.3, T-20.4, T-22.1, T-23.3 | W3: pipeline.db.test.ts, request-schema.test.ts | W3: 634d0f9 (ai-core), 0fe5024 (web), 8bb3229 (stryker) |
| 2.8 | C7, C13 | T-10.3, T-10.5, T-10.6, T-10.7, T-10.8, T-15.2, T-15.3, T-20.2, T-20.4, T-23.1, T-23.2 | W3: trace.test.ts, pipeline.db.test.ts, rag-stream.test.ts, rag/query/route.test.ts | W3: 634d0f9 (ai-core), 0fe5024 (web), 8bb3229 (stryker) |
| 2.9 | C10, C16 | T-13.1, T-13.4, T-15.5, T-24.1, T-24.2, T-24.4, T-25.1, T-26.2 | W3: recall.test.ts, rag/index.test.ts, test:mutation (score 86.46) | W3: 634d0f9 (ai-core), 0fe5024 (web), 8bb3229 (stryker) |
| 2.10 | C10, C16 | T-13.3, T-13.4, T-14.2, T-24.3, T-24.4, T-25.1, T-26.2 | W3: judge.test.ts, rag/index.test.ts, m2-scenarios.test.ts | W3: 634d0f9 (ai-core), 0fe5024 (web), 8bb3229 (stryker) |
| 2.11 | C7, C8, C13, C14 | T-10.3, T-10.5, T-10.8, T-11.4, T-15.2, T-15.3, T-20.2, T-20.4, T-23.1, T-23.2, T-23.4 | W3: trace.test.ts, pipeline.db.test.ts, query.db.test.ts, rag-stream.test.ts, rag/query/route.test.ts | W3: 634d0f9 (ai-core), 0fe5024 (web), 8bb3229 (stryker) |
| 2.12 | C10, C15, C16, C13 | T-8.5, T-8.6, T-9.1, T-13.2, T-14.1, T-24.1 | W2: knowledge route / ingest route tests; real-server.spec.ts; W3: dataset.test.ts, dataset.test.ts (eval-set) | W2: 5cd0a52 (ai-core), b904eff (web), 4f01313 (stryker); W3: 634d0f9 (ai-core), 0fe5024 (web), 8bb3229 (stryker) |

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
| 3.1 | C11 | T-16.2, T-16.3, T-16.5, T-16.6, T-16.7, T-16.8, T-18.3, T-19.1, T-21.3, T-22.2, T-26.3 |||
| 3.2 | C11 | T-16.2, T-18.1, T-21.1 |||
| 3.3 | C11 | T-3.2, T-16.3, T-18.1, T-21.1 |W1: 3.2 structured/generate-validated.test.ts | W1: b5f32ab, f5f9490, f4b73f1 |
| 3.4 | C11 | T-16.3 |||
| 3.5 | C11 | T-2.1, T-16.1, T-16.5, T-18.1 |W1: 2.1 config/*.test.ts | W1: b5f32ab, f5f9490, f4b73f1 |
| 3.6 | C11 | T-2.1, T-16.1, T-16.5, T-18.1, T-21.1 |W1: 2.1 config/*.test.ts | W1: b5f32ab, f5f9490, f4b73f1 |
| 3.7 | C11 | T-2.1, T-16.1, T-16.6, T-18.1, T-21.1 |W1: 2.1 config/*.test.ts | W1: b5f32ab, f5f9490, f4b73f1 |
| 3.8 | C11 | T-2.1, T-3.2, T-16.1, T-16.7, T-18.1, T-27.3 |W1: 2.1 config/*.test.ts; 3.2 structured/generate-validated.test.ts | W1: b5f32ab, f5f9490, f4b73f1 |
| 3.9 | C11 | T-16.7, T-21.1, T-23.2 |||
| 3.10 | C11 | T-16.7, T-21.1 |||
| 3.11 | C11 | T-16.7 |||
| 3.12 | C1, C11 | T-2.2, T-16.4, T-18.1, T-21.1 |W1: 2.2 models/catalog.test.ts, gateway.test.ts | W1: b5f32ab, f5f9490, f4b73f1 |
| 3.13 | C11, C17 | T-4.1, T-4.4, T-16.2, T-16.3, T-16.5, T-16.6, T-16.7, T-18.3, T-19.2, T-26.3 |W1: 4.1 check-repo-rules.test.mjs; 4.4 mise run gate | W1: b5f32ab, f5f9490, f4b73f1 |

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
| 4.1 | C12 | T-17.1, T-17.2, T-17.3, T-17.4, T-17.5, T-17.6, T-17.7, T-18.4, T-19.1, T-21.3, T-22.2, T-23.3 |||
| 4.2 | C12 | T-3.2, T-17.1, T-18.2, T-21.2 |W1: 3.2 structured/generate-validated.test.ts | W1: b5f32ab, f5f9490, f4b73f1 |
| 4.3 | C12 | T-17.2, T-18.2, T-21.2 |||
| 4.4 | C12 | T-17.3, T-18.2, T-21.2 |||
| 4.5 | C12 | T-2.1, T-17.4, T-18.2, T-21.2 |W1: 2.1 config/*.test.ts | W1: b5f32ab, f5f9490, f4b73f1 |
| 4.6 | C12 | T-2.1, T-2.2, T-17.5, T-18.2, T-18.4, T-21.2 |W1: 2.1 config/*.test.ts; 2.2 models/catalog.test.ts, gateway.test.ts | W1: b5f32ab, f5f9490, f4b73f1 |
| 4.7 | C12 | T-17.6, T-18.2, T-21.2, T-25.2 |||
| 4.8 | C18 | T-4.3, T-26.4, T-26.5, T-27.2, T-28.3 |W1: 4.3 check-docs.test.mjs | W1: b5f32ab, f5f9490, f4b73f1 |

検証の計画（plan「Requirements Traceability」の検証の列）:

- 4.1: G（6 関数の独立した呼び出し）
- 4.2: G（不足項目と質問）
- 4.3: G
- 4.4: G（順序実行、ステップ上限）
- 4.5: G（既定 3、並列生成、選択）
- 4.6: G（反復、履歴、cross の同一モデル拒否。CL-5）
- 4.7: G（役割ごとの `createGuardedAgent`、受け渡し、共有予算。CL-8）
- 4.8: D、`docs:check`（`2-4` の必須トピックと参照テストの実在）

## Gaps

- 要件に対応するタスクが無い受け入れ基準: なし（45/45 が 1 つ以上のサブタスクの `_Requirements:_` に現れる）。
- 受け入れ基準を持たないタスク: なし（全サブタスクが `_Requirements:_` を持つ）。
- `_Boundary:_` が plan の File Structure Plan に無いパス（意図した例外。`tasks.md`「表記規約」に列挙）: 生成物 `pnpm-lock.yaml`（1.1）、`specs/002-rag-and-workflows/` 配下の spec 文書（5.3、7.4、25、27、28）、`mock:judge-v1` の追加で影響を受ける `apps/web` の既存テストと E2E（2.2。plan C1「既知の影響」）、git タグのみのタスク（28.3）。
- 「gate が保証しないもの」（検索手法の効果の差、Judge の判定、`local` モデルの脚注の遵守率、実 Postgres での挙動、Cohere の実呼び出し）の一覧は、27.1 が本ファイルに節として追加する。
- W1（1.1〜4.4）の Test / Commit 列は W1 のタスクが担う分だけ記入した（`W1:` 接頭辞）。後続の波が同じ行に追記する。W2（5.1〜9.3）は `W2:` 接頭辞で、W3（10.1〜15.5）は `W3:` 接頭辞で追記した。W2 の `*.pg.test.ts` は未実行（Docker なし。人が `mise run test:db` で確かめる）。1.1・1.2 はマニフェストと設定のみでテストを持たない（証拠は `pnpm audit` と gate）。
