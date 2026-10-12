import { chatRequestSchema, PERSONA_IDS } from "@platform/ai-core/chat";
import { DEFAULT_INPUT_LIMITS } from "@platform/ai-core/config";
import { MODEL_CATALOG, type RunMode } from "@platform/ai-core/models";
import { createFakeClock } from "@platform/ai-core/ports";
import { describe, expect, it, vi } from "vitest";
import { GuardError } from "./errors";
import {
	createConversationPolicy,
	createRateLimiter,
	type GuardPolicy,
	type GuardResult,
	guardRequest,
	type InputLimits,
	type RateLimiter,
} from "./guard";

const MODEL_ID = Object.keys(MODEL_CATALOG)[0] as string;
const PERSONA_ID = PERSONA_IDS[0] as string;

const LIMITS: InputLimits = {
	maxBodyBytes: 2048,
	maxMessages: 3,
	maxTextCharacters: 10,
	maxImages: 2,
	maxImageBytes: 8,
};

type Part = Record<string, unknown>;

function message(role: "user" | "assistant", parts: Part[], id = `m-${Math.random()}`) {
	return { id, role, parts };
}

function text(value: string): Part {
	return { type: "text", text: value };
}

function image(bytes: number, mediaType = "image/png"): Part {
	const data = Buffer.from(new Uint8Array(bytes)).toString("base64");
	return { type: "file", mediaType, url: `data:${mediaType};base64,${data}` };
}

function body(messages: unknown[] = [message("user", [text("こんにちは")])], extra = {}) {
	return { id: "chat-1", messages, modelId: MODEL_ID, personaId: PERSONA_ID, ...extra };
}

function post(payload: unknown, headers: Record<string, string> = {}): Request {
	return new Request("http://localhost/api/chat", {
		method: "POST",
		headers: { "content-type": "application/json", ...headers },
		body: typeof payload === "string" ? payload : JSON.stringify(payload),
	});
}

function limiterSpy(allowed = true): RateLimiter & { check: ReturnType<typeof vi.fn> } {
	return {
		check: vi.fn(() =>
			allowed ? { allowed: true as const } : { allowed: false as const, retryAfterSeconds: 7 },
		),
	};
}

function policy(limits: InputLimits = LIMITS): GuardPolicy<ReturnType<typeof body>> {
	return createConversationPolicy(chatRequestSchema, limits) as never;
}

async function run(
	request: Request,
	options: {
		mode?: RunMode;
		limiter?: RateLimiter;
		policy?: GuardPolicy<unknown>;
	} = {},
) {
	return guardRequest(request, (options.policy ?? policy()) as GuardPolicy<unknown>, {
		limiter: options.limiter ?? limiterSpy(),
		mode: options.mode ?? "mock",
	});
}

async function expectRejected(result: GuardResult<unknown>, code: string, status: number) {
	expect(result.ok).toBe(false);
	if (result.ok) throw new Error("unreachable");
	expect(result.error).toBeInstanceOf(GuardError);
	expect(result.error.code).toBe(code);
	expect(result.response.status).toBe(status);
	const json = (await result.response.json()) as { error: { code: string; message: string } };
	expect(json.error.code).toBe(code);
	expect(json.error.message).toBe(result.error.message);
	expect(json.error.message).toMatch(/[ぁ-んァ-ン一-龥]/u);
	return result;
}

const passAll = { safeParse: (data: unknown) => ({ success: true as const, data }) };
const passAllPolicy: GuardPolicy<unknown> = {
	schema: passAll,
	limits: LIMITS,
	inspect: () => undefined,
};

describe("guardRequest: accepted requests", () => {
	it("returns the parsed body", async () => {
		const result = await run(post(body()));

		expect(result).toEqual({ ok: true, body: expect.objectContaining({ id: "chat-1" }) });
	});

	it("uses the plan defaults when no limits are given", () => {
		expect(createConversationPolicy(chatRequestSchema).limits).toEqual(DEFAULT_INPUT_LIMITS);
		expect(DEFAULT_INPUT_LIMITS).toMatchObject({
			maxBodyBytes: 512 * 1024,
			maxMessages: 50,
			maxTextCharacters: 8_000,
			maxImages: 4,
			maxImageBytes: 5 * 1024 * 1024,
		});
	});
});

