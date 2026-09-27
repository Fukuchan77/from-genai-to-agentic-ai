// Side-effect-free hermetic network guard (plan C18, Req 2.11). `setup-hermetic.ts` installs it
// for every test file; tests import this module directly when they must not install it themselves.
import dgram from "node:dgram";
import dns from "node:dns";
import dnsPromises from "node:dns/promises";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";
import { normalizeOllamaBaseUrl } from "./ollama";

const NETWORK_BLOCKED_CODE = "NETWORK_BLOCKED" as const;
const DEFAULT_HOST = "localhost";
/** Default host port of the Compose `postgres` service (`compose.yaml`, `POSTGRES_PORT`). */
export const DEFAULT_POSTGRES_PORT = 5432;
const POSTGRES_LOCAL_HOSTS = ["127.0.0.1", "localhost"] as const;

type SocketConnect = net.Socket["connect"];
type DgramSend = dgram.Socket["send"];
type DgramConnect = dgram.Socket["connect"];
type DnsLookup = typeof dns.lookup;
type PromiseDnsLookup = typeof dnsPromises.lookup;
type DnsLookupService = typeof dns.lookupService;
type PromiseDnsLookupService = typeof dnsPromises.lookupService;
type DnsFunction = (...args: never[]) => unknown;

interface HostPort {
	hostname: string;
	port: number;
}

/** Destinations the guard delegates to the real implementation; everything else is blocked. */
interface GuardPolicy {
	dnsHostnames: ReadonlySet<string>;
	fetchOrigins: ReadonlySet<string>;
	sockets: readonly HostPort[];
}

interface SocketDestination {
	display: string;
	hostname?: string;
	port?: number;
}

interface InstalledGuards {
	fetch: typeof globalThis.fetch;
	socketConnect: SocketConnect;
	dgramSend: DgramSend;
	dgramConnect: DgramConnect;
	dnsLookup: DnsLookup;
	promiseDnsLookup: PromiseDnsLookup;
	dnsLookupService: DnsLookupService;
	promiseDnsLookupService: PromiseDnsLookupService;
	dnsResolvers: Map<string, DnsFunction>;
	promiseDnsResolvers: Map<string, DnsFunction>;
	dnsResolverPrototypeMethods: Map<string, DnsFunction>;
	promiseDnsResolverPrototypeMethods: Map<string, DnsFunction>;
}

let installedGuards: InstalledGuards | undefined;
const blockedConnections: string[] = [];

export class NetworkBlockedError extends Error {
	readonly code = NETWORK_BLOCKED_CODE;
	readonly destination: string;

	constructor(destination: string) {
		super(`Network access blocked during hermetic test: ${destination}`);
		this.name = "NetworkBlockedError";
		this.destination = destination;
	}
}

/** Records the blocked destination so the test fails even if the caller swallows the error. */
function block(destination: string): NetworkBlockedError {
	blockedConnections.push(destination);
	return new NetworkBlockedError(destination);
}

/**
 * Returns and clears the destinations blocked since the last call. Tests that expect blocking
 * call this to acknowledge it; anything left unconsumed fails the test in `afterEach`.
 */
export function consumeBlockedConnections(): string[] {
	return blockedConnections.splice(0);
}

/** Throws (and clears the record) when any blocked destination was not consumed by the test. */
export function assertNoUnconsumedBlockedConnections(): void {
	const destinations = consumeBlockedConnections();
	if (destinations.length === 0) return;
	throw new Error(
		`Unmocked network access was blocked during this test (${destinations.length}): ${destinations.join(", ")}. Mock the connection, or call consumeBlockedConnections() when blocking is the expected outcome.`,
	);
}

function normalizeHostname(hostname: string): string {
	return hostname.replace(/^\[|\]$/gu, "").toLowerCase();
}

function parsePort(port: string | number | undefined): number | undefined {
	if (typeof port === "number") return port;
	if (typeof port !== "string" || port.length === 0) return undefined;
	const parsed = Number(port);
	return Number.isInteger(parsed) ? parsed : undefined;
}

function defaultPort(url: URL): number | undefined {
	if (url.port) return parsePort(url.port);
	if (url.protocol === "http:") return 80;
	if (url.protocol === "https:") return 443;
	return undefined;
}

