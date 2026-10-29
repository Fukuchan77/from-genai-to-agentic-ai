import { defineScenario, type ScenarioDefinition } from "../../src/mock/scenario";

// Mock responses for modules 2-1 and 2-2 (RAG). The `mock` embedding model has no sense of
// meaning: two texts are similar only when they are identical. So the sample questions below are
// either the exact text of an evaluation-corpus chunk (plain query), or paired with a HyDE /
// Multi-Query response that is the exact text of a chunk. `src/mock/m2-scenarios.test.ts` pins every constant to the
// corpus, so editing a corpus file fails there instead of silently turning the demo into "no
// evidence".

/** Exact chunk bodies of `fixtures/rag/corpus` (see `src/mock/m2-scenarios.test.ts`). */
export const M2_CORPUS_TEXT = Object.freeze({
	ragOverview:
		"RAG（Retrieval-Augmented Generation、検索拡張生成）は、大規模言語モデルに質問する前に、外部の文書から関連する部分を検索して、その内容を根拠として回答を生成する方式である。モデルが学習時に覚えた知識だけに頼らず、手元の文書を根拠にできる点が最大の特徴である。",
	recallAtK:
		"recall@k は、正解のチャンクのうち、上位 k 件の中に含まれていた割合である。正解が複数ある質問では、見つかった正解の数を正解の総数で割る。値が大きいほど、取りこぼしが少ない。",
	whyRag:
		"言語モデルの知識は学習時点で固定されており、社内の規程や最新の仕様書のような非公開・更新頻度の高い情報は含まれない。モデルを再学習せずに最新の情報を扱う最も手軽な方法が、検索した文書を質問と一緒にモデルへ渡すことである。\n\n根拠となる文書を回答と一緒に示せるため、利用者は回答の出典を確かめられる。出典を確かめられることは、誤った回答（ハルシネーション）を見つけやすくするうえで重要である。",
	hybridOverview:
		"ハイブリッド検索は、ベクトル検索と全文検索の結果を組み合わせる方式である。ベクトル検索は意味の近さを、全文検索は語の一致を見るので、得意な質問が異なる。両方の結果を統合すると、片方だけでは取りこぼす候補を拾える。",
	scoreScales:
		"二つの検索の点数は、尺度が違う。ベクトル検索の点数は -1 から 1 のコサイン類似度で、全文検索の点数は ts_rank という別の尺度である。点数を単純に足したり、重みを付けて足したりしても、尺度の違いが結果に影響してしまい、重みの調整も難しい。",
	rrf: "Reciprocal Rank Fusion（RRF）は、点数ではなく順位だけを使って統合する手法である。各検索結果の順位を 1 から数え、候補ごとに「1 を（k に順位を足した値）で割った値」を全ての検索結果にわたって合計する。合計が大きい候補ほど上位になる。\n\n定数 k には 60 がよく使われる。k が小さいと上位の順位の影響が強くなり、大きいと順位の差が緩やかになる。このリポジトリでは k の既定値を 60 にしている。\n\nRRF には三つの性質がある。一つ目は、点数の尺度に依存しないことである。二つ目は、複数の検索で上位に現れた候補ほど高く評価されることである。三つ目は、同じ候補は統合後に一件だけ残ることで、複数の検索で見つかっても重複しない。\n\n順位が同じ合計になったときの並びは、結果を決まった順序にするために、候補の ID の辞書順で決める。実行のたびに順序が変わらないので、テストで検証しやすい。",
	agenticRag:
		"Agentic RAG は、検索の要否、検索語、検索の回数をエージェントに決めさせる方式である。通常の RAG は、質問のたびに必ず一回だけ検索する固定の手順であるのに対し、Agentic RAG では検索が選択肢の一つになる。",
});

/** Questions that the scenarios below answer; the UI offers them as input examples in `mock`. */
export const M2_1_SAMPLE_QUESTIONS = Object.freeze({
	/** Plain query: the question is a chunk's text, so the mock embedding finds it. */
	answer: M2_CORPUS_TEXT.ragOverview,
	/** The mock answer cites [1] and also an out-of-range [9], which is removed. */
	outOfRange: M2_CORPUS_TEXT.recallAtK,
	/** With HyDE on, the hypothetical answer is the text of the `whyRag` chunk. */
	hyde: "社内の規程を最新の状態に保ったまま、モデルに答えさせるにはどうしたらよいですか。",
	/** With Multi-Query on, the three sub-queries are the texts of three hybrid-search chunks. */
	multiQuery: "ハイブリッド検索の仕組みを、複数の観点から説明してください。",
	/** Agentic RAG: the agent searches, then answers with a footnote. */
	agenticSearch: "Agentic RAG は固定の RAG と何が違いますか。",
	/** Agentic RAG: the agent answers without searching. */
	agenticNoSearch: "ありがとう、助かりました。",
});

