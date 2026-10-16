# rag-and-workflows（Milestone 2）— 完了した実装タスク W6: 評価・解説・統合（大タスク 24〜28）

完了した波（2026-10-16 に移行）。表記規約、ID 対応表、進捗、gate への段階的な結線、完了した波の移行手順は
[tasks.md](tasks.md) を参照する。波の敵対的レビューの記録は
`.sdd/reviews/002-rag-and-workflows-impl-w6-review-2026-10-13.md`（1 ラウンド。指摘への対応を追記済み）。
コミット: `6c5ef81`、`1001e4c`、`09400e3`、`2c43957`、`eb4c23a`。完成タグ `module/2-1`〜`2-4` は `0ba762e`（ローカル。push は人が行う）。

---

## W6 評価・解説・統合（大タスク 24〜28）

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

- [x] 24.1 `tests/regression/rag-eval-set.db.test.ts`（gate）: コーパスを専用の PGlite に取り込み、質問セットが 20 問以上で、すべての正解チャンク ID が実在し、`mock` の埋め込みで「質問 = チャンク本文」のとき recall@1 が 1.0 になること（評価の配管の検証。検索手法の効果の差は主張しない）を検証する。`eval-suite` の既存の Vitest 設定（接尾辞 `test`）が `*.db.test.ts` を gate に含めることを確認する（設定の変更は不要な想定。必要なら止めて人に報告する）
  _Boundary:_ `packages/eval-suite/tests/regression/rag-eval-set.db.test.ts`
  _Depends:_ 9.1, 13.1, 14.1, 8.1
  _Requirements:_ 2.9, 2.12
  _Traces:_ REQ-002, C16
  _Verify:_ `mise run gate` で `rag-eval-set.db.test.ts` が実行され（`executed` に数えられ）、正解 ID を 1 つ壊すと落ちる（PROVE を Implementation Notes に記録）
- [x] 24.2 (P) `tests/capability/rag-retrieval.local.test.ts`（`describeLocal`）: 手法の組み合わせ（ナイーブ、HyDE、Multi-Query、ハイブリッド、Rerank を含む組み合わせ）ごとの平均 recall@k を質問セットで比較し、結果を表で出力する。Rerank は `COHERE_API_KEY` が無ければスキップして理由を表に出す。`granite4.2` が構造化出力（Multi-Query の 3 件）を守る割合（再生成の回数）を観察として出力する（割合そのものは断定せず、パイプラインが完走することだけをアサートする）。Ollama がなければ理由付きでスキップされる
  _Boundary:_ `packages/eval-suite/tests/capability/rag-retrieval.local.test.ts`
  _Depends:_ 8.1, 10.8, 13.1, 14.1
  _Requirements:_ 2.9, 2.2
  _Traces:_ REQ-002, C16
  _Verify:_ gate では理由付きでスキップされ（合格に数えない）、`mise run test:local` で Ollama があれば実行される。`describeLocal` を外すと Ollama なしで失敗する
- [x] 24.3 (P) `tests/capability/rag-judge.local.test.ts`（`describeLocal`）: 忠実性と回答関連性を `judgeRagAnswer` で採点する。裏付けのある回答は忠実性が `pass`、チャンクに無い内容を足した回答は `fail`、質問に答えていない回答は回答関連性が `fail` になることを、小さな固定のケースで検証する。`granite4.2` が回答の脚注を守る割合を質問セットの一部で観察として出力する。Ollama がなければ理由付きでスキップされる
  _Boundary:_ `packages/eval-suite/tests/capability/rag-judge.local.test.ts`
  _Depends:_ 11.2, 13.3, 14.1
  _Requirements:_ 2.10, 1.5
  _Traces:_ REQ-002, C16
  _Verify:_ gate では理由付きでスキップされ、`mise run test:local` で Ollama があれば実行される