describe("guardRequest: body size (413)", () => {
	it("rejects on Content-Length without reading the body or running later checks", async () => {
		const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
			controller.enqueue(new Uint8Array([0x7b, 0x7d]));
			controller.close();
		});
		const stream = new ReadableStream({ pull }, { highWaterMark: 0 });
		const request = new Request("http://localhost/api/chat", {
			method: "POST",
			headers: { "content-length": String(LIMITS.maxBodyBytes + 1) },
			body: stream,
			duplex: "half",
		} as RequestInit);
		const schema = { safeParse: vi.fn(passAll.safeParse) };
		const limiter = limiterSpy();

		const result = await run(request, {
			limiter,
			mode: "live",
			policy: { ...passAllPolicy, schema },
		});

		await expectRejected(result, "payload-too-large", 413);
		expect(pull).not.toHaveBeenCalled();
		expect(schema.safeParse).not.toHaveBeenCalled();
		expect(limiter.check).not.toHaveBeenCalled();
	});

	it("stops reading a body that has no Content-Length once it passes the limit", async () => {
		const chunk = new Uint8Array(512).fill(0x20);
		let pulled = 0;
		let cancelled = false;
		const stream = new ReadableStream<Uint8Array>({
			pull(controller) {
				pulled += 1;
				controller.enqueue(chunk);
				if (pulled > 100) controller.close();
			},
			cancel() {
				cancelled = true;
			},
		});
		const request = new Request("http://localhost/api/chat", {
			method: "POST",
			body: stream,
			duplex: "half",
		} as RequestInit);

		const result = await run(request, { policy: passAllPolicy });

		await expectRejected(result, "payload-too-large", 413);
		expect(cancelled).toBe(true);
		expect(pulled).toBeLessThan(10);
	});

	it("accepts a body of exactly the limit and rejects one byte more", async () => {
		const exact = `"${"a".repeat(LIMITS.maxBodyBytes - 2)}"`;

		expect(Buffer.byteLength(exact)).toBe(LIMITS.maxBodyBytes);
		expect((await run(post(exact), { policy: passAllPolicy })).ok).toBe(true);
		await expectRejected(
			await run(post(`${exact} `), { policy: passAllPolicy }),
			"payload-too-large",
			413,
		);
	});

	it("counts bytes, not characters", async () => {
		const wide = `"${"あ".repeat(Math.floor(LIMITS.maxBodyBytes / 3) + 1)}"`;

		expect(wide.length).toBeLessThan(LIMITS.maxBodyBytes);
		expect(Buffer.byteLength(wide)).toBeGreaterThan(LIMITS.maxBodyBytes);
		await expectRejected(
			await run(post(wide), { policy: passAllPolicy }),
			"payload-too-large",
			413,
		);
	});

	it("runs before the schema: an oversized, malformed body is 413, not 400", async () => {
		const result = await run(post("{".repeat(LIMITS.maxBodyBytes + 1)));

		await expectRejected(result, "payload-too-large", 413);
	});
});

