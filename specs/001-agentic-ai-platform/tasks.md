# agentic-ai-platform（Milestone 1）— 実装タスク（索引と現在の波）

`/sdd-tasks` が生成し、`/sdd-analyze`（2026-09-27）の指摘を反映して、実装の波（W1〜W5）ごとに分割した。
2回目の `/sdd-analyze`（2026-09-27）の H-1〜H-3、M-1〜M-4 と、3回目の H-1、M-1〜M-4、L-1〜L-3 も反映した。
ルールは `~/.claude/sdd/rules/tasks-generation.md` と `~/.claude/sdd/rules/tasks-parallel-analysis.md` に従う。
並列モード（`--sequential` 未指定）。

## ファイル構成

| ファイル | 内容 |
|---|---|
| `tasks.md`（本ファイル） | 表記規約、ID 対応表、進捗、gate と CI の段階的な結線、**現在の波**のタスク全文 |
| `tasks-w4.md`〜`tasks-w5.md` | 未着手の波のタスク全文。その波に着手するときに本ファイルへ移す |
| `tasks-comp-w1.md`〜`tasks-comp-w5.md` | 完了した波の保管先。波の完了時に作る（現在は `tasks-comp-w1.md`・`tasks-comp-w2.md`） |
| `traceability.md` | 要件 → 設計 → タスク → テスト → コミット |

タスク番号は全ファイルで一意で、移動しても変えない。`_Depends:_` と `traceability.md` は、ファイルをまたいで
番号だけで参照する。

### 完了した波の移行手順

1. 移行の条件: その波の全サブタスクが `[x]`、各大タスクの Implementation Notes が記入済み、波の締めのタスク
   （下記「gate と CI の段階的な結線」）が完了し、`mise run gate` と CI の `ci-status` が成功している。加えて、
   その波の敵対的レビューの記録が `.sdd/reviews/` にある（下記「波ごとの敵対的レビュー」）。
2. 1つ目のコミット（例: `docs(tasks): archive wave N`）では、`git mv tasks.md tasks-comp-wN.md` だけを行い、
   本文を変えない。
3. 2つ目のコミット（例: `docs(tasks): promote wave N+1`）では、`git mv tasks-w(N+1).md tasks.md` の後、索引の節
   （本ファイルの「現在の波」より前）を `tasks-comp-wN.md` から `tasks.md` の先頭へ移す。`tasks-comp-wN.md` には
   「現在の波」の本文だけを、本文を変えずに残す。
4. 同じコミットで、下記「進捗」の状態とファイルの列を更新する。
5. 2つのコミットは波の締めの後に続けて行い、同じ PR に含める。並列作業の途中では移行しない。2つに分けるのは、
   Git がリネームを記録せず、削除されたパスだけを内容の類似度で追跡するためである。1つのコミットでは
   `tasks.md` が前後に存在するため、完了した波の履歴を `tasks-comp-wN.md` から `git log --follow` で追えなくなる
   （2026-09-27、W1 の移行で改訂）。

完了分は波ごとに1ファイルに分かれるため、保管先のファイルは最大でも約300行に収まる。

### 波ごとの敵対的レビュー（constitution 原則 9）

原則 9 の「各実装フェーズの完了後に、新規コンテキストで敵対的レビューを1回行う」の「実装フェーズ」は、
本 spec では**実装の波（W1〜W5）**を指す。マイルストーン単位の1回だけでは、W1 の基盤の誤りが W2〜W5 に
継承されるため、波ごとに行う。

- 時点: 波の締めのタスクが完了し、`mise run gate` が成功した後、移行のコミットより前。
- 実施者: その波の実装に関わっていない新規コンテキスト（`sdd-reviewer` サブエージェント、`adversarial-review` skill）。
- 対象: その波で追加・変更したコード、テスト、設定、`tasks.md` の Implementation Notes。
- 記録: `.sdd/reviews/001-agentic-ai-platform-impl-wN-review-YYYY-MM-DD.md`（1ラウンド1ファイル。過去の
  ラウンドを上書きしない）。指摘への対応が完了したことをその記録に追記してから、移行する。

## 表記規約

- `- [ ]` 未着手、`- [x]` 完了、`- [ ]*` 任意・後回し可のテスト。
- `(P)` = 並列実行可（依存なし・境界の重複なし）。大タスクの見出しに付けた `(P)` は、その大タスクが同じ波の
  他の大タスクと並列に進められることを示す。
- 各タスク（大タスク・サブタスクの両方）は `_Boundary:_` と `_Depends:_` を必ず持つ。
- **テスト先行（constitution 原則 4）**: 実装を含むサブタスクは、対応するテストファイルを同じ `_Boundary:_` に
  含み、RED（失敗の確認）→ GREEN → REFACTOR を1つのサブタスクの中で行う。設定ファイル・生成物・公開 API の
  集約など、単独のテストを持たないサブタスクは、検証手段を `_Verify:_` に書く。
- `_Requirements:_` は spec.md の受け入れ基準番号（例: `1.1`）をカンマ区切りの数値のみで列挙する。
  NFR（数値番号を持たない）は `NFR-01`〜`NFR-13`（下記の対応表）で同じ書式に揃えて記載する。
- `_Traces:_` は安定リンクIDを持つ。この spec は `spec.md`/`plan.md` に `REQ-###`/`DES-#.#` 形式の
  見出しを持たないため、以下の対応表で実在する見出しに固定する。
- 各大タスクの末尾の `### Implementation Notes` は生成時は空。大タスクの完了後に、実装者が学びを1〜3項目
  追記する。
- 共有ファイルの編集者を1つに絞る: `.env.example`（1.5 が全変数を一度に作る）、`packages/ai-core/package.json`
  （6.1 が M1 の依存を一度に宣言する。`test`・`test:coverage` スクリプトだけは 6.3 が、`exports` の `./errors` だけは 21.1 が加える）、`apps/web/package.json`（8.1。`test`・`test:coverage` スクリプトだけは 21.1 が加える）、`packages/eval-suite/package.json`（7.1。`test`・`test:coverage` スクリプトだけは 19.1 が加える）、
  `mise.toml`（1.1 と各波の締めのタスクだけが編集する）、`.github/workflows/ci.yml`（2.1 と、ジョブを加える
  波の締めのタスク 19.3・29.1 だけが編集する）。