function ollamaDestination(env: NodeJS.ProcessEnv): (HostPort & { origin: string }) | undefined {
	if (env.AI_TEST_RUN_MODE !== "local") return undefined;
	const baseUrl = normalizeOllamaBaseUrl(env.OLLAMA_BASE_URL);
	if (!baseUrl) return undefined;
	const url = new URL(baseUrl);
	const port = defaultPort(url);
	if (port === undefined) return undefined;
	return { hostname: normalizeHostname(url.hostname), origin: url.origin, port };
}

function postgresPort(env: NodeJS.ProcessEnv): number | undefined {
	const configured = env.POSTGRES_PORT?.trim();
	if (!configured) return DEFAULT_POSTGRES_PORT;
	const port = parsePort(configured);
	return port !== undefined && port > 0 && port < 65_536 ? port : undefined;
}

function guardPolicy(env: NodeJS.ProcessEnv): GuardPolicy {
	const dnsHostnames = new Set<string>();
	const fetchOrigins = new Set<string>();
	const sockets: HostPort[] = [];

	const ollama = ollamaDestination(env);
	if (ollama) {
		fetchOrigins.add(ollama.origin);
		sockets.push({ hostname: ollama.hostname, port: ollama.port });
		dnsHostnames.add(ollama.hostname);
	}

	const pgPort = env.AI_TEST_SUITE === "pg" ? postgresPort(env) : undefined;
	if (pgPort !== undefined) {
		for (const hostname of POSTGRES_LOCAL_HOSTS) {
			sockets.push({ hostname, port: pgPort });
			dnsHostnames.add(hostname);
		}
	}

	return { dnsHostnames, fetchOrigins, sockets };
}

function fetchDestination(input: RequestInfo | URL): { display: string; origin?: string } {
	const display = input instanceof Request ? input.url : input.toString();
	try {
		return { display, origin: new URL(display).origin };
	} catch {
		return { display };
	}
}

function socketDestination(args: readonly unknown[]): SocketDestination {
	const connectArgs = Array.isArray(args[0]) ? args[0] : args;
	const first = connectArgs[0];
	if (typeof first === "number") {
		const hostname = typeof connectArgs[1] === "string" ? connectArgs[1] : DEFAULT_HOST;
		return {
			display: `${hostname}:${first}`,
			hostname: normalizeHostname(hostname),
			port: first,
		};
	}
	if (typeof first === "string") return { display: first };
	if (typeof first === "object" && first !== null) {
		const options = first as { host?: string; path?: string; port?: number | string };
		if (options.path) return { display: options.path };
		const hostname = options.host ?? DEFAULT_HOST;
		const port = parsePort(options.port);
		return {
			display: port === undefined ? hostname : `${hostname}:${port}`,
			hostname: normalizeHostname(hostname),
			...(port === undefined ? {} : { port }),
		};
	}
	return { display: String(first) };
}

function hostPortDisplay(port: unknown, address: unknown): string {
	const hostname = typeof address === "string" && address.length > 0 ? address : DEFAULT_HOST;
	return `${hostname}:${String(port)}`;
}

/** `send(msg, [offset, length,] port, [address], [callback])`; a connected socket omits port. */
function dgramSendDestination(args: readonly unknown[]): string {
	if (typeof args[3] === "number" || typeof args[3] === "string") {
		return hostPortDisplay(args[3], args[4]);
	}
	if (typeof args[1] === "number" || typeof args[1] === "string") {
		return hostPortDisplay(args[1], args[2]);
	}
	return "connected dgram socket";
}

function isDnsResolverMethod(name: string): boolean {
	return name === "reverse" || name.startsWith("resolve");
}

function isAllowedSocketDestination(destination: SocketDestination, policy: GuardPolicy): boolean {
	return policy.sockets.some(
		(allowed) => destination.hostname === allowed.hostname && destination.port === allowed.port,
	);
}

function isAllowedDnsHostname(hostname: unknown, policy: GuardPolicy): boolean {
	return typeof hostname === "string" && policy.dnsHostnames.has(normalizeHostname(hostname));
}

