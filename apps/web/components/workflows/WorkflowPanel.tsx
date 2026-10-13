"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { ErrorBanner } from "@/components/chat/ErrorBanner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { WorkflowResultView, type WorkflowRun, workflowTitle } from "./WorkflowResultView";

type Kind = "workflow" | "pattern";

export interface WorkflowSample {
	readonly label: string;
	readonly task: string;
}

/** The limits the screen enforces; the server page passes `DEFAULT_WORKFLOW_LIMITS` in. */
export interface WorkflowOptionLimits {
	readonly maxSections: number;
	readonly maxVotes: number;
	readonly maxSubtasks: number;
	readonly maxCandidates: number;
	readonly maxIterationsCap: number;
}

export interface WorkflowPanelProps {
	/** The names the API accepts, per kind (`WORKFLOW_DEMO_NAMES` / `PATTERN_DEMO_NAMES`). */
	readonly names: { readonly workflow: readonly string[]; readonly pattern: readonly string[] };
	/** Input examples per name, chosen to match the `mock` scenarios. */
	readonly samples: Readonly<Record<string, readonly WorkflowSample[]>>;
	readonly limits: WorkflowOptionLimits;
	readonly taskMaxLength: number;
}

type OptionField =
	| {
			readonly key: string;
			readonly label: string;
			readonly kind: "int" | "number";
			readonly min: number;
			readonly max: number;
	  }
	| {
			readonly key: string;
			readonly label: string;
			readonly kind: "list";
			readonly maxItems: number;
			readonly maxLength: number;
	  }
	| {
			readonly key: string;
			readonly label: string;
			readonly kind: "text";
			readonly maxLength: number;
	  }
	| {
			readonly key: string;
			readonly label: string;
			readonly kind: "enum";
			readonly choices: readonly { readonly value: string; readonly label: string }[];
	  };

const ASPECT_MAX_LENGTH = 40;
const GOAL_MAX_LENGTH = 200;

/** The option fields of a name, with the limits of `/api/workflows` (the server checks them too). */
function optionFieldsFor(name: string, limits: WorkflowOptionLimits): readonly OptionField[] {
	const iterations: OptionField = {
		key: "maxIterations",
		label: "最大反復回数",
		kind: "int",
		min: 1,
		max: limits.maxIterationsCap,
	};
	switch (name) {
		case "parallel-sectioning":
			return [
				{
					key: "aspects",
					label: "観点（カンマまたは読点で区切る）",
					kind: "list",
					maxItems: limits.maxSections,
					maxLength: ASPECT_MAX_LENGTH,
				},
			];
		case "parallel-voting":
			return [{ key: "votes", label: "投票数", kind: "int", min: 1, max: limits.maxVotes }];
		case "orchestrator-workers":
			return [
				{
					key: "maxSubtasks",
					label: "サブタスクの上限",
					kind: "int",
					min: 1,
					max: limits.maxSubtasks,
				},
			];
		case "evaluator-optimizer":
			return [
				{ key: "passScore", label: "合格スコア", kind: "number", min: 0, max: 100 },
				iterations,
			];
		case "multi-path-plan":
			return [
				{ key: "candidates", label: "候補数", kind: "int", min: 1, max: limits.maxCandidates },
			];
		case "self-reflection":
		case "cross-reflection":
			return [iterations];
		case "prompt-response-optimizer":
			return [
				{
					key: "target",
					label: "対象",
					kind: "enum",
					choices: [
						{ value: "prompt", label: "プロンプト" },
						{ value: "response", label: "応答" },
					],
				},
				{ key: "goal", label: "改善の方針", kind: "text", maxLength: GOAL_MAX_LENGTH },
			];
		default:
			return [];
	}
}

type Parsed =
	| { readonly ok: true; readonly value: unknown }
	| { readonly ok: false; readonly error: string };