- [x] 24.4 `tests/capability/README.md`: RAG の評価の置き場所と、gate / `local` の線引き（gate が保証するのは配管、`local` だけが手法の効果の差と Judge を示す）を足す
  _Boundary:_ `packages/eval-suite/tests/capability/README.md`
  _Depends:_ 24.1, 24.2, 24.3
  _Requirements:_ 2.9, 2.10
  _Traces:_ REQ-002, C16
  _Verify:_ README の記述が 3 つのテストファイルの名前と一致する（`docs:check` の対象外なので手で確認する）

### Implementation Notes

- 24.1: PROVE — a gold ID changed in `eval-set.json` fails two tests (`only labels chunk IDs that exist…`, `returns every gold chunk first…`: "gold chunk … is missing"); a question that is not the chunk body fails the recall@1 test (`expected true to be false` on `noEvidence`). First RED was my own bug (`chunk.id` on a `ScoredChunk`, which wraps `chunk`), found by a debug test, not by tsc because the file was not yet type-checked. The `eval-suite` Vitest config already includes `*.db.test.ts` in the gate (`executed=8`, was 3; 7 after review F-11 removed a duplicate test); no config change.
- The first full-gate run with the new DB test failed with `Hook timed out in 10000ms` while Ollama was busy; both the new test (explicit 90 s timeouts, `afterAll` guards a missing handle) and the shared configs (`hookTimeout: 60_000` in `packages/ai-core` and the `apps/web` routes project) were hardened after `gate:repeat` run 6/10 failed the same way in existing PGlite hooks.
- 24.2/24.3 run only under `AI_TEST_RUN_MODE=local`; in the gate they report 8 skips with the reason. The comparison test took more than 60 min for 32 questions under load: it exceeded its first 1-hour timeout (recorded as failed; the comparison finished and printed its table during the next test, so its own assertions were never evaluated), so the timeout is now 3 h and `RAG_EVAL_QUESTIONS=<n>` limits the questions for a quick check (3 questions: 148 s). A `local` test must never run in `beforeAll` (it runs even when skipped): the harness is built lazily inside the first test.

---

## 25. `local` での実測と記録（C18 の前提）

`local` でしか得られない数値を実測して `research.md` に記録する。解説（26）はこの記録から数値を引く。

_Boundary:_ `specs/002-rag-and-workflows/research.md`
_Depends:_ 7.4, 18.4, 24.2, 24.3
_Requirements:_ 1.7, 2.2, 2.9, 2.10, 4.7
_Traces:_ REQ-001, REQ-002, REQ-004, C16, C18

- [x] 25.1 実 Ollama で `mise run test:local` を実行し、手法の組み合わせごとの recall@k、Judge の採点、`granite4.2` の構造化出力の遵守（Multi-Query の 3 件の成功率）と脚注の遵守率を、research.md の末尾の「M2 実測（W6）」に表で記録する。日本語の `local` 埋め込みでの類似度の分布を再測定し、既定の閾値 0.5 の妥当性（I-8）を更新する。Ollama を使えない環境では、記録欄に「未実測」と理由を書き、「人が行うこと」に残す
  _Boundary:_ `specs/002-rag-and-workflows/research.md`
  _Depends:_ 7.4, 24.2, 24.3
  _Requirements:_ 1.7, 2.2, 2.9, 2.10
  _Traces:_ REQ-001, REQ-002, C16, C18
  _Verify:_ 記録した数値は `mise run test:local` の出力から転記したもので、実行日とモデル ID（Ollama のタグ）が併記されている
- [x] 25.2 Role-Based Cooperation と単一エージェントのトークン使用量を、同じタスクで比較して実測する（憲章 原則 1 の根拠。`runPatternDemo("role-based-cooperation")` の役割ごとの `AgentRunSummary.usage` の合計と、M1 の `/agent`（単一エージェント + ツール）で同じタスクを実行したときの使用量を比べる）。結果を research.md の「M2 実測（W6）」に記録する。実測で単一エージェントで足りると分かっても、Role-Based Cooperation の実装は残す（plan 憲章 原則 1 の確定済みの扱い）。Ollama を使えない環境では「未実測」と書く
  _Boundary:_ `specs/002-rag-and-workflows/research.md`
  _Depends:_ 18.4, 25.1
  _Requirements:_ 4.7
  _Traces:_ REQ-004, C12, C18
  _Verify:_ 比較したタスクの入力、両方のトークン使用量、実行したモデル ID と日付が記録されている

