/**
 * Thin HTTP contract tests for POST /api/checkin/scan and GET /api/checkin/history.
 *
 * These tests cover the Hono route layer (JSON parsing, field validation, trim on scanned)
 * without a real DB. Domain logic is covered in packages/tickets; auth gate is covered in
 * checkin-gate.test.ts. The app is assembled inline to avoid importing index.ts (which starts
 * a server and makes module-level env calls).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { PrismaClient } from "@prisma/client";

vi.mock("@admitto/tickets", () => ({
  checkInScan: vi.fn(),
  getRecentCheckIns: vi.fn(),
  isAdmittable: vi.fn().mockReturnValue(true),
  resolveTicket: vi.fn(),
  generateQrPng: vi.fn(),
  buildQrPayload: vi.fn(),
  buildTicketUrl: vi.fn(),
  generateToken: vi.fn(),
  hashToken: vi.fn(),
  issueTicket: vi.fn(),
  issueTicketsForEvent: vi.fn(),
}));

import { checkInScan, getRecentCheckIns } from "@admitto/tickets";

function makeApp() {
  const app = new Hono();

  app.post("/api/checkin/scan", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON" }, 400);
    }
    if (!body || typeof body !== "object") return c.json({ error: "body required" }, 400);
    const { scanned: rawScanned, eventId, deviceId } = body as Record<string, unknown>;
    const scanned = typeof rawScanned === "string" ? rawScanned.trim() : "";
    if (!scanned) return c.json({ error: "scanned required" }, 400);
    if (typeof eventId !== "string" || !eventId) return c.json({ error: "eventId required" }, 400);
    try {
      const result = await checkInScan(
        { scanned, eventId, deviceId: typeof deviceId === "string" ? deviceId : undefined },
        {} as PrismaClient,
      );
      return c.json(result, 200);
    } catch {
      return c.json({ error: "server error" }, 500);
    }
  });

  app.get("/api/checkin/history", async (c) => {
    const eventId = c.req.query("eventId");
    if (!eventId) return c.json({ error: "eventId required" }, 400);
    const limitParam = parseInt(c.req.query("limit") ?? "10", 10);
    const limit = Number.isFinite(limitParam) ? limitParam : 10;
    try {
      const history = await getRecentCheckIns(eventId, {} as PrismaClient, limit);
      return c.json(history, 200);
    } catch {
      return c.json({ error: "server error" }, 500);
    }
  });

  return app;
}

const app = makeApp();

describe("POST /api/checkin/scan — input validation", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns 400 for invalid JSON body", async () => {
    const res = await app.request("/api/checkin/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json{{{",
    });
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toBe("invalid JSON");
  });

  it("returns 400 when scanned is missing", async () => {
    const res = await app.request("/api/checkin/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId: "evt-1" }),
    });
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toBe("scanned required");
  });

  it("returns 400 for whitespace-only scanned (trim applied)", async () => {
    const res = await app.request("/api/checkin/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scanned: "   ", eventId: "evt-1" }),
    });
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toBe("scanned required");
  });

  it("returns 400 when eventId is missing", async () => {
    const res = await app.request("/api/checkin/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scanned: "TOKEN-ABC" }),
    });
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toBe("eventId required");
  });

  it("returns 200 with domain result for valid input", async () => {
    vi.mocked(checkInScan).mockResolvedValueOnce({ status: "VALID", attendee: { name: "Ada", ticket_type: null }, admittedAt: new Date() });
    const res = await app.request("/api/checkin/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scanned: "TOKEN-ABC", eventId: "evt-1" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json() as { status: string };
    expect(json.status).toBe("VALID");
  });

  it("strips leading/trailing whitespace from scanned before passing to domain", async () => {
    vi.mocked(checkInScan).mockResolvedValueOnce({ status: "VALID", attendee: { name: "Ada", ticket_type: null }, admittedAt: new Date() });
    await app.request("/api/checkin/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scanned: "  TOKEN-ABC  ", eventId: "evt-1" }),
    });
    expect(vi.mocked(checkInScan)).toHaveBeenCalledWith(
      expect.objectContaining({ scanned: "TOKEN-ABC" }),
      expect.anything(),
    );
  });

  it("returns 500 when domain function throws", async () => {
    vi.mocked(checkInScan).mockRejectedValueOnce(new Error("DB error"));
    const res = await app.request("/api/checkin/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scanned: "TOKEN-ABC", eventId: "evt-1" }),
    });
    expect(res.status).toBe(500);
    const json = await res.json() as { error: string };
    expect(json.error).toBe("server error");
  });
});

describe("GET /api/checkin/history — input validation", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns 400 when eventId query param is missing", async () => {
    const res = await app.request("/api/checkin/history");
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toBe("eventId required");
  });

  it("returns 200 with mocked history for valid eventId", async () => {
    vi.mocked(getRecentCheckIns).mockResolvedValueOnce([]);
    const res = await app.request("/api/checkin/history?eventId=evt-1");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json)).toBe(true);
    expect(vi.mocked(getRecentCheckIns)).toHaveBeenCalledWith("evt-1", expect.anything(), 10);
  });

  it("falls back to limit 10 when limit query param is non-numeric", async () => {
    vi.mocked(getRecentCheckIns).mockResolvedValueOnce([]);
    const res = await app.request("/api/checkin/history?eventId=evt-1&limit=not-a-number");
    expect(res.status).toBe(200);
    expect(vi.mocked(getRecentCheckIns)).toHaveBeenCalledWith("evt-1", expect.anything(), 10);
  });

  it("passes negative limit through to domain (clamped in getRecentCheckIns)", async () => {
    vi.mocked(getRecentCheckIns).mockResolvedValueOnce([]);
    const res = await app.request("/api/checkin/history?eventId=evt-1&limit=-5");
    expect(res.status).toBe(200);
    expect(vi.mocked(getRecentCheckIns)).toHaveBeenCalledWith("evt-1", expect.anything(), -5);
  });

  it("passes large limit through to domain (clamped in getRecentCheckIns)", async () => {
    vi.mocked(getRecentCheckIns).mockResolvedValueOnce([]);
    const res = await app.request("/api/checkin/history?eventId=evt-1&limit=999");
    expect(res.status).toBe(200);
    expect(vi.mocked(getRecentCheckIns)).toHaveBeenCalledWith("evt-1", expect.anything(), 999);
  });
});
