const PRINTABLE_ASCII = /^[\x20-\x7E]*$/;
const FONT_OBJECT = 3;
const FIRST_PAGE_OBJECT = 4;

function escapeText(line: string): string {
	return line.replace(/[\\()]/g, (char) => `\\${char}`);
}

function pageContent(text: string): string {
	if (text === "") return "";
	const lines = text.split("\n").map((line) => `(${escapeText(line)}) Tj`);
	return `BT /F1 12 Tf 14 TL 72 720 Td ${lines.join(" T* ")} ET`;
}

/**
 * Builds a minimal PDF in memory: one Helvetica text object per page, no binary fixtures.
 * Text must be printable ASCII (`\n` starts a new line); an empty string makes an empty page.
 */
export function buildTextPdf(pages: readonly string[]): Uint8Array {
	if (pages.length === 0) {
		throw new RangeError("buildTextPdf needs at least one page.");
	}
	for (const text of pages) {
		if (!text.split("\n").every((line) => PRINTABLE_ASCII.test(line))) {
			throw new RangeError("buildTextPdf accepts printable ASCII text only.");
		}
	}

	const pageObject = (index: number) => FIRST_PAGE_OBJECT + index * 2;
	const objects: string[] = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${pageObject(i)} 0 R`).join(" ")}] >>`,
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
	];
	pages.forEach((text, index) => {
		const content = pageContent(text);
		objects.push(
			`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${FONT_OBJECT} 0 R >> >> /Contents ${pageObject(index) + 1} 0 R >>`,
			`<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
		);
	});

	let output = "%PDF-1.4\n";
	const offsets: number[] = [];
	objects.forEach((body, index) => {
		offsets.push(output.length);
		output += `${index + 1} 0 obj\n${body}\nendobj\n`;
	});
	const xrefOffset = output.length;
	output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	for (const offset of offsets) output += `${String(offset).padStart(10, "0")} 00000 n \n`;
	output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
	return new TextEncoder().encode(output);
}
