# rag-and-workflows（Milestone 2）— 完了した実装タスク W3: 検索・回答・Agentic RAG（大タスク 10〜15）

完了した波（2026-10-12 に移行）。表記規約、ID 対応表、進捗、gate への段階的な結線、完了した波の移行手順は
[tasks.md](tasks.md) を参照する。波の敵対的レビューの記録は
`.sdd/reviews/002-rag-and-workflows-impl-w3-review-2026-10-12.md`（1 ラウンド。指摘への対応を追記済み）。
コミット: `634d0f9`、`0fe5024`、`8bb3229`、`5e7ca2c`。

---

## W3 検索・回答・Agentic RAG（大タスク 10〜15）

W2（大タスク 5〜9）は完了し [tasks-comp-w2.md](tasks-comp-w2.md) に移した。

RRF、HyDE、Multi-Query、疑似 Rerank、検索パイプライン、引用、`streamRagQuery`、Agentic RAG のツールと `/api/rag/agent`、`/api/rag/query`、
評価の算術と Judge、ラベル付き質問セット、`m2-1`・`m2-2` のシナリオを作る。**コーパス（9.1）を固めてから質問セット（14.1）を書く**。

10.1・10.2・10.3・10.4・11.1・12.1・13.1・13.2・13.3 は互いに独立で、並列に進められる。10.5〜10.8 は順に行う。14 は 10〜13 の後、15 は 14 の後に行う。

---

## 10. 検索パイプライン（C7、C2 の疑似実装）

質問から最終的な上位 k 件の根拠チャンクを、手法の有効・無効の設定に従って取得し、各段の中間結果を返す。
**「該当なし」の判定は、ベクトル検索で閾値以上の候補が 1 件も無いことだけで行い、全文検索のヒットは寄与させない**（CL-1。非空虚なテストで縛る）。

_Boundary:_ `packages/ai-core/src/rag/retrieve/rrf.ts`, `packages/ai-core/src/rag/retrieve/rrf.test.ts`, `packages/ai-core/src/rag/lexical-rerank.ts`, `packages/ai-core/src/rag/lexical-rerank.test.ts`, `packages/ai-core/src/rag/retrieve/trace.ts`, `packages/ai-core/src/rag/retrieve/trace.test.ts`, `packages/ai-core/src/rag/retrieve/hyde.ts`, `packages/ai-core/src/rag/retrieve/hyde.test.ts`, `packages/ai-core/src/rag/retrieve/multi-query.ts`, `packages/ai-core/src/rag/retrieve/multi-query.test.ts`, `packages/ai-core/src/rag/retrieve/pipeline.ts`, `packages/ai-core/src/rag/retrieve/pipeline.db.test.ts`, `packages/ai-core/src/rag/retrieve/index.ts`
_Depends:_ 2.1, 3.1, 3.2, 6.3, 7.3
_Requirements:_ 1.4, 1.6, 1.7, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.11
_Traces:_ REQ-001, REQ-002, C2, C7

- [x] 10.1 (P) `rag/retrieve/rrf.ts`: `reciprocalRankFusion(rankings, k): { id; score }[]`（純関数。同一 ID は統合後に 1 回だけ。順位は 1 始まりで `1 / (k + rank)` の和。同点は ID の辞書順。決定論）+ `rrf.test.ts` に、重複排除（複数のランキングに現れる ID が 1 回）、既知の入力に対するスコアの値、入力ランキングの順序を入れ替えても結果が同じ（性質テスト）、同点の辞書順、空のランキング、`k` の影響を先に足す（Req 2.4 の非空虚: 重複排除を壊すと落ちる）
  _Boundary:_ `packages/ai-core/src/rag/retrieve/rrf.ts`, `packages/ai-core/src/rag/retrieve/rrf.test.ts`
  _Depends:_ none
  _Requirements:_ 2.3, 2.4
  _Traces:_ REQ-002, C7
- [x] 10.2 (P) `rag/lexical-rerank.ts`: `createLexicalRerank(): RerankProvider`（質問と候補を `toSearchText` の分かち書きで語に分け、重なりの割合で採点する決定論的な疑似実装。キー不要。`modelId` は疑似実装であることが分かる固定名）+ `lexical-rerank.test.ts` に、重なりが多い候補が上位、決定論（同じ入力で同じ順序）、空入力、`topN` の適用、同点の決定論を先に足す
  _Boundary:_ `packages/ai-core/src/rag/lexical-rerank.ts`, `packages/ai-core/src/rag/lexical-rerank.test.ts`
  _Depends:_ 3.1, 6.3
  _Requirements:_ 2.5
  _Traces:_ REQ-002, C2
