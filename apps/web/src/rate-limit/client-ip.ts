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

/**
 * Rate-limit bucket identity for a client IP. A single IPv6 host usually controls a whole /64,
 * so keying on the full address lets it rotate through buckets at will; IPv6 addresses are
 * collapsed to their /64 prefix. IPv4 (and IPv4-mapped IPv6) addresses are keyed as-is.
 * Audit and log fields keep using the full address from {@link resolveClientIp}.
 */
export function rateLimitIpKey(ip: string): string {
  if (!isIPv6(ip)) return ip;
  const mappedV4 = ip.toLowerCase().startsWith("::ffff:") ? ip.slice("::ffff:".length) : "";
  if (isIP(mappedV4) === 4) return mappedV4;
  const bare = ip.split("%")[0]!.toLowerCase();
  if (bare.includes(".")) return bare;
  const [left = "", right] = bare.split("::");
  const head = left ? left.split(":") : [];
  const tail = right ? right.split(":") : [];
  const groups =
    right === undefined
      ? head
      : [...head, ...Array.from({ length: 8 - head.length - tail.length }, () => "0"), ...tail];
  return `${groups
    .slice(0, 4)
    .map((g) => Number.parseInt(g, 16).toString(16))
    .join(":")}::/64`;
}
