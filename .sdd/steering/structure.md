# Structure

コードの配置パターンを記す永続知識。ファイルツリーの列挙ではなく、パターンと例を書く。
全ファイルの計画は `specs/001-agentic-ai-platform/plan.md` の File Structure Plan にある。

> **状態（2026-10-29）**: M1・M2 と M3 の W1〜W7 の `apps/web`・`packages/ai-core`・`packages/eval-suite`・`tooling/`・
> `scripts/`・`docs/` は実装済み（M3 の W8 で評価・解説・統合を仕上げている）。M4 の領域（`harness/` など）は未作成。

## Organization Pattern

**ロジックと UI の分離 + 機能ごとのサブパス公開**。LLM を呼ぶロジックはすべて UI 非依存の
`packages/ai-core` に置き、`apps/web` は検査・配信・描画だけを担う。`ai-core` は機能領域ごとの
ディレクトリに分かれ、各ディレクトリの `index.ts` がそのサブパスの公開 API になる。

例（エージェント領域）:

```
packages/ai-core/src/agents/
  guarded-agent.ts          # createGuardedAgent (the only place allowed to new ToolLoopAgent)
  guarded-agent.test.ts     # colocated test
  stop-conditions.ts
  stop-reason.ts            # pure function, exhaustively tested
  index.ts                  # public API of @platform/ai-core/agents
```

## Directory Map (high level)

| Path | Holds |
|------|-------|
| `apps/web/` | Next.js アプリ（パッケージ名 `web`、非公開）。`app/` にページと `app/api/*/route.ts`、`components/<feature>/` に画面部品、`components/ui/` に shadcn/ui の基本部品、`lib/server/` にサーバー専用モジュール、`e2e/` に Playwright |
| `packages/ai-core/` | `@platform/ai-core`。`src/<area>/`（`config`、`models`、`mock`、`agents`、`aci`、`ports`、`chat`、`summarize`、`testing`、M2 の `structured`、`rag`、`workflows`、`patterns`、M3 の `files`、`mcp`、`sandbox`、`analysis`、`research`、`helpdesk`、`requirements`、`marketing` …）、`drizzle/`（手書きの SQL マイグレーション）と `fixtures/`（シナリオ・カセット・外部サービスの fixture、`rag/` の評価コーパスと質問セット、M3 の `analysis/`・`arxiv/`・`helpdesk/`・`marketing/`・`sandbox/`） |
| `packages/eval-suite/` | `@platform/eval-suite`。`tests/capability/`（`local` 専用の RAG 検索比較・Judge と M3 の比較）と `tests/regression/`（RAG と M3 の配管。本体は M4） |
| `knowledge/` | 学習者の文書（RAG の取り込み元）。`README.md` 以外は `.gitignore` 済み。評価コーパスとは `kb:` / `eval:` の文書 ID で分離する |
| `tooling/vitest/` | テスト基盤（ネットワーク遮断、`local` 判定、件数を検査するレポーター） |
| `scripts/` | リポジトリ規約の検査（`check-*.mjs`、各々に隣の `.test.mjs`）、gate の補助（`scripts/gate/`）、E2E 用 SSE fixture 生成（`scripts/e2e/`）、共有ヘルパ（`scripts/lib/`） |
| `docs/` | 日本語の解説。`modules/<id>-<slug>.md`、`phases/phase-N.md`、`modules/_template.md` |
| `docker/sandbox/` | データ分析サンドボックスのイメージ定義（`mise run sandbox:build`）。サンプルデータの投入は `mise run seed:samples` |
| `infra/`、`compose.yaml` | ローカル依存サービス（Compose のプロファイル `db` / `trace`） |
| `specs/` | milestone 単位の spec（`00N-<name>/`）と、カリキュラムの確定版（`curriculum/`） |

