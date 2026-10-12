import { RawJsonView } from "../RawJsonView";
import type { ToolRendererProps } from "../renderers";
import { CardFrame, Fact, formatNumber, isRecord } from "./shared";

export function WeatherCard({ data }: ToolRendererProps) {
	if (
		!isRecord(data) ||
		typeof data.cityLabel !== "string" ||
		typeof data.condition !== "string" ||
		typeof data.temperatureC !== "number"
	) {
		return <RawJsonView value={data} label="出力" />;
	}
	return (
		<CardFrame title="天気">
			<dl className="flex flex-col gap-1">
				<Fact term="都市">{data.cityLabel}</Fact>
				<Fact term="天気">{data.condition}</Fact>
				<Fact term="気温">{`${formatNumber(data.temperatureC)}°C`}</Fact>
			</dl>
		</CardFrame>
	);
}