export const M2_1_SCENARIOS: readonly ScenarioDefinition[] = [
	defineScenario({
		id: "m2-1/rag/answer",
		turns: [
			{
				match: { purpose: "chat", lastUserTextIncludes: `質問: ${M2_1_SAMPLE_QUESTIONS.answer}` },
				respond: {
					text: "RAG は、質問の前に外部の文書から関連する部分を検索し、その内容を根拠に回答を生成する方式です [1]。",
					chunkSize: 8,
					usage: { inputTokens: 220, outputTokens: 60 },
				},
			},
		],
	}),
	defineScenario({
		id: "m2-1/rag/answer-out-of-range",
		turns: [
			{
				match: {
					purpose: "chat",
					lastUserTextIncludes: `質問: ${M2_1_SAMPLE_QUESTIONS.outOfRange}`,
				},
				respond: {
					text: "recall@k は、正解のチャンクのうち上位 k 件に含まれていた割合です [1]。別の指標として hit rate もあります [9]。",
					chunkSize: 8,
					usage: { inputTokens: 180, outputTokens: 70 },
				},
			},
		],
	}),
	defineScenario({
		id: "m2-1/hyde",
		turns: [
			{
				match: { purpose: "structured", lastUserTextIncludes: M2_1_SAMPLE_QUESTIONS.hyde },
				respond: {
					text: M2_CORPUS_TEXT.whyRag,
					usage: { inputTokens: 90, outputTokens: 120 },
				},
			},
			{
				match: {
					purpose: "chat",
					lastUserTextIncludes: `質問: ${M2_1_SAMPLE_QUESTIONS.hyde}`,
				},
				respond: {
					text: "検索した文書を質問と一緒にモデルへ渡します。再学習は要りません [1]。",
					chunkSize: 8,
					usage: { inputTokens: 260, outputTokens: 40 },
				},
			},
		],
	}),
	defineScenario({
		id: "m2-1/multi-query",
		turns: [
			{
				match: { purpose: "structured", lastUserTextIncludes: M2_1_SAMPLE_QUESTIONS.multiQuery },
				respond: {
					object: {
						queries: [
							M2_CORPUS_TEXT.hybridOverview,
							M2_CORPUS_TEXT.scoreScales,
							M2_CORPUS_TEXT.rrf,
						],
					},
					usage: { inputTokens: 100, outputTokens: 150 },
				},
			},
			{
				match: {
					purpose: "chat",
					lastUserTextIncludes: `質問: ${M2_1_SAMPLE_QUESTIONS.multiQuery}`,
				},
				respond: {
					text: "ハイブリッド検索は、ベクトル検索と全文検索の結果を組み合わせます [1]。点数の尺度が違うため順位で統合する RRF を使います [2]。",
					chunkSize: 8,
					usage: { inputTokens: 520, outputTokens: 80 },
				},
			},
		],
	}),
	defineScenario({
		id: "m2-1/agentic/search-then-answer",
		turns: [
			{
				match: {
					purpose: "chat",
					lastUserTextIncludes: M2_1_SAMPLE_QUESTIONS.agenticSearch,
					stepIndex: 0,
				},
				respond: {
					toolCalls: [
						{ toolName: "searchKnowledgeBase", input: { query: M2_CORPUS_TEXT.agenticRag } },
					],
				},
			},
			{
				// Named by its question like the first turn: a turn that answered every search result would
				// also answer the help desk's (003 m3-2), which searches with the same tool.
				match: {
					purpose: "chat",
					lastUserTextIncludes: M2_1_SAMPLE_QUESTIONS.agenticSearch,
					stepIndex: 1,
					toolResultFor: "searchKnowledgeBase",
				},
				respond: {
					text: "固定の RAG は毎回一回だけ検索しますが、Agentic RAG は検索の要否や回数をエージェントが決めます [1]。",
					chunkSize: 8,
				},
			},
		],
	}),
	defineScenario({
		id: "m2-1/agentic/no-search",
		turns: [
			{
				match: {
					purpose: "chat",
					lastUserTextIncludes: M2_1_SAMPLE_QUESTIONS.agenticNoSearch,
					stepIndex: 0,
				},
				respond: { text: "どういたしまして。ほかにも知りたいことがあれば聞いてください。" },
			},
		],
	}),
];
