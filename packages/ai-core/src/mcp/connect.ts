import {
	createMCPClient,
	type ListToolsResult,
	type MCPClient,
	type MCPTransport,
} from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import { type AnyAciTool, ToolExecutionError } from "../aci";
import { DEFAULT_TOOLS } from "../config/defaults";
import { ConfigError } from "../config/load";
import { raceWithAbort } from "../ports/abort";
import { type Clock, systemClock } from "../ports/clock";
import { adaptMcpTool } from "./adapt";
import { buildAllowedSchemas, loadAllowedTools } from "./allow-list";
import { riskFromAnnotations } from "./risk";
import type {
	AgentId,
	McpAllowList,
	McpServerConfig,
	McpServerStatus,
	McpToolStatus,
} from "./types";

const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;
const SERVER_ID = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/u;
const DISCONNECTED = /Connection closed|closed client|not connected/iu;

export interface ConnectOptions {
	/** Aborting rejects `connectMcpServers` after it has closed what it opened. */
	readonly signal?: AbortSignal | undefined;
	readonly clock?: Clock | undefined;
	/** How long one server may take to connect and list its tools. */
	readonly connectTimeoutMs?: number | undefined;
	/** The most tools one agent may load. Defaults to `DEFAULT_TOOLS.maxToolsPerAgent`. */
	readonly maxToolsPerAgent?: number | undefined;
	/**
	 * Supplies the transport of a server instead of starting or dialling it (tests connect to a server
	 * in the same process). Returning `undefined` uses the configured transport.
	 */
	readonly transportFor?: ((config: McpServerConfig) => MCPTransport | undefined) | undefined;
}

export interface ToolsForOptions {
	/**
	 * Server ID → the tools this agent loads from it. It can only narrow a server's configured
	 * allow-list; a name outside it is a configuration error.
	 */
	readonly allow?: McpAllowList | undefined;
	/** How many tools the agent holds besides these (its built-in tools), counted against the limit. */
	readonly reservedTools?: number | undefined;
}

export interface McpRegistry {
	status(): readonly McpServerStatus[];
	/** The tools one agent may use: allowed, read-only, and well described. Throws above the limit. */
	toolsFor(agentId: AgentId, options?: ToolsForOptions): readonly AnyAciTool[];
	close(): Promise<void>;
}

interface ServerState {
	readonly config: McpServerConfig;
	client: MCPClient | undefined;
	definitions: ListToolsResult | undefined;
	status: McpServerStatus;
	/** Set by the client's uncaught-error hook when the connection is gone (the error's name only). */
	brokenBy?: string;
}

/**
 * True only for the client's own "the connection is gone" error. A JSON-RPC error a server sends
 * carries a `code` (and the server chooses its text), so it never counts: an untrusted server must
 * not be able to take itself, or a tool, out of the registry by wording an error.
 */
function isReconnectExhausted(error: unknown): boolean {
	return (
		error instanceof Error &&
		error.name === "MCPClientError" &&
		(error as { code?: unknown }).code === undefined &&
		/Maximum reconnection attempts/iu.test(error.message)
	);
}

export function isDisconnectError(error: unknown): boolean {
	return (
		error instanceof Error &&
		error.name === "MCPClientError" &&
		(error as { code?: unknown }).code === undefined &&
		DISCONNECTED.test(error.message)
	);
}

function codeOf(error: unknown): string | undefined {
	if (typeof error !== "object" || error === null) return undefined;
	const code = (error as { code?: unknown }).code;
	return typeof code === "string" ? code : undefined;
}

function httpStatusOf(error: unknown): number | undefined {
	if (typeof error !== "object" || error === null) return undefined;
	const record = error as { statusCode?: unknown; status?: unknown };
	const status = record.statusCode ?? record.status;
	return typeof status === "number" ? status : undefined;
}

/**
 * What the learner reads when a server cannot be reached. Built from the kind of failure only: the
 * error's own message can hold a response body or a header, and so a secret.
 */
