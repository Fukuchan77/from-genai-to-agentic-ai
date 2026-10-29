import { DEFAULT_ANALYSIS } from "../config/defaults";

// Separates what the sandbox's code printed into plain text, figures and tables (003 CL-19).
// The code draws through two helper functions (`prelude.ts`) that print one marker line per figure
// or table; this file takes those lines out of stdout and checks them. It is a pure function:
// the sandbox is untrusted, so every marker line is validated as if a person had typed it.

export const PNG_MARKER = "__PNG__:";
export const TABLE_MARKER = "__TABLE__:";

export interface Figure {
	readonly alt: string;
	readonly mediaType: "image/png";
	readonly base64: string;
}

export type TableCell = string | number | null;

export interface Table {
	readonly caption: string;
	readonly columns: readonly string[];
	readonly rows: readonly (readonly TableCell[])[];
	/** The number of rows the code had, which can exceed `rows.length` when rows were dropped. */
	readonly totalRows: number;
}

export interface OutputLimits {
	/** Decoded PNG size. */
	readonly maxFigureBytes: number;
	readonly maxTableRows: number;
	/** How many figures, and how many tables, are kept. The rest are reported as rejected. */
	readonly maxItems: number;
	readonly maxAltCharacters: number;
	readonly maxColumns: number;
	readonly maxCaptionCharacters: number;
	/** A cell or a column name longer than this is cut and marked with an ellipsis. */
	readonly maxCellCharacters: number;
	/** When set, the plain text is cut to this many characters after the markers are taken out. */
	readonly maxTextCharacters?: number;
}

export const DEFAULT_OUTPUT_LIMITS: OutputLimits = Object.freeze({
	maxFigureBytes: DEFAULT_ANALYSIS.maxFigureBytes,
	maxTableRows: DEFAULT_ANALYSIS.maxTableRows,
	maxItems: 10,
	maxAltCharacters: 200,
	maxColumns: 100,
	maxCaptionCharacters: 200,
	maxCellCharacters: 1_000,
});

export interface ParsedSandboxOutput {
	/** stdout without the marker lines. */
	readonly text: string;
	readonly figures: readonly Figure[];
	readonly tables: readonly Table[];
	/** Learner-facing reasons for each marker line that was dropped. */
	readonly rejected: readonly string[];
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/u;

type Checked<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly reason: string };

function fail<T>(reason: string): Checked<T> {
	return { ok: false, reason };
}

