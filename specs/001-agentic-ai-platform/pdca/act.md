# Act Phase — agentic-ai-platform（W4 apps/web）

## Check Phase Summary

W4 は gate が成功し、サーバー側の安全策（接続時検査、エラーの許可リスト、ガード）も入った。一方、敵対的レビューで、同じ概念の判定が複数箇所に分散していたことによる漏れと、範囲の広すぎる catch が見つかった。MEDIUM 2件と LOW 1件は同日に修正済みである。

## Outcome

Partial（実装と修正は完了、実サーバー確認・完成タグ・LOW 3件が残る）

## Success Pattern OR Mistake Record

### Mistake Record

- **What happened**: 画像判定がガード・ルート・履歴アダプタに別々に書かれ、ガードだけが bare な `image` を数えなかった。エージェントルートは SDK 呼び出し全体を `catch {}` で包み、すべてを 400 にしていた。
- **Root cause**: 「複数の層が同じ述語を共有する」設計規則がなかった。例外処理の範囲を「想定する失敗」に絞るという規則が、レビュー前の自己点検に入っていなかった。
- **Impact**: Req 3.11 の上限を回避できる経路（本文 512 KiB が上限）と、実バグを 400 に偽装する経路。実害は出る前に検出した。
- **Prevention**: 下の対応表のとおり。
- Saved to: `.sdd/mistakes/agentic-ai-platform-2026-10-12.md`

## Learnings → Rules Mapping

| Learning | Candidate rule / steering update |
|---|---|
| 同じ概念（画像か、ブロック対象か）を複数の層で判定しない | `.sdd/steering/structure.md` に「判定述語は1か所に置き、他の層は import する」を追記する |
| catch は、想定する失敗を投げる呼び出しだけを包む | `check:repo-rules` への空 `catch {}` 検査の追加は過剰なので、レビューのチェックリスト（adversarial-review）側で扱う |
| 検証してから変換する（検証前の入力を変換関数に渡さない） | route テンプレートの順序を `guard → validate → adapt → stream` と steering に明記する |
| テスト内のダミー秘密値は `changeme` 系を使う | 既存の AGENTS.md「Placeholder secrets」で足りている。新規ファイルの作成時にも適用する |
| 文字列置換スクリプトは対象に当たらなくても無音で終わることがある | 一括置換は Edit ツールか、置換件数を検査する形にする |

## Process Improvements

- 波ごとの敵対的レビューを、`/sdd-ship` の前に回す。今回は ship 後にレビューしたため、修正が別コミットになった。
- ガード系の新規テストは、同じ概念の別表記（`image`、`image/png`、大文字小文字）を最初から入れる。

## Next Actions

- 今回の修正（guard.ts、両ルート、guard.test.ts）とレビュー記録のコミット。レビュー記録に対応記録を追記する。
- LOW 3件の扱いを決める（受け入れて traceability の Gaps に記録するか、修正するか）。
- 27.1・27.3 で実サーバーの表示確認と axe 検査を行い、23.5・24.4 のタグを付ける。
- steering への追記（上の対応表の1・3行目）。
