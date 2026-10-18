import { DEFAULT_ANALYSIS } from "../config/defaults";

export type UploadKind = "csv" | "xlsx" | "xls";
export type UploadRejection = "extension" | "size" | "empty" | "magic" | "encoding";

export type UploadCheck =
	| { readonly ok: true; readonly kind: UploadKind }
	| { readonly ok: false; readonly reason: UploadRejection };

export interface CheckUploadParams {
	readonly name: string;
	readonly bytes: Uint8Array;
	/** The size the client declared (`Content-Length`). It can only tighten the check, never relax it. */
	readonly declaredLength?: number | undefined;
	readonly maxBytes?: number;
}

const EXTENSIONS: Readonly<Record<string, UploadKind>> = { csv: "csv", xlsx: "xlsx", xls: "xls" };

const ZIP_LOCAL = [0x50, 0x4b, 0x03, 0x04] as const;
const OLE2 = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] as const;
// Content that is plainly not text: a CSV that begins with one of these is another kind of file.
const BINARY_SIGNATURES: readonly (readonly number[])[] = [
	[0x89, 0x50, 0x4e, 0x47], // PNG
	[0xff, 0xd8, 0xff], // JPEG
	[0x47, 0x49, 0x46, 0x38], // GIF
	[0x25, 0x50, 0x44, 0x46], // PDF
	ZIP_LOCAL,
	OLE2,
];

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const MAX_COMMENT_BYTES = 0xffff;

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
	return signature.every((byte, index) => bytes[index] === byte);
}

/** The kind a file name claims by its extension, or undefined for an unsupported name. */
export function uploadKindOf(name: string): UploadKind | undefined {
	const base = name.split(/[\\/]/u).pop() ?? "";
	const dot = base.lastIndexOf(".");
	// A stem is required (".csv" alone is not a name), and nothing may follow the extension.
	if (dot <= 0) return undefined;
	return EXTENSIONS[base.slice(dot + 1).toLowerCase()];
}

/**
 * The file names inside a zip, read from its central directory without inflating anything. The
 * archive is only listed, never extracted (ADR-1: the host does not parse the workbook itself).
 * Undefined when the directory is missing, truncated, or points outside the file.
 */
function listZipEntries(bytes: Uint8Array): string[] | undefined {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const lowest = Math.max(0, bytes.length - 22 - MAX_COMMENT_BYTES);
	for (let at = bytes.length - 22; at >= lowest; at -= 1) {
		if (view.getUint32(at, true) !== END_OF_CENTRAL_DIRECTORY) continue;
		const count = view.getUint16(at + 10, true);
		const offset = view.getUint32(at + 16, true);
		// ZIP64 archives put 0xffff / 0xffffffff here; a 20 MB workbook never needs them, and the
		// entry checks below reject them because those values point outside the file.

		const names: string[] = [];
		const decoder = new TextDecoder();
		let position = offset;
		for (let entry = 0; entry < count; entry += 1) {
			if (position + 46 > at || view.getUint32(position, true) !== CENTRAL_FILE_HEADER)
				return undefined;
			const nameLength = view.getUint16(position + 28, true);
			const extraLength = view.getUint16(position + 30, true);
			const commentLength = view.getUint16(position + 32, true);
			const nameEnd = position + 46 + nameLength;
			if (nameEnd > at) return undefined;
			names.push(decoder.decode(bytes.subarray(position + 46, nameEnd)));
			position = nameEnd + extraLength + commentLength;
		}
		return names;
	}
	return undefined;
}

/** True when the bytes hold the UTF-16LE spelling of `name` (an OLE2 directory entry). */
function holdsStreamName(bytes: Uint8Array, name: string): boolean {
	const encoded = Buffer.alloc(name.length * 2);
	encoded.write(name, "utf16le");
	return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).includes(encoded);
}

function isValidUtf8(bytes: Uint8Array): boolean {
	try {
		new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
		return true;
	} catch {
		return false;
	}
}

/**
 * Decides, before any sandbox starts, whether an upload is a CSV or an Excel workbook (Req 3.9). A
 * pure function of its inputs: extension first, then size (the larger of the real and declared
 * length), then emptiness, then whether the content is what the extension claims.
 */
export function checkUpload(params: CheckUploadParams): UploadCheck {
	const kind = uploadKindOf(params.name);
	if (!kind) return { ok: false, reason: "extension" };

	const { bytes } = params;
	const limit = params.maxBytes ?? DEFAULT_ANALYSIS.maxUploadBytes;
	if (bytes.length > limit || (params.declaredLength ?? 0) > limit) {
		return { ok: false, reason: "size" };
	}
	if (bytes.length === 0) return { ok: false, reason: "empty" };

	if (kind === "xlsx") {
		const entries = startsWith(bytes, ZIP_LOCAL) ? listZipEntries(bytes) : undefined;
		return entries?.includes("xl/workbook.xml")
			? { ok: true, kind }
			: { ok: false, reason: "magic" };
	}
	if (kind === "xls") {
		const isWorkbook =
			startsWith(bytes, OLE2) &&
			(holdsStreamName(bytes, "Workbook") || holdsStreamName(bytes, "Book"));
		return isWorkbook ? { ok: true, kind } : { ok: false, reason: "magic" };
	}

	if (BINARY_SIGNATURES.some((signature) => startsWith(bytes, signature))) {
		return { ok: false, reason: "magic" };
	}
	if (bytes.includes(0) || !isValidUtf8(bytes)) return { ok: false, reason: "encoding" };
	return { ok: true, kind };
}
