import { describe, expect, it, vi } from "vitest";
import { checkRegistryUpdates, formatUpdateReport, isAiV7Compatible } from "./check-updates.mjs";

const NOW = new Date("2026-09-27T12:00:00.000Z");
const PINNED_TYPESCRIPT = "7.1.0-dev.20260926.1";

function registryResponse(body) {
	return new Response(JSON.stringify(body), {
		headers: { "content-type": "application/json" },
		status: 200,
	});
}

function registryFetch(fixtures) {
	return vi.fn(async (url) => {
		const packageName = decodeURIComponent(new URL(url).pathname.slice(1));
		const fixture = fixtures[packageName];
		if (!fixture) return new Response("not found", { status: 404 });
		return registryResponse(fixture);
	});
}

function typescriptFixture(times) {
	return {
		name: "typescript",
		time: times,
		versions: Object.fromEntries(Object.keys(times).map((version) => [version, { version }])),
	};
}

function watsonxFixture(peerDependenciesByVersion) {
	return {
		name: "watsonx-ai-provider",
		versions: Object.fromEntries(
			Object.entries(peerDependenciesByVersion).map(([version, peerDependencies]) => [
				version,
				{ version, peerDependencies },
			]),
		),
	};
}

describe("checkRegistryUpdates", () => {
	it("reports the newest eligible TypeScript 7.1 prerelease build", async () => {
		const fetchImpl = registryFetch({
			typescript: typescriptFixture({
				"7.1.0-dev.20260926.1": "2026-09-26T09:00:00.000Z",
				"7.1.0-dev.20260926.2": "2026-09-26T10:00:00.000Z",
				"7.1.0-dev.20260926.10": "2026-09-26T11:00:00.000Z",
				"7.2.0-dev.20260926.1": "2026-09-26T08:00:00.000Z",
			}),
			"watsonx-ai-provider": watsonxFixture({ "1.0.0": { ai: "^6.0.0" } }),
		});

		const result = await checkRegistryUpdates({
			fetchImpl,
			now: NOW,
			typescriptVersion: PINNED_TYPESCRIPT,
		});

		expect(result.typescript).toEqual({
			current: PINNED_TYPESCRIPT,
			newerEligible: "7.1.0-dev.20260926.10",
		});
	});

	it("ignores builds published less than 24 hours before the injected time", async () => {
		const fetchImpl = registryFetch({
			typescript: typescriptFixture({
				"7.1.0-dev.20260926.1": "2026-09-25T12:00:00.000Z",
				"7.1.0-dev.20260927.1": "2026-09-26T12:00:00.000Z",
				"7.1.0-dev.20260927.2": "2026-09-26T12:00:00.001Z",
			}),
			"watsonx-ai-provider": watsonxFixture({ "1.0.0": { ai: "^6.0.0" } }),
		});

		const result = await checkRegistryUpdates({
			fetchImpl,
			now: NOW,
			typescriptVersion: PINNED_TYPESCRIPT,
		});

		expect(result.typescript.newerEligible).toBe("7.1.0-dev.20260927.1");
	});

	it("detects a watsonx-ai-provider release compatible with ai@^7", async () => {
		const fetchImpl = registryFetch({
			typescript: typescriptFixture({
				"7.1.0-dev.20260926.1": "2026-09-25T12:00:00.000Z",
			}),
			"watsonx-ai-provider": watsonxFixture({
				"0.4.0": { ai: "^6.0.0" },
				"0.5.0": { ai: ">=7.0.0 <8.0.0" },
				"0.6.0": { ai: "^7.1.0 || ^8.0.0" },
			}),
		});

		const result = await checkRegistryUpdates({
			fetchImpl,
			now: NOW,
			typescriptVersion: PINNED_TYPESCRIPT,
		});

		expect(result.watsonx).toEqual({
			aiV7Compatible: true,
			compatibleVersions: ["0.5.0", "0.6.0"],
		});
		expect(isAiV7Compatible("^6.0.0 || ^7.0.0")).toBe(true);
		expect(isAiV7Compatible("^6.0.0")).toBe(false);
	});

	it("uses only the injected fetcher and produces a deterministic report", async () => {
		const fetchImpl = registryFetch({
			typescript: typescriptFixture({
				"7.1.0-dev.20260926.1": "2026-09-25T12:00:00.000Z",
			}),
			"watsonx-ai-provider": watsonxFixture({ "0.4.0": { ai: "^6.0.0" } }),
		});

		const result = await checkRegistryUpdates({
			fetchImpl,
			now: NOW,
			typescriptVersion: PINNED_TYPESCRIPT,
		});

		expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
			"https://registry.npmjs.org/typescript",
			"https://registry.npmjs.org/watsonx-ai-provider",
		]);
		expect(formatUpdateReport(result)).toBe(
			[
				`TypeScript: ${PINNED_TYPESCRIPT} is the newest eligible 7.1 prerelease build.`,
				"watsonx-ai-provider: no release declares compatibility with ai@^7.",
			].join("\n"),
		);
	});
});
