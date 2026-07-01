import { Hono, type Context } from "hono";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { bodyLimit } from "hono/body-limit";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@admitto/db";
import type { AttendeeStatus } from "@admitto/db";
import { recordTicketViewed } from "@admitto/mail-delivery";
import type { MailDeliveryDeps } from "@admitto/mail-delivery";
import { getBrandingTheme, SESSION_STAGE } from "@admitto/auth";
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
import {
  resolveBaseUrl,
  resolveCheckinToken,
  resolveAllowCheckinBearer,
  validateCheckinBootConfig,
  validateCfAccessBootConfig,
  resolveOpsHealthTokenOption,
  validateOpsHealthBootConfig,
  validateRedisBootConfig,
  validateEncryptionKeyBootConfig,
} from "./config.js";
import {
  handleGetAppleTouchIcon,
  handleGetAppleTouchIconPrecomposed,
  handleGetFavicon32Png,
  handleGetFaviconIco,
  handleGetFaviconSvg,
} from "./favicon.js";
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
import {
  createAccountMfaEnrollRateLimitMiddleware,
  createMfaEnrollRateLimitMiddleware,
} from "./auth/mfa-rate-limit.js";
import { createCrossSitePostGuard } from "./auth/same-origin-post.js";
import { createCheckinAuthenticatedRateLimit } from "./checkin-rate-limit.js";
import { createCheckinStreamConcurrencyLimit } from "./checkin-stream-limit.js";
import {
  createAdminBulkResendRateLimit,
  createAdminResendRateLimit,
} from "./admin-resend-rate-limit.js";
import {
  createAdminExportRateLimit,
  createAdminPiiExportRateLimit,
} from "./admin-export-rate-limit.js";
import { createAdminCommunicationRateLimit } from "./admin-communication-rate-limit.js";
import { createAdminMailSettingsRateLimit } from "./admin-mail-settings-rate-limit.js";
import {
  createAdminImportPreviewRateLimit,
  createAdminImportCommitRateLimit,
  createAdminTemplatePreviewRateLimit,
} from "./admin-heavy-ops-rate-limit.js";
import { createAdminAuthProviderOpsRateLimit } from "./admin-auth-providers-rate-limit.js";
import { handleLogin, handleLogout, handleMe, handlePostSessionDeviceLabel, handleMfaVerify, handleTotpEnroll, handleTotpConfirm, handleTotpBackupCodesComplete } from "./auth/routes.js";
import {
  handleGetMfaEnroll,
  handleGetMfaEnrollBackupCodes,
  handleGetMfaVerify,
  handlePostMfaEnroll,
  handlePostMfaEnrollBackupCodes,
  handlePostMfaEnrollDownloadCodes,
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
import { handleCreateEvent, handleGetAdminEvents } from "./admin/admin-api-routes.js";
import {
  handlePostArchiveEvent,
  handlePostUnarchiveEvent,
  withEventArchiveGuard,
} from "./admin/event-archiving.js";
import {
  handleGetEventSettings,
  handlePatchEvent,
  handleExportEventPii,
} from "./admin/event-settings-routes.js";
import {
  handleListEventAttendees,
  handleCreateEventAttendee,
  handleGetEventAttendee,
  handlePatchEventAttendee,
  handleDeleteEventAttendee,
  handleResendEventAttendeeTicket,
  handleBulkResendTickets,
  handleListTicketTypes,
  handleExportAttendees,
} from "./admin/attendees-api-routes.js";
import { handleImportPreview, handleImportCommit, handleGetImportTemplate, MAX_IMPORT_BODY_BYTES } from "./admin/import-api-routes.js";
import {
  handleListEventItems,
  handleCreateEventItem,
  handlePatchEventItem,
  handleDeleteEventItem,
  handleGetEventOpsConfig,
  handlePatchEventOpsConfig,
} from "./admin/event-items-api-routes.js";
import { handleGetReports, handleExportReports } from "./admin/reports-routes.js";
import { handleGetEventOverview } from "./admin/overview-routes.js";
import { handlePostUpload } from "./admin/uploads-api-routes.js";
import { resolveUploadDir } from "./admin/branding-upload.js";
import {
  handleGetEventTemplate,
  handlePutEventTemplate,
  handlePreviewEventTemplate,
  handleTestSendEventTemplate,
  handleTestSendEventTemplateById,
  handleListEventDeliveries,
  handleListEventTemplates,
  handleGetEventTemplateById,
  handlePutEventTemplateById,
  handleCreateEventTemplate,
  handleDeleteEventTemplate,
  handlePreviewEventTemplateById,
  MAX_TEMPLATE_BODY_BYTES,
  MAX_TEMPLATE_TEST_SEND_BODY_BYTES,
} from "./admin/communication-api-routes.js";
import { handleBulkSend, handleBulkSendStatus } from "./admin/bulk-send-routes.js";
import { handleEventStream } from "./admin/checkin-stream-routes.js";
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
  handleCheckinOpsConfig,
  handleCheckinHistory,
  eventIdFromCheckinBody,
} from "./admin/checkin-api-routes.js";
import { handleGetStaffTheme, handlePutStaffTheme } from "./admin/staff-api-routes.js";
import {
  handleGetMailSettings,
  handlePutMailSettings,
  handlePostMailSettingsTest,
  MAX_MAIL_SETTINGS_BODY_BYTES,
} from "./admin/mail-settings-routes.js";
import { handleGetSetupChecks } from "./admin/setup-checks-routes.js";
import { handlePostSetupComplete } from "./admin/setup-complete-routes.js";
import {
  handleGetSetupOrgBranding,
  handlePatchSetupOrgBranding,
} from "./admin/setup-org-branding-routes.js";
import { handleGetSetup, handlePostSetup } from "./setup-routes.js";
import {
  handleGetSessions,
  handleRevokeSession,
  handleRevokeAllOperatorSessions,
} from "./admin/sessions-routes.js";
import { handleGetAuditLog } from "./admin/audit-routes.js";
import {
  handleGetOrganizations,
  handleGetUsers,
  handlePostUser,
  handlePatchUser,
  handlePostUserRole,
  handleDeleteUserRole,
  handlePostResetUserMfa,
  handlePostResetUserPassword,
  handlePostRevokeUserSessions,
} from "./admin/users-routes.js";
import { handleGetRoleAssignments } from "./admin/role-assignments-routes.js";
import {
  handleGetChangePassword,
  handlePostChangePassword,
} from "./auth/change-password-routes.js";
import {
  handleGetAccount,
  handlePatchAccountProfile,
  handlePatchAccountPassword,
  handleGetAccountSessions,
  handleDeleteAccountSession,
  handlePostMfaEnroll as handlePostAccountMfaEnroll,
  handlePostMfaConfirm as handlePostAccountMfaConfirm,
  handlePostMfaReset as handlePostAccountMfaReset,
} from "./admin/account-routes.js";
import {
  handleGetSystemSettings,
  handlePatchSystemSettings,
} from "./admin/system-settings-routes.js";
import { handlePostClientError } from "./admin/client-error-routes.js";
import { createStaffSpaHandlers } from "./staff-spa.js";
import { serveTablerIcons } from "./vendor-assets.js";
import { sweepExpiredOidcAuthStates } from "@admitto/auth";
import {
  handleListProviders,
  handleGetNewProvider,
  handlePostNewProvider,
  handleGetEditProvider,
  handlePostEditProvider,
  handlePostDiscover,
  handlePostTestConnection,
  handleToggleProvider,
} from "./admin/auth-providers-routes.js";
import {
  handleGetCfAccess,
  handlePostCfAccess,
  handlePostCfAccessTest,
} from "./admin/cf-access-routes.js";
import { applyBaselineSecurityHeaders } from "./security-headers.js";
import { resolvePostLoginRedirectForUser } from "./auth/post-login-redirect.js";
import { handleReadyz } from "./ops/readyz.js";
import { createReadyzRateLimitMiddleware } from "./ops/readyz-rate-limit.js";
import { createHealthzRateLimitMiddleware } from "./ops/healthz-rate-limit.js";

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
  opsHealthToken?: string | null;
}

