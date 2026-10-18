import { z } from "zod";
import type { JsonSchemaNode } from "./description-check";

const HEADER = "入力が正しくありません。次の点を直して、もう一度呼び出してください。";
const WHOLE_INPUT = "入力全体";

function jsonSchemaOf(schema: z.ZodType): JsonSchemaNode {
	return z.toJSONSchema(schema, {
		io: "input",
		unrepresentable: "any",
		target: "draft-7",
	}) as JsonSchemaNode;
}

function members(node: JsonSchemaNode): readonly JsonSchemaNode[] {
	return [...(node.anyOf ?? []), ...(node.oneOf ?? []), ...(node.allOf ?? [])];
}

function descriptionOf(node: JsonSchemaNode): string | undefined {
	if (typeof node.description === "string" && node.description.trim() !== "")
		return node.description;
	for (const member of members(node)) {
		const found = descriptionOf(member);
		if (found !== undefined) return found;
	}
	return undefined;
}

/** Finds the schema node for an issue path; numbers step into `items`. */
function nodeAt(root: JsonSchemaNode, path: readonly PropertyKey[]): JsonSchemaNode | undefined {
	let node: JsonSchemaNode | undefined = root;
	for (const key of path) {
		if (node === undefined) return undefined;
		const current: JsonSchemaNode = node;
		const next: JsonSchemaNode | undefined =
			typeof key === "number"
				? Array.isArray(current.items)
					? current.items[0]
					: (current.items as JsonSchemaNode | undefined)
				: (current.properties?.[String(key)] ??
					members(current)
						.map((m) => m.properties?.[String(key)])
						.find(Boolean));
		node = next;
	}
	return node;
}

const STRING_FORMAT_EXAMPLES: Readonly<Record<string, string>> = {
	email: "user@example.com",
	uri: "https://example.com/",
	url: "https://example.com/",
	uuid: "123e4567-e89b-12d3-a456-426614174000",
	date: "2026-01-31",
	"date-time": "2026-01-31T09:00:00Z",
};

function exampleFor(node: JsonSchemaNode): unknown {
	if (node.const !== undefined) return node.const;
	if (Array.isArray(node.enum) && node.enum.length > 0) return node.enum[0];
	const alternatives = members(node).filter((member) => member.type !== "null");
	if (alternatives[0] !== undefined) return exampleFor(alternatives[0]);
	switch (node.type) {
		case "string": {
			const format =
				typeof node.format === "string" ? STRING_FORMAT_EXAMPLES[node.format] : undefined;
			if (format !== undefined) return format;
			const minLength = typeof node.minLength === "number" ? node.minLength : 1;
			return "例".repeat(Math.max(1, minLength));
		}
		case "number":
		case "integer": {
			const minimum = typeof node.minimum === "number" ? node.minimum : undefined;
			const above =
				typeof node.exclusiveMinimum === "number" ? node.exclusiveMinimum + 1 : undefined;
			const maximum = typeof node.maximum === "number" ? node.maximum : undefined;
			const below =
				typeof node.exclusiveMaximum === "number" ? node.exclusiveMaximum - 1 : undefined;
			const base = Math.max(minimum ?? 1, above ?? Number.NEGATIVE_INFINITY);
			const cap = Math.min(maximum ?? Number.POSITIVE_INFINITY, below ?? Number.POSITIVE_INFINITY);
			return Math.min(base, cap);
		}
		case "boolean":
			return true;
		case "array": {
			const minItems = typeof node.minItems === "number" ? node.minItems : 0;
			const items = Array.isArray(node.items)
				? node.items[0]
				: (node.items as JsonSchemaNode | undefined);
			return items === undefined ? [] : Array.from({ length: minItems }, () => exampleFor(items));
		}
		case "object":
			return exampleObject(node);
		default:
			return null;
	}
}

function exampleObject(node: JsonSchemaNode): Record<string, unknown> {
	const required = Array.isArray(node.required) ? (node.required as string[]) : [];
	const result: Record<string, unknown> = {};
	for (const name of required) {
		const child = node.properties?.[name];
		if (child !== undefined) result[name] = exampleFor(child);
	}
	return result;
}

function detailOf(issue: z.core.$ZodIssue): string {
	switch (issue.code) {
		case "invalid_type": {
			const omitted = /received undefined/u.test(issue.message);
			return `${issue.expected} 型で指定してください。${omitted ? "省略できません。" : ""}`;
		}
		case "invalid_value":
			return `次のいずれかにしてください: ${issue.values.map((value) => JSON.stringify(value)).join(", ")}。`;
		case "too_small": {
			const bound = Number(issue.minimum);
			if (issue.origin === "string") return `${bound} 文字以上にしてください。`;
			if (issue.origin === "array" || issue.origin === "set")
				return `${bound} 件以上にしてください。`;
			return `${bound} ${issue.inclusive ? "以上" : "より大きい値"}にしてください。`;
		}
		case "too_big": {
			const bound = Number(issue.maximum);
			if (issue.origin === "string") return `${bound} 文字以下にしてください。`;
			if (issue.origin === "array" || issue.origin === "set")
				return `${bound} 件以下にしてください。`;
			return `${bound} ${issue.inclusive ? "以下" : "より小さい値"}にしてください。`;
		}
		case "unrecognized_keys":
			return `不要なパラメータ（${issue.keys.join(", ")}）があります。取り除いてください。`;
		default:
			return `${issue.message}。`;
	}
}

/**
 * Builds the text the model sees when its tool input fails validation (CL-2): which parameter is
 * wrong, what is expected, what it means and a valid example. It never repeats the received values
 * and carries no Zod dump or stack trace.
 */
export function formatInputGuide(error: z.ZodError, inputSchema: z.ZodType): string {
	const root = jsonSchemaOf(inputSchema);
	const lines = error.issues.map((issue) => {
		const name = issue.path.length === 0 ? WHOLE_INPUT : issue.path.map(String).join(".");
		const meaning = nodeAt(root, issue.path);
		const description = meaning === undefined ? undefined : descriptionOf(meaning);
		const label = description === undefined ? name : `${name}（${description}）`;
		return `- ${label}：${detailOf(issue)}`;
	});
	const guide = `${HEADER}\n${lines.join("\n")}`;
	// An example the schema itself rejects would teach the model the same mistake, so it is shown
	// only when it parses (patterns and refinements are beyond what the generator knows).
	const example = exampleFor(root);
	return inputSchema.safeParse(example).success
		? `${guide}\n正しい入力の例: ${JSON.stringify(example)}`
		: guide;
}
