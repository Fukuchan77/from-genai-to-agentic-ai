# Plan Review: 001-agentic-ai-platform（2026-09-27、ラウンド 1）

- 対象: `specs/001-agentic-ai-platform/plan.md`、`research.md`
- 基準: `~/.claude/sdd/rules/plan-review.md`、`.sdd/memory/constitution.md` v1.0.0
- 判定: **NO-GO（条件付き）** → 指摘をすべて plan に反映済み。再検証（ラウンド 2）待ち
- 前提: `.sdd/steering/` は未作成

## 指摘と対応

| ID | 重大度 | 指摘 | 対応（反映先） |
|---|---|---|---|
| P-1 | CRITICAL | Constitution Compliance が「constitution なし」のまま。原則 1・2・5・6・7 の検証手段（ツール数 20 以下、`new ToolLoopAgent` の走査、`generateObject` 禁止、`ai-core` の UI 依存禁止、`eval` / `child_process` 禁止、非 read-only ツールの登録拒否、Actions の SHA 固定検査、`allowBuilds` の理由、`--frozen-lockfile`、ロギング方針）が計画にない | C20 に `check-repo-rules.mjs`（規則表）を追加し gate に組み込んだ。C8 にツール数上限を、C9 に非 read-only の拒否を追加した。C1 と C2 に `allowBuilds` の理由と `--frozen-lockfile` を追記した。Error Handling にロギング方針を追加し、Compliance 節を原則 1〜11 の表で書き直した |
| P-2 | HIGH | GuardedAgent の実行ごとの状態（開始時刻、停止条件の記録）の持ち方が決まっていない。サマリの確定経路（`aborted` と `error` の区別）が書かれていない | 1回の実行につき1回生成する方式に決めた（C8、ADR-6）。`onStepEnd` → `onEnd` / `onError` で1回だけ確定させ、`messageMetadata` の `finish` で送る。並行実行のテストを追加した |
| P-3 | HIGH | Mock の解決規則が、ADR-5（キーで照合）と Data Model（述語で照合）で食い違っている。`purpose` と `stepIndex` の出どころが決まっていない | シナリオは述語で定義順に照合し、カセットはキーで照合する方式に統一した。`purpose` はゲートウェイがモデル生成時に束縛し、`stepIndex` はプロンプトから導く（C7、ADR-5） |
| P-4 | HIGH | 原則 8（文書にもカタログ外のモデル ID を書かない）と Req 7.4（ドラフトのモデル ID との差分を明記する）が衝突する | constitution を 1.0.1 に PATCH 改訂し、差分表の囲みだけを例外とした。`check-model-ids` の走査範囲と囲みの規則を C20 に定義した |
| P-5 | MEDIUM | E2E が `/api/**` を全部モックするため、実際の Route Handler を通らない。`.sse` の fixture が実装とずれる | fixture を Route Handler の出力から生成し、`route.test.ts` で一致を検査するようにした。`real-server.spec.ts` を追加した（C19） |
| P-6 | MEDIUM | `deadline` はステップ完了時にしか効かず、応答しない LLM 呼び出しを止められない | `AbortSignal.any` でタイムアウトのシグナルを合成し、`reason` で `timeout` と `aborted` を区別する（C8、ADR-6） |
| P-7 | LOW | Req 4.3 と 4.5 の境界（部分オブジェクトの扱い）が書かれていない | `partial` は暫定表示で、確定値は検証済みの `final` だけと明記した（C12） |
| P-8 | LOW | クライアントのコードに環境変数名を書くと、クライアントバンドル検査が誤検知する | `requiredEnv` はサーバーのメタデータ経由でだけ表示すると規約にした（C16） |
| P-9 | LOW | `docs:check` は動的なテスト名を参照できない | 静的な抽出の制約と「チェックリストから参照するテストは固定の名前で書く」規約を明記した（C22） |
| P-10 | LOW | eval-suite の回帰テストが `ai-core` の単体テストと重なる | エージェントの通し実行の回帰テスト（`tool-agent-run.test.ts`）に置き換えた（C21） |

## 評価できる点

- M1 の範囲を守り、後続 spec には型と拡張点しか渡していない（原則 9）
- 品質ゲートの空振り対策が、段ごとに具体的に設計されている
- 版と API を実測の根拠で確定し、未検証の組み合わせには後退先を決めてある
- Req 1.1〜7.11 と NFR のトレーサビリティがすべて埋まっている
