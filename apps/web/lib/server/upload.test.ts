import { describe, expect, it } from "vitest";
import { GuardError } from "./errors";
import { readUpload } from "./upload";

const SESSION = "11111111-2222-4333-8444-555555555555";
const MAX = 1000;
const OPTIONS = { maxBytes: MAX, extraBytes: 4096 };

function form(
	file: Uint8Array | string | undefined,
	fields: Record<string, string> = {},
): FormData {
	const data = new FormData();
	if (file !== undefined)
		data.append("file", new File([file as BlobPart], "sales.csv", { type: "text/csv" }));
	data.append("instruction", "月ごとの売上を集計してください");
	data.append("sessionId", SESSION);
	for (const [name, value] of Object.entries(fields)) data.append(name, value);
	return data;
}

function post(
	body: FormData | ReadableStream<Uint8Array> | string,
	headers: Record<string, string> = {},
): Request {
	return new Request("http://localhost/api/analysis", {
		method: "POST",
		body: body as BodyInit,
		headers,
		...(body instanceof ReadableStream ? { duplex: "half" } : {}),
	} as RequestInit);
}

async function rejection(promise: Promise<unknown>): Promise<GuardError> {
	const error = await promise.then(
		() => undefined,
		(caught: unknown) => caught,
	);
	expect(error).toBeInstanceOf(GuardError);
	return error as GuardError;
}

/** A body that yields `chunks` chunks of `size` bytes, counting how many were pulled. */
function countedStream(size: number, chunks: number, boundary: string) {
	const state = { pulled: 0, cancelled: false };
	const stream = new ReadableStream<Uint8Array>({
		pull(controller) {
			if (state.pulled >= chunks) {
				controller.close();
				return;
			}
			state.pulled += 1;
			controller.enqueue(new Uint8Array(size).fill(0x61));
		},
		cancel() {
			state.cancelled = true;
		},
	});
	return {
		stream,
		state,
		headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
	};
}

describe("readUpload: a valid upload", () => {
	it("returns the file as bytes with its name, and the fields", async () => {
		const bytes = new Uint8Array([0, 255, 10, 13, 65]);

		const upload = await readUpload(post(form(bytes, { modelId: "some-model" })), OPTIONS);

		expect(upload.file.name).toBe("sales.csv");
		expect(upload.file.bytes).toEqual(bytes);
		expect(upload).toMatchObject({
			instruction: "月ごとの売上を集計してください",
			sessionId: SESSION,
			modelId: "some-model",
		});
	});

	it("leaves modelId out when it was not sent", async () => {
		const upload = await readUpload(post(form("a,b\n")), OPTIONS);

		expect(upload).not.toHaveProperty("modelId");
	});
});

describe("readUpload: the size limit (413)", () => {
	it("accepts a file of exactly the limit and rejects one byte more", async () => {
		const exact = await readUpload(post(form(new Uint8Array(MAX).fill(0x61))), OPTIONS);
		const over = await rejection(
			readUpload(post(form(new Uint8Array(MAX + 1).fill(0x61))), OPTIONS),
		);

		expect(exact.file.bytes).toHaveLength(MAX);
		expect(over.code).toBe("payload-too-large");
		expect(over.message).toContain("大き");
	});

	it("accepts a file of exactly 20 MiB and rejects 20 MiB + 1 with the real limit", async () => {
		const limit = 20 * 1024 * 1024;
		const exact = await readUpload(post(form(new Uint8Array(limit).fill(0x61))), {
			maxBytes: limit,
		});
		const over = await rejection(
			readUpload(post(form(new Uint8Array(limit + 1).fill(0x61))), { maxBytes: limit }),
		);

		expect(exact.file.bytes).toHaveLength(limit);
		expect(over.code).toBe("payload-too-large");
	}, 30_000);

	it("rejects at once, without reading the body, when the declared length is over the limit", async () => {
		const { stream, state, headers } = countedStream(512, 100, "b");

		const error = await rejection(
			readUpload(
				post(stream, { ...headers, "content-length": String(MAX + OPTIONS.extraBytes + 1) }),
				OPTIONS,
			),
		);

		expect(error.code).toBe("payload-too-large");
		// A stream pre-fetches one chunk when it is made; the upload reader reads none.
		expect(state.pulled).toBeLessThanOrEqual(1);
		expect(state.cancelled).toBe(true);
	});

	it("stops reading a body larger than it declared, instead of trusting Content-Length", async () => {
		const { stream, state, headers } = countedStream(512, 10_000, "b");

		const error = await rejection(
			readUpload(post(stream, { ...headers, "content-length": "100" }), OPTIONS),
		);

		expect(error.code).toBe("payload-too-large");
		expect(state.cancelled).toBe(true);
		// The cap is 5096 bytes: about ten chunks of 512, and a couple more the stream pre-fetches.
		expect(state.pulled).toBeLessThan(20);
	});

	it("applies the same cap to a body with no declared length", async () => {
		const { stream, state, headers } = countedStream(512, 10_000, "b");

		const error = await rejection(readUpload(post(stream, headers), OPTIONS));

		expect(error.code).toBe("payload-too-large");
		expect(state.cancelled).toBe(true);
	});

	it("allows a body of exactly the cap, which then fails as a malformed form rather than as too large", async () => {
		const cap = OPTIONS.maxBytes + OPTIONS.extraBytes;
		const exact = countedStream(cap, 1, "b");
		const over = countedStream(cap + 1, 1, "b");

		const atCap = await rejection(
			readUpload(post(exact.stream, { ...exact.headers, "content-length": String(cap) }), OPTIONS),
		);
		const pastCap = await rejection(readUpload(post(over.stream, over.headers), OPTIONS));

		expect(atCap.code).toBe("invalid-request");
		expect(pastCap.code).toBe("payload-too-large");
	});

	it("ignores a Content-Length that is not a number and counts the bytes instead", async () => {
		const { stream, headers } = countedStream(512, 10_000, "b");

		const error = await rejection(
			readUpload(post(stream, { ...headers, "content-length": "lots" }), OPTIONS),
		);

		expect(error.code).toBe("payload-too-large");
	});
});

