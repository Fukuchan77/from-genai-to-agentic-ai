# hub-alignment — Gap Analysis

_調査日: 2026-10-12_ / _対象: `specs/005-hub-alignment/spec.md`（要件承認済み、設計・タスク未生成）_ / _ハブの確認先: ローカルの `vaz-agentic-ai-next`（ブランチ `chore/dependency-security-refresh`、`origin/main` が既定）_

本書は情報と選択肢の提示であり、実装方針の決定ではない。決定は `/sdd-plan hub-alignment` で行う。

## 1. 分析サマリー

- **Req 1 は実質完了している。** 002〜004 の各 spec に「本番実装との境界」節があり、005 Req 1.2 の5行はすべて入っている（2026-10-04 反映）。追加の実装はない。残るのは、ハブの参照先が今も実在するかの再確認だけで、本調査で5件とも実在を確認した（§3.1）。
- **Req 2 は未実装で、M1 の解説4本に遡及が要る。** Phase 1 の解説（1-0〜1-3）は W5 で完成・タグ付け済みだが、「本番ではどう作るか」節を持たない（`tasks-comp-w5.md:186` に「005 未承認のため加えていない」と記録）。検査もない。
- **Req 3 は2つに割れる。** テーマトークンの文書化（3.3、3.4）は M1 のコードがすでにあり、文書だけが欠ける。承認ダイアログのコピー（3.1、3.2、3.5）は M4 の作業で、今は実装できないが、ハブの `ApprovalCard` はすでに存在する。コピー時に直すべき差分が3点見つかった（§3.3）。
- **最大の構造上の課題は時期のずれ。** 005「承認ゲート」は「Req 2〜3 の実装は、対象マイルストーンと同じ波で行う」と定めるが、Req 2.2 と Req 3.3 の対象は M1 で、M1 の W1〜W5 は完了済み、タグ `module/1-1`〜`module/1-3` は push 済みである。遡及の扱い（タグの内容、タスクの置き場）を plan で決める必要がある。
- **推奨**: ハイブリッド（§5 の案 C）。節の存在は既存の `check-docs.mjs`、リンク先の一致は新しいリポジトリ規則に分け、対応表を機械可読に整える。文書化と検査を M1 の後続タスクとして先に片付け、コピーは M4 に回す。

## 2. 要件と能力の対応

| 要件 | 必要な能力 | 分類 | 根拠 |
|---|---|---|---|
| Req 1.1〜1.2 | 002〜004 の境界節と5行の表 | ✅ 充足 | `specs/002-rag-and-workflows/spec.md:40-50`、`003-domain-agents/spec.md:44-55`、`004-harness-evals-safety/spec.md:44-56` |
| Req 1.3 | 本番機能を要件に加えない | ✅ 充足（現時点） | 各 spec の「点検の記録」節。以後は 002〜004 の改訂時に人が守る規則で、機械検査はない |
| Req 1.4 | 該当要件の書き換えと表への記録 | ✅ 充足（現時点） | 各「点検の記録」に「書き換えた受け入れ基準はない」 |
| Req 1.5 | 採番を変えない | ✅ 充足（現時点） | 各 spec の更新履歴に採番変更なし。以後の改訂で守る |
| Req 2.1 | 対応表を唯一の定義にする | 🔧 部分的 | 表は `specs/curriculum/README.md:98-112` にある。ただし機械可読でない（§4.2） |
| Req 2.2 | 解説に「本番ではどう作るか」節とリンク | 🆕 不足 | `docs/modules/*.md` に該当節なし（grep で0件）。`_template.md` にも節がない |
| Req 2.3 | リポジトリ規則としての検査 | 🆕 不足 | `scripts/check-repo-rules.mjs` の `RULE_NAMES` は9規則で、解説を走査する規則はない。`check-docs.mjs` は必須節と test 参照だけを見る |
| Req 2.4 | 未作成モジュールを外し一覧を出力 | 🆕 不足 | `check-repo-rules.mjs:1043-1052` の出力は `<rule>: scanned N FILES` の1行形式で、除外一覧を載せる口がない |
| Req 2.5 | 本文を転載しない | 🆕 不足（人の確認） | 機械検査の対象にしにくい（§4.4） |
| Req 2.6 | 改名時の表の更新と更新日の記録 | 🆕 不足 | 表に更新日がない。ハブ側 `docs/guide/README.md` の逆引き表とは現在一致している（§3.2） |
| Req 3.1 | 承認ダイアログをハブ部品のコピーで作る | 🆕 不足（M4） | 004 は未実装。ハブ側の部品は存在する（§3.3） |
| Req 3.2 | 部品を表示専念にする | 🆕 不足（M4 の設計） | ハブの `ApprovalCard` の doc コメントが同じ責務分離を述べている（ハブ `ApprovalCard.tsx` の JSDoc） |
| Req 3.3 | テーマトークンの文書化 | 🔧 部分的 | トークン `apps/web/app/globals.css:8-73` とコントラスト検査 `scripts/check-web-theme.test.mjs` はある。文書がない |
| Req 3.4 | 変更の記録とハブへの伝達判断 | 🆕 不足 | 記録先がない。3.3 の文書に変更履歴の節を設ける |
| Req 3.5 | コピー元をコメントで残す | 🆕 不足（M4） | コピー時に行う |