function parseJsonObject(payload: string): Record<string, unknown> | undefined {
	try {
		const value: unknown = JSON.parse(payload);
		return typeof value === "object" && value !== null && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
}

function megabytes(bytes: number): string {
	return `${bytes / (1024 * 1024)} MiB`;
}

function checkFigure(payload: string, limits: OutputLimits): Checked<Figure> {
	const data = parseJsonObject(payload);
	if (!data) return fail("図の行を読み取れませんでした（JSON の形式が不正です）。");

	const alt = typeof data.alt === "string" ? data.alt.trim() : "";
	if (alt.length < 1 || alt.length > limits.maxAltCharacters) {
		return fail(
			`図を表示できません: alt（代替テキスト）は 1〜${limits.maxAltCharacters} 文字の文字列で指定してください。`,
		);
	}

	const base64 = data.base64;
	if (typeof base64 !== "string" || base64.length % 4 !== 0 || !BASE64.test(base64)) {
		return fail(`図「${alt}」を表示できません: 画像データの形式が不正です。`);
	}
	const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
	if ((base64.length / 4) * 3 - padding > limits.maxFigureBytes) {
		return fail(
			`図「${alt}」を表示できません: 画像が大きすぎます（上限 ${megabytes(limits.maxFigureBytes)}）。`,
		);
	}
	const bytes = Buffer.from(base64, "base64");
	if (!PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
		return fail(`図「${alt}」を表示できません: PNG 画像ではありません。`);
	}
	return { ok: true, value: { alt, mediaType: "image/png", base64 } };
}

function isCell(value: unknown): value is TableCell {
	return (
		value === null ||
		typeof value === "string" ||
		(typeof value === "number" && Number.isFinite(value))
	);
}

function cutCell(text: string, limit: number): string {
	const characters = Array.from(text);
	return characters.length <= limit ? text : `${characters.slice(0, limit).join("")}…`;
}

function checkTable(payload: string, limits: OutputLimits): Checked<Table> {
	const reject = (why: string) => fail<Table>(`表を表示できません: ${why}`);
	const data = parseJsonObject(payload);
	if (!data) return fail("表の行を読み取れませんでした（JSON の形式が不正です）。");

	const { caption, columns, rows, totalRows } = data;
	if (typeof caption !== "string" || caption.length > limits.maxCaptionCharacters) {
		return reject(`キャプションは ${limits.maxCaptionCharacters} 文字以内の文字列にしてください。`);
	}
	if (
		!Array.isArray(columns) ||
		columns.length < 1 ||
		columns.length > limits.maxColumns ||
		!columns.every((column) => typeof column === "string")
	) {
		return reject(`列名は 1〜${limits.maxColumns} 個の文字列にしてください。`);
	}
	if (!Array.isArray(rows)) return reject("行の形式が不正です。");
	if (
		totalRows !== undefined &&
		(typeof totalRows !== "number" || !Number.isInteger(totalRows) || totalRows < 0)
	) {
		return reject("行数の形式が不正です。");
	}

	// Rows past the limit are dropped, not read: a bad cell beyond them cannot fail the table.
	const kept = rows.slice(0, limits.maxTableRows);
	for (const row of kept) {
		if (!Array.isArray(row) || row.length !== columns.length || !row.every(isCell)) {
			return reject("行の形式が不正です（列の数や値の型が合いません）。");
		}
	}
	return {
		ok: true,
		value: {
			caption,
			columns: (columns as string[]).map((column) => cutCell(column, limits.maxCellCharacters)),
			rows: (kept as TableCell[][]).map((row) =>
				row.map((cell) =>
					typeof cell === "string" ? cutCell(cell, limits.maxCellCharacters) : cell,
				),
			),
			totalRows: Math.max(totalRows ?? 0, rows.length),
		},
	};
}

/** Cuts to `limit` UTF-16 units without leaving half of a surrogate pair, and says how much went. */
function cutText(text: string, limit: number): string {
	if (text.length <= limit) return text;
	let end = limit;
	const last = text.charCodeAt(end - 1);
	if (end > 0 && last >= 0xd800 && last <= 0xdbff) end -= 1;
	return `${text.slice(0, end)}\n…（以降 ${text.length - end} 文字を省略しました）`;
}

/**
 * Takes the marker lines out of `stdout` and checks them: a PNG within the size limit with a
 * non-empty alt, a table within the row and column limits. A marker counts only at the start of a
 * line. The markers are extracted from the whole output before the text is cut, so a huge print
 * cannot push a figure out of reach.
 */
export function parseSandboxOutput(stdout: string, limits: OutputLimits): ParsedSandboxOutput {
	const figures: Figure[] = [];
	const tables: Table[] = [];
	const rejected: string[] = [];
	const kept: string[] = [];

	function take<T>(
		line: string,
		marker: string,
		label: string,
		into: T[],
		check: (payload: string) => Checked<T>,
	): void {
		if (into.length >= limits.maxItems) {
			rejected.push(`${label}が多すぎます（上限 ${limits.maxItems} 件）。超えた分は表示しません。`);
			return;
		}
		const result = check(line.slice(marker.length));
		if (result.ok) into.push(result.value);
		else rejected.push(result.reason);
	}

	for (const line of stdout.split(/\r?\n/u)) {
		if (line.startsWith(PNG_MARKER))
			take(line, PNG_MARKER, "図", figures, (p) => checkFigure(p, limits));
		else if (line.startsWith(TABLE_MARKER))
			take(line, TABLE_MARKER, "表", tables, (p) => checkTable(p, limits));
		else kept.push(line);
	}

	const text = kept.join("\n");
	return {
		text: limits.maxTextCharacters === undefined ? text : cutText(text, limits.maxTextCharacters),
		figures,
		tables,
		rejected,
	};
}
