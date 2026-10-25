import { DEFAULT_ANALYSIS, DEFAULT_SANDBOX } from "@platform/ai-core/config";
import { PlatformError } from "@platform/ai-core/errors";
import { M3_3_SAMPLE_INSTRUCTIONS } from "@platform/ai-core/mock";
import { CapabilityUnsupportedError } from "@platform/ai-core/models";
import { createFakeClock } from "@platform/ai-core/ports";
import {
	createMockSandboxProvider,
	createSandboxRegistry,
	type MockSandboxProvider,
} from "@platform/ai-core/sandbox";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createPlatform,
	getSandboxSelection,
	type SandboxSetup,
	setPlatformForTesting,
	setSandboxForTesting,
} from "@/lib/server/platform";
import { verifyOrWriteFixture } from "../../../../../scripts/e2e/generate-sse-fixtures.mjs";
import { POST } from "./route";

const MOCK_ENV = { VITEST: "1", AI_TEST_RUN_MODE: "mock" } as const;
const LIVE_ENV = {
	VITEST: "1",
	AI_TEST_RUN_MODE: "live",
	AI_LIVE_PROVIDER: "openai",
	OPENAI_API_KEY: "test-key",
	CHAT_RATE_LIMIT_MAX: "1",
} as const;
const NOW = Date.parse("2026-10-18T00:00:00.000Z");
const SESSION = "11111111-2222-4333-8444-555555555555";
const OTHER_SESSION = "99999999-2222-4333-8444-555555555555";
const CSV = "date,region,product,units,sales\n2026-01-08,東京,ノート,100,40000\n";

let provider: MockSandboxProvider;
let modelCalls: number;
let beforeModelCall: ((callIndex: number) => Promise<void> | void) | undefined;
let clock: ReturnType<typeof createFakeClock>;

function enabled(): SandboxSetup {
	provider = createMockSandboxProvider();
	return {
		kind: "mock",
		provider,
		registry: createSandboxRegistry({
			provider,
			clock,
			idleTimeoutMs: DEFAULT_SANDBOX.idleTimeoutMs,
		}),
		stop: () => undefined,
	};
}

async function install(
	env: Record<string, string> = MOCK_ENV,
	adjust: (platform: Awaited<ReturnType<typeof createPlatform>>) => object = () => ({}),
	setup: SandboxSetup = enabled(),
) {
	const platform = await createPlatform({ env, clock });
	const resolve = platform.gateway.resolve.bind(platform.gateway);
	setPlatformForTesting({
		...platform,
		gateway: {
			...platform.gateway,
			resolve: async (request: Parameters<typeof resolve>[0]) => {
				const resolved = await resolve(request);
				const { model } = resolved;
				const wrapped = Object.create(model) as typeof model;
				wrapped.doGenerate = async (options) => {
					modelCalls += 1;
					await beforeModelCall?.(modelCalls);
					return model.doGenerate(options);
				};
				return { ...resolved, model: wrapped };
			},
			resolveEmbedding: platform.gateway.resolveEmbedding.bind(platform.gateway),
		} as never,
		...adjust(platform),
	});
	setSandboxForTesting(setup);
}

interface FormOptions {
	file?: { name: string; bytes: Uint8Array | string } | null;
	extraFiles?: number;
	instruction?: string | null;
	sessionId?: string | null;
	modelId?: string;
	fields?: Record<string, string>;
}

function formOf(options: FormOptions = {}): FormData {
	const form = new FormData();
	const file = options.file === undefined ? { name: "sales.csv", bytes: CSV } : options.file;
	if (file) form.append("file", new File([file.bytes as BlobPart], file.name));
	for (let index = 0; index < (options.extraFiles ?? 0); index += 1) {
		form.append("file", new File(["a\n"], `extra-${index}.csv`));
	}
	const instruction =
		options.instruction === undefined ? M3_3_SAMPLE_INSTRUCTIONS.success : options.instruction;
	if (instruction !== null) form.append("instruction", instruction);
	const sessionId = options.sessionId === undefined ? SESSION : options.sessionId;
	if (sessionId !== null) form.append("sessionId", sessionId);
	if (options.modelId !== undefined) form.append("modelId", options.modelId);
	for (const [name, value] of Object.entries(options.fields ?? {})) form.append(name, value);
	return form;
}

