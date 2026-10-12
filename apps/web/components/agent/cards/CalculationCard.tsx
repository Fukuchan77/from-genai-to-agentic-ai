import { RawJsonView } from "../RawJsonView";
import type { ToolRendererProps } from "../renderers";
import { CardFrame, Fact, formatNumber, isRecord } from "./shared";

export function CalculationCard({ data }: ToolRendererProps) {
	if (!isRecord(data) || typeof data.expression !== "string" || typeof data.result !== "number") {
		return <RawJsonView value={data} label="出力" />;
	}
	return (
		<CardFrame title="計算結果">
			<dl className="flex flex-col gap-1">
				<Fact term="式">{data.expression}</Fact>
				<Fact term="結果">{formatNumber(data.result)}</Fact>
			</dl>
		</CardFrame>
	);
}