### Implementation Notes

- Measured on 2026-10-13 with Ollama (see research.md "M2 実測（W6）"): hybrid recall@5 89.1% vs naive 70.8%, while HyDE (65.6%) and Multi-Query (63.5%) were *below* naive with the 8.8B local model; Multi-Query gave valid output 32/32 first time; footnotes 9/10; Judge verdicts as expected on three fixed cases.
- Default threshold 0.5 never said "no evidence" for nomic-embed-text on Japanese (out-of-scope top-1 similarity 0.627–0.746, 8/8 ≥ 0.5): worse than the I-8 pilot. Decision unchanged (documented as a weak defence); recorded rather than hidden.
- Role-Based Cooperation used ~1.26× the tokens of a single agent for a two-tool task and both were correct; the implementation stays (plan decision). Rerank rows are *unmeasured* (no `COHERE_API_KEY`) and Docker was not available: both are on the human list.

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

- [x] 26.1 (P) `docs/modules/2-1-typescript-native-rag.md`: RAG の取り込み・分割・埋め込み・検索・引用・Agentic RAG の解説。タスク 4.3 で定義した 2-1 の必須トピックの見出しをすべて含める。「`mock` の緑が保証しないもの」（検索の効果の差、日本語の埋め込みの品質）と、日本語の埋め込みでの閾値の限界（research I-8、25.1 の再測定値）を書く。Req 1.12 の分類（`*.db.test.ts` / `*.pg.test.ts`）とその根拠を、research.md の実測へのリンクとともに書く。ハンズオンは `local`（Ollama + Docker の Postgres）を原則とし、`mock`（PGlite）でも動くことを併記する。チェックリストは `rag/` のテスト名を参照する
  _Boundary:_ `docs/modules/2-1-typescript-native-rag.md`
  _Depends:_ 4.3, 23.4, 25.1
  _Requirements:_ 1.12
  _Traces:_ REQ-001, C18
  _Verify:_ `mise run docs:check` が成功する（必須トピック、必須節、テスト名の実在、「移植で諦めたもの」の列）
- [x] 26.2 (P) `docs/modules/2-2-advanced-rag.md`: HyDE・Multi-Query・RRF・Rerank・ハイブリッド検索の解説と、手法の組み合わせの比較。タスク 4.3 で定義した 2-2 の必須トピックを含める。「`mock` の緑が保証しないもの」（手法の効果の差と Judge の判定は `*.local.test.ts` だけが示し、gate ではスキップされる）と、CL-1（「該当なし」の判定がベクトル検索の閾値だけで行われること）、CL-11（Rerank の失敗時のフォールバック）を書く。比較結果の数値は 25.1 の実測から引く。Rerank のハンズオンは `COHERE_API_KEY` が任意であることを明示する
  _Boundary:_ `docs/modules/2-2-advanced-rag.md`
  _Depends:_ 4.3, 23.4, 25.1
  _Requirements:_ 2.9, 2.10
  _Traces:_ REQ-002, C18
  _Verify:_ `mise run docs:check` が成功する
- [x] 26.3 (P) `docs/modules/2-3-workflow-patterns.md`: ワークフローとエージェントの峻別、5 パターンの利点とトレードオフ（`workflow-no-agent-loop` が境界を機械的に守ること、制御フローをコードとして読めること）、LangGraph 的なグラフ抽象を使わない理由、耐久実行を扱わないこと（本番との境界）を書く。「本番ではどう作るか」は LE・AE のハブのページへのリンク。ハンズオンは `/workflows` 画面での各パターンの実行（`mock` で完走、`local`/`live` で実モデル）
  _Boundary:_ `docs/modules/2-3-workflow-patterns.md`
  _Depends:_ 23.4, 19.2
  _Requirements:_ 3.1, 3.13
  _Traces:_ REQ-003, C18
  _Verify:_ `mise run docs:check` が成功する
