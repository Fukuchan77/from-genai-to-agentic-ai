# rag-and-workflows（Milestone 2）— 実装タスク（索引）

`/sdd-tasks` が生成した。承認済みの [spec.md](spec.md)（WHAT）と [plan.md](plan.md)（HOW、C1〜C18、Implementation Waves W1〜W6）から、
実装の波ごとに分割した。ルールは `~/.claude/sdd/rules/tasks-generation.md` と `~/.claude/sdd/rules/tasks-parallel-analysis.md`
に従う。並列モード（`--sequential` 未指定）。001 の `tasks.md` と同じ運用（索引 + 現在の波の全文、未着手の波は `tasks-wN.md`、
完了した波は `tasks-comp-wN.md`）を採る。

## ファイル構成

| ファイル | 内容 |
|---|---|
| `tasks.md`（本ファイル） | 表記規約、ID 対応表、進捗、gate への段階的な結線、**現在の波（W6）**のタスク全文 |
| `tasks-comp-w1.md`〜 | 完了した波の保管先（W1〜W5 完了）。波の完了時に作る |
| `traceability.md` | 要件 → 設計 → タスク → テスト → コミット（Test と Commit は `/sdd-ship` が埋める） |

タスク番号は全ファイルで一意で、移動しても変えない。`_Depends:_` と `traceability.md` は、ファイルをまたいで
番号だけで参照する。

### 完了した波の移行手順

001 の `tasks.md`「完了した波の移行手順」と同じである（2 つのコミットに分け、1 つ目は `git mv tasks.md tasks-comp-wN.md` だけ、
2 つ目は `git mv tasks-w(N+1).md tasks.md` の後に索引の節を移す）。移行の条件は次のとおり。

1. その波の全サブタスクが `[x]` で、各大タスクの Implementation Notes が記入済みである。
2. 波の締めのタスク（下記「gate への段階的な結線」）が完了し、`mise run gate` と CI の `ci-status` が成功している。
3. その波の敵対的レビュー（憲章 原則 9。新規コンテキストで `sdd-reviewer` と `adversarial-review` skill）の記録が
   `.sdd/reviews/002-rag-and-workflows-impl-wN-review-YYYY-MM-DD.md`（1 ラウンド 1 ファイル）にあり、指摘への対応が追記されている。

## 表記規約

- `- [ ]` 未着手、`- [x]` 完了、`- [ ]*` 任意・後回し可のテスト（この spec では使っていない）。
- `(P)` = 並列実行可（依存なし・境界の重複なし）。同じ波の中で、依存関係の同じ段にあるタスクの間でだけ付ける。
- 各タスク（大タスク・サブタスクの両方）は `_Boundary:_`、`_Depends:_`、`_Requirements:_`、`_Traces:_` を必ず持つ。
- **テスト先行（憲章 原則 4）**: 実装を含むサブタスクは、対応するテストファイルを同じ `_Boundary:_` に含め、RED（失敗の確認）→
  GREEN → REFACTOR を 1 つのサブタスクの中で行う。設定・文書・ガイドなど単独のテストを持たないサブタスクは、検証手段を
  `_Verify:_` に書く。
- `_Requirements:_` は spec.md の受け入れ基準番号（例: `1.1`）を数値のみでカンマ区切りに列挙する。基盤の作業で対応する
  受け入れ基準が plan の部品表（`Requirements` 行）にあるものは、それを書く。
- `_Traces:_` は安定リンク ID を持つ。この spec は `spec.md`/`plan.md` に `REQ-###`/`DES-#.#` 形式の見出しを持たないため、
  下記の対応表で実在する見出しに固定する（001 と同じ扱い）。
