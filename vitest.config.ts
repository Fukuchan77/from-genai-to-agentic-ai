import { configDefaults, defineConfig } from "vitest/config";

// AI_TEST_SUITE selects which test files this unit runs (plan C18):
// - gate (default): every test except `*.pg.test.*`; `*.local.test.*` files are collected and
//   skip themselves with a reason unless local mode is available.
// - local: only `*.local.test.*` (`mise run test:local`).
// - pg: only `*.pg.test.*` (`mise run test:db`).
// Only the gate suite requires at least one test file; units without local or pg tests may be empty.
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
	test: {
		environment: "node",
		include: [`tooling/**/*.${suite.suffix}.ts`, `scripts/**/*.${suite.suffix}.{ts,mts,mjs}`],
		exclude: [...configDefaults.exclude, ...suite.exclude],
		setupFiles: ["./tooling/vitest/setup-hermetic.ts"],
		reporters: ["default", "./tooling/vitest/gate-reporter.ts"],
		passWithNoTests: suiteName !== "gate",
	},
});
