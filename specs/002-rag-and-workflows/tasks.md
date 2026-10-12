# rag-and-workflows（Milestone 2）— 実装タスク（索引）

`/sdd-tasks` が生成した。承認済みの [spec.md](spec.md)（WHAT）と [plan.md](plan.md)（HOW、C1〜C18、Implementation Waves W1〜W6）から、
実装の波ごとに分割した。ルールは `~/.claude/sdd/rules/tasks-generation.md` と `~/.claude/sdd/rules/tasks-parallel-analysis.md`
に従う。並列モード（`--sequential` 未指定）。001 の `tasks.md` と同じ運用（索引 + 現在の波の全文、未着手の波は `tasks-wN.md`、
完了した波は `tasks-comp-wN.md`）を採る。

## ファイル構成

| ファイル | 内容 |
|---|---|
| `tasks.md`（本ファイル） | 表記規約、ID 対応表、進捗、gate への段階的な結線、**現在の波（W1）**のタスク全文 |
| `tasks-w2.md`〜`tasks-w6.md` | 未着手の波。前の波の完了時に `tasks.md` へ昇格する |
| `tasks-comp-w1.md`〜 | 完了した波の保管先。波の完了時に作る |
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
| W1 基盤 | 1 依存と設定ファイル、2 設定・カタログ・ゲートウェイの拡張、3 共通部品（Rerank ポート、`generateValidated`）、4 リポジトリ検査 | 未着手 | 本ファイル |
| W2 ナレッジベース | 5 DB 層、6 取り込みの部品、7 埋め込みとストア、8 取り込みの組み立てと HTTP 入口、9 コーパスと実サーバー確認 | 未着手 | [tasks-w2.md](tasks-w2.md) |
| W3 検索・回答・Agentic | 10 検索パイプライン、11 回答と引用、12 Agentic RAG、13 RAG の評価、14 評価データとシナリオ、15 RAG の HTTP 入口 | 未着手 | [tasks-w3.md](tasks-w3.md) |
| W4 ワークフロー・パターン | 16 ワークフロー、17 エージェントデザインパターン、18 シナリオとデモ、19 ワークフローの HTTP 入口 | 未着手 | [tasks-w4.md](tasks-w4.md) |
| W5 画面と E2E | 20 RAG 画面の部品、21 ワークフロー画面の部品、22 ページ、23 E2E | 未着手 | [tasks-w5.md](tasks-w5.md) |
| W6 評価・解説・統合 | 24 評価テスト、25 `local` での実測、26 解説、27 トレーサビリティ・ステアリング、28 最終統合 | 未着手 | [tasks-w6.md](tasks-w6.md) |

**波の依存**（plan「Implementation Waves」）: W2 は W1 に、W3 は W2 に、W5 は W3 と W4 に、W6 は W5 に依存する。W4 は W1 のみに依存するため
W2・W3 と並行できるが、W3 と W4 は `gateway.ts`・`mock/index.ts`・`fixtures/scenarios/m2.test.ts` を共有するので、シナリオとデモのタスク
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

## 現在の波: W1 基盤（大タスク 1〜4）

依存の宣言、設定・カタログ・ゲートウェイの拡張、Rerank ポート、`generateValidated`、リポジトリ検査を揃える。この波の終わりに
`pnpm audit` が 0 件であること（ADR-2）と、`allowBuilds` の警告が出ないことを確かめる。

1.1・1.2・2.1・2.2・3.2・4.1・4.3 は並列に進められる。2.3・3.1・4.2 は 2.2 の後、4.4 は最後に行う。

---

## 1. 依存と設定ファイル

M2 が使う 6 つの依存を完全一致で宣言し、学習者の文書の置き場所と秘密情報の検査を整える。

_Boundary:_ `packages/ai-core/package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.gitignore`, `knowledge/README.md`, `mise.toml`
_Depends:_ none
_Requirements:_ 1.1, 1.12, 2.5
_Traces:_ REQ-001, REQ-002, C1, C17

