import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createSingleFileTar } from "./tar";

const BLOCK = 512;
const text = (value: string) => new TextEncoder().encode(value);
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function field(archive: Uint8Array, start: number, length: number): string {
	return new TextDecoder().decode(archive.subarray(start, start + length)).replace(/\0.*$/s, "");
}

/** The header checksum: the sum of all 512 bytes with the checksum field counted as spaces. */
function expectedChecksum(header: Uint8Array): number {
	let sum = 0;
	for (let i = 0; i < BLOCK; i += 1) sum += i >= 148 && i < 156 ? 0x20 : (header[i] ?? 0);
	return sum;
}

describe("createSingleFileTar", () => {
	// The reference values below were produced by Python's `tarfile` (USTAR format, mtime 0,
	// uid/gid 0, mode 0644): an independent implementation of the same format.
	it.each([
		[
			"data.csv",
			text("a,b\n1,2\n"),
			1024,
			"038342f1b009abb0f78eecb3d5514685763741a42d411a84dfeee9bea971bb45",
		],
		[
			"empty.txt",
			new Uint8Array(),
			512,
			"46e46b167f5018a400d855f8f981d2b29cafd408070a3b7e65eed0c234c713df",
		],
		[
			"日本語.csv",
			text("名前\n"),
			1024,
			"b504320d7c88a4540f0aac472be90d0e461ac88c1502796415d7ec1674f74cea",
		],
		[
			"big.bin",
			Uint8Array.from({ length: 768 }, (_, i) => i % 256),
			1536,
			"fbe0500388aba65e3e767903b155f748c0fb5886bfa7ee91c95f441e21b02023",
		],
	])("matches Python's tarfile byte for byte for %s", (name, bytes, length, hash) => {
		const archive = createSingleFileTar(name, bytes);

		expect(archive.length).toBe(length + 2 * BLOCK);
		expect(sha256(archive.subarray(0, length))).toBe(hash);
	});

	it("writes a 512-byte header with the name, an octal size, a valid checksum and the ustar magic", () => {
		const archive = createSingleFileTar("data.csv", text("a,b\n1,2\n"));
		const header = archive.subarray(0, BLOCK);

		expect(field(archive, 0, 100)).toBe("data.csv");
		expect(field(archive, 124, 12)).toBe("00000000010"); // 8 bytes, in octal
		expect(field(archive, 257, 6)).toBe("ustar");
		expect(field(archive, 263, 2)).toBe("00");
		expect(String.fromCharCode(header[156] ?? 0)).toBe("0"); // a regular file
		expect(Number.parseInt(field(archive, 148, 8).trim(), 8)).toBe(expectedChecksum(header));
	});

	it("puts the content right after the header and pads it to a whole block", () => {
		const content = text("hello");
		const archive = createSingleFileTar("a.txt", content);

		expect(archive.subarray(BLOCK, BLOCK + 5)).toEqual(content);
		expect(archive.subarray(BLOCK + 5, 2 * BLOCK).every((byte) => byte === 0)).toBe(true);
	});

	it("adds no padding block when the content is exactly one block, and one more block for 513 bytes", () => {
		expect(createSingleFileTar("a", new Uint8Array(512)).length).toBe(BLOCK + 512 + 2 * BLOCK);
		expect(createSingleFileTar("a", new Uint8Array(513)).length).toBe(BLOCK + 1024 + 2 * BLOCK);
	});

	it("ends with two zero blocks", () => {
		const archive = createSingleFileTar("a.txt", text("x"));

		expect(archive.subarray(archive.length - 2 * BLOCK).every((byte) => byte === 0)).toBe(true);
	});

	it("is deterministic: the same input gives the same bytes", () => {
		expect(createSingleFileTar("a.txt", text("x"))).toEqual(
			createSingleFileTar("a.txt", text("x")),
		);
	});

	it("accepts a name of exactly 100 bytes and rejects 101", () => {
		expect(() => createSingleFileTar("a".repeat(100), text("x"))).not.toThrow();
		expect(() => createSingleFileTar("a".repeat(101), text("x"))).toThrow(/100/);
	});

	it("counts the name length in UTF-8 bytes, not characters", () => {
		// 34 characters of 3 bytes each = 102 bytes.
		expect(() => createSingleFileTar("あ".repeat(34), text("x"))).toThrow(/100/);
		expect(() => createSingleFileTar("あ".repeat(33), text("x"))).not.toThrow();
	});

	it.each([
		["an empty name", ""],
		["a path separator", "dir/file.csv"],
		["a parent reference", ".."],
		["a current-directory reference", "."],
		["a NUL byte", "a\0b.csv"],
	])("rejects %s", (_label, name) => {
		expect(() => createSingleFileTar(name, text("x"))).toThrow(RangeError);
	});
});
