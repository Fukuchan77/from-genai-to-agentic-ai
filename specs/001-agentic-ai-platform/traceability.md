# agentic-ai-platform（Milestone 1）— トレーサビリティ

`/sdd-tasks` が生成（骨格）し、`/sdd-analyze`（2026-09-27）の指摘を反映して更新した。2回目の `/sdd-analyze` の
H-1〜H-3、M-1〜M-4 と、3回目の H-1、M-1〜M-4、L-1〜L-3 も反映した。Test と Commit の列は
`/sdd-ship` が実装完了後に埋める。

ID 規約は `tasks.md` の「ID 対応表」を参照する（この spec の plan.md/spec.md は
`REQ-###`/`DES-#.#` の見出しを持たないため、`REQ-001`〜`REQ-007`・`NFR-01`〜`NFR-13` を
要件グループ／NFR単位の安定IDとして定義し、設計リンクには plan.md に実在する `C1`〜`C22` を
そのまま使う）。タスクは波ごとのファイル（`tasks.md`、`tasks-w2.md`〜`tasks-w5.md`、完了後は
`tasks-comp-w*.md`）に分かれているが、タスク番号は全ファイルで一意なので、番号だけで参照する。

- **Requirement**: spec.md の受け入れ基準番号（`X.Y`）または `NFR-##`
- **REQ-ID**: 上記の粗粒度な安定ID（要件グループ単位）
- **Design**: plan.md のコンポーネントID（`C1`〜`C22`）
- **Task**: タスクID（`T-#` は大タスク、`T-#.#` はサブタスク）
- **Test** / **Commit**: `/sdd-ship` が実装後に記入する

## Requirement 1: モノレポ基盤と品質ゲート

| Requirement | Design | Task | Test | Commit |
|---|---|---|---|---|
| 1.1 | C1, C13, C21 | T-1.2, T-7.1, T-8.1, T-8.2, T-8.3, T-19.1 | T-1.2: `mise run setup`、Turbo pnpm-workspace dry-run | T-1.2: `10c3b48`、修正（T-1.2）: `01dc364` |
| 1.2 | C1 | T-6.1, T-6.3 |  |  |
| 1.3 | C1 | T-1.1, T-1.2 | T-1.1: `mise tasks validate`（23件）、T-1.2: frozen install | T-1.1/T-1.2: `10c3b48`、修正（T-1.1/T-1.2）: `01dc364` |
| 1.4 | C1 | T-1.1, T-1.4, T-5.5, T-13.7, T-19.3, T-29.1 | T-1.1: 初期gate、T-1.4: Vitest/Stryker構造検査・`tsc` | T-1.1: `10c3b48`、T-1.4: `ee05b10`、修正（T-1.1/T-1.4）: `01dc364` |
| 1.5 | C1, C18 | T-4.1, T-29.2 | T-4.1: hermetic network guard 9件・API key不要のmock実行 | T-4.1: `2085577` |
| 1.6 | C1 | T-1.3 | unused-import 負例、`tsc --noEmit`、`mise run gate` | T-1.3: `10c3b48` |
| 1.7 | C2 | T-2.1, T-19.3, T-29.1 | T-2.1: CI構造検査、`ci-status` 成功/失敗シミュレーション | T-2.1: `f9e7aca`、修正（T-2.1）: `956b3df` |
| 1.8 | C3, C22 | T-3.1, T-3.2, T-28.5 | T-3.1: Compose構造34 assertion・6/6 healthy・Langfuse health/UI、T-3.2: 新規volumeでentrypoint自動実行・`vector`・カスタムDB・wiring PROVE | T-3.1/T-3.2: `dbf1300` |
| 1.9 | C4, C13 | T-12.2, T-12.4, T-20.2 |  |  |
| 1.10 | C2, C13, C14, C16, C20 | T-20.1, T-21.1, T-25.2, T-29.1 |  |  |
| 1.11 | C1 | T-1.1, T-29.2 | T-1.1: offline lint-only gate（Docker/API key 不要） | T-1.1: `10c3b48` |
| 1.12 | C1, C18 | T-1.4, T-4.3 | T-1.4: test suffix include/exclude構成検査、T-4.3: 実行/skip理由/DB未実行件数7件 | T-1.4: `ee05b10`、修正（T-1.4）: `01dc364`、T-4.3: `2085577` |
| 1.13 | C6, C18, C21 | T-4.2, T-7.2, T-7.3, T-11.1, T-11.2, T-14.5, T-19.1, T-19.2 | T-4.2: local availability一時単体5件・globalSetup統合1件 | T-4.2: `2085577` |
| 1.14 | C18, C21 | T-4.2, T-4.3, T-7.2, T-11.2, T-14.5, T-19.2, T-29.2 | T-4.2: 理由付きavailability、T-4.3: skip理由集計・全件skipのgate/local統合probe | T-4.2/T-4.3: `2085577` |
| 1.15 | C1, C18, C19, C20 | T-1.4, T-4.3, T-5.2, T-5.4, T-5.5, T-13.7, T-19.3, T-25.3, T-29.1 | T-1.4: `passWithNoTests: false`・reporter登録、T-4.3: gate実行0件のexit 1 | T-1.4: `ee05b10`、修正（T-1.4）: `01dc364`、T-4.3: `2085577` |
| 1.16 | C1, C2, C18 | T-1.4, T-4.3, T-19.3, T-29.3 | T-1.4: Stryker対象・runner・閾値の構造検査、T-4.3: 集計/空実行/DB件数のPROVE 5種 | T-1.4: `ee05b10`、T-4.3: `2085577` |
| 1.17 | C2, C19 | T-25.1, T-25.3, T-26.1, T-26.2, T-27.1, T-27.2, T-29.1 |  |  |
| 1.18 | C1, C2 | T-1.5, T-2.1, T-29.3 | T-1.5: staged dummy secret rejection（redact）、T-2.1: `fetch-depth: 0`・`mise run secret-scan` | T-1.5: `d9cec30`、T-2.1: `f9e7aca` |
| 1.19 | C19 | T-26.3, T-27.3 |  |  |

