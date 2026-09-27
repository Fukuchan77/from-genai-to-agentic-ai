# agentic-ai-platform（Milestone 1）— 実装タスク（索引と現在の波）

`/sdd-tasks` が生成し、`/sdd-analyze`（2026-09-27）の指摘を反映して、実装の波（W1〜W5）ごとに分割した。
2回目の `/sdd-analyze`（2026-09-27）の H-1〜H-3、M-1〜M-4 と、3回目の H-1、M-1〜M-4、L-1〜L-3 も反映した。
ルールは `~/.claude/sdd/rules/tasks-generation.md` と `~/.claude/sdd/rules/tasks-parallel-analysis.md` に従う。
並列モード（`--sequential` 未指定）。

## ファイル構成

| ファイル | 内容 |
|---|---|
| `tasks.md`（本ファイル） | 表記規約、ID 対応表、進捗、gate と CI の段階的な結線、**現在の波**のタスク全文 |
| `tasks-w2.md`〜`tasks-w5.md` | 未着手の波のタスク全文。その波に着手するときに本ファイルへ移す |
| `tasks-comp-w1.md`〜`tasks-comp-w5.md` | 完了した波の保管先。波の完了時に作る |
| `traceability.md` | 要件 → 設計 → タスク → テスト → コミット |

タスク番号は全ファイルで一意で、移動しても変えない。`_Depends:_` と `traceability.md` は、ファイルをまたいで
番号だけで参照する。

### 完了した波の移行手順

1. 移行の条件: その波の全サブタスクが `[x]`、各大タスクの Implementation Notes が記入済み、波の締めのタスク
   （下記「gate と CI の段階的な結線」）が完了し、`mise run gate` と CI の `ci-status` が成功している。加えて、
   その波の敵対的レビューの記録が `.sdd/reviews/` にある（下記「波ごとの敵対的レビュー」）。
2. 本ファイルの「現在の波」の節を、本文を変えずに `tasks-comp-wN.md` へ移す。
3. 次の波の `tasks-w(N+1).md` の本文を本ファイルの「現在の波」へ移し、`tasks-w(N+1).md` を削除する。
4. 下記「進捗」の状態とファイルの列を更新する。
5. 移行は波の締めの後に単独のコミット（例: `docs(tasks): archive wave 1`）で行う。並列作業の途中では移行しない。

完了分は波ごとに1ファイルに分かれるため、保管先のファイルは最大でも約300行に収まる。

### 波ごとの敵対的レビュー（constitution 原則 9）

原則 9 の「各実装フェーズの完了後に、新規コンテキストで敵対的レビューを1回行う」の「実装フェーズ」は、
本 spec では**実装の波（W1〜W5）**を指す。マイルストーン単位の1回だけでは、W1 の基盤の誤りが W2〜W5 に
継承されるため、波ごとに行う。

- 時点: 波の締めのタスクが完了し、`mise run gate` が成功した後、移行のコミットより前。
- 実施者: その波の実装に関わっていない新規コンテキスト（`sdd-reviewer` サブエージェント、`adversarial-review` skill）。
- 対象: その波で追加・変更したコード、テスト、設定、`tasks.md` の Implementation Notes。
- 記録: `.sdd/reviews/001-agentic-ai-platform-impl-wN-review-YYYY-MM-DD.md`（1ラウンド1ファイル。過去の
  ラウンドを上書きしない）。指摘への対応が完了したことをその記録に追記してから、移行する。

## 表記規約

- `- [ ]` 未着手、`- [x]` 完了、`- [ ]*` 任意・後回し可のテスト。
- `(P)` = 並列実行可（依存なし・境界の重複なし）。大タスクの見出しに付けた `(P)` は、その大タスクが同じ波の
  他の大タスクと並列に進められることを示す。
- 各タスク（大タスク・サブタスクの両方）は `_Boundary:_` と `_Depends:_` を必ず持つ。
- **テスト先行（constitution 原則 4）**: 実装を含むサブタスクは、対応するテストファイルを同じ `_Boundary:_` に
  含み、RED（失敗の確認）→ GREEN → REFACTOR を1つのサブタスクの中で行う。設定ファイル・生成物・公開 API の
  集約など、単独のテストを持たないサブタスクは、検証手段を `_Verify:_` に書く。