- [x] 10.3 (P) `rag/retrieve/trace.ts`: `RetrievalTrace`（`settings`、`hypotheticalAnswer?`、`subQueries?`、`vector`/`fullText` の `{ query; candidates }[]`、`fused`、`reranked?`、`rerank: { status: "applied" | "skipped" | "disabled"; reason? }`、`final`、`stages`）と `StageEvent { stage; status: "running" | "done" | "skipped"; detail? }` の型、トレースの組み立て（所要時間は `Clock` から）+ `trace.test.ts` に、段の記録の形、`FakeClock` による所要時間の固定（表示用の値をアサートしない）、スキップの理由の記録を先に足す
  _Boundary:_ `packages/ai-core/src/rag/retrieve/trace.ts`, `packages/ai-core/src/rag/retrieve/trace.test.ts`
  _Depends:_ 2.1, 7.3
  _Requirements:_ 2.8, 2.11
  _Traces:_ REQ-002, C7
- [x] 10.4 (P) `rag/retrieve/hyde.ts`・`multi-query.ts`: `generateHypotheticalAnswer`（質問から仮想回答を生成）、`expandQuery`（`generateValidated` で `DEFAULT_RAG.subQueryCount`（3）件の**異なる**サブクエリ。重複・件数違いは検証失敗として再生成。CL-2）+ `hyde.test.ts`・`multi-query.test.ts` に、仮想回答のプロンプトに質問が入ること、サブクエリが 3 件、重複で再生成、3 回失敗で `output-invalid`（`StructuredOutputError`）、中断を先に足す（`mock` モデルで検証。小型モデルの遵守は `local` 専用）
  _Boundary:_ `packages/ai-core/src/rag/retrieve/hyde.ts`, `packages/ai-core/src/rag/retrieve/hyde.test.ts`, `packages/ai-core/src/rag/retrieve/multi-query.ts`, `packages/ai-core/src/rag/retrieve/multi-query.test.ts`
  _Depends:_ 2.1, 3.2
  _Requirements:_ 2.1, 2.2
  _Traces:_ REQ-002, C7
- [x] 10.5 `rag/retrieve/pipeline.ts`（ナイーブ）: `runRetrieval({ question, settings, deps, onStage?, signal? })` の骨格。質問の埋め込み → ベクトル検索（`candidatePool` 件）→ 閾値の適用 → 上位 `topK` 件、`onStage` の発行、`filter` の伝播、**ベクトル検索で閾値以上が 0 件なら該当なし（`chunks: []`）**、ナレッジベースが空のときも該当なし + `pipeline.db.test.ts` に、上位 k 件、閾値の境界値（ちょうどの値は通る）、0 件の該当なし、フィルタ（文書名・`tags`）、段の実行順、中間結果を先に足す（PGlite、`mock` の決定論的な埋め込み）
  _Boundary:_ `packages/ai-core/src/rag/retrieve/pipeline.ts`, `packages/ai-core/src/rag/retrieve/pipeline.db.test.ts`
  _Depends:_ 10.1, 10.3, 7.3
  _Requirements:_ 1.4, 1.6, 1.7, 2.8, 2.11
  _Traces:_ REQ-001, REQ-002, C7
- [x] 10.6 `pipeline.ts`（ハイブリッド）: `methods.hybrid` が有効なとき、サブクエリごとにベクトル検索と全文検索を並列（`Promise.all`）に実行し、`reciprocalRankFusion` で 1 つのランキングにする。全文検索の候補は `candidatePool` で打ち切る。質問を分かち書きした語が 0 件なら全文検索を実行せず空の結果にする（エラーにしない）。**全文検索だけがヒットし、ベクトル検索が閾値未満のとき、ハイブリッドが有効でも該当なしになる**（CL-1）+ `pipeline.db.test.ts` に、全文 + ベクトルの統合、重複する候補が 1 回、日本語の全文一致、語が 0 件の質問、CL-1 の非空虚なテスト（全文のみヒットで該当なし）を先に足す
  _Boundary:_ `packages/ai-core/src/rag/retrieve/pipeline.ts`, `packages/ai-core/src/rag/retrieve/pipeline.db.test.ts`
  _Depends:_ 10.5
  _Requirements:_ 1.7, 2.3, 2.4, 2.8
  _Traces:_ REQ-001, REQ-002, C7
- [x] 10.7 `pipeline.ts`（HyDE・Multi-Query）: `methods.hyde` が有効なとき、仮想回答の埋め込みでベクトル検索を行う。`methods.multiQuery` が有効なとき、3 件のサブクエリの検索（ベクトル・全文）を並列に実行して RRF で統合する。HyDE と Multi-Query の両方が有効なときは、仮想回答を生成してからサブクエリへ展開する（plan の流れ図）。構造化出力に対応しないモデルは呼び出し側（15.3）が LLM の前に拒否する + `pipeline.db.test.ts` に、HyDE の検索クエリが仮想回答の埋め込みであること、サブクエリごとの検索が並列に呼ばれること、サブクエリが `trace.subQueries` に残ること、閾値の判定が HyDE・Multi-Query の各クエリを含むことを先に足す
  _Boundary:_ `packages/ai-core/src/rag/retrieve/pipeline.ts`, `packages/ai-core/src/rag/retrieve/pipeline.db.test.ts`
  _Depends:_ 10.4, 10.6
  _Requirements:_ 2.1, 2.2, 2.7, 2.8
  _Traces:_ REQ-002, C7
