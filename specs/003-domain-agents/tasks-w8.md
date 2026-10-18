# domain-agents（Milestone 3）— 実装タスク W8: 評価・解説・統合（大タスク 37〜42）

未着手の波。表記規約、ID 対応表、進捗、gate への段階的な結線、共有ファイルの編集者は [tasks.md](tasks.md) を参照する。

`eval-suite` のテスト（回帰と能力）、`local` と `container` での実行と結果の記録（高水準と低レベルの比較、修正ループ、引用の遵守、合意に達する割合、
単一エージェントとのトークン比較）、解説 3-1〜3-6、`phase-3.md`、`traceability.md`、ステアリングと `AGENTS.md` の更新、`changes-from-drafts.md` への差分、
`gate:repeat`、完成タグを作る。`local` と `container` の結果は gate の外であることを解説に明記する（スキップを合格に数えない）。

37.1〜37.4 は並列に進められる。38.1〜38.4 は並列に進められる。40.1〜40.6 は 39.x の後に並列に進められる。

---

## 37. 回帰テスト（gate、`mock`）

配管を `mock` で決定論的に検証する。品質の評価ではない。

_Boundary:_ `packages/eval-suite/tests/regression/*`
_Depends:_ 11.1, 15.3, 19.6, 22.4, 27.8
_Requirements:_ 1.3, 1.5, 2.1, 2.6, 2.7, 4.8, 6.5
_Traces:_ REQ-001, REQ-002, REQ-004, REQ-006, C16

- [ ] 37.1 (P) `tests/regression/mcp-fatal-stop.test.ts`: 致命的エラー（許可ルート外のパスの読み取り）でツール呼び出しが止まり、停止理由が `error` になり、後続のツールが実行されない配管を、`mock` と自作サーバー（同一プロセスの接続）で検証する
  _Boundary:_ `packages/eval-suite/tests/regression/mcp-fatal-stop.test.ts`
  _Depends:_ 10.4, 8.4
  _Requirements:_ 1.3, 1.5
  _Traces:_ REQ-001, C16
- [ ] 37.2 (P) `tests/regression/helpdesk-plan.db.test.ts`: 問い合わせ → 計画 → 実行 → 判断 → チケット保存（`resolved` と `escalated`）の配管を、`mock` と PGlite で検証する
  _Boundary:_ `packages/eval-suite/tests/regression/helpdesk-plan.db.test.ts`
  _Depends:_ 14.1, 15.1
  _Requirements:_ 2.1, 2.6, 2.7
  _Traces:_ REQ-002, C16
- [ ] 37.3 (P) `tests/regression/research-budget.test.ts`: Supervisor の呼び出し回数と共有トークン予算の上限（`maxSubagentCalls: 2` に下げて検証する）を `mock` で検証する
  _Boundary:_ `packages/eval-suite/tests/regression/research-budget.test.ts`
  _Depends:_ 22.5
  _Requirements:_ 4.8
  _Traces:_ REQ-004, C16
- [ ] 37.4 (P) `tests/regression/marketing-catalog.db.test.ts`: レコメンドがカタログの商品 ID だけを返し、カタログ外の ID が除去されて件数が記録される配管を、`mock` と PGlite で検証する
  _Boundary:_ `packages/eval-suite/tests/regression/marketing-catalog.db.test.ts`
  _Depends:_ 27.1, 26.7
  _Requirements:_ 6.5
  _Traces:_ REQ-006, C16

### Implementation Notes

---

## 38. 能力テスト（`local` 専用）

実モデルの品質を観察する。gate では理由付きでスキップされ、合格に数えない。

_Boundary:_ `packages/eval-suite/tests/capability/*`
_Depends:_ 37.1, 37.2, 37.3, 37.4
_Requirements:_ 1.12, 3.3, 4.2, 4.5, 6.2
_Traces:_ REQ-001, REQ-003, REQ-004, REQ-006, C16

- [ ] 38.1 (P) `tests/capability/mcp-compare.local.test.ts`: 高水準ツール（`findAndReadFiles`）と低レベルの組み合わせのステップ数・トークン数の比較を観察する（Req 1.12）
  _Boundary:_ `packages/eval-suite/tests/capability/mcp-compare.local.test.ts`
  _Depends:_ 10.5
  _Requirements:_ 1.12
  _Traces:_ REQ-001, C16