function post(options: FormOptions = {}, init: RequestInit = {}): Request {
	return new Request("http://localhost/api/analysis", {
		method: "POST",
		body: formOf(options),
		...init,
	});
}

interface StreamPart {
	type: string;
	id?: string;
	data?: Record<string, unknown>;
}

async function partsOf(response: Response): Promise<StreamPart[]> {
	return partsOfText(await response.text());
}

function partsOfText(text: string): StreamPart[] {
	return text
		.split("\n\n")
		.map((chunk) => chunk.trim())
		.filter((chunk) => chunk.startsWith("data: ") && chunk !== "data: [DONE]")
		.map((chunk) => JSON.parse(chunk.slice("data: ".length)) as StreamPart);
}

async function errorOf(response: Response) {
	return (await response.json()).error as {
		code: string;
		message: string;
		details?: { guidance?: string };
	};
}

const resultOf = (parts: readonly StreamPart[]) =>
	parts.find((part) => part.type === "data-analysis-result")?.data as
		| { status: string; attempts: number; fixes: number; text: string }
		| undefined;

beforeEach(() => {
	modelCalls = 0;
	beforeModelCall = undefined;
	clock = createFakeClock(NOW);
});

afterEach(() => {
	setSandboxForTesting(undefined);
	setPlatformForTesting(undefined);
});

/** Nothing reached the sandbox or the model. */
function expectUntouched() {
	expect(provider.sessions).toHaveLength(0);
	expect(modelCalls).toBe(0);
}

