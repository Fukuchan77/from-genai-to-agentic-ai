import { ConfigError, type FeatureId, loadPlatformConfig } from "@platform/ai-core/config";

// Startup validation (plan C13, Req 1.9). Next.js calls `register` once when the server starts.
// The platform itself is assembled lazily by `lib/server/platform.ts`; this file only makes a bad
// configuration fail at startup, with every missing variable named, instead of at the first request.

/**
 * Features whose variables must be set at startup, besides the live provider's own (added by
 * `loadPlatformConfig` in `live` mode). Web search is optional: without a Tavily key the tool is
 * listed as disabled (Req 5.4).
 */
const REQUIRED_FEATURES: readonly FeatureId[] = [];

/** One line per missing variable, naming the feature that needs it. Never prints values. */
export function formatConfigError(error: ConfigError): string {
	const lines = [`[設定エラー] ${error.message}`];
	for (const { variable, feature } of error.missing) {
		lines.push(`  - ${variable}（機能: ${feature}）`);
	}
	if (error.missing.length > 0) {
		lines.push("  .env.example を参照して環境変数を設定してから、もう一度起動してください。");
	}
	return lines.join("\n");
}

export async function register(): Promise<void> {
	if (process.env.NEXT_RUNTIME !== "nodejs") return;
	try {
		loadPlatformConfig(process.env, { features: REQUIRED_FEATURES });
	} catch (error) {
		if (error instanceof ConfigError) console.error(formatConfigError(error));
		throw error;
	}
}
