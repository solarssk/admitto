import * as jose from "jose";
import { customFetch, type FetchImplementation } from "jose";
import { isIP } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
import {
  assertSafeOidcFetchUrl,
  isLoopbackHostForTests,
  resolveSafeOidcHostname,
  unbracketHostname,
} from "./safe-url.js";

const RESOLVED_HOST_TTL_MS = 5 * 60 * 1000;
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

interface ResolvedHostRecord {
  address: string;
  family: 4 | 6;
}

interface ResolvedHost {
  hostname: string;
  records: ResolvedHostRecord[];
  useDefaultFetch: boolean;
}

const resolvedHostCache = new Map<string, { resolved: ResolvedHost; expiresAt: number }>();

/** For tests — reset pinned DNS cache between cases. */
export function clearPinnedOidcCacheForTests(): void {
  resolvedHostCache.clear();
}

function isDevLoopbackAllowed(): boolean {
  return process.env["NODE_ENV"] !== "production";
}

function toResolvedRecords(
  records: Awaited<ReturnType<typeof resolveSafeOidcHostname>>,
): ResolvedHostRecord[] {
  return records.map((record) => ({
    address: record.address,
    family: record.family === 6 ? 6 : 4,
  }));
}

async function resolveHostForUrl(url: URL): Promise<ResolvedHost> {
  const hostname = unbracketHostname(url.hostname);

  if (isDevLoopbackAllowed() && isLoopbackHostForTests(hostname)) {
    return {
      hostname,
      records: [{ address: hostname, family: hostname.includes(":") ? 6 : 4 }],
      useDefaultFetch: true,
    };
  }

  if (isIP(hostname)) {
    await resolveSafeOidcHostname(hostname);
    return {
      hostname,
      records: [{ address: hostname, family: isIP(hostname) === 6 ? 6 : 4 }],
      useDefaultFetch: true,
    };
  }

  const records = await resolveSafeOidcHostname(hostname);
  if (records.length === 0) {
    throw new Error("OIDC URL hostname could not be resolved");
  }

  return {
    hostname,
    records: toResolvedRecords(records),
    useDefaultFetch: false,
  };
}

async function getResolvedHost(url: URL): Promise<ResolvedHost> {
  const now = Date.now();
  const cacheKey = url.host;
  const cached = resolvedHostCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.resolved;
  }
  const resolved = await resolveHostForUrl(url);
  resolvedHostCache.set(cacheKey, { resolved, expiresAt: now + RESOLVED_HOST_TTL_MS });
  return resolved;
}

/** Pin connect-time DNS to a validated address while keeping the original URL hostname (Host/SNI). */
function createPinnedDispatcher(hostname: string, record: ResolvedHostRecord): Agent {
  return new Agent({
    connect: {
      servername: hostname,
      lookup: (_host, _options, callback) => {
        callback(null, record.address, record.family);
      },
    },
  });
}

type OidcFetchInit = NonNullable<Parameters<typeof fetch>[1]>;

function isConnectFailure(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as NodeJS.ErrnoException).code;
  if (
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    code === "ENETUNREACH" ||
    code === "EHOSTUNREACH" ||
    code === "EPERM"
  ) {
    return true;
  }
  const cause = (err as Error & { cause?: unknown }).cause;
  if (cause instanceof Error) {
    return isConnectFailure(cause);
  }
  return err.message.toLowerCase().includes("fetch failed");
}

async function pinnedUndiciFetch(
  urlString: string,
  init: {
    method?: OidcFetchInit["method"];
    body?: OidcFetchInit["body"];
    signal?: OidcFetchInit["signal"];
    headers?: OidcFetchInit["headers"];
    dispatcher: Agent;
  },
): Promise<Response> {
  return (await undiciFetch(urlString, {
    ...init,
    redirect: "manual",
  } as Parameters<typeof undiciFetch>[1])) as unknown as Response;
}

async function fetchPinnedNoFollow(urlString: string, init?: OidcFetchInit): Promise<Response> {
  assertSafeOidcFetchUrl(urlString);
  const url = new URL(urlString);
  const resolved = await getResolvedHost(url);

  if (resolved.useDefaultFetch) {
    return fetch(urlString, { ...init, redirect: "manual" });
  }

  let lastError: unknown;
  for (const record of resolved.records) {
    const dispatcher = createPinnedDispatcher(resolved.hostname, record);
    try {
      return await pinnedUndiciFetch(urlString, {
        method: init?.method,
        body: init?.body,
        signal: init?.signal,
        headers: init?.headers,
        dispatcher,
      });
    } catch (err) {
      if (!isConnectFailure(err)) throw err;
      lastError = err;
    } finally {
      await dispatcher.close();
    }
  }

  throw lastError instanceof Error ? lastError : new Error("OIDC URL hostname could not be reached");
}

function resolveRedirectUrl(response: Response, baseUrl: string): string {
  const location = response.headers.get("location");
  if (!location) {
    throw new Error("Redirect response missing Location header");
  }
  return new URL(location, baseUrl).href;
}

function redirectFollowInit(status: number, init?: OidcFetchInit): OidcFetchInit | undefined {
  if (status === 307 || status === 308) {
    return init;
  }
  if (!init) return { method: "GET" };
  const { body: _body, ...rest } = init;
  return { ...rest, method: "GET" };
}

/**
 * Outbound OIDC/CF Access fetch with DNS pinning at connect time.
 * Uses the original URL hostname for Host/SNI; undici connects via a validated pinned address.
 */
export async function safeOidcFetch(urlString: string, init?: OidcFetchInit): Promise<Response> {
  let currentUrl = urlString;
  let requestInit: OidcFetchInit | undefined = init;

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const response = await fetchPinnedNoFollow(currentUrl, requestInit);
    if (!REDIRECT_STATUSES.has(response.status)) {
      return response;
    }
    if (redirects === MAX_REDIRECTS) {
      throw new Error("Too many OIDC redirects");
    }
    currentUrl = resolveRedirectUrl(response, currentUrl);
    assertSafeOidcFetchUrl(currentUrl);
    requestInit = redirectFollowInit(response.status, requestInit);
  }

  throw new Error("Too many OIDC redirects");
}

/** jose `customFetch` with pinned outbound fetch and manual redirect validation. */
export function createSafeOidcCustomFetch(urlString: string): FetchImplementation {
  assertSafeOidcFetchUrl(urlString);
  return async (url, options) =>
    safeOidcFetch(url, {
      method: options.method,
      signal: options.signal,
      headers: options.headers,
    });
}

/** Remote JWKS verifier with pinned outbound fetch. */
export function createPinnedRemoteJWKSet(jwksUri: string): jose.JWTVerifyGetKey {
  assertSafeOidcFetchUrl(jwksUri);
  return jose.createRemoteJWKSet(new URL(jwksUri), {
    [customFetch]: createSafeOidcCustomFetch(jwksUri),
  });
}