export function restoreHermeticNetworkGuards(): void {
	if (!installedGuards) return;

	globalThis.fetch = installedGuards.fetch;
	net.Socket.prototype.connect = installedGuards.socketConnect;
	dgram.Socket.prototype.send = installedGuards.dgramSend;
	dgram.Socket.prototype.connect = installedGuards.dgramConnect;
	dns.lookup = installedGuards.dnsLookup;
	dnsPromises.lookup = installedGuards.promiseDnsLookup;
	dns.lookupService = installedGuards.dnsLookupService;
	dnsPromises.lookupService = installedGuards.promiseDnsLookupService;
	const mutableDns = dns as unknown as Record<string, unknown>;
	for (const [name, resolver] of installedGuards.dnsResolvers) {
		mutableDns[name] = resolver;
	}
	const mutableDnsPromises = dnsPromises as unknown as Record<string, unknown>;
	for (const [name, resolver] of installedGuards.promiseDnsResolvers) {
		mutableDnsPromises[name] = resolver;
	}
	const dnsResolverPrototype = dns.Resolver.prototype as unknown as Record<string, unknown>;
	for (const [name, resolver] of installedGuards.dnsResolverPrototypeMethods) {
		dnsResolverPrototype[name] = resolver;
	}
	const promiseDnsResolverPrototype = dnsPromises.Resolver.prototype as unknown as Record<
		string,
		unknown
	>;
	for (const [name, resolver] of installedGuards.promiseDnsResolverPrototypeMethods) {
		promiseDnsResolverPrototype[name] = resolver;
	}
	syncBuiltinESMExports();
	installedGuards = undefined;
}

/**
 * Blocks fetch, `node:net` sockets, `node:dgram` sends/connects, and `node:dns` lookups.
 * Allowed only: the Ollama origin (from `OLLAMA_BASE_URL`, default in `./ollama`) when
 * `AI_TEST_RUN_MODE=local`, and `127.0.0.1`/`localhost` at `POSTGRES_PORT` when `AI_TEST_SUITE=pg`.
 */
