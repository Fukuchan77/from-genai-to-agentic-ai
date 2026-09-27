import dgram from "node:dgram";
import dns, { lookup as namedDnsLookup, resolve4 as namedDnsResolve4 } from "node:dns";
import dnsPromises, {
	lookup as namedPromiseDnsLookup,
	resolve4 as namedPromiseDnsResolve4,
} from "node:dns/promises";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	assertNoUnconsumedBlockedConnections,
	consumeBlockedConnections,
	installHermeticNetworkGuards,
	NetworkBlockedError,
	restoreHermeticNetworkGuards,
} from "./setup-hermetic";

// Every destination in this file is loopback, and resolvers point at loopback, so a broken
// guard fails these tests without sending traffic off the host (review N-3).
const LOOPBACK_DNS_SERVERS = ["127.0.0.1"];
dns.setServers(LOOPBACK_DNS_SERVERS);

function loopbackResolver<T extends { setServers(servers: readonly string[]): void }>(
	resolver: T,
): T {
	resolver.setServers(LOOPBACK_DNS_SERVERS);
	return resolver;
}

const resolveMethodNames = Object.keys(dns).filter((name) => name.startsWith("resolve"));
const promiseResolveMethodNames = Object.keys(dnsPromises).filter((name) =>
	name.startsWith("resolve"),
);

