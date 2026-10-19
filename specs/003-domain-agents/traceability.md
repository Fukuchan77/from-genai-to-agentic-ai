# domain-agents（Milestone 3）— トレーサビリティ

`/sdd-tasks` が生成した骨格（2026-10-18）。Requirement / Design / Task の列は `tasks.md`（現在の波、W6）・`tasks-comp-w1.md`〜`tasks-comp-w5.md`・`tasks-w7.md`・`tasks-w8.md` の
`_Requirements:_` と plan.md「Requirements Traceability」から機械的に作った。Test と Commit の列は `/sdd-ship` が実装後に埋める
（Test の列は 41.1 でも、解説のレビューや `local`・`container` で検証するものを含めて埋める）。

ID 規約は `tasks.md` の「ID 対応表」を参照する（この spec の plan.md/spec.md は `REQ-###`/`DES-#.#` の見出しを持たないため、
`REQ-001`〜`REQ-006` を要件グループ（Requirement 1〜6）の安定 ID とし、設計リンクには plan.md に実在する `C1`〜`C16` をそのまま使う）。

- **Requirement**: spec.md の受け入れ基準番号（`X.Y`）。`REQ-00N` は Requirement N のグループ ID
- **Design**: plan.md の部品 ID（`C1`〜`C16`。001 の `C1`〜`C22`、002 の `C1`〜`C18` とは別の番号）
- **Task**: タスク ID（`T-#.#` はサブタスク。波ごとのファイル `tasks-comp-w1.md`（spike・W1）、`tasks-comp-w2.md`（W2）、`tasks-comp-w3.md`（W3）、`tasks-comp-w4.md`（W4）、`tasks-comp-w5.md`（W5）、`tasks.md`（W6）、`tasks-w7.md`・`tasks-w8.md` を番号で引く）
- **Test** / **Commit**: `/sdd-ship` が実装後に記入する。plan の検証の略号（G = gate、DB = PGlite、PG = `test:db`、C = `test:container`、L = `test:local`、E = Playwright、D = 解説のレビュー・ハンズオンの記録）は、各行の下の「検証の計画」に残した


## Requirement 1: ACI ツール設計と MCP 連携（REQ-001）

