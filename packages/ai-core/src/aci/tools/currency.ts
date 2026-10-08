import { z } from "zod";
import { ConfigError } from "../../config/load";
import { defineAciTool, ToolExecutionError } from "../define-tool";
import type { AciTool } from "../types";
import bundledRates from "./rates.json" with { type: "json" };

export const CURRENCY_CONVERT_TOOL_NAME = "currencyConvert";

const currencyCode = z.string().regex(/^[A-Z]{3}$/u);

const rateTableSchema = z
	.object({
		base: currencyCode,
		asOf: z.iso.date(),
		note: z.string().optional(),
		rates: z.record(currencyCode, z.number().positive().finite()),
	})
	.refine((table) => table.rates[table.base] === 1, {
		message: "the base currency must have rate 1",
		path: ["rates"],
	});

/** Fixed exchange rates: units of each currency per one unit of `base`, as of `asOf`. */
export interface RateTable {
	readonly base: string;
	readonly asOf: string;
	readonly rates: Readonly<Record<string, number>>;
}

export function parseRateTable(value: unknown): RateTable {
	const parsed = rateTableSchema.safeParse(value);
	if (!parsed.success) {
		throw new ConfigError(
			`為替レート表が不正です（${parsed.error.issues.map((issue) => issue.path.join(".") || issue.message).join("、")}）。`,
		);
	}
	const { base, asOf, rates } = parsed.data;
	return Object.freeze({ base, asOf, rates: Object.freeze({ ...rates }) });
}

/** The bundled table (`rates.json`). Rates are fixed for learning, not live market data. */
export const DEFAULT_RATE_TABLE: RateTable = parseRateTable(bundledRates);

export interface CurrencyConversion {
	readonly amount: number;
	readonly from: string;
	readonly to: string;
	/** Units of `to` per one unit of `from`, rounded to 6 decimals. */
	readonly rate: number;
	/** Rounded to 2 decimals. */
	readonly converted: number;
	readonly asOf: string;
}

function round(value: number, decimals: number): number {
	const factor = 10 ** decimals;
	return Math.round(value * factor) / factor;
}

const currencyInputSchema = z.object({
	amount: z.number().nonnegative().max(1e12).describe("換算する金額"),
	from: z.string().min(3).max(3).describe("換算元の通貨コード（ISO 4217。例: USD）"),
	to: z.string().min(3).max(3).describe("換算先の通貨コード（ISO 4217。例: JPY）"),
});

/** Converts currencies with a bundled fixed table; never calls an external API. */
export function createCurrencyConvertTool(
	rates: RateTable = DEFAULT_RATE_TABLE,
): AciTool<z.output<typeof currencyInputSchema>, CurrencyConversion> {
	const supported = Object.keys(rates.rates);

	function rateOf(code: string): number {
		const rate = rates.rates[code];
		if (rate === undefined) {
			throw new ToolExecutionError(`通貨「${code}」は換算表にありません。`, {
				nextAction: `対応している通貨（${supported.join("、")}）から選んでください。`,
			});
		}
		return rate;
	}

	return defineAciTool({
		name: CURRENCY_CONVERT_TOOL_NAME,
		description: `固定の為替レート表（${rates.asOf} 時点、学習用）で金額を別の通貨に換算します。対応通貨: ${supported.join(", ")}`,
		inputSchema: currencyInputSchema,
		risk: "read-only",
		execute: ({ amount, from, to }) => {
			const fromCode = from.toUpperCase();
			const toCode = to.toUpperCase();
			const fromRate = rateOf(fromCode);
			const exact = rateOf(toCode) / fromRate;
			return {
				amount,
				from: fromCode,
				to: toCode,
				rate: round(exact, 6),
				converted: round(amount * exact, 2),
				asOf: rates.asOf,
			};
		},
	});
}
