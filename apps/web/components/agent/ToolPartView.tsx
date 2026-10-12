import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { parseStreamErrorText } from "@/lib/server/errors";
import { isRecord } from "./cards/shared";
import { RawJsonView } from "./RawJsonView";
import { rendererFor } from "./renderers";

/**
 * The fields of a `tool-<name>` / `dynamic-tool` UI part this view reads. Structural, because the
 * stream is untrusted input and the tool set is not known to the client's types.
 */
export interface ToolPartLike {
	readonly type: string;
	readonly state: string;
	readonly toolCallId?: string;
	/** Only on `dynamic-tool` parts. */
	readonly toolName?: string;
	readonly input?: unknown;
	readonly output?: unknown;
	readonly errorText?: string;
}

const TOOL_PREFIX = "tool-";

export function isToolPart(part: { readonly type: string }): boolean {
	return part.type.startsWith(TOOL_PREFIX) || part.type === "dynamic-tool";
}

export function toolNameOf(part: { readonly type: string; readonly toolName?: string }): string {
	return part.type === "dynamic-tool"
		? (part.toolName ?? "不明なツール")
		: part.type.slice(TOOL_PREFIX.length);
}

const STATE_LABELS: Readonly<Record<string, string>> = {
	"input-streaming": "引数を生成しています",
	"input-available": "実行しています",
	"output-available": "完了",
	"output-error": "失敗",
};

const FAILURE_LABELS: Readonly<Record<string, string>> = {
	recoverable: "再試行できる失敗",
	timeout: "時間切れ",
	fatal: "致命的な失敗",
};

interface Failure {
	readonly kind: string;
	readonly summary: string;
	readonly nextAction: string | undefined;
}

type Outcome =
	| { readonly kind: "success"; readonly data: unknown }
	| { readonly kind: "failure"; readonly failure: Failure }
	| { readonly kind: "unknown" };

/** Reads a `ToolOutcome` (`{ ok, data }` / `{ ok: false, failure }`) from untrusted output. */
function readOutcome(output: unknown): Outcome {
	if (!isRecord(output)) return { kind: "unknown" };
	if (output.ok === true) return { kind: "success", data: output.data };
	const { failure } = output;
	if (output.ok === false && isRecord(failure) && typeof failure.summary === "string") {
		return {
			kind: "failure",
			failure: {
				kind: typeof failure.kind === "string" ? failure.kind : "recoverable",
				summary: failure.summary,
				nextAction: typeof failure.nextAction === "string" ? failure.nextAction : undefined,
			},
		};
	}
	return { kind: "unknown" };
}

function ResultBody({ part, name }: { readonly part: ToolPartLike; readonly name: string }) {
	const outcome = readOutcome(part.output);
	if (outcome.kind === "failure") {
		const { failure } = outcome;
		return (
			<Alert variant="destructive" role="group">
				<AlertTitle>{FAILURE_LABELS[failure.kind] ?? "失敗"}</AlertTitle>
				<AlertDescription>
					<p>{failure.summary}</p>
					{failure.nextAction ? <p>{failure.nextAction}</p> : null}
				</AlertDescription>
			</Alert>
		);
	}
	const Renderer = outcome.kind === "success" ? rendererFor(name) : undefined;
	if (outcome.kind === "success" && Renderer) {
		return (
			<>
				<Renderer input={part.input} data={outcome.data} />
				<details className="text-sm">
					<summary className="cursor-pointer rounded-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2">
						生の JSON を表示
					</summary>
					<div className="mt-2 flex flex-col gap-2">
						<RawJsonView label="引数" value={part.input} />
						<RawJsonView label="結果" value={part.output} />
					</div>
				</details>
			</>
		);
	}
	return (
		<div className="flex flex-col gap-2">
			<RawJsonView label="引数" value={part.input} />
			<RawJsonView label="結果" value={part.output} />
		</div>
	);
}

/**
 * One tool call of an assistant message, switched on the part's `state` (plan C16, Req 5.1, 5.5).
 * A registered tool's successful result gets its card; any other tool, and any result the card
 * cannot read, is shown as raw JSON. Text that came from an error is read through
 * `parseStreamErrorText`, so only a server-made `{ code, message }` ever reaches the screen.
 */
export function ToolPartView({ part }: { readonly part: ToolPartLike }) {
	const name = toolNameOf(part);
	const stateLabel = STATE_LABELS[part.state] ?? "状態を確認しています";
	return (
		<div className="flex flex-col gap-2 rounded-md border border-border p-3">
			<div className="flex flex-wrap items-center gap-2">
				<span className="text-sm font-semibold">{name}</span>
				<Badge variant={part.state === "output-error" ? "destructive" : "secondary"}>
					{stateLabel}
				</Badge>
			</div>
			{part.state === "input-streaming" || part.state === "input-available" ? (
				<RawJsonView label="引数" value={part.input} />
			) : null}
			{part.state === "output-available" ? <ResultBody part={part} name={name} /> : null}
			{part.state === "output-error" ? (
				<p className="text-sm text-destructive">
					{parseStreamErrorText(part.errorText ?? "").message}
				</p>
			) : null}
		</div>
	);
}
