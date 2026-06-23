import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { BlockList, isIP, isIPv6 } from "node:net";

/** Block server-side fetches to private/link-local targets (SSRF mitigation). */

const privateIpv6 = new BlockList();
privateIpv6.addSubnet("fe80::", 10, "ipv6");
privateIpv6.addSubnet("fc00::", 7, "ipv6");

/** URL.hostname keeps brackets around IPv6 literals — strip before parsing. */
export function unbracketHostname(hostname: string): string {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname.slice(1, -1);
  }
  return hostname;
}

export function isLoopbackHostForTests(hostname: string): boolean {
  return isLoopbackHost(hostname);
}

function isLoopbackHost(hostname: string): boolean {
  const host = unbracketHostname(hostname).toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
  const mapped = extractIpv4FromMappedIpv6(host);
  return mapped === "127.0.0.1";
}

function parseIpv4(host: string): [number, number, number, number] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((part) => Number(part));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return nums as [number, number, number, number];
}

/** IPv4-mapped IPv6 (::ffff:127.0.0.1 or ::ffff:7f00:1) — normalize to dotted IPv4 for SSRF checks. */
function extractIpv4FromMappedIpv6(host: string): string | null {
  const lower = host.toLowerCase();
  if (!isIPv6(lower)) return null;

  const dotted = lower.match(/(?:^|:)ffff:((?:\d{1,3}\.){3}\d{1,3})$/);
  if (dotted) return dotted[1] ?? null;

  const hex = lower.match(/(?:^|:)ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) return null;
  const hi = parseInt(hex[1]!, 16);
  const lo = parseInt(hex[2]!, 16);
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

function isBlockedPrivateOrMetadataHost(hostname: string): boolean {
  const host = unbracketHostname(hostname).toLowerCase();
  if (host === "metadata.google.internal") return true;
  if (isBlockedPrivateIpv6(hostname)) return true;

  const mappedIpv4 = extractIpv4FromMappedIpv6(host);
  if (mappedIpv4 && isBlockedPrivateIpv4Dotted(mappedIpv4)) return true;

  return isBlockedPrivateIpv4Dotted(host);
}

/**
 * Require HTTPS for outbound OIDC fetches. In non-production, allow http://127.0.0.1 and
 * http://localhost for local mock IdPs and integration tests.
 */
export function assertSafeOidcFetchUrl(urlString: string): void {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new Error("Invalid OIDC URL");
  }

  const loopback = isLoopbackHost(url.hostname);
  const allowHttpLoopback = process.env["NODE_ENV"] !== "production";

  if (url.protocol !== "https:" && !(allowHttpLoopback && loopback && url.protocol === "http:")) {
    throw new Error("OIDC URL must use HTTPS");
  }

  // Dev-only: http://127.0.0.1 mock IdPs. HTTPS loopback still blocked in production.
  if (loopback && allowHttpLoopback && url.protocol === "http:") return;

  if (loopback || isBlockedPrivateOrMetadataHost(url.hostname)) {
    throw new Error("OIDC URL must not target private or link-local addresses");
  }
}

function assertResolvedIpSafe(address: string): void {
  const host = unbracketHostname(address).toLowerCase();
  if (isLoopbackHost(host) || isBlockedPrivateOrMetadataHost(host)) {
    throw new Error("OIDC URL must not target private or link-local addresses");
  }
}

/** Resolve hostname and reject private/link-local targets (used before pinned outbound fetch). */
export async function resolveSafeOidcHostname(hostname: string): Promise<LookupAddress[]> {
  const host = unbracketHostname(hostname);
  if (isIP(host)) {
    assertResolvedIpSafe(host);
    return [{ address: host, family: isIP(host) === 6 ? 6 : 4 }];
  }

  let records: LookupAddress[];
  try {
    records = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error("OIDC URL hostname could not be resolved");
  }

  if (records.length === 0) {
    throw new Error("OIDC URL hostname could not be resolved");
  }

  for (const record of records) {
    assertResolvedIpSafe(record.address);
  }
  return records;
}

/**
 * SSRF guard before outbound fetch: synchronous URL checks plus DNS resolution
 * so hostnames cannot pass validation then rebind to metadata/private targets.
 */
export async function assertSafeOidcFetchUrlResolved(urlString: string): Promise<void> {
  assertSafeOidcFetchUrl(urlString);

  const hostname = unbracketHostname(new URL(urlString).hostname);
  const allowHttpLoopback = process.env["NODE_ENV"] !== "production";
  if (allowHttpLoopback && isLoopbackHost(hostname)) return;

  await resolveSafeOidcHostname(hostname);
}
