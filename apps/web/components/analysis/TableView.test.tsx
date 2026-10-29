import type { Table } from "@platform/ai-core/analysis";
import { DEFAULT_ANALYSIS } from "@platform/ai-core/config";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TableView } from "./TableView";

const LIMIT = DEFAULT_ANALYSIS.maxTableRows;

afterEach(cleanup);

const TABLE: Table = {
	caption: "月別の売上",
	columns: ["月", "売上", "備考"],
	rows: [
		["1 月", 1200, "好調"],
		["2 月", 980.5, null],
	],
	totalRows: 2,
};

function numberedRows(count: number): Table["rows"] {
	return Array.from({ length: count }, (_, index) => [`row-${index + 1}`, index + 1]);
}

describe("TableView", () => {
	it("renders a plain table with a caption and column headers", () => {
		render(<TableView maxRows={LIMIT} table={TABLE} />);
		const table = screen.getByRole("table", { name: "月別の売上" });
		const headers = within(table).getAllByRole("columnheader");
		expect(headers.map((header) => header.textContent)).toEqual(["月", "売上", "備考"]);
		for (const header of headers) expect(header.getAttribute("scope")).toBe("col");
		expect(table.querySelector("caption")?.textContent).toBe("月別の売上");
	});

	it("renders every cell, numbers as text and null as a dash", () => {
		render(<TableView maxRows={LIMIT} table={TABLE} />);
		const rows = within(screen.getByRole("table")).getAllByRole("row");
		// One header row plus two body rows.
		expect(rows).toHaveLength(3);
		const cells = (row: HTMLElement) =>
			within(row)
				.getAllByRole("cell")
				.map((cell) => cell.textContent);
		expect(cells(rows[1] as HTMLElement)).toEqual(["1 月", "1200", "好調"]);
		expect(cells(rows[2] as HTMLElement)).toEqual(["2 月", "980.5", "—"]);
	});

	it("shows the row count when nothing was dropped", () => {
		render(<TableView maxRows={LIMIT} table={TABLE} />);
		expect(screen.getByText("2 件中 2 件を表示")).toBeTruthy();
	});

	it("renders at most 200 rows and says how many there were", () => {
		render(
			<TableView maxRows={LIMIT} table={{ ...TABLE, rows: numberedRows(250), totalRows: 250 }} />,
		);
		const rows = within(screen.getByRole("table")).getAllByRole("row");
		expect(rows).toHaveLength(201);
		expect(screen.getByText("row-200")).toBeTruthy();
		expect(screen.queryByText("row-201")).toBeNull();
		expect(screen.getByText("250 件中 200 件を表示")).toBeTruthy();
	});

	it("renders exactly 200 rows without cutting any", () => {
		render(
			<TableView maxRows={LIMIT} table={{ ...TABLE, rows: numberedRows(200), totalRows: 200 }} />,
		);
		expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(201);
		expect(screen.getByText("200 件中 200 件を表示")).toBeTruthy();
	});

	it("reports the code's row count when the server sent fewer rows than it had", () => {
		render(
			<TableView maxRows={LIMIT} table={{ ...TABLE, rows: numberedRows(200), totalRows: 5000 }} />,
		);
		expect(screen.getByText("5000 件中 200 件を表示")).toBeTruthy();
	});

	it("never reports fewer rows in total than it holds", () => {
		render(<TableView maxRows={LIMIT} table={{ ...TABLE, totalRows: 1 }} />);
		expect(screen.getByText("2 件中 2 件を表示")).toBeTruthy();
	});

	it("announces nothing live (the table is static output)", () => {
		const { container } = render(<TableView maxRows={LIMIT} table={TABLE} />);
		expect(container.querySelector("[aria-live]")).toBeNull();
	});

	it("renders an empty table with its header and a zero count", () => {
		render(<TableView maxRows={LIMIT} table={{ ...TABLE, rows: [], totalRows: 0 }} />);
		expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(1);
		expect(screen.getByText("0 件中 0 件を表示")).toBeTruthy();
	});

	it("omits the caption element when the caption is empty", () => {
		const { container } = render(<TableView maxRows={LIMIT} table={{ ...TABLE, caption: "" }} />);
		expect(container.querySelector("caption")).toBeNull();
		expect(screen.getByRole("table")).toBeTruthy();
	});

	it("names the table region even without a caption", () => {
		render(<TableView maxRows={LIMIT} table={{ ...TABLE, caption: "  " }} />);
		expect(screen.getByRole("region", { name: "表" })).toBeTruthy();
	});

	it("trims the caption", () => {
		const { container } = render(
			<TableView maxRows={LIMIT} table={{ ...TABLE, caption: "  月別の売上 \n" }} />,
		);
		expect(container.querySelector("caption")?.textContent).toBe("月別の売上");
	});

	it("puts a scrollable table in the keyboard order", () => {
		render(<TableView maxRows={LIMIT} table={TABLE} />);
		const region = screen.getByRole("region", { name: "月別の売上" });
		expect(region.getAttribute("tabindex")).toBe("0");
		expect(region.contains(screen.getByRole("table"))).toBe(true);
	});

	it("shows markup in cells, headers and captions as plain text", () => {
		const hostile = '<img src=x onerror="alert(1)"><script>alert(1)</script>';
		const { container } = render(
			<TableView
				maxRows={LIMIT}
				table={{ caption: hostile, columns: [hostile], rows: [[hostile]], totalRows: 1 }}
			/>,
		);
		expect(container.querySelector("img")).toBeNull();
		expect(container.querySelector("script")).toBeNull();
		expect(screen.getAllByText(hostile).length).toBeGreaterThanOrEqual(2);
	});
});