| Requirement | Design | Task | Test | Commit |
|---|---|---|---|---|
| 1.1 | C3, C4, C5, C16 | T-4.1, T-4.6, T-4.7, T-4.8, T-7.1, T-8.3, T-9.3, T-40.1, T-40.7, T-40.8, T-41.1, T-41.3, T-42.3 | description-check.test.ts, define-tool.test.ts, tools.test.ts, adapt.test.ts | 70dd437, 077c51e, 9df796f, 7c3c3f9 |
| 1.2 | C2, C3 | T-1.1, T-4.2, T-4.7, T-4.8 | research.md S-1 (D), input-guide.test.ts, define-tool.test.ts | 70dd437 |
| 1.3 | C2, C5, C13, C14 | T-1.1, T-3.1, T-3.2, T-3.3, T-7.2, T-9.3, T-10.4, T-29.2, T-35.3, T-37.1, T-40.1 | research.md S-1 (D), fatal.test.ts, tool-set.test.ts, guarded-agent.test.ts, research.md gate 実測 (D), adapt.test.ts, mcp/chat route.test.ts | 70dd437, 7c3c3f9, c710007 |
| 1.4 | C4 | T-8.2, T-8.3, T-11.2, T-42.2 | path.test.ts, tools.test.ts | 9df796f, 2432c19 |
| 1.5 | C2, C4, C5 | T-3.1, T-8.2, T-8.3, T-9.3, T-11.2, T-37.1, T-40.1, T-42.1, T-42.2 | fatal.test.ts, path.test.ts, tools.test.ts, adapt.test.ts | 70dd437, 9df796f, 7c3c3f9 |
| 1.6 | C3, C4 | T-4.3, T-4.8, T-8.3 | response-format.test.ts, tools.test.ts | 70dd437, 9df796f |
| 1.7 | C4, C5, C13, C14 | T-1.2, T-1.3, T-2.1, T-8.1, T-8.4, T-9.4, T-9.5, T-10.2, T-10.3, T-11.1, T-29.1, T-29.2, T-35.1, T-35.5, T-40.1 | research.md S-2/S-3 (D), env-schema.test.ts, feature-requirements.test.ts, load.test.ts, server.test.ts, github.test.ts, connect.test.ts, platform.test.ts, mcp route.test.ts, real-server.spec.ts (E) | ee815d5, 3af8b69, 9df796f, 7c3c3f9, c710007 |
| 1.8 | C5 | T-1.2, T-1.3, T-2.1, T-9.2, T-9.5, T-10.2, T-10.4, T-11.1, T-40.1 | research.md S-2/S-3 (D), env-schema.test.ts, feature-requirements.test.ts, load.test.ts, allow-list.test.ts, connect.test.ts, mcp route.test.ts, real-server.spec.ts (E) | ee815d5, 3af8b69, 7c3c3f9, c710007 |
| 1.9 | C5 | T-1.2, T-1.4, T-2.1, T-2.2, T-9.4, T-11.3 | research.md S-6 (D), env-schema.test.ts, feature-requirements.test.ts, load.test.ts, gateway.test.ts, github.test.ts | ee815d5, 3af8b69, 7c3c3f9 |
| 1.10 | C5, C13, C14 | T-9.5, T-10.1, T-10.2, T-10.3, T-11.3, T-29.1, T-29.2, T-35.3 | connect.test.ts, m3-scenarios.test.ts, platform.test.ts, mcp route.test.ts | 7c3c3f9, c710007 |
| 1.11 | C3, C16 | T-4.1, T-4.6, T-4.7, T-7.1, T-8.3, T-9.3 | description-check.test.ts, define-tool.test.ts, tools.test.ts, adapt.test.ts | 70dd437, 077c51e, 4121998, 9df796f, 7c3c3f9 |
| 1.12 | C3, C4, C13 | T-4.5, T-4.8, T-8.3, T-10.1, T-10.5, T-29.1, T-38.1, T-38.5, T-39.1, T-40.1 | high-level-compare.test.ts, tools.test.ts, m3-scenarios.test.ts, mcp/compare route.test.ts | 70dd437, 9df796f, c710007 |
| 1.13 | C3 | T-4.4, T-4.8, T-8.3 | short-id.test.ts, think-tool.test.ts, tools.test.ts | 70dd437, 9df796f |
| 1.14 | C3 | T-4.4, T-4.8, T-10.4 | short-id.test.ts, think-tool.test.ts, mcp/chat route.test.ts | 70dd437, c710007 |
| 1.15 | C1, C5, C13 | T-2.1, T-9.5, T-10.3, T-10.4, T-29.1 | env-schema.test.ts, feature-requirements.test.ts, load.test.ts, connect.test.ts, mcp route.test.ts | 3af8b69, 7c3c3f9, c710007 |
| 1.16 | C2, C4, C5, C16 | T-1.3, T-4.7, T-6.2, T-8.3, T-9.1, T-9.3, T-11.2, T-21.4, T-40.1 | research.md S-2/S-3 (D), define-tool.test.ts, check-repo-rules.test.mjs, tools.test.ts, risk.test.ts, adapt.test.ts | 70dd437, 077c51e, 4121998, 9df796f, 7c3c3f9, 2432c19 |
| 1.17 | C4, C5, C16 | T-1.4, T-6.2, T-8.3, T-8.4, T-9.1, T-9.5, T-10.4, T-11.2, T-29.1, T-40.1 | research.md S-6 (D), check-repo-rules.test.mjs, server.test.ts, risk.test.ts, connect.test.ts, mcp/chat route.test.ts | 077c51e, 9df796f, 7c3c3f9, c710007, 2432c19 |

**検証の計画**（plan より）

