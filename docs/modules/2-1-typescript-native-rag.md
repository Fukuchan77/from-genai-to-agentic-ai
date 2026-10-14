# 2-1 TypeScript ネイティブ RAG

- **フェーズ**: Phase 2 発展編。IBM 成熟度モデルの Level 1（Generative AI）の水準で、検索を足して回答の根拠を示す RAG を作ります。最後に、検索をツールにして必要なときだけ呼ぶ Agentic RAG（Level 2 の入口）との違いを確かめます（[phase-2.md](../phases/phase-2.md)）
- **要件**: [spec 002](../../specs/002-rag-and-workflows/spec.md) の Requirement 1（1.1〜1.12）。解説の必須事項として 001 の Requirement 2.16、7.2〜7.6、7.9
- **実装**: `packages/ai-core/src/rag/`、`packages/ai-core/drizzle/`、`apps/web/app/api/rag/`、`apps/web/components/rag/`、`apps/web/app/rag/`

## 学習目標

このモジュールを終えると、次のことができます。

- LCEL のブラックボックスを使わず、非同期関数の合成で、取り込み・分割・埋め込み・検索・回答・引用の各段を読める RAG を実装できる。
- Markdown の見出し境界と文字数の上限でチャンクを分割し、再取り込みでチャンクが重複しないように ID と置換を設計できる。
- 類似度の閾値で「該当なし」を判定し、根拠がないときにモデルを呼ばず、推測で回答しない設計にできる。ただし、日本語の埋め込みでは閾値が弱い防御であることを説明できる。
- 回答の脚注 `[n]` を、そのリクエストで取得したチャンクと照合し、範囲外の引用を除去して記録できる。
- 常に検索する RAG と、検索をツールにして必要なときだけ呼ぶ Agentic RAG の違いを説明し、使い分けられる。
- `mock` の緑が何を保証し、何を保証しないかを説明できる。

## 主要トピック

扱う概念は次の8つです。

1. LCEL を使わない非同期関数の合成による RAG
2. チャンク分割の戦略と Markdown の見出し境界
3. 埋め込みと pgvector によるコサイン類似度検索
4. 根拠がないときに推測で回答しない設計（類似度の閾値）
5. 引用の検証
6. 常に検索する RAG と Agentic RAG の違い
7. `mock` の緑が保証しないもの
8. 日本語の埋め込みでの閾値の限界

### LCEL を使わない非同期関数の合成による RAG

元教材は LangChain の LCEL（`retriever | prompt | llm | parser`）で RAG を組みます。本リポジトリは、段ごとに引数と戻り値の型が見える TypeScript の関数を、`await` で合成します。

```text
ingestDocuments        読み込み → 分割 → 埋め込み → 1 つのトランザクションで保存
streamRagQuery         検索（runRetrieval）→ 回答の生成（streamRagAnswer）→ 引用の照合（resolveCitations）
```

| 段 | 関数 | 場所 |
|---|---|---|
| 取り込み | `ingestDocuments` | `rag/ingest/ingest.ts` |
| 分割 | `splitMarkdown`、`chunkDocument` | `rag/ingest/markdown.ts`、`chunk.ts` |
| 埋め込み | `embedTexts`、`embedQuery` | `rag/embedding.ts` |
| 保存と検索 | `createKnowledgeStore` | `rag/store.ts` |
| 検索のパイプライン | `runRetrieval` | `rag/retrieve/pipeline.ts` |
| 回答 | `streamRagAnswer`、`buildAnswerPrompt` | `rag/answer/prompt.ts` |
| 引用の照合 | `resolveCitations` | `rag/answer/citations.ts` |
| 全体の合成 | `streamRagQuery` | `rag/query.ts` |

各段が独立した関数なので、段ごとにテストでき、`mock` の埋め込みやモデルを引数で差し替えられます。Route Handler（`/api/rag/query`）は、検査 → モデルの解決 → `streamRagQuery` の呼び出し → ストリームへの変換だけを行い、RAG のロジックを持ちません。進行状況と中間結果は、回答の本文とは別の `data-*` パートで UI へ流します（2-2 で扱います）。

