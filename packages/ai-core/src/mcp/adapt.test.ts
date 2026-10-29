import { describe, expect, it } from "vitest";
import { FatalLatch, FatalToolError, type ToolOutcome } from "../aci";
import { createFakeClock } from "../ports/clock";
import {
	adaptMcpTool,
	classifyMcpToolResult,
	MAX_MCP_OUTPUT_CHARACTERS,
	MCP_ERROR_META_KEY,
} from "./adapt";
import type { McpClientTool } from "./allow-list";

const DESCRIPTION = [
	"リポジトリのファイルを読み取る。",
	"使うとき: リポジトリの中のファイルの内容を知りたいとき。",
	"使わないとき: 書き込みや検索のとき。",
	'例: {"owner":"octocat","repo":"hello","path":"README.md"}',
].join("\n");

const SCHEMA = {
	type: "object",
	properties: {
		owner: { type: "string", description: "リポジトリの所有者" },
		repo: { type: "string", description: "リポジトリ名" },
		path: { type: "string", description: "ファイルのパス" },
	},
	required: ["owner", "repo"],
	additionalProperties: false,
};

const LEARNER_MESSAGES: Record<string, string> = {
	"not-allowed": "許可されたルート（/work/ws）の外のパスにはアクセスできません。",
	// Differs from the platform default on purpose: the adapter must use the configured wording.
	"auth-failed": "GitHub がトークンを拒否しました。GITHUB_TOKEN を確認してください。",
	"config-missing": "設定が不足しています。",
	"attempt-limit": "試行回数の上限に達しました。",
};
const learnerMessageFor = (code: string): string => LEARNER_MESSAGES[code] ?? "?";

function clientTool(
	execute: McpClientTool["execute"],
	inputSchema: unknown = SCHEMA,
): McpClientTool {
	return { description: "server description", inputSchema: { jsonSchema: inputSchema }, execute };
}

const okResult = (text: string) => ({ content: [{ type: "text", text }] });

function adapted(
	overrides: Partial<Parameters<typeof adaptMcpTool>[2]> = {},
	execute: McpClientTool["execute"] = async () => okResult("ok"),
) {
	const result = adaptMcpTool("get_file_contents", clientTool(execute), {
		serverId: "github",
		risk: "read-only",
		description: DESCRIPTION,
		trustErrorMeta: false,
		learnerMessageFor,
		...overrides,
	});
	if (!result.ok) throw new Error(`expected the tool to be adapted: ${result.reason}`);
	return result.tool;
}

async function run(
	aciTool: ReturnType<typeof adapted>,
	input: unknown,
	latch?: FatalLatch,
): Promise<ToolOutcome<unknown>> {
	const execute = aciTool.toTool({
		clock: createFakeClock(),
		toolTimeoutMs: 5_000,
		fatal: latch,
	}).execute;
	if (!execute) throw new Error("must be executable");
	return (await execute(input, {
		toolCallId: "call-1",
		messages: [],
		context: undefined,
	})) as ToolOutcome<unknown>;
}