- 1.1: G（`checkDescription`、M1 の 5 ツールと M3 のツールの検査、MCP 由来のツールの `checkJsonSchemaDescription` と上書き）、D（文言の品質）
- 1.2: G（`formatInputGuide`、本体が実行されないこと）
- 1.3: G（分類、ラッチ後の非実行、停止理由 `error`、`generate` / `stream`、MCP 経由の `classifyMcpToolResult`）、E（`finish` の表示）
- 1.4: G（相対パスの拒否）
- 1.5: G（兄弟ディレクトリ、シンボリックリンク、`..`、許可ルートを含む文言、MCP 経由で停止理由が `error` になること）
- 1.6: G（`concise` の切り詰めと全文の案内）
- 1.7: G（同一プロセスの stdio、自作サーバーの注釈）、E（実サーバーで `/mcp` が自作サーバーを起動）
- 1.8: G（許可リストのツールだけの登録、`schemas` の組み立て）
- 1.9: G（トークンの有無、`Authorization` ヘッダ、値が漏れないこと、説明文の上書きを持つ読み取り専用ツールが登録されること）、D（S-6 と実機のハンズオンの記録）
- 1.10: G（接続失敗・切断のステータスと通知）、E（通知の表示）
- 1.11: G（見出し行の検査）、D（文言の品質）
- 1.12: G（高水準ツール、`compareApproaches`）、L（ステップ数・トークン数の実測比較）
- 1.13: G（`ShortIdIndex`、UUID が出力に現れないこと）
- 1.14: G（有効・無効の切り替え、内容を保持しないこと）
- 1.15: G（20 個の許容と 21 個の起動時拒否、MCP を含む）
- 1.16: G（`risk` の必須、MCP の写像、既存規則 `tool-risk-declared`）
- 1.17: G（`write` / `destructive` が登録されないこと、`disabled` の理由、リクエストの拒否）


## Requirement 2: ヘルプデスク・エージェント（REQ-002）

| Requirement | Design | Task | Test | Commit |
|---|---|---|---|---|
| 2.1 | C10 | T-12.1, T-12.4, T-13.2, T-14.1, T-15.1, T-15.3, T-37.2, T-40.2, T-40.7, T-40.8 | plan-schema.test.ts, planner.test.ts, ticket-store.db.test.ts, helpdesk.test.ts, api/helpdesk/route.test.ts | 1a0ff4c, 2f07038, 7f1351f |
| 2.2 | C10 | T-12.2, T-12.6, T-14.1, T-16.1, T-40.2 | scheduler.test.ts, run.test.ts, helpdesk.test.ts, check-repo-rules.test.mjs | 1a0ff4c, dea6909 |
| 2.3 | C10 | T-12.1, T-12.5, T-13.2, T-14.1, T-15.1, T-15.3, T-15.4, T-16.1, T-30.1, T-40.2 | plan-schema.test.ts, replanner.test.ts, ticket-store.db.test.ts, helpdesk.test.ts, api/helpdesk/**/route.test.ts | 1a0ff4c, 2f07038, 7f1351f, dea6909 |
| 2.4 | C1, C10 | T-2.1, T-12.6, T-13.2, T-14.1, T-15.3, T-30.1, T-40.2 | env-schema.test.ts, feature-requirements.test.ts, load.test.ts, helpdesk tests (ticket-store.db.test.ts, helpdesk.test.ts, plan-schema.test.ts, planner.test.ts) | 3af8b69, 1a0ff4c |
| 2.5 | C13, C14 | T-15.2, T-15.3, T-30.1, T-30.2, T-35.2, T-35.3, T-36.1 | domain-stream.test.ts, api/helpdesk/route.test.ts | 7f1351f |
| 2.6 | C10 | T-13.1, T-13.2, T-14.1, T-15.2, T-15.3, T-15.4, T-16.2, T-30.1, T-30.2, T-37.2, T-40.2 | schema.db.test.ts, client.pg.test.ts (PG), ticket-store.db.test.ts, helpdesk.test.ts, domain-stream.test.ts, api/helpdesk/**/route.test.ts | 1a0ff4c, 7f1351f |
| 2.7 | C10 | T-13.1, T-13.2, T-14.1, T-15.3, T-15.4, T-30.1, T-30.2, T-37.2, T-40.2 | schema.db.test.ts, client.pg.test.ts (PG), ticket-store.db.test.ts, helpdesk.test.ts, api/helpdesk/**/route.test.ts | 1a0ff4c, 7f1351f |
| 2.8 | C10 | T-12.3, T-13.2, T-14.1, T-15.3, T-40.2 | credentials.test.ts, ticket-store.db.test.ts, helpdesk.test.ts, api/helpdesk/route.test.ts | 1a0ff4c, 7f1351f |
| 2.9 | C10, C15, C16 | T-13.3, T-13.4 | seed.db.test.ts; `mise run seed:samples` twice on Docker Postgres (5 added, then 0) | 1a0ff4c, b67826d |
| 2.10 | C10 | T-2.1, T-12.1, T-12.4, T-14.1, T-15.3, T-16.1, T-40.2 | env-schema.test.ts, feature-requirements.test.ts, load.test.ts, helpdesk tests (ticket-store.db.test.ts, helpdesk.test.ts, plan-schema.test.ts, planner.test.ts) | 3af8b69, 1a0ff4c |