### ID 対応表

| ID | 対応する見出し |
|---|---|
| `REQ-001`〜`REQ-007` | spec.md の `### Requirement 1`〜`### Requirement 7`（要件グループ単位。AC単位の詳細は `_Requirements:_` を見る） |
| `NFR-01`〜`NFR-13` | spec.md `## Non-Functional Requirements` の箇条書き順（01検証速度、02決定性、03オフライン動作、04ストリーミング応答性、05型安全性、06テストカバレッジ、07秘密情報、08隔離実行、09アクセシビリティ、10対応ブラウザ、11サプライチェーン、12UI言語、13コスト可視化） |
| `C1`〜`C22` | plan.md の `#### C_N <名前>`（実在する見出し。`DES-#.#` の代わりにこの一次IDを使う） |

## 進捗

| 波 | 大タスク | 状態 | ファイル |
|---|---|---|---|
| W1 基盤 | 1 ツールチェーン、2 CI、3 ローカル依存サービス、4 テスト基盤、5 リポジトリ規約検査 | 完了（2026-09-27。敵対的レビュー2ラウンド） | [tasks-comp-w1.md](tasks-comp-w1.md) |
| W2 ai-core の土台 | 6 ai-core scaffold、7 eval-suite scaffold、8 apps/web scaffold、9 ModelCatalog、10 Ports、11 testing ヘルパ、12 PlatformConfig、13 MockRuntime | 完了（2026-09-30。敵対的レビュー3ラウンド、2026-10-04 の検証で追加の修正） | [tasks-comp-w2.md](tasks-comp-w2.md) |
| W3 ai-core の機能 | 14 ModelGateway、15 AciToolkit、16 GuardedAgent、17 ChatCore、18 SummaryPipeline、19 評価スイート | 着手（現在の波。14〜18 完了） | 本ファイル |
| W4 apps/web | 21 RequestGuard、20 AppShell、22 ChatFeature、23 ToolAgentFeature、24 SummaryFeature | 未着手 | [tasks-w4.md](tasks-w4.md) |
| W5 E2E・解説・最終統合 | 25 E2E 生成・検査スクリプト、26 E2E 基盤、27 E2E シナリオ、28 解説ドキュメント、29 最終統合と NFR 検証 | 未着手 | [tasks-w5.md](tasks-w5.md) |

波の順序は依存関係で決まる。W4 は 21 を 20 より先に行う（20.1 がレート制限器を組み立てるため）。

モジュールの完成タグ（Req 7.11、plan C22）は、そのモジュールのリファレンス実装が完了した波の中で付ける:
`module/1-1` は 14.6（W3）、`module/1-2` は 23.5（W4）、`module/1-3` は 24.4（W4）。29.4 は3つのタグの検証と
push だけを行う。

## gate と CI の段階的な結線

gate の各段は「走査0件で失敗」するため、検査対象がまだない段を最初から入れると、実装の途中で必ず失敗する
（plan C1「gate と CI の段階的な結線」、C20）。CI のジョブも同じで、対象（Stryker の変異対象、Playwright の設定、
クライアントバンドル検査のスクリプト）がないジョブを最初から入れると、`ci-status` が W5 まで失敗し続け、
PR のステータス（Req 1.7）が信号として機能しない。そこで波の締めのタスクが、対象が揃った段、
`check:repo-rules --only` の規則、CI のジョブ（と `ci-status` の `needs`）を加える。波の途中では、直前の波の
締めで確定した構成を使う。一度加えた段・規則・ジョブは外さない。

| 時点 | 締めのタスク | gate に加える段 | `check:repo-rules --only` に加える規則 | CI に加えるジョブ |
|---|---|---|---|---|
| 初期 | 1.1（CI は 2.1） | `lint`（`biome ci` のみ） | — | `gate`、`secret-scan`、`audit`、集約 `ci-status` |
| W1 の締め | 5.5 | `lint` への `count-biome` の付加、`check:model-ids`、`check:repo-rules`、`test`（`tooling/`・`scripts/` のテスト） | `no-dynamic-eval`、`actions-pinned`、`frozen-lockfile`、`allow-builds-reasoned` | — |
| W2 の締め | 13.7 | `typecheck`（`count-tsc` 付き。ルートの `//#typecheck` を含む） | `no-deprecated-object-api`、`guarded-agent-only`、`ai-core-no-ui-deps`、`no-sensitive-logging` | — |
| W3 の締め | 19.3 | — | `tool-risk-declared` | `mutation`（Stryker の変異対象がすべて W3 までにそろう） |
| W4 | （締めのタスクなし） | — | — | — |
| W5 の締め | 29.1 | `docs:check`。これで plan C1 の全段（`lint` → `check:model-ids` → `check:repo-rules` → `typecheck` → `test` → `docs:check`）と全9規則がそろう | — | `e2e`（3エンジン）、`client-bundle`。これで plan C2 の全ジョブがそろう |

各規則の走査対象と除外は plan C20 の規則表が正本である。

---

# 現在の波: W3 ai-core の機能（大タスク 14〜19）

14、15、16、18 は並列に進められる。ただし 16.3 は 15.2 の後に行う（`GuardedToolSet` を使うため）。17 は 16 の後、19 は 14〜18 の後に行う。14.6（`module/1-1` のタグ）は 14.5 の直後に付ける。

---

## 14. ModelGateway（C6）(P)

用途とモデルIDから、実行モードに応じた `LanguageModel`/`EmbeddingModel` を返す。返す前に認証情報・
接続・機能対応を検査する。各サブタスクは `gateway.test.ts` にテストを先に足してから実装する。