## 3. 調査結果

### 3.1 Req 1: ハブの参照先の実在（2026-10-12 確認）

| 参照先 | 実在 |
|---|---|
| `docs/adr/0005-durable-workflow-engine.md` | ✅ |
| `packages/agents/src/supervisor.ts` | ✅ |
| `docs/owasp-agentic-threats-mitigations-mapping.md` | ✅ |
| `docs/guide/harness-engineering.md`、`agentops.md`、`mcp.md` | ✅ |
| `apps/web/src/lib/approvals.ts`、`packages/tools/src/allowlist.ts` | ✅ |

002〜004 の表の参照先は、ネットワークなしの gate では検証できない（Req 2.3 と同じ制約）。改名の検知は Req 2.6 の人手の報告に頼る。

### 3.2 Req 2: 対応表と検査

- 対応表（`specs/curriculum/README.md:98-112`）はハブの `docs/guide/README.md` の逆引き表と内容が一致する（PE/CE/LE/HE/AE/AO/MCP/EV の8行）。
- ハブの手法ページは8本で、すべて実在する: `prompt-engineering.md`、`context-engineering.md`、`loop-engineering.md`、`harness-engineering.md`、`agentic-engineering.md`、`agentops.md`、`mcp.md`、`evaluation.md`。
- 既存の解説は4本（1-0、1-1、1-2、1-3）。`check-docs.mjs` の `REQUIRED_SECTIONS` に節を足せば「節の存在」は同じ仕組みで検査できる。`MODULE_FILE` の正規表現（`/^(\d-\d)-.+\.md$/u`）が `_template.md` と `index.md` を除外するので、走査件数は4件になる。
- ゲート上の位置: `docs:check` は `gate` の最後の段。リポジトリ規則は `check:repo-rules`（`mise.toml:184`）で、`gate` の2番目の段に近い。

### 3.3 Req 3: ハブの `ApprovalCard` と本リポジトリの差分

ハブには `apps/web/src/components/agent-ui/{ApprovalCard,StreamingStatus,ToolExecution}.tsx` がある。最新のコミットは `bb6ccdd`（2026-10-12 時点）。005 Req 3.1 の「ハブの部品が存在しない時点では…」の分岐は、現時点では不要である。

コピーするときの差分:

| # | 差分 | 影響 |
|---|---|---|
| 1 | ハブは `cn` を `@/lib/utils` から import する。本リポジトリには `apps/web/lib/utils` がなく、`cn` は `components/ui/utils.tsx` にある | import 先を書き換えると「コピー」ではなく改変になる。`apps/web/lib/utils.ts` に再 export を置けば無改変で通る（plan で選ぶ）。なお `components.json` の `aliases.utils` は `@/lib/utils` を指しており、実ファイル配置と食い違っている |
| 2 | ハブの `ApprovalCard` には編集可能な引数欄（`editableArguments`、`onEditableArgumentsChange`）がある | 004 Req 4.3 は「承認された引数のまま」実行する。引数を編集できる UI は、署名で束縛した引数と食い違うので、使わない。props のうち編集系を渡さないことを保証する方法（型で禁止する薄いラッパー、またはコピー時に削る）を決める必要がある |
| 3 | ハブの部品は `Card`。004 Req 4.2 は「承認ダイアログ」 | 本リポジトリには `components/ui/dialog.tsx` がある。モーダルにするなら、フォーカス管理と Esc の挙動が必要で、WCAG 2.2 AA の E2E（`@axe-core/playwright`）に載る。`Card` のままインライン表示にするかは M4 の設計で決める |

依存する UI 基本部品（`alert`、`button`、`card`（`CardFooter` を含む）、`textarea`、`badge`）は本リポジトリの `apps/web/components/ui/` にすべてある。ハブの props は `@vaz/schemas` に依存しない（ハブ spec `009` 2.3 の方針どおり）。

本リポジトリには、類似の既存部品として `components/agent/ToolPartView.tsx`、`RunSummaryBadge.tsx` がある。ハブの `ToolExecution`、`StreamingStatus` と役割が重なるが、005 Req 3.1 が求めるのは承認ダイアログだけである。重なる部品の置き換えは要件にない（範囲を広げない）。

