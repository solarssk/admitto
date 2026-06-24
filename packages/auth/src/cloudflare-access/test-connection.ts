import { safeOidcFetch } from "../oidc/safe-oidc-fetch.js";
import { assertSafeOidcFetchUrl } from "../oidc/safe-url.js";

/** Verify team certs/JWKS endpoint responds (no secrets in result). */
export async function testCfAccessConnection(input: {
  teamDomain: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const base = input.teamDomain.replace(/\/$/, "");
    const jwksUrl = `${base}/cdn-cgi/access/certs`;
    assertSafeOidcFetchUrl(jwksUrl);
    const res = await safeOidcFetch(jwksUrl, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      return { ok: false, error: `Connection check failed (HTTP ${res.status})` };
    }
    const body = (await res.json()) as { keys?: unknown };
    if (!Array.isArray(body.keys) || body.keys.length === 0) {
      return { ok: false, error: "Connection check failed: no signing keys found" };
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Connection test failed";
    return { ok: false, error: message };
  }
}
