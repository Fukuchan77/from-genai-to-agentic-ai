import { z } from "zod";

/** The three heading lines every tool description carries (003 CL-18). */
export const DESCRIPTION_HEADINGS = ["使うとき:", "使わないとき:", "例:"] as const;

export type DescriptionIssueCode =
	| "missing-summary"
	| "missing-heading"
	| "empty-heading"
	| "missing-field-description"
	| "unsendable-schema";

export interface DescriptionIssue {
	readonly code: DescriptionIssueCode;
	/** The heading (`使うとき:`), `description`, or the dotted path of the input field. */
	readonly target: string;
	/** Learner-facing text for the tool author. */
	readonly message: string;
}

/** The part of a JSON Schema this check reads. Other keywords are ignored. */
export interface JsonSchemaNode {
	readonly description?: string;
	readonly properties?: Readonly<Record<string, JsonSchemaNode>>;
	readonly items?: JsonSchemaNode | readonly JsonSchemaNode[];
	readonly anyOf?: readonly JsonSchemaNode[];
	readonly oneOf?: readonly JsonSchemaNode[];
	readonly allOf?: readonly JsonSchemaNode[];
	readonly additionalProperties?: boolean | JsonSchemaNode;
	readonly $ref?: string;
	readonly [keyword: string]: unknown;
}

const COLON = /^[:：]/u;

function headingStart(line: string, heading: string): string | undefined {
	const label = heading.slice(0, -1);
	const trimmed = line.trimStart();
	if (!trimmed.startsWith(label)) return undefined;
	const rest = trimmed.slice(label.length);
	return COLON.test(rest) ? rest.slice(1) : undefined;
}

function headingOf(line: string): (typeof DESCRIPTION_HEADINGS)[number] | undefined {
	return DESCRIPTION_HEADINGS.find((heading) => headingStart(line, heading) !== undefined);
}

/** Checks the purpose sentence and the three heading lines, each with a non-empty body. */
function checkHeadings(description: string): DescriptionIssue[] {
	const issues: DescriptionIssue[] = [];
	const bodies = new Map<string, string[]>();
	const summary: string[] = [];
	let current: string | undefined;
	for (const line of description.split(/\r?\n/u)) {
		const heading = headingOf(line);
		if (heading !== undefined) {
			current = heading;
			bodies.set(heading, [headingStart(line, heading) ?? ""]);
		} else if (current === undefined) {
			summary.push(line);
		} else {
			bodies.get(current)?.push(line);
		}
	}
	if (summary.join("").trim() === "") {
		issues.push({
			code: "missing-summary",
			target: "description",
			message: "説明文の先頭に、ツールの用途を 1 文で書いてください。",
		});
	}
	for (const heading of DESCRIPTION_HEADINGS) {
		const body = bodies.get(heading);
		if (body === undefined) {
			issues.push({
				code: "missing-heading",
				target: heading,
				message: `説明文に「${heading}」で始まる行がありません。`,
			});
		} else if (body.join("").trim() === "") {
			issues.push({
				code: "empty-heading",
				target: heading,
				message: `説明文の「${heading}」の後ろに内容を書いてください。`,
			});
		}
	}
	return issues;
}

function childNodes(node: JsonSchemaNode): readonly JsonSchemaNode[] {
	return [...(node.anyOf ?? []), ...(node.oneOf ?? []), ...(node.allOf ?? [])];
}

/**
 * A node is described by its own description, or when every non-null member of its union is.
 * (`.nullable()` moves the description into the `anyOf` member that is not `null`.)
 */
function isDescribed(node: JsonSchemaNode): boolean {
	if (typeof node.description === "string" && node.description.trim() !== "") return true;
	const members = childNodes(node).filter((member) => member.type !== "null");
	return members.length > 0 && members.every(isDescribed);
}

/** Follows a local `$ref` (`#`, `#/a/b`); returns undefined for anything else. */
function resolveRef(root: JsonSchemaNode, ref: string): JsonSchemaNode | undefined {
	if (ref === "#") return root;
	if (!ref.startsWith("#/")) return undefined;
	let node: unknown = root;
	for (const part of ref.slice(2).split("/")) {
		const key = part.replaceAll("~1", "/").replaceAll("~0", "~");
		node =
			typeof node === "object" && node !== null
				? (node as Record<string, unknown>)[key]
				: undefined;
	}
	return typeof node === "object" && node !== null ? (node as JsonSchemaNode) : undefined;
}

function walk(
	root: JsonSchemaNode,
	node: JsonSchemaNode,
	path: string,
	acceptable: (name: string, child: JsonSchemaNode) => boolean,
	issues: DescriptionIssue[],
	followed: ReadonlySet<string> = new Set(),
): void {
	if (node.$ref !== undefined) {
		// A recursive schema points back to itself; follow each reference once per path.
		if (followed.has(node.$ref)) return;
		const target = resolveRef(root, node.$ref);
		if (target !== undefined) {
			walk(root, target, path, acceptable, issues, new Set([...followed, node.$ref]));
		}
		return;
	}
	for (const [name, child] of Object.entries(node.properties ?? {})) {
		const childPath = path === "" ? name : `${path}.${name}`;
		if (!acceptable(name, child)) {
			issues.push({
				code: "missing-field-description",
				target: childPath,
				message: `入力「${childPath}」の説明がありません。`,
			});
		}
		walk(root, child, childPath, acceptable, issues, followed);
	}
	if (typeof node.additionalProperties === "object") {
		walk(root, node.additionalProperties, `${path}{}`, acceptable, issues, followed);
	}
	const items = node.items;
	if (items !== undefined) {
		for (const item of Array.isArray(items) ? items : [items as JsonSchemaNode]) {
			walk(root, item, `${path}[]`, acceptable, issues, followed);
		}
	}
	for (const child of childNodes(node)) walk(root, child, path, acceptable, issues, followed);
}

/**
 * Checks a native tool: the description has a purpose sentence and the `使うとき:`、`使わないとき:`、
 * `例:` lines, and every input field has `.describe()` (CL-16, CL-18). Wrappers such as `.optional()`
 * are looked through because the check reads the JSON Schema the model receives.
 */
export function checkDescription(description: string, inputSchema: z.ZodType): DescriptionIssue[] {
	const issues = checkHeadings(description);
	let json: JsonSchemaNode;
	try {
		// The same options as the AI SDK, so a schema it cannot convert fails here, not on the request.
		json = z.toJSONSchema(inputSchema, {
			io: "input",
			target: "draft-7",
			reused: "inline",
		}) as JsonSchemaNode;
	} catch {
		issues.push({
			code: "unsendable-schema",
			target: "input",
			message:
				"入力スキーマを JSON Schema に変換できません（日付や関数などは文字列や数値で表してください）。",
		});
		return issues;
	}
	walk(json, json, "", (_name, child) => isDescribed(child), issues);
	return issues;
}

/** True when `name` appears as a whole word in `text` (not inside `valid` or `path`). */
function mentionsName(text: string, name: string): boolean {
	const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
	return new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`, "u").test(text);
}

/**
 * Checks an MCP tool, whose input is a JSON Schema. The heading rules are the same; an input
 * property passes when it has a `description` or its name appears in the tool description (CL-25).
 */
export function checkJsonSchemaDescription(
	description: string,
	inputSchema: JsonSchemaNode,
): DescriptionIssue[] {
	const issues = checkHeadings(description);
	walk(
		inputSchema,
		inputSchema,
		"",
		(name, child) => isDescribed(child) || mentionsName(description, name),
		issues,
	);
	return issues;
}