- [x] 10.8 `pipeline.ts`（Rerank）と `rag/retrieve/index.ts`: `methods.rerank` が有効でキーあり（`mock` は疑似実装）→ 統合後の候補を再順位付けして上位 `topK` 件を使う。有効でキー無し（`rerank` が `undefined`）→ 段をスキップして `rerank: { status: "skipped", reason: "api-key-missing" }` を記録する。無効 → `status: "disabled"`。Rerank の呼び出しが失敗 → 回答を止めず統合後の順位に戻り `reason: "provider-error"` を記録する（CL-11）。`retrieve/index.ts` が検索の公開 API を出す + `pipeline.db.test.ts` に、Rerank 後の上位 k 件（疑似実装）、キー無しのスキップと記録、無効、失敗時のフォールバック、**手法 4 つの全組み合わせ（16 通り）の段の実行順とスキップの記録**を先に足す
  _Boundary:_ `packages/ai-core/src/rag/retrieve/pipeline.ts`, `packages/ai-core/src/rag/retrieve/pipeline.db.test.ts`, `packages/ai-core/src/rag/retrieve/index.ts`
  _Depends:_ 10.2, 10.7
  _Requirements:_ 2.5, 2.6, 2.7, 2.8, 2.11
  _Traces:_ REQ-002, C2, C7

### Implementation Notes

- 10.1〜10.4 は新規コンテキストのサブエージェントに任せ、メインで再実行して確認した。`RetrievalSettings` と段の名前（`fusion` を含む）は `trace.ts` に置いた。無効な段は `skipped`（理由「無効」）として記録するので、16 通りの組み合わせはいつも同じ 6 段が同じ順で並ぶ。
- HyDE も Multi-Query も `structuredModel` を使う（`chatModel` は回答生成だけ）。呼び出し側（15.3）が構造化出力の対応を 1 回確かめれば済み、`RetrievalDeps` から `chatModel` を外した（`RagQueryDeps` が足す）。HyDE と Multi-Query を併用するときは、Multi-Query が仮想回答をサブクエリへ展開する。
- PROVE で見つけた弱いテストを 4 件強化した（RRF の `k`、全文検索の語 0 件、Rerank の元スコア、Rerank の候補が全て未知の ID）。Rerank の呼び出しが `topN` を超えて返しても、パイプラインが `topK` で切る。

---

## 11. 回答と引用（C8）

取得したチャンクを根拠にした回答をストリーミングで生成し、引用を照合して返す。根拠が無ければ LLM を呼ばずに「該当なし」を返す。

_Boundary:_ `packages/ai-core/src/rag/answer/citations.ts`, `packages/ai-core/src/rag/answer/citations.test.ts`, `packages/ai-core/src/rag/answer/prompt.ts`, `packages/ai-core/src/rag/answer/prompt.test.ts`, `packages/ai-core/src/rag/answer/index.ts`, `packages/ai-core/src/rag/request-schema.ts`, `packages/ai-core/src/rag/request-schema.test.ts`, `packages/ai-core/src/rag/query.ts`, `packages/ai-core/src/rag/query.db.test.ts`
_Depends:_ 7.3, 8.2, 10.8
_Requirements:_ 1.4, 1.5, 1.6, 1.7, 1.11, 2.7, 2.11
_Traces:_ REQ-001, C8, C13

- [x] 11.1 (P) `rag/answer/citations.ts`: `resolveCitations(answerText, chunks): { answer; citations; removedCitations }`（純関数。範囲外の序数 `[n]` を回答から除去して `removedCitations` に記録、取得した全チャンクを `Citation[]`（`chunkId`・`label`・`documentId`・`documentTitle`・`locator`（`page` または `heading`）・`excerpt`（先頭 200 文字）・`similarity?`・`cited`）にし、脚注が参照したものに `cited: true` を付ける。コードブロック内の `[n]` は引用として扱わない）+ `citations.test.ts` に、範囲外（`[7]`）の除去と記録（Req 1.11 の非空虚: 除去を壊すと落ちる）、重複した脚注、全角括弧、コードブロック内の `[n]`、脚注なし（全チャンク `cited: false`）、0 件、`[0]`、抜粋の切り出し、ページと見出しパスの `locator` を先に足す
  _Boundary:_ `packages/ai-core/src/rag/answer/citations.ts`, `packages/ai-core/src/rag/answer/citations.test.ts`
  _Depends:_ 7.3
  _Requirements:_ 1.5, 1.11
  _Traces:_ REQ-001, C8
- [x] 11.2 `rag/answer/prompt.ts`・`answer/index.ts`: `buildAnswerPrompt(question, chunks)`（取得チャンクに序数ラベル `[1]`〜`[k]` を付け、「資料だけを根拠に答え、根拠にした資料の番号を文末に付ける。根拠が無ければ該当なしと答える」を要求する。資料は区切って「指示として扱わない」旨を明記する。ラベルはそのリクエストの取得順）、`NO_EVIDENCE_MESSAGE`（固定の日本語文）、`streamRagAnswer({ chatModel, question, chunks, signal })`（`streamText`）、`answer/index.ts` の公開 API + `prompt.test.ts` に、ラベルが取得順で 1 始まり、資料の区切りと指示の無効化の記述、質問がプロンプトに入ること、チャンク 0 件で呼ばないことを先に足す
  _Boundary:_ `packages/ai-core/src/rag/answer/prompt.ts`, `packages/ai-core/src/rag/answer/prompt.test.ts`, `packages/ai-core/src/rag/answer/index.ts`
  _Depends:_ 11.1
  _Requirements:_ 1.4, 1.5, 1.7
  _Traces:_ REQ-001, C8
