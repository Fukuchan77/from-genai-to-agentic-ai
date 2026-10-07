import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { createFakeClock } from "../../ports/clock";
import { ToolExecutionError } from "../define-tool";
import type { ToolOutcome } from "../types";
import { CALCULATOR_TOOL_NAME, createCalculatorTool, evaluateExpression } from "./calculator";

function errorOf(expression: string): ToolExecutionError {
	try {
		evaluateExpression(expression);
	} catch (error) {
		if (error instanceof ToolExecutionError) return error;
		throw error;
	}
	throw new Error(`expected "${expression}" to fail`);
}

describe("evaluateExpression", () => {
	it.each([
		["1 + 2 * 3", 7],
		["(1 + 2) * 3", 9],
		["10 - 4 - 3", 3],
		["2 * 3 / 4", 1.5],
		["100 / 10 / 5", 2],
		["2 ^ 3 ^ 2", 512],
		["2 ** 10", 1024],
		["-2 ^ 2", -4],
		["(-2) ^ 2", 4],
		["2 ^ -1", 0.5],
		["-(3 + 4) * 2", -14],
		["+5 - -5", 10],
		["1.5 * 4", 6],
		[".5 + .25", 0.75],
		["  ((2))  ", 2],
		["3 × 4 ÷ 6", 2],
		["0.1 + 0.2", 0.3],
		["-0 * 1", 0],
	])("evaluates %s to %s", (expression, expected) => {
		expect(evaluateExpression(expression)).toBe(expected);
	});

	it("asks to close an unclosed parenthesis", () => {
		const error = errorOf("(1 + 2");
		expect(error.summary).toBe("数式の括弧が閉じていません。");
		expect(error.nextAction).toBe("数式の括弧を閉じてください。");
	});

	it.each([
		["1 + 2)", "数式の 6 文字目に予期しない「)」があります。"],
		["1 +", "数式が途中で終わっています。"],
		["", "数式が空です。"],
		["2 * x", "数式の 5 文字目に使えない文字「x」があります。"],
		["1..2", "数式の 1 文字目の数値「1..2」が不正です。"],
		["* 3", "数式の 1 文字目に予期しない「*」があります。"],
		["()", "数式の 2 文字目に予期しない「)」があります。"],
	])("reports %j as %s", (expression, summary) => {
		expect(errorOf(expression).summary).toBe(summary);
	});

	it("rejects division by zero", () => {
		const error = errorOf("1 / (2 - 2)");
		expect(error.summary).toBe("0 で割ることはできません。");
		expect(error.nextAction).toBe("除数が 0 にならないように数式を直してください。");
	});

	it("rejects a non-finite result", () => {
		expect(errorOf("10 ^ 400").summary).toBe("計算結果が有限の数になりません。");
		expect(errorOf("(-8) ^ 0.5").summary).toBe("計算結果が有限の数になりません。");
	});

	it("rejects expressions nested deeper than the parser allows", () => {
		const deep = `${"(".repeat(65)}1${")".repeat(65)}`;
		expect(errorOf(deep).summary).toBe("数式の括弧の入れ子が深すぎます（上限 64 段）。");
		const ok = `${"(".repeat(64)}1${")".repeat(64)}`;
		expect(evaluateExpression(ok)).toBe(1);
	});

	it("does not evaluate JavaScript", () => {
		expect(errorOf("process.exit(1)").summary).toBe(
			"数式の 1 文字目に使えない文字「p」があります。",
		);
	});
});

describe("createCalculatorTool", () => {
	const runtime = { clock: createFakeClock(), toolTimeoutMs: 1_000 };

	async function calculate(expression: string): Promise<ToolOutcome<unknown>> {
		const execute = createCalculatorTool().toTool(runtime).execute;
		if (!execute) throw new Error("calculator must be executable");
		return (await execute(
			{ expression },
			{ toolCallId: "call-1", messages: [], context: undefined },
		)) as ToolOutcome<unknown>;
	}

	it("is a read-only tool named calculator", () => {
		const tool = createCalculatorTool();
		expect(tool.name).toBe(CALCULATOR_TOOL_NAME);
		expect(CALCULATOR_TOOL_NAME).toBe("calculator");
		expect(tool.risk).toBe("read-only");
	});

	it("returns the expression and its result", async () => {
		await expect(calculate("(1 + 2) * 3")).resolves.toEqual({
			ok: true,
			data: { expression: "(1 + 2) * 3", result: 9 },
		});
	});

	it("returns an invalid expression as a recoverable failure with a next action", async () => {
		await expect(calculate("(1 + 2")).resolves.toEqual({
			ok: false,
			failure: {
				kind: "recoverable",
				summary: "数式の括弧が閉じていません。",
				nextAction: "数式の括弧を閉じてください。",
			},
		});
	});

	it("limits the expression length in its input schema", () => {
		const schema = createCalculatorTool().toTool(runtime).inputSchema as z.ZodType;
		expect(schema.safeParse({ expression: "1".repeat(200) }).success).toBe(true);
		expect(schema.safeParse({ expression: "1".repeat(201) }).success).toBe(false);
	});
});