- [x] 26.4 (P) `docs/modules/2-4-agent-design-patterns.md`: 18 パターンの体系と、リファレンス実装の 6 パターンの解説。**18 パターンすべてについて、リファレンス実装のどのモジュール・関数に対応するか、または解説のみで扱うかを示す対応表**（Req 4.8）を含める。LangGraph との比較。ハンズオンには、Cross-Reflection に `AI_MODEL_JUDGE`（生成側と異なるカタログ ID）の設定が必須であること（`live` の Anthropic 既定では未設定だと `invalid-request` になること。CL-5）を前提として書く。Role-Based Cooperation は、単一エージェントとのトークン使用量の比較（25.2 の実測値。未実測なら未実測と書く）を記録し、共有予算の考え方（CL-8）を書く
  _Boundary:_ `docs/modules/2-4-agent-design-patterns.md`
  _Depends:_ 4.3, 23.4, 25.2
  _Requirements:_ 4.8
  _Traces:_ REQ-004, C18
  _Verify:_ `mise run docs:check` が成功する（`2-4` の必須トピックと参照テストの実在）。対応表の行数が 18 である
- [x] 26.5 `docs/phases/phase-2.md`（Phase 2 の成熟度の水準と、モジュール一覧）と `docs/modules/index.md`（2-1〜2-4 を「提供済み」にし、解説と完成タグへのリンクを足す）
  _Boundary:_ `docs/phases/phase-2.md`, `docs/modules/index.md`
  _Depends:_ 26.1, 26.2, 26.3, 26.4
  _Requirements:_ 4.8
  _Traces:_ REQ-004, C18
  _Verify:_ `mise run docs:check` が成功し、`index.md` のリンクがすべて実在する

### Implementation Notes

- The four module docs were written against `docs/modules/_template.md`; `mise run docs:check` verifies required sections/topics and that every `<!-- test: … -->` name exists (110 references over 8 documents). The 18-pattern table uses the names of Liu et al.'s catalogue (arXiv 2405.10467 v4), checked on the paper's page; 13 of 18 are implemented or covered by existing parts, 5 are explanation-only.
- "本番ではどう作るか" links use `https://github.com/Fukuchan77/vaz-agentic-ai-next/blob/main/docs/guide/<page>.md` (the form used by the root README); the pages exist in the local hub clone (checked 2026-10-13). The repository rule that compares the strings (005 Req 2.3) does not exist yet.
- Boundary amendment: `docs/README.md` (module list) and `docs/modules/1-1-dev-environment.md` (rule count 9 → 11) were also edited; both are small and recorded in traceability Gaps (review F-16, F-7).
- Model IDs must not appear in docs (`check:model-ids` scans them): the docs use `catalog: local.ollama.*`; measured model tags live in research.md only.

---

## 27. トレーサビリティ・ステアリング・判断（C18）

受け入れ基準 → テストの対応表、固定した決定のステアリングへの反映、`withRegeneration` の統合の要否の判断を記録する。

_Boundary:_ `specs/002-rag-and-workflows/traceability.md`, `.sdd/steering/tech.md`, `.sdd/steering/structure.md`, `AGENTS.md`, `specs/curriculum/changes-from-drafts.md`, `specs/002-rag-and-workflows/research.md`
_Depends:_ 19.2, 25.2, 26.5
_Requirements:_ 1.12, 2.2, 3.8, 4.8
_Traces:_ REQ-001, REQ-002, REQ-003, REQ-004, C18

- [x] 27.1 (P) `traceability.md`: 骨格（`/sdd-tasks` が作成）の Test 列に、各受け入れ基準を検証するテストファイル（またはテスト名）を埋める。**「gate が保証しないもの」の一覧**（検索手法の効果の差、Judge の判定、`local` モデルの脚注の遵守率、実 Postgres での挙動、Cohere の実呼び出し）を節として追加し、それぞれがどのテスト（`*.local.test.ts`/`*.pg.test.ts`）または手動のハンズオンで確認されるかを書く。Commit 列は `/sdd-ship` が埋める
  _Boundary:_ `specs/002-rag-and-workflows/traceability.md`
  _Depends:_ 26.5
  _Requirements:_ 1.12
  _Traces:_ REQ-001, REQ-002, REQ-003, REQ-004, C18
  _Verify:_ 全 45 の受け入れ基準の行に Test 列が埋まっている（解説のレビューで検証するもの — 4.8 など — は「D」と書く）