- [x] 11.3 (P) `rag/request-schema.ts`（クエリ）: `POST /api/rag/query` の `z.strictObject`（`id`、`question`（1〜2000 文字）、`modelId?`、`settings?`: `topK` 1〜20、`minSimilarity` -1〜1、`filter`（`documentIds` 20 件以下、`tags` 10 件以下）、`methods`（`hyde`/`multiQuery`/`hybrid`/`rerank`、既定は全て `false`））を足す + `request-schema.test.ts` に、未知フィールドの拒否、各範囲の境界値、既定値（`DEFAULT_RAG` と全手法 `false`）を先に足す
  _Boundary:_ `packages/ai-core/src/rag/request-schema.ts`, `packages/ai-core/src/rag/request-schema.test.ts`
  _Depends:_ 8.2
  _Requirements:_ 1.4, 1.6, 2.7
  _Traces:_ REQ-001, REQ-002, C13
- [x] 11.4 `rag/query.ts`: `streamRagQuery(deps, request, signal): AsyncGenerator<RagEvent, void>`（`runRetrieval` と 11.2 を合成する。`RagEvent` は `stage`（`onStage` の中継）、`trace`（累積した `RetrievalTrace`）、`text-delta`、`result`（`RagResult { answer; citations; removedCitations; noEvidence; rerank; settings; usage }`）の閉じた union。`noEvidence` のときは LLM を呼ばず `NO_EVIDENCE_MESSAGE` を `text-delta` として 1 回出す。完了時に `resolveCitations` で照合する）+ `query.db.test.ts` に、イベントの順序（`stage` → `trace` → `text-delta`* → `result`）、該当なしで LLM を呼ばない、範囲外の引用の除去、中断で後続の LLM 呼び出しが始まらず `result` を送らない、回答生成の失敗が固定文の `provider-unavailable` になる、ナレッジベースが空のときの該当なしを先に足す
  _Boundary:_ `packages/ai-core/src/rag/query.ts`, `packages/ai-core/src/rag/query.db.test.ts`
  _Depends:_ 10.8, 11.2
  _Requirements:_ 1.4, 1.5, 1.7, 1.11, 2.11
  _Traces:_ REQ-001, REQ-002, C8

### Implementation Notes

- `streamRagQuery` は検索の `onStage` を非同期キューで `stage` イベントに橋渡しする。PROVE で、トレースを受け取った消費側が中断した後に回答生成が始まる実バグを見つけ、`trace` の送出直後に中断を確認するよう直した。
- 回答生成の失敗は固定文の `provider-unavailable` に変換し、中断は変換せずそのまま投げる（原因の取り違えを防ぐテストあり）。
- クエリのスキーマの `modelId` はカタログの列挙（M1 と同じ）。plan の `modelId?: string` より厳しく、未知の ID は 400 になる。

---

## 12. Agentic RAG（C9）

ナレッジベース検索をエージェントのツールとして定義し、検索したチャンクを引用レジストリに登録する。`createGuardedAgent` の呼び出しは
Route Handler（15.4）が行い、`rag/` は `agents/` を import しない。

_Boundary:_ `packages/ai-core/src/aci/tools/search-knowledge-base.ts`, `packages/ai-core/src/aci/tools/search-knowledge-base.test.ts`, `packages/ai-core/src/aci/index.ts`, `packages/ai-core/src/rag/agentic.ts`, `packages/ai-core/src/rag/agentic.db.test.ts`
_Depends:_ 10.8, 11.1
_Requirements:_ 1.9, 1.10, 1.11
_Traces:_ REQ-001, C9

- [x] 12.1 (P) `aci/tools/search-knowledge-base.ts`: `createSearchKnowledgeBaseTool({ search, registry })`（`defineAciTool`、`risk: "read-only"`、ツール名 `searchKnowledgeBase`。`aci/` は `rag/` を import しないため、`KnowledgeSearcher` と `CitationRegistry` のインターフェースを `aci/` 側で定義して注入する。入力は `query`（1〜500 文字）と任意の `documentIds`。出力は `{ label, documentTitle, locator, excerpt }[]` と、0 件のときの該当なしの旨）を作り、`aci/index.ts` から再エクスポートする + `search-knowledge-base.test.ts` に、入力検証、0 件、リスク区分が `read-only`、検索の例外がツール結果に変換されてループが続く、ラベルがレジストリ由来を先に足す
  _Boundary:_ `packages/ai-core/src/aci/tools/search-knowledge-base.ts`, `packages/ai-core/src/aci/tools/search-knowledge-base.test.ts`, `packages/ai-core/src/aci/index.ts`
  _Depends:_ none
  _Requirements:_ 1.9
  _Traces:_ REQ-001, C9
