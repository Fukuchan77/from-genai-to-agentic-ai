import type { ResearchAgentName } from "@platform/ai-core/research";
import type { ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { agentLabel } from "./AgentInspector";

/** The `data-research-result` payload: the checked report, the citation warnings and the gaps. */
export interface ResearchResultData {
	/** Markdown, after the server's citation check. Shown as text blocks, never as HTML. */
	readonly report: string;
	readonly warnings: readonly string[];
	readonly missing: readonly { readonly agent: ResearchAgentName; readonly reason: string }[];
}

export interface ReportViewProps {
	/** `undefined` until `data-research-result` arrives. */
	readonly result: ResearchResultData | undefined;
}

// The report is model-written text built from external content, so it is never handed to an HTML
// or Markdown library. This reads the few shapes the Supervisor is asked to write (headings, lists,
// code, bold, inline code, https links) and builds React elements from them; every string reaches
// the page as a text node, so markup in the report is displayed, not run. Anything it does not
// recognize stays as the text it was written as.

type Block =
	| {
			readonly key: string;
			readonly kind: "heading";
			readonly level: number;
			readonly text: string;
	  }
	| { readonly key: string; readonly kind: "paragraph"; readonly text: string }
	| { readonly key: string; readonly kind: "code"; readonly text: string }
	| {
			readonly key: string;
			readonly kind: "list";
			readonly ordered: boolean;
			readonly items: readonly string[];
	  };

const FENCE = /^ {0,3}(`{3,}|~{3,})/u;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/u;
const BULLET = /^\s*[-*+]\s+(.*)$/u;
const NUMBERED = /^\s*\d{1,9}[.)]\s+(.*)$/u;
/** The page has its own h1 and h2, so the report's `#` starts at h3 and `######` stops at h6. */
const HEADING_SHIFT = 2;
const MAX_HEADING_LEVEL = 6;

function parseBlocks(markdown: string): Block[] {
	const lines = markdown.split(/\r\n|\r|\n/u);
	const blocks: Block[] = [];
	let paragraph: string[] = [];
	let list: { ordered: boolean; items: string[] } | undefined;
	const next = () => `b${blocks.length}`;
	const flush = () => {
		if (paragraph.length > 0) {
			blocks.push({ key: next(), kind: "paragraph", text: paragraph.join(" ") });
			paragraph = [];
		}
		if (list) {
			blocks.push({ key: next(), kind: "list", ordered: list.ordered, items: list.items });
			list = undefined;
		}
	};

	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index] ?? "";
		const fence = FENCE.exec(line)?.[1];
		if (fence !== undefined) {
			flush();
			const body: string[] = [];
			index += 1;
			for (; index < lines.length; index += 1) {
				const candidate = lines[index] ?? "";
				const closer = FENCE.exec(candidate)?.[1];
				if (
					closer?.startsWith(fence.charAt(0)) &&
					closer.length >= fence.length &&
					candidate.trim() === closer
				) {
					break;
				}
				body.push(candidate);
			}
			blocks.push({ key: next(), kind: "code", text: body.join("\n") });
			continue;
		}
		if (line.trim() === "") {
			flush();
			continue;
		}
		const heading = HEADING.exec(line);
		if (heading) {
			flush();
			blocks.push({
				key: next(),
				kind: "heading",
				level: Math.min((heading[1]?.length ?? 1) + HEADING_SHIFT, MAX_HEADING_LEVEL),
				text: heading[2] ?? "",
			});
			continue;
		}
		const bullet = BULLET.exec(line);
		const numbered = bullet ? null : NUMBERED.exec(line);
		const item = bullet ?? numbered;
		if (item) {
			const ordered = numbered !== null;
			if (paragraph.length > 0 || (list && list.ordered !== ordered)) flush();
			list ??= { ordered, items: [] };
			list.items.push(item[1] ?? "");
			continue;
		}
		if (list) flush();
		paragraph.push(line.trim());
	}
	flush();
	return blocks;
}

// Inline: `code`, **bold**, and [text](https://…). The link target allows no parentheses or
// spaces, and `![` (an image) is never a link, so nothing here loads a resource by itself.
const INLINE = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|(?<!!)\[([^\]\n]{0,200})\]\(([^()\s]{1,2000})\)/gu;

