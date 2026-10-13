/** One stage of a prompt chain (plan C11). `validate` returns the problems; an empty list is valid. */
export interface ChainStep {
	readonly name: string;
	run(input: unknown, signal: AbortSignal | undefined): Promise<unknown>;
	validate?(output: unknown): readonly string[];
}

export interface ChainStepRecord {
	readonly name: string;
	readonly output: unknown;
	readonly errors: readonly string[];
}

export type PromptChainResult =
	| {
			readonly status: "completed";
			readonly output: unknown;
			readonly steps: readonly ChainStepRecord[];
	  }
	| {
			readonly status: "failed";
			readonly failedStep: string;
			readonly errors: readonly string[];
			readonly steps: readonly ChainStepRecord[];
	  };

export interface PromptChainParams {
	readonly input: unknown;
	readonly steps: readonly ChainStep[];
	readonly signal?: AbortSignal | undefined;
}

/**
 * Runs the steps in order, feeding each output to the next step (Req 3.1). The gate between steps
 * is code: when a step's `validate` reports problems, no later step runs and the result names the
 * failed step (Req 3.2). A failed validation is a result, not an exception; an error thrown by a
 * step, including an abort, propagates unchanged.
 */
export async function runPromptChain(params: PromptChainParams): Promise<PromptChainResult> {
	const { signal } = params;
	const records: ChainStepRecord[] = [];
	let current = params.input;
	for (const step of params.steps) {
		signal?.throwIfAborted();
		const output = await step.run(current, signal);
		const errors = step.validate?.(output) ?? [];
		records.push({ name: step.name, output, errors });
		if (errors.length > 0) {
			return { status: "failed", failedStep: step.name, errors, steps: records };
		}
		current = output;
	}
	return { status: "completed", output: current, steps: records };
}