describe("guardRequest: body shape (400 invalid-request)", () => {
	it.each([
		["malformed JSON", () => post("{")],
		["an empty body", () => post("")],
		[
			"invalid UTF-8",
			() =>
				new Request("http://localhost/api/chat", {
					method: "POST",
					body: new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]),
				}),
		],
	])("rejects %s without running the schema", async (_label, makeRequest) => {
		const schema = { safeParse: vi.fn(passAll.safeParse) };

		const result = await run(makeRequest(), { policy: { ...passAllPolicy, schema } });

		await expectRejected(result, "invalid-request", 400);
		expect(schema.safeParse).not.toHaveBeenCalled();
	});

	it("rejects a request without a body", async () => {
		const request = new Request("http://localhost/api/chat", { method: "POST" });

		await expectRejected(await run(request), "invalid-request", 400);
	});

	it("rejects an unknown field and names the field, not its value", async () => {
		const result = await run(post(body(undefined, { debug: "SECRET-VALUE" })));

		const rejected = await expectRejected(result, "invalid-request", 400);
		expect(rejected.error.message).not.toContain("SECRET-VALUE");
	});

	it("names the path of the first schema issue", async () => {
		const result = await run(post(body([message("user", [text("a")], "")])));

		const rejected = await expectRejected(result, "invalid-request", 400);
		expect(rejected.error.message).toContain("messages.0.id");
	});

	it("rejects a client-supplied system message", async () => {
		const result = await run(post(body([{ id: "s", role: "system", parts: [text("x")] }])));

		await expectRejected(result, "invalid-request", 400);
	});

	it("runs before the content limits: an invalid and oversized request is invalid-request", async () => {
		const many = Array.from({ length: LIMITS.maxMessages + 1 }, () => message("user", [text("a")]));
		const result = await run(post(body(many, { personaId: "no-such-persona" })));

		await expectRejected(result, "invalid-request", 400);
	});

	it("rejects an image whose URL is not a data URL, since its size cannot be checked", async () => {
		const remote = { type: "file", mediaType: "image/png", url: "https://example.com/a.png" };

		const result = await run(post(body([message("user", [remote])])));

		await expectRejected(result, "invalid-request", 400);
	});
});