### チャンク分割の戦略と Markdown の見出し境界

文字数だけで切ると、1 つのチャンクに別の話題が混ざります。本リポジトリは次の順で分割します（Req 1.2）。

1. **見出しの境界**で分ける（`splitMarkdown`）。ATX 見出し（`#`〜`######`）の階層を `headingPath`（例: `["チャンク分割", "サイズ"]`）として保ち、コードフェンスの中の `#` は見出しにしません。1 つのチャンクが複数の見出しセクションをまたぎません。
2. 1 つのセクションが上限（既定 800 文字）を超えるときだけ、**段落**で、それでも長ければ**文**の境界で、最後の手段として文字数で分ける（`chunkDocument`）。文字数はコードポイントで数えるので、サロゲートペアの途中では切りません。

チャンクの ID は `sha256(文書 ID + 見出しの階層 + 本文)` の先頭 16 桁（内容ハッシュ）です。同じ文書を同じ内容で取り込み直すと同じ ID になり、本文を 1 文字変えるとその見出しのチャンク ID が変わります。評価用の質問セットが正解として持つチャンク ID はこの性質に依存します。**文書を編集したら、評価セットの検証テスト（`rag-eval-set.db.test.ts`）が正解 ID のずれを検出します。**

再取り込み（Req 1.3）は文書単位の置換です。1 つのトランザクションで、その文書のチャンクを削除してから挿入します。埋め込みはトランザクションの前に計算するので、埋め込みに失敗しても既存のチャンクは残ります。文書 ID は取り込み元の接頭辞（`kb:` = `knowledge/`、`eval:` = 評価コーパス）とファイル名なので、同じ名前のファイルが別の取り込み元と衝突しません。

PDF は `unpdf` でページごとにテキストを取り出し、ページ番号を出典として持たせます。テキスト層のない PDF（スキャン画像）は OCR しないので、理由「テキストなし」でスキップし、取り込み結果に含めます（Req 1.8）。

### 埋め込みと pgvector によるコサイン類似度検索

埋め込みは AI SDK の `embedMany` / `embed` で作り、`vector(768)` 列に保存して、pgvector の `<=>`（コサイン距離）で検索します。類似度は `1 - コサイン距離` で、−1〜1 です。HNSW インデックスが検索を速くします。クエリは `drizzle-orm` の型付きクエリビルダーで書き、メタデータフィルタ（文書、タグ）も同じクエリに入ります（Req 1.6）。

- **次元は 768 に統一**します。OpenAI は `dimensions: 768`、Google は `outputDimensionality: 768` を `providerOptions` で指定し、`local`（Ollama）と `mock` は 768 です。次元が違うと既存のベクトルを使えません。
- **ナレッジベースに埋め込みモデルを記録**します（`rag_meta`）。取り込み・検索のたびに現在のモデルと照合し、別のモデルなら `reset: true` で作り直すまで拒否します。モデルが違うと同じ文章のベクトルが別物になり、検索が静かに壊れるからです。
- `live` の Anthropic の既定には埋め込みモデルがありません。`AI_MODEL_EMBEDDING` と、そのプロバイダの API キーを設定します（設定が無ければ、案内付きのエラーになります）。

テーブルの定義は `packages/ai-core/drizzle/NNNN_<name>.sql` の手書きの SQL で、自前の小さなマイグレーターが順に適用します。`drizzle-kit` は依存の監査（`npm audit`）で中程度の指摘を持ち込むため採りません。型付きクエリ用の `schema.ts` との乖離は、スキーマ照合テストが検出します。

### 根拠がないときに推測で回答しない設計（類似度の閾値）

質問のベクトルと類似度が閾値（既定 0.5）以上のチャンクが **1 件も無い**ときは、モデルを呼ばず、固定の「該当なし」の文を返します（Req 1.7）。モデルに「根拠が無ければ答えないで」と頼むだけでは、頼みを無視して推測で答えることがあります。**呼ばないこと**が確実な防御です。空のナレッジベースでは、質問の埋め込みも呼びません。

