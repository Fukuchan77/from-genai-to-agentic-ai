import { expect, type Locator } from "@playwright/test";

/**
 * Fill a controlled field and wait until the submit button reacts to the value.
 *
 * A `fill` that lands before React has hydrated the form sets the DOM value but never reaches the
 * component state, so the submit button stays disabled (seen as a 15–30 s timeout on the WebKit CI
 * job). React tracks the last value it saw and ignores an `input` event that carries the same value,
 * so filling the same text again does nothing: the field is cleared first, which makes the next fill
 * a real change. Once the form is hydrated the first attempt succeeds and nothing is repeated.
 */
export async function fillUntilEnabled(
	field: Locator,
	value: string,
	submit: Locator,
): Promise<void> {
	await expect(async () => {
		await field.fill("");
		await field.fill(value);
		await expect(submit).toBeEnabled({ timeout: 1_000 });
	}).toPass({ timeout: 15_000 });
}
