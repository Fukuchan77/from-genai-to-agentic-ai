# Act Phase — agentic-ai-platform（W4 apps/web）

## Check Phase Summary

W4 は gate が通った後に、敵対的レビューと実サーバー確認で2種類の欠陥が見つかった。(1) 同じ概念の判定が複数の層に分散していたことによる漏れと、範囲の広すぎる catch（レビュー）。(2) Vitest では再現できない本番ビルドの失敗（Turbopack の2件、Tailwind の未処理）と、ブラウザ固有の欠陥（Firefox のフォーカス指示子、WebKit の Tab）。すべて修正し、3エンジンの E2E 81件（実サーバー、axe の light/dark、キーボード、フォーカスのコントラスト）と、タスク 25.1〜25.3・26.1 の検査基盤を加えた。

## Outcome

Success（W4 の実装・検証は完了。残りは完成タグの push、27.2・27.4、26.2・26.3 の残り、gate・CI への結線）

## Success Pattern OR Mistake Record

### Success Pattern

- `.sdd/patterns/real-server-e2e-guard.md`: gate（単体テスト）の外に、本番ビルドを実際に起動する E2E を置き、「3ページが 200・スタイルが当たる・ブラウザエラー0」を回帰として守る。

### Mistake Record

- **What happened**: (1) 画像判定の分散、広すぎる catch（レビューで検出）。(2) gate が緑のまま、実サーバーでは3ページとも 500 で、Tailwind も処理されていなかった。(3) Firefox でフォーカス指示子が見えなかった。
- **Root cause**: 「複数の層が同じ述語を共有する」規則と、「例外処理の範囲を想定する失敗に絞る」規則がなかった。Vitest はバンドラーを通らないため、バンドラー固有の失敗と CSS パイプラインの欠落を検出できない。依存（`@tailwindcss/postcss`）が plan で宣言漏れだった。focus の色をブラウザの既定に任せていた。
- **Impact**: ship 済みのコードが一度も実サーバーで動いていなかった。axe の違反0は、無スタイルの状態の結果で意味がなかった。
- **Prevention**: 下の対応表のとおり。
- Saved to: `.sdd/mistakes/agentic-ai-platform-2026-10-12.md`

## Learnings → Rules Mapping

| Learning | Candidate rule / steering update |
|---|---|
| 同じ概念（画像か、ブロック対象か）を複数の層で判定しない | `.sdd/steering/structure.md` に追記済み（判定述語は1か所） |
| catch は、想定する失敗を投げる呼び出しだけを包む | 同上（`guard → resolve → validate → adapt → stream`）。空 `catch {}` の機械検査は過剰なので、adversarial-review のチェックリスト側で扱う |
| gate の緑は本番ビルドの動作を保証しない | 各ウェーブの締めに、実サーバー（`next dev` または `next start`）で全ページが 200 になる確認を入れる。27.1 が回帰になる。**未反映: tasks.md の締めの手順への追記** |
| a11y の「違反0」は、スタイルが当たっていることを前提にする | axe の前に、スタイルが当たっている確認（body の背景色）を入れる（27.1 に実装済み）。ダークは `.dark` クラスで検査する |
| 依存の宣言漏れは、実際にビルドするまで見えない | plan の `package.json` 行を、`next build` が通る最小の依存集合として見直す。**未反映** |
| フォーカス指示子の色はブラウザの既定に任せない | `globals.css` の `:focus-visible`（反映済み）。コントラスト検査は3エンジンで行う |
| 生成物（SSE fixture）は生成元のテストが検証する | 反映済み（`verifyOrWriteFixture`、`mise run e2e:fixtures`） |
| 一括置換は Edit ツールか件数検査付きで行う／ダミー秘密値は `changeme` 系 | 既存の AGENTS.md で足りる |

## Process Improvements

- 敵対的レビューを `/sdd-ship` の前に回す（今回は ship 後で、修正が別コミットになった）。
- ウェーブの完了の定義に「実サーバーでの確認」を含める。E2E の基盤（Playwright と実サーバーの spec）は、機能の実装と同じウェーブ（遅くとも直後）に置く。今回は W5 に分かれていたため、W4 の欠陥の発見が遅れた。
- ガード系の新規テストは、同じ概念の別表記を最初から入れる。
- 完成タグは、実サーバーで動くコミットに付ける（元の機能コミットは Turbopack でビルドできなかった）。

## Next Actions

- 29.4 の前に、完成タグの push（人間の承認後）と `module/1-1` のタグ（14.6）を確認する。
- 26.2（`mock-api.ts`）、26.3 の `latency-probe.ts`、27.2、27.4 を実装する。
- `check:client-bundle` と `test:e2e` を gate・CI に結線する（29 の締め）。
- 上の対応表の「未反映」2件（ウェーブ締めの手順、plan の依存の見直し）を tasks.md と plan に反映する。
- LOW 3件（クォータの消費順、ガード付き fetch のボディ型、`local` のレート制限の文書化）の W5 での扱いを決める。
