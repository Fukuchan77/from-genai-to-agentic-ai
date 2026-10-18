import { asSchema } from "ai";
import { describe, expect, it } from "vitest";
import { FatalLatch } from "../aci/fatal";
import { buildToolSet } from "../aci/tool-set";
import type { ToolOutcome, ToolRuntime } from "../aci/types";
import { PlatformError } from "../errors";
import { createFakeClock } from "../ports/clock";
import type { SandboxRunResult, SandboxSession } from "../ports/sandbox";
import { createAttemptLog } from "./attempts";
import { PNG_MARKER, TABLE_MARKER } from "./output-parser";
import { helpersImportLine } from "./prelude";
import {
	type AnalysisEvent,
	createRunPythonTool,
	RUN_PYTHON_TOOL_NAME,
	type RunPythonResult,
} from "./run-python-tool";

const PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const figureLine = (alt = "売上のグラフ") =>
	`${PNG_MARKER}${JSON.stringify({ alt, base64: PNG_BASE64 })}`;
const tableLine = (caption = "月別売上") =>
	`${TABLE_MARKER}${JSON.stringify({ caption, columns: ["a"], rows: [["x"]], totalRows: 1 })}`;

const SUCCESS: SandboxRunResult = { stdout: "rows: 3\n", stderr: "" };
const KEY_ERROR: SandboxRunResult = {
	stdout: "loading\n",
	stderr: "Traceback (most recent call last):\n  File \"x\", line 2\nKeyError: 'revenue'\n",
	error: { name: "KeyError", message: "'revenue'", traceback: "Traceback...\nKeyError: 'revenue'" },
};

interface Harness {
	readonly runs: { code: string; timeoutMs: number }[];
	readonly events: AnalysisEvent[];
	readonly log: ReturnType<typeof createAttemptLog>;
	call(code: string): Promise<ToolOutcome<RunPythonResult>>;
	readonly latch: FatalLatch;
}

function harness(
	responses: readonly (SandboxRunResult | Error)[],
	options: { maxFixAttempts?: number; executionTimeoutMs?: number } = {},
): Harness {
	const runs: { code: string; timeoutMs: number }[] = [];
	const events: AnalysisEvent[] = [];
	let next = 0;
	const session: SandboxSession = {
		async writeFile() {},
		async runPython(code, { timeoutMs }) {
			runs.push({ code, timeoutMs });
			const response = responses[Math.min(next, responses.length - 1)];
			next += 1;
			if (response instanceof Error) throw response;
			return response ?? SUCCESS;
		},
		async isAlive() {
			return true;
		},
		async close() {},
	};
	const log = createAttemptLog({ maxFixAttempts: options.maxFixAttempts ?? 3 });
	const latch = new FatalLatch();
	const tool = createRunPythonTool({
		session,
		log,
		executionTimeoutMs: options.executionTimeoutMs ?? 60_000,
		onEvent: (event) => events.push(event),
	});
	const runtime: ToolRuntime = { clock: createFakeClock(), toolTimeoutMs: 120_000, fatal: latch };
	const { tools } = buildToolSet([tool], {}, runtime);
	const execute = tools[RUN_PYTHON_TOOL_NAME]?.execute;
	if (!execute) throw new Error("runPython must be executable");
	return {
		runs,
		events,
		log,
		latch,
		call: async (code) =>
			(await execute(
				{ code },
				{ toolCallId: "call-1", messages: [], context: undefined },
			)) as ToolOutcome<RunPythonResult>,
	};
}

describe("createRunPythonTool: definition", () => {
	it("is the read-only runPython tool, whose only effect is inside the sandbox", () => {
		const tool = createRunPythonTool({
			session: harness([SUCCESS]).log as never,
			log: createAttemptLog({ maxFixAttempts: 3 }),
			executionTimeoutMs: 1000,
		});

		expect(tool.name).toBe("runPython");
		expect(tool.risk).toBe("read-only");
		expect(tool.description).toContain("使うとき:");
		expect(tool.description).toContain("使わないとき:");
		expect(tool.description).toContain("例:");
	});

	it("rejects empty code and code over 20000 characters before running anything", async () => {
		const tool = createRunPythonTool({
			session: undefined as never,
			log: createAttemptLog({ maxFixAttempts: 3 }),
			executionTimeoutMs: 1000,
		});
		const schema = asSchema(
			tool.toTool({ clock: createFakeClock(), toolTimeoutMs: 1000 }).inputSchema,
		);

		expect((await schema.validate?.({ code: "" }))?.success).toBe(false);
		expect((await schema.validate?.({ code: "x".repeat(20_001) }))?.success).toBe(false);
		expect((await schema.validate?.({ code: "x".repeat(20_000) }))?.success).toBe(true);
		expect((await schema.validate?.({}))?.success).toBe(false);
	});
});

