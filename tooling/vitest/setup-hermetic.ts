import dns from "node:dns";
import dnsPromises from "node:dns/promises";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";

const NETWORK_BLOCKED_CODE = "NETWORK_BLOCKED" as const;
const DEFAULT_HOST = "localhost";

type SocketConnect = net.Socket["connect"];
type DnsLookup = typeof dns.lookup;
type PromiseDnsLookup = typeof dnsPromises.lookup;
type DnsFunction = (...args: never[]) => unknown;

interface AllowedOllamaDestination {
	hostname: string;
	origin: string;
	port: number;
}

interface SocketDestination {
	display: string;
	hostname?: string;
	port?: number;
}

interface InstalledGuards {
	fetch: typeof globalThis.fetch;
	socketConnect: SocketConnect;
	dnsLookup: DnsLookup;
	promiseDnsLookup: PromiseDnsLookup;
	dnsResolvers: Map<string, DnsFunction>;
	promiseDnsResolvers: Map<string, DnsFunction>;
	dnsResolverPrototypeMethods: Map<string, DnsFunction>;
	promiseDnsResolverPrototypeMethods: Map<string, DnsFunction>;
}

let installedGuards: InstalledGuards | undefined;

export class NetworkBlockedError extends Error {
	readonly code = NETWORK_BLOCKED_CODE;
	readonly destination: string;

	constructor(destination: string) {
		super(`Network access blocked during hermetic test: ${destination}`);
		this.name = "NetworkBlockedError";
		this.destination = destination;
	}
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

function allowedOllamaDestination(): AllowedOllamaDestination | undefined {
	if (process.env.AI_TEST_RUN_MODE !== "local" || !process.env.OLLAMA_BASE_URL) {
		return undefined;
	}

	try {
		const url = new URL(process.env.OLLAMA_BASE_URL);
		const port = defaultPort(url);
		if ((url.protocol !== "http:" && url.protocol !== "https:") || port === undefined) {
			return undefined;
		}
		return {
			hostname: normalizeHostname(url.hostname),
			origin: url.origin,
			port,
		};
	} catch {
		return undefined;
	}
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

function isDnsResolverMethod(name: string): boolean {
	return name === "reverse" || name.startsWith("resolve");
}

function isAllowedSocketDestination(
	destination: SocketDestination,
	allowed: AllowedOllamaDestination | undefined,
): boolean {
	return (
		allowed !== undefined &&
		destination.hostname === allowed.hostname &&
		destination.port === allowed.port
	);
}

function isAllowedDnsHostname(
	hostname: unknown,
	allowed: AllowedOllamaDestination | undefined,
): boolean {
	return typeof hostname === "string" && normalizeHostname(hostname) === allowed?.hostname;
}

export function restoreHermeticNetworkGuards(): void {
	if (!installedGuards) return;

	globalThis.fetch = installedGuards.fetch;
	net.Socket.prototype.connect = installedGuards.socketConnect;
	dns.lookup = installedGuards.dnsLookup;
	dnsPromises.lookup = installedGuards.promiseDnsLookup;
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

export function installHermeticNetworkGuards(): void {
	restoreHermeticNetworkGuards();

	const allowed = allowedOllamaDestination();
	const originalFetch = globalThis.fetch;
	const originalSocketConnect = net.Socket.prototype.connect;
	const originalDnsLookup = dns.lookup;
	const originalPromiseDnsLookup = dnsPromises.lookup;
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
		if (allowed && destination.origin === allowed.origin) {
			return originalFetch(input, init);
		}
		throw new NetworkBlockedError(destination.display);
	};

	net.Socket.prototype.connect = function guardedConnect(
		this: net.Socket,
		...args: unknown[]
	): net.Socket {
		const destination = socketDestination(args);
		if (isAllowedSocketDestination(destination, allowed)) {
			return Reflect.apply(originalSocketConnect, this, args) as net.Socket;
		}
		throw new NetworkBlockedError(destination.display);
	} as SocketConnect;

	dns.lookup = function guardedLookup(hostname: string, ...args: unknown[]): void {
		if (isAllowedDnsHostname(hostname, allowed)) {
			Reflect.apply(originalDnsLookup, dns, [hostname, ...args]);
			return;
		}
		throw new NetworkBlockedError(hostname);
	} as DnsLookup;

	dnsPromises.lookup = async function guardedPromiseLookup(
		hostname: string,
		...args: unknown[]
	): Promise<unknown> {
		if (isAllowedDnsHostname(hostname, allowed)) {
			return Reflect.apply(originalPromiseDnsLookup, dnsPromises, [hostname, ...args]);
		}
		throw new NetworkBlockedError(hostname);
	} as PromiseDnsLookup;

	for (const name of Object.keys(dns).filter(isDnsResolverMethod)) {
		const resolver = mutableDns[name];
		if (typeof resolver !== "function") continue;
		dnsResolvers.set(name, resolver as DnsFunction);
		mutableDns[name] = (hostname: unknown, ...args: unknown[]) => {
			if (isAllowedDnsHostname(hostname, allowed)) {
				return Reflect.apply(resolver, dns, [hostname, ...args]);
			}
			throw new NetworkBlockedError(String(hostname));
		};
	}

	for (const name of Object.keys(dnsPromises).filter(isDnsResolverMethod)) {
		const resolver = mutableDnsPromises[name];
		if (typeof resolver !== "function") continue;
		promiseDnsResolvers.set(name, resolver as DnsFunction);
		mutableDnsPromises[name] = async (hostname: unknown, ...args: unknown[]) => {
			if (isAllowedDnsHostname(hostname, allowed)) {
				return Reflect.apply(resolver, dnsPromises, [hostname, ...args]);
			}
			throw new NetworkBlockedError(String(hostname));
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
			if (isAllowedDnsHostname(hostname, allowed)) {
				return Reflect.apply(resolver, this, [hostname, ...args]);
			}
			throw new NetworkBlockedError(String(hostname));
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
			if (isAllowedDnsHostname(hostname, allowed)) {
				return Reflect.apply(resolver, this, [hostname, ...args]);
			}
			throw new NetworkBlockedError(String(hostname));
		};
	}

	syncBuiltinESMExports();

	installedGuards = {
		fetch: originalFetch,
		socketConnect: originalSocketConnect,
		dnsLookup: originalDnsLookup,
		promiseDnsLookup: originalPromiseDnsLookup,
		dnsResolvers,
		promiseDnsResolvers,
		dnsResolverPrototypeMethods,
		promiseDnsResolverPrototypeMethods,
	};
}

installHermeticNetworkGuards();