- 各大タスクの末尾の `### Implementation Notes` は生成時は空。大タスクの完了後に、実装者が学びを 1〜3 項目追記する。
- **Boundary の対象**: plan の File Structure Plan にあるファイルに限る。次の例外だけを許す。(1) 生成物 `pnpm-lock.yaml`
  （1.1）。(2) `specs/002-rag-and-workflows/` 配下の spec 文書（`research.md` への実測の追記、`traceability.md`）。
  (3) plan C1「既知の影響」が明示する、`mock:judge-v1` の追加で影響を受ける `apps/web` の既存テスト（2.2 の RED で特定）。
- **共有ファイルの編集者**: `mise.toml` は 1.2（`client-bundle` のセンチネル）と各波の締めのタスクだけが編集する。
  `stryker.config.mjs` は各波の締めのタスクだけが編集する。`packages/ai-core/package.json` は 1.1 だけが編集する（`exports` の
  4 サブパス `./structured`、`./rag`、`./workflows`、`./patterns` を含む。参照先の `index.ts` は各領域の最初のタスクが作る）。
  `packages/ai-core/src/models/gateway.ts` の `mock` 既定シナリオへの追加は、シナリオを作る 14.2（M2-1/M2-2）と 18.1・18.2（M2-3/M2-4）だけが行う。
  `packages/ai-core/src/rag/index.ts` は 8.3（初期）と 13.4（最終）、`apps/web/lib/server/platform.ts` は 8.4 と 15.1 だけが編集する。

### ID 対応表

| ID | 対応する見出し |
|---|---|
| `REQ-001`〜`REQ-004` | spec.md の `### Requirement 1`〜`### Requirement 4`（要件グループ単位。受け入れ基準単位の詳細は `_Requirements:_` を見る） |
| `C1`〜`C18` | plan.md の `### C_N <名前>`（実在する見出し。`DES-#.#` の代わりにこの一次 ID を使う。001 の `C1`〜`C22` とは別の番号） |
| `CL-1`〜`CL-12` | plan.md「Clarifications」の決定 |
| `ADR-1`〜`ADR-12`、`R-1`/`R-2` | research.md の決定とリスク |

## 進捗

| 波 | 大タスク | 状態 | ファイル |
|---|---|---|---|
| W1 基盤 | 1 依存と設定ファイル、2 設定・カタログ・ゲートウェイの拡張、3 共通部品（Rerank ポート、`generateValidated`）、4 リポジトリ検査 | 完了（2026-10-12 に移行） | [tasks-comp-w1.md](tasks-comp-w1.md) |
| W2 ナレッジベース | 5 DB 層、6 取り込みの部品、7 埋め込みとストア、8 取り込みの組み立てと HTTP 入口、9 コーパスと実サーバー確認 | 完了（2026-10-12 に移行） | [tasks-comp-w2.md](tasks-comp-w2.md) |
| W3 検索・回答・Agentic | 10 検索パイプライン、11 回答と引用、12 Agentic RAG、13 RAG の評価、14 評価データとシナリオ、15 RAG の HTTP 入口 | 完了（2026-10-12 に移行） | [tasks-comp-w3.md](tasks-comp-w3.md) |
| W4 ワークフロー・パターン | 16 ワークフロー、17 エージェントデザインパターン、18 シナリオとデモ、19 ワークフローの HTTP 入口 | 完了（2026-10-13 に移行） | [tasks-comp-w4.md](tasks-comp-w4.md) |
| W5 画面と E2E | 20 RAG 画面の部品、21 ワークフロー画面の部品、22 ページ、23 E2E | 完了（2026-10-13 に移行） | [tasks-comp-w5.md](tasks-comp-w5.md) |
| W6 評価・解説・統合 | 24 評価テスト、25 `local` での実測、26 解説、27 トレーサビリティ・ステアリング、28 最終統合 | 未着手（現在の波） | 本ファイル |

**波の依存**（plan「Implementation Waves」）: W2 は W1 に、W3 は W2 に、W5 は W3 と W4 に、W6 は W5 に依存する。W4 は W1 のみに依存するため
W2・W3 と並行できるが、W3 と W4 は `gateway.ts`・`mock/index.ts`・`src/mock/m2-scenarios.test.ts` を共有するので、シナリオとデモのタスク
（18）は 14.2 の後に行う。関数そのもののタスク（16、17）は W2・W3 と並行してよい。

