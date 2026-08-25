import type { Context } from "hono";
import { shouldTrustForwardedHeaders } from "./rate-limit/trust-proxy.js";

function firstForwardedValue(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const first = raw.split(",")[0]?.trim();
  return first || undefined;
}

/** Whether the incoming request arrived over HTTPS (honours X-Forwarded-Proto from a trusted proxy peer). */
export function isSecureRequest(c: Context): boolean {
  const requestUrl = new URL(c.req.url);
  let proto = requestUrl.protocol.replace(/:$/, "").toLowerCase();
  if (shouldTrustForwardedHeaders(c)) {
    const forwarded = firstForwardedValue(c.req.header("x-forwarded-proto"));
    if (forwarded) proto = forwarded.toLowerCase();
  }
  return proto === "https";
}