- [x] 12.2 `rag/agentic.ts`: `createCitationRegistry()`（リクエストごと。ラベルを通し番号で採番し、同じチャンクは同じラベル）、`createKnowledgeSearcher(deps)`（`runRetrieval` を包む）、`AGENTIC_RAG_INSTRUCTIONS`（検索の要否を判断し、無関係な質問には検索せずに答え、根拠が無ければ該当なしと答える）、`summarizeAgenticRun(summary: AgentRunSummary, registry, answerText)`（`toolsCalled` に `searchKnowledgeBase` があるか → `searched`・`searchCount`、`resolveCitations` の結果）+ `agentic.db.test.ts` に、ラベルの通し番号と同じチャンクの同じラベル、検索したかの導出（0 回・1 回・複数回）、レジストリがリクエスト間で共有されない、範囲外の脚注の除去、ツール経由の検索がナレッジベースの内容を返すことを先に足す
  _Boundary:_ `packages/ai-core/src/rag/agentic.ts`, `packages/ai-core/src/rag/agentic.db.test.ts`
  _Depends:_ 10.8, 11.1, 12.1
  _Requirements:_ 1.9, 1.10, 1.11
  _Traces:_ REQ-001, C9

### Implementation Notes

- `rag/` は `agents/` を import しない。`summarizeAgenticRun` は `{ toolsCalled }` だけを要求する構造的な型を受け取り、`AgentRunSummary` は渡されるだけで済む。
- 引用レジストリは `ScoredChunk` を保持し、`chunks()[n-1]` がラベル `n` に対応する。リクエスト間で共有しないことは `agentic.db.test.ts` で縛った（ルート側の「毎回新規」は、同じ固定シナリオでは区別できないため単体テストに任せる）。

---

## 13. RAG の評価（C10）

検索精度の算術、RAG 専用の最小の LLM-as-a-Judge、ラベル付き質問セットの型と読み込みを提供する。評価の実行場所は `eval-suite`（24）。
Judge の共通化・校正・レポートは 004 の対象で、M2 では行わない（ADR-10）。

_Boundary:_ `packages/ai-core/src/rag/eval/recall.ts`, `packages/ai-core/src/rag/eval/recall.test.ts`, `packages/ai-core/src/rag/eval/dataset.ts`, `packages/ai-core/src/rag/eval/dataset.test.ts`, `packages/ai-core/src/rag/eval/judge.ts`, `packages/ai-core/src/rag/eval/judge.test.ts`, `packages/ai-core/src/rag/eval/index.ts`, `packages/ai-core/src/rag/index.ts`
_Depends:_ 3.2, 8.3, 10.8, 11.4, 12.2
_Requirements:_ 2.9, 2.10, 2.12
_Traces:_ REQ-002, C10

- [x] 13.1 (P) `rag/eval/recall.ts`: `recallAtK(retrievedIds, goldIds, k)`（含有率 = 上位 k 件に含まれる正解 / 正解の数）、`hitRateAtK`、`meanRecallAtK(results)`、`compareMethods(dataset, retrieveFor)`（手法の組み合わせごとの平均 recall と質問ごとの結果）+ `recall.test.ts` に、算術（既知の値）、境界値（k=0、k が候補より大きい、正解が 0 件）、重複 ID、平均、手法ごとの比較を先に足す（Req 2.9 の非空虚: 分母・分子を壊すと落ちる）
  _Boundary:_ `packages/ai-core/src/rag/eval/recall.ts`, `packages/ai-core/src/rag/eval/recall.test.ts`
  _Depends:_ none
  _Requirements:_ 2.9
  _Traces:_ REQ-002, C10
- [x] 13.2 (P) `rag/eval/dataset.ts`: `EvalQuestion { id; question; goldChunkIds; referenceAnswer }` と `loadEvalSet(path)`（Zod 検証。20 問未満、正解 ID の欠落、`id` の重複、空の質問・参照回答は失敗）+ `dataset.test.ts` に、正常な読み込み、20 問未満の拒否、正解 ID が空、重複 `id`、不正な JSON を一時ファイルで先に足す
  _Boundary:_ `packages/ai-core/src/rag/eval/dataset.ts`, `packages/ai-core/src/rag/eval/dataset.test.ts`
  _Depends:_ none
  _Requirements:_ 2.12
  _Traces:_ REQ-002, C10
- [x] 13.3 (P) `rag/eval/judge.ts`: `judgeRagAnswer({ judgeModel, question, answer, chunks })`（評価軸 — 忠実性（回答が取得チャンクに裏付けられているか）と回答関連性（回答が質問に答えているか）— ごとに別のプロンプトで `generateValidated` を呼び、`{ axis; verdict: "pass" | "fail" | "unknown"; score: 1〜5; rationale }` を返す。`unknown` は根拠不足。`JudgeModel` は注入できる型）+ `judge.test.ts` に、フェイク Judge による軸の分離（2 軸が別の呼び出しで、互いのルーブリックを含まない）、`unknown` の扱い、スコアの範囲違反で再生成、取得チャンクが 0 件のとき忠実性が `unknown` を先に足す
  _Boundary:_ `packages/ai-core/src/rag/eval/judge.ts`, `packages/ai-core/src/rag/eval/judge.test.ts`
  _Depends:_ 3.2
  _Requirements:_ 2.10
  _Traces:_ REQ-002, C10
