# rag-and-workflows（Milestone 2）— 完了した実装タスク W1: 基盤（大タスク 1〜4）

完了した波（2026-10-12 に移行）。表記規約、ID 対応表、進捗、gate への段階的な結線、完了した波の移行手順は
[tasks.md](tasks.md) を参照する。波の敵対的レビューの記録は
`.sdd/reviews/002-rag-and-workflows-impl-w1-review-2026-10-12.md`（1 ラウンド。指摘への対応を追記済み）。
コミット: `b5f32ab`、`f5f9490`、`f4b73f1`、`fd62fd5`。

---

## W1 基盤（大タスク 1〜4）

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

- [x] 1.1 (P) `packages/ai-core/package.json`: plan「依存の宣言」の 6 件（`drizzle-orm` 0.45.4、`@electric-sql/pglite` 0.5.8、`@electric-sql/pglite-pgvector` 0.0.9、`postgres` 3.4.9、`unpdf` 1.8.1、`@ai-sdk/cohere` 4.0.59）を完全一致で足し、`exports` に `./structured`、`./rag`、`./workflows`、`./patterns`（`./src/<領域>/index.ts`）を足す。`pnpm install` で `pnpm-lock.yaml` を更新し、`pnpm audit` が 0 件であること（ADR-2。`drizzle-kit` は足さない）と、`allowBuilds` の警告が出ないことを確かめる。警告が出た依存だけ `pnpm-workspace.yaml` に理由付きで追記する（出なければ変更しない）。各依存の公開が 24 時間以上前であることを `pnpm view <name>@<version> time` で確認する（憲章 原則 7）
  _Boundary:_ `packages/ai-core/package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`
  _Depends:_ none
  _Requirements:_ 1.12, 2.5
  _Traces:_ REQ-001, REQ-002, C1, C17
  _Verify:_ `mise run setup`（`--frozen-lockfile`）が成功し、`pnpm audit` が 0 件、`mise run gate` が成功する。`exports` の参照先の `index.ts` は後続の各領域のタスクが作るので、それまで import されない（`typecheck` に影響しない）ことを `mise run typecheck` で確認する
- [x] 1.2 (P) `.gitignore` に `knowledge/*` を足して `knowledge/README.md` だけを追跡し、`knowledge/README.md`（学習者の文書を置く場所と、対応形式 Markdown・PDF を日本語で説明する）を作る。`mise.toml` の `check:client-bundle` のセンチネル環境変数に `COHERE_API_KEY` を足す（`--sentinel` の引数も同じ値を足す）
  _Boundary:_ `.gitignore`, `knowledge/README.md`, `mise.toml`
  _Depends:_ none
  _Requirements:_ 1.1
  _Traces:_ REQ-001, C5, C17
  _Verify:_ `git check-ignore -q knowledge/sample.md` が成功し、`git check-ignore -q knowledge/README.md` が失敗する（追跡される）。`mise tasks validate` が成功する。`COHERE_API_KEY` のセンチネルが環境変数と `--sentinel` の両方に同じ値で入っている

### Implementation Notes

- 6 依存はすべて公開から 24 時間以上（最短は `@ai-sdk/cohere` の 84 時間）。`pnpm install` は `allowBuilds` の警告を出さず、`pnpm-workspace.yaml` は変更していない。`pnpm audit` は 0 件。
- `knowledge/*` を無視しつつ `knowledge/README.md` だけを追跡する `.gitignore` は、`git check-ignore -q` の成否で両方向を確かめた。

---

## 2. 設定・カタログ・ゲートウェイの拡張（C1）

M2 が必要とする設定値、カタログ項目、秘密情報の名前を、M1 の公開契約（`ModelPurpose` の語彙、cassette スキーマ）を変えずに足す。
各サブタスクは該当するテストを先に足してから実装する。

