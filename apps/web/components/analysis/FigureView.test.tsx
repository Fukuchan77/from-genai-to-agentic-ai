import type { Figure } from "@platform/ai-core/analysis";
import { DEFAULT_ANALYSIS } from "@platform/ai-core/config";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FigureView } from "./FigureView";

const LIMIT = DEFAULT_ANALYSIS.maxFigureBytes;

afterEach(cleanup);

// 1x1 transparent PNG.
const PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const FIGURE: Figure = {
	alt: "月別売上の折れ線グラフ",
	mediaType: "image/png",
	base64: PNG_BASE64,
};

/** A figure the types would reject, as the wire could still deliver it. */
function untrusted(overrides: Record<string, unknown>): Figure {
	return { ...FIGURE, ...overrides } as unknown as Figure;
}

describe("FigureView", () => {
	it("shows a PNG as an image with its alt text", () => {
		render(<FigureView maxBytes={LIMIT} figure={FIGURE} />);
		const image = screen.getByRole("img", { name: "月別売上の折れ線グラフ" });
		expect(image.getAttribute("src")).toBe(`data:image/png;base64,${PNG_BASE64}`);
	});

	it("trims the alt text", () => {
		render(<FigureView maxBytes={LIMIT} figure={untrusted({ alt: "  棒グラフ \n" })} />);
		expect(screen.getByRole("img", { name: "棒グラフ" }).getAttribute("alt")).toBe("棒グラフ");
	});

	it.each(["", "   ", "\n\t"])("renders nothing when the alt is blank (%j)", (alt) => {
		const { container } = render(<FigureView maxBytes={LIMIT} figure={untrusted({ alt })} />);
		expect(container.innerHTML).toBe("");
	});

	it("renders nothing when the alt is missing or not a string", () => {
		expect(
			render(<FigureView maxBytes={LIMIT} figure={untrusted({ alt: undefined })} />).container
				.innerHTML,
		).toBe("");
		cleanup();
		expect(
			render(<FigureView maxBytes={LIMIT} figure={untrusted({ alt: 42 })} />).container.innerHTML,
		).toBe("");
	});

	it.each(["image/svg+xml", "text/html", "image/jpeg", "image/gif", "IMAGE/PNG", ""])(
		"renders nothing for the media type %j",
		(mediaType) => {
			const { container } = render(
				<FigureView maxBytes={LIMIT} figure={untrusted({ mediaType })} />,
			);
			expect(container.innerHTML).toBe("");
		},
	);

	it("renders nothing for SVG or HTML smuggled in as the payload", () => {
		const svg = btoa('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
		const html = btoa("<html><body><script>alert(1)</script></body></html>");
		for (const base64 of [svg, html]) {
			const { container } = render(<FigureView maxBytes={LIMIT} figure={untrusted({ base64 })} />);
			expect(container.innerHTML).toBe("");
			cleanup();
		}
	});

	it("renders nothing when the payload is not PNG data, even if it is valid base64", () => {
		const jpeg = btoa("\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00");
		const { container } = render(
			<FigureView maxBytes={LIMIT} figure={untrusted({ base64: jpeg })} />,
		);
		expect(container.innerHTML).toBe("");
	});

	it.each([
		["a quote that closes the attribute", `${PNG_BASE64}" onerror="alert(1)`],
		["a closing tag", `${PNG_BASE64}"><script>alert(1)</script>`],
		["another media type after a semicolon", `${PNG_BASE64};text/html;base64,PHNjcmlwdD4=`],
		["a comma that starts a second data section", `${PNG_BASE64},PHNjcmlwdD4=`],
		["a space", `${PNG_BASE64} AAAA`],
		["a newline", `${PNG_BASE64}\nAAAA`],
		["a url-safe dash", `${PNG_BASE64.slice(0, 20)}-${PNG_BASE64.slice(21)}`],
		["a url-safe underscore", `${PNG_BASE64.slice(0, 20)}_${PNG_BASE64.slice(21)}`],
		["padding in the middle", `iVBORw0K=GgoAAAAN`],
		["too much padding", `${PNG_BASE64}=`],
		["a length that is not a multiple of 4", `${PNG_BASE64}A`],
		["missing padding", PNG_BASE64.replace(/=+$/u, "")],
		["three padding characters", `${PNG_BASE64.slice(0, -3)}===`],
		["only padding", "===="],
		["an empty payload", ""],
	])("renders nothing when the payload has %s", (_label, base64) => {
		const { container } = render(<FigureView maxBytes={LIMIT} figure={untrusted({ base64 })} />);
		expect(container.innerHTML).toBe("");
		expect(container.querySelector("img")).toBeNull();
	});

	it.each([123, null, undefined, ["iVBORw0KGgo="], { length: 4 }])(
		"renders nothing when the payload is not a string (%j)",
		(base64) => {
			const { container } = render(<FigureView maxBytes={LIMIT} figure={untrusted({ base64 })} />);
			expect(container.innerHTML).toBe("");
		},
	);

	/** A payload of `chars` base64 characters that starts like a PNG; `pad` replaces the tail. */
	function pngOfLength(chars: number, pad: string): string {
		const header = PNG_BASE64.slice(0, 12);
		return header + "A".repeat(chars - header.length - pad.length) + pad;
	}

	it("renders nothing for an image above the 1 MiB limit", () => {
		// 4 * 349526 characters decode to 1048578 bytes.
		const { container } = render(
			<FigureView maxBytes={LIMIT} figure={untrusted({ base64: pngOfLength(4 * 349_526, "") })} />,
		);
		expect(container.innerHTML).toBe("");
	});

	it("renders nothing for an image one byte above the limit", () => {
		// 4 * 349526 characters with one padding character decode to 1048577 bytes.
		const { container } = render(
			<FigureView maxBytes={LIMIT} figure={untrusted({ base64: pngOfLength(4 * 349_526, "=") })} />,
		);
		expect(container.innerHTML).toBe("");
	});

	it("renders an image of exactly 1 MiB", () => {
		// 4 * 349526 characters with two padding characters decode to 1048576 bytes.
		render(
			<FigureView
				maxBytes={LIMIT}
				figure={untrusted({ base64: pngOfLength(4 * 349_526, "==") })}
			/>,
		);
		expect(screen.getByRole("img")).toBeTruthy();
	});

	it("never emits an attribute other than the fixed image ones", () => {
		render(<FigureView maxBytes={LIMIT} figure={FIGURE} />);
		const image = screen.getByRole("img");
		expect(image.getAttributeNames().sort()).toEqual(["alt", "class", "src"]);
	});

	it("does not interpret the alt text as markup", () => {
		const alt = '<script>alert(1)</script>"><b>x</b>';
		const { container } = render(<FigureView maxBytes={LIMIT} figure={untrusted({ alt })} />);
		expect(container.querySelector("script")).toBeNull();
		expect(container.querySelector("b")).toBeNull();
		expect(container.querySelector("img")?.getAttribute("alt")).toBe(alt);
	});
});
