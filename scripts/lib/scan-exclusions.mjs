/** Directory names that hold dependencies, VCS data, or build and test output, never source. */
export const GENERATED_DIRECTORY_NAMES = Object.freeze([
	"node_modules",
	".git",
	".next",
	".turbo",
	"coverage",
	"dist",
	".stryker-tmp",
	"playwright-report",
	"test-results",
]);

const generated = new Set(GENERATED_DIRECTORY_NAMES);

export function isGeneratedDirectory(name) {
	return generated.has(name);
}