回答プロンプトも、資料にない内容を推測で補わないこと、根拠が無い場合は「該当なし」と答えることを要求します。ただし、これはモデルが守るかどうかに依存する二つ目の防御です。

「該当なし」の判定は、ベクトル検索の閾値**だけ**で行います（全文検索の一致は、キーワード一致を回収するためのもので、閾値の対象外）。全文検索に当たっても、ベクトル検索が閾値に届かなければ「該当なし」です。

### 引用の検証

回答プロンプトは、取得したチャンクに 1 から始まる序数ラベルを付け、根拠にした資料を `[1]` の形で文末に付けさせます。サーバーは回答テキストの `[n]` を解析して、次のように処理します（Req 1.5、1.11）。

- `n` が 1〜取得件数の範囲にあれば、その序数に対応するチャンクの引用（文書名、ページまたは見出し、本文抜粋）に `cited: true` を付ける。
- 範囲外の `[7]` のような脚注は、**回答から除去**し、除去した序数を `removedCitations` に記録する。
- 返す引用は**取得した全チャンク**で、脚注が参照したものにだけ `cited: true` が付く。モデルが脚注を付けなくても、根拠の候補を UI に出せる。

つまり、モデルが存在しないチャンクを引用しても、それは回答に残りません。コードブロックの中の `[1]` は脚注として扱いません。UI は、ストリーム中の本文を、除去後の確定版（`data-rag-result` の `answer`）に置き換えます。

小型のモデルの失敗は、偽の ID を作ることよりも、**脚注を付けないこと**のほうが多いという観察があります（[research I-7](../../specs/002-rag-and-workflows/research.md)）。「引用を付ける」ことは、モデルの遵守に頼る部分で、「付いた引用が取得した範囲に収まる」ことがコードの保証です。

### 常に検索する RAG と Agentic RAG の違い

| | 常に検索する RAG | Agentic RAG |
|---|---|---|
| 検索するか | 質問ごとに必ず検索する | エージェントが、検索の要否・クエリ・回数を判断する |
| 実装 | `streamRagQuery`（固定の段） | 検索を `searchKnowledgeBase` ツール（`risk: "read-only"`）にして `createGuardedAgent` に渡す |
| 無関係な質問 | 検索して、閾値に届かず「該当なし」 | 検索せずに答えられる。結果に、検索ツールを呼んだかどうかを含める（Req 1.10） |
| コスト・予測可能性 | 呼び出し回数が決まっている | 検索の回数が変わり、上限（ステップ数・トークン・時間）が必要 |
| 向く場面 | 質問がほぼ常にナレッジベースの内容 | 雑談や無関係な質問が混ざる。複数回の検索が要る |

Agentic RAG の検索ツールは、取得したチャンクにリクエスト内で通し番号を付ける登録簿（`createCitationRegistry`）を持ち、複数回の検索でも同じチャンクには同じ番号を返します。脚注の照合は、常に検索する RAG と同じ `resolveCitations` です。

### `mock` の緑が保証しないもの

`mock` は、`mise run gate` が使う決定論的なモードです。埋め込みは入力の SHA-256 から作る乱数ベクトルで、**同じ文は 1.0、異なる文はほぼ 0** になります（001 Req 2.16）。したがって、gate の緑が保証するのは次のものだけです。

- 算術（RRF のスコア、recall の計算、閾値の境界）、制御フロー（分岐、中断、再生成）、型、SQL の正しさ（PGlite で実行）
- 評価の配管（正解チャンク ID が実在する。質問が本文と同じとき recall@1 が 1.0 になる）

保証**しない**ものは次のとおりです。

- **検索の効果の差。** HyDE、Multi-Query、ハイブリッド、Rerank の組み合わせでどれが recall を上げるか。意味を持たない埋め込みでは、差が出ません。`*.local.test.ts`（実際の Ollama）だけが示します。
- **日本語の埋め込みの品質と、閾値の妥当性。**
- **`local` のモデルが構造化出力や脚注を守る割合。**
- **実 Postgres（PostgreSQL 17 + pgvector）での挙動。** gate の SQL は PGlite（PostgreSQL 18 の WASM）で実行します。実 Postgres は `*.pg.test.ts`（`mise run test:db`、Docker が必要）だけが確かめます。
- **Cohere の実際の呼び出し。**

