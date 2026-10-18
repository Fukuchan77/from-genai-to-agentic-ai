# domain-agents（Milestone 3）— 実装タスク W4: サンドボックス・分析（大タスク 17〜20）

未着手の波。表記規約、ID 対応表、進捗、gate への段階的な結線、共有ファイルの編集者は [tasks.md](tasks.md) を参照する。

提供者の選択、E2B・Docker・疑似の提供者、tar・demux・Engine API、`docker/sandbox/Dockerfile` と `sandbox:build`、アップロードの検査、出力の分離、修正ループ、
`runPython`、`/api/analysis*`、`m3-3` のシナリオを作る。前提は spike S-4・S-5（1.5、1.6）の結果。生成コードはホストで実行しない（`sandbox-import-scope`、憲章 原則 6）。

17.1・17.2・17.3・17.5 は並列に進められる。18.1・18.2 は並列に進められる。19.2・19.3 は並列に進められる。

---

## 17. サンドボックス提供者（C6）

E2B、ローカルのコンテナ、疑似実装の 3 提供者を `SandboxProvider` の背後に置き、セッションごとの作成とアイドル破棄を行う。

_Boundary:_ `packages/ai-core/src/sandbox/**`, `packages/ai-core/fixtures/sandbox/*`, `docker/sandbox/Dockerfile`, `mise.toml`, `specs/003-domain-agents/research.md`
_Depends:_ 6.1, 1.5, 1.6, 2.1
_Requirements:_ 3.1, 3.2, 3.7, 3.8, 3.10
_Traces:_ REQ-003, C6, C15, ADR-6

- [ ] 17.1 (P) `sandbox/mock.ts` と `fixtures/sandbox/mock-{success,error}.json`: 定義済みの標準出力・エラー出力・小さな PNG（base64）を返す疑似提供者を作る。実際のコードは実行しない + `mock.test.ts` に、成功と失敗の応答、コードの内容に応じた応答の切り替え、`close` 後の `runPython` の失敗を先に書く
  _Boundary:_ `packages/ai-core/src/sandbox/mock.ts`, `packages/ai-core/src/sandbox/mock.test.ts`, `packages/ai-core/fixtures/sandbox/mock-success.json`, `packages/ai-core/fixtures/sandbox/mock-error.json`
  _Depends:_ 6.1
  _Requirements:_ 3.10
  _Traces:_ REQ-003, C6, C15
- [ ] 17.2 (P) `sandbox/select.ts`: `selectSandboxProvider({ env, dockerProbe })` が E2B の鍵 → ローカルのコンテナ（疎通と画像の有無）→ 無効の順に選び、無効のときは理由と有効化に必要な設定の案内（`sandbox:build` を含む）を返す + `select.test.ts` に、選択の順序、鍵あり・Docker なし、鍵なし・Docker あり、画像なし、すべて無し（案内文）を先に書く
  _Boundary:_ `packages/ai-core/src/sandbox/select.ts`, `packages/ai-core/src/sandbox/select.test.ts`
  _Depends:_ 6.1, 2.1
  _Requirements:_ 3.8
  _Traces:_ REQ-003, C6, ADR-6
- [ ] 17.3 (P) `sandbox/lifecycle.ts`: `createSandboxRegistry({ provider, clock, idleTimeoutMs })` が `acquire(sessionId)`（既存のセッションは再利用し、`isAlive()` が偽なら 1 回だけ作り直す）、`touch`、`release`（冪等）、`sweep`（アイドル 10 分で破棄）を持つ。時刻は `Clock` から + `lifecycle.test.ts`（`FakeClock`）に、アイドルの境界値（10 分ちょうどと +1 ms）、明示解放の冪等、期限切れの作り直しが 1 回で止まること、`sweep` が実行中のセッションを破棄しないことを先に書く
  _Boundary:_ `packages/ai-core/src/sandbox/lifecycle.ts`, `packages/ai-core/src/sandbox/lifecycle.test.ts`
  _Depends:_ 6.1
  _Requirements:_ 3.7
  _Traces:_ REQ-003, C6, CL-8
