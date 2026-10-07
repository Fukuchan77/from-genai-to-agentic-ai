import { beforeAll, describe, expect, it } from "vitest";
import { ConfigError } from "../../config/load";
import { PlatformError } from "../../errors";
import {
	createFixtureHttpFetcher,
	createFixtureWebSearch,
	type FixtureSet,
	loadFixtureSet,
} from "../../mock/fixtures";
import { createFakeClock } from "../../ports/clock";
import type { FetchInit, HttpFetcher } from "../../ports/http";
import { buildToolSet } from "../tool-set";
import type { AciTool, ToolOutcome, ToolRuntime } from "../types";
import {
	CURRENCY_CONVERT_TOOL_NAME,
	createCurrencyConvertTool,
	DEFAULT_RATE_TABLE,
	parseRateTable,
} from "./currency";
import { CURRENT_TIME_TOOL_NAME, createCurrentTimeTool } from "./current-time";
import { createWeatherTool, openMeteoUrl, WEATHER_TOOL_NAME } from "./weather";
import { createWebSearchTool, WEB_SEARCH_TOOL_NAME } from "./web-search";

async function call<INPUT, OUTPUT>(
	aciTool: AciTool<INPUT, OUTPUT>,
	input: INPUT,
	runtime: ToolRuntime = { clock: createFakeClock(), toolTimeoutMs: 1_000 },
): Promise<ToolOutcome<OUTPUT>> {
	const execute = aciTool.toTool(runtime).execute;
	if (!execute) throw new Error(`${aciTool.name} must be executable`);
	return (await execute(input, {
		toolCallId: "call-1",
		messages: [],
		context: undefined,
	})) as ToolOutcome<OUTPUT>;
}

describe("createCurrentTimeTool", () => {
	const instant = Date.UTC(2026, 9, 7, 3, 4, 5);

	it("reads the time from the injected clock", async () => {
		const clock = createFakeClock(instant);
		const currentTime = createCurrentTimeTool(clock);
		expect(currentTime).toMatchObject({ name: CURRENT_TIME_TOOL_NAME, risk: "read-only" });
		expect(CURRENT_TIME_TOOL_NAME).toBe("currentTime");

		await expect(call(currentTime, {})).resolves.toEqual({
			ok: true,
			data: {
				epochMs: instant,
				iso: "2026-10-07T03:04:05.000Z",
				timeZone: "Asia/Tokyo",
				localDateTime: "2026-10-07 12:04:05",
				weekday: "水",
			},
		});

		clock.advanceBy(60 * 60 * 1_000);
		await expect(call(currentTime, { timeZone: "UTC" })).resolves.toMatchObject({
			ok: true,
			data: { timeZone: "UTC", localDateTime: "2026-10-07 04:04:05", weekday: "水" },
		});
	});

	it("crosses the date line in the requested time zone", async () => {
		const currentTime = createCurrentTimeTool(createFakeClock(instant));
		await expect(call(currentTime, { timeZone: "America/Los_Angeles" })).resolves.toMatchObject({
			ok: true,
			data: { localDateTime: "2026-10-06 20:04:05", weekday: "火" },
		});
	});

	it("returns an unknown time zone as a recoverable failure", async () => {
		const currentTime = createCurrentTimeTool(createFakeClock(instant));
		await expect(call(currentTime, { timeZone: "Mars/Olympus" })).resolves.toEqual({
			ok: false,
			failure: {
				kind: "recoverable",
				summary: "タイムゾーン「Mars/Olympus」は使えません。",
				nextAction: "IANA のタイムゾーン名（例: Asia/Tokyo、UTC）を指定してください。",
			},
		});
	});
});

let fixtures: FixtureSet;

beforeAll(async () => {
	fixtures = await loadFixtureSet();
});

