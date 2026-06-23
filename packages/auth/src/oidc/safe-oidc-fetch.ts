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

interface ResolvedHost {
  host: string;
  hostname: string;
  address: string;
  family: 4 | 6;
  useDefaultFetch: boolean;
}

interface PinnedOidcTarget extends ResolvedHost {
  pinnedHref: string;
}

const resolvedHostCache = new Map<string, { resolved: ResolvedHost; expiresAt: number }>();

/** For tests — reset pinned DNS cache between cases. */
export function clearPinnedOidcCacheForTests(): void {
  resolvedHostCache.clear();
}

function isDevLoopbackAllowed(): boolean {
  return process.env["NODE_ENV"] !== "production";
}

function formatPinnedHostname(address: string): string {
  return address.includes(":") ? `[${address}]` : address;
}

async function resolveHostForUrl(url: URL): Promise<ResolvedHost> {
  const hostname = unbracketHostname(url.hostname);

  if (isDevLoopbackAllowed() && isLoopbackHostForTests(hostname)) {
    return {
      host: url.host,
      hostname,
      address: hostname,
      family: hostname.includes(":") ? 6 : 4,
      useDefaultFetch: true,
    };
  }

  if (isIP(hostname)) {
    await resolveSafeOidcHostname(hostname);
    return {
      host: url.host,
      hostname,
      address: hostname,
      family: isIP(hostname) === 6 ? 6 : 4,
      useDefaultFetch: true,
    };
  }

  const records = await resolveSafeOidcHostname(hostname);
  const record = records[0];
  if (!record) {
    throw new Error("OIDC URL hostname could not be resolved");
  }

  return {
    host: url.host,
    hostname,
    address: record.address,
    family: record.family === 6 ? 6 : 4,
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

function toPinnedTarget(url: URL, resolved: ResolvedHost): PinnedOidcTarget {
  if (resolved.useDefaultFetch) {
    return { ...resolved, pinnedHref: url.href };
  }
  const pinned = new URL(url.href);
  pinned.hostname = formatPinnedHostname(resolved.address);
  return { ...resolved, pinnedHref: pinned.href };
}

async function getPinnedOidcTarget(urlString: string): Promise<PinnedOidcTarget> {
  assertSafeOidcFetchUrl(urlString);
  const url = new URL(urlString);
  const resolved = await getResolvedHost(url);
  return toPinnedTarget(url, resolved);
}

function createPinnedDispatcher(hostname: string, address: string, family: 4 | 6): Agent {
  return new Agent({
    connect: {
      servername: hostname,
      lookup: (_host, _options, callback) => {
        callback(null, address, family);
      },
    },
  });
}

type OidcFetchInit = NonNullable<Parameters<typeof fetch>[1]>;

function withHostHeader(headers: unknown, host: string): Headers {
  const merged = new Headers(headers as ConstructorParameters<typeof Headers>[0]);
  merged.set("host", host);
  return merged;
}

async function pinnedUndiciFetch(
  pinnedHref: string,
  init: {
    method?: OidcFetchInit["method"];
    body?: OidcFetchInit["body"];
    signal?: OidcFetchInit["signal"];
    redirect?: OidcFetchInit["redirect"];
    headers?: unknown;
    dispatcher: Agent;
  },
): Promise<Response> {
  return (await undiciFetch(pinnedHref, init as Parameters<typeof undiciFetch>[1])) as unknown as Response;
}

/** Outbound OIDC/CF Access fetch with DNS pinning (blocks rebinding between check and connect). */
export async function safeOidcFetch(urlString: string, init?: OidcFetchInit): Promise<Response> {
  const target = await getPinnedOidcTarget(urlString);
  if (target.useDefaultFetch) {
    return fetch(urlString, init);
  }

  const dispatcher = createPinnedDispatcher(target.hostname, target.address, target.family);
  try {
    return await pinnedUndiciFetch(target.pinnedHref, {
      method: init?.method,
      body: init?.body,
      signal: init?.signal,
      redirect: init?.redirect,
      headers: withHostHeader(init?.headers, target.host),
      dispatcher,
    });
  } finally {
    await dispatcher.close();
  }
}

/** jose `customFetch` that reuses the same pinned address for JWKS reloads. */
export function createSafeOidcCustomFetch(urlString: string): FetchImplementation {
  return async (url, options) => {
    const target = await getPinnedOidcTarget(urlString);
    if (target.useDefaultFetch) {
      return fetch(url, options);
    }

    const dispatcher = createPinnedDispatcher(target.hostname, target.address, target.family);
    try {
      return await pinnedUndiciFetch(target.pinnedHref, {
        method: options.method,
        signal: options.signal,
        redirect: options.redirect,
        headers: withHostHeader(options.headers, target.host),
        dispatcher,
      });
    } finally {
      await dispatcher.close();
    }
  };
}

/** Remote JWKS verifier with pinned outbound fetch. */
export function createPinnedRemoteJWKSet(jwksUri: string): jose.JWTVerifyGetKey {
  assertSafeOidcFetchUrl(jwksUri);
  return jose.createRemoteJWKSet(new URL(jwksUri), {
    [customFetch]: createSafeOidcCustomFetch(jwksUri),
  });
}
