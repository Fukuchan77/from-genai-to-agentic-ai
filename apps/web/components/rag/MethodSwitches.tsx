"use client";

import type { QueryMethods } from "@platform/ai-core/rag";
import { useState } from "react";

/** The retrieval settings of one question: what `POST /api/rag/query` takes, plus the mode. */
export interface RagSettings {
	readonly topK: number;
	readonly minSimilarity: number;
	readonly methods: QueryMethods;
	/** Answer with the tool-calling agent (`/api/rag/agent`) instead of the fixed pipeline. */
	readonly agentic: boolean;
}

/**
 * The allowed ranges. The server page passes the request schema's limits in, so the screen and
 * `queryRequestSchema` cannot drift (the `rag` subpath is server-only and cannot be imported here).
 */
export interface SettingsLimits {
	readonly topK: { readonly min: number; readonly max: number };
	readonly minSimilarity: { readonly min: number; readonly max: number };
}

export interface MethodSwitchesProps {
	readonly value: RagSettings;
	/** Called with a complete, valid settings object only. */
	readonly onChange: (next: RagSettings) => void;
	/** Tells the parent whether the text fields hold valid values, so it can hold back the send. */
	readonly onValidityChange?: (valid: boolean) => void;
	readonly limits: SettingsLimits;
	readonly rerank: { readonly available: boolean; readonly reason?: "api-key-missing" };
	readonly disabled?: boolean;
}

const METHOD_LABELS: readonly { key: keyof QueryMethods; label: string; hint: string }[] = [
	{ key: "hyde", label: "HyDE", hint: "質問から仮想の回答を作り、その文で検索する" },
	{ key: "multiQuery", label: "Multi-Query", hint: "質問を言い換えて複数回検索し、結果を統合する" },
	{ key: "hybrid", label: "ハイブリッド検索", hint: "ベクトル検索と全文検索を組み合わせる" },
	{ key: "rerank", label: "Rerank", hint: "候補を再ランキングして上位を選び直す" },
];

const CHECKBOX_CLASS = "size-4 shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2";
const INPUT_CLASS =
	"h-9 w-28 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60 aria-invalid:border-destructive";

function parseNumber(text: string, min: number, max: number, integer: boolean): number | undefined {
	if (text.trim() === "") return undefined;
	const value = Number(text);
	if (!Number.isFinite(value) || value < min || value > max) return undefined;
	if (integer && !Number.isInteger(value)) return undefined;
	return value;
}

interface SwitchProps {
	readonly label: string;
	readonly hint: string;
	readonly checked: boolean;
	readonly disabled: boolean;
	readonly onToggle: (checked: boolean) => void;
	readonly note?: string | undefined;
}

function Switch({ label, hint, checked, disabled, onToggle, note }: SwitchProps) {
	return (
		<div className="flex flex-col gap-1">
			<label className="flex items-start gap-2 text-sm">
				<input
					type="checkbox"
					className={`${CHECKBOX_CLASS} mt-0.5`}
					checked={checked}
					disabled={disabled}
					onChange={(event) => onToggle(event.target.checked)}
				/>
				<span>
					<span className="font-medium">{label}</span>
					<span className="block text-xs text-muted-foreground">{hint}</span>
				</span>
			</label>
			{note === undefined ? null : <p className="pl-6 text-xs text-muted-foreground">{note}</p>}
		</div>
	);
}

/**
 * The method switches and the two retrieval numbers (plan C14, Req 2.7). A text field that holds a
 * value outside the range is flagged and never reaches `onChange`, so a request built from `value`
 * is always one the server accepts. With Agentic RAG on, the agent chooses how to search, so the
 * fixed-pipeline settings are turned off.
 */