- [x] 13.4 `rag/eval/index.ts` と `rag/index.ts`（最終版）: 評価の公開 API を作り、`@platform/ai-core/rag` の公開 API を完成させる（`retrieve`・`answer`・`query`・`agentic`・`eval` と型、`createSearchKnowledgeBaseTool` と引用レジストリの再エクスポート。plan「後続 spec への契約」の表の公開場所と一致させる）。`rag/` が `agents/` を import しないことを確認する
  _Boundary:_ `packages/ai-core/src/rag/eval/index.ts`, `packages/ai-core/src/rag/index.ts`
  _Depends:_ 8.3, 10.8, 11.4, 12.2, 13.1, 13.2, 13.3
  _Requirements:_ 2.9, 2.10
  _Traces:_ REQ-002, C10
  _Verify:_ `mise run typecheck` と `mise run check:repo-rules`（`guarded-agent-only`、`ai-core-no-ui-deps`）が成功し、`apps/web` から `@platform/ai-core/rag` の契約表の全シンボルを import できる

### Implementation Notes

- `compareMethods` のシグネチャは plan の `(dataset, retrieveFor)` に `{ combinations, k, signal? }` を足した。`goldChunkIds` は 1 件以上が必須（`loadEvalSet`）なので、無関係な質問（該当なし）は質問セットに入れず、14.2 のシナリオと `query.db.test.ts` の該当なしのテストで確かめる。
- Judge の軸の印は `[judge-axis:<軸>]`（プロンプトの先頭行）。本番プロンプトに `fixture:` を載せないため。`mock` のシナリオは軸ごとに 1 ターン（pass）で、fail と unknown はフェイク Judge の単体テストで確かめる。

---

## 14. 評価データとシナリオ（C15）

ラベル付き質問セット（20 問以上）と、`mock` の応答（シナリオ）を用意する。

_Boundary:_ `packages/ai-core/fixtures/rag/eval-set.json`, `packages/ai-core/src/rag/eval/dataset.test.ts`, `packages/ai-core/fixtures/scenarios/m2-1.ts`, `packages/ai-core/fixtures/scenarios/m2-2.ts`, `packages/ai-core/src/mock/m2-scenarios.test.ts`, `packages/ai-core/src/mock/index.ts`, `packages/ai-core/src/models/gateway.ts`, `packages/ai-core/src/models/gateway.test.ts`
_Depends:_ 2.3, 9.1, 10.8, 11.2, 12.2, 13.2, 13.3
_Requirements:_ 1.12, 2.10, 2.12
_Traces:_ REQ-002, C15

- [x] 14.1 `fixtures/rag/eval-set.json`: ラベル付き質問セット（20 問以上。質問、正解チャンク ID、参照回答）を書く。質問は、キーワードが一致しない言い換え（ハイブリッド・Rerank の効果が見える）、抽象的な質問（HyDE）、複数の観点にまたがる質問（Multi-Query）、無関係な質問（該当なしの確認）を含める。正解チャンク ID は、コミットしない一時スクリプトで 9.1 のコーパスに `chunkDocument` を実行して得る + `dataset.test.ts` に、実際の `eval-set.json` が `loadEvalSet` を通る（20 問以上、`id` が一意、参照回答が空でない）ケースを先に足す。正解 ID がコーパスに実在することの恒久的な検査は 24.1 が行う
  _Boundary:_ `packages/ai-core/fixtures/rag/eval-set.json`, `packages/ai-core/src/rag/eval/dataset.test.ts`
  _Depends:_ 9.1, 13.2
  _Requirements:_ 2.12
  _Traces:_ REQ-002, C15
- [x] 14.2 `fixtures/scenarios/m2-1.ts`・`m2-2.ts`: RAG の回答（脚注付き）、範囲外の脚注を含む回答、HyDE の仮想回答、Multi-Query の 3 件のサブクエリ、Agentic RAG（検索ツールを呼んでから答える流れ、検索せずに答える流れ）、Judge（忠実性・回答関連性）のシナリオを、`purpose` と `lastUserTextIncludes` の `fixture:` マーカーで照合する形で作る。シナリオ ID は `m2-1/...`・`m2-2/...`。`models/gateway.ts` の `mock` 既定シナリオに足し、`mock/index.ts` から `M2_1_SCENARIOS`・`M2_2_SCENARIOS` を再エクスポートする + `m2.test.ts` に、曖昧な一致（同じ入力に複数のシナリオが一致）の検出、全 `fixture:` マーカーの網羅を、`gateway.test.ts` に、`mock` の既定シナリオに M2 が含まれ M1 のシナリオが引き続き一致することを先に足す。画面の入力例は、シナリオに対応する質問文を提示する
  _Boundary:_ `packages/ai-core/fixtures/scenarios/m2-1.ts`, `packages/ai-core/fixtures/scenarios/m2-2.ts`, `packages/ai-core/src/mock/m2-scenarios.test.ts`, `packages/ai-core/src/mock/index.ts`, `packages/ai-core/src/models/gateway.ts`, `packages/ai-core/src/models/gateway.test.ts`
  _Depends:_ 2.3, 10.8, 11.2, 12.2, 13.3
  _Requirements:_ 2.10, 1.12
  _Traces:_ REQ-001, REQ-002, C15

