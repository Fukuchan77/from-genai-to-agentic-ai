import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page, Route } from "@playwright/test";

// Plan C19: `page.route("/api/**")` serves the generated `e2e/fixtures/*.sse` streams (never
// written by hand: `mise run e2e:fixtures`) and JSON error bodies in the shape of `toErrorResponse`.
//
// `route.fulfill` delivers a body at once, so a stream's timing is shaped in the page: the reply
// carries its `StreamPlan` in a header and a small `fetch` wrapper (installed by `mockApi`) re-emits
// the body one event at a time, with a pause between events and/or held open after a given event
// until the test calls `release()`. `installLatencyProbe` must be installed after `mockApi`, so it
// observes the stream the page actually reads.

const FIXTURE_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures");

export const FIXTURE_NAMES = [
	"chat-greeting",
	"agent-weather",
	"summarize-transcript",
	"summarize-article",
	"rag-query",
	"rag-query-no-evidence",
	"rag-agent-search",
	"rag-agent-no-search",
	"helpdesk",
	"analysis",
	"analysis-attempt-limit",
	"research",
	"research-partial",
	"requirements",
	"marketing-council",
	"marketing-recommend",
	"mcp-chat",
	"mcp-chat-error",
] as const;
export type FixtureName = (typeof FIXTURE_NAMES)[number];

/** Generated JSON bodies (`e2e/fixtures/*.json`), the counterpart of the streams above. */
export const JSON_FIXTURE_NAMES = [
	"workflows-evaluator-optimizer",
	"mcp-servers",
	"mcp-compare",
	"analysis-status",
	"helpdesk-tickets",
	"requirements-session",
] as const;
export type JsonFixtureName = (typeof JSON_FIXTURE_NAMES)[number];

export type ApiPath =
	| "/api/chat"
	| "/api/agent/tools"
	| "/api/summarize"
	| "/api/rag/knowledge"
	| "/api/rag/ingest"
	| "/api/rag/query"
	| "/api/rag/agent"
	| "/api/workflows"
	| "/api/helpdesk"
	| "/api/helpdesk/tickets"
	| "/api/helpdesk/tickets/[id]"
	| "/api/analysis"
	| "/api/analysis/status"
	| "/api/analysis/sessions/[id]"
	| "/api/research"
	| "/api/requirements/sessions"
	| "/api/requirements/sessions/[id]/messages"
	| "/api/requirements/sessions/[id]/document"
	| "/api/marketing/council"
	| "/api/marketing/recommend"
	| "/api/mcp/servers"
	| "/api/mcp/compare"
	| "/api/mcp/chat";

// A path with a dynamic segment is configured under its `[id]` form; the request's real path is
// matched exactly first (so a test can still single out one id), then in this normalised form.
const DYNAMIC_PATHS: readonly (readonly [RegExp, string])[] = [
	[
		/^\/api\/requirements\/sessions\/[^/]+\/(messages|document)$/,
		"/api/requirements/sessions/[id]/$1",
	],
	[/^\/api\/analysis\/sessions\/[^/]+$/, "/api/analysis/sessions/[id]"],
	[/^\/api\/helpdesk\/tickets\/[^/]+$/, "/api/helpdesk/tickets/[id]"],
];

/** The `ApiPath` form of a request path: the id segment of a dynamic route becomes `[id]`. */
export function normalizeApiPath(pathname: string): string {
	for (const [pattern, template] of DYNAMIC_PATHS) {
		if (pattern.test(pathname)) return pathname.replace(pattern, template);
	}
	return pathname;
}

/** One parsed `data: {...}` event of a UI message stream (`[DONE]` is added back on serialising). */
export interface SseEvent {
	readonly type: string;
	readonly id?: string;
	readonly delta?: string;
	readonly data?: unknown;
	readonly toolCallId?: string;
	readonly output?: unknown;
	readonly errorText?: string;
	readonly [key: string]: unknown;
}

const PLAN_HEADER = "x-mock-api-plan";
const STATE_KEY = "__mockApi";

export interface StreamPlan {
	/** Pause between events in milliseconds. Default 0: the events follow each other at once. */
	readonly paceMs?: number;
	/** Keep the stream open after the `count`th (default 1st) event of `type`, until `release()`. */
	readonly holdAfter?: { readonly type: string; readonly count?: number };
}