### 3.4 テーマトークン

- 定義: `apps/web/app/globals.css` の `:root`（ライト、35-53行）と `.dark`（ダーク、57行以降）。色は OKLCH。名前は `background`、`foreground`、`card`、`card-foreground`、`popover`、`popover-foreground`、`primary`、`primary-foreground`、`secondary`、`secondary-foreground`、`muted`、`muted-foreground`、`accent`、`accent-foreground`、`destructive`、`destructive-foreground`、`border`、`input`、`ring`、加えて `--radius`。
- 検査: `scripts/check-web-theme.test.mjs`。OKLCH を線形 sRGB へ変換して WCAG の相対輝度を求める。本文の組（`background`/`foreground` など8組）は 4.5:1 以上、境界の組（`background` と `border`、`input`、`ring`）は 3:1 以上を、ライトとダークの両方で検査する。フォーカスのアウトラインが不透明であることも検査する。
- 文書に書くべき内容（3.3）は上記でほぼ揃う。書けない点: `destructive` と `background` の組（エラー文言の色）は検査対象に入っていない。文書に「検査の範囲外」と明記するか、検査に組を足すかを決める。

## 4. 統合上の課題

### 4.1 時期のずれ（最重要）

005「承認ゲート」は Req 2〜3 の実装を「対象マイルストーンと同じ波」で行うと定める。しかし対象のうち、Req 2.2（1-0〜1-3 の節）と Req 3.3、3.4（テーマ文書）は M1 に属し、M1 は完了している。001 spec の Clarifications は「M1 の実装タスク（大タスク 28）への組み込みは、005 の要件承認後に plan と tasks を改訂して行う」と定めるが、W5 は `tasks-comp-w5.md` にアーカイブ済みで、`tasks.md` は完了した波の索引になっている。

決めること:

1. 遡及の作業の置き場: (a) 005 自身の `plan.md`/`tasks.md` を作る、(b) 001 の `tasks.md` に W6 を足す。001 の要件は変わらないので、(a) が自然。
2. 完了済みタグ `module/1-1`〜`module/1-3` は、解説の変更を含まない。解説の「完成時点のタグ」節は「含まれるもの」を述べるため、後から節を足すとタグ時点と食い違う。タグを動かさず、節の追加を後続コミットとして扱うかを決める。

### 4.2 対応表が機械可読でない

`specs/curriculum/README.md` の表は、`2-1、2-2` や `3-2〜3-6` のように範囲・列挙を使い、ページ名のファイル名は最初の出現にだけ付く（`PE`、`LE` は2回目以降が略称だけ）。`1-1` は表の外の文で書かれている。`4-4` の `LE（強制停止条件）` のように注釈つきの行もある。Req 2.1 が表を「唯一の定義」とするなら、検査は表を直接読むのが望ましい。

- 案 X: 表を機械可読に整える（1行1モジュール、毎回ファイル名を書く、1-1 も表に入れる）。`specs/curriculum` は「spec に合わせて直す」立場なので許される。ハブ側の逆引き表（手法 → モジュール）とは形が逆になるが、人が突き合わせる（Req 2.6）。
- 案 Y: 検査側に略称 → ファイル名の写像と範囲の展開を持たせる。表の見た目は変わらないが、検査が表の書式に結びつく。表を変えたとき検査が壊れる。

### 4.3 リンク先の文字列の形

Req 2.3 は「リンク先の文字列が表と一致」を求めるが、文字列の形が未定である。候補: `https://github.com/Fukuchan77/vaz-agentic-ai-next/blob/main/docs/guide/<page>.md`（`origin/main` が既定ブランチ）。ブランチ名を固定すると、ハブが既定ブランチを変えたときに全リンクが切れる。到達性は検査しない（Out of Scope）。plan で形を1つに決め、`README.md`（ルート）の既存リンク形式と揃える。

### 4.4 Req 2.5 の機械検査

「1段落以内の引用」「出典（リポジトリ、パス、確認日）」は、構造が決まっていないと検査できない。引用を引用ブロック（`>`）に限り、直後に出典行を要求する書式を `_template.md` に定めれば、「引用ブロックが出典行を伴うこと」「連続する引用行が1段落以内であること」は検査できる。ただしハブの本文と一致するかの検査はネットワークなしではできない。人のレビュー項目として残すのが現実的。

### 4.5 数の更新

規則を1つ足すと、次の記述が古くなる（grep で洗い出して直す）: ルートの `AGENTS.md`（「nine W1–W3 repository rules」）、`.sdd/steering/tech.md`（`check:repo-rules（9規則）`）、`001` plan C20/C1 の規則表。`.sdd/steering/*.md` には未コミットの変更が既にあるので、同じ変更に混ぜないよう扱う。