_Boundary:_ `packages/ai-core/src/models/providers.ts`, `packages/ai-core/src/models/ollama-preflight.ts`, `packages/ai-core/src/models/ollama-preflight.test.ts`, `packages/ai-core/src/models/gateway.ts`, `packages/ai-core/src/models/errors.ts`, `packages/ai-core/src/models/index.ts`, `packages/ai-core/src/models/gateway.test.ts`, `packages/ai-core/src/models/catalog.local.test.ts`
_Depends:_ 9, 11, 12, 13
_Requirements:_ 1.13, 1.14, 2.1, 2.2, 2.3, 2.6, 2.7, 2.9, 2.10, 2.13, 3.2, 3.9, 7.11
_Traces:_ REQ-001, REQ-002, REQ-003, REQ-007, C6, C22

- [x] 14.1 `models/errors.ts`・`providers.ts`・`gateway.ts`: エラー型（`ProviderCredentialsMissingError`・`OllamaUnavailableError`・`CapabilityUnsupportedError`）、プロバイダファクトリの対応表（anthropic/openai/azure/google/`ollama-ai-provider-v2`）、`createModelGateway` の `resolve` の骨格（`mock` はシナリオモデル、`live` は認証情報を検査してから生成）。解決するカタログの entry の `modes` に現在の実行モードが含まれることを検査し、含まれなければ拒否する（`AI_MODEL_*` で明示指定した ID も対象。C4 の `loadPlatformConfig` はカタログに実在するかだけを検査するため。2026-10-04、W2 `/sdd-validate-impl` の D9。エラーの型は実装時に決めて plan C6 に記録する）+ `gateway.test.ts`（モード別の解決、`ProviderCredentialsMissingError` のプロバイダ名と変数名、ネットワークなしで `mock` が動く、`local` で `live` 専用の ID を `AI_MODEL_CHAT` に指定すると拒否する）
  _Boundary:_ `packages/ai-core/src/models/errors.ts`, `packages/ai-core/src/models/providers.ts`, `packages/ai-core/src/models/gateway.ts`, `packages/ai-core/src/models/gateway.test.ts`
  _Depends:_ 9, 12, 13
  _Requirements:_ 2.1, 2.2, 2.6
  _Traces:_ REQ-002, C6
- [x] 14.2 `models/ollama-preflight.ts`: `GET {baseUrl}/api/tags` による接続とモデル取得済みの事前検査（短時間キャッシュ）+ `ollama-preflight.test.ts`、`gateway.ts` の `local` の解決 + `gateway.test.ts` に `OllamaUnavailableError`（接続先 URL と起動方法の案内）を追加
  _Boundary:_ `packages/ai-core/src/models/ollama-preflight.ts`, `packages/ai-core/src/models/ollama-preflight.test.ts`, `packages/ai-core/src/models/gateway.ts`, `packages/ai-core/src/models/gateway.test.ts`
  _Depends:_ 14.1
  _Requirements:_ 2.3, 2.7
  _Traces:_ REQ-002, C6
- [x] 14.3 `gateway.ts`: 機能への対応の検査（`CapabilityUnsupportedError`）、`resolveEmbedding`、`availableModels`（現在の実行モードを `modes` に含み、認証情報のそろったプロバイダのものだけ。D9）、録画時だけの `recordingMiddleware` の合成 + `gateway.test.ts` に各ケースを追加
  _Boundary:_ `packages/ai-core/src/models/gateway.ts`, `packages/ai-core/src/models/gateway.test.ts`
  _Depends:_ 14.2
  _Requirements:_ 2.9, 2.10, 2.13, 3.2, 3.9
  _Traces:_ REQ-002, REQ-003, C6
- [x] 14.4 `models/index.ts`: `./models` の公開API（クライアントへ渡すのは Zod を含まない型だけ）
  _Boundary:_ `packages/ai-core/src/models/index.ts`
  _Depends:_ 14.3
  _Requirements:_ 2.1
  _Traces:_ REQ-002, C6
  _Verify:_ 17・19・20 のテストが公開サブパス `@platform/ai-core/models` から import して通る
- [x] 14.5 `models/catalog.local.test.ts`: `local` 限定で、既定モデルが実際にツール呼び出しと構造化出力に応答することを確認する（`describeLocal`。Ollama がなければ理由付きでスキップ）
  _Boundary:_ `packages/ai-core/src/models/catalog.local.test.ts`
  _Depends:_ 14.4, 11
  _Requirements:_ 1.13, 1.14, 2.3
  _Traces:_ REQ-001, REQ-002, C6, C18
- [x] 14.6 完成タグ `module/1-1`: モジュール 1-1（Req 1、2 のリファレンス実装: モノレポ基盤、品質ゲート、実行モード、モデルカタログ、ゲートウェイ、モック）が完了した統合ブランチのコミットに、注釈付きタグをローカルで付ける（plan C22）。タグの push は 29.4 で人間の承認後に行う
  _Boundary:_ git タグのみ（ファイルの変更なし）
  _Depends:_ 1〜13, 14.1, 14.2, 14.3, 14.4, 14.5
  _Requirements:_ 7.11
  _Traces:_ REQ-007, C22
  _Verify:_ タグのコミットで `mise run gate`（その時点の構成）が成功する。タグのメッセージに、そのコミットに含まれる後続モジュールの途中の実装（並列に進めた 15〜18）を列挙する

### Implementation Notes