- [ ] 1.1 (P) `packages/ai-core/package.json`: plan「依存の宣言」の 6 件（`drizzle-orm` 0.45.4、`@electric-sql/pglite` 0.5.8、`@electric-sql/pglite-pgvector` 0.0.9、`postgres` 3.4.9、`unpdf` 1.8.1、`@ai-sdk/cohere` 4.0.59）を完全一致で足し、`exports` に `./structured`、`./rag`、`./workflows`、`./patterns`（`./src/<領域>/index.ts`）を足す。`pnpm install` で `pnpm-lock.yaml` を更新し、`pnpm audit` が 0 件であること（ADR-2。`drizzle-kit` は足さない）と、`allowBuilds` の警告が出ないことを確かめる。警告が出た依存だけ `pnpm-workspace.yaml` に理由付きで追記する（出なければ変更しない）。各依存の公開が 24 時間以上前であることを `pnpm view <name>@<version> time` で確認する（憲章 原則 7）
  _Boundary:_ `packages/ai-core/package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`
  _Depends:_ none
  _Requirements:_ 1.12, 2.5
  _Traces:_ REQ-001, REQ-002, C1, C17
  _Verify:_ `mise run setup`（`--frozen-lockfile`）が成功し、`pnpm audit` が 0 件、`mise run gate` が成功する。`exports` の参照先の `index.ts` は後続の各領域のタスクが作るので、それまで import されない（`typecheck` に影響しない）ことを `mise run typecheck` で確認する
- [ ] 1.2 (P) `.gitignore` に `knowledge/*` を足して `knowledge/README.md` だけを追跡し、`knowledge/README.md`（学習者の文書を置く場所と、対応形式 Markdown・PDF を日本語で説明する）を作る。`mise.toml` の `check:client-bundle` のセンチネル環境変数に `COHERE_API_KEY` を足す（`--sentinel` の引数も同じ値を足す）
  _Boundary:_ `.gitignore`, `knowledge/README.md`, `mise.toml`
  _Depends:_ none
  _Requirements:_ 1.1
  _Traces:_ REQ-001, C5, C17
  _Verify:_ `git check-ignore -q knowledge/sample.md` が成功し、`git check-ignore -q knowledge/README.md` が失敗する（追跡される）。`mise tasks validate` が成功する。`COHERE_API_KEY` のセンチネルが環境変数と `--sentinel` の両方に同じ値で入っている

### Implementation Notes

<!-- Empty at generation. Implementer appends 1-3 bullet learnings after completing this major task. -->

---

## 2. 設定・カタログ・ゲートウェイの拡張（C1）

M2 が必要とする設定値、カタログ項目、秘密情報の名前を、M1 の公開契約（`ModelPurpose` の語彙、cassette スキーマ）を変えずに足す。
各サブタスクは該当するテストを先に足してから実装する。

_Boundary:_ `packages/ai-core/src/config/defaults.ts`, `packages/ai-core/src/config/env-schema.ts`, `packages/ai-core/src/config/feature-requirements.ts`, `packages/ai-core/src/config/load.ts`, `packages/ai-core/src/config/index.ts`, `packages/ai-core/src/config/env-schema.test.ts`, `packages/ai-core/src/config/feature-requirements.test.ts`, `packages/ai-core/src/config/load.test.ts`, `.env.example`, `packages/ai-core/src/models/catalog.ts`, `packages/ai-core/src/models/catalog.test.ts`, `packages/ai-core/src/models/gateway.test.ts`, `packages/ai-core/src/models/index.ts`, `apps/web/**/*.test.{ts,tsx}`, `apps/web/e2e/**`, `packages/ai-core/src/models/gateway.ts`
_Depends:_ none
_Requirements:_ 1.4, 1.7, 2.5, 2.6, 3.5, 3.6, 3.7, 3.8, 3.12, 4.5, 4.6
_Traces:_ REQ-001, REQ-002, REQ-003, REQ-004, C1

