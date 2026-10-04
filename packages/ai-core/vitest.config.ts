import { configDefaults, defineConfig } from "vitest/config";

const suites = {
	gate: { suffix: "test", exclude: ["**/*.pg.test.*"] },
	local: { suffix: "local.test", exclude: [] },
	pg: { suffix: "pg.test", exclude: [] },
} as const;

const suiteName = process.env.AI_TEST_SUITE || "gate";
if (!Object.hasOwn(suites, suiteName)) {
	throw new Error(
		`Unknown AI_TEST_SUITE "${suiteName}". Expected one of: ${Object.keys(suites).join(", ")}`,
	);
}
const suite = suites[suiteName as keyof typeof suites];

export default defineConfig({
	root: import.meta.dirname,
	test: {
		environment: "node",
		include: [`src/**/*.${suite.suffix}.ts`],
		exclude: [...configDefaults.exclude, ...suite.exclude],
		setupFiles: ["../../tooling/vitest/setup-hermetic.ts"],
		globalSetup: ["../../tooling/vitest/global-setup-local.ts"],
		reporters: ["default", "../../tooling/vitest/gate-reporter.ts"],
		passWithNoTests: suiteName !== "gate",
		coverage: {
			enabled: true,
			provider: "v8",
			reporter: ["text"],
			include: ["src/**/*.ts"],
			exclude: ["src/**/*.test.ts", "src/**/*.local.test.ts", "src/**/*.pg.test.ts"],
			...(suiteName === "gate"
				? {
						thresholds: {
							lines: 80,
						},
					}
				: {}),
		},
	},
});
