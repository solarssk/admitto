import { describe, expect, it } from "vitest";
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

  it("uses X-Forwarded-Proto/Host behind a reverse proxy", async () => {
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

  it("rejects HTTP Origin when proxy terminates TLS", async () => {
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
});