**plan の波の割り当てからの調整**: コーパス 6 本（plan では W3）を W2 の 9.1 に前倒しした。W2 の実サーバー確認（リスク R-1）が
「取り込み → 検索」を通すにはコーパスが要るためである。ラベル付き質問セット（`eval-set.json`）は plan のとおり W3 の 14.1 で、コーパスを固めた後に書く。
完成タグ（`module/2-1`〜`2-4`）は、解説の完成後に W6 の 28.3 でローカルに付け、push は人が行う。

## gate への段階的な結線

gate の各段は「走査 0 件で失敗」するため、検査対象がまだない規則を最初から入れると、実装の途中で必ず失敗する（001 と同じ）。
規則そのものは W1 の 4.1 で実装して単体テストで守り、`mise.toml` の `check:repo-rules --only` へは、走査対象が揃う波の締めで加える。
一度加えた規則は外さない。`gate` の段の順序は変えない（plan C17）。

| 時点 | 締めのタスク | `check:repo-rules --only` に加える規則 | その他の結線 |
|---|---|---|---|
| W1 の締め | 4.4 | `no-sql-raw`（`ai-core/src` は常に走査対象がある） | — |
| W2 の締め | 9.3 | — | `stryker.config.mjs` に `markdown.ts`、`chunk.ts`、`search-text.ts` |
| W3 の締め | 15.5 | — | `stryker.config.mjs` に `rrf.ts`、`citations.ts`、`recall.ts` |
| W4 の締め | 19.2 | `workflow-no-agent-loop`（`workflows/` と `patterns/` が揃う） | `stryker.config.mjs` に `parallelization.ts`、`evaluator-optimizer.ts` |
| W5 の締め | 23.4 | — | — |
| W6 の締め | 28.1 | — | `docs:check` は 001 から結線済み。2-1〜2-4 の解説が加わった状態で成功することを確かめる |

---

## 現在の波: W6 評価・解説・統合（大タスク 24〜28）

W5（大タスク 20〜23）は完了し [tasks-comp-w5.md](tasks-comp-w5.md) に移した。

`eval-suite` のテスト、`local` での実行と結果の記録（recall、Judge、`granite4.2` の遵守率、単一エージェントとのトークン比較）、解説 2-1〜2-4、
`phase-2.md`、トレーサビリティ、ステアリングと `AGENTS.md` の更新、`withRegeneration` の統合の要否の判断（ADR-8）、`gate:repeat`、完成タグを行う。

**`local` の結果は gate の外**であることを解説に明記する（gate の緑は算術・制御フロー・型・SQL の正しさだけを保証し、検索手法の効果の差と Judge の判定は保証しない。憲章 原則 3、11）。
Ollama や Docker を使えない環境では、実測を「未実測」と書いて「人が行うこと」に残す（憲章 原則 8。未実測を実測済みと書かない）。

24.2・24.3 は並列に進められる。25 は 24 の後、26.1〜26.4 は 25 の後に並列に進められる。27.1・27.2・27.3 は互いに独立。

---

## 24. 評価テスト（C16）

RAG の検索精度の比較と Judge を `local` 専用の Capability 評価として置き、品質ゲートで検証できる「評価の配管」を Regression として置く。
**評価は専用のインメモリ DB（PGlite）にコーパスだけを取り込んで行い、稼働中のナレッジベースと学習者の `knowledge/` には触れない**。

_Boundary:_ `packages/eval-suite/tests/regression/rag-eval-set.db.test.ts`, `packages/eval-suite/tests/capability/rag-retrieval.local.test.ts`, `packages/eval-suite/tests/capability/rag-judge.local.test.ts`, `packages/eval-suite/tests/capability/README.md`
_Depends:_ 8.1, 9.1, 10.8, 11.2, 13.1, 13.3, 14.1
_Requirements:_ 1.5, 2.2, 2.9, 2.10, 2.12
_Traces:_ REQ-002, C16

