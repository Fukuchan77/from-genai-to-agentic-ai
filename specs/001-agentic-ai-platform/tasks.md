# agentic-ai-platform（Milestone 1）— 実装タスク（索引と現在の波）

`/sdd-tasks` が生成し、`/sdd-analyze`（2026-09-27）の指摘を反映して、実装の波（W1〜W5）ごとに分割した。
2回目の `/sdd-analyze`（2026-09-27）の H-1〜H-3、M-1〜M-4 と、3回目の H-1、M-1〜M-4、L-1〜L-3 も反映した。
ルールは `~/.claude/sdd/rules/tasks-generation.md` と `~/.claude/sdd/rules/tasks-parallel-analysis.md` に従う。
並列モード（`--sequential` 未指定）。

## ファイル構成

| ファイル | 内容 |
|---|---|
| `tasks.md`（本ファイル） | 表記規約、ID 対応表、進捗、gate と CI の段階的な結線、**現在の波**のタスク全文 |
| `tasks-w3.md`〜`tasks-w5.md` | 未着手の波のタスク全文。その波に着手するときに本ファイルへ移す |
| `tasks-comp-w1.md`〜`tasks-comp-w5.md` | 完了した波の保管先。波の完了時に作る（現在は `tasks-comp-w1.md`） |
| `traceability.md` | 要件 → 設計 → タスク → テスト → コミット |

タスク番号は全ファイルで一意で、移動しても変えない。`_Depends:_` と `traceability.md` は、ファイルをまたいで
番号だけで参照する。

### 完了した波の移行手順

1. 移行の条件: その波の全サブタスクが `[x]`、各大タスクの Implementation Notes が記入済み、波の締めのタスク
   （下記「gate と CI の段階的な結線」）が完了し、`mise run gate` と CI の `ci-status` が成功している。加えて、
   その波の敵対的レビューの記録が `.sdd/reviews/` にある（下記「波ごとの敵対的レビュー」）。
2. 1つ目のコミット（例: `docs(tasks): archive wave N`）では、`git mv tasks.md tasks-comp-wN.md` だけを行い、
   本文を変えない。
3. 2つ目のコミット（例: `docs(tasks): promote wave N+1`）では、`git mv tasks-w(N+1).md tasks.md` の後、索引の節
   （本ファイルの「現在の波」より前）を `tasks-comp-wN.md` から `tasks.md` の先頭へ移す。`tasks-comp-wN.md` には
   「現在の波」の本文だけを、本文を変えずに残す。
4. 同じコミットで、下記「進捗」の状態とファイルの列を更新する。
5. 2つのコミットは波の締めの後に続けて行い、同じ PR に含める。並列作業の途中では移行しない。2つに分けるのは、
   Git がリネームを記録せず、削除されたパスだけを内容の類似度で追跡するためである。1つのコミットでは
   `tasks.md` が前後に存在するため、完了した波の履歴を `tasks-comp-wN.md` から `git log --follow` で追えなくなる
   （2026-09-27、W1 の移行で改訂）。

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
| W1 基盤 | 1 ツールチェーン、2 CI、3 ローカル依存サービス、4 テスト基盤、5 リポジトリ規約検査 | 完了（2026-09-27。敵対的レビュー2ラウンド） | [tasks-comp-w1.md](tasks-comp-w1.md) |
| W2 ai-core の土台 | 6 ai-core scaffold、7 eval-suite scaffold、8 apps/web scaffold、9 ModelCatalog、10 Ports、11 testing ヘルパ、12 PlatformConfig、13 MockRuntime | 進行中（現在の波。6〜7 完了） | 本ファイル |
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

# 現在の波: W2 ai-core の土台（大タスク 6〜13）

6.1 → 7.1 → 8.1 は、どれも `pnpm-lock.yaml` を更新するため順に行う（`(P)` を付けない）。それぞれの後続
サブタスク（6.2〜、7.2〜、8.2〜）は並列に進められる。

---

## 6. ai-core パッケージ scaffold と共通エラー型（C1）(P)

`@platform/ai-core` ワークスペースの骨格と、全独自エラーの基底クラスを用意する。

_Boundary:_ `packages/ai-core/package.json`, `packages/ai-core/tsconfig.json`, `pnpm-lock.yaml`, `packages/ai-core/vitest.config.ts`, `packages/ai-core/src/errors.ts`, `packages/ai-core/src/errors.test.ts`
_Depends:_ 1, 4
_Requirements:_ 1.2, NFR-05, NFR-06
_Traces:_ REQ-001, C1, C18

