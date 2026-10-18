import { describe, expect, it } from "vitest";
import { type McpServerStatus, publicMcpStatus } from "./types";

describe("publicMcpStatus", () => {
	const status: McpServerStatus = {
		id: "files",
		state: "connected",
		tools: [
			{ name: "listFiles", risk: "read-only", registered: true },
			{ name: "writeFile", risk: "destructive", registered: false, disabledReason: "理由" },
		],
	};

	it("keeps the id, the state, the reason and each tool's name, risk, registration and reason", () => {
		expect(publicMcpStatus(status)).toEqual(status);
		expect(publicMcpStatus({ ...status, state: "unavailable", reason: "切断" })).toMatchObject({
			state: "unavailable",
			reason: "切断",
		});
	});

	it("drops every other field, at the server and at the tool level", () => {
		const leaky = {
			...status,
			headers: { Authorization: "Bearer ghp_x" },
			tools: [{ ...status.tools[0], token: "ghp_x" }],
		} as unknown as McpServerStatus;

		const text = JSON.stringify(publicMcpStatus(leaky));

		expect(text).not.toContain("ghp_x");
		expect(Object.keys(publicMcpStatus(leaky))).toEqual(["id", "state", "tools"]);
	});

	it("does not add an undefined reason", () => {
		expect("reason" in publicMcpStatus(status)).toBe(false);
		expect("disabledReason" in (publicMcpStatus(status).tools[0] ?? {})).toBe(false);
	});
});
