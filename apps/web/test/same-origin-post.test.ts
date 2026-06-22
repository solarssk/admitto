import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { rejectCrossSitePost } from "../src/auth/same-origin-post.js";

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
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allows matching Origin scheme and host", async () => {
    const app = makeApp();
    const res = await app.request("https://tickets.example.com/login", {
      method: "POST",
      headers: { Origin: "https://tickets.example.com" },
    });
    expect(res.status).toBe(200);
  });

  it("rejects cross-host Origin", async () => {
    const app = makeApp();
    const res = await app.request("https://tickets.example.com/login", {
      method: "POST",
      headers: { Origin: "https://evil.example" },
    });
    expect(res.status).toBe(403);
  });

  it("rejects HTTP Origin on HTTPS request (same host)", async () => {
    const app = makeApp();
    const res = await app.request("https://tickets.example.com/login", {
      method: "POST",
      headers: { Origin: "http://tickets.example.com" },
    });
    expect(res.status).toBe(403);
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

  it("accepts same-origin Sec-Fetch-Site when Origin and Referer are absent", async () => {
    const app = makeApp();
    const res = await app.request("https://tickets.example.com/login", {
      method: "POST",
      headers: { "Sec-Fetch-Site": "same-origin" },
    });
    expect(res.status).toBe(200);
  });

  it("rejects cross-site Sec-Fetch-Site when Origin and Referer are absent", async () => {
    const app = makeApp();
    const res = await app.request("https://tickets.example.com/login", {
      method: "POST",
      headers: { "Sec-Fetch-Site": "cross-site" },
    });
    expect(res.status).toBe(403);
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
