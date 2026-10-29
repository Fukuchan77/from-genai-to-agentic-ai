import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DocumentDownload, type RequirementsJudgement } from "./DocumentDownload";

afterEach(cleanup);

const SESSION = "11111111-2222-4333-8444-555555555555";

const INSUFFICIENT: RequirementsJudgement = {
	round: 1,
	sufficient: false,
	missing: ["予算の上限", "利用者数"],
	forcedEnd: false,
};
const SUFFICIENT: RequirementsJudgement = {
	round: 2,
	sufficient: true,
	missing: [],
	forcedEnd: false,
};
const FORCED: RequirementsJudgement = {
	round: 5,
	sufficient: false,
	missing: ["予算の上限"],
	forcedEnd: true,
};

function verdictRegion() {
	return screen.getByRole("region", { name: "十分性の判定" });
}

describe("DocumentDownload", () => {
	it("announces the verdict through a polite live region", () => {
		render(<DocumentDownload sessionId={SESSION} judgement={INSUFFICIENT} documentReady={false} />);

		expect(verdictRegion().getAttribute("aria-live")).toBe("polite");
	});

	it("says no verdict has been made before the first round ends", () => {
		render(<DocumentDownload sessionId={SESSION} judgement={null} documentReady={false} />);

		expect(within(verdictRegion()).getByText(/まだ判定されていません/)).toBeTruthy();
		expect(within(verdictRegion()).queryByRole("list")).toBeNull();
	});

	it("lists every missing item when the information is insufficient", () => {
		render(<DocumentDownload sessionId={SESSION} judgement={INSUFFICIENT} documentReady={false} />);

		const region = verdictRegion();
		expect(within(region).getByText(/第 1 ラウンド/)).toBeTruthy();
		expect(within(region).getByText(/不足/)).toBeTruthy();
		const items = within(within(region).getByRole("list", { name: "不足項目" })).getAllByRole(
			"listitem",
		);
		expect(items.map((item) => item.textContent)).toEqual(["予算の上限", "利用者数"]);
	});

	it("reports sufficient information without a missing list", () => {
		render(<DocumentDownload sessionId={SESSION} judgement={SUFFICIENT} documentReady />);

		const region = verdictRegion();
		expect(within(region).getByText(/十分/)).toBeTruthy();
		expect(within(region).queryByRole("list")).toBeNull();
	});

	it("explains a forced end at the round limit and still lists what is missing", () => {
		render(<DocumentDownload sessionId={SESSION} judgement={FORCED} documentReady />);

		const region = verdictRegion();
		expect(within(region).getByText(/ラウンド数の上限に達した/)).toBeTruthy();
		expect(within(region).getByText(/未確認事項/)).toBeTruthy();
		expect(within(region).getByRole("list", { name: "不足項目" })).toBeTruthy();
	});

	it("disables the download button until the document exists, and says why", () => {
		render(<DocumentDownload sessionId={SESSION} judgement={INSUFFICIENT} documentReady={false} />);

		const button = screen.getByRole("button", { name: "requirements.md をダウンロード" });
		expect(button.hasAttribute("disabled")).toBe(true);
		expect(screen.queryByRole("link", { name: /ダウンロード/ })).toBeNull();
		const reason = document.getElementById(button.getAttribute("aria-describedby") ?? "");
		expect(reason?.textContent).toContain("面接が終わる");
	});

	it("keeps the button disabled when there is no session yet, even if ready is claimed", () => {
		render(<DocumentDownload sessionId={null} judgement={null} documentReady />);

		const button = screen.getByRole("button", { name: "requirements.md をダウンロード" });
		expect(button.hasAttribute("disabled")).toBe(true);
	});

	it("offers requirements.md from the session's document endpoint once it exists", () => {
		render(<DocumentDownload sessionId={SESSION} judgement={SUFFICIENT} documentReady />);

		const link = screen.getByRole("link", { name: "requirements.md をダウンロード" });
		expect(link.getAttribute("href")).toBe(`/api/requirements/sessions/${SESSION}/document`);
		expect(link.getAttribute("download")).toBe("requirements.md");
		expect(screen.queryByRole("button", { name: /ダウンロード/ })).toBeNull();
	});

	it("encodes the session id in the URL path", () => {
		render(<DocumentDownload sessionId="a/b?c" judgement={SUFFICIENT} documentReady />);

		const link = screen.getByRole("link", { name: /ダウンロード/ });
		expect(link.getAttribute("href")).toBe("/api/requirements/sessions/a%2Fb%3Fc/document");
	});

	it("is focusable by keyboard once enabled, and not while disabled", () => {
		const { rerender } = render(
			<DocumentDownload sessionId={SESSION} judgement={INSUFFICIENT} documentReady={false} />,
		);
		const disabled = screen.getByRole("button", { name: /ダウンロード/ });
		disabled.focus();
		expect(document.activeElement).not.toBe(disabled);

		rerender(<DocumentDownload sessionId={SESSION} judgement={SUFFICIENT} documentReady />);
		const link = screen.getByRole("link", { name: /ダウンロード/ });
		link.focus();
		expect(document.activeElement).toBe(link);
		expect(link.getAttribute("tabindex")).not.toBe("-1");
	});
});