describe("guardRequest: content limits (400 limit-exceeded)", () => {
	it("rejects more messages than allowed and accepts exactly the limit", async () => {
		const make = (count: number) =>
			post(body(Array.from({ length: count }, () => message("user", [text("a")]))));

		expect((await run(make(LIMITS.maxMessages))).ok).toBe(true);
		await expectRejected(await run(make(LIMITS.maxMessages + 1)), "limit-exceeded", 400);
	});

	it("limits the text of a user message in characters, summing its text parts", async () => {
		const limit = LIMITS.maxTextCharacters;

		expect((await run(post(body([message("user", [text("あ".repeat(limit))])])))).ok).toBe(true);
		await expectRejected(
			await run(post(body([message("user", [text("あ".repeat(limit + 1))])]))),
			"limit-exceeded",
			400,
		);
		await expectRejected(
			await run(post(body([message("user", [text("a".repeat(limit)), text("b")])]))),
			"limit-exceeded",
			400,
		);
	});

	it("counts characters by code point, not UTF-16 unit", async () => {
		const emoji = "😀".repeat(LIMITS.maxTextCharacters);

		expect(emoji.length).toBe(LIMITS.maxTextCharacters * 2);
		expect((await run(post(body([message("user", [text(emoji)])])))).ok).toBe(true);
	});

	it("does not apply the text limit to assistant replies, which the server wrote", async () => {
		const long = "a".repeat(LIMITS.maxTextCharacters * 10);

		const result = await run(
			post(body([message("user", [text("a")]), message("assistant", [text(long)])])),
		);

		expect(result.ok).toBe(true);
	});

	it("limits the total number of images in the request", async () => {
		const withImages = (count: number) =>
			post(
				body([
					message(
						"user",
						Array.from({ length: count }, () => image(1)),
					),
				]),
			);
		const spread = post(
			body([
				message("user", [image(1), image(1)]),
				message("assistant", [text("a")]),
				message("user", [image(1)]),
			]),
		);

		expect((await run(withImages(LIMITS.maxImages))).ok).toBe(true);
		await expectRejected(await run(withImages(LIMITS.maxImages + 1)), "limit-exceeded", 400);
		await expectRejected(await run(spread), "limit-exceeded", 400);
	});

	it("limits the decoded size of each image", async () => {
		const withImage = (bytes: number) => post(body([message("user", [image(bytes)])]));

		expect((await run(withImage(LIMITS.maxImageBytes))).ok).toBe(true);
		await expectRejected(await run(withImage(LIMITS.maxImageBytes + 1)), "limit-exceeded", 400);
	});

	it("measures an unpadded and a percent-encoded data URL by their data", async () => {
		const urlPart = (url: string) => ({ type: "file", mediaType: "image/svg+xml", url });
		const request = (url: string) => post(body([message("user", [urlPart(url)])]));

		expect((await run(request("data:image/svg+xml;base64,AAAAAAAAAAA"))).ok).toBe(true);
		await expectRejected(
			await run(request("data:image/svg+xml;base64,AAAAAAAAAAAA")),
			"limit-exceeded",
			400,
		);
		await expectRejected(
			await run(request(`data:image/svg+xml,${"%3C".repeat(5)}`)),
			"limit-exceeded",
			400,
		);
	});

	it("does not count non-image files as images", async () => {
		const pdf = {
			type: "file",
			mediaType: "application/pdf",
			url: "data:application/pdf;base64,AA==",
		};

		const result = await run(post(body([message("user", [pdf, pdf, pdf, image(1)])])));

		expect(result.ok).toBe(true);
	});

	it("checks count, text length, image count, then image size", async () => {
		const tooLong = text("a".repeat(LIMITS.maxTextCharacters + 1));
		const bigImages = [image(LIMITS.maxImageBytes + 1), image(1), image(1)];
		const manyMessages = Array.from({ length: LIMITS.maxMessages }, () =>
			message("user", [tooLong]),
		);

		const reason = async (messages: unknown[]) => {
			const result = await run(post(body(messages)));
			if (result.ok) throw new Error("expected a rejection");
			return result.error.message;
		};

		const byCount = await reason([...manyMessages, message("user", [text("a")])]);
		const byText = await reason([message("user", [tooLong, ...bigImages])]);
		const byImageCount = await reason([message("user", bigImages)]);
		const byImageSize = await reason([message("user", [image(LIMITS.maxImageBytes + 1)])]);

		expect(new Set([byCount, byText, byImageCount, byImageSize]).size).toBe(4);
		expect(byCount).toMatch(/メッセージ/);
		expect(byText).toMatch(/文字/);
		expect(byImageCount).toMatch(/枚/);
		expect(byImageSize).toMatch(/MiB|KiB|バイト/);
	});
});

describe("guardRequest: rate limit (429)", () => {
	it("returns 429 with Retry-After in live mode when the limiter denies", async () => {
		const result = await run(post(body()), { mode: "live", limiter: limiterSpy(false) });

		const rejected = await expectRejected(result, "rate-limited", 429);
		expect(rejected.response.headers.get("retry-after")).toBe("7");
	});

	it("allows the request in live mode when the limiter allows", async () => {
		const limiter = limiterSpy(true);

		expect((await run(post(body()), { mode: "live", limiter })).ok).toBe(true);
		expect(limiter.check).toHaveBeenCalledTimes(1);
	});

	it.each(["mock", "local"] as const)("never consults the limiter in %s mode", async (mode) => {
		const limiter = limiterSpy(false);

		const results = await Promise.all([1, 2, 3].map(() => run(post(body()), { mode, limiter })));

		expect(results.every((result) => result.ok)).toBe(true);
		expect(limiter.check).not.toHaveBeenCalled();
	});

	it.each([
		["a malformed body", () => post("{")],
		["an oversized body", () => post("x".repeat(LIMITS.maxBodyBytes + 1))],
		["an invalid body", () => post(body(undefined, { extra: 1 }))],
		[
			"an over-limit body",
			() =>
				post(
					body(Array.from({ length: LIMITS.maxMessages + 1 }, () => message("user", [text("a")]))),
				),
		],
	])("does not spend rate-limit quota on %s", async (_label, make) => {
		const limiter = limiterSpy(false);

		const result = await run(make(), { mode: "live", limiter });

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).not.toBe("rate-limited");
		expect(limiter.check).not.toHaveBeenCalled();
	});

	it("limits a real limiter across requests: the third request in a window is rejected", async () => {
		const clock = createFakeClock(1_000);
		const limiter = createRateLimiter({ limit: 2, windowMs: 60_000, clock });

		const first = await run(post(body()), { mode: "live", limiter });
		const second = await run(post(body()), { mode: "live", limiter });
		const third = await run(post(body()), { mode: "live", limiter });
		clock.advanceBy(60_000);
		const afterWindow = await run(post(body()), { mode: "live", limiter });

		expect([first.ok, second.ok, third.ok, afterWindow.ok]).toEqual([true, true, false, true]);
		if (!third.ok) {
			expect(third.error.code).toBe("rate-limited");
			expect(third.response.headers.get("retry-after")).toBe("60");
		}
	});
});

