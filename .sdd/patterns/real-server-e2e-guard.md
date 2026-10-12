# 実サーバー E2E ガード

## Problem

単体テスト（Vitest）は通っても、バンドラー（Turbopack）や CSS パイプライン（PostCSS）、ブラウザ固有の挙動を通らないため、本番ビルドが壊れていても gate が緑になる。axe のような検査も、スタイルが当たっていない画面では無意味に通る。

## Solution

gate の外に、`next build && next start`（`AI_RUN_MODE=mock`）を起動する Playwright の E2E を置く。最低限の回帰を3つ持つ: (1) 全ページが 200、(2) スタイルが当たっている（body の背景色が透明でない）、(3) ブラウザのエラーが 0。その上に axe、キーボード操作、フォーカス指示子のコントラストを3エンジンで載せる。

## Implementation

- `apps/web/playwright.config.ts`: 3 projects、`webServer` に `NODE_ENV: "production"` と `gracefulShutdown`。
- `e2e/real-server.spec.ts`: `page.route` を使わず実際の Route Handler を通す。
- `e2e/a11y.spec.ts`: ダークは `.dark` クラスを付けて検査する。
- `e2e/keyboard.spec.ts`: WebKit は Option+Tab。フォーカス色は canvas で sRGB に変換して 3:1 を検査する。
- `scripts/gate/assert-playwright-nonempty.mjs`: 収集0件・全件スキップ・空のエンジンを失敗にする。

## Benefits

- Turbopack の解決失敗、PostCSS の欠落、Firefox のフォーカス指示子の欠陥を、変異検証で再現できる形で検出した。
- 生成した fixture を Route Handler のテストが検証するため、E2E が古い応答に依存しない。

## Evidence

- 2026-10-12: 3エンジン 81 件通過。fixtures を `new URL` に戻す／`postcss.config.mjs` を外す／`<html lang>` を外す／dark を適用しない、の各変異が検出された。
