import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";
import { InMemoryRateLimitStore, type RateLimitStore } from "../src/rate-limit/index.js";
import {
  INLINE_RATE_LIMITS,
  RATE_POLICIES,
  checkRegistrationEventRateLimit,
  checkRegistrationMailRecipientRateLimit,
  rateLimit,
} from "../src/rate-limit/policies.js";
import { applyRateLimitOverrides } from "../src/rate-limit/overrides.js";
import { RedisRateLimitStore } from "../src/rate-limit/redis.js";
import {
  MAX_REGISTRATION_BODY_BYTES,
  registrationSubmitGuards,
} from "../src/registration/submit-guards.js";

const peer = vi.hoisted(() => ({ address: "203.0.113.10" }));
vi.mock("@hono/node-server/conninfo", () => ({
  getConnInfo: vi.fn(() => ({ remote: { address: peer.address, port: 1234 } })),
}));

const SUBMIT_MAX = RATE_POLICIES["registration:submit"].checks[0]!.max;
const sameOrigin = { Origin: "http://localhost", "Content-Type": "application/json" };

/** Stand-in for POST /r/:slug: the real handler (95c) sits behind exactly these guards. */
function makeSubmitApp(store: RateLimitStore) {
  const app = new Hono();
  const [crossSite, ipLimit, bodyCap] = registrationSubmitGuards(store);
  app.post("/r/:slug", crossSite, ipLimit, bodyCap, async (c) => {
    await c.req.json();
    return c.json({ received: true });
  });
  return app;
}

/** The same body, sent chunked with no Content-Length, so only the running count can stop it. */
function chunkedInit(text: string, headers: Record<string, string>): RequestInit {
  const bytes = new TextEncoder().encode(text);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const half = Math.floor(bytes.length / 2);
      controller.enqueue(bytes.slice(0, half));
      controller.enqueue(bytes.slice(half));
      controller.close();
    },
  });
  return { method: "POST", headers, body, duplex: "half" } as RequestInit;
}

const oversized = () => JSON.stringify({ pad: "x".repeat(MAX_REGISTRATION_BODY_BYTES) });

