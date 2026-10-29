import type { McpServerStatus } from "@platform/ai-core/mcp";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ServerStatusList } from "./ServerStatusList";

afterEach(cleanup);

const FILES: McpServerStatus = {
	id: "files",
	state: "connected",
	tools: [
		{ name: "listFiles", risk: "read-only", registered: true },
		{ name: "readFile", risk: "read-only", registered: true },
		{
			name: "deleteFile",
			risk: "destructive",
			registered: false,
			disabledReason: "リスク区分が destructive のため登録しません。",
		},
		{
			name: "writeFile",
			risk: "write",
			registered: false,
			disabledReason: "リスク区分が write のため登録しません。",
		},
		{
			name: "searchFiles",
			risk: "read-only",
			registered: false,
			disabledReason: "説明文の形式が要件を満たしていないため登録しません。",
		},
	],
};

const GITHUB: McpServerStatus = {
	id: "github",
	state: "unavailable",
	reason: "接続がタイムアウトしました。",
	tools: [],
};

function serverItem(id: string) {
	const items = within(screen.getByRole("list", { name: "MCP サーバー" })).getAllByRole("listitem");
	const found = items.find((item) => item.getAttribute("data-server") === id);
	if (!found) throw new Error(`no server item for ${id}`);
	return found;
}

