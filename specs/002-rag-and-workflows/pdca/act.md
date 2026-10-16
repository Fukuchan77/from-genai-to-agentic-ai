# Act Phase — rag-and-workflows（Milestone 2）

## Check Phase Summary

M2 は gate・CI・ミューテーション（87.03）・カバレッジ（98.39%）の基準を満たして完了した。見つかった欠陥は 2 種類ある。(1) **測定の書き方**: 1 回の標本抽出や、測っていない条件を、断定や完了として書いた（W6 レビュー F-1〜F-4、F-13）。(2) **マージ後に初めて見えた E2E の競合**: フォームの fill が hydration より先に着地すると送信ボタンが有効にならず、main の CI が #40・#41 で赤になった。詳細は `check.md`。

## Outcome

Success（実装・検証・完成タグは完了）。ただし、未実測と未決の項目を人が行うこととして残している。

## Success Pattern OR Mistake Record

### Success Pattern

- `.sdd/patterns/measurement-disclosure.md`: `local` モデルの実測を記録するとき、結果の値と一緒に、実行条件（コマンド、日付、件数、標本数）、測っていない条件、完了していない検証を書く。未実測は「未実測」と書き、実測済みと書かない。W6 のレビューの指摘 19 件のうち F-1〜F-4（MEDIUM）と F-13（LOW）の 5 件は、この規則で防げた。

### Mistake Record

- **What happened**: (1) E2E の `fill` が hydration より先に着地すると、React が追跡する値と同じ値の input イベントを無視し、送信ボタンが有効にならなかった。ローカルの 363 件と #39 の CI は通り、マージ後の main で 2 回赤くなった。(2) 検索比較の表を、完了後のアサーションが評価されていない実行から転記し、解説では太字で断定した。
- **Root cause**: (1) 入力のタイミングを意図的にずらす回帰テストがなかった。再入力の対策（#40）も、値が同じなら効かなかった。(2) 「揺れる出力」と「実行が正常に終わったか」を、記録の書式として区別していなかった。
- **Impact**: (1) main の CI が約 2.5 時間赤かった（#39 のマージ 10:34 から #42 の 13:01 まで）。(2) 解説が、根拠より強い主張をしていた（レビューで検出し、修正済み）。
- **Prevention**: 下の対応表のとおり。
- Saved to: `.sdd/mistakes/rag-and-workflows-2026-10-16.md`

## Learnings → Rules Mapping

| Learning | Candidate rule / steering update |
|---|---|
| 実測の記録には、実行条件と未測定の条件を値と一緒に書く | `.sdd/patterns/measurement-disclosure.md`（新規）。**未反映: 解説テンプレートへの「実測の書き方」の節** |
| テストが完了後のアサーションまで評価されたか、は実行結果に現れない（タイムアウトで失敗と記録されても処理は続く） | 長時間のテストは問数を絞れる設計にし、タイムアウトは実測時間の数倍に置く（反映済み: `RAG_EVAL_QUESTIONS`、3 時間）。緑の全問実行は人が行う |
| 規則の数のような派生した数値を grep で確認するときは、表記の揺れ（「9規則」「9 規則」）を両方拾う | AGENTS.md の「After a rename, a heading shift, or a count change, grep …」で足りる。揺れの例として `9 *規則` を tasks.md の 27.2 のメモに記録済み |
| React の制御された入力は、値が同じだと input イベントを無視する。fill の前に空にする | `apps/web/e2e/support/form.ts`（反映済み）と `hydration.spec.ts` の回帰テスト |
| 「CI が緑」は、タイミングに依存する欠陥がないことを意味しない。失敗時に原因を特定できる証拠（trace）を CI に残す | `ci: upload Playwright traces when an E2E job fails`（#41、反映済み） |
| 波の敵対的レビューは、`/sdd-ship` の前ではなく後に回ると、修正が別コミットになる | 001 の act.md で既出。M2 の W6 も同じ順序（ship 後のレビュー）だった。**未反映: sdd-ship のスキルまたは tasks.md の締めの手順** |

## Process Improvements

- 解説と research.md に実測を書く前に、「この数値は何回の実行から来たか」「完了後のアサーションは評価されたか」を確認する（`measurement-disclosure.md` のチェックリスト）。
- E2E の追加では、フォームの入力が hydration より先に着地する場合を、スクリプトの配信を遅らせて再現する。
- 001 の act.md から繰り越した「敵対的レビューを ship の前に回す」は、M2 でも実現していない。次のマイルストーン（003）の tasks.md の締めの手順に入れるかを、人が決める。

## Next Actions

1. タグを push する: `git push origin module/2-1 module/2-2 module/2-3 module/2-4`
2. `docs/m2-w6-closeout` を push して PR を作る（コミット: eb4c23a、d545e47、1936c90、および本 Act のコミット）。
3. 人が行うこと: `mise run test:db`（Docker）、Cohere 実キーでの Rerank、`/agent` とのトークン比較、`rag-retrieval.local.test.ts` の全問の再実行、Req 4.7 `final` の扱い。
4. M2 が確定したら、003（`domain-agents`）の要件・設計・タスクの承認に進む（前のマイルストーンの実装後にだけ承認する、という規則）。
