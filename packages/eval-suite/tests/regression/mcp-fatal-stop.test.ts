// Regression: a fatal error from an MCP tool ends the tool-calling run (003 Req 1.3, 1.5; plan C5,
// C16). The plumbing under test is the whole chain through public subpaths: the in-repo file MCP
// server connected in the same process -> `connectMcpServers` / `adaptMcpTool` (error metadata) ->
// `buildToolSet` with a `FatalLatch` -> `createGuardedAgent` (stop condition + run summary).
// The unit behaviour of each link is tested inside `@platform/ai-core`; this file pins the observable
// contract of a whole run: stop reason `error`, and no later tool body runs. No network, no child
// process: the server and the client talk over a linked in-memory pair.

import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildToolSet,
	createCalculatorTool,
	FatalLatch,
	type GuardedToolSet,
} from "@platform/ai-core/aci";
import {
	type AgentRunSummary,
	createGuardedAgent,
	type LoopLimits,
} from "@platform/ai-core/agents";
import { createFilesServer } from "@platform/ai-core/files";
import {
	type ConnectOptions,
	connectMcpServers,
	FILES_SERVER_ID,
	filesServerConfig,
	type McpRegistry,
} from "@platform/ai-core/mcp";
import { createScenarioModel, defineScenario } from "@platform/ai-core/mock";
import { createFakeClock } from "@platform/ai-core/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const LIMITS: LoopLimits = {
	maxSteps: 10,
	maxTotalTokens: 50_000,
	maxDurationMs: 120_000,
	toolTimeoutMs: 15_000,
};

const SECRET = "TOP SECRET";
const LATER_TOOL_NAME = "calculator";
const LATER_TOOL_CALL = { toolName: LATER_TOOL_NAME, input: { expression: "6 * 7" } } as const;

type TransportFor = NonNullable<ConnectOptions["transportFor"]>;
type ClientTransport = NonNullable<ReturnType<TransportFor>>;
type RpcMessage = Parameters<ClientTransport["send"]>[0];

/** One end of an in-memory pair; whatever one end sends is delivered to the other end's handler. */
class LinkedEnd {
	onmessage?: (message: RpcMessage) => void;
	onclose?: () => void;
	onerror?: (error: Error) => void;
	sessionId?: string;
	#peer: LinkedEnd | undefined;
	#closed = false;
	readonly #queue: RpcMessage[] = [];

	static pair(): [LinkedEnd, LinkedEnd] {
		const a = new LinkedEnd();
		const b = new LinkedEnd();
		a.#peer = b;
		b.#peer = a;
		return [a, b];
	}

