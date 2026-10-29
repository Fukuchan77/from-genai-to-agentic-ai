import type { ResearchAgentName, ResearchEventKind } from "@platform/ai-core/research";
import { Badge } from "@/components/ui/badge";

/** The `data-research-event` payload: which agent an event belongs to, its kind, and its detail. */
export interface ResearchEventData {
	readonly agent: ResearchAgentName;
	readonly kind: ResearchEventKind;
	readonly detail: Readonly<Record<string, unknown>>;
}

/** An event with the running id its part was written under. */
export interface InspectorEvent extends ResearchEventData {
	readonly id: string;
}

export interface AgentInspectorProps {
	/** Every event so far, in the order they arrived (`data-research-event` parts are appended). */
	readonly events: readonly InspectorEvent[];
}

const AGENT_LABELS: Readonly<Record<string, string>> = {
	supervisor: "Supervisor",
	search: "検索",
	reading: "読解",
	market: "市場",
};

const KIND_LABELS: Readonly<Record<ResearchEventKind, string>> = {
	call: "呼び出し",
	tool: "ツール",
	summary: "要約",
	card: "論文",
	error: "エラー",
};

/** The Japanese name of an agent (or a ledger role); an unknown name is shown as it is. */
export function agentLabel(name: string): string {
	return Object.hasOwn(AGENT_LABELS, name) ? (AGENT_LABELS[name] ?? name) : name;
}

// Only a plain arXiv abstract address becomes a link: the detail comes from a model-driven run, so
// anything else (another host, `http`, `javascript:`) is shown as text.
const ARXIV_ABSTRACT_URL = /^https:\/\/arxiv\.org\/abs\/[A-Za-z0-9./-]+$/u;

function text(detail: Readonly<Record<string, unknown>>, key: string): string | undefined {
	const value = detail[key];
	return typeof value === "string" ? value : undefined;
}

function texts(detail: Readonly<Record<string, unknown>>, key: string): string[] {
	const value = detail[key];
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

function CardBody({ detail }: { readonly detail: Readonly<Record<string, unknown>> }) {
	const title = text(detail, "title") ?? "";
	const url = text(detail, "url");
	const authors = texts(detail, "authors");
	const arxivId = text(detail, "arxivId");
	const publishedAt = text(detail, "publishedAt");
	return (
		<div className="flex flex-col gap-0.5">
			{url !== undefined && ARXIV_ABSTRACT_URL.test(url) ? (
				<a
					href={url}
					target="_blank"
					rel="noopener noreferrer"
					className="w-fit rounded-sm font-medium text-primary underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2"
				>
					{title}
				</a>
			) : (
				<span className="font-medium">{title}</span>
			)}
			{authors.length > 0 ? (
				<span className="break-words text-xs text-muted-foreground">{authors.join(", ")}</span>
			) : null}
			<span className="text-xs text-muted-foreground">
				{[arxivId, publishedAt].filter((part) => part !== undefined).join(" · ")}
			</span>
		</div>
	);
}

function Body({ event }: { readonly event: ResearchEventData }) {
	const { detail } = event;
	switch (event.kind) {
		case "call":
			return (
				<p className="break-words">
					<span className="font-medium">{agentLabel(text(detail, "callee") ?? "")}</span>
					{" に依頼: "}
					{text(detail, "task")}
				</p>
			);
		case "tool":
			return (
				<p className="break-words">
					<code className="font-mono text-[0.9em]">{text(detail, "name")}</code>{" "}
					<code className="font-mono text-[0.9em]">{text(detail, "input")}</code>
				</p>
			);
		case "summary":
			return <p className="whitespace-pre-wrap break-words">{text(detail, "text")}</p>;
		case "card":
			return <CardBody detail={detail} />;
		case "error":
			return <p className="break-words">{text(detail, "reason")}</p>;
	}
}

/**
 * The Agent Inspector (plan C14, Req 4.9): every event of a research run in arrival order, each
 * marked with the agent it belongs to, so two agents doing the same thing stay distinguishable.
 * Event fields are rendered as text only. A `log` role makes new events announce politely.
 */
export function AgentInspector({ events }: AgentInspectorProps) {
	return (
		<div role="log" aria-label="Agent Inspector" aria-live="polite" className="text-sm">
			{events.length === 0 ? (
				<p className="text-muted-foreground">イベントはまだありません。</p>
			) : (
				<ol className="flex flex-col gap-2">
					{events.map((event) => (
						<li
							key={event.id}
							data-agent={event.agent}
							className="flex flex-col gap-1 rounded-md border border-border bg-card p-2"
						>
							<div className="flex flex-wrap items-center gap-2">
								<Badge variant={event.agent === "supervisor" ? "default" : "secondary"}>
									{agentLabel(event.agent)}
								</Badge>
								<Badge variant={event.kind === "error" ? "destructive" : "outline"}>
									{KIND_LABELS[event.kind]}
								</Badge>
							</div>
							<Body event={event} />
						</li>
					))}
				</ol>
			)}
		</div>
	);
}