- [x] 6.1 `package.json`（plan の File Structure Plan に列挙した M1 の依存をすべて宣言し、サブパス `exports` の骨格を置く。`test`・`test:coverage` スクリプトは最初のテストと同時に 6.3 で加える）、`tsconfig.json`（ベース設定の継承）
  _Boundary:_ `packages/ai-core/package.json`, `packages/ai-core/tsconfig.json`, `pnpm-lock.yaml`
  _Depends:_ 1
  _Requirements:_ 1.2
  _Traces:_ REQ-001, C1
  _Verify:_ `mise run setup` がロックファイルを更新して成功する。UI 依存がないことは 13.7 で gate に入る `ai-core-no-ui-deps` が検査する
- [x] 6.2 `vitest.config.ts`（node 環境、`setup-hermetic` と `gate-reporter` の登録、`AI_TEST_SUITE` によるテストの選択、カバレッジを常に有効にした行カバレッジ80%の閾値。Stryker もこの設定を使う。plan C18）
  _Boundary:_ `packages/ai-core/vitest.config.ts`
  _Depends:_ 6.1, 4
  _Requirements:_ NFR-06
  _Traces:_ REQ-001, C18
  _Verify:_ 6.3 で `test` スクリプトを加えた後、閾値を下回る状態で `mise run test` が失敗することを1回確認する
- [x] 6.3 `src/errors.ts`: `PlatformError` 基底クラス（`code`・日本語 `message`・`details`）と閉じた語彙の `PlatformErrorCode` + `errors.test.ts`。`packages/ai-core/package.json` に `test`・`test:coverage`（`vitest run --coverage.enabled --coverage.reporter=html --coverage.thresholds.lines=0`。HTML レポートの生成だけを行い、閾値の強制は gate の `test` 段が担う。plan C18「テストの実行単位」）スクリプトを加える（ai-core の最初のテスト）
  _Boundary:_ `packages/ai-core/src/errors.ts`, `packages/ai-core/src/errors.test.ts`, `packages/ai-core/package.json`
  _Depends:_ 6.2
  _Requirements:_ 1.2, NFR-05
  _Traces:_ REQ-001, C1

### Implementation Notes

- `pnpm-lock.yaml` は 6.1・7.1・8.1 の `_Boundary:_` に含める（依存の宣言と同時に生成物として更新される。W2 の lockfile 更新直列化規約）。
- カバレッジ計測は全スイートで有効にし、80%閾値は0件を許可する `local` / `pg` ではなく `gate` だけに適用する。
- `PlatformErrorCode` はこのタスクで根拠を確認できる M1 公開エラーコードだけを列挙し、後続のエラー subclass は各タスクで必要なコードを追加する。

---

## 7. eval-suite パッケージ scaffold（C21）(P)

`@platform/eval-suite` ワークスペースの骨格（評価の実体は M4）を用意する。

_Boundary:_ `packages/eval-suite/package.json`, `packages/eval-suite/tsconfig.json`, `pnpm-lock.yaml`, `packages/eval-suite/vitest.config.ts`, `packages/eval-suite/tests/capability/README.md`
_Depends:_ 4, 6.1
_Requirements:_ 1.1, 1.13, 1.14
_Traces:_ REQ-001, C21

- [x] 7.1 `package.json`（`@platform/ai-core` に依存）、`tsconfig.json`。`test`・`test:coverage` スクリプトは最初のテストと同時に 19.1 で加える（テスト0件のプロジェクトで gate の `test` 段が失敗するのを防ぐ）
  _Boundary:_ `packages/eval-suite/package.json`, `packages/eval-suite/tsconfig.json`, `pnpm-lock.yaml`
  _Depends:_ 6.1
  _Requirements:_ 1.1
  _Traces:_ REQ-001, C21
  _Verify:_ `mise run setup` と `mise run typecheck` が成功する
- [x] 7.2 `vitest.config.ts`（`setup-hermetic`/`global-setup-local`/`gate-reporter` の登録、`AI_TEST_SUITE` によるテストの選択。ルートからは集約しない。plan C18「テストの実行単位」）
  _Boundary:_ `packages/eval-suite/vitest.config.ts`
  _Depends:_ 7.1, 4
  _Requirements:_ 1.13, 1.14
  _Traces:_ REQ-001, C21
  _Verify:_ 19.1・19.2 のテストの実行で確認する
- [x] 7.3 `tests/capability/README.md`: Capability / Regression の配置規約と 004 への引き継ぎ事項
  _Boundary:_ `packages/eval-suite/tests/capability/README.md`
  _Depends:_ 7.1
  _Requirements:_ 1.13
  _Traces:_ REQ-001, C21
  _Verify:_ 文書のみ。レビューで確認する