- [ ] 24.1 `tests/regression/rag-eval-set.db.test.ts`（gate）: コーパスを専用の PGlite に取り込み、質問セットが 20 問以上で、すべての正解チャンク ID が実在し、`mock` の埋め込みで「質問 = チャンク本文」のとき recall@1 が 1.0 になること（評価の配管の検証。検索手法の効果の差は主張しない）を検証する。`eval-suite` の既存の Vitest 設定（接尾辞 `test`）が `*.db.test.ts` を gate に含めることを確認する（設定の変更は不要な想定。必要なら止めて人に報告する）
  _Boundary:_ `packages/eval-suite/tests/regression/rag-eval-set.db.test.ts`
  _Depends:_ 9.1, 13.1, 14.1, 8.1
  _Requirements:_ 2.9, 2.12
  _Traces:_ REQ-002, C16
  _Verify:_ `mise run gate` で `rag-eval-set.db.test.ts` が実行され（`executed` に数えられ）、正解 ID を 1 つ壊すと落ちる（PROVE を Implementation Notes に記録）
- [ ] 24.2 (P) `tests/capability/rag-retrieval.local.test.ts`（`describeLocal`）: 手法の組み合わせ（ナイーブ、HyDE、Multi-Query、ハイブリッド、Rerank を含む組み合わせ）ごとの平均 recall@k を質問セットで比較し、結果を表で出力する。Rerank は `COHERE_API_KEY` が無ければスキップして理由を表に出す。`granite4.2` が構造化出力（Multi-Query の 3 件）を守る割合（再生成の回数）を観察として出力する（割合そのものは断定せず、パイプラインが完走することだけをアサートする）。Ollama がなければ理由付きでスキップされる
  _Boundary:_ `packages/eval-suite/tests/capability/rag-retrieval.local.test.ts`
  _Depends:_ 8.1, 10.8, 13.1, 14.1
  _Requirements:_ 2.9, 2.2
  _Traces:_ REQ-002, C16
  _Verify:_ gate では理由付きでスキップされ（合格に数えない）、`mise run test:local` で Ollama があれば実行される。`describeLocal` を外すと Ollama なしで失敗する
- [ ] 24.3 (P) `tests/capability/rag-judge.local.test.ts`（`describeLocal`）: 忠実性と回答関連性を `judgeRagAnswer` で採点する。裏付けのある回答は忠実性が `pass`、チャンクに無い内容を足した回答は `fail`、質問に答えていない回答は回答関連性が `fail` になることを、小さな固定のケースで検証する。`granite4.2` が回答の脚注を守る割合を質問セットの一部で観察として出力する。Ollama がなければ理由付きでスキップされる
  _Boundary:_ `packages/eval-suite/tests/capability/rag-judge.local.test.ts`
  _Depends:_ 11.2, 13.3, 14.1
  _Requirements:_ 2.10, 1.5
  _Traces:_ REQ-002, C16
  _Verify:_ gate では理由付きでスキップされ、`mise run test:local` で Ollama があれば実行される
- [ ] 24.4 `tests/capability/README.md`: RAG の評価の置き場所と、gate / `local` の線引き（gate が保証するのは配管、`local` だけが手法の効果の差と Judge を示す）を足す
  _Boundary:_ `packages/eval-suite/tests/capability/README.md`
  _Depends:_ 24.1, 24.2, 24.3
  _Requirements:_ 2.9, 2.10
  _Traces:_ REQ-002, C16
  _Verify:_ README の記述が 3 つのテストファイルの名前と一致する（`docs:check` の対象外なので手で確認する）

### Implementation Notes

<!-- Empty at generation. Implementer appends 1-3 bullet learnings after completing this major task. -->

---

## 25. `local` での実測と記録（C18 の前提）