export type Reply =
	| {
			readonly kind: "stream";
			readonly fixture: FixtureName;
			readonly transform?: (events: readonly SseEvent[]) => readonly SseEvent[];
			readonly plan: StreamPlan;
	  }
	| { readonly kind: "json"; readonly status: number; readonly body: unknown }
	| {
			readonly kind: "error";
			readonly status: number;
			readonly error: {
				readonly code: string;
				readonly message: string;
				readonly details?: Readonly<Record<string, unknown>>;
			};
	  };

export interface StreamReplyOptions extends StreamPlan {
	/** Derives a variant of the generated stream (e.g. a failed tool result) in the test. */
	readonly transform?: (events: readonly SseEvent[]) => readonly SseEvent[];
}

/** Reply with a generated fixture stream, optionally transformed and/or shaped in time. */
export function streamReply(fixture: FixtureName, options: StreamReplyOptions = {}): Reply {
	const { transform, ...plan } = options;
	return { kind: "stream", fixture, plan, ...(transform ? { transform } : {}) };
}

/**
 * Reply with a JSON body. A generated fixture name loads `e2e/fixtures/<name>.json` (never written
 * by hand); any other value is used as the body as it is, for the small state replies (the
 * knowledge-base listing, an ingest result) whose shapes the screens already type.
 */
export function jsonReply(body: JsonFixtureName | unknown, status = 200): Reply {
	const loaded =
		typeof body === "string" && (JSON_FIXTURE_NAMES as readonly string[]).includes(body)
			? loadJsonFixture(body as JsonFixtureName)
			: body;
	return { kind: "json", status, body: loaded };
}

/** Reply with a failure before the stream starts: `{ error: { code, message } }` and a status. */
export function errorReply(
	status: number,
	error: Extract<Reply, { kind: "error" }>["error"],
): Reply {
	return { kind: "error", status, error };
}

export function parseSse(text: string): SseEvent[] {
	const events: SseEvent[] = [];
	for (const block of text.split("\n\n")) {
		const line = block.trim();
		if (!line.startsWith("data:")) continue;
		const payload = line.slice("data:".length).trim();
		if (payload === "[DONE]") continue;
		const event: unknown = JSON.parse(payload);
		if (
			typeof event !== "object" ||
			event === null ||
			typeof (event as { type?: unknown }).type !== "string"
		) {
			throw new Error(`SSE event without a type: ${payload}`);
		}
		events.push(event as SseEvent);
	}
	return events;
}

export function serializeSse(events: readonly SseEvent[]): string {
	return `${[...events.map((event) => `data: ${JSON.stringify(event)}`), "data: [DONE]"].join("\n\n")}\n\n`;
}

/** The events of a generated fixture. A missing or empty fixture fails the spec. */
export function loadFixture(name: FixtureName): SseEvent[] {
	const events = parseSse(readFileSync(path.join(FIXTURE_DIRECTORY, `${name}.sse`), "utf8"));
	if (events.length === 0)
		throw new Error(`${name}.sse has no events; run \`mise run e2e:fixtures\``);
	return events;
}

/** The body of a generated JSON fixture. A missing or empty fixture fails the spec. */
export function loadJsonFixture(name: JsonFixtureName): unknown {
	const text = readFileSync(path.join(FIXTURE_DIRECTORY, `${name}.json`), "utf8");
	if (text.trim() === "") throw new Error(`${name}.json is empty; run \`mise run e2e:fixtures\``);
	return JSON.parse(text);
}

/** Replaces every event of `type`; fails when there is none, so a changed fixture is noticed. */
export function mapEvents(
	events: readonly SseEvent[],
	type: string,
	replace: (event: SseEvent) => SseEvent,
): SseEvent[] {
	if (!events.some((event) => event.type === type)) {
		throw new Error(`the stream has no "${type}" event to replace`);
	}
	return events.map((event) => (event.type === type ? replace(event) : event));
}

export interface RecordedRequest {
	/** The path as requested, e.g. `/api/helpdesk/tickets/T-0001`. */
	readonly path: string;
	/** The `ApiPath` it matched, e.g. `/api/helpdesk/tickets/[id]`. */
	readonly route: string;
	/** Parsed JSON; the raw text for a body that is not JSON (a multipart upload); null if none. */
	readonly body: unknown;
}

