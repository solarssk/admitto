/** Block server-side fetches to private/link-local targets (SSRF mitigation). */

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function parseIpv4(host: string): [number, number, number, number] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((part) => Number(part));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return nums as [number, number, number, number];
}

function isBlockedPrivateOrMetadataHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "metadata.google.internal") return true;

  const ip = parseIpv4(host);
  if (!ip) return false;
  const [a, b] = ip;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 127) return true;
  return false;
}

/**
 * Require HTTPS for outbound OIDC fetches. In non-production, allow http://127.0.0.1 and
 * http://localhost for local mock IdPs and integration tests.
 */
export function assertSafeOidcFetchUrl(urlString: string): void {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new Error("Invalid OIDC URL");
  }

  const loopback = isLoopbackHost(url.hostname);
  const allowHttpLoopback = process.env["NODE_ENV"] !== "production";

  if (url.protocol !== "https:" && !(allowHttpLoopback && loopback && url.protocol === "http:")) {
    throw new Error("OIDC URL must use HTTPS");
  }

  if (loopback) return;

  if (isBlockedPrivateOrMetadataHost(url.hostname)) {
    throw new Error("OIDC URL must not target private or link-local addresses");
  }
}
