import type { ReactNode } from "react";

const integerAware = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 6 });

export function formatNumber(value: number): string {
	return integerAware.format(value);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A titled definition list shared by the single-value cards. */
export function CardFrame({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section
			aria-label={title}
			className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4 text-card-foreground"
		>
			<h4 className="text-sm font-semibold">{title}</h4>
			{children}
		</section>
	);
}

export function Fact({ term, children }: { term: string; children: ReactNode }) {
	return (
		<div className="flex flex-wrap gap-x-2">
			<dt className="text-sm text-muted-foreground">{term}</dt>
			<dd className="text-sm font-medium">{children}</dd>
		</div>
	);
}
