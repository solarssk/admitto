import { assertSafeOidcFetchUrl, assertSafeOidcFetchUrlResolved } from "../oidc/safe-url.js";

/** Verify team certs/JWKS endpoint responds (no secrets in result). */
export async function testCfAccessConnection(input: {
  teamDomain: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const base = input.teamDomain.replace(/\/$/, "");
    const jwksUrl = `${base}/cdn-cgi/access/certs`;
    assertSafeOidcFetchUrl(jwksUrl);
    await assertSafeOidcFetchUrlResolved(jwksUrl);
    const res = await fetch(jwksUrl, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      return { ok: false, error: `JWKS endpoint returned HTTP ${res.status}` };
    }
    const body = (await res.json()) as { keys?: unknown };
    if (!Array.isArray(body.keys) || body.keys.length === 0) {
      return { ok: false, error: "JWKS document has no keys" };
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Connection test failed";
    return { ok: false, error: message };
  }
}
