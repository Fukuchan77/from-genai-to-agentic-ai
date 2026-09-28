# Task 7 Adversarial Review（2026-09-28）

## Risk Trigger Resolution

- **新規依存 / lockfile: explained and verified.** `packages/eval-suite/package.json` の第三者 devDependencies は `@types/node@26.6.3`、`@vitest/coverage-v8@5.0.2`、`typescript@7.1.0-dev.20260926.1`、`vitest@5.0.2` の4件で、すべて完全一致版である。これらは `research.md` の External dependencies と plan C18 の Vitest・coverage・strict TypeScript 契約に宣言済みであり、Task 7.1 が package manifest の依存宣言を一括所有し、Task 19.1 は scripts だけを追加するため、この時点での宣言も必要である。`pnpm-lock.yaml` の変更は `packages/eval-suite` importer 19行だけで、新しい解決版や未宣言 package を追加していない。
- **workspace 依存方向: verified.** 実行時依存は `@platform/ai-core: workspace:*` のみであり、`ai-core` から `eval-suite` への逆依存・import はない。steering の「`apps/web` と `packages/eval-suite` → `@platform/ai-core`、逆向き禁止」に一致する。
- **脆弱性監査: clean.** sandbox 内の初回 `mise run audit` は DNS 制限で失敗したが、同一コマンドをネットワーク許可下で再実行し、`No known vulnerabilities found` を確認した。

## Boundary Audit

| Change | Declared boundary | Result |
|---|---|---|
| `packages/eval-suite/package.json` | Task 7 / 7.1 | in boundary |
| `packages/eval-suite/tsconfig.json` | Task 7 / 7.1 | in boundary |
| `pnpm-lock.yaml` importer | Task 7 / 7.1 | in boundary |
| `packages/eval-suite/vitest.config.ts` | Task 7 / 7.2 | in boundary |
| `packages/eval-suite/tests/capability/README.md` | Task 7 / 7.3 | in boundary |
| `specs/001-agentic-ai-platform/tasks.md` | expected process file | allowed |
| `specs/001-agentic-ai-platform/pdca/do.md` | expected process file | allowed |

`git status`、`git diff --name-status`、untracked file 列挙で、上記以外の実装変更は確認されなかった。`packages/eval-suite/.turbo/` と `node_modules/` は生成物かつ ignore 対象であり、差分には含まれない。

## Test Integrity

- tracked test の変更・削除・rename は0件で、untracked の新規 test source も0件だった。既存テストへの `.skip` / `.only` 追加もない。
- eval-suite に `test` / `test:coverage` script をまだ置かない方針は plan C18 と tasks.md 7.1/19.1 に一致する。現時点で空の eval-suite を Turbo の gate execution unit に入れず、Task 19.1 で最初の regression test と script を同時追加するため、空の execution unit を合格扱いする fake pass にはならない。
- `mise run gate` は root 234件、ai-core 3件を実行し、両 execution unit の gate-reporter が非ゼロ件数を確認した。Turbo は packages in scope に eval-suite を認識しつつ、script がないため実行対象は意図どおり2 unitだった。

## Configuration Fidelity

- `gate`: `tests/**/*.test.ts`、`*.pg.test.*` を除外、0件で exit 1、gate-reporter も `executed=0` を検出して exit 1。
- `local`: `tests/**/*.local.test.ts` のみ、0件を許可して exit 0。
- `pg`: `tests/**/*.pg.test.ts` のみ、0件を許可して exit 0。
- unknown suite: config 読み込み時に `Unknown AI_TEST_SUITE ... Expected one of: gate, local, pg` で exit 1。
- `setup-hermetic`、`global-setup-local`、`gate-reporter` はそれぞれ eval-suite の workspace config に登録されている。global setup 自体は `AI_TEST_RUN_MODE=local` の場合だけ Ollama を確認する既存実装であり、gate の hermetic 性を崩さない。
- root `vitest.config.ts` に `projects` / workspace 集約はなく、eval-suite config は `root: import.meta.dirname` を持つ独立設定である。C18 の「ルートから集約しない」に一致する。

## Documentation Fidelity

Capability は品質の達成度、Regression は決定論的契約として説明され、Task 19.1/19.2 の予定ファイルと整合する。004 への引き継ぎもデータセット、rubric、Judge、安全性・ハーネス、トレーサビリティを明記しており、C21 と 001 Req 1.13/1.14 の主契約は満たす。ただし、共有テスト命名規約の DB レーンに1件の軽微な欠落がある。

## Critique

### [LOW] DB 評価の配置規約が `*.pg.test.ts` だけに見え、gate 内の `*.db.test.ts` が欠落している
**Location**: packages/eval-suite/tests/capability/README.md:23-28
**Issue**: 「ファイル名と実行レーン」が将来の DB 評価を `*.pg.test.ts` とだけ説明し、インプロセス DB を使って gate に含める `*.db.test.ts` の共有規約を記載していない。
**Evidence**: README は「`*.pg.test.ts`: 将来データベースが必要な評価に使い、`mise run test:db` だけで実行する」とする一方、`.sdd/steering/tech.md:67-71` と 001 Req 1.12 は、`*.db.test.ts` をインプロセス DB で gate に含め、Docker Postgres が必要なものだけを `*.pg.test.ts` に分離する規約を定めている。現状の文面では、将来の in-process DB 評価まで gate 外へ置く誤誘導になり得る。
**Confidence**: high
**Fix**: `*.db.test.ts` の bullet を追加し、「インプロセス DB で gate に含める」と明記する。`*.pg.test.ts` は「Docker Postgres が必要な評価」に限定して説明する。

## Verification Evidence

- `mise run setup`: PASS（初回 sandbox 実行は DNS 制限で失敗、ネットワーク許可下の再実行は `Lockfile is up to date`、3 workspace、exit 0）
- `mise run typecheck`: PASS（root / ai-core / eval-suite、3/3 successful）
- `AI_TEST_SUITE=local AI_TEST_RUN_MODE=local ... vitest run --config packages/eval-suite/vitest.config.ts`: PASS（0 files permitted）
- `AI_TEST_SUITE=pg AI_TEST_RUN_MODE=mock ...`: PASS（0 files permitted）
- `AI_TEST_SUITE=gate AI_TEST_RUN_MODE=mock ...`: EXPECTED FAIL（0 tests、gate-reporter error）
- `AI_TEST_SUITE=unknown ...`: EXPECTED FAIL（config load rejection）
- `mise run gate`: PASS（root 234、ai-core 3、Turbo 2/2 successful）
- `mise run audit`: PASS（No known vulnerabilities found）
- `git diff --check`: PASS

## Verdict
APPROVE_WITH_NOTES

## Hallucination Signal
forced: false
