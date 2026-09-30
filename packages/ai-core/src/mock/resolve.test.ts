import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCassetteStore } from "./cassette-store";
import type { LanguageModelV4CallOptions } from "./request-key";
import { requestKey } from "./request-key";
import {
	findAmbiguousScenarioMatches,
	MockFixtureMissingError,
	resolveMockResponse,
} from "./resolve";
import { defineScenario } from "./scenario";

const directories: string[] = [];
afterEach(async () =>
	Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true }))),
);

function params(text = "hello"): LanguageModelV4CallOptions {
	return { prompt: [{ role: "user", content: [{ type: "text", text }] }] };
}

describe("resolveMockResponse", () => {
	it("prefers the first matching scenario over a cassette", async () => {
		const directory = await mkdtemp(path.join(tmpdir(), "cassette-"));
		directories.push(directory);
		const store = createCassetteStore(directory);
		const key = requestKey(params(), "chat");
		await store.put(key, {
			version: 1,
			key,
			request: { purpose: "chat", modelId: "mock", promptDigest: key, toolNames: [] },
			parts: [
				{ type: "text-start", id: "cassette" },
				{ type: "text-delta", id: "cassette", delta: "cassette" },
				{ type: "text-end", id: "cassette" },
			],
			recordedAt: "2026-09-30T00:00:00.000Z",
			recordedWith: "local",
		});
		const scenarios = [
			defineScenario({ id: "first", turns: [{ match: {}, respond: { text: "scenario" } }] }),
			defineScenario({ id: "second", turns: [{ match: {}, respond: { text: "later" } }] }),
		];

		const resolved = await resolveMockResponse({
			params: params(),
			purpose: "chat",
			scenarios,
			cassettes: store,
		});
		expect(resolved).toMatchObject({
			source: "scenario",
			scenarioId: "first",
			response: { text: "scenario" },
		});
	});

	it("falls back to cassette by request key and never to a network", async () => {
		const directory = await mkdtemp(path.join(tmpdir(), "cassette-"));
		directories.push(directory);
		const store = createCassetteStore(directory);
		const key = requestKey(params(), "chat");
		await store.put(key, {
			version: 1,
			key,
			request: { purpose: "chat", modelId: "mock", promptDigest: key, toolNames: [] },
			parts: [
				{ type: "text-start", id: "t" },
				{ type: "text-delta", id: "t", delta: "saved" },
				{ type: "text-end", id: "t" },
			],
			recordedAt: "2026-09-30T00:00:00.000Z",
			recordedWith: "live",
		});

		await expect(
			resolveMockResponse({ params: params(), purpose: "chat", scenarios: [], cassettes: store }),
		).resolves.toMatchObject({ source: "cassette", cassette: { key } });
		await expect(
			resolveMockResponse({
				params: params("missing"),
				purpose: "chat",
				scenarios: [],
				cassettes: store,
			}),
		).rejects.toMatchObject({
			name: "MockFixtureMissingError",
			key: requestKey(params("missing"), "chat"),
		});
	});

	it("detects ambiguous scenario predicates without changing first-match runtime behavior", () => {
		const scenarios = [
			defineScenario({ id: "broad", turns: [{ match: {}, respond: { text: "a" } }] }),
			defineScenario({
				id: "also-broad",
				turns: [{ match: { purpose: "chat" }, respond: { text: "b" } }],
			}),
		];
		expect(findAmbiguousScenarioMatches(params(), "chat", scenarios)).toEqual([
			{ scenarioId: "broad", turnIndex: 0 },
			{ scenarioId: "also-broad", turnIndex: 0 },
		]);
	});

	it("exposes only keys and scenario ids in missing-fixture diagnostics", () => {
		const error = new MockFixtureMissingError("abc" as ReturnType<typeof requestKey>, [
			"scenario/a",
		]);
		expect(error.message).toBe("モック応答が見つかりませんでした。");
		expect(error.details).toEqual({ key: "abc", nearest: ["scenario/a"] });
	});

	it("rejects unsafe storage keys and supports concurrent writes to one cassette", async () => {
		const directory = await mkdtemp(path.join(tmpdir(), "cassette-"));
		directories.push(directory);
		const store = createCassetteStore(directory);
		await expect(store.put("../escaped", {})).rejects.toThrow("Invalid cassette storage key");
		const key = requestKey(params(), "chat");
		const cassette = {
			version: 1 as const,
			key,
			request: { purpose: "chat" as const, modelId: "mock", promptDigest: key, toolNames: [] },
			parts: [
				{ type: "text-start" as const, id: "text" },
				{ type: "text-end" as const, id: "text" },
			],
			recordedAt: "2026-09-30T00:00:00.000Z",
			recordedWith: "local" as const,
		};
		const writes = await Promise.allSettled([
			store.put(`llm/${key}`, cassette),
			store.put(`llm/${key}`, cassette),
		]);
		expect(writes.every((write) => write.status === "fulfilled")).toBe(true);
	});

	it("validates cassette JSON at the filesystem boundary", async () => {
		const directory = await mkdtemp(path.join(tmpdir(), "cassette-"));
		directories.push(directory);
		const key = requestKey(params(), "chat");
		await mkdir(path.join(directory, "llm"), { recursive: true });
		await writeFile(
			path.join(directory, "llm", `${key}.json`),
			JSON.stringify({ version: 2, key }),
		);
		await expect(createCassetteStore(directory).get(key)).rejects.toThrow();
		await writeFile(
			path.join(directory, "llm", `${key}.json`),
			JSON.stringify({
				version: 1,
				key,
				request: { purpose: "chat", modelId: "mock", promptDigest: key, toolNames: [] },
				parts: [{ type: "text-delta" }],
				recordedAt: "2026-09-30T00:00:00.000Z",
				recordedWith: "local",
			}),
		);
		await expect(createCassetteStore(directory).get(key)).rejects.toThrow();
	});
});
