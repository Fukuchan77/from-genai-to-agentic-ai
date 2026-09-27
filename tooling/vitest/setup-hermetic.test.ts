import dns, { lookup as namedDnsLookup, resolve4 as namedDnsResolve4 } from "node:dns";
import dnsPromises, {
	lookup as namedPromiseDnsLookup,
	resolve4 as namedPromiseDnsResolve4,
} from "node:dns/promises";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	installHermeticNetworkGuards,
	NetworkBlockedError,
	restoreHermeticNetworkGuards,
} from "./setup-hermetic";

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
		await expect(fetch("https://example.com/api?q=1")).rejects.toMatchObject({
			name: "NetworkBlockedError",
			code: "NETWORK_BLOCKED",
			destination: "https://example.com/api?q=1",
		});
	});

	it("blocks every Socket.connect form before a connection starts", () => {
		expect(() => new net.Socket().connect({ host: "example.com", port: 443 })).toThrowError(
			expect.objectContaining({
				name: "NetworkBlockedError",
				destination: "example.com:443",
			}),
		);
		expect(() => new net.Socket().connect(11434, "example.com")).toThrowError(
			/example\.com:11434/u,
		);
		expect(() => new net.Socket().connect(11434)).toThrowError(/localhost:11434/u);
		expect(() => new net.Socket().connect("/tmp/agent.sock")).toThrowError(/\/tmp\/agent\.sock/u);
		expect(() => net.connect({ host: "example.com", port: 443 })).toThrowError(
			expect.objectContaining({ destination: "example.com:443" }),
		);
		expect(() => net.createConnection(11434, "example.com")).toThrowError(
			expect.objectContaining({ destination: "example.com:11434" }),
		);
	});

	it("blocks callback and promise DNS lookup with the hostname in the error", async () => {
		expect(() => dns.lookup("example.com", () => undefined)).toThrowError(
			expect.objectContaining({
				name: "NetworkBlockedError",
				destination: "example.com",
			}),
		);
		await expect(dnsPromises.lookup("example.com")).rejects.toBeInstanceOf(NetworkBlockedError);
		await expect(dnsPromises.lookup("example.com")).rejects.toMatchObject({
			destination: "example.com",
		});
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
			expect(
				() => mutableDns[methodName]?.("records.example.com", () => undefined),
				methodName,
			).toThrowError(
				expect.objectContaining({
					name: "NetworkBlockedError",
					destination: "records.example.com",
				}),
			);
		}
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
			await expect(
				mutableDnsPromises[methodName]?.("records.example.com"),
				methodName,
			).rejects.toMatchObject({
				name: "NetworkBlockedError",
				destination: "records.example.com",
			});
		}
	});

	it("blocks live ESM named exports after installation", async () => {
		restoreHermeticNetworkGuards();
		vi.spyOn(dns, "lookup").mockImplementation(() => undefined);
		vi.spyOn(dns, "resolve4").mockImplementation(() => undefined);
		vi.spyOn(dnsPromises, "lookup").mockResolvedValue({ address: "127.0.0.1", family: 4 });
		vi.spyOn(dnsPromises, "resolve4").mockResolvedValue(["127.0.0.1"]);
		syncBuiltinESMExports();
		installHermeticNetworkGuards();

		expect(() => namedDnsLookup("example.com", () => undefined)).toThrowError(NetworkBlockedError);
		expect(() => namedDnsResolve4("example.com", () => undefined)).toThrowError(
			NetworkBlockedError,
		);
		await expect(namedPromiseDnsLookup("example.com")).rejects.toBeInstanceOf(NetworkBlockedError);
		await expect(namedPromiseDnsResolve4("example.com")).rejects.toBeInstanceOf(
			NetworkBlockedError,
		);
	});

	it("blocks callback and promise Resolver instances", async () => {
		restoreHermeticNetworkGuards();
		vi.spyOn(dns.Resolver.prototype, "resolve4").mockImplementation(() => undefined);
		vi.spyOn(dnsPromises.Resolver.prototype, "resolve4").mockResolvedValue(["127.0.0.1"]);
		installHermeticNetworkGuards();

		expect(() => new dns.Resolver().resolve4("example.com", () => undefined)).toThrowError(
			expect.objectContaining({ destination: "example.com" }),
		);
		await expect(new dnsPromises.Resolver().resolve4("example.com")).rejects.toMatchObject({
			destination: "example.com",
		});
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
		expect(() => dns.lookup("example.com", () => undefined)).toThrowError(/example\.com/u);
	});
});
