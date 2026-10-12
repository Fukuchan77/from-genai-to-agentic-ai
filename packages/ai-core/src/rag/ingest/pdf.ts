import { extractText, getDocumentProxy } from "unpdf";
import { PlatformError } from "../../errors";

/** The bytes could not be read as a PDF; the loader reports it as the skip reason `parse-failed`. */
export class PdfParseError extends PlatformError {
	constructor() {
		super("invalid-request", "PDF を解析できませんでした。", { reason: "parse-failed" });
	}
}

/**
 * Extracts the text of each page (index 0 is page 1). Pages without text stay in the array as empty
 * strings, so the caller decides whether the whole file has no text.
 */
export async function extractPdfPages(bytes: Uint8Array): Promise<string[]> {
	// pdf.js rejects Node Buffers and may take ownership of the array it is given, so it receives a
	// plain Uint8Array copy. verbosity 0 keeps its recovery warnings out of the process output.
	const pdf = await getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 }).catch(() => {
		throw new PdfParseError();
	});
	try {
		const { text } = await extractText(pdf, { mergePages: false });
		return text;
	} catch {
		throw new PdfParseError();
	} finally {
		await pdf.loadingTask.destroy();
	}
}
