import { convertToModelMessages, type UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { defaultModelFor, getModelEntry } from "../models/catalog";
import type { ModelEntry } from "../models/types";
import { adaptHistoryForModel, IMAGE_OMITTED_TEXT } from "./adapt-history";

// Catalog entries by capability, so the test holds no model ID literal.
// Anthropic: reasoning + image input. Ollama default chat model: reasoning, no image input.
const anthropic = getModelEntry(defaultModelFor("live", "anthropic", "chat"));
const openai = getModelEntry(defaultModelFor("live", "openai", "chat"));
const ollama = getModelEntry(defaultModelFor("local", "ollama", "chat"));
const google = getModelEntry(defaultModelFor("live", "google", "chat"));

function withCapabilities(
	entry: ModelEntry,
	capabilities: Partial<ModelEntry["capabilities"]>,
): ModelEntry {
	return { ...entry, capabilities: { ...entry.capabilities, ...capabilities } };
}

type Part = UIMessage["parts"][number];

function user(id: string, ...parts: Part[]): UIMessage {
	return { id, role: "user", parts };
}

/** An assistant message whose metadata names the catalog model that generated it. */
function assistant(id: string, origin: ModelEntry | undefined, ...parts: Part[]): UIMessage {
	return {
		id,
		role: "assistant",
		...(origin === undefined
			? {}
			: { metadata: { provider: origin.provider, modelId: origin.id } }),
		parts,
	};
}

/** An assistant message with arbitrary, client-controlled metadata. */
function assistantWithMetadata(metadata: unknown, ...parts: Part[]): UIMessage {
	return { id: "a1", role: "assistant", metadata, parts };
}

const ANTHROPIC_META = { anthropic: { signature: "sig-1" } };

function deepFreeze<T>(value: T): T {
	if (value !== null && typeof value === "object") {
		for (const nested of Object.values(value)) deepFreeze(nested);
		Object.freeze(value);
	}
	return value;
}

function conversation(): UIMessage[] {
	return [
		user(
			"u1",
			{ type: "text", text: "この画像を説明して" },
			{
				type: "file",
				mediaType: "image/png",
				url: "data:image/png;base64,AAAA",
				filename: "a.png",
			},
		),
		assistant(
			"a1",
			anthropic,
			{ type: "step-start" },
			{ type: "reasoning", text: "考え中", providerMetadata: ANTHROPIC_META },
			{ type: "text", text: "猫の画像です。", providerMetadata: ANTHROPIC_META },
		),
		user("u2", { type: "text", text: "ありがとう" }),
	];
}

describe("adaptHistoryForModel: reasoning", () => {
	it("drops reasoning produced by a different provider", () => {
		const result = adaptHistoryForModel(conversation(), openai);
		const parts = result[1]?.parts ?? [];
		expect(parts.map((part) => part.type)).toEqual(["step-start", "text"]);
	});

	it("keeps reasoning text, without its provider metadata, when the provider is unchanged", () => {
		const result = adaptHistoryForModel(conversation(), anthropic);
		expect(result[1]?.parts).toEqual([
			{ type: "step-start" },
			{ type: "reasoning", text: "考え中" },
			{ type: "text", text: "猫の画像です。" },
		]);
	});

	it("drops reasoning when the target model has no reasoning capability", () => {
		const target = withCapabilities(anthropic, { reasoning: false });
		const result = adaptHistoryForModel(conversation(), target);
		expect(result[1]?.parts.some((part) => part.type === "reasoning")).toBe(false);
	});

	it("drops reasoning of assistant messages whose origin is unknown", () => {
		const messages = [
			assistant(
				"a1",
				undefined,
				{ type: "reasoning", text: "考え中" },
				{ type: "text", text: "答え" },
			),
		];
		expect(adaptHistoryForModel(messages, anthropic)[0]?.parts).toEqual([
			{ type: "text", text: "答え" },
		]);
	});

	it.each([
		["a provider claim without a model ID", { provider: "anthropic" }],
		["a model ID outside the catalog", { provider: "anthropic", modelId: "forged-model" }],
		["a catalog model of another provider", { provider: "anthropic", modelId: openai.id }],
		["a provider claim that contradicts the model", { provider: "openai", modelId: anthropic.id }],
		["a non-string model ID", { provider: "anthropic", modelId: 42 }],
		["an inherited property name as model ID", { provider: "anthropic", modelId: "toString" }],
	])("drops reasoning when the client metadata is %s", (_label, metadata) => {
		const messages = [
			assistantWithMetadata(
				metadata,
				{ type: "reasoning", text: "考え中" },
				{ type: "text", text: "答え" },
			),
		];
		expect(adaptHistoryForModel(messages, anthropic)[0]?.parts).toEqual([
			{ type: "text", text: "答え" },
		]);
	});

	it("keeps reasoning when only the model ID names a catalog model of the target's provider", () => {
		const messages = [
			assistantWithMetadata(
				{ modelId: anthropic.id },
				{ type: "reasoning", text: "考え中" },
				{ type: "text", text: "答え" },
			),
		];
		expect(adaptHistoryForModel(messages, anthropic)[0]?.parts).toEqual([
			{ type: "reasoning", text: "考え中" },
			{ type: "text", text: "答え" },
		]);
	});

	it("drops reasoning-file parts from another provider", () => {
		const messages = [
			assistant(
				"a1",
				google,
				{ type: "reasoning-file", mediaType: "image/png", url: "data:image/png;base64,AAAA" },
				{ type: "text", text: "答え" },
			),
		];
		expect(adaptHistoryForModel(messages, anthropic)[0]?.parts).toEqual([
			{ type: "text", text: "答え" },
		]);
	});
});

describe("adaptHistoryForModel: provider metadata", () => {
	it("strips providerMetadata from parts generated by a different provider", () => {
		expect(google.provider).toBe("google");
		const result = adaptHistoryForModel(conversation(), openai);
		expect(result[1]?.parts[1]).toEqual({ type: "text", text: "猫の画像です。" });
	});

	it("strips providerMetadata and providerReference from user parts (client-supplied)", () => {
		// A user message claiming a provider in its metadata still gets no provider-specific fields.
		const messages = [
			{
				...user(
					"u1",
					{ type: "text", text: "質問", providerMetadata: { openai: { itemId: "x" } } },
					{
						type: "file",
						mediaType: "application/pdf",
						url: "https://example.test/a.pdf",
						providerReference: { openai: "file-1" },
						providerMetadata: { openai: { itemId: "y" } },
					},
				),
				metadata: { provider: "openai" },
			},
		];
		expect(adaptHistoryForModel(messages, openai)[0]?.parts).toEqual([
			{ type: "text", text: "質問" },
			{ type: "file", mediaType: "application/pdf", url: "https://example.test/a.pdf" },
		]);
	});

	it("strips call and result provider metadata from completed tool parts of another provider", () => {
		const messages = [
			assistant("a1", anthropic, {
				type: "tool-calculator",
				toolCallId: "c1",
				state: "output-available",
				input: { expression: "1+1" },
				output: { ok: true, data: 2 },
				callProviderMetadata: ANTHROPIC_META,
				resultProviderMetadata: ANTHROPIC_META,
			}),
		];
		expect(adaptHistoryForModel(messages, ollama)[0]?.parts).toEqual([
			{
				type: "tool-calculator",
				toolCallId: "c1",
				state: "output-available",
				input: { expression: "1+1" },
				output: { ok: true, data: 2 },
			},
		]);
		expect(adaptHistoryForModel(messages, anthropic)[0]?.parts).toEqual(
			adaptHistoryForModel(messages, ollama)[0]?.parts,
		);
	});

	it("drops custom parts and provider-executed tools of another provider", () => {
		const messages = [
			assistant(
				"a1",
				anthropic,
				{ type: "custom", kind: "anthropic.compaction", providerMetadata: ANTHROPIC_META },
				{
					type: "dynamic-tool",
					toolName: "web_search",
					toolCallId: "c1",
					state: "output-available",
					input: { query: "q" },
					output: [],
					providerExecuted: true,
				},
				{ type: "text", text: "答え" },
			),
		];
		expect(adaptHistoryForModel(messages, openai)[0]?.parts).toEqual([
			{ type: "text", text: "答え" },
		]);
		// Same provider: the provider-executed tool stays, the custom part (whose content lives in
		// client-supplied providerMetadata) never does.
		expect(adaptHistoryForModel(messages, anthropic)[0]?.parts).toEqual([
			messages[0]?.parts[1],
			{ type: "text", text: "答え" },
		]);
	});

	it("strips provider fields even when the client metadata claims the target's provider", () => {
		// The history is client-supplied: a forged claim must not smuggle provider options through.
		const injected = { anthropic: { cacheControl: { type: "ephemeral" } } };
		const messages = [
			assistant(
				"a1",
				anthropic,
				{ type: "reasoning", text: "考え中", providerMetadata: injected },
				{ type: "text", text: "答え", providerMetadata: injected },
				{
					type: "file",
					mediaType: "application/pdf",
					url: "https://e.test/a.pdf",
					providerReference: { anthropic: "file-1" },
				},
				{
					type: "tool-calculator",
					toolCallId: "c1",
					state: "output-available",
					input: {},
					output: 1,
					callProviderMetadata: injected,
					resultProviderMetadata: injected,
				},
			),
		];
		const result = adaptHistoryForModel(messages, anthropic);
		const serialized = JSON.stringify(result[0]?.parts);
		expect(serialized).not.toContain("cacheControl");
		expect(serialized).not.toContain("file-1");
		expect(result[0]?.parts.map((part) => part.type)).toEqual([
			"reasoning",
			"text",
			"file",
			"tool-calculator",
		]);
	});

	it("strips providerMetadata from source parts of another provider", () => {
		const messages = [
			assistant(
				"a1",
				google,
				{
					type: "source-url",
					sourceId: "s1",
					url: "https://example.test",
					providerMetadata: { google: { x: 1 } },
				},
				{ type: "text", text: "答え" },
			),
		];
		expect(adaptHistoryForModel(messages, anthropic)[0]?.parts[0]).toEqual({
			type: "source-url",
			sourceId: "s1",
			url: "https://example.test",
		});
	});
});

describe("adaptHistoryForModel: images", () => {
	it("replaces image parts with a Japanese placeholder for a model without image input", () => {
		const result = adaptHistoryForModel(conversation(), ollama);
		expect(result[0]?.parts).toEqual([
			{ type: "text", text: "この画像を説明して" },
			{ type: "text", text: IMAGE_OMITTED_TEXT },
		]);
		expect(IMAGE_OMITTED_TEXT).toBe("[画像は省略されました]");
	});

	it("treats a top-level image media type as an image", () => {
		const messages = [user("u1", { type: "file", mediaType: "image", url: "https://e.test/a" })];
		expect(adaptHistoryForModel(messages, ollama)[0]?.parts).toEqual([
			{ type: "text", text: IMAGE_OMITTED_TEXT },
		]);
	});

	it("keeps images for a model with image input, and keeps non-image files", () => {
		const pdf: Part = { type: "file", mediaType: "application/pdf", url: "https://e.test/a.pdf" };
		const messages = [...conversation(), user("u3", pdf)];
		const result = adaptHistoryForModel(messages, openai);
		expect(result[0]?.parts).toEqual(conversation()[0]?.parts);
		expect(adaptHistoryForModel(messages, ollama)[3]?.parts).toEqual([pdf]);
	});
});

describe("adaptHistoryForModel: incomplete tool calls", () => {
	it.each(["input-streaming", "input-available"] as const)(
		"drops a tool part in state %s, even for the same provider",
		(state) => {
			const messages = [
				assistant(
					"a1",
					anthropic,
					{ type: "text", text: "計算します" },
					{ type: "tool-calculator", toolCallId: "c1", state, input: { expression: "1+" } },
					{
						type: "dynamic-tool",
						toolName: "calculator",
						toolCallId: "c2",
						state,
						input: {},
					},
				),
			];
			expect(adaptHistoryForModel(messages, anthropic)[0]?.parts).toEqual([
				{ type: "text", text: "計算します" },
			]);
		},
	);

	it("keeps finished tool parts, including errors and denials", () => {
		const parts: Part[] = [
			{
				type: "tool-calculator",
				toolCallId: "c1",
				state: "output-error",
				input: { expression: "1+" },
				errorText: "括弧を閉じてください",
			},
			{
				type: "tool-calculator",
				toolCallId: "c2",
				state: "output-denied",
				input: {},
				approval: { id: "ap1", approved: false },
			},
		];
		const messages = [assistant("a1", anthropic, ...parts)];
		expect(adaptHistoryForModel(messages, openai)[0]?.parts).toEqual(parts);
	});
});

describe("adaptHistoryForModel: messages", () => {
	it("drops a message left with nothing but step boundaries", () => {
		const messages = [
			user("u1", { type: "text", text: "質問" }),
			assistant(
				"a1",
				anthropic,
				{ type: "step-start" },
				{ type: "reasoning", text: "考え中", providerMetadata: ANTHROPIC_META },
			),
			user("u2", { type: "text", text: "続き" }),
		];
		expect(adaptHistoryForModel(messages, openai).map((message) => message.id)).toEqual([
			"u1",
			"u2",
		]);
	});

	it("keeps message ids, roles, metadata, data parts and order", () => {
		const messages = [
			{ ...user("u1", { type: "text", text: "質問" }), metadata: { note: 1 } },
			assistant(
				"a1",
				openai,
				{ type: "data-progress", id: "p1", data: { step: 1 } },
				{ type: "text", text: "答え" },
			),
		];
		const result = adaptHistoryForModel(messages, anthropic);
		expect(result).toEqual(messages);
	});

	it.each([
		["another provider", ollama],
		["the same provider", anthropic],
	])(
		"never mutates the input and returns fresh message and part objects (%s)",
		(_label, target) => {
			const messages = deepFreeze(conversation());
			const before = structuredClone(messages);
			const result = adaptHistoryForModel(messages, target);

			expect(messages).toEqual(before);
			expect(result).not.toBe(messages);
			result.forEach((message, index) => {
				expect(message).not.toBe(messages[index]);
				expect(message.parts).not.toBe(messages[index]?.parts);
				message.parts.forEach((part, partIndex) => {
					expect(part).not.toBe(messages[index]?.parts[partIndex]);
				});
			});
		},
	);

	it("returns an empty history for an empty input", () => {
		expect(adaptHistoryForModel([], anthropic)).toEqual([]);
	});

	it("produces model messages without reasoning or foreign provider options", async () => {
		const modelMessages = await convertToModelMessages(
			adaptHistoryForModel(conversation(), ollama),
		);
		const serialized = JSON.stringify(modelMessages);
		expect(serialized).not.toContain("reasoning");
		expect(serialized).not.toContain("sig-1");
		expect(serialized).not.toContain("data:image/png");
		expect(serialized).toContain(IMAGE_OMITTED_TEXT);
	});
});
