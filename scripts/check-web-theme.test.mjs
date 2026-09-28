import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../apps/web/app/globals.css", import.meta.url), "utf8");

function themeBlock(selector) {
	const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
	const match = css.match(new RegExp(`${escaped}\\s*\\{(?<body>[^}]*)\\}`, "u"));
	if (!match?.groups?.body) throw new Error(`Theme selector not found: ${selector}`);
	return match.groups.body;
}

function colorToken(block, name) {
	const match = block.match(
		new RegExp(
			`--${name}:\\s*oklch\\((?<lightness>[\\d.]+)\\s+(?<chroma>[\\d.]+)\\s+(?<hue>[\\d.]+)\\)`,
			"u",
		),
	);
	if (!match?.groups) throw new Error(`OKLCH token not found: --${name}`);
	return {
		lightness: Number(match.groups.lightness),
		chroma: Number(match.groups.chroma),
		hue: Number(match.groups.hue),
	};
}

function baseUniversalRule() {
	const withoutComments = css.replace(/\/\*[\s\S]*?\*\//gu, "");
	const match = withoutComments.match(/@layer\s+base\s*\{\s*\*\s*\{(?<body>[^}]*)\}/u);
	if (!match?.groups?.body) throw new Error("Universal rule not found in @layer base");
	return match.groups.body;
}

function relativeLuminance({ lightness, chroma, hue }) {
	const angle = (hue * Math.PI) / 180;
	const a = chroma * Math.cos(angle);
	const b = chroma * Math.sin(angle);
	const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
	const red = Math.min(1, Math.max(0, 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s));
	const green = Math.min(1, Math.max(0, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s));
	const blue = Math.min(1, Math.max(0, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s));
	return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(left, right) {
	const lighter = Math.max(relativeLuminance(left), relativeLuminance(right));
	const darker = Math.min(relativeLuminance(left), relativeLuminance(right));
	return (lighter + 0.05) / (darker + 0.05);
}

const textPairs = [
	["background", "foreground"],
	["card", "card-foreground"],
	["popover", "popover-foreground"],
	["primary", "primary-foreground"],
	["secondary", "secondary-foreground"],
	["muted", "muted-foreground"],
	["accent", "accent-foreground"],
	["destructive", "destructive-foreground"],
];

const interfacePairs = [
	["background", "border"],
	["background", "input"],
	["background", "ring"],
];

it("uses an opaque focus outline so the token contrast is the rendered contrast", () => {
	const rule = baseUniversalRule();
	expect(rule).toMatch(/@apply\s+border-border\s+outline-ring\s*;/u);
	expect(rule).not.toMatch(/outline-ring\//u);
});

describe.each([
	["light", ":root"],
	["dark", ".dark"],
])("%s theme contrast", (_theme, selector) => {
	const block = themeBlock(selector);

	it.each(textPairs)("keeps %s / %s text contrast at 4.5:1 or higher", (surface, text) => {
		expect(
			contrastRatio(colorToken(block, surface), colorToken(block, text)),
		).toBeGreaterThanOrEqual(4.5);
	});

	it.each(interfacePairs)(
		"keeps %s / %s non-text contrast at 3:1 or higher",
		(surface, boundary) => {
			expect(
				contrastRatio(colorToken(block, surface), colorToken(block, boundary)),
			).toBeGreaterThanOrEqual(3);
		},
	);
});