describe("createRateLimiter", () => {
	function make(limit = 3, windowMs = 10_000, start = 0) {
		const clock = createFakeClock(start);
		return { clock, limiter: createRateLimiter({ limit, windowMs, clock }) };
	}

	it("allows `limit` checks in a window and denies the next", () => {
		const { limiter } = make(3);

		expect([1, 2, 3, 4].map(() => limiter.check().allowed)).toEqual([true, true, true, false]);
	});

	it("reports the whole seconds until the window ends, rounded up and at least 1", () => {
		const { clock, limiter } = make(1, 10_000);
		limiter.check();

		clock.advanceBy(2_500);
		expect(limiter.check()).toEqual({ allowed: false, retryAfterSeconds: 8 });
		clock.advanceBy(7_400);
		expect(limiter.check()).toEqual({ allowed: false, retryAfterSeconds: 1 });
	});

	it("does not count denied checks, so they cannot extend the block", () => {
		const { clock, limiter } = make(1, 10_000);
		limiter.check();
		clock.advanceBy(5_000);
		for (let index = 0; index < 20; index += 1) limiter.check();

		clock.advanceBy(5_000);

		expect(limiter.check().allowed).toBe(true);
	});

	it("is a fixed window: it resets exactly at the window end and restarts from the next check", () => {
		const { clock, limiter } = make(2, 10_000);
		limiter.check();
		clock.advanceBy(9_999);
		limiter.check();
		expect(limiter.check().allowed).toBe(false);

		clock.advanceBy(1);
		expect(limiter.check().allowed).toBe(true);
		expect(limiter.check().allowed).toBe(true);
		expect(limiter.check()).toEqual({ allowed: false, retryAfterSeconds: 10 });
	});

	it("starts the first window at the first check, not at creation", () => {
		const { clock, limiter } = make(1, 10_000, 0);
		clock.advanceBy(5_000);
		limiter.check();

		clock.advanceBy(5_000);

		expect(limiter.check()).toEqual({ allowed: false, retryAfterSeconds: 5 });
		clock.advanceBy(5_000);
		expect(limiter.check().allowed).toBe(true);
	});

	it("starts a new window after a long idle gap", () => {
		const { clock, limiter } = make(1, 10_000);
		limiter.check();

		clock.advanceBy(1_000_000);

		expect(limiter.check().allowed).toBe(true);
		expect(limiter.check()).toEqual({ allowed: false, retryAfterSeconds: 10 });
	});

	it.each([
		["a zero limit", { limit: 0, windowMs: 1000 }],
		["a fractional limit", { limit: 1.5, windowMs: 1000 }],
		["a negative limit", { limit: -1, windowMs: 1000 }],
		["a zero window", { limit: 1, windowMs: 0 }],
		["an infinite window", { limit: 1, windowMs: Number.POSITIVE_INFINITY }],
		["a NaN window", { limit: 1, windowMs: Number.NaN }],
	])("rejects %s", (_label, options) => {
		expect(() => createRateLimiter({ ...options, clock: createFakeClock() })).toThrow(RangeError);
	});
});
