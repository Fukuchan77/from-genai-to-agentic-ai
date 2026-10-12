import type { ComponentType } from "react";
import { CalculationCard } from "./cards/CalculationCard";
import { CurrencyCard } from "./cards/CurrencyCard";
import { SearchResultsList } from "./cards/SearchResultsList";
import { TimeCard } from "./cards/TimeCard";
import { WeatherCard } from "./cards/WeatherCard";

/**
 * Props of a tool result card. `data` is the `data` of a successful `ToolOutcome`. Its type is
 * `unknown` on purpose: the stream is untrusted input to the UI, so each card checks the shape it
 * needs and falls back to `RawJsonView` instead of throwing.
 */
export interface ToolRendererProps {
	readonly input: unknown;
	readonly data: unknown;
}

/** The names of the M1 sample tools (the `*_TOOL_NAME` constants of `@platform/ai-core/aci`). */
export type SampleToolName =
	| "currentTime"
	| "calculator"
	| "currencyConvert"
	| "weather"
	| "webSearch";

/** Tool name -> display component (plan C16). A tool missing here is shown with `RawJsonView`. */
export const TOOL_RENDERERS: Readonly<Record<SampleToolName, ComponentType<ToolRendererProps>>> =
	Object.freeze({
		currentTime: TimeCard,
		calculator: CalculationCard,
		currencyConvert: CurrencyCard,
		weather: WeatherCard,
		webSearch: SearchResultsList,
	});

/** The registered renderer for `toolName`, or `undefined` (inherited object keys do not count). */
export function rendererFor(toolName: string): ComponentType<ToolRendererProps> | undefined {
	return Object.hasOwn(TOOL_RENDERERS, toolName)
		? TOOL_RENDERERS[toolName as SampleToolName]
		: undefined;
}