beforeEach(() => {
  peer.address = "203.0.113.10";
  resetSystemLogBufferForTest();
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("registration per-IP policies", () => {
  it("shares one bucket across an IPv6 /64 and separates other networks", async () => {
    const store = new InMemoryRateLimitStore();
    const app = makeSubmitApp(store);
    const post = (address: string) => {
      peer.address = address;
      return app.request("/r/evt", { method: "POST", headers: sameOrigin, body: "{}" });
    };

    // Every request comes from a different address inside 2001:db8:1:2::/64.
    for (let i = 0; i < SUBMIT_MAX; i++) {
      expect((await post(`2001:db8:1:2:${i.toString(16)}::1`)).status).toBe(200);
    }
    expect((await post("2001:db8:1:2:ffff::9")).status).toBe(429);
    // The neighbouring /64 and an IPv4 client have their own budget.
    expect((await post("2001:db8:1:3::1")).status).toBe(200);
    expect((await post("198.51.100.7")).status).toBe(200);
  });

  it("never puts the slug in a key: unknown slugs create no per-event bucket", async () => {
    const store = new InMemoryRateLimitStore();
    const hit = vi.spyOn(store, "hit");
    const app = makeSubmitApp(store);

    for (let i = 0; i < 25; i++) {
      await app.request(`/r/no-such-event-${i}`, { method: "POST", headers: sameOrigin, body: "{}" });
    }

    const keys = new Set(hit.mock.calls.map(([key]) => key));
    expect([...keys]).toEqual(["registration:submit:ip:203.0.113.10"]);
  });

  it("is silent when exceeded for page, submit and confirm, but audits the password limit", async () => {
    for (const name of ["registration:page", "registration:submit", "registration:confirm"] as const) {
      expect(RATE_POLICIES[name].checks[0]).not.toHaveProperty("logOnExceeded");
    }
    expect(RATE_POLICIES["registration:password"].checks[0]).toMatchObject({
      logOnExceeded: { scope: "registration", keyHint: "password" },
    });

    const store = new InMemoryRateLimitStore();
    const app = new Hono();
    app.post("/quiet", rateLimit(store, "registration:submit"), (c) => c.body(null, 200));
    app.post("/pw", rateLimit(store, "registration:password"), (c) => c.body(null, 200));

    for (let i = 0; i < SUBMIT_MAX + 5; i++) await app.request("/quiet", { method: "POST" });
    expect(querySystemLogs({ source: "security" })).toHaveLength(0);

    const passwordMax = RATE_POLICIES["registration:password"].checks[0]!.max;
    for (let i = 0; i < passwordMax + 1; i++) await app.request("/pw", { method: "POST" });
    const entries = querySystemLogs({ source: "security" });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.message).toBe("auth.rate_limit.exceeded");
  });

  it("can be retuned with RATE_LIMIT_OVERRIDES, like the other limits", () => {
    const policies = structuredClone({
      "registration:submit": { checks: RATE_POLICIES["registration:submit"].checks.map(({ windowMs, max }) => ({ windowMs, max })) },
    });
    const inline = structuredClone({ "registration:event": { ...INLINE_RATE_LIMITS["registration:event"] } });
    applyRateLimitOverrides(policies, inline, {
      RATE_LIMIT_OVERRIDES: '{"registration:submit":{"max":30},"registration:event":{"max":50}}',
    });
    expect(policies["registration:submit"].checks[0]?.max).toBe(30);
    expect(inline["registration:event"].max).toBe(50);
  });
});

describe("POST /r/:slug guard order and body cap", () => {
  it("answers a cross-site POST with 403 before it can use up the IP budget", async () => {
    const store = new InMemoryRateLimitStore();
    const hit = vi.spyOn(store, "hit");
    const app = makeSubmitApp(store);

    const res = await app.request("/r/evt", {
      method: "POST",
      headers: { Origin: "https://evil.example", "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(403);
    expect(hit).not.toHaveBeenCalled();
  });

  it("rejects a declared oversize body with 413", async () => {
    const app = makeSubmitApp(new InMemoryRateLimitStore());
    const res = await app.request("/r/evt", { method: "POST", headers: sameOrigin, body: oversized() });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "request too large" });
  });

  it("rejects a chunked oversize body with no Content-Length with 413", async () => {
    const app = makeSubmitApp(new InMemoryRateLimitStore());
    const res = await app.request("/r/evt", chunkedInit(oversized(), sameOrigin));
    expect(res.status).toBe(413);
  });

  it("still reads an ordinary body", async () => {
    const app = makeSubmitApp(new InMemoryRateLimitStore());
    const res = await app.request("/r/evt", {
      method: "POST",
      headers: sameOrigin,
      body: JSON.stringify({ email: "guest@example.com" }),
    });
    expect(res.status).toBe(200);
  });

  it("counts oversized requests in the IP limiter, so the cap cannot be used to dodge it", async () => {
    const app = makeSubmitApp(new InMemoryRateLimitStore());
    const body = oversized();
    for (let i = 0; i < SUBMIT_MAX; i++) {
      expect((await app.request("/r/evt", { method: "POST", headers: sameOrigin, body })).status).toBe(413);
    }
    const res = await app.request("/r/evt", { method: "POST", headers: sameOrigin, body });
    expect(res.status).toBe(429);
  });
});

describe("per-event ceiling and per-address mail limit", () => {
  it("keys the event ceiling by event id and gives each event its own budget", async () => {
    const store = new InMemoryRateLimitStore();
    const hit = vi.spyOn(store, "hit");
    const { max } = INLINE_RATE_LIMITS["registration:event"];

    for (let i = 0; i < max; i++) expect(await checkRegistrationEventRateLimit(store, "evt-a")).toBe(true);
    expect(await checkRegistrationEventRateLimit(store, "evt-a")).toBe(false);
    expect(await checkRegistrationEventRateLimit(store, "evt-b")).toBe(true);
    expect(hit.mock.calls[0]?.[0]).toBe("registration:event:evt-a");
    expect(querySystemLogs({ source: "security" })).toHaveLength(0);
  });

  it("allows three mails per address per day, whatever the case, and never stores the address", async () => {
    const store = new InMemoryRateLimitStore();
    const hit = vi.spyOn(store, "hit");

    expect(await checkRegistrationMailRecipientRateLimit(store, "Guest@Example.com")).toBe(true);
    expect(await checkRegistrationMailRecipientRateLimit(store, "guest@example.com")).toBe(true);
    expect(await checkRegistrationMailRecipientRateLimit(store, " GUEST@example.com ")).toBe(true);
    expect(await checkRegistrationMailRecipientRateLimit(store, "guest@example.com")).toBe(false);
    expect(await checkRegistrationMailRecipientRateLimit(store, "other@example.com")).toBe(true);

    for (const [key, windowMs, max] of hit.mock.calls) {
      expect(key).toMatch(/^registration:mail-recipient:[0-9a-f]{64}$/);
      expect(key).not.toContain("example.com");
      expect([windowMs, max]).toEqual([86_400_000, 3]);
    }
  });

  it("does not share its tag with the admin test-send limit for the same address", async () => {
    const store = new InMemoryRateLimitStore();
    const hit = vi.spyOn(store, "hit");
    await checkRegistrationMailRecipientRateLimit(store, "guest@example.com");
    const { checkMailTestRecipientRateLimit } = await import("../src/rate-limit/policies.js");
    await checkMailTestRecipientRateLimit(store, "guest@example.com", undefined);
    const [a, b] = hit.mock.calls.map(([key]) => key.split(":").pop());
    expect(a).not.toBe(b);
  });
});

describe("Redis unreachable (127.0.0.1:1)", () => {
  it("neither fails open nor closed: the submit limit keeps applying per process", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = new RedisRateLimitStore("redis://127.0.0.1:1", { connectTimeoutMs: 200 });
    const app = makeSubmitApp(store);

    for (let i = 0; i < SUBMIT_MAX; i++) {
      expect((await app.request("/r/evt", { method: "POST", headers: sameOrigin, body: "{}" })).status).toBe(200);
    }
    expect((await app.request("/r/evt", { method: "POST", headers: sameOrigin, body: "{}" })).status).toBe(429);

    await store.disconnect();
  });
});