- D9 のモード検査は `ModelSelectionError`（`code: "invalid-request"`、`reason` は `unknown-model` / `mode-mismatch` / `no-default` / `purpose-mismatch`）で拒否する。`AI_MODEL_*` の ID も要求の `modelId` も、`resolve` の最初の検査で同じように扱う。検査の順序は、カタログと実行モード → 機能（2.9）→ 認証情報（2.6）→ Ollama の事前検査（2.7）とし、すべてモデル生成の前に行う。このため、`local` で `live` 専用の ID を指定しても Ollama へは接続しない。
- Ollama の事前検査は、成功した `/api/tags` の一覧だけを 5 秒キャッシュする。失敗はキャッシュしないので、`ollama serve` を起動すれば次の要求で回復する。同時に来た検査は1回の取得を共有し、タイムアウトは注入した `Clock` の `timeoutSignal(2000)` で付ける。`OLLAMA_BASE_URL` は末尾の `/api` の有無をどちらも受け付け、`ollama-ai-provider-v2` には `${server}/api` を渡す。
- 録画は `config.recording` が真のときだけ `wrapLanguageModel` で合成する（`recordedWith` は実行モード、時刻は `Clock` から取る）。既定の `Redactor` は `process.env` ではなく `config.credentials` から作る（C4 の「`process.env` を読むのは既定引数の1か所」を守るため）。埋め込みは録画の対象外とした（カセットの形式が LanguageModel 専用のため）。
- 14.6: 注釈付きタグ `module/1-1` を 14.5 の統合コミット `f671813` にローカルで付けた（メッセージは「module/1-1: reference implementation of module 1-1 (Req 1, 2)」に続けて、含むもの（タスク 1〜13、14.1〜14.5）、並列に進めた後続モジュールの途中の実装は W2 以外なし、含まないもの（C19 の E2E、C22 の解説）、29.4 で人間の承認後に push する旨）。作業環境は使い捨てのためタグは失われうる。29.4 は同じコミットと同じメッセージで作り直す。`f671813` を `main` に残すため、W3 の PR はマージコミットで取り込む（squash / rebase しない）。

---

## 15. AciToolkit とサンプルツール（C9）(P)

ツール定義の共通規約（リスク区分、タイムアウト、エラーのツール結果化、Clock 注入）と M1 の
サンプルツールを提供する。`TAVILY_API_KEY` は 1.5 の `.env.example` に含まれる。

_Boundary:_ `packages/ai-core/src/aci/types.ts`, `packages/ai-core/src/aci/define-tool.ts`, `packages/ai-core/src/aci/tool-set.ts`, `packages/ai-core/src/aci/tools/current-time.ts`, `packages/ai-core/src/aci/tools/calculator.ts`, `packages/ai-core/src/aci/tools/currency.ts`, `packages/ai-core/src/aci/tools/rates.json`, `packages/ai-core/src/aci/tools/weather.ts`, `packages/ai-core/src/aci/tools/web-search.ts`, `packages/ai-core/src/aci/index.ts`, `packages/ai-core/src/aci/define-tool.test.ts`, `packages/ai-core/src/aci/tool-set.test.ts`, `packages/ai-core/src/aci/tools/calculator.test.ts`, `packages/ai-core/src/aci/tools/tools.test.ts`
_Depends:_ 10, 12, 13
_Requirements:_ 5.2, 5.3, 5.4, 5.7, 5.8, 6.4
_Traces:_ REQ-005, REQ-006, C9

- [x] 15.1 (P) `aci/types.ts`・`define-tool.ts`: `ToolRisk`・`ToolOutcome`・`ToolFailure`・`ToolRuntime`（`clock`、`toolTimeoutMs`）・`GuardedToolSet`（`unique symbol` のブランド型。plan C9）・`defineAciTool`（`AciTool` を返す。AI SDK の `Tool` への変換は `ToolRuntime` を受け取って行い、実効のタイムアウトは `min(definition.timeoutMs ?? runtime.toolTimeoutMs, runtime.toolTimeoutMs)`、中断は `AbortSignal.any([options.abortSignal, runtime.clock.timeoutSignal(実効値)])` で合成する。例外とタイムアウトのツール結果化）+ テスト（fake Clock で、実効タイムアウトの選択（定義なし・定義が短い・定義が長い）、タイムアウトと例外のツール結果化、呼び出し元の中断の伝播）
  _Boundary:_ `packages/ai-core/src/aci/types.ts`, `packages/ai-core/src/aci/define-tool.ts`, `packages/ai-core/src/aci/define-tool.test.ts`
  _Depends:_ 10
  _Requirements:_ 5.8, 6.4
  _Traces:_ REQ-005, REQ-006, C9
- [x] 15.2 `aci/tool-set.ts`: `buildToolSet(tools, availability, runtime: ToolRuntime)`（`runtime` で各 `AciTool` を AI SDK の `Tool` に変換し、`GuardedToolSet` として返す。無効化ツールの一覧、`risk` が `read-only` 以外は `ConfigError` で拒否）+ テスト（`runtime.toolTimeoutMs`（`AGENT_TOOL_TIMEOUT_MS` 由来）と `runtime.clock` が全ツールに届くこと、戻り値が `GuardedToolSet` であること）
  _Boundary:_ `packages/ai-core/src/aci/tool-set.ts`, `packages/ai-core/src/aci/tool-set.test.ts`
  _Depends:_ 15.1, 12
  _Requirements:_ 5.4
  _Traces:_ REQ-005, C9
- [x] 15.3 `aci/tools/current-time.ts`・`calculator.ts`: 現在時刻ツール（Clock 注入）と再帰下降パーサの計算ツール（`eval` を使わない）+ `calculator.test.ts`
  _Boundary:_ `packages/ai-core/src/aci/tools/current-time.ts`, `packages/ai-core/src/aci/tools/calculator.ts`, `packages/ai-core/src/aci/tools/calculator.test.ts`
  _Depends:_ 15.1
  _Requirements:_ 5.2, 5.7
  _Traces:_ REQ-005, C9
- [x] 15.4 `aci/tools/currency.ts`・`rates.json`・`weather.ts`・`web-search.ts`: 為替・天気（Open-Meteo）・Web検索（Tavily、キー未設定時は登録しない）ツール + `tools.test.ts`（fake Clock と 13.6 の fixture 実装を使う）
  _Boundary:_ `packages/ai-core/src/aci/tools/currency.ts`, `packages/ai-core/src/aci/tools/rates.json`, `packages/ai-core/src/aci/tools/weather.ts`, `packages/ai-core/src/aci/tools/web-search.ts`, `packages/ai-core/src/aci/tools/tools.test.ts`
  _Depends:_ 10, 13, 15.1
  _Requirements:_ 5.2, 5.3
  _Traces:_ REQ-005, C9