describe("POST /api/analysis: rejections before any sandbox or model", () => {
	it("answers 413 when the file is over 20 MiB, and starts neither", async () => {
		await install();
		const over = new Uint8Array(DEFAULT_ANALYSIS.maxUploadBytes + 1).fill(0x61);

		const response = await POST(post({ file: { name: "big.csv", bytes: over } }));

		expect(response.status).toBe(413);
		expect((await errorOf(response)).code).toBe("payload-too-large");
		expectUntouched();
	}, 30_000);

	it("accepts a file of exactly 20 MiB", async () => {
		await install();
		const exact = new Uint8Array(DEFAULT_ANALYSIS.maxUploadBytes).fill(0x61);

		const response = await POST(post({ file: { name: "big.csv", bytes: exact } }));

		expect(response.status).toBe(200);
		await response.text();
	}, 30_000);

	it("answers 400 for a body that is not multipart", async () => {
		await install();

		const response = await POST(
			new Request("http://localhost/api/analysis", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: "{}",
			}),
		);

		expect(response.status).toBe(400);
		expect((await errorOf(response)).code).toBe("invalid-request");
		expectUntouched();
	});

	it.each([
		["no file", { file: null }],
		["two files", { extraFiles: 1 }],
		["no instruction", { instruction: null }],
		["no sessionId", { sessionId: null }],
		["an unknown field", { fields: { root: "/etc" } }],
		["an empty instruction", { instruction: "" }],
		["a blank instruction", { instruction: "  \n " }],
		["a session id that is not a UUID", { sessionId: "../../etc" }],
	] satisfies [string, FormOptions][])("answers 400 for %s", async (_label, options) => {
		await install();

		const response = await POST(post(options));

		expect(response.status).toBe(400);
		expect((await errorOf(response)).code).toMatch(/invalid-request|limit-exceeded/u);
		expectUntouched();
	});

	it("answers 400 for an instruction over 2,000 characters, and accepts exactly 2,000", async () => {
		await install();
		const tooLong = await POST(post({ instruction: "あ".repeat(2_001) }));
		const exact = await POST(post({ instruction: "あ".repeat(2_000) }));

		expect(tooLong.status).toBe(400);
		expect((await errorOf(tooLong)).code).toBe("limit-exceeded");
		expect(exact.status).toBe(200);
		await exact.text();
	});

	it("counts an instruction in characters, not UTF-16 units: 1,500 emoji are within the 2,000 limit", async () => {
		await install();

		const response = await POST(post({ instruction: "😀".repeat(1_500) }));

		expect(response.status).toBe(200);
		await response.text();
	});

	it.each([
		["a name with an unsupported extension", { name: "notes.txt", bytes: CSV }, "ファイル形式"],
		[
			"a .docx renamed .xlsx",
			{ name: "report.xlsx", bytes: "PK\u0003\u0004 not a workbook" },
			"拡張子",
		],
		[
			"a PNG renamed .csv",
			{ name: "image.csv", bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]) },
			"拡張子",
		],
		[
			"a CSV in Shift_JIS",
			{ name: "sjis.csv", bytes: new Uint8Array([0x96, 0xbc, 0x91, 0x4f, 0x2c, 0x94, 0xe4]) },
			"UTF-8",
		],
		["an empty file", { name: "empty.csv", bytes: "" }, "空"],
	])("answers 400 for %s without starting the sandbox or the model", async (_label, file, hint) => {
		await install();

		const response = await POST(post({ file }));

		expect(response.status).toBe(400);
		const error = await errorOf(response);
		expect(error.code).toBe("invalid-request");
		expect(error.message).toContain(hint);
		expectUntouched();
	});

	it("answers 503 provider-unavailable with the guidance when no sandbox is available, and starts no model", async () => {
		await install(MOCK_ENV, () => ({}), {
			kind: "disabled",
			reason: "E2B_API_KEY が未設定で、ローカルのコンテナ実行環境（Docker）にも接続できません。",
			guidance:
				"E2B_API_KEY を設定するか、Docker を起動して `mise run sandbox:build` で画像を作ってください。",
		});

		const response = await POST(post());

		expect(response.status).toBe(503);
		const error = await errorOf(response);
		expect(error.code).toBe("provider-unavailable");
		expect(error.message).toContain("分析");
		expect(error.details?.guidance).toContain("mise run sandbox:build");
		expect(modelCalls).toBe(0);
	});

	it("answers 400 for an unknown model and for a model without tools, before the sandbox starts", async () => {
		await install();
		const unknown = await POST(post({ modelId: "not-a-model" }));
		await install(MOCK_ENV, (platform) => ({
			gateway: {
				...platform.gateway,
				resolve: async (request: { require?: readonly string[] }) => {
					if (request.require?.includes("tools")) {
						throw new CapabilityUnsupportedError("tools", "mock:general-v1", "Mock");
					}
					return platform.gateway.resolve(request as never);
				},
				resolveEmbedding: platform.gateway.resolveEmbedding.bind(platform.gateway),
			},
		}));
		const noTools = await POST(post());

		expect(unknown.status).toBe(400);
		expect(noTools.status).toBe(400);
		expect((await errorOf(noTools)).code).toBe("capability-unsupported");
		expect(provider.sessions).toHaveLength(0);
	});

	it("rate-limits only in live mode, after every other check, and a rejected request spends no quota", async () => {
		await install(LIVE_ENV, (platform) => ({
			gateway: {
				...platform.gateway,
				resolve: async () => {
					throw new CapabilityUnsupportedError("tools", "gpt-test", "OpenAI");
				},
			},
		}));

		const rejected = await POST(post({ instruction: "" }));
		const unsupported = await POST(post({ file: { name: "notes.txt", bytes: CSV } }));
		const first = await POST(post());
		const second = await POST(post());

		expect(rejected.status).toBe(400);
		expect(unsupported.status).toBe(400);
		expect((await errorOf(first)).code).toBe("capability-unsupported");
		expect(second.status).toBe(429);
		expect((await errorOf(second)).code).toBe("rate-limited");
		expect(provider.sessions).toHaveLength(0);
	});

	it("does not rate-limit a disabled sandbox's 503, which spends no quota either", async () => {
		await install(LIVE_ENV, () => ({}), { kind: "disabled", reason: "r", guidance: "g" });

		const statuses = [
			(await POST(post())).status,
			(await POST(post())).status,
			(await POST(post())).status,
		];

		expect(statuses).toEqual([503, 503, 503]);
	});
});