### Implementation Notes

- `package.json` は後続 19.1 が scripts だけを追加できるよう、workspace 依存と Vitest / TypeScript の開発依存を scaffold 時点で固定した。eval-suite 自体にはテストがまだないため `test` script は置かない。
- `vitest.config.ts` は root config から集約せず、`gate` / `local` / `pg` を独立した execution unit として選択する。空の `local` / `pg` は許可し、空の `gate` は失敗する。
- Capability は品質の達成度、Regression は決定論的な既存契約を担い、004 ではデータセット・rubric・Judge 校正・安全性評価を同じ配置に追加する。

---

## 8. apps/web ワークスペース scaffold（C13 一部）(P)

Next.js アプリのワークスペース骨格（機能ロジックは含まない）を用意する。

_Boundary:_ `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/next-env.d.ts`, `pnpm-lock.yaml`, `apps/web/next.config.ts`, `apps/web/vitest.config.ts`, `apps/web/components.json`, `apps/web/app/globals.css`, `biome.json`, `scripts/check-web-theme.test.mjs`
_Depends:_ 7.1
_Requirements:_ 1.1, NFR-09
_Traces:_ REQ-001, C13

- [x] 8.1 `package.json`（plan の File Structure Plan の `apps/web/package.json` の行に列挙した依存・開発依存をすべて宣言する。Next.js・React・`@ai-sdk/react`・`babel-plugin-react-compiler`・`server-only`・Tailwind CSS・shadcn/ui の生成部品の実行時依存・`jsdom`・Testing Library・`@vitejs/plugin-react`・Playwright・axe。パス別名は Vite 8 native `resolve.tsconfigPaths` を使う。`typecheck`（`next typegen && tsc --noEmit`）等のスクリプト。`test`・`test:coverage` スクリプトは 21.1 で加える）、`tsconfig.json`、`next-env.d.ts`
  _Boundary:_ `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/next-env.d.ts`, `pnpm-lock.yaml`
  _Depends:_ 7.1
  _Requirements:_ 1.1
  _Traces:_ REQ-001, C13
  _Verify:_ `mise run setup` と `mise run typecheck` が成功する
- [x] 8.2 `next.config.ts`（`reactCompiler: true`、`typedRoutes: true`、`serverExternalPackages`（jsdom 等））
  _Boundary:_ `apps/web/next.config.ts`
  _Depends:_ 8.1
  _Requirements:_ 1.1
  _Traces:_ REQ-001, C13
  _Verify:_ `mise run typecheck` が成功する。`next build` の成功は 25.2 で確認する
- [x] 8.3 `vitest.config.ts`（jsdom 環境のコンポーネントテストと node 環境の Route Handler テストの2プロジェクト。両方に `setup-hermetic` と `gate-reporter` を登録し、`AI_TEST_SUITE` によるテストの選択（plan C18「テストの実行単位」）を適用する。`@vitejs/plugin-react`、Vite 8 native `resolve.tsconfigPaths`、`server-only` の空モジュールへの別名解決）、`components.json`（shadcn/ui 生成設定）、`app/globals.css`（Tailwind CSS v4、`tw-animate-css`、WCAG 2.2 AA のコントラスト）、Biome の Tailwind directive parser、token contrast の静的回帰テスト
  _Boundary:_ `apps/web/vitest.config.ts`, `apps/web/components.json`, `apps/web/app/globals.css`, `biome.json`, `scripts/check-web-theme.test.mjs`
  _Depends:_ 8.1
  _Requirements:_ 1.1, NFR-09
  _Traces:_ REQ-001, C13
  _Verify:_ `mise run gate` が `scripts/check-web-theme.test.mjs` の token contrast（text 4.5:1、UI boundary と不透明 focus outline 3:1）を実行して成功する。Vitest の Web execution unit は 21.1 以降、完成画面の computed style とコントラストは 27.3 のブラウザ検査でも確認する

### Implementation Notes