後続 milestone は、この骨格に領域を足す（M2 は `ai-core/src/{structured,rag,workflows,patterns}/`、M3 は
`ai-core/src/{files,mcp,sandbox,analysis,research,helpdesk,requirements,marketing}/`、M4 は
`ai-core/src/harness/`）。新しいトップレベルのワークスペースは作らない前提で進める。

## Naming Conventions

- **Files**: kebab-case の `.ts`（`guarded-agent.ts`、`adapt-history.ts`）。React コンポーネントは
  PascalCase の `.tsx`（`ToolPartView.tsx`）。スクリプトは `check-<topic>.mjs`。
- **Tests**: 実装の隣に `<name>.test.ts`。接尾辞で実行経路を表す（`.local.test.ts`、
  `.db.test.ts`、`.pg.test.ts`、`.container.test.ts`。意味は `tech.md` の Testing を参照）。
- **Factories**: `create<Thing>`（`createModelGateway`、`createGuardedAgent`、`createFakeClock`）、
  定義ヘルパは `define<Thing>`（`defineAciTool`、`defineScenario`）。
- **Errors**: `<Cause>Error extends PlatformError`（`OllamaUnavailableError`、`ConfigError`）。
- **Closed vocabularies**: kebab-case の文字列リテラル union（停止理由 `step-limit` /
  `token-budget`、リスク区分 `read-only`、エラー `code`）。
- **Fixtures**: シナリオ ID はモジュールと用途を含める（`m1-2/agent/weather-then-answer`）。
- **Docs**: `docs/modules/<phase>-<n>-<slug>.md`（`1-2-ai-sdk-core-and-tools.md`）。完成タグは
  `module/<phase>-<n>`。

## Import / Dependency Rules

- `apps/web` と `packages/eval-suite` は `@platform/ai-core` に依存する。逆向きの依存は作らない。
- `@platform/ai-core` は React / Next.js / `@ai-sdk/react` に依存しない（リポジトリ走査で検査）。
- `ai-core` の利用者は `package.json#exports` のサブパス（`@platform/ai-core/agents` など）からだけ
  import する。深いパス（`src/...`）を直接 import しない。
- `apps/web` のサーバー専用コードは `lib/server/` に集め、`server-only` を import する。依存の
  組み立て（ゲートウェイ、ポート、Clock）は `lib/server/platform.ts` の1か所で行う。
- モデル ID の文字列リテラルは `models/catalog.ts` と設定スキーマの既定値以外に書かない。fixture の
  中でもカタログの定数を import する。
- `new ToolLoopAgent` は `agents/guarded-agent.ts` にだけ書く。
- `@ai-sdk/mcp` は `ai-core/src/mcp/` の中だけで import する（規則 `mcp-import-scope`）。`@e2b/code-interpreter` は `sandbox/e2b.ts` だけ、
  Docker の unix socket（`socketPath`、`docker.sock`）は `sandbox/docker/` だけ（規則 `sandbox-import-scope`。テスト基盤の例外は名指しの2ファイル）。
- Next.js ではページと Route Handler が別のモジュールコピーになる。複数ルートで共有する状態（セッション、定義済みツールの記録）は
  モジュール変数でなく `globalThis` のホルダーに置く。

## Where Things Go

- 新しい LLM ロジック（ワークフロー、エージェント、パイプライン）→ `packages/ai-core/src/<area>/`
  （Route Handler には書かない）
- 新しいツール → `packages/ai-core/src/aci/tools/<name>.ts`（`defineAciTool` + `risk` 必須）
- 新しい外部サービス → `ai-core/src/ports/` にポートと本番実装、`ai-core/src/mock/` に fixture 実装
- 新しい HTTP エンドポイント → `apps/web/app/api/<name>/route.ts`（`guardRequest` を通す。検査順は
  本文サイズ 413 → `z.strictObject` 400 → 件数・長さ 400 → `live` のときだけレート制限 429。LLM ロジックは
  `ai-core` の関数を呼ぶだけ）
