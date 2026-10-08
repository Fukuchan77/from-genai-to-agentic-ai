// Local-only check (Req 1.13, 1.14, 2.3): the catalog's default `local` models, resolved through
// the gateway, really answer with a tool call and with schema-valid structured output on Ollama.
// Without a reachable Ollama (or outside `mise run test:local`) every test is reported as skipped
// with the reason from the local global setup, and is never counted as passed.
import { generateText, Output, tool } from "ai";
import { expect, it } from "vitest";
import { z } from "zod";
import { loadPlatformConfig } from "../config";
import { describeLocal } from "../testing/local-only";
import { createModelGateway } from "./gateway";

const LOCAL_MODEL_TIMEOUT_MS = 120_000;

function localGateway() {
	const config = loadPlatformConfig();
	expect(config.mode).toBe("local");
	return createModelGateway({ config });
}

describeLocal("catalog defaults on local Ollama", () => {
	it(
		"the default chat model answers with a tool call",
		async () => {
			const { model, entry } = await localGateway().resolve({
				purpose: "chat",
				require: ["tools"],
			});

			const result = await generateText({
				model,
				prompt: "Use the add tool to add 2 and 3.",
				tools: {
					add: tool({
						description: "Adds two numbers.",
						inputSchema: z.object({ a: z.number(), b: z.number() }),
					}),
				},
				toolChoice: "required",
			});

			expect(entry.capabilities.tools).toBe(true);
			expect(result.toolCalls.map((call) => call.toolName)).toContain("add");
		},
		LOCAL_MODEL_TIMEOUT_MS,
	);

	it(
		"the default structured model returns schema-valid output",
		async () => {
			const schema = z.object({ city: z.string().min(1), country: z.string().min(1) });
			const { model } = await localGateway().resolve({
				purpose: "structured",
				require: ["structuredOutput"],
			});

			const { output } = await generateText({
				model,
				output: Output.object({ schema }),
				prompt: "Return the capital city of Japan and its country as JSON.",
			});

			expect(schema.safeParse(output).success).toBe(true);
		},
		LOCAL_MODEL_TIMEOUT_MS,
	);
});
