# Act Phase — domain-agents（Milestone 3）

## Check Phase Summary

M3 は gate（強制実行で 70〜83 秒）、mutation（86.19）、E2E（3 エンジンで 735 passed）、container（17 passed）、audit、secret-scan の基準を満たして完了した。毎波のレビューは、スタブ単位の PROVE では見えない全体の欠陥（予算、状態、終端状態）と、記録の正確さの欠陥（検証していない因果、走らないテストの完了）を見つけた。詳細は `check.md`。

## Outcome

Success（実装・検証・完成タグは完了）。ただし、E2B 実機・GitHub 実キー・arXiv の一部・修正ループの能力テスト（38.2）は未実測または M4 へ持ち越し。

## Success Pattern OR Mistake Record

### Success Pattern

- `.sdd/patterns/whole-run-invariant-tests.md`: 機能ごとに「実行全体の規則」と「終端状態」を文で書き、mock の run 全体がそれを満たすことを主張するテストを実装前に置く。W5〜W8 の 4 波で、約 700 本のスタブを殺した後にもレビューが全体の欠陥を見つけたことに基づく。

### Mistake Record

- **What happened**: 検証していない因果を 5 か所に記録した（W8 F-2）。走らないテストの 38.2 を完了にした（W8 F-3）。回した検査を実施せずに完了にした（W7 F-1）。
- **Root cause**: 仮説を実装と照らさず事実として書いた。「テストが存在する」と「走る」を区別しなかった。持ち越しの検査の中身が受け側にない。
- **Impact**: 人が読む文書が根拠より強い主張をしていた。レビューが検出し、修正済み。
- **Prevention**: 下の対応表のとおり。
- Saved to: `.sdd/mistakes/domain-agents-2026-10-29.md`

## Learnings → Rules Mapping

| Learning | Candidate rule / steering update |
|---|---|
| 変異スタブでは、全体の不変条件が破れることを検出できない | `.sdd/patterns/whole-run-invariant-tests.md`（新規）。**未反映: sdd-impl / test-strategy の「機能ごとに終端状態のテストを 1 つ」の項目** |
| 因果の説明は、実装と照らしてから記録する | `.sdd/mistakes/domain-agents-2026-10-29.md`。`measurement-disclosure.md` に「因果は未確認なら未特定と書く」を足すことを検討 |
| 「テストが存在する」と「走る」は別。完了の前に出力の名前で確認する | tasks.md のタスク完了条件に追記する案。**未反映** |
| 持ち越しは受け側のタスクの本文に検査の中身を書く | tasks.md の生成規則（sdd-tasks）。**未反映** |
| Docker 専用レーンは、pg テストを書くタスクのチェック前に実行する（PGlite では件数の期待値の誤りが見えない） | `AGENTS.md` の Tooling には既に `test:db` あり。タスクの Verify に入れる運用 |
| 修正担当者の「PROVE を実行した」は主セッションで再実行する | W7 で 3/6 が未実行。sub-agent-coordination の確認項目として追記する案 |
| 他プロセスの負荷（load 25〜31）が E2E と mutation を不安定にする。失敗が単独で通るなら、負荷を疑う | 長い実行の前に `uptime` を記録する運用。gate を 2 つ同時に起動しない（W6） |
| ガードに回避が要るなら、回避を外してテストを諦める。ガードは弱めない | W8 で実践済み。憲章の方針と一致 |
| モジュールのコピーごとに分かれる状態（WeakSet、brand）は globalThis か brand で持つ | plan C2 に反映済み（W7） |
| クライアントのコンポーネントは `@platform/ai-core/config` を import しない | plan C14 と `check:client-bundle` に反映済み |

## Process Improvements

- 001・002 の act.md から繰り越している「敵対的レビューを ship の前に回す」は、003 でも実現していない（W3 以降は ship の後か同時）。M4 の tasks.md の締めの手順に入れるかを、人が決める。
- 波の修正後の fresh な再レビューが W3 以降ほぼ未実施。M4 では少なくとも HIGH を直した波は再レビューする。
- 完了にする前の 3 点確認: (1) そのテストがどのレーンで走るか、(2) 記録した因果を実装で確認したか、(3) 終端状態を見ているか。

## Next Actions

1. 人: `module/3-1`〜`3-6` と `feat/m3-w1-foundation` の push 状態を確認し、PR を作る。
2. 人: E2B 実機（S-4、外向き通信の既定）、GitHub MCP 実キー、arXiv の複数件・0 件・HTTP 400 の実測。
3. M4 の最初のタスク（tasks.md「004 への引き継ぎ事項」）: `/recommend` の往復テスト、W7 F-17・F-18、plan.md の項目。38.2 のレーン。
4. 004 Req 4: `runPython` のリスク区分とネットワーク制限、外部コンテンツの汚染判定、MCP の注釈を信頼しない前提、ハードな費用上限。
5. 未反映の規則（上表の「未反映」）を、sdd-impl / sdd-tasks / test-strategy に入れるか決める。