- [ ] 17.4 `sandbox/e2b.ts`: `createE2bProvider({ apiKey, sdk })`（`@e2b/code-interpreter` を import する唯一のファイル。SDK を注入できる形で、キーが無ければ読み込まない）が、`create` / `writeFile` / `runPython` / `isAlive` / `close` を SDK に写す。偽 SDK の形は 1.5 の結果に合わせる + `e2b.test.ts` に、偽 SDK での作成・書き込み・実行・標準出力と標準エラーとエラーの写像、期限切れ、`create` の失敗が `provider-unavailable` になること、キーが例外の文言に現れないことを先に書く
  _Boundary:_ `packages/ai-core/src/sandbox/e2b.ts`, `packages/ai-core/src/sandbox/e2b.test.ts`
  _Depends:_ 6.1, 1.5
  _Requirements:_ 3.1, 3.2
  _Traces:_ REQ-003, C6, S-4
- [ ] 17.5 (P) `sandbox/docker/tar.ts` と `sandbox/docker/demux.ts`: 1 ファイルの tar を 512 バイトのヘッダで作る純関数と、8 バイトのヘッダの多重化ストリームを標準出力と標準エラーに分ける純関数を作る（`tar-stream` は使わない）+ `tar.test.ts`・`demux.test.ts` に、ヘッダのチェックサムとパディング、長いファイル名の拒否、ストリームが途中で切れたとき読めた分までを返し警告を付けること、標準出力と標準エラーの混在を先に書く
  _Boundary:_ `packages/ai-core/src/sandbox/docker/tar.ts`, `packages/ai-core/src/sandbox/docker/tar.test.ts`, `packages/ai-core/src/sandbox/docker/demux.ts`, `packages/ai-core/src/sandbox/docker/demux.test.ts`
  _Depends:_ none
  _Requirements:_ 3.2
  _Traces:_ REQ-003, C6, ADR-4
- [ ] 17.6 `sandbox/docker/probe.ts` と `sandbox/docker/engine.ts`: `probeDockerSocket(env)`（`DOCKER_HOST`、`~/.docker/run/docker.sock`、`/var/run/docker.sock` の順に疎通を確かめる）と、Engine API の薄いクライアント（`node:http` の `socketPath`。create / start / archive / wait / logs / delete）を作る。`dockerode` は使わない（ADR-4）+ `probe.test.ts`・`engine.test.ts` に、探索の順序、疎通の失敗の扱い、要求の形（パス、メソッド、本文）を偽のソケット（インメモリのストリーム）で、各呼び出しの失敗が `provider-unavailable` になることを先に書く。実ソケットへは接続しない
  _Boundary:_ `packages/ai-core/src/sandbox/docker/probe.ts`, `packages/ai-core/src/sandbox/docker/probe.test.ts`, `packages/ai-core/src/sandbox/docker/engine.ts`, `packages/ai-core/src/sandbox/docker/engine.test.ts`
  _Depends:_ 1.6
  _Requirements:_ 3.2, 3.8
  _Traces:_ REQ-003, C6, ADR-4, S-5
- [ ] 17.7 `sandbox/docker/provider.ts` と `sandbox/index.ts`: `createDockerProvider({ engine, image })` が、ネットワークなし（`NetworkMode: none`）・読み取り専用ルート・tmpfs の `/work`・メモリと CPU の制限・PID 上限・capability の全削除・`no-new-privileges`・非 root のコンテナを作り、`writeFile`（tar）→ 実行 → ログの取得 → **必ず削除**（`force` + `v`、`finally`）を行う。タイムアウトでコンテナを強制削除する。`sandbox/index.ts` は `@platform/ai-core/sandbox` の公開 API を再エクスポートする + `provider.test.ts` に、作成要求の制限の内容（設定値の検査）、成功・失敗・タイムアウトのいずれでもコンテナが削除されること、`create` / `archive` / `start` / `wait` / `logs` の各失敗、ログの途中切れの警告を、偽のエンジンで先に書く
  _Boundary:_ `packages/ai-core/src/sandbox/docker/provider.ts`, `packages/ai-core/src/sandbox/docker/provider.test.ts`, `packages/ai-core/src/sandbox/index.ts`
  _Depends:_ 17.1, 17.2, 17.3, 17.4, 17.5, 17.6
  _Requirements:_ 3.1, 3.2, 3.8
  _Traces:_ REQ-003, C6, ADR-6, CL-20
