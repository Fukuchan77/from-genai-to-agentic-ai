## Critique

### [MEDIUM] 50% opacity の focus ring は light/dark とも 3:1 を満たさず、静的テストもこの実効色を検査していない
**Location**: apps/web/app/globals.css:52,74,79; scripts/check-web-theme.test.mjs:58-61
**Issue**: `--ring` 自体は背景比 3:1 を超えるが、実際に base style が使う `outline-ring/50` は背景へ合成すると light 2.20:1、dark 2.51:1 になり、UI の状態表示に必要な 3:1 を下回る一方、回帰テストは border/input だけを検査している。
**Evidence**: CSS は `--ring: oklch(0.48 0.08 255)` / `oklch(0.68 0.08 255)` を定義し、全要素へ `@apply border-border outline-ring/50` を適用する。しかし `interfacePairs` は `["background", "border"]` と `["background", "input"]` の2組だけである。OKLCH を linear sRGB へ変換後、CSS の50% alphaを sRGBで背景へ合成して再計算すると、light 2.2024:1、dark 2.5111:1 だった。solid ring はそれぞれ 6.2607:1 / 6.7517:1 なので、現テストは実際に描画される半透明の状態表示を取り逃がす。なお既存20組はすべて閾値を満たし、border/input は light 3.489:1、dark 3.675:1 である。
**Confidence**: high
**Fix**: `outline-ring/50` を3:1以上になる不透明度または色へ変更し、静的テストに alpha 合成を含む background/ring の実効コントラスト検査を追加する。将来の shadcn component が `ring-ring/50` を使う場合も同じ契約で検査する。

### [LOW] alias / hermetic setup の temporary PROVE は round 1 から依然として再現不能である
**Location**: specs/001-agentic-ai-platform/pdca/do.md:2129-2138
**Issue**: contrast test には恒久テストと変異結果が追加されたが、`server-only` alias と route network guard の PROVE は削除済み probe の完全な source と command がなく、prior review の監査性指摘が未解消である。
**Evidence**: 記録には「temporary component probe」「temporary route probe」、期待した失敗、復元結果だけがあり、probe 本文と作成・実行 command は残っていない。独立再検証では local/pg の0件許可、unknown suite の拒否、`mise run gate`、`mise run typecheck` は確認できたが、同一の変異テストを記録だけから再実行できない。（prior: round 1 LOW、未解消）
**Confidence**: high
**Fix**: Task 21.1 の恒久テストを先行させない方針を維持するなら、2 probe の完全な source、作成 command、実行 command、削除 command を `pdca/do.md` に記録する。Task 21.1 で同等の committed test を追加した時点で、そのテストへの参照へ置き換えてよい。

### [LOW] Task 8.3 の Verify 条項が追加した静的コントラストテストを検証経路として示していない
**Location**: specs/001-agentic-ai-platform/tasks.md:220
**Issue**: remediation で `scripts/check-web-theme.test.mjs` を Task 8.3 の成果物と境界へ追加した一方、`_Verify:_` は依然として将来の Task 27.3 の axe 検査だけをコントラスト確認手段として挙げており、現在の決定論的 gate 契約と不整合である。
**Evidence**: Task 本文は「token contrast の静的回帰テスト」を所有し、Implementation Notes も text 4.5:1 / input・border 3:1 を直接検査すると記すが、Verify は「コントラストは 27.3 の axe 検査で確認する」のままである。実測では `mise run gate` が当該20 testsを実行して成功したため、実装ではなく承認済みタスク記述の追随漏れである。
**Confidence**: high
**Fix**: Task 8.3 の `_Verify:_` に `mise run gate`（または root Vitest の対象テスト）による token 契約の確認を追加し、27.3 は完成画面の補完的 axe 検査として記す。

## Verdict
REQUEST_CHANGES

## Hallucination Signal
forced: false
