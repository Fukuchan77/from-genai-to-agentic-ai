import type { Figure } from "@platform/ai-core/analysis";

export interface FigureViewProps {
	/** One `data-analysis-figure` part of the stream (the server already checked it once). */
	readonly figure: Figure;
	/**
	 * The size limit of a figure in bytes (`DEFAULT_ANALYSIS.maxFigureBytes`). The page passes it:
	 * a client component must not import `@platform/ai-core/config`, whose index carries the
	 * environment schema (and its secret variable names) into the browser bundle.
	 */
	readonly maxBytes: number;
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/u;
/** The first bytes of every PNG file, as base64 (`89 50 4E 47 0D 0A 1A 0A`). */
const PNG_BASE64_PREFIX = "iVBORw0KGgo";

/** The decoded size of a base64 string whose shape was already checked. */
function decodedBytes(base64: string): number {
	const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
	return (base64.length / 4) * 3 - padding;
}

/**
 * The `src` for a figure, or `undefined` when it must not be shown. The browser is the last line
 * of defence, so the figure is checked again whatever the server did: exactly `image/png`, a
 * strict base64 alphabet (nothing that can close the attribute or start another `data:` section),
 * a PNG signature, and at most the size limit. The prefix is a constant, so the media type
 * cannot change.
 */
function pngSource(figure: Figure, maxBytes: number): string | undefined {
	const { mediaType, base64 } = figure;
	if (mediaType !== "image/png") return undefined;
	if (typeof base64 !== "string" || base64.length % 4 !== 0 || !BASE64.test(base64)) {
		return undefined;
	}
	if (!base64.startsWith(PNG_BASE64_PREFIX)) return undefined;
	if (decodedBytes(base64) > maxBytes) return undefined;
	return `data:image/png;base64,${base64}`;
}

/**
 * A figure the sandbox code produced (Req 3.5). Only a PNG with a non-empty alt is drawn; SVG,
 * HTML and every other type render nothing, so the page never executes learner-supplied markup.
 */
export function FigureView({ figure, maxBytes }: FigureViewProps) {
	const alt = typeof figure.alt === "string" ? figure.alt.trim() : "";
	if (alt.length < 1) return null;
	const src = pngSource(figure, maxBytes);
	if (src === undefined) return null;
	return (
		<figure className="m-0">
			{/* A data: URL is not optimizable by next/image, and its source was checked above. */}
			{/* biome-ignore lint/performance/noImgElement: data URLs cannot go through next/image */}
			<img src={src} alt={alt} className="h-auto max-w-full rounded-md border border-border" />
		</figure>
	);
}
