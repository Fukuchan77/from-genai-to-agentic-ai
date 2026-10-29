import { HELPDESK_REQUEST_LIMITS } from "@platform/ai-core/helpdesk";
import type { Metadata } from "next";
import { GET as listTickets } from "@/app/api/helpdesk/tickets/route";
import { type HelpdeskExample, HelpdeskPanel } from "@/components/helpdesk/HelpdeskPanel";
import type { TicketSummary } from "@/components/helpdesk/TicketList";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getPlatform } from "@/lib/server/platform";

export const metadata: Metadata = { title: "ヘルプデスク" };

// The model list and the tickets depend on the running server and its database.
export const dynamic = "force-dynamic";

const TICKETS_UNAVAILABLE_MESSAGE =
	"チケットの一覧を取得できませんでした。データベース（Postgres）の設定を確認してください。";

// The wording matches the `mock` scenarios of the help-desk agent (fixtures `m3-2`), so each
// example reaches a different outcome there: resolved, replanned and unresolved.
const EXAMPLES: readonly HelpdeskExample[] = [
	{
		label: "VPN に接続できない（解決）",
		inquiry: "自宅から VPN に接続できません。確認する手順を教えてください。",
	},
	{
		label: "プリンターが表示されない（再計画）",
		inquiry: "共有プリンターを追加したいのですが、一覧に表示されません。どうすればよいですか。",
	},
	{
		label: "ツールの導入可否（未解決）",
		inquiry: "新しい設計ツールを、承認を待たずに今すぐ導入してもよいですか。",
	},
];

/**
 * The initial ticket list, read through `GET /api/helpdesk/tickets` itself so the page and the API
 * cannot disagree. A failure (an unreachable database) becomes a message, not a crashed page.
 */
async function loadTickets(): Promise<
	{ readonly tickets: readonly TicketSummary[] } | { readonly message: string }
> {
	try {
		const response = await listTickets(new Request("http://localhost/api/helpdesk/tickets"));
		if (response.ok) {
			const body = (await response.json()) as { tickets: TicketSummary[] };
			return { tickets: body.tickets };
		}
		const body = (await response.json()) as { error?: { message?: string } };
		return { message: body.error?.message ?? TICKETS_UNAVAILABLE_MESSAGE };
	} catch {
		return { message: TICKETS_UNAVAILABLE_MESSAGE };
	}
}

export default async function HelpdeskPage() {
	const { gateway, config } = await getPlatform();
	const models = gateway
		.availableModels()
		.filter(
			(model) =>
				model.capabilities.tools &&
				model.capabilities.structuredOutput &&
				!model.capabilities.embedding,
		);
	const defaultModel = models.find((model) => model.id === config.models.chat) ?? models[0];
	const initial = await loadTickets();

	return (
		<div className="flex flex-col gap-6">
			<h1 className="text-2xl font-bold">ヘルプデスク</h1>
			<p className="text-muted-foreground">
				問い合わせを計画に分け、ナレッジを調べながらタスクを実行します。計画の修正、使ったステップ数、最終結果を順に確かめられます。
			</p>
			{defaultModel ? (
				<HelpdeskPanel
					models={models}
					defaultModelId={defaultModel.id}
					initial={initial}
					inquiryMaxLength={HELPDESK_REQUEST_LIMITS.inquiryMaxCharacters}
					examples={EXAMPLES}
				/>
			) : (
				<Alert>
					<AlertTitle>利用できるモデルがありません</AlertTitle>
					<AlertDescription>
						ツール呼び出しと構造化出力に対応したモデルの認証情報（API キー）または Ollama
						の設定を確認してください。
					</AlertDescription>
				</Alert>
			)}
		</div>
	);
}
