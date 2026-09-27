import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["tooling/**/*.test.ts", "scripts/**/*.test.{ts,mts,mjs}"],
		exclude: [...configDefaults.exclude, "**/*.local.test.ts", "**/*.pg.test.ts"],
		setupFiles: ["./tooling/vitest/setup-hermetic.ts"],
		reporters: ["default", "./tooling/vitest/gate-reporter.ts"],
		passWithNoTests: false,
	},
});