## Requirement 2: LLM プロバイダと実行モード

| Requirement | Design | Task | Test | Commit |
|---|---|---|---|---|
| 2.1 | C4, C6 | T-12.1, T-14.1, T-14.4 |  |  |
| 2.2 | C5, C6 | T-9.2, T-14.1 |  |  |
| 2.3 | C6 | T-14.2, T-14.5 |  |  |
| 2.4 | C7 | T-13.1, T-13.2 |  |  |
| 2.5 | C4, C18 | T-4.1, T-12.3 | T-4.1: mock既定でfetch/net/dnsを遮断 | T-4.1: `2085577` |
| 2.6 | C6 | T-14.1 |  |  |
| 2.7 | C6 | T-14.2 |  |  |
| 2.8 | C4, C5 | T-9.2, T-12.1 |  |  |
| 2.9 | C6 | T-14.3 |  |  |
| 2.10 | C5, C6, C20, C22 | T-5.3, T-9.2, T-14.3, T-28.5 |  |  |
| 2.11 | C18 | T-4.1 | T-4.1: fetch/net/dns/Resolver遮断・接続先error・local限定例外9件 | T-4.1: `2085577` |
| 2.12 | C4 | T-12.3 |  |  |
| 2.13 | C4, C6, C7, C13 | T-12.4, T-13.4, T-14.3, T-20.1 |  |  |
| 2.14 | C7 | T-13.3 |  |  |
| 2.15 | C7, C10 | T-10.2, T-10.3, T-10.4, T-13.6 |  |  |
| 2.16 | C7, C22 | T-13.5, T-28.7 |  |  |
| 2.17 | C5 | T-9.1, T-9.2 |  |  |
| 2.18 | C1, C4, C5, C20 | T-1.5, T-5.1, T-9.2, T-12.4 | T-1.5: pre-commit順序・T-5.1自動有効化 | T-1.5: `d9cec30` |

## Requirement 3: ストリーミングチャット

| Requirement | Design | Task | Test | Commit |
|---|---|---|---|---|
| 3.1 | C15 | T-22.1, T-22.2 |  |  |
| 3.2 | C6, C15 | T-14.3, T-22.3 |  |  |
| 3.3 | C11, C15, C19 | T-17.2, T-22.1, T-27.2 |  |  |
| 3.4 | C15 | T-22.2 |  |  |
| 3.5 | C15 | T-22.1, T-22.2 |  |  |
| 3.6 | C15 | T-22.1, T-22.4 |  |  |
| 3.7 | C11, C15 | T-17.3, T-22.4 |  |  |
| 3.8 | C13, C15 | T-20.1, T-20.3, T-22.1 |  |  |
| 3.9 | C6, C15 | T-14.3, T-22.1, T-22.3 |  |  |
| 3.10 | C11, C15 | T-17.1, T-17.3, T-22.3 |  |  |
| 3.11 | C14, C15 | T-21.1, T-21.2, T-22.1 |  |  |

