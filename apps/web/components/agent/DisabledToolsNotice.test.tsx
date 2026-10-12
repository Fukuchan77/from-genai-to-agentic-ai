import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DisabledToolsNotice } from "./DisabledToolsNotice";

afterEach(cleanup);

describe("DisabledToolsNotice", () => {
	it("shows each disabled tool with the server's reason and required variables (Req 5.4)", () => {
		render(
			<DisabledToolsNotice
				tools={[
					{ name: "toolA", reason: "理由A", requiredEnv: ["SERVER_VAR_ONE", "SERVER_VAR_TWO"] },
					{ name: "toolB", reason: "理由B", requiredEnv: [] },
				]}
			/>,
		);

		expect(screen.getByRole("status")).toBeTruthy();
		expect(screen.getByText("toolA")).toBeTruthy();
		expect(screen.getByText("理由A")).toBeTruthy();
		expect(screen.getByText("SERVER_VAR_ONE")).toBeTruthy();
		expect(screen.getByText("SERVER_VAR_TWO")).toBeTruthy();
		expect(screen.getByText("toolB")).toBeTruthy();
		expect(screen.getByText("理由B")).toBeTruthy();
		expect(screen.getAllByRole("listitem")).toHaveLength(2);
	});

	it("renders nothing when every tool is enabled", () => {
		const { container } = render(<DisabledToolsNotice tools={[]} />);

		expect(container.innerHTML).toBe("");
	});

	it("does not hard-code any environment variable name (plan C16, client bundle check)", () => {
		const source = readFileSync(
			resolve(process.cwd(), "components/agent/DisabledToolsNotice.tsx"),
			"utf8",
		);

		expect(source).not.toMatch(/[A-Z][A-Z0-9]+_[A-Z0-9_]+/u);
	});
});