- [x] 27.2 (P) ステアリングと `AGENTS.md`: `.sdd/steering/tech.md`（DB 層 — PGlite と Postgres の二層、`drizzle-orm`、手書き SQL のマイグレーション、`drizzle-kit` を採らないこと — 、日本語の全文検索の決定、768 次元、`rag/`・`workflows/`・`patterns/`・`structured/`、新しい規則 `workflow-no-agent-loop`・`no-sql-raw`、`COHERE_API_KEY`）と `structure.md`（新しい領域の配置と「Where Things Go」）、`AGENTS.md`（プロジェクトの状態を M2 の実装済みの範囲に更新）、`specs/curriculum/changes-from-drafts.md`（M2 で実測により確定した API・設定の差分）を更新する。更新後、変更した用語の旧名と数値（規則の数 9 → 11 など）を grep で確認する
  _Boundary:_ `.sdd/steering/tech.md`, `.sdd/steering/structure.md`, `AGENTS.md`, `specs/curriculum/changes-from-drafts.md`
  _Depends:_ 26.5
  _Requirements:_ 4.8
  _Traces:_ REQ-004, C18
  _Verify:_ `grep` で旧い数値・名前（規則 9 個、M2 が「未作成」など）が残っていない
- [x] 27.3 (P) `withRegeneration` の統合の要否の判断（ADR-8）: M1 の `summarize/retry.ts` と M2 の `generateValidated` の重複を比べ、統合するか、重複を許容するかを決めて research.md の ADR-8 に追記する。統合する場合の変更は M2 の範囲外なので、後続のタスクとして記録するだけにする（この spec では `summarize/retry.ts` を変更しない）
  _Boundary:_ `specs/002-rag-and-workflows/research.md`
  _Depends:_ 19.2, 25.2
  _Requirements:_ 2.2, 3.8
  _Traces:_ REQ-002, REQ-003, C3
  _Verify:_ ADR-8 に判断と根拠が追記されている

### Implementation Notes

- 27.3: not merged — `withRegeneration` is a streaming async generator with a restart event and `SummaryValidationError`; `generateValidated` owns a non-streaming call and throws `StructuredOutputError`. Merging would touch the M1 public contract for ~8 duplicated lines (recorded in ADR-8, Q-2 resolved).
- 27.2: rule count 9 → 11 and the M2 areas were updated in steering/AGENTS.md. The first `grep` used only the spelling "9規則" and missed `docs/modules/1-1-dev-environment.md` ("9 規則", fixed after the wave review F-7); grep `9 *規則` as well.

---

## 28. 最終統合と完成タグ（C17、C18）

M2 全体の検証をまとめて行う。タグの push と、Docker の Postgres・Cohere の実キーを使う確認は人が行う。

_Boundary:_ `specs/002-rag-and-workflows/traceability.md`
_Depends:_ 27.1, 27.2, 27.3
_Requirements:_ 1.12, 4.8
_Traces:_ REQ-001, REQ-004, C17, C18

- [x] 28.1 **W6 の締め**: `mise run gate`、`mise run gate:repeat`（10 回とも同じ判定）、`mise run test:mutation`（閾値 70）、`mise run test:coverage`（`packages/ai-core` の行カバレッジ 80%）、`mise run test:e2e`（3 エンジン、skipped 0）、`mise run check:client-bundle`、`mise run secret-scan`、`mise run audit` を実行し、結果と所要時間を Implementation Notes と traceability.md に記録する。`mise run gate` の所要時間が 5 分を超えていないこと、`docs:check` が 2-1〜2-4 を含めて成功することを確かめる。`mise run test:db` が少なくとも 1 回実行されているか（5.3、7.4）を確かめ、未実行なら「人が行うこと」として一覧にする
  _Boundary:_ `specs/002-rag-and-workflows/traceability.md`
  _Depends:_ 27.1, 27.2, 27.3
  _Requirements:_ 1.12
  _Traces:_ REQ-001, C17
  _Verify:_ 上記のコマンドがすべて成功する。失敗が M2 以前から base ブランチにあるものなら、新しいものと分けて報告する 波の敵対的レビュー（憲章 原則 9。新規コンテキストで `sdd-reviewer`）を行い、記録 `.sdd/reviews/002-rag-and-workflows-impl-w6-review-YYYY-MM-DD.md` が存在し、指摘への対応が追記されていることを確かめる（波の移行条件 3）
