import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { BlockList, isIP, isIPv6 } from "node:net";

/**
 * Hostname/IP-level SSRF blocklist: private (RFC1918), loopback, link-local (incl. cloud
 * metadata 169.254.169.254), and unspecified addresses, for both IPv4 and IPv6 (including
 * IPv4-mapped IPv6). Shared by any outbound server-side fetch whose destination is
 * operator-controlled — OIDC/Cloudflare Access discovery (@admitto/auth) and mail transport
 * config (@admitto/mailer).
 */

const privateIpv6 = new BlockList();
privateIpv6.addSubnet("fe80::", 10, "ipv6");
privateIpv6.addSubnet("fc00::", 7, "ipv6");

/** Strip bracket wrapping from IPv6 literals in URL.hostname. */
export function unbracketHostname(hostname: string): string {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname.slice(1, -1);
  }
  return hostname;
}

/** Whether the hostname is loopback (localhost / 127.0.0.1 / ::1). */
export function isLoopbackHost(hostname: string): boolean {
  const host = unbracketHostname(hostname).toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
  const mapped = extractIpv4FromMappedIpv6(host);
  return mapped === "127.0.0.1";
}

function parseIpv4(host: string): [number, number, number, number] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return nums as [number, number, number, number];
}

/** IPv4-mapped IPv6 (::ffff:127.0.0.1 or ::ffff:7f00:1) — normalize to dotted IPv4 for SSRF checks. */
function extractIpv4FromMappedIpv6(host: string): string | null {
  const lower = host.toLowerCase();
  if (!isIPv6(lower)) return null;

  const dotted = /(?:^|:)ffff:((?:\d{1,3}\.){3}\d{1,3})$/.exec(lower);
  if (dotted) return dotted[1] ?? null;

  const hex = /(?:^|:)ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (!hex) return null;
  const hi = Number.parseInt(hex[1]!, 16);
  const lo = Number.parseInt(hex[2]!, 16);
  if (!Number.isFinite(hi) || !Number.isFinite(lo)) return null;
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

function isBlockedPrivateIpv4Dotted(host: string): boolean {
  const ip = parseIpv4(host);
  if (!ip) return false;
  const [a, b, c, d] = ip;
  if (a === 0 && b === 0 && c === 0 && d === 0) return true;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 127) return true;
  return false;
}

function isBlockedPrivateIpv6(hostname: string): boolean {
  const host = unbracketHostname(hostname);
  if (!isIPv6(host)) return false;
  const lower = host.toLowerCase();
  if (lower === "::" || lower === "::1") return true;
  return privateIpv6.check(host, "ipv6");
}

/** Whether the hostname is a private/loopback/link-local/metadata address (any family). */
export function isBlockedPrivateOrMetadataHost(hostname: string): boolean {
  const host = unbracketHostname(hostname).toLowerCase();
  if (host === "metadata.google.internal") return true;
  if (isBlockedPrivateIpv6(hostname)) return true;

  const mappedIpv4 = extractIpv4FromMappedIpv6(host);
  if (mappedIpv4 && isBlockedPrivateIpv4Dotted(mappedIpv4)) return true;

  return isBlockedPrivateIpv4Dotted(host);
}

function assertResolvedIpSafe(address: string): void {
  const host = unbracketHostname(address).toLowerCase();
  if (isLoopbackHost(host) || isBlockedPrivateOrMetadataHost(host)) {
    throw new Error("hostname must not resolve to a private or link-local address");
  }
}

/**
 * Resolve hostname and reject private/link-local/unspecified targets (used before a pinned
 * outbound fetch/connect) — this is the DNS-resolution-time recheck that catches a hostname
 * that looks public but resolves to an internal address.
 */
export async function resolveSafeHostname(hostname: string): Promise<LookupAddress[]> {
  const host = unbracketHostname(hostname);
  if (isIP(host)) {
    assertResolvedIpSafe(host);
    return [{ address: host, family: isIP(host) === 6 ? 6 : 4 }];
  }

  let records: LookupAddress[];
  try {
    records = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error("hostname could not be resolved");
  }

  if (records.length === 0) {
    throw new Error("hostname could not be resolved");
  }

  for (const record of records) {
    assertResolvedIpSafe(record.address);
  }
  return records;
}
