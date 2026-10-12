# 同じ概念の判定の分散と広すぎる catch（W4）

## 何が起きたか

- `/api/chat`・`/api/agent/tools` は `mediaType === "image"` も画像として扱い、`adaptHistoryForModel` も同じ。ガードの `inspectConversation` だけが `startsWith("image/")` だったため、bare な `image` は枚数・サイズの上限を通らなかった。
- `/api/agent/tools` は `createAgentUIStreamResponse` 全体を `catch {}` で包み、SDK の検証失敗以外も 400 `invalid-request` にしていた。検証前の履歴を `adaptHistoryForModel` に渡していた。

## 根本原因

1. 判定述語が3か所に重複していた。変更や追加のとき、1か所だけが古いまま残る。
2. 例外処理の範囲が、想定する失敗（検証）ではなく呼び出し全体だった。

## 影響

Req 3.11 の枚数・サイズの上限を、本文 512 KiB の範囲で回避できた。実バグが 400 として見え、ログもなかった。実害が出る前にレビューで検出し、修正済み。

## 防止策

- 述語は1つの関数にして共有する（`isImageMediaType`、`apps/web/lib/server/guard.ts`）。
- 検証の失敗だけを個別の try で変換し、他の例外は共通のエラー処理へ渡す。
- 検証 → 変換 → 実行の順序を守る。
- ガードのテストに、同じ概念の別表記を入れる。
- 敵対的レビューを `/sdd-ship` の前に行う。