### Implementation Notes

- 境界の調整: `fixtures/scenarios/m2.test.ts` は Vitest の `include`（`src/**`）に入らず、置いても実行されない（空虚なテストになる）ので、`packages/ai-core/src/mock/m2-scenarios.test.ts` に置いた。`m2-*.ts` は `fixtures/scenarios/` のまま。
- `mock` の埋め込みは「同じ文字列でなければ似ない」ので、入力例は「コーパスのチャンク本文そのもの」か、HyDE・Multi-Query の応答がチャンク本文になる質問にした。コーパスの文を直すと `m2-scenarios.test.ts` が落ちる（`M2_CORPUS_TEXT` をコーパスに固定）。
- 質問セットは 32 問（言い換え・抽象・複数観点を含む）。正解 ID は一時スクリプトで `eval:` の文書 ID から得た。

---

## 15. RAG の HTTP 入口と W3 の締め（C13、C17）

`POST /api/rag/query` と `POST /api/rag/agent` を既存の検査順（`guard → resolve → validate → adapt → stream`）で提供する。
`RagEvent` から UI メッセージストリームのパートへの写像は 15.2 に集め、Route Handler はそれを呼ぶだけにする。

_Boundary:_ `apps/web/lib/server/platform.ts`, `apps/web/lib/server/platform.test.ts`, `apps/web/lib/server/rag-stream.ts`, `apps/web/lib/server/rag-stream.test.ts`, `apps/web/app/api/rag/query/route.ts`, `apps/web/app/api/rag/query/route.test.ts`, `apps/web/app/api/rag/agent/route.ts`, `apps/web/app/api/rag/agent/route.test.ts`, `stryker.config.mjs`
_Depends:_ 3.1, 8.4, 9.3, 10.2, 11.3, 11.4, 12.2, 13.4, 14.2
_Requirements:_ 1.4, 1.5, 1.7, 1.9, 1.10, 1.11, 2.4, 2.5, 2.6, 2.8, 2.9, 2.11
_Traces:_ REQ-001, REQ-002, C13, C17

- [x] 15.1 `apps/web/lib/server/platform.ts`: `ports.rerank` を足す（`mock` は `createLexicalRerank()`、`local`/`live` は `COHERE_API_KEY` があれば `createCohereRerank`、なければ `undefined`。CL-6）+ `platform.test.ts` に、実行モード別の Rerank の組み立て（`mock` は疑似、キーなしは `undefined`、キーありは Cohere）を先に足す（Cohere へは接続しない）
  _Boundary:_ `apps/web/lib/server/platform.ts`, `apps/web/lib/server/platform.test.ts`
  _Depends:_ 3.1, 8.4, 10.2
  _Requirements:_ 2.5, 2.6
  _Traces:_ REQ-002, C13
- [x] 15.2 (P) `apps/web/lib/server/rag-stream.ts`: `RagEvent` を UI メッセージストリームのパートへ写像する（`stage` → `data-rag-stage`（`id: stage-<stage>` で上書き）、`trace` → `data-rag-trace`（`id: trace`）、`text-delta` → `text-start`/`text-delta`/`text-end`、`result` → `data-rag-result`（`id: result`）。ストリームの途中のエラーは `PlatformError` の `code` と日本語のメッセージだけに変換する（M1 の `toStreamErrorText`）。生のメッセージ・スタック・SQL を送らない）+ `rag-stream.test.ts` に、イベントごとの写像、同じ `id` の上書き、中断時に `data-rag-result` を送らない、エラーの `code` への変換と秘密情報を含まないことを先に足す
  _Boundary:_ `apps/web/lib/server/rag-stream.ts`, `apps/web/lib/server/rag-stream.test.ts`
  _Depends:_ 11.4
  _Requirements:_ 1.4, 1.5, 2.8, 2.11
  _Traces:_ REQ-001, REQ-002, C13
