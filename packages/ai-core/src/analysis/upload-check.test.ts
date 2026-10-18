import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_ANALYSIS } from "../config/defaults";
import { checkUpload } from "./upload-check";

const MAX = DEFAULT_ANALYSIS.maxUploadBytes;
const text = (value: string) => new TextEncoder().encode(value);

/** A zip with stored (uncompressed) entries and a central directory: enough to list names. */
function buildZip(entries: readonly string[], padding = 0): Uint8Array {
	const parts: Uint8Array[] = [];
	const central: Uint8Array[] = [];
	let offset = 0;
	for (const name of entries) {
		const nameBytes = text(name);
		const local = new Uint8Array(30 + nameBytes.length);
		const localView = new DataView(local.buffer);
		localView.setUint32(0, 0x04034b50, true);
		localView.setUint16(26, nameBytes.length, true);
		local.set(nameBytes, 30);
		// `padding` bytes of extra field and of comment after each name, as real archives have.
		const header = new Uint8Array(46 + nameBytes.length + 2 * padding);
		const view = new DataView(header.buffer);
		view.setUint32(0, 0x02014b50, true);
		view.setUint16(28, nameBytes.length, true);
		view.setUint16(30, padding, true);
		view.setUint16(32, padding, true);
		view.setUint32(42, offset, true);
		header.set(nameBytes, 46);
		parts.push(local);
		central.push(header);
		offset += local.length;
	}
	const centralSize = central.reduce((sum, part) => sum + part.length, 0);
	const end = new Uint8Array(22);
	const endView = new DataView(end.buffer);
	endView.setUint32(0, 0x06054b50, true);
	endView.setUint16(8, entries.length, true);
	endView.setUint16(10, entries.length, true);
	endView.setUint32(12, centralSize, true);
	endView.setUint32(16, offset, true);
	return concat(...parts, ...central, end);
}

function concat(...parts: Uint8Array[]): Uint8Array {
	const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
	let at = 0;
	for (const part of parts) {
		out.set(part, at);
		at += part.length;
	}
	return out;
}

const XLSX = buildZip(["[Content_Types].xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml"]);
const DOCX = buildZip(["[Content_Types].xml", "word/document.xml"]);
const OLE2_MAGIC = Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const utf16 = (value: string) =>
	Uint8Array.from([...value].flatMap((char) => [char.charCodeAt(0), 0]));
const XLS = concat(
	OLE2_MAGIC,
	new Uint8Array(504),
	utf16("Root Entry"),
	utf16("Workbook"),
	new Uint8Array(64),
);
const DOC = concat(
	OLE2_MAGIC,
	new Uint8Array(504),
	utf16("Root Entry"),
	utf16("WordDocument"),
	new Uint8Array(64),
);
const PNG = Uint8Array.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
]);