export function MethodSwitches({
	value,
	onChange,
	onValidityChange,
	limits,
	rerank,
	disabled = false,
}: MethodSwitchesProps) {
	const [topKText, setTopKText] = useState(String(value.topK));
	const [similarityText, setSimilarityText] = useState(String(value.minSimilarity));
	const [invalid, setInvalid] = useState({ topK: false, minSimilarity: false });

	const pipelineOff = disabled || value.agentic;
	const topKRange = `${limits.topK.min} 以上 ${limits.topK.max} 以下の整数`;
	const similarityRange = `${limits.minSimilarity.min} 以上 ${limits.minSimilarity.max} 以下の数`;

	function setValidity(next: { topK: boolean; minSimilarity: boolean }) {
		setInvalid(next);
		onValidityChange?.(!next.topK && !next.minSimilarity);
	}

	return (
		<fieldset className="flex flex-col gap-3 rounded-lg border border-border p-4">
			<legend className="px-1 text-sm font-semibold">検索の設定</legend>
			{METHOD_LABELS.map(({ key, label, hint }) => (
				<Switch
					key={key}
					label={label}
					hint={hint}
					checked={value.methods[key]}
					disabled={pipelineOff}
					onToggle={(checked) =>
						onChange({ ...value, methods: { ...value.methods, [key]: checked } })
					}
					note={
						key === "rerank" && !rerank.available
							? "Rerank の API キー（Cohere）が未設定のため、有効にしても検索はスキップされます。"
							: undefined
					}
				/>
			))}
			<div className="flex flex-wrap gap-4">
				<div className="flex flex-col gap-1">
					<label htmlFor="rag-top-k" className="text-sm font-medium">
						取得件数（k）
					</label>
					<input
						id="rag-top-k"
						type="number"
						step={1}
						min={limits.topK.min}
						max={limits.topK.max}
						className={INPUT_CLASS}
						value={topKText}
						disabled={pipelineOff}
						aria-invalid={invalid.topK}
						aria-describedby={invalid.topK ? "rag-top-k-error" : undefined}
						onChange={(event) => {
							const text = event.target.value;
							setTopKText(text);
							const parsed = parseNumber(text, limits.topK.min, limits.topK.max, true);
							setValidity({ ...invalid, topK: parsed === undefined });
							if (parsed !== undefined) onChange({ ...value, topK: parsed });
						}}
					/>
					{invalid.topK ? (
						<p id="rag-top-k-error" role="alert" className="text-xs text-destructive">
							{`取得件数は ${topKRange}で指定してください。`}
						</p>
					) : null}
				</div>
				<div className="flex flex-col gap-1">
					<label htmlFor="rag-min-similarity" className="text-sm font-medium">
						類似度の閾値
					</label>
					<input
						id="rag-min-similarity"
						type="number"
						step="any"
						min={limits.minSimilarity.min}
						max={limits.minSimilarity.max}
						className={INPUT_CLASS}
						value={similarityText}
						disabled={pipelineOff}
						aria-invalid={invalid.minSimilarity}
						aria-describedby={invalid.minSimilarity ? "rag-min-similarity-error" : undefined}
						onChange={(event) => {
							const text = event.target.value;
							setSimilarityText(text);
							const parsed = parseNumber(
								text,
								limits.minSimilarity.min,
								limits.minSimilarity.max,
								false,
							);
							setValidity({ ...invalid, minSimilarity: parsed === undefined });
							if (parsed !== undefined) onChange({ ...value, minSimilarity: parsed });
						}}
					/>
					{invalid.minSimilarity ? (
						<p id="rag-min-similarity-error" role="alert" className="text-xs text-destructive">
							{`類似度の閾値は ${similarityRange}で指定してください。`}
						</p>
					) : null}
				</div>
			</div>
			<hr className="border-border" />
			<Switch
				label="Agentic RAG"
				hint="エージェントが、検索するか、何を何回検索するかを自分で決める"
				checked={value.agentic}
				disabled={disabled}
				onToggle={(checked) => onChange({ ...value, agentic: checked })}
				note={
					value.agentic
						? "Agentic RAG では、エージェントが検索の回数と内容を決めます。上の検索の設定は使われません。"
						: undefined
				}
			/>
		</fieldset>
	);
}