_Boundary:_ `packages/ai-core/src/config/defaults.ts`, `packages/ai-core/src/config/env-schema.ts`, `packages/ai-core/src/config/feature-requirements.ts`, `packages/ai-core/src/config/load.ts`, `packages/ai-core/src/config/index.ts`, `packages/ai-core/src/config/env-schema.test.ts`, `packages/ai-core/src/config/feature-requirements.test.ts`, `packages/ai-core/src/config/load.test.ts`, `.env.example`, `packages/ai-core/src/models/catalog.ts`, `packages/ai-core/src/models/catalog.test.ts`, `packages/ai-core/src/models/gateway.test.ts`, `packages/ai-core/src/models/index.ts`, `apps/web/**/*.test.{ts,tsx}`, `apps/web/e2e/**`, `packages/ai-core/src/models/gateway.ts`
_Depends:_ none
_Requirements:_ 1.4, 1.7, 2.5, 2.6, 3.5, 3.6, 3.7, 3.8, 3.12, 4.5, 4.6
_Traces:_ REQ-001, REQ-002, REQ-003, REQ-004, C1

- [x] 2.1 (P) `config/`: `DEFAULT_RAG`（`topK` 5、`minSimilarity` 0.5、`candidatePool` 20、`rrfK` 60、`subQueryCount` 3、`chunkMaxCharacters` 800、`maxQuestionCharacters` 2000、`maxIngestFiles` 50、`maxIngestFileBytes` 5 MiB）と `DEFAULT_WORKFLOW_LIMITS`（`maxSections` 8、`defaultVotes` 3・`maxVotes` 9、`maxSubtasks` 6、`maxPlanSteps` 8、`defaultCandidates` 3・`maxCandidates` 5、`passScore` 85、`defaultMaxIterations` 3・`maxIterationsCap` 8、`maxRoles` 5）を足す。`COHERE_API_KEY`（任意）を `env-schema.ts` と `.env.example`（キー名と説明だけ）に、機能 `rerank` → `COHERE_API_KEY` を `feature-requirements.ts` に、`PlatformConfig.credentials.cohere` と `PlatformConfig.database`（`POSTGRES_*` から。既定は Compose と同じ `127.0.0.1`・5432・`postgres`・`postgres`・`agentic_ai`）を `load.ts` に足し、`index.ts` から再エクスポートする + `env-schema.test.ts`・`feature-requirements.test.ts`・`load.test.ts` に、任意変数の受理、機能と変数の対応（既存の「全機能が 1 件以上・全変数がスキーマに存在」の不変条件を保つ）、`database` の既定値と上書き、`credentials.cohere` の有無を先に足す
  _Boundary:_ `packages/ai-core/src/config/defaults.ts`, `packages/ai-core/src/config/env-schema.ts`, `packages/ai-core/src/config/feature-requirements.ts`, `packages/ai-core/src/config/load.ts`, `packages/ai-core/src/config/index.ts`, `packages/ai-core/src/config/env-schema.test.ts`, `packages/ai-core/src/config/feature-requirements.test.ts`, `packages/ai-core/src/config/load.test.ts`, `.env.example`
  _Depends:_ none
  _Requirements:_ 1.4, 1.7, 2.5, 2.6, 3.5, 3.6, 3.7, 3.8, 4.5, 4.6
  _Traces:_ REQ-001, REQ-002, REQ-003, REQ-004, C1
  _Verify:_ 定数そのものは単独のテストを持たない。値は plan「設定値」の表と一致させ、利用側のテスト（W2 以降）が境界値で縛る。`mise run typecheck` と `config/` のテストが通る
- [x] 2.2 (P) `models/catalog.ts`: カタログ項目 `mock:judge-v1` を足して `MODEL_DEFAULTS.mock.mock.judge` をこれに変更する（CL-5）。`MODEL_TIERS`（`mode` × `provider` → `{ light, capable }`。CL-10）、`RERANK_MODELS`（Cohere の多言語モデル 1 件。ID はここにだけ書く）と `defaultRerankModel()` を足し、`models/index.ts` から `MODEL_TIERS`・`defaultRerankModel` を再エクスポートする + `catalog.test.ts`・`gateway.test.ts` に、新しい項目の `modes`・`purposes`、`mock` の `judge` の既定の変更、各 `mode`/`provider` のティア（`live` の Anthropic など 1 社 1 モデルでは `light` と `capable` が同じ）、Rerank の既定の取得を先に足す。`mock:judge-v1` の追加で `mock` のモデル選択肢が 1 つ増えるため、RED で既存テスト（`apps/web` の画面のテストと E2E を含む）への影響を洗い出して直し、対象のファイルを具体的なパスで Implementation Notes に記録し、`apps/web` の編集はそのパスに限る（`_Boundary:_` の glob は上限であり、記録にないファイルは触らない。W5 のタスクとの衝突を避ける。plan C1「既知の影響」）
  _Boundary:_ `packages/ai-core/src/models/catalog.ts`, `packages/ai-core/src/models/catalog.test.ts`, `packages/ai-core/src/models/gateway.test.ts`, `packages/ai-core/src/models/index.ts`, `apps/web/**/*.test.{ts,tsx}`, `apps/web/e2e/**`
  _Depends:_ none
  _Requirements:_ 2.5, 3.12, 4.6
  _Traces:_ REQ-002, REQ-003, REQ-004, C1
