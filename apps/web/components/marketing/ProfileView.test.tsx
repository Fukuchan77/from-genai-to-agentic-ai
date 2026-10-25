import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProfileView, type ProfileViewData } from "./ProfileView";

afterEach(cleanup);

const PROFILE: ProfileViewData = {
	interests: ["コーヒー", "キャンプ"],
	budgetYen: 12000,
	concerns: ["送料", "返品"],
};

function region() {
	return screen.getByRole("region", { name: "お客様のプロファイル" });
}

describe("ProfileView", () => {
	it("announces updates through a polite live region", () => {
		render(<ProfileView profile={PROFILE} />);

		expect(region().getAttribute("aria-live")).toBe("polite");
	});

	it("lists the interests, the budget and the concerns", () => {
		render(<ProfileView profile={PROFILE} />);

		const interests = within(screen.getByRole("list", { name: "関心事" })).getAllByRole("listitem");
		expect(interests.map((item) => item.textContent)).toEqual(["コーヒー", "キャンプ"]);
		const concerns = within(screen.getByRole("list", { name: "懸念点" })).getAllByRole("listitem");
		expect(concerns.map((item) => item.textContent)).toEqual(["送料", "返品"]);
		expect(within(region()).getByText("予算")).toBeTruthy();
		expect(within(region()).getByText("12,000 円")).toBeTruthy();
	});

	it("says what is not known yet", () => {
		render(<ProfileView profile={{ interests: [], budgetYen: null, concerns: [] }} />);

		expect(screen.queryByRole("list", { name: "関心事" })).toBeNull();
		expect(screen.queryByRole("list", { name: "懸念点" })).toBeNull();
		expect(within(region()).getByText("予算")).toBeTruthy();
		expect(within(region()).getByText("未確認")).toBeTruthy();
		expect(within(region()).getAllByText("まだ分かっていません")).toHaveLength(2);
	});

	it("shows a zero budget as a budget, not as unknown", () => {
		render(<ProfileView profile={{ interests: [], budgetYen: 0, concerns: [] }} />);

		expect(within(region()).getByText("0 円")).toBeTruthy();
		expect(within(region()).queryByText("未確認")).toBeNull();
	});

	it("shows the first conversation turn before any profile arrives", () => {
		render(<ProfileView profile={undefined} />);

		expect(
			within(region()).getByText("会話が始まると、ここに分かったことが表示されます"),
		).toBeTruthy();
		expect(screen.queryByRole("list", { name: "関心事" })).toBeNull();
	});

	it("replaces the old values when the profile is updated", () => {
		const { rerender } = render(<ProfileView profile={PROFILE} />);

		rerender(
			<ProfileView profile={{ interests: ["登山"], budgetYen: 8000, concerns: ["送料"] }} />,
		);

		const interests = within(screen.getByRole("list", { name: "関心事" })).getAllByRole("listitem");
		expect(interests.map((item) => item.textContent)).toEqual(["登山"]);
		expect(within(region()).getByText("8,000 円")).toBeTruthy();
		expect(within(region()).queryByText("12,000 円")).toBeNull();
		expect(within(region()).queryByText("キャンプ")).toBeNull();
	});

	it("renders values as plain text, never as HTML", () => {
		const { container } = render(
			<ProfileView
				profile={{ interests: ["<b>太字</b>"], budgetYen: null, concerns: ["<img src=x>"] }}
			/>,
		);

		expect(container.querySelector("b")).toBeNull();
		expect(container.querySelector("img")).toBeNull();
		expect(within(region()).getByText("<b>太字</b>")).toBeTruthy();
	});
});