- [x] 15.3 `app/api/rag/query/route.ts`: 引用付き回答のストリーム。guard → resolve（チャットモデル `purpose: "chat"`、構造化出力 `"structured"`、埋め込み）→ validate（11.3 のクエリのスキーマ）→ stream の順で処理する。HyDE または Multi-Query が有効で、モデルが構造化出力に対応しない場合は LLM を呼ぶ前に 400 `capability-unsupported`。埋め込みモデルが無い場合は `AI_MODEL_EMBEDDING` を案内する `invalid-request`。`request.signal` を検索・生成に伝播する + `route.test.ts` に、検査順（413 → 400 → 400 → `live` のみ 429）、拒否のコード、ストリームの形（`data-rag-stage`・`data-rag-trace`・テキスト・`data-rag-result`）、該当なしで LLM を呼ばない、中断、Rerank のキー無しのスキップが結果に載ることを先に足す（`mock` のシナリオを使う）
  _Boundary:_ `apps/web/app/api/rag/query/route.ts`, `apps/web/app/api/rag/query/route.test.ts`
  _Depends:_ 11.3, 14.2, 15.1, 15.2
  _Requirements:_ 1.4, 1.5, 1.7, 2.6, 2.8, 2.11
  _Traces:_ REQ-001, REQ-002, C13
- [x] 15.4 (P) `app/api/rag/agent/route.ts`: Agentic RAG。M1 の `/api/agent/tools` と同じ形で、リクエストごとに `createGuardedAgent` を 1 回生成し、`searchKnowledgeBase`（`risk: "read-only"`）だけをツールとして渡す。引用レジストリはリクエストごとに作る。`finish` の `messageMetadata` に `{ run: AgentRunSummary; rag: AgenticRagSummary }` を載せる。ツール非対応のモデルは 400 `capability-unsupported`。`signal` と `abortSignal` を伝播する + `route.test.ts` に、検査順、ツール呼び出しのストリーム（`tool-searchKnowledgeBase` パート）、検索せずに答えた場合の `searched: false`、`messageMetadata` の形、停止理由が `run` に載る、レジストリがリクエスト間で共有されない、中断を先に足す（`mock` のシナリオを使う）
  _Boundary:_ `apps/web/app/api/rag/agent/route.ts`, `apps/web/app/api/rag/agent/route.test.ts`
  _Depends:_ 12.2, 14.2, 15.1
  _Requirements:_ 1.9, 1.10, 1.11
  _Traces:_ REQ-001, C13
- [x] 15.5 **W3 の締め**: `stryker.config.mjs` の `mutate` に `rag/retrieve/rrf.ts`、`rag/answer/citations.ts`、`rag/eval/recall.ts` を足し、`mise run test:mutation` が閾値 70 を満たすことを確かめる。`mise run gate` が成功することを確かめ、所要時間を Implementation Notes に記録する（予算 5 分）。`rag/` の行カバレッジ（80%）を `mise run test:coverage` で確かめる
  _Boundary:_ `stryker.config.mjs`
  _Depends:_ 9.3, 13.4, 15.3, 15.4
  _Requirements:_ 1.11, 2.4, 2.9
  _Traces:_ REQ-001, REQ-002, C17
  _Verify:_ `mise run gate`、`mise run test:mutation`、`mise run test:coverage` が成功する。gate の所要時間を記録する 波の敵対的レビュー（憲章 原則 9。新規コンテキストで `sdd-reviewer`）を行い、記録 `.sdd/reviews/002-rag-and-workflows-impl-w3-review-YYYY-MM-DD.md` が存在し、指摘への対応が追記されていることを確かめる（波の移行条件 3）

### Implementation Notes

- `Platform.ports` は `PlatformPortSet`（`PlatformPorts` + `rerank`）にした。録画ラッパの対象は従来の 3 ポートのままで、Rerank は録画しない（ADR-7）。`resolveKnowledgeEmbedding` を `platform.ts` に足し、`/api/rag/query` と `/api/rag/agent` が `AI_MODEL_EMBEDDING` の案内を共有する。
- `/api/rag/agent` は M1 の会話スキーマをそのまま使うので `modelId` と `personaId` が必須（ペルソナは使わない）。回答テキストは `messageMetadata` で見える最後のステップの `text-delta` から組み立てる。中断済みのリクエストでは `abort` パートだけが返り、ツールは実行されない。
- 検査順（413 → 400 → `live` のみ 429）は両ルートのテストで縛った。
- W3 の締め（15.5）: `mise run test:mutation` は 86 点台で閾値 70 を満たす（`rrf.ts` 82.98、`citations.ts` 82.87、`recall.ts` 93.42。レビュー対応で `citations.ts` を直したため再実行した結果は do.md）。`TURBO_FORCE=true mise run gate` は約 27 秒（予算 5 分）。`ai-core` の行カバレッジは 98%、`rag/` は 100%（基準 80%）。
- gate を全ワークスペース同時に走らせると PGlite の起動が 5 秒の既定を超えるテストが出たため、`rag/db/schema.db.test.ts` と `lib/server/platform.test.ts` の 2 件に 30 秒のタイムアウトを明示した（境界外の既存テストの変更。理由は負荷による時間切れで、ロジックは変えていない）。
- 敵対的レビュー（`sdd-reviewer`、新規コンテキスト）: `.sdd/reviews/002-rag-and-workflows-impl-w3-review-2026-10-12.md`。判定は REQUEST_CHANGES（MEDIUM 5 件）。F-1〜F-5 をテスト先行で直し、残りの LOW への対応を同ファイルの Responses に追記した。
