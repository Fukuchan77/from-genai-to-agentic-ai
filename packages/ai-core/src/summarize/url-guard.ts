/**
 * Literal checks on an article URL before it is fetched (W3 review M6, SSRF). The WHATWG URL parser
 * already canonicalizes host spellings (`2130706433`, `0x7f.1`, `0177.0.0.1`, full-width digits and
 * percent-encoding all become `127.0.0.1`; IPv6 is compressed and an embedded IPv4 becomes hex), so
 * the checks run on `URL.hostname`.
 *
 * Limit: names are not resolved (the HttpFetcher port has no DNS step), so a public name whose DNS
 * record points to a private address (including DNS rebinding) is not caught here. The server-side
 * HttpFetcher (W4 task 20.1) applies the same address rules to the resolved address at connect time.
 */

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/** Names that always mean this machine, the LAN or a cloud metadata service. */
const BLOCKED_NAMES = new Set(["localhost", "metadata.google.internal"]);
/**
 * Special-use domains, blocked themselves and with any subdomain: loopback (RFC 6761), mDNS
 * (RFC 6762), private use (ICANN, 2024), home networks (RFC 8375) and the customary `lan` that home
 * routers serve (W3 review r2 N7).
 */
const BLOCKED_DOMAINS = ["localhost", "local", "internal", "home.arpa", "lan"];

/** IPv4 ranges that are not public unicast: [network, prefix length]. */
const BLOCKED_IPV4_RANGES: readonly (readonly [string, number])[] = [
	["0.0.0.0", 8], // "this network"
	["10.0.0.0", 8], // private
	["100.64.0.0", 10], // carrier-grade NAT
	["127.0.0.0", 8], // loopback
	["169.254.0.0", 16], // link-local, including the 169.254.169.254 metadata address
	["172.16.0.0", 12], // private
	["192.0.0.0", 24], // IETF protocol assignments
	["192.168.0.0", 16], // private
	["198.18.0.0", 15], // benchmarking
	["224.0.0.0", 4], // multicast
	["240.0.0.0", 4], // reserved, including broadcast
];

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u;

function ipv4ToNumber(address: string): number | undefined {
	const match = IPV4.exec(address);
	if (!match) return undefined;
	const octets = match.slice(1).map(Number);
	if (octets.some((octet) => octet > 255)) return undefined;
	return octets.reduce((value, octet) => value * 256 + octet, 0);
}

function inIpv4Range(address: number, network: string, prefix: number): boolean {
	const base = ipv4ToNumber(network) ?? 0;
	const size = 2 ** (32 - prefix);
	return address >= base && address < base + size;
}

/** True for an IPv4 address (as a 32-bit number) outside public unicast space. */
function isBlockedIpv4(address: number): boolean {
	return BLOCKED_IPV4_RANGES.some(([network, prefix]) => inIpv4Range(address, network, prefix));
}

/** Expands a canonical (WHATWG-serialized) IPv6 address into its eight 16-bit groups. */
function ipv6Groups(address: string): number[] | undefined {
	const halves = address.split("::");
	if (halves.length > 2) return undefined;
	const parse = (part: string | undefined) =>
		part ? part.split(":").map((group) => Number.parseInt(group, 16)) : [];
	const head = parse(halves[0]);
	const tail = parse(halves[1]);
	const missing = 8 - head.length - tail.length;
	if (halves.length === 1 ? missing !== 0 : missing < 0) return undefined;
	const groups = [...head, ...Array.from({ length: missing }, () => 0), ...tail];
	return groups.every((group) => Number.isInteger(group) && group >= 0 && group <= 0xffff)
		? groups
		: undefined;
}

function embeddedIpv4(groups: readonly number[]): number {
	return (groups[6] ?? 0) * 0x10000 + (groups[7] ?? 0);
}

/** True for an IPv6 address outside global unicast space, or embedding a blocked IPv4 address. */
function isBlockedIpv6(groups: readonly number[]): boolean {
	const [first = 0] = groups;
	const upperSixZero = groups.slice(0, 6).every((group) => group === 0);
	// ::, ::1 and the deprecated IPv4-compatible ::a.b.c.d form.
	if (upperSixZero) return true;
	// IPv4-mapped ::ffff:a.b.c.d, SIIT ::ffff:0:a.b.c.d (RFC 6145) and NAT64 64:ff9b::a.b.c.d reach
	// the embedded IPv4 address.
	const mapped = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
	const siit =
		groups.slice(0, 4).every((group) => group === 0) && groups[4] === 0xffff && groups[5] === 0;
	const nat64 = first === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every((g) => g === 0);
	if (mapped || siit || nat64) return isBlockedIpv4(embeddedIpv4(groups));
	// 6to4 2002:a.b.c.d::/48 (RFC 3056) tunnels to the IPv4 address in its second and third groups.
	if (first === 0x2002) return isBlockedIpv4((groups[1] ?? 0) * 0x10000 + (groups[2] ?? 0));
	// Local-use NAT64 64:ff9b:1::/48 (RFC 8215) is never a public destination, and its embedded
	// address sits where the operator's prefix length puts it; Teredo 2001::/32 (RFC 4380) carries
	// an obfuscated client address. Both are refused whole (W3 review r2 N7).
	if (first === 0x64 && groups[1] === 0xff9b && groups[2] === 1) return true;
	if (first === 0x2001 && groups[1] === 0) return true;
	return (
		(first & 0xfe00) === 0xfc00 || // unique local fc00::/7 (incl. fd00:ec2::254 metadata)
		(first & 0xffc0) === 0xfe80 || // link-local fe80::/10
		(first & 0xffc0) === 0xfec0 || // site-local fec0::/10 (deprecated)
		(first & 0xff00) === 0xff00 // multicast ff00::/8
	);
}

/** True when the hostname names this machine, the LAN, a metadata service or a non-public IP. */
export function isBlockedHostname(hostname: string): boolean {
	const host = hostname.toLowerCase().replace(/\.+$/u, "");
	if (host.startsWith("[") && host.endsWith("]")) {
		const groups = ipv6Groups(host.slice(1, -1));
		return groups === undefined || isBlockedIpv6(groups);
	}
	const ipv4 = ipv4ToNumber(host);
	if (ipv4 !== undefined) return isBlockedIpv4(ipv4);
	if (BLOCKED_NAMES.has(host)) return true;
	if (BLOCKED_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
		return true;
	}
	// A single-label name is resolved through the local search domains, i.e. on the LAN.
	return !host.includes(".");
}

/** Returns the parsed URL when it is an http(s) URL to a public host, otherwise `undefined`. */
export function fetchableUrl(url: string | URL): URL | undefined {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return undefined;
	}
	if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) return undefined;
	return isBlockedHostname(parsed.hostname) ? undefined : parsed;
}