function describeConnectError(error: unknown): string {
	const status = httpStatusOf(error);
	if (status === 401 || status === 403) {
		return "認証に失敗しました（auth-failed）。トークンの値と権限を確認してください。";
	}
	if (codeOf(error) === "ENOENT") return "起動コマンドが見つかりません（ENOENT）。";
	const name = error instanceof Error ? error.name : typeof error;
	if (name === "TimeoutError") return "接続がタイムアウトしました。";
	return `接続に失敗しました（${name}）。起動コマンド、環境変数、接続先を確認してください。`;
}

function assertValidConfigs(configs: readonly McpServerConfig[]): void {
	const ids = new Set<string>();
	for (const config of configs) {
		if (!SERVER_ID.test(config.id)) {
			throw new ConfigError(
				`MCP サーバーの ID「${config.id}」は英字で始まる32文字以内の英数字・_・- にしてください。`,
			);
		}
		if (ids.has(config.id))
			throw new ConfigError(`MCP サーバーの ID「${config.id}」が重複しています。`);
		ids.add(config.id);
	}
}

function createTransport(config: McpServerConfig, options: ConnectOptions) {
	const injected = options.transportFor?.(config);
	if (injected !== undefined) return injected;
	const { transport } = config;
	if (transport.kind === "stdio") {
		return new Experimental_StdioMCPTransport({
			command: transport.command,
			args: [...transport.args],
			env: { ...transport.env },
		}) as unknown as MCPTransport;
	}
	return { type: "http" as const, url: transport.url, headers: { ...transport.headers } };
}

async function listAllTools(client: MCPClient): Promise<ListToolsResult> {
	let page = await client.listTools();
	const tools = [...page.tools];
	while (page.nextCursor !== undefined) {
		page = await client.listTools({ params: { cursor: page.nextCursor } });
		tools.push(...page.tools);
	}
	return { ...page, tools };
}

function closeQuietly(client: MCPClient | undefined): Promise<void> {
	return client ? client.close().catch(() => undefined) : Promise.resolve();
}

async function connectOne(config: McpServerConfig, options: ConnectOptions): Promise<ServerState> {
	const state: ServerState = {
		config,
		client: undefined,
		definitions: undefined,
		status: { id: config.id, state: "unavailable", tools: [] },
	};
	const clock = options.clock ?? systemClock;
	const limit = clock.timeoutSignal(options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS);
	const signal = options.signal ? AbortSignal.any([options.signal, limit]) : limit;
	try {
		const unusable = await config.preflight?.();
		if (unusable !== undefined) {
			state.status = { id: config.id, state: "unavailable", reason: unusable, tools: [] };
			return state;
		}
		const opening = (async () => {
			const client = await createMCPClient({
				transport: createTransport(config, options),
				// A terminal transport failure takes the server out at the next `status()`; any other
				// error is dropped (its message may hold a header or a body).
				onUncaughtError: (error) => {
					if (isDisconnectError(error) || isReconnectExhausted(error)) {
						state.brokenBy = error instanceof Error ? error.name : "Error";
					}
				},
			});
			try {
				return { client, definitions: await listAllTools(client) };
			} catch (error) {
				await closeQuietly(client);
				throw error;
			}
		})();
		// A server that answers after the limit must not stay connected.
		opening.then(
			async (late) => {
				if (signal.aborted) await closeQuietly(late.client);
			},
			() => undefined,
		);
		const { client, definitions } = await raceWithAbort(opening, signal);
		state.client = client;
		state.definitions = definitions;
		state.status = { id: config.id, state: "connected", tools: [] };
	} catch (error) {
		if (options.signal?.aborted) throw error;
		state.status = {
			id: config.id,
			state: "unavailable",
			reason: describeConnectError(error),
			tools: [],
		};
	}
	return state;
}

interface Assembled {
	readonly tools: readonly AnyAciTool[];
	readonly statuses: readonly McpToolStatus[];
}

