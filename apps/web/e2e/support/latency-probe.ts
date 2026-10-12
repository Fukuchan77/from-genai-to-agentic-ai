import type { Page } from "@playwright/test";

// NFR-04 / plan C19: how long after the page received a response chunk the chunk is in the DOM.
//
// Two clocks in the page, both `performance.now()`, so no clock skew:
//   - receive: a `fetch` wrapper passes the `/api/` response body through and stamps every read of
//     the reader the app uses, i.e. the moment the chunk reaches the application;
//   - reflect: a `MutationObserver` stamps the first mutation after which the text of the `target`
//     element contains everything streamed so far. Mutation records are delivered as a microtask
//     after the DOM change, so the stamp is the commit time, not the paint time.
// Install it after `mockApi` (which also wraps `fetch`), so the probe observes the shaped stream.

const STATE_KEY = "__latencyProbe";

export interface LatencyProbeOptions {
	/**
	 * CSS selector of the element whose text should contain the streamed text. When several
	 * elements match, the last one is used, so a repeated answer is not satisfied by an earlier one.
	 */
	readonly target: string;
	/** `type` of the stream events that carry text. Default `text-delta`. */
	readonly deltaType?: string;
}

export interface ChunkLatency {
	/** Position among the chunks seen since the page loaded. */
	readonly index: number;
	readonly text: string;
	/** `performance.now()` when the chunk reached the app. */
	readonly receivedAt: number;
	/** `performance.now()` when the DOM contained the chunk's text; null if it never did. */
	readonly reflectedAt: number | null;
	readonly latencyMs: number | null;
}

interface ProbeConfig {
	readonly stateKey: string;
	readonly target: string;
	readonly deltaType: string;
}

interface ProbeRecord {
	text: string;
	cumulative: string;
	receivedAt: number;
	reflectedAt: number | null;
}

/** Runs in the page before any script. Self-contained: no closure over the test's scope. */
function installProbe({ stateKey, target, deltaType }: ProbeConfig): void {
	const records: ProbeRecord[] = [];
	Object.defineProperty(window, stateKey, { value: records });
	const decoder = new TextDecoder();
	const nextFetch = window.fetch.bind(window);

	const reflect = () => {
		const elements = document.querySelectorAll(target);
		const text = elements.item(elements.length - 1)?.textContent ?? "";
		const now = performance.now();
		for (const record of records) {
			if (record.reflectedAt === null && text.includes(record.cumulative)) {
				record.reflectedAt = now;
			}
		}
	};
	new MutationObserver(reflect).observe(document, {
		subtree: true,
		childList: true,
		characterData: true,
	});

	window.fetch = async (input, init) => {
		const response = await nextFetch(input, init);
		const url = input instanceof Request ? input.url : String(input);
		if (!new URL(url, location.href).pathname.startsWith("/api/") || response.body === null) {
			return response;
		}
		const reader = response.body.getReader();
		let buffer = "";
		let cumulative = "";
		// Read eagerly, not on the app's demand: a chunk is stamped when it arrives, so time it then
		// waits for a busy main thread counts as delay instead of hiding behind back-pressure.
		const stream = new ReadableStream<Uint8Array>({
			async start(controller) {
				try {
					for (;;) {
						const { done, value } = await reader.read();
						if (done) break;
						const receivedAt = performance.now();
						buffer += decoder.decode(value, { stream: true });
						for (let end = buffer.indexOf("\n\n"); end >= 0; end = buffer.indexOf("\n\n")) {
							const block = buffer.slice(0, end).trim();
							buffer = buffer.slice(end + 2);
							if (!block.startsWith("data:") || block.endsWith("[DONE]")) continue;
							try {
								const event = JSON.parse(block.slice("data:".length)) as {
									type?: string;
									delta?: string;
								};
								if (
									event.type === deltaType &&
									typeof event.delta === "string" &&
									event.delta !== ""
								) {
									cumulative += event.delta;
									records.push({ text: event.delta, cumulative, receivedAt, reflectedAt: null });
								}
							} catch {
								// Not a JSON event: nothing to measure.
							}
						}
						controller.enqueue(value);
					}
					controller.close();
				} catch (error) {
					controller.error(error);
				}
			},
			cancel(reason) {
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

export async function installLatencyProbe(page: Page, options: LatencyProbeOptions): Promise<void> {
	await page.addInitScript(installProbe, {
		stateKey: STATE_KEY,
		target: options.target,
		deltaType: options.deltaType ?? "text-delta",
	});
}

/** The chunks measured so far. A chunk whose text never reached the DOM has `null` latency. */
export async function readLatencies(page: Page): Promise<ChunkLatency[]> {
	const records = await page.evaluate(
		(key) => (window as never as Record<string, ProbeRecord[]>)[key] ?? [],
		STATE_KEY,
	);
	return records.map((record, index) => ({
		index,
		text: record.text,
		receivedAt: record.receivedAt,
		reflectedAt: record.reflectedAt,
		latencyMs: record.reflectedAt === null ? null : record.reflectedAt - record.receivedAt,
	}));
}
