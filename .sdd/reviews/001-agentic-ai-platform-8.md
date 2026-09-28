## Critique

### [HIGH] Task 8 の境界外ファイルを、設計上の例外承認なしで成果物に含めている
**Location**: specs/001-agentic-ai-platform/tasks.md:198-220; biome.json:38-42; apps/web/next-env.d.ts:1-7
**Issue**: Task 8 の `_Boundary:_` にない `biome.json` と `apps/web/next-env.d.ts` を変更・追加しており、`plan.md` の更新または事前の境界改訂がないため、adversarial-review の境界契約に違反する。
**Evidence**: Task 8 の大境界と 8.1〜8.3 の各境界は7ファイルと `pnpm-lock.yaml` だけを列挙する一方、実差分には `biome.json` の `css.parser.tailwindDirectives` と未追跡の `apps/web/next-env.d.ts` がある。`pdca/do.md:2115` と `:2151` も両方を boundary 外変更として認識しているが、`plan.md` の C13 / File Structure Plan と Task 8 の `_Boundary:_` は改訂されていない。
**Confidence**: high
**Fix**: `plan.md` に Tailwind v4 を lint するための repository-wide Biome 変更と Next 生成型入口の所有者を明記し、Task 8 / 8.1 / 8.3 の `_Boundary:_` に `biome.json` と、追跡するなら `apps/web/next-env.d.ts` を追加する。`next-env.d.ts` を追跡しない判断なら、生成後に恒常的な未追跡差分を残さない方針を明記する。

### [MEDIUM] Web と ai-core が異なる AI SDK Core パッチ版を解決している
**Location**: apps/web/package.json:13-14; pnpm-lock.yaml:199-204,2174-2183,5034-5048
**Issue**: 最新の `@ai-sdk/react@4.0.121` は内部で `ai@7.0.118` を固定する一方、`@platform/ai-core` は `ai@7.0.113` のままで、同じ Web アプリ内に UI message stream の送受信を担う Core が2版入っている。
**Evidence**: `pnpm list ai --depth 10` は Web 側に `@ai-sdk/react -> ai@7.0.118`、サーバー側に `@platform/ai-core -> ai@7.0.113` を表示した。npm metadata でも `@ai-sdk/react@4.0.116` は `ai@7.0.113`、採用した `4.0.121` は `ai@7.0.118` に対応する。現 Task は機能コードを持たないため `mise run typecheck` の成功は、将来の `useChat` と ai-core の stream response 間の型・wire 互換性をまだ検査しない。
**Confidence**: high
**Fix**: 共有 AI SDK を同じリリース組に揃える。推奨は plan / Task 6 の依存所有境界を改訂して ai-core の `ai` と関連 provider を検証付きで更新すること。更新できない場合は `@ai-sdk/react@4.0.116` に留める例外と解除条件を plan に記録し、Task 21/22 で実際の UI message stream 往復テストを追加する。

### [MEDIUM] `vite-tsconfig-paths` は実環境で不要・非互換・非保守の依存になっている
**Location**: apps/web/package.json:41; apps/web/vitest.config.ts:3,24; pnpm-lock.yaml:3060-3069,5921-5924,5997-6002
**Issue**: Vite 8.3.1 が native `resolve.tsconfigPaths` を提供する環境でプラグインを残した結果、非保守の `tsconfck@3.1.6` と TypeScript 7.1 の未充足 peer が入り、`pnpm peers check` が失敗する。
**Evidence**: Vitest 起動時に毎回「Vite now supports tsconfig paths resolution natively ... remove the plugin」と警告される。lockfile は `tsconfck@3.1.6` を `deprecated: unmaintained`、peer を `typescript: ^5.0.0` と記録し、実測した `pnpm peers check` は installed `7.1.0-dev.20260926.1` に対する unmet peer で exit 1 になった。config load の成功は現在通ったコードパスの実測にはなるが、依存互換性を成立させるものではない。
**Confidence**: high
**Fix**: constitution 原則8に従って古くなった plan / Task 8 の `vite-tsconfig-paths` 指定を改訂し、Vite の `resolve.tsconfigPaths: true` へ置き換えて依存と `tsconfck` を除去する。残す場合は単なる warning 記録ではなく、未充足 peer を許容する明示的 waiver、影響範囲、解除条件を plan に置く。

### [MEDIUM] input / border token は WCAG 2.2 AA の非テキストコントラストを満たさない
**Location**: apps/web/app/globals.css:50-52,72-74
**Issue**: `--border` と `--input` は背景とのコントラストが light 1.56:1、dark 2.11:1 で、入力境界など識別に必要な UI 部品に適用すると WCAG 2.2 AA の 3:1 を下回る。
**Evidence**: CSS は `--input` と `--border` を light `oklch(0.84 0.01 265)`、dark `oklch(0.4 0.02 265)` とし、背景はそれぞれ `oklch(0.985 0 0)` と `oklch(0.16 0.01 265)` である。OKLCH を linear sRGB の相対輝度へ変換した実測は 1.56:1 / 2.11:1 だった。foreground 系の主要ペアは 4.5:1 を超えたが、Task 8.3 は `globals.css` 自体に「WCAG 2.2 AA のコントラスト」を要求し、Implementation Notes は token を高コントラストと主張している。
**Confidence**: high
**Fix**: `--border` / `--input` を両テーマで背景比 3:1 以上に調整し、token ペアを直接検査する自動テストを追加する。27.3 の axe だけに延期せず、scaffold の数値契約を小さい deterministic test で固定する。

### [LOW] temporary PROVE は非空だが、再現に必要な probe source が記録されていない
**Location**: specs/001-agentic-ai-platform/pdca/do.md:2129-2138
**Issue**: alias と hermetic setup を壊して失敗させた記録は fake-pass ではないが、削除した probe の完全な source と実行 command がないため、レビュー記録だけから同じ変異を再現できない。
**Evidence**: 独立レビューで一時的に component / route の2 probe を作ると、`server-only` alias、route の network guard、2-project 集約、root reporter は `executed=2 passed=2` で確認できた。gate/local/pg/unknown の終了コードも記録どおりだった。一方、author の記録は期待文字列と break の説明だけで probe 本文を含まない。なお `apps/web/package.json` に `test` / `test:coverage` script がないことは Task 8.1 と Task 21.1 の所有分離どおりであり、早期 execution unit を作らない判断は正しい。
**Confidence**: high
**Fix**: Task 21.1 で同じ契約を committed test に移し、Task 8 の PROVE 記録から参照する。それまでの監査性を必要とするなら、probe source と完全な command を `pdca/do.md` に残す。

## Verdict
REQUEST_CHANGES

## Hallucination Signal
forced: false
