import type { Context } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { isIP, isIPv6 } from "node:net";
import { isTrustedProxyAddress, shouldTrustForwardedHeaders } from "./trust-proxy.js";

/**
 * The client address in an X-Forwarded-For list: the rightmost hop that is not one of our own
 * trusted proxies (`isTrustedHop`). Each proxy appends the address it received the request from, so
 * the entries to the right of the first untrusted one were added by infrastructure we trust, and
 * everything to its left was supplied by the client and can be anything - taking the first hop
 * would let a client pick its own rate-limit bucket behind a proxy that appends instead of
 * overwriting. When every hop is trusted (a request that never left the proxy chain) the leftmost
 * one is used. Returns undefined when the header is missing or any hop is not a valid IP (the
 * caller then falls back to the socket address, avoiding shared "unknown" buckets).
 */
export function clientIpFromHeaders(
  forwardedFor: string | undefined,
  isTrustedHop: (ip: string) => boolean = () => false,
): string | undefined {
  if (!forwardedFor) return undefined;
  const hops = forwardedFor.split(",").map((hop) => {
    const trimmed = hop.trim();
    return trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1) : trimmed;
  });
  if (hops.some((hop) => !isIP(hop))) return undefined;
  for (let i = hops.length - 1; i >= 0; i--) {
    if (!isTrustedHop(hops[i]!)) return hops[i];
  }
  return hops[0];
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
    const fromHeader = clientIpFromHeaders(forwarded, (hop) => isTrustedProxyAddress(hop));
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
