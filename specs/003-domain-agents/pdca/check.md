# Check Phase — domain-agents（Milestone 3）

PDCA Check: 計画（plan.md、tasks.md）と結果（do.md、レビュー、gate）の比較。`/sdd-reflect`（2026-10-29）が生成した。

## Expectations vs. Results

| 期待（plan / tasks） | 結果（do / 記録） | 状態 |
|---|---|---|
| W1〜W8 の全サブタスクが完了し、gate が決定的に緑 | 38.2 を除き `[x]`。`gate:repeat` 10/10 同一判定（修正前。その後は docs とテストコメントのみ変更） | ✅ |
| `mise run gate` が 5 分以内 | 強制実行（キャッシュなし）で 70〜83 秒（W6〜W8 の ship 時） | ✅ |
| ミューテーションスコア 70 以上 | 86.19（W8 の全体実行。約 100 分、マシン負荷の影響が大きい） | ✅ |
| E2E 3 エンジンで skipped 0 | 735 passed、skipped 0、3.0 分。負荷 25〜31 の間は 4 回連続で緑にならず、負荷が約 3 に下がってから 1 回で緑 | ⚠️ |
| `test:container` / `test:db` | `test:container` 17 passed。`test:db` は W6 ship で実行し、既存ケースの失敗を 1 件検出して修正 | ✅ |
| `audit` / `secret-scan` | `qs` の override を `^6.16.1` に上げて `audit` が通る。`secret-scan` は clean | ✅ |
| 修正ループの能力テスト（38.2） | 常にスキップされる状態。人が M4 へ送ると決定し `[ ]` のまま | ❌（決定済みの持ち越し） |
| E2B 実機、GitHub MCP 実キー、Cohere、arXiv の一部の実応答 | 未実測（キーなし）。traceability と解説の「確認できていないこと」に明記 | ❌（環境の制約。未実測と明記済み） |
| 完成タグ `module/3-1`〜`3-6` | ローカルに付与済み（HEAD `ddfb7ee` で 42.3 を完了）。push の有無は今回確認していない | ⚠️ |

## Test & Quality Outcomes

- Tests（`TURBO_FORCE=true mise run gate`、exit 0）: root 427、`@platform/ai-core` 3,681 passed・skipped 4、`web` 1,660、`@platform/eval-suite` 40 passed・skipped 12（`local` / 実環境のテスト。合格には数えない）。
- Docs: `docs:check` 14 documents / 247 references。リポジトリ規則 13 本が gate で有効（`mcp-import-scope`、`sandbox-import-scope` を追加）。
- 敵対的レビュー: W1〜W8 の 9 ラウンド（W6 は 2 回）。W8 は HIGH 3、MEDIUM 7、LOW 12。各ラウンドが `REQUEST_CHANGES` で、指摘は修正またはレビュー記録での対応を済ませている。W3 以降の多くで、修正後の fresh な再レビューは未実施。
- PROVE（変異スタブ）: 各タスクで 6〜58 本、波全体で約 400〜700 本を殺した。

## Requirements Coverage

- spec.md の Requirement 1〜6 は、すべて 1 つ以上のサブタスクとテストまたは解説（D）に対応している（traceability.md）。
- Gaps（traceability.md の「Gaps」に記録済み）:
  - 実機でしか確認できないもの: E2B のサンドボックス起動と外向き通信の既定（S-4、CL-21）、GitHub MCP の実キー、arXiv の複数件・0 件の正常系と HTTP 400。
  - 共有予算がハードな上限ではない（plan C9 を「ソフトな上限」に改訂、人が決定）。
  - 38.2 は M4 へ。

## Deviations from Design

- スパイク S-1 の結果、plan 自身の代替案を採った（research.md に記録）。
- 境界外の変更を 13 件記録し、いずれも人が承認した（例: (12) W6、(13) W7 の module copies と client bundle）。plan C2・C9・C13・C14・C16 を同期した。
- plan C9: 共有予算を「合計が `maxTotalTokens` 以内」から「ソフトな上限」へ。ADR-6 はアイドル時間 × 3。
- `viewpoint` 列（plan の Data Model）を、タスク文面の `instructions` より優先した（26.2）。

## Issues Encountered

| Issue | Root cause | Resolution |
|---|---|---|
| 予算が 1 呼び出しの単位では守られても、全体では上限を超えた（W5 F-1、W6 の 330/100、W8 F-1） | 規則が 1 行ごとには破られず、スタブ単位のテストでは検出できなかった。全体の不変条件を主張するテストがなかった | 予約枠の追加、不変条件のテスト、最終的に人がソフトな上限と決定 |
| mock の Web アプリが FAQ を取り込まず、全問合せが escalate された（W7 F-1、HIGH） | W3 から 35.x へ回した持ち越しを、実施せず完了にした。実サーバー E2E が `T-` と `改訂 1` しか確認しなかった | `ensureMockFaq` と 409 の `details.reason`。終端状態を主張する検査を追加 |
| `/mcp` を先に描画すると `buildToolSet` が自分のツールを拒否した（W7） | モジュールのコピーごとに `definedTools` の WeakSet が分かれた | globalThis の保持体。`PlatformError` の brand と `latchOfToolSet` も同様に硬化 |
| `check:client-bundle` が失敗（W7） | クライアントのコンポーネントが `@platform/ai-core/config` を取り込み、環境スキーマの秘密名がブラウザのバンドルに入った | 上限を props にした。plan C14 に追記 |
| `does not apply a migration twice`: `expected 3 to be 2`（W6 ship） | 26.2 が `0003` を足したが件数の期待値を更新せず、PGlite では見えなかった | 修正。Docker 専用のレーンは、pg テストを書くタスクのチェック前に実行する |
| 「並列呼び出しが待ち行列になる」という誤った因果を 5 か所に記録（W8 F-2、HIGH） | 1 回の診断を実装と照らさずに記録した | 削除し、原因は未特定と書いた |
| 38.2 を完了にしたが、そのテストはどのレーンでも走らない（W8 F-3、HIGH） | ガード回避の一時的な実行で得た表を、リポジトリにない状態のまま完了と扱った | `[ ]` に戻し、M4 へ。解説を訂正 |
| E2E と mutation が長時間化・不安定化（W8） | 他プロセスによる負荷（load 25〜31）。失敗したテストは単独で通る | 負荷が下がってから再実行して 735 passed |
| ガードの回避が `sandbox-import-scope` と `rootDir` に拒否された（W8） | ローカルのレーンが Docker ソケットを塞ぐテストが既にある | 回避を外し、テストを常にスキップに。ガードは弱めない |

## Assessment

M3 は gate・mutation・E2E・container・audit・secret-scan の基準を満たして完了した。実装は計画どおりで、逸脱はすべて人の承認と plan の同期を経ている。

課題は 2 種類ある。(1) **全体の不変条件の欠落**: 実装中に数百本の変異スタブを殺しても、レビューは毎波、予算・状態・終端状態のような全体の欠陥を見つけた（W5、W6、W7、W8）。(2) **記録の正確さ**: 実測できていない条件を完了と書く、検証していない因果を事実として書く（W8 F-2、F-3）。人が行うことは、E2B 実機・GitHub 実キー・arXiv の残り・タグの push の確認である。
