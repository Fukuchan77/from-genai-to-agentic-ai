import { GuardError } from "./errors";

// Receives the multipart upload of the analysis route (plan C13, CL-7, Req 3.9). The size limit is
// enforced on what actually arrives, not on what the client declares: the declared length can only
// reject early, and the reader stops at the first byte past the cap instead of buffering the rest.

/** Room for the text fields and the multipart framing around the file. */
const DEFAULT_EXTRA_BYTES = 64 * 1024;

const TEXT_FIELDS = ["instruction", "sessionId", "modelId"] as const;
const REQUIRED_TEXT_FIELDS = ["instruction", "sessionId"] as const;

export interface UploadOptions {
	/** The most bytes the file itself may hold. */
	readonly maxBytes: number;
	/** What the body may hold beyond the file. Defaults to 64 KiB. */
	readonly extraBytes?: number;
}

export interface UploadedFile {
	readonly name: string;
	readonly bytes: Uint8Array;
}

export interface Upload {
	readonly file: UploadedFile;
	readonly instruction: string;
	readonly sessionId: string;
	readonly modelId?: string;
}

function formatMebibytes(bytes: number): string {
	return `${Number((bytes / (1024 * 1024)).toFixed(1))} MiB`;
}

function tooLarge(maxBytes: number): GuardError {
	return new GuardError(
		"payload-too-large",
		`アップロードしたファイルが大きすぎます（上限 ${formatMebibytes(maxBytes)}）。`,
	);
}

function invalid(message: string): GuardError {
	return new GuardError("invalid-request", message);
}

/** Reads the body, giving up at the first byte over `cap`. */
async function readBody(request: Request, cap: number, maxBytes: number): Promise<Uint8Array> {
	const declared = request.headers.get("content-length");
	if (declared !== null && /^\d+$/u.test(declared) && Number(declared) > cap) {
		// Nothing is read; the unread body is dropped rather than left for the connection to drain.
		await request.body?.cancel().catch(() => undefined);
		throw tooLarge(maxBytes);
	}
	const reader = request.body?.getReader();
	if (!reader) return new Uint8Array();

	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > cap) {
			await reader.cancel();
			throw tooLarge(maxBytes);
		}
		chunks.push(value);
	}
	const body = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return body;
}

async function parseForm(contentType: string, body: Uint8Array): Promise<FormData> {
	try {
		return await new Response(body as BodyInit, {
			headers: { "content-type": contentType },
		}).formData();
	} catch {
		throw invalid("アップロードの本文を読み取れませんでした。");
	}
}

/**
 * Reads `multipart/form-data` with exactly one `file` and the text fields `instruction`,
 * `sessionId` and (optionally) `modelId`. Anything else is rejected, and no message repeats what
 * the client sent.
 */
export async function readUpload(request: Request, options: UploadOptions): Promise<Upload> {
	const contentType = request.headers.get("content-type") ?? "";
	if (!/^multipart\/form-data\s*;/iu.test(contentType)) {
		throw invalid("ファイルは multipart/form-data で送信してください。");
	}
	const cap = options.maxBytes + (options.extraBytes ?? DEFAULT_EXTRA_BYTES);
	const body = await readBody(request, cap, options.maxBytes);
	const form = await parseForm(contentType, body);

	const known: readonly string[] = ["file", ...TEXT_FIELDS];
	for (const key of new Set(form.keys())) {
		if (!known.includes(key)) throw invalid("送信できない項目が含まれています。");
	}

	const files = form.getAll("file");
	if (files.length !== 1) throw invalid("ファイルは 1 つだけ指定してください。");
	const file = files[0];
	// A part with an empty `filename` is read as a string, so a file always has a name here.
	if (!(file instanceof File)) {
		throw invalid("ファイルは名前の付いたファイルとして送信してください。");
	}
	if (file.size > options.maxBytes) throw tooLarge(options.maxBytes);

	const text: Partial<Record<(typeof TEXT_FIELDS)[number], string>> = {};
	for (const field of TEXT_FIELDS) {
		const values = form.getAll(field);
		if (values.length === 0) continue;
		const value = values[0];
		if (values.length > 1 || typeof value !== "string") {
			throw invalid(`${field} は文字列を 1 つだけ指定してください。`);
		}
		text[field] = value;
	}
	for (const field of REQUIRED_TEXT_FIELDS) {
		if (text[field] === undefined) throw invalid(`${field} を指定してください。`);
	}

	return {
		file: { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) },
		instruction: text.instruction as string,
		sessionId: text.sessionId as string,
		...(text.modelId === undefined ? {} : { modelId: text.modelId }),
	};
}
