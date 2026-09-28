import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
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
const setupFile = "../../tooling/vitest/setup-hermetic.ts";
const passWithNoTests = suiteName !== "gate";

export default defineConfig({
	root: import.meta.dirname,
	plugins: [react()],
	resolve: {
		tsconfigPaths: true,
		alias: {
			"server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
		},
	},
	test: {
		exclude: [...configDefaults.exclude, ...suite.exclude],
		passWithNoTests,
		reporters: ["default", "../../tooling/vitest/gate-reporter.ts"],
		projects: [
			{
				test: {
					name: "components",
					environment: "jsdom",
					include: [`components/**/*.${suite.suffix}.{ts,tsx}`],
					setupFiles: [setupFile],
				},
			},
			{
				test: {
					name: "routes",
					environment: "node",
					include: [
						`app/api/**/*.${suite.suffix}.ts`,
						`lib/server/**/*.${suite.suffix}.ts`,
						`instrumentation.${suite.suffix}.ts`,
					],
					setupFiles: [setupFile],
				},
			},
		],
	},
});