**検証の計画**（plan より）

- 2.1: G（計画の構造化出力）、DB（改訂 0 の保存）
- 2.2: G（`nextRunnable`、依存未完了のタスクを実行しない）
- 2.3: G（`decideNext` の 3 値、`diffPlan`、ID の保持）、DB（改訂の追記）
- 2.4: G（ステップ上限の境界、未完了タスクの一覧）
- 2.5: G（状態変化ごとの `data-helpdesk-plan` の順序）、E（3 項目の表示）
- 2.6: DB（`resolved` と回答の保存、CHECK 制約）
- 2.7: DB（`escalated` と理由）、G
- 2.8: G（形状検出、再作成 1 回、値が出力されないこと）、DB（検出時に保存されないこと）
- 2.9: DB（初期投入の冪等）、G（`seed:samples` の入口）
- 2.10: G（循環・存在しない依存・空、再生成 2 回）、DB（`escalated`）


## Requirement 3: データ分析エージェント（REQ-003）

| Requirement | Design | Task | Test | Commit |
|---|---|---|---|---|
| 3.1 | C6, C7, C13 | T-1.2, T-1.5, T-1.6, T-6.1, T-17.4, T-17.7, T-17.8, T-18.4, T-19.6, T-20.1, T-35.5, T-39.2, T-40.3, T-40.7, T-40.8 | research.md S-4 (D), research.md S-5 (D), provider.test.ts, mock.test.ts, agent.test.ts, analysis route.test.ts, real-server.spec.ts (E) | ee815d5, 077c51e, 8510c68, 0114cd7, 748cd84 |
| 3.2 | C6, C16 | T-1.5, T-1.6, T-6.1, T-6.2, T-6.3, T-17.4, T-17.5, T-17.6, T-17.7, T-17.8, T-20.2, T-40.3 | research.md S-4 (D), research.md S-5 (D), check-repo-rules.test.mjs, check-client-bundle.test.mjs, provider.test.ts, provider.container.test.ts (C), engine.test.ts, tar.test.ts, check-repo-rules.test.mjs | 077c51e, 8510c68 |
| 3.3 | C7 | T-18.3, T-18.4, T-18.5, T-38.2, T-39.1, T-40.3 | attempts.test.ts, run-python-tool.test.ts, agent.test.ts, scenarios.test.ts | 0114cd7 |
| 3.4 | C2, C7 | T-3.3, T-18.3, T-18.4, T-31.1, T-35.3, T-40.3 | guarded-agent.test.ts, run-python-tool.test.ts, agent.test.ts, analysis route.test.ts | 70dd437, 0114cd7, 748cd84 |
| 3.5 | C7, C13, C14 | T-18.2, T-18.4, T-19.4, T-19.6, T-20.2, T-31.2, T-31.3, T-35.2, T-35.3, T-36.1, T-40.3 | output-parser.test.ts, prelude.test.ts, domain-stream.test.ts, analysis route.test.ts | 0114cd7, 748cd84 |
| 3.6 | C7, C14 | T-18.3, T-18.4, T-19.4, T-19.6, T-31.1, T-31.3, T-35.3 | attempts.test.ts, agent.test.ts, domain-stream.test.ts, analysis route.test.ts | 0114cd7, 748cd84 |
| 3.7 | C6, C13 | T-2.1, T-17.3, T-19.3, T-19.6, T-19.7, T-20.1, T-31.3, T-40.3 | env-schema.test.ts, feature-requirements.test.ts, load.test.ts, lifecycle.test.ts, sessions.test.ts, analysis route.test.ts, sessions/[id]/route.test.ts, real-server.spec.ts (E) | 3af8b69, 8510c68, 748cd84 |
| 3.8 | C6, C13, C14 | T-1.5, T-1.6, T-2.1, T-2.2, T-17.2, T-17.6, T-17.7, T-17.8, T-19.1, T-19.5, T-19.6, T-20.3, T-31.1, T-31.3, T-35.3, T-35.5, T-39.2, T-40.3, T-41.1, T-41.2, T-41.4 | research.md S-4 (D), research.md S-5 (D), env-schema.test.ts, feature-requirements.test.ts, load.test.ts, gateway.test.ts, select.test.ts, local.test.ts, probe.test.ts, platform.test.ts, status/route.test.ts | 3af8b69, 8510c68, 748cd84 |
| 3.9 | C7, C13 | T-2.1, T-18.1, T-19.2, T-19.6, T-20.2, T-31.1, T-40.3, T-42.1, T-42.2 | env-schema.test.ts, feature-requirements.test.ts, load.test.ts, upload-check.test.ts, upload.test.ts, analysis route.test.ts | 3af8b69, 0114cd7, 748cd84 |
| 3.10 | C6, C15 | T-6.1, T-6.4, T-17.1, T-18.4, T-18.5 | m3-scenarios.test.ts, mock.test.ts, scenarios.test.ts, m3-scenarios.test.ts | 077c51e, 8510c68, 0114cd7 |

