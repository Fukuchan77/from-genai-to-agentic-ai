import { describe, expect, it } from "vitest";
import { checkJsonSchemaDescription } from "../aci";
import { FILE_TOOL_NAMES } from "../files/operations";
import {
	filesServerConfig,
	GITHUB_ENDPOINT,
	GITHUB_READ_ONLY_TOOLS,
	GITHUB_SERVER_ID,
	GITHUB_TOOL_INPUTS,
	githubServerConfig,
} from "./github";

const TOKEN = "ghp_test-token-0123456789";

function configOf(env: { GITHUB_TOKEN?: string | undefined }) {
	const result = githubServerConfig(env);
	if ("reason" in result) throw new Error(`expected a configuration, received ${result.reason}`);
	return result;
}

describe("githubServerConfig (CL-4, Req 1.9)", () => {
	it("returns token-missing when GITHUB_TOKEN is not set, empty or blank", () => {
		expect(githubServerConfig({})).toEqual({ reason: "token-missing" });
		expect(githubServerConfig({ GITHUB_TOKEN: undefined })).toEqual({ reason: "token-missing" });
		expect(githubServerConfig({ GITHUB_TOKEN: "" })).toEqual({ reason: "token-missing" });
		expect(githubServerConfig({ GITHUB_TOKEN: "  \n" })).toEqual({ reason: "token-missing" });
	});

	it("connects to the hosted GitHub MCP server over HTTP with a bearer token", () => {
		const config = configOf({ GITHUB_TOKEN: TOKEN });
		expect(config.id).toBe(GITHUB_SERVER_ID);
		expect(config.transport).toMatchObject({ kind: "http", url: GITHUB_ENDPOINT });
		if (config.transport.kind !== "http") throw new Error("expected http");
		expect(config.transport.headers.Authorization).toBe(`Bearer ${TOKEN}`);
	});

	it("also asks the server for its read-only mode", () => {
		const config = configOf({ GITHUB_TOKEN: TOKEN });
		if (config.transport.kind !== "http") throw new Error("expected http");
		expect(config.transport.headers["X-MCP-Readonly"]).toBe("true");
	});

	it("trims the token", () => {
		const config = configOf({ GITHUB_TOKEN: `  ${TOKEN}\n` });
		if (config.transport.kind !== "http") throw new Error("expected http");
		expect(config.transport.headers.Authorization).toBe(`Bearer ${TOKEN}`);
	});

	it("puts the token in the Authorization header and nowhere else", () => {
		const config = configOf({ GITHUB_TOKEN: TOKEN });
		if (config.transport.kind !== "http") throw new Error("expected http");
		const { Authorization: _hidden, ...otherHeaders } = config.transport.headers;
		const withoutAuthorization = {
			...config,
			transport: { ...config.transport, headers: otherHeaders },
		};
		expect(JSON.stringify(withoutAuthorization)).not.toContain(TOKEN);
		expect(config.transport.url).not.toContain(TOKEN);
	});

	it("does not trust the server's error metadata", () => {
		expect(configOf({ GITHUB_TOKEN: TOKEN }).trustErrorMeta).toBe(false);
	});

	it("allows only read-only tools (Req 1.17)", () => {
		const config = configOf({ GITHUB_TOKEN: TOKEN });
		expect([...config.allow].sort()).toEqual([...GITHUB_READ_ONLY_TOOLS].sort());
		for (const name of config.allow) {
			expect(name).toMatch(/^(get|list|search|issue_read|pull_request_read)/u);
			expect(name).not.toMatch(/write|create|update|delete|merge|push|fork/u);
		}
	});

	it("has an override description in the CL-18 form for every allowed tool, naming its inputs", () => {
		const config = configOf({ GITHUB_TOKEN: TOKEN });
		expect(config.descriptions).toBeDefined();
		for (const name of config.allow) {
			const description = config.descriptions?.[name];
			expect(description, name).toBeTruthy();
			// The override must pass for a schema that lists exactly the documented inputs without descriptions.
			const documented = GITHUB_TOOL_INPUTS[name] ?? [];
			expect(documented.length, name).toBeGreaterThan(0);
			const schema = {
				type: "object",
				properties: Object.fromEntries(documented.map((input) => [input, {}])),
			};
			expect(checkJsonSchemaDescription(description ?? "", schema), name).toEqual([]);
		}
		expect(Object.keys(config.descriptions ?? {}).sort()).toEqual([...config.allow].sort());
	});

	it("explains how a failure of authentication is shown to the learner", () => {
		const config = configOf({ GITHUB_TOKEN: TOKEN });
		expect(config.fatalMessages?.["auth-failed"]).toContain("GITHUB_TOKEN");
		expect(config.fatalMessages?.["auth-failed"]).not.toContain(TOKEN);
	});
});

describe("filesServerConfig (CL-3, CL-24)", () => {
	const SERVER_FILE = "/repo/packages/ai-core/src/files/stdio.ts";

	it("starts the platform's own server with the current Node, no loader, and the root in MCP_FS_ROOT", () => {
		const config = filesServerConfig({ root: "/work/ws", serverFile: SERVER_FILE });
		expect(config.transport).toEqual({
			kind: "stdio",
			command: process.execPath,
			args: [SERVER_FILE],
			env: { MCP_FS_ROOT: "/work/ws" },
		});
	});

	it("resolves a relative root to an absolute path", () => {
		const config = filesServerConfig({ root: "workspace/", serverFile: SERVER_FILE });
		if (config.transport.kind !== "stdio") throw new Error("expected stdio");
		expect(config.transport.env.MCP_FS_ROOT?.startsWith("/")).toBe(true);
		expect(config.transport.env.MCP_FS_ROOT?.endsWith("/workspace")).toBe(true);
	});

	it("finds the server file next to the package source by default", () => {
		const config = filesServerConfig({ root: "/work/ws" });
		if (config.transport.kind !== "stdio") throw new Error("expected stdio");
		expect(config.transport.args).toHaveLength(1);
		expect(config.transport.args[0]).toMatch(/packages\/ai-core\/src\/files\/stdio\.ts$/u);
	});

	it("trusts its own error metadata, and only for this server", () => {
		expect(filesServerConfig({ root: "/work/ws", serverFile: SERVER_FILE }).trustErrorMeta).toBe(
			true,
		);
	});

	it("allows exactly the read-only file tools; the write and delete tools are not in the list", () => {
		const config = filesServerConfig({ root: "/work/ws", serverFile: SERVER_FILE });
		expect([...config.allow].sort()).toEqual(
			[
				FILE_TOOL_NAMES.list,
				FILE_TOOL_NAMES.read,
				FILE_TOOL_NAMES.search,
				FILE_TOOL_NAMES.findAndRead,
			].sort(),
		);
		expect(config.allow).not.toContain(FILE_TOOL_NAMES.write);
		expect(config.allow).not.toContain(FILE_TOOL_NAMES.delete);
	});

	it("names the allowed root in the learner's message for a path that leaves it", () => {
		const config = filesServerConfig({ root: "/work/ws", serverFile: SERVER_FILE });
		expect(config.fatalMessages?.["not-allowed"]).toContain("/work/ws");
	});

	it("needs no override descriptions: the platform's own tools already follow the CL-18 form", () => {
		expect(
			filesServerConfig({ root: "/work/ws", serverFile: SERVER_FILE }).descriptions,
		).toBeUndefined();
	});
});
