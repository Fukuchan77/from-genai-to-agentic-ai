// Proves that vitest.config.ts registers setup-hermetic as a setup file (review M-4).
// This file must never install the guards itself: it imports only the side-effect-free guard
// library, so every assertion below fails when `setupFiles` no longer loads setup-hermetic.
import dns from "node:dns";
import net from "node:net";
import { describe, expect, it } from "vitest";
import { consumeBlockedConnections } from "./network-guard";

const blocked = (destination: string) =>
	expect.objectContaining({
		name: "NetworkBlockedError",
		code: "NETWORK_BLOCKED",
		destination,
	});

describe("hermetic setup registration", () => {
	it("blocks fetch, net.connect, and dns.lookup without an explicit install", async () => {
		await expect(fetch("http://localhost")).rejects.toEqual(blocked("http://localhost"));
		expect(() => net.connect({ host: "localhost", port: 80 })).toThrowError(
			blocked("localhost:80"),
		);
		expect(() => dns.lookup("localhost", () => undefined)).toThrowError(blocked("localhost"));

		expect(consumeBlockedConnections()).toEqual(["http://localhost", "localhost:80", "localhost"]);
	});

	// Review H-7: the setup file's afterEach must fail a test whose code swallowed the block.
	// `it.fails` passes only because that afterEach throws; without the hook this test fails.
	it.fails("fails a test that swallows a NetworkBlockedError", async () => {
		try {
			await fetch("https://localhost/");
		} catch {
			// Simulates code under test that maps a network failure to a result value.
		}
	});
});
