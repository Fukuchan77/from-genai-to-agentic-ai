import type { McpAllowList, McpServerStatus } from "@platform/ai-core/mcp";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AllowListEditor } from "./AllowListEditor";

afterEach(cleanup);

const FILES: McpServerStatus = {
	id: "files",
	state: "connected",
	tools: [
		{ name: "listFiles", risk: "read-only", registered: true },
		{ name: "readFile", risk: "read-only", registered: true },
		{ name: "searchFiles", risk: "read-only", registered: true },
		{
			name: "deleteFile",
			risk: "destructive",
			registered: false,
			disabledReason: "リスク区分が destructive のため登録しません。",
		},
	],
};
const GITHUB: McpServerStatus = {
	id: "github",
	state: "connected",
	tools: [{ name: "get_issue", risk: "read-only", registered: true }],
};
const DOWN: McpServerStatus = { id: "down", state: "unavailable", reason: "x", tools: [] };

const ALL: McpAllowList = {
	files: ["listFiles", "readFile", "searchFiles"],
	github: ["get_issue"],
};

interface Overrides {
	servers?: readonly McpServerStatus[];
	value?: McpAllowList;
	maxTools?: number;
	reservedTools?: number;
	disabled?: boolean;
}

function setup(overrides: Overrides = {}) {
	const onChange = vi.fn();
	render(
		<AllowListEditor
			servers={overrides.servers ?? [FILES, GITHUB]}
			value={overrides.value ?? ALL}
			onChange={onChange}
			maxTools={overrides.maxTools ?? 20}
			{...(overrides.reservedTools === undefined ? {} : { reservedTools: overrides.reservedTools })}
			{...(overrides.disabled === undefined ? {} : { disabled: overrides.disabled })}
		/>,
	);
	return { onChange };
}

const box = (name: string) =>
	screen.getByRole("checkbox", { name: new RegExp(name) }) as HTMLInputElement;
const counter = () => screen.getByRole("status", { name: "選択中のツール数" });

describe("AllowListEditor", () => {
	it("offers one labelled checkbox per loadable tool, grouped by server", () => {
		setup();

		const files = within(screen.getByRole("group", { name: "files" }));
		expect(
			files.getAllByRole("checkbox").map((entry) => (entry as HTMLInputElement).value),
		).toEqual(["listFiles", "readFile", "searchFiles"]);
		const github = within(screen.getByRole("group", { name: "github" }));
		expect(github.getAllByRole("checkbox")).toHaveLength(1);
	});

	it("does not offer a tool the server refused", () => {
		setup();

		expect(screen.queryByRole("checkbox", { name: /deleteFile/ })).toBeNull();
	});

	it("shows which tools are selected", () => {
		setup({ value: { files: ["readFile"], github: [] } });

		expect(box("listFiles").checked).toBe(false);
		expect(box("readFile").checked).toBe(true);
		expect(box("get_issue").checked).toBe(false);
	});

	it("passes the whole allow-list on when a tool is switched off", () => {
		const { onChange } = setup();

		fireEvent.click(box("readFile"));

		expect(onChange).toHaveBeenCalledTimes(1);
		expect(onChange).toHaveBeenCalledWith({
			files: ["listFiles", "searchFiles"],
			github: ["get_issue"],
		});
	});

	it("passes the whole allow-list on when a tool is switched on, in the server's order", () => {
		const { onChange } = setup({ value: { files: ["searchFiles"], github: [] } });

		fireEvent.click(box("listFiles"));

		expect(onChange).toHaveBeenCalledWith({ files: ["listFiles", "searchFiles"], github: [] });
	});

	it("keeps a server with nothing selected in the list as an empty entry", () => {
		const { onChange } = setup({ value: { files: ["listFiles"], github: ["get_issue"] } });

		fireEvent.click(box("listFiles"));

		expect(onChange).toHaveBeenCalledWith({ files: [], github: ["get_issue"] });
	});

	it("says an unavailable server cannot offer tools, without checkboxes", () => {
		setup({ servers: [FILES, DOWN], value: { files: [] } });

		const group = within(screen.getByRole("group", { name: "down" }));
		expect(group.getByText("利用不可のため、ツールを選べません。")).toBeTruthy();
		expect(group.queryByRole("checkbox")).toBeNull();
	});

	it("says there is nothing to edit without a server", () => {
		setup({ servers: [], value: {} });

		expect(screen.getByText("許可リストを編集できるサーバーはありません。")).toBeTruthy();
	});

	it("disables every control while a run is in progress", () => {
		setup({ disabled: true });

		for (const entry of screen.getAllByRole("checkbox")) {
			expect((entry as HTMLInputElement).disabled).toBe(true);
		}
		expect((screen.getByRole("button", { name: "既定に戻す" }) as HTMLButtonElement).disabled).toBe(
			true,
		);
	});
});