- [x] 2.3 `models/gateway.ts`: `credentialSecrets` に `COHERE_API_KEY` を加える（録画の秘匿。`mock` 既定シナリオへの M2 の追加は 14.2・18.1・18.2 が行う）+ `gateway.test.ts` に、録画ラッパが `COHERE_API_KEY` の値をカセットから秘匿する（既存の他の秘密情報と同じ）ケースを先に足す
  _Boundary:_ `packages/ai-core/src/models/gateway.ts`, `packages/ai-core/src/models/gateway.test.ts`
  _Depends:_ 2.1, 2.2
  _Requirements:_ 2.5, 2.6
  _Traces:_ REQ-002, C1

### Implementation Notes

- 2.2 の影響調査: `mock:judge-v1` を足した状態で `mise run test` を通し、`apps/web` の単体テストは 306 件すべて変更なしで成功した。`apps/web/e2e/**` は読んで確認した（`chat.spec.ts` は表示名で代替モデルを選び、`mock-api.ts` の `offerAlternativeModel` は一覧の最初の `mock:general-v1` を複製するので、選択肢が 1 つ増えても影響しない）。**`apps/web` のファイルは編集していない**（W5 のタスクとの衝突なし）。Playwright の実行は W5 で行う。
- Rerank のモデルは `RERANK_MODELS`（`rerank-v4.0-pro`）に置き、`MODEL_CATALOG` には入れない。入れると `listModels` とモデル選択に出てしまう。
- 8.4 / 15.1 への申し送り（W1 レビュー F-5）: `apps/web/lib/server/platform.ts` は ai-core とは別に `credentialSecrets` の一覧を持ち、`COHERE_API_KEY` が無い。8.4 または 15.1 で足すか、ai-core の一覧を再利用すること。
- `DEFAULT_DATABASE`（Compose と同じ既定値）を `defaults.ts` に足した。plan の一覧にない定数だが、`load.ts` と後続の DB 層が同じ値を参照するため。`POSTGRES_PORT` はスキーマ上は文字列のままで、`load.ts` が 1〜65535 の整数として検査する。

---

## 3. 共通部品（Rerank ポートと構造化出力ヘルパ）（C2 のポート側、C3）

Rerank を外部サービスのポートとして抽象化し、構造化出力の再生成ヘルパを提供する。どちらも以降の波が使う契約である（plan「後続 spec への契約」）。

_Boundary:_ `packages/ai-core/src/ports/rerank.ts`, `packages/ai-core/src/ports/rerank.test.ts`, `packages/ai-core/src/ports/index.ts`, `packages/ai-core/src/structured/generate-validated.ts`, `packages/ai-core/src/structured/errors.ts`, `packages/ai-core/src/structured/generate-validated.test.ts`, `packages/ai-core/src/structured/index.ts`
_Depends:_ 1.1, 2.2
_Requirements:_ 2.2, 2.5, 2.6, 3.3, 3.8, 4.2
_Traces:_ REQ-002, REQ-003, REQ-004, C2, C3

- [x] 3.1 (P) `ports/rerank.ts`: `RerankProvider`（`modelId`、`rerank(query, candidates, { topN, signal })`）と `createCohereRerank(apiKey, options?)`（`ai` の `rerank()` と `@ai-sdk/cohere`。応答は Zod で検証し、不正は `source-unavailable`。タイムアウトと中断の伝播）を作り、`ports/index.ts` から再エクスポートする + `rerank.test.ts`（SDK をフェイクに差し替える）に、並べ替えと `topN` の適用、応答の不正（欠落・範囲外のインデックス・スコア型）、タイムアウト、`signal` による中断、モデル ID の保持（ID の文字列はカタログの `defaultRerankModel()` から取り、テストにも書かない）を先に足す
  _Boundary:_ `packages/ai-core/src/ports/rerank.ts`, `packages/ai-core/src/ports/rerank.test.ts`, `packages/ai-core/src/ports/index.ts`
  _Depends:_ 1.1, 2.2
  _Requirements:_ 2.5, 2.6
  _Traces:_ REQ-002, C2
