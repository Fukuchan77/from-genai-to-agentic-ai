# Technology

技術上の判断と規約を記す永続知識。依存の網羅的な一覧ではない。
版の実測値と ADR の詳細は `specs/001-agentic-ai-platform/research.md`、コンポーネントの契約は
同 `plan.md` にある。

> **状態（2026-09-27）**: 実装前。001 の要件と設計（plan.md）は承認済み、タスクは未生成。以下の
> 「計画」は承認済みの plan.md / research.md の決定であり、実装で実測した値（版など）が変われば更新する。

## Stack

| Layer | Choice | Notes |
|-------|--------|-------|
| Runtime | Node.js 26 | `mise.toml` で固定（先行版の採用は方針） |
| Language | TypeScript 7.1 先行版 | 全ワークスペースで完全一致の版に固定。型検査は `tsc --noEmit`（ADR-2） |
| Monorepo | pnpm workspaces + Turborepo | 入口は mise タスク。turbo は `typecheck` / `test` / `build` を依存順に実行（ADR-1） |
| Web | Next.js（App Router、Turbopack、React Compiler、`typedRoutes`） | UI は shadcn/ui + Tailwind CSS v4 の基本部品と自前のチャット部品（ADR-11） |
| AI | Vercel AI SDK v7 + Zod | プロバイダ: Anthropic（`live` 既定）/ OpenAI / Azure / Google / Ollama |
| Data store | Postgres + pgvector（Docker Compose） | M2 から。gate では使わない。検索は pgvector + Reciprocal Rank Fusion |
| Observability | OpenTelemetry（OTLP）+ Langfuse | 受信基盤（Compose の `trace` プロファイル）は M1 で用意し、計測とエクスポートは M4 |
| Sandbox | E2B（キーがなければローカルコンテナ） | LLM 生成コードの実行専用（M3 から） |
| Testing | Vitest（単体・回帰）、Playwright（3エンジン E2E）、Stryker（ミューテーション） | `@axe-core/playwright` で WCAG 2.2 AA。Stryker は TypeScript 7・Vitest 5 に未対応のため、`tsconfigFile` の回避と `@stryker-mutator/vitest-runner` へのパッチ（`patchedDependencies`）で動かす。対応版が出たら外す（plan C18） |
| Lint / Format | Biome（リポジトリ全体で単一規約） | `noUnusedVariables` / `noUnusedImports` は `error` |
| Tooling | mise → `pnpm exec` | 素のツールを直接実行しない |

## Key Decisions

- **エージェントは `ToolLoopAgent`、ワークフローは素の TS** — `generateText` / `streamText` を
  合成するワークフローで `ToolLoopAgent` を使わない。構造化出力は `output: Output.object(...)`、
  ツール入力は `inputSchema`。`generateObject` / `streamObject` は使わない。
- **エージェント生成は `createGuardedAgent` に一本化** — 3種の停止条件と停止理由を強制し、
  1回の実行につき1回生成する（状態をリクエスト間で共有しない）。ツールは 20 個以下（ADR-6）。
  渡せるツールは `buildToolSet` の戻り値 `GuardedToolSet`（ブランド型）だけで、リスク区分の検査を
  迂回できない（plan C8、C9）。
- **後続 milestone は拡張点から差し込む** — トレース（004 Req 5）と評価レポートは
  `createGuardedAgent` の `observers`（`RunObserver.onRunEnd(summary)`）を実装して接続する。承認ゲート
  （004 Req 4）は `toolApproval` 等を `createGuardedAgent` の options に足すだけで、`/api/agent/tools`
  の UI ストリームの形は変えない（plan「後続 spec への契約」）。
- **モデル切り替え時の履歴は許可リストで変換する** — 送信直前に `adaptHistoryForModel` を適用し、他
  プロバイダの推論パートと `providerMetadata` を除き、画像非対応モデルには画像をテキストに置き換える。
  変換はサーバーの送信時だけで、クライアントの表示用履歴は変えない（ADR-7）。
- **トークン数はローカルで推定する** — `gpt-tokenizer` の推定値に安全係数 1.2 を掛け、カタログの
  コンテキスト上限の 80% を超えるなら分割して段階的に要約する。実測の `usage` も併記する（ADR-9）。
- **ツールは `defineAciTool` で定義** — リスク区分（`read-only` / `write` / `destructive`）が必須。
  例外とタイムアウトは `ToolOutcome` としてツール結果に変換し、ループを継続させる。
- **モデル解決はゲートウェイに集約** — 機能は `gateway.resolve({ purpose, modelId? })` だけを呼ぶ。
  モデル ID はモデルカタログ（`models/catalog.ts`）にだけ書く（ADR-4）。
- **LLM 実行モードは3層** — `mock`（テスト専用・決定論的）、`local`（Ollama。Web とハンズオンの
  既定）、`live`（商用 API）。コードを変えずに環境変数で切り替える。