describe("createCurrencyConvertTool", () => {
	const rates = parseRateTable({
		base: "USD",
		asOf: "2026-09-30",
		rates: { USD: 1, JPY: 150, EUR: 0.8 },
	});

	it("converts with the bundled table and reports its reference date", async () => {
		const convert = createCurrencyConvertTool(rates);
		expect(convert).toMatchObject({ name: CURRENCY_CONVERT_TOOL_NAME, risk: "read-only" });
		expect(CURRENCY_CONVERT_TOOL_NAME).toBe("currencyConvert");

		await expect(call(convert, { amount: 100, from: "USD", to: "JPY" })).resolves.toEqual({
			ok: true,
			data: {
				amount: 100,
				from: "USD",
				to: "JPY",
				rate: 150,
				converted: 15000,
				asOf: "2026-09-30",
			},
		});
	});

	it("converts between two non-base currencies and rounds to two decimals", async () => {
		const convert = createCurrencyConvertTool(rates);
		await expect(call(convert, { amount: 1000, from: "jpy", to: "eur" })).resolves.toEqual({
			ok: true,
			data: {
				amount: 1000,
				from: "JPY",
				to: "EUR",
				rate: 0.005333,
				converted: 5.33,
				asOf: "2026-09-30",
			},
		});
	});

	it("returns an unsupported currency as a recoverable failure", async () => {
		const convert = createCurrencyConvertTool(rates);
		await expect(call(convert, { amount: 1, from: "USD", to: "XYZ" })).resolves.toEqual({
			ok: false,
			failure: {
				kind: "recoverable",
				summary: "通貨「XYZ」は換算表にありません。",
				nextAction: "対応している通貨（USD、JPY、EUR）から選んでください。",
			},
		});
	});

	it("uses the bundled table by default", async () => {
		expect(DEFAULT_RATE_TABLE.rates[DEFAULT_RATE_TABLE.base]).toBe(1);
		expect(DEFAULT_RATE_TABLE.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
		expect(Object.keys(DEFAULT_RATE_TABLE.rates)).toEqual(
			expect.arrayContaining(["USD", "JPY", "EUR"]),
		);
		await expect(
			call(createCurrencyConvertTool(), { amount: 1, from: "USD", to: "USD" }),
		).resolves.toMatchObject({ ok: true, data: { converted: 1, asOf: DEFAULT_RATE_TABLE.asOf } });
	});

	it.each([
		["a missing base rate", { base: "USD", asOf: "2026-09-30", rates: { JPY: 150 } }],
		["a base rate other than 1", { base: "USD", asOf: "2026-09-30", rates: { USD: 2 } }],
		["a non-positive rate", { base: "USD", asOf: "2026-09-30", rates: { USD: 1, JPY: 0 } }],
		["an invalid date", { base: "USD", asOf: "yesterday", rates: { USD: 1 } }],
	])("rejects a rate table with %s", (_label, table) => {
		expect(() => parseRateTable(table)).toThrow(ConfigError);
	});
});

describe("createWeatherTool", () => {
	it("builds the Open-Meteo URL the recorded fixture uses", () => {
		expect(openMeteoUrl(35.6762, 139.6503)).toBe(
			"https://api.open-meteo.com/v1/forecast?latitude=35.6762&longitude=139.6503&current=temperature_2m,weather_code",
		);
	});

	it.each(["Tokyo", "tokyo", " 東京 "])(
		"returns the current weather for %j from the HTTP fixture",
		async (city) => {
			const weather = createWeatherTool(createFixtureHttpFetcher(fixtures.http));
			expect(weather).toMatchObject({ name: WEATHER_TOOL_NAME, risk: "read-only" });
			expect(WEATHER_TOOL_NAME).toBe("weather");

			await expect(call(weather, { city })).resolves.toEqual({
				ok: true,
				data: {
					city: "Tokyo",
					cityLabel: "東京",
					latitude: 35.6762,
					longitude: 139.6503,
					temperatureC: 22,
					weatherCode: 0,
					condition: "晴れ",
				},
			});
		},
	);

	it("returns an unknown city as a recoverable failure without fetching", async () => {
		let fetched = false;
		const weather = createWeatherTool({
			fetch: async () => {
				fetched = true;
				throw new Error("must not fetch");
			},
		});
		const outcome = await call(weather, { city: "Atlantis" });
		expect(fetched).toBe(false);
		expect(outcome).toMatchObject({
			ok: false,
			failure: { kind: "recoverable", summary: "都市「Atlantis」の座標が登録されていません。" },
		});
		expect(outcome.ok ? undefined : outcome.failure.nextAction).toContain("Tokyo（東京）");
	});

	it("returns an HTTP error as a recoverable failure", async () => {
		const weather = createWeatherTool(
			createFixtureHttpFetcher([
				{ url: openMeteoUrl(34.6937, 135.5023), status: 503, headers: {}, body: "" },
			]),
		);
		await expect(call(weather, { city: "Osaka" })).resolves.toEqual({
			ok: false,
			failure: {
				kind: "recoverable",
				summary: "天気情報を取得できませんでした（HTTP 503）。",
				nextAction: "時間をおいて再試行するか、天気を調べられないことを伝えてください。",
			},
		});
	});

	it.each([
		["a body that is not JSON", "<html>"],
		["a body without current weather", JSON.stringify({ hourly: {} })],
	])("returns %s as a recoverable failure", async (_label, body) => {
		const weather = createWeatherTool(
			createFixtureHttpFetcher([
				{ url: openMeteoUrl(34.6937, 135.5023), status: 200, headers: {}, body },
			]),
		);
		await expect(call(weather, { city: "大阪" })).resolves.toMatchObject({
			ok: false,
			failure: { kind: "recoverable", summary: "天気情報の応答が想定した形式ではありません。" },
		});
	});

	it("describes an unknown weather code with its number", async () => {
		const weather = createWeatherTool(
			createFixtureHttpFetcher([
				{
					url: openMeteoUrl(34.6937, 135.5023),
					status: 200,
					headers: {},
					body: JSON.stringify({ current: { temperature_2m: 18.5, weather_code: 42 } }),
				},
			]),
		);
		await expect(call(weather, { city: "Osaka" })).resolves.toMatchObject({
			ok: true,
			data: { temperatureC: 18.5, weatherCode: 42, condition: "不明（コード 42）" },
		});
	});

	it("passes the tool's abort signal to the fetcher and times out", async () => {
		const clock = createFakeClock();
		const seen: FetchInit[] = [];
		const hanging: HttpFetcher = {
			fetch: (_url, init) => {
				if (init) seen.push(init);
				return new Promise(() => {});
			},
		};
		const pending = call(
			createWeatherTool(hanging),
			{ city: "Tokyo" },
			{
				clock,
				toolTimeoutMs: 500,
			},
		);
		await Promise.resolve();
		await Promise.resolve();
		clock.advanceBy(500);

		await expect(pending).resolves.toMatchObject({ ok: false, failure: { kind: "timeout" } });
		expect(seen).toHaveLength(1);
		expect(seen[0]?.signal?.aborted).toBe(true);
	});
});

describe("createWebSearchTool", () => {
	it("is registered only when web search is available", () => {
		const webSearch = createWebSearchTool(createFixtureWebSearch(fixtures.webSearch));
		const runtime = { clock: createFakeClock(), toolTimeoutMs: 1_000 };
		expect(webSearch).toMatchObject({
			name: WEB_SEARCH_TOOL_NAME,
			risk: "read-only",
			requiredFeature: "web-search",
		});
		expect(WEB_SEARCH_TOOL_NAME).toBe("webSearch");

		const withoutKey = buildToolSet([webSearch], {}, runtime);
		expect(Object.keys(withoutKey.tools)).toEqual([]);
		expect(withoutKey.disabled).toEqual([
			expect.objectContaining({ name: "webSearch", requiredEnv: ["TAVILY_API_KEY"] }),
		]);
		const withKey = buildToolSet([webSearch], { "web-search": true }, runtime);
		expect(Object.keys(withKey.tools)).toEqual(["webSearch"]);
		expect(withKey.disabled).toEqual([]);
	});

	it("returns search hits from the web-search fixture", async () => {
		const webSearch = createWebSearchTool(createFixtureWebSearch(fixtures.webSearch));
		await expect(call(webSearch, { query: "Agentic AI evaluation" })).resolves.toEqual({
			ok: true,
			data: {
				query: "Agentic AI evaluation",
				results: [
					{
						title: "Evaluating AI agents",
						url: "https://example.test/evaluating-agents",
						snippet: "A deterministic fixture about capability and regression evaluations.",
						score: 0.95,
						publishedDate: "2026-09-01",
					},
				],
			},
		});
	});

	it("keeps at most five hits and forwards the tool's abort signal", async () => {
		const signals: (AbortSignal | undefined)[] = [];
		const hits = Array.from({ length: 7 }, (_, index) => ({
			title: `hit ${index}`,
			url: `https://example.test/${index}`,
			snippet: "snippet",
			score: 1 - index / 10,
		}));
		const webSearch = createWebSearchTool({
			search: async (_query, signal) => {
				signals.push(signal);
				return hits;
			},
		});
		const outcome = await call(webSearch, { query: "many" });
		expect(outcome.ok && outcome.data.results.map((hit) => hit.title)).toEqual([
			"hit 0",
			"hit 1",
			"hit 2",
			"hit 3",
			"hit 4",
		]);
		expect(signals).toHaveLength(1);
		expect(signals[0]).toBeInstanceOf(AbortSignal);
	});

	it("returns a provider failure as a recoverable failure", async () => {
		const webSearch = createWebSearchTool({
			search: async () => {
				throw new PlatformError("source-unavailable", "Web 検索に失敗しました。", {
					provider: "tavily",
				});
			},
		});
		await expect(call(webSearch, { query: "anything" })).resolves.toMatchObject({
			ok: false,
			failure: { kind: "recoverable", summary: "Web 検索に失敗しました。" },
		});
	});
});
