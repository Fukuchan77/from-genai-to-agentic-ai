import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const REGISTRY_URL = "https://registry.npmjs.org";
const MINIMUM_RELEASE_AGE_MS = 24 * 60 * 60 * 1000;
const TYPESCRIPT_71_PRERELEASE = /^7\.1\.0-/u;

function versionParts(version) {
	return version
		.split(/([0-9]+)/u)
		.filter(Boolean)
		.map((part) => (/^[0-9]+$/u.test(part) ? Number(part) : part));
}

function compareVersions(left, right) {
	const leftParts = versionParts(left);
	const rightParts = versionParts(right);
	const length = Math.max(leftParts.length, rightParts.length);
	for (let index = 0; index < length; index += 1) {
		const leftPart = leftParts[index];
		const rightPart = rightParts[index];
		if (leftPart === rightPart) continue;
		if (leftPart === undefined) return -1;
		if (rightPart === undefined) return 1;
		if (typeof leftPart === typeof rightPart) return leftPart < rightPart ? -1 : 1;
		return typeof leftPart === "number" ? 1 : -1;
	}
	return 0;
}

function parseCoreVersion(version) {
	const match = /^(\d+)(?:\.(\d+|x|X|\*))?(?:\.(\d+|x|X|\*))?/u.exec(version.trim());
	if (!match) return undefined;
	return [
		Number(match[1]),
		match[2] === undefined || /^(?:x|\*)$/iu.test(match[2]) ? 0 : Number(match[2]),
		match[3] === undefined || /^(?:x|\*)$/iu.test(match[3]) ? 0 : Number(match[3]),
	];
}

function compareCore(left, right) {
	for (let index = 0; index < 3; index += 1) {
		if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
	}
	return 0;
}

function comparatorAllowsCandidate(comparator, candidate) {
	const match = /^(<=|>=|<|>|=)?\s*(\d+(?:\.(?:\d+|x|X|\*)){0,2})$/u.exec(comparator);
	if (!match) return false;
	const operator = match[1] ?? "=";
	const version = parseCoreVersion(match[2]);
	if (!version) return false;
	const comparison = compareCore(candidate, version);
	if (operator === ">=") return comparison >= 0;
	if (operator === ">") return comparison > 0;
	if (operator === "<=") return comparison <= 0;
	if (operator === "<") return comparison < 0;
	return comparison === 0;
}

function clauseAllowsAiV7(clause) {
	const normalized = clause.trim();
	if (normalized === "" || normalized === "*" || /^latest$/iu.test(normalized)) return true;
	if (/^[~^]\s*7(?:\.|$)/u.test(normalized)) return true;
	if (/^7(?:\.x|\.\*|\.\d+(?:\.x|\.\*|\.\d+)?)?$/iu.test(normalized)) return true;

	const hyphen = /^(\d+(?:\.\d+){0,2})\s+-\s+(\d+(?:\.\d+){0,2})$/u.exec(normalized);
	if (hyphen) {
		const lower = parseCoreVersion(hyphen[1]);
		const upper = parseCoreVersion(hyphen[2]);
		return Boolean(
			lower && upper && compareCore(lower, [8, 0, 0]) < 0 && compareCore(upper, [7, 0, 0]) >= 0,
		);
	}

	const comparators = normalized.split(/\s+/u).filter(Boolean);
	if (comparators.length === 0 || comparators.some((part) => !/^(?:<=|>=|<|>|=)?\d/u.test(part))) {
		return false;
	}

	const candidates = [
		[7, 0, 0],
		[7, 1, 0],
		[7, 999999, 999999],
	];
	for (const comparator of comparators) {
		const version = parseCoreVersion(comparator.replace(/^(?:<=|>=|<|>|=)/u, ""));
		if (version?.[0] === 7) candidates.push(version);
	}
	return candidates.some((candidate) =>
		comparators.every((comparator) => comparatorAllowsCandidate(comparator, candidate)),
	);
}

export function isAiV7Compatible(range) {
	return typeof range === "string" && range.split("||").some(clauseAllowsAiV7);
}

async function fetchPackageMetadata(packageName, fetchImpl) {
	const response = await fetchImpl(`${REGISTRY_URL}/${encodeURIComponent(packageName)}`);
	if (!response.ok) {
		throw new Error(`npm registry request failed for ${packageName}: ${response.status}`);
	}
	return response.json();
}

function newestEligibleTypescript(metadata, currentVersion, now) {
	const cutoff = now.getTime() - MINIMUM_RELEASE_AGE_MS;
	return Object.keys(metadata.versions ?? {})
		.filter((version) => TYPESCRIPT_71_PRERELEASE.test(version))
		.filter((version) => compareVersions(version, currentVersion) > 0)
		.filter((version) => {
			const publishedAt = Date.parse(metadata.time?.[version] ?? "");
			return Number.isFinite(publishedAt) && publishedAt <= cutoff;
		})
		.sort(compareVersions)
		.at(-1);
}

function compatibleWatsonxVersions(metadata) {
	return Object.entries(metadata.versions ?? {})
		.filter(([, manifest]) => isAiV7Compatible(manifest?.peerDependencies?.ai))
		.map(([version]) => version)
		.sort(compareVersions);
}

export async function checkRegistryUpdates({
	fetchImpl = globalThis.fetch,
	now = new Date(),
	typescriptVersion,
}) {
	if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function");
	if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
		throw new TypeError("now must be a valid Date");
	}
	if (typeof typescriptVersion !== "string" || !TYPESCRIPT_71_PRERELEASE.test(typescriptVersion)) {
		throw new Error("typescriptVersion must be an exact TypeScript 7.1 prerelease version");
	}

	const [typescriptMetadata, watsonxMetadata] = await Promise.all([
		fetchPackageMetadata("typescript", fetchImpl),
		fetchPackageMetadata("watsonx-ai-provider", fetchImpl),
	]);
	const compatibleVersions = compatibleWatsonxVersions(watsonxMetadata);

	return {
		typescript: {
			current: typescriptVersion,
			newerEligible: newestEligibleTypescript(typescriptMetadata, typescriptVersion, now),
		},
		watsonx: {
			aiV7Compatible: compatibleVersions.length > 0,
			compatibleVersions,
		},
	};
}

export function formatUpdateReport(result) {
	const typescriptLine = result.typescript.newerEligible
		? `TypeScript: newer eligible 7.1 prerelease build ${result.typescript.newerEligible} (current ${result.typescript.current}).`
		: `TypeScript: ${result.typescript.current} is the newest eligible 7.1 prerelease build.`;
	const watsonxLine = result.watsonx.aiV7Compatible
		? `watsonx-ai-provider: ai@^7 compatible release(s): ${result.watsonx.compatibleVersions.join(", ")}.`
		: "watsonx-ai-provider: no release declares compatibility with ai@^7.";
	return `${typescriptLine}\n${watsonxLine}`;
}

async function main() {
	const packageJson = JSON.parse(
		await readFile(new URL("../package.json", import.meta.url), { encoding: "utf8" }),
	);
	const typescriptVersion = packageJson.devDependencies?.typescript;
	const result = await checkRegistryUpdates({ typescriptVersion });
	console.log(formatUpdateReport(result));
}

const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined;
if (entryUrl === import.meta.url) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