describe("ServerStatusList", () => {
	it("is a polite live region so a connection change is announced", () => {
		render(<ServerStatusList servers={[FILES]} />);

		expect(
			screen.getByRole("region", { name: "MCP サーバーの状態" }).getAttribute("aria-live"),
		).toBe("polite");
	});

	it("says there is no server when the list is empty", () => {
		render(<ServerStatusList servers={[]} />);

		expect(screen.getByText("接続先の MCP サーバーはありません。")).toBeTruthy();
		expect(screen.queryByRole("list", { name: "MCP サーバー" })).toBeNull();
	});

	it("shows each server with its state", () => {
		render(<ServerStatusList servers={[FILES, GITHUB]} />);

		expect(serverItem("files").textContent).toContain("files");
		expect(serverItem("files").textContent).toContain("接続済み");
		expect(serverItem("github").textContent).toContain("github");
		expect(serverItem("github").textContent).toContain("利用不可");
	});

	it("shows why an unavailable server is unavailable", () => {
		render(<ServerStatusList servers={[GITHUB]} />);

		expect(serverItem("github").textContent).toContain("接続がタイムアウトしました。");
	});

	it("does not show a reason line for a connected server", () => {
		render(<ServerStatusList servers={[FILES]} />);

		expect(within(serverItem("files")).queryByText(/原因/)).toBeNull();
	});

	it("states that an unavailable server's tools cannot be used", () => {
		render(<ServerStatusList servers={[GITHUB]} />);

		expect(serverItem("github").textContent).toContain("このサーバーのツールは使えません");
	});

	it("lists the loaded tools separately from the refused ones", () => {
		render(<ServerStatusList servers={[FILES]} />);

		const loaded = within(screen.getByRole("list", { name: "files の読み込んだツール" }));
		expect(loaded.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
			expect.stringContaining("listFiles"),
			expect.stringContaining("readFile"),
		]);
		const refused = within(screen.getByRole("list", { name: "files の拒否したツール" }));
		expect(refused.getAllByRole("listitem")).toHaveLength(3);
	});

	it("shows the risk class of every tool", () => {
		render(<ServerStatusList servers={[FILES]} />);

		const refused = within(screen.getByRole("list", { name: "files の拒否したツール" }));
		const [deleteItem, writeItem, searchItem] = refused.getAllByRole("listitem");
		expect(deleteItem?.textContent).toContain("destructive");
		expect(writeItem?.textContent).toContain("write");
		expect(searchItem?.textContent).toContain("read-only");
		const loaded = within(screen.getByRole("list", { name: "files の読み込んだツール" }));
		expect(loaded.getAllByRole("listitem")[0]?.textContent).toContain("read-only");
	});

	it.each([
		["deleteFile", "リスク区分が destructive のため登録しません。"],
		["writeFile", "リスク区分が write のため登録しません。"],
		["searchFiles", "説明文の形式が要件を満たしていないため登録しません。"],
	])("shows the reason %s was refused", (name, reason) => {
		render(<ServerStatusList servers={[FILES]} />);

		const refused = within(screen.getByRole("list", { name: "files の拒否したツール" }));
		const item = refused
			.getAllByRole("listitem")
			.find((entry) => entry.textContent?.includes(name));
		expect(item?.textContent).toContain(reason);
	});

	it("shows the reason of a tool missing its annotations as destructive", () => {
		const unannotated: McpServerStatus = {
			id: "files",
			state: "connected",
			tools: [
				{
					name: "mystery",
					risk: "destructive",
					registered: false,
					disabledReason:
						"リスク区分が destructive のため登録しません（read-only にするには、サーバーが readOnlyHint: true を付ける必要があります）。",
				},
			],
		};
		render(<ServerStatusList servers={[unannotated]} />);

		const refused = within(screen.getByRole("list", { name: "files の拒否したツール" }));
		expect(refused.getByRole("listitem").textContent).toContain("readOnlyHint: true");
	});

	it("marks a risky tool in the danger colour and a read-only one not", () => {
		render(<ServerStatusList servers={[FILES]} />);

		const refused = within(screen.getByRole("list", { name: "files の拒否したツール" }));
		const [deleteItem, , searchItem] = refused.getAllByRole("listitem");
		expect(within(deleteItem as HTMLElement).getByText("destructive").className).toContain(
			"bg-destructive",
		);
		expect(within(searchItem as HTMLElement).getByText("read-only").className).not.toContain(
			"bg-destructive",
		);
	});

	it("falls back to a generic reason when a refused tool carries none", () => {
		const bare: McpServerStatus = {
			id: "files",
			state: "connected",
			tools: [{ name: "odd", risk: "destructive", registered: false }],
		};
		render(<ServerStatusList servers={[bare]} />);

		const refused = within(screen.getByRole("list", { name: "files の拒否したツール" }));
		expect(refused.getByRole("listitem").textContent).toContain("理由は報告されていません");
	});

	it("counts the loaded tools in the server's summary", () => {
		render(<ServerStatusList servers={[FILES]} />);

		expect(serverItem("files").textContent).toContain("読み込み 2 個 / 拒否 3 個");
	});

	it("says so when a connected server has no loaded tool", () => {
		const none: McpServerStatus = {
			id: "files",
			state: "connected",
			tools: [{ name: "deleteFile", risk: "destructive", registered: false, disabledReason: "x" }],
		};
		render(<ServerStatusList servers={[none]} />);

		expect(serverItem("files").textContent).toContain("読み込んだツールはありません。");
		expect(screen.queryByRole("list", { name: "files の読み込んだツール" })).toBeNull();
	});

	it("omits the refused list when nothing was refused", () => {
		const clean: McpServerStatus = {
			id: "files",
			state: "connected",
			tools: [{ name: "listFiles", risk: "read-only", registered: true }],
		};
		render(<ServerStatusList servers={[clean]} />);

		expect(screen.queryByRole("list", { name: "files の拒否したツール" })).toBeNull();
		expect(screen.queryByText("拒否したツール")).toBeNull();
	});

	it("names an unavailable server that still lists its tools as disconnected", () => {
		const dropped: McpServerStatus = {
			id: "files",
			state: "unavailable",
			reason: "接続が切断されました。",
			tools: [
				{
					name: "listFiles",
					risk: "read-only",
					registered: false,
					disabledReason: "サーバーが切断されました。",
				},
			],
		};
		render(<ServerStatusList servers={[dropped]} />);

		expect(serverItem("files").textContent).toContain("接続が切断されました。");
		expect(serverItem("files").textContent).toContain("サーバーが切断されました。");
	});
});