`local` でしか得られない数値を実測して `research.md` に記録する。解説（26）はこの記録から数値を引く。

_Boundary:_ `specs/002-rag-and-workflows/research.md`
_Depends:_ 7.4, 18.4, 24.2, 24.3
_Requirements:_ 1.7, 2.2, 2.9, 2.10, 4.7
_Traces:_ REQ-001, REQ-002, REQ-004, C16, C18

- [ ] 25.1 実 Ollama で `mise run test:local` を実行し、手法の組み合わせごとの recall@k、Judge の採点、`granite4.2` の構造化出力の遵守（Multi-Query の 3 件の成功率）と脚注の遵守率を、research.md の末尾の「M2 実測（W6）」に表で記録する。日本語の `local` 埋め込みでの類似度の分布を再測定し、既定の閾値 0.5 の妥当性（I-8）を更新する。Ollama を使えない環境では、記録欄に「未実測」と理由を書き、「人が行うこと」に残す
  _Boundary:_ `specs/002-rag-and-workflows/research.md`
  _Depends:_ 7.4, 24.2, 24.3
  _Requirements:_ 1.7, 2.2, 2.9, 2.10
  _Traces:_ REQ-001, REQ-002, C16, C18
  _Verify:_ 記録した数値は `mise run test:local` の出力から転記したもので、実行日とモデル ID（Ollama のタグ）が併記されている
- [ ] 25.2 Role-Based Cooperation と単一エージェントのトークン使用量を、同じタスクで比較して実測する（憲章 原則 1 の根拠。`runPatternDemo("role-based-cooperation")` の役割ごとの `AgentRunSummary.usage` の合計と、M1 の `/agent`（単一エージェント + ツール）で同じタスクを実行したときの使用量を比べる）。結果を research.md の「M2 実測（W6）」に記録する。実測で単一エージェントで足りると分かっても、Role-Based Cooperation の実装は残す（plan 憲章 原則 1 の確定済みの扱い）。Ollama を使えない環境では「未実測」と書く
  _Boundary:_ `specs/002-rag-and-workflows/research.md`
  _Depends:_ 18.4, 25.1
  _Requirements:_ 4.7
  _Traces:_ REQ-004, C12, C18
  _Verify:_ 比較したタスクの入力、両方のトークン使用量、実行したモデル ID と日付が記録されている

### Implementation Notes

<!-- Empty at generation. Implementer appends 1-3 bullet learnings after completing this major task. -->

---

## 26. 解説ドキュメント（C18）

モジュール 2-1〜2-4 の解説を `docs/modules/_template.md` の必須節で書く。各解説に、「本番ではどう作るか」の節（005 Req 2。ハブのページへのリンクのみで、
文書の転載はしない。2-1・2-2 は CE、2-3 は LE・AE、2-4 は AE。文字列は `specs/curriculum/README.md` の表と一致させる。CL-12）、ハンズオン手順
（実行モードと必要なサービス — Docker の Postgres、Ollama、`COHERE_API_KEY` — を明示）、習熟度チェックリスト（テスト名を参照し、`docs:check` が実在を検証する。
`local` 専用のテストを参照する項目はスキップされうることを明記する）、元教材との対照表（「移植で諦めたもの」の列を持つ）、移植時の変更点（API・版は実測値）を置く。

_Boundary:_ `docs/modules/2-1-typescript-native-rag.md`, `docs/modules/2-2-advanced-rag.md`, `docs/modules/2-3-workflow-patterns.md`, `docs/modules/2-4-agent-design-patterns.md`, `docs/phases/phase-2.md`, `docs/modules/index.md`
_Depends:_ 4.3, 19.2, 23.4, 25.1, 25.2
_Requirements:_ 1.12, 2.9, 2.10, 3.1, 3.13, 4.8
_Traces:_ REQ-001, REQ-002, REQ-003, REQ-004, C18