describe("adaptMcpTool", () => {
	it("returns a tool with the given name, description and risk class", () => {
		const aciTool = adapted();
		expect(aciTool.name).toBe("get_file_contents");
		expect(aciTool.description).toBe(DESCRIPTION);
		expect(aciTool.risk).toBe("read-only");
	});

	it("keeps the risk class it was given", () => {
		expect(adapted({ risk: "destructive" }).risk).toBe("destructive");
	});

	it("shows the model the server's own JSON Schema", () => {
		const aciTool = adapted();
		const modelTool = aciTool.toTool({ clock: createFakeClock(), toolTimeoutMs: 1_000 });
		const schema = modelTool.inputSchema as { jsonSchema: unknown };
		expect(schema.jsonSchema).toEqual(SCHEMA);
	});

	it("registers a tool whose override description names every input property (CL-25)", () => {
		const bare = { type: "object", properties: { owner: {}, repo: {} } };
		const withNames = [
			"ファイルを読む。",
			"使うとき: owner と repo で指すリポジトリのファイルを読むとき。",
			"使わないとき: 書き込むとき。",
			"例: owner=octocat, repo=hello",
		].join("\n");
		const result = adaptMcpTool(
			"read",
			clientTool(async () => okResult("x"), bare),
			{
				serverId: "github",
				risk: "read-only",
				description: withNames,
				trustErrorMeta: false,
			},
		);
		expect(result.ok).toBe(true);
	});

	it("does not register a tool whose effective description lacks the CL-18 headings, and says why", () => {
		const result = adaptMcpTool(
			"get_file_contents",
			clientTool(async () => okResult("x")),
			{
				serverId: "github",
				risk: "read-only",
				description: "Get the contents of a file or directory from a GitHub repository",
				trustErrorMeta: false,
			},
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toContain("説明文の形式");
	});

	it("does not register a tool whose input property is neither described nor named", () => {
		const result = adaptMcpTool(
			"get_file_contents",
			clientTool(async () => okResult("x"), { type: "object", properties: { zzz: {} } }),
			{ serverId: "github", risk: "read-only", description: DESCRIPTION, trustErrorMeta: false },
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toContain("zzz");
	});

	it("does not register a tool without a readable input schema, or with a name the platform rejects", () => {
		const noSchema = adaptMcpTool(
			"t",
			{ description: "d", execute: async () => okResult("x") },
			{
				serverId: "s",
				risk: "read-only",
				description: DESCRIPTION,
				trustErrorMeta: false,
			},
		);
		expect(noSchema.ok).toBe(false);
		const badName = adaptMcpTool(
			"bad.name",
			clientTool(async () => okResult("x")),
			{
				serverId: "s",
				risk: "read-only",
				description: DESCRIPTION,
				trustErrorMeta: false,
			},
		);
		expect(badName.ok).toBe(false);
		if (!badName.ok) expect(badName.reason).toContain("ツール名");
	});

	it("passes the model's input to the server and returns its text", async () => {
		const seen: unknown[] = [];
		const aciTool = adapted({}, async (input) => {
			seen.push(input);
			return okResult("# README");
		});
		const outcome = await run(aciTool, { owner: "octocat", repo: "hello", path: "README.md" });
		expect(seen).toEqual([{ owner: "octocat", repo: "hello", path: "README.md" }]);
		expect(outcome).toEqual({ ok: true, data: "# README" });
	});

	it("joins text parts and names the other kinds of content instead of passing them on", async () => {
		const aciTool = adapted({}, async () => ({
			content: [
				{ type: "text", text: "first" },
				{ type: "image", data: "AAAA", mimeType: "image/png" },
				{ type: "text", text: "second" },
			],
		}));
		const outcome = await run(aciTool, { owner: "o", repo: "r" });
		expect(outcome).toEqual({ ok: true, data: "first\n（image は省略しました）\nsecond" });
	});

	it("cuts a very long result and says how much was left out", async () => {
		const aciTool = adapted({}, async () => okResult("x".repeat(MAX_MCP_OUTPUT_CHARACTERS + 10)));
		const outcome = await run(aciTool, { owner: "o", repo: "r" });
		if (!outcome.ok) throw new Error("expected success");
		expect(String(outcome.data)).toContain("残り 10 文字を省略しました");
	});

	it("rejects input that is not an object before calling the server", async () => {
		let called = false;
		const aciTool = adapted({}, async () => {
			called = true;
			return okResult("x");
		});
		const modelTool = aciTool.toTool({ clock: createFakeClock(), toolTimeoutMs: 1_000 });
		const schema = modelTool.inputSchema as {
			validate?: (value: unknown) => Promise<{ success: boolean }>;
		};
		expect((await schema.validate?.("not an object"))?.success).toBe(false);
		expect(called).toBe(false);
	});

	it("turns an authentication failure (HTTP 401 / 403) into a fatal error with a fixed message", async () => {
		for (const statusCode of [401, 403]) {
			const aciTool = adapted({}, async () => {
				throw Object.assign(new Error("Bad credentials for ghp_SECRET"), { statusCode });
			});
			const latch = new FatalLatch();
			const outcome = await run(aciTool, { owner: "o", repo: "r" }, latch);
			expect(latch.error?.code).toBe("auth-failed");
			expect(latch.error?.learnerMessage).toBe(LEARNER_MESSAGES["auth-failed"]);
			expect(JSON.stringify(outcome)).not.toContain("ghp_SECRET");
		}
	});

	it("without a latch an authentication failure is still reported as the fixed message", async () => {
		const aciTool = adapted({}, async () => {
			throw Object.assign(new Error("Bad credentials"), { statusCode: 401 });
		});
		const outcome = await run(aciTool, { owner: "o", repo: "r" });
		expect(outcome).toEqual({
			ok: false,
			failure: {
				kind: "recoverable",
				summary: LEARNER_MESSAGES["auth-failed"],
				nextAction: "入力を見直して再試行するか、ツールを使わずに回答してください。",
			},
		});
	});

	it("lets the caller replace an error from the transport (a closed connection)", async () => {
		const aciTool = adapted(
			{ onCallError: () => new FatalToolError("config-missing", "サーバーが切断されました。") },
			async () => {
				throw new Error("Connection closed");
			},
		);
		const latch = new FatalLatch();
		await run(aciTool, { owner: "o", repo: "r" }, latch);
		expect(latch.error?.code).toBe("config-missing");
	});

	it("leaves a stop by the learner alone: the transport error that follows is not a broken server", async () => {
		const controller = new AbortController();
		const seen: unknown[] = [];
		const aciTool = adapted(
			{
				onCallError: (error) => {
					seen.push(error);
					return undefined;
				},
			},
			async () => {
				controller.abort(new Error("learner stopped"));
				throw new Error("Connection closed");
			},
		);
		const execute = aciTool.toTool({ clock: createFakeClock(), toolTimeoutMs: 5_000 }).execute;
		await expect(
			execute?.(
				{ owner: "o", repo: "r" },
				{ toolCallId: "c", messages: [], context: undefined, abortSignal: controller.signal },
			),
		).rejects.toThrow("learner stopped");
		expect(seen).toEqual([]);

		// The same error without an abort does reach the hook.
		const unaborted = adapted(
			{
				onCallError: (error) => {
					seen.push(error);
					return undefined;
				},
			},
			async () => {
				throw new Error("Connection closed");
			},
		);
		await run(unaborted, { owner: "o", repo: "r" });
		expect(seen).toHaveLength(1);
	});

	it("reports an unexpected transport error by name only", async () => {
		const aciTool = adapted({}, async () => {
			throw new TypeError("secret detail ghp_SECRET");
		});
		const outcome = await run(aciTool, { owner: "o", repo: "r" });
		expect(JSON.stringify(outcome)).not.toContain("ghp_SECRET");
		expect(outcome.ok).toBe(false);
	});
});

describe("classifyMcpToolResult (CL-24)", () => {
	const context = (trustErrorMeta: boolean) => ({
		serverId: "files",
		toolName: "readFile",
		trustErrorMeta,
		learnerMessageFor,
	});
	const failed = (kind: string, code: string | undefined, text = "SERVER SAID THIS") => ({
		isError: true,
		content: [{ type: "text", text }],
		_meta: { [MCP_ERROR_META_KEY]: { kind, ...(code === undefined ? {} : { code }) } },
	});

	it("reads a successful result as text", () => {
		expect(classifyMcpToolResult(okResult("hello"), context(true))).toEqual({
			ok: true,
			output: "hello",
		});
	});

	it("reads a successful result without content as an explicit notice", () => {
		expect(classifyMcpToolResult({ content: [] }, context(true))).toEqual({
			ok: true,
			output: "（結果は空でした）",
		});
	});

	it("falls back to structuredContent when there is no text", () => {
		expect(
			classifyMcpToolResult({ content: [], structuredContent: { a: 1 } }, context(true)),
		).toEqual({ ok: true, output: '{"a":1}' });
	});

	it("makes a fatal result from a trusted server a FatalToolError with the configured message", () => {
		const result = classifyMcpToolResult(failed("fatal", "not-allowed"), context(true));
		if (result.ok || result.kind !== "fatal") throw new Error("expected fatal");
		expect(result.error).toBeInstanceOf(FatalToolError);
		expect(result.error.code).toBe("not-allowed");
		expect(result.error.learnerMessage).toBe(LEARNER_MESSAGES["not-allowed"]);
		expect(result.error.learnerMessage).not.toContain("SERVER SAID THIS");
	});

	it("accepts every code of C2's closed vocabulary", () => {
		for (const code of ["auth-failed", "config-missing", "not-allowed", "attempt-limit"]) {
			const result = classifyMcpToolResult(failed("fatal", code), context(true));
			expect(result).toMatchObject({ kind: "fatal", error: { code } });
		}
	});

	it("treats a fatal result from a server that is not trusted as recoverable", () => {
		const result = classifyMcpToolResult(failed("fatal", "not-allowed"), context(false));
		expect(result).toMatchObject({ ok: false, kind: "recoverable" });
	});

	it("treats a code outside the closed vocabulary as recoverable, even from a trusted server", () => {
		for (const code of ["totally-fatal", "", undefined]) {
			const result = classifyMcpToolResult(failed("fatal", code), context(true));
			expect(result).toMatchObject({ ok: false, kind: "recoverable" });
		}
	});

	it("never takes the server's wording into a learner-facing message", () => {
		const untrusted = classifyMcpToolResult(
			failed("fatal", "not-allowed", "LEAK ghp_SECRET"),
			context(false),
		);
		expect(JSON.stringify(untrusted)).not.toContain("LEAK");
		expect(JSON.stringify(untrusted)).not.toContain("ghp_SECRET");
	});

	it("passes a trusted server's fix guide on as the next action of a recoverable result", () => {
		const result = classifyMcpToolResult(
			failed(
				"recoverable",
				undefined,
				"相対パスは使えません。\n次の対応: 絶対パスで指定してください。",
			),
			context(true),
		);
		if (result.ok || result.kind !== "recoverable") throw new Error("expected recoverable");
		expect(result.summary).toContain("readFile");
		expect(result.summary).toContain("files");
		expect(result.nextAction).toContain("絶対パスで指定してください");
	});

	it("gives a trusted server's error without metadata (its SDK validation message) the generic next action", () => {
		const result = classifyMcpToolResult(
			{
				isError: true,
				content: [{ type: "text", text: "Input validation error: SERVER WORDING" }],
			},
			context(true),
		);
		if (result.ok || result.kind !== "recoverable") throw new Error("expected recoverable");
		expect(result.nextAction).toContain("再試行");
		expect(JSON.stringify(result)).not.toContain("SERVER WORDING");
	});

	it("gives an untrusted server's error a generic next action and none of its text", () => {
		const result = classifyMcpToolResult(
			{ isError: true, content: [{ type: "text", text: "Not Found: LEAK" }] },
			context(false),
		);
		if (result.ok || result.kind !== "recoverable") throw new Error("expected recoverable");
		expect(JSON.stringify(result)).not.toContain("LEAK");
		expect(result.nextAction).toContain("再試行");
	});

	it("treats an isError result without any meta as recoverable", () => {
		expect(classifyMcpToolResult({ isError: true, content: [] }, context(true))).toMatchObject({
			ok: false,
			kind: "recoverable",
		});
	});

	it("reads a malformed result as recoverable instead of crashing", () => {
		for (const result of [undefined, null, "text", 7, []]) {
			expect(classifyMcpToolResult(result, context(true))).toMatchObject({
				ok: false,
				kind: "recoverable",
			});
		}
	});

	it("uses a generic sentence that names the server when no message is configured for the code", () => {
		const result = classifyMcpToolResult(failed("fatal", "not-allowed"), {
			...context(true),
			learnerMessageFor: undefined,
		});
		if (result.ok || result.kind !== "fatal") throw new Error("expected fatal");
		expect(result.error.learnerMessage).toContain("files");
	});
});

describe("adaptMcpTool with a trusted server (end to end through the tool runtime)", () => {
	it("trips the latch when the server reports a fatal error, and the model gets the fixed message", async () => {
		const aciTool = adapted({ trustErrorMeta: true, serverId: "files" }, async () => ({
			isError: true,
			content: [{ type: "text", text: "RAW SERVER TEXT" }],
			_meta: { [MCP_ERROR_META_KEY]: { kind: "fatal", code: "not-allowed" } },
		}));
		const latch = new FatalLatch();
		const outcome = await run(aciTool, { owner: "o", repo: "r" }, latch);
		expect(latch.error?.code).toBe("not-allowed");
		expect(JSON.stringify(outcome)).toContain("許可されたルート");
		expect(JSON.stringify(outcome)).not.toContain("RAW SERVER TEXT");
	});
});
