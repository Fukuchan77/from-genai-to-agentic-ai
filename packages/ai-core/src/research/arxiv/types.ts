import { z } from "zod";
import { PlatformError } from "../../errors";

// Kept in step with the identifiers arXiv issues: `2401.01234` since 2007-04, `cs/0501001` and
// `math.GT/0309136` before. The citation check (C9) relies on this shape, so nothing else gets in.
export const ARXIV_ID_PATTERN = /^(?:\d{4}\.\d{4,5}|[a-z]+(?:-[a-z]+)*(?:\.[A-Z]{2})?\/\d{7})$/u;

export const arxivLinkSchema = z.strictObject({
	href: z.string().min(1),
	rel: z.string().optional(),
	title: z.string().optional(),
});

export const arxivPaperSchema = z.strictObject({
	/** The identifier without its version (`2401.01234`, not `2401.01234v2`). */
	arxivId: z.string().regex(ARXIV_ID_PATTERN),
	title: z.string().min(1),
	authors: z.array(z.string()),
	/** ISO 8601, UTC. */
	publishedAt: z.iso.datetime(),
	summary: z.string(),
	links: z.array(arxivLinkSchema),
});

export type ArxivLink = z.infer<typeof arxivLinkSchema>;
export type ArxivPaper = z.infer<typeof arxivPaperSchema>;

/**
 * A response that is not a usable arXiv feed: it did not parse, it carries a DOCTYPE or entity
 * declaration, or arXiv answered with its error feed. The message is fixed text; the parser's and
 * the server's own wording can echo the query, so neither is shown.
 */
export class ArxivFeedError extends PlatformError {
	constructor(message = "arXiv の応答を解析できませんでした。") {
		super("source-unavailable", message);
	}
}