- [ ] 38.2 (P) `tests/capability/analysis-fix.local.test.ts`: 実モデルが誤ったコードを修正して完走する割合を観察する。サンドボックスは疑似でなく、`local` で利用可能な提供者（Docker）を使い、無ければ理由付きでスキップする
  _Boundary:_ `packages/eval-suite/tests/capability/analysis-fix.local.test.ts`
  _Depends:_ 18.4, 17.8
  _Requirements:_ 3.3
  _Traces:_ REQ-003, C16
- [ ] 38.3 (P) `tests/capability/research-quality.local.test.ts`: Supervisor が子を呼び分け、未知の論文を引用しない割合を観察し、同じ課題を単一エージェントで行った場合とのトークン使用量を比較する（3-4 の解説に使う。憲章 原則 1）
  _Boundary:_ `packages/eval-suite/tests/capability/research-quality.local.test.ts`
  _Depends:_ 22.4
  _Requirements:_ 4.2, 4.5
  _Traces:_ REQ-004, C16
- [ ] 38.4 (P) `tests/capability/council-agreement.local.test.ts`: 合議が上限内で合意に達する割合を観察し、単一エージェントで同じ文案を改善した場合とのトークン使用量を比較する（3-6 の解説に使う。憲章 原則 1）
  _Boundary:_ `packages/eval-suite/tests/capability/council-agreement.local.test.ts`
  _Depends:_ 26.7
  _Requirements:_ 6.2
  _Traces:_ REQ-006, C16
- [ ] 38.5 `tests/capability/README.md`: M3 の評価の置き場所と gate / `local` / `container` の線引きを足す
  _Boundary:_ `packages/eval-suite/tests/capability/README.md`
  _Depends:_ 38.1, 38.2, 38.3, 38.4
  _Requirements:_ 1.12
  _Traces:_ REQ-001, C16
  _Verify:_ README の記述と、実在するテストのファイル名が一致する（`mise run docs:check` が成功する）

### Implementation Notes

---

## 39. `local`・`container` での実測と記録

gate の外にある実機の結果を research.md と解説の根拠に記録する。実行できない環境では「未実行」と明記する。

_Boundary:_ `specs/003-domain-agents/research.md`
_Depends:_ 38.5
_Requirements:_ 1.12, 3.1, 3.3, 4.2, 6.2
_Traces:_ REQ-001, REQ-003, REQ-004, REQ-006, C16

- [ ] 39.1 `mise run test:local`（Ollama）で 38.1〜38.4 を実行し、結果（高水準と低レベルのステップ数・トークン数、修正ループの完走率、引用の遵守率、合意に達する割合、単一エージェントとのトークン比較）を、使用したモデルとともに research.md に追記する。Ollama が使えない環境では未実行と明記し、解説にはその旨を書く（実測値を捏造しない）
  _Boundary:_ `specs/003-domain-agents/research.md`
  _Depends:_ 38.5
  _Requirements:_ 1.12, 3.3, 4.2, 6.2
  _Traces:_ REQ-001, REQ-003, REQ-004, REQ-006, C16
  _Verify:_ research.md に実行日、モデル、各観察値（または「未実行」と理由）が書かれている
- [ ] 39.2 `mise run sandbox:build` と `mise run test:container`（Docker）の結果、macOS のソケットの結果（S-5）、E2B（`E2B_API_KEY`）と GitHub の MCP（`GITHUB_TOKEN`）のハンズオンの結果（任意）を、research.md の該当 spike の節に追記する。人が実行する項目で、実行されなかったものは「未実行」と書く
  _Boundary:_ `specs/003-domain-agents/research.md`
  _Depends:_ 39.1
  _Requirements:_ 3.1, 3.8
  _Traces:_ REQ-001, REQ-003, C16, S-4, S-5, S-6
  _Verify:_ research.md の S-4・S-5・S-6 の節に実行日と結果（または「未実行」）が書かれている