describe("runPython: a successful run", () => {
	it("runs the code behind the helpers import line, with the execution timeout", async () => {
		const h = harness([SUCCESS], { executionTimeoutMs: 12_345 });

		await h.call("print(len(df))");

		expect(h.runs).toEqual([{ code: `${helpersImportLine()}\nprint(len(df))`, timeoutMs: 12_345 }]);
	});

	it("tells the model the output and what was shown, without the image data", async () => {
		const h = harness([
			{ stdout: `rows: 3\n${figureLine("棒グラフ")}\n${tableLine("売上表")}\n`, stderr: "" },
		]);

		const outcome = await h.call("code");

		expect(outcome).toEqual({
			ok: true,
			data: { status: "ok", stdout: "rows: 3\n", figures: ["棒グラフ"], tables: ["売上表"] },
		});
		expect(JSON.stringify(outcome)).not.toContain(PNG_BASE64);
	});

	it("emits the attempt first, then each figure and table, and records the code as the model wrote it", async () => {
		const h = harness([
			{ stdout: `${figureLine("グラフ")}\n${tableLine("表")}\nlast\n`, stderr: "warn\n" },
		]);

		await h.call("my code");

		expect(h.events.map((event) => event.type)).toEqual(["attempt", "figure", "table"]);
		expect(h.events[0]).toMatchObject({
			type: "attempt",
			fixes: 0,
			attempt: { index: 1, code: "my code", stdout: "last\n", stderr: "warn\n" },
		});
		expect(h.events[1]).toMatchObject({
			type: "figure",
			figure: { alt: "グラフ", mediaType: "image/png" },
		});
		expect(h.events[2]).toMatchObject({ type: "table", table: { caption: "表", totalRows: 1 } });
	});

	it("reports the markers it had to drop, to the model and as an event", async () => {
		const bad = `${PNG_MARKER}${JSON.stringify({ alt: "", base64: PNG_BASE64 })}`;
		const h = harness([{ stdout: `${bad}\n`, stderr: "" }]);

		const outcome = await h.call("code");

		expect(outcome).toMatchObject({ ok: true, data: { status: "ok", figures: [] } });
		const data = (outcome as { data: Extract<RunPythonResult, { status: "ok" }> }).data;
		expect(data.rejected?.[0]).toContain("alt");
		expect(h.events.map((event) => event.type)).toEqual(["attempt", "rejected"]);
	});

	it("cuts the output the model sees at 6000 characters but keeps more for the learner", async () => {
		const h = harness([{ stdout: "x".repeat(10_000), stderr: "" }]);

		const outcome = await h.call("code");

		const data = (outcome as { data: Extract<RunPythonResult, { status: "ok" }> }).data;
		expect(data.stdout.length).toBeLessThan(6200);
		expect(data.stdout).toContain("省略");
		expect(
			(h.events[0] as Extract<AnalysisEvent, { type: "attempt" }>).attempt.stdout,
		).toHaveLength(10_000);
	});
});

describe("runPython: a failed run", () => {
	it("hands the error back to the model so it can fix the code, with the fixes left", async () => {
		const h = harness([KEY_ERROR]);

		const outcome = await h.call("df['revenue']");

		expect(outcome).toMatchObject({
			ok: true,
			data: {
				status: "error",
				error: "KeyError: 'revenue'",
				stdout: "loading\n",
				stderr: KEY_ERROR.stderr,
				fixesLeft: 3,
			},
		});
		expect(h.latch.error).toBeUndefined();
	});

	it("gives the model the end of a long stderr, up to 8000 characters", async () => {
		const stderr = `${"a".repeat(20_000)}KeyError: 'last'`;
		const h = harness([{ ...KEY_ERROR, stderr }]);

		const outcome = await h.call("code");

		const data = (outcome as { data: Extract<RunPythonResult, { status: "error" }> }).data;
		expect(data.stderr.endsWith("KeyError: 'last'")).toBe(true);
		expect([...data.stderr].length).toBeLessThan(8100);
		expect(data.stderr).toContain("省略");
	});

	it("emits the failed attempt with its error summary, and no figures from a failed run", async () => {
		const h = harness([{ ...KEY_ERROR, stdout: `${figureLine()}\npartial\n` }]);

		const outcome = await h.call("code");

		expect(h.events.map((event) => event.type)).toEqual(["attempt"]);
		expect(h.events[0]).toMatchObject({
			attempt: { index: 1, errorSummary: "KeyError: 'revenue'", stdout: "partial\n" },
		});
		expect(JSON.stringify(outcome)).not.toContain("売上のグラフ");
	});

	it("reports in each attempt event how many fixes had been made by then", async () => {
		const h = harness([KEY_ERROR, KEY_ERROR, SUCCESS]);

		await h.call("one");
		await h.call("two");
		await h.call("three");

		const fixes = h.events
			.filter((event) => event.type === "attempt")
			.map((event) => (event as { fixes: number }).fixes);
		expect(fixes).toEqual([0, 1, 2]);
	});

	it("treats a timeout as an error of the code, so the model can make it faster", async () => {
		const h = harness([
			{
				stdout: "",
				stderr: "",
				error: { name: "TimeoutError", message: "実行が 60000 ms を超えました。", traceback: "" },
			},
		]);

		const outcome = await h.call("while True: pass");

		expect(outcome).toMatchObject({
			ok: true,
			data: { status: "error", error: expect.stringContaining("TimeoutError") },
		});
		expect(h.latch.error).toBeUndefined();
	});

	it("counts down the fixes left", async () => {
		const h = harness([KEY_ERROR, KEY_ERROR, KEY_ERROR]);

		const left: number[] = [];
		for (let run = 0; run < 3; run += 1) {
			const outcome = await h.call(`attempt ${run}`);
			left.push((outcome as { data: { fixesLeft: number } }).data.fixesLeft);
		}

		expect(left).toEqual([3, 2, 1]);
	});

	it("ends the run when the sandbox itself is unavailable, with the sandbox's own message", async () => {
		const h = harness([
			new PlatformError(
				"provider-unavailable",
				"サンドボックスの有効期限が切れました。もう一度実行してください。",
			),
		]);

		const outcome = await h.call("code");

		expect(h.latch.error?.code).toBe("sandbox-unavailable");
		expect(h.latch.error?.learnerMessage).toContain("有効期限");
		expect(outcome).toMatchObject({ ok: false });
		// Nothing ran, so nothing is an attempt; and it is not a failure of the code to fix.
		expect(h.log.attempts()).toEqual([]);
		expect(h.events).toEqual([]);
	});

	it("keeps other errors from the sandbox recoverable (they are not an unavailable sandbox)", async () => {
		const h = harness([new PlatformError("invalid-request", "ファイル名が不正です。")]);

		const outcome = await h.call("code");

		expect(outcome).toMatchObject({ ok: false, failure: { kind: "recoverable" } });
		expect(h.latch.error).toBeUndefined();
	});
});

