import { z } from "zod";
import { defineAciTool, ToolExecutionError } from "../define-tool";
import type { AciTool } from "../types";

export const CALCULATOR_TOOL_NAME = "calculator";
export const MAX_EXPRESSION_LENGTH = 200;
const MAX_PARENTHESIS_DEPTH = 64;
/** Significant digits kept in a result, so that `0.1 + 0.2` reads as `0.3`. */
const RESULT_PRECISION = 15;

type Operator = "+" | "-" | "*" | "/" | "^";

type Token =
	| { readonly type: "number"; readonly value: number; readonly position: number }
	| { readonly type: "operator"; readonly value: Operator; readonly position: number }
	| { readonly type: "paren"; readonly value: "(" | ")"; readonly position: number };

const OPERATOR_ALIASES: Readonly<Record<string, Operator>> = {
	"+": "+",
	"-": "-",
	"*": "*",
	"×": "*",
	"/": "/",
	"÷": "/",
	"^": "^",
};
const NUMBER_CHARACTER = /[0-9.]/u;
const VALID_NUMBER = /^(?:\d+(?:\.\d*)?|\.\d+)$/u;
const WHITESPACE = /\s/u;

function invalid(
	summary: string,
	nextAction = "四則演算・べき乗・括弧だけを使った数式にしてください。",
) {
	return new ToolExecutionError(summary, { nextAction });
}

function tokenize(expression: string): readonly Token[] {
	const tokens: Token[] = [];
	let index = 0;
	while (index < expression.length) {
		const character = expression.charAt(index);
		if (WHITESPACE.test(character)) {
			index += 1;
			continue;
		}
		if (NUMBER_CHARACTER.test(character)) {
			let end = index;
			while (end < expression.length && NUMBER_CHARACTER.test(expression.charAt(end))) end += 1;
			const text = expression.slice(index, end);
			if (!VALID_NUMBER.test(text)) {
				throw invalid(`数式の ${index + 1} 文字目の数値「${text}」が不正です。`);
			}
			tokens.push({ type: "number", value: Number(text), position: index });
			index = end;
			continue;
		}
		if (character === "*" && expression.charAt(index + 1) === "*") {
			tokens.push({ type: "operator", value: "^", position: index });
			index += 2;
			continue;
		}
		const operator = OPERATOR_ALIASES[character];
		if (operator !== undefined) {
			tokens.push({ type: "operator", value: operator, position: index });
			index += 1;
			continue;
		}
		if (character === "(" || character === ")") {
			tokens.push({ type: "paren", value: character, position: index });
			index += 1;
			continue;
		}
		throw invalid(`数式の ${index + 1} 文字目に使えない文字「${character}」があります。`);
	}
	return tokens;
}

/**
 * Recursive-descent parser and evaluator (no `eval`):
 *
 *   expression := term (("+" | "-") term)*
 *   term       := unary (("*" | "/") unary)*
 *   unary      := ("+" | "-") unary | power
 *   power      := primary ("^" unary)?        (right-associative; -2^2 = -4)
 *   primary    := number | "(" expression ")"
 */
class Parser {
	private readonly tokens: readonly Token[];
	private index = 0;
	private depth = 0;

	constructor(tokens: readonly Token[]) {
		this.tokens = tokens;
	}

	parse(): number {
		const value = this.expression();
		const extra = this.peek();
		if (extra !== undefined) throw this.unexpected(extra);
		return value;
	}

	private peek(): Token | undefined {
		return this.tokens[this.index];
	}

	private next(): Token {
		const token = this.tokens[this.index];
		if (token === undefined) {
			throw this.depth > 0
				? invalid("数式の括弧が閉じていません。", "数式の括弧を閉じてください。")
				: invalid("数式が途中で終わっています。", "演算子の後に数値か括弧を書いてください。");
		}
		this.index += 1;
		return token;
	}

	private unexpected(token: Token): ToolExecutionError {
		const text = token.type === "number" ? String(token.value) : token.value;
		return invalid(`数式の ${token.position + 1} 文字目に予期しない「${text}」があります。`);
	}

	private isOperator(token: Token | undefined, ...operators: Operator[]): token is Token {
		return token?.type === "operator" && operators.includes(token.value);
	}

	private expression(): number {
		let value = this.term();
		for (let token = this.peek(); this.isOperator(token, "+", "-"); token = this.peek()) {
			this.index += 1;
			const right = this.term();
			value = token.value === "+" ? value + right : value - right;
		}
		return value;
	}

	private term(): number {
		let value = this.unary();
		for (let token = this.peek(); this.isOperator(token, "*", "/"); token = this.peek()) {
			this.index += 1;
			const right = this.unary();
			if (token.value === "*") {
				value *= right;
				continue;
			}
			if (right === 0) {
				throw invalid(
					"0 で割ることはできません。",
					"除数が 0 にならないように数式を直してください。",
				);
			}
			value /= right;
		}
		return value;
	}

	private unary(): number {
		let sign = 1;
		for (let token = this.peek(); this.isOperator(token, "+", "-"); token = this.peek()) {
			this.index += 1;
			if (token.value === "-") sign = -sign;
		}
		return sign * this.power();
	}

	private power(): number {
		const base = this.primary();
		if (!this.isOperator(this.peek(), "^")) return base;
		this.index += 1;
		return base ** this.unary();
	}

	private primary(): number {
		const token = this.next();
		if (token.type === "number") return token.value;
		if (token.value !== "(") throw this.unexpected(token);
		if (this.depth >= MAX_PARENTHESIS_DEPTH) {
			throw invalid(`数式の括弧の入れ子が深すぎます（上限 ${MAX_PARENTHESIS_DEPTH} 段）。`);
		}
		this.depth += 1;
		const value = this.expression();
		const closing = this.next();
		if (closing.type !== "paren" || closing.value !== ")") throw this.unexpected(closing);
		this.depth -= 1;
		return value;
	}
}

/** Evaluates an arithmetic expression. Throws `ToolExecutionError` for an invalid expression. */
export function evaluateExpression(expression: string): number {
	const tokens = tokenize(expression);
	if (tokens.length === 0) throw invalid("数式が空です。");
	const result = new Parser(tokens).parse();
	if (!Number.isFinite(result)) {
		throw invalid("計算結果が有限の数になりません。", "数値の大きさや指数を見直してください。");
	}
	const rounded = Number(result.toPrecision(RESULT_PRECISION));
	return rounded === 0 ? 0 : rounded;
}

export interface CalculatorResult {
	readonly expression: string;
	readonly result: number;
}

const calculatorInputSchema = z.object({
	expression: z
		.string()
		.max(MAX_EXPRESSION_LENGTH)
		.describe(
			"計算する数式。四則演算（+ - * /）、べき乗（^ または **）、括弧が使えます。例: (1 + 2) * 3",
		),
});

export function createCalculatorTool(): AciTool<{ expression: string }, CalculatorResult> {
	return defineAciTool({
		name: CALCULATOR_TOOL_NAME,
		description: "数式を正確に計算します。暗算せず、計算が必要なときはこのツールを使ってください。",
		inputSchema: calculatorInputSchema,
		risk: "read-only",
		execute: ({ expression }) => ({ expression, result: evaluateExpression(expression) }),
	});
}