- [ ] 2.1 (P) `config/`: `DEFAULT_RAG`（`topK` 5、`minSimilarity` 0.5、`candidatePool` 20、`rrfK` 60、`subQueryCount` 3、`chunkMaxCharacters` 800、`maxQuestionCharacters` 2000、`maxIngestFiles` 50、`maxIngestFileBytes` 5 MiB）と `DEFAULT_WORKFLOW_LIMITS`（`maxSections` 8、`defaultVotes` 3・`maxVotes` 9、`maxSubtasks` 6、`maxPlanSteps` 8、`defaultCandidates` 3・`maxCandidates` 5、`passScore` 85、`defaultMaxIterations` 3・`maxIterationsCap` 8、`maxRoles` 5）を足す。`COHERE_API_KEY`（任意）を `env-schema.ts` と `.env.example`（キー名と説明だけ）に、機能 `rerank` → `COHERE_API_KEY` を `feature-requirements.ts` に、`PlatformConfig.credentials.cohere` と `PlatformConfig.database`（`POSTGRES_*` から。既定は Compose と同じ `127.0.0.1`・5432・`postgres`・`postgres`・`agentic_ai`）を `load.ts` に足し、`index.ts` から再エクスポートする + `env-schema.test.ts`・`feature-requirements.test.ts`・`load.test.ts` に、任意変数の受理、機能と変数の対応（既存の「全機能が 1 件以上・全変数がスキーマに存在」の不変条件を保つ）、`database` の既定値と上書き、`credentials.cohere` の有無を先に足す
  _Boundary:_ `packages/ai-core/src/config/defaults.ts`, `packages/ai-core/src/config/env-schema.ts`, `packages/ai-core/src/config/feature-requirements.ts`, `packages/ai-core/src/config/load.ts`, `packages/ai-core/src/config/index.ts`, `packages/ai-core/src/config/env-schema.test.ts`, `packages/ai-core/src/config/feature-requirements.test.ts`, `packages/ai-core/src/config/load.test.ts`, `.env.example`
  _Depends:_ none
  _Requirements:_ 1.4, 1.7, 2.5, 2.6, 3.5, 3.6, 3.7, 3.8, 4.5, 4.6
  _Traces:_ REQ-001, REQ-002, REQ-003, REQ-004, C1
  _Verify:_ 定数そのものは単独のテストを持たない。値は plan「設定値」の表と一致させ、利用側のテスト（W2 以降）が境界値で縛る。`mise run typecheck` と `config/` のテストが通る
- [ ] 2.2 (P) `models/catalog.ts`: カタログ項目 `mock:judge-v1` を足して `MODEL_DEFAULTS.mock.mock.judge` をこれに変更する（CL-5）。`MODEL_TIERS`（`mode` × `provider` → `{ light, capable }`。CL-10）、`RERANK_MODELS`（Cohere の多言語モデル 1 件。ID はここにだけ書く）と `defaultRerankModel()` を足し、`models/index.ts` から `MODEL_TIERS`・`defaultRerankModel` を再エクスポートする + `catalog.test.ts`・`gateway.test.ts` に、新しい項目の `modes`・`purposes`、`mock` の `judge` の既定の変更、各 `mode`/`provider` のティア（`live` の Anthropic など 1 社 1 モデルでは `light` と `capable` が同じ）、Rerank の既定の取得を先に足す。`mock:judge-v1` の追加で `mock` のモデル選択肢が 1 つ増えるため、RED で既存テスト（`apps/web` の画面のテストと E2E を含む）への影響を洗い出して直し、対象のファイルを具体的なパスで Implementation Notes に記録し、`apps/web` の編集はそのパスに限る（`_Boundary:_` の glob は上限であり、記録にないファイルは触らない。W5 のタスクとの衝突を避ける。plan C1「既知の影響」）
  _Boundary:_ `packages/ai-core/src/models/catalog.ts`, `packages/ai-core/src/models/catalog.test.ts`, `packages/ai-core/src/models/gateway.test.ts`, `packages/ai-core/src/models/index.ts`, `apps/web/**/*.test.{ts,tsx}`, `apps/web/e2e/**`
  _Depends:_ none
  _Requirements:_ 2.5, 3.12, 4.6
  _Traces:_ REQ-002, REQ-003, REQ-004, C1
- [ ] 2.3 `models/gateway.ts`: `credentialSecrets` に `COHERE_API_KEY` を加える（録画の秘匿。`mock` 既定シナリオへの M2 の追加は 14.2・18.1・18.2 が行う）+ `gateway.test.ts` に、録画ラッパが `COHERE_API_KEY` の値をカセットから秘匿する（既存の他の秘密情報と同じ）ケースを先に足す
  _Boundary:_ `packages/ai-core/src/models/gateway.ts`, `packages/ai-core/src/models/gateway.test.ts`
  _Depends:_ 2.1, 2.2
  _Requirements:_ 2.5, 2.6
  _Traces:_ REQ-002, C1

