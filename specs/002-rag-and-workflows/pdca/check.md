# Check Phase — rag-and-workflows（Milestone 2）

PDCA Check: 計画（plan.md、tasks.md）と結果（do.md、レビュー、CI）の比較。`/sdd-reflect`（2026-10-16）が生成した。

## Expectations vs. Results

| 期待（plan / tasks） | 結果（do / 記録） | 状態 |
|---|---|---|
| W1〜W6 の全サブタスクが完了し、gate が決定的に緑 | 全サブタスク `[x]`。`gate:repeat` 10/10 同一判定（`hookTimeout` 修正後。初回は 6/10 回目で失敗） | ✅ |
| `mise run gate` が 5 分以内 | `gate:repeat` 10 回の合計が 8 分 15 秒なので、1 回あたり約 50 秒（算出値。単独実行の時間は今回測っていない） | ✅ |
| ミューテーションスコア 70 以上 | 87.03（killed 1169、timeout 45、survived 173、no coverage 8） | ✅ |
| `packages/ai-core` の行カバレッジ 80% 以上 | 98.39% | ✅ |
| E2E 3 エンジンで skipped 0 | 363 passed、skipped 0（chromium / firefox / webkit 各 121）。ただし CI の main では #40・#41 で赤になり、#42 で緑に戻った（下記） | ⚠️ |
| `local` での実測（recall、Judge、`granite4.2` の遵守率、トークン比較）を記録 | 記録済み。ただし 5 点が未完了（下記「未完了」） | ⚠️ |
| 実 Postgres（`test:db`）と Cohere 実キーの確認 | 未実施（Docker なし、キーなし）。人が行うことに残した | ❌（環境の制約。未実測と明記済み） |
| 完成タグ `module/2-1`〜`2-4` | 注釈付きでローカルに付与済み（`0ba762e`）。push は人が行う | ✅ |

## Test & Quality Outcomes

- Tests（`TURBO_FORCE=true mise run gate`、exit 0）: `//:test` 352/352、`@platform/ai-core` 1732 passed・skipped 4、`web` 733/733、`@platform/eval-suite` 7 passed・skipped 8（skipped 12 件は `local` のテストで、理由つきで報告され、合格には数えない）。
- Docs: 8 つの解説、110 件のテスト参照を検証。
- Lint / type / repo rules: gate 内で成功（Biome 398 files、`workflow-no-agent-loop` は 34 files を走査）。
- 敵対的レビュー: W1〜W6 の 6 回。各回の指摘は見出しで数えて 15〜19 件、合計 106 件。W6 は `REQUEST_CHANGES`（CRITICAL / HIGH なし、MEDIUM 7、LOW 12）で、19 件すべてに対応を記録した（修正 15、記録のみ 4。人の判断が要るものは人が行うことに移した）。

## Requirements Coverage

- Covered: 45/45（すべての受け入れ基準が 1 つ以上のサブタスクの `_Requirements:_` に現れ、Test 列が埋まっている。解説で検証するものは「D」）。
- Gaps:
  - **Req 4.7**: デモの `final` が成果物ではなくレビュアーの承認コメントになる。W4 のコードと承認済みの plan C12 に触れるため、修正せず traceability.md に記録した。人が (a) デモを直すか (b) `final` の定義を plan に書くかを決める。
  - 検索手法の効果の差、Judge の判定、`local` モデルの脚注の遵守率は gate の外（`*.local.test.ts`）。実 Postgres（`*.pg.test.ts`）と Cohere の実呼び出しは未実施。

## Deviations from Design

- コーパス 6 本を W3 から W2 の 9.1 に前倒し（実サーバー確認 R-1 のため）。tasks.md に記録済み。
- `packages/ai-core/vitest.config.ts` と `apps/web/vitest.config.ts` に `hookTimeout: 60_000` を追加（境界外。ship 時に承認、F-15）。`docs/README.md` と `docs/modules/1-1-dev-environment.md` の編集も境界外（F-16、F-7）。
- ADR-8: `withRegeneration`（M1 `summarize/retry.ts`）と `generateValidated` は統合せず、重複を許容した（M1 の公開契約に触れるため）。

## Issues Encountered

| Issue | Root cause | Resolution |
|---|---|---|
| gate が 10 回中 6 回目で失敗（`Hook timed out in 10000ms`） | PGlite の WASM 起動がマシンの負荷（常駐した Ollama モデルが RAM の約 34%）に敏感で、既定の 10 秒を超えた | `hookTimeout: 60_000`。固まったフックは 60 秒で落ちる。`gate:repeat` 10/10 |
| 検索比較テストが 1 時間のタイムアウトを超えた | 1 問約 50 秒 × 32 問 ≈ 26 分が、並走で 1 時間超になった。Vitest は失敗と記録して次へ進み、比較は動き続けて表を出した。テスト自身の完了後のアサーションは評価されていない | タイムアウトを 3 時間に変更、`RAG_EVAL_QUESTIONS` で問数を絞れるようにした。**全問の再実行は未実施**（人が行うこと。F-1） |
| 解説と research.md が、1 回の標本抽出の結果を断定していた（F-2、F-3、F-4、F-13） | 結果の「揺れ」と「測っていない条件」を文に書かなかった | 太字の断定を外し、実行コマンド・日付・件数・比較対象の違いを明記。類似度は単独で再測定 |
| ステアリングの規則数が一部の文書に残った（F-7） | 最初の grep が「9規則」だけで「9 規則」を拾わなかった | 両方の表記で grep。旧い数値は 0 件 |
| main の CI が #40・#41 で赤（E2E、WebKit のばらつき） | フォームの fill が hydration より先に着地すると、React が追跡する値と同じ値の input イベントを無視し、送信ボタンが有効にならない（47bbfce のメッセージ）。W5 の E2E に潜在していた | #40 で「有効になるまで再入力」、#41 で失敗時の trace を CI に保存、#42 で「入力前に空にする」と、hydration を遅らせて再現する回帰テストを追加。#42 で全ジョブ緑 |

## Assessment

M2 の実装は計画どおりに完了し、gate・CI・ミューテーション・カバレッジの基準を満たした。ただし「完了」に含まれない範囲がある。実 Postgres・Cohere・`/agent` との比較・全問の緑の検索比較・Req 4.7 の扱いは人が決める、または実行する。

W5 の E2E に潜んでいた hydration 競合は、ローカルの 363 件 pass と PR #39 の CI の成功では見つからず、マージ後に main で 2 回赤くなって見つかった。#39 が緑だったのは、タイミングが合っただけの可能性が高い（推測。#39 の再実行では確かめていない）。この欠陥は CI の trace 保存（#41）で原因を特定できた。
