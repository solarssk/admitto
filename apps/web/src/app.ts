import { Hono, type Context } from "hono";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@admitto/db";
import type { AttendeeStatus } from "@admitto/db";
import { recordTicketViewed } from "@admitto/mail-delivery";
import type { MailDeliveryDeps } from "@admitto/mail-delivery";
import { getBrandingTheme } from "@admitto/auth";
import {
  resolveTicket,
  generateQrPng,
  buildQrPayload,
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
import { resolveBaseUrl, resolveCheckinToken, resolveAllowCheckinBearer, validateCheckinBootConfig, validateCfAccessBootConfig } from "./config.js";
import {
  createCheckinPreAuth,
  createCheckinSessionCsrfGuard,
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
import { createRequireSession, createRequirePartialSession } from "./auth-middleware.js";
import { createLoginRateLimitMiddleware } from "./auth/login-rate-limit.js";
import { createOidcAuthRateLimitMiddleware } from "./auth/oidc-rate-limit.js";
import { createCrossSitePostGuard } from "./auth/same-origin-post.js";
import { createCheckinAuthenticatedRateLimit } from "./checkin-rate-limit.js";
import { createAdminResendRateLimit } from "./admin-resend-rate-limit.js";
import { handleLogin, handleLogout, handleMe, handleMfaVerify, handleTotpEnroll, handleTotpConfirm } from "./auth/routes.js";
import {
  handleGetMfaEnroll,
  handleGetMfaVerify,
  handlePostMfaEnroll,
  handlePostMfaEnrollStart,
  handlePostMfaVerify,
} from "./auth/mfa-html-routes.js";
import {
  handleGetLogin,
  handlePostLogin,
  handlePostLogout,
} from "./auth/html-routes.js";
import { handleOidcStart, handleOidcCallback } from "./auth/oidc-routes.js";
import { handleGetOidcLink, handlePostOidcLink } from "./auth/oidc-link-routes.js";
import { createAdminAccessMiddleware } from "./auth/admin-access-middleware.js";
import { createStaffAdminGate } from "./auth/staff-admin-gate.js";
import { createCheckInPanelCapabilityGuard } from "./auth/checkin-panel-gate.js";
import { handleGetAdminEvents } from "./admin/admin-api-routes.js";
import {
  handleListEventAttendees,
  handleGetEventAttendee,
  handlePatchEventAttendee,
  handleResendEventAttendeeTicket,
} from "./admin/attendees-api-routes.js";
import { handleImportPreview, handleImportCommit } from "./admin/import-api-routes.js";
import {
  handleGetCheckinEvents,
  handleCheckinScan,
  handleCheckinLookup,
  handleGetAttendeeCard,
  handleCheckinAdmit,
  handleCheckinItemAction,
  handleCheckinNote,
  handleCheckinUndo,
  handleCheckinStats,
  handleCheckinHistory,
  eventIdFromCheckinBody,
} from "./admin/checkin-api-routes.js";
import { handleGetStaffTheme, handlePutStaffTheme } from "./admin/staff-api-routes.js";
import { createStaffSpaHandlers } from "./staff-spa.js";
import { sweepExpiredOidcAuthStates } from "@admitto/auth";
import {
  handleListProviders,
  handleGetNewProvider,
  handlePostNewProvider,
  handleGetEditProvider,
  handlePostEditProvider,
  handlePostDiscover,
  handlePostTestConnection,
} from "./admin/auth-providers-routes.js";
import {
  handleGetCfAccess,
  handlePostCfAccess,
  handlePostCfAccessTest,
} from "./admin/cf-access-routes.js";

/** Parse check-in history `limit` query param: default 10, clamped to 1–100. */
function parseCheckinHistoryLimit(raw: string | undefined): number {
  const limitParam = parseInt(raw ?? "10", 10);
  const parsed = Number.isFinite(limitParam) ? limitParam : 10;
  return Math.max(1, Math.min(parsed, 100));
}

/** Injectable dependencies for `createApp()` (tests and custom deploy wiring). */
export interface CreateAppOptions {
  prisma?: PrismaClient;
  baseUrl?: string;
  checkinToken?: string | null;
  allowCheckinBearer?: boolean;
  skipCheckinBootValidation?: boolean;
  rateLimitStore?: RateLimitStore;
  adminDistRoot?: string;
  mailDeliveryDeps?: MailDeliveryDeps;
}

/**
 * Liveness/readiness probe for Docker and reverse proxies.
 * Runs `SELECT 1` against Postgres; no auth; does not expose app version or secrets.
 */
async function handleHealthz(c: Context, db: PrismaClient) {
  try {
    await db.$queryRaw(Prisma.sql`SELECT 1`);
    return c.json({ status: "ok" }, 200);
  } catch {
    return c.json({ status: "unavailable" }, 503);
  }
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
  const mailDeliveryDeps = options.mailDeliveryDeps ?? {};

  const app = new Hono();
  const rateLimitStore = options.rateLimitStore ?? createRateLimitStore();
  const publicRateLimit = createPublicRateLimitMiddleware(rateLimitStore);
  const loginRateLimitJson = createLoginRateLimitMiddleware(rateLimitStore, { format: "json" });
  const loginRateLimitHtml = createLoginRateLimitMiddleware(rateLimitStore, { format: "text" });
  const oidcAuthRateLimit = createOidcAuthRateLimitMiddleware(rateLimitStore);
  const htmlPostCsrf = createCrossSitePostGuard({ format: "text" });
  const jsonPostCsrf = createCrossSitePostGuard({ format: "json" });
  const requireSession = createRequireSession(db);
  const requireSessionHtml = createRequireSession(db, { redirectTo: "/login" });
  const requirePartialSession = createRequirePartialSession(db);
  const requirePartialSessionHtml = createRequirePartialSession(db, { redirectTo: "/login" });
  const requireAdminAccess = createAdminAccessMiddleware(db);
  const staffAdminGate = createStaffAdminGate(db);
  const adminResendRateLimit = createAdminResendRateLimit(rateLimitStore);
  const checkInPanelGuard = createCheckInPanelCapabilityGuard(db);
  const staffSpa = createStaffSpaHandlers({ distRoot: options.adminDistRoot });

  void sweepExpiredOidcAuthStates(db).catch((err) => {
    console.error("OidcAuthState sweep failed:", err);
  });

  function htmlWithSecurityHeaders(
    c: Context,
    html: string,
    status: 200 | 404 | 410 | 500,
    theme?: Awaited<ReturnType<typeof getBrandingTheme>> | null,
  ) {
    for (const [name, value] of Object.entries(getTicketPageSecurityHeaders(theme))) {
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

    let theme;
    try {
      theme = await getBrandingTheme(db);
    } catch {
      theme = null;
    }

    return htmlWithSecurityHeaders(c, renderTicket(resolved, qrDataUrl, theme), 200, theme);
  }

  app.get("/healthz", (c) => handleHealthz(c, db));

  app.post("/api/auth/login", jsonPostCsrf, loginRateLimitJson, (c) =>
    handleLogin(c, db, rateLimitStore),
  );
  app.post("/api/auth/logout", jsonPostCsrf, (c) => handleLogout(c, db));
  app.get("/api/auth/me", requireSession, (c) => handleMe(c, db));

  app.get("/api/admin/me", staffAdminGate, (c) => handleMe(c, db));
  app.get("/api/admin/events", staffAdminGate, (c) => handleGetAdminEvents(c, db));
  app.get("/api/admin/events/:eventId/attendees", staffAdminGate, (c) =>
    handleListEventAttendees(c, db),
  );
  app.get("/api/admin/events/:eventId/attendees/:id", staffAdminGate, (c) =>
    handleGetEventAttendee(c, db),
  );
  app.patch("/api/admin/events/:eventId/attendees/:id", jsonPostCsrf, staffAdminGate, (c) =>
    handlePatchEventAttendee(c, db),
  );
  app.post(
    "/api/admin/events/:eventId/attendees/:id/resend",
    jsonPostCsrf,
    staffAdminGate,
    adminResendRateLimit,
    (c) => handleResendEventAttendeeTicket(c, db, mailDeliveryDeps),
  );
  app.post("/api/admin/events/:eventId/import/preview", jsonPostCsrf, staffAdminGate, (c) =>
    handleImportPreview(c, db),
  );
  app.post("/api/admin/events/:eventId/import/commit", jsonPostCsrf, staffAdminGate, (c) =>
    handleImportCommit(c, db),
  );
  app.get("/api/admin/theme", staffAdminGate, (c) => handleGetStaffTheme(c, db));
  app.put("/api/admin/theme", jsonPostCsrf, staffAdminGate, (c) => handlePutStaffTheme(c, db));

  app.get("/api/checkin/events", requireSession, (c) => handleGetCheckinEvents(c, db));
  app.get("/api/staff/theme", requireSession, (c) => handleGetStaffTheme(c, db));
  app.put("/api/staff/theme", jsonPostCsrf, requireSession, (c) => handlePutStaffTheme(c, db));

  app.post("/api/auth/mfa/verify", jsonPostCsrf, requirePartialSession, (c) =>
    handleMfaVerify(c, db, rateLimitStore),
  );
  app.post("/api/auth/mfa/totp/enroll", jsonPostCsrf, requirePartialSession, (c) =>
    handleTotpEnroll(c, db),
  );
  app.post("/api/auth/mfa/totp/confirm", jsonPostCsrf, requirePartialSession, (c) =>
    handleTotpConfirm(c, db, rateLimitStore),
  );

  app.get("/api/auth/oidc/:providerId/start", oidcAuthRateLimit, (c) => handleOidcStart(c, db, baseUrl));
  app.get("/api/auth/oidc/:providerId/callback", oidcAuthRateLimit, (c) => handleOidcCallback(c, db, baseUrl));

  app.get("/account/oidc/:providerId/link", requireSessionHtml, (c) => handleGetOidcLink(c, db));
  app.post("/account/oidc/:providerId/link", htmlPostCsrf, loginRateLimitHtml, requireSessionHtml, (c) =>
    handlePostOidcLink(c, db, baseUrl, rateLimitStore),
  );

  app.get("/", (c) => c.redirect("/login", 302));

  app.get("/admin/auth/providers", requireAdminAccess, (c) => handleListProviders(c, db));
  app.get("/admin/auth/providers/new", requireAdminAccess, (c) => handleGetNewProvider(c));
  app.post("/admin/auth/providers/new", htmlPostCsrf, requireAdminAccess, (c) =>
    handlePostNewProvider(c, db),
  );
  app.get("/admin/auth/providers/:id", requireAdminAccess, (c) => handleGetEditProvider(c, db));
  app.post("/admin/auth/providers/:id", htmlPostCsrf, requireAdminAccess, (c) =>
    handlePostEditProvider(c, db),
  );
  app.post("/admin/auth/providers/:id/discover", htmlPostCsrf, requireAdminAccess, (c) =>
    handlePostDiscover(c, db),
  );
  app.post("/admin/auth/providers/:id/test", htmlPostCsrf, requireAdminAccess, (c) =>
    handlePostTestConnection(c, db),
  );

  app.get("/admin/auth/cf-access", requireAdminAccess, (c) => handleGetCfAccess(c, db));
  app.post("/admin/auth/cf-access", htmlPostCsrf, requireAdminAccess, (c) =>
    handlePostCfAccess(c, db),
  );
  app.post("/admin/auth/cf-access/test", htmlPostCsrf, requireAdminAccess, (c) =>
    handlePostCfAccessTest(c, db),
  );

  app.get("/login", (c) => handleGetLogin(c, db));
  app.post("/login", htmlPostCsrf, loginRateLimitHtml, (c) => handlePostLogin(c, db, rateLimitStore));
  app.get("/mfa/verify", requirePartialSessionHtml, (c) => handleGetMfaVerify(c));
  app.post("/mfa/verify", htmlPostCsrf, requirePartialSessionHtml, (c) =>
    handlePostMfaVerify(c, db, rateLimitStore),
  );
  app.get("/mfa/enroll", requirePartialSessionHtml, (c) => handleGetMfaEnroll(c, db));
  app.post("/mfa/enroll/start", htmlPostCsrf, requirePartialSessionHtml, (c) =>
    handlePostMfaEnrollStart(c, db),
  );
  app.post("/mfa/enroll", htmlPostCsrf, requirePartialSessionHtml, (c) =>
    handlePostMfaEnroll(c, db, rateLimitStore),
  );
  app.post("/logout", htmlPostCsrf, (c) => handlePostLogout(c, db));

  app.get("/assets/*", staffSpa.serveAsset);
  app.get("/admin", staffAdminGate, staffSpa.serveSpaIndex);
  app.get("/admin/*", staffAdminGate, staffSpa.serveSpaIndex);
  app.get("/operator", requireSessionHtml, checkInPanelGuard, staffSpa.serveSpaIndex);
  app.get("/operator/*", requireSessionHtml, checkInPanelGuard, staffSpa.serveSpaIndex);

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

  app.post(
    "/api/checkin/scan",
    createCheckinPreAuth(checkinAuthDeps),
    createCheckinSessionCsrfGuard(),
    createCheckinAuthenticatedRateLimit(rateLimitStore, "scan"),
    parseScanBodyMiddleware,
    createCheckinEventScope(checkinAuthDeps, eventIdFromScanBody),
    (c) => handleCheckinScan(c, db),
  );

  app.post(
    "/api/checkin/lookup",
    createCheckinPreAuth(checkinAuthDeps),
    createCheckinSessionCsrfGuard(),
    createCheckinAuthenticatedRateLimit(rateLimitStore, "scan"),
    parseScanBodyMiddleware,
    createCheckinEventScope(checkinAuthDeps, eventIdFromCheckinBody),
    (c) => handleCheckinLookup(c, db),
  );

  app.get(
    "/api/checkin/attendees/:attendeeId",
    createCheckinPreAuth(checkinAuthDeps),
    createCheckinAuthenticatedRateLimit(rateLimitStore, "history"),
    createCheckinEventScope(checkinAuthDeps, (c) => c.req.query("eventId") || undefined),
    (c) => handleGetAttendeeCard(c, db),
  );

  app.post(
    "/api/checkin/admit",
    createCheckinPreAuth(checkinAuthDeps),
    createCheckinSessionCsrfGuard(),
    createCheckinAuthenticatedRateLimit(rateLimitStore, "scan"),
    parseScanBodyMiddleware,
    createCheckinEventScope(checkinAuthDeps, eventIdFromCheckinBody),
    (c) => handleCheckinAdmit(c, db),
  );

  app.post(
    "/api/checkin/items/:itemKey",
    createCheckinPreAuth(checkinAuthDeps),
    createCheckinSessionCsrfGuard(),
    createCheckinAuthenticatedRateLimit(rateLimitStore, "scan"),
    parseScanBodyMiddleware,
    createCheckinEventScope(checkinAuthDeps, eventIdFromCheckinBody),
    (c) => handleCheckinItemAction(c, db),
  );

  app.post(
    "/api/checkin/notes",
    createCheckinPreAuth(checkinAuthDeps),
    createCheckinSessionCsrfGuard(),
    createCheckinAuthenticatedRateLimit(rateLimitStore, "scan"),
    parseScanBodyMiddleware,
    createCheckinEventScope(checkinAuthDeps, eventIdFromCheckinBody),
    (c) => handleCheckinNote(c, db),
  );

  app.post(
    "/api/checkin/undo",
    createCheckinPreAuth(checkinAuthDeps),
    createCheckinSessionCsrfGuard(),
    createCheckinAuthenticatedRateLimit(rateLimitStore, "scan"),
    parseScanBodyMiddleware,
    createCheckinEventScope(checkinAuthDeps, eventIdFromCheckinBody),
    (c) => handleCheckinUndo(c, db),
  );

  app.get(
    "/api/checkin/stats",
    createCheckinPreAuth(checkinAuthDeps),
    createCheckinAuthenticatedRateLimit(rateLimitStore, "history"),
    createCheckinEventScope(checkinAuthDeps, eventIdFromHistoryQuery),
    (c) => handleCheckinStats(c, db),
  );

  app.get(
    "/api/checkin/history",
    createCheckinPreAuth(checkinAuthDeps),
    createCheckinAuthenticatedRateLimit(rateLimitStore, "history"),
    createCheckinEventScope(checkinAuthDeps, eventIdFromHistoryQuery),
    (c) => handleCheckinHistory(c, db),
  );

  return app;
}
