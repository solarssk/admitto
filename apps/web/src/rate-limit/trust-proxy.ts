import type { Context } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { BlockList, isIP } from "node:net";
import { resolveTrustProxy } from "../env-flags.js";

type EnvLike = Record<string, string | undefined>;

/** Same-host default: covers TRUST_PROXY setups where the proxy shares the app's network namespace. */
const DEFAULT_TRUSTED_PROXY_CIDRS = "127.0.0.1/32,::1/128";

/**
 * Parse a comma-separated CIDR allowlist (e.g. "127.0.0.1/32,::1/128") into a BlockList.
 * Malformed entries are skipped; throws only when nothing usable remains, so boot validation
 * (see `validateTrustedProxyCidrsBootConfig` in ../config.ts) catches a typo'd env var early.
 */
export function parseTrustedProxyCidrs(raw: string): BlockList {
  const list = new BlockList();
  let count = 0;
  for (const entry of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    const [address, prefixRaw] = entry.split("/");
    const family = address ? isIP(address) : 0;
    if (!family) continue;
    const maxPrefix = family === 6 ? 128 : 32;
    // Number.parseInt("2x", 10) === 2 - a mistyped "/2x" (meant "/24") would otherwise silently
    // widen the trusted range to a /2 instead of being rejected. Require the whole prefix string
    // to be decimal digits before converting it.
    const prefix =
      prefixRaw !== undefined ? (/^\d+$/.test(prefixRaw) ? Number.parseInt(prefixRaw, 10) : NaN) : maxPrefix;
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix) continue;
    list.addSubnet(address!, prefix, family === 6 ? "ipv6" : "ipv4");
    count += 1;
  }
  if (count === 0) {
    throw new Error("TRUSTED_PROXY_CIDRS must contain at least one valid CIDR entry");
  }
  return list;
}

/** Resolve the configured trusted-proxy allowlist; defaults to loopback-only (same-host proxy). */
export function resolveTrustedProxyCidrs(env: EnvLike = process.env): BlockList {
  const raw = env["TRUSTED_PROXY_CIDRS"]?.trim();
  return parseTrustedProxyCidrs(raw || DEFAULT_TRUSTED_PROXY_CIDRS);
}

/** Direct TCP peer address, or undefined when unavailable — never derived from a header. */
function socketPeerAddress(c: Context): string | undefined {
  try {
    const address = getConnInfo(c).remote.address;
    return address && isIP(address) ? address : undefined;
  } catch {
    return undefined;
  }
}

/** Whether the direct TCP peer is inside the configured trusted-proxy allowlist. */
export function isTrustedProxyPeer(c: Context, env: EnvLike = process.env): boolean {
  const peer = socketPeerAddress(c);
  if (!peer) return false;
  return resolveTrustedProxyCidrs(env).check(peer, isIP(peer) === 6 ? "ipv6" : "ipv4");
}

/**
 * Whether X-Forwarded-For/Host/Proto should be trusted for this request: TRUST_PROXY=true AND
 * the request arrived directly from an allowlisted proxy peer. Gates every read of those headers
 * (client-ip.ts, same-origin-post.ts, auth/routes.ts) — TRUST_PROXY alone is not enough, since
 * anyone who can reach the app directly could otherwise set those headers themselves.
 */
export function shouldTrustForwardedHeaders(c: Context, env: EnvLike = process.env): boolean {
  return resolveTrustProxy(env) && isTrustedProxyPeer(c, env);
}