/**
 * Decides, for one server and one allow-list, which tools an agent gets and why the others are left
 * out. `taken` holds the names earlier servers already supplied: the first server keeps a name.
 */
function assemble(
	state: ServerState,
	allow: readonly string[],
	taken: Set<string>,
	onCallError: (error: unknown) => unknown,
): Assembled {
	const { client, definitions, config } = state;
	if (!client || !definitions) return { tools: [], statuses: [] };

	const allowed = new Set(allow);
	const risks = new Map(
		definitions.tools.map((definition) => [
			definition.name,
			riskFromAnnotations(definition.annotations),
		]),
	);
	const reasons = new Map<string, string>();
	const eligible: string[] = [];
	for (const definition of definitions.tools) {
		const risk = risks.get(definition.name) ?? "destructive";
		if (!allowed.has(definition.name)) {
			reasons.set(definition.name, "許可リストにありません。");
		} else if (risk !== "read-only") {
			reasons.set(
				definition.name,
				`リスク区分が ${risk} のため登録しません（read-only にするには、サーバーが readOnlyHint: true を付ける必要があります）。`,
			);
		} else if (taken.has(definition.name)) {
			reasons.set(definition.name, "同名のツールが先に接続したサーバーにあるため登録しません。");
		} else {
			eligible.push(definition.name);
		}
	}

	const selection = buildAllowedSchemas(definitions.tools, eligible);
	const clientTools = loadAllowedTools(client, definitions, selection);
	const tools: AnyAciTool[] = [];
	for (const name of selection.loaded) {
		const clientTool = clientTools[name];
		const definition = definitions.tools.find((candidate) => candidate.name === name);
		const description = config.descriptions?.[name] ?? definition?.description ?? "";
		const adapted = clientTool
			? adaptMcpTool(name, clientTool, {
					serverId: config.id,
					risk: risks.get(name) ?? "destructive",
					description,
					trustErrorMeta: config.trustErrorMeta,
					learnerMessageFor: (code) => config.fatalMessages?.[code],
					onCallError,
				})
			: ({ ok: false, reason: "クライアントがツールを作成できませんでした。" } as const);
		if (adapted.ok) {
			tools.push(adapted.tool);
			taken.add(name);
		} else {
			reasons.set(name, adapted.reason);
		}
	}

	const statuses: McpToolStatus[] = definitions.tools.map((definition) => {
		const reason = reasons.get(definition.name);
		return {
			name: definition.name,
			risk: risks.get(definition.name) ?? "destructive",
			registered: reason === undefined,
			...(reason === undefined ? {} : { disabledReason: reason }),
		};
	});
	const exposed = new Set(definitions.tools.map((definition) => definition.name));
	for (const name of [...allowed].filter((candidate) => !exposed.has(candidate))) {
		statuses.push({
			name,
			risk: "destructive",
			registered: false,
			disabledReason: "許可リストにありますが、サーバーが公開していません。",
		});
	}
	return { tools, statuses };
}

class Registry implements McpRegistry {
	readonly #states: readonly ServerState[];
	readonly #maxTools: number;
	#closed = false;

	constructor(states: readonly ServerState[], options: ConnectOptions) {
		this.#states = states;
		this.#maxTools = options.maxToolsPerAgent ?? DEFAULT_TOOLS.maxToolsPerAgent;
		// The statuses of a connected server describe what its configured allow-list gives.
		const taken = new Set<string>();
		let configured = 0;
		for (const state of states) {
			if (state.status.state !== "connected") continue;
			const { statuses } = assemble(state, state.config.allow, taken, this.#onCallError(state));
			state.status = { ...state.status, tools: statuses };
			configured += statuses.filter((tool) => tool.registered).length;
		}
		// Req 1.15: a configuration over the limit is refused when it is built, not per request.
		if (configured > this.#maxTools) {
			throw new ConfigError(
				`設定された MCP ツールが ${this.#maxTools} 個を超えます（${configured} 個）。サーバーの許可リストを絞ってください。`,
			);
		}
	}

	status(): readonly McpServerStatus[] {
		for (const state of this.#states) {
			if (state.brokenBy !== undefined) {
				this.#markUnavailable(
					state,
					`サーバー「${state.config.id}」との接続が切れました（${state.brokenBy}）。`,
				);
			}
		}
		return this.#states.map((state) => state.status);
	}