- 依存は 2026-09-28 の npm registry の version/time を実測し、公開後24時間以上の版を完全一致で固定した。Next.js は research 時点の canary ではなく、同じ要件（React Compiler、typed routes）を満たす安定版 16.3.6 を採用した。`@ai-sdk/react` は ai-core と同じ `ai@7.0.113` release cohort の 4.0.116 とし、Web 内に AI SDK Core を重複させない。`@platform/ai-core` は dependency direction に従って直接依存とした。`test` / `test:coverage` scripts は 21.1 まで追加していない。
- `next typegen` が標準の `next-env.d.ts` を生成するため、再現可能な型入口として scaffold に含めた。`serverExternalPackages` は `jsdom` と、ai-core の字幕取得で使う `youtubei.js` を外部化する。
- Vitest 5 では reporter と `passWithNoTests` は root-only option なので、2 project 共通の root に `gate-reporter` を1回登録し、`setup-hermetic` は各 project に登録した。component は jsdom、Route Handler / server module は node で分離する。パス別名は Vite 8 native `resolve.tsconfigPaths` を使い、非保守の `vite-tsconfig-paths` / `tsconfck` は導入しない。
- Tailwind v4 の `@theme` / `@custom-variant` / `@apply` を repository-wide Biome が解釈できるよう、`biome.json` の CSS parser に `tailwindDirectives: true` を追加した。light/dark の text pair 4.5:1 と input/border/opaque focus outline pair 3:1 は `scripts/check-web-theme.test.mjs` で直接検査し、完成画面の computed style と WCAG 2.2 AA は 27.3 のブラウザ検査でも確認する。

---

## 9. ModelCatalog（C5）

モデルID、対応機能、コンテキスト上限、単価、用途別既定モデルを1か所で定義する。

_Boundary:_ `packages/ai-core/src/models/types.ts`, `packages/ai-core/src/models/catalog.ts`, `packages/ai-core/src/models/catalog.test.ts`
_Depends:_ 6
_Requirements:_ 2.2, 2.8, 2.10, 2.17, 2.18, NFR-13
_Traces:_ REQ-002, C5

- [x] 9.1 `models/types.ts`: `ProviderId`・`ModelId`・`Capability`・`ModelPurpose`・`ModelEntry` の Zod 非依存の型（クライアントからも import 可能）
  _Boundary:_ `packages/ai-core/src/models/types.ts`
  _Depends:_ 6
  _Requirements:_ 2.17
  _Traces:_ REQ-002, C5
  _Verify:_ 型のみ。`mise run typecheck` と 9.2 のテストで確認する
- [x] 9.2 `models/catalog.ts`・`catalog.test.ts`: `MODEL_CATALOG`（`as const satisfies ModelCatalog`）、`getModelEntry`、`listModels`、`defaultModelFor`、`estimateCost`。watsonx.ai は含めない。テストはカタログ整合性（既定モデルの実在、機能と用途の一致、`live` の単価の存在）と、同梱カセットの `modelId` がカタログに実在することを検証する。モデル ID の値は実装時に各社公式ドキュメントで確認する（constitution 原則 8）
  _Boundary:_ `packages/ai-core/src/models/catalog.ts`, `packages/ai-core/src/models/catalog.test.ts`
  _Depends:_ 9.1
  _Requirements:_ 2.2, 2.8, 2.10, 2.17, 2.18, NFR-13
  _Traces:_ REQ-002, C5

### Implementation Notes

- 型は Zod に依存させず、`ProviderId`、`RunMode`、`Capability`、`ModelPurpose`、カタログ・単価・使用量・コスト見積もりの構造を `types.ts` に集約した。`CatalogModelId` は `MODEL_CATALOG` のキーから導出し、実行時のモデル ID リテラルは `catalog.ts` だけに置く。
- 2026-09-28 に Anthropic、OpenAI、Microsoft Azure、Google、Ollama の公式モデル・価格ページを確認し、`mock` / `local` / `live` のモデル、対応機能、コンテキスト上限、出力上限、単価と用途別既定値を登録した。watsonx.ai は Req 2.10 に従って含めていない。
- `defaultModelFor` は宣言済みの mode / provider / purpose 組み合わせだけを返し、埋め込みモデルを持たない Anthropic / Azure の embedding 既定値などは `RangeError` にする。`estimateCost` はキャッシュ読出し単価が未定義の場合、入力単価を用いる保守的な見積もりを返す。カセット検査は `fixtures/cassettes/` が後続タスクで追加された時点から、その `modelId` を同じテストで検証する。

---

## 10. Ports（C10）(P)

時刻と外部サービスへのアクセスをインターフェースとして定義し、実装を差し替え可能にする。
録画用ラッパ（`recordingHttpFetcher`・`recordingTranscriptSource`・`recordingWebSearch`）は C7 に属する（13.4）。

_Boundary:_ `packages/ai-core/src/ports/clock.ts`, `packages/ai-core/src/ports/clock.test.ts`, `packages/ai-core/src/ports/http.ts`, `packages/ai-core/src/ports/http.test.ts`, `packages/ai-core/src/ports/transcript.ts`, `packages/ai-core/src/ports/transcript.test.ts`, `packages/ai-core/src/ports/web-search.ts`, `packages/ai-core/src/ports/web-search.test.ts`, `packages/ai-core/src/ports/index.ts`, `packages/ai-core/src/ports/abort.ts`
_Depends:_ 6
_Requirements:_ 2.15, 5.7
_Traces:_ REQ-002, REQ-005, C10