- [ ] 17.8 `docker/sandbox/Dockerfile` と `mise.toml` の `sandbox:build`、`fixtures/sandbox/sample-analysis.py`、`sandbox/docker/provider.container.test.ts`: pandas、openpyxl、xlrd、matplotlib を 1.6 で固定した版で含む非 root の画像（名前 `agentic-ai-sandbox:local`）を作り、実 Docker で、ネットワークなし、読み取り専用ルート、タイムアウト、コンテナの削除、分析スクリプトが目印の行（`__PNG__:`、`__TABLE__:`）を出すことを検証する。Docker が無い環境では `*.container.test.ts` が理由付きでスキップされる。初回の `mise run sandbox:build` と `mise run test:container` の実行（Docker を起動できる環境で、人が行う）の所要時間と Docker のバージョンを research.md に追記する
  _Boundary:_ `docker/sandbox/Dockerfile`, `mise.toml`, `packages/ai-core/fixtures/sandbox/sample-analysis.py`, `packages/ai-core/src/sandbox/docker/provider.container.test.ts`, `specs/003-domain-agents/research.md`
  _Depends:_ 17.7, 6.3
  _Requirements:_ 3.1, 3.2, 3.8
  _Traces:_ REQ-003, C6, C15, CL-9, CL-20
  _Verify:_ `mise run sandbox:build` が成功し、`mise run test:container` が実 Docker で成功する（Docker が無い環境では「人が行うこと」として未実行を research.md に明記し、スキップを合格に数えない）。`mise run gate` が `*.container.test.ts` を実行しない

### Implementation Notes

---

## 18. データ分析（C7）

アップロードを検査し、サンドボックスでコードを実行して失敗を修正しながら分析を進める修正ループと、出力の分離を提供する。

_Boundary:_ `packages/ai-core/src/analysis/**`, `packages/ai-core/fixtures/analysis/sales.csv`, `packages/ai-core/fixtures/scenarios/m3-3.ts`, `packages/ai-core/src/models/gateway.ts`, `packages/ai-core/src/models/gateway.test.ts`, `packages/ai-core/src/mock/index.ts`, `packages/ai-core/src/mock/m3-scenarios.test.ts`
_Depends:_ 6.1, 3.3, 4.7, 5.2, 17.1
_Requirements:_ 3.1, 3.3, 3.4, 3.5, 3.6, 3.9, 3.10
_Traces:_ REQ-003, C7, C15

- [ ] 18.1 (P) `analysis/upload-check.ts` と `fixtures/analysis/sales.csv`: `checkUpload({ name, bytes, declaredLength? })` が、拡張子（`.csv` / `.xlsx` / `.xls`）、マジックバイト（xlsx は zip、xls は OLE2）、20 MB（20 MiB ちょうどは許容、+1 バイトで拒否）、CSV の NUL と UTF-8 の不正、空ファイルを検査する純関数を作る + `upload-check.test.ts` に、`.xlsx` の名前の `.docx`、`.csv` の名前の PNG、20 MB の境界、`declaredLength` が小さく実体が大きい場合、空ファイル、非対応形式を先に書く
  _Boundary:_ `packages/ai-core/src/analysis/upload-check.ts`, `packages/ai-core/src/analysis/upload-check.test.ts`, `packages/ai-core/fixtures/analysis/sales.csv`
  _Depends:_ none
  _Requirements:_ 3.9
  _Traces:_ REQ-003, C7, C15
- [ ] 18.2 (P) `analysis/prelude.ts` と `analysis/output-parser.ts`: `analysisPrelude`（`show_figure(alt)`、`show_table(df, caption)` を定義する Python の断片）と、`parseSandboxOutput(stdout, limits)`（目印の行 `__PNG__:` / `__TABLE__:` を取り出し、PNG のマジックバイト・1 MB・`alt` の 1〜200 文字、表の 200 行を検査して `figures` / `tables` / `rejected` と画面用の `text` を返し、目印の行を `text` から除く純関数）を作る。目印の行は切り詰めの前に取り出す + `prelude.test.ts`・`output-parser.test.ts` に、PNG でない画像、大きさの超過、`alt` が空、デコード不能、200 行超（`totalRows` の保持）、目印の行が画面の標準出力から除かれること、標準出力が巨大でも目印の行が失われないこと、SVG や HTML を描画対象にしないことを先に書く
  _Boundary:_ `packages/ai-core/src/analysis/prelude.ts`, `packages/ai-core/src/analysis/prelude.test.ts`, `packages/ai-core/src/analysis/output-parser.ts`, `packages/ai-core/src/analysis/output-parser.test.ts`
  _Depends:_ none
  _Requirements:_ 3.5
  _Traces:_ REQ-003, C7, CL-19, ADR-2