describe("checkUpload", () => {
	describe("a valid file", () => {
		it("accepts CSV text, in UTF-8, with a BOM, with CRLF, and the committed sample", () => {
			const sample = new Uint8Array(
				readFileSync(path.resolve(import.meta.dirname, "../../fixtures/analysis/sales.csv")),
			);

			expect(checkUpload({ name: "a.csv", bytes: text("a,b\n1,2\n") })).toEqual({
				ok: true,
				kind: "csv",
			});
			expect(checkUpload({ name: "a.csv", bytes: text("名前,売上\r\nペン,100\r\n") }).ok).toBe(
				true,
			);
			expect(
				checkUpload({
					name: "a.csv",
					bytes: concat(Uint8Array.from([0xef, 0xbb, 0xbf]), text("a,b\n")),
				}).ok,
			).toBe(true);
			expect(checkUpload({ name: "sales.csv", bytes: sample })).toEqual({ ok: true, kind: "csv" });
		});

		it("accepts a workbook whose zip holds xl/workbook.xml, and an OLE2 workbook", () => {
			expect(checkUpload({ name: "book.xlsx", bytes: XLSX })).toEqual({ ok: true, kind: "xlsx" });
			expect(checkUpload({ name: "book.xls", bytes: XLS })).toEqual({ ok: true, kind: "xls" });
		});

		it("reads the extension case-insensitively and from the last path segment", () => {
			expect(checkUpload({ name: "SALES.CSV", bytes: text("a\n") })).toEqual({
				ok: true,
				kind: "csv",
			});
			expect(checkUpload({ name: "C:\\Users\\me\\Q1.sales.csv", bytes: text("a\n") }).ok).toBe(
				true,
			);
			expect(checkUpload({ name: "../../etc/q1.xlsx", bytes: XLSX }).ok).toBe(true);
		});
	});

	describe("the extension", () => {
		it.each([
			"notes.txt",
			"report.pdf",
			"macro.xlsm",
			"book.xlsb",
			"data",
			"data.",
			".csv",
			"a.csv.exe",
			"a.csv ",
			"",
		])("rejects the name %j", (name) => {
			expect(checkUpload({ name, bytes: text("a,b\n") })).toEqual({
				ok: false,
				reason: "extension",
			});
		});

		it("is checked before anything else", () => {
			expect(checkUpload({ name: "a.exe", bytes: new Uint8Array(MAX + 1) })).toEqual({
				ok: false,
				reason: "extension",
			});
		});
	});

	it("treats a file in a directory whose name has a dot, or a bare .csv in a directory, by the file's own name", () => {
		expect(checkUpload({ name: "reports.v2/sales.csv", bytes: text("a\n") }).ok).toBe(true);
		expect(checkUpload({ name: "reports/.csv", bytes: text("a\n") })).toEqual({
			ok: false,
			reason: "extension",
		});
	});

	describe("the size limit", () => {
		it("takes another limit from the parameters", () => {
			expect(checkUpload({ name: "a.csv", bytes: text("0123456789"), maxBytes: 10 }).ok).toBe(true);
			expect(checkUpload({ name: "a.csv", bytes: text("01234567890"), maxBytes: 10 })).toEqual({
				ok: false,
				reason: "size",
			});
		});

		it("accepts exactly the limit and rejects one byte more", () => {
			const atLimit = new Uint8Array(MAX).fill(0x61);
			const over = new Uint8Array(MAX + 1).fill(0x61);

			expect(checkUpload({ name: "a.csv", bytes: atLimit })).toEqual({ ok: true, kind: "csv" });
			expect(checkUpload({ name: "a.csv", bytes: over })).toEqual({ ok: false, reason: "size" });
		});

		it("uses the real size when the declared length is smaller", () => {
			const over = new Uint8Array(MAX + 1).fill(0x61);

			expect(checkUpload({ name: "a.csv", bytes: over, declaredLength: 100 })).toEqual({
				ok: false,
				reason: "size",
			});
		});

		it("rejects a declared length over the limit even when few bytes arrived", () => {
			expect(checkUpload({ name: "a.csv", bytes: text("a\n"), declaredLength: MAX + 1 })).toEqual({
				ok: false,
				reason: "size",
			});
			expect(checkUpload({ name: "a.csv", bytes: text("a\n"), declaredLength: MAX })).toEqual({
				ok: true,
				kind: "csv",
			});
		});

		it("is checked before the content", () => {
			expect(checkUpload({ name: "a.xlsx", bytes: new Uint8Array(MAX + 1) })).toEqual({
				ok: false,
				reason: "size",
			});
		});
	});

	describe("an empty file", () => {
		it.each(["a.csv", "a.xlsx", "a.xls"])("rejects an empty %s as empty", (name) => {
			expect(checkUpload({ name, bytes: new Uint8Array() })).toEqual({
				ok: false,
				reason: "empty",
			});
		});
	});

	describe("the content must match the extension", () => {
		it("rejects an .xlsx that is really a Word document, plain text, or a broken zip", () => {
			expect(checkUpload({ name: "a.xlsx", bytes: DOCX })).toEqual({ ok: false, reason: "magic" });
			expect(checkUpload({ name: "a.xlsx", bytes: text("a,b\n1,2\n") })).toEqual({
				ok: false,
				reason: "magic",
			});
			expect(checkUpload({ name: "a.xlsx", bytes: XLSX.subarray(0, XLSX.length - 30) })).toEqual({
				ok: false,
				reason: "magic",
			});
			expect(
				checkUpload({ name: "a.xlsx", bytes: Uint8Array.from([0x50, 0x4b, 0x03, 0x04]) }),
			).toEqual({
				ok: false,
				reason: "magic",
			});
		});

		it("reads an archive whose directory entries carry extra fields and comments", () => {
			const padded = buildZip(["[Content_Types].xml", "xl/workbook.xml", "xl/styles.xml"], 7);

			expect(checkUpload({ name: "a.xlsx", bytes: padded })).toEqual({ ok: true, kind: "xlsx" });
		});

		it("rejects an .xlsx whose first bytes are not a zip signature, even with a valid directory", () => {
			const damaged = XLSX.slice();
			damaged[0] = 0x4a;

			expect(checkUpload({ name: "a.xlsx", bytes: damaged })).toEqual({
				ok: false,
				reason: "magic",
			});
		});

		it("rejects an .xlsx that needs ZIP64, which a 20 MB workbook never does", () => {
			const zip64 = XLSX.slice();
			new DataView(zip64.buffer).setUint16(zip64.length - 22 + 10, 0xffff, true);

			expect(checkUpload({ name: "a.xlsx", bytes: zip64 })).toEqual({ ok: false, reason: "magic" });
		});

		it("rejects an .xlsx whose directory entry has a bad signature", () => {
			const damaged = XLSX.slice();
			const view = new DataView(damaged.buffer);
			const directoryStart = view.getUint32(damaged.length - 22 + 16, true);
			view.setUint32(directoryStart, 0, true);

			expect(checkUpload({ name: "a.xlsx", bytes: damaged })).toEqual({
				ok: false,
				reason: "magic",
			});
		});

		it("rejects an .xlsx whose last entry claims a name longer than the file", () => {
			const damaged = XLSX.slice();
			const view = new DataView(damaged.buffer);
			let position = view.getUint32(damaged.length - 22 + 16, true);
			for (let entry = 0; entry < 2; entry += 1) {
				position += 46 + view.getUint16(position + 28, true);
			}
			view.setUint16(position + 28, 0xffff, true); // the third entry

			expect(checkUpload({ name: "a.xlsx", bytes: damaged })).toEqual({
				ok: false,
				reason: "magic",
			});
		});

		it("rejects an .xlsx whose central directory points outside the file", () => {
			const broken = XLSX.slice();
			new DataView(broken.buffer).setUint32(broken.length - 6, 0x7fffffff, true);

			expect(checkUpload({ name: "a.xlsx", bytes: broken })).toEqual({
				ok: false,
				reason: "magic",
			});
		});

		it("rejects an .xls that is an OLE2 file without a workbook, and one that is not OLE2", () => {
			expect(checkUpload({ name: "a.xls", bytes: DOC })).toEqual({ ok: false, reason: "magic" });
			expect(checkUpload({ name: "a.xls", bytes: text("a,b\n1,2\n") })).toEqual({
				ok: false,
				reason: "magic",
			});
			expect(checkUpload({ name: "a.xls", bytes: XLSX })).toEqual({ ok: false, reason: "magic" });
		});

		it("accepts the older workbook stream name Book, and rejects the name without the OLE2 signature", () => {
			const xls5 = concat(
				OLE2_MAGIC,
				new Uint8Array(504),
				utf16("Root Entry"),
				utf16("Book"),
				new Uint8Array(64),
			);
			const notOle2 = concat(
				text("NOTOLE2!"),
				new Uint8Array(504),
				utf16("Workbook"),
				new Uint8Array(64),
			);

			expect(checkUpload({ name: "a.xls", bytes: xls5 })).toEqual({ ok: true, kind: "xls" });
			expect(checkUpload({ name: "a.xls", bytes: notOle2 })).toEqual({
				ok: false,
				reason: "magic",
			});
		});

		it("rejects a .csv that is really a PNG, a workbook or a PDF", () => {
			expect(checkUpload({ name: "a.csv", bytes: PNG })).toEqual({ ok: false, reason: "magic" });
			expect(checkUpload({ name: "a.csv", bytes: XLSX })).toEqual({ ok: false, reason: "magic" });
			expect(checkUpload({ name: "a.csv", bytes: XLS })).toEqual({ ok: false, reason: "magic" });
			expect(checkUpload({ name: "a.csv", bytes: text("%PDF-1.7\n") })).toEqual({
				ok: false,
				reason: "magic",
			});
			expect(
				checkUpload({ name: "a.csv", bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x61]) }),
			).toEqual({
				ok: false,
				reason: "magic",
			});
		});
	});

	describe("the CSV encoding", () => {
		it("rejects a NUL byte anywhere in the text", () => {
			expect(
				checkUpload({ name: "a.csv", bytes: Uint8Array.from([0x61, 0x2c, 0x00, 0x62]) }),
			).toEqual({
				ok: false,
				reason: "encoding",
			});
			const late = new Uint8Array(1000).fill(0x61);
			late[999] = 0;
			expect(checkUpload({ name: "a.csv", bytes: late })).toEqual({
				ok: false,
				reason: "encoding",
			});
		});

		it("rejects text that is not valid UTF-8, such as Shift_JIS and UTF-16", () => {
			const shiftJis = Uint8Array.from([0x96, 0xbc, 0x91, 0x4f, 0x2c, 0x94, 0xe4, 0x0a]); // 名前,売
			const utf16le = Uint8Array.from([0xff, 0xfe, 0x61, 0x00, 0x2c, 0x00, 0x62, 0x00]);

			expect(checkUpload({ name: "a.csv", bytes: shiftJis })).toEqual({
				ok: false,
				reason: "encoding",
			});
			expect(checkUpload({ name: "a.csv", bytes: utf16le })).toEqual({
				ok: false,
				reason: "encoding",
			});
			expect(checkUpload({ name: "a.csv", bytes: Uint8Array.from([0x61, 0xc3]) })).toEqual({
				ok: false,
				reason: "encoding",
			});
		});
	});

	it("does not change the bytes it was given", () => {
		const bytes = text("a,b\n1,2\n");
		const copy = bytes.slice();

		checkUpload({ name: "a.csv", bytes });

		expect(bytes).toEqual(copy);
	});
});