**検証の計画**（plan より）

- 3.1: G（疑似提供者での分析）、C（実 Docker で分析スクリプトが動く）、D（E2B のハンズオン）
- 3.2: G（規則 `sandbox-import-scope`、ホストで実行する経路が無いこと）、C（ネットワークなし・読み取り専用ルート）
- 3.3: G（3 回の修正、成功で停止）、L（実モデルの修正）
- 3.4: G（4 回目を実行しない、`attempt-limit`、最後のコードと履歴）、E
- 3.5: G（`parseSandboxOutput`、PNG のマジックバイト、行数上限）、E（`alt` 付きの画像と表の描画）
- 3.6: G（コード・標準出力・エラー・修正回数のイベント）、E
- 3.7: G（アイドル 10 分の境界、明示解放の冪等、接続断での破棄）
- 3.8: G（選択の順序: E2B → Docker → 無効）、C（実ソケットの疎通）、E（無効時の案内）、D（macOS のソケット）
- 3.9: G（拡張子、マジックバイト、20 MB の境界、申告と実体の不一致、サンドボックスが起動しないこと）
- 3.10: G（疑似提供者で 3.3〜3.6 を検証）


## Requirement 4: 階層型リサーチエージェント（REQ-004）

| Requirement | Design | Task | Test | Commit |
|---|---|---|---|---|
| 4.1 | C9 | T-22.3, T-22.4, T-40.4, T-40.7, T-40.8 | subagents.test.ts, supervisor.test.ts | 122c075 |
| 4.2 | C9, C13 | T-22.4, T-22.5, T-23.3, T-23.4, T-32.2, T-38.3, T-39.1 | supervisor.test.ts, scenarios.test.ts, research/route.test.ts | 122c075, 71a9b90 |
| 4.3 | C8 | T-1.2, T-21.1, T-21.3, T-21.4, T-23.1, T-23.4 | parse.test.ts, client.test.ts, tools.test.ts, platform.test.ts, arxiv-fixtures.test.ts | ee815d5, 122c075, 71a9b90 |
| 4.4 | C9 | T-22.3, T-40.4 | subagents.test.ts | 122c075 |
| 4.5 | C9 | T-22.2, T-22.4, T-22.5, T-24.1, T-32.1, T-38.3, T-40.4 | citations.test.ts, supervisor.test.ts, scenarios.test.ts | 122c075 |
| 4.6 | C9 | T-22.3, T-22.4, T-23.3, T-32.1, T-40.4 | subagents.test.ts, supervisor.test.ts, research/route.test.ts | 122c075, 71a9b90 |
| 4.7 | C8 | T-2.1, T-21.2, T-21.3, T-23.1, T-24.2, T-40.4 | env-schema.test.ts, feature-requirements.test.ts, load.test.ts | 3af8b69 |
| 4.8 | C1, C9 | T-2.1, T-22.1, T-22.3, T-22.4, T-23.3, T-24.1, T-32.1, T-32.2, T-37.3, T-40.4 | env-schema.test.ts, feature-requirements.test.ts, load.test.ts | 3af8b69 |
| 4.9 | C9, C13, C14 | T-5.2, T-22.4, T-23.2, T-23.3, T-32.1, T-32.2, T-35.2, T-35.4 | observer.test.ts | efcde0d |
| 4.10 | C9, C14 | T-2.1, T-5.1, T-5.2, T-22.1, T-22.4, T-23.2, T-23.3, T-32.1, T-35.4, T-40.4 | env-schema.test.ts, feature-requirements.test.ts, load.test.ts, token-ledger.test.ts, observer.test.ts | 3af8b69, efcde0d |