「テストが緑」と「検索が良い」は別のことです。

#### Req 1.12: インプロセス DB で実行できるテストの分類

ベクトル検索・全文検索・RRF を使うテストを、PGlite で gate に含められるもの（`*.db.test.ts`）と、実 Postgres が要るもの（`*.pg.test.ts`、別タスク）に分類しました。分類は PGlite で実測した結果に基づきます。

| テスト対象 | gate（`*.db.test.ts`、PGlite） | 別タスク（`*.pg.test.ts`） |
|---|---|---|
| ベクトル検索（`<=>`、フィルタ）、HNSW の作成 | 実行できる | 同じケースを再実行 |
| 全文検索（`simple` + 分かち書き、GIN） | 実行できる | 同じケースを再実行 |
| 置換、ロールバック | 実行できる | 同時取り込みの競合 |
| RRF | 実行できる（純関数で DB 不要） | — |
| 初期化 SQL による拡張の作成、postgres.js 経由の接続 | 実行できない | 実行する |

PGlite は起動に約 1 秒で、`fetch` / `node:net` を使わないため、ネットワーク遮断下の gate でも動きます。詳しい実測と根拠は [research.md の I-1 と Req 1.12 の分類](../../specs/002-rag-and-workflows/research.md)にあります。

### 日本語の埋め込みでの閾値の限界

閾値 0.5 で「該当なし」を分けられるのは、**関連する質問と無関係な質問の類似度が分離しているとき**だけです。`local` の埋め込み（`catalog: local.ollama.embedding`）で日本語を測ると、分離しませんでした（[research I-8](../../specs/002-rag-and-workflows/research.md)）。

2026-10-13 に、評価用コーパス（6 文書）に対して、各質問の最上位のチャンクのコサイン類似度を測りました（[research.md の「M2 実測（W6）」](../../specs/002-rag-and-workflows/research.md)、25.1-d）。

| 質問 | 件数 | 最小 | 中央値 | 最大 | 閾値 0.5 以上 |
|---|---|---|---|---|---|
| コーパスに答えがある | 32 | 0.710 | 0.822 | 0.938 | 32/32 |
| コーパスに答えが無い（天気、料理など） | 8 | 0.627 | 0.706 | 0.746 | **8/8** |

**既定の閾値 0.5 では、答えが無い質問でも「該当なし」になりませんでした。** 2 つの分布は 0.71〜0.75 で重なり、単一の閾値では分けられません。この数値は `local` の埋め込みモデル（`catalog: local.ollama.embedding`）が決める性質で、このコーパスと質問での観察です。別の埋め込みモデルや文書では変わるので、自分の環境で測ってください（`rag-retrieval.local.test.ts` の類似度のテストが分布を出力します。LLM を使わず数秒で終わります。実行方法は [テストの置き場所](../../packages/eval-suite/tests/capability/README.md) を見てください）。四分位と中央値は最近順位です。2 つの行は同じ 1 回の実行（2026-10-14 の再実行）で測りました。

したがって、`local` の日本語では閾値は**弱い防御**です。次のように使います。

- 閾値は要件どおり実装し、リクエストで変更できます。関連と無関係の分布を測ってから決めます。
- 回答プロンプトでも「根拠が無ければ該当なし」を要求します（二つ目の防御）。
- 検索精度の比較は、閾値の分離力に依存しない指標（recall@k）で行います（2-2）。
- 閾値だけに頼らず、引用（どの資料を根拠にしたか）を人が確かめられる UI にします。

## ハンズオン手順

### 手順 1: ナレッジベースを作る

- 実行モード: `local`（原則）。`mock`（PGlite）でも動く
- 外部サービス: `local` は Ollama の起動と、`catalog: local.ollama.embedding` および `catalog: local.ollama.chat` のモデルの取得、Docker の Postgres（pgvector 入り）。`mock` はなし

```text
mise run services:up:db     # Docker の Postgres を起動し、healthy になるまで待つ
mise run dev                # http://localhost:3000/rag を開く
```