- [x] 15.5 `aci/index.ts`: `./aci` の公開API集約
  _Boundary:_ `packages/ai-core/src/aci/index.ts`
  _Depends:_ 15.2, 15.3, 15.4
  _Requirements:_ 5.2
  _Traces:_ REQ-005, C9
  _Verify:_ 19.1 と 23.1 のテストが公開サブパス `@platform/ai-core/aci` から import して通る

### Implementation Notes

- AI SDK v7 の `Tool<INPUT, OUTPUT>` は `INPUT`・`OUTPUT` について不変（`needsApproval` と `execute` の引数位置、`inputSchema` が両方向に現れる）。そのため `AciTool<{expression:string}, R>` は `AciTool<unknown, unknown>` に代入できず、型の異なるツールの配列を受ける `buildToolSet` の引数には、`toTool(): Tool`（SDK の消去型）を持つ `AnyAciTool` を別に定義した。出力も不変なので、`readonly SearchHit[]` を返す web-search は `defineAciTool<IN, OUT>` の型引数を明示する。
- 実効タイムアウトと呼び出し元の中断は `AbortSignal.any` の `reason` で判別する（`reason === timeoutSignal.reason` のときだけ `kind: "timeout"` のツール結果にし、それ以外の中断は理由をそのまま再 throw して `aborted` をエージェントへ伝える）。`execute` がシグナルを無視しても fake Clock で確定するよう、`raceWithAbort`（`ports/abort.ts`）で競わせる。想定外の例外の `message` は秘密情報を含みうるため、ツール結果に入れるのはエラー名だけにする。学習者向けの文言は `ToolExecutionError`（summary/nextAction）か `PlatformError` の message だけを使う。
- `tool-risk-declared` の走査は `defineAciTool<...>(` を呼び出しとして扱うため、`function defineAciTool<INPUT, OUTPUT>(` という宣言自体を違反と判定した。宣言を `export const defineAciTool = <INPUT, OUTPUT>(...) =>` に変えて回避した。天気の URL は、録画済み fixture の URL（`current=temperature_2m,weather_code`）と一致させるため、`URLSearchParams`（カンマを `%2C` にする）を使わず手で組み立てる。

---

## 16. GuardedAgent（C8）(P)

3種の停止条件と停止理由を必ず持つ `ToolLoopAgent` を生成し、実行サマリを返す。

_Boundary:_ `packages/ai-core/src/agents/stop-conditions.ts`, `packages/ai-core/src/agents/stop-reason.ts`, `packages/ai-core/src/agents/guarded-agent.ts`, `packages/ai-core/src/agents/index.ts`, `packages/ai-core/src/agents/stop-conditions.test.ts`, `packages/ai-core/src/agents/stop-reason.test.ts`, `packages/ai-core/src/agents/guarded-agent.test.ts`
_Depends:_ 11, 12, 13（16.3 は 15.2 にも依存する）
_Requirements:_ 5.1, 5.6, 6.1, 6.2, 6.3, 6.5
_Traces:_ REQ-005, REQ-006, C8

- [x] 16.1 (P) `agents/stop-conditions.ts`: `stepLimit`（`isStepCount` ラッパ）・`tokenBudget`・`deadline`（Clock 経過）+ テスト（境界値: ちょうど上限、上限の1つ手前）
  _Boundary:_ `packages/ai-core/src/agents/stop-conditions.ts`, `packages/ai-core/src/agents/stop-conditions.test.ts`
  _Depends:_ 11
  _Requirements:_ 6.1
  _Traces:_ REQ-006, C8
- [x] 16.2 `agents/stop-reason.ts`: `deriveStopReason`（優先順位: `aborted`→`error`→成立した停止条件→`completed`）+ テスト（6種の網羅）
  _Boundary:_ `packages/ai-core/src/agents/stop-reason.ts`, `packages/ai-core/src/agents/stop-reason.test.ts`
  _Depends:_ 16.1
  _Requirements:_ 6.2
  _Traces:_ REQ-006, C8
- [x] 16.3 `agents/guarded-agent.ts`・`guarded-agent.test.ts`: `createGuardedAgent`（1回の実行に束縛、`tools` は 15.2 の `GuardedToolSet` だけを受け付ける、ツール数20超で `ConfigError`、`abortSignal = AbortSignal.any([signal, timeoutSignal])` の合成、`onStepEnd`/`onEnd`/`onError` によるサマリの1回だけの確定、`RunObserver.onRunEnd`）。テストはシナリオモデル（13）で、ツール呼び出しの反復、知識のみの回答（ツールを呼ばず `toolsCalled` が空）、並行する2実行の状態分離、ツール数21件での生成拒否、生の `ToolSet` を `tools` に渡すと型エラーになること（`@ts-expect-error`）、応答しないLLM呼び出しの `timeout` 化、学習者の停止による `aborted`、サマリ確定が1回だけであることを検証する
  _Boundary:_ `packages/ai-core/src/agents/guarded-agent.ts`, `packages/ai-core/src/agents/guarded-agent.test.ts`
  _Depends:_ 16.2, 15.2, 12, 13
  _Requirements:_ 5.1, 5.6, 6.1, 6.2, 6.3, 6.5
  _Traces:_ REQ-005, REQ-006, C8
- [x] 16.4 `agents/index.ts`: `./agents` の公開API
  _Boundary:_ `packages/ai-core/src/agents/index.ts`
  _Depends:_ 16.3
  _Requirements:_ 5.1
  _Traces:_ REQ-005, C8
  _Verify:_ 17.3・19.1・23.1 のテストが公開サブパス `@platform/ai-core/agents` から import して通る

