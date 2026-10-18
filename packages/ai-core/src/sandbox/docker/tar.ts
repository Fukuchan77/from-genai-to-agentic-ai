const BLOCK = 512;
const NAME_BYTES = 100;
// 11 octal digits fit the 12-byte size field (with its terminating NUL): 8 GiB - 1.
const MAX_SIZE = 0o77777777777;

const encoder = new TextEncoder();

function writeText(header: Uint8Array, offset: number, text: string): void {
	header.set(encoder.encode(text), offset);
}

/** A number as zero-padded octal digits filling `width - 1` bytes, then a NUL (the byte stays 0). */
function writeOctal(header: Uint8Array, offset: number, width: number, value: number): void {
	writeText(header, offset, value.toString(8).padStart(width - 1, "0"));
}

/**
 * A POSIX (ustar) archive holding one regular file, the shape Docker's `PUT /containers/{id}/archive`
 * takes to place an input file (003 C6, ADR-4: no `tar-stream`). The result is deterministic: the
 * owner is root, the time is 0, the mode is 0644, and the device fields stay empty (as for any
 * non-device file). Only a plain file name is accepted — no directory
 * entries, no `prefix` field — because the caller names a file inside a fixed directory.
 */
export function createSingleFileTar(name: string, content: Uint8Array): Uint8Array {
	const nameBytes = encoder.encode(name);
	if (nameBytes.length === 0 || name === "." || name === ".." || /[/\0]/.test(name)) {
		throw new RangeError("tar entry name must be a plain file name");
	}
	if (nameBytes.length > NAME_BYTES) {
		throw new RangeError(`tar entry name is longer than ${NAME_BYTES} bytes`);
	}
	if (content.length > MAX_SIZE) {
		throw new RangeError("tar entry is larger than 8 GiB");
	}

	const padded = Math.ceil(content.length / BLOCK) * BLOCK;
	const archive = new Uint8Array(BLOCK + padded + 2 * BLOCK);
	const header = archive.subarray(0, BLOCK);

	header.set(nameBytes, 0);
	writeOctal(header, 100, 8, 0o644); // mode
	writeOctal(header, 108, 8, 0); // uid
	writeOctal(header, 116, 8, 0); // gid
	writeOctal(header, 124, 12, content.length); // size
	writeOctal(header, 136, 12, 0); // mtime
	header.fill(0x20, 148, 156); // the checksum counts as spaces while it is computed
	writeText(header, 156, "0"); // a regular file
	writeText(header, 257, "ustar\0"); // magic
	writeText(header, 263, "00"); // version

	let checksum = 0;
	for (const byte of header) checksum += byte;
	writeText(header, 148, `${checksum.toString(8).padStart(6, "0")}\0 `);

	archive.set(content, BLOCK);
	return archive;
}