`knowledge/` に Markdown または PDF を置き、画面の取り込みで選んで実行します（評価コーパスを使うときは取り込み元に「評価用コーパス」を選びます。6 文書が入ります）。**同じ文書をもう一度取り込んで、チャンク数が増えない**ことを確かめます。`mock` では PGlite を使い、Docker は不要です（サーバーを再起動すると消えます）。

### 手順 2: 引用付きの回答を読む

- 実行モード: `local`（`mock` でも画面の流れは確かめられる）
- 外部サービス: 手順 1 と同じ

評価コーパスを取り込み、「RAG とは何ですか。」と質問します（`local` の場合。**`mock` の埋め込みは、チャンクの本文と完全に同じ文字列の質問にしか類似度が出ません**。`mock` で画面の流れを見るときは、評価用コーパスの文書から段落を 1 つコピーして質問に貼ります。自然な質問は「該当なし」になります）。回答に脚注 `[n]` が付き、回答の下に引用のカード（文書名、見出し、本文抜粋）が並ぶことを確かめます。脚注を押すと、対応するカードにフォーカスが移ります。

### 手順 3: 「該当なし」を確かめる

- 実行モード: `mock`（前半）、`local`（後半）
- 外部サービス: 前半はなし。後半は Ollama と Docker の Postgres

前半（`mock`）: ナレッジベースを空にして質問し、モデルが呼ばれずに「該当なし」の文が返ることを確かめます。

後半（`local`）: 評価コーパスを取り込み、答えがある質問と無関係な質問（天気など）を、類似度の閾値を変えながら送ります。上の表のとおり、既定の 0.5 では無関係な質問も「該当なし」にならず、0.75 付近まで上げると無関係な質問は「該当なし」になりますが、答えがある質問の一部も落ちます。`mock` の埋め込みは完全一致の質問にしか類似度が出ないので、閾値の実験は `mock` では意味のある結果になりません。

### 手順 4: Agentic RAG に切り替える

- 実行モード: `local`
- 外部サービス: Ollama、Docker の Postgres

Agentic RAG に切り替え、ナレッジベースの内容を問う質問と、無関係な質問（例: 挨拶）を送ります。結果に「検索した」「検索せずに答えた」が表示されることを確かめます。

### 手順 5: 実 Postgres のテストを実行する

- 実行モード: `mock`（テストの既定）。実 Postgres に接続する
- 外部サービス: Docker

```text
mise run test:db
```

`*.pg.test.ts` が、PGlite と同じ SQL を実際の Postgres で実行します。gate で緑でも、この結果はまだ確認されていません。

## 習熟度判定チェックリスト

自動テストで確かめられる項目にはテストへの参照があります。`*.pg.test.ts` と `local` 専用のテストを参照する項目は、gate では実行されません（`test:db` / `test:local` でだけ実行され、Docker や Ollama が無い環境ではスキップまたは未実行になります）。