/** The text value of a field in a recorded multipart body (`undefined` when it is not there). */
export function multipartField(body: unknown, name: string): string | undefined {
	if (typeof body !== "string") return undefined;
	const pattern = new RegExp(
		`name="${name}"(?:; filename="[^"]*")?\\r?\\n(?:[^\\r\\n]+\\r?\\n)*\\r?\\n`,
	);
	const match = pattern.exec(body);
	if (match === null) return undefined;
	const rest = body.slice(match.index + match[0].length);
	const end = rest.search(/\r?\n--/);
	return end < 0 ? rest : rest.slice(0, end);
}

export interface MockApi {
	/** The requests that reached the mocked routes, in order. */
	readonly requests: readonly RecordedRequest[];
	/** Resolves when a stream is held open by its `holdAfter`. */
	waitUntilHeld(): Promise<void>;
	/** Lets a held stream continue. */
	release(): Promise<void>;
}

/** Installed in the page before any script: applies the plan of a mocked stream. */
function installStreamShaper({
	planHeader,
	stateKey,
}: {
	planHeader: string;
	stateKey: string;
}): void {
	const state = { held: false, release: () => {} };
	Object.defineProperty(window, stateKey, { value: state });
	const nativeFetch = window.fetch.bind(window);

	window.fetch = async (input, init) => {
		const response = await nativeFetch(input, init);
		const planText = response.headers.get(planHeader);
		if (planText === null || response.body === null) return response;
		const plan = JSON.parse(planText) as {
			paceMs?: number;
			holdAfter?: { type: string; count?: number };
		};
		const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		const encoder = new TextEncoder();
		const counts = new Map<string, number>();
		let buffer = "";
		let emitted = 0;
		let holdNext = false;

		const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
		const typeOf = (block: string): string => {
			try {
				return String(JSON.parse(block.replace(/^data:\s*/, "")).type);
			} catch {
				return "";
			}
		};

		const stream = new ReadableStream<Uint8Array>({
			async pull(controller) {
				if (holdNext) {
					holdNext = false;
					state.held = true;
					await new Promise<void>((resolve) => {
						state.release = resolve;
						signal?.addEventListener("abort", () => resolve(), { once: true });
					});
					state.held = false;
				}
				if (signal?.aborted) {
					controller.error(new DOMException("The operation was aborted.", "AbortError"));
					return;
				}
				let separator = buffer.indexOf("\n\n");
				while (separator < 0) {
					const { done, value } = await reader.read();
					if (done) {
						if (buffer.trim() !== "") controller.enqueue(encoder.encode(buffer));
						buffer = "";
						controller.close();
						return;
					}
					buffer += decoder.decode(value, { stream: true });
					separator = buffer.indexOf("\n\n");
				}
				const block = buffer.slice(0, separator);
				buffer = buffer.slice(separator + 2);
				if (emitted > 0 && plan.paceMs) await sleep(plan.paceMs);
				if (signal?.aborted) {
					controller.error(new DOMException("The operation was aborted.", "AbortError"));
					return;
				}
				emitted += 1;
				controller.enqueue(encoder.encode(`${block}\n\n`));
				const type = typeOf(block);
				counts.set(type, (counts.get(type) ?? 0) + 1);
				if (plan.holdAfter?.type === type && counts.get(type) === (plan.holdAfter.count ?? 1)) {
					holdNext = true;
				}
			},
			cancel(reason) {
				state.release();
				return reader.cancel(reason);
			},
		});
		return new Response(stream, {
			status: response.status,
			statusText: response.statusText,
			headers: response.headers,
		});
	};
}

