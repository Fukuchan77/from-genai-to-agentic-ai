// Capability observation (plan C16, Req 1.12): how a real local model behaves when the same
// question is answered with one high-level tool (`findAndReadFiles`) versus a low-level
// combination (`searchFiles` + `readFile`) over the same sample workspace. It runs only under
// `mise run test:local`; elsewhere `describeLocal` reports it as skipped with the reason.
//
// This test OBSERVES: it prints steps and tokens per variant and repetition, and asserts only
// what must hold anyway (usage numbers are finite and positive; the stop reason is printed in the
// table, not asserted). Model
// behaviour is never a pass/fail threshold (constitution principle 3). Paste the printed Markdown
// table into research.md.
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildToolSet, compareApproaches, FatalLatch } from "@platform/ai-core/aci";
import {
	type AgentRunSummary,
	createGuardedAgent,
	type LoopLimits,
} from "@platform/ai-core/agents";
import { loadPlatformConfig } from "@platform/ai-core/config";
import { createFilesServer } from "@platform/ai-core/files";
import {
	type ConnectOptions,
	compareUserText,
	connectMcpServers,
	FILES_SERVER_ID,
	filesServerConfig,
	MCP_COMPARE_APPROACHES,
	MCP_COMPARE_TOOLS,
	type McpCompareApproach,
	type McpRegistry,
} from "@platform/ai-core/mcp";
import { createModelGateway, ollamaRuntimeOptions } from "@platform/ai-core/models";
import { systemClock } from "@platform/ai-core/ports";
import { describeLocal } from "@platform/ai-core/testing";
import { afterAll, expect } from "vitest";

const LOCAL_MODEL_TIMEOUT_MS = 600_000;
const REPETITIONS = 3;
const INSTRUCTIONS =
	"あなたはファイルを調べるアシスタントです。ツールで確かめてから、日本語で簡潔に答えます。";

type TransportFor = NonNullable<ConnectOptions["transportFor"]>;
type ClientTransport = NonNullable<ReturnType<TransportFor>>;
type RpcMessage = Parameters<ClientTransport["send"]>[0];

/** One end of an in-memory pair; whatever one end sends is delivered to the other end's handler. */
class LinkedEnd {
	onmessage?: (message: RpcMessage) => void;
	onclose?: () => void;
	onerror?: (error: Error) => void;
	sessionId?: string;
	#peer: LinkedEnd | undefined;
	#closed = false;
	readonly #queue: RpcMessage[] = [];

	static pair(): [LinkedEnd, LinkedEnd] {
		const a = new LinkedEnd();
		const b = new LinkedEnd();
		a.#peer = b;
		b.#peer = a;
		return [a, b];
	}