describe("runPython: the attempt limit", () => {
	it("runs the code four times (the first run and three fixes), then stops the run without a fifth", async () => {
		const h = harness([KEY_ERROR]);

		const outcomes: ToolOutcome<RunPythonResult>[] = [];
		for (let run = 0; run < 4; run += 1) outcomes.push(await h.call(`attempt ${run + 1}`));

		expect(h.runs).toHaveLength(4);
		expect(outcomes.slice(0, 3).every((outcome) => outcome.ok)).toBe(true);
		expect(h.latch.error?.code).toBe("attempt-limit");
		expect(h.latch.error?.learnerMessage).toContain("3");
		expect(h.log.exhausted()).toBe(true);
	});

	it("does not run another attempt once the run has been stopped, even if the model asks again", async () => {
		const h = harness([KEY_ERROR]);
		for (let run = 0; run < 4; run += 1) await h.call(`attempt ${run + 1}`);

		const fifth = await h.call("attempt 5");

		expect(h.runs).toHaveLength(4);
		expect(fifth).toMatchObject({ ok: false });
		expect(h.log.attempts()).toHaveLength(4);
	});

	it("refuses by itself, without a latch to do it, when the fixes are used up", async () => {
		const runs: string[] = [];
		const session: SandboxSession = {
			async writeFile() {},
			async runPython(code) {
				runs.push(code);
				return KEY_ERROR;
			},
			async isAlive() {
				return true;
			},
			async close() {},
		};
		const log = createAttemptLog({ maxFixAttempts: 1 });
		const tool = createRunPythonTool({ session, log, executionTimeoutMs: 1000 });
		const { tools } = buildToolSet([tool], {}, { clock: createFakeClock(), toolTimeoutMs: 10_000 });
		const execute = tools[RUN_PYTHON_TOOL_NAME]?.execute;
		if (!execute) throw new Error("runPython must be executable");
		const run = (code: string) =>
			execute({ code }, { toolCallId: "c", messages: [], context: undefined });

		await run("one");
		await run("two"); // the last allowed fix fails
		const refused = (await run("three")) as ToolOutcome<RunPythonResult>;

		expect(runs).toHaveLength(2);
		expect(refused).toMatchObject({
			ok: false,
			failure: { summary: expect.stringContaining("1 回") },
		});
	});

	it("keeps every attempt for the learner, with the last code and its error", async () => {
		const h = harness([KEY_ERROR]);
		for (let run = 0; run < 4; run += 1) await h.call(`attempt ${run + 1}`);

		const attempts = h.log.attempts();

		expect(attempts.map((attempt) => attempt.code)).toEqual([
			"attempt 1",
			"attempt 2",
			"attempt 3",
			"attempt 4",
		]);
		expect(attempts.at(-1)?.errorSummary).toBe("KeyError: 'revenue'");
		expect(h.events.filter((event) => event.type === "attempt")).toHaveLength(4);
	});

	it("does not stop a run that succeeds on the last allowed fix", async () => {
		const h = harness([KEY_ERROR, KEY_ERROR, KEY_ERROR, SUCCESS]);

		for (let run = 0; run < 4; run += 1) await h.call(`attempt ${run + 1}`);

		expect(h.latch.error).toBeUndefined();
		expect(h.log.fixes()).toBe(3);
	});

	it("honours another limit: with one fix allowed it stops after the second run", async () => {
		const h = harness([KEY_ERROR], { maxFixAttempts: 1 });

		await h.call("one");
		expect(h.latch.error).toBeUndefined();
		await h.call("two");

		expect(h.runs).toHaveLength(2);
		expect(h.latch.error?.code).toBe("attempt-limit");
	});
});