### Implementation Notes

---

## 40. 解説（モジュール 3-1〜3-6、C16）

各モジュールの解説を日本語で書く。ハンズオンは `local` / `live` を原則とし、必要なサービス（Ollama、Docker、`E2B_API_KEY`、`GITHUB_TOKEN`）を各手順に明示する。
習熟度チェックリストはテスト名を参照し、`local` と `container` 専用のテストを参照する項目はスキップされうることを明記する。「本番ではどう作るか」節でハブ
`vaz-agentic-ai-next` の手法ページへリンクし、「確認できていないこと」に gate が保証しないものを書く。

_Boundary:_ `docs/modules/3-1-aci-and-mcp.md`, `docs/modules/3-2-helpdesk-agent.md`, `docs/modules/3-3-data-analysis-agent.md`, `docs/modules/3-4-hierarchical-research.md`, `docs/modules/3-5-requirements-interview.md`, `docs/modules/3-6-marketing-support.md`, `docs/phases/phase-3.md`, `docs/modules/index.md`, `scripts/check-docs.mjs`, `scripts/check-docs.test.mjs`
_Depends:_ 36.1, 39.2
_Requirements:_ 1.1, 1.17, 2.1, 3.1, 4.1, 5.1, 6.1
_Traces:_ REQ-001, REQ-002, REQ-003, REQ-004, REQ-005, REQ-006, C16

- [ ] 40.1 (P) `docs/modules/3-1-aci-and-mcp.md`: ACI 設計（説明文の形式、修正ガイド、`concise` / `detailed`、意味のある識別子、思考ツール、高水準ツール）、MCP（自作サーバー、許可リスト、注釈とリスク区分、致命的エラーのラッチ、書き込み系を登録しない理由）を、移植時の変更点・本番ではどう作るか（`docs/guide/mcp.md`）・確認できていないこと（GitHub の MCP の注釈、S-6）とともに書く
  _Boundary:_ `docs/modules/3-1-aci-and-mcp.md`
  _Depends:_ 36.1, 39.2
  _Requirements:_ 1.1, 1.3, 1.5, 1.7, 1.8, 1.12, 1.16, 1.17
  _Traces:_ REQ-001, C16
- [ ] 40.2 (P) `docs/modules/3-2-helpdesk-agent.md`: Plan-and-Execute（計画の検査、スケジューラ、`continue` / `replan` / `finish`、差分）、チケットとステップ上限、認証情報の形状検査、計画をワークフローで書き `ToolLoopAgent` を使わない理由（ADR-9）、憲章 原則 1 の⚠ 2 の記録を書く
  _Boundary:_ `docs/modules/3-2-helpdesk-agent.md`
  _Depends:_ 36.1, 39.2
  _Requirements:_ 2.1, 2.2, 2.3, 2.4, 2.6, 2.7, 2.8, 2.10
  _Traces:_ REQ-002, C16
- [ ] 40.3 (P) `docs/modules/3-3-data-analysis-agent.md`: サンドボックス（E2B と Docker の選択順、隔離の制限）、アップロードの検査、修正ループ（3 回）、図表の受け渡し（目印の行）、アイドル破棄を書く。**「確認できていないこと」に E2B の外向き通信の既定（S-4）と、004 への引き継ぎ事項（`runPython` のリスク区分とネットワーク制限の再検討。CL-21）を書く**
  _Boundary:_ `docs/modules/3-3-data-analysis-agent.md`
  _Depends:_ 36.1, 39.2
  _Requirements:_ 3.1, 3.2, 3.3, 3.4, 3.5, 3.7, 3.8, 3.9
  _Traces:_ REQ-003, C16, CL-21
- [ ] 40.4 (P) `docs/modules/3-4-hierarchical-research.md`: Supervisor と 3 つのサブエージェント（Agent-as-a-Tool）、要約だけを返す境界、共有予算と呼び出し回数、引用の照合、arXiv の利用規約（3 秒間隔、キャッシュ）を書き、**単一エージェントとのトークン使用量の比較（39.1 の実測または「未実行」）を記録する**（憲章 原則 1 の⚠ 1）
  _Boundary:_ `docs/modules/3-4-hierarchical-research.md`
  _Depends:_ 36.1, 39.1
  _Requirements:_ 4.1, 4.4, 4.5, 4.6, 4.7, 4.8, 4.10
  _Traces:_ REQ-004, C16