- [ ] 18.3 `analysis/attempts.ts` と `analysis/run-python-tool.ts`: `AnalysisAttempt`（コード 8000 文字まで、標準出力、標準エラー、エラーの要約）と試行履歴の組み立て、`createRunPythonTool` が `runPython` を `risk: "read-only"`（作用はサンドボックスの中だけ。CL-21）で定義し、サンドボックスのセッションをポート `SandboxSession` の型だけで受け取る（`sandbox/` の具象を import しない）。エラーの出力は標準エラーとトレースバックを 8000 文字までモデルに返し、4 回目の実行は行わず `FatalToolError`（`attempt-limit`）で止める + `attempts.test.ts`・`run-python-tool.test.ts` に、コード長の切り詰め、成功で止まること、3 回の修正の後に 4 回目の実行が**起きない**こと、タイムアウトがエラーとして扱われること、`risk` が `read-only` であることを先に書く
  _Boundary:_ `packages/ai-core/src/analysis/attempts.ts`, `packages/ai-core/src/analysis/attempts.test.ts`, `packages/ai-core/src/analysis/run-python-tool.ts`, `packages/ai-core/src/analysis/run-python-tool.test.ts`
  _Depends:_ 6.1, 18.2, 3.1, 4.7
  _Requirements:_ 3.3, 3.4, 3.6
  _Traces:_ REQ-003, C7, CL-21
- [ ] 18.4 `analysis/agent.ts` と `analysis/index.ts`: `runAnalysis({ sandbox, file, instruction, model, options, observer, signal })` が、ファイルを生バイトのままサンドボックスへ書き込み（ホストで解析しない。ADR-1）、`analysisPrelude` を投入し、`createGuardedAgent` で `runPython` を使って分析する。失敗の修正は最大 3 回で、超えたら `attempt-limit`（最後のコード、エラー、試行履歴を返す）。壊れた xlsx は「ファイルを読めない」という結果で終える（修正ループに入れない）。結果は `AnalysisResult`（`status`、`attempts`、`figures`、`tables`、`text`）。`index.ts` は `@platform/ai-core/analysis` の公開 API を再エクスポートする + `agent.test.ts` に、疑似提供者（17.1）での成功、失敗 → 修正 → 成功、3 回失敗で `attempt-limit` と最後のコード・履歴、4 回目の実行が起きないこと、画像と表の取り出し、コード・標準出力・エラー・修正回数のイベント、中断で後続の実行が始まらないこと、`sandbox/` の具象を import していないことを先に書く
  _Boundary:_ `packages/ai-core/src/analysis/agent.ts`, `packages/ai-core/src/analysis/agent.test.ts`, `packages/ai-core/src/analysis/index.ts`
  _Depends:_ 18.3, 17.1, 3.3, 5.2
  _Requirements:_ 3.1, 3.3, 3.4, 3.5, 3.6, 3.10
  _Traces:_ REQ-003, C7, ADR-1
- [ ] 18.5 `fixtures/scenarios/m3-3.ts`: 分析（コード生成 → 実行 → 成功、失敗 → 修正 → 成功、3 回失敗）のシナリオを作り、`gateway.ts` の `mock` 既定シナリオと `mock/index.ts` の集約に足す + `m3-scenarios.test.ts` の期待件数を更新して曖昧な一致がないことを確かめる
  _Boundary:_ `packages/ai-core/fixtures/scenarios/m3-3.ts`, `packages/ai-core/src/models/gateway.ts`, `packages/ai-core/src/models/gateway.test.ts`, `packages/ai-core/src/mock/index.ts`, `packages/ai-core/src/mock/m3-scenarios.test.ts`
  _Depends:_ 15.1, 18.4
  _Requirements:_ 3.3, 3.10
  _Traces:_ REQ-003, C15

### Implementation Notes

---

## 19. 分析の HTTP 入口（C13 の一部）

組み立て、アップロードの受信、セッションのレジストリ、ストリームの写像、`/api/analysis*` を作る。