/**
 * Liveness/readiness probe for Docker and reverse proxies.
 * Runs `SELECT 1` against Postgres; no auth; does not expose app version or secrets.
 */
async function handleHealthz(c: Context, db: PrismaClient) {
  applyBaselineSecurityHeaders((name, value) => c.header(name, value));
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
    validateOpsHealthBootConfig(process.env);
    validateRedisBootConfig(process.env);
    validateEncryptionKeyBootConfig(process.env);
  }

  const checkinGateConfig: CheckinGateConfig = {
    allowBearer: allowCheckinBearer,
    operatorToken: checkinToken,
  };
  const checkinAuthDeps = { prisma: db, config: checkinGateConfig };
  const mailDeliveryDeps = options.mailDeliveryDeps ?? {};

  const app = new Hono();
  const rateLimitStore = options.rateLimitStore ?? createRateLimitStore();
  const opsHealthToken = resolveOpsHealthTokenOption(options.opsHealthToken);
  const readyzRateLimit = createReadyzRateLimitMiddleware(rateLimitStore);
  const healthzRateLimit = createHealthzRateLimitMiddleware(rateLimitStore);
  const publicRateLimit = createPublicRateLimitMiddleware(rateLimitStore);
  const loginRateLimitJson = createLoginRateLimitMiddleware(rateLimitStore, { format: "json" });
  const loginRateLimitHtml = createLoginRateLimitMiddleware(rateLimitStore, { format: "text" });
  const oidcAuthRateLimit = createOidcAuthRateLimitMiddleware(rateLimitStore);
  const mfaEnrollRateLimitJson = createMfaEnrollRateLimitMiddleware(rateLimitStore, { format: "json" });
  const mfaEnrollRateLimitHtml = createMfaEnrollRateLimitMiddleware(rateLimitStore, { format: "text" });
  const htmlPostCsrf = createCrossSitePostGuard({ format: "text" });
  const jsonPostCsrf = createCrossSitePostGuard({ format: "json" });
  const requireSession = createRequireSession(db);
  const requireSessionHtml = createRequireSession(db, { redirectTo: "/login" });
  const requirePartialSession = createRequirePartialSession(db);
  const requirePartialSessionHtml = createRequirePartialSession(db, { redirectTo: "/login" });
  // Forced password change is its own constrained stage; only sessions in that
  // stage may reach `/change-password`, and full sessions never can (IAM-001).
  const requireChangePasswordSession = createRequirePartialSession(db, {
    redirectTo: "/login",
    allowedStages: [SESSION_STAGE.CHANGE_PASSWORD_REQUIRED],
  });
  const requireAdminAccess = createAdminAccessMiddleware(db);
  const staffAdminGate = createStaffAdminGate(db);
  /** Middleware: event manage access, then archived read-only guard, then route handler. */
  const guardArchivedEvent = (handler: (c: Context) => Response | Promise<Response>) =>
    withEventArchiveGuard(db, handler);
  const adminResendRateLimit = createAdminResendRateLimit(rateLimitStore);
  const adminBulkResendRateLimit = createAdminBulkResendRateLimit(rateLimitStore);
  const adminPiiExportRateLimit = createAdminPiiExportRateLimit(rateLimitStore);
  const adminExportRateLimit = createAdminExportRateLimit(rateLimitStore);
  const adminCommunicationRateLimit = createAdminCommunicationRateLimit(rateLimitStore);
  const adminMailSettingsRateLimit = createAdminMailSettingsRateLimit(rateLimitStore);
  const adminImportPreviewRateLimit = createAdminImportPreviewRateLimit(rateLimitStore);
  const adminImportCommitRateLimit = createAdminImportCommitRateLimit(rateLimitStore);
  const adminTemplatePreviewRateLimit = createAdminTemplatePreviewRateLimit(rateLimitStore);
  const adminAuthProviderOpsRateLimit = createAdminAuthProviderOpsRateLimit(rateLimitStore);
  const importBodyLimit = bodyLimit({
    maxSize: MAX_IMPORT_BODY_BYTES,
    onError: (c) => c.json({ error: "file too large" }, 400),
  });
  const templateBodyLimit = bodyLimit({
    maxSize: MAX_TEMPLATE_BODY_BYTES,
    onError: (c) => c.json({ error: "template too large" }, 400),
  });
  const templateTestSendBodyLimit = bodyLimit({
    maxSize: MAX_TEMPLATE_TEST_SEND_BODY_BYTES,
    onError: (c) => c.json({ error: "request too large" }, 400),
  });
  const mailSettingsBodyLimit = bodyLimit({
    maxSize: MAX_MAIL_SETTINGS_BODY_BYTES,
    onError: (c) => c.json({ error: "request too large" }, 400),
  });
  const uploadBodyLimit = bodyLimit({
    maxSize: Math.ceil(2.1 * 1024 * 1024),
    onError: (c) => c.json({ error: "file too large" }, 413),
  });
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

  app.get("/healthz", healthzRateLimit, (c) => handleHealthz(c, db));
  app.get("/favicon.svg", handleGetFaviconSvg);
  app.get("/favicon-32.png", handleGetFavicon32Png);
  app.get("/favicon.ico", handleGetFaviconIco);
  app.get("/apple-touch-icon.png", handleGetAppleTouchIcon);
  app.get("/apple-touch-icon-precomposed.png", handleGetAppleTouchIconPrecomposed);
  app.get("/readyz", readyzRateLimit, (c) =>
    handleReadyz(c, {
      db,
      rateLimitStore,
      opsHealthToken,
      env: process.env,
    }),
  );

  app.post("/api/auth/login", jsonPostCsrf, loginRateLimitJson, (c) =>
    handleLogin(c, db, rateLimitStore),
  );
  app.post("/api/auth/logout", jsonPostCsrf, (c) => handleLogout(c, db));
  app.get("/api/auth/me", requireSession, (c) => handleMe(c, db));
  app.post("/api/auth/session/device-label", jsonPostCsrf, requireSession, (c) =>
    handlePostSessionDeviceLabel(c, db),
  );

  app.get("/api/admin/me", staffAdminGate, (c) =>
    handleMe(c, db, { includeMailerStatus: true, includeSetupComplete: true }),
  );
  app.get("/api/admin/events", staffAdminGate, (c) => handleGetAdminEvents(c, db));
  app.post("/api/admin/events", jsonPostCsrf, staffAdminGate, (c) => handleCreateEvent(c, db));
  app.post("/api/admin/events/:eventId/archive", jsonPostCsrf, staffAdminGate, (c) =>
    handlePostArchiveEvent(c, db),
  );
  app.post("/api/admin/events/:eventId/unarchive", jsonPostCsrf, staffAdminGate, (c) =>
    handlePostUnarchiveEvent(c, db),
  );
  // PATCH /events/:eventId is the bare event id (no trailing segment). Hono matches the
  // full path, so this does not shadow /attendees/:id, /items/:itemId, or /ops-config.
  app.get("/api/admin/events/:eventId/settings", staffAdminGate, (c) => handleGetEventSettings(c, db));
  app.patch(
    "/api/admin/events/:eventId",
    jsonPostCsrf,
    staffAdminGate,
    guardArchivedEvent((c) => handlePatchEvent(c, db)),
  );
  app.get("/api/admin/events/:eventId/export-pii", staffAdminGate, adminPiiExportRateLimit, (c) =>
    handleExportEventPii(c, db),
  );
  app.get("/api/admin/events/:eventId/attendees/ticket-types", staffAdminGate, (c) =>
    handleListTicketTypes(c, db),
  );
  app.get("/api/admin/events/:eventId/attendees/export", staffAdminGate, adminExportRateLimit, (c) =>
    handleExportAttendees(c, db),
  );
  app.get("/api/admin/events/:eventId/attendees", staffAdminGate, (c) =>
    handleListEventAttendees(c, db),
  );
  app.post(
    "/api/admin/events/:eventId/attendees",
    jsonPostCsrf,
    staffAdminGate,
    guardArchivedEvent((c) => handleCreateEventAttendee(c, db)),
  );
  app.post(
    "/api/admin/events/:eventId/attendees/bulk-resend",
    jsonPostCsrf,
    staffAdminGate,
    adminBulkResendRateLimit,
    guardArchivedEvent((c) => handleBulkResendTickets(c, db, mailDeliveryDeps, baseUrl)),
  );
  app.get("/api/admin/events/:eventId/attendees/:id", staffAdminGate, (c) =>
    handleGetEventAttendee(c, db),
  );
  app.patch("/api/admin/events/:eventId/attendees/:id", jsonPostCsrf, staffAdminGate, guardArchivedEvent((c) =>
    handlePatchEventAttendee(c, db),
  ));
  app.delete("/api/admin/events/:eventId/attendees/:id", jsonPostCsrf, staffAdminGate, (c) =>
    handleDeleteEventAttendee(c, db),
  );
  app.post(
    "/api/admin/events/:eventId/attendees/:id/resend",
    jsonPostCsrf,
    staffAdminGate,
    adminResendRateLimit,
    guardArchivedEvent((c) => handleResendEventAttendeeTicket(c, db, mailDeliveryDeps, baseUrl)),
  );
  app.get("/api/admin/events/:eventId/template", staffAdminGate, (c) =>
    handleGetEventTemplate(c, db),
  );
  app.put("/api/admin/events/:eventId/template", jsonPostCsrf, staffAdminGate, templateBodyLimit, guardArchivedEvent((c) =>
    handlePutEventTemplate(c, db),
  ));
  app.post("/api/admin/events/:eventId/template/preview", jsonPostCsrf, staffAdminGate, adminTemplatePreviewRateLimit, templateBodyLimit, guardArchivedEvent((c) =>
    handlePreviewEventTemplate(c, db, baseUrl),
  ));
  app.post(
    "/api/admin/events/:eventId/template/test-send",
    jsonPostCsrf,
    staffAdminGate,
    templateTestSendBodyLimit,
    adminCommunicationRateLimit,
    guardArchivedEvent((c) => handleTestSendEventTemplate(c, db, mailDeliveryDeps, baseUrl)),
  );
  app.get("/api/admin/events/:eventId/templates", staffAdminGate, (c) =>
    handleListEventTemplates(c, db),
  );
  app.get("/api/admin/events/:eventId/templates/:templateId", staffAdminGate, (c) =>
    handleGetEventTemplateById(c, db),
  );
  app.put(
    "/api/admin/events/:eventId/templates/:templateId",
    jsonPostCsrf,
    staffAdminGate,
    templateBodyLimit,
    guardArchivedEvent((c) => handlePutEventTemplateById(c, db)),
  );
  app.post(
    "/api/admin/events/:eventId/templates",
    jsonPostCsrf,
    staffAdminGate,
    templateBodyLimit,
    guardArchivedEvent((c) => handleCreateEventTemplate(c, db)),
  );
  app.delete(
    "/api/admin/events/:eventId/templates/:templateId",
    jsonPostCsrf,
    staffAdminGate,
    guardArchivedEvent((c) => handleDeleteEventTemplate(c, db)),
  );
  app.post(
    "/api/admin/events/:eventId/templates/:templateId/preview",
    jsonPostCsrf,
    staffAdminGate,
    adminTemplatePreviewRateLimit,
    templateBodyLimit,
    guardArchivedEvent((c) => handlePreviewEventTemplateById(c, db, baseUrl)),
  );
  app.post(
    "/api/admin/events/:eventId/templates/:templateId/test-send",
    jsonPostCsrf,
    staffAdminGate,
    templateTestSendBodyLimit,
    adminCommunicationRateLimit,
    guardArchivedEvent((c) =>
      handleTestSendEventTemplateById(c, db, mailDeliveryDeps, baseUrl),
    ),
  );
  app.post(
    "/api/admin/events/:eventId/send",
    jsonPostCsrf,
    staffAdminGate,
    adminBulkResendRateLimit,
    guardArchivedEvent((c) => handleBulkSend(c, db, mailDeliveryDeps, baseUrl)),
  );
  app.get("/api/admin/events/:eventId/send/status/:batchId", staffAdminGate, (c) =>
    handleBulkSendStatus(c, db),
  );
  app.get("/api/admin/events/:eventId/deliveries", staffAdminGate, (c) =>
    handleListEventDeliveries(c, db),
  );
  app.get("/api/admin/events/:eventId/import/template", staffAdminGate, (c) =>
    handleGetImportTemplate(c, db),
  );
  app.post("/api/admin/events/:eventId/import/preview", jsonPostCsrf, staffAdminGate, adminImportPreviewRateLimit, importBodyLimit, guardArchivedEvent((c) =>
    handleImportPreview(c, db),
  ));
  app.post("/api/admin/events/:eventId/import/commit", jsonPostCsrf, staffAdminGate, adminImportCommitRateLimit, importBodyLimit, guardArchivedEvent((c) =>
    handleImportCommit(c, db),
  ));
  app.get("/api/admin/events/:eventId/items", staffAdminGate, (c) => handleListEventItems(c, db));
  app.post("/api/admin/events/:eventId/items", jsonPostCsrf, staffAdminGate, guardArchivedEvent((c) =>
    handleCreateEventItem(c, db),
  ));
  app.patch("/api/admin/events/:eventId/items/:itemId", jsonPostCsrf, staffAdminGate, guardArchivedEvent((c) =>
    handlePatchEventItem(c, db),
  ));
  app.delete("/api/admin/events/:eventId/items/:itemId", jsonPostCsrf, staffAdminGate, guardArchivedEvent((c) =>
    handleDeleteEventItem(c, db),
  ));
  app.get("/api/admin/events/:eventId/ops-config", staffAdminGate, (c) => handleGetEventOpsConfig(c, db));
  app.patch("/api/admin/events/:eventId/ops-config", jsonPostCsrf, staffAdminGate, guardArchivedEvent((c) =>
    handlePatchEventOpsConfig(c, db),
  ));
  app.get("/api/admin/events/:eventId/overview", staffAdminGate, (c) =>
    handleGetEventOverview(c, db),
  );
  app.get("/api/admin/events/:eventId/reports", staffAdminGate, (c) => handleGetReports(c, db));
  app.get("/api/admin/events/:eventId/reports/export", staffAdminGate, adminExportRateLimit, (c) =>
    handleExportReports(c, db),
  );
  app.get("/api/admin/theme", staffAdminGate, (c) => handleGetStaffTheme(c, db));
  app.put("/api/admin/theme", jsonPostCsrf, staffAdminGate, (c) => handlePutStaffTheme(c, db));
  app.get("/api/admin/mail-settings", staffAdminGate, (c) => handleGetMailSettings(c, db));
  app.put("/api/admin/mail-settings", mailSettingsBodyLimit, jsonPostCsrf, staffAdminGate, (c) =>
    handlePutMailSettings(c, db),
  );
  app.post(
    "/api/admin/mail-settings/test",
    jsonPostCsrf,
    staffAdminGate,
    adminMailSettingsRateLimit,
    (c) => handlePostMailSettingsTest(c, db, mailDeliveryDeps),
  );
  app.get("/api/admin/setup/checks", staffAdminGate, (c) =>
    handleGetSetupChecks(c, db, rateLimitStore),
  );
  app.get("/api/admin/setup/org-branding", staffAdminGate, (c) => handleGetSetupOrgBranding(c, db));
  app.patch("/api/admin/setup/org-branding", jsonPostCsrf, staffAdminGate, (c) =>
    handlePatchSetupOrgBranding(c, db),
  );
  app.post("/api/admin/setup/complete", jsonPostCsrf, staffAdminGate, (c) =>
    handlePostSetupComplete(c, db),
  );
  app.get("/api/admin/audit-log", staffAdminGate, (c) => handleGetAuditLog(c, db));
  app.get("/api/admin/sessions", staffAdminGate, (c) => handleGetSessions(c, db));
  app.post("/api/admin/sessions/:id/revoke", jsonPostCsrf, staffAdminGate, (c) =>
    handleRevokeSession(c, db),
  );
  app.post(
    "/api/admin/events/:eventId/revoke-all-operator-sessions",
    jsonPostCsrf,
    staffAdminGate,
    (c) => handleRevokeAllOperatorSessions(c, db),
  );
  app.get("/api/admin/organizations", staffAdminGate, (c) => handleGetOrganizations(c, db));
  app.get("/api/admin/users", staffAdminGate, (c) => handleGetUsers(c, db));
  app.post("/api/admin/users", jsonPostCsrf, staffAdminGate, (c) => handlePostUser(c, db));
  app.patch("/api/admin/users/:id", jsonPostCsrf, staffAdminGate, (c) => handlePatchUser(c, db));
  app.post("/api/admin/users/:id/roles", jsonPostCsrf, staffAdminGate, (c) =>
    handlePostUserRole(c, db),
  );
  app.delete("/api/admin/users/:id/roles/:assignmentId", jsonPostCsrf, staffAdminGate, (c) =>
    handleDeleteUserRole(c, db),
  );
  app.post("/api/admin/users/:id/reset-2fa", jsonPostCsrf, staffAdminGate, (c) =>
    handlePostResetUserMfa(c, db),
  );
  app.post("/api/admin/users/:id/reset-password", jsonPostCsrf, staffAdminGate, (c) =>
    handlePostResetUserPassword(c, db),
  );
  app.post("/api/admin/users/:id/revoke-sessions", jsonPostCsrf, staffAdminGate, (c) =>
    handlePostRevokeUserSessions(c, db),
  );
  app.get("/api/admin/role-assignments", staffAdminGate, (c) => handleGetRoleAssignments(c, db));
  app.get("/api/admin/system-settings", staffAdminGate, (c) => handleGetSystemSettings(c, db));
  app.patch("/api/admin/system-settings", jsonPostCsrf, staffAdminGate, (c) =>
    handlePatchSystemSettings(c, db),
  );
  app.post("/api/admin/client-errors", jsonPostCsrf, staffAdminGate, (c) => handlePostClientError(c));
  app.post("/api/admin/uploads", jsonPostCsrf, staffAdminGate, uploadBodyLimit, (c) =>
    handlePostUpload(c, db),
  );

  app.get("/api/account", requireSession, (c) => handleGetAccount(c, db));
  app.patch("/api/account/profile", jsonPostCsrf, requireSession, (c) =>
    handlePatchAccountProfile(c, db),
  );
  app.patch("/api/account/password", jsonPostCsrf, loginRateLimitJson, requireSession, (c) =>
    handlePatchAccountPassword(c, db),
  );
  app.get("/api/account/sessions", requireSession, (c) => handleGetAccountSessions(c, db));
  app.delete("/api/account/sessions/:sessionId", jsonPostCsrf, requireSession, (c) =>
    handleDeleteAccountSession(c, db),
  );
  app.post(
    "/api/account/mfa/totp/enroll",
    jsonPostCsrf,
    loginRateLimitJson,
    requireSession,
    createAccountMfaEnrollRateLimitMiddleware(rateLimitStore),
    (c) => handlePostAccountMfaEnroll(c, db),
  );
  app.post("/api/account/mfa/totp/confirm", jsonPostCsrf, loginRateLimitJson, requireSession, (c) =>
    handlePostAccountMfaConfirm(c, db, rateLimitStore),
  );
  app.post("/api/account/mfa/reset", jsonPostCsrf, loginRateLimitJson, requireSession, (c) =>
    handlePostAccountMfaReset(c, db),
  );

  app.get("/api/checkin/events", requireSession, (c) => handleGetCheckinEvents(c, db));
  app.get("/api/staff/theme", requireSession, (c) => handleGetStaffTheme(c, db));
  app.put("/api/staff/theme", jsonPostCsrf, requireSession, (c) => handlePutStaffTheme(c, db));

  app.post("/api/auth/mfa/verify", jsonPostCsrf, requirePartialSession, (c) =>
    handleMfaVerify(c, db, rateLimitStore),
  );
  app.post("/api/auth/mfa/totp/enroll", jsonPostCsrf, requirePartialSession, mfaEnrollRateLimitJson, (c) =>
    handleTotpEnroll(c, db),
  );
  app.post("/api/auth/mfa/totp/confirm", jsonPostCsrf, requirePartialSession, (c) =>
    handleTotpConfirm(c, db, rateLimitStore),
  );
  app.post("/api/auth/mfa/totp/backup-codes/complete", jsonPostCsrf, requirePartialSession, (c) =>
    handleTotpBackupCodesComplete(c, db),
  );

  app.get("/api/auth/oidc/:providerId/start", oidcAuthRateLimit, (c) => handleOidcStart(c, db, baseUrl));
  app.get("/api/auth/oidc/:providerId/callback", oidcAuthRateLimit, (c) => handleOidcCallback(c, db, baseUrl));

  app.get("/account/oidc/:providerId/link", requireSessionHtml, (c) => handleGetOidcLink(c, db));
  app.post("/account/oidc/:providerId/link", htmlPostCsrf, loginRateLimitHtml, requireSessionHtml, (c) =>
    handlePostOidcLink(c, db, baseUrl, rateLimitStore),
  );

  app.get("/", requireSessionHtml, async (c) => {
    const auth = c.get("auth");
    const landing = await resolvePostLoginRedirectForUser(db, auth.userId);
    return c.redirect(landing, 302);
  });

  app.get("/admin/auth/providers", requireAdminAccess, (c) => handleListProviders(c, db));
  app.get("/admin/auth/providers/new", requireAdminAccess, (c) => handleGetNewProvider(c));
  app.post("/admin/auth/providers/new", htmlPostCsrf, requireAdminAccess, (c) =>
    handlePostNewProvider(c, db),
  );
  app.get("/admin/auth/providers/:id", requireAdminAccess, (c) => handleGetEditProvider(c, db));
  app.post("/admin/auth/providers/:id", htmlPostCsrf, requireAdminAccess, (c) =>
    handlePostEditProvider(c, db),
  );
  app.post("/admin/auth/providers/:id/discover", htmlPostCsrf, requireAdminAccess, adminAuthProviderOpsRateLimit, (c) =>
    handlePostDiscover(c, db),
  );
  app.post("/admin/auth/providers/:id/test", htmlPostCsrf, requireAdminAccess, adminAuthProviderOpsRateLimit, (c) =>
    handlePostTestConnection(c, db),
  );
  app.post("/admin/auth/providers/:id/toggle", htmlPostCsrf, requireAdminAccess, (c) =>
    handleToggleProvider(c, db),
  );

  app.get("/admin/auth/cf-access", requireAdminAccess, (c) => handleGetCfAccess(c, db));
  app.post("/admin/auth/cf-access", htmlPostCsrf, requireAdminAccess, (c) =>
    handlePostCfAccess(c, db),
  );
  app.post("/admin/auth/cf-access/test", htmlPostCsrf, requireAdminAccess, (c) =>
    handlePostCfAccessTest(c, db),
  );

  app.get("/setup", (c) => handleGetSetup(c, db));
  app.post("/setup", htmlPostCsrf, loginRateLimitHtml, (c) => handlePostSetup(c, db));
  app.get("/login", (c) => handleGetLogin(c, db));
  app.post("/login", htmlPostCsrf, loginRateLimitHtml, (c) => handlePostLogin(c, db, rateLimitStore));
  app.get("/mfa/verify", requirePartialSessionHtml, (c) => handleGetMfaVerify(c));
  app.post("/mfa/verify", htmlPostCsrf, requirePartialSessionHtml, (c) =>
    handlePostMfaVerify(c, db, rateLimitStore),
  );
  app.get("/mfa/enroll", requirePartialSessionHtml, (c) => handleGetMfaEnroll(c, db));
  app.post("/mfa/enroll/start", htmlPostCsrf, requirePartialSessionHtml, mfaEnrollRateLimitHtml, (c) =>
    handlePostMfaEnrollStart(c, db),
  );
  app.post("/mfa/enroll", htmlPostCsrf, requirePartialSessionHtml, (c) =>
    handlePostMfaEnroll(c, db, rateLimitStore),
  );
  app.get("/mfa/enroll/backup-codes", requirePartialSessionHtml, (c) =>
    handleGetMfaEnrollBackupCodes(c, db),
  );
  app.post("/mfa/enroll/backup-codes", htmlPostCsrf, requirePartialSessionHtml, (c) =>
    handlePostMfaEnrollBackupCodes(c, db),
  );
  app.post("/mfa/enroll/download-codes", htmlPostCsrf, requirePartialSessionHtml, (c) =>
    handlePostMfaEnrollDownloadCodes(c, db),
  );
  app.post("/logout", htmlPostCsrf, (c) => handlePostLogout(c, db));
  app.get("/change-password", requireChangePasswordSession, (c) => handleGetChangePassword(c, db));
  app.post("/change-password", htmlPostCsrf, requireChangePasswordSession, (c) =>
    handlePostChangePassword(c, db),
  );

  app.get("/assets/*", staffSpa.serveAsset);
  app.get("/uploads/*", async (c) => {
    const uploadDir = resolveUploadDir();
    const relPath = c.req.path.slice("/uploads/".length);
    if (relPath.includes("..") || relPath.startsWith("/")) {
      return c.notFound();
    }
    const filePath = join(uploadDir, relPath);
    let buf: Buffer;
    try {
      buf = await readFile(filePath);
    } catch {
      return c.notFound();
    }
    const ext = extname(filePath).toLowerCase();
    const contentTypeMap: Record<string, string> = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
    };
    const ct = contentTypeMap[ext] ?? "application/octet-stream";
    c.header("Content-Type", ct);
    c.header("Cache-Control", "public, max-age=86400");
    c.header("X-Content-Type-Options", "nosniff");
    return c.body(new Uint8Array(buf));
  });
  app.get("/vendor/tabler-icons/*", serveTablerIcons);
  app.get("/admin", staffAdminGate, staffSpa.serveSpaIndex);
  app.get("/admin/*", staffAdminGate, staffSpa.serveSpaIndex);
  app.get("/account", requireSessionHtml, staffSpa.serveSpaIndex);
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
    "/api/checkin/ops-config",
    createCheckinPreAuth(checkinAuthDeps),
    createCheckinAuthenticatedRateLimit(rateLimitStore, "history"),
    createCheckinEventScope(checkinAuthDeps, eventIdFromHistoryQuery),
    (c) => handleCheckinOpsConfig(c, db),
  );

  app.get(
    "/api/checkin/stats",
    createCheckinPreAuth(checkinAuthDeps),
    createCheckinAuthenticatedRateLimit(rateLimitStore, "history"),
    createCheckinEventScope(checkinAuthDeps, eventIdFromHistoryQuery),
    (c) => handleCheckinStats(c, db),
  );

  app.get(
    "/api/checkin/events/:eventId/stream",
    createCheckinPreAuth(checkinAuthDeps),
    createCheckinAuthenticatedRateLimit(rateLimitStore, "stream"),
    createCheckinEventScope(checkinAuthDeps, (c) => c.req.param("eventId")),
    createCheckinStreamConcurrencyLimit(),
    (c) => handleEventStream(c),
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
