import { serve } from "@hono/node-server";
import { Hono, type Context } from "hono";
import { Prisma } from "@prisma/client";
import { prisma } from "@admitto/db";
import { resolveTicket, generateQrPng, buildQrPayload, checkInScan, getRecentCheckIns } from "@admitto/tickets";
import {
  getTicketPageSecurityHeaders,
  renderTicket,
  renderNotFound,
  renderRevoked,
  renderServerError,
} from "./ticket-page.js";
import { resolveBaseUrl } from "./config.js";

// Fail-fast in production: BASE_URL must be set explicitly.
// In non-production environments the localhost fallback is acceptable.
const baseUrl = resolveBaseUrl();

const app = new Hono();
const ticketPageHeaders = getTicketPageSecurityHeaders();

function htmlWithSecurityHeaders(c: Context, html: string, status: 200 | 404 | 410 | 500) {
  for (const [name, value] of Object.entries(ticketPageHeaders)) {
    c.header(name, value);
  }
  return c.html(html, status);
}

app.get("/t/:token", async (c) => {
  const token = c.req.param("token");

  let resolved;
  try {
    resolved = await resolveTicket(token, prisma);
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientInitializationError ||
      err instanceof Prisma.PrismaClientKnownRequestError ||
      err instanceof Prisma.PrismaClientUnknownRequestError
    ) {
      console.error("resolveTicket database error:", err);
    } else {
      console.error("resolveTicket unexpected error:", err);
    }
    return htmlWithSecurityHeaders(c, renderServerError(), 500);
  }

  if (!resolved) {
    return htmlWithSecurityHeaders(c, renderNotFound(), 404);
  }

  const { attendee, event } = resolved;

  if (attendee.status === "revoked" || attendee.status === "cancelled") {
    return htmlWithSecurityHeaders(c, renderRevoked(attendee.name, event.title, attendee.status), 410);
  }

  let qrPayload: string;
  if (resolved.mode === "internal") {
    qrPayload = buildQrPayload("internal", { baseUrl, token });
  } else {
    const agencyPayload = attendee.qr_payload ?? attendee.external_uuid;
    if (!agencyPayload) {
      console.error(`Agency attendee ${attendee.id} has neither qr_payload nor external_uuid`);
      return htmlWithSecurityHeaders(c, renderServerError(), 500);
    }
    qrPayload = buildQrPayload("agency", { agencyPayload });
  }

  let qrDataUrl: string;
  try {
    const qrPng = await generateQrPng(qrPayload);
    qrDataUrl = `data:image/png;base64,${qrPng.toString("base64")}`;
  } catch (err) {
    console.error("generateQrPng failed:", err);
    return htmlWithSecurityHeaders(c, renderServerError(), 500);
  }

  return htmlWithSecurityHeaders(c, renderTicket(resolved, qrDataUrl), 200);
});

// POST /api/checkin/scan — validate a scanned QR/token for a given event
// Body: { scanned: string, eventId: string, deviceId?: string }
// Returns domain result: VALID / ALREADY_CHECKED_IN / REVOKED / INVALID (all 200)
// 400 = malformed input, 500 = server/runtime failure
app.post("/api/checkin/scan", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON" }, 400);
  }
  if (!body || typeof body !== "object") return c.json({ error: "body required" }, 400);
  const { scanned, eventId, deviceId } = body as Record<string, unknown>;
  if (typeof scanned !== "string" || !scanned) return c.json({ error: "scanned required" }, 400);
  if (typeof eventId !== "string" || !eventId) return c.json({ error: "eventId required" }, 400);

  try {
    const result = await checkInScan(
      { scanned, eventId, deviceId: typeof deviceId === "string" ? deviceId : undefined },
      prisma,
    );
    return c.json(result, 200);
  } catch (err) {
    console.error("checkInScan failed:", err);
    return c.json({ error: "server error" }, 500);
  }
});

// GET /api/checkin/history?eventId=...&limit=10 — recent scans for operator view
// No PII (email excluded), hard cap 50
app.get("/api/checkin/history", async (c) => {
  const eventId = c.req.query("eventId");
  if (!eventId) return c.json({ error: "eventId required" }, 400);
  const limitParam = parseInt(c.req.query("limit") ?? "10", 10);
  const limit = Number.isFinite(limitParam) ? limitParam : 10;
  try {
    const history = await getRecentCheckIns(eventId, prisma, limit);
    return c.json(history, 200);
  } catch (err) {
    console.error("getRecentCheckIns failed:", err);
    return c.json({ error: "server error" }, 500);
  }
});

const port = parseInt(process.env["PORT"] ?? "3000", 10);
serve({ fetch: app.fetch, port }, () => {
  console.log(`Admitto web running at http://localhost:${port}`);
});