describe("hermetic network guards", () => {
	beforeEach(() => {
		restoreHermeticNetworkGuards();
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
		vi.stubEnv("AI_TEST_RUN_MODE", "mock");
		installHermeticNetworkGuards();
	});

	afterEach(() => {
		restoreHermeticNetworkGuards();
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
		syncBuiltinESMExports();
	});

	it("blocks fetch and reports the requested destination", async () => {
		await expect(fetch("https://localhost/api?q=1")).rejects.toMatchObject({
			name: "NetworkBlockedError",
			code: "NETWORK_BLOCKED",
			destination: "https://localhost/api?q=1",
		});
		expect(consumeBlockedConnections()).toEqual(["https://localhost/api?q=1"]);
	});

	it("blocks every Socket.connect form before a connection starts", () => {
		expect(() => new net.Socket().connect({ host: "localhost", port: 443 })).toThrowError(
			expect.objectContaining({
				name: "NetworkBlockedError",
				destination: "localhost:443",
			}),
		);
		expect(() => new net.Socket().connect(11434, "localhost")).toThrowError(/localhost:11434/u);
		expect(() => new net.Socket().connect(11434)).toThrowError(/localhost:11434/u);
		expect(() => new net.Socket().connect("/tmp/agent.sock")).toThrowError(/\/tmp\/agent\.sock/u);
		expect(() => net.connect({ host: "localhost", port: 443 })).toThrowError(
			expect.objectContaining({ destination: "localhost:443" }),
		);
		expect(() => net.createConnection(11434, "localhost")).toThrowError(
			expect.objectContaining({ destination: "localhost:11434" }),
		);
		expect(consumeBlockedConnections()).toEqual([
			"localhost:443",
			"localhost:11434",
			"localhost:11434",
			"/tmp/agent.sock",
			"localhost:443",
			"localhost:11434",
		]);
	});

	it("blocks callback and promise DNS lookup with the hostname in the error", async () => {
		expect(() => dns.lookup("localhost", () => undefined)).toThrowError(
			expect.objectContaining({
				name: "NetworkBlockedError",
				destination: "localhost",
			}),
		);
		await expect(dnsPromises.lookup("localhost")).rejects.toBeInstanceOf(NetworkBlockedError);
		await expect(dnsPromises.lookup("localhost")).rejects.toMatchObject({
			destination: "localhost",
		});
		expect(consumeBlockedConnections()).toEqual(["localhost", "localhost", "localhost"]);
	});

	it("blocks every exported dns.resolve* function", () => {
		restoreHermeticNetworkGuards();
		expect(resolveMethodNames).toEqual(expect.arrayContaining(["resolve4", "resolve6"]));
		const mutableDns = dns as unknown as Record<string, (...args: unknown[]) => unknown>;
		for (const methodName of resolveMethodNames) {
			vi.spyOn(mutableDns, methodName).mockImplementation(() => undefined);
		}
		installHermeticNetworkGuards();

		for (const methodName of resolveMethodNames) {
			expect(() => mutableDns[methodName]?.("localhost", () => undefined), methodName).toThrowError(
				expect.objectContaining({
					name: "NetworkBlockedError",
					destination: "localhost",
				}),
			);
		}
		expect(consumeBlockedConnections()).toEqual(resolveMethodNames.map(() => "localhost"));
	});

	it("blocks every exported dns.promises.resolve* function", async () => {
		restoreHermeticNetworkGuards();
		expect(promiseResolveMethodNames).toEqual(expect.arrayContaining(["resolve4", "resolve6"]));
		const mutableDnsPromises = dnsPromises as unknown as Record<
			string,
			(...args: unknown[]) => unknown
		>;
		for (const methodName of promiseResolveMethodNames) {
			vi.spyOn(mutableDnsPromises, methodName).mockResolvedValue([]);
		}
		installHermeticNetworkGuards();

		for (const methodName of promiseResolveMethodNames) {
			await expect(mutableDnsPromises[methodName]?.("localhost"), methodName).rejects.toMatchObject(
				{
					name: "NetworkBlockedError",
					destination: "localhost",
				},
			);
		}
		expect(consumeBlockedConnections()).toEqual(promiseResolveMethodNames.map(() => "localhost"));
	});

	it("blocks live ESM named exports after installation", async () => {
		restoreHermeticNetworkGuards();
		vi.spyOn(dns, "lookup").mockImplementation(() => undefined);
		vi.spyOn(dns, "resolve4").mockImplementation(() => undefined);
		vi.spyOn(dnsPromises, "lookup").mockResolvedValue({ address: "127.0.0.1", family: 4 });
		vi.spyOn(dnsPromises, "resolve4").mockResolvedValue(["127.0.0.1"]);
		syncBuiltinESMExports();
		installHermeticNetworkGuards();

		expect(() => namedDnsLookup("localhost", () => undefined)).toThrowError(NetworkBlockedError);
		expect(() => namedDnsResolve4("localhost", () => undefined)).toThrowError(NetworkBlockedError);
		await expect(namedPromiseDnsLookup("localhost")).rejects.toBeInstanceOf(NetworkBlockedError);
		await expect(namedPromiseDnsResolve4("localhost")).rejects.toBeInstanceOf(NetworkBlockedError);
		expect(consumeBlockedConnections()).toEqual([
			"localhost",
			"localhost",
			"localhost",
			"localhost",
		]);
	});

	it("blocks callback and promise Resolver instances", async () => {
		restoreHermeticNetworkGuards();
		vi.spyOn(dns.Resolver.prototype, "resolve4").mockImplementation(() => undefined);
		vi.spyOn(dnsPromises.Resolver.prototype, "resolve4").mockResolvedValue(["127.0.0.1"]);
		installHermeticNetworkGuards();

		expect(() =>
			loopbackResolver(new dns.Resolver()).resolve4("localhost", () => undefined),
		).toThrowError(expect.objectContaining({ destination: "localhost" }));
		await expect(
			loopbackResolver(new dnsPromises.Resolver()).resolve4("localhost"),
		).rejects.toMatchObject({
			destination: "localhost",
		});
		expect(consumeBlockedConnections()).toEqual(["localhost", "localhost"]);
	});

	it("allows only the configured Ollama origin in local mode", async () => {
		restoreHermeticNetworkGuards();
		vi.stubEnv("AI_TEST_RUN_MODE", "local");
		vi.stubEnv("OLLAMA_BASE_URL", "http://127.0.0.1:11434/api");

		const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("ok"));
		vi.stubGlobal("fetch", fetchMock);
		installHermeticNetworkGuards();

		await expect(fetch("http://127.0.0.1:11434/api/tags")).resolves.toBeInstanceOf(Response);
		expect(fetchMock).toHaveBeenCalledOnce();
		await expect(fetch("http://127.0.0.1:11435/api/tags")).rejects.toMatchObject({
			destination: "http://127.0.0.1:11435/api/tags",
		});
		await expect(fetch("http://localhost:11434/api/tags")).rejects.toMatchObject({
			destination: "http://localhost:11434/api/tags",
		});
		expect(consumeBlockedConnections()).toEqual([
			"http://127.0.0.1:11435/api/tags",
			"http://localhost:11434/api/tags",
		]);
	});

	it("delegates matching socket and DNS destinations only in local mode", async () => {
		restoreHermeticNetworkGuards();
		vi.stubEnv("AI_TEST_RUN_MODE", "local");
		vi.stubEnv("OLLAMA_BASE_URL", "http://127.0.0.1:11434");

		const connectMock = vi
			.spyOn(net.Socket.prototype, "connect")
			.mockImplementation(function connect(this: net.Socket) {
				return this;
			});
		const lookupMock = vi
			.spyOn(dns, "lookup")
			.mockImplementation((_hostname: string, _options: unknown, callback?: unknown) => {
				const resolvedCallback = typeof _options === "function" ? _options : callback;
				if (typeof resolvedCallback === "function") {
					resolvedCallback(null, "127.0.0.1", 4);
				}
			});
		const promiseLookupMock = vi
			.spyOn(dnsPromises, "lookup")
			.mockResolvedValue({ address: "127.0.0.1", family: 4 });
		installHermeticNetworkGuards();

		const socket = new net.Socket();
		expect(socket.connect(11434, "127.0.0.1")).toBe(socket);
		expect(net.connect({ host: "127.0.0.1", port: 11434 })).toBeInstanceOf(net.Socket);
		expect(net.createConnection(11434, "127.0.0.1")).toBeInstanceOf(net.Socket);
		expect(connectMock).toHaveBeenCalledTimes(3);
		expect(() => socket.connect(80, "127.0.0.1")).toThrowError(/127\.0\.0\.1:80/u);

		await new Promise<void>((resolve, reject) => {
			dns.lookup("127.0.0.1", (error) => {
				if (error) reject(error);
				else resolve();
			});
		});
		await expect(dnsPromises.lookup("127.0.0.1")).resolves.toMatchObject({
			address: "127.0.0.1",
		});
		expect(lookupMock).toHaveBeenCalledOnce();
		expect(promiseLookupMock).toHaveBeenCalledOnce();
		expect(() => dns.lookup("localhost", () => undefined)).toThrowError(/localhost/u);
		expect(consumeBlockedConnections()).toEqual(["127.0.0.1:80", "localhost"]);
	});

	it("allows the default Ollama origin in local mode when OLLAMA_BASE_URL is unset", async () => {
		restoreHermeticNetworkGuards();
		vi.stubEnv("AI_TEST_RUN_MODE", "local");
		vi.stubEnv("OLLAMA_BASE_URL", undefined);
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("ok"));
		vi.stubGlobal("fetch", fetchMock);
		const connectMock = vi
			.spyOn(net.Socket.prototype, "connect")
			.mockImplementation(function connect(this: net.Socket) {
				return this;
			});
		installHermeticNetworkGuards();

		await expect(fetch("http://127.0.0.1:11434/api/tags")).resolves.toBeInstanceOf(Response);
		expect(fetchMock).toHaveBeenCalledOnce();
		expect(net.connect({ host: "127.0.0.1", port: 11434 })).toBeInstanceOf(net.Socket);
		expect(connectMock).toHaveBeenCalledOnce();
		await expect(fetch("http://localhost:11434/api/tags")).rejects.toBeInstanceOf(
			NetworkBlockedError,
		);
		expect(() => net.connect({ host: "127.0.0.1", port: 11435 })).toThrowError(NetworkBlockedError);
		expect(consumeBlockedConnections()).toEqual([
			"http://localhost:11434/api/tags",
			"127.0.0.1:11435",
		]);
	});

	it("keeps the default Ollama origin blocked outside local mode", async () => {
		vi.stubEnv("OLLAMA_BASE_URL", undefined);
		await expect(fetch("http://127.0.0.1:11434/api/tags")).rejects.toBeInstanceOf(
			NetworkBlockedError,
		);
		expect(consumeBlockedConnections()).toEqual(["http://127.0.0.1:11434/api/tags"]);
	});

	it.each(["http://127.0.0.1:11434/", "http://127.0.0.1:11434/api/"])(
		"allows the Ollama origin for OLLAMA_BASE_URL=%s",
		async (baseUrl) => {
			restoreHermeticNetworkGuards();
			vi.stubEnv("AI_TEST_RUN_MODE", "local");
			vi.stubEnv("OLLAMA_BASE_URL", baseUrl);
			vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response("ok")));
			installHermeticNetworkGuards();

			await expect(fetch("http://127.0.0.1:11434/api/tags")).resolves.toBeInstanceOf(Response);
			expect(consumeBlockedConnections()).toEqual([]);
		},
	);

	it("records blocked destinations even when the caller swallows the error", async () => {
		try {
			await fetch("https://localhost/");
		} catch {
			// Code under test that maps network failures to a result must still fail the test.
		}
		expect(() => new net.Socket().connect(443, "localhost")).toThrowError();

		expect(() => assertNoUnconsumedBlockedConnections()).toThrowError(
			"Unmocked network access was blocked during this test (2): https://localhost/, localhost:443. Mock the connection, or call consumeBlockedConnections() when blocking is the expected outcome.",
		);
		expect(() => assertNoUnconsumedBlockedConnections()).not.toThrow();
		expect(consumeBlockedConnections()).toEqual([]);
	});

	it("consumeBlockedConnections returns the recorded destinations once", async () => {
		await expect(fetch("https://localhost/")).rejects.toBeInstanceOf(NetworkBlockedError);

		expect(consumeBlockedConnections()).toEqual(["https://localhost/"]);
		expect(consumeBlockedConnections()).toEqual([]);
		expect(() => assertNoUnconsumedBlockedConnections()).not.toThrow();
	});

	it.each([
		["5432 by default", undefined, 5432],
		["POSTGRES_PORT when set", "55432", 55432],
	])("allows only the local Postgres port (%s) in the pg suite", async (_label, portEnv, port) => {
		restoreHermeticNetworkGuards();
		vi.stubEnv("AI_TEST_SUITE", "pg");
		vi.stubEnv("POSTGRES_PORT", portEnv);
		const connectMock = vi
			.spyOn(net.Socket.prototype, "connect")
			.mockImplementation(function connect(this: net.Socket) {
				return this;
			});
		const lookupMock = vi.spyOn(dns, "lookup").mockImplementation(() => undefined);
		installHermeticNetworkGuards();

		expect(net.connect({ host: "127.0.0.1", port })).toBeInstanceOf(net.Socket);
		expect(net.connect({ host: "localhost", port })).toBeInstanceOf(net.Socket);
		expect(net.connect(port, "LOCALHOST")).toBeInstanceOf(net.Socket);
		expect(connectMock).toHaveBeenCalledTimes(3);
		dns.lookup("localhost", () => undefined);
		expect(lookupMock).toHaveBeenCalledOnce();

		expect(() => net.connect({ host: "127.0.0.1", port: port + 1 })).toThrowError(
			NetworkBlockedError,
		);
		expect(() => net.connect({ host: "127.0.0.2", port })).toThrowError(NetworkBlockedError);
		expect(() => net.connect({ host: "10.0.0.5", port })).toThrowError(NetworkBlockedError);
		expect(() => dns.lookup("127.0.0.2", () => undefined)).toThrowError(NetworkBlockedError);
		await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toBeInstanceOf(NetworkBlockedError);
		expect(consumeBlockedConnections()).toEqual([
			`127.0.0.1:${port + 1}`,
			`127.0.0.2:${port}`,
			`10.0.0.5:${port}`,
			"127.0.0.2",
			`http://127.0.0.1:${port}/`,
		]);
	});

	it("keeps the local Postgres port blocked outside the pg suite", () => {
		vi.stubEnv("AI_TEST_SUITE", "gate");
		restoreHermeticNetworkGuards();
		installHermeticNetworkGuards();

		expect(() => net.connect({ host: "127.0.0.1", port: 5432 })).toThrowError(NetworkBlockedError);
		expect(consumeBlockedConnections()).toEqual(["127.0.0.1:5432"]);
	});

	it("blocks dgram sends and connects with the destination in the error", () => {
		const socket = dgram.createSocket("udp4");
		try {
			expect(() => socket.send(Buffer.from("ping"), 53, "127.0.0.1")).toThrowError(
				expect.objectContaining({ name: "NetworkBlockedError", destination: "127.0.0.1:53" }),
			);
			expect(() => socket.send(Buffer.from("ping"), 0, 4, 5353, "224.0.0.251")).toThrowError(
				expect.objectContaining({ destination: "224.0.0.251:5353" }),
			);
			expect(() => socket.send("ping", 9999)).toThrowError(
				expect.objectContaining({ destination: "localhost:9999" }),
			);
			expect(() => socket.connect(53, "127.0.0.2")).toThrowError(
				expect.objectContaining({ destination: "127.0.0.2:53" }),
			);
		} finally {
			socket.close();
		}
		expect(consumeBlockedConnections()).toEqual([
			"127.0.0.1:53",
			"224.0.0.251:5353",
			"localhost:9999",
			"127.0.0.2:53",
		]);
	});

	it("blocks callback and promise dns.lookupService", async () => {
		expect(() => dns.lookupService("127.0.0.1", 53, () => undefined)).toThrowError(
			expect.objectContaining({ name: "NetworkBlockedError", destination: "127.0.0.1:53" }),
		);
		await expect(dnsPromises.lookupService("127.0.0.2", 443)).rejects.toMatchObject({
			name: "NetworkBlockedError",
			destination: "127.0.0.2:443",
		});
		expect(consumeBlockedConnections()).toEqual(["127.0.0.1:53", "127.0.0.2:443"]);
	});
});
