export default {
	testRunner: "vitest",
	plugins: ["@stryker-mutator/vitest-runner"],
	coverageAnalysis: "perTest",
	checkers: [],
	mutate: [
		"packages/ai-core/src/agents/stop-conditions.ts",
		"packages/ai-core/src/agents/stop-reason.ts",
		"packages/ai-core/src/aci/define-tool.ts",
		"packages/ai-core/src/config/run-mode.ts",
		"packages/ai-core/src/mock/resolve.ts",
		"packages/ai-core/src/summarize/plan.ts",
		"packages/ai-core/src/summarize/retry.ts",
	],
	vitest: {
		configFile: "packages/ai-core/vitest.config.ts",
		related: true,
	},
	thresholds: {
		break: 70,
	},
};
