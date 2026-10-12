import { expect, test } from "@playwright/test";
import { accessibilityViolations, applyColorScheme, type ColorScheme } from "./support/axe";

// Req 1.19, NFR-09: axe (WCAG 2.2 AA) on every screen in both themes. The dark theme is a
// `.dark` class on <html>, so it is checked explicitly rather than through prefers-color-scheme.

const PATHS = ["/chat", "/agent", "/summarize"] as const;
const SCHEMES: readonly ColorScheme[] = ["light", "dark"];

for (const path of PATHS) {
	for (const scheme of SCHEMES) {
		test(`${path} has no axe violations (${scheme})`, async ({ page }) => {
			await page.goto(path);
			await applyColorScheme(page, scheme);
			await expect(page.locator("html")).toHaveClass(scheme === "dark" ? /dark/ : /^(?!.*dark).*$/);

			expect(await accessibilityViolations(page)).toEqual([]);
		});
	}
}