/** Reads one non-empty option text; an empty text is "not set" and never reaches this function. */
function parseOption(field: OptionField, text: string): Parsed {
	switch (field.kind) {
		case "int":
		case "number": {
			const value = Number(text);
			const valid =
				value >= field.min &&
				value <= field.max &&
				(field.kind === "number" || Number.isInteger(value));
			return valid
				? { ok: true, value }
				: {
						ok: false,
						error: `${field.label}は ${field.min} 以上 ${field.max} 以下の${field.kind === "int" ? "整数" : "数"}で指定してください。`,
					};
		}
		case "list": {
			const items = text
				.split(/[,，、]/u)
				.map((item) => item.trim())
				.filter((item) => item !== "");
			if (items.length > field.maxItems) {
				return { ok: false, error: `観点は ${field.maxItems} 個までです。` };
			}
			if (items.some((item) => [...item].length > field.maxLength)) {
				return { ok: false, error: `観点は 1 つにつき ${field.maxLength} 文字までです。` };
			}
			return items.length === 0
				? { ok: false, error: "観点を入力してください。" }
				: { ok: true, value: items };
		}
		case "text":
			return [...text].length > field.maxLength
				? { ok: false, error: `${field.label}は ${field.maxLength} 文字までです。` }
				: { ok: true, value: text.trim() };
		case "enum":
			return { ok: true, value: text };
	}
}

function firstTask(samples: WorkflowPanelProps["samples"], name: string | undefined): string {
	return (name === undefined ? undefined : samples[name]?.[0]?.task) ?? "";
}

const FIELD_CLASS =
	"h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60 aria-invalid:border-destructive";

/**
 * The workflow and pattern screen (plan C14, Req 3.1, 4.1): choose a kind and a name, edit the
 * input and the options, run, and read the result. The options are checked against the same
 * limits as the server before anything is sent, so a request built here is one the server accepts.
 * The run can be aborted with the browser's `AbortController`.
 */
