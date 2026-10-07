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
