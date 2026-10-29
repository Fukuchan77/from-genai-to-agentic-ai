import {
	buildToolSet,
	compareApproaches,
	FatalLatch,
	type RunMetrics,
} from "@platform/ai-core/aci";
import { type AgentRunSummary, createGuardedAgent } from "@platform/ai-core/agents";
import { DEFAULT_INPUT_LIMITS } from "@platform/ai-core/config";
import { PlatformError } from "@platform/ai-core/errors";
import {
	compareUserText,
	FILES_SERVER_ID,
	MCP_COMPARE_APPROACHES,
	MCP_COMPARE_TOOLS,
	type McpCompareApproach,
	type McpCompareRequest,
	type McpRegistry,
	mcpCompareRequestSchema,
} from "@platform/ai-core/mcp";
import { ollamaRuntimeOptions } from "@platform/ai-core/models";
import { toErrorResponse } from "@/lib/server/errors";
import { type GuardPolicy, guardRequest } from "@/lib/server/guard";
import { getMcpRegistry, getPlatform, type Platform } from "@/lib/server/platform";

// POST /api/mcp/compare (plan C13, Req 1.12): the same task done with one high-level tool and with
// low-level tools in combination. Each way is one guarded agent run, measured in steps and tokens;
// `compareApproaches` turns the two measurements into the comparison. A run that did not finish is
// reported as an error and no ratio is computed.

export const dynamic = "force-dynamic";

const POLICY: GuardPolicy<McpCompareRequest> = {
	schema: mcpCompareRequestSchema,
	limits: DEFAULT_INPUT_LIMITS,
	// The body is a task name and a model: nothing in it needs a content limit.
	inspect: () => undefined,
};

interface MeasuredRun extends RunMetrics {
	readonly stopReason: AgentRunSummary["stopReason"];
	readonly toolsCalled: readonly string[];
	/** Set when the run did not finish; the message is vetted text, never a raw error. */
	readonly error?: { readonly code: string; readonly message: string };
}

function metricsOf(summary: AgentRunSummary): MeasuredRun {
	const failed = summary.stopReason !== "completed";
	return {
		steps: summary.steps,
		tokens: summary.totalTokens.input + summary.totalTokens.output,
		stopReason: summary.stopReason,
		toolsCalled: summary.toolsCalled,
		...(failed ? { failed: true as const } : {}),
		...(summary.error ? { error: summary.error } : {}),
	};
}

async function runApproach(options: {
	readonly platform: Platform;
	readonly registry: McpRegistry;
	readonly approach: McpCompareApproach;
	readonly task: McpCompareRequest["task"];
	readonly signal: AbortSignal;
	readonly resolved: Awaited<ReturnType<Platform["gateway"]["resolve"]>>;
}): Promise<MeasuredRun> {
	const { platform, registry, approach, task, signal, resolved } = options;
	const mcpTools = registry.toolsFor(`mcp-compare-${approach}`, {
		allow: { [FILES_SERVER_ID]: MCP_COMPARE_TOOLS[approach] },
	});
	const { tools } = buildToolSet(
		mcpTools,
		{},
		{ ...platform.toolRuntime, fatal: new FatalLatch() },
	);
	const agent = createGuardedAgent({
		model: resolved.model,
		instructions:
			"あなたはファイルを調べるアシスタントです。ツールで確かめてから、日本語で簡潔に答えます。",
		tools,
		limits: platform.config.agent,
		clock: platform.clock,
		signal,
		...ollamaRuntimeOptions(resolved.entry),
	});
	try {
		await agent.agent.generate({
			prompt: compareUserText(task, approach),
			abortSignal: agent.abortSignal,
		});
	} catch {
		// The summary below records the failure with a vetted message; the raw error stays here.
	}
	return metricsOf(await agent.done);
}

export async function POST(request: Request): Promise<Response> {
	try {
		const platform = await getPlatform();
		const guarded = await guardRequest(request, POLICY, {
			limiter: platform.limiter,
			mode: platform.mode,
		});
		if (!guarded.ok) return guarded.response;
		const { body } = guarded;

		const registry = await getMcpRegistry();
		const files = registry.status().find((server) => server.id === FILES_SERVER_ID);
		if (files?.state !== "connected") {
			throw new PlatformError(
				"provider-unavailable",
				"比較に使うファイルサーバーに接続できていません。/api/mcp/servers で状態を確認してください。",
			);
		}

		const resolved = await platform.gateway.resolve({
			purpose: "chat",
			...(body.modelId ? { modelId: body.modelId } : {}),
			require: ["tools"],
		});

		// One after the other, so the two runs never compete for the same rate limit or model.
		const [highLevel, lowLevel] = [
			await runApproach({
				platform,
				registry,
				approach: MCP_COMPARE_APPROACHES[0],
				task: body.task,
				signal: request.signal,
				resolved,
			}),
			await runApproach({
				platform,
				registry,
				approach: MCP_COMPARE_APPROACHES[1],
				task: body.task,
				signal: request.signal,
				resolved,
			}),
		];
		return Response.json({
			highLevel,
			lowLevel,
			comparison: compareApproaches({ highLevel, lowLevel }),
		});
	} catch (error) {
		return toErrorResponse(error);
	}
}
