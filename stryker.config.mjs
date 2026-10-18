export default {
	testRunner: "vitest",
	plugins: ["@stryker-mutator/vitest-runner"],
	coverageAnalysis: "perTest",
	checkers: [],
	// Stryker rewrites `tsconfigFile` with the TypeScript JS API (`ts.parseConfigFileTextToJson`),
	// which TypeScript 7 (the native compiler) no longer ships. Point it at a file that does not
	// exist so the rewrite is skipped. Nothing needs rewriting: the root tsconfig only extends
	// ./tsconfig.base.json, which is copied into the sandbox, and no checker reads tsconfig.
	tsconfigFile: "stryker-no-tsconfig-rewrite.json",
	mutate: [
		"packages/ai-core/src/agents/stop-conditions.ts",
		"packages/ai-core/src/agents/stop-reason.ts",
		"packages/ai-core/src/aci/define-tool.ts",
		"packages/ai-core/src/aci/description-check.ts",
		"packages/ai-core/src/files/path.ts",
		"packages/ai-core/src/mcp/risk.ts",
		"packages/ai-core/src/helpdesk/plan-schema.ts",
		"packages/ai-core/src/helpdesk/scheduler.ts",
		"packages/ai-core/src/config/run-mode.ts",
		"packages/ai-core/src/mock/resolve.ts",
		"packages/ai-core/src/summarize/plan.ts",
		"packages/ai-core/src/summarize/retry.ts",
		"packages/ai-core/src/rag/ingest/markdown.ts",
		"packages/ai-core/src/rag/ingest/chunk.ts",
		"packages/ai-core/src/rag/ingest/search-text.ts",
		"packages/ai-core/src/rag/retrieve/rrf.ts",
		"packages/ai-core/src/rag/answer/citations.ts",
		"packages/ai-core/src/rag/eval/recall.ts",
		"packages/ai-core/src/workflows/parallelization.ts",
		"packages/ai-core/src/workflows/evaluator-optimizer.ts",
	],
	vitest: {
		configFile: "packages/ai-core/vitest.config.ts",
		related: true,
	},
	thresholds: {
		break: 70,
	},
};
