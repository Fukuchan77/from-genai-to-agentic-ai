// Capability example (plan C21, Req 1.13, 1.14): a real local model summarises a short transcript
// into exactly three distinct key points. It runs only under `mise run test:local` with Ollama and
// the required models available; everywhere else `describeLocal` reports it as skipped with the
// reason from the local global setup, so the gate never counts it as passed.
import { loadPlatformConfig } from "@platform/ai-core/config";
import { createModelGateway } from "@platform/ai-core/models";
import {
	type LoadedSource,
	planSummary,
	SUMMARY_LIMITS,
	summarize,
	summarySchema,
} from "@platform/ai-core/summarize";
import { describeLocal } from "@platform/ai-core/testing";
import { expect } from "vitest";

const LOCAL_MODEL_TIMEOUT_MS = 180_000;

/** A transcript with three clearly separable topics, so three key points are a fair ask. */
const SOURCE: LoadedSource = {
	kind: "transcript",
	text: [
		"今日はエージェント開発で大切な三つのことを話します。",
		"一つ目は、ツールの説明を具体的に書くことです。モデルはツールの名前と説明だけを見て、いつ使うかを決めます。",
		"二つ目は、ループに上限を設けることです。ステップ数、トークン数、実行時間の三つの上限がないと、エージェントは止まらなくなることがあります。",
		"三つ目は、テストを決定論的にすることです。モックのモデルとフィクスチャを使えば、ネットワークなしで同じ結果を何度でも再現できます。",
		"この三つを守れば、学習用のエージェントでも安心して改良を重ねられます。",
	].join("\n"),
};

describeLocal("summary quality on a local model", (it) => {
	it(
		"returns exactly three distinct, non-empty key points",
		async () => {
			const config = loadPlatformConfig();
			expect(config.mode).toBe("local");
			const { model, entry } = await createModelGateway({ config }).resolve({
				purpose: "structured",
				require: ["structuredOutput"],
			});

			const { summary } = await summarize(planSummary(SOURCE, entry), { model, entry });

			expect(summarySchema.safeParse(summary).success).toBe(true);
			expect(summary.keyPoints).toHaveLength(SUMMARY_LIMITS.keyPointCount);
			const keyPoints = summary.keyPoints.map((point) => point.trim());
			for (const point of keyPoints) expect(point.length).toBeGreaterThan(0);
			expect(new Set(keyPoints).size).toBe(SUMMARY_LIMITS.keyPointCount);
		},
		LOCAL_MODEL_TIMEOUT_MS,
	);
});
