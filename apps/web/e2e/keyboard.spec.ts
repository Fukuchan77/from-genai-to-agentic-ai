import { expect, type Page, test } from "@playwright/test";
import { applyColorScheme, type ColorScheme } from "./support/axe";

// Req 1.19, NFR-09: the main operations work with the keyboard alone, and the focus indicator of
// representative focusable components keeps 3:1 against the adjacent background (WCAG 2.2 AA,
// 1.4.11), in both themes and in every engine.

const MAX_TABS = 30;

/**
 * Safari's default skips links and buttons when tabbing; Option+Tab visits every focusable
 * element, so WebKit uses it. Other engines use plain Tab.
 */
function tabKey(page: Page): string {
	return page.context().browser()?.browserType().name() === "webkit" ? "Alt+Tab" : "Tab";
}

/** Presses Tab until the element matching `selector` has focus. Fails if it is never reached. */
async function tabTo(page: Page, selector: string): Promise<void> {
	for (let presses = 0; presses < MAX_TABS; presses += 1) {
		await page.keyboard.press(tabKey(page));
		if (await page.evaluate((query) => document.activeElement?.matches(query) ?? false, selector)) {
			return;
		}
	}
	throw new Error(`Tab never reached "${selector}" within ${MAX_TABS} presses`);
}

test("skip link is the first stop and moves focus to the main region", async ({ page }) => {
	await page.goto("/chat");

	await page.keyboard.press(tabKey(page));
	await expect(page.getByRole("link", { name: "本文へ移動" })).toBeFocused();
	await page.keyboard.press("Enter");

	await expect(page).toHaveURL(/#main$/);
});

test("chat: send a message and read the answer with the keyboard only", async ({ page }) => {
	await page.goto("/chat");

	await tabTo(page, "textarea");
	await page.keyboard.type("こんにちは");
	await tabTo(page, 'button[type="submit"]');
	await page.keyboard.press("Enter");

	await expect(page.getByRole("log", { name: "会話" })).toContainText(
		"モックモードから決定論的に応答しています。",
	);
});

test("summarize: choose the input kind and submit with the keyboard only", async ({ page }) => {
	await page.goto("/summarize");

	await tabTo(page, 'input[type="radio"]');
	await page.keyboard.press("ArrowDown");
	await page.keyboard.press("ArrowDown");
	await expect(page.getByRole("radio", { name: "字幕テキスト" })).toBeChecked();
	await tabTo(page, "textarea");
	await page.keyboard.type("fixture:summary-full 本文です。");
	await tabTo(page, 'button[type="submit"]');
	await page.keyboard.press("Space");

	await expect(page.getByRole("list", { name: "要点" })).toBeVisible();
});

interface FocusIndicator {
	readonly kind: "outline" | "ring" | "none";
	readonly width: number;
	readonly indicator: readonly [number, number, number];
	readonly background: readonly [number, number, number];
}

/** Reads the indicator of the focused element and the colour behind it, as sRGB triples. */
function readFocusIndicator(page: Page): Promise<FocusIndicator> {
	return page.evaluate(() => {
		const toRgb = (color: string): [number, number, number] => {
			// A canvas converts any CSS colour (oklch, lab, ...) to sRGB pixels.
			const canvas = document.createElement("canvas");
			canvas.width = 1;
			canvas.height = 1;
			const context = canvas.getContext("2d", { willReadFrequently: true });
			if (!context) throw new Error("2d canvas is unavailable");
			context.fillStyle = "#000";
			context.fillStyle = color;
			context.fillRect(0, 0, 1, 1);
			const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;
			return [r, g, b];
		};
		const active = document.activeElement;
		if (!active) throw new Error("nothing has focus");
		const style = getComputedStyle(active);
		const outlineWidth = Number.parseFloat(style.outlineWidth);
		let backgroundColor = "rgb(255, 255, 255)";
		for (let node: Element | null = active.parentElement; node; node = node.parentElement) {
			const candidate = getComputedStyle(node).backgroundColor;
			const alpha = candidate.startsWith("rgba")
				? Number.parseFloat(candidate.split(",")[3] ?? "1")
				: 1;
			if (candidate !== "transparent" && alpha > 0) {
				backgroundColor = candidate;
				break;
			}
		}
		const background = toRgb(backgroundColor);
		if (style.outlineStyle !== "none" && outlineWidth > 0) {
			return {
				kind: "outline",
				width: outlineWidth,
				indicator: toRgb(style.outlineColor),
				background,
			};
		}
		const ring =
			/(?:rgba?\([^)]*\)|oklch\([^)]*\)|lab\([^)]*\)|color\([^)]*\))\s+0px\s+0px\s+0px\s+([\d.]+)px/.exec(
				style.boxShadow,
			);
		if (ring?.[1]) {
			const color = /^(\S+\([^)]*\))/.exec(style.boxShadow)?.[1] ?? "";
			return {
				kind: "ring",
				width: Number.parseFloat(ring[1]),
				indicator: toRgb(color),
				background,
			};
		}
		return { kind: "none", width: 0, indicator: [0, 0, 0], background };
	});
}

function luminance([r, g, b]: readonly [number, number, number]): number {
	const channel = (value: number) => {
		const c = value / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(
	a: readonly [number, number, number],
	b: readonly [number, number, number],
): number {
	const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

const TARGETS = [
	{ path: "/chat", name: "skip link", selector: "a[href='#main']" },
	{ path: "/chat", name: "navigation link", selector: "nav a" },
	{ path: "/chat", name: "textarea", selector: "textarea" },
	{ path: "/chat", name: "model selector", selector: "select, [role='combobox']" },
	{ path: "/summarize", name: "radio", selector: "input[type='radio']" },
	{ path: "/summarize", name: "url field", selector: "input[type='url']" },
] as const;

for (const scheme of ["light", "dark"] as const satisfies readonly ColorScheme[]) {
	for (const target of TARGETS) {
		test(`focus indicator of the ${target.name} on ${target.path} has 3:1 contrast (${scheme})`, async ({
			page,
		}) => {
			await page.goto(target.path);
			await applyColorScheme(page, scheme);

			await tabTo(page, target.selector);
			const focus = await readFocusIndicator(page);

			expect(focus.kind, "a visible focus indicator").not.toBe("none");
			expect(focus.width).toBeGreaterThanOrEqual(2);
			expect(contrast(focus.indicator, focus.background)).toBeGreaterThanOrEqual(3);
		});
	}
}
