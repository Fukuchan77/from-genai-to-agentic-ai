import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { loadPlatformConfig } from "../config";
import { createModelGateway, getModelEntry, MODEL_DEFAULTS, type ResolvedModel } from "../models";
import { reflect } from "./reflection";

const USAGE = {
	inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
	outputTokens: { total: 0, text: 0, reasoning: 0 },
};

interface Spy {
	readonly model: MockLanguageModelV4;
	readonly users: string[];
	readonly signals: (AbortSignal | undefined)[];
	readonly calls: () => number;
}

function spy(reply: (call: number, user: string) => string): Spy {
	const users: string[] = [];
	const signals: (AbortSignal | undefined)[] = [];
	let call = 0;
	const model = new MockLanguageModelV4({
		doGenerate: async (options) => {
			const user = JSON.stringify(options.prompt.filter((message) => message.role === "user"));
			users.push(user);
			signals.push(options.abortSignal);
			const text = reply(call, user);
			call += 1;
			return {
				content: [{ type: "text", text }],
				finishReason: { unified: "stop", raw: undefined },
				usage: USAGE,
				warnings: [],
			};
		},
	});
	return { model, users, signals, calls: () => call };
}

function resolved(id: string, model: MockLanguageModelV4): ResolvedModel {
	return { model, entry: getModelEntry(id as Parameters<typeof getModelEntry>[0]), mode: "mock" };
}

const CHAT = MODEL_DEFAULTS.mock.mock.chat;
const JUDGE = MODEL_DEFAULTS.mock.mock.judge;

/** The generator writes `draft` first, then `revised-<n>`; the critic always asks for a revision. */
function generatorSpy() {
	return spy((call) => (call === 0 ? "draft" : `revised-${call}`));
}

function criticSpy(needsRevision: (call: number) => boolean = () => true) {
	return spy((call) =>
		JSON.stringify({ critique: `critique-${call + 1}`, needsRevision: needsRevision(call) }),
	);
}

describe("reflect (self)", () => {
	it("critiques and revises up to the default of 3 iterations and returns the history", async () => {
		const generator = generatorSpy();
		const critic = criticSpy();

		const result = await reflect({
			mode: "self",
			generator: resolved(CHAT, generator.model),
			critic: resolved(CHAT, critic.model),
			task: "write a poem",
		});

		expect(result.history).toEqual([
			{ iteration: 1, output: "draft", critique: "critique-1", revised: "revised-1" },
			{ iteration: 2, output: "revised-1", critique: "critique-2", revised: "revised-2" },
			{ iteration: 3, output: "revised-2", critique: "critique-3", revised: "revised-3" },
		]);
		expect(result.final).toBe("revised-3");
		expect(critic.calls()).toBe(3);
		expect(generator.calls()).toBe(4);
	});

	it("uses the generator model as its own critic when no critic is given", async () => {
		const generator = spy((call, user) =>
			user.includes("<output>") && !user.includes("<critique>")
				? JSON.stringify({ critique: "c", needsRevision: false })
				: `text-${call}`,
		);

		const result = await reflect({
			mode: "self",
			generator: resolved(CHAT, generator.model),
			task: "t",
		});

		expect(result.criticModelId).toBe(CHAT);
		expect(result.generatorModelId).toBe(CHAT);
		expect(result.history).toHaveLength(1);
	});

	it("stops early, keeping the output, when the critic says no revision is needed", async () => {
		const generator = generatorSpy();
		const critic = criticSpy((call) => call === 0);

		const result = await reflect({
			mode: "self",
			generator: resolved(CHAT, generator.model),
			critic: resolved(CHAT, critic.model),
			task: "t",
		});

		expect(result.history).toEqual([
			{ iteration: 1, output: "draft", critique: "critique-1", revised: "revised-1" },
			{ iteration: 2, output: "revised-1", critique: "critique-2", revised: "revised-1" },
		]);
		expect(result.final).toBe("revised-1");
		expect(generator.calls()).toBe(2);
	});

	it("honours a custom iteration count up to the cap", async () => {
		const generator = generatorSpy();
		const critic = criticSpy();
		const base = {
			mode: "self" as const,
			generator: resolved(CHAT, generator.model),
			critic: resolved(CHAT, critic.model),
			task: "t",
		};

		const two = await reflect({ ...base, maxIterations: 2 });
		const eight = await reflect({ ...base, maxIterations: 8 });

		expect(two.history).toHaveLength(2);
		expect(eight.history).toHaveLength(8);
	});

	it("does not call any model when maxIterations is above the cap", async () => {
		const generator = generatorSpy();

		await expect(
			reflect({
				mode: "self",
				generator: resolved(CHAT, generator.model),
				task: "t",
				maxIterations: 9,
			}),
		).rejects.toMatchObject({ code: "invalid-request" });
		expect(generator.calls()).toBe(0);
	});

	it("gives the critic the task and the output, and the generator the critique", async () => {
		const generator = generatorSpy();
		const critic = criticSpy();

		await reflect({
			mode: "self",
			generator: resolved(CHAT, generator.model),
			critic: resolved(CHAT, critic.model),
			task: "THE-TASK",
			maxIterations: 1,
		});

		expect(critic.users[0]).toContain("THE-TASK");
		expect(critic.users[0]).toContain("draft");
		expect(generator.users[1]).toContain("critique-1");
		expect(generator.users[1]).toContain("draft");
	});

	it("labels every call's user message with its stage, so the calls can be told apart", async () => {
		const generator = generatorSpy();
		const critic = criticSpy();

		await reflect({
			mode: "self",
			generator: resolved(CHAT, generator.model),
			critic: resolved(CHAT, critic.model),
			task: "t",
			maxIterations: 2,
		});

		const stageOf = (user: string) => /\[段: [^\]]+\]/u.exec(user)?.[0];
		expect(generator.users.map(stageOf)).toEqual(["[段: 初稿]", "[段: 修正 1]", "[段: 修正 2]"]);
		expect(critic.users.map(stageOf)).toEqual(["[段: 批評 1]", "[段: 批評 2]"]);
	});

	it("regenerates a critique that is not valid", async () => {
		const generator = generatorSpy();
		const critic = spy((call) =>
			call === 0
				? JSON.stringify({ critique: "", needsRevision: true })
				: JSON.stringify({ critique: "ok", needsRevision: false }),
		);

		const result = await reflect({
			mode: "self",
			generator: resolved(CHAT, generator.model),
			critic: resolved(CHAT, critic.model),
			task: "t",
		});

		expect(critic.calls()).toBe(2);
		expect(result.history[0]?.critique).toBe("ok");
	});

	it("does not start another model call after an abort", async () => {
		const controller = new AbortController();
		const reason = new Error("user stopped");
		const generator = spy((call) => {
			if (call === 0) controller.abort(reason);
			return "draft";
		});
		const critic = criticSpy();

		await expect(
			reflect({
				mode: "self",
				generator: resolved(CHAT, generator.model),
				critic: resolved(CHAT, critic.model),
				task: "t",
				signal: controller.signal,
			}),
		).rejects.toBe(reason);
		expect(critic.calls()).toBe(0);
	});

	it("does not revise after an abort during the critique", async () => {
		const controller = new AbortController();
		const reason = new Error("user stopped");
		const generator = generatorSpy();
		const critic = spy(() => {
			controller.abort(reason);
			return JSON.stringify({ critique: "c", needsRevision: true });
		});

		await expect(
			reflect({
				mode: "self",
				generator: resolved(CHAT, generator.model),
				critic: resolved(CHAT, critic.model),
				task: "t",
				signal: controller.signal,
			}),
		).rejects.toBe(reason);
		expect(generator.calls()).toBe(1);
	});

	it("hands the signal to the generator and critic calls", async () => {
		const controller = new AbortController();
		const generator = generatorSpy();
		const critic = criticSpy();

		await reflect({
			mode: "self",
			generator: resolved(CHAT, generator.model),
			critic: resolved(CHAT, critic.model),
			task: "t",
			maxIterations: 1,
			signal: controller.signal,
		});
		controller.abort();

		expect(generator.signals.every((signal) => signal?.aborted)).toBe(true);
		expect(critic.signals.every((signal) => signal?.aborted)).toBe(true);
	});
});

