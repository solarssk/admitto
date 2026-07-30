import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { rejectCrossSitePost } from "../src/auth/same-origin-post.js";

vi.mock("@hono/node-server/conninfo", () => ({
  getConnInfo: vi.fn(),
}));

const mockedGetConnInfo = vi.mocked(getConnInfo);

/** Trusted by default (matches TRUSTED_PROXY_CIDRS' loopback default) unless a test overrides it. */
function setPeer(address: string) {
  mockedGetConnInfo.mockReturnValue({
    remote: { address, port: 1234 },
  } as ReturnType<typeof getConnInfo>);
}

function makeApp() {
  const app = new Hono();
  app.post("/login", (c) => {
    const blocked = rejectCrossSitePost(c);
    if (blocked) return blocked;
    return c.text("ok", 200);
  });
  return app;
}

describe("rejectCrossSitePost", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    setPeer("127.0.0.1");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it.each([
    { name: "allows matching Origin scheme and host", origin: "https://tickets.example.com", expectedStatus: 200 },
    { name: "rejects cross-host Origin", origin: "https://evil.example", expectedStatus: 403 },
    {
      name: "rejects HTTP Origin on HTTPS request (same host)",
      origin: "http://tickets.example.com",
      expectedStatus: 403,
    },
  ])("$name", async ({ origin, expectedStatus }) => {
    const app = makeApp();
    const res = await app.request("https://tickets.example.com/login", {
      method: "POST",
      headers: { Origin: origin },
    });
    expect(res.status).toBe(expectedStatus);
  });

  it("rejects HTTPS Origin on HTTP request (same host)", async () => {
    const app = makeApp();
    const res = await app.request("http://tickets.example.com/login", {
      method: "POST",
      headers: { Origin: "https://tickets.example.com" },
    });
    expect(res.status).toBe(403);
  });

  it("accepts Referer when Origin is absent", async () => {
    const app = makeApp();
    const res = await app.request("https://tickets.example.com/login", {
      method: "POST",
      headers: { Referer: "https://tickets.example.com/login" },
    });
    expect(res.status).toBe(200);
  });

  it("rejects cross-scheme Referer", async () => {
    const app = makeApp();
    const res = await app.request("https://tickets.example.com/login", {
      method: "POST",
      headers: { Referer: "http://tickets.example.com/login" },
    });
    expect(res.status).toBe(403);
  });

  it("rejects POST when Origin, Referer, and Sec-Fetch-Site are absent", async () => {
    const app = makeApp();
    const res = await app.request("https://tickets.example.com/login", { method: "POST" });
    expect(res.status).toBe(403);
  });

  it.each([
    {
      name: "accepts same-origin Sec-Fetch-Site when Origin and Referer are absent",
      value: "same-origin",
      expectedStatus: 200,
    },
    {
      name: "rejects cross-site Sec-Fetch-Site when Origin and Referer are absent",
      value: "cross-site",
      expectedStatus: 403,
    },
    {
      name: "rejects same-site Sec-Fetch-Site when Origin and Referer are absent",
      value: "same-site",
      expectedStatus: 403,
    },
  ])("$name", async ({ value, expectedStatus }) => {
    const app = makeApp();
    const res = await app.request("https://tickets.example.com/login", {
      method: "POST",
      headers: { "Sec-Fetch-Site": value },
    });
    expect(res.status).toBe(expectedStatus);
  });

  it("accepts Origin with non-default port when X-Forwarded-Host matches and TRUST_PROXY=true", async () => {
    vi.stubEnv("TRUST_PROXY", "true");
    const app = makeApp();
    const res = await app.request("http://127.0.0.1/login", {
      method: "POST",
      headers: {
        Origin: "http://127.0.0.1:8080",
        "X-Forwarded-Proto": "http",
        "X-Forwarded-Host": "127.0.0.1:8080",
      },
    });
    expect(res.status).toBe(200);
  });

  it("uses X-Forwarded-Proto/Host when TRUST_PROXY=true", async () => {
    vi.stubEnv("TRUST_PROXY", "true");
    const app = makeApp();
    const res = await app.request("http://127.0.0.1/login", {
      method: "POST",
      headers: {
        Origin: "https://tickets.example.com",
        "X-Forwarded-Proto": "https",
        "X-Forwarded-Host": "tickets.example.com",
      },
    });
    expect(res.status).toBe(200);
  });

  it("rejects HTTP Origin when proxy terminates TLS and TRUST_PROXY=true", async () => {
    vi.stubEnv("TRUST_PROXY", "true");
    const app = makeApp();
    const res = await app.request("http://127.0.0.1/login", {
      method: "POST",
      headers: {
        Origin: "http://tickets.example.com",
        "X-Forwarded-Proto": "https",
        "X-Forwarded-Host": "tickets.example.com",
      },
    });
    expect(res.status).toBe(403);
  });

  it("ignores spoofed X-Forwarded-Host/Proto from an untrusted peer even when TRUST_PROXY=true", async () => {
    // Reproduces xfh-csrf-bypass-01: an attacker reaching the app directly (bypassing the
    // reverse proxy) must not be able to forge the CSRF origin check via these headers.
    vi.stubEnv("TRUST_PROXY", "true");
    setPeer("203.0.113.99");
    const app = makeApp();
    const res = await app.request("http://127.0.0.1/login", {
      method: "POST",
      headers: {
        Origin: "https://evil.example",
        "X-Forwarded-Proto": "https",
        "X-Forwarded-Host": "evil.example",
      },
    });
    expect(res.status).toBe(403);
  });

  it("ignores spoofed X-Forwarded-* when TRUST_PROXY is unset", async () => {
    const app = makeApp();
    const res = await app.request("http://127.0.0.1/login", {
      method: "POST",
      headers: {
        Origin: "https://evil.example",
        "X-Forwarded-Proto": "https",
        "X-Forwarded-Host": "evil.example",
      },
    });
    expect(res.status).toBe(403);
  });

  it("rejects public Origin on loopback when TRUST_PROXY is unset", async () => {
    const app = makeApp();
    const res = await app.request("http://127.0.0.1/login", {
      method: "POST",
      headers: {
        Origin: "https://tickets.example.com",
        "X-Forwarded-Proto": "https",
        "X-Forwarded-Host": "tickets.example.com",
      },
    });
    expect(res.status).toBe(403);
  });

  it("returns 403 not 500 when forwarded headers are malformed and TRUST_PROXY=true", async () => {
    vi.stubEnv("TRUST_PROXY", "true");
    const app = makeApp();
    const res = await app.request("https://tickets.example.com/login", {
      method: "POST",
      headers: {
        Origin: "https://evil.example",
        "X-Forwarded-Proto": ":::bad",
        "X-Forwarded-Host": "%%%",
      },
    });
    expect(res.status).toBe(403);
  });

  it("falls back to request origin when forwarded headers are malformed and TRUST_PROXY=true", async () => {
    vi.stubEnv("TRUST_PROXY", "true");
    const app = makeApp();
    const res = await app.request("https://tickets.example.com/login", {
      method: "POST",
      headers: {
        Origin: "https://tickets.example.com",
        "X-Forwarded-Proto": ":::bad",
        "X-Forwarded-Host": "%%%",
      },
    });
    expect(res.status).toBe(200);
  });
});
