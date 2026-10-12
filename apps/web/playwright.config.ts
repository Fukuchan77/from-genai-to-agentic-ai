import { defineConfig, devices } from "@playwright/test";

// Plan C19: the same scenarios run in three engines against a production build (`next start`)
// in `mock` mode, so the Route Handlers, the request guard and the scenario models are real.
const PORT = 3100;

export default defineConfig({
	testDir: "./e2e",
	testMatch: "**/*.spec.ts",
	fullyParallel: true,
	forbidOnly: Boolean(process.env.CI),
	retries: 0,
	reporter: [["list"], ["json", { outputFile: "test-results/results.json" }]],
	use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
	projects: [
		{ name: "chromium", use: { ...devices["Desktop Chrome"] } },
		{ name: "firefox", use: { ...devices["Desktop Firefox"] } },
		{ name: "webkit", use: { ...devices["Desktop Safari"] } },
	],
	webServer: {
		command: `pnpm exec next build && pnpm exec next start -p ${PORT}`,
		url: `http://localhost:${PORT}/chat`,
		// `next build` needs NODE_ENV=production even when the caller shell exports another value.
		env: { AI_RUN_MODE: "mock", NODE_ENV: "production" },
		reuseExistingServer: false,
		// Without it `next-server`, a child of `next start`, outlives the run and holds the port.
		gracefulShutdown: { signal: "SIGTERM", timeout: 5000 },
		timeout: 300_000,
	},
});