	async start(): Promise<void> {
		for (const message of this.#queue.splice(0)) this.onmessage?.(message);
	}

	async send(message: RpcMessage): Promise<void> {
		const peer = this.#peer;
		if (peer === undefined) throw new Error("not connected");
		if (peer.onmessage) peer.onmessage(message);
		else peer.#queue.push(message);
	}

	async close(): Promise<void> {
		if (this.#closed) return;
		this.#closed = true;
		const peer = this.#peer;
		this.#peer = undefined;
		try {
			await peer?.close();
		} finally {
			this.onclose?.();
		}
	}
}

// --- Pure helpers (no model, no network) ---

/** The sample workspace: a few small files, two of which mention "README". */
const WORKSPACE_FILES: Readonly<Record<string, string>> = {
	"README.md":
		"# サンプル\nこのリポジトリは、エージェントの学習用のサンプルです。ツールの使い方を試せます。\n",
	"docs/README-setup.md":
		"セットアップ手順: 依存関係を入れてから、開発サーバーを起動します。詳細は README を参照してください。\n",
	"docs/notes.txt": "会議のメモ: 次回の締め切りは金曜日です。\n",
	"src/main.ts": 'export const greeting = "hello";\n',
};

async function createWorkspace(base: string): Promise<string> {
	const root = join(base, "workspace");
	for (const [relative, content] of Object.entries(WORKSPACE_FILES)) {
		const target = join(root, relative);
		await mkdir(join(target, ".."), { recursive: true });
		await writeFile(target, content);
	}
	return root;
}

interface Sample {
	readonly steps: number;
	readonly tokens: number;
	readonly stopReason: string;
	readonly toolsCalled: readonly string[];
	readonly answerChars: number;
}

function sampleOf(summary: AgentRunSummary, answer: string): Sample {
	return {
		steps: summary.steps,
		tokens: summary.totalTokens.input + summary.totalTokens.output,
		stopReason: summary.stopReason,
		toolsCalled: summary.toolsCalled,
		answerChars: answer.trim().length,
	};
}

function median(values: readonly number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1
		? (sorted[middle] as number)
		: ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

function formatTable(
	modelId: string,
	samples: Readonly<Record<McpCompareApproach, readonly Sample[]>>,
): string {
	const lines = [
		`MCP compare (model: ${modelId}, ${REPETITIONS} runs per variant)`,
		"",
		"| variant | run | steps | tokens | stop | answer chars | tools called |",
		"| :-- | --: | --: | --: | :-- | --: | :-- |",
	];
	for (const approach of MCP_COMPARE_APPROACHES) {
		for (const [index, s] of samples[approach].entries()) {
			lines.push(
				`| ${approach} | ${index + 1} | ${s.steps} | ${s.tokens} | ${s.stopReason} | ${s.answerChars} | ${s.toolsCalled.join(" > ") || "-"} |`,
			);
		}
	}
	lines.push("", "| variant | steps (min-med-max) | tokens (min-med-max) |", "| :-- | :-- | :-- |");
	for (const approach of MCP_COMPARE_APPROACHES) {
		const steps = samples[approach].map((s) => s.steps);
		const tokens = samples[approach].map((s) => s.tokens);
		lines.push(
			`| ${approach} | ${Math.min(...steps)}-${median(steps)}-${Math.max(...steps)} | ${Math.min(...tokens)}-${median(tokens)}-${Math.max(...tokens)} |`,
		);
	}
	const ratio = compareApproaches({
		highLevel: {
			steps: median(samples.highLevel.map((s) => s.steps)),
			tokens: median(samples.highLevel.map((s) => s.tokens)),
		},
		lowLevel: {
			steps: median(samples.lowLevel.map((s) => s.steps)),
			tokens: median(samples.lowLevel.map((s) => s.tokens)),
		},
	});
	lines.push(
		"",
		`median saved by highLevel: ${ratio.steps} steps, ${ratio.tokens} tokens (highLevel/lowLevel token ratio: ${ratio.ratio?.toFixed(2) ?? "n/a"})`,
	);
	return lines.join("\n");
}

// --- End of pure helpers ---

describeLocal("MCP high-level vs low-level tools on a local model", (it) => {
	const cleanup: (() => Promise<void>)[] = [];
	afterAll(async () => {
		for (const close of cleanup.splice(0).reverse()) await close();
	});

	it(
		"observes steps and tokens of findAndReadFiles versus searchFiles + readFile",
		async () => {
			const config = loadPlatformConfig();
			expect(config.mode).toBe("local");
			const resolved = await createModelGateway({ config }).resolve({
				purpose: "chat",
				require: ["tools"],
			});

			const sandbox = await realpath(await mkdtemp(join(tmpdir(), "mcp-compare-")));
			cleanup.push(() => rm(sandbox, { recursive: true, force: true }));
			const root = await createWorkspace(sandbox);

			const registry: McpRegistry = await connectMcpServers([filesServerConfig({ root })], {
				connectTimeoutMs: 20_000,
				transportFor: (serverConfig) => {
					if (serverConfig.id !== FILES_SERVER_ID) return undefined;
					const server = createFilesServer({ root });
					const [clientEnd, serverEnd] = LinkedEnd.pair();
					void server.connect(serverEnd as unknown as Parameters<typeof server.connect>[0]);
					cleanup.push(() => server.close());
					return clientEnd as unknown as ClientTransport;
				},
			});
			cleanup.push(() => registry.close());

			const limits: LoopLimits = config.agent;
			const samples: Record<McpCompareApproach, Sample[]> = { highLevel: [], lowLevel: [] };

			for (let run = 0; run < REPETITIONS; run += 1) {
				// Alternate the order so a warm model cache does not always favour one variant.
				const order =
					run % 2 === 0 ? MCP_COMPARE_APPROACHES : [...MCP_COMPARE_APPROACHES].reverse();
				for (const approach of order) {
					const mcpTools = registry.toolsFor(`mcp-compare-${approach}`, {
						allow: { [FILES_SERVER_ID]: MCP_COMPARE_TOOLS[approach] },
					});
					const { tools } = buildToolSet(
						mcpTools,
						{},
						{ clock: systemClock, toolTimeoutMs: limits.toolTimeoutMs, fatal: new FatalLatch() },
					);
					const guarded = createGuardedAgent({
						model: resolved.model,
						instructions: INSTRUCTIONS,
						tools,
						limits,
						clock: systemClock,
						signal: new AbortController().signal,
						...ollamaRuntimeOptions(resolved.entry),
					});
					let answer = "";
					try {
						const result = await guarded.agent.generate({
							prompt: compareUserText("list-and-read", approach),
							abortSignal: guarded.abortSignal,
						});
						answer = result.text;
					} catch {
						// The run summary records the stop reason; the assertions below report it.
					}
					const summary = await guarded.done;
					samples[approach].push(sampleOf(summary, answer));
				}
			}

			console.info(`\n${formatTable(resolved.entry.id, samples)}\n`);

			for (const approach of MCP_COMPARE_APPROACHES) {
				expect(samples[approach]).toHaveLength(REPETITIONS);
				for (const s of samples[approach]) {
					expect(s.stopReason, `${approach} stop reason`).toBe("completed");
					expect(s.answerChars, `${approach} answer length`).toBeGreaterThan(0);
					expect(Number.isFinite(s.steps) && s.steps > 0).toBe(true);
					expect(Number.isFinite(s.tokens) && s.tokens >= 0).toBe(true);
				}
			}
		},
		LOCAL_MODEL_TIMEOUT_MS,
	);
});