- **`mock` はシナリオ（述語照合）→ カセット（キー照合）→ エラー** — ネットワークへフォールバック
  しない（ADR-5）。
- **Biome の書式はタブ・ダブルクォート・行幅 100・セミコロンあり**（ADR-3）。ドラフトの
  2スペース・シングルクォート案は採らない。

## Conventions

- **Typing**: strict。`packages/ai-core` の公開 API に `any` を含めない（Biome `noExplicitAny`）。
  システム境界（HTTP、ツール入力、構造化出力、環境変数、外部 API の応答）は Zod で検証し、内部では
  検証済みの型を信頼する。クライアントへ渡す型は Zod を含まない型にする。
- **Errors**: 独自エラーは `PlatformError`（`code` は閉じた語彙、`message` は日本語、`details`）を
  継承する。クライアントへは `code` と `message` だけを返し、スタックトレースと秘密情報を送らない。
- **Logging**: ログに出してよいのはエラーの `code`・名前、モデル ID、ツール名、数値だけ。生の
  プロンプト、メッセージ本文、ツール引数・結果、秘密情報は出さない。
- **Dependency injection**: 時刻と外部サービスはポート（`Clock`、`HttpFetcher`、
  `TranscriptSource`、`WebSearchProvider`）越しに注入する。`process.env` を直接読むのは設定読み込みの
  既定引数の1か所だけ。
- **Testing**: TDD（RED → GREEN → REFACTOR）。テストは実装の隣に置く。命名で実行経路が決まる:
  - `*.test.ts` — gate で実行（`mock`）
  - `*.local.test.ts` — 比較・品質評価。`local` のときだけ実行し、なければ理由付きスキップ
  - `*.db.test.ts` — インプロセス DB で gate に含める
  - `*.pg.test.ts` — Docker の Postgres が必要。`mise run test:db` だけで実行
  - テスト中は `fetch`・`node:net`・`node:dns` を遮断する。未モックの接続はテストを失敗させる。
- **Non-vacuous gate**: 各段で実行件数・走査件数が 0 なら失敗。スキップは合格に数えない。
- **Language**: spec・解説・UI 文言は日本語。コード、識別子、コメント、コミット、PR は英語。
- **Commands**: `mise run <task>` → `pnpm exec <cmd>` の順。
- **Gate command**: `mise run gate`。現在の W1 構成は `lint`（Biome の非空走査を含む）→
  `check:model-ids` → `check:repo-rules`（W1 の4規則）→ `test`。Docker・API キー・ネットワーク不要。
  後続の波で `typecheck` と残りの規則を加え、W5 で `docs:check` を結線する。
- **Preflight command**: なし。`local` の可否は Vitest の global setup が Ollama の到達性で判定する。

## Constraints

- **決定性**: 同一コミットで `gate` を 10 回実行して同じ合否。依存インストール済みの開発機で 5 分以内。
- **隔離実行**: LLM 生成コード（データ分析、ハーネスの実装・テスト）はホストで実行しない。隔離環境が
  なければその機能は起動しない。`eval` / `new Function` / `child_process` は許可リスト外で禁止。
- **承認ゲート**（constitution 原則 6、004 Req 4）: 承認要否はコミット済みのサーバー側コードで決め、
  クライアントの値や実行時のヒューリスティックで決めない。承認要求はサーバーが発行し、ツール呼び出し
  ID と引数に束縛して署名し、1 回だけ消費できる。承認・再開のリクエストは未知フィールドを拒否する厳格な
  スキーマで検証し、会話履歴・モデル・トークン使用量を受け付けない。
- **秘密情報**: API キーは環境変数からサーバー側でのみ参照（`server-only`）。`NEXT_PUBLIC_` を秘密に
  使わない。`.env` はコミットせず、キー名だけの `.env.example` を置く。
- **サプライチェーン**: 公開 24 時間未満の版を採らない（`minimumReleaseAge: 1440`）。`allowBuilds` は
  理由コメント付き。`overrides`・`patchedDependencies` も直前のコメントに理由と外す条件を書く。CI は `--frozen-lockfile`、Actions は SHA 固定・最小 `permissions`。
- **依存の追加**: `plan.md` に宣言してから追加する。API キーが要る外部サービスは、キーがない場合の
  スキップまたは代替を必ず持つ。
- **先行版**: 範囲指定でなく完全一致で固定し、理由を記録する。非互換で TypeScript 6.x に後退する
  場合は、範囲・理由・解除条件を記録する。コンパイラ API 依存のツール（`ts-morph`、型付き
  `typescript-eslint`、Stryker `typescript-checker`）は採らない。
- **品質目標**: `packages/ai-core` の行カバレッジ 80% 以上、WCAG 2.2 AA とキーボード操作、最新安定版の
  Chrome / Firefox / Safari、`mock` でのストリーミング反映 100 ms 以内。
