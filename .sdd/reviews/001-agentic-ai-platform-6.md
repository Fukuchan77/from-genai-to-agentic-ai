# Task 6 Adversarial Re-Review — Round 2（2026-09-28）

## Prior Finding Disposition

- **Round 1 HIGH（空の local/pg が閾値で失敗）: RESOLVED.** `coverage.enabled: true` は全スイートで維持され、`thresholds.lines: 80` は `gate` のみに条件付けされた。キャッシュを介さない package 単位の再実行で、`local` と `pg` はともにテスト0件・行カバレッジ0%を表示しつつ exit 0 になった。
- **Round 1 MEDIUM（`PlatformError` の公開 import 経路）: WITHDRAWN AS TASK 6 DEFECT.** plan.md:86 は公開 API を9サブパスに限定し、Task 6.1 はその骨格を要求しているため、Task 6 で `./errors` を追加するのは設計逸脱になる。もっとも、tasks-w4.md:21 の Web エラー変換がどの既存サブパスから `PlatformError` を import するかは明記されていないため、これは Task 21 までに既存9サブパスのどこから再 export するかを確定すべき**将来計画の曖昧さ**であり、現 Task の defect には数えない。
- **Round 1 MEDIUM（根拠のないエラーコードと不完全な語彙テスト）: RESOLVED.** 語彙は plan.md の M1 HTTP 契約に実在する4値へ縮小され、`PLATFORM_ERROR_CODES` の const tuple から union を導出し、テストが配列と union の完全一致を固定している。後続 subclass のコード追加は各後続タスクの責務として整合している。
- **Round 1 LOW（Implementation Notes が空）: RESOLVED.** tasks.md:151-153 に3項目が追加され、lockfile 例外、suite 別閾値、エラー語彙の方針を記録している。

## Risk Trigger Resolution

- **新規依存 / lockfile:** `packages/ai-core/package.json` の runtime/dev 依存は plan/research の M1 依存表に対応し、すべて完全一致版で固定されている。`mise run setup` は `--frozen-lockfile` で成功し、lockfile は up-to-date と判定された。`mise run audit` はネットワーク許可後に `No known vulnerabilities found` で成功した。
- **境界例外:** `pnpm-lock.yaml` は Task 6 の literal boundary 外だが、tasks.md:118-119 が 6.1/7.1/8.1 の lockfile 更新を明記し、6.1 `_Verify:_` が `mise run setup` による更新を要求する。生成物例外として正当であり、境界違反ではない。
- **Round 1 remediation:** local/pg/gate の suite 選択、未知 suite の fail-fast、型検査、HTML coverage、エラー語彙の完全一致テスト、Implementation Notes を再確認した。gate package lane は3テスト・100% line coverage、local/pg は0件・0% coverage で成功し、未知 suite は設定読込時に非ゼロ終了した。

## Critique

### [LOW] `test:coverage` でも gate 用80%閾値が有効になり、「HTMLレポートだけ」の契約とずれる
**Location**: packages/ai-core/vitest.config.ts:32-38; packages/ai-core/package.json:19; specs/001-agentic-ai-platform/plan.md:301
**Issue**: `test:coverage` も `AI_TEST_SUITE=gate` で動くため、設定の80%閾値が適用され、plan が定める「HTML レポートを作るだけで、閾値の強制は gate が担う」というコマンド契約を満たさない。
**Evidence**: vitest config は `suiteName === "gate"` の唯一の条件で `thresholds.lines: 80` を設定する一方、mise の `test:coverage` は `AI_TEST_SUITE = "gate"` を設定し、package script は `vitest run --coverage.enabled --coverage.reporter=html` で閾値を上書きしない。plan.md:301 は `mise run test:coverage` を「HTML レポートを作るだけ」と明記している。現状は100%のためコマンド自体は成功したが、80%未満の状態では診断用レポート生成も非ゼロ終了する。
**Confidence**: high
**Fix**: `test:coverage` script で line threshold を無効化/0へ上書きするなど、gate の `test` だけが80%を強制し、`test:coverage` は結果にかかわらずHTMLレポートを生成できるようにする。その差をコマンドテストまたは設定テストで固定する。

## Verification Evidence

- `mise run setup`: PASS（frozen lockfile、全2 workspace）
- `mise run audit`: PASS（既知の脆弱性なし）
- `AI_TEST_SUITE=gate AI_TEST_RUN_MODE=mock mise exec -- pnpm --filter @platform/ai-core test`: PASS（3 tests、lines 100%）
- `AI_TEST_SUITE=local AI_TEST_RUN_MODE=local mise exec -- pnpm --filter @platform/ai-core test`: PASS（0 tests、lines 0%）
- `AI_TEST_SUITE=pg AI_TEST_RUN_MODE=mock mise exec -- pnpm --filter @platform/ai-core test`: PASS（0 tests、lines 0%）
- `AI_TEST_SUITE=bogus mise exec -- pnpm --filter @platform/ai-core test`: EXPECTED FAIL（未知 suite）
- `mise exec -- pnpm --filter @platform/ai-core typecheck`: PASS
- `mise run test:coverage`: PASS（3 tests、HTML reporter）

## Verdict
APPROVE_WITH_NOTES

## Hallucination Signal
forced: false
