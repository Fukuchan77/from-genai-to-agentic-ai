import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/** A tool that was left out of the agent, as `ResponseMetadata.disabledTools` delivers it. */
export interface DisabledToolView {
	readonly name: string;
	readonly reason: string;
	readonly requiredEnv: readonly string[];
}

/**
 * Lists the tools the server did not register and the settings that would enable them (Req 5.4).
 * Every name, reason and variable comes from the server's response metadata: no environment
 * variable name is written in client code (plan C16, checked by the client bundle scan).
 */
export function DisabledToolsNotice({ tools }: { readonly tools: readonly DisabledToolView[] }) {
	if (tools.length === 0) return null;
	return (
		<Alert role="status">
			<AlertTitle>無効なツールがあります</AlertTitle>
			<AlertDescription>
				<ul className="flex flex-col gap-2">
					{tools.map((tool) => (
						<li key={tool.name} className="flex flex-col gap-1">
							<span className="font-medium">{tool.name}</span>
							<span>{tool.reason}</span>
							{tool.requiredEnv.length > 0 ? (
								<span>
									有効にするには次の環境変数を設定してください:{" "}
									{tool.requiredEnv.map((variable, index) => (
										<span key={variable}>
											{index > 0 ? "、" : ""}
											<code className="rounded-sm bg-muted px-1 py-0.5 text-foreground">
												{variable}
											</code>
										</span>
									))}
								</span>
							) : null}
						</li>
					))}
				</ul>
			</AlertDescription>
		</Alert>
	);
}
