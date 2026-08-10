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

/**
 * Strip bracket wrapping from IPv6 literals in URL.hostname, and any IPv6 zone index
 * (e.g. "fe80::1%eth0" -> "fe80::1"). Node's isIP/isIPv6 accept zone indices, but the
 * exact-match and regex checks below don't — left unstripped, a private/loopback/
 * mapped-IPv4 address with an appended zone index slips past every check in this file.
 */
export function unbracketHostname(hostname: string): string {
  const unbracketed =
    hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  return isIPv6(unbracketed) ? unbracketed.split("%")[0]! : unbracketed;
}

/**
 * Normalize a hostname or IP literal for allowlist exact-match.
 * WHATWG URL parsing compresses IPv6 (`fd00:0:0:0:0:0:0:1` -> `fd00::1`), so an allowlist
 * entry pasted from either form still matches `new URL(issuer).hostname`.
 */
export function canonicalizeAllowlistHost(hostname: string): string {
  const host = unbracketHostname(hostname.trim()).toLowerCase();
  if (!host) return "";
  if (!isIP(host)) return host;
  try {
    const url = isIP(host) === 6 ? new URL(`https://[${host}]/`) : new URL(`https://${host}/`);
    return unbracketHostname(url.hostname).toLowerCase();
  } catch {
    return host;
  }
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

function parseIpv6HexGroup(group: string): number {
  return Number.parseInt(group, 16);
}

function parseIpv6GroupList(part: string): number[] {
  if (part === "") return [];
  const rawGroups = part.split(":");
  const dotted = rawGroups.at(-1)!;
  const hasDottedSuffix = dotted.includes(".");
  const groups = (hasDottedSuffix ? rawGroups.slice(0, -1) : rawGroups).map(parseIpv6HexGroup);

  if (!hasDottedSuffix) return groups;
  // extractIpv4FromMappedIpv6 calls this only after Node's isIPv6() has validated the address.
  const ipv4 = parseIpv4(dotted)!;
  groups.push(
    (ipv4.at(0)! << 8) | ipv4.at(1)!,
    (ipv4.at(2)! << 8) | ipv4.at(3)!,
  );
  return groups;
}

/** Expand a syntactically-valid IPv6 address into eight 16-bit groups. */
function expandIpv6Groups(host: string): number[] {
  const compressionStart = host.indexOf("::");
  if (compressionStart === -1) {
    return parseIpv6GroupList(host);
  }

  const head = parseIpv6GroupList(host.slice(0, compressionStart));
  const tail = parseIpv6GroupList(host.slice(compressionStart + 2));
  const omittedGroups = 8 - head.length - tail.length;
  return [...head, ...Array.from({ length: omittedGroups }, () => 0), ...tail];
}

/** IPv4-mapped IPv6 (::ffff:127.0.0.1 or ::ffff:7f00:1) — normalize to dotted IPv4 for SSRF checks. */
function extractIpv4FromMappedIpv6(host: string): string | null {
  const lower = host.toLowerCase();
  if (!isIPv6(lower)) return null;

  const groups = expandIpv6Groups(lower);
  if (groups.slice(0, 5).some((group) => group !== 0) || groups.at(5) !== 0xffff) return null;

  const high = groups.at(6)!;
  const low = groups.at(7)!;
  return `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
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

/** Stable codes for DNS-time hostname SSRF failures (auth discovery, mail, etc.). */
export type SafeHostnameErrorCode = "hostname_blocked" | "hostname_unresolved";

/** Typed failure from {@link resolveSafeHostname} — callers map to domain-specific API codes. */
export class SafeHostnameError extends Error {
  readonly code: SafeHostnameErrorCode;

  constructor(code: SafeHostnameErrorCode, message: string) {
    super(message);
    this.name = "SafeHostnameError";
    this.code = code;
  }
}

function assertResolvedIpSafe(address: string): void {
  const host = unbracketHostname(address).toLowerCase();
  if (isLoopbackHost(host) || isBlockedPrivateOrMetadataHost(host)) {
    throw new SafeHostnameError(
      "hostname_blocked",
      "hostname must not resolve to a private or link-local address",
    );
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
    throw new SafeHostnameError("hostname_unresolved", "hostname could not be resolved");
  }

  if (records.length === 0) {
    throw new SafeHostnameError("hostname_unresolved", "hostname could not be resolved");
  }

  for (const record of records) {
    assertResolvedIpSafe(record.address);
  }
  return records;
}

/**
 * Reject `promise` when `signal` aborts. `dns.lookup` (used by {@link resolveSafeHostname})
 * takes no AbortSignal of its own, so without this a stalled/unresponsive DNS server would
 * hang past the caller's configured timeout — this races it against the same deadline the
 * caller uses for the follow-up HTTP request, so DNS resolution stays inside that budget.
 */
export function awaitWithAbortSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}
