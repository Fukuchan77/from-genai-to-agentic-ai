import { describe, expect, it } from "vitest";
import type { LanguageModelV4CallOptions } from "./request-key";
import { normalizeRequest, requestKey } from "./request-key";

function callOptions(
	overrides: Partial<LanguageModelV4CallOptions> = {},
): LanguageModelV4CallOptions {
	return {
		prompt: [{ role: "user", content: [{ type: "text", text: "weather in Tokyo" }] }],
		tools: [
			{
				type: "function",
				name: "weather",
				inputSchema: { type: "object", properties: { city: { type: "string" } } },
			},
		],
		...overrides,
	};
}

describe("requestKey", () => {
	it("normalizes object key order and ignores provider-specific options", () => {
		const first = callOptions({
			providerOptions: { openai: { zeta: 2, alpha: 1 } },
			responseFormat: { type: "json", schema: { type: "object", required: ["answer"] } },
		});
		const second = callOptions({
			providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
			responseFormat: { type: "json", schema: { required: ["answer"], type: "object" } },
		});

		expect(normalizeRequest(first, "chat")).toEqual(normalizeRequest(second, "chat"));
		expect(requestKey(first, "chat")).toBe(requestKey(second, "chat"));
		expect(requestKey(first, "chat")).toMatch(/^[a-f0-9]{64}$/u);
	});

	it.each([
		[
			"prompt",
			callOptions({ prompt: [{ role: "user", content: [{ type: "text", text: "rain" }] }] }),
			"chat",
		],
		[
			"tool name",
			callOptions({ tools: [{ type: "function", name: "forecast", inputSchema: {} }] }),
			"chat",
		],
		["purpose", callOptions(), "structured"],
	] as const)("changes when %s changes", (_label, options, purpose) => {
		expect(requestKey(options, purpose)).not.toBe(requestKey(callOptions(), "chat"));
	});
});