- [ ] 26.1 (P) `docs/modules/2-1-typescript-native-rag.md`: RAG の取り込み・分割・埋め込み・検索・引用・Agentic RAG の解説。タスク 4.3 で定義した 2-1 の必須トピックの見出しをすべて含める。「`mock` の緑が保証しないもの」（検索の効果の差、日本語の埋め込みの品質）と、日本語の埋め込みでの閾値の限界（research I-8、25.1 の再測定値）を書く。Req 1.12 の分類（`*.db.test.ts` / `*.pg.test.ts`）とその根拠を、research.md の実測へのリンクとともに書く。ハンズオンは `local`（Ollama + Docker の Postgres）を原則とし、`mock`（PGlite）でも動くことを併記する。チェックリストは `rag/` のテスト名を参照する
  _Boundary:_ `docs/modules/2-1-typescript-native-rag.md`
  _Depends:_ 4.3, 23.4, 25.1
  _Requirements:_ 1.12
  _Traces:_ REQ-001, C18
  _Verify:_ `mise run docs:check` が成功する（必須トピック、必須節、テスト名の実在、「移植で諦めたもの」の列）
- [ ] 26.2 (P) `docs/modules/2-2-advanced-rag.md`: HyDE・Multi-Query・RRF・Rerank・ハイブリッド検索の解説と、手法の組み合わせの比較。タスク 4.3 で定義した 2-2 の必須トピックを含める。「`mock` の緑が保証しないもの」（手法の効果の差と Judge の判定は `*.local.test.ts` だけが示し、gate ではスキップされる）と、CL-1（「該当なし」の判定がベクトル検索の閾値だけで行われること）、CL-11（Rerank の失敗時のフォールバック）を書く。比較結果の数値は 25.1 の実測から引く。Rerank のハンズオンは `COHERE_API_KEY` が任意であることを明示する
  _Boundary:_ `docs/modules/2-2-advanced-rag.md`
  _Depends:_ 4.3, 23.4, 25.1
  _Requirements:_ 2.9, 2.10
  _Traces:_ REQ-002, C18
  _Verify:_ `mise run docs:check` が成功する
- [ ] 26.3 (P) `docs/modules/2-3-workflow-patterns.md`: ワークフローとエージェントの峻別、5 パターンの利点とトレードオフ（`workflow-no-agent-loop` が境界を機械的に守ること、制御フローをコードとして読めること）、LangGraph 的なグラフ抽象を使わない理由、耐久実行を扱わないこと（本番との境界）を書く。「本番ではどう作るか」は LE・AE のハブのページへのリンク。ハンズオンは `/workflows` 画面での各パターンの実行（`mock` で完走、`local`/`live` で実モデル）
  _Boundary:_ `docs/modules/2-3-workflow-patterns.md`
  _Depends:_ 23.4, 19.2
  _Requirements:_ 3.1, 3.13
  _Traces:_ REQ-003, C18
  _Verify:_ `mise run docs:check` が成功する
- [ ] 26.4 (P) `docs/modules/2-4-agent-design-patterns.md`: 18 パターンの体系と、リファレンス実装の 6 パターンの解説。**18 パターンすべてについて、リファレンス実装のどのモジュール・関数に対応するか、または解説のみで扱うかを示す対応表**（Req 4.8）を含める。LangGraph との比較。ハンズオンには、Cross-Reflection に `AI_MODEL_JUDGE`（生成側と異なるカタログ ID）の設定が必須であること（`live` の Anthropic 既定では未設定だと `invalid-request` になること。CL-5）を前提として書く。Role-Based Cooperation は、単一エージェントとのトークン使用量の比較（25.2 の実測値。未実測なら未実測と書く）を記録し、共有予算の考え方（CL-8）を書く
  _Boundary:_ `docs/modules/2-4-agent-design-patterns.md`
  _Depends:_ 4.3, 23.4, 25.2
  _Requirements:_ 4.8
  _Traces:_ REQ-004, C18
  _Verify:_ `mise run docs:check` が成功する（`2-4` の必須トピックと参照テストの実在）。対応表の行数が 18 である
