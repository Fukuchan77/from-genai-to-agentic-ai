# Task 3.1 敵対的レビュー

## Critique

**対象**: `compose.yaml`、Task 3.1 に対応する `specs/001-agentic-ai-platform/{spec.md,plan.md,tasks.md}`、`.sdd/steering/*.md`、`specs/001-agentic-ai-platform/pdca/do.md`、関連未コミット差分。

**リスクトリガーの解決**: 物理的には境界外変更を確認した。Task 3.1 の `_Boundary:_` は `compose.yaml` のみだが、`specs/001-agentic-ai-platform/tasks.md` と `specs/001-agentic-ai-platform/pdca/do.md` も変更されている。ただし差分内容は、前者が Task 3.1 のチェックボックス `[ ]` → `[x]` の1箇所、後者が RED / GREEN / PROVE / runtime / gate の管理証跡追記だけであり、要件、設計、コマンド、実装挙動は変更していない。ユーザーが明示した必須管理更新の範囲に限定されているため、実装境界の逸脱として verdict を下げない。

**独立検証結果（2026-09-27）**:

- `docker compose config --profiles` は `db` / `trace` を返した。
- `db` は `postgres` のみ、`trace` は `postgres`、`langfuse-web`、`langfuse-worker`、`clickhouse`、`redis`、`minio` の6サービスを解決した。
- 解決後設定では6サービスすべてに healthcheck があり、web / worker は Postgres、ClickHouse、Redis、MinIO の `service_healthy` を待つ。
- 全公開ポートは `127.0.0.1` に限定されている。
- `mise run services:up` は exit 0。独立取得した `docker compose ps` では6/6サービスが `running` / `healthy` だった。
- Langfuse health endpoint は HTTP 200 と `version: 4.46.0`、Web root は HTTP 200、OTLP traces endpoint は認証なしの POST に HTTP 401 `No authorization header` を返した。したがって Web と認証付き OTLP 受信経路は存在する。
- クリーンな Postgres 初期化ログでは、Langfuse DB が最初は存在せず Prisma P1003 になった後、Langfuse web が DB を作成し、Postgres / ClickHouse migration を完了して healthy になった。Task 3.1 単体でも Langfuse v4 一式は起動できる。
- `mise run gate` は exit 0、Biome は7ファイルを走査した。

### [MEDIUM] Compose イメージが可変タグのため、同じコミットでも将来別バイナリを起動する
**Location**: `compose.yaml:54`, `compose.yaml:76`, `compose.yaml:92`, `compose.yaml:105`, `compose.yaml:127`, `compose.yaml:150`
**Issue**: 全サービスが major / calendar 系の可変タグ、またはタグ省略であり、再 pull 時に実体が変わるため、教材の再現性とサプライチェーン監査性がコミットに固定されていない。
**Evidence**: `pgvector/pgvector:pg17`、Langfuse web / worker の `:4`、ClickHouse `:25.12`、Redis `:7`、タグ省略の `cgr.dev/chainguard/minio` を使っている。独立実行時の `:4` は Langfuse `4.46.0` に解決されたが、このパッチ版は Compose ファイルから確定できない。特にタグ省略の MinIO は更新範囲が最も広い。一方、Task 3.1 と plan C3 はこれらの系列名を要求しており、現時点の動作は要件どおりなので阻害事項とはしない。
**Confidence**: high
**Fix**: 読みやすいタグを残しつつ digest（`image: repository:tag@sha256:...`）まで固定するか、少なくとも検証済みの完全なパッチタグに固定し、更新手順を文書化する。

### [LOW] 既知の開発用秘密値が自動適用され、補助サービスの管理ポートもすべて公開される
**Location**: `compose.yaml:7-8`, `compose.yaml:12-13`, `compose.yaml:17-18`, `compose.yaml:24-25`, `compose.yaml:32`, `compose.yaml:58-60`, `compose.yaml:82`, `compose.yaml:113-115`, `compose.yaml:138-139`, `compose.yaml:158-160`
**Issue**: `.env` を用意しなくても既知の DB / Redis / MinIO / Langfuse 秘密値で起動し、Web UI 以外に Postgres、ClickHouse、Redis、MinIO API / console もホストへ公開するため、ローカルプロセスからの攻撃面が必要以上に広い。
**Evidence**: `postgres` / `clickhouse` / `redis-secret` / `miniosecret` / `development-secret-change-me` / 全ゼロの encryption key が fallback である。外部インターフェースはすべて `127.0.0.1` に限定されており、リモート公開ではないため重大度は LOW とする。
**Confidence**: high
**Fix**: 学習者向け自動生成 `.env` または必須変数検査を用意する。ホストから直接使わない ClickHouse native port、Redis、worker、MinIO console などは公開を外すか、明示的な debug profile に分離する。

### [LOW] 「29 assertions」と PROVE の静的検査をリポジトリから再現できない
**Location**: `specs/001-agentic-ai-platform/pdca/do.md:579-589`
**Issue**: PDCA は静的受け入れ検査29件と mutation failure を主張するが、実行コマンド、スクリプト本体、保存ログがなく、第三者は同じ29件を再実行できない。
**Evidence**: 記録は `Task 3.1 compose acceptance checks: 29 assertions passed` と、Postgres image を壊した際の `AssertionError` だけであり、どの29条件をどのコードで検査したかは残っていない。今回のレビューではプロファイル、サービス集合、healthcheck、依存条件、ポート、runtime health、Web / OTLP 到達性を独立再検証できたため、実装の合否を妨げる欠陥ではない。
**Confidence**: high
**Fix**: 境界を増やさない方針なら、PDCA に完全な再実行コマンドと assertion 一覧を記録する。継続的な回帰検査にするなら、別タスクで Compose 静的検査スクリプトを宣言・追加する。

### [LOW] Task 3.1 の起動で作成した永続 Postgres volume には、後続 Task 3.2 の init SQL が自動適用されない
**Location**: `compose.yaml:65-67`, `compose.yaml:170-172`, `specs/001-agentic-ai-platform/tasks.md:209-214`
**Issue**: Task 3.1 の検証が空の永続 volume を初期化した後に Task 3.2 で `01-extensions.sql` を追加しても、Postgres entrypoint は既存 data directory に init scripts を再実行しない。
**Evidence**: 独立取得した初回ログは `/docker-entrypoint-initdb.d/*` を無視して初期化を完了しており、`services:down` も `-v` を付けないため volume を保持する。最終的なクリーン clone では SQL が初回起動前に存在するので製品欠陥ではないが、タスク順どおりの実装・検証では Task 3.2 の確認前に volume の再作成が必要になる。
**Confidence**: high
**Fix**: Task 3.2 の検証手順に、対象 project の Postgres volume を明示的に再作成する手順、または既存 DB に冪等に SQL を適用する手順を追加する。削除対象を限定し、他プロジェクトの volume を消さないこと。

## Verdict
APPROVE_WITH_NOTES

## Hallucination Signal
forced: false