- [x] 3.2 (P) `structured/`: `generateValidated<T>({ model, schema, system?, prompt, validate?, maxRegenerations?, abortSignal?, providerOptions? })`（`generateText` + `Output.object`。スキーマ違反と追加検証の失敗で既定 2 回まで再生成し、再生成の指示に前回の問題点を含め、使用量を全試行で合算する。`generateObject`/`streamObject` は使わない）と `StructuredOutputError`（`PlatformError("output-invalid")`、各試行の問題点の一覧）、`index.ts` を作る + `generate-validated.test.ts` に、初回成功、再生成で成功、3 回失敗で `StructuredOutputError`（`attempts` と問題点）、追加検証の失敗、`maxRegenerations: 0`、中断後に次の試行を始めない、使用量の合算、再生成のプロンプトに前回の問題点が入ることを先に足す（M1 の `mock-models` ヘルパを使う）
  _Boundary:_ `packages/ai-core/src/structured/generate-validated.ts`, `packages/ai-core/src/structured/errors.ts`, `packages/ai-core/src/structured/generate-validated.test.ts`, `packages/ai-core/src/structured/index.ts`
  _Depends:_ none
  _Requirements:_ 2.2, 3.3, 3.8, 4.2
  _Traces:_ REQ-002, REQ-003, REQ-004, C3

### Implementation Notes

- `createCohereRerank` の差し替え点は `RerankSdkCall` 1 つ。SDK の応答は Zod で形を検査したうえで、範囲外・重複のインデックスも `source-unavailable` にする。タイムアウトは `details.reason: "timeout"`、呼び出し側の中断は `signal.reason` をそのまま投げる（`source-unavailable` に包まない）。
- `generateValidated` は `NoObjectGeneratedError` だけを再生成の対象にする。プロバイダのエラーと中断は再試行しない。エラーの問題点はスキーマのパスと制約だけで、生成された本文は含めない（テストで固定）。

---

## 4. リポジトリ検査（C17）

新しい境界を機械的に守らせ、新しいモデル族とモジュールの必須トピックを既存の検査に結線する。規則の `mise.toml` への結線は波の締め（4.4）で行う。

_Boundary:_ `scripts/check-repo-rules.mjs`, `scripts/check-repo-rules.test.mjs`, `scripts/check-model-ids.mjs`, `scripts/check-model-ids.test.mjs`, `scripts/check-docs.mjs`, `scripts/check-docs.test.mjs`, `mise.toml`
_Depends:_ 1.1, 1.2, 2.2, 2.3, 3.1, 3.2
_Requirements:_ 1.12, 2.5, 3.13, 4.8
_Traces:_ REQ-001, REQ-002, REQ-003, REQ-004, C17

- [x] 4.1 (P) `check-repo-rules.mjs`: 規則 `workflow-no-agent-loop`（`packages/ai-core/src/workflows/` と `patterns/` の全ファイルが `../agents`・`@platform/ai-core/agents`・`ToolLoopAgent` を参照しない。許可は `patterns/role-based-cooperation.ts` のみ。走査 0 件で失敗）と `no-sql-raw`（`packages/ai-core/src/` で `sql.raw` を使わない。許可は `rag/db/migrate.ts` のみ）を足し、`RULE_NAMES` を 9 → 11 にする + `check-repo-rules.test.mjs` に、各規則の違反例（相対 import、サブパス import、型だけの import、`ToolLoopAgent` の識別子、`sql.raw` の呼び出し）、許可例（許可ファイル）、走査 0 件の失敗、走査件数の出力を先に足す
  _Boundary:_ `scripts/check-repo-rules.mjs`, `scripts/check-repo-rules.test.mjs`
  _Depends:_ none
  _Requirements:_ 3.13, 1.12
  _Traces:_ REQ-001, REQ-003, C17
