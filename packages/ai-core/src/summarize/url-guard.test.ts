import { describe, expect, it } from "vitest";
import { fetchableUrl, isBlockedHostname } from "./url-guard";

describe("fetchableUrl", () => {
	it.each([
		"https://example.test/articles/agentic-ai",
		"http://example.com:8080/path?q=1",
		"https://8.8.8.8/",
		"https://[2606:4700::1111]/",
		"https://[::ffff:8.8.8.8]/",
		"https://172.32.0.1/",
		"https://100.128.0.1/",
		"https://sub.localhost.example.com/",
	])("accepts the public URL %s", (url) => {
		expect(fetchableUrl(url)?.href).toBe(new URL(url).href);
	});

	it.each([
		["file:///etc/passwd"],
		["ftp://example.com/file"],
		["data:text/plain,hello"],
		["javascript:alert(1)"],
		["gopher://example.com/"],
		["not a url"],
	])("rejects the non-http(s) or malformed URL %s", (url) => {
		expect(fetchableUrl(url)).toBeUndefined();
	});

	it.each([
		// loopback, in every spelling the URL parser canonicalizes to 127.0.0.1
		"http://127.0.0.1:11434/api/tags",
		"http://127.1/",
		"http://2130706433/",
		"http://0x7f.0.0.1/",
		"http://0177.0.0.1/",
		"http://%31%32%37.0.0.1/",
		"http://127.255.255.254/",
		// names
		"http://localhost:3000/",
		"http://LOCALHOST./",
		"http://app.localhost/",
		"http://printer.local/",
		"http://db.internal/",
		"http://metadata.google.internal/computeMetadata/v1/",
		"http://intranet/",
		// private, link-local, metadata and other non-public IPv4
		"http://0.0.0.0/",
		"http://0/",
		"http://10.1.2.3/",
		"http://100.64.0.1/",
		"http://169.254.169.254/latest/meta-data/",
		"http://172.16.0.1/",
		"http://172.31.255.255/",
		"http://192.0.0.8/",
		"http://192.168.1.1/",
		"http://198.18.0.1/",
		"http://224.0.0.1/",
		"http://255.255.255.255/",
		// IPv6
		"http://[::1]/",
		"http://[0:0:0:0:0:0:0:1]/",
		"http://[::]/",
		"http://[::127.0.0.1]/",
		"http://[::ffff:127.0.0.1]/",
		"http://[::ffff:169.254.169.254]/",
		"http://[64:ff9b::10.0.0.1]/",
		"http://[fc00::1]/",
		"http://[fd00:ec2::254]/",
		"http://[fe80::1]/",
		"http://[febf::1]/",
		"http://[fec0::1]/",
		"http://[ff02::1]/",
	])("rejects the local, private or metadata address %s", (url) => {
		expect(fetchableUrl(url)).toBeUndefined();
	});

	it("checks the boundaries of the IPv4 ranges", () => {
		expect(isBlockedHostname("9.255.255.255")).toBe(false);
		expect(isBlockedHostname("11.0.0.0")).toBe(false);
		expect(isBlockedHostname("100.63.255.255")).toBe(false);
		expect(isBlockedHostname("100.127.255.255")).toBe(true);
		expect(isBlockedHostname("172.15.255.255")).toBe(false);
		expect(isBlockedHostname("192.0.1.0")).toBe(false);
		expect(isBlockedHostname("198.20.0.0")).toBe(false);
		expect(isBlockedHostname("223.255.255.255")).toBe(false);
	});

	it("checks the boundaries of the IPv6 ranges and the mapped forms", () => {
		expect(isBlockedHostname("[fbff::1]")).toBe(false);
		expect(isBlockedHostname("[fe7f::1]")).toBe(false);
		expect(isBlockedHostname("[ff00::1]")).toBe(true);
		expect(isBlockedHostname("[::1:0:0:1]")).toBe(false);
		expect(isBlockedHostname("[::fffe:7f00:1]")).toBe(false);
		expect(isBlockedHostname("[64:ff9b::808:808]")).toBe(false);
		expect(isBlockedHostname("[64:ff9b:1::7f00:1]")).toBe(false);
		expect(isBlockedHostname("[65:ff9b::7f00:1]")).toBe(false);
	});

	it("treats an unparsable IPv6 literal as blocked", () => {
		expect(isBlockedHostname("[1::2::3]")).toBe(true);
		expect(isBlockedHostname("[1:2:3]")).toBe(true);
		expect(isBlockedHostname("[1:2:3:4:5:6:7:8:9]")).toBe(true);
		expect(isBlockedHostname("[::fffff]")).toBe(true);
	});
});