### Implementation Notes

<!-- Empty at generation. Implementer appends 1-3 bullet learnings after completing this major task. -->

---

## 3. 共通部品（Rerank ポートと構造化出力ヘルパ）（C2 のポート側、C3）

Rerank を外部サービスのポートとして抽象化し、構造化出力の再生成ヘルパを提供する。どちらも以降の波が使う契約である（plan「後続 spec への契約」）。

_Boundary:_ `packages/ai-core/src/ports/rerank.ts`, `packages/ai-core/src/ports/rerank.test.ts`, `packages/ai-core/src/ports/index.ts`, `packages/ai-core/src/structured/generate-validated.ts`, `packages/ai-core/src/structured/errors.ts`, `packages/ai-core/src/structured/generate-validated.test.ts`, `packages/ai-core/src/structured/index.ts`
_Depends:_ 1.1, 2.2
_Requirements:_ 2.2, 2.5, 2.6, 3.3, 3.8, 4.2
_Traces:_ REQ-002, REQ-003, REQ-004, C2, C3

- [ ] 3.1 (P) `ports/rerank.ts`: `RerankProvider`（`modelId`、`rerank(query, candidates, { topN, signal })`）と `createCohereRerank(apiKey, options?)`（`ai` の `rerank()` と `@ai-sdk/cohere`。応答は Zod で検証し、不正は `source-unavailable`。タイムアウトと中断の伝播）を作り、`ports/index.ts` から再エクスポートする + `rerank.test.ts`（SDK をフェイクに差し替える）に、並べ替えと `topN` の適用、応答の不正（欠落・範囲外のインデックス・スコア型）、タイムアウト、`signal` による中断、モデル ID の保持（ID の文字列はカタログの `defaultRerankModel()` から取り、テストにも書かない）を先に足す
  _Boundary:_ `packages/ai-core/src/ports/rerank.ts`, `packages/ai-core/src/ports/rerank.test.ts`, `packages/ai-core/src/ports/index.ts`
  _Depends:_ 1.1, 2.2
  _Requirements:_ 2.5, 2.6
  _Traces:_ REQ-002, C2
- [ ] 3.2 (P) `structured/`: `generateValidated<T>({ model, schema, system?, prompt, validate?, maxRegenerations?, abortSignal?, providerOptions? })`（`generateText` + `Output.object`。スキーマ違反と追加検証の失敗で既定 2 回まで再生成し、再生成の指示に前回の問題点を含め、使用量を全試行で合算する。`generateObject`/`streamObject` は使わない）と `StructuredOutputError`（`PlatformError("output-invalid")`、各試行の問題点の一覧）、`index.ts` を作る + `generate-validated.test.ts` に、初回成功、再生成で成功、3 回失敗で `StructuredOutputError`（`attempts` と問題点）、追加検証の失敗、`maxRegenerations: 0`、中断後に次の試行を始めない、使用量の合算、再生成のプロンプトに前回の問題点が入ることを先に足す（M1 の `mock-models` ヘルパを使う）
  _Boundary:_ `packages/ai-core/src/structured/generate-validated.ts`, `packages/ai-core/src/structured/errors.ts`, `packages/ai-core/src/structured/generate-validated.test.ts`, `packages/ai-core/src/structured/index.ts`
  _Depends:_ none
  _Requirements:_ 2.2, 3.3, 3.8, 4.2
  _Traces:_ REQ-002, REQ-003, REQ-004, C3

### Implementation Notes

<!-- Empty at generation. Implementer appends 1-3 bullet learnings after completing this major task. -->

---

## 4. リポジトリ検査（C17）

新しい境界を機械的に守らせ、新しいモデル族とモジュールの必須トピックを既存の検査に結線する。規則の `mise.toml` への結線は波の締め（4.4）で行う。

_Boundary:_ `scripts/check-repo-rules.mjs`, `scripts/check-repo-rules.test.mjs`, `scripts/check-model-ids.mjs`, `scripts/check-model-ids.test.mjs`, `scripts/check-docs.mjs`, `scripts/check-docs.test.mjs`, `mise.toml`
_Depends:_ 1.1, 1.2, 2.2, 2.3, 3.1, 3.2
_Requirements:_ 1.12, 2.5, 3.13, 4.8
_Traces:_ REQ-001, REQ-002, REQ-003, REQ-004, C17

