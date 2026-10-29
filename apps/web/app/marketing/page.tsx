import { DEFAULT_COUNCIL } from "@platform/ai-core/config";
import { COUNCIL_REQUEST_LIMITS, RECOMMEND_REQUEST_LIMITS } from "@platform/ai-core/marketing";
import type { Metadata } from "next";
import { CouncilPanel, type PersonaOption } from "@/components/marketing/CouncilPanel";
import { RecommendPanel } from "@/components/marketing/RecommendPanel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getCatalogRepo } from "@/lib/server/platform";

export const metadata: Metadata = { title: "マーケティング" };

// The personas come from the database and depend on the running server.
export const dynamic = "force-dynamic";

const PERSONAS_UNAVAILABLE_MESSAGE =
	"ペルソナ定義を取得できませんでした。データベース（Postgres）の設定を確認し、`mise run seed:samples` でサンプルデータを投入してください。";

/** The personas the council can use. A failure (unseeded or no database) becomes a message. */
async function loadPersonas(): Promise<
	{ readonly personas: readonly PersonaOption[] } | { readonly message: string }
> {
	try {
		const repo = await getCatalogRepo();
		const personas = await repo.listPersonas();
		return {
			personas: personas.map(({ id, name, viewpoint }) => ({ id, name, viewpoint })),
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : "";
		// The unseeded message already names the command; anything else gets the fixed text.
		return { message: message.includes("seed:samples") ? message : PERSONAS_UNAVAILABLE_MESSAGE };
	}
}

export default async function MarketingPage() {
	const loaded = await loadPersonas();
	const known = "personas" in loaded ? new Set(loaded.personas.map(({ id }) => id)) : new Set();
	const defaultPersonaIds = DEFAULT_COUNCIL.personaIds.filter((id) => known.has(id));

	return (
		<div className="flex flex-col gap-8">
			<h1 className="text-2xl font-bold">マーケティング</h1>
			<p className="text-muted-foreground">
				複数のペルソナが広告文案を議論して改善する合議と、会話からお客様の関心を読み取って商品をおすすめするレコメンドを試せます。
			</p>
			<section aria-labelledby="council-title" className="flex flex-col gap-3">
				<h2 id="council-title" className="text-lg font-semibold">
					ペルソナ合議
				</h2>
				{"message" in loaded ? (
					<Alert variant="destructive">
						<AlertTitle>ペルソナを読み込めません</AlertTitle>
						<AlertDescription>{loaded.message}</AlertDescription>
					</Alert>
				) : (
					<CouncilPanel
						personas={loaded.personas}
						defaultPersonaIds={defaultPersonaIds}
						draftMaxLength={COUNCIL_REQUEST_LIMITS.draftMaxCharacters}
						personaLimits={{
							min: COUNCIL_REQUEST_LIMITS.personaIdsMin,
							max: COUNCIL_REQUEST_LIMITS.personaIdsMax,
						}}
						roundLimits={{
							min: COUNCIL_REQUEST_LIMITS.maxRoundsMin,
							max: COUNCIL_REQUEST_LIMITS.maxRoundsMax,
							default: DEFAULT_COUNCIL.maxRounds,
						}}
					/>
				)}
			</section>
			<section aria-labelledby="recommend-title" className="flex flex-col gap-3">
				<h2 id="recommend-title" className="text-lg font-semibold">
					商品レコメンド
				</h2>
				<RecommendPanel messageMaxLength={RECOMMEND_REQUEST_LIMITS.textMaxCharacters} />
			</section>
		</div>
	);
}
