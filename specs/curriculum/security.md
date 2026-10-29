# セキュリティ補講: AI・エージェントの脅威と対策

[secure-dev-roadmap](https://github.com/Fukuchan77/secure-dev-roadmap) の学習内容のうち、本カリキュラムの題材（LLM アプリとエージェントの開発）に直結する部分を取り込んだ補講である。同リポジトリは 2026-10-11 時点の一次情報で検証されている（検証ログ: `docs/verification-log.md`）。引用する版・日付・ID は取り込み時点のもので、使う前に出典で最新を確認すること。

本書は学習用の対応表であり、要件や数値を定めない。食い違う場合は [README.md](README.md) の優先順位に従い、spec（特に 004 Req 4）を正とする。

## 1. 位置づけ

- 主に [モジュール 4-4](phase-4.md#モジュール-4-4-安全設計オブザーバビリティ)（安全設計）の補講である。[concepts.md §7](concepts.md#7-安全設計ブラスト半径の制御) の各手段が、どの脅威への対策かを示す。
- 3-1（ACI と MCP）、3-3（データ分析エージェント）、4-2（長時間実行ハーネス）も脅威の入口になる。該当箇所は §3 の対応表に挙げる。
- 認証・認可、本番デプロイは本カリキュラムの対象外である（[README.md](README.md#対象外)）。ここでは設計の考え方だけを扱う。

## 2. 中心となる原則: Least Agency

エージェントに、必要以上の自律性と権限を与えない。OWASP Top 10 for Agentic Applications 2026 の中心原則であり、本カリキュラムの次の設計と同じ方向を向いている。

| 原則 | 本カリキュラムでの現れ方 |
|---|---|
| 必要最小限のツールだけを公開する | 読み取り専用モードでは書き込み・破壊的ツールを公開しない（004 Req 4.1） |
| 副作用の大きさでツールを区分する | `defineAciTool` の必須の `risk`（`read-only` / `write` / `destructive`） |
| 破壊的な操作は人が承認する | Human-in-the-Loop の承認ゲート（004 Req 4.2〜4.5） |
| 暴走の上限を決める | 最大ステップ数・累積トークン・実行時間の強制停止条件（001 Req 6） |
| 生成コードをホストで動かさない | 使い捨てのサンドボックス・コンテナ（001 NFR 隔離実行） |

## 3. OWASP Top 10 for LLM Applications 2025 と本カリキュラム

| ID | リスク | 主な対策（secure-dev-roadmap） | 関連モジュール・箇所 |
|---|---|---|---|
| LLM01 | Prompt Injection（直接・間接） | 外部コンテンツを「データ」として隔離する、ツールの権限を分離する、出力を検証する | 4-4 外部コンテンツの扱い（004 Req 4.7、4.8、4.10） |
| LLM02 | Sensitive Information Disclosure | 入力前のマスキング、出力の DLP | 4-4 認証情報をスパンに残さない（004 Req 5） |
| LLM03 | Supply Chain | モデルやプラグインの来歴を確認する | §5、3-1 MCP |
| LLM04 | Data and Model Poisoning | 学習データ・RAG データの出所を管理する | 2-1、2-2（RAG のデータ取り込み） |
| LLM05 | Improper Output Handling | 出力を信頼しない。SQL・HTML・シェルへ渡す前にエスケープ・検証する | 4-4 出力のサニタイズ（004 Req 4.9）、1-3 構造化出力 |
| LLM06 | Excessive Agency | 最小権限、破壊的な操作には人の承認を挟む | 3-1 ACI、4-4 承認ゲート |
| LLM07 | System Prompt Leakage | システムプロンプトに秘密情報を入れない | 4-1 コンテキストエンジニアリング |
| LLM08 | Vector and Embedding Weaknesses | ベクトル DB にもテナント分離とアクセス制御をかける | 2-1（pgvector） |
| LLM09 | Misinformation | 根拠の提示、人によるレビュー | 2-2 Advanced RAG、4-3 Evals |
| LLM10 | Unbounded Consumption | トークン数・回数・コストの上限 | 強制停止条件（001 Req 6） |

## 4. OWASP Top 10 for Agentic Applications 2026（ASI01〜ASI10）

2025-12 公開。2026-06 に v2.01 へ更新されたとの二次情報があるため、引用する際は <https://genai.owasp.org/> の最新版を確認する。

| ID | リスク | 設計上の対策 | 関連モジュール・箇所 |
|---|---|---|---|
| ASI01 | Agent Goal Hijack | 指示とデータの分離、目標の逸脱を検知する | 4-4 外部コンテンツの扱い |
| ASI02 | Tool Misuse and Exploitation | ツールごとの許可リスト、パラメータのスキーマ検証 | 3-1（`inputSchema` の Zod 検証、ポカヨケ） |
| ASI03 | Identity and Privilege Abuse | エージェント専用の ID、ユーザー権限を丸ごと委譲しない | 3-1、3-2（本カリキュラムでは認可は対象外。設計上の注意に留める） |
| ASI04 | Agentic Supply Chain Vulnerabilities | MCP サーバー・プラグインの来歴確認、バージョン固定 | 3-1 MCP、§5 |
| ASI05 | Unexpected Code Execution（RCE） | サンドボックス、ネットワーク遮断（ローカルのコンテナは `NetworkMode: none`。E2B は既定で外向き通信が可能で、制限は 004 Req 4 で再検討する） | 3-3、4-2（生成コードの隔離実行） |
| ASI06 | Memory and Context Poisoning | 長期メモリへの書き込みを検証し、出所を記録する | 4-1 メモリ、2-4 |
| ASI07 | Insecure Inter-Agent Communication | エージェント間の相互認証、メッセージ署名 | 3-4 階層型リサーチ（マルチエージェント） |
| ASI08 | Cascading Failures | サーキットブレーカー、レート制限 | 強制停止条件、4-2 |
| ASI09 | Human-Agent Trust Exploitation | 承認画面に根拠と影響範囲を明示する | 4-4 承認 UI（ツール名と引数を示す） |
| ASI10 | Rogue Agents | キルスイッチ、振る舞いの監視 | 4-4 オブザーバビリティ、監査ログ |

## 5. ガードレールの全体像と監査ログ

```text
[ユーザー入力] ─> 入力ガードレール
       │
       ▼
[LLM / エージェント] ── 外部コンテンツは「データ」としてタグ付けし、指示として扱わない
       │ ツール呼び出しの要求
       ▼
[ポリシーの強制（fail-closed）]
   ├─ ツールの許可リストとパラメータのスキーマ検証
   ├─ 破壊的な操作は人の承認（Human-in-the-Loop）
   └─ レートとコストの上限、キルスイッチ
       │
       ▼
[監査ログ（改ざん検知付き）] ── 入力・ツール名・引数・結果・承認者を記録
```

- 監査ログには**入力・ツール呼び出し・結果・承認の記録**を残す。思考過程（Chain-of-Thought）の保存は、機密情報を含むおそれがあり、モデルによっては取得できないため推奨しない。
- 「fail-closed」とは、ポリシーの判定に失敗したとき、許可ではなく拒否に倒すことである。
- ベンダー製品（Microsoft Agent Governance Toolkit など）の「OWASP Agentic Top 10 を 10/10 カバー」は自己申告である。導入前に、配布元（README に明記されたもの）、ライセンス、プレビュー段階かどうかを自分で確認する。

## 6. 開発基盤のサプライチェーン対策

OWASP Top 10:2025 では「A03 Software Supply Chain Failures」が独立した。**脆弱性の検出（audit）だけでは足りず**、(1) 悪性の新版を入れない、(2) インストール時に実行させない、(3) 公開用の長期トークンを持たない、の3つが要る。本リポジトリの基盤との対応は次のとおり。

| 対策 | 内容 | 本リポジトリでの対応 |
|---|---|---|
| リリース直後の版を避ける | pnpm の `minimumReleaseAge`（pnpm 11 の既定は 1440 分） | `pnpm-workspace.yaml` で設定済み |
| インストール時の実行を許可制にする | `allowBuilds` で許可したパッケージだけがビルドスクリプトを実行できる | `allowBuilds` を設定済み。理由の記載は `allow-builds-reasoned` ルールで検査 |
| lockfile を固定する | CI では `pnpm install --frozen-lockfile` | `frozen-lockfile` ルールで検査 |
| 依存の脆弱性を検出する | `pnpm audit --audit-level high --prod` | CI の `audit` ジョブ |
| GitHub Actions を SHA で固定する | `uses:` を40桁のコミット SHA にする。タグは書き換えられる（tj-actions 2025-03、Trivy 2026-03 の侵害） | `actions-pinned` ルールで検査 |
| ワークフローの最小権限 | `permissions: contents: read` から始める、`pull_request_target` は使わない、`persist-credentials: false` | 学習課題: `.github/workflows/ci.yml` を点検する |
| 静的監査・実行時監視 | zizmor、StepSecurity harden-runner | 未導入。導入候補 |
| 更新の自動化 | Dependabot の `cooldown`（7日程度） | `.github/dependabot.yml` で設定済み |
| シークレットの検出 | gitleaks | `secret-scan` タスク |

> ⚠ npm の classic トークンは 2025-12-09 にすべて失効した。パッケージを公開する場合は Trusted Publishing（OIDC）を使う。
> ⚠ `uv audit` はプレビュー機能で、OSV の応答件数が不足すると「脆弱性なし」で終了コード 0 を返すという報告がある（astral-sh/uv#22102）。Python 依存を扱う場合は pip-audit と併用し、単独のゲートにしない。

## 7. 評価・レッドチーミングの道具

PyRIT（Microsoft）、garak（NVIDIA）、promptfoo（OWASP の LLM・Agentic 向けプラグインあり）、NeMo Guardrails、LlamaFirewall と Prompt Guard（Meta）。最新版とライセンスは各公式で確認する。モジュール 4-3 の Evals に、プロンプトインジェクションへの耐性を測る回帰評価を足す際の参考になる。

演習対象には [damn-vulnerable-llm-agent](https://github.com/ReversecLabs/damn-vulnerable-llm-agent)（LLM エージェントへのプロンプトインジェクション）がある。**自分が管理する隔離環境だけで使い**、第三者のシステムへの診断やスキャンは書面の許可なしに行わない。

## 8. 学習課題（任意）

1. 3-1 で定義した各ツールの `risk` を見直し、LLM06 / ASI02 の観点で「もっと狭められる権限」を1つ挙げる。
2. 4-4 の承認ゲートについて、ASI09 の観点で、承認画面に「根拠」と「影響範囲」が表示されているかを確認する。
3. 外部コンテンツ（Web 検索、YouTube 字幕）を取り込む run に、指示を含むテキストを混ぜた回帰評価を設計する（LLM01 / ASI01）。パターン検知は補助で、承認ゲートの代わりにならない点を確かめる。
4. `.github/workflows/ci.yml` を §6 の表で点検し、足りない対策を一覧にする。

## 9. 出典

- [secure-dev-roadmap](https://github.com/Fukuchan77/secure-dev-roadmap): `docs/03-supply-chain-sca.md`、`docs/04-cicd-hardening.md`、`docs/06-ai-agent-security.md`、`docs/references.md`、`docs/verification-log.md`
- OWASP GenAI Security Project: <https://genai.owasp.org/>
- OWASP Top 10:2025: <https://owasp.org/Top10/2025/>
- Microsoft Open Source Blog, [Introducing the Agent Governance Toolkit](https://opensource.microsoft.com/blog/2026/04/02/introducing-the-agent-governance-toolkit-open-source-runtime-security-for-ai-agents/)
