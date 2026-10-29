import type { StoppedReason, TicketStatus } from "@platform/ai-core/helpdesk";
import { Badge, type BadgeProps } from "@/components/ui/badge";

/**
 * One ticket as `GET /api/helpdesk/tickets` sends it (`ticketJson`): dates are ISO strings and a
 * field that applies to one outcome only is absent otherwise.
 */
export interface TicketSummary {
	readonly id: string;
	readonly inquiry: string;
	readonly status: TicketStatus;
	/** `resolved` only. */
	readonly answer?: string;
	/** `escalated` only. */
	readonly escalationReason?: string;
	readonly stepsUsed: number;
	/** `open` only: why the run stopped before an outcome. */
	readonly stoppedReason?: StoppedReason;
	readonly createdAt: string;
	readonly updatedAt: string;
	/**
	 * Ids of the tasks that did not finish, from the run's `data-helpdesk-result` part. The stored
	 * ticket does not carry them, so a ticket loaded from the API has none.
	 */
	readonly remaining?: readonly string[];
}

export interface TicketListProps {
	/** Newest first, as the server sent them. */
	readonly tickets: readonly TicketSummary[];
}

const STATUS_LABELS: Readonly<Record<TicketStatus, string>> = {
	open: "未完了",
	resolved: "解決済み",
	escalated: "エスカレーション",
};

const STATUS_VARIANTS: Readonly<Record<TicketStatus, NonNullable<BadgeProps["variant"]>>> = {
	open: "secondary",
	resolved: "default",
	escalated: "destructive",
};

const STOPPED_REASON_LABELS: Readonly<Record<StoppedReason, string>> = {
	"step-limit": "ステップ上限に達したため、実行を止めました",
	aborted: "中断されたため、実行を止めました",
};

// A fixed zone keeps the server render and the browser render identical (no hydration mismatch).
const DATE_FORMAT = new Intl.DateTimeFormat("ja-JP", {
	timeZone: "Asia/Tokyo",
	dateStyle: "medium",
	timeStyle: "short",
});

function formatDate(iso: string): string {
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? iso : DATE_FORMAT.format(date);
}

function TicketItem({ ticket }: { readonly ticket: TicketSummary }) {
	return (
		<li
			data-ticket-id={ticket.id}
			data-status={ticket.status}
			className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 text-card-foreground"
		>
			<div className="flex flex-wrap items-center gap-2">
				<span className="font-mono text-sm font-medium">{ticket.id}</span>
				<Badge variant={STATUS_VARIANTS[ticket.status]}>{STATUS_LABELS[ticket.status]}</Badge>
				<span className="text-xs text-muted-foreground">{ticket.stepsUsed} ステップ</span>
				<time dateTime={ticket.updatedAt} className="ml-auto text-xs text-muted-foreground">
					{formatDate(ticket.updatedAt)}
				</time>
			</div>
			<p className="line-clamp-2 text-sm">{ticket.inquiry}</p>
			{ticket.answer !== undefined ? (
				<div className="flex flex-col gap-0.5 text-sm">
					<span className="text-xs font-medium">回答</span>
					<p className="whitespace-pre-wrap">{ticket.answer}</p>
				</div>
			) : null}
			{ticket.escalationReason !== undefined ? (
				<div className="flex flex-col gap-0.5 text-sm">
					<span className="text-xs font-medium">未解決の理由</span>
					<p className="whitespace-pre-wrap">{ticket.escalationReason}</p>
				</div>
			) : null}
			{ticket.stoppedReason !== undefined ? (
				<p className="text-sm">{STOPPED_REASON_LABELS[ticket.stoppedReason]}</p>
			) : null}
			{ticket.remaining !== undefined && ticket.remaining.length > 0 ? (
				<div className="flex flex-col gap-1 text-sm">
					<span className="text-xs font-medium">未完了のタスク</span>
					<ul aria-label="未完了のタスク" className="flex flex-wrap gap-1">
						{ticket.remaining.map((id) => (
							<li key={id} className="rounded-md border border-border px-1.5 font-mono text-xs">
								{id}
							</li>
						))}
					</ul>
				</div>
			) : null}
		</li>
	);
}

/**
 * The ticket history (plan C14, Req 2.4, 2.6, 2.7): the status, the answer of a resolved ticket,
 * the reason an escalated ticket was not solved, and an `open` ticket stopped by the step limit
 * with the tasks it left. Text only: an answer is never read as markup. The list is a polite live
 * region, so a ticket that arrives or changes is announced.
 */
export function TicketList({ tickets }: TicketListProps) {
	return (
		<section aria-label="チケット一覧" aria-live="polite" className="flex flex-col gap-2">
			{tickets.length > 0 ? (
				<ul aria-label="チケット" className="flex flex-col gap-2">
					{tickets.map((ticket) => (
						<TicketItem key={ticket.id} ticket={ticket} />
					))}
				</ul>
			) : (
				<p className="text-sm text-muted-foreground">チケットはまだありません</p>
			)}
		</section>
	);
}