describe("reflect (cross)", () => {
	it("critiques with a model that has a different catalog ID and records both IDs", async () => {
		const generator = generatorSpy();
		const critic = criticSpy();

		const result = await reflect({
			mode: "cross",
			generator: resolved(CHAT, generator.model),
			critic: resolved(JUDGE, critic.model),
			task: "t",
			maxIterations: 1,
		});

		expect(result.generatorModelId).toBe(CHAT);
		expect(result.criticModelId).toBe(JUDGE);
		expect(result.criticModelId).not.toBe(result.generatorModelId);
	});

	it("rejects the same model before calling anything, and says how to configure the judge", async () => {
		const generator = generatorSpy();
		const critic = criticSpy();

		const error = await reflect({
			mode: "cross",
			generator: resolved(CHAT, generator.model),
			critic: resolved(CHAT, critic.model),
			task: "t",
		}).catch((thrown: unknown) => thrown);

		expect(error).toMatchObject({ code: "invalid-request" });
		expect((error as Error).message).toContain("AI_MODEL_JUDGE");
		expect(generator.calls()).toBe(0);
		expect(critic.calls()).toBe(0);
	});

	it("rejects a missing critic", async () => {
		await expect(
			reflect({ mode: "cross", generator: resolved(CHAT, generatorSpy().model), task: "t" }),
		).rejects.toMatchObject({ code: "invalid-request" });
	});

	it("can use the mock judge model as the critic", async () => {
		const gateway = createModelGateway({ config: loadPlatformConfig({ VITEST: "true" }) });
		const generator = await gateway.resolve({ purpose: "chat" });
		const critic = await gateway.resolve({ purpose: "judge" });
		const generatorSpyModel = generatorSpy();
		const criticSpyModel = criticSpy();

		const result = await reflect({
			mode: "cross",
			generator: { ...generator, model: generatorSpyModel.model },
			critic: { ...critic, model: criticSpyModel.model },
			task: "t",
			maxIterations: 1,
		});

		expect(critic.entry.id).toBe("mock:judge-v1");
		expect(result.criticModelId).toBe("mock:judge-v1");
		expect(result.generatorModelId).not.toBe("mock:judge-v1");
	});
});