- [x] 10.1 (P) `ports/clock.ts`: `Clock`、`systemClock`、`createFakeClock()` + `clock.test.ts`（時刻の進行、`timeoutSignal` の中断）
  _Boundary:_ `packages/ai-core/src/ports/clock.ts`, `packages/ai-core/src/ports/clock.test.ts`
  _Depends:_ 6
  _Requirements:_ 5.7
  _Traces:_ REQ-005, C10
- [x] 10.2 `ports/http.ts`: `HttpFetcher` と `createNodeHttpFetcher()` + `http.test.ts`（注入した `fetch` で、ステータス・ヘッダー・本文の写像と `AbortSignal` の伝播）
  _Boundary:_ `packages/ai-core/src/ports/http.ts`, `packages/ai-core/src/ports/http.test.ts`
  _Depends:_ 10.1
  _Requirements:_ 2.15
  _Traces:_ REQ-002, C10
- [x] 10.3 `ports/transcript.ts`: `TranscriptSource` と `createYoutubeiTranscriptSource()` + `transcript.test.ts`（異常理由 `no-captions`/`private`/`fetch-failed` の写像を、`youtubei.js` の応答を模したテスト内のスタブで検証する。C7 の fixture 実装には依存しない）
  _Boundary:_ `packages/ai-core/src/ports/transcript.ts`, `packages/ai-core/src/ports/transcript.test.ts`, `packages/ai-core/src/ports/abort.ts`
  _Depends:_ 10.1
  _Requirements:_ 2.15
  _Traces:_ REQ-002, C10
- [x] 10.4 `ports/web-search.ts`・`index.ts`: `WebSearchProvider` と `createTavilySearch(apiKey)`、`./ports` の公開API + `web-search.test.ts`（注入した Tavily クライアントのスタブで `SearchHit` への写像と `AbortSignal` の伝播）
  _Boundary:_ `packages/ai-core/src/ports/web-search.ts`, `packages/ai-core/src/ports/web-search.test.ts`, `packages/ai-core/src/ports/index.ts`, `packages/ai-core/src/ports/abort.ts`
  _Depends:_ 10.2, 10.3
  _Requirements:_ 2.15
  _Traces:_ REQ-002, C10

### Implementation Notes

- `Clock` は epoch milliseconds を返し、fake 実装は `advanceBy` / `set` で決定論的に進行する。期限到来時は native timeout と同じ `TimeoutError` の `DOMException` で中断する。
- HTTP ポートは Web 標準の `RequestInit` / `fetch` を境界に使い、応答本文を文字列、headers を小文字キーの record に正規化する。
- YouTube 字幕ポートは `youtubei.js` の `getInfo()` の `basic_info`・`playability_status` と `getTranscript()` の戻り値を Zod で検証してから `TranscriptResult` に変換する（constitution 原則 5。`/sdd-ship` の NO-GO を受けた修正）。検証の失敗（`start_ms` / `end_ms` が数字列でない、終了が開始より前、など）は `fetch-failed` に閉じる。
- 失敗理由の分類: "This video is private" / "private video"（例外の `info.reason`、または `playability_status.reason`）は `private`。`LOGIN_REQUIRED` だけでは年齢制限の動画も含むため `private` にしない。youtubei の定型文 "Video likely has no transcript" と、字幕パネル・segment が空の応答は `no-captions`。それ以外は `fetch-failed`。例外の `info` は Zod で `status` / `reason` だけを読み、循環参照でも分類中に例外を投げない。
- section header は `target_id` の有無で segment から除外する。youtubei の parser node が持つ `type`（`TranscriptSegment` / `TranscriptSectionHeader`）による判別は、スタブ全体の変更を伴うため見送った（`.sdd/reviews/agentic-ai-platform-10.3-10.4.md` の L-4。youtubei の更新で `targetId` が欠けた場合は全 segment が `no-captions` になる）。
- `Innertube.create()` の失敗はキャッシュせず、次の呼び出しで作り直す。
- Tavily ポートは SDK の応答を `unknown` として受け、Zod（`url` は http/https のみ）で検証してから `SearchHit` に写像する。検証の失敗と SDK の例外（401・429・通信失敗など）は `PlatformError("source-unavailable", { provider: "tavily" })` に閉じる。`publishedDate` の欠落・`null` は省略する。http/https 以外の URL を1件でも含む応答は、結果全体を fail-closed で拒否する（引用元として扱う URL を部分的に信頼しないため）。
- `@tavily/core` 0.7.13 は未知の option をリクエスト本文へ直列化するため、本番 adapter は `signal` を SDK に渡さず、呼び出し元の中断は abort race で即時に返す（SDK の HTTP 要求自体は止まらない。upstream が中断の option を提供した時点で adapter だけを置き換える）。注入 client の契約には `signal` を残し、中断に対応する client は利用できる。abort race は字幕と Web 検索で共有する内部 helper `ports/abort.ts` に置き、`./ports` からは公開しない（Task 10・10.3・10.4 の境界に追加）。