## Requirement 4: 構造化出力と要約パイプライン

| Requirement | Design | Task | Test | Commit |
|---|---|---|---|---|
| 4.1 | C12 | T-18.1, T-18.2 |  |  |
| 4.2 | C12 | T-18.2 |  |  |
| 4.3 | C12 | T-18.1, T-18.6 |  |  |
| 4.4 | C12 | T-18.5 |  |  |
| 4.5 | C12, C17 | T-18.6, T-24.2 |  |  |
| 4.6 | C12 | T-18.3 |  |  |
| 4.7 | C12, C17 | T-18.2, T-24.1 |  |  |
| 4.8 | C12, C17 | T-18.4, T-18.6, T-24.3 |  |  |
| 4.9 | C12 | T-18.2 |  |  |
| 4.10 | C12, C17 | T-18.1, T-18.6, T-24.3 |  |  |
| 4.11 | C12, C17 | T-18.2, T-24.1, T-24.3 |  |  |
| 4.12 | C12, C17 | T-18.3, T-18.6, T-24.3 |  |  |

## Requirement 5: ツール呼び出しと ToolLoopAgent

| Requirement | Design | Task | Test | Commit |
|---|---|---|---|---|
| 5.1 | C8, C16 | T-16.3, T-16.4, T-23.1, T-23.2 |  |  |
| 5.2 | C9 | T-15.3, T-15.4, T-15.5 |  |  |
| 5.3 | C9 | T-15.4 |  |  |
| 5.4 | C9, C16 | T-15.2, T-23.1, T-23.4 |  |  |
| 5.5 | C16 | T-23.2, T-23.3 |  |  |
| 5.6 | C8, C11, C16 | T-16.3, T-17.3, T-23.4 |  |  |
| 5.7 | C9, C10 | T-10.1, T-15.3 |  |  |
| 5.8 | C9 | T-15.1 |  |  |

## Requirement 6: ループ制御と強制停止条件

| Requirement | Design | Task | Test | Commit |
|---|---|---|---|---|
| 6.1 | C4, C8, C22 | T-12.1, T-16.1, T-16.3, T-28.6 |  |  |
| 6.2 | C8, C16 | T-16.2, T-16.3, T-23.1, T-23.4 |  |  |
| 6.3 | C8, C15, C16 | T-16.3, T-22.1, T-23.1, T-23.4 |  |  |
| 6.4 | C4, C9, C13, C16 | T-15.1, T-15.2, T-20.1, T-23.1 |  |  |
| 6.5 | C8 | T-16.3 |  |  |

## Requirement 7: モジュール解説ドキュメント

| Requirement | Design | Task | Test | Commit |
|---|---|---|---|---|
| 7.1 | C22 | T-28.3 |  |  |
| 7.2 | C22 | T-28.2, T-28.4, T-28.5, T-28.6, T-28.7 |  |  |
| 7.3 | C22 | T-28.2, T-28.4, T-28.5, T-28.6, T-28.7 |  |  |
| 7.4 | C22 | T-28.2, T-28.4, T-28.5, T-28.6, T-28.7 |  |  |
| 7.5 | C22 | T-28.2, T-28.4, T-28.5, T-28.6, T-28.7 |  |  |
| 7.6 | C22 | T-28.1, T-28.5, T-28.6, T-28.7 |  |  |
| 7.7 | C22 | T-28.3 |  |  |
| 7.8 | C22 | T-28.4 |  |  |
| 7.9 | C22 | T-28.1, T-28.2, T-28.4, T-28.5, T-28.6, T-28.7 |  |  |
| 7.10 | C22 | T-28.2, T-28.4, T-28.5, T-28.6, T-28.7 |  |  |
| 7.11 | C22 | T-14.6, T-23.5, T-24.4, T-28.2, T-29.4 |  |  |

## Non-Functional Requirements