	async start(): Promise<void> {
		for (const message of this.#queue.splice(0)) this.onmessage?.(message);
	}

	async send(message: RpcMessage): Promise<void> {
		const peer = this.#peer;
		if (peer === undefined) throw new Error("not connected");
		if (peer.onmessage) peer.onmessage(message);
		else peer.#queue.push(message);
	}

	async close(): Promise<void> {
		if (this.#closed) return;
		this.#closed = true;
		const peer = this.#peer;
		this.#peer = undefined;
		try {
			await peer?.close();
		} finally {
			this.onclose?.();
		}
	}
}

/** A tool-calling model run: the summary, what the tools returned, and what the model saw. */
interface ToolRun {
	readonly summary: AgentRunSummary;
	readonly toolOutputs: readonly { readonly toolName: string; readonly output: unknown }[];
	readonly modelCalls: number;
	/** True when the later tool's body ran: its output is the successful Outcome, not a refusal. */
	readonly laterToolRan: boolean;
}

let sandbox: string;
let root: string;
let outsideFile: string;
let insideFile: string;
let registry: McpRegistry | undefined;
const closers: (() => Promise<void>)[] = [];

beforeAll(async () => {
	sandbox = await realpath(await mkdtemp(join(tmpdir(), "mcp-fatal-stop-")));
	root = join(sandbox, "root");
	const outside = join(sandbox, "outside");
	await mkdir(root);
	await mkdir(outside);
	insideFile = join(root, "notes.txt");
	outsideFile = join(outside, "secret.txt");
	await writeFile(insideFile, "inside the root");
	await writeFile(outsideFile, SECRET);
});

afterAll(async () => {
	await rm(sandbox, { recursive: true, force: true });
});

afterEach(async () => {
	await registry?.close();
	registry = undefined;
	for (const close of closers.splice(0)) await close();
});

/** Connects the in-repo file server to the registry over a linked pair instead of a child process. */
async function connectFilesServer(): Promise<McpRegistry> {
	registry = await connectMcpServers([filesServerConfig({ root })], {
		connectTimeoutMs: 20_000,
		transportFor: (config) => {
			if (config.id !== FILES_SERVER_ID) return undefined;
			const server = createFilesServer({ root });
			const [clientEnd, serverEnd] = LinkedEnd.pair();
			void server.connect(serverEnd as unknown as Parameters<typeof server.connect>[0]);
			closers.push(() => server.close());
			return clientEnd as unknown as ClientTransport;
		},
	});
	return registry;
}

/** Runs one tool-calling agent over the file server's tools plus the calculator as the "later" tool. */
async function runWith(
	turns: ReturnType<typeof defineScenario>["turns"],
	prompt: string,
): Promise<ToolRun> {
	const reg = await connectFilesServer();
	const clock = createFakeClock(Date.UTC(2026, 0, 1));
	const latch = new FatalLatch();
	const tools: GuardedToolSet = buildToolSet(
		[...reg.toolsFor("mcp-fatal-stop"), createCalculatorTool()],
		{},
		{ clock, toolTimeoutMs: LIMITS.toolTimeoutMs, fatal: latch },
	).tools;
	const model = createScenarioModel({
		purpose: "chat",
		scenarios: [defineScenario({ id: "eval/regression/mcp-fatal-stop", turns })],
	});
	const guarded = createGuardedAgent({
		model,
		instructions: "あなたはファイルを読んで答えるアシスタントです。",
		tools,
		limits: LIMITS,
		clock,
		signal: new AbortController().signal,
	});

	const result = await guarded.agent.stream({ prompt, abortSignal: guarded.abortSignal });
	const toolOutputs: { toolName: string; output: unknown }[] = [];
	for await (const part of result.fullStream) {
		if (part.type === "tool-result") {
			toolOutputs.push({ toolName: part.toolName, output: part.output });
		}
	}
	return {
		summary: await guarded.done,
		toolOutputs,
		modelCalls: model.doStreamCalls.length,
		laterToolRan: toolOutputs.some(
			({ toolName, output }) =>
				toolName === LATER_TOOL_NAME && (output as { ok?: unknown }).ok === true,
		),
	};
}

describe("MCP fatal error stops the tool-calling run (regression)", () => {
	it("stops with reason error after reading a path outside the allowed root, so the next step never runs", async () => {
		const run = await runWith(
			[
				{
					match: { purpose: "chat", lastUserTextIncludes: "fatal-then-note", stepIndex: 0 },
					respond: { toolCalls: [{ toolName: "readFile", input: { path: outsideFile } }] },
				},
				// What a loop that did not stop would do next. It must never be asked for.
				{
					match: { purpose: "chat", stepIndex: 1, toolResultFor: "readFile" },
					respond: { toolCalls: [LATER_TOOL_CALL] },
				},
				{
					match: { purpose: "chat", stepIndex: 2, toolResultFor: LATER_TOOL_NAME },
					respond: { text: "終わりました。" },
				},
			],
			"fatal-then-note",
		);

		expect(run.summary).toMatchObject({
			stopReason: "error",
			steps: 1,
			toolsCalled: ["readFile"],
			error: { code: "not-allowed", message: expect.stringContaining(root) },
		});
		expect(run.modelCalls).toBe(1);
		expect(run.laterToolRan).toBe(false);
		expect(JSON.stringify(run.toolOutputs)).not.toContain(SECRET);
		expect(JSON.stringify(run.summary)).not.toContain(SECRET);
	});

	it("refuses a tool called in the same step after the fatal one, without running its body", async () => {
		const run = await runWith(
			[
				{
					match: { purpose: "chat", lastUserTextIncludes: "fatal-same-step", stepIndex: 0 },
					respond: {
						toolCalls: [
							{ toolName: "readFile", input: { path: outsideFile } },
							LATER_TOOL_CALL,
							{ toolName: "readFile", input: { path: insideFile } },
						],
					},
				},
			],
			"fatal-same-step",
		);

		expect(run.summary).toMatchObject({
			stopReason: "error",
			steps: 1,
			error: { code: "not-allowed" },
		});
		expect(run.modelCalls).toBe(1);
		// Neither the calculator body nor the later (valid) file read ran.
		expect(run.laterToolRan).toBe(false);
		expect(JSON.stringify(run.toolOutputs)).not.toContain("inside the root");
		expect(JSON.stringify(run.toolOutputs)).not.toContain(SECRET);
		const [, laterToolOutput, laterRead] = run.toolOutputs;
		for (const output of [laterToolOutput, laterRead]) {
			expect(output?.output).toMatchObject({ ok: false, failure: { kind: "recoverable" } });
		}
	});

	it("completes normally when the path is inside the root (the later tool does run)", async () => {
		const run = await runWith(
			[
				{
					match: { purpose: "chat", lastUserTextIncludes: "inside-then-note", stepIndex: 0 },
					respond: { toolCalls: [{ toolName: "readFile", input: { path: insideFile } }] },
				},
				{
					match: { purpose: "chat", stepIndex: 1, toolResultFor: "readFile" },
					respond: { toolCalls: [LATER_TOOL_CALL] },
				},
				{
					match: { purpose: "chat", stepIndex: 2, toolResultFor: LATER_TOOL_NAME },
					respond: { text: "読み終えました。" },
				},
			],
			"inside-then-note",
		);

		expect(run.summary).toMatchObject({
			stopReason: "completed",
			steps: 3,
			toolsCalled: ["readFile", LATER_TOOL_NAME],
			error: undefined,
		});
		expect(run.laterToolRan).toBe(true);
		expect(run.toolOutputs[0]?.output).toEqual({ ok: true, data: "inside the root" });
	});
});