- [ ] Markdown を見出し境界で分け、1 つのチャンクが複数の見出しセクションをまたがない <!-- test: packages/ai-core/src/rag/ingest/markdown.test.ts#splits at heading boundaries so no section spans two headings -->
- [ ] コードフェンスの中の `#` を見出しとして扱わない <!-- test: packages/ai-core/src/rag/ingest/markdown.test.ts#does not treat # lines inside fenced code blocks as headings -->
- [ ] 長いセクションを、段落、次に文の境界で分ける <!-- test: packages/ai-core/src/rag/ingest/chunk.test.ts#splits an over-long paragraph at sentence boundaries -->
- [ ] 同じ文書を再取り込みしても、チャンクが重複しない <!-- test: packages/ai-core/src/rag/ingest/ingest.db.test.ts#replaces a re-ingested document instead of duplicating it -->
- [ ] 埋め込みに失敗しても、既存のチャンクが残る <!-- test: packages/ai-core/src/rag/ingest/ingest.db.test.ts#keeps the existing chunks when the embedding call fails -->
- [ ] 別の埋め込みモデルでの取り込みを拒否し、`reset` で作り直せる <!-- test: packages/ai-core/src/rag/ingest/ingest.db.test.ts#rejects another embedding model, then rebuilds the base with reset -->
- [ ] 取り込めないファイルをスキップし、理由を結果に含める <!-- test: packages/ai-core/src/rag/ingest/ingest.db.test.ts#reports every skip reason and still ingests the remaining files -->
- [ ] 類似度の上位 k 件を返し、閾値と同じ値は残す <!-- test: packages/ai-core/src/rag/retrieve/pipeline.db.test.ts#keeps a chunk whose similarity equals the threshold and drops one just above it -->
- [ ] 閾値以上の候補が無いときは「該当なし」で、モデルを呼ばない <!-- test: packages/ai-core/src/rag/query.db.test.ts#does not call the language model when there is no evidence -->
- [ ] 空のナレッジベースでは、埋め込みも呼ばずに「該当なし」を返す <!-- test: packages/ai-core/src/rag/retrieve/pipeline.db.test.ts#reports no evidence for an empty knowledge base without calling the embedding model -->
- [ ] 範囲外の脚注を回答から除去して記録する <!-- test: packages/ai-core/src/rag/answer/citations.test.ts#removes [7] from the answer and records it, keeping the valid footnotes -->
- [ ] 回答プロンプトが、取得順の番号を付け、資料だけを根拠にするよう指示する <!-- test: packages/ai-core/src/rag/answer/prompt.test.ts#tells the model to answer only from the sources, cite their numbers, and say so when there is no evidence -->
- [ ] チャンク内のタグでデータのブロックを閉じさせない <!-- test: packages/ai-core/src/rag/answer/prompt.test.ts#escapes source tags inside a chunk so it cannot close the data block -->
- [ ] Agentic RAG は、検索ツールを呼ばなかったことを結果で報告する <!-- test: packages/ai-core/src/rag/agentic.db.test.ts#reports that no search happened when the tool was never called -->
- [ ] Agentic RAG は、複数回の検索でも同じチャンクに同じ番号を返す <!-- test: packages/ai-core/src/rag/agentic.db.test.ts#gives the same label when a later search returns the same chunk -->
- [ ] 実 Postgres でも、cosine 距離の順位が PGlite と同じである（`test:db` で実行） <!-- test: packages/ai-core/src/rag/store.pg.test.ts#orders by cosine distance with the same similarities as PGlite -->
- [ ] 評価用の質問セットの正解 ID がコーパスに実在し、評価の配管が緑である <!-- test: packages/eval-suite/tests/regression/rag-eval-set.db.test.ts#only labels chunk IDs that exist in the ingested evaluation corpus -->
- [ ] `mock` の緑が保証しないものを 5 つ挙げられる（手で確かめる）
- [ ] 日本語の埋め込みで閾値が弱い防御になる理由を、類似度の分布で説明できる（手で確かめる）

## リファレンス実装とテストの所在

| 項目 | パス |
|---|---|
| 取り込み、分割 | `packages/ai-core/src/rag/ingest/`（`ingest.ts`、`markdown.ts`、`chunk.ts`、`loader.ts`、`pdf.ts`、`search-text.ts`） |
| 埋め込み | `rag/embedding.ts` |
| ストアと DB 層 | `rag/store.ts`、`rag/db/`、`packages/ai-core/drizzle/` |
| 検索、回答、引用 | `rag/retrieve/pipeline.ts`、`rag/answer/`、`rag/query.ts` |
| Agentic RAG | `rag/agentic.ts`、`aci/tools/search-knowledge-base.ts` |
| リクエストの検査 | `rag/request-schema.ts` |
| HTTP | `apps/web/app/api/rag/ingest`、`query`、`agent`、`knowledge` |
| 画面 | `apps/web/app/rag/page.tsx`、`apps/web/components/rag/` |
| 評価コーパスと質問セット | `packages/ai-core/fixtures/rag/` |
| ゲートのテスト（PGlite） | `rag/**/*.db.test.ts`、`packages/eval-suite/tests/regression/rag-eval-set.db.test.ts` |
| 実 Postgres のテスト | `rag/store.pg.test.ts`（`mise run test:db`） |
| E2E | `apps/web/e2e/rag.spec.ts` |

