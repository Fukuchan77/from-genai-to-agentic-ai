import { describe, expect, it } from "vitest";
import { MODEL_CATALOG } from "../models/catalog";
import {
	RECOMMEND_REQUEST_LIMITS,
	recommendRequestSchema,
	storedProfileSchema,
} from "./recommend-request-schema";

const message = (role: "user" | "assistant", text: string, id = "m1") => ({
	id,
	role,
	parts: [{ type: "text", text }],
});
const valid = { id: "chat-1", messages: [message("user", "ランニングシューズを探しています")] };

describe("recommendRequestSchema", () => {
	it("accepts the minimal body and the optional fields", () => {
		expect(recommendRequestSchema.safeParse(valid).success).toBe(true);
		const full = recommendRequestSchema.safeParse({
			...valid,
			modelId: Object.keys(MODEL_CATALOG)[0],
			profile: { interests: ["ランニング"], budgetYen: 10_000, concerns: [] },
			trigger: "submit-message",
			messageId: "m9",
		});
		expect(full.success).toBe(true);
	});

	it.each([
		["an unknown field", { ...valid, extra: 1 }],
		["no id", { messages: valid.messages }],
		["an empty id", { ...valid, id: "" }],
		["an id over 200 characters", { ...valid, id: "a".repeat(201) }],
		["no messages", { ...valid, messages: [] }],
		["a system message", { ...valid, messages: [{ ...message("user", "x"), role: "system" }] }],
		["an unknown model", { ...valid, modelId: "not-a-model" }],
		[
			"a non-text part",
			{
				...valid,
				messages: [{ id: "m", role: "user", parts: [{ type: "file", url: "data:,x" }] }],
			},
		],
		["a message without parts", { ...valid, messages: [{ id: "m", role: "user", parts: [] }] }],
		["an assistant message last", { ...valid, messages: [message("assistant", "こんにちは")] }],
		["a blank last user message", { ...valid, messages: [message("user", " \n ")] }],
		[
			"a text over the limit",
			{
				...valid,
				messages: [message("user", "あ".repeat(RECOMMEND_REQUEST_LIMITS.textMaxCharacters + 1))],
			},
		],
		[
			"too many parts",
			{
				...valid,
				messages: [
					{
						id: "m",
						role: "user",
						parts: Array.from({ length: RECOMMEND_REQUEST_LIMITS.partsMax + 1 }, () => ({
							type: "text",
							text: "a",
						})),
					},
				],
			},
		],
		["an unknown profile field", { ...valid, profile: { ...emptyProfile(), extra: 1 } }],
		["a bad trigger", { ...valid, trigger: "other" }],
	])("rejects %s", (_name, body) => {
		expect(recommendRequestSchema.safeParse(body).success).toBe(false);
	});

	it("accepts text exactly at the limit, counted in characters", () => {
		const text = "あ".repeat(RECOMMEND_REQUEST_LIMITS.textMaxCharacters);
		expect(
			recommendRequestSchema.safeParse({ ...valid, messages: [message("user", text)] }).success,
		).toBe(true);
	});

	it("accepts an earlier assistant message when the last one is the user's", () => {
		const body = {
			...valid,
			messages: [
				message("user", "a", "1"),
				message("assistant", "b", "2"),
				message("user", "c", "3"),
			],
		};
		expect(recommendRequestSchema.safeParse(body).success).toBe(true);
	});

	it("accepts the data, step and text parts the route itself streams in an assistant message", () => {
		const body = {
			...valid,
			messages: [
				message("user", "a", "1"),
				{
					id: "2",
					role: "assistant",
					parts: [
						{ type: "step-start" },
						{ type: "data-marketing-profile", id: "profile", data: { interests: [] } },
						{ type: "data-marketing-recommendation", id: "r", data: { items: [], dropped: 0 } },
						{ type: "text", text: "2 件をおすすめします。", state: "done" },
					],
				},
				message("user", "c", "3"),
			],
		};
		const parsed = recommendRequestSchema.safeParse(body);
		expect(parsed.success).toBe(true);
	});

	it("still refuses files and unknown part types, and any non-text part from the user", () => {
		const withParts = (role: "user" | "assistant", parts: object[]) => ({
			...valid,
			messages: [message("user", "a", "1"), { id: "2", role, parts }, message("user", "c", "3")],
		});
		for (const part of [{ type: "file", url: "data:,x" }, { type: "tool-x" }, { type: "dataX" }]) {
			expect(recommendRequestSchema.safeParse(withParts("assistant", [part])).success).toBe(false);
		}
		expect(
			recommendRequestSchema.safeParse(withParts("user", [{ type: "data-marketing-profile" }]))
				.success,
		).toBe(false);
	});

	it("keeps extra fields of a text part (state, providerMetadata) without failing", () => {
		const body = {
			...valid,
			messages: [{ id: "m", role: "user", parts: [{ type: "text", text: "a", state: "done" }] }],
		};
		expect(recommendRequestSchema.safeParse(body).success).toBe(true);
	});
});

function emptyProfile() {
	return { interests: [], budgetYen: null, concerns: [] };
}

describe("storedProfileSchema", () => {
	it("accepts an empty profile and a full one", () => {
		expect(storedProfileSchema.safeParse(emptyProfile()).success).toBe(true);
		expect(
			storedProfileSchema.safeParse({ interests: ["a"], budgetYen: 0, concerns: ["b"] }).success,
		).toBe(true);
	});

	it.each([
		["a negative budget", { ...emptyProfile(), budgetYen: -1 }],
		["a fractional budget", { ...emptyProfile(), budgetYen: 1.5 }],
		["a budget above one billion", { ...emptyProfile(), budgetYen: 1_000_000_001 }],
		["a missing budget", { interests: [], concerns: [] }],
		["11 interests", { ...emptyProfile(), interests: Array.from({ length: 11 }, () => "a") }],
		["11 concerns", { ...emptyProfile(), concerns: Array.from({ length: 11 }, () => "a") }],
		["a 101-character item", { ...emptyProfile(), interests: ["a".repeat(101)] }],
		["a non-string item", { ...emptyProfile(), concerns: [1] }],
	])("rejects %s", (_name, profile) => {
		expect(storedProfileSchema.safeParse(profile).success).toBe(false);
	});

	it("accepts 10 items of 100 characters", () => {
		const items = Array.from({ length: 10 }, () => "a".repeat(100));
		expect(
			storedProfileSchema.safeParse({ interests: items, budgetYen: 1_000_000_000, concerns: items })
				.success,
		).toBe(true);
	});
});