_Boundary:_ `apps/web/lib/server/platform.ts`, `apps/web/lib/server/platform.test.ts`, `apps/web/lib/server/upload.ts`, `apps/web/lib/server/upload.test.ts`, `apps/web/lib/server/sessions.ts`, `apps/web/lib/server/sessions.test.ts`, `apps/web/lib/server/domain-stream.ts`, `apps/web/lib/server/domain-stream.test.ts`, `apps/web/app/api/analysis/**`
_Depends:_ 17.7, 18.5, 15.2
_Requirements:_ 3.1, 3.5, 3.6, 3.7, 3.8, 3.9
_Traces:_ REQ-003, C13

- [ ] 19.1 `platform.ts`: `getSandboxSelection()` を組み立てる（起動時に提供者を選び、`mock` では疑似提供者。提供者とサンドボックスのレジストリは `globalThis` のホルダーで 1 つだけ）+ `platform.test.ts` に、実行モード別の組み立て、鍵が無いときの無効化と案内（`guidance`）を先に足す
  _Boundary:_ `apps/web/lib/server/platform.ts`, `apps/web/lib/server/platform.test.ts`
  _Depends:_ 15.2, 17.2, 17.7
  _Requirements:_ 3.8
  _Traces:_ REQ-003, C13
- [ ] 19.2 (P) `lib/server/upload.ts`: `readUpload(request, { maxBytes })` が `multipart/form-data` を受信し、`Content-Length` と受信バイト数の両方で上限（20 MiB）を検査して、超えたら残りを読まずに打ち切る。`file` が 0 個または 2 個以上、`instruction`・`sessionId` の欠落を拒否する + `upload.test.ts` に、宣言が小さく実体が大きい multipart の拒否、20 MiB ちょうどと +1 バイト、`file` の個数、打ち切り後に残りを読まないことを先に書く
  _Boundary:_ `apps/web/lib/server/upload.ts`, `apps/web/lib/server/upload.test.ts`
  _Depends:_ none
  _Requirements:_ 3.9
  _Traces:_ REQ-003, C13, CL-7
- [ ] 19.3 (P) `lib/server/sessions.ts`: `createSessionRegistry<T>({ clock, idleTimeoutMs })` が `get`、`create(id, factory)`、`touch`、`dispose(id)` を持ち、アイドル破棄を `Clock` で数える。レジストリの実体は `platform.ts` と同じ `globalThis` のホルダーに 1 つだけ保持する（`getSessionRegistries()`）。ルートごとに別バンドルになりえて dev ではモジュールが再読み込みされるため、モジュールスコープの変数に置かない + `sessions.test.ts` に、アイドルの境界値、`dispose` のフック、あるモジュールインスタンスで作ったセッションを別のインスタンスから取得できること（ホルダーの共有）を先に書く
  _Boundary:_ `apps/web/lib/server/sessions.ts`, `apps/web/lib/server/sessions.test.ts`
  _Depends:_ none
  _Requirements:_ 3.7
  _Traces:_ REQ-003, C13, CL-8
- [ ] 19.4 `lib/server/domain-stream.ts`: `data-analysis-attempt`・`data-analysis-figure`・`data-analysis-table`・`data-analysis-result`（イベント）への写像を足す + `domain-stream.test.ts` に、図表の上限（1 MB、200 行）が適用済みであること、`alt` が空の図を流さないこと、`attempt` の順序を先に足す
  _Boundary:_ `apps/web/lib/server/domain-stream.ts`, `apps/web/lib/server/domain-stream.test.ts`
  _Depends:_ 15.2, 18.4
  _Requirements:_ 3.5, 3.6
  _Traces:_ REQ-003, C13
- [ ] 19.5 (P) `GET /api/analysis/status`: `{ sandbox: { kind } | { kind: "disabled"; reason; guidance }; upload: { maxBytes; accepts } }` を返す + `route.test.ts` に、E2B・Docker・無効の 3 通り、案内文に有効化に必要な設定が含まれること、秘密が応答に現れないことを先に書く
  _Boundary:_ `apps/web/app/api/analysis/status/route.ts`, `apps/web/app/api/analysis/status/route.test.ts`
  _Depends:_ 19.1
  _Requirements:_ 3.8
  _Traces:_ REQ-003, C13
