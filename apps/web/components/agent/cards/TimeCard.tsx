import { RawJsonView } from "../RawJsonView";
import type { ToolRendererProps } from "../renderers";
import { CardFrame, Fact, isRecord } from "./shared";

export function TimeCard({ data }: ToolRendererProps) {
	if (
		!isRecord(data) ||
		typeof data.localDateTime !== "string" ||
		typeof data.timeZone !== "string" ||
		typeof data.weekday !== "string"
	) {
		return <RawJsonView value={data} label="出力" />;
	}
	return (
		<CardFrame title="現在時刻">
			<dl className="flex flex-col gap-1">
				<Fact term="日時">{data.localDateTime}</Fact>
				<Fact term="タイムゾーン">{data.timeZone}</Fact>
				<Fact term="曜日">{data.weekday}</Fact>
			</dl>
		</CardFrame>
	);
}
