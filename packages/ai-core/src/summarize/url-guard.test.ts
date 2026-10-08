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
		expect(isBlockedHostname("[64:ff9b:0:1::7f00:1]")).toBe(false);
		expect(isBlockedHostname("[64:ff9b:2::7f00:1]")).toBe(false);
		expect(isBlockedHostname("[65:ff9b::7f00:1]")).toBe(false);
	});

	// W3 review r2 N7: LAN names and the IPv6 forms that embed (or tunnel to) an IPv4 address.
	it.each([
		"http://router.lan/",
		"http://ROUTER.LAN./",
		"http://lan/",
		"http://myhost.home.arpa/",
		"http://home.arpa/",
		// SIIT ::ffff:0:0/96 (RFC 6145) with a blocked IPv4 address
		"http://[::ffff:0:7f00:1]/",
		"http://[::ffff:0:a9fe:a9fe]/",
		// 6to4 2002::/16 (RFC 3056) whose embedded IPv4 address is blocked
		"http://[2002:7f00:1::]/",
		"http://[2002:a00:1::1]/",
		"http://[2002:c0a8:101:1::1]/",
		// local-use NAT64 64:ff9b:1::/48 (RFC 8215): never a public destination
		"http://[64:ff9b:1::7f00:1]/",
		"http://[64:ff9b:1::808:808]/",
		"http://[64:ff9b:1:ffff:ffff:ffff:ffff:ffff]/",
		// Teredo 2001::/32 (RFC 4380): the client IPv4 address is obfuscated, so all of it
		"http://[2001::1]/",
		"http://[2001:0:4136:e378:8000:63bf:3fff:fdd2]/",
		"http://[2001:0:ffff:ffff:ffff:ffff:ffff:ffff]/",
	])("rejects the LAN name or IPv4-embedding IPv6 address %s", (url) => {
		expect(fetchableUrl(url)).toBeUndefined();
	});

	it.each([
		"https://plan.example.com/",
		"https://my.atlan/",
		"https://home.arpa.example.com/",
		"https://[::ffff:0:808:808]/",
		"https://[::ffff:1:7f00:1]/",
		"https://[::fffe:0:7f00:1]/",
		"https://[2002:808:808::1]/",
		"https://[2003:7f00:1::]/",
		"https://[2001:1::1]/",
		"https://[2001:4860:4860::8888]/",
	])("accepts the public name or address %s next to the N7 ranges", (url) => {
		expect(fetchableUrl(url)?.href).toBe(new URL(url).href);
	});

	it("treats an unparsable IPv6 literal as blocked", () => {
		expect(isBlockedHostname("[1::2::3]")).toBe(true);
		expect(isBlockedHostname("[1:2:3]")).toBe(true);
		expect(isBlockedHostname("[1:2:3:4:5:6:7:8:9]")).toBe(true);
		expect(isBlockedHostname("[::fffff]")).toBe(true);
	});
});