本 spec の NFR は spec 001〜004 すべてに適用する横断要件。M1（本 spec）のタスクが担う部分のみ
Task 列に記載する。

| Requirement | Design | Task | Test | Commit |
|---|---|---|---|---|
| NFR-01（検証速度） | C1 | T-29.2 |  |  |
| NFR-02（決定性） | C1, C7 | T-13.1, T-13.2, T-29.2 |  |  |
| NFR-03（オフライン動作） | C7, C18 | T-4.1, T-13.6, T-29.2 | T-4.1: mock hermetic network guard 9件 | T-4.1: `2085577` |
| NFR-04（ストリーミング応答性） | C19 | T-26.3, T-27.4 |  |  |
| NFR-05（型安全性） | C1 | T-1.3, T-6.3 | T-1.3: TypeScript 7.1 strict root typecheck | T-1.3: `10c3b48`、修正（T-1.3）: `01dc364` |
| NFR-06（テストカバレッジ） | C18 | T-6.2 |  |  |
| NFR-07（秘密情報） | C1, C4 | T-1.5, T-12.1, T-12.4 | T-1.5: names-only env・gitleaks redact | T-1.5: `d9cec30`、修正（T-1.5）: `01dc364` |
| NFR-08（隔離実行） | — | **未割当（下記 Gaps 参照）** |  |  |
| NFR-09（アクセシビリティ） | C13, C19 | T-8.3, T-20.4, T-26.3, T-27.3 |  |  |
| NFR-10（対応ブラウザ） | C19 | T-26.1, T-27.1, T-27.2 |  |  |
| NFR-11（サプライチェーン） | C1, C2 | T-1.2, T-1.5, T-2.1, T-2.2 | T-1.2: frozen lockfile、T-1.5: staged secret hook、T-2.1: SHA/permissions/frozen setup、T-2.2: Dependabot構造検査 | T-1.2: `10c3b48`、T-1.5: `d9cec30`、修正（T-1.2）: `01dc364`, `9418a09`、T-2.1/T-2.2: `f9e7aca`、修正（T-2.1）: `956b3df` |
| NFR-12（UI言語） | C13, C22 | T-20.3, T-28.2 |  |  |
| NFR-13（コスト可視化） | C5 | T-9.2 |  |  |

## Gaps

- 2026-09-27 の `/sdd-ship`（T-4.1〜T-4.3）では、新しい要件・設計ギャップは検出しなかった。hermetic network guard、local availability、gate reporterを20件のship検証（恒久16件 + T-4.2一時4件）と行カバレッジ93.56%で確認した。T-4.2の恒久的な受け取り側skipテストとOllama停止時統合確認は、承認済みタスクどおりT-11.2/T-29.2へ引き継ぐ。
- 2026-09-27 の `/sdd-ship`（T-3.1〜T-3.2）では、新しい要件・設計ギャップは検出しなかった。Composeは6サービスのhealthy状態とLangfuse UI/health、Postgresは新規volumeからのinit SQL自動実行・`vector`・カスタムLangfuse DBを実測した。Rancher Desktopの`/Users/Shared` mount手順は端末ローカルのGit除外memoryにのみ保存した。
- 2026-09-27 の `/sdd-ship`（T-2.1〜T-2.2）では、新しい要件・設計ギャップは検出しなかった。PR の `ci-status` と GitHub Insights の Dependabot 設定確認は、設定を push した後のホスト側検証として残る。
- 2026-09-27 の `/sdd-ship`（T-1.1〜T-1.3）では、新しい要件・設計ギャップは検出しなかった。`pnpm-lock.yaml` は T-1.2 の frozen install を成立させる派生成物として追跡する（2026-09-27 の `/sdd-validate-impl` で境界外と判定し、T-1・T-1.2 の `_Boundary:_` と plan のルートの表に加えた）。
- 2026-09-27 の `/sdd-ship`（T-1.4〜T-1.5）でも新しい要件・設計ギャップは検出しなかった。Vitest hook と mutation の実行検証は、承認済みタスクどおり T-4.1/T-4.3/T-29.3 へ引き継ぐ。
- **NFR-08（隔離実行）は M1 に意図的な未割当**: plan.md の Requirements Traceability が明記する
  とおり「M1には該当する機能がない（003、004で適用）」。M1 には LLM 生成コードを実行する機能
  （データ分析、長時間実行ハーネス）が存在しないため、対応するタスクを割り当てていない。003
  （データ分析エージェント）と 004（長時間実行ハーネス）の tasks.md がこの NFR を引き継ぐ。
