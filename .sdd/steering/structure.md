# Structure

コードの配置パターンを記す永続知識。ファイルツリーの列挙ではなく、パターンと例を書く。
全ファイルの計画は `specs/001-agentic-ai-platform/plan.md` の File Structure Plan にある。

> **状態（2026-09-27）**: 実装前。現在のリポジトリにあるのは `specs/` と設定ファイルだけで、
> 以下の `apps/`・`packages/` 等は承認済みの plan.md の計画で、まだ作られていない。

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
| `packages/ai-core/` | `@platform/ai-core`。`src/<area>/`（`config`、`models`、`mock`、`agents`、`aci`、`ports`、`chat`、`summarize`、`testing` …）と `fixtures/`（シナリオ・カセット・外部サービスの fixture） |
| `packages/eval-suite/` | `@platform/eval-suite`。`tests/capability/` と `tests/regression/`（本体は M4） |
| `tooling/vitest/` | テスト基盤（ネットワーク遮断、`local` 判定、件数を検査するレポーター） |
| `scripts/` | リポジトリ規約の検査（`check-*.mjs`）と gate の補助（`scripts/gate/`） |
| `docs/` | 日本語の解説。`modules/<id>-<slug>.md`、`phases/phase-N.md`、`modules/_template.md` |
| `infra/`、`compose.yaml` | ローカル依存サービス（Compose のプロファイル `db` / `trace`） |
| `specs/` | milestone 単位の spec（`00N-<name>/`）と、カリキュラムの確定版（`curriculum/`） |

後続 milestone は、この骨格に領域を足す（例: M2 は `ai-core/src/workflows/`、M4 は
`ai-core/src/harness/`）。新しいトップレベルのワークスペースは作らない前提で進める。

## Naming Conventions

- **Files**: kebab-case の `.ts`（`guarded-agent.ts`、`adapt-history.ts`）。React コンポーネントは
  PascalCase の `.tsx`（`ToolPartView.tsx`）。スクリプトは `check-<topic>.mjs`。
- **Tests**: 実装の隣に `<name>.test.ts`。接尾辞で実行経路を表す（`.local.test.ts`、
  `.db.test.ts`、`.pg.test.ts`。意味は `tech.md` の Testing を参照）。
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

## Where Things Go

- 新しい LLM ロジック（ワークフロー、エージェント、パイプライン）→ `packages/ai-core/src/<area>/`
  （Route Handler には書かない）
- 新しいツール → `packages/ai-core/src/aci/tools/<name>.ts`（`defineAciTool` + `risk` 必須）
- 新しい外部サービス → `ai-core/src/ports/` にポートと本番実装、`ai-core/src/mock/` に fixture 実装
- 新しい HTTP エンドポイント → `apps/web/app/api/<name>/route.ts`（`guardRequest` を通す。検査順は
  本文サイズ 413 → `z.strictObject` 400 → 件数・長さ 400 → `live` のときだけレート制限 429。LLM ロジックは
  `ai-core` の関数を呼ぶだけ）
- エージェント実行の結果を記録・送出する処理（トレース、評価レポート）→ `RunObserver` の実装として
  `createGuardedAgent` の `observers` に渡す（`guarded-agent.ts` を直接改変しない）
- 新しいモデル → `packages/ai-core/src/models/catalog.ts` だけ
- `mock` の応答 → `packages/ai-core/fixtures/`（`scenarios/`、`cassettes/`、`http/`、`transcripts/`）
- 評価 → `packages/eval-suite/tests/{capability,regression}/`
- リポジトリ規約の機械検査 → `scripts/check-repo-rules.mjs` に規則を追加（走査件数 0 なら失敗）
- 解説 → `docs/modules/`（`_template.md` の必須節に従い、チェックリストはテストを参照する）