describe("AllowListEditor limit", () => {
	it("shows the number selected against the limit in a polite live region", () => {
		setup();

		expect(counter().textContent).toContain("選択中 4 / 20 個");
		expect(counter().getAttribute("aria-live")).toBe("polite");
	});

	it("counts the built-in tools against the same limit", () => {
		setup({ reservedTools: 1 });

		expect(counter().textContent).toContain("選択中 5 / 20 個");
		expect(counter().textContent).toContain("組み込みツール 1 個を含む");
	});

	it("does not mention built-in tools when there are none", () => {
		setup();

		expect(counter().textContent).not.toContain("組み込み");
	});

	it("stops offering more tools once the limit is reached", () => {
		setup({ maxTools: 4 });

		expect(counter().textContent).toContain("上限の 4 個に達しました");
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("disables only the unselected tools at the limit, so the learner can still switch one off", () => {
		setup({ maxTools: 2, value: { files: ["listFiles", "readFile"], github: [] } });

		expect(box("searchFiles").disabled).toBe(true);
		expect(box("get_issue").disabled).toBe(true);
		expect(box("listFiles").disabled).toBe(false);
		expect(box("readFile").disabled).toBe(false);
	});

	it("keeps unselected tools enabled one below the limit", () => {
		setup({ maxTools: 3, value: { files: ["listFiles", "readFile"], github: [] } });

		expect(box("searchFiles").disabled).toBe(false);
		expect(counter().textContent).not.toContain("上限");
	});

	it("counts the built-in tools when deciding the limit is reached", () => {
		setup({
			maxTools: 3,
			reservedTools: 1,
			value: { files: ["listFiles", "readFile"], github: [] },
		});

		expect(box("searchFiles").disabled).toBe(true);
	});

	it("frees a slot again after a tool is switched off", () => {
		const onChange = vi.fn();
		const { rerender } = render(
			<AllowListEditor
				servers={[FILES, GITHUB]}
				value={{ files: ["listFiles", "readFile"], github: [] }}
				onChange={onChange}
				maxTools={2}
			/>,
		);
		expect(box("searchFiles").disabled).toBe(true);

		rerender(
			<AllowListEditor
				servers={[FILES, GITHUB]}
				value={{ files: ["listFiles"], github: [] }}
				onChange={onChange}
				maxTools={2}
			/>,
		);

		expect(box("searchFiles").disabled).toBe(false);
	});

	it("raises an alert when the value already exceeds the limit", () => {
		setup({ maxTools: 3 });

		expect(screen.getByRole("alert").textContent).toContain("上限の 3 個を超えています");
		expect(counter().textContent).not.toContain("達しました");
	});

	it("raises no alert within the limit", () => {
		setup();

		expect(screen.queryByRole("alert")).toBeNull();
	});
});

describe("AllowListEditor keyboard", () => {
	// jsdom has no Tab key handling, so the tab order is read from the DOM: the controls a browser
	// would stop at, in document order. A native checkbox or button answers Space / Enter with a
	// click, which is what the other tests send.
	function tabStops(): HTMLElement[] {
		return Array.from(
			document.querySelectorAll<HTMLElement>("input, button, a[href], [tabindex]"),
		).filter((element) => !(element as HTMLInputElement).disabled && element.tabIndex >= 0);
	}

	it("puts every checkbox and the reset button in the tab order, in reading order", () => {
		setup();

		expect(
			tabStops().map((element) => element.getAttribute("value") ?? element.textContent),
		).toEqual(["listFiles", "readFile", "searchFiles", "get_issue", "既定に戻す"]);
	});

	it("takes keyboard focus on a checkbox and on the reset button", () => {
		setup();

		box("readFile").focus();
		expect(document.activeElement).toBe(box("readFile"));
		screen.getByRole("button", { name: "既定に戻す" }).focus();
		expect(document.activeElement).toBe(screen.getByRole("button", { name: "既定に戻す" }));
	});

	it("leaves the checkboxes the limit disabled out of the tab order and cannot focus them", () => {
		setup({ maxTools: 2, value: { files: ["listFiles", "readFile"], github: [] } });

		expect(
			tabStops().map((element) => element.getAttribute("value") ?? element.textContent),
		).toEqual(["listFiles", "readFile", "既定に戻す"]);
		box("searchFiles").focus();
		expect(document.activeElement).not.toBe(box("searchFiles"));
	});

	it("restores the default from the reset button", () => {
		const { onChange } = setup({ value: { files: [], github: [] } });

		fireEvent.click(screen.getByRole("button", { name: "既定に戻す" }));

		expect(onChange).toHaveBeenCalledWith(ALL);
	});

	it("restores only what fits when the default would exceed the limit", () => {
		const { onChange } = setup({ maxTools: 2, value: { files: [], github: [] } });

		fireEvent.click(screen.getByRole("button", { name: "既定に戻す" }));

		expect(onChange).toHaveBeenCalledWith({ files: ["listFiles", "readFile"], github: [] });
	});

	it("restores nothing when the built-in tools alone exceed the limit", () => {
		const { onChange } = setup({ maxTools: 1, reservedTools: 2, value: { files: [], github: [] } });

		fireEvent.click(screen.getByRole("button", { name: "既定に戻す" }));

		expect(onChange).toHaveBeenCalledWith({ files: [], github: [] });
	});

	it("keeps room for the built-in tools when it restores the default", () => {
		const { onChange } = setup({ maxTools: 2, reservedTools: 1, value: { files: [], github: [] } });

		fireEvent.click(screen.getByRole("button", { name: "既定に戻す" }));

		expect(onChange).toHaveBeenCalledWith({ files: ["listFiles"], github: [] });
	});
});