### Implementation Notes

- AI SDK v7 の `isStopConditionMet` は `Promise.all` で全停止条件を同時に評価する。そのため同じステップで複数の条件が成立しうるし、`stepLimit` を `isStepCount`（戻り値の型が `PromiseLike | boolean`）に委譲して async にしたことで、記録の「成立した順」がマイクロタスクの順に左右された。そこで `fired()` は成立順ではなく `STOP_CONDITION_NAMES` の固定順で返し、停止理由は `deriveStopReason` の固定優先順位（timeout → token-budget → step-limit）だけで決める。`ToolLoopAgentSettings.stopWhen` は readonly 配列を受け付けないため、`createRunStopConditions` は実行ごとに新しい mutable 配列を返し、条件の引数型は `{ usage }` だけの構造型にした（`any` なしでどの `TOOLS` の `StopCondition` にも代入できる。`expectTypeOf` で固定）。呼び出し元の中断と実行時間上限の中断は 16.3 が `AbortSignal.reason` で判定して `StopReasonInput.abort: "caller" | "timeout"` として渡し、`deriveStopReason` は純粋関数のままにした（どちらの中断も error より上）。
- v7 の `createAgentUIStream(Response)` では、UI ストリームの `finish` が `streamText` の `onEnd` より先に届くことがある（`onEnd` はイベント処理の flush で呼ばれる）。そのため `messageMetadata` の `finish` でもサマリを確定する。`finish` の時点で全ステップの `onStepEnd` と停止条件の評価は済んでいるので、`onEnd` で確定した場合と同じ値になる。確定は最初の1回だけ採用する。
- v7 では中断が `onError` に来ない。`streamText` は中断を `abort` パートに変換し、`onAbort` も出すが、`ToolLoopAgentSettings` に `onAbort` / `onError` はない。そこで合成した `abortSignal` の `abort` イベントでサマリを確定する（タイムアウトか呼び出し元かは `reason` の一致で判定）。生成時に既に中断済みの場合は、その場で `aborted` として確定する。`onError` は中断済みなら中断理由、そうでなければ `error` として確定し、学習者向けの固定文言を返す（生のエラー文はストリームに出さない）。`abortSignal` は settings ではなく呼び出しごとの引数なので、route は `guarded.abortSignal` を `createAgentUIStreamResponse` に渡す。`ToolsContextSettings<TOOLS>` は generic な TOOLS では解決できないため、settings は `as unknown as ToolLoopAgentSettings<never, TOOLS>` で渡す。

---

## 17. ChatCore（C11）

ペルソナのテンプレート、モデル切り替え時の履歴変換、応答メタデータの組み立てを提供する。

_Boundary:_ `packages/ai-core/src/chat/personas/index.ts`, `packages/ai-core/src/chat/personas/general-assistant.ts`, `packages/ai-core/src/chat/personas/python-mentor.ts`, `packages/ai-core/src/chat/personas/strict-reviewer.ts`, `packages/ai-core/src/chat/adapt-history.ts`, `packages/ai-core/src/chat/metadata.ts`, `packages/ai-core/src/chat/request-schema.ts`, `packages/ai-core/src/chat/index.ts`, `packages/ai-core/src/chat/adapt-history.test.ts`, `packages/ai-core/src/chat/personas/personas.test.ts`, `packages/ai-core/src/chat/metadata.test.ts`, `packages/ai-core/src/chat/request-schema.test.ts`
_Depends:_ 9, 16
_Requirements:_ 3.3, 3.7, 3.10, 5.6
_Traces:_ REQ-003, REQ-005, C11

- [x] 17.1 (P) `chat/personas/*`: 汎用アシスタント・Python講師・厳密レビュアの3テンプレート（`id`/`version`/`title`/`render`）+ テスト（ID一意性、版の形式、描画結果）
  _Boundary:_ `packages/ai-core/src/chat/personas/index.ts`, `packages/ai-core/src/chat/personas/general-assistant.ts`, `packages/ai-core/src/chat/personas/python-mentor.ts`, `packages/ai-core/src/chat/personas/strict-reviewer.ts`, `packages/ai-core/src/chat/personas/personas.test.ts`
  _Depends:_ 9
  _Requirements:_ 3.10
  _Traces:_ REQ-003, C11
- [x] 17.2 (P) `chat/adapt-history.ts`: `adaptHistoryForModel`（推論・プロバイダ固有メタデータ・非対応画像の除外・変換、表示用履歴は変えない）+ テスト
  _Boundary:_ `packages/ai-core/src/chat/adapt-history.ts`, `packages/ai-core/src/chat/adapt-history.test.ts`
  _Depends:_ 9
  _Requirements:_ 3.3
  _Traces:_ REQ-003, C11
- [x] 17.3 `chat/metadata.ts`・`request-schema.ts`・`index.ts`: `buildResponseMetadata`、`chatRequestSchema`/`agentRequestSchema`（`z.strictObject`）、`./chat` の公開API + `metadata.test.ts`（使用量の写し替え、`run` と `toolsCalled` の有無）・`request-schema.test.ts`（未知フィールド・カタログ外のモデル ID・未知のペルソナ ID の拒否）
  _Boundary:_ `packages/ai-core/src/chat/metadata.ts`, `packages/ai-core/src/chat/metadata.test.ts`, `packages/ai-core/src/chat/request-schema.ts`, `packages/ai-core/src/chat/request-schema.test.ts`, `packages/ai-core/src/chat/index.ts`
  _Depends:_ 17.1, 17.2, 16
  _Requirements:_ 3.7, 3.10, 5.6
  _Traces:_ REQ-003, REQ-005, C11

### Implementation Notes