	toolsFor(agentId: AgentId, options: ToolsForOptions = {}): readonly AnyAciTool[] {
		const requested = options.allow ?? {};
		for (const [serverId, names] of Object.entries(requested)) {
			const state = this.#states.find((candidate) => candidate.config.id === serverId);
			if (!state) {
				throw new ConfigError(`許可リストが未設定の MCP サーバー「${serverId}」を指定しています。`);
			}
			const outside = names.filter((name) => !state.config.allow.includes(name));
			if (outside.length > 0) {
				throw new ConfigError(
					`サーバー「${serverId}」の許可リストにないツール（${outside.join("、")}）は読み込めません。`,
				);
			}
		}
		const taken = new Set<string>();
		const tools: AnyAciTool[] = [];
		for (const state of this.#states) {
			if (state.status.state !== "connected") continue;
			const allow = requested[state.config.id] ?? state.config.allow;
			tools.push(...assemble(state, allow, taken, this.#onCallError(state)).tools);
		}
		const total = (options.reservedTools ?? 0) + tools.length;
		if (total > this.#maxTools) {
			throw new ConfigError(
				`エージェント「${agentId}」のツールが ${this.#maxTools} 個を超えます（${total} 個）。許可リストを絞ってください。`,
			);
		}
		return tools;
	}

	/** A call that failed because the connection is gone: the server leaves the registry (Req 1.10). */
	#onCallError(state: ServerState): (error: unknown) => unknown {
		return (error) => {
			if (!isDisconnectError(error)) return undefined;
			const cause = "接続が閉じられました";
			this.#markUnavailable(state, `サーバー「${state.config.id}」が切断されました（${cause}）。`);
			return new ToolExecutionError(
				`サーバー「${state.config.id}」が切断されました（${cause}）。`,
				{
					nextAction: `サーバー「${state.config.id}」のツールはこの実行では使えません。他のツールで続けるか、ツールを使わずに回答してください。`,
				},
			);
		};
	}

	#markUnavailable(state: ServerState, reason: string): void {
		if (state.status.state === "unavailable") return;
		state.status = {
			id: state.config.id,
			state: "unavailable",
			reason,
			tools: state.status.tools.map((tool) => ({
				...tool,
				registered: false,
				disabledReason: "サーバーが切断されました。",
			})),
		};
		const client = state.client;
		state.client = undefined;
		void closeQuietly(client);
	}

	async close(): Promise<void> {
		if (this.#closed) return;
		this.#closed = true;
		await Promise.all(this.#states.map((state) => closeQuietly(state.client)));
	}
}

/**
 * Connects to every configured server at once. A server that cannot be reached is recorded as
 * `unavailable` with a reason and does not affect the others (Req 1.10); only an abort by the caller
 * rejects, after the clients opened so far are closed.
 */
export async function connectMcpServers(
	configs: readonly McpServerConfig[],
	options: ConnectOptions = {},
): Promise<McpRegistry> {
	assertValidConfigs(configs);
	const settled = await Promise.allSettled(configs.map((config) => connectOne(config, options)));
	const states = settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
	const aborted = settled.find((result) => result.status === "rejected");
	if (aborted?.status === "rejected") {
		await Promise.all(states.map((state) => closeQuietly(state.client)));
		throw aborted.reason;
	}
	try {
		return new Registry(states, options);
	} catch (error) {
		await Promise.all(states.map((state) => closeQuietly(state.client)));
		throw error;
	}
}
