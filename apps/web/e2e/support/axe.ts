import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

export const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] as const;

export type ColorScheme = "light" | "dark";

/** The theme is class-based (`@custom-variant dark`), so the scheme is set on `<html>`. */
export async function applyColorScheme(page: Page, scheme: ColorScheme): Promise<void> {
	await page.evaluate((value) => {
		document.documentElement.classList.toggle("dark", value === "dark");
	}, scheme);
}

/** Axe violations (WCAG 2.2 AA) as `id: first-target` strings, so a failure names its cause. */
export async function accessibilityViolations(page: Page): Promise<string[]> {
	const results = await new AxeBuilder({ page }).withTags([...WCAG_TAGS]).analyze();
	return results.violations.map(
		(violation) =>
			`${violation.id} (${violation.impact}): ${violation.nodes
				.slice(0, 3)
				.map((node) => node.target.join(" "))
				.join(", ")}`,
	);
}
