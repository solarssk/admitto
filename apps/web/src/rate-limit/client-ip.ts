import type { Context } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { isIP } from "node:net";
import { resolveTrustProxy } from "../env-flags.js";

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

/** Client IP for rate limiting and audit: direct socket unless TRUST_PROXY is set. */
export function resolveClientIp(c: Context): string {
  if (resolveTrustProxy()) {
    const forwarded = c.req.header("x-forwarded-for");
    const fromHeader = clientIpFromHeaders(forwarded);
    if (fromHeader) return fromHeader;
  }

  return socketRemoteAddress(c);
}
