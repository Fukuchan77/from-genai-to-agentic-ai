import { z } from "zod";
import type { HttpFetcher } from "../../ports/http";
import { defineAciTool, ToolExecutionError } from "../define-tool";
import type { AciTool } from "../types";

export const WEATHER_TOOL_NAME = "weather";

interface City {
	readonly name: string;
	readonly label: string;
	readonly latitude: number;
	readonly longitude: number;
	readonly aliases: readonly string[];
}

/** Bundled coordinates, so the tool needs neither an API key nor a geocoding call. */
const CITIES: readonly City[] = [
	{ name: "Tokyo", label: "東京", latitude: 35.6762, longitude: 139.6503, aliases: ["東京都"] },
	{ name: "Osaka", label: "大阪", latitude: 34.6937, longitude: 135.5023, aliases: ["大阪市"] },
	{
		name: "Nagoya",
		label: "名古屋",
		latitude: 35.1815,
		longitude: 136.9066,
		aliases: ["名古屋市"],
	},
	{ name: "Sapporo", label: "札幌", latitude: 43.0618, longitude: 141.3545, aliases: ["札幌市"] },
	{ name: "Fukuoka", label: "福岡", latitude: 33.5904, longitude: 130.4017, aliases: ["福岡市"] },
	{ name: "Naha", label: "那覇", latitude: 26.2124, longitude: 127.6809, aliases: ["那覇市"] },
	{ name: "New York", label: "ニューヨーク", latitude: 40.7128, longitude: -74.006, aliases: [] },
	{ name: "London", label: "ロンドン", latitude: 51.5074, longitude: -0.1278, aliases: [] },
	{ name: "Paris", label: "パリ", latitude: 48.8566, longitude: 2.3522, aliases: [] },
];

const CITY_INDEX: ReadonlyMap<string, City> = new Map(
	CITIES.flatMap((city) =>
		[city.name, city.label, ...city.aliases].map((key) => [key.toLowerCase(), city] as const),
	),
);

/** WMO weather interpretation codes used by Open-Meteo, in Japanese. */
const WEATHER_CONDITIONS: Readonly<Record<number, string>> = {
	0: "晴れ",
	1: "おおむね晴れ",
	2: "一部曇り",
	3: "曇り",
	45: "霧",
	48: "着氷性の霧",
	51: "弱い霧雨",
	53: "霧雨",
	55: "強い霧雨",
	56: "弱い着氷性の霧雨",
	57: "着氷性の霧雨",
	61: "弱い雨",
	63: "雨",
	65: "強い雨",
	66: "弱い着氷性の雨",
	67: "着氷性の雨",
	71: "弱い雪",
	73: "雪",
	75: "強い雪",
	77: "霧雪",
	80: "弱いにわか雨",
	81: "にわか雨",
	82: "激しいにわか雨",
	85: "弱いにわか雪",
	86: "にわか雪",
	95: "雷雨",
	96: "ひょうを伴う雷雨",
	99: "強いひょうを伴う雷雨",
};

const openMeteoResponseSchema = z.object({
	current: z.object({ temperature_2m: z.number(), weather_code: z.number().int() }),
});

export interface WeatherReport {
	readonly city: string;
	readonly cityLabel: string;
	readonly latitude: number;
	readonly longitude: number;
	readonly temperatureC: number;
	readonly weatherCode: number;
	readonly condition: string;
}

/**
 * Open-Meteo's current-weather URL. Built by hand rather than with `URLSearchParams`, which would
 * encode the comma in `current=` and so stop matching the recorded fixture URL.
 */
export function openMeteoUrl(latitude: number, longitude: number): string {
	return `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code`;
}

function findCity(name: string): City {
	const city = CITY_INDEX.get(name.trim().toLowerCase());
	if (city === undefined) {
		throw new ToolExecutionError(`都市「${name}」の座標が登録されていません。`, {
			nextAction: `次の都市から選んでください: ${CITIES.map((entry) => `${entry.name}（${entry.label}）`).join("、")}`,
		});
	}
	return city;
}

function parseBody(body: string): z.output<typeof openMeteoResponseSchema> {
	let json: unknown;
	try {
		json = JSON.parse(body);
	} catch {
		json = undefined;
	}
	const parsed = openMeteoResponseSchema.safeParse(json);
	if (!parsed.success) {
		throw new ToolExecutionError("天気情報の応答が想定した形式ではありません。", {
			nextAction: "天気を調べられないことを伝えてください。",
		});
	}
	return parsed.data;
}

const weatherInputSchema = z.object({
	city: z
		.string()
		.min(1)
		.max(64)
		.describe(`都市名。対応: ${CITIES.map((city) => `${city.name}（${city.label}）`).join(", ")}`),
});

/** Current weather from Open-Meteo (no API key) through the injected `HttpFetcher`. */
export function createWeatherTool(
	fetcher: HttpFetcher,
): AciTool<z.output<typeof weatherInputSchema>, WeatherReport> {
	return defineAciTool({
		name: WEATHER_TOOL_NAME,
		description: "指定した都市の現在の天気と気温を Open-Meteo から取得します。",
		inputSchema: weatherInputSchema,
		risk: "read-only",
		execute: async ({ city }, context) => {
			const target = findCity(city);
			const response = await fetcher.fetch(openMeteoUrl(target.latitude, target.longitude), {
				signal: context.abortSignal,
			});
			if (response.status < 200 || response.status >= 300) {
				throw new ToolExecutionError(
					`天気情報を取得できませんでした（HTTP ${response.status}）。`,
					{
						nextAction: "時間をおいて再試行するか、天気を調べられないことを伝えてください。",
					},
				);
			}
			const { current } = parseBody(response.body);
			return {
				city: target.name,
				cityLabel: target.label,
				latitude: target.latitude,
				longitude: target.longitude,
				temperatureC: current.temperature_2m,
				weatherCode: current.weather_code,
				condition:
					WEATHER_CONDITIONS[current.weather_code] ?? `不明（コード ${current.weather_code}）`,
			};
		},
	});
}