- [ ] 19.6 `POST /api/analysis`: multipart を検査し（413 → 400 形式 → 件数・長さ → `live` のみ 429）、`checkUpload` に失敗したらサンドボックスも LLM も起動せず理由を返し（400 `invalid-request`、20 MB 超は 413）、サンドボックスが無効なら 503 `provider-unavailable` と `guidance` を `details` に含める。検査に通ったらセッションのサンドボックスを取得し（期限切れなら 1 回だけ作り直して通知）、`runAnalysis` の進行を `data-analysis-*` として流す。`request.signal` の abort でサンドボックスを破棄し実行を中断する + `route.test.ts` に、検査順、拒否のとき**サンドボックスが起動しない**こと、無効時の 503、`mock` での完走（成功、修正して成功、`attempt-limit`）、接続断での破棄を先に書く
  _Boundary:_ `apps/web/app/api/analysis/route.ts`, `apps/web/app/api/analysis/route.test.ts`
  _Depends:_ 19.1, 19.2, 19.3, 19.4, 18.4, 18.5
  _Requirements:_ 3.1, 3.5, 3.6, 3.7, 3.8, 3.9
  _Traces:_ REQ-003, C13
- [ ] 19.7 `DELETE /api/analysis/sessions/[id]`: サンドボックスを破棄して 204 を返す（存在しない ID も 204。ID の形式が不正なら 400）。**あるルートで作ったセッションを別のルートから破棄できる**ことを検査する + `route.test.ts` に、`/api/analysis` が作ったセッションを DELETE が実際に破棄して提供者の `close` が呼ばれること、冪等、不正な ID を先に書く
  _Boundary:_ `apps/web/app/api/analysis/sessions/[id]/route.ts`, `apps/web/app/api/analysis/sessions/[id]/route.test.ts`
  _Depends:_ 19.6
  _Requirements:_ 3.7
  _Traces:_ REQ-003, C13, CL-8

### Implementation Notes

---

## 20. 実サーバー確認と W4 の締め

_Boundary:_ `apps/web/next.config.ts`, `apps/web/e2e/real-server.spec.ts`, `mise.toml`, `stryker.config.mjs`, `specs/003-domain-agents/research.md`
_Depends:_ 19.7, 11.1
_Requirements:_ 3.1, 3.2, 3.7, 3.9
_Traces:_ REQ-003, C13, C16, R-1

- [ ] 20.1 実サーバー（`mock`）で、`@e2b/code-interpreter` がバンドルされて起動できること、`/api/analysis` が疑似提供者で完走すること、`/api/analysis` が作ったセッションを `DELETE /api/analysis/sessions/[id]` が実際に破棄すること（ルートをまたいだセッションの共有）を `real-server.spec.ts` で確かめ、`next.config.ts` の `serverExternalPackages` を必要最小限に更新する。結果を research.md の R-1 に追記する
  _Boundary:_ `apps/web/next.config.ts`, `apps/web/e2e/real-server.spec.ts`, `specs/003-domain-agents/research.md`
  _Depends:_ 19.7, 11.1
  _Requirements:_ 3.1, 3.7
  _Traces:_ REQ-003, C13, R-1
  _Verify:_ `mise run test:e2e`（実サーバー）が成功する。足した `serverExternalPackages` の理由が research.md にある
- [ ] 20.2 W4 の結線: `mise.toml` の `check:repo-rules --only` に `sandbox-import-scope` を足し、`stryker.config.mjs` に `analysis/upload-check.ts` と `analysis/output-parser.ts` を足す
  _Boundary:_ `mise.toml`, `stryker.config.mjs`
  _Depends:_ 20.1, 6.2, 17.7
  _Requirements:_ 3.2, 3.5, 3.9
  _Traces:_ REQ-003, C16
  _Verify:_ `mise run check:repo-rules` が `sandbox-import-scope` を走査 1 件以上で成功する。`mise run test:mutation` が閾値 70 を満たす
- [ ] 20.3 W4 の gate を実測して記録する。`mise run gate` の成功を引用し、所要時間を research.md に追記する。`mise run test:container` の結果（実行した場合）を併記し、Docker が無い環境では未実行と明記する
  _Boundary:_ `specs/003-domain-agents/research.md`
  _Depends:_ 20.2
  _Requirements:_ 3.8
  _Traces:_ REQ-003, C16
  _Verify:_ `mise run gate` の成功と所要時間を research.md に記録した。W4 の敵対的レビューの記録が `.sdd/reviews/003-domain-agents-impl-w4-review-*.md` にある

### Implementation Notes
