import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@admitto/db";
import { createApp } from "../src/app.js";
import { MAX_CHECKIN_BODY_BYTES } from "../src/checkin-gate.js";
import { MAX_OPS_LOG_BODY_BYTES } from "../src/ops/system-log-ingest.js";
import { InMemoryRateLimitStore } from "../src/rate-limit/index.js";

const CHECKIN_TOKEN = "wiring-checkin-bearer-token-32ch!!";
const OPS_TOKEN = "wiring-ops-health-token-32-chars!!";

const CHECKIN_POST_ROUTES = [
  "/api/checkin/scan",
  "/api/checkin/lookup",
  "/api/checkin/admit",
  "/api/checkin/items/swag",
  "/api/checkin/notes",
  "/api/checkin/undo",
];

function makeApp() {
  // Only the check-in and ops gates run in these cases. An unauthorized request makes the gate
  // look up an (absent) session or provider setting, so any model answers "nothing found".
  const model = new Proxy({}, { get: () => vi.fn(async () => null) });
  const prisma = new Proxy(
    { $queryRaw: vi.fn(async () => [{ "?column?": 1 }]) },
    { get: (target, prop) => (prop in target ? target[prop as keyof typeof target] : model) },
  ) as unknown as PrismaClient;
  return createApp({
    prisma,
    baseUrl: "https://tickets.example.com",
    skipCheckinBootValidation: true,
    rateLimitStore: new InMemoryRateLimitStore(),
    allowCheckinBearer: true,
    checkinToken: CHECKIN_TOKEN,
    opsHealthToken: OPS_TOKEN,
  });
}

/** A JSON body of at least `bytes` bytes. */
function jsonOfSize(bytes: number): string {
  return JSON.stringify({ eventId: "evt-wiring", pad: "x".repeat(bytes) });
}

/** The same body, but sent chunked with no Content-Length, so only the running count can stop it. */
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

describe("check-in POST body cap", () => {
  const headers = {
    Authorization: `Bearer ${CHECKIN_TOKEN}`,
    "Content-Type": "application/json",
    "X-Forwarded-For": "203.0.113.90",
  };

  it.each(CHECKIN_POST_ROUTES)("%s rejects a declared oversize body with 413", async (route) => {
    const app = makeApp();
    const res = await app.request(route, {
      method: "POST",
      headers,
      body: jsonOfSize(MAX_CHECKIN_BODY_BYTES),
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "request too large" });
  });

  it.each(CHECKIN_POST_ROUTES)("%s rejects a chunked oversize body with 413", async (route) => {
    const app = makeApp();
    const res = await app.request(route, chunkedInit(jsonOfSize(MAX_CHECKIN_BODY_BYTES), headers));
    expect(res.status).toBe(413);
  });

  it.each(CHECKIN_POST_ROUTES)("%s still reads an ordinary small body", async (route) => {
    const app = makeApp();
    const res = await app.request(route, {
      method: "POST",
      headers,
      body: JSON.stringify({ eventId: "evt-wiring", scanned: "qr", attendeeId: "a1", body: "n" }),
    });
    expect(res.status).not.toBe(413);
    // Past the JSON step: a field-level 400 is fine, "invalid JSON" is not.
    const text = await res.text();
    expect(text).not.toContain("invalid JSON");
  });

  it("accepts a note-sized body just under the cap", async () => {
    const app = makeApp();
    const res = await app.request("/api/checkin/notes", {
      method: "POST",
      headers,
      body: JSON.stringify({ eventId: "evt-wiring", attendeeId: "a1", body: "é".repeat(2000) }),
    });
    expect(res.status).not.toBe(413);
  });

  it.each(CHECKIN_POST_ROUTES)(
    "%s answers an unauthorized oversize request with the gate's status, not 413",
    async (route) => {
      const app = makeApp();
      const res = await app.request(route, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Forwarded-For": "203.0.113.91" },
        body: jsonOfSize(MAX_CHECKIN_BODY_BYTES),
      });
      expect([401, 403]).toContain(res.status);
    },
  );
});

describe("ops system-log ingest body cap", () => {
  const good = {
    Authorization: `Bearer ${OPS_TOKEN}`,
    "Content-Type": "application/json",
    "X-Forwarded-For": "203.0.113.92",
  };

  it("rejects a declared oversize body from the ops token with 413", async () => {
    const app = makeApp();
    const res = await app.request("/api/ops/system-logs", {
      method: "POST",
      headers: good,
      body: jsonOfSize(MAX_OPS_LOG_BODY_BYTES),
    });
    expect(res.status).toBe(413);
  });

  it("rejects a chunked oversize body from the ops token with 413", async () => {
    const app = makeApp();
    const res = await app.request(
      "/api/ops/system-logs",
      chunkedInit(jsonOfSize(MAX_OPS_LOG_BODY_BYTES), good),
    );
    expect(res.status).toBe(413);
  });

  it("answers a wrong token with 401 before reading an oversize body", async () => {
    const app = makeApp();
    const res = await app.request("/api/ops/system-logs", {
      method: "POST",
      headers: { ...good, Authorization: "Bearer wrong-token-wrong-token-wrong-tok" },
      body: jsonOfSize(MAX_OPS_LOG_BODY_BYTES),
    });
    expect(res.status).toBe(401);
  });

  it("accepts an ordinary entry", async () => {
    const app = makeApp();
    const res = await app.request("/api/ops/system-logs", {
      method: "POST",
      headers: good,
      body: JSON.stringify({ source: "mail", level: "info", message: "mail_bounce_ingest_ok" }),
    });
    expect(res.status).toBe(200);
  });
});
