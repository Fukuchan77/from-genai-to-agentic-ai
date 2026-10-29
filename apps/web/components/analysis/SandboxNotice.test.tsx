import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SandboxNotice } from "./SandboxNotice";

afterEach(cleanup);

describe("SandboxNotice", () => {
	it("tells which sandbox the analysis will use, politely, for each enabled kind (Req 3.8)", () => {
		const { rerender } = render(<SandboxNotice sandbox={{ kind: "e2b" }} />);
		expect(screen.getByRole("status").textContent).toContain("E2B");

		rerender(<SandboxNotice sandbox={{ kind: "docker" }} />);
		expect(screen.getByRole("status").textContent).toContain("Docker");

		rerender(<SandboxNotice sandbox={{ kind: "mock" }} />);
		expect(screen.getByRole("status").textContent).toContain("疑似");
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("shows the server's reason and guidance when the analysis is disabled (Req 3.8)", () => {
		render(
			<SandboxNotice
				sandbox={{
					kind: "disabled",
					reason: "サーバー側の理由 R1",
					guidance: "サーバー側の案内 G1: SERVER_SETTING を設定してください",
				}}
			/>,
		);

		const notice = screen.getByRole("status");
		expect(screen.getByText("分析エージェントは無効です")).toBeTruthy();
		expect(notice.textContent).toContain("サーバー側の理由 R1");
		expect(notice.textContent).toContain("サーバー側の案内 G1: SERVER_SETTING を設定してください");
	});

	it("does not announce an enabled sandbox as a disabled one", () => {
		render(<SandboxNotice sandbox={{ kind: "docker" }} />);

		expect(screen.queryByText("分析エージェントは無効です")).toBeNull();
	});

	it("does not hard-code any environment variable name (client bundle check)", () => {
		const source = readFileSync(
			resolve(process.cwd(), "components/analysis/SandboxNotice.tsx"),
			"utf8",
		);

		expect(source).not.toMatch(/[A-Z][A-Z0-9]+_[A-Z0-9_]+/u);
	});
});