- [ ] 40.5 (P) `docs/modules/3-5-requirements-interview.md`: ペルソナ面接、十分性の判定（`missing` の検査）、ラウンド上限、固定の章立ての要件定義書、状態をセッションに置く理由を書く
  _Boundary:_ `docs/modules/3-5-requirements-interview.md`
  _Depends:_ 36.1, 39.2
  _Requirements:_ 5.1, 5.2, 5.3, 5.4, 5.5, 5.6
  _Traces:_ REQ-005, C16
- [ ] 40.6 (P) `docs/modules/3-6-marketing-support.md`: ラウンドロビンの合議、合意の判定（モデルの宣言とコードの検査）、プロファイルのマージ、カタログ照合を書き、**単一エージェントとのトークン使用量の比較（39.1 の実測または「未実行」）を記録する**（憲章 原則 1 の⚠ 1）
  _Boundary:_ `docs/modules/3-6-marketing-support.md`
  _Depends:_ 36.1, 39.1
  _Requirements:_ 6.1, 6.2, 6.4, 6.5
  _Traces:_ REQ-006, C16
- [ ] 40.7 `docs/phases/phase-3.md` と `docs/modules/index.md`: Phase 3 の成熟度の水準（IBM の Level 2〜3）とモジュール一覧、3-1〜3-6 を「提供済み」にし、解説とタグへのリンクを足す
  _Boundary:_ `docs/phases/phase-3.md`, `docs/modules/index.md`
  _Depends:_ 40.1, 40.2, 40.3, 40.4, 40.5, 40.6
  _Requirements:_ 1.1, 2.1, 3.1, 4.1, 5.1, 6.1
  _Traces:_ REQ-001, REQ-002, REQ-003, REQ-004, REQ-005, REQ-006, C16
- [ ] 40.8 `scripts/check-docs.mjs` の `REQUIRED_TOPICS` に `3-1`〜`3-6` を足す + `check-docs.test.mjs` に、新しい必須トピックが欠けたときに失敗すること、習熟度チェックリストのテスト名が実在することを先に足す。`005-hub-alignment` の解説リンクの検査が入っていれば、3-1〜3-6 にも適用されることを確認する
  _Boundary:_ `scripts/check-docs.mjs`, `scripts/check-docs.test.mjs`
  _Depends:_ 40.7
  _Requirements:_ 1.1, 2.1, 3.1, 4.1, 5.1, 6.1
  _Traces:_ REQ-001, REQ-002, REQ-003, REQ-004, REQ-005, REQ-006, C16
  _Verify:_ `mise run docs:check` が成功する。`mise run gate` が成功する

### Implementation Notes

---

## 41. トレーサビリティ・ステアリング・状態の更新

受け入れ基準 → テストの対応、決定の反映、プロジェクトの状態を更新する。

_Boundary:_ `specs/003-domain-agents/traceability.md`, `.sdd/steering/tech.md`, `.sdd/steering/structure.md`, `AGENTS.md`, `specs/curriculum/changes-from-drafts.md`
_Depends:_ 40.8
_Requirements:_ 1.1, 3.8, 6.6
_Traces:_ REQ-001, REQ-003, REQ-006, C16

- [ ] 41.1 `specs/003-domain-agents/traceability.md`: Test の列を、受け入れ基準ごとにテストのファイル名（`*.local.test.ts` と `*.container.test.ts` はスキップされうることを併記）で埋め、「gate が保証しないもの」（E2B の実機、GitHub の MCP の注釈、実 Docker、実モデルの品質、arXiv の実応答、複数インスタンス、認証）を Gaps に明記する。Commit の列は `/sdd-ship` が埋める
  _Boundary:_ `specs/003-domain-agents/traceability.md`
  _Depends:_ 40.8
  _Requirements:_ 1.1, 3.8
  _Traces:_ REQ-001, REQ-003, C16
