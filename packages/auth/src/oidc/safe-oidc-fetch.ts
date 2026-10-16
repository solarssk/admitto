import * as jose from "jose";
import { customFetch, type FetchImplementation } from "jose";
import { isIP } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
import { createPinnedDispatcher, isConnectFailure } from "@admitto/shared/pinned-dispatcher";
import {
  assertSafeOidcFetchUrl,
  isLoopbackHostForTests,
  resolveSafeOidcHostname,
  unbracketHostname,
} from "./safe-url.js";

const RESOLVED_HOST_TTL_MS = 5 * 60 * 1000;
const MAX_REDIRECTS = 5;
// A discovery document, token response or key set is a few kilobytes; 1 MiB leaves ample room.
const MAX_RESPONSE_BYTES = 1024 * 1024;
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

type OidcFetchInit = NonNullable<Parameters<typeof fetch>[1]>;

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
  return await undiciFetch(urlString, {
    ...init,
    redirect: "manual",
  } as Parameters<typeof undiciFetch>[1]);
}

/** Reads a body up to MAX_RESPONSE_BYTES; leaving the loop on the limit cancels the stream. */
async function readBodyWithinLimit(body: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of body) {
    size += chunk.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      throw new Error("OIDC response body is too large");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

/**
 * Settles a response while its connection is still open, then hands back a copy that is safe to
 * read later. Closing a pinned dispatcher waits for the request to finish, so a body nobody has
 * read stalls the close once it outgrows the socket buffers. Only the headers of a redirect are
 * used, so its body is cancelled instead of read.
 */
async function settleResponse(response: Response): Promise<Response> {
  const { status, headers } = response;
  if (REDIRECT_STATUSES.has(status)) {
    await response.body?.cancel().catch(() => undefined);
    return new Response(null, { status, headers });
  }
  const body = response.body ? await readBodyWithinLimit(response.body) : null;
  return new Response(body, { status, headers });
}

async function fetchPinnedNoFollow(urlString: string, init?: OidcFetchInit): Promise<Response> {
  assertSafeOidcFetchUrl(urlString);
  const url = new URL(urlString);
  const resolved = await getResolvedHost(url);

  if (resolved.useDefaultFetch) {
    return settleResponse(await fetch(urlString, { ...init, redirect: "manual" }));
  }

  let lastError: unknown;
  for (const record of resolved.records) {
    const dispatcher = createPinnedDispatcher(resolved.hostname, record);
    let response: Response;
    try {
      response = await pinnedUndiciFetch(urlString, {
        method: init?.method,
        body: init?.body,
        signal: init?.signal,
        headers: init?.headers,
        dispatcher,
      });
    } catch (err) {
      await dispatcher.close();
      if (!isConnectFailure(err)) throw err;
      lastError = err;
      continue;
    }
    try {
      return await settleResponse(response); // NOSONAR - tries each resolved address in turn; the next one only after the previous failed
    } finally {
      await dispatcher.close(); // NOSONAR - tries each resolved address in turn; the next one only after the previous failed
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
 * The returned response is already fully read, because the pinned connection is closed before it
 * is returned; a body over MAX_RESPONSE_BYTES rejects instead.
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
