import {
	CALCULATOR_TOOL_NAME,
	CURRENCY_CONVERT_TOOL_NAME,
	CURRENT_TIME_TOOL_NAME,
	WEATHER_TOOL_NAME,
	WEB_SEARCH_TOOL_NAME,
} from "@platform/ai-core/aci";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RawJsonView } from "./RawJsonView";
import { rendererFor, TOOL_RENDERERS } from "./renderers";

afterEach(cleanup);

describe("TOOL_RENDERERS", () => {
	it("has exactly one renderer for each sample tool name (Req 5.5)", () => {
		expect(Object.keys(TOOL_RENDERERS).sort()).toEqual(
			[
				CURRENT_TIME_TOOL_NAME,
				CALCULATOR_TOOL_NAME,
				CURRENCY_CONVERT_TOOL_NAME,
				WEATHER_TOOL_NAME,
				WEB_SEARCH_TOOL_NAME,
			].sort(),
		);
	});

	it("renders the time card with the zone, local time and weekday", () => {
		const Card = TOOL_RENDERERS.currentTime;
		render(
			<Card
				input={{}}
				data={{
					epochMs: 0,
					iso: "1970-01-01T00:00:00.000Z",
					timeZone: "Asia/Tokyo",
					localDateTime: "1970-01-01 09:00:00",
					weekday: "木",
				}}
			/>,
		);

		expect(screen.getByText("1970-01-01 09:00:00")).toBeTruthy();
		expect(screen.getByText("Asia/Tokyo")).toBeTruthy();
		expect(screen.getByText("木")).toBeTruthy();
	});

	it("renders the calculation card with the expression and result", () => {
		const Card = TOOL_RENDERERS.calculator;
		render(<Card input={{}} data={{ expression: "1 + 2", result: 3 }} />);

		expect(screen.getByText("1 + 2")).toBeTruthy();
		expect(screen.getByText("3")).toBeTruthy();
	});

	it("renders the currency card with amounts, rate and the rate table date", () => {
		const Card = TOOL_RENDERERS.currencyConvert;
		render(
			<Card
				input={{}}
				data={{
					amount: 100,
					from: "USD",
					to: "JPY",
					rate: 150.5,
					converted: 15050,
					asOf: "2026-01-01",
				}}
			/>,
		);

		expect(screen.getByText("100 USD")).toBeTruthy();
		expect(screen.getByText("15,050 JPY")).toBeTruthy();
		expect(screen.getByText("150.5")).toBeTruthy();
		expect(screen.getByText("2026-01-01")).toBeTruthy();
	});

	it("renders the weather card with city, condition and temperature", () => {
		const Card = TOOL_RENDERERS.weather;
		render(
			<Card
				input={{}}
				data={{
					city: "Tokyo",
					cityLabel: "東京",
					latitude: 35.7,
					longitude: 139.7,
					temperatureC: 22.4,
					weatherCode: 0,
					condition: "快晴",
				}}
			/>,
		);

		expect(screen.getByText("東京")).toBeTruthy();
		expect(screen.getByText("快晴")).toBeTruthy();
		expect(screen.getByText("22.4°C")).toBeTruthy();
	});

	it("renders search hits as an ordered list of http(s) links", () => {
		const Card = TOOL_RENDERERS.webSearch;
		render(
			<Card
				input={{}}
				data={{
					query: "ai",
					results: [
						{ title: "First", url: "https://example.com/a", snippet: "alpha", score: 0.9 },
						{ title: "Second", url: "javascript:alert(1)", snippet: "beta", score: 0.5 },
					],
				}}
			/>,
		);

		const first = screen.getByRole("link", { name: /First/u });
		expect(first.getAttribute("href")).toBe("https://example.com/a");
		expect(first.getAttribute("rel")).toContain("noopener");
		expect(screen.getAllByRole("listitem")).toHaveLength(2);
		expect(screen.queryByRole("link", { name: /Second/u })).toBeNull();
		expect(screen.getByText("Second")).toBeTruthy();
	});

	it("falls back to raw JSON when a registered tool's data has an unexpected shape", () => {
		const Card = TOOL_RENDERERS.weather;
		const { container } = render(<Card input={{}} data={{ unexpected: true }} />);

		expect(container.querySelector("pre")?.textContent).toContain('"unexpected": true');
	});
});

describe("card shape guards", () => {
	it("falls back to raw JSON when a numeric field has the wrong type", () => {
		const Card = TOOL_RENDERERS.weather;
		const { container } = render(
			<Card input={{}} data={{ cityLabel: "東京", condition: "快晴", temperatureC: "22" }} />,
		);

		expect(container.querySelector("pre")).not.toBeNull();
		expect(screen.queryByText("東京")).toBeNull();
	});
});

describe("rendererFor", () => {
	it("looks up registered names only, not inherited object keys", () => {
		expect(rendererFor("weather")).toBe(TOOL_RENDERERS.weather);
		expect(rendererFor("constructor")).toBeUndefined();
		expect(rendererFor("toString")).toBeUndefined();
		expect(rendererFor("somethingElse")).toBeUndefined();
	});
});

describe("RawJsonView", () => {
	it("shows pretty-printed JSON as text, never as markup", () => {
		const { container } = render(<RawJsonView label="入力" value={{ a: "<b>x</b>", n: [1, 2] }} />);

		const pre = container.querySelector("pre");
		expect(pre?.textContent).toBe(JSON.stringify({ a: "<b>x</b>", n: [1, 2] }, null, 2));
		expect(container.querySelector("b")).toBeNull();
		expect(screen.getByText("入力")).toBeTruthy();
	});

	it("shows a placeholder when there is no value", () => {
		render(<RawJsonView value={undefined} />);

		expect(screen.getByText("（値なし）")).toBeTruthy();
	});
});
