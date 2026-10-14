// Capability (plan C16, Req 2.10, 1.5): a real local Judge scores RAG answers on faithfulness and
// answer relevance, and a real local chat model is observed for how often it keeps the `[n]`
// footnotes. It runs only under `mise run test:local`; everywhere else `describeLocal` reports it
// as skipped with the reason. The Judge's verdicts are model output, so they are never part of the
// gate (constitution principle 3).
import path from "node:path";
import { loadPlatformConfig } from "@platform/ai-core/config";
import { createModelGateway, type ResolvedEmbeddingModel } from "@platform/ai-core/models";
import {
	createKnowledgeStore,
	createPgliteDatabase,
	type EvalQuestion,
	ingestDocuments,
	type JudgeChunk,
	judgeRagAnswer,
	type KnowledgeStore,
	listIngestableFiles,
	loadEvalSet,
	type RagDatabaseHandle,
	resolveCitations,
	runRetrieval,
	streamRagAnswer,
} from "@platform/ai-core/rag";
import { describeLocal } from "@platform/ai-core/testing";
import { afterAll, expect } from "vitest";

const LOCAL_MODEL_TIMEOUT_MS = 3_600_000;
const FOOTNOTE_SAMPLE_SIZE = 10;

const RAG_FIXTURES = path.resolve(import.meta.dirname, "../../../ai-core/fixtures/rag");
const CORPUS_ROOT = path.join(RAG_FIXTURES, "corpus");

/** One chunk of the corpus that defines RAG, and a question it answers. */
const QUESTION = "RAG とは何ですか。";
const GROUNDED_ANSWER =
	"RAG（検索拡張生成）は、質問する前に外部の文書から関連する部分を検索し、その内容を根拠として回答を生成する方式です。";
const UNFAITHFUL_ANSWER = `${GROUNDED_ANSWER} また、RAG は 2030 年に国際標準規格 ISO 99999 として正式に標準化されました。`;
const IRRELEVANT_ANSWER = "明日の東京の天気は晴れで、最高気温は二十五度の見込みです。";

interface Harness {
	readonly handle: RagDatabaseHandle;
	readonly store: KnowledgeStore;
	readonly embedding: ResolvedEmbeddingModel;
	readonly gateway: ReturnType<typeof createModelGateway>;
	readonly questions: readonly EvalQuestion[];
}

let harness: Promise<Harness> | undefined;

/** Built on first use inside a test, so a skipped run never touches Ollama or the database. */
function getHarness(): Promise<Harness> {
	harness ??= (async () => {
		const config = loadPlatformConfig();
		expect(config.mode).toBe("local");
		const gateway = createModelGateway({ config });
		const embedding = await gateway.resolveEmbedding();
		const handle = await createPgliteDatabase();
		await ingestDocuments({
			db: handle.db,
			embedding,
			source: "eval-corpus",
			root: CORPUS_ROOT,
			files: await listIngestableFiles(CORPUS_ROOT),
		});
		return {
			handle,
			store: createKnowledgeStore(handle.db),
			embedding,
			gateway,
			questions: await loadEvalSet(path.join(RAG_FIXTURES, "eval-set.json")),
		};
	})();
	return harness;
}

afterAll(async () => {
	if (harness) await (await harness).handle.close();
});

/** The labelled chunk that answers the fixed question, read from the ingested corpus. */
async function groundingChunks(): Promise<JudgeChunk[]> {
	const { store, questions } = await getHarness();
	const labelled = questions.find((entry) => entry.question === QUESTION);
	if (!labelled) throw new Error(`the question set has no question "${QUESTION}"`);
	return await store.getChunks(labelled.goldChunkIds);
}

describeLocal("RAG answer judging on local models", (it) => {
	it(
		"scores a grounded answer as faithful",
		async () => {
			const { gateway } = await getHarness();
			const { model } = await gateway.resolve({ purpose: "judge", require: ["structuredOutput"] });
			const judgements = await judgeRagAnswer({
				judgeModel: model,
				question: QUESTION,
				answer: GROUNDED_ANSWER,
				chunks: await groundingChunks(),
			});
			console.table(judgements);
			expect(judgements.find((entry) => entry.axis === "faithfulness")?.verdict).toBe("pass");
		},
		LOCAL_MODEL_TIMEOUT_MS,
	);

	it(
		"scores an answer with a claim the chunks do not contain as unfaithful",
		async () => {
			const { gateway } = await getHarness();
			const { model } = await gateway.resolve({ purpose: "judge", require: ["structuredOutput"] });
			const judgements = await judgeRagAnswer({
				judgeModel: model,
				question: QUESTION,
				answer: UNFAITHFUL_ANSWER,
				chunks: await groundingChunks(),
			});
			console.table(judgements);
			expect(judgements.find((entry) => entry.axis === "faithfulness")?.verdict).toBe("fail");
		},
		LOCAL_MODEL_TIMEOUT_MS,
	);

	it(
		"scores an answer that ignores the question as irrelevant",
		async () => {
			const { gateway } = await getHarness();
			const { model } = await gateway.resolve({ purpose: "judge", require: ["structuredOutput"] });
			const judgements = await judgeRagAnswer({
				judgeModel: model,
				question: QUESTION,
				answer: IRRELEVANT_ANSWER,
				chunks: await groundingChunks(),
			});
			console.table(judgements);
			expect(judgements.find((entry) => entry.axis === "answer-relevance")?.verdict).toBe("fail");
		},
		LOCAL_MODEL_TIMEOUT_MS,
	);

	it(
		"observes how often the chat model keeps valid [n] footnotes in its answers",
		async () => {
			const { gateway, store, embedding, questions } = await getHarness();
			const chat = await gateway.resolve({ purpose: "chat" });
			const sample = questions.slice(0, FOOTNOTE_SAMPLE_SIZE);
			let withFootnote = 0;
			let withOutOfRange = 0;
			let answersSeen = 0;
			for (const item of sample) {
				const { chunks } = await runRetrieval({
					question: item.question,
					settings: {
						topK: 5,
						minSimilarity: 0,
						pool: 20,
						methods: { hyde: false, multiQuery: false, hybrid: false, rerank: false },
					},
					deps: { store, embedding, structuredModel: undefined as never, rerank: undefined },
				});
				const result = streamRagAnswer({
					chatModel: chat.model,
					question: item.question,
					chunks,
				});
				const text = await result.text;
				answersSeen += 1;
				const resolved = resolveCitations(text, chunks);
				if (resolved.citations.some((citation) => citation.cited)) withFootnote += 1;
				if (resolved.removedCitations.length > 0) withOutOfRange += 1;
			}
			console.table([
				{
					model: chat.entry.id,
					answers: sample.length,
					"with a valid footnote": `${withFootnote}/${sample.length}`,
					"with an out-of-range footnote": `${withOutOfRange}/${sample.length}`,
				},
			]);
			// Only completion is asserted (every sampled question produced an answer); the footnote
			// rate itself is an observation.
			expect(answersSeen).toBe(sample.length);
		},
		LOCAL_MODEL_TIMEOUT_MS,
	);
});