- ペルソナ定義ファイル（`general-assistant.ts` など）はデータ（`id`/`version`/`title`/`instructions`）だけを export し、`personas/index.ts` が `render` 付きの凍結済みテンプレートに組み立てる（定義側から描画関数を import する循環参照を避けるため）。`render(vars)` の `vars` は `modelName`（カタログの表示名）と `today`（Clock から得た `YYYY-MM-DD`）だけで、どちらもリクエスト本文からは受け取らない。プロンプト本文を変えたら `version` を上げる。`adaptHistoryForModel` は生成元プロバイダを assistant メッセージの `metadata.provider`（17.3 の `ResponseMetadata.provider`）から判定し、生成元が不明な assistant メッセージと全 user パートは「別プロバイダ」扱いでプロバイダ固有フィールドを必ず除く（クライアントが送った `providerMetadata` を任意オプション注入として通さない）。推論は同じプロバイダかつ `capabilities.reasoning` のときだけ残す。
- 不完全なツール呼び出し（`input-streaming`/`input-available`）は、結果のない tool-call をプロバイダが拒否するため、同じプロバイダでも常に除く。承認系の状態（`approval-*`、`output-denied`）は SDK の承認フローに必要なので残す。別プロバイダが実行したツール（`providerExecuted`）と `custom` パートは除く。変換で空（`step-start` だけ）になったメッセージは送らない。
- `buildResponseMetadata` の入力に `persona`（`id`/`version`）と `disabledTools` を追加し、`usage` は任意にした（`start` ではモデル名とペルソナだけ、`finish` で `part.totalUsage` を渡し、`useChat` が2つをマージする）。`toolsCalled` はトップレベルに置き（Req 5.6）、明示の値、なければ `run.toolsCalled`、どちらもなければキーを省く。`DefaultChatTransport` は既定で本文に `trigger`（`submit-message`/`regenerate-message`）と `messageId` を付けて送る（`HttpChatTransport.sendMessages` で確認）ため、plan どおりの4フィールドだけの `z.strictObject` では既定の `useChat` の送信がすべて 400 になる。この2フィールドは任意で受け付けて Route では使わず、`role: "system"` は拒否する。メッセージはエンベロープだけを strict に検査し、part の中身の検証は C15 の Route の `validateUIMessages` に任せる。

---

## 18. SummaryPipeline（C12）(P)

記事URL・YouTube URL・字幕テキストから本文を取得し、分割の要否を判断して、スキーマ検証済みの
要約オブジェクトを逐次生成する。

_Boundary:_ `packages/ai-core/src/summarize/schema.ts`, `packages/ai-core/src/summarize/schema.test.ts`, `packages/ai-core/src/summarize/source.ts`, `packages/ai-core/src/summarize/tokens.ts`, `packages/ai-core/src/summarize/plan.ts`, `packages/ai-core/src/summarize/cache-policy.ts`, `packages/ai-core/src/summarize/cache-policy.test.ts`, `packages/ai-core/src/summarize/prompts.ts`, `packages/ai-core/src/summarize/retry.ts`, `packages/ai-core/src/summarize/pipeline.ts`, `packages/ai-core/src/summarize/errors.ts`, `packages/ai-core/src/summarize/index.ts`, `packages/ai-core/src/summarize/source.test.ts`, `packages/ai-core/src/summarize/plan.test.ts`, `packages/ai-core/src/summarize/retry.test.ts`, `packages/ai-core/src/summarize/pipeline.test.ts`
_Depends:_ 9, 10, 11, 13
_Requirements:_ 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 4.12
_Traces:_ REQ-004, C12

- [x] 18.1 `summarize/schema.ts`・`errors.ts`: 要約スキーマ（`title`/`keyPoints`ちょうど3件/`tags`/`actionItems`/`chapters?`）、`summarizeRequestSchema`（`z.strictObject`）と `SourceFetchError`・`TranscriptUnavailableError`・`SummaryValidationError` + `schema.test.ts`（要点が3件でない、上限超過、要約リクエストの未知フィールドの拒否）
  _Boundary:_ `packages/ai-core/src/summarize/schema.ts`, `packages/ai-core/src/summarize/schema.test.ts`, `packages/ai-core/src/summarize/errors.ts`
  _Depends:_ 9
  _Requirements:_ 4.1, 4.3, 4.10
  _Traces:_ REQ-004, C12
- [x] 18.2 `summarize/source.ts`: 記事本文抽出（`@mozilla/readability` + `jsdom`）、YouTube URL 解析と字幕取得、字幕テキストの直接入力の受付 + テスト（13.6 の fixture 実装で、HTTP失敗・空本文・字幕なしでLLMを呼ばないこと）
  _Boundary:_ `packages/ai-core/src/summarize/source.ts`, `packages/ai-core/src/summarize/source.test.ts`
  _Depends:_ 18.1, 10, 13
  _Requirements:_ 4.1, 4.2, 4.7, 4.9, 4.11
  _Traces:_ REQ-004, C12
- [x] 18.3 (P) `summarize/tokens.ts`・`plan.ts`: `gpt-tokenizer` によるトークン推定（安全係数1.2）と全文/分割の判断（コンテキスト上限の80%境界）+ テスト
  _Boundary:_ `packages/ai-core/src/summarize/tokens.ts`, `packages/ai-core/src/summarize/plan.ts`, `packages/ai-core/src/summarize/plan.test.ts`
  _Depends:_ 18.1
  _Requirements:_ 4.6, 4.12
  _Traces:_ REQ-004, C12
- [x] 18.4 (P) `summarize/cache-policy.ts`・`prompts.ts`: プロバイダ別のプロンプトキャッシュ指定方法（`anthropic`明示/自動系は記録のみ/`ollama`・`mock`はなし）と要約・部分要約・統合のプロンプト + `cache-policy.test.ts`
  _Boundary:_ `packages/ai-core/src/summarize/cache-policy.ts`, `packages/ai-core/src/summarize/cache-policy.test.ts`, `packages/ai-core/src/summarize/prompts.ts`
  _Depends:_ 18.1
  _Requirements:_ 4.8
  _Traces:_ REQ-004, C12
