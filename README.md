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

## セットアップ

```bash
mise install
mise run setup
cp .env.example .env.local
mise run gate
```

`.env.example`には変数名だけを収録しています。APIキーなしでも品質ゲートを`mock`モードで
実行できます。現在のW1 gateは、Biomeのlint・formatと非空走査、モデルID検査、W1の4つの
リポジトリ規則、ルートテストを実行します。後続の段は波の締めで段階的に結線します。

`mise run setup`はpre-commitフック（`.githooks/pre-commit`）を有効にします。フックは
`pnpm`と`gitleaks`をPATHから呼ぶため、miseを有効にしたシェル（`mise activate`）から
commitしてください。miseを有効にしていないGitクライアントでは、フックがコマンドを
見つけられずにcommitを拒否します。

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

## 実行モード

- `mock`: 決定論的なテスト専用モード。ネットワークへフォールバックしません。
- `local`: Ollamaを使うハンズオンの既定モードです。
- `live`: 設定済みの商用プロバイダを使用します。

## ライセンス

[MIT](LICENSE)