- `_Requirements:_` は spec.md の受け入れ基準番号（例: `1.1`）をカンマ区切りの数値のみで列挙する。
  NFR（数値番号を持たない）は `NFR-01`〜`NFR-13`（下記の対応表）で同じ書式に揃えて記載する。
- `_Traces:_` は安定リンクIDを持つ。この spec は `spec.md`/`plan.md` に `REQ-###`/`DES-#.#` 形式の
  見出しを持たないため、以下の対応表で実在する見出しに固定する。
- 各大タスクの末尾の `### Implementation Notes` は生成時は空。大タスクの完了後に、実装者が学びを1〜3項目
  追記する。
- 共有ファイルの編集者を1つに絞る: `.env.example`（1.5 が全変数を一度に作る）、`packages/ai-core/package.json`
  （6.1 が M1 の依存を一度に宣言する。`test`・`test:coverage` スクリプトだけは 6.3 が加える）、`apps/web/package.json`（8.1。`test`・`test:coverage` スクリプトだけは 21.1 が加える）、`packages/eval-suite/package.json`（7.1。`test`・`test:coverage` スクリプトだけは 19.1 が加える）、
  `mise.toml`（1.1 と各波の締めのタスクだけが編集する）、`.github/workflows/ci.yml`（2.1 と、ジョブを加える
  波の締めのタスク 19.3・29.1 だけが編集する）。

### ID 対応表

| ID | 対応する見出し |
|---|---|
| `REQ-001`〜`REQ-007` | spec.md の `### Requirement 1`〜`### Requirement 7`（要件グループ単位。AC単位の詳細は `_Requirements:_` を見る） |
| `NFR-01`〜`NFR-13` | spec.md `## Non-Functional Requirements` の箇条書き順（01検証速度、02決定性、03オフライン動作、04ストリーミング応答性、05型安全性、06テストカバレッジ、07秘密情報、08隔離実行、09アクセシビリティ、10対応ブラウザ、11サプライチェーン、12UI言語、13コスト可視化） |
| `C1`〜`C22` | plan.md の `#### C_N <名前>`（実在する見出し。`DES-#.#` の代わりにこの一次IDを使う） |

## 進捗

| 波 | 大タスク | 状態 | ファイル |
|---|---|---|---|
| W1 基盤 | 1 ツールチェーン、2 CI、3 ローカル依存サービス、4 テスト基盤、5 リポジトリ規約検査 | 未着手（現在の波） | 本ファイル |
| W2 ai-core の土台 | 6 ai-core scaffold、7 eval-suite scaffold、8 apps/web scaffold、9 ModelCatalog、10 Ports、11 testing ヘルパ、12 PlatformConfig、13 MockRuntime | 未着手 | [tasks-w2.md](tasks-w2.md) |
| W3 ai-core の機能 | 14 ModelGateway、15 AciToolkit、16 GuardedAgent、17 ChatCore、18 SummaryPipeline、19 評価スイート | 未着手 | [tasks-w3.md](tasks-w3.md) |
| W4 apps/web | 21 RequestGuard、20 AppShell、22 ChatFeature、23 ToolAgentFeature、24 SummaryFeature | 未着手 | [tasks-w4.md](tasks-w4.md) |
| W5 E2E・解説・最終統合 | 25 E2E 生成・検査スクリプト、26 E2E 基盤、27 E2E シナリオ、28 解説ドキュメント、29 最終統合と NFR 検証 | 未着手 | [tasks-w5.md](tasks-w5.md) |

波の順序は依存関係で決まる。W4 は 21 を 20 より先に行う（20.1 がレート制限器を組み立てるため）。

モジュールの完成タグ（Req 7.11、plan C22）は、そのモジュールのリファレンス実装が完了した波の中で付ける:
`module/1-1` は 14.6（W3）、`module/1-2` は 23.5（W4）、`module/1-3` は 24.4（W4）。29.4 は3つのタグの検証と
push だけを行う。

## gate と CI の段階的な結線