- [x] 18.5 (P) `summarize/retry.ts`: スキーマ検証失敗時の最大2回までの再生成 + テスト（1回目・2回目の成功、3回目失敗時のエラー内容）
  _Boundary:_ `packages/ai-core/src/summarize/retry.ts`, `packages/ai-core/src/summarize/retry.test.ts`
  _Depends:_ 18.1
  _Requirements:_ 4.4
  _Traces:_ REQ-004, C12
- [x] 18.6 `summarize/pipeline.ts`・`index.ts`: `streamSummary`（`partial`/`restart`/`final`/`meta` のイベント列、`final` だけを検証済み要約として扱う）+ テスト（13.6 の `m1-3` シナリオと 11 のモックモデルで、部分オブジェクトの順序、チャプターの生成、キャッシュ読み出し量の記録）
  _Boundary:_ `packages/ai-core/src/summarize/pipeline.ts`, `packages/ai-core/src/summarize/index.ts`, `packages/ai-core/src/summarize/pipeline.test.ts`
  _Depends:_ 18.2, 18.3, 18.4, 18.5, 11, 13
  _Requirements:_ 4.3, 4.5, 4.8, 4.10, 4.12
  _Traces:_ REQ-004, C12

### Implementation Notes

- AI SDK v7 の `streamText` は `messages` 内の system メッセージを `AI_InvalidPromptError` で拒否するため、要約プロンプトは `{ instructions, messages }`（`SummaryPrompt`）で返す。長文のソースは user メッセージの先頭のテキストパートに `<source>` で区切って置き、Anthropic ではそのパートだけに `providerOptions.anthropic.cacheControl` を付ける。再生成時の検証エラーは後ろに別パートとして足すので、キャッシュ対象の先頭部分は再送しても変わらない。分割判断の指示文トークンは、空のソースで実際のプロンプトを組み立てて推定し、プロンプトを変更しても判断がずれないようにした。
- 構造化出力は `streamText` + `Output.object` で、`partialOutputStream` を `partial` イベントとして送る。`await result.output` が `NoObjectGeneratedError` で失敗したときは、`error.text` を自前で JSON 解析・スキーマ検証して `path: message` 形式の issues を作る。生成本文を含む `cause` は使わず、エラーにも入れない。プロバイダのエラーは再生成せずにそのまま投げる。既定の `onError` はエラーを console に出すため、no-op の収集関数で置き換えた。staged では各チャンクの部分要約（再生成規則は同じ、イベントは出さない）の後、統合の呼び出しだけが `partial` / `restart` を送る。再生成を使い切った `SummaryValidationError` は、当初は合うコードがなく `provider-unavailable` を使っていたため、`PlatformErrorCode` に `output-invalid` を加えて区別した（コーディネーターの修正 `1367ee4`）。
- jsdom には型定義がなく `@types/jsdom` も宣言済みの依存にないため、`createRequire(import.meta.url)("jsdom")` で読み込み、使う面だけをローカルの interface で型付けした。jsdom は `innerText` を実装しないので、Readability の結果（`serializer: (node) => node`）をブロック要素ごとに改行してテキスト化する。Readability は失敗時も文書を変更する（script を除去する）ため、本文抽出が失敗したときの代替経路でも script の本文は混ざらない。

---

## 19. 評価スイート: 回帰テストと Capability の例（C21 続き）

M1 のツールエージェントの通し実行を回帰として検証し、`local` 限定の品質評価の適用例を1件置く。
W3 の締めとして gate を結線する。

_Boundary:_ `packages/eval-suite/package.json`, `packages/eval-suite/tests/regression/tool-agent-run.test.ts`, `packages/eval-suite/tests/capability/summary-quality.local.test.ts`, `mise.toml`, `.github/workflows/ci.yml`
_Depends:_ 7, 9, 13, 15, 16, 18（19.3 は 14、17 にも依存する）
_Requirements:_ 1.1, 1.4, 1.7, 1.13, 1.14, 1.15, 1.16
_Traces:_ REQ-001, C21, C1, C2

- [ ] 19.1 `tests/regression/tool-agent-run.test.ts`: `mock` シナリオでツールエージェントを最後まで実行し、停止理由・ツール呼び出し列・最終回答の Outcome を回帰として検証する。`packages/eval-suite/package.json` に `test`・`test:coverage`（`vitest run --coverage.enabled --coverage.reporter=html --coverage.thresholds.lines=0`。閾値の強制は gate の `test` 段。plan C18）スクリプトを加える
  _Boundary:_ `packages/eval-suite/tests/regression/tool-agent-run.test.ts`, `packages/eval-suite/package.json`
  _Depends:_ 7, 13, 15, 16
  _Requirements:_ 1.1, 1.13
  _Traces:_ REQ-001, C21
- [ ] 19.2 `tests/capability/summary-quality.local.test.ts`: `local` 限定で要約が3件の要点を持つことを実モデルで確認する例
  _Boundary:_ `packages/eval-suite/tests/capability/summary-quality.local.test.ts`
  _Depends:_ 7, 18, 11
  _Requirements:_ 1.13, 1.14
  _Traces:_ REQ-001, C21
- [ ] 19.3 W3 の締め: `mise.toml` の `gate` に W3 の規則を、`ci.yml` に `mutation` ジョブ（`mise run test:mutation`）と `ci-status` の `needs` を加える（[tasks.md](tasks.md)「gate と CI の段階的な結線」）
  _Boundary:_ `mise.toml`, `.github/workflows/ci.yml`
  _Depends:_ 14, 15, 16, 17, 18, 19.1, 19.2
  _Requirements:_ 1.4, 1.7, 1.15, 1.16
  _Traces:_ REQ-001, C1, C2
  _Verify:_ `mise run gate` が成功し、`tool-risk-declared` が走査件数を出力する。gate-reporter が `*.local.test.ts` を理由付きのスキップとして数える。`mise run test:mutation` がローカルで閾値（70）を満たし、PR の `ci-status` が `mutation` を含めて成功する

### Implementation Notes
