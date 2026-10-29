import { describe, expect, it } from "vitest";
import { type DockerProbeResult, selectSandboxProvider } from "./select";

const READY: DockerProbeResult = { reachable: true, imagePresent: true };
const NO_IMAGE: DockerProbeResult = { reachable: true, imagePresent: false };
const DOWN: DockerProbeResult = { reachable: false, imagePresent: false };

describe("selectSandboxProvider", () => {
	it("prefers E2B when a key is set, even if the container is ready", () => {
		expect(
			selectSandboxProvider({ env: { E2B_API_KEY: "changeme-e2b" }, dockerProbe: READY }),
		).toEqual({ kind: "e2b" });
	});

	it("uses E2B when the key is set and Docker is not reachable", () => {
		expect(
			selectSandboxProvider({ env: { E2B_API_KEY: "changeme-e2b" }, dockerProbe: DOWN }),
		).toEqual({ kind: "e2b" });
	});

	it("uses the local container when there is no key and Docker has the image", () => {
		expect(selectSandboxProvider({ env: {}, dockerProbe: READY })).toEqual({ kind: "docker" });
	});

	it("treats an empty or blank key as not set", () => {
		expect(selectSandboxProvider({ env: { E2B_API_KEY: "" }, dockerProbe: READY })).toEqual({
			kind: "docker",
		});
		expect(selectSandboxProvider({ env: { E2B_API_KEY: "   " }, dockerProbe: DOWN })).toMatchObject(
			{
				kind: "disabled",
			},
		);
	});

	it("is disabled when Docker answers but the image is missing, and names the image and the build task", () => {
		const selection = selectSandboxProvider({ env: {}, dockerProbe: NO_IMAGE });

		expect(selection).toMatchObject({ kind: "disabled" });
		if (selection.kind !== "disabled") throw new Error("expected disabled");
		expect(selection.reason).toContain("agentic-ai-sandbox:local");
		expect(selection.guidance).toContain("mise run sandbox:build");
		expect(selection.guidance).toContain("E2B_API_KEY");
	});

	it("reports the image name from DOCKER_SANDBOX_IMAGE", () => {
		const selection = selectSandboxProvider({
			env: { DOCKER_SANDBOX_IMAGE: "my-sandbox:1" },
			dockerProbe: NO_IMAGE,
		});

		if (selection.kind !== "disabled") throw new Error("expected disabled");
		expect(selection.reason).toContain("my-sandbox:1");
		expect(selection.reason).not.toContain("agentic-ai-sandbox:local");
	});

	it("is disabled with a reason and guidance when there is neither a key nor a container", () => {
		const selection = selectSandboxProvider({ env: {}, dockerProbe: DOWN });

		if (selection.kind !== "disabled") throw new Error("expected disabled");
		expect(selection.reason).toContain("E2B_API_KEY");
		expect(selection.reason).toContain("Docker");
		expect(selection.guidance).toContain("E2B_API_KEY");
		expect(selection.guidance).toContain("Docker");
		expect(selection.guidance).toContain("mise run sandbox:build");
	});

	it("never puts the key in the selection", () => {
		const key = "changeme-secret-value";
		const selection = selectSandboxProvider({ env: { E2B_API_KEY: key }, dockerProbe: DOWN });

		expect(JSON.stringify(selection)).not.toContain(key);
	});
});