- [x] 4.2 `check-model-ids.mjs`: Rerank のモデル族 `rerank-` を `MODEL_ID_FAMILIES` に足す（カタログ以外に ID を書かせない）+ `check-model-ids.test.mjs` に、`rerank-` の ID の検出（カタログ外）とカタログ内の許可を先に足す。実リポジトリの走査（`mise run check:model-ids`）が、2.2 で足したカタログの Rerank ID を許可して成功する
  _Boundary:_ `scripts/check-model-ids.mjs`, `scripts/check-model-ids.test.mjs`
  _Depends:_ 2.2
  _Requirements:_ 2.5
  _Traces:_ REQ-002, C17
- [x] 4.3 (P) `check-docs.mjs`: `REQUIRED_TOPICS` に `2-1`、`2-2` の必須トピックを足す（`2-3`、`2-4` は定義済み）。トピックは `specs/curriculum/phase-2.md` のモジュール 2-1・2-2 の内容と、plan C18 が 2-1・2-2 に求める「`mock` の緑が保証しないもの」「日本語の埋め込みでの閾値の限界」を含める。文字列は 26.1・26.2 の解説の見出しがそのまま満たすものにする + `check-docs.test.mjs` に、必須トピックが欠けた解説の失敗、満たした解説の成功を先に足す
  _Boundary:_ `scripts/check-docs.mjs`, `scripts/check-docs.test.mjs`
  _Depends:_ none
  _Requirements:_ 4.8, 1.12
  _Traces:_ REQ-001, REQ-004, C17, C18
- [x] 4.4 **W1 の締め**: `mise.toml` の `check:repo-rules` の `--only` に `no-sql-raw` を足す（`workflow-no-agent-loop` は走査対象が揃う W4 の締め 19.2 で足す）。`mise run gate` を実行して成功を確かめ、所要時間を Implementation Notes に記録する（予算は 5 分。憲章 原則 3）。`pnpm audit` が 0 件であることを再確認する
  _Boundary:_ `mise.toml`
  _Depends:_ 1.1, 1.2, 2.3, 3.1, 3.2, 4.1, 4.2, 4.3
  _Requirements:_ 1.12, 3.13
  _Traces:_ REQ-001, REQ-003, C17
  _Verify:_ `mise run gate` が成功し、`check:repo-rules` の出力に `no-sql-raw: scanned N FILES`（N ≥ 1）が出る。`mise run check:repo-rules` に `workflow-no-agent-loop` を含めずに緑になる 波の敵対的レビュー（憲章 原則 9。新規コンテキストで `sdd-reviewer`）を行い、記録 `.sdd/reviews/002-rag-and-workflows-impl-w1-review-YYYY-MM-DD.md` が存在し、指摘への対応が追記されていることを確かめる（波の移行条件 3）

### Implementation Notes

- `rerank-` のモデル族は、版またはバリアント語（`v4.0-pro`、`multilingual`、`2.5` など）が続く場合だけ検出する。単純な `rerank-` にすると、コーパスのファイル名 `05-rerank-and-evaluation.md` と `rerank-skipped` のような語彙が誤検出される。
- `workflow-no-agent-loop` は `workflows/`・`patterns/` のテストファイルも走査する。後続のテストからエージェント領域を import しないこと。
- 4.4: `mise run gate` は `TURBO_FORCE=true`（キャッシュなし）で 13 秒、予算 5 分以内。`no-sql-raw: scanned 112 FILES`、`pnpm audit` 0 件。敵対的レビューは `.sdd/reviews/002-rag-and-workflows-impl-w1-review-2026-10-12.md`（REQUEST_CHANGES → F-1〜F-4、F-6〜F-9 を修正、F-5 は 8.4/15.1 へ申し送り、残りは受容を記録）。
- レビューで得た注意: `ai` は `ToolLoopAgent` を `Experimental_Agent` の別名でも公開する（規則は両方を見る）。プロバイダの例外メッセージは鍵・質問・本文を含みうるので `details` に入れない。`validate()` の問題点の文言に生成された本文を入れない（呼び出し側の責任）。
- 手書きのファイルは先に `mise run lint:fix` を通す（最初の `gate` は Biome の整形で失敗した）。