## 本番ではどう作るか

本リポジトリの実装は学習用で、本番の判断と運用はハブ `vaz-agentic-ai-next` の手法ページにあります（文書の転載はしません。確認日 2026-10-13）。

- CE（コンテキストエンジニアリング）: [`context-engineering.md`](https://github.com/Fukuchan77/vaz-agentic-ai-next/blob/main/docs/guide/context-engineering.md)

簡略化している点は、ナレッジベースがローカルの単一の学習者を前提にしていることです（認証・RBAC、文書ごとのアクセス制御、取り込みジョブの耐久実行は扱いません。[005 Req 1.3](../../specs/005-hub-alignment/spec.md)）。

## 元教材との対照表

| 元教材（Python / LangChain / LangGraph）の対応箇所 | TypeScript / AI SDK 版での置き換え | 移植で諦めたもの |
|---|---|---|
| 1_llm-agent 第9・10章（RAG の基本） | 取り込みから引用までを非同期関数の合成で書く（`streamRagQuery`） | LCEL のパイプ演算子による宣言的な合成、組み込みのバッチ・ストリーミング |
| ベクトルストア（FAISS / Chroma / LangChain の PGVector ラッパ） | pgvector を `drizzle-orm` の型付きクエリで直接引く。データ層は PGlite と Docker の Postgres の二層 | ベクトルストアの差し替えを 1 行で行う抽象（アダプタ層） |
| `RecursiveCharacterTextSplitter` | 見出し境界 → 段落 → 文 → 文字数の順に分ける自前の分割（コードポイントで数える） | 言語ごとの多数のセパレータ設定 |
| 引用（ソースドキュメントのメタデータ） | 序数の脚注 `[n]` の解析と、取得した全チャンクを返す `cited` | モデルによる構造化引用 |
| Agentic RAG（Retriever をツールにする） | 検索を `read-only` のツールにして `createGuardedAgent` に渡す | なし |

## 移植時の変更点

[changes-from-drafts.md](../../specs/curriculum/changes-from-drafts.md) の §9 に記録された変更のうち、このモジュールに関わるものと、実装時に実測で確定したことです（Req 7.4）。採用したモデルはモデル ID ではなくカタログへの参照で示します（回答は用途 `chat`、埋め込みは用途 `embedding`。`local` なら `catalog: local.ollama.chat`、`catalog: local.ollama.embedding`）。

- **データ層は二層。** gate と `mock` は PGlite（PostgreSQL 18 の WASM、pgvector 0.8.1）、ハンズオンと `test:db` は Docker の Postgres 17（Compose）です。SQL は Drizzle のクエリビルダーで 1 回だけ書きます。
- **`drizzle-kit` は採りません。** 手書きの SQL マイグレーションと自前のマイグレーターです。
- **日本語の全文検索。** `Intl.Segmenter` で分かち書きして保存し、`simple` の `tsvector` を GIN で引きます。助詞のようなひらがなだけの短い語は検索語から除きます。順位は `ts_rank` で、BM25 ではありません。
- **PGlite は Next.js の `serverExternalPackages` に置きます。** そうしないと、Server Component のページから使ったときに pgvector の拡張を読めず、失敗します（Route Handler では動いたため、Vitest も実サーバー E2E の前は緑でした。research I-10）。
- **埋め込みは 768 次元。** `live` の Anthropic の既定には埋め込みモデルが無く、`AI_MODEL_EMBEDDING` の設定が必要です。

## 完成時点のタグ

- **タグ**: `module/2-1`
- **含まれるもの**: 取り込み（Markdown / PDF）、分割、埋め込み、ストア（PGlite と Postgres）、類似度検索と閾値、引用付き回答、Agentic RAG、`/api/rag/*` と `/rag` 画面、評価コーパス、この解説
- **含まれないもの**: Advanced RAG の手法（HyDE、Multi-Query、ハイブリッド、Rerank。2-2 で扱うが、実装は同じタグ時点の `rag/` に入っている）、実 Postgres と Cohere の実キーによる人の確認（未了なら「人が行うこと」に残す）