- [ ] 26.5 `docs/phases/phase-2.md`（Phase 2 の成熟度の水準と、モジュール一覧）と `docs/modules/index.md`（2-1〜2-4 を「提供済み」にし、解説と完成タグへのリンクを足す）
  _Boundary:_ `docs/phases/phase-2.md`, `docs/modules/index.md`
  _Depends:_ 26.1, 26.2, 26.3, 26.4
  _Requirements:_ 4.8
  _Traces:_ REQ-004, C18
  _Verify:_ `mise run docs:check` が成功し、`index.md` のリンクがすべて実在する

### Implementation Notes

<!-- Empty at generation. Implementer appends 1-3 bullet learnings after completing this major task. -->

---

## 27. トレーサビリティ・ステアリング・判断（C18）

受け入れ基準 → テストの対応表、固定した決定のステアリングへの反映、`withRegeneration` の統合の要否の判断を記録する。

_Boundary:_ `specs/002-rag-and-workflows/traceability.md`, `.sdd/steering/tech.md`, `.sdd/steering/structure.md`, `AGENTS.md`, `specs/curriculum/changes-from-drafts.md`, `specs/002-rag-and-workflows/research.md`
_Depends:_ 19.2, 25.2, 26.5
_Requirements:_ 1.12, 2.2, 3.8, 4.8
_Traces:_ REQ-001, REQ-002, REQ-003, REQ-004, C18

- [ ] 27.1 (P) `traceability.md`: 骨格（`/sdd-tasks` が作成）の Test 列に、各受け入れ基準を検証するテストファイル（またはテスト名）を埋める。**「gate が保証しないもの」の一覧**（検索手法の効果の差、Judge の判定、`local` モデルの脚注の遵守率、実 Postgres での挙動、Cohere の実呼び出し）を節として追加し、それぞれがどのテスト（`*.local.test.ts`/`*.pg.test.ts`）または手動のハンズオンで確認されるかを書く。Commit 列は `/sdd-ship` が埋める
  _Boundary:_ `specs/002-rag-and-workflows/traceability.md`
  _Depends:_ 26.5
  _Requirements:_ 1.12
  _Traces:_ REQ-001, REQ-002, REQ-003, REQ-004, C18
  _Verify:_ 全 45 の受け入れ基準の行に Test 列が埋まっている（解説のレビューで検証するもの — 4.8 など — は「D」と書く）
- [ ] 27.2 (P) ステアリングと `AGENTS.md`: `.sdd/steering/tech.md`（DB 層 — PGlite と Postgres の二層、`drizzle-orm`、手書き SQL のマイグレーション、`drizzle-kit` を採らないこと — 、日本語の全文検索の決定、768 次元、`rag/`・`workflows/`・`patterns/`・`structured/`、新しい規則 `workflow-no-agent-loop`・`no-sql-raw`、`COHERE_API_KEY`）と `structure.md`（新しい領域の配置と「Where Things Go」）、`AGENTS.md`（プロジェクトの状態を M2 の実装済みの範囲に更新）、`specs/curriculum/changes-from-drafts.md`（M2 で実測により確定した API・設定の差分）を更新する。更新後、変更した用語の旧名と数値（規則の数 9 → 11 など）を grep で確認する
  _Boundary:_ `.sdd/steering/tech.md`, `.sdd/steering/structure.md`, `AGENTS.md`, `specs/curriculum/changes-from-drafts.md`
  _Depends:_ 26.5
  _Requirements:_ 4.8
  _Traces:_ REQ-004, C18
  _Verify:_ `grep` で旧い数値・名前（規則 9 個、M2 が「未作成」など）が残っていない
