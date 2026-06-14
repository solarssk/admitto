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
import { resolveBaseUrl, resolveCheckinToken, resolveAllowCheckinBearer, validateCheckinBootConfig } from "./config.js";
import {
  createCheckinPreAuth,
  createCheckinEventScope,
  parseScanBodyMiddleware,
  eventIdFromScanBody,
  eventIdFromHistoryQuery,
  type CheckinGateConfig,
} from "./checkin-gate.js";
import { findAttendeeForEventRoute } from "./attendee-lookup.js";
import {
  createRateLimitStore,
  createPublicRateLimitMiddleware,
  type RateLimitStore,
} from "./rate-limit/index.js";
import { createRequireSession } from "./auth-middleware.js";
import { createLoginRateLimitMiddleware } from "./auth/login-rate-limit.js";
import { createCheckinRateLimitMiddleware } from "./checkin-rate-limit.js";
import { handleLogin, handleLogout, handleMe } from "./auth/routes.js";
import {
  handleGetLogin,
  handlePostLogin,
  handleGetOperator,
  handlePostLogout,
} from "./auth/html-routes.js";

/** Injectable dependencies for `createApp()` (tests and custom deploy wiring). */
export interface CreateAppOptions {
  prisma?: PrismaClient;
  baseUrl?: string;
  checkinToken?: string | null;
  allowCheckinBearer?: boolean;
  skipCheckinBootValidation?: boolean;
  rateLimitStore?: RateLimitStore;
}

/** Build the Admitto Hono app (public tickets, auth, check-in API, operator HTML). */
export function createApp(options: CreateAppOptions = {}) {
  const db = options.prisma ?? defaultPrisma;
  const baseUrl = options.baseUrl ?? resolveBaseUrl();
  const allowCheckinBearer =
    options.allowCheckinBearer !== undefined
      ? options.allowCheckinBearer
      : resolveAllowCheckinBearer();
  const checkinToken =
    options.checkinToken !== undefined ? options.checkinToken : resolveCheckinToken();

  if (!options.skipCheckinBootValidation) {
    validateCheckinBootConfig({
      ...process.env,
      ALLOW_CHECKIN_BEARER: allowCheckinBearer ? "true" : "",
      CHECKIN_OPERATOR_TOKEN: checkinToken ?? "",
    });
  }

  const checkinGateConfig: CheckinGateConfig = {
    allowBearer: allowCheckinBearer,
    operatorToken: checkinToken,
  };
  const checkinAuthDeps = { prisma: db, config: checkinGateConfig };

  const app = new Hono();
  const ticketPageHeaders = getTicketPageSecurityHeaders();
  const rateLimitStore = options.rateLimitStore ?? createRateLimitStore();
  const publicRateLimit = createPublicRateLimitMiddleware(rateLimitStore);
  const loginRateLimit = createLoginRateLimitMiddleware(rateLimitStore);
  const checkinRateLimit = createCheckinRateLimitMiddleware(rateLimitStore);
  const requireSession = createRequireSession(db);
  const requireSessionHtml = createRequireSession(db, { redirectTo: "/login" });

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

  app.post("/api/auth/login", loginRateLimit, (c) => handleLogin(c, db, rateLimitStore));
  app.post("/api/auth/logout", (c) => handleLogout(c, db));
  app.get("/api/auth/me", requireSession, (c) => handleMe(c, db));

  app.get("/login", (c) => handleGetLogin(c));
  app.post("/login", loginRateLimit, (c) => handlePostLogin(c, db, rateLimitStore));
  app.get("/operator", requireSessionHtml, (c) => handleGetOperator(c, db));
  app.post("/logout", (c) => handlePostLogout(c, db));

  app.use("/t/*", publicRateLimit);
  app.use("/q/*", publicRateLimit);

  // Mode B ticket page — must be registered before /t/:token
  app.get("/t/:eventSlug/a/:ref", async (c) => {
    const { eventSlug, ref } = c.req.param();
    let resolved;
    try {
      resolved = await findAttendeeForEventRoute(eventSlug, ref, db);
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

  // Mode B hosted QR — filename param is "{public_ref}.png"
  app.get("/q/:eventSlug/a/:filename", async (c) => {
    const { eventSlug, filename } = c.req.param();
    if (!filename.endsWith(".png")) {
      return c.body(null, 404);
    }
    const publicRef = filename.slice(0, -4);
    let resolved;
    try {
      resolved = await findAttendeeForEventRoute(eventSlug, publicRef, db);
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

  app.use("/api/checkin/*", checkinRateLimit);

  app.post(
    "/api/checkin/scan",
    createCheckinPreAuth(checkinAuthDeps),
    parseScanBodyMiddleware,
    createCheckinEventScope(checkinAuthDeps, eventIdFromScanBody),
    async (c) => {
      const body = c.get("parsedScanBody");
      const { scanned: rawScanned, eventId, deviceId } = body;
      const scanned = typeof rawScanned === "string" ? rawScanned.trim() : "";
      if (!scanned) return c.json({ error: "scanned required" }, 400);
      if (typeof eventId !== "string" || !eventId) {
        return c.json({ error: "eventId required" }, 400);
      }

      try {
        const operatorUserId = c.get("operatorUserId") as string | undefined;
        const result = await checkInScan(
          {
            scanned,
            eventId,
            deviceId: typeof deviceId === "string" ? deviceId : undefined,
            operator: operatorUserId,
          },
          db,
        );
        return c.json(result, 200);
      } catch (err) {
        console.error("checkInScan failed:", err);
        return c.json({ error: "server error" }, 500);
      }
    },
  );

  app.get(
    "/api/checkin/history",
    createCheckinPreAuth(checkinAuthDeps),
    createCheckinEventScope(checkinAuthDeps, eventIdFromHistoryQuery),
    async (c) => {
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
    },
  );

  return app;
}