- [ ] 4.1 (P) `check-repo-rules.mjs`: 規則 `workflow-no-agent-loop`（`packages/ai-core/src/workflows/` と `patterns/` の全ファイルが `../agents`・`@platform/ai-core/agents`・`ToolLoopAgent` を参照しない。許可は `patterns/role-based-cooperation.ts` のみ。走査 0 件で失敗）と `no-sql-raw`（`packages/ai-core/src/` で `sql.raw` を使わない。許可は `rag/db/migrate.ts` のみ）を足し、`RULE_NAMES` を 9 → 11 にする + `check-repo-rules.test.mjs` に、各規則の違反例（相対 import、サブパス import、型だけの import、`ToolLoopAgent` の識別子、`sql.raw` の呼び出し）、許可例（許可ファイル）、走査 0 件の失敗、走査件数の出力を先に足す
  _Boundary:_ `scripts/check-repo-rules.mjs`, `scripts/check-repo-rules.test.mjs`
  _Depends:_ none
  _Requirements:_ 3.13, 1.12
  _Traces:_ REQ-001, REQ-003, C17
- [ ] 4.2 `check-model-ids.mjs`: Rerank のモデル族 `rerank-` を `MODEL_ID_FAMILIES` に足す（カタログ以外に ID を書かせない）+ `check-model-ids.test.mjs` に、`rerank-` の ID の検出（カタログ外）とカタログ内の許可を先に足す。実リポジトリの走査（`mise run check:model-ids`）が、2.2 で足したカタログの Rerank ID を許可して成功する
  _Boundary:_ `scripts/check-model-ids.mjs`, `scripts/check-model-ids.test.mjs`
  _Depends:_ 2.2
  _Requirements:_ 2.5
  _Traces:_ REQ-002, C17
- [ ] 4.3 (P) `check-docs.mjs`: `REQUIRED_TOPICS` に `2-1`、`2-2` の必須トピックを足す（`2-3`、`2-4` は定義済み）。トピックは `specs/curriculum/phase-2.md` のモジュール 2-1・2-2 の内容と、plan C18 が 2-1・2-2 に求める「`mock` の緑が保証しないもの」「日本語の埋め込みでの閾値の限界」を含める。文字列は 26.1・26.2 の解説の見出しがそのまま満たすものにする + `check-docs.test.mjs` に、必須トピックが欠けた解説の失敗、満たした解説の成功を先に足す
  _Boundary:_ `scripts/check-docs.mjs`, `scripts/check-docs.test.mjs`
  _Depends:_ none
  _Requirements:_ 4.8, 1.12
  _Traces:_ REQ-001, REQ-004, C17, C18
- [ ] 4.4 **W1 の締め**: `mise.toml` の `check:repo-rules` の `--only` に `no-sql-raw` を足す（`workflow-no-agent-loop` は走査対象が揃う W4 の締め 19.2 で足す）。`mise run gate` を実行して成功を確かめ、所要時間を Implementation Notes に記録する（予算は 5 分。憲章 原則 3）。`pnpm audit` が 0 件であることを再確認する
  _Boundary:_ `mise.toml`
  _Depends:_ 1.1, 1.2, 2.3, 3.1, 3.2, 4.1, 4.2, 4.3
  _Requirements:_ 1.12, 3.13
  _Traces:_ REQ-001, REQ-003, C17
  _Verify:_ `mise run gate` が成功し、`check:repo-rules` の出力に `no-sql-raw: scanned N FILES`（N ≥ 1）が出る。`mise run check:repo-rules` に `workflow-no-agent-loop` を含めずに緑になる 波の敵対的レビュー（憲章 原則 9。新規コンテキストで `sdd-reviewer`）を行い、記録 `.sdd/reviews/002-rag-and-workflows-impl-w1-review-YYYY-MM-DD.md` が存在し、指摘への対応が追記されていることを確かめる（波の移行条件 3）

### Implementation Notes

<!-- Empty at generation. Implementer appends 1-3 bullet learnings after completing this major task. -->
