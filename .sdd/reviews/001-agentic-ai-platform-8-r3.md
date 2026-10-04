## Critique

### [MEDIUM] 27.3 に computed-style 検査の所有がなく、Task 8.3 の将来検証契約が実行タスクへ引き継がれていない
**Location**: specs/001-agentic-ai-platform/tasks.md:220; specs/001-agentic-ai-platform/tasks-w5.md:89-93; specs/001-agentic-ai-platform/plan.md:789-799
**Issue**: Task 8.3 は完成画面の computed style とコントラストを 27.3 で確認すると宣言するが、27.3 と plan は keyboard 操作と axe 検査しか要求せず、focus outline の computed color・opacity・隣接背景との 3:1 をブラウザで検査する成果物が割り当てられていない。
**Evidence**: Task 8.3 の `_Verify:_` は「完成画面の computed style とコントラストは 27.3 のブラウザ検査でも確認する」とする一方、27.3 は「主要操作をキーボードだけで行えること、各画面の axe 検査（WCAG 2.2 AA）」だけで、plan の `a11y.spec.ts` も「各画面の axe 検査」としか定義していない。現在の静的 gate は opaque `outline-ring` と token 比を検査できるが、生成 CSS と実際の focus 状態の computed style を将来確認する契約はこのままでは落ちる。
**Confidence**: high
**Fix**: 27.3 と plan の `a11y.spec.ts` 責務に、代表的な focusable component を focus し、`getComputedStyle` から outline/ring の実効色・alpha と隣接背景を取得して 3:1 以上を検査するブラウザテストを明記する。Task 8.3 の参照先と同じ文言で trace を閉じる。

### [LOW] temporary probe 記録の source と手順は、そのままでは再現実行できない
**Location**: specs/001-agentic-ai-platform/pdca/do.md:2217-2275
**Issue**: probe 本文に実タブではなくリテラルの `\t` が入り、作成・break・restore もコメントまたは diff 表示だけなので、「完全な source と再現可能な create/run/break/restore/cleanup commands」という round 2 の是正条件を満たしていない。
**Evidence**: code fence は `\texpect(...)`、`\tawait ...`、`\t\tcode: ...` をそのまま含むため、コピーした TypeScript は構文エラーになる。Creation は `# Write the two sources above to their paths.`、Restoration は `# Restore ...` であり、2つの break も実行 command ではなく diff 断片である。（prior: round 2 LOW、source は追加されたが再現可能性は未解消）
**Confidence**: high
**Fix**: code fence の `\t` を実際のインデントへ直し、heredoc 等による2ファイルの作成、設定のバックアップ、各 break の適用、各実行、設定の復元、green 再実行、cleanup までをコピー実行可能な command 列として記録する。

### [LOW] opaque-outline test は base style を対象にせず、CSS 内の不活性な同一文字列でも通る
**Location**: scripts/check-web-theme.test.mjs:67-69
**Issue**: opaque outline 契約が CSS 全文への `toContain` だけなので、`@layer base` の universal rule が再び `outline-ring/50` になっても、コメントや別 selector に `@apply border-border outline-ring;` が残れば false green になる。
**Evidence**: test は `expect(css).toContain("@apply border-border outline-ring;");` であり、対象 selector や declaration の active/非activeを検査しない。現在の `globals.css:77-80` は正しく opaque で、`/50` へ直接戻す mutation は失敗しているため現実装の不具合ではないが、「base style の rendered contrast と token contrast を一致させる」契約としてはスコープが弱い。
**Confidence**: high
**Fix**: コメントを除去したうえで `@layer base` 内の `*` rule を抽出し、その rule が `outline-ring` を持ち `/` opacity modifier を持たないことを検査する。

## Verdict
REQUEST_CHANGES

## Hallucination Signal
forced: false
