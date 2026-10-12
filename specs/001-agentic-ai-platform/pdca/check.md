# Check Phase — agentic-ai-platform（W4 apps/web）

`pdca/plan.md` が存在しないため、期待値は `tasks.md` の W4（大タスク 20〜24）の受け入れ条件と `do.md` の Success Criteria から取った。

## Expectations vs. Results

| Expectation | Result | Status |
|---|---|---|
| RequestGuard が LLM 呼び出し前に件数・長さ・サイズ・回数を検査する（Req 3.11） | 実装済み。ただし bare な `image` メディアタイプと画像以外のリモート URL が検査をすり抜けた（敵対的レビュー MEDIUM 1、LOW 3） | ⚠️ → 修正済み |
| 接続時の名前解決と検査で内部アドレスへの接続を拒否する（W3 R3-1） | `platform.ts` に実装、テストあり | ✅ |
| 失敗時にクライアントへ秘密値・生メッセージを出さない | `errors.ts` の許可リスト方式と固定文言で達成 | ✅ |
| `/api/chat`・`/api/agent/tools`・`/api/summarize` と各 UI | 実装済み | ✅ |
| エージェントルートが不正な履歴だけを 400 にする | 初版は例外すべてを 400 にしていた（MEDIUM 2） | ⚠️ → 修正済み |
| 実サーバーでの表示確認、完成タグ 23.5・24.4 | 実施。実サーバーで3ページが 500 だった（Turbopack の2件、Tailwind の未処理）。修正後は3エンジン81件が通過、完成タグはローカルに付与 | ⚠️ → 修正済み |

## Test & Quality Outcomes

- Tests（2026-10-12 の最終 `mise run gate`、exit 0）: root 275、ai-core 687（skipped 4）、eval-suite 3（skipped 1）、web 301。ship 時点の web は 294。E2E は gate の外で、`mise run test:e2e` が3エンジン × 27 件 = 81 件を通し、`assert-playwright-nonempty` が非空を確認する。
- Lint/型検査: gate に含まれ、成功した。
- カバレッジ: 閾値の強制は未結線（`apps/web/vitest.config.ts` に coverage 設定がない。tasks.md 21 の Implementation Notes に記載済み）。
- 性能: 今回は測定していない。

## Requirements Coverage

- 実サーバーで NFR-09 の axe（WCAG 2.2 AA、light/dark）とフォーカス指示子の 3:1 を3エンジンで確認した（27.3）。
- W4 の要件（Req 1.9、1.10、2.13、3.1〜3.11、4.x の UI 側、5.x の UI 側、6.2〜6.4、NFR-09、NFR-12）のうち、実サーバーでしか確認できない NFR-09 の axe 検査と NFR-12 の表示は 27.x に持ち越した。
- Gaps: 完成タグの push（29.4）、`module/1-1` のタグ（14.6）、26.2・26.3 の `latency-probe.ts`、27.2・27.4、gate・CI への e2e と bundle 検査の結線（29）。

## Deviations from Design

- plan C13 は undici の `Agent` を例示していたが、`apps/web` に依存を加えず `node:http(s)` の `lookup` で同じ保証を実装した（do.md に記録、依存追加なし）。
- ガードの対象を「画像」から「すべての `file` パーツ」に広げた。いずれも `data:` URL だけを許可する。

## Issues Encountered

| Issue | Root cause | Resolution |
|---|---|---|
| ガードが bare な `image` を数えない | 「画像か」の判定がガード、ルート、`adaptHistoryForModel` の3か所に別々に書かれていた | `isImageMediaType` を1つにして共有、テスト追加 |
| エージェントルートの包括的 `catch {}` | 検証失敗を想定した catch が SDK 呼び出し全体を包んでいた | 検証だけを個別の try にし、他の例外は `toErrorResponse` へ |
| 検証前の履歴を `adaptHistoryForModel` に渡していた | 検証と変換の順序の誤り | 検証後の履歴を渡す |
| pre-commit の gitleaks がテスト内のダミー秘密値を検出 | `sk-live-…` 形式のダミー値が秘密値に見えた | `changeme-not-a-real-secret` に変更 |
| 外部スクリプトによる一括置換が2回無音で空振りした | インデント（タブ数）の想定違い | Edit ツールに切り替え |

## Assessment

W4 の実装は要件の大半を満たしている。敵対的レビューの MEDIUM 2件と LOW 1件は修正してテストを足し、gate は成功した。LOW 3件（レート制限枠の消費、非文字列本文の無視、`local` モードの記載）は未対応。完成タグと実サーバー確認が残るため、W4 は「実装完了、検証は W5 に一部持ち越し」と判断する。修正はまだコミットしていない。
| gate が通るのに `next dev` で3ページとも 500 | Vitest は Turbopack を通らない。`new URL("../../fixtures", import.meta.url)` と `tw-animate-css` の `style` 条件だけの `exports` を解決できなかった | `path.resolve` と相対 `@import` に変更。27.1 で回帰を守る |
| Tailwind が処理されず無スタイルのまま。axe は違反0 | `@tailwindcss/postcss` と `postcss.config` が宣言されていなかった（plan の宣言漏れ） | 人間の承認後に追加し、plan・research に記録 |
| Firefox でスキップリンクのフォーカス指示子が見えない | フォーカス中に outline 色が `currentcolor` になり、本文色がページ背景と同色だった | `:focus-visible { outline-ring }` を明示（`keyboard.spec` が検出） |
| `playwright test` が終了せずポートを握る | 子プロセス `next-server` が `gracefulShutdown` なしで残った。シェルの `NODE_ENV=development` が `next build` を壊した | `gracefulShutdown` と `NODE_ENV=production` を指定 |
| WebKit で Tab がリンクとボタンに止まらない | Safari の既定の挙動 | WebKit だけ Option+Tab を使う |
