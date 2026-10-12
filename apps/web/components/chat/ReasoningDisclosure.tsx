// A native <details> element: keyboard operable (Enter / Space on the summary) and announced by
// assistive technology as a collapsed / expanded disclosure, with no script (Req 3.4).
export function ReasoningDisclosure({ text }: { readonly text: string }) {
	return (
		<details className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
			<summary className="cursor-pointer rounded-sm font-medium text-foreground focus-visible:outline-2 focus-visible:outline-offset-2">
				推論を表示
			</summary>
			<p className="mt-2 whitespace-pre-wrap break-words">{text}</p>
		</details>
	);
}