function jsonBody(route: Route): unknown {
	const request = route.request();
	let text: string | null = null;
	try {
		text = request.postData();
	} catch {
		// A binary body has no text form; fall through to the buffer.
	}
	if (text === null) {
		const buffer = request.postDataBuffer();
		if (buffer === null) return null;
		text = buffer.toString("utf8");
	}
	if ((request.headers()["content-type"] ?? "").includes("multipart/form-data")) return text;
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

/**
 * Serves the replies for the given API paths and records the requests. A path may take a list:
 * the nth request gets the nth reply, and the last one repeats. A request to any other `/api/**`
 * path fails the request with a 501 so an unplanned call cannot go unnoticed.
 */
export async function mockApi(
	page: Page,
	replies: Partial<Record<ApiPath, Reply | readonly Reply[]>>,
): Promise<MockApi> {
	const requests: RecordedRequest[] = [];
	const seen = new Map<string, number>();
	await page.addInitScript(installStreamShaper, { planHeader: PLAN_HEADER, stateKey: STATE_KEY });
	await page.route("/api/**", async (route) => {
		const { pathname } = new URL(route.request().url());
		const table = replies as Record<string, Reply | readonly Reply[] | undefined>;
		const key = table[pathname] !== undefined ? pathname : normalizeApiPath(pathname);
		const configured = table[key];
		if (configured === undefined) {
			await route.fulfill({ status: 501, body: `unmocked API path: ${pathname}` });
			return;
		}
		requests.push({ path: pathname, route: key, body: jsonBody(route) });
		const list = Array.isArray(configured) ? configured : [configured];
		const index = seen.get(key) ?? 0;
		seen.set(key, index + 1);
		const reply = list[Math.min(index, list.length - 1)] as Reply;
		if (reply.kind === "json") {
			await route.fulfill({
				status: reply.status,
				contentType: "application/json; charset=utf-8",
				body: JSON.stringify(reply.body),
			});
			return;
		}
		if (reply.kind === "error") {
			await route.fulfill({
				status: reply.status,
				contentType: "application/json; charset=utf-8",
				body: JSON.stringify({ error: reply.error }),
			});
			return;
		}
		const events = loadFixture(reply.fixture);
		await route.fulfill({
			status: 200,
			headers: {
				"content-type": "text/event-stream",
				"cache-control": "no-cache",
				"x-vercel-ai-ui-message-stream": "v1",
				[PLAN_HEADER]: JSON.stringify(reply.plan),
			},
			body: serializeSse(reply.transform ? reply.transform(events) : events),
		});
	});
	return {
		requests,
		async waitUntilHeld() {
			await page.waitForFunction(
				(key) => (window as never as Record<string, { held: boolean }>)[key]?.held === true,
				STATE_KEY,
			);
		},
		async release() {
			await page.evaluate(
				(key) => (window as never as Record<string, { release(): void }>)[key]?.release(),
				STATE_KEY,
			);
		},
	};
}

export interface AlternativeModel {
	readonly id: string;
	readonly displayName: string;
}

/**
 * Mock mode lists a single chat model, so a model switch cannot happen with the real list. This
 * adds a copy of that model, under another id and name, to the model list the server rendered into
 * the page `pagePath`, by rewriting the document in flight. It fails if the list is not found, so
 * a change in how Next.js embeds props shows up as a failing spec and not as a silent no-op.
 */
export async function offerAlternativeModel(
	page: Page,
	pagePath: string,
	model: AlternativeModel,
): Promise<void> {
	await page.route(`**${pagePath}`, async (route) => {
		if (route.request().resourceType() !== "document") {
			await route.fallback();
			return;
		}
		const response = await route.fetch();
		const html = await response.text();
		// The props travel inside a JS string of the flight payload, so quotes are escaped (`\"`).
		const pattern =
			/\{\\"id\\":\\"mock:general-v1\\",\\"displayName\\":\\"[^"\\]*\\".*?\\"contextWindow\\":\d+\}/;
		const original = pattern.exec(html)?.[0];
		if (original === undefined) {
			throw new Error(`no mock:general-v1 entry in the model list of ${pagePath}`);
		}
		const copy = original
			.replace("mock:general-v1", model.id)
			.replace(/\\"displayName\\":\\"[^"\\]*\\"/, `\\"displayName\\":\\"${model.displayName}\\"`);
		// `fetch` decoded the body, so the encoding and length headers no longer describe it.
		const {
			"content-encoding": _encoding,
			"content-length": _length,
			...headers
		} = response.headers();
		await route.fulfill({
			status: response.status(),
			headers,
			body: html.replace(original, `${original},${copy}`),
		});
	});
}