---

## 11. ai-core testing ヘルパ（C18・ai-core/testing）

`@platform/ai-core/testing` サブパスとして、モックモデルのファクトリと `local` 限定テストの
ヘルパを提供する。

_Boundary:_ `packages/ai-core/src/testing/index.ts`, `packages/ai-core/src/testing/mock-models.ts`, `packages/ai-core/src/testing/mock-models.test.ts`, `packages/ai-core/src/testing/local-only.ts`, `packages/ai-core/src/testing/local-only.test.ts`, `packages/ai-core/vitest.config.ts`
_Depends:_ 10
_Requirements:_ 1.13, 1.14
_Traces:_ REQ-001, C18

- [x] 11.1 `testing/mock-models.ts`: `createTextStreamModel`・`createToolCallingModel`・`createObjectModel`（`MockLanguageModelV4` + `simulateReadableStream`）+ `mock-models.test.ts`（生成とストリームの両方で指定した内容を返す）
  _Boundary:_ `packages/ai-core/src/testing/mock-models.ts`, `packages/ai-core/src/testing/mock-models.test.ts`
  _Depends:_ 10
  _Requirements:_ 1.13
  _Traces:_ REQ-001, C18
- [x] 11.2 `testing/local-only.ts`・`index.ts`: `describeLocal`/`itLocal`（`localAvailability` 不可時は理由付きスキップ）と `createFakeClock` の再公開 + `local-only.test.ts`（不可なら理由付きでスキップ、可なら実行）
  _Boundary:_ `packages/ai-core/src/testing/local-only.ts`, `packages/ai-core/src/testing/local-only.test.ts`, `packages/ai-core/src/testing/index.ts`, `packages/ai-core/vitest.config.ts`
  _Depends:_ 11.1
  _Requirements:_ 1.13, 1.14
  _Traces:_ REQ-001, C18

### Implementation Notes

- モック factory は AI SDK の公開型だけに依存し、V4 の provider 内部型は `MockLanguageModelV4` の `doGenerate` / `doStream` 戻り型から導出する。
- `describeLocal` は suite 内の `beforeEach`、`itLocal` は test callback の先頭で `context.skip(reason)` を呼び、`gate-reporter` が理由を集計できる note を残す。
- ai-core の local test でも `localAvailability` を受け取れるよう、scaffold で欠けていた `global-setup-local.ts` を `vitest.config.ts` に登録した（Task 11 boundary 外の prerequisite fix。VDD review 対象）。

---

## 12. PlatformConfig（C4）

環境変数を Zod で検証し、実行モード・プロバイダ・用途別モデル・上限値を型付きの設定として返す。
環境変数名の一覧（`.env.example`）は 1.5 で作成済み。

_Boundary:_ `packages/ai-core/src/config/env-schema.ts`, `packages/ai-core/src/config/env-schema.test.ts`, `packages/ai-core/src/config/feature-requirements.ts`, `packages/ai-core/src/config/feature-requirements.test.ts`, `packages/ai-core/src/config/defaults.ts`, `packages/ai-core/src/config/run-mode.ts`, `packages/ai-core/src/config/run-mode.test.ts`, `packages/ai-core/src/config/load.ts`, `packages/ai-core/src/config/load.test.ts`, `packages/ai-core/src/config/index.ts`
_Depends:_ 9
_Requirements:_ 1.9, 2.1, 2.5, 2.8, 2.12, 2.13, 2.18, 6.1, NFR-07
_Traces:_ REQ-001, REQ-002, REQ-006, C4

- [ ] 12.1 `config/env-schema.ts`・`defaults.ts`: 環境変数の Zod スキーマと既定値（停止条件、レート制限、入力上限）+ `env-schema.test.ts`（既定値、型の変換、不正値の拒否）
  _Boundary:_ `packages/ai-core/src/config/env-schema.ts`, `packages/ai-core/src/config/defaults.ts`, `packages/ai-core/src/config/env-schema.test.ts`
  _Depends:_ 9
  _Requirements:_ 2.1, 2.8, 6.1, NFR-07
  _Traces:_ REQ-002, REQ-006, C4
