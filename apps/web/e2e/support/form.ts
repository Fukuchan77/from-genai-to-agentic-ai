import { expect, type Locator } from "@playwright/test";

/**
 * Fill a controlled field and wait until the submit button reacts to the value.
 *
 * A `fill` that lands before React has hydrated the form sets the DOM value but never reaches the
 * component state, so the submit button stays disabled (seen as a 30 s click timeout on a loaded
 * WebKit CI runner). Filling again after the button is still disabled covers that window; once the
 * form is hydrated the first attempt succeeds and nothing is repeated.
 */
export async function fillUntilEnabled(
	field: Locator,
	value: string,
	submit: Locator,
): Promise<void> {
	await expect(async () => {
		await field.fill(value);
		await expect(submit).toBeEnabled({ timeout: 1_000 });
	}).toPass({ timeout: 15_000 });
}
