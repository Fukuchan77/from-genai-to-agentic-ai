import { RawJsonView } from "../RawJsonView";
import type { ToolRendererProps } from "../renderers";
import { CardFrame, Fact, formatNumber, isRecord } from "./shared";

export function CurrencyCard({ data }: ToolRendererProps) {
	if (
		!isRecord(data) ||
		typeof data.amount !== "number" ||
		typeof data.converted !== "number" ||
		typeof data.rate !== "number" ||
		typeof data.from !== "string" ||
		typeof data.to !== "string" ||
		typeof data.asOf !== "string"
	) {
		return <RawJsonView value={data} label="出力" />;
	}
	return (
		<CardFrame title="通貨換算">
			<dl className="flex flex-col gap-1">
				<Fact term="換算前">{`${formatNumber(data.amount)} ${data.from}`}</Fact>
				<Fact term="換算後">{`${formatNumber(data.converted)} ${data.to}`}</Fact>
				<Fact term="レート">{formatNumber(data.rate)}</Fact>
				<Fact term="レート基準日">{data.asOf}</Fact>
			</dl>
		</CardFrame>
	);
}