- [ ] 41.2 `.sdd/steering/tech.md` と `structure.md`: サンドボックス（E2B と Docker の選択）、MCP の決定（注釈からリスクを決める、許可リスト）、arXiv の利用規約、`*.container.test.ts`、新しい規則 `mcp-import-scope`・`sandbox-import-scope`、`ai-core` の新しい領域 8 つ、`apps/web` の新しいルートと `lib/server/` の追加を反映する
  _Boundary:_ `.sdd/steering/tech.md`, `.sdd/steering/structure.md`
  _Depends:_ 41.1
  _Requirements:_ 3.8
  _Traces:_ REQ-003, C16
- [ ] 41.3 `AGENTS.md`: プロジェクトの状態（M3 の実装済みの範囲、`*.container.test.ts`、新しい規則、`workspace/`、`mise run sandbox:build` / `test:container` / `seed:samples`、`gate` の新しい検査数）を更新する。更新後、旧い件数や名前（規則の数 11 など）を grep して残っていないことを確認する
  _Boundary:_ `AGENTS.md`
  _Depends:_ 41.2
  _Requirements:_ 1.1
  _Traces:_ REQ-001, C16
- [ ] 41.4 `specs/curriculum/changes-from-drafts.md`: M3 で実測により確定した API・設定の差分（`dockerode` を採らないこと、MCP の注釈の扱い、`@ai-sdk/mcp` を 2.0.76 に固定した理由、Python 側の版など）を追記する。`specs/curriculum/` の本文が spec と食い違う箇所があれば、spec を正としてカリキュラム側を直す
  _Boundary:_ `specs/curriculum/changes-from-drafts.md`
  _Depends:_ 41.3
  _Requirements:_ 3.8
  _Traces:_ REQ-003, C16

### Implementation Notes

---

## 42. 最終統合

_Boundary:_ `stryker.config.mjs`, `specs/003-domain-agents/research.md`
_Depends:_ 41.4
_Requirements:_ 1.4, 1.5, 3.9, 6.5
_Traces:_ REQ-001, REQ-003, REQ-006, C16

- [ ] 42.1 `mise run gate:repeat`（10 回、同じ判定）、`mise run test:mutation`、`mise run test:e2e`（3 エンジン）、`mise run audit`、`mise run secret-scan` を実行し、結果を research.md に引用する。失敗が M3 以前から存在する場合は、新しい失敗と分けて報告する
  _Boundary:_ `specs/003-domain-agents/research.md`
  _Depends:_ 41.4
  _Requirements:_ 1.5, 3.9
  _Traces:_ REQ-001, REQ-003, C16
  _Verify:_ 各コマンドの成功が research.md に引用されている。`gate:repeat` が 10 回とも同じ判定（成功）である
- [ ] 42.2 `stryker.config.mjs` の最終確認: plan のミューテーション対象（`resolveWorkspacePath`、`riskFromAnnotations`、`checkDescription`、`validatePlan`、`diffPlan`、`nextRunnable`、`parseSandboxOutput`、`checkUpload`、`checkCitations`、`createBudget`、`judgeAgreement`、`recommend` の照合）がすべて含まれていることを確かめ、足りないものを足す
  _Boundary:_ `stryker.config.mjs`
  _Depends:_ 42.1
  _Requirements:_ 1.4, 1.5, 3.9, 6.5
  _Traces:_ REQ-001, REQ-003, REQ-006, C16
  _Verify:_ `mise run test:mutation` が閾値 70 を満たす
- [ ] 42.3 完成タグ `module/3-1`〜`module/3-6` をローカルに付ける（push は人が行う）。すべてのサブタスクが `[x]` で、`mise run gate` と CI の `ci-status` が成功していることを確認してから付ける
  _Boundary:_ `specs/003-domain-agents/research.md`
  _Depends:_ 42.2
  _Requirements:_ 1.1
  _Traces:_ REQ-001, C16
  _Verify:_ `git tag -l 'module/3-*'` に 6 件が並ぶ。W8 の敵対的レビューの記録が `.sdd/reviews/003-domain-agents-impl-w8-review-*.md` にある

### Implementation Notes
