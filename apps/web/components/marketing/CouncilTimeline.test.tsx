import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
	type CouncilResultView,
	CouncilTimeline,
	type CouncilTurnView,
	type CouncilVerdictView,
	confirmedRoundTurns,
} from "./CouncilTimeline";

afterEach(cleanup);

function turn(round: number, personaName: string, text: string, failed = false): CouncilTurnView {
	return {
		id: `${round}-${personaName}`,
		round,
		personaId: `p-${personaName}`,
		personaName,
		text,
		failed,
	};
}

function verdict(round: number, over: Partial<CouncilVerdictView> = {}): CouncilVerdictView {
	return { round, agreed: false, reason: "価格が不明確です", remainingObjections: [], ...over };
}

function result(over: Partial<CouncilResultView> = {}): CouncilResultView {
	return {
		improvedDraft: "改善後の文案です",
		endReason: "agreed",
		rounds: [],
		...over,
	};
}

function roundSection(round: number) {
	return screen.getByRole("region", { name: `ラウンド ${round}` });
}

describe("CouncilTimeline", () => {
	it("announces additions through a polite live region", () => {
		render(<CouncilTimeline turns={[]} verdicts={[]} />);

		expect(screen.getByRole("log", { name: "合議の経過" }).getAttribute("aria-live")).toBe(
			"polite",
		);
	});

	it("shows each statement under its persona's name", () => {
		render(
			<CouncilTimeline
				turns={[
					turn(1, "節約家", "もう少し安く見せたい"),
					turn(1, "新しもの好き", "新機能を前に出す"),
				]}
				verdicts={[]}
			/>,
		);

		const section = roundSection(1);
		const names = within(section)
			.getAllByRole("heading", { level: 4 })
			.map((heading) => heading.textContent);
		expect(names).toEqual(["節約家", "新しもの好き"]);
		expect(within(section).getByText("もう少し安く見せたい")).toBeTruthy();
		expect(within(section).getByText("新機能を前に出す")).toBeTruthy();
	});

	it("separates the rounds in order and keeps each statement in its own round", () => {
		render(
			<CouncilTimeline
				turns={[turn(1, "節約家", "一回目の発言"), turn(2, "節約家", "二回目の発言")]}
				verdicts={[verdict(1)]}
			/>,
		);

		const sections = screen.getAllByRole("region", { name: /^ラウンド / });
		expect(sections.map((section) => section.getAttribute("aria-label"))).toEqual([
			"ラウンド 1",
			"ラウンド 2",
		]);
		expect(within(roundSection(1)).queryByText("二回目の発言")).toBeNull();
		expect(within(roundSection(2)).getByText("二回目の発言")).toBeTruthy();
	});

	it("shows a round that disagreed with its reason and remaining objections", () => {
		render(
			<CouncilTimeline
				turns={[turn(1, "節約家", "x")]}
				verdicts={[
					verdict(1, {
						agreed: false,
						reason: "価格が不明確です",
						remainingObjections: ["送料", "返品"],
					}),
				]}
			/>,
		);

		const section = roundSection(1);
		expect(within(section).getByText("合意に至っていません")).toBeTruthy();
		expect(within(section).getByText(/価格が不明確です/)).toBeTruthy();
		const objections = within(
			within(section).getByRole("list", { name: "残っている懸念" }),
		).getAllByRole("listitem");
		expect(objections.map((item) => item.textContent)).toEqual(["送料", "返品"]);
	});

	it("shows a round that agreed, without an objections list", () => {
		render(
			<CouncilTimeline
				turns={[turn(1, "節約家", "x")]}
				verdicts={[verdict(1, { agreed: true, reason: "全員が納得しました" })]}
			/>,
		);

		const section = roundSection(1);
		expect(within(section).getByText("合意しました")).toBeTruthy();
		expect(within(section).queryByText("合意に至っていません")).toBeNull();
		expect(within(section).queryByRole("list", { name: "残っている懸念" })).toBeNull();
	});

	it("orders the rounds by number even when a later round arrives first", () => {
		render(
			<CouncilTimeline
				turns={[turn(2, "節約家", "二回目")]}
				verdicts={[]}
				result={result({ rounds: [{ round: 1, statements: 1, missing: [] }] })}
			/>,
		);

		const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
		expect(headings.slice(0, 2)).toEqual(["ラウンド 1", "ラウンド 2"]);
	});

	it("shows a round that only the result lists, with the verdict it carries", () => {
		render(
			<CouncilTimeline
				turns={[]}
				verdicts={[]}
				result={result({
					rounds: [
						{
							round: 1,
							statements: 2,
							missing: [],
							verdict: verdict(1, { agreed: true, reason: "同意" }),
						},
					],
				})}
			/>,
		);

		const section = roundSection(1);
		expect(within(section).getByRole("heading", { level: 3, name: "ラウンド 1" })).toBeTruthy();
		expect(within(section).getByText("合意しました")).toBeTruthy();
	});

	it("marks a round that is still running until its verdict arrives", () => {
		render(<CouncilTimeline turns={[turn(1, "節約家", "x")]} verdicts={[]} />);

		expect(within(roundSection(1)).getByText("判定を待っています")).toBeTruthy();
	});

	it("explains a silent persona instead of an empty statement", () => {
		render(<CouncilTimeline turns={[turn(1, "節約家", "", true)]} verdicts={[]} />);

		const section = roundSection(1);
		expect(within(section).getByRole("heading", { level: 4, name: "節約家" })).toBeTruthy();
		expect(within(section).getByText("発言できませんでした")).toBeTruthy();
	});

	it("shows a round that ended without a verdict once the result says so", () => {
		render(
			<CouncilTimeline
				turns={[turn(1, "節約家", "x")]}
				verdicts={[]}
				result={result({
					endReason: "budget-exhausted",
					rounds: [{ round: 1, statements: 1, missing: [] }],
				})}
			/>,
		);

		const section = roundSection(1);
		expect(within(section).getByText("判定なし")).toBeTruthy();
		expect(within(section).queryByText("判定を待っています")).toBeNull();
	});

	it("lists the personas who stayed silent in a settled round with the reason", () => {
		render(
			<CouncilTimeline
				turns={[turn(1, "節約家", "x"), turn(1, "新しもの好き", "", true)]}
				verdicts={[verdict(1)]}
				result={result({
					endReason: "max-rounds",
					rounds: [
						{
							round: 1,
							statements: 1,
							missing: [
								{ personaId: "p-新しもの好き", personaName: "新しもの好き", reason: "timeout" },
							],
							verdict: verdict(1),
						},
					],
				})}
			/>,
		);

		expect(within(roundSection(1)).getByText(/発言なし: 新しもの好き（timeout）/)).toBeTruthy();
	});

	it("shows the improved draft and why the council ended", () => {
		render(
			<CouncilTimeline
				turns={[turn(1, "節約家", "x")]}
				verdicts={[verdict(1, { agreed: true, reason: "ok" })]}
				result={result({ improvedDraft: "送料無料でお届けします", endReason: "agreed" })}
			/>,
		);

		const summary = screen.getByRole("region", { name: "合議の結果" });
		expect(within(summary).getByText("合意に達したため終了しました")).toBeTruthy();
		expect(within(summary).getByRole("heading", { name: "改善後の文案" })).toBeTruthy();
		expect(within(summary).getByText("送料無料でお届けします")).toBeTruthy();
	});

	it.each([
		["agreed", "合意に達したため終了しました"],
		["max-rounds", "ラウンドの上限に達したため終了しました"],
		["budget-exhausted", "トークンの予算を使い切ったため終了しました"],
	] as const)("labels the end reason %s", (endReason, label) => {
		render(<CouncilTimeline turns={[]} verdicts={[]} result={result({ endReason })} />);

		const summary = screen.getByRole("region", { name: "合議の結果" });
		expect(within(summary).getByText(label)).toBeTruthy();
	});

	it("draws no result before the council ends", () => {
		render(<CouncilTimeline turns={[turn(1, "節約家", "x")]} verdicts={[]} />);

		expect(screen.queryByRole("region", { name: "合議の結果" })).toBeNull();
		expect(screen.queryByRole("heading", { name: "改善後の文案" })).toBeNull();
	});

	it("renders a statement and a draft as plain text, never as HTML", () => {
		const html = '<img src=x onerror="alert(1)"><script>alert(2)</script><b>強調</b>';
		const { container } = render(
			<CouncilTimeline
				turns={[turn(1, "節約家", html)]}
				verdicts={[]}
				result={result({ improvedDraft: html })}
			/>,
		);

		expect(container.querySelector("img")).toBeNull();
		expect(container.querySelector("script")).toBeNull();
		expect(container.querySelector("b")).toBeNull();
		expect(within(roundSection(1)).getByText(html)).toBeTruthy();
		expect(within(screen.getByRole("region", { name: "合議の結果" })).getByText(html)).toBeTruthy();
	});

	it("keeps line breaks of a statement visible", () => {
		render(<CouncilTimeline turns={[turn(1, "節約家", "一行目\n二行目")]} verdicts={[]} />);

		expect(screen.getByText(/一行目/).className).toContain("whitespace-pre-wrap");
	});
});

