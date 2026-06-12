import { Hono, type Context } from "hono";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@admitto/db";
import type { AttendeeStatus } from "@admitto/db";
import { recordTicketViewed } from "@admitto/mail-delivery";
import {
  resolveTicket,
  generateQrPng,
  buildQrPayload,
  checkInScan,
  getRecentCheckIns,
  isAdmittable,
  hashToken,
} from "@admitto/tickets";
import {
  getTicketPageSecurityHeaders,
  renderTicket,
  renderNotFound,
  renderRevoked,
  renderServerError,
} from "./ticket-page.js";
import { resolveBaseUrl, resolveCheckinToken } from "./config.js";
import { createCheckinGate } from "./checkin-gate.js";
import { findAttendeeForEventRoute } from "./attendee-lookup.js";
import { checkRateLimit, clientIpFromHeaders } from "./rate-limit.js";

export interface CreateAppOptions {
  prisma?: PrismaClient;
  baseUrl?: string;
  checkinToken?: string | null;
}

export function createApp(options: CreateAppOptions = {}) {
  const db = options.prisma ?? defaultPrisma;
  const baseUrl = options.baseUrl ?? resolveBaseUrl();
  const checkinToken = options.checkinToken ?? resolveCheckinToken();

  const app = new Hono();
  const ticketPageHeaders = getTicketPageSecurityHeaders();

  function publicRateLimit(c: Context): boolean {
    const ip = clientIpFromHeaders(c.req.header("x-forwarded-for"));
    return checkRateLimit(ip);
  }

  function htmlWithSecurityHeaders(c: Context, html: string, status: 200 | 404 | 410 | 500) {
    for (const [name, value] of Object.entries(ticketPageHeaders)) {
      c.header(name, value);
    }
    return c.html(html, status);
  }

  async function renderTicketPage(
    c: Context,
    resolved: NonNullable<Awaited<ReturnType<typeof resolveTicket>>>,
    internalToken?: string,
  ) {
    const { attendee, event } = resolved;

    if (!isAdmittable(attendee.status as AttendeeStatus)) {
      const reason: "revoked" | "cancelled" =
        attendee.status === "cancelled" ? "cancelled" : "revoked";
      return htmlWithSecurityHeaders(c, renderRevoked(attendee.name, event.title, reason), 410);
    }

    let qrPayload: string;
    if (resolved.mode === "internal") {
      if (!internalToken) {
        console.error(`Internal attendee ${attendee.id} missing token for ticket page QR`);
        return htmlWithSecurityHeaders(c, renderServerError(), 500);
      }
      qrPayload = buildQrPayload("internal", { baseUrl, token: internalToken });
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

    try {
      await recordTicketViewed(attendee.id, event.id, db);
    } catch (err) {
      console.error("recordTicketViewed failed:", err);
    }

    return htmlWithSecurityHeaders(c, renderTicket(resolved, qrDataUrl), 200);
  }

  app.use("/api/checkin/*", createCheckinGate(checkinToken));

  app.use("/t/*", async (c, next) => {
    if (!publicRateLimit(c)) return c.text("Too Many Requests", 429);
    await next();
  });
  app.use("/q/*", async (c, next) => {
    if (!publicRateLimit(c)) return c.text("Too Many Requests", 429);
    await next();
  });

  // Mode B ticket page — must be registered before /t/:token
  app.get("/t/:eventSlug/a/:attendeeId", async (c) => {
    const { eventSlug, attendeeId } = c.req.param();
    let resolved;
    try {
      resolved = await findAttendeeForEventRoute(eventSlug, attendeeId, db);
    } catch (err) {
      console.error("findAttendeeForEventRoute error:", err);
      return htmlWithSecurityHeaders(c, renderServerError(), 500);
    }
    if (!resolved || resolved.mode !== "agency") {
      return htmlWithSecurityHeaders(c, renderNotFound(), 404);
    }
    return renderTicketPage(c, resolved);
  });

  // Mode A ticket page
  app.get("/t/:token", async (c) => {
    const token = c.req.param("token");

    let resolved;
    try {
      resolved = await resolveTicket(token, db);
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

    return renderTicketPage(c, resolved, token);
  });

  // Mode B hosted QR — filename param is "{attendeeId}.png"
  app.get("/q/:eventSlug/a/:filename", async (c) => {
    const { eventSlug, filename } = c.req.param();
    if (!filename.endsWith(".png")) {
      return c.body(null, 404);
    }
    const attendeeId = filename.slice(0, -4);
    let resolved;
    try {
      resolved = await findAttendeeForEventRoute(eventSlug, attendeeId, db);
    } catch (err) {
      console.error("findAttendeeForEventRoute error:", err);
      return c.body(null, 500);
    }
    if (!resolved || resolved.mode !== "agency") {
      return c.body(null, 404);
    }
    const agencyPayload = resolved.attendee.qr_payload ?? resolved.attendee.external_uuid;
    if (!agencyPayload) {
      return c.body(null, 404);
    }
    try {
      const png = await generateQrPng(buildQrPayload("agency", { agencyPayload }));
      c.header("Content-Type", "image/png");
      c.header("Cache-Control", "public, max-age=86400");
      return c.body(new Uint8Array(png), 200);
    } catch {
      return c.body(null, 500);
    }
  });

  // Mode A hosted QR — filename param is "{token}.png"
  app.get("/q/:filename", async (c) => {
    const filename = c.req.param("filename");
    if (!filename.endsWith(".png")) {
      return c.body(null, 404);
    }
    const token = filename.slice(0, -4);
    const tokenHash = hashToken(token);
    let attendee;
    try {
      attendee = await db.attendee.findUnique({
        where: { token_hash: tokenHash },
        include: { event: true },
      });
    } catch (err) {
      console.error("attendee lookup error:", err);
      return c.body(null, 500);
    }
    if (!attendee) {
      return c.body(null, 404);
    }
    try {
      const png = await generateQrPng(
        buildQrPayload("internal", { baseUrl, token }),
      );
      c.header("Content-Type", "image/png");
      c.header("Cache-Control", "public, max-age=86400");
      return c.body(new Uint8Array(png), 200);
    } catch {
      return c.body(null, 500);
    }
  });

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
        db,
      );
      return c.json(result, 200);
    } catch (err) {
      console.error("checkInScan failed:", err);
      return c.json({ error: "server error" }, 500);
    }
  });

  app.get("/api/checkin/history", async (c) => {
    const eventId = c.req.query("eventId");
    if (!eventId) return c.json({ error: "eventId required" }, 400);
    const limitParam = parseInt(c.req.query("limit") ?? "10", 10);
    const limit = Number.isFinite(limitParam) ? limitParam : 10;
    try {
      const history = await getRecentCheckIns(eventId, db, limit);
      return c.json(history, 200);
    } catch (err) {
      console.error("getRecentCheckIns failed:", err);
      return c.json({ error: "server error" }, 500);
    }
  });

  return app;
}