export function installHermeticNetworkGuards(env: NodeJS.ProcessEnv = process.env): void {
	restoreHermeticNetworkGuards();

	const policy = guardPolicy(env);
	const originalFetch = globalThis.fetch;
	const originalSocketConnect = net.Socket.prototype.connect;
	const originalDgramSend = dgram.Socket.prototype.send;
	const originalDgramConnect = dgram.Socket.prototype.connect;
	const originalDnsLookup = dns.lookup;
	const originalPromiseDnsLookup = dnsPromises.lookup;
	const originalDnsLookupService = dns.lookupService;
	const originalPromiseDnsLookupService = dnsPromises.lookupService;
	const mutableDns = dns as unknown as Record<string, unknown>;
	const mutableDnsPromises = dnsPromises as unknown as Record<string, unknown>;
	const dnsResolverPrototype = dns.Resolver.prototype as unknown as Record<string, unknown>;
	const promiseDnsResolverPrototype = dnsPromises.Resolver.prototype as unknown as Record<
		string,
		unknown
	>;
	const dnsResolvers = new Map<string, DnsFunction>();
	const promiseDnsResolvers = new Map<string, DnsFunction>();
	const dnsResolverPrototypeMethods = new Map<string, DnsFunction>();
	const promiseDnsResolverPrototypeMethods = new Map<string, DnsFunction>();

	globalThis.fetch = async (input, init) => {
		const destination = fetchDestination(input);
		if (destination.origin !== undefined && policy.fetchOrigins.has(destination.origin)) {
			return originalFetch(input, init);
		}
		throw block(destination.display);
	};

	net.Socket.prototype.connect = function guardedConnect(
		this: net.Socket,
		...args: unknown[]
	): net.Socket {
		const destination = socketDestination(args);
		if (isAllowedSocketDestination(destination, policy)) {
			return Reflect.apply(originalSocketConnect, this, args) as net.Socket;
		}
		throw block(destination.display);
	} as SocketConnect;

	// UDP has no allowed destination: no supported service in the test policy uses it.
	dgram.Socket.prototype.send = function guardedDgramSend(...args: unknown[]): void {
		throw block(dgramSendDestination(args));
	} as DgramSend;

	dgram.Socket.prototype.connect = function guardedDgramConnect(
		port: unknown,
		address?: unknown,
	): void {
		throw block(hostPortDisplay(port, address));
	} as DgramConnect;

	dns.lookup = function guardedLookup(hostname: string, ...args: unknown[]): void {
		if (isAllowedDnsHostname(hostname, policy)) {
			Reflect.apply(originalDnsLookup, dns, [hostname, ...args]);
			return;
		}
		throw block(hostname);
	} as DnsLookup;

	dnsPromises.lookup = async function guardedPromiseLookup(
		hostname: string,
		...args: unknown[]
	): Promise<unknown> {
		if (isAllowedDnsHostname(hostname, policy)) {
			return Reflect.apply(originalPromiseDnsLookup, dnsPromises, [hostname, ...args]);
		}
		throw block(hostname);
	} as PromiseDnsLookup;

	// Reverse lookups are never needed by an allowed destination, so they are always blocked.
	dns.lookupService = function guardedLookupService(address: unknown, port: unknown): void {
		throw block(hostPortDisplay(port, address));
	} as unknown as DnsLookupService;

	dnsPromises.lookupService = async function guardedPromiseLookupService(
		address: unknown,
		port: unknown,
	): Promise<never> {
		throw block(hostPortDisplay(port, address));
	} as PromiseDnsLookupService;

	for (const name of Object.keys(dns).filter(isDnsResolverMethod)) {
		const resolver = mutableDns[name];
		if (typeof resolver !== "function") continue;
		dnsResolvers.set(name, resolver as DnsFunction);
		mutableDns[name] = (hostname: unknown, ...args: unknown[]) => {
			if (isAllowedDnsHostname(hostname, policy)) {
				return Reflect.apply(resolver, dns, [hostname, ...args]);
			}
			throw block(String(hostname));
		};
	}

	for (const name of Object.keys(dnsPromises).filter(isDnsResolverMethod)) {
		const resolver = mutableDnsPromises[name];
		if (typeof resolver !== "function") continue;
		promiseDnsResolvers.set(name, resolver as DnsFunction);
		mutableDnsPromises[name] = async (hostname: unknown, ...args: unknown[]) => {
			if (isAllowedDnsHostname(hostname, policy)) {
				return Reflect.apply(resolver, dnsPromises, [hostname, ...args]);
			}
			throw block(String(hostname));
		};
	}

	for (const name of Object.getOwnPropertyNames(dns.Resolver.prototype).filter(
		isDnsResolverMethod,
	)) {
		const resolver = dnsResolverPrototype[name];
		if (typeof resolver !== "function") continue;
		dnsResolverPrototypeMethods.set(name, resolver as DnsFunction);
		dnsResolverPrototype[name] = function guardedResolver(
			this: dns.Resolver,
			hostname: unknown,
			...args: unknown[]
		) {
			if (isAllowedDnsHostname(hostname, policy)) {
				return Reflect.apply(resolver, this, [hostname, ...args]);
			}
			throw block(String(hostname));
		};
	}

	for (const name of Object.getOwnPropertyNames(dnsPromises.Resolver.prototype).filter(
		isDnsResolverMethod,
	)) {
		const resolver = promiseDnsResolverPrototype[name];
		if (typeof resolver !== "function") continue;
		promiseDnsResolverPrototypeMethods.set(name, resolver as DnsFunction);
		promiseDnsResolverPrototype[name] = async function guardedPromiseResolver(
			this: dnsPromises.Resolver,
			hostname: unknown,
			...args: unknown[]
		) {
			if (isAllowedDnsHostname(hostname, policy)) {
				return Reflect.apply(resolver, this, [hostname, ...args]);
			}
			throw block(String(hostname));
		};
	}

	syncBuiltinESMExports();

	installedGuards = {
		fetch: originalFetch,
		socketConnect: originalSocketConnect,
		dgramSend: originalDgramSend,
		dgramConnect: originalDgramConnect,
		dnsLookup: originalDnsLookup,
		promiseDnsLookup: originalPromiseDnsLookup,
		dnsLookupService: originalDnsLookupService,
		promiseDnsLookupService: originalPromiseDnsLookupService,
		dnsResolvers,
		promiseDnsResolvers,
		dnsResolverPrototypeMethods,
		promiseDnsResolverPrototypeMethods,
	};
}
