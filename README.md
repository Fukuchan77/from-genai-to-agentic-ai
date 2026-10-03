# From GenAI to Agentic AI

本番品質のAIエージェントをTypeScriptとWeb標準スタックで設計・構築・評価するための、
日本語エンジニアリングガイドとリファレンス実装です。

## 現在の状態

Milestone 1の基盤を実装中です。pnpm workspaces + Turborepoのモノレポ、miseタスク、
Biome、TypeScript 7.1、Vitest、Strykerのルート設定を用意しています。Webアプリと
`packages/ai-core`の実装は後続タスクで追加します。

確定済みの要件・設計・カリキュラムは次を参照してください。

- `specs/001-agentic-ai-platform/`: M1の要件、設計、タスク
- `specs/curriculum/`: 4フェーズ・19モジュールのカリキュラム
- `.sdd/memory/constitution.md`: 変更できない開発原則

## 関連リポジトリとの役割分担

2026-10-03 に、Agentic AI 系リポジトリの役割を次のように定めました。本リポジトリは
**入門から本番品質までを順に学ぶ学習パス**です。

| リポジトリ | 役割 | 読者が得るもの |
|---|---|---|
| 本リポジトリ | 学習パス。19 モジュールを順に進める。リファレンス実装は教材用に最小限 | 概念の理解と、自分で組めるようになる手順 |
| [`vaz-agentic-ai-next`](https://github.com/Fukuchan77/vaz-agentic-ai-next) | 本番の統合ハブ（Next.js + AI SDK と FastAPI + Pydantic AI のモノレポ）。`docs/guide/` は 8 手法（PE / CE / LE / HE / AE / AO / MCP / EV）別の本番エンジニアリング・リファレンス | 本番で使う判断（ADR）・防御・運用の実例 |
| [`next-agentic-stack`](https://github.com/Fukuchan77/next-agentic-stack) / [`pydantic-ai-sandbox`](https://github.com/Fukuchan77/pydantic-ai-sandbox) | TypeScript / Python のベータ検証レーン | 次の版で何が変わるか |

運用ルール:

- **相互リンクで済ませ、本文を複製しない。** 各モジュールの解説は、該当する手法のハブ側ページへ
  「本番ではどう作るか」としてリンクします。ハブの `docs/guide/` は、手法ごとに本リポジトリの該当
  モジュールへ「学習パス」としてリンクします。対応表は
  [`specs/curriculum/README.md`](specs/curriculum/README.md#本番実装との対応) にあります。
- **教材コードを第 3 の本番実装にしない。** `@platform/ai-core` は学ぶための最小構成です。
  本番の機能（認証・RBAC、耐久ワークフロー、承認の永続化など）が要るモジュールでは、簡略版であることを
  明示し、ハブの実装へリンクします。
- **UI 部品の標準は shadcn/ui + Tailwind CSS**（ハブの ADR-0008）で、本リポジトリの `apps/web` と同じです。

## セットアップ

```bash
mise install
mise run setup
cp .env.example .env.local
mise run gate
```

`.env.example`には変数名だけを収録しています。APIキーなしでも品質ゲートを`mock`モードで
実行できます。現在のW1 gateは、Biomeのlint・formatと非空走査、モデルID検査、W1の4つの
リポジトリ規則、ルートと`test`スクリプトを持つワークスペース（現在は`@platform/ai-core`）のテストを実行します。後続の段は波の締めで段階的に結線します。

`mise run setup`はpre-commitフック（`.githooks/pre-commit`）を有効にします。フックは
`pnpm`と`gitleaks`をPATHから呼ぶため、miseを有効にしたシェル（`mise activate`）から
commitしてください。miseを有効にしていないGitクライアントでは、フックがコマンドを
見つけられずにcommitを拒否します。フックのBiomeとgitleaksはステージ済みの内容を検査しますが、
モデルID検査（`mise run check:model-ids`）は作業ツリー全体を走査します。ステージしていない
修正で違反が隠れることがあるため、commit前に`mise run gate`も実行してください。

`.env.local`は、Next.jsと`mise run services:*`（Composeへ`--env-file .env.local`として渡す）の
両方が読みます。ファイルがなければComposeは`compose.yaml`の既定値で起動します。既定の秘密値は
ローカル専用なので、共有環境では`.env.local`に独自の値を設定してください。

## 主なコマンド

```bash
mise tasks              # 利用可能なタスクを表示
mise run gate           # 現在の品質ゲート
mise run lint:fix       # Biomeによるformat/lint修正
mise run typecheck      # Turborepo経由の型検査
mise run test           # mockモードのテスト（テスト基盤完成後）
mise run test:local     # Ollamaを使う比較・品質テスト
mise run services:up    # Postgres・Langfuseサービス（Compose完成後）
```

ツールは直接実行せず、原則として`mise run <task>`から起動します。

## トラブルシュート

### Rancher Desktopでinit SQLがマウントされない

Rancher Desktopは既定でホームディレクトリと`/Volumes`だけをVMへ共有します。リポジトリを
`/Users/Shared`などに置いている場合、Postgresのinit SQLが見えず、`vector`拡張とLangfuse用DBが
作成されません。`~/Library/Application Support/rancher-desktop/lima/_config/override.yaml`に
次を追加し、Rancher Desktopを再起動してください。

```yaml
mounts:
  - location: "/Users/Shared"
    writable: true
```

確認:

```bash
docker run --rm \
  --mount type=bind,source="$PWD/infra/postgres/init",target=/mnt,readonly \
  pgvector/pgvector:pg17 ls -l /mnt/01-extensions.sql
```

## 実行モード

- `mock`: 決定論的なテスト専用モード。ネットワークへフォールバックしません。
- `local`: Ollamaを使うハンズオンの既定モードです。
- `live`: 設定済みの商用プロバイダを使用します。

## ライセンス

[MIT](LICENSE)
