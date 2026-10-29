import { describe, expect, it } from "vitest";
import { demuxDockerStream } from "./demux";

const STDOUT = 1;
const STDERR = 2;

function frame(stream: number, payload: string | Uint8Array): Uint8Array {
	const body = typeof payload === "string" ? new TextEncoder().encode(payload) : payload;
	const out = new Uint8Array(8 + body.length);
	out[0] = stream;
	new DataView(out.buffer).setUint32(4, body.length, false);
	out.set(body, 8);
	return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
	const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}

describe("demuxDockerStream", () => {
	it("splits stdout and stderr frames", () => {
		const result = demuxDockerStream(
			concat(frame(STDOUT, "out1\n"), frame(STDERR, "err\n"), frame(STDOUT, "out2\n")),
		);

		expect(result.stdout).toBe("out1\nout2\n");
		expect(result.stderr).toBe("err\n");
		expect(result.warnings).toEqual([]);
	});

	it("returns empty output for an empty stream", () => {
		expect(demuxDockerStream(new Uint8Array())).toEqual({ stdout: "", stderr: "", warnings: [] });
	});

	it("reads a zero-length frame as nothing", () => {
		const result = demuxDockerStream(concat(frame(STDOUT, ""), frame(STDOUT, "x")));

		expect(result.stdout).toBe("x");
		expect(result.warnings).toEqual([]);
	});

	it("decodes a multi-byte character split across two frames", () => {
		const bytes = new TextEncoder().encode("売上");
		const result = demuxDockerStream(
			concat(
				frame(STDOUT, bytes.subarray(0, 4)),
				frame(STDERR, "e"),
				frame(STDOUT, bytes.subarray(4)),
			),
		);

		expect(result.stdout).toBe("売上");
	});

	it("returns what was read, with a warning, when the stream ends inside a frame payload", () => {
		const whole = concat(frame(STDOUT, "complete\n"), frame(STDOUT, "partial text"));
		const cut = whole.subarray(0, whole.length - 5);

		const result = demuxDockerStream(cut);

		expect(result.stdout).toBe("complete\npartial");
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]).toContain("途中");
	});

	it("returns what was read, with a warning, when the stream ends inside a header", () => {
		const result = demuxDockerStream(concat(frame(STDOUT, "ok\n"), new Uint8Array([STDERR, 0, 0])));

		expect(result.stdout).toBe("ok\n");
		expect(result.warnings).toHaveLength(1);
	});

	it("warns once, not per leftover byte, for a header cut at any length", () => {
		for (let cutAt = 1; cutAt < 8; cutAt += 1) {
			const result = demuxDockerStream(frame(STDOUT, "abc").subarray(0, cutAt));
			expect(result.stdout).toBe("");
			expect(result.warnings).toHaveLength(1);
		}
	});

	it("treats a frame that claims more bytes than exist as cut, not as an error", () => {
		const lying = frame(STDOUT, "hi");
		new DataView(lying.buffer).setUint32(4, 0xffffffff, false);

		const result = demuxDockerStream(lying);

		expect(result.stdout).toBe("hi");
		expect(result.warnings).toHaveLength(1);
	});

	it("skips a frame of an unknown stream type, with a warning, and keeps reading", () => {
		const result = demuxDockerStream(concat(frame(9, "junk"), frame(STDOUT, "after\n")));

		expect(result.stdout).toBe("after\n");
		expect(result.warnings).toHaveLength(1);
	});

	it("reads Docker's system-error stream (type 3) as stderr", () => {
		const result = demuxDockerStream(concat(frame(3, "oom\n"), frame(STDOUT, "x")));

		expect(result.stderr).toBe("oom\n");
		expect(result.stdout).toBe("x");
	});

	it("ignores the stdin stream type without a warning", () => {
		const result = demuxDockerStream(concat(frame(0, "echo"), frame(STDOUT, "x")));

		expect(result.stdout).toBe("x");
		expect(result.warnings).toEqual([]);
	});

	it("caps each stream at the limit and says so", () => {
		const result = demuxDockerStream(concat(frame(STDOUT, "0123456789"), frame(STDERR, "abc")), {
			maxBytesPerStream: 4,
		});

		expect(result.stdout).toBe("0123");
		expect(result.stderr).toBe("abc");
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]).toContain("標準出力");
	});

	it("does not warn when the output is exactly the limit", () => {
		const result = demuxDockerStream(frame(STDOUT, "0123"), { maxBytesPerStream: 4 });

		expect(result.stdout).toBe("0123");
		expect(result.warnings).toEqual([]);
	});
});