describe("POST /api/analysis: a run in mock mode", () => {
	it("analyses a CSV: the attempt, a figure with its alt, a table, and the result", async () => {
		await install();

		const response = await POST(post());
		const parts = await partsOf(response);

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/event-stream");
		expect(parts.filter((part) => part.type === "data-analysis-attempt")).toHaveLength(1);
		const figure = parts.find((part) => part.type === "data-analysis-figure");
		expect(figure?.data).toMatchObject({ alt: "Monthly sales bar chart", mediaType: "image/png" });
		expect(parts.find((part) => part.type === "data-analysis-table")?.data).toMatchObject({
			caption: "Monthly sales",
			totalRows: 3,
		});
		expect(resultOf(parts)).toMatchObject({ status: "succeeded", attempts: 1, fixes: 0 });
		expect(parts.map((part) => part.type).indexOf("data-analysis-attempt")).toBeLessThan(
			parts.map((part) => part.type).indexOf("data-analysis-result"),
		);
	});

	it("writes the learner's file into the sandbox as it was uploaded", async () => {
		await install();
		const bytes = new TextEncoder().encode(CSV);

		await (await POST(post({ file: { name: "sales.csv", bytes } }))).text();

		expect(provider.sessions).toHaveLength(1);
		expect(provider.sessions[0]?.files.get("data.csv")).toEqual(bytes);
	});

	it("fixes the code after an error and succeeds, showing both attempts", async () => {
		await install();

		const parts = await partsOf(await POST(post({ instruction: M3_3_SAMPLE_INSTRUCTIONS.fixed })));

		const attempts = parts.filter((part) => part.type === "data-analysis-attempt");
		expect(attempts).toHaveLength(2);
		expect(attempts[0]?.data?.errorSummary).toBe("KeyError: 'revenue'");
		expect(attempts[1]?.data).not.toHaveProperty("errorSummary");
		expect(resultOf(parts)).toMatchObject({ status: "succeeded", attempts: 2, fixes: 1 });
	});

	it("stops with attempt-limit after the first run and three fixes, and shows every attempt", async () => {
		await install();

		const parts = await partsOf(
			await POST(post({ instruction: M3_3_SAMPLE_INSTRUCTIONS.attemptLimit })),
		);

		expect(parts.filter((part) => part.type === "data-analysis-attempt")).toHaveLength(4);
		expect(resultOf(parts)).toMatchObject({ status: "attempt-limit", attempts: 4, fixes: 3 });
		expect(provider.sessions[0]?.runs).toHaveLength(4);
		expect(modelCalls).toBe(4);
	});

	it("keeps the sandbox for the next request of the same session, and gives another session its own", async () => {
		await install();

		await (await POST(post())).text();
		await (await POST(post())).text();
		expect(provider.sessions).toHaveLength(1);

		await (await POST(post({ sessionId: OTHER_SESSION }))).text();
		expect(provider.sessions).toHaveLength(2);
	});

	it("says so when the sandbox of the session had expired and was made again", async () => {
		await install();
		await (await POST(post())).text();
		const current = await getSandboxSelection();
		if (current.kind === "disabled") throw new Error("expected an enabled setup");
		const lease = await current.registry.acquire(SESSION);
		await lease.session.close();
		lease.done();

		const parts = await partsOf(await POST(post()));

		expect(provider.sessions).toHaveLength(2);
		const notice = parts.find((part) => part.type === "data-analysis-notice");
		expect(notice?.data).toMatchObject({ reasons: [expect.stringContaining("作り直")] });
		expect(resultOf(parts)?.status).toBe("succeeded");
	});

	it("lets the idle sweep close the sandbox once the request has finished", async () => {
		await install();
		await (await POST(post())).text();
		const current = await getSandboxSelection();
		if (current.kind === "disabled") throw new Error("expected an enabled setup");

		// While the request ran, the sandbox was in use; afterwards it is only idle.
		expect(await current.registry.sweep()).toEqual([]);
		clock.advanceBy(DEFAULT_SANDBOX.idleTimeoutMs + 1);

		expect(await current.registry.sweep()).toEqual([SESSION]);
		expect(provider.sessions[0]?.closeCount).toBe(1);
	});

	it("closes the sandbox and runs no further code when the connection is lost", async () => {
		await install();
		const controller = new AbortController();
		beforeModelCall = (call) => {
			if (call === 1) controller.abort(new Error("client went away"));
		};

		const response = await POST(
			post({ instruction: M3_3_SAMPLE_INSTRUCTIONS.attemptLimit }, { signal: controller.signal }),
		);
		await response.text().catch(() => undefined);

		expect(provider.sessions).toHaveLength(1);
		expect(provider.sessions[0]?.closeCount).toBe(1);
		// The learner left during the model's first call, before any code was asked for.
		expect(provider.sessions[0]?.runs).toHaveLength(0);
		// The agent loop was told to stop too: the model is not asked for the next step.
		expect(modelCalls).toBe(1);
	});

	it("refuses a second request for a session whose analysis is still running, without touching its sandbox", async () => {
		await install();
		let release: () => void = () => undefined;
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		beforeModelCall = (call) => (call === 1 ? held : undefined);

		const first = POST(post());
		await vi.waitFor(() => expect(modelCalls).toBe(1));
		const second = await POST(post());

		expect(second.status).toBe(400);
		const error = await errorOf(second);
		expect(error.code).toBe("invalid-request");
		expect(error.message).toContain("実行中");
		expect(provider.sessions).toHaveLength(1);
		expect(provider.sessions[0]?.closeCount).toBe(0);
		release();
		expect(resultOf(await partsOf(await first))?.status).toBe("succeeded");
		// Once it is over the session is free again.
		expect((await POST(post())).status).toBe(200);
	});

	it("does not count the busy refusal against the rate limit", async () => {
		await install(LIVE_ENV, (platform) => ({
			gateway: {
				...platform.gateway,
				resolve: async () => {
					throw new CapabilityUnsupportedError("tools", "gpt-test", "OpenAI");
				},
			},
		}));
		const holder = await getSandboxSelection();
		if (holder.kind === "disabled") throw new Error("expected an enabled setup");
		const lease = await holder.registry.acquire(SESSION);

		const refused = await POST(post());
		lease.done();
		const first = await POST(post());
		const second = await POST(post());

		expect((await errorOf(refused)).code).toBe("invalid-request");
		expect((await errorOf(first)).code).toBe("capability-unsupported");
		expect(second.status).toBe(429);
	});

	it("ends with sandbox-unavailable, closes the sandbox and chooses again next time when the sandbox stops working", async () => {
		const failing = createMockSandboxProvider({
			respond: () => {
				throw new PlatformError("provider-unavailable", "サンドボックスは終了しています。");
			},
		});
		provider = failing;
		await install(MOCK_ENV, () => ({}), {
			kind: "docker",
			provider: failing,
			registry: createSandboxRegistry({
				provider: failing,
				clock,
				idleTimeoutMs: DEFAULT_SANDBOX.idleTimeoutMs,
			}),
			stop: () => undefined,
		});

		const parts = await partsOf(await POST(post()));

		expect(resultOf(parts)).toMatchObject({ status: "sandbox-unavailable", attempts: 0 });
		expect(resultOf(parts)?.text).toContain("サンドボックスは終了しています");
		expect(modelCalls).toBe(1);
		expect(failing.sessions[0]?.closeCount).toBe(1);
		// The stale choice is gone: the next look chooses afresh (here: the pseudo provider of mock mode).
		expect((await getSandboxSelection()).kind).toBe("mock");
	});

	it("starts no sandbox when the request is already aborted", async () => {
		await install();
		const controller = new AbortController();
		controller.abort(new Error("gone"));

		const response = await POST(post({}, { signal: controller.signal }));
		await response.text().catch(() => undefined);

		expect(provider.sessions).toHaveLength(0);
		expect(modelCalls).toBe(0);
	});

	it("reports an error in the stream as a code and a Japanese message only", async () => {
		await install();
		beforeModelCall = () => {
			throw new Error("secret detail /Users/me/.ssh/key");
		};

		const response = await POST(post());
		const text = await response.text();

		expect(response.status).toBe(200);
		expect(text).toContain('"type":"error"');
		expect(text).not.toContain("secret detail");
		expect(text).not.toContain(".ssh");
		// What the browser gets is a closed code and a Japanese message.
		const failure = (await partsOfText(text)).find((part) => part.type === "error") as
			| { errorText?: string }
			| undefined;
		expect(JSON.parse(failure?.errorText ?? "{}")).toEqual({
			code: "unexpected",
			message: expect.stringContaining("予期しない"),
		});
	});
});

describe("POST /api/analysis: generated SSE fixtures used by the E2E specs", () => {
	it("matches the generated SSE fixture of a successful analysis with a figure and a table", async () => {
		await install();

		const response = await POST(post());

		expect(response.status).toBe(200);
		verifyOrWriteFixture("analysis.sse", await response.text());
	});

	it("matches the generated SSE fixture of a run that stops at the attempt limit", async () => {
		await install();

		const response = await POST(post({ instruction: M3_3_SAMPLE_INSTRUCTIONS.attemptLimit }));

		expect(response.status).toBe(200);
		verifyOrWriteFixture("analysis-attempt-limit.sse", await response.text());
	});
});