gate の各段は「走査0件で失敗」するため、検査対象がまだない段を最初から入れると、実装の途中で必ず失敗する
（plan C1「gate と CI の段階的な結線」、C20）。CI のジョブも同じで、対象（Stryker の変異対象、Playwright の設定、
クライアントバンドル検査のスクリプト）がないジョブを最初から入れると、`ci-status` が W5 まで失敗し続け、
PR のステータス（Req 1.7）が信号として機能しない。そこで波の締めのタスクが、対象が揃った段、
`check:repo-rules --only` の規則、CI のジョブ（と `ci-status` の `needs`）を加える。波の途中では、直前の波の
締めで確定した構成を使う。一度加えた段・規則・ジョブは外さない。

| 時点 | 締めのタスク | gate に加える段 | `check:repo-rules --only` に加える規則 | CI に加えるジョブ |
|---|---|---|---|---|
| 初期 | 1.1（CI は 2.1） | `lint`（`biome ci` のみ） | — | `gate`、`secret-scan`、`audit`、集約 `ci-status` |
| W1 の締め | 5.5 | `lint` への `count-biome` の付加、`check:model-ids`、`check:repo-rules`、`test`（`tooling/`・`scripts/` のテスト） | `no-dynamic-eval`、`actions-pinned`、`frozen-lockfile`、`allow-builds-reasoned` | — |
| W2 の締め | 13.7 | `typecheck`（`count-tsc` 付き。ルートの `//#typecheck` を含む） | `no-deprecated-object-api`、`guarded-agent-only`、`ai-core-no-ui-deps`、`no-sensitive-logging` | — |
| W3 の締め | 19.3 | — | `tool-risk-declared` | `mutation`（Stryker の変異対象がすべて W3 までにそろう） |
| W4 | （締めのタスクなし） | — | — | — |
| W5 の締め | 29.1 | `docs:check`。これで plan C1 の全段（`lint` → `check:model-ids` → `check:repo-rules` → `typecheck` → `test` → `docs:check`）と全9規則がそろう | — | `e2e`（3エンジン）、`client-bundle`。これで plan C2 の全ジョブがそろう |

各規則の走査対象と除外は plan C20 の規則表が正本である。

---

# 現在の波: W1 基盤（大タスク 1〜5）

## 1. モノレポ基盤ツールチェーン（C1）

pnpm workspaces + Turborepo の骨格、版固定、Biome、strict な TypeScript 設定、品質ゲートの
入口となるルート設定一式を用意する。

_Boundary:_ `mise.toml`, `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `turbo.json`, `biome.json`, `tsconfig.base.json`, `tsconfig.json`, `vitest.config.ts`, `stryker.config.mjs`, `.gitignore`, `.gitleaksignore`, `.githooks/pre-commit`, `.env.example`, `AGENTS.md`, `README.md`
_Depends:_ none
_Requirements:_ 1.1, 1.3, 1.4, 1.6, 1.11, 1.12, 1.15, 1.16, 1.18, 2.18, NFR-05, NFR-07, NFR-11
_Traces:_ REQ-001, C1

- [x] 1.1 `mise.toml` にツール（node、pnpm、gitleaks）の版を固定し、plan の [mise タスク](plan.md#mise-タスク学習者と-ci-の入口) と C1 の Public interface に挙げた全タスク（`setup`、`lint`、`lint:fix`、`typecheck`、`test`、`test:local`、`test:db`、`test:e2e`、`test:mutation`、`test:coverage`、`gate:repeat`、`secret-scan`、`secret-scan:staged`、`audit`、`outdated`、`services:up`、`services:up:db`、`services:down`、`record`、`docs:check`、`check:model-ids`、`check:repo-rules`）を plan のコマンドどおりに定義する。対象がまだないタスクは、その波までは実行できなくてよい。`gate` は初期構成（`lint` のみ。上記「gate と CI の段階的な結線」）で定義する
  _Boundary:_ `mise.toml`
  _Depends:_ none
  _Requirements:_ 1.3, 1.4, 1.11
  _Traces:_ REQ-001, C1
  _Verify:_ `mise tasks` に全タスクが列挙され、`mise run gate` が初期構成で成功する
- [x] 1.2 pnpm workspace 宣言（`minimumReleaseAge`、理由付き `allowBuilds`）とルート `package.json`、Turborepo のタスクグラフ（ルートの `tooling/`・`scripts/` のテストはルートタスク `//#test`（ルートの `vitest.config.ts` だけを使い、ワークスペースのテストは含めない。plan C18「テストの実行単位」）、ルートの型検査はルートタスク `//#typecheck`（`tsc -p tsconfig.json --noEmit`））を定義する。ADR-1 の確認（Turborepo 2.11 が pnpm 12 のワークスペースとロックファイルを解決できるか）を行い、失敗したら mise + `pnpm -r` へ後退して理由を `package.json` のコメントに記録する
  _Boundary:_ `pnpm-workspace.yaml`, `package.json`, `pnpm-lock.yaml`, `turbo.json`
  _Depends:_ 1.1
  _Requirements:_ 1.1, 1.3, NFR-11
  _Traces:_ REQ-001, C1
  _Verify:_ クリーンな clone で `mise run setup`（`--frozen-lockfile`）が成功する