### 4.6 そのほか

- gate はネットワークを使わず決定的でなければならない（001 Req 1.5、1.11）。ローカルにあるハブのクローン（`../vaz-agentic-ai-next`）を検査が読んではならない（CI に存在しない）。
- 検査の走査件数が0なら失敗（001 Req 1.15）。解説が4本ある現在は満たせるが、除外した未作成モジュールの一覧を出力に含める必要がある（Req 2.4）。
- ハブの spec `010-worker-approval-policy` が承認フローを変える可能性がある。M4 のコピー時に、そのときのハブの `ApprovalCard` を再確認する（コミットは M4 の時点で記録し直す）。

## 5. 実装方針の選択肢（Req 2 の検査）

| 案 | 内容 | 向く場面 | コスト | リスク |
|---|---|---|---|---|
| A. 既存を拡張（`check-docs.mjs` に集約） | 節の存在、リンク集合の一致、未作成の一覧を `docs:check` で行う | 解説の構造検査が1か所に集まる。表の読み取りも既存の走査基盤を使える | 低 | Req 2.3 は「リポジトリ規則」と書く。字義どおりでなく、`check:repo-rules` の規則数（9）と食い違う説明が要る。`docs:check` は gate の最後の段なので、失敗が遅く見つかる |
| B. 新しいリポジトリ規則（`check-repo-rules.mjs` に `hub-guide-links` を追加） | 字義どおり。表の読み取りと解説の走査を規則に入れる | 仕様に忠実。gate の早い段で失敗する | 中 | `check-repo-rules.mjs` は1070行で、出力が `scanned N FILES` の1形式。除外一覧を出すために出力形式の拡張が要る。解説の節構造の解析を `check-docs.mjs` と重複して持つ |
| C. ハイブリッド | 節の存在（`REQUIRED_SECTIONS` に追加）を `check-docs.mjs`、リンク先の一致と未作成一覧を新規則 `hub-guide-links` で行う。解析関数は `scripts/lib/` に出して共有する | 仕様の字義と既存の責務分割を両立する | 中 | 2か所を変えるので、plan で責務の線引きを明記しないと重複する |

**推奨は C**。節の存在は `check-docs.mjs` の既存の仕組み（`REQUIRED_SECTIONS`）に自然に載り、リンクの一致は Req 2.3 の字義どおり規則として gate の早い段に置ける。表の整形は案 X（機械可読化）と組み合わせる。

Req 3.1 のコピー方式の選択肢（M4 で決めてよいが、plan に論点として残す）:

| 案 | 内容 | リスク |
|---|---|---|
| α. 無改変コピー + `lib/utils.ts` の再 export | 差分 #1 を吸収。編集系 props は呼び出し側が渡さない | #2 の編集 UI がコードに残る。型で禁止できない |
| β. 無改変コピー + 薄いラッパー | `ApprovalDialog` が `ApprovalCard` を包み、編集系 props を型で受け付けない | ラッパーが増える。コピー元は変わらず、差分追跡が楽 |
| γ. 編集系を削ったコピー | コピー元コメントに「削った箇所」を残す | コピー元が更新されたとき、手で追従する |

## 6. plan で調べること

1. 遡及作業の置き場（005 の plan/tasks か、001 の W6 か）と、タグ `module/1-x` の扱い（§4.1）。
2. 対応表の整形（案 X か Y）と、表の更新日の置き場（Req 2.6）。
3. リンク先の文字列の形（§4.3）と、ルート `README.md` の既存リンクとの整合。
4. 規則 `hub-guide-links` の出力形式（除外一覧の出し方）と、`check-repo-rules.test.mjs` のテスト方針。非空走査（4件）と、除外一覧の出力のテストを先に書く。
5. 引用書式の定義と、Req 2.5 のどこまでを機械検査にするか（§4.4）。
6. テーマ文書の置き場（`docs/` 直下か、`docs/modules/` に入れない別ファイルか。`check-docs.mjs` の `MODULE_FILE` は `<n>-<n>-*.md` だけを数えるので、別名なら走査に混ざらない）と、トークン表と `globals.css` の一致を検査するか（ずれを防ぐテスト）。`destructive` と `background` の組を検査に加えるか。
7. M4 の承認ダイアログ: コピー方式（α/β/γ）、`Card` かモーダルか（§3.3）、ハブの spec `010` の影響。
8. 数の更新（§4.5）の一覧。

## 7. 次のステップ

- `/sdd-plan hub-alignment` で設計を作る（本書を自動で読み込む）。
- plan では、上の §6 の1〜3を先に決める。1 が決まらないとタスクの置き場が定まらない。
- 人が判断する点: 遡及作業の扱い（§4.1）。タグの内容に関わるため、plan の承認時に確認する。
