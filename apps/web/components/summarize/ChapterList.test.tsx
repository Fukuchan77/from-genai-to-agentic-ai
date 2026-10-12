import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ChapterList, formatTimestamp } from "./ChapterList";

afterEach(cleanup);

describe("formatTimestamp", () => {
	it.each([
		[0, "00:00"],
		[5, "00:05"],
		[90, "01:30"],
		[599, "09:59"],
		[3599, "59:59"],
		[3600, "1:00:00"],
		[3725, "1:02:05"],
		[36_000, "10:00:00"],
		[61.9, "01:01"],
	])("formats %s seconds as %s", (seconds, expected) => {
		expect(formatTimestamp(seconds)).toBe(expected);
	});

	it("clamps negative and non-finite values to 00:00", () => {
		expect(formatTimestamp(-4)).toBe("00:00");
		expect(formatTimestamp(Number.NaN)).toBe("00:00");
		expect(formatTimestamp(Number.POSITIVE_INFINITY)).toBe("00:00");
	});
});

describe("ChapterList", () => {
	it("lists each chapter's start time and heading in order (Req 4.10)", () => {
		render(
			<ChapterList
				chapters={[
					{ heading: "導入", startSeconds: 0 },
					{ heading: "実装", startSeconds: 90 },
					{ heading: "まとめ", startSeconds: 3725 },
				]}
			/>,
		);

		const list = screen.getByRole("list", { name: "チャプター" });
		const items = Array.from(list.querySelectorAll("li"));
		expect(items.map((item) => item.textContent)).toEqual([
			"00:00導入",
			"01:30実装",
			"1:02:05まとめ",
		]);
		const time = items[1]?.querySelector("time");
		expect(time?.getAttribute("datetime")).toBe("PT90S");
	});

	it("shows skeletons for the fields of a chapter that has not been generated yet", () => {
		const { container } = render(
			<ChapterList chapters={[{ heading: "導入" }, { startSeconds: 30 }]} />,
		);

		const skeletons = container.querySelectorAll('[data-slot="skeleton"]');
		expect(skeletons).toHaveLength(2);
		for (const skeleton of skeletons) expect(skeleton.getAttribute("aria-hidden")).toBe("true");
		expect(screen.getByText("導入")).toBeTruthy();
		expect(screen.getByText("00:30")).toBeTruthy();
	});

	it("renders nothing for an empty list", () => {
		const { container } = render(<ChapterList chapters={[]} />);
		expect(container.firstChild).toBeNull();
	});
});
