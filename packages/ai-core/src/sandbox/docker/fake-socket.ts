import http from "node:http";
import { Duplex } from "node:stream";

// Test support: an `http.Agent` whose connections are in-memory streams, so the Docker Engine
// client is exercised through the real `node:http` without opening a socket (the hermetic test
// setup blocks every real connection). Not exported from `sandbox/index.ts`.

export interface FakeEngineRequest {
	readonly method: string;
	readonly path: string;
	readonly headers: Readonly<Record<string, string>>;
	readonly body: Buffer;
}

export interface FakeEngineResponse {
	readonly status: number;
	readonly body?: Uint8Array | string;
	readonly headers?: Readonly<Record<string, string>>;
	/** Accept the request and never answer at all (a daemon that hangs). */
	readonly silent?: boolean;
	/** Drop the connection instead of answering (a daemon that died mid-request). */
	readonly destroy?: boolean;
	/** Send the head and the body (if any) as a chunk, then keep the connection open and silent. */
	readonly hang?: boolean;
}

export type FakeEngineHandler = (
	request: FakeEngineRequest,
) => FakeEngineResponse | Promise<FakeEngineResponse>;

export interface FakeEngine {
	readonly agent: http.Agent;
	/** Every request received, in order. */
	readonly requests: readonly FakeEngineRequest[];
}

function parseRequest(raw: Buffer): FakeEngineRequest | undefined {
	const headEnd = raw.indexOf("\r\n\r\n");
	if (headEnd < 0) return undefined;
	const [requestLine = "", ...headerLines] = raw
		.subarray(0, headEnd)
		.toString("latin1")
		.split("\r\n");
	const [method = "", path = ""] = requestLine.split(" ");
	const headers: Record<string, string> = {};
	for (const line of headerLines) {
		const colon = line.indexOf(":");
		if (colon > 0) headers[line.slice(0, colon).toLowerCase()] = line.slice(colon + 1).trim();
	}
	const length = Number(headers["content-length"] ?? 0);
	const body = raw.subarray(headEnd + 4);
	if (body.length < length) return undefined;
	return { method, path, headers, body: body.subarray(0, length) };
}

/** Builds the in-memory engine. `handler` answers each request like the daemon would. */
export function createFakeEngine(handler: FakeEngineHandler): FakeEngine {
	const requests: FakeEngineRequest[] = [];

	class FakeAgent extends http.Agent {
		override createConnection(): Duplex {
			let received = Buffer.alloc(0);
			let answered = false;
			const socket = new Duplex({
				read() {},
				write(chunk: Buffer, _encoding, callback) {
					received = Buffer.concat([received, chunk]);
					callback();
					if (answered) return;
					const request = parseRequest(received);
					if (!request) return;
					answered = true;
					requests.push(request);
					void Promise.resolve(handler(request)).then((response) => {
						if (response.silent) return;
						if (response.destroy) {
							socket.destroy(new Error("connection reset by the fake daemon"));
							return;
						}
						const body = Buffer.from(response.body ?? "");
						const head = [
							`HTTP/1.1 ${response.status} Fake`,
							...(response.hang
								? ["Transfer-Encoding: chunked"]
								: [`Content-Length: ${body.length}`]),
							"Connection: close",
							...Object.entries(response.headers ?? {}).map(([name, value]) => `${name}: ${value}`),
							"",
							"",
						].join("\r\n");
						socket.push(Buffer.from(head, "latin1"));
						if (response.hang) {
							// A chunked body that never ends: the client must stop reading by itself.
							if (body.length > 0) {
								socket.push(
									Buffer.concat([
										Buffer.from(`${body.length.toString(16)}\r\n`),
										body,
										Buffer.from("\r\n"),
									]),
								);
							}
							return;
						}
						socket.push(body);
						socket.push(null);
					});
				},
			});
			// The members of `net.Socket` that `node:http` calls on a connection.
			Object.assign(socket, {
				setTimeout: () => socket,
				setNoDelay: () => socket,
				setKeepAlive: () => socket,
				ref: () => socket,
				unref: () => socket,
			});
			return socket;
		}
	}

	return { agent: new FakeAgent({ keepAlive: false }), requests };
}
