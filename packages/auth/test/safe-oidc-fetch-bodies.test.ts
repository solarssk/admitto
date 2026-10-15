import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { lookup } from "node:dns/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Agent } from "undici";
import {
  clearPinnedOidcCacheForTests,
  createSafeOidcCustomFetch,
  safeOidcFetch,
} from "../src/oidc/safe-oidc-fetch.js";

// Real undici and real sockets. Only DNS is faked (the pinned address is a local server) and the
// scheme is downgraded to HTTP, so a plain local server can stand in for an HTTPS identity
// provider. The pinned Agent, its close() and the body streaming are the real ones.
vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal<typeof import("undici")>();
  return {
    ...actual,
    fetch: (input: string | URL, init?: Parameters<typeof actual.fetch>[1]) =>
      actual.fetch(String(input).replace(/^https:/, "http:"), init),
  };
});

const LIMIT_BYTES = 1024 * 1024;
const PINNED_HOST = "login.example.com";
// A hung request would otherwise wait for the test timeout; this makes it fail in a few seconds.
const ATTEMPT_MS = 3000;

let server: Server;
let port = 0;
let endlessStreamClosed = false;

function pinnedUrl(path: string): string {
  return `https://${PINNED_HOST}:${port}${path}`;
}

function attempt(): { signal: AbortSignal } {
  return { signal: AbortSignal.timeout(ATTEMPT_MS) };
}

function keySet(count: number): string {
  const keys = Array.from({ length: count }, (_, index) => ({
    kty: "RSA",
    kid: `key-${index}`,
    n: "A".repeat(342),
    e: "AQAB",
  }));
  return JSON.stringify({ keys });
}

function sendChunked(res: ServerResponse, size: number): void {
  res.writeHead(200, { "content-type": "text/plain" });
  for (let sent = 0; sent < size; sent += 16_384) {
    res.write(Buffer.alloc(Math.min(16_384, size - sent), 0x61));
  }
  res.end();
}

function sendUntilClosed(res: ServerResponse): void {
  const chunk = Buffer.alloc(64 * 1024, 0x61);
  res.writeHead(200, { "content-type": "text/plain" });
  res.on("close", () => {
    endlessStreamClosed = true;
  });
  const write = (): void => {
    if (res.destroyed) return;
    if (res.write(chunk)) setImmediate(write);
    else res.once("drain", write);
  };
  write();
}

function handle(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? "/", `https://${PINNED_HOST}`);
  const size = Number(url.searchParams.get("size") ?? 0);
  if (url.pathname === "/body") {
    res.writeHead(200, { "content-type": "text/plain", "content-length": size });
    res.end(Buffer.alloc(size, 0x61));
  } else if (url.pathname === "/chunked") {
    sendChunked(res, size);
  } else if (url.pathname === "/keys") {
    const body = keySet(300);
    res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
    res.end(body);
  } else if (url.pathname === "/redirect") {
    res.writeHead(302, { location: pinnedUrl("/final"), "content-length": 200_000 });
    res.end(Buffer.alloc(200_000, 0x61));
  } else if (url.pathname === "/empty") {
    res.writeHead(204);
    res.end();
  } else if (url.pathname === "/final") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  } else if (url.pathname === "/endless") {
    sendUntilClosed(res);
  } else {
    res.writeHead(404);
    res.end();
  }
}

beforeAll(async () => {
  server = createServer(handle);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
  vi.stubEnv("SSO_PRIVATE_DESTINATION_ALLOWLIST", PINNED_HOST);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

beforeEach(() => {
  endlessStreamClosed = false;
  clearPinnedOidcCacheForTests();
  vi.mocked(lookup).mockResolvedValue([{ address: "127.0.0.1", family: 4 }] as Awaited<
    ReturnType<typeof lookup>
  >);
});

describe("safeOidcFetch response bodies over a pinned connection", () => {
  it("returns a body larger than the connection buffers and closes the pinned dispatcher", async () => {
    const closeSpy = vi.spyOn(Agent.prototype, "close");
    try {
      const res = await safeOidcFetch(pinnedUrl("/body?size=200000"), attempt());

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/plain");
      expect(await res.text()).toBe("a".repeat(200_000));
      // undici's close() re-enters itself, so count the distinct Agents that were closed.
      const closedAgents = new Set(closeSpy.mock.contexts.filter((context) => context instanceof Agent));
      expect(closedAgents.size).toBe(1);
    } finally {
      closeSpy.mockRestore();
    }
  });

  it("returns a response that has no body", async () => {
    const res = await safeOidcFetch(pinnedUrl("/empty"), attempt());

    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });

  it("returns a large body whose length is not announced", async () => {
    const res = await safeOidcFetch(pinnedUrl("/chunked?size=150000"), attempt());

    expect((await res.text()).length).toBe(150_000);
  });

  it("serves a large key set through the jose custom fetch", async () => {
    const customFetch = createSafeOidcCustomFetch(pinnedUrl("/keys"));

    const res = await customFetch(pinnedUrl("/keys"), { method: "GET", ...attempt() });
    const jwks = (await res.json()) as { keys: unknown[] };

    expect(jwks.keys).toHaveLength(300);
  });

  it("follows a redirect whose body is large", async () => {
    const res = await safeOidcFetch(pinnedUrl("/redirect"), attempt());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("accepts a body of exactly the limit and rejects one byte more", async () => {
    const res = await safeOidcFetch(pinnedUrl(`/body?size=${LIMIT_BYTES}`), attempt());
    expect((await res.text()).length).toBe(LIMIT_BYTES);

    await expect(safeOidcFetch(pinnedUrl(`/body?size=${LIMIT_BYTES + 1}`), attempt())).rejects.toThrow(
      /too large/,
    );
  });

  it("stops reading a body that never ends and drops the connection", async () => {
    await expect(safeOidcFetch(pinnedUrl("/endless"), attempt())).rejects.toThrow(/too large/);

    await vi.waitFor(() => expect(endlessStreamClosed).toBe(true));
  });
});

describe("safeOidcFetch response bodies over the plain fetch path", () => {
  it("applies the same limit to a loopback identity provider", async () => {
    const small = await safeOidcFetch(`http://127.0.0.1:${port}/body?size=150000`, attempt());
    expect((await small.text()).length).toBe(150_000);

    await expect(safeOidcFetch(`http://127.0.0.1:${port}/endless`, attempt())).rejects.toThrow(/too large/);
    await vi.waitFor(() => expect(endlessStreamClosed).toBe(true));
  });
});