- Route Handler の処理順は `guard → resolve → validate → adapt → stream`。検証（`validateUIMessages` など）を
  通す前の入力を変換関数（`adaptHistoryForModel` など）に渡さない。検証の失敗だけを個別の `try` で
  `invalid-request` に変換し、その外の例外は `toErrorResponse` に任せる（広い `catch {}` で 400 に偽装しない）
- 同じ概念の判定（画像か、ブロック対象か）は1か所の関数に置き、他の層は import する
  （例: `lib/server/guard.ts` の `isImageMediaType` を両ルートが使う）。ガードのテストには同じ概念の別表記
  （`image`、`image/png`、大文字小文字）を入れる
- エージェント実行の結果を記録・送出する処理（トレース、評価レポート）→ `RunObserver` の実装として
  `createGuardedAgent` の `observers` に渡す（`guarded-agent.ts` を直接改変しない）
- 新しいモデル → `packages/ai-core/src/models/catalog.ts` だけ
- 構造化出力を検証して再生成する呼び出し → `ai-core/src/structured/` の `generateValidated`
- RAG（取り込み、分割、埋め込み、検索、引用、評価）→ `ai-core/src/rag/`（DB は `rag/db/`、スキーマ変更は `drizzle/NNNN_<name>.sql` と `schema.ts` の両方）
- ワークフローパターン → `ai-core/src/workflows/`、エージェントデザインパターン → `ai-core/src/patterns/`。どちらも
  `agents/` と `ToolLoopAgent` を import しない（例外は `patterns/role-based-cooperation.ts` だけ）。HTTP 用の固定の組み立ては各領域の `demos.ts`
- 評価の質問セットとコーパス → `ai-core/fixtures/rag/`。手法の比較と Judge は `eval-suite/tests/capability/*.local.test.ts`、
  評価の配管の検証は `eval-suite/tests/regression/*.db.test.ts`
- `mock` の応答 → `packages/ai-core/fixtures/`（`scenarios/`、`cassettes/`、`http/`、`transcripts/`、`web-search/`）
- サンドボックス（実行環境の提供者）→ `ports/sandbox.ts` のポートと `ai-core/src/sandbox/`（E2B は `e2b.ts`、Docker は `docker/`、`mock` は `mock.ts`）。
  Docker 実機を要するテストは `*.container.test.ts`
- MCP（クライアントのアダプター、許可リスト、リスク区分）→ `ai-core/src/mcp/`、自作の stdio サーバーとファイル操作ツール → `ai-core/src/files/`
- ドメインエージェント → 領域ごとに `ai-core/src/{analysis,research,helpdesk,requirements,marketing}/`。`apps/web` の対応は
  `app/api/{analysis,research,helpdesk,requirements,marketing,mcp}/` と `components/<name>/`。
  M3 のルート: `mcp/{chat,compare,servers}`、`helpdesk`（`tickets`、`tickets/[id]`）、`analysis`（`status`、`sessions/[id]`）、`research`、
  `requirements/sessions`（`[id]/messages`、`[id]/document`）、`marketing/{council,recommend}`。
  HTTP の補助は `lib/server/`（`sessions.ts` セッションレジストリ、`upload.ts` アップロード検査、`domain-stream.ts` イベントの `data-*` 写像、`helpdesk-json.ts`）
- 新しい画面 → `apps/web/app/<name>/page.tsx` と `apps/web/components/<name>/`（色はテーマトークン経由。
  コントラストはルートのテストが検査する）。E2E は `apps/web/e2e/<name>.spec.ts`、API 応答の差し替えは
  `e2e/support/mock-api.ts`
- 評価 → `packages/eval-suite/tests/{capability,regression}/`
- リポジトリ規約の機械検査 → `scripts/check-repo-rules.mjs` に規則を追加（走査件数 0 なら失敗）
- 解説 → `docs/modules/`（`_template.md` の必須節に従い、チェックリストはテストを参照する）
