import type { Context } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { isIP, isIPv6 } from "node:net";
import { shouldTrustForwardedHeaders } from "./trust-proxy.js";

/**
 * First X-Forwarded-For hop — safe only behind a reverse proxy that
 * overwrites/forwards a trusted client IP (document in deployment runbook).
 * Returns undefined when the hop is missing or not a valid IP (avoids shared "unknown" buckets).
 */
export function clientIpFromHeaders(
  forwardedFor: string | undefined,
): string | undefined {
  if (!forwardedFor) return undefined;
  const first = forwardedFor.split(",")[0]?.trim();
  if (!first) return undefined;
  const host = first.startsWith("[") && first.endsWith("]") ? first.slice(1, -1) : first;
  return isIP(host) ? host : undefined;
}

function socketRemoteAddress(c: Context): string {
  try {
    const { remote } = getConnInfo(c);
    const address = remote.address;
    if (address && isIP(address)) return address;
  } catch {
    // fall through
  }
  return "unknown";
}

/** Client IP for rate limiting and audit: direct socket unless request came from a trusted proxy. */
export function resolveClientIp(c: Context): string {
  if (shouldTrustForwardedHeaders(c)) {
    const forwarded = c.req.header("x-forwarded-for");
    const fromHeader = clientIpFromHeaders(forwarded);
    if (fromHeader) return fromHeader;
  }

  return socketRemoteAddress(c);
}

/** Eight 16-bit groups of a valid IPv6 address (zone index and an embedded dotted IPv4 tail handled). */
function ipv6Groups(ip: string): number[] {
  let text = ip.split("%")[0]!;
  const lastColon = text.lastIndexOf(":");
  const tail = text.slice(lastColon + 1);
  if (tail.includes(".")) {
    const [a = 0, b = 0, c = 0, d = 0] = tail.split(".").map(Number);
    text = `${text.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [left = "", right] = text.split("::");
  const head = left ? left.split(":") : [];
  const rest = right ? right.split(":") : [];
  const fill = right === undefined ? 0 : 8 - head.length - rest.length;
  return [...head, ...Array.from({ length: fill }, () => "0"), ...rest].map((g) => Number.parseInt(g, 16));
}

/**
 * Rate-limit bucket identity for a client IP. A single IPv6 host usually controls a whole /64,
 * so keying on the full address lets it rotate through buckets at will; IPv6 addresses are
 * collapsed to their /64 prefix. IPv4 addresses, and IPv4-mapped IPv6 addresses in any spelling
 * (`::ffff:192.0.2.1`, `::ffff:c000:201`), are keyed as the IPv4 address.
 * Audit and log fields keep using the full address from {@link resolveClientIp}.
 */
export function rateLimitIpKey(ip: string): string {
  if (!isIPv6(ip)) return ip;
  const groups = ipv6Groups(ip);
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    const [high = 0, low = 0] = groups.slice(6);
    return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
  }
  return `${groups
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(":")}::/64`;
}
