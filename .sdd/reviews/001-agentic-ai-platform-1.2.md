## Critique

Task 1.2 の境界である `package.json`、`pnpm-workspace.yaml`、`turbo.json` と、生成物として追加された `pnpm-lock.yaml` を、`AGENTS.md`、`spec.json`、`spec.md`、`plan.md`、`research.md`、`tasks.md`、`.sdd/steering/*.md`、constitution、現在の staged / unstaged / untracked 差分および既存レビューと突き合わせた。

第三者依存追加のリスクトリガーについては、ルートの直接開発依存 7 件がすべて範囲指定なしの完全一致であり、`research.md` の External dependencies に宣言された名前・版と一致することを確認した。pnpm 12 が `packageManager: "pnpm@12.6.0"` から生成する env lockfile は `pnpm-lock.yaml` の先頭 YAML document に `packageManagerDependencies` を置き、通常の依存 lockfile を第2 document に置く仕様であり、重複・破損ではない。`--offline --frozen-lockfile --lockfile-only` による再読込では lockfile の SHA-256 が変化せず、再現性を確認した。

Turborepo については、実リポジトリでの `--dry=json` が `//#typecheck` を `tsc -p tsconfig.json --noEmit`、`//#test` を `vitest run --config vitest.config.ts` として解決することを確認した。さらに一時ディレクトリに依存関係を持つ2つの仮ワークスペースを置いた dry-run で、Turborepo 2.11.4 が pnpm 12 形式の workspace と lockfile を読み、`build` と `typecheck` の `^` 依存、および `test` の `^build` 依存を正しく構築した。ルート `test` は単独の `//#test` として解決され、ワークスペースの Vitest を集約する設定や `projects` は存在しない。ADR-1 の後退条件には該当しない。

`mise run setup` と一時クリーン Git ディレクトリでの frozen install の成功済み証拠を前提として確認した。`mise run gate` は Task 1.3 所有の `biome.json` が未導入で既存 JSON 6 件の format 差分により失敗しているため、Task 1.2 の欠陥とは判定しない。ただし、W1 の締めまでには正規 gate の成功が別途必要である。

### [LOW] 現在の依存グラフに存在しない `esbuild` の lifecycle script を先行許可している
**Location**: `pnpm-workspace.yaml:8-10`
**Issue**: `allowBuilds.esbuild: true` の理由は現在解決される依存グラフと一致せず、未導入パッケージの lifecycle script 実行権限を将来の依存追加に先回りして付与している。
**Evidence**: コメントは「Vitest uses Vite, whose esbuild dependency verifies its platform binary in postinstall」と説明するが、lockfile の `vite@8.3.1` は `esbuild` を optional peer として宣言するだけで、`pnpm-lock.yaml` に `esbuild@...` の package / snapshot はなく、`node_modules` にも esbuild はインストールされていない。plan C1 と `.sdd/steering/tech.md` は `allowBuilds` を監査済みかつ理由付きの例外として扱うため、現在の許可理由は実測結果を表していない。一方、現 lockfile では esbuild 自体が存在せず script は実行されないため、現在のインストールに直接の実行リスクはない。
**Confidence**: high
**Fix**: 現時点では `allowBuilds` から `esbuild` を削除し、実際に lifecycle script を必要とする依存が lockfile に入るタスクで、対象版と必要性を確認して理由コメント付きで追加する。Task 1.2 で空の `allowBuilds` を保持する必要がないなら、設定自体をその時点まで遅延してよい。

## Verdict
APPROVE_WITH_NOTES

## Hallucination Signal
forced: false