export function WorkflowPanel({ names, samples, limits, taskMaxLength }: WorkflowPanelProps) {
	const [kind, setKind] = useState<Kind>("workflow");
	const [name, setName] = useState<string | undefined>(names.workflow[0]);
	const [task, setTask] = useState(firstTask(samples, names.workflow[0]));
	const [optionTexts, setOptionTexts] = useState<Readonly<Record<string, string>>>({});
	const [pending, setPending] = useState(false);
	const [aborted, setAborted] = useState(false);
	const [error, setError] = useState<Error | undefined>();
	const [run, setRun] = useState<WorkflowRun | undefined>();
	const controllerRef = useRef<AbortController | undefined>(undefined);

	// A run still in flight when the screen goes away is cancelled.
	useEffect(() => () => controllerRef.current?.abort(), []);

	const fields = name === undefined ? [] : optionFieldsFor(name, limits);
	const options: Record<string, unknown> = {};
	const optionErrors: Record<string, string> = {};
	for (const field of fields) {
		const text = optionTexts[field.key] ?? "";
		if (text.trim() === "") continue;
		const parsed = parseOption(field, text);
		if (parsed.ok) options[field.key] = parsed.value;
		else optionErrors[field.key] = parsed.error;
	}
	const taskLength = [...task].length;
	const taskTooLong = taskLength > taskMaxLength;
	const canRun =
		!pending &&
		name !== undefined &&
		task.trim() !== "" &&
		!taskTooLong &&
		Object.keys(optionErrors).length === 0;

	function select(nextKind: Kind, nextName: string | undefined) {
		setKind(nextKind);
		setName(nextName);
		setTask(firstTask(samples, nextName));
		setOptionTexts({});
	}

	async function execute() {
		if (!canRun || name === undefined) return;
		const controller = new AbortController();
		controllerRef.current = controller;
		setPending(true);
		setAborted(false);
		setError(undefined);
		setRun(undefined);
		try {
			const response = await fetch("/api/workflows", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					kind,
					name,
					task: task.trim(),
					...(Object.keys(options).length > 0 ? { options } : {}),
				}),
				signal: controller.signal,
			});
			if (!response.ok) {
				setError(new Error(await response.text()));
				return;
			}
			setRun((await response.json()) as WorkflowRun);
		} catch {
			// A network or parse failure can hold addresses or keys: only the fixed text is shown.
			if (controller.signal.aborted) setAborted(true);
			else setError(new Error("unexpected"));
		} finally {
			controllerRef.current = undefined;
			setPending(false);
		}
	}

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		void execute();
	}

	return (
		<div className="flex flex-col gap-6">
			<form onSubmit={handleSubmit} className="flex flex-col gap-4">
				<fieldset className="flex flex-wrap gap-4">
					<legend className="mb-1 text-sm font-semibold">種類</legend>
					{(
						[
							["workflow", "ワークフロー"],
							["pattern", "エージェントパターン"],
						] as const
					).map(([value, label]) => (
						<label key={value} className="flex items-center gap-2 text-sm">
							<input
								type="radio"
								name="workflow-kind"
								className="size-4 focus-visible:outline-2 focus-visible:outline-offset-2"
								checked={kind === value}
								disabled={pending}
								onChange={() => select(value, names[value][0])}
							/>
							{label}
						</label>
					))}
				</fieldset>
				<div className="flex flex-col gap-1.5">
					<label htmlFor="workflow-name" className="text-sm font-medium">
						名前
					</label>
					<select
						id="workflow-name"
						className={FIELD_CLASS}
						value={name ?? ""}
						disabled={pending}
						onChange={(event) => select(kind, event.target.value)}
					>
						{names[kind].map((value) => (
							<option key={value} value={value}>
								{`${workflowTitle(value)}（${value}）`}
							</option>
						))}
					</select>
				</div>
				{fields.length > 0 ? (
					<fieldset className="flex flex-col gap-3 rounded-lg border border-border p-4">
						<legend className="px-1 text-sm font-semibold">オプション</legend>
						{fields.map((field) => {
							const id = `workflow-option-${field.key}`;
							const message = optionErrors[field.key];
							return (
								<div key={field.key} className="flex flex-col gap-1">
									<label htmlFor={id} className="text-sm font-medium">
										{field.label}
									</label>
									{field.kind === "enum" ? (
										<select
											id={id}
											className={FIELD_CLASS}
											value={optionTexts[field.key] ?? ""}
											disabled={pending}
											onChange={(event) =>
												setOptionTexts({ ...optionTexts, [field.key]: event.target.value })
											}
										>
											<option value="">既定</option>
											{field.choices.map((choice) => (
												<option key={choice.value} value={choice.value}>
													{choice.label}
												</option>
											))}
										</select>
									) : (
										<input
											id={id}
											type="text"
											inputMode={field.kind === "int" ? "numeric" : undefined}
											className={FIELD_CLASS}
											placeholder="省略すると既定の値"
											value={optionTexts[field.key] ?? ""}
											disabled={pending}
											aria-invalid={message !== undefined}
											aria-describedby={message === undefined ? undefined : `${id}-error`}
											onChange={(event) =>
												setOptionTexts({ ...optionTexts, [field.key]: event.target.value })
											}
										/>
									)}
									{message === undefined ? null : (
										<p id={`${id}-error`} role="alert" className="text-xs text-destructive">
											{message}
										</p>
									)}
								</div>
							);
						})}
					</fieldset>
				) : null}
				<div className="flex flex-col gap-1.5">
					<label htmlFor="workflow-task" className="text-sm font-medium">
						入力
					</label>
					{name !== undefined && (samples[name]?.length ?? 0) > 0 ? (
						<section aria-label="入力例" className="flex flex-wrap gap-2">
							{samples[name]?.map((sample) => (
								<Button
									key={sample.label}
									type="button"
									variant="outline"
									size="sm"
									disabled={pending}
									onClick={() => setTask(sample.task)}
								>
									{sample.label}
								</Button>
							))}
						</section>
					) : null}
					<Textarea
						id="workflow-task"
						value={task}
						disabled={pending}
						onChange={(event) => setTask(event.target.value)}
						aria-invalid={taskTooLong}
					/>
					{taskTooLong ? (
						<p role="alert" className="text-sm text-destructive">
							{`入力は ${taskMaxLength} 文字までです（現在 ${taskLength} 文字）。`}
						</p>
					) : (
						<p className="text-xs text-muted-foreground">{`${taskLength} / ${taskMaxLength} 文字`}</p>
					)}
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<Button type="submit" disabled={!canRun}>
						実行
					</Button>
					{pending ? (
						<Button type="button" variant="outline" onClick={() => controllerRef.current?.abort()}>
							中断
						</Button>
					) : null}
				</div>
			</form>
			<p
				role="status"
				aria-label="実行の状態"
				aria-live="polite"
				className="text-sm text-muted-foreground"
			>
				{pending ? "実行しています。モデルを呼び出しているため、数秒かかることがあります。" : ""}
				{aborted ? "実行を中断しました。" : ""}
			</p>
			{error ? (
				<ErrorBanner
					error={error}
					onRetry={() => void execute()}
					onDismiss={() => setError(undefined)}
				/>
			) : null}
			{run ? <WorkflowResultView run={run} /> : null}
		</div>
	);
}
