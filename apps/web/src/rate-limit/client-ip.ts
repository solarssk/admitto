import type { Context } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";

/**
 * First X-Forwarded-For hop — safe only behind a reverse proxy that
 * overwrites/forwards a trusted client IP (document in deployment runbook).
 */
export function clientIpFromHeaders(
  forwardedFor: string | undefined,
  fallback = "unknown",
): string {
  if (!forwardedFor) return fallback;
  const first = forwardedFor.split(",")[0]?.trim();
  return first || fallback;
}

function trustProxyEnabled(): boolean {
  const v = process.env["TRUST_PROXY"];
  return v === "1" || v === "true";
}

/** Client IP for rate limiting and audit: direct socket unless TRUST_PROXY is set. */
export function resolveClientIp(c: Context): string {
  if (trustProxyEnabled()) {
    const forwarded = c.req.header("x-forwarded-for");
    if (forwarded) return clientIpFromHeaders(forwarded);
  }

  try {
    const { remote } = getConnInfo(c);
    return remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}