- 受け入れ基準（1.1〜7.11、計84件）は全件サブタスクに割り当て済み（100%）。大タスクだけに割り当てた
  受け入れ基準はない（2026-09-27 の `/sdd-analyze` M-4 で 3.3 と 5.6 をサブタスクへ割り当てた）。
- タスク側に対応する要件のないタスク（orphan task）はなし。全タスクの `_Requirements:_` は
  spec.md の受け入れ基準または本ファイルの NFR-## のいずれかに対応する。
- 2026-09-27 の再構成で削除・統合したタスク番号: T-3.3（`.env.example` の編集は T-1.5 に集約）、
  T-9.3（T-9.2 にテストを統合）。T-14.1〜T-14.5 と T-16.3・T-16.4 は内容を組み替えた（テスト先行のため）。
  新設: T-5.5、T-13.7、T-19.3（各波の gate の結線）、T-14.5（`catalog.local.test.ts`）、T-29.4（完成タグ）。
- 2回目の `/sdd-analyze`（2026-09-27）での変更: T-14.6・T-23.5・T-24.4（各モジュールの完了時点の完成タグ）を
  新設し、T-29.4 をタグの検証と push に改めた（H-2）。CI のジョブを波ごとに加えるため、T-2.1 から 1.10・1.16 を
  外し、`mutation` を T-19.3、`e2e`・`client-bundle` を T-29.1 に移した（H-1）。tasks.md の「完了した波の移行手順」に `.sdd/reviews/` の波ごとの
  敵対的レビューを移行条件に加えた（H-3。要件ではなく constitution 原則 9 の手続きのため、本表の行はない）。
- 3回目の `/sdd-analyze`（2026-09-27）での変更: テストの実行単位をワークスペースごとに固定し、ルートの
  `vitest.config.ts` は `tooling/`・`scripts/` だけを対象にした（H-1。T-1.2、T-1.4、T-6.2、T-7.2、T-8.3）。
  ai-core の `test` スクリプトを T-6.3 で加える（M-4）。`count-tsc` の手段を実測で確定する（M-2。T-5.4）。
  `createGuardedAgent` の `tools` を `buildToolSet` の戻り値 `GuardedToolSet` に限った（M-3。T-15.1、T-15.2、
  T-16.3。constitution 原則 6 の手続きのため、本表の行は変えていない）。T-8.1 に `babel-plugin-react-compiler`
  と `jsdom` を加えた（M-1）。NFR-10・NFR-12 の割り当てを大タスクからサブタスクに改めた（L-2）。
- 2026-09-27 の `/sdd-validate-impl`（Task 2）: PR #2 の `ci-status` が `a00f581` で成功し、Dependabot の設定検証チェックも成功した（T-2.1・T-2.2 のホスト側検証を充足。Insights での確認は main へのマージ後）。T-2.1 の `audit` を通すための `qs` の override（`9418a09`）は T-1.2 の境界内の修正として追跡する。`ci.yml` に `persist-credentials: false`、ジョブごとの `timeout-minutes`、PR の古い実行を取り消す `concurrency` を加えた。
- 2026-09-27 の `/sdd-validate-impl`（Task 1）: Vitest の CLI フィルタが `exclude` を戻せないため `test:local`・`test:db` が対象を実行できない欠陥と、Turborepo の strict env モードで `OLLAMA_BASE_URL` がテストに渡らない欠陥を検出した。`AI_TEST_SUITE` によるテストの選択（plan C18）と `turbo.json` の `env` で解消した。影響するタスクの記述（T-4.3、T-5.5、T-6.2、T-7.2、T-8.3）も更新した。
- 2026-09-27 の `/sdd-validate-impl`（Task 1 の再検証）: `turbo.json` に `test:coverage` がなく `mise run test:coverage` が失敗する欠陥を検出し、T-1 の境界内で追加した。各ワークスペースの `test:coverage` スクリプトは、`test` スクリプトと同時に T-6.3（ai-core）・T-19.1（eval-suite）・T-21.1（apps/web）が加える（同日の検証の W-2 で割り当てた。各タスクの `_Boundary:_` は対象の `package.json` を含むため変更なし）。