**検証の計画**（plan より）

- 4.1: G（3 つのサブエージェントが入力スキーマ付きツールとして呼べること）
- 4.2: G（`mock` の完走、Markdown のレポート）、L（実モデルの呼び分け）、E
- 4.3: G（Atom のパース、各項目、1 件のみ・空・エラーのフィード）
- 4.4: G（Supervisor に返るのが要約だけで、内部のトランスクリプトを含まないこと）
- 4.5: G（`checkCitations`: 集合に無い ID とリンクの除去、警告、全論文に ID が付くこと）
- 4.6: G（子の失敗が `missing` に入り、残りでレポートが作られ、欠落の観点が明記されること）
- 4.7: G（待機を挟む最大 3 回の再試行、`Retry-After`、間隔 3 秒、同時 1 接続、キャッシュ）
- 4.8: G（呼び出し回数の上限、残量 0 の子を実行しないこと）
- 4.9: G（`agent` 付きのイベントの順序）、E（Agent Inspector の区別表示）
- 4.10: G（`TokenLedger` の内訳と合計の一致）、E（内訳の表示）


## Requirement 5: 要件定義書生成エージェント（REQ-005）

| Requirement | Design | Task | Test | Commit |
|---|---|---|---|---|
| 5.1 | C11, C13 | T-2.1, T-25.2, T-27.1, T-27.4, T-33.2, T-40.5, T-40.7, T-40.8 | env-schema.test.ts, feature-requirements.test.ts, load.test.ts | 3af8b69 |
| 5.2 | C11, C13, C14 | T-25.3, T-27.4, T-27.5, T-33.2, T-40.5 |  |  |
| 5.3 | C11, C13, C14 | T-25.1, T-25.3, T-27.1, T-27.3, T-27.5, T-33.1, T-33.2, T-35.2, T-35.4, T-40.5 |  |  |
| 5.4 | C11 | T-25.3, T-27.1, T-27.3, T-27.5, T-28.2, T-33.1, T-40.5 |  |  |
| 5.5 | C11 | T-2.1, T-25.1, T-25.3, T-27.5, T-40.5 | env-schema.test.ts, feature-requirements.test.ts, load.test.ts | 3af8b69 |
| 5.6 | C11 | T-25.4, T-27.5, T-40.5 |  |  |
| 5.7 | C11, C13, C14 | T-27.6, T-33.1, T-35.4 |  |  |

**検証の計画**（plan より）

- 5.1: G（ペルソナの構造化出力、件数の設定）、E
- 5.2: G（ペルソナごとの質問、対話の進行）、E
- 5.3: G（回答ごとの要件抽出と `data-requirements-preview`）、E（プレビューの更新）
- 5.4: G（十分性の判定、`sufficient: true` かつ `missing` 非空を不十分とすること）
- 5.5: G（不足項目に焦点を当てた追加質問、上限未満での継続）
- 5.6: G（固定の章立て、上限到達時の「未確認事項」の列挙）、D
- 5.7: G（Markdown のダウンロード、固定のファイル名）、E


## Requirement 6: マーケティング支援エージェント（REQ-006）

| Requirement | Design | Task | Test | Commit |
|---|---|---|---|---|
| 6.1 | C12 | T-26.1, T-26.5, T-27.7, T-34.2, T-40.6, T-40.7, T-40.8 |  |  |
| 6.2 | C12 | T-2.1, T-26.4, T-26.5, T-27.1, T-27.3, T-27.7, T-28.1, T-34.1, T-38.4, T-39.1, T-40.6 | env-schema.test.ts, feature-requirements.test.ts, load.test.ts | 3af8b69 |
| 6.3 | C12, C13, C14 | T-26.1, T-26.5, T-27.3, T-27.7, T-34.1, T-34.2, T-35.2, T-35.4 |  |  |
| 6.4 | C12, C13, C14 | T-26.6, T-26.7, T-27.1, T-27.3, T-27.8, T-34.1, T-34.2, T-35.2, T-35.4, T-40.6 |  |  |
| 6.5 | C12 | T-26.2, T-26.3, T-26.7, T-27.2, T-27.3, T-27.8, T-28.1, T-34.2, T-37.4, T-40.6, T-42.2 |  |  |
| 6.6 | C12, C15, C16 | T-26.2, T-26.3, T-27.2, T-27.9 |  |  |