describe("confirmedRoundTurns", () => {
	const turns = [turn(1, "a", "r1"), turn(2, "a", "r2"), turn(3, "a", "r3")];

	it("keeps only the rounds whose verdict arrived", () => {
		const kept = confirmedRoundTurns({ turns, verdicts: [verdict(1), verdict(2)] });

		expect(kept.map((item) => item.round)).toEqual([1, 2]);
	});

	it("drops every statement when no round was confirmed", () => {
		expect(confirmedRoundTurns({ turns, verdicts: [] })).toEqual([]);
	});

	it("also keeps a round that the result lists but that has no verdict", () => {
		const kept = confirmedRoundTurns({
			turns,
			verdicts: [verdict(1)],
			result: result({
				rounds: [
					{ round: 1, statements: 1, missing: [] },
					{ round: 2, statements: 1, missing: [] },
				],
			}),
		});

		expect(kept.map((item) => item.round)).toEqual([1, 2]);
	});

	it("drops a round that neither has a verdict nor is listed by the result", () => {
		const kept = confirmedRoundTurns({ turns, verdicts: [], result: result({ rounds: [] }) });

		expect(kept).toEqual([]);
	});

	it("does not change the input", () => {
		const input = [...turns];
		confirmedRoundTurns({ turns: input, verdicts: [verdict(1)] });

		expect(input).toEqual(turns);
	});
});