- [ ] 27.3 (P) `withRegeneration` の統合の要否の判断（ADR-8）: M1 の `summarize/retry.ts` と M2 の `generateValidated` の重複を比べ、統合するか、重複を許容するかを決めて research.md の ADR-8 に追記する。統合する場合の変更は M2 の範囲外なので、後続のタスクとして記録するだけにする（この spec では `summarize/retry.ts` を変更しない）
  _Boundary:_ `specs/002-rag-and-workflows/research.md`
  _Depends:_ 19.2, 25.2
  _Requirements:_ 2.2, 3.8
  _Traces:_ REQ-002, REQ-003, C3
  _Verify:_ ADR-8 に判断と根拠が追記されている

### Implementation Notes

<!-- Empty at generation. Implementer appends 1-3 bullet learnings after completing this major task. -->

---

## 28. 最終統合と完成タグ（C17、C18）

M2 全体の検証をまとめて行う。タグの push と、Docker の Postgres・Cohere の実キーを使う確認は人が行う。

_Boundary:_ `specs/002-rag-and-workflows/traceability.md`
_Depends:_ 27.1, 27.2, 27.3
_Requirements:_ 1.12, 4.8
_Traces:_ REQ-001, REQ-004, C17, C18

- [ ] 28.1 **W6 の締め**: `mise run gate`、`mise run gate:repeat`（10 回とも同じ判定）、`mise run test:mutation`（閾値 70）、`mise run test:coverage`（`packages/ai-core` の行カバレッジ 80%）、`mise run test:e2e`（3 エンジン、skipped 0）、`mise run check:client-bundle`、`mise run secret-scan`、`mise run audit` を実行し、結果と所要時間を Implementation Notes と traceability.md に記録する。`mise run gate` の所要時間が 5 分を超えていないこと、`docs:check` が 2-1〜2-4 を含めて成功することを確かめる。`mise run test:db` が少なくとも 1 回実行されているか（5.3、7.4）を確かめ、未実行なら「人が行うこと」として一覧にする
  _Boundary:_ `specs/002-rag-and-workflows/traceability.md`
  _Depends:_ 27.1, 27.2, 27.3
  _Requirements:_ 1.12
  _Traces:_ REQ-001, C17
  _Verify:_ 上記のコマンドがすべて成功する。失敗が M2 以前から base ブランチにあるものなら、新しいものと分けて報告する 波の敵対的レビュー（憲章 原則 9。新規コンテキストで `sdd-reviewer`）を行い、記録 `.sdd/reviews/002-rag-and-workflows-impl-w6-review-YYYY-MM-DD.md` が存在し、指摘への対応が追記されていることを確かめる（波の移行条件 3）
- [ ] 28.2 PR の `ci-status` が成功することを確かめる（PR の作成と push は人が行う。CI のジョブ構成は変えない）。成功したら、波の移行手順（`tasks.md`）に従って進捗を更新する（移行のコミットは別に行う）
  _Boundary:_ `specs/002-rag-and-workflows/traceability.md`
  _Depends:_ 28.1
  _Requirements:_ 1.12
  _Traces:_ REQ-001, C17
  _Verify:_ CI の `gate`、`secret-scan`、`audit`、`mutation`、`e2e`、`client-bundle` が成功し、`ci-status` が成功する
- [ ] 28.3 完成タグ `module/2-1`〜`module/2-4`: M2 の全タスクが完了した統合コミットに、注釈付きタグ 4 つをローカルで付ける（メッセージに、含むもの — 対応するモジュールの要件 Req 1〜4 — と、含まないもの — 実 Postgres・Cohere 実キーの人による確認が未了ならその旨 — を書く）。push は人が行う
  _Boundary:_ git タグのみ（ファイルの変更なし）
  _Depends:_ 28.1
  _Requirements:_ 4.8
  _Traces:_ REQ-004, C18
  _Verify:_ タグのコミットで `mise run gate` が成功する。`git tag -l 'module/2-*'` が 4 件を返す

### Implementation Notes

<!-- Empty at generation. Implementer appends 1-3 bullet learnings after completing this major task. -->