describe("readUpload: the shape of the form (400)", () => {
	it("rejects a body that is not multipart/form-data", async () => {
		const error = await rejection(
			readUpload(post("{}", { "content-type": "application/json" }), OPTIONS),
		);

		expect(error.code).toBe("invalid-request");
		expect(error.message).toContain("multipart/form-data");
	});

	it("rejects a multipart body that cannot be parsed", async () => {
		const error = await rejection(
			readUpload(
				post("--x\r\nbroken", { "content-type": "multipart/form-data; boundary=zzz" }),
				OPTIONS,
			),
		);

		expect(error.code).toBe("invalid-request");
	});

	it("rejects an empty body", async () => {
		const error = await rejection(
			readUpload(post("", { "content-type": "multipart/form-data; boundary=zzz" }), OPTIONS),
		);

		expect(error.code).toBe("invalid-request");
	});

	it("rejects a form with no file", async () => {
		const error = await rejection(readUpload(post(form(undefined)), OPTIONS));

		expect(error.code).toBe("invalid-request");
		expect(error.message).toContain("ファイル");
	});

	it("rejects a form with two files", async () => {
		const data = form("a\n");
		data.append("file", new File(["b\n"], "other.csv"));

		const error = await rejection(readUpload(post(data), OPTIONS));

		expect(error.code).toBe("invalid-request");
		expect(error.message).toContain("1 つ");
	});

	it.each(["instruction", "sessionId"])("rejects a form without %s", async (name) => {
		const data = new FormData();
		data.append("file", new File(["a\n"], "a.csv"));
		for (const field of ["instruction", "sessionId"]) {
			if (field !== name) data.append(field, field === "sessionId" ? SESSION : "指示");
		}

		const error = await rejection(readUpload(post(data), OPTIONS));

		expect(error.code).toBe("invalid-request");
		expect(error.message).toContain(name);
	});

	it("rejects a field it does not know", async () => {
		const error = await rejection(readUpload(post(form("a\n", { extra: "x" })), OPTIONS));

		expect(error.code).toBe("invalid-request");
	});

	it("rejects a file sent as plain text, and a text field sent as a file", async () => {
		const asText = new FormData();
		asText.append("file", "just text");
		asText.append("instruction", "指示");
		asText.append("sessionId", SESSION);
		const asFile = new FormData();
		asFile.append("file", new File(["a\n"], "a.csv"));
		asFile.append("instruction", new File(["指示"], "instruction.txt"));
		asFile.append("sessionId", SESSION);

		expect((await rejection(readUpload(post(asText), OPTIONS))).code).toBe("invalid-request");
		expect((await rejection(readUpload(post(asFile), OPTIONS))).code).toBe("invalid-request");
	});

	it("rejects a file with no name", async () => {
		const data = new FormData();
		data.append("file", new File(["a\n"], ""));
		data.append("instruction", "指示");
		data.append("sessionId", SESSION);

		const error = await rejection(readUpload(post(data), OPTIONS));

		expect(error.code).toBe("invalid-request");
	});

	it("rejects a second value for a text field", async () => {
		const data = form("a\n");
		data.append("instruction", "もう一つの指示");

		const error = await rejection(readUpload(post(data), OPTIONS));

		expect(error.code).toBe("invalid-request");
	});

	it("never puts what the client sent into a message", async () => {
		const data = form(undefined, { "evil-field-name<script>": "x" });

		const error = await rejection(readUpload(post(data), OPTIONS));

		expect(error.message).not.toContain("evil-field-name");
		expect(error.message).not.toContain("script");
	});
});