- [x] 1.3 Biome の規約（ADR-3: タブ・ダブルクォート・行幅100・セミコロン、`noUnusedVariables`/`noUnusedImports` を error）と `tsconfig.base.json`（strict）、ルートの `tsconfig.json`（ベースを継承し、どのワークスペースにも属さない `tooling/**/*.ts` とルートの設定ファイル（`vitest.config.ts` 等）を `include` する。`noEmit`）を定義する
  _Boundary:_ `biome.json`, `tsconfig.base.json`, `tsconfig.json`
  _Depends:_ 1.2
  _Requirements:_ 1.6, NFR-05
  _Traces:_ REQ-001, C1
  _Verify:_ 未使用 import を含む一時ファイルで `biome ci` が失敗することを1回確認してから、一時ファイルを消す。ルートの型検査は W2 の締め（13.7）で gate に入るまで、W1 の各タスクの完了時に `pnpm exec tsc -p tsconfig.json --noEmit` で確認する
- [x] 1.4 ルート `vitest.config.ts`（対象は `tooling/`・`scripts/` のテストだけ。ワークスペースを `projects` で集約しない。`setup-hermetic` と `gate-reporter` の登録。plan C18「テストの実行単位」）と `stryker.config.mjs`（制御ロジックに限定した対象、`vitest.configFile` は `packages/ai-core/vitest.config.ts`、閾値70）を定義する
  _Boundary:_ `vitest.config.ts`, `stryker.config.mjs`
  _Depends:_ 1.2
  _Requirements:_ 1.4, 1.12, 1.15, 1.16
  _Traces:_ REQ-001, C1, C18
  _Verify:_ Vitest の構成は 4.1・4.3 のテストの実行で、Stryker の構成は 29.3 の `test:mutation` で確認する