**検証の計画**（plan より）

- 6.1: G（`cooperateByRole` のラウンドロビン、他者の発言を踏まえること）
- 6.2: G（ラウンドごとの合意判定、最大ラウンド、終了理由）、L（合意に達する割合の観察）
- 6.3: G（ペルソナ名付きの `data-council-turn`）、E
- 6.4: G（プロファイルの逐次抽出とマージ）、E（プロファイルとレコメンドの更新）
- 6.5: G（カタログ外 ID の除去と `dropped`）、DB（商品の照合）
- 6.6: DB（初期投入の冪等）、G（`seed:samples` の入口）

## Gaps

- 未対応の要件: なし（全 60 の受け入れ基準が 1 つ以上のサブタスクに対応する。生成時に機械的に確認した）。
- 受け入れ基準を持たないタスク: 1.1〜1.6（spike）、4.8、6.x、各波の締め（7.x、11.2〜11.3、16.x、20.x、24.x、28.x、36.1、42.x）は基盤・結線・検証のタスクで、対応する受け入れ基準は `_Requirements:_` に示した。
- **gate が保証しないもの**（41.1 で確定し、各解説の「確認できていないこと」に書く）: E2B の実機の挙動と外向き通信の既定（S-4、CL-21）、GitHub の公式ホスト型 MCP のエンドポイントとツールの注釈（S-6）、実 Docker での隔離と macOS のソケット（S-5、`*.container.test.ts`）、実モデルの品質（修正ループの成功率、Supervisor の呼び分け、合意に達する割合）、arXiv の実応答と 429 / 503 / `Retry-After` の実挙動、複数インスタンスにまたがる arXiv の速度制限、利用者ごとの認証（005 の境界）。
- **W3 の出荷時点（2026-10-18）の持ち越し**: 2.5 の「状態変化から 1 秒以内」は gate では書き出しの即時性（順序と回数）までの検証で、画面での確認は W7（30.x、35.x）。2.6・2.7 の Docker Postgres での検証（`client.pg.test.ts`）は実行済み。W3 の修正後の fresh な再レビューは未実施（`.sdd/reviews/003-domain-agents-impl-w3-review-2026-10-18.md`）。`test:mutation` の全体は未実行（対象の 2 ファイルは 91.41）。
- **plan の記載漏れ**（tasks.md の Boundary の例外 (4)）: `packages/ai-core/src/rag/db/client.pg.test.ts` は plan の Test Strategy が言及するが File Structure Plan に載っていない。13.1・26.2 が M2 の既存ファイルへ 1 ケースを足すだけに限って触れる。
- **plan の波の割り当てからの調整**: `docs:check` の必須トピックを W1 から W8（40.8）へ、`sessions.ts`・`upload.ts` を W4（19.2、19.3）へ移した（理由は `tasks.md`）。
- **W4 の出荷時点（2026-10-18）の持ち越し**: W4 の敵対的レビュー（`.sdd/reviews/003-domain-agents-impl-w4-review-2026-10-18.md`）の修正後の fresh な再レビューは未実施。CL-26（修正回数の数え方）は ★ で人の確認が未了。F-14・F-15 は受け入れた制限、F-17 は 004 へ。3.5・3.6 の画面での描画は W7（35.x）、3.3 の実モデルの修正は `local`（L）で未確認、E2B の実機は D で未確認。
- **W5 の出荷時点（2026-10-19）の持ち越し**: W5 の敵対的レビュー（`.sdd/reviews/003-domain-agents-impl-w5-review-2026-10-19.md`）の修正後の fresh な再レビューは未実施。arXiv の実応答と 429 / 503 / `Retry-After` の実挙動は未実測（フィクスチャは仕様と推測に基づく）。
- **004 への引き継ぎ**: E2B の外向き通信（CL-21）、外部コンテンツの汚染状態（CL-10）、MCP の注釈を信頼しない前提（ADR-7）。`tasks.md`「004 への引き継ぎ事項」と 40.3 に記録する。