- [ ] 12.2 `config/feature-requirements.ts`: 機能IDと必須環境変数の対応表 + `feature-requirements.test.ts`（全変数がスキーマに存在し、全機能が1件以上の変数を持つ）
  _Boundary:_ `packages/ai-core/src/config/feature-requirements.ts`, `packages/ai-core/src/config/feature-requirements.test.ts`
  _Depends:_ 12.1
  _Requirements:_ 1.9
  _Traces:_ REQ-001, C4
- [ ] 12.3 `config/run-mode.ts`: `resolveRunMode`（テストランナー内は `AI_TEST_RUN_MODE ?? "mock"`、それ以外は `AI_RUN_MODE ?? "local"`）+ テスト
  _Boundary:_ `packages/ai-core/src/config/run-mode.ts`, `packages/ai-core/src/config/run-mode.test.ts`
  _Depends:_ 12.1
  _Requirements:_ 2.5, 2.12
  _Traces:_ REQ-002, C4
- [ ] 12.4 `config/load.ts`・`index.ts`: `loadPlatformConfig`・`ConfigError`（不足変数名と機能名の列挙）。`AI_RECORD=1` と実行モード `mock` の組み合わせは `ConfigError` で拒否する（録画は `local`/`live` だけ。`mise run record` はこの検査で `mock` での起動を止める）+ テスト（不足変数の列挙、既定値、カタログ外のモデル ID の拒否、`AI_RECORD=1` + `mock` の拒否、`.env.example` の変数名とスキーマの一致）
  _Boundary:_ `packages/ai-core/src/config/load.ts`, `packages/ai-core/src/config/index.ts`, `packages/ai-core/src/config/load.test.ts`
  _Depends:_ 12.2, 12.3
  _Requirements:_ 1.9, 2.13, 2.18, NFR-07
  _Traces:_ REQ-001, REQ-002, C4

### Implementation Notes

---

## 13. MockRuntime（C7）

`mock` モードで、ネットワークを使わずに決定論的な応答を返す。`local`/`live` の録画（LLM と外部サービス）も扱う。
W2 の締めとして gate を結線する。

_Boundary:_ `packages/ai-core/src/mock/request-key.ts`, `packages/ai-core/src/mock/request-key.test.ts`, `packages/ai-core/src/mock/scenario.ts`, `packages/ai-core/src/mock/cassette-store.ts`, `packages/ai-core/src/mock/resolve.ts`, `packages/ai-core/src/mock/scenario-model.ts`, `packages/ai-core/src/mock/recording.ts`, `packages/ai-core/src/mock/redactor.ts`, `packages/ai-core/src/mock/deterministic-embedding.ts`, `packages/ai-core/src/mock/fixtures.ts`, `packages/ai-core/src/mock/index.ts`, `packages/ai-core/src/mock/scenario-model.test.ts`, `packages/ai-core/src/mock/resolve.test.ts`, `packages/ai-core/src/mock/recording.test.ts`, `packages/ai-core/src/mock/deterministic-embedding.test.ts`, `packages/ai-core/src/mock/fixtures.test.ts`, `packages/ai-core/fixtures/scenarios/m1-2.ts`, `packages/ai-core/fixtures/scenarios/m1-3.ts`, `packages/ai-core/fixtures/http/*.json`, `packages/ai-core/fixtures/transcripts/*.json`, `packages/ai-core/fixtures/web-search/*.json`, `packages/ai-core/fixtures/cassettes/.gitkeep`, `mise.toml`
_Depends:_ 9, 10（13.7 は 6〜12 にも依存する）
_Requirements:_ 1.4, 1.15, 2.4, 2.13, 2.14, 2.15, 2.16, NFR-02, NFR-03
_Traces:_ REQ-001, REQ-002, C7, C1

- [ ] 13.1 `mock/request-key.ts`: 呼び出しパラメータの正規化と `requestKey()`（正規化JSONのSHA-256）+ `request-key.test.ts`（キー順やプロバイダ固有オプションで値が変わらず、プロンプト・ツール名・用途で変わる）
  _Boundary:_ `packages/ai-core/src/mock/request-key.ts`, `packages/ai-core/src/mock/request-key.test.ts`
  _Depends:_ 9
  _Requirements:_ 2.4, NFR-02
  _Traces:_ REQ-002, C7
