import { afterEach, describe, expect, it, vi } from "vitest";

// The holder lives on globalThis and, once installed, cannot be deleted. This file therefore runs
// the forged-holder case first (the forged value is a plain, deletable property) and clears it.
const KEY = Symbol.for("@platform/ai-core/aci/defined-tools");
const holder = globalThis as Record<symbol, unknown>;

afterEach(() => {
	vi.resetModules();
});

describe("defined-tool holder on globalThis", () => {
	it("refuses a holder that is not a real WeakSet instead of replacing it", async () => {
		const forged = { has: () => true, add: () => undefined };
		holder[KEY] = forged;
		try {
			await expect(import("./define-tool")).rejects.toThrow(/WeakSet/u);
			expect(holder[KEY]).toBe(forged);
		} finally {
			delete holder[KEY];
		}
	});

	it("refuses a Set, which is not a WeakSet", async () => {
		holder[KEY] = new Set();
		try {
			await expect(import("./define-tool")).rejects.toThrow(/WeakSet/u);
		} finally {
			delete holder[KEY];
		}
	});

	it("installs the holder non-writable, non-configurable and non-enumerable", async () => {
		await import("./define-tool");
		const descriptor = Object.getOwnPropertyDescriptor(globalThis, KEY);
		expect(descriptor?.writable).toBe(false);
		expect(descriptor?.configurable).toBe(false);
		expect(descriptor?.enumerable).toBe(false);
		expect(Object.prototype.toString.call(descriptor?.value)).toBe("[object WeakSet]");
		expect(() => {
			holder[KEY] = {};
		}).toThrow(TypeError);
		expect(Reflect.deleteProperty(globalThis, KEY)).toBe(false);
	});

	it("reuses the installed WeakSet in a second copy", async () => {
		await import("./define-tool");
		const before = holder[KEY];
		vi.resetModules();
		await import("./define-tool");
		expect(holder[KEY]).toBe(before);
	});
});