- [x] 1.5 pre-commit フック（`biome check` → `gitleaks git --staged --redact` → `check:model-ids`）、`.gitignore`/`.gitleaksignore`、`.env.example`（plan の[環境変数](plan.md#環境変数env-example-に名前だけを列挙する)の表の全変数を名前だけで一度に作る。`AI_*`、`OLLAMA_BASE_URL`、各プロバイダの認証情報、`TAVILY_API_KEY`、`AGENT_*`、`CHAT_RATE_LIMIT_*`、`POSTGRES_*`、`LANGFUSE_*`）、README/AGENTS.md の更新
  _Boundary:_ `.githooks/pre-commit`, `.gitignore`, `.gitleaksignore`, `.env.example`, `README.md`, `AGENTS.md`
  _Depends:_ 1.1
  _Requirements:_ 1.18, 2.18, NFR-07, NFR-11
  _Traces:_ REQ-001, C1
  _Verify:_ `.env.example` とスキーマの一致は 12.4 の `load.test.ts` が検査する。フックはダミーの秘密値をステージして拒否されることを1回確認する

### Implementation Notes

- Node.js 26.10.0・pnpm 12.6.0・gitleaks 8.30.1 と全依存を固定し、Turborepo 2.11.4 が pnpm 12 の workspace / lockfile / root tasks を解決できることを実測した。
- Biome・TypeScript・Vitest・Stryker のルート設定を分離し、`.turbo` 生成後も初期 lint gate が決定的に成功するようにした。
- staged-only の Biome / gitleaks とモデルID検査を pre-commit に並べ、環境変数名だけの `.env.example` とセットアップ文書を整備した。モデルID検査は対象スクリプトを作る Task 5.1 まで明示的に延期する。

---

## 2. CI パイプライン（C2）(P)

プルリクエストで品質ゲート相当の検証・3エンジンE2E・シークレットスキャン・依存監査・
ミューテーションテストを実行し、結果を集約ステータスとして報告する。
W1 では対象のあるジョブだけを置き、残りのジョブは 19.3・29.1 が加える（[gate と CI の段階的な結線](#gate-と-ci-の段階的な結線)）。

_Boundary:_ `.github/workflows/ci.yml`, `.github/dependabot.yml`
_Depends:_ 1
_Requirements:_ 1.7, 1.18, NFR-11
_Traces:_ REQ-001, C2

- [x] 2.1 (P) `ci.yml`: 初期構成のジョブ `gate`、`secret-scan`（`fetch-depth: 0` で全履歴）、`audit`、集約ジョブ `ci-status`（`needs` + `if: always()`）。`mutation` は 19.3、`e2e`（chromium/firefox/webkit マトリクス）と `client-bundle` は 29.1 が加える（[gate と CI の段階的な結線](#gate-と-ci-の段階的な結線)）。Actions はコミット SHA 固定、`permissions: contents: read` のみ、依存インストールは `mise run setup`
  _Boundary:_ `.github/workflows/ci.yml`
  _Depends:_ 1
  _Requirements:_ 1.7, 1.18, NFR-11
  _Traces:_ REQ-001, C2
  _Verify:_ SHA 固定・`permissions`・`--frozen-lockfile` は 5.2 の `actions-pinned`/`frozen-lockfile` 規則が検査する（W1 の締めで gate に入る）。W1 の PR で `ci-status` が成功することを確認する
- [x] 2.2 (P) `dependabot.yml`: npm と GitHub Actions の週次更新、`cooldown`、グループ（`ai-sdk`/`prerelease-toolchain`/`react`/`dev-tooling`）、`@playwright/test` の除外
  _Boundary:_ `.github/dependabot.yml`
  _Depends:_ 1
  _Requirements:_ NFR-11
  _Traces:_ REQ-001, C2
  _Verify:_ GitHub の Insights → Dependency graph → Dependabot で設定の検証エラーがないことを確認する

### Implementation Notes

- CI は初期波で実行対象がある `gate`・`secret-scan`・`audit` だけを独立ジョブにし、`ci-status` が全結果を集約する。
- Actions と mise 本体を固定し、全検証ジョブが `mise run setup` を経由することでローカルと CI の入口を統一した。
- Dependabot は公開24時間待機、互換性が連動する依存のグループ化、Playwright 先行版の除外を同時に管理する。

---

## 3. ローカル依存サービス（C3）(P)

ハンズオン用の Postgres + pgvector と Langfuse 一式を Compose で起動できるようにする。
Compose 関連の環境変数名（`POSTGRES_*`、`LANGFUSE_*`）は 1.5 の `.env.example` に含まれる。

_Boundary:_ `compose.yaml`, `infra/postgres/init/01-extensions.sql`
_Depends:_ 1
_Requirements:_ 1.8
_Traces:_ REQ-001, C3

- [ ] 3.1 (P) `compose.yaml`: `db` プロファイル（`pgvector/pgvector:pg17`、healthcheck）と `trace` プロファイル（`langfuse-web`/`langfuse-worker`/`clickhouse`/`redis`/`minio`。Langfuse の DB は `postgres` サービスに同居）
  _Boundary:_ `compose.yaml`
  _Depends:_ 1
  _Requirements:_ 1.8
  _Traces:_ REQ-001, C3
  _Verify:_ gate の対象外（Docker が必要）。`mise run services:up` で全サービスが healthy になり、Langfuse の Web UI に到達できることを確認する
- [ ] 3.2 `infra/postgres/init/01-extensions.sql`: pgvector 拡張の有効化と Langfuse 用データベースの作成
  _Boundary:_ `infra/postgres/init/01-extensions.sql`
  _Depends:_ 3.1
  _Requirements:_ 1.8
  _Traces:_ REQ-001, C3
  _Verify:_ `mise run services:up:db` の後、`CREATE EXTENSION` 済みであることと Langfuse 用 DB の存在を `psql` で確認する

### Implementation Notes

---

## 4. テスト基盤: ネットワーク遮断とレポーター（C18・tooling）(P)

テストの実行モード固定、ネットワーク遮断、`local` 限定テストの分類、空振り検出を提供する。

_Boundary:_ `tooling/vitest/setup-hermetic.ts`, `tooling/vitest/setup-hermetic.test.ts`, `tooling/vitest/global-setup-local.ts`, `tooling/vitest/gate-reporter.ts`, `tooling/vitest/gate-reporter.test.ts`
_Depends:_ 1
_Requirements:_ 1.5, 1.12, 1.13, 1.14, 1.15, 1.16, 2.5, 2.11, NFR-03
_Traces:_ REQ-001, REQ-002, C18

- [ ] 4.1 (P) `setup-hermetic.ts`: `fetch`・`node:net`（`Socket.prototype.connect`）・`node:dns`（`lookup`/`promises.lookup`/`resolve*`）を接続先を含む `NetworkBlockedError` で遮断し、`AI_TEST_RUN_MODE=local` の時だけ `OLLAMA_BASE_URL` 宛てを許可する + `setup-hermetic.test.ts`
  _Boundary:_ `tooling/vitest/setup-hermetic.ts`, `tooling/vitest/setup-hermetic.test.ts`
  _Depends:_ 1
  _Requirements:_ 1.5, 2.11, 2.5, NFR-03
  _Traces:_ REQ-001, REQ-002, C18
- [ ] 4.2 `global-setup-local.ts`: `AI_TEST_RUN_MODE=local` の時だけ Ollama の到達性と必要モデルの取得済みを確認し、`provide("localAvailability", ...)` で渡す
  _Boundary:_ `tooling/vitest/global-setup-local.ts`
  _Depends:_ 4.1
  _Requirements:_ 1.13, 1.14
  _Traces:_ REQ-001, C18
  _Verify:_ 受け取り側のスキップ判定は 11.2 の `local-only.test.ts` が検証する。本体は、Ollama を止めた状態の `mise run test:local` で `*.local.test.ts` が理由付きでスキップされることを 29.2 で確認する
- [ ] 4.3 `gate-reporter.ts`: 実行・成功・失敗・スキップ（理由別）の件数と DB 依存の未実行件数を表示し、実行件数0件で非ゼロ終了する。0件での失敗は `AI_TEST_SUITE=gate`（既定）のときだけ適用し、`local`・`pg` では対象のない実行単位を許す（plan C18「テストの実行単位」）+ テスト
  _Boundary:_ `tooling/vitest/gate-reporter.ts`, `tooling/vitest/gate-reporter.test.ts`
  _Depends:_ 4.1
  _Requirements:_ 1.12, 1.14, 1.15, 1.16
  _Traces:_ REQ-001, C18

### Implementation Notes

---

## 5. リポジトリ規約検査スクリプト（C20）(P)

設定では表現できないリポジトリ規約（モデルID一元管理、9つの constitution 規則、先行版監視）を
機械的に検査し、W1 の締めとして gate を結線する。

_Boundary:_ `scripts/check-model-ids.mjs`, `scripts/check-model-ids.test.mjs`, `scripts/check-repo-rules.mjs`, `scripts/check-repo-rules.test.mjs`, `scripts/check-updates.mjs`, `scripts/check-updates.test.mjs`, `scripts/gate/count-biome.mjs`, `scripts/gate/count-tsc.mjs`, `scripts/gate/count.test.mjs`, `mise.toml`, `.githooks/pre-commit`
_Depends:_ 1（5.5 は 2、3、4 にも依存する）
_Requirements:_ 1.4, 1.15, 2.10, 2.18
_Traces:_ REQ-001, REQ-002, C20, C1

- [ ] 5.1 (P) `check-model-ids.mjs`: モデル系列の接頭辞を持つ文字列リテラルを走査対象（`apps/`、`packages/`、`scripts/`、`tooling/` の `*.ts`/`*.tsx`/`*.mjs`、`docs/`、`README.md`）から検出し、許可場所（`catalog.ts`、`env-schema.ts` の既定値、自身とそのテスト）を除外し、走査0件で失敗する + テスト
  _Boundary:_ `scripts/check-model-ids.mjs`, `scripts/check-model-ids.test.mjs`
  _Depends:_ 1
  _Requirements:_ 2.18
  _Traces:_ REQ-002, C20
- [ ] 5.2 (P) `check-repo-rules.mjs`: 9規則（`no-deprecated-object-api`、`guarded-agent-only`、`ai-core-no-ui-deps`、`no-dynamic-eval`、`tool-risk-declared`、`actions-pinned`、`frozen-lockfile`、`allow-builds-reasoned`、`no-sensitive-logging`）を、plan C20 の規則表の走査対象・除外どおりに検査し、規則ごとの走査件数（**走査したファイル数**。plan C20）を出力し、いずれか0件なら失敗する。コードを対象とする規則は、文字列リテラル・テンプレートリテラル・コメントの中身を検査しない。`check-repo-rules.mjs` 自身とそのテストは全規則の走査から除外する。`--only <rule,...>` で実行する規則を限定できる + テスト（規則ごとの違反の検出、許可リストの除外、文字列・コメント内の一致を違反としないこと、自身とテストの除外、0件での失敗、`--only`。違反例のファイルはテスト内で一時ディレクトリに書き出す）
  _Boundary:_ `scripts/check-repo-rules.mjs`, `scripts/check-repo-rules.test.mjs`
  _Depends:_ 1
  _Requirements:_ 1.15
  _Traces:_ REQ-001, C20
- [ ] 5.3 (P) `check-updates.mjs`: TypeScript 7.1 先行版の新しいビルドと `watsonx-ai-provider` の `ai@^7` 対応状況を npm レジストリで確認する（取得処理は注入可能にする）+ `check-updates.test.mjs`（レジストリ応答の fixture で、新しいビルドの検出、公開24時間未満の除外、`ai@^7` 対応の判定）
  _Boundary:_ `scripts/check-updates.mjs`, `scripts/check-updates.test.mjs`
  _Depends:_ 1
  _Requirements:_ 2.10
  _Traces:_ REQ-002, C20
- [ ] 5.4 (P) `scripts/gate/count-biome.mjs`・`count-tsc.mjs`: Biome の JSON 出力と、ルートと各ワークスペースの tsconfig ごとの `tsc -p <tsconfig> --listFilesOnly` の出力から走査件数を取り出し、どれかが0件なら失敗する。先に、1.2 で固定した TypeScript 7.1 先行版が `--listFilesOnly` を持つかを実測する。持たない場合は、`count-tsc.mjs` が tsconfig の `files`・`include`・`exclude`（`extends` を解決する）を `node:fs` で展開して数える方式にし、結果を research.md の Risks に記録する（plan C20）+ `scripts/gate/count.test.mjs`（出力または tsconfig の fixture で件数の抽出と0件での失敗）
  _Boundary:_ `scripts/gate/count-biome.mjs`, `scripts/gate/count-tsc.mjs`, `scripts/gate/count.test.mjs`
  _Depends:_ 1
  _Requirements:_ 1.15
  _Traces:_ REQ-001, C20
- [ ] 5.5 W1 の締め: `mise.toml` の `gate` に W1 の段と規則（上記「gate と CI の段階的な結線」）を加える。`.githooks/pre-commit` から `check:model-ids` の暫定の延期分岐（スクリプトがなければスキップ）を外し、常に `mise run check:model-ids` を実行する
  _Boundary:_ `mise.toml`, `.githooks/pre-commit`
  _Depends:_ 2, 3, 4, 5.1, 5.2, 5.3, 5.4
  _Requirements:_ 1.4, 1.15
  _Traces:_ REQ-001, C1
  _Verify:_ `mise run gate` が成功し、各段が走査件数（ファイル数・テスト数）を出力する。W1 の4規則はどれも1件以上を走査する（`no-dynamic-eval` は `scripts/`・`tooling/` を走査する）。一時的に規則の対象ファイルをなくすと、その段が0件で失敗することを1回確認する

### Implementation Notes