- [ ] 13.2 `mock/scenario.ts`・`scenario-model.ts`: `defineScenario`・`createScenarioModel`（述語照合、`stepIndex`/`toolResultFor`/`purpose` の導出と束縛、生成・ストリームの決定論的応答）+ テスト
  _Boundary:_ `packages/ai-core/src/mock/scenario.ts`, `packages/ai-core/src/mock/scenario-model.ts`, `packages/ai-core/src/mock/scenario-model.test.ts`
  _Depends:_ 13.1
  _Requirements:_ 2.4, NFR-02
  _Traces:_ REQ-002, C7
- [ ] 13.3 `mock/cassette-store.ts`・`resolve.ts`: シナリオ→カセット→`MockFixtureMissingError` の解決順序（ネットワークへフォールバックしない）+ テスト（曖昧な述語の検出を含む）
  _Boundary:_ `packages/ai-core/src/mock/cassette-store.ts`, `packages/ai-core/src/mock/resolve.ts`, `packages/ai-core/src/mock/resolve.test.ts`
  _Depends:_ 13.2
  _Requirements:_ 2.14
  _Traces:_ REQ-002, C7
- [ ] 13.4 `mock/redactor.ts`・`recording.ts`: 録画ミドルウェアと、C10 の3つのポートを包む録画用ラッパ（`recordingHttpFetcher`・`recordingTranscriptSource`・`recordingWebSearch`）、秘密値・ヘッダーの伏せ字化。`youtubei.js` と `@tavily/core` は `HttpFetcher` を通らないため、字幕と Web 検索はポートの入出力（`videoId`→`TranscriptResult`、`query`→`SearchHit[]`）を、13.6 の fixture 実装がそのまま読める形式（`TranscriptFixture`・`WebSearchFixture`）で録画する + テスト（LLM と3種の外部サービスの録画に秘密情報とヘッダーが残らないこと、録画した字幕・Web 検索を 13.6 の fixture 実装で再生すると同じ結果になること）
  _Boundary:_ `packages/ai-core/src/mock/redactor.ts`, `packages/ai-core/src/mock/recording.ts`, `packages/ai-core/src/mock/recording.test.ts`
  _Depends:_ 10, 13.1
  _Requirements:_ 2.13
  _Traces:_ REQ-002, C7
- [ ] 13.5 `mock/deterministic-embedding.ts`: ハッシュ由来の決定論的な埋め込みモデル（L2正規化）+ テスト（決定性・次元数・正規化）
  _Boundary:_ `packages/ai-core/src/mock/deterministic-embedding.ts`, `packages/ai-core/src/mock/deterministic-embedding.test.ts`
  _Depends:_ 13.1
  _Requirements:_ 2.16
  _Traces:_ REQ-002, C7
- [ ] 13.6 `mock/fixtures.ts`・`index.ts`・`packages/ai-core/fixtures/*`: HTTP・字幕・Web検索の fixture 実装（手書きの fixture と、`fixtures/cassettes/` 配下に録画した fixture の両方を読む）、M1 のシナリオ・cassette 保存先、公開API + `fixtures.test.ts`（登録済みの要求に fixture を返し、未登録で `MockFixtureMissingError`）
  _Boundary:_ `packages/ai-core/src/mock/fixtures.ts`, `packages/ai-core/src/mock/fixtures.test.ts`, `packages/ai-core/src/mock/index.ts`, `packages/ai-core/fixtures/scenarios/m1-2.ts`, `packages/ai-core/fixtures/scenarios/m1-3.ts`, `packages/ai-core/fixtures/http/*.json`, `packages/ai-core/fixtures/transcripts/*.json`, `packages/ai-core/fixtures/web-search/*.json`, `packages/ai-core/fixtures/cassettes/.gitkeep`
  _Depends:_ 10, 13.3, 13.4, 13.5
  _Requirements:_ 2.15, NFR-03
  _Traces:_ REQ-002, C7
- [ ] 13.7 W2 の締め: `mise.toml` の `gate` に W2 の段と規則（[tasks.md](tasks.md)「gate と CI の段階的な結線」）を加える
  _Boundary:_ `mise.toml`
  _Depends:_ 6, 7, 8, 9, 10, 11, 12, 13.1, 13.2, 13.3, 13.4, 13.5, 13.6
  _Requirements:_ 1.4, 1.15
  _Traces:_ REQ-001, C1
  _Verify:_ `mise run gate` が成功し、`typecheck` 段（ルートの `//#typecheck` を含む）と追加した4規則が走査件数を出力する。ai-core の行カバレッジが80%以上である

### Implementation Notes