// Hosts and paths the citation check (`checkCitations`) itself reads as arXiv paper pages.
const ARXIV_HOSTS: ReadonlySet<string> = new Set([
	"arxiv.org",
	"www.arxiv.org",
	"export.arxiv.org",
	"ar5iv.org",
	"ar5iv.labs.arxiv.org",
]);
const ARXIV_PATH = /^\/(?:abs|pdf|html)\/[^?#]+/iu;

type LinkTarget = { readonly kind: "arxiv" } | { readonly kind: "other"; readonly host: string };

/**
 * Only arXiv paper pages become links: the report is model text built from external abstracts, so
 * any other https address could be a prompt-injected phishing link. Those show their host as text.
 * `undefined` means the address is not https at all and stays as the text it was written as.
 */
function classifyLink(address: string): LinkTarget | undefined {
	try {
		const url = new URL(address);
		if (url.protocol !== "https:") return undefined;
		const arxiv =
			ARXIV_HOSTS.has(url.hostname.toLowerCase()) &&
			url.username === "" &&
			url.password === "" &&
			ARXIV_PATH.test(url.pathname);
		return arxiv ? { kind: "arxiv" } : { kind: "other", host: url.hostname };
	} catch {
		return undefined;
	}
}

function Inline({ text }: { readonly text: string }) {
	const nodes: ReactNode[] = [];
	let last = 0;
	for (const match of text.matchAll(INLINE)) {
		if (match.index > last) nodes.push(text.slice(last, match.index));
		const [source, code, bold, label, address] = match;
		const target = address === undefined ? undefined : classifyLink(address);
		if (code !== undefined) {
			nodes.push(
				<code key={match.index} className="font-mono text-[0.9em]">
					{code}
				</code>,
			);
		} else if (bold !== undefined) {
			nodes.push(<strong key={match.index}>{bold}</strong>);
		} else if (label !== undefined && target?.kind === "other") {
			nodes.push(`${label}（${target.host}）`);
		} else if (label !== undefined && address !== undefined && target?.kind === "arxiv") {
			nodes.push(
				<a
					key={match.index}
					href={address}
					target="_blank"
					rel="noopener noreferrer"
					className="rounded-sm font-medium text-primary underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2"
				>
					{label}
				</a>,
			);
		} else {
			nodes.push(source);
		}
		last = match.index + source.length;
	}
	if (last < text.length) nodes.push(text.slice(last));
	return <>{nodes}</>;
}

const HEADINGS = { 3: "h3", 4: "h4", 5: "h5", 6: "h6" } as const;

function BlockView({ block }: { readonly block: Block }) {
	switch (block.kind) {
		case "heading": {
			const Tag = HEADINGS[block.level as keyof typeof HEADINGS];
			return (
				<Tag className="font-semibold">
					<Inline text={block.text} />
				</Tag>
			);
		}
		case "paragraph":
			return (
				<p className="break-words">
					<Inline text={block.text} />
				</p>
			);
		case "code":
			return (
				<pre className="overflow-x-auto rounded-md border border-border bg-muted p-2 font-mono text-xs">
					<code>{block.text}</code>
				</pre>
			);
		case "list": {
			const Tag = block.ordered ? "ol" : "ul";
			return (
				<Tag className={block.ordered ? "list-decimal pl-5" : "list-disc pl-5"}>
					{block.items.map((item, index) => (
						// The same text can repeat in a list, so the position is the identity.
						// biome-ignore lint/suspicious/noArrayIndexKey: see above
						<li key={index} className="break-words">
							<Inline text={item} />
						</li>
					))}
				</Tag>
			);
		}
	}
}

/**
 * The finished report with its citation warnings and the aspects that could not be researched
 * (plan C14, Req 4.2, 4.5, 4.6). The server decided what was removed and what is missing; this
 * shows the outcome. Warnings and gaps are `status` regions so that they are announced on arrival.
 */
export function ReportView({ result }: ReportViewProps) {
	if (result === undefined) return null;
	const { report, warnings, missing } = result;
	return (
		<div className="flex flex-col gap-3 text-sm">
			{warnings.length > 0 ? (
				<Alert role="status" aria-label="引用の警告">
					<AlertTitle>引用の警告</AlertTitle>
					<AlertDescription>
						<ul className="list-disc pl-5">
							{warnings.map((warning, index) => (
								// Warnings can repeat, so the position is the identity.
								// biome-ignore lint/suspicious/noArrayIndexKey: see above
								<li key={index} className="break-words">
									{warning}
								</li>
							))}
						</ul>
					</AlertDescription>
				</Alert>
			) : null}
			{missing.length > 0 ? (
				<Alert role="status" aria-label="欠落した観点">
					<AlertTitle>欠落した観点</AlertTitle>
					<AlertDescription>
						<ul className="list-disc pl-5">
							{missing.map(({ agent, reason }) => (
								<li key={`${agent}-${reason}`} className="break-words">
									{`${agentLabel(agent)}: ${reason}`}
								</li>
							))}
						</ul>
					</AlertDescription>
				</Alert>
			) : null}
			{report.trim() === "" ? (
				<p className="text-muted-foreground">レポートは空です。</p>
			) : (
				<article aria-label="レポート" className="flex flex-col gap-2">
					{parseBlocks(report).map((block) => (
						<BlockView key={block.key} block={block} />
					))}
				</article>
			)}
		</div>
	);
}