- [x] 28.2 PR の `ci-status` が成功することを確かめる（PR の作成と push は人が行う。CI のジョブ構成は変えない）。成功したら、波の移行手順（`tasks.md`）に従って進捗を更新する（移行のコミットは別に行う）
  _Boundary:_ `specs/002-rag-and-workflows/traceability.md`
  _Depends:_ 28.1
  _Requirements:_ 1.12
  _Traces:_ REQ-001, C17
  _Verify:_ CI の `gate`、`secret-scan`、`audit`、`mutation`、`e2e`、`client-bundle` が成功し、`ci-status` が成功する
- [x] 28.3 完成タグ `module/2-1`〜`module/2-4`: M2 の全タスクが完了した統合コミットに、注釈付きタグ 4 つをローカルで付ける（メッセージに、含むもの — 対応するモジュールの要件 Req 1〜4 — と、含まないもの — 実 Postgres・Cohere 実キーの人による確認が未了ならその旨 — を書く）。push は人が行う
  _Boundary:_ git タグのみ（ファイルの変更なし）
  _Depends:_ 28.1
  _Requirements:_ 4.8
  _Traces:_ REQ-004, C18
  _Verify:_ タグのコミットで `mise run gate` が成功する。`git tag -l 'module/2-*'` が 4 件を返す

### Implementation Notes

- 28.1 (2026-10-14, after the review fixes): `TURBO_FORCE=true mise run gate` → exit 0 (`//:test executed=352`, `ai-core executed=1732 skipped=4`, `web executed=733`, `eval-suite executed=7 skipped=8`, `Docs: 8 module documents, 110 test references verified`); `gate:repeat` → 10/10 identical, 8m15s. `test:mutation`, `test:coverage`, `test:e2e`, `check:client-bundle`, `secret-scan`, `audit` were run on 2026-10-13 (mutation 87.03, coverage 98.39%, e2e 363 passed skipped=0); since then only eval-suite tests, docs, comments and AGENTS.md changed, so they were not re-run. `test:db` not run (no Docker): human list.
- The wave review (`.sdd/reviews/002-rag-and-workflows-impl-w6-review-2026-10-13.md`) was `REQUEST_CHANGES`; every finding has a recorded response. Renaming a test cited by a doc is caught by `docs:check` (it caught one here).
- Open for a human: 28.2 (PR/push/CI), 28.3 tags (to be placed on the integration commit after `/sdd-ship`), Req 4.7 `final` gap, `/agent` token comparison, full green retrieval run, `test:db`, Cohere.
- 28.2 (2026-10-16): PR #39 (`ci-status` and all 8 jobs success), and on `main` HEAD `0ba762e` (PR #42) all jobs incl. `ci-status` success. PRs #40/#41 ran red on main (E2E fill/hydration fixes) before #42 turned it green; the tags therefore sit on `0ba762e`, not on the #39 merge.
- 28.3 (2026-10-16): annotated tags `module/2-1`〜`2-4` placed locally on `0ba762e` (tree identical to `47bbfce`). `TURBO_FORCE=true mise run gate` on that tree → exit 0 (`//:test` 352, `ai-core` 1732 skipped=4, `web` 733, `eval-suite` 7 skipped=8, `Docs: 8 module documents, 110 test references verified`). Not pushed — push is a human step (`git push origin module/2-1 module/2-2 module/2-3 module/2-4`).
