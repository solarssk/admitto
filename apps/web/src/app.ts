import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { bodyLimit } from "hono/body-limit";
import { Prisma, prisma as defaultPrisma, type PrismaClient, type AttendeeStatus } from "@admitto/db";
import { recordTicketViewed } from "@admitto/mail-delivery";
import type { MailDeliveryDeps } from "@admitto/mail-delivery";
import {
  WalletProviderError,
  resolveWalletProvider,
  type WalletPassInput,
  type WalletPassProvider,
  type WalletPassResult,
  type WalletProviderErrorCode,
} from "@admitto/wallet";
import type { GeocodingProvider } from "@admitto/location";
import { getBrandingTheme, SESSION_STAGE, sweepExpiredOidcAuthStates } from "@admitto/auth";
import {
  resolveTicket,
  generateQrPng,
  buildQrPayload,
  isAdmittable,
  hashToken,
  resolveTicketPageDisplay,
  buildWalletPassInput,
} from "@admitto/tickets";
import {
  getTicketPageSecurityHeaders,
  renderTicket,
  renderNotFound,
  renderRevoked,
  renderServerError,
  resolveDisplayToken,
} from "./ticket-page.js";
import { EventStaticMapService } from "./maps/event-static-map-service.js";
import { resolveGeocodingConfig, resolveMapTileConfig, setMapsConfigCache } from "./maps/config.js";
import { startMapsConfigInvalidationSubscriber } from "./maps/maps-config-invalidate.js";
import {
  builtInMapsConfig,
  refreshMapsConfigCache,
} from "./maps/maps-org-settings.js";
import { createWeatherServiceFromDb } from "./weather/weather-org-settings.js";
import {
  parseEventIdFromStaticMapFilename,
  staticMapCacheControl,
  staticMapFailureStatus,
} from "./maps/static-map-route.js";
import {
  handleGetAdmittoLogo,
  handleGetAdmittoMark,
  handleGetAppleWalletBadge,
  handleGetAppleWalletBadgePng,
  handleGetGoogleWalletBadge,
  handleGetGoogleWalletBadgePng,
} from "./wallet-badges.js";
import { handlePassCreatorWebhook } from "./wallet-webhook.js";
import {
  resolveCheckinToken,
  resolveAllowCheckinBearer,
  validateCheckinBootConfig,
  resolveOpsHealthTokenOption,
  validateOpsHealthBootConfig,
  validateRedisBootConfig,
  validateEncryptionKeyBootConfig,
  validateTrustedProxyCidrsBootConfig,
} from "./config.js";
import { resolveInstanceBaseUrl } from "./instance-base-url.js";
import {
  handleGetAppleTouchIcon,
  handleGetAppleTouchIconPrecomposed,
  handleGetFavicon32Png,
  handleGetFaviconIco,
  handleGetFaviconSvg,
} from "./favicon.js";
import { handleGetRobotsTxt } from "./robots.js";
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
import {
  createHealthzRateLimitMiddleware,
  rateLimit,
} from "./rate-limit/policies.js";
import { skipBulkSendRateLimitForDryRun } from "./rate-limit/skip-bulk-send-dry-run.js";
import { skipWalletMessageRateLimitForDryRun } from "./rate-limit/skip-wallet-message-rate-limit-for-dry-run.js";
import { createRequireSession, createRequirePartialSession } from "./auth-middleware.js";
import { createLoginRateLimitMiddleware } from "./auth/login-rate-limit.js";
import {
  createAccountMfaEnrollRateLimitMiddleware,
  createMfaEnrollRateLimitMiddleware,
} from "./auth/mfa-rate-limit.js";
import { createCrossSitePostGuard } from "./auth/same-origin-post.js";
import { createCheckinStreamConcurrencyLimit } from "./checkin-stream-limit.js";
import { handleLogin, handleLogout, handleMe, handlePostSessionDeviceLabel, handleMfaVerify, handlePostMfaWebauthnBegin, handlePostMfaWebauthnVerify, handlePostMfaRememberDevice, handlePostMfaWebauthnEnrollBegin, handlePostMfaWebauthnEnrollFinish, handleTotpEnroll, handleTotpConfirm, handleTotpBackupCodesComplete } from "./auth/routes.js";
import {
  handleGetMfaEnroll,
  handleGetMfaEnrollBackupCodes,
  handleGetMfaEnrollMethod,
  handleGetMfaEnrollWebauthn,
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
import { handleDeleteEvent } from "./admin/event-deletion.js";
import { handleRevokeAllCheckIns, handleRevokeAllItems } from "./admin/event-revoke-routes.js";
import {
  handleGetEventSettings,
  handlePatchEvent,
  handleExportEventPii,
  handlePostEventWalletTest,
} from "./admin/event-settings-routes.js";
import {
  handleListEventAttendees,
  handleCreateEventAttendee,
  handleGetEventAttendee,
  handlePatchEventAttendee,
  handleDeleteEventAttendee,
  handleBulkDeleteEventAttendees,
  handleBulkCheckInEventAttendees,
  handleBulkRevokeAttendeeItems,
  handleBulkRevokeCheckInEventAttendees,
  handleBulkRevokeAttendeePass,
  handleBulkVoidAttendeeWalletPass,
  handleBulkReissueAttendeeWalletPass,
  handleBulkDeleteAttendeeWalletPass,
  handleBulkTicketTypeEventAttendees,
  handleBulkRsvpEventAttendees,
  handleResendEventAttendeeTicket,
  handleGetAttendeeTicketLink,
  handleDismissAttendeeBounce,
  handleBulkResendTickets,
  handleExportAttendees,
  handleGetExportJob,
  handleDownloadExportJob,
  handleExportSelectedAttendees,
  handleRevokeAttendeeCheckIn,
  handleRevokeAttendeeItem,
  handleVoidAttendeeWalletPass,
  handleRestoreAttendeeWalletPass,
  handleReissueAttendeeWalletPass,
  handleDeleteAttendeeWalletPass,
  handleAddAttendeeNote,
  handlePatchAttendeeNote,
  handleDeleteAttendeeNote,
} from "./admin/attendees-api-routes.js";
import { handleGetWalletPushJob, handleGetWalletPushHistory } from "./admin/wallet-push-routes.js";
import {
  handleWalletMessageSend,
  handleGetWalletMessageJob,
  handleGetWalletMessageHistory,
  handleSearchWalletMessageAttendees,
  WALLET_MESSAGE_SEND_BODY_MAX_BYTES,
} from "./admin/wallet-message-routes.js";
import { handleImportPreview, handleImportCommit, handleGetImportJob, handleGetImportTemplate, handleGetImportHistory, MAX_IMPORT_BODY_BYTES } from "./admin/import-api-routes.js";
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
import {
  handlePatchEventNote,
  handleCreateContact,
  handleUpdateContact,
  handleDeleteContact,
  handleCreateResource,
  handleUpdateResource,
  handleDeleteResource,
} from "./admin/event-context-routes.js";
import {
  handleDeleteUpload,
  handlePostEventBrandingUpload,
  handlePostThemeFontUpload,
  handlePostUpload,
} from "./admin/uploads-api-routes.js";
import {
  handleListEventImageAssets,
  handleCreateEventImageAsset,
  handleUpdateEventImageAsset,
  handleDeleteEventImageAsset,
} from "./admin/event-image-assets-routes.js";
import {
  handleListEventCustomFields,
  handleCreateEventCustomField,
  handlePatchEventCustomField,
  handleDeleteEventCustomField,
} from "./admin/event-custom-fields-routes.js";
import {
  handleListEventTicketTypes,
  handleCreateEventTicketType,
  handlePatchEventTicketType,
  handleDeleteEventTicketType,
  handleCheckinTicketTypes,
} from "./admin/ticket-types-routes.js";
import { resolveUploadDir } from "./admin/branding-upload.js";
import {
  handleGetEventTemplate,
  handlePutEventTemplate,
  handlePreviewEventTemplate,
  handleTestSendEventTemplate,
  handleTestSendEventTemplateById,
  handleListEventDeliveries,
  handleGetEventDelivery,
  handleGetRenderedEventDelivery,
  handleExportEventDeliveries,
  handleListEventTemplates,
  handleGetEventTemplateById,
  handlePutEventTemplateById,
  handlePatchEventTemplateMetadata,
  handleCreateEventTemplate,
  handleDeleteEventTemplate,
  handlePreviewEventTemplateById,
  MAX_TEMPLATE_BODY_BYTES,
  MAX_TEMPLATE_TEST_SEND_BODY_BYTES,
  MAX_TEMPLATE_METADATA_BODY_BYTES,
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
  handlePostMailSettingsProbe,
  MAX_MAIL_SETTINGS_BODY_BYTES,
} from "./admin/mail-settings-routes.js";
import {
  handleGetEventMailSettings,
  handlePutEventMailSettings,
  handleDeleteEventMailSettings,
  handlePostEventMailSettingsTest,
  handlePostEventMailSettingsProbe,
} from "./admin/event-mail-settings-routes.js";
import type { MailSmtpProbeDeps } from "./admin/mail-settings-shared.js";
import {
  handleGetEventBounceIngestSettings,
  handlePutEventBounceIngestSettings,
  handlePostEventBounceIngestSettingsTest,
  handlePostEventBounceIngestSettingsRun,
} from "./admin/event-bounce-ingest-settings-routes.js";
import { handleGetEventLocation, handlePutEventLocation } from "./admin/event-location-routes.js";
import {
  handlePostGeocodingReverse,
  handlePostGeocodingSearch,
  handlePostGeocodingTimezone,
} from "./admin/geocoding-routes.js";
import { handleGetMapsConfig } from "./admin/maps-config-routes.js";
import {
  handleGetExternalServices,
  handlePutWeatherSettings,
  handlePutMapsSettings,
  handlePostWeatherTest,
  handlePostMapsTest,
} from "./admin/external-services-routes.js";
import { buildGeocodingUserAgent } from "./maps/user-agent.js";
import { NominatimProvider } from "./maps/nominatim-provider.js";
import { createGeocodingCache } from "./maps/geocoding-cache.js";
import { GeocodingService } from "./maps/geocoding-service.js";
import { handleGetSetupChecks } from "./admin/setup-checks-routes.js";
import {
  handleAdminHealth,
} from "./admin/health-check-routes.js";
import { handlePostSetupComplete } from "./admin/setup-complete-routes.js";
import {
  handleGetSetupOrgBranding,
  handlePatchSetupOrgBranding,
} from "./admin/setup-org-branding-routes.js";
import {
  handleGetSetupSupportContact,
  handlePatchSetupSupportContact,
} from "./admin/setup-support-contact-routes.js";
import { handleGetSetup, handlePostSetup, resolveStaffEntryPath } from "./setup-routes.js";
import {
  handleGetSessions,
  handleRevokeSession,
  handleUpdateSessionDeviceLabel,
  handleRevokeAllOperatorSessions,
} from "./admin/sessions-routes.js";
import { handleExportAuditLog, handleGetAuditLog } from "./admin/audit-routes.js";
import { handleExportSecurityAuditLog, handleGetSecurityAuditLog } from "./admin/security-audit-routes.js";
import { handleGetSystemLogs } from "./admin/system-log-routes.js";
import {
  handleGetOrganizations,
  handleGetUsers,
  handleGetUserStats,
  handlePostUser,
  handlePatchUser,
  handleDeleteUser,
  handlePostUserRole,
  handleDeleteUserRole,
  handlePostResetUserMfa,
  handleDeleteUserExternalIdentity,
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
  handleDeleteAccountExternalIdentity,
  handleGetAccountSessions,
  handleDeleteAccountSession,
  handleDeleteAccountTrustedDevices,
  handlePostMfaEnroll as handlePostAccountMfaEnroll,
  handleDeleteMfaEnroll as handleDeleteAccountMfaEnroll,
  handlePostMfaConfirm as handlePostAccountMfaConfirm,
  handlePostMfaReset as handlePostAccountMfaReset,
  handlePostAccountWebauthnRegisterBegin,
  handlePostAccountWebauthnRegisterFinish,
  handlePostAccountWebauthnAssertBegin,
  handleGetAccountWebauthnCredentials,
  handleDeleteAccountWebauthnCredential,
  handleDeleteAccountTotp,
  handleGetAccountBackupCodesStatus,
  handlePostAccountRegenerateBackupCodes,
  MAX_WEBAUTHN_BODY_BYTES,
} from "./admin/account-routes.js";
import {
  handleGetSystemSettings,
  handlePatchSystemSettings,
} from "./admin/system-settings-routes.js";
import { handlePostClientError } from "./admin/client-error-routes.js";
import { createStaffSpaHandlers } from "./staff-spa.js";
import { serveFontsourceFonts, serveTablerIcons } from "./vendor-assets.js";
import {
  handleApiListProviders,
  handleApiGetProvider,
  handleApiCreateProvider,
  handleApiUpdateProvider,
  handleApiToggleProvider,
  handleApiDiscoverProvider,
  handleApiDiscoverProviderPreview,
  handleApiTestProviderDraft,
  handleApiTestProvider,
  handleApiGetCfAccess,
  handleApiUpdateCfAccess,
  handleApiTestCfAccess,
} from "./admin/identity-api-routes.js";
import { resolveOidcPublicBaseUrlOrNull } from "./admin/oidc-redirect-uri.js";
import { applyBaselineSecurityHeaders } from "./security-headers.js";
import { createRequestLogMiddleware, resolveLogHttpRequests } from "./request-log.js";
import { resolvePostLoginRedirectForUser } from "./auth/post-login-redirect.js";
import { handleReadyz } from "./ops/readyz.js";
import { handleOpsSystemLogIngest } from "./ops/system-log-ingest.js";
import { emitSystemLog, recordSystemLog } from "@admitto/shared/system-log";

/** Parse check-in history `limit` query param: default 10, clamped to 1–100. */
function parseCheckinHistoryLimit(raw: string | undefined): number {
  const limitParam = Number.parseInt(raw ?? "10", 10);
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
  /** Test-only injection for SMTP connection probe (nodemailer verify). */
  mailProbeDeps?: MailSmtpProbeDeps;
  /** Test-only injection point — bypasses the real Nominatim HTTP adapter. */
  geocodingProvider?: GeocodingProvider;
  /** Test-only injection point - static map PNG resolver for `/m/:eventId.png`. */
  eventStaticMapService?: Pick<EventStaticMapService, "getForEvent">;
  /** Test-only injection point — bypasses PassCreator env config / real HTTP for wallet routes. */
  walletPassProvider?: WalletPassProvider;
  opsHealthToken?: string | null;
  /** JSON access log per request (defaults to `LOG_HTTP_REQUESTS` env). */
  logHttpRequests?: boolean;
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

function htmlWithSecurityHeaders(
  c: Context,
  html: string,
  status: 200 | 404 | 410 | 500,
  theme?: Awaited<ReturnType<typeof getBrandingTheme>> | null,
  logoUrl?: string | null,
) {
  for (const [name, value] of Object.entries(getTicketPageSecurityHeaders(theme, logoUrl))) {
    c.header(name, value);
  }
  return c.html(html, status);
}

/** Shared internal-token-vs-agency-payload branching for the ticket page and the wallet redirect
 * handler - split out of both callers to keep their own cognitive complexity under the SonarCloud
 * threshold (S3776), same reasoning as createApp's own markFailed extraction. Module scope (not a
 * createApp closure) since it captures nothing from there - SonarCloud S7721. `onMissing` builds
 * each caller's own error response (a redirect for the wallet handler, a rendered error page for
 * the ticket page). */
async function resolveQrPayloadOrRespond(
  resolved: NonNullable<Awaited<ReturnType<typeof resolveTicket>>>,
  internalToken: string | undefined,
  logContext: string,
  onMissing: () => Response | Promise<Response>,
): Promise<string | Response> {
  const { attendee } = resolved;
  if (resolved.mode === "internal") {
    if (!internalToken) {
      console.error(`Internal attendee ${attendee.id} missing token for ${logContext}`);
      return onMissing();
    }
    return buildQrPayload("internal", { token: internalToken });
  }
  const agencyPayload = attendee.qr_payload ?? attendee.external_uuid;
  if (!agencyPayload) {
    console.error(`Agency attendee ${attendee.id} has neither qr_payload nor external_uuid`);
    return onMissing();
  }
  return buildQrPayload("agency", { agencyPayload });
}

/** Build the Admitto Hono app (public tickets, auth, check-in API, operator HTML). */
export function createApp(options: CreateAppOptions = {}) {
  const db = options.prisma ?? defaultPrisma;
  const mailInjectedBaseUrl = options.baseUrl;
  const allowCheckinBearer = options.allowCheckinBearer ?? resolveAllowCheckinBearer();
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
    validateTrustedProxyCidrsBootConfig(process.env);
  }

  const checkinGateConfig: CheckinGateConfig = {
    allowBearer: allowCheckinBearer,
    operatorToken: checkinToken,
  };
  const checkinAuthDeps = { prisma: db, config: checkinGateConfig };
  const mailDeliveryDeps = options.mailDeliveryDeps ?? {};
  const mailProbeDeps = options.mailProbeDeps ?? {};
  const geocodingProvider: GeocodingProvider =
    options.geocodingProvider ??
    new NominatimProvider({
      baseUrl: () => resolveGeocodingConfig().baseUrl,
      timeoutMs: () => resolveGeocodingConfig().timeoutMs,
      buildUserAgent: () => buildGeocodingUserAgent(db),
    });
  const geocodingService = new GeocodingService(
    geocodingProvider,
    createGeocodingCache(),
    () => resolveGeocodingConfig().baseUrl,
  );
  const eventStaticMapService = options.eventStaticMapService ?? new EventStaticMapService();

  // UI maps settings into the sync cache used by list cards / static maps / health.
  void refreshMapsConfigCache(db).catch((err) => {
    console.error("maps config cache refresh failed:", err);
    setMapsConfigCache(builtInMapsConfig());
  });
  // Other instances that save maps settings publish on Redis; mark this process stale.
  startMapsConfigInvalidationSubscriber();

  const app = new Hono();
  // Catch route errors once with enough request context in System logs. Keep raw exception
  // diagnostics on stderr. Live-tail gets error class/code only - never stack, Prisma detail,
  // or concrete request paths beyond the matched route template.
  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();

    console.error("unhandled_exception:", err);
    // Hono only invokes onError for Error instances (non-Error throws bypass it).
    const errorName = err.name;
    const errorCode =
      "code" in err && typeof err.code === "string" ? err.code : undefined;
    emitSystemLog("api", "error", "unhandled_exception", {
      method: c.req.method,
      path: c.req.routePath || "/[unmatched]",
      error_name: errorName,
      ...(errorCode ? { error_code: errorCode } : {}),
    });
    return c.json({ error: "internal_error" }, 500);
  });
  // First middleware so the access log also covers 404s and rate-limited requests.
  if (options.logHttpRequests ?? resolveLogHttpRequests()) {
    app.use("*", createRequestLogMiddleware());
  }
  // Applied after next() so it lands on responses handlers build via c.json()/c.body()
  // AND ones that return a bare `new Response(...)` (e.g. CSV/PDF/XLSX exports) — Hono only
  // merges pre-next() c.header() calls into responses built through its own c.json()/c.body().
  app.use("/api/*", async (c, next) => {
    await next();
    applyBaselineSecurityHeaders((name, value) => c.header(name, value));
  });
  const rateLimitStore = options.rateLimitStore ?? createRateLimitStore();
  const opsHealthToken = resolveOpsHealthTokenOption(options.opsHealthToken);
  const readyzRateLimit = rateLimit(rateLimitStore, "ops:readyz");
  const opsSystemLogRateLimit = rateLimit(rateLimitStore, "ops:system-logs");
  const walletWebhookRateLimit = rateLimit(rateLimitStore, "wallet:webhook");
  const healthzRateLimit = createHealthzRateLimitMiddleware(rateLimitStore);
  const publicRateLimit = createPublicRateLimitMiddleware(rateLimitStore);
  const loginRateLimitJson = createLoginRateLimitMiddleware(rateLimitStore, { format: "json" });
  const loginRateLimitHtml = createLoginRateLimitMiddleware(rateLimitStore, { format: "text" });
  const accountIpRateLimit = rateLimit(rateLimitStore, "auth:account-ip");
  const oidcAuthRateLimit = rateLimit(rateLimitStore, "auth:oidc");
  const mfaEnrollRateLimitJson = createMfaEnrollRateLimitMiddleware(rateLimitStore, { format: "json" });
  const mfaEnrollRateLimitHtml = createMfaEnrollRateLimitMiddleware(rateLimitStore, { format: "text" });
  const htmlPostCsrf = createCrossSitePostGuard({ format: "text" });
  const jsonPostCsrf = createCrossSitePostGuard({ format: "json" });
  const resolveStaffEntry = () => resolveStaffEntryPath(db);
  const requireSession = createRequireSession(db);
  const requireSessionHtml = createRequireSession(db, { resolveRedirectTo: resolveStaffEntry });
  const requirePartialSession = createRequirePartialSession(db);
  const requirePartialSessionHtml = createRequirePartialSession(db, {
    resolveRedirectTo: resolveStaffEntry,
  });
  // Forced password change is its own constrained stage; only sessions in that
  // stage may reach `/change-password`, and full sessions never can (IAM-001).
  const requireChangePasswordSession = createRequirePartialSession(db, {
    resolveRedirectTo: resolveStaffEntry,
    allowedStages: [SESSION_STAGE.CHANGE_PASSWORD_REQUIRED],
  });
  const requireAdminAccess = createAdminAccessMiddleware(db);
  const staffAdminGate = createStaffAdminGate(db);
  /** Middleware: event manage access, then archived read-only guard, then route handler. */
  const guardArchivedEvent = (handler: (c: Context) => Response | Promise<Response>) =>
    withEventArchiveGuard(db, handler);
  const adminResendRateLimit = rateLimit(rateLimitStore, "admin:resend");
  const adminBulkResendRateLimit = rateLimit(rateLimitStore, "admin:resend-bulk");
  const adminPiiExportRateLimit = rateLimit(rateLimitStore, "admin:export-pii");
  const adminExportRateLimit = rateLimit(rateLimitStore, "admin:export");
  const adminCommunicationRateLimit = rateLimit(rateLimitStore, "admin:test-send");
  const adminMailSettingsRateLimit = rateLimit(rateLimitStore, "admin:mail-transport-test");
  const adminEventMailSettingsRateLimit = rateLimit(rateLimitStore, "admin:event-mail-transport-test");
  const adminHealthLiveRateLimit = rateLimit(rateLimitStore, "admin:health-live");
  const adminImportPreviewRateLimit = rateLimit(rateLimitStore, "admin:import-preview");
  const adminAttendeesSearchRateLimit = rateLimit(rateLimitStore, "admin:attendees-search");
  const adminGeocodingSearchRateLimit = rateLimit(rateLimitStore, "admin:geocoding-search");
  const adminGeocodingTimezoneRateLimit = rateLimit(rateLimitStore, "admin:geocoding-timezone");
  const adminImportCommitRateLimit = rateLimit(rateLimitStore, "admin:import-commit");
  const adminImportJobStatusRateLimit = rateLimit(rateLimitStore, "admin:import-job-status");
  const adminWalletPushJobStatusRateLimit = rateLimit(rateLimitStore, "admin:wallet-push-job-status");
  const adminWalletMessageJobStatusRateLimit = rateLimit(rateLimitStore, "admin:wallet-message-job-status");
  const adminWalletMessageSendRateLimit = rateLimit(rateLimitStore, "admin:wallet-message-send");
  const adminAttendeePatchRateLimit = rateLimit(rateLimitStore, "admin:attendee-patch");
  const adminTemplatePreviewRateLimit = rateLimit(rateLimitStore, "admin:template-preview");
  const adminAuthProviderOpsRateLimit = rateLimit(rateLimitStore, "admin:oidc-provider-ops");
  const checkinScanRateLimit = rateLimit(rateLimitStore, "checkin:scan");
  const checkinHistoryRateLimit = rateLimit(rateLimitStore, "checkin:history");
  const checkinStreamRateLimit = rateLimit(rateLimitStore, "checkin:stream");
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
  const templateMetadataBodyLimit = bodyLimit({
    maxSize: MAX_TEMPLATE_METADATA_BODY_BYTES,
    onError: (c) => c.json({ error: "request too large" }, 400),
  });
  const mailSettingsBodyLimit = bodyLimit({
    maxSize: MAX_MAIL_SETTINGS_BODY_BYTES,
    onError: (c) => c.json({ error: "request too large" }, 400),
  });
  const walletMessageBodyLimit = bodyLimit({
    maxSize: WALLET_MESSAGE_SEND_BODY_MAX_BYTES,
    onError: (c) => c.json({ error: "request too large" }, 400),
  });
  const uploadBodyLimit = bodyLimit({
    maxSize: Math.ceil(2.1 * 1024 * 1024),
    onError: (c) => c.json({ error: "file too large" }, 413),
  });
  // Font files run larger than the branding-image cap above (MAX_FONT_UPLOAD_BYTES, branding-upload.ts).
  const fontUploadBodyLimit = bodyLimit({
    maxSize: Math.ceil(5.1 * 1024 * 1024),
    onError: (c) => c.json({ error: "file too large" }, 413),
  });
  // Every route that can carry a WebAuthn ceremony response (registration, assertion, or a
  // step-up proof on an account-security action) - bounds the decode/CBOR-parse/crypto-verify
  // work `@simplewebauthn/server` does on the body, and rejects an oversized request before it's
  // ever buffered/parsed, not just once the zod schema's own `.max()` calls see it.
  const webauthnBodyLimit = bodyLimit({
    maxSize: MAX_WEBAUTHN_BODY_BYTES,
    onError: (c) => c.json({ error: "request too large" }, 400),
  });
  const checkInPanelGuard = createCheckInPanelCapabilityGuard(db);
  const staffSpa = createStaffSpaHandlers({ distRoot: options.adminDistRoot, db });

  void sweepExpiredOidcAuthStates(db).catch((err) => {
    console.error("OidcAuthState sweep failed:", err);
  });

  async function loadOptionalBrandingTheme() {
    try {
      return await getBrandingTheme(db);
    } catch {
      return null;
    }
  }

  /** Branded public HTML 404/500. Theme load is optional: skip on global misses (no DB flood). */
  async function renderPublicHtmlError(
    c: Context,
    status: 404 | 500,
    options: { loadTheme?: boolean } = {},
  ) {
    const theme = options.loadTheme === false ? null : await loadOptionalBrandingTheme();
    const html = status === 404 ? renderNotFound(theme) : renderServerError(theme);
    return htmlWithSecurityHeaders(c, html, status, theme);
  }

  /**
   * On-demand wallet pass: creates (once) or reuses the attendee's WalletPass, then 302s to the
   * provider URL. Never a bare 500 - failures redirect back to the ticket page with a retry
   * notice (ADR 0041 §3b).
   */
  async function handleWalletRedirect(
    c: Context,
    resolved: NonNullable<Awaited<ReturnType<typeof resolveTicket>>>,
    platform: "apple" | "google",
    backHref: string,
    internalToken?: string,
  ): Promise<Response> {
    const { attendee, event } = resolved;

    if (!isAdmittable(attendee.status as AttendeeStatus)) {
      return c.redirect(backHref, 302);
    }
    const platformEnabled =
      event.walletEnabled &&
      (platform === "apple" ? event.walletAppleEnabled : event.walletGoogleEnabled);
    if (!platformEnabled) {
      return c.redirect(backHref, 302);
    }
    const walletProvider = resolveWalletProvider(event, options.walletPassProvider);
    if (!walletProvider) {
      return c.redirect(`${backHref}?walletError=1`, 302);
    }
    const provider: WalletPassProvider = walletProvider;

    // Same QR payload the attendee's own ticket page encodes - the wallet pass's barcode must
    // match it exactly, or scanning the wallet pass at check-in won't resolve to this attendee.
    const qrPayloadResult = await resolveQrPayloadOrRespond(resolved, internalToken, "wallet QR", () =>
      c.redirect(`${backHref}?walletError=1`, 302),
    );
    if (typeof qrPayloadResult !== "string") return qrPayloadResult;
    // Narrowed local: a nested function declaration below (resolvePassUrls) doesn't inherit the
    // typeof-narrowing above on the outer closure variable (see AGENTS.md's React-state note for
    // the same TypeScript limitation) - capture it as a definitely-string const instead.
    const qrPayload: string = qrPayloadResult;

    let existing: Awaited<ReturnType<typeof db.walletPass.findUnique>>;
    try {
      existing = await db.walletPass.findUnique({ where: { attendee_id: attendee.id } });
    } catch (err) {
      console.error("walletPass lookup failed:", err);
      recordSystemLog({
        level: "error",
        source: "api",
        message: "wallet_pass_lookup_failed",
        fields: { eventId: event.id, attendeeId: attendee.id },
      });
      return c.redirect(`${backHref}?walletError=1`, 302);
    }

    /** Returns null (after logging) instead of throwing - a database error here must still land
     * on the retry redirect below, not escape to app.onError as a bare JSON 500. */
    async function markActive(
      userProvidedId: string,
      result: WalletPassResult,
    ): Promise<{ apple_url: string | null; android_url: string | null } | null> {
      try {
        await db.walletPass.upsert({
          where: { attendee_id: attendee.id },
          create: {
            attendee_id: attendee.id,
            provider: "passcreator",
            provider_pass_id: result.providerPassId,
            user_provided_id: userProvidedId,
            download_url: result.downloadUrl,
            apple_url: result.appleUrl,
            android_url: result.androidUrl,
            status: "active",
            issued_at: new Date(),
          },
          update: {
            provider: "passcreator",
            provider_pass_id: result.providerPassId,
            user_provided_id: userProvidedId,
            download_url: result.downloadUrl,
            apple_url: result.appleUrl,
            android_url: result.androidUrl,
            status: "active",
            last_error_code: null,
            issued_at: new Date(),
          },
        });
      } catch (err) {
        console.error("walletPass upsert (active) failed:", err);
        recordSystemLog({
          level: "error",
          source: "api",
          message: "wallet_pass_upsert_failed",
          fields: { eventId: event.id, attendeeId: attendee.id },
        });
        return null;
      }
      return { apple_url: result.appleUrl, android_url: result.androidUrl };
    }

    /** Marks the pass "failed" after an unrecoverable createPass error - split out of
     * createOrRecoverPass to keep its cognitive complexity under the SonarCloud threshold
     * (S3776). Never throws: a DB error here must still land on the retry redirect below. */
    async function markFailed(code: WalletProviderErrorCode): Promise<null> {
      try {
        await db.walletPass.upsert({
          where: { attendee_id: attendee.id },
          create: { attendee_id: attendee.id, status: "failed", last_error_code: code },
          update: { status: "failed", last_error_code: code },
        });
      } catch (upsertErr) {
        console.error("walletPass upsert (failed) failed:", upsertErr);
        recordSystemLog({
          level: "error",
          source: "api",
          message: "wallet_pass_upsert_failed",
          fields: { eventId: event.id, attendeeId: attendee.id },
        });
      }
      return null;
    }

    /** Un-voids an already-issued pass at the provider (e.g. after a staff-only "Void wallet
     * pass" action, independent of the attendee's own admittable status) instead of treating a
     * voided WalletPass row as "never created": createPass would just get rejected as a
     * duplicate on the shared userProvidedId, and recovering that rejection via
     * findByUserProvidedId would mark the row "active" locally without ever calling restorePass,
     * leaving the pass permanently voided at the provider while Admitto believes it's valid
     * again and hides the Restore action (CodeRabbit review). Never throws: a provider/DB error
     * here must still land on the retry redirect below. */
    async function restoreExistingPass(
      providerPassId: string,
    ): Promise<{ apple_url: string | null; android_url: string | null } | null> {
      try {
        await provider.restorePass(providerPassId);
      } catch (err) {
        console.error("PassCreator restorePass failed:", err);
        recordSystemLog({
          level: "error",
          source: "api",
          message: "wallet_pass_restore_failed",
          fields: { eventId: event.id, attendeeId: attendee.id },
        });
        return null;
      }
      try {
        const row = await db.walletPass.update({
          where: { attendee_id: attendee.id },
          data: { status: "active", voided_at: null, last_error_code: null },
        });
        return { apple_url: row.apple_url, android_url: row.android_url };
      } catch (err) {
        console.error("walletPass update (restore) failed:", err);
        recordSystemLog({
          level: "error",
          source: "api",
          message: "wallet_pass_upsert_failed",
          fields: { eventId: event.id, attendeeId: attendee.id },
        });
        return null;
      }
    }

    /**
     * A concurrent request for the same attendee can win the race and create the pass first -
     * PassCreator then rejects this one as a duplicate on the shared userProvidedId. Recovers the
     * winner's pass instead of overwriting its "active" row with "failed" (which would otherwise
     * make every later click retry forever against an already-existing pass). Returns null (after
     * marking the pass failed and logging) when creation could not be recovered.
     */
    async function createOrRecoverPass(
      input: WalletPassInput,
    ): Promise<{ apple_url: string | null; android_url: string | null } | null> {
      try {
        const result = await provider.createPass(input);
        return await markActive(input.userProvidedId, result);
      } catch (err) {
        const code = err instanceof WalletProviderError ? err.code : "wallet_provider_rejected";
        const recovered =
          code === "wallet_provider_duplicate"
            ? await provider.findByUserProvidedId(input.userProvidedId).catch(() => null)
            : null;
        if (recovered) return markActive(input.userProvidedId, recovered);

        console.error("PassCreator createPass failed:", err);
        recordSystemLog({
          level: "error",
          source: "api",
          message: "wallet_pass_create_failed",
          fields: { eventId: event.id, attendeeId: attendee.id, errorCode: code },
        });
        return markFailed(code);
      }
    }

    /** Dispatches on the existing WalletPass row's status - split out of the main handler body to
     * keep its cognitive complexity under the SonarCloud threshold (S3776). Returns null (after
     * the callee's own logging) when none of the three paths could produce a usable URL. */
    async function resolvePassUrls(): Promise<{ apple_url: string | null; android_url: string | null } | null> {
      if (existing?.status === "active") {
        return { apple_url: existing.apple_url, android_url: existing.android_url };
      }
      if (existing?.status === "voided" && existing.provider_pass_id) {
        return restoreExistingPass(existing.provider_pass_id);
      }
      const display = await resolveTicketPageDisplay(db, resolved);
      const input = buildWalletPassInput(display, qrPayload);
      return createOrRecoverPass(input);
    }

    const providerUrls = await resolvePassUrls();
    if (!providerUrls) return c.redirect(`${backHref}?walletError=1`, 302);

    const url = platform === "apple" ? providerUrls.apple_url : providerUrls.android_url;
    if (!url) {
      return c.redirect(`${backHref}?walletError=1`, 302);
    }
    return c.redirect(url, 302);
  }

  async function renderTicketPage(
    c: Context,
    resolved: NonNullable<Awaited<ReturnType<typeof resolveTicket>>>,
    internalToken?: string,
    route = "/t/:token",
    agencyPublicRef?: string,
  ) {
    const { attendee, event } = resolved;

    if (!isAdmittable(attendee.status as AttendeeStatus)) {
      const reason: "revoked" | "cancelled" =
        attendee.status === "cancelled" ? "cancelled" : "revoked";
      let theme;
      try {
        theme = await getBrandingTheme(db);
      } catch {
        theme = null;
      }
      const resolvedForDisplay = await resolveTicketPageDisplay(db, resolved);
      return htmlWithSecurityHeaders(
        c,
        renderRevoked(resolvedForDisplay, theme, reason),
        410,
        theme,
        resolvedForDisplay.event.logoUrl,
      );
    }

    const qrPayload = await resolveQrPayloadOrRespond(resolved, internalToken, "ticket page QR", () =>
      renderPublicHtmlError(c, 500),
    );
    if (typeof qrPayload !== "string") return qrPayload;

    let qrDataUrl: string;
    try {
      const qrPng = await generateQrPng(qrPayload);
      qrDataUrl = `data:image/png;base64,${qrPng.toString("base64")}`;
    } catch (err) {
      console.error("generateQrPng failed:", err);
      recordSystemLog({
        level: "error",
        source: "api",
        message: "qr_png_generation_failed",
        fields: { route },
      });
      return renderPublicHtmlError(c, 500);
    }

    try {
      await recordTicketViewed(attendee.id, event.id, db);
    } catch (err) {
      console.error("recordTicketViewed failed:", err);
    }

    const theme = await loadOptionalBrandingTheme();

    const resolvedForDisplay = await resolveTicketPageDisplay(db, resolved);
    const displayToken = resolveDisplayToken(internalToken, agencyPublicRef);

    const mapTiles = resolveMapTileConfig();
    let weather = null;
    try {
      const weatherService = await createWeatherServiceFromDb(db);
      weather = await weatherService.summarize({
        latitude: resolvedForDisplay.event.latitude,
        longitude: resolvedForDisplay.event.longitude,
        date: resolvedForDisplay.event.date,
        timezone: resolvedForDisplay.event.timezone || "UTC",
      });
    } catch (err) {
      console.error("weather summarize failed for ticket page:", err);
      weather = null;
    }
    const walletBase =
      route === "/t/:eventSlug/a/:ref"
        ? `/t/${resolvedForDisplay.event.slug}/a/${agencyPublicRef}`
        : `/t/${internalToken}`;
    // No template or API key configured for this event yet (Event settings -> Wallet) - the
    // /wallet/:platform routes would only redirect back with walletError=1 (resolveWalletProvider
    // returns null without both), so don't offer them. The master switch and each platform's own
    // toggle independently gate visibility too. `options.walletPassProvider` is the same test-only
    // injection escape hatch resolveWalletProvider itself checks first.
    const walletConfigured =
      resolvedForDisplay.event.walletEnabled &&
      resolvedForDisplay.event.walletTemplateId !== null &&
      (options.walletPassProvider !== undefined || resolvedForDisplay.event.walletApiKeyEnc !== null);
    const appleWalletVisible = walletConfigured && resolvedForDisplay.event.walletAppleEnabled;
    const googleWalletVisible = walletConfigured && resolvedForDisplay.event.walletGoogleEnabled;
    return htmlWithSecurityHeaders(
      c,
      renderTicket(resolvedForDisplay, qrDataUrl, theme, {
        displayToken,
        staticMapEnabled: mapTiles.enabled,
        weather,
        ...(appleWalletVisible ? { walletAppleHref: `${walletBase}/wallet/apple` } : {}),
        ...(googleWalletVisible ? { walletGoogleHref: `${walletBase}/wallet/google` } : {}),
        walletError: c.req.query("walletError") === "1",
      }),
      200,
      theme,
      resolvedForDisplay.event.logoUrl,
    );
  }

  app.get("/healthz", healthzRateLimit, (c) => handleHealthz(c, db));
  app.get("/robots.txt", handleGetRobotsTxt);
  app.get("/favicon.svg", handleGetFaviconSvg);
  app.get("/favicon-32.png", handleGetFavicon32Png);
  app.get("/favicon.ico", handleGetFaviconIco);
  app.get("/apple-touch-icon.png", handleGetAppleTouchIcon);
  app.get("/apple-touch-icon-precomposed.png", handleGetAppleTouchIconPrecomposed);
  app.get("/assets/admitto-mark.svg", handleGetAdmittoMark);
  app.get("/assets/admitto-logo.svg", handleGetAdmittoLogo);
  app.get("/assets/apple-wallet-badge.svg", handleGetAppleWalletBadge);
  app.get("/assets/google-wallet-badge.svg", handleGetGoogleWalletBadge);
  app.get("/assets/apple-wallet-badge.png", handleGetAppleWalletBadgePng);
  app.get("/assets/google-wallet-badge.png", handleGetGoogleWalletBadgePng);
  app.get("/readyz", readyzRateLimit, (c) =>
    handleReadyz(c, {
      db,
      rateLimitStore,
      opsHealthToken,
      env: process.env,
    }),
  );
  app.post("/api/ops/system-logs", opsSystemLogRateLimit, (c) =>
    handleOpsSystemLogIngest(c, { opsHealthToken }),
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
  // Delete is intentionally not wrapped in guardArchivedEvent: it does NOT require the
  // event to be archived (isEventDeletable in event-deletion.ts checks remaining content
  // signals only, never archived_at), so gating it behind "already archived" would be
  // the opposite of that guard's "block mutations on archived events" purpose.
  app.delete("/api/admin/events/:eventId", jsonPostCsrf, staffAdminGate, (c) =>
    handleDeleteEvent(c, db),
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
  app.post(
    "/api/admin/events/:eventId/wallet/test",
    jsonPostCsrf,
    staffAdminGate,
    guardArchivedEvent((c) => handlePostEventWalletTest(c, db)),
  );
  app.get("/api/admin/events/:eventId/mail-settings", staffAdminGate, (c) =>
    handleGetEventMailSettings(c, db),
  );
  app.put(
    "/api/admin/events/:eventId/mail-settings",
    mailSettingsBodyLimit,
    jsonPostCsrf,
    staffAdminGate,
    guardArchivedEvent((c) => handlePutEventMailSettings(c, db)),
  );
  app.delete(
    "/api/admin/events/:eventId/mail-settings",
    jsonPostCsrf,
    staffAdminGate,
    guardArchivedEvent((c) => handleDeleteEventMailSettings(c, db)),
  );
  app.post(
    "/api/admin/events/:eventId/mail-settings/test",
    jsonPostCsrf,
    staffAdminGate,
    adminEventMailSettingsRateLimit,
    guardArchivedEvent((c) => handlePostEventMailSettingsTest(c, db, mailDeliveryDeps)),
  );
  app.post(
    "/api/admin/events/:eventId/mail-settings/probe",
    jsonPostCsrf,
    staffAdminGate,
    adminEventMailSettingsRateLimit,
    guardArchivedEvent((c) => handlePostEventMailSettingsProbe(c, db, mailProbeDeps)),
  );
  app.get("/api/admin/events/:eventId/bounce-ingest-settings", staffAdminGate, (c) =>
    handleGetEventBounceIngestSettings(c, db),
  );
  app.put(
    "/api/admin/events/:eventId/bounce-ingest-settings",
    mailSettingsBodyLimit,
    jsonPostCsrf,
    staffAdminGate,
    guardArchivedEvent((c) => handlePutEventBounceIngestSettings(c, db)),
  );
  app.post(
    "/api/admin/events/:eventId/bounce-ingest-settings/test",
    jsonPostCsrf,
    staffAdminGate,
    adminEventMailSettingsRateLimit,
    guardArchivedEvent((c) => handlePostEventBounceIngestSettingsTest(c, db)),
  );
  app.post(
    "/api/admin/events/:eventId/bounce-ingest-settings/run",
    jsonPostCsrf,
    staffAdminGate,
    adminEventMailSettingsRateLimit,
    guardArchivedEvent((c) => handlePostEventBounceIngestSettingsRun(c, db)),
  );
  app.get("/api/admin/events/:eventId/location", staffAdminGate, (c) => handleGetEventLocation(c, db));
  app.put(
    "/api/admin/events/:eventId/location",
    jsonPostCsrf,
    staffAdminGate,
    guardArchivedEvent((c) => handlePutEventLocation(c, db)),
  );
  app.post(
    "/api/admin/geocoding/search",
    jsonPostCsrf,
    staffAdminGate,
    adminGeocodingSearchRateLimit,
    (c) => handlePostGeocodingSearch(c, db, geocodingService),
  );
  // Shares the same per-user API rate limit as search. Nominatim's ≤1 req/s Usage Policy is
  // enforced inside NominatimProvider around real upstream calls (not on Redis cache hits).
  app.post(
    "/api/admin/geocoding/reverse",
    jsonPostCsrf,
    staffAdminGate,
    adminGeocodingSearchRateLimit,
    (c) => handlePostGeocodingReverse(c, db, geocodingService),
  );
  // Offline geo-tz lookup (no Nominatim) — does not share the Nominatim 1 req/s budget.
  app.post(
    "/api/admin/geocoding/timezone",
    jsonPostCsrf,
    staffAdminGate,
    adminGeocodingTimezoneRateLimit,
    (c) => handlePostGeocodingTimezone(c),
  );
  app.get("/api/admin/maps/config", staffAdminGate, (c) => handleGetMapsConfig(c, db));
  app.get("/api/admin/external-services", staffAdminGate, (c) => handleGetExternalServices(c, db));
  app.put(
    "/api/admin/external-services/weather",
    mailSettingsBodyLimit,
    jsonPostCsrf,
    staffAdminGate,
    (c) => handlePutWeatherSettings(c, db),
  );
  app.put(
    "/api/admin/external-services/maps",
    mailSettingsBodyLimit,
    jsonPostCsrf,
    staffAdminGate,
    (c) => handlePutMapsSettings(c, db),
  );
  app.post(
    "/api/admin/external-services/weather/test",
    mailSettingsBodyLimit,
    jsonPostCsrf,
    staffAdminGate,
    (c) => handlePostWeatherTest(c, db),
  );
  app.post(
    "/api/admin/external-services/maps/test",
    mailSettingsBodyLimit,
    jsonPostCsrf,
    staffAdminGate,
    (c) => handlePostMapsTest(c, db),
  );
  app.post(
    "/api/admin/events/:eventId/branding-upload",
    jsonPostCsrf,
    staffAdminGate,
    uploadBodyLimit,
    guardArchivedEvent((c) => handlePostEventBrandingUpload(c, db)),
  );
  app.get("/api/admin/events/:eventId/image-assets", staffAdminGate, (c) =>
    handleListEventImageAssets(c, db),
  );
  app.post(
    "/api/admin/events/:eventId/image-assets",
    jsonPostCsrf,
    staffAdminGate,
    uploadBodyLimit,
    guardArchivedEvent((c) => handleCreateEventImageAsset(c, db)),
  );
  app.patch(
    "/api/admin/events/:eventId/image-assets/:assetId",
    jsonPostCsrf,
    staffAdminGate,
    uploadBodyLimit,
    guardArchivedEvent((c) => handleUpdateEventImageAsset(c, db)),
  );
  app.delete(
    "/api/admin/events/:eventId/image-assets/:assetId",
    jsonPostCsrf,
    staffAdminGate,
    guardArchivedEvent((c) => handleDeleteEventImageAsset(c, db)),
  );
  app.get("/api/admin/events/:eventId/custom-fields", staffAdminGate, (c) =>
    handleListEventCustomFields(c, db),
  );
  app.post(
    "/api/admin/events/:eventId/custom-fields",
    jsonPostCsrf,
    staffAdminGate,
    guardArchivedEvent((c) => handleCreateEventCustomField(c, db)),
  );
  app.patch(
    "/api/admin/events/:eventId/custom-fields/:fieldId",
    jsonPostCsrf,
    staffAdminGate,
    guardArchivedEvent((c) => handlePatchEventCustomField(c, db)),
  );
  app.delete(
    "/api/admin/events/:eventId/custom-fields/:fieldId",
    jsonPostCsrf,
    staffAdminGate,
    guardArchivedEvent((c) => handleDeleteEventCustomField(c, db)),
  );
  app.get("/api/admin/events/:eventId/export-pii", staffAdminGate, adminPiiExportRateLimit, (c) =>
    handleExportEventPii(c, db),
  );
  app.get("/api/admin/events/:eventId/ticket-types", staffAdminGate, (c) =>
    handleListEventTicketTypes(c, db),
  );
  app.post(
    "/api/admin/events/:eventId/ticket-types",
    jsonPostCsrf,
    staffAdminGate,
    guardArchivedEvent((c) => handleCreateEventTicketType(c, db)),
  );
  app.patch(
    "/api/admin/events/:eventId/ticket-types/:typeId",
    jsonPostCsrf,
    staffAdminGate,
    guardArchivedEvent((c) => handlePatchEventTicketType(c, db)),
  );
  app.delete(
    "/api/admin/events/:eventId/ticket-types/:typeId",
    jsonPostCsrf,
    staffAdminGate,
    guardArchivedEvent((c) => handleDeleteEventTicketType(c, db)),
  );
  app.get("/api/admin/events/:eventId/attendees/export", staffAdminGate, adminExportRateLimit, (c) =>
    handleExportAttendees(c, db),
  );
  app.get("/api/admin/events/:eventId/export/jobs/:jobId", staffAdminGate, (c) =>
    handleGetExportJob(c, db),
  );
  app.get("/api/admin/events/:eventId/export/jobs/:jobId/download", staffAdminGate, (c) =>
    handleDownloadExportJob(c, db),
  );
  app.get(
    "/api/admin/events/:eventId/wallet-push/jobs/:jobId",
    staffAdminGate,
    adminWalletPushJobStatusRateLimit,
    (c) => handleGetWalletPushJob(c, db),
  );
  app.get("/api/admin/events/:eventId/wallet-push/history", staffAdminGate, (c) =>
    handleGetWalletPushHistory(c, db),
  );
  app.post(
    "/api/admin/events/:eventId/wallet-message/send",
    jsonPostCsrf,
    staffAdminGate,
    walletMessageBodyLimit,
    skipWalletMessageRateLimitForDryRun,
    adminWalletMessageSendRateLimit,
    guardArchivedEvent((c) => handleWalletMessageSend(c, db)),
  );
  app.get(
    "/api/admin/events/:eventId/wallet-message/jobs/:jobId",
    staffAdminGate,
    adminWalletMessageJobStatusRateLimit,
    (c) => handleGetWalletMessageJob(c, db),
  );
  app.get("/api/admin/events/:eventId/wallet-message/history", staffAdminGate, (c) =>
    handleGetWalletMessageHistory(c, db),
  );
  app.get(
    "/api/admin/events/:eventId/wallet-message/attendees",
    staffAdminGate,
    adminAttendeesSearchRateLimit,
    (c) => handleSearchWalletMessageAttendees(c, db),
  );
  app.post(
    "/api/admin/events/:eventId/attendees/export-selected",
    jsonPostCsrf,
    staffAdminGate,
    adminExportRateLimit,
    (c) => handleExportSelectedAttendees(c, db),
  );
  app.get(
    "/api/admin/events/:eventId/attendees",
    staffAdminGate,
    adminAttendeesSearchRateLimit,
    (c) => handleListEventAttendees(c, db),
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
    guardArchivedEvent((c) => handleBulkResendTickets(c, db, mailDeliveryDeps, mailInjectedBaseUrl)),
  );
  app.get("/api/admin/events/:eventId/attendees/:id", staffAdminGate, (c) =>
    handleGetEventAttendee(c, db),
  );
  app.patch(
    "/api/admin/events/:eventId/attendees/:id",
    jsonPostCsrf,
    staffAdminGate,
    adminAttendeePatchRateLimit,
    guardArchivedEvent((c) => handlePatchEventAttendee(c, db)),
  );
  app.delete("/api/admin/events/:eventId/attendees/:id", jsonPostCsrf, staffAdminGate, (c) =>
    handleDeleteEventAttendee(c, db),
  );
  app.post(
    "/api/admin/events/:eventId/attendees/bulk-delete",
    jsonPostCsrf,
    staffAdminGate,
    (c) => handleBulkDeleteEventAttendees(c, db),
  );
  app.post(
    "/api/admin/events/:eventId/attendees/bulk-checkin",
    jsonPostCsrf,
    staffAdminGate,
    guardArchivedEvent((c) => handleBulkCheckInEventAttendees(c, db)),
  );
  app.post(
    "/api/admin/events/:eventId/attendees/bulk-revoke-checkin",
    jsonPostCsrf,
    staffAdminGate,
    guardArchivedEvent((c) => handleBulkRevokeCheckInEventAttendees(c, db)),
  );
  app.post(
    "/api/admin/events/:eventId/attendees/bulk-revoke-items",
    jsonPostCsrf,
    staffAdminGate,
    guardArchivedEvent((c) => handleBulkRevokeAttendeeItems(c, db)),
  );
  app.post(
    "/api/admin/events/:eventId/attendees/bulk-revoke-pass",
    jsonPostCsrf,
    staffAdminGate,
    guardArchivedEvent((c) => handleBulkRevokeAttendeePass(c, db)),
  );
  app.post(
    "/api/admin/events/:eventId/attendees/bulk-wallet-void",
    jsonPostCsrf,
    staffAdminGate,
    guardArchivedEvent((c) => handleBulkVoidAttendeeWalletPass(c, db)),
  );
  app.post(
    "/api/admin/events/:eventId/attendees/bulk-wallet-reissue",
    jsonPostCsrf,
    staffAdminGate,
    guardArchivedEvent((c) => handleBulkReissueAttendeeWalletPass(c, db)),
  );
  app.post(
    "/api/admin/events/:eventId/attendees/bulk-wallet-delete",
    jsonPostCsrf,
    staffAdminGate,
    guardArchivedEvent((c) => handleBulkDeleteAttendeeWalletPass(c, db)),
  );
  app.post(
    "/api/admin/events/:eventId/attendees/bulk-ticket-type",
    jsonPostCsrf,
    staffAdminGate,
    guardArchivedEvent((c) => handleBulkTicketTypeEventAttendees(c, db)),
  );
  app.post(
    "/api/admin/events/:eventId/attendees/bulk-rsvp",
    jsonPostCsrf,
    staffAdminGate,
    guardArchivedEvent((c) => handleBulkRsvpEventAttendees(c, db)),
  );
  app.post(
    "/api/admin/events/:eventId/attendees/:id/resend",
    jsonPostCsrf,
    staffAdminGate,
    adminResendRateLimit,
    guardArchivedEvent((c) => handleResendEventAttendeeTicket(c, db, mailDeliveryDeps, mailInjectedBaseUrl)),
  );
  app.post(
    "/api/admin/events/:eventId/attendees/:id/ticket-link",
    jsonPostCsrf,
    staffAdminGate,
    (c) => handleGetAttendeeTicketLink(c, db, mailInjectedBaseUrl),
  );
  app.post(
    "/api/admin/events/:eventId/attendees/:id/dismiss-bounce",
    jsonPostCsrf,
    staffAdminGate,
    guardArchivedEvent((c) => handleDismissAttendeeBounce(c, db)),
  );
  app.post(
    "/api/admin/events/:eventId/attendees/:id/revoke-checkin",
    jsonPostCsrf,
    staffAdminGate,
    guardArchivedEvent((c) => handleRevokeAttendeeCheckIn(c, db)),
  );
  app.post(
    "/api/admin/events/:eventId/attendees/:id/wallet/void",
    jsonPostCsrf,
    staffAdminGate,
    guardArchivedEvent((c) => handleVoidAttendeeWalletPass(c, db)),
  );
  app.post(
    "/api/admin/events/:eventId/attendees/:id/wallet/restore",
    jsonPostCsrf,
    staffAdminGate,
    guardArchivedEvent((c) => handleRestoreAttendeeWalletPass(c, db)),
  );
  app.post(
    "/api/admin/events/:eventId/attendees/:id/wallet/reissue",
    jsonPostCsrf,
    staffAdminGate,
    guardArchivedEvent((c) => handleReissueAttendeeWalletPass(c, db)),
  );
  app.post(
    "/api/admin/events/:eventId/attendees/:id/wallet/delete",
    jsonPostCsrf,
    staffAdminGate,
    guardArchivedEvent((c) => handleDeleteAttendeeWalletPass(c, db)),
  );
  app.post(
    "/api/admin/events/:eventId/attendees/:id/items/:itemKey/revoke",
    jsonPostCsrf,
    staffAdminGate,
    guardArchivedEvent((c) => handleRevokeAttendeeItem(c, db)),
  );
  app.post(
    "/api/admin/events/:eventId/attendees/:id/notes",
    jsonPostCsrf,
    staffAdminGate,
    guardArchivedEvent((c) => handleAddAttendeeNote(c, db)),
  );
  app.patch(
    "/api/admin/events/:eventId/attendees/:id/notes/:noteId",
    jsonPostCsrf,
    staffAdminGate,
    guardArchivedEvent((c) => handlePatchAttendeeNote(c, db)),
  );
  app.delete(
    "/api/admin/events/:eventId/attendees/:id/notes/:noteId",
    jsonPostCsrf,
    staffAdminGate,
    guardArchivedEvent((c) => handleDeleteAttendeeNote(c, db)),
  );
  app.get("/api/admin/events/:eventId/template", staffAdminGate, (c) =>
    handleGetEventTemplate(c, db),
  );
  app.put("/api/admin/events/:eventId/template", jsonPostCsrf, staffAdminGate, templateBodyLimit, guardArchivedEvent((c) =>
    handlePutEventTemplate(c, db),
  ));
  app.post("/api/admin/events/:eventId/template/preview", jsonPostCsrf, staffAdminGate, adminTemplatePreviewRateLimit, templateBodyLimit, guardArchivedEvent((c) =>
    handlePreviewEventTemplate(c, db, mailInjectedBaseUrl),
  ));
  app.post(
    "/api/admin/events/:eventId/template/test-send",
    jsonPostCsrf,
    staffAdminGate,
    templateTestSendBodyLimit,
    adminCommunicationRateLimit,
    guardArchivedEvent((c) => handleTestSendEventTemplate(c, db, mailDeliveryDeps, mailInjectedBaseUrl)),
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
  app.patch(
    "/api/admin/events/:eventId/templates/:templateId",
    jsonPostCsrf,
    staffAdminGate,
    templateMetadataBodyLimit,
    guardArchivedEvent((c) => handlePatchEventTemplateMetadata(c, db)),
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
    guardArchivedEvent((c) => handlePreviewEventTemplateById(c, db, mailInjectedBaseUrl)),
  );
  app.post(
    "/api/admin/events/:eventId/templates/:templateId/test-send",
    jsonPostCsrf,
    staffAdminGate,
    templateTestSendBodyLimit,
    adminCommunicationRateLimit,
    guardArchivedEvent((c) =>
      handleTestSendEventTemplateById(c, db, mailDeliveryDeps, mailInjectedBaseUrl),
    ),
  );
  app.post(
    "/api/admin/events/:eventId/send",
    jsonPostCsrf,
    staffAdminGate,
    skipBulkSendRateLimitForDryRun,
    adminBulkResendRateLimit,
    guardArchivedEvent((c) => handleBulkSend(c, db, mailDeliveryDeps, mailInjectedBaseUrl)),
  );
  app.get("/api/admin/events/:eventId/send/status/:batchId", staffAdminGate, (c) =>
    handleBulkSendStatus(c, db),
  );
  app.get("/api/admin/events/:eventId/deliveries", staffAdminGate, (c) =>
    handleListEventDeliveries(c, db),
  );
  app.get("/api/admin/events/:eventId/deliveries/export", staffAdminGate, adminExportRateLimit, (c) =>
    handleExportEventDeliveries(c, db),
  );
  app.get("/api/admin/events/:eventId/deliveries/:deliveryId", staffAdminGate, (c) =>
    handleGetEventDelivery(c, db),
  );
  app.get("/api/admin/events/:eventId/deliveries/:deliveryId/rendered", staffAdminGate, (c) =>
    handleGetRenderedEventDelivery(c, db, mailInjectedBaseUrl),
  );
  app.get("/api/admin/events/:eventId/import/template", staffAdminGate, (c) =>
    handleGetImportTemplate(c, db),
  );
  app.get("/api/admin/events/:eventId/import/history", staffAdminGate, (c) =>
    handleGetImportHistory(c, db),
  );
  app.post("/api/admin/events/:eventId/import/preview", jsonPostCsrf, staffAdminGate, adminImportPreviewRateLimit, importBodyLimit, guardArchivedEvent((c) =>
    handleImportPreview(c, db),
  ));
  app.post("/api/admin/events/:eventId/import/commit", jsonPostCsrf, staffAdminGate, adminImportCommitRateLimit, importBodyLimit, guardArchivedEvent((c) =>
    handleImportCommit(c, db),
  ));
  app.get(
    "/api/admin/events/:eventId/import/jobs/:jobId",
    staffAdminGate,
    adminImportJobStatusRateLimit,
    (c) => handleGetImportJob(c, db),
  );
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
  app.patch("/api/admin/events/:eventId/note", jsonPostCsrf, staffAdminGate, guardArchivedEvent((c) =>
    handlePatchEventNote(c, db),
  ));
  app.post("/api/admin/events/:eventId/contacts", jsonPostCsrf, staffAdminGate, guardArchivedEvent((c) =>
    handleCreateContact(c, db),
  ));
  app.put("/api/admin/events/:eventId/contacts/:contactId", jsonPostCsrf, staffAdminGate, guardArchivedEvent((c) =>
    handleUpdateContact(c, db),
  ));
  app.delete("/api/admin/events/:eventId/contacts/:contactId", jsonPostCsrf, staffAdminGate, guardArchivedEvent((c) =>
    handleDeleteContact(c, db),
  ));
  app.post("/api/admin/events/:eventId/resources", jsonPostCsrf, staffAdminGate, guardArchivedEvent((c) =>
    handleCreateResource(c, db),
  ));
  app.put("/api/admin/events/:eventId/resources/:resourceId", jsonPostCsrf, staffAdminGate, guardArchivedEvent((c) =>
    handleUpdateResource(c, db),
  ));
  app.delete("/api/admin/events/:eventId/resources/:resourceId", jsonPostCsrf, staffAdminGate, guardArchivedEvent((c) =>
    handleDeleteResource(c, db),
  ));
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
  app.post(
    "/api/admin/mail-settings/probe",
    jsonPostCsrf,
    staffAdminGate,
    adminMailSettingsRateLimit,
    (c) => handlePostMailSettingsProbe(c, db, mailProbeDeps),
  );
  app.get("/api/admin/setup/checks", staffAdminGate, (c) =>
    handleGetSetupChecks(c, db, rateLimitStore, mailInjectedBaseUrl),
  );
  const adminHealthOpts = {
    geocodingProvider,
    injectedBaseUrl: mailInjectedBaseUrl,
    adminDistRoot: options.adminDistRoot,
  };
  app.get("/api/admin/health", staffAdminGate, (c) =>
    handleAdminHealth(c, db, rateLimitStore, adminHealthOpts),
  );
  app.post(
    "/api/admin/health/live",
    jsonPostCsrf,
    staffAdminGate,
    adminHealthLiveRateLimit,
    (c) => handleAdminHealth(c, db, rateLimitStore, { ...adminHealthOpts, live: true }),
  );
  app.get("/api/admin/setup/org-branding", staffAdminGate, (c) => handleGetSetupOrgBranding(c, db));
  app.patch("/api/admin/setup/org-branding", jsonPostCsrf, staffAdminGate, (c) =>
    handlePatchSetupOrgBranding(c, db),
  );
  app.get("/api/admin/setup/support-contact", staffAdminGate, (c) =>
    handleGetSetupSupportContact(c, db),
  );
  app.patch("/api/admin/setup/support-contact", jsonPostCsrf, staffAdminGate, (c) =>
    handlePatchSetupSupportContact(c, db),
  );
  app.post("/api/admin/setup/complete", jsonPostCsrf, staffAdminGate, (c) =>
    handlePostSetupComplete(c, db, rateLimitStore, mailInjectedBaseUrl),
  );
  app.get("/api/admin/audit-log", staffAdminGate, (c) => handleGetAuditLog(c, db));
  app.get("/api/admin/audit-log/export", staffAdminGate, adminExportRateLimit, (c) => handleExportAuditLog(c, db));
  app.get("/api/admin/security-audit-log", staffAdminGate, (c) => handleGetSecurityAuditLog(c, db));
  app.get("/api/admin/security-audit-log/export", staffAdminGate, adminExportRateLimit, (c) =>
    handleExportSecurityAuditLog(c, db),
  );
  app.get("/api/admin/system-logs", staffAdminGate, (c) => handleGetSystemLogs(c, db));
  app.get("/api/admin/sessions", staffAdminGate, (c) => handleGetSessions(c, db));
  app.post("/api/admin/sessions/:id/revoke", jsonPostCsrf, staffAdminGate, (c) =>
    handleRevokeSession(c, db),
  );
  app.post("/api/admin/sessions/:id/device-label", jsonPostCsrf, staffAdminGate, (c) =>
    handleUpdateSessionDeviceLabel(c, db),
  );
  app.post(
    "/api/admin/events/:eventId/revoke-all-operator-sessions",
    jsonPostCsrf,
    staffAdminGate,
    (c) => handleRevokeAllOperatorSessions(c, db),
  );
  app.post(
    "/api/admin/events/:eventId/revoke-all-checkins",
    jsonPostCsrf,
    staffAdminGate,
    (c) => handleRevokeAllCheckIns(c, db),
  );
  app.post(
    "/api/admin/events/:eventId/revoke-all-items",
    jsonPostCsrf,
    staffAdminGate,
    (c) => handleRevokeAllItems(c, db),
  );
  app.get("/api/admin/organizations", staffAdminGate, (c) => handleGetOrganizations(c, db));
  app.get("/api/admin/users", staffAdminGate, (c) => handleGetUsers(c, db));
  app.get("/api/admin/users/stats", staffAdminGate, (c) => handleGetUserStats(c, db));
  app.post("/api/admin/users", jsonPostCsrf, staffAdminGate, (c) => handlePostUser(c, db));
  app.patch("/api/admin/users/:id", jsonPostCsrf, staffAdminGate, (c) => handlePatchUser(c, db));
  app.delete("/api/admin/users/:id", jsonPostCsrf, staffAdminGate, (c) => handleDeleteUser(c, db));
  app.post("/api/admin/users/:id/roles", jsonPostCsrf, staffAdminGate, (c) =>
    handlePostUserRole(c, db),
  );
  app.delete("/api/admin/users/:id/roles/:assignmentId", jsonPostCsrf, staffAdminGate, (c) =>
    handleDeleteUserRole(c, db),
  );
  app.post("/api/admin/users/:id/reset-2fa", jsonPostCsrf, staffAdminGate, (c) =>
    handlePostResetUserMfa(c, db, rateLimitStore, mailInjectedBaseUrl),
  );
  app.delete("/api/admin/users/:id/external-identity", jsonPostCsrf, staffAdminGate, (c) =>
    handleDeleteUserExternalIdentity(c, db),
  );
  app.post("/api/admin/users/:id/reset-password", jsonPostCsrf, staffAdminGate, (c) =>
    handlePostResetUserPassword(c, db, rateLimitStore, mailInjectedBaseUrl),
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
  app.delete("/api/admin/uploads", jsonPostCsrf, staffAdminGate, (c) => handleDeleteUpload(c, db));
  app.post(
    "/api/admin/theme-font-upload",
    jsonPostCsrf,
    staffAdminGate,
    fontUploadBodyLimit,
    (c) => handlePostThemeFontUpload(c, db),
  );

  // Own auth:account-ip bucket for the whole group (see policies.ts) - kept separate from
  // auth:login-ip so consuming one never throttles the other, and applied once here rather than
  // per-route so it automatically covers any future /api/account/* endpoint too.
  app.use("/api/account/*", accountIpRateLimit);
  app.get("/api/account", requireSession, (c) => handleGetAccount(c, db));
  app.patch("/api/account/profile", jsonPostCsrf, requireSession, (c) =>
    handlePatchAccountProfile(c, db),
  );
  app.patch("/api/account/password", jsonPostCsrf, webauthnBodyLimit, requireSession, (c) =>
    handlePatchAccountPassword(c, db, rateLimitStore, mailInjectedBaseUrl),
  );
  app.delete("/api/account/external-identity", jsonPostCsrf, webauthnBodyLimit, requireSession, (c) =>
    handleDeleteAccountExternalIdentity(c, db, rateLimitStore, mailInjectedBaseUrl),
  );
  app.get("/api/account/sessions", requireSession, (c) => handleGetAccountSessions(c, db));
  app.delete("/api/account/sessions/:sessionId", jsonPostCsrf, requireSession, (c) =>
    handleDeleteAccountSession(c, db),
  );
  app.delete("/api/account/mfa/trusted-devices", jsonPostCsrf, requireSession, (c) =>
    handleDeleteAccountTrustedDevices(c, db),
  );
  app.post(
    "/api/account/mfa/totp/enroll",
    jsonPostCsrf,
    requireSession,
    createAccountMfaEnrollRateLimitMiddleware(rateLimitStore),
    (c) => handlePostAccountMfaEnroll(c, db),
  );
  app.delete("/api/account/mfa/totp/enroll", jsonPostCsrf, requireSession, (c) =>
    handleDeleteAccountMfaEnroll(c, db),
  );
  app.post("/api/account/mfa/totp/confirm", jsonPostCsrf, requireSession, (c) =>
    handlePostAccountMfaConfirm(c, db, rateLimitStore),
  );
  app.post("/api/account/mfa/reset", jsonPostCsrf, webauthnBodyLimit, requireSession, (c) =>
    handlePostAccountMfaReset(c, db, rateLimitStore, mailInjectedBaseUrl),
  );
  app.get("/api/account/mfa/webauthn", requireSession, (c) =>
    handleGetAccountWebauthnCredentials(c, db),
  );
  app.post(
    "/api/account/mfa/webauthn/register/begin",
    jsonPostCsrf,
    requireSession,
    createAccountMfaEnrollRateLimitMiddleware(rateLimitStore),
    (c) => handlePostAccountWebauthnRegisterBegin(c, db, mailInjectedBaseUrl),
  );
  app.post(
    "/api/account/mfa/webauthn/register/finish",
    jsonPostCsrf,
    webauthnBodyLimit,
    requireSession,
    createAccountMfaEnrollRateLimitMiddleware(rateLimitStore),
    (c) => handlePostAccountWebauthnRegisterFinish(c, db, mailInjectedBaseUrl),
  );
  app.post(
    "/api/account/mfa/webauthn/assert/begin",
    jsonPostCsrf,
    requireSession,
    createAccountMfaEnrollRateLimitMiddleware(rateLimitStore),
    (c) => handlePostAccountWebauthnAssertBegin(c, db, mailInjectedBaseUrl),
  );
  app.delete(
    "/api/account/mfa/webauthn/:credentialId",
    jsonPostCsrf,
    webauthnBodyLimit,
    requireSession,
    (c) => handleDeleteAccountWebauthnCredential(c, db, rateLimitStore, mailInjectedBaseUrl),
  );
  app.delete("/api/account/mfa/totp", jsonPostCsrf, loginRateLimitJson, webauthnBodyLimit, requireSession, (c) =>
    handleDeleteAccountTotp(c, db, rateLimitStore, mailInjectedBaseUrl),
  );
  app.get("/api/account/mfa/backup-codes", requireSession, (c) =>
    handleGetAccountBackupCodesStatus(c, db),
  );
  app.post(
    "/api/account/mfa/backup-codes/regenerate",
    jsonPostCsrf,
    loginRateLimitJson,
    webauthnBodyLimit,
    requireSession,
    (c) => handlePostAccountRegenerateBackupCodes(c, db, rateLimitStore, mailInjectedBaseUrl),
  );

  app.get("/api/checkin/events", requireSession, (c) => handleGetCheckinEvents(c, db));
  app.get("/api/staff/theme", requireSession, (c) => handleGetStaffTheme(c, db));
  app.put("/api/staff/theme", jsonPostCsrf, requireSession, (c) => handlePutStaffTheme(c, db));

  app.post("/api/auth/mfa/verify", jsonPostCsrf, requirePartialSession, (c) =>
    handleMfaVerify(c, db, rateLimitStore),
  );
  app.post("/api/auth/mfa/webauthn/begin", jsonPostCsrf, loginRateLimitJson, requirePartialSession, (c) =>
    handlePostMfaWebauthnBegin(c, db, mailInjectedBaseUrl),
  );
  app.post("/api/auth/mfa/webauthn/verify", jsonPostCsrf, webauthnBodyLimit, requirePartialSession, (c) =>
    handlePostMfaWebauthnVerify(c, db, rateLimitStore, mailInjectedBaseUrl),
  );
  app.post("/api/auth/mfa/remember-device", jsonPostCsrf, requireSession, (c) =>
    handlePostMfaRememberDevice(c, db),
  );
  app.post(
    "/api/auth/mfa/webauthn/register/begin",
    jsonPostCsrf,
    requirePartialSession,
    mfaEnrollRateLimitJson,
    (c) => handlePostMfaWebauthnEnrollBegin(c, db, mailInjectedBaseUrl),
  );
  app.post(
    "/api/auth/mfa/webauthn/register/finish",
    jsonPostCsrf,
    webauthnBodyLimit,
    requirePartialSession,
    mfaEnrollRateLimitJson,
    (c) => handlePostMfaWebauthnEnrollFinish(c, db, mailInjectedBaseUrl),
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

  // OIDC redirect_uri must match what the SPA shows (Instance URL / BASE_URL), not the
  // boot-only resolveBaseUrl() that skips DB instance_url in development.
  async function oidcPublicBaseUrl(): Promise<string> {
    return resolveInstanceBaseUrl(db, process.env, mailInjectedBaseUrl);
  }


  app.get("/api/auth/oidc/:providerId/start", oidcAuthRateLimit, async (c) =>
    handleOidcStart(c, db, await oidcPublicBaseUrl()),
  );
  app.get("/api/auth/oidc/:providerId/callback", oidcAuthRateLimit, async (c) =>
    handleOidcCallback(c, db, await oidcPublicBaseUrl()),
  );

  app.get("/account/oidc/:providerId/link", requireSessionHtml, (c) => handleGetOidcLink(c, db));
  app.post("/account/oidc/:providerId/link", htmlPostCsrf, loginRateLimitHtml, requireSessionHtml, async (c) =>
    handlePostOidcLink(c, db, await oidcPublicBaseUrl(), rateLimitStore),
  );

  app.get("/", requireSessionHtml, async (c) => {
    const auth = c.get("auth");
    const landing = await resolvePostLoginRedirectForUser(db, auth.userId);
    return c.redirect(landing, 302);
  });

  // Identity providers + Cloudflare Access JSON API for the SPA Settings → Identity section (#266).
  // Uses requireAdminAccess (superadmin via canManageInstance) to gate the editor.
  app.get("/api/admin/identity/providers", requireAdminAccess, (c) => handleApiListProviders(c, db));
  app.post("/api/admin/identity/providers", jsonPostCsrf, requireAdminAccess, (c) =>
    handleApiCreateProvider(c, db, mailInjectedBaseUrl),
  );
  app.post(
    "/api/admin/identity/providers/test",
    jsonPostCsrf,
    requireAdminAccess,
    adminAuthProviderOpsRateLimit,
    (c) => handleApiTestProviderDraft(c),
  );
  app.post(
    "/api/admin/identity/providers/discover-preview",
    jsonPostCsrf,
    requireAdminAccess,
    adminAuthProviderOpsRateLimit,
    (c) => handleApiDiscoverProviderPreview(c),
  );
  app.get("/api/admin/identity/providers/:id", requireAdminAccess, (c) =>
    handleApiGetProvider(c, db, mailInjectedBaseUrl),
  );
  app.put("/api/admin/identity/providers/:id", jsonPostCsrf, requireAdminAccess, (c) =>
    handleApiUpdateProvider(c, db, mailInjectedBaseUrl),
  );
  app.post("/api/admin/identity/providers/:id/toggle", jsonPostCsrf, requireAdminAccess, (c) =>
    handleApiToggleProvider(c, db),
  );
  app.post(
    "/api/admin/identity/providers/:id/discover",
    jsonPostCsrf,
    requireAdminAccess,
    adminAuthProviderOpsRateLimit,
    (c) => handleApiDiscoverProvider(c, db, mailInjectedBaseUrl),
  );
  app.post(
    "/api/admin/identity/providers/:id/test",
    jsonPostCsrf,
    requireAdminAccess,
    adminAuthProviderOpsRateLimit,
    (c) => handleApiTestProvider(c, db),
  );
  app.get("/api/admin/identity/cf-access", requireAdminAccess, (c) => handleApiGetCfAccess(c, db));
  app.put("/api/admin/identity/cf-access", jsonPostCsrf, requireAdminAccess, (c) =>
    handleApiUpdateCfAccess(c, db),
  );
  app.post(
    "/api/admin/identity/cf-access/test",
    jsonPostCsrf,
    requireAdminAccess,
    adminAuthProviderOpsRateLimit,
    (c) => handleApiTestCfAccess(c, db),
  );

  app.get("/setup", (c) => handleGetSetup(c, db));
  app.post("/setup", htmlPostCsrf, loginRateLimitHtml, (c) => handlePostSetup(c, db));
  app.get("/login", (c) => handleGetLogin(c, db));
  app.post("/login", htmlPostCsrf, loginRateLimitHtml, (c) => handlePostLogin(c, db, rateLimitStore));
  app.get("/mfa/verify", requirePartialSessionHtml, (c) => handleGetMfaVerify(c, db));
  app.post("/mfa/verify", htmlPostCsrf, requirePartialSessionHtml, (c) =>
    handlePostMfaVerify(c, db, rateLimitStore),
  );
  app.get("/mfa/enroll", requirePartialSessionHtml, (c) => handleGetMfaEnroll(c, db));
  app.get("/mfa/enroll/method", requirePartialSessionHtml, (c) => handleGetMfaEnrollMethod(c, db));
  app.get("/mfa/enroll/webauthn", requirePartialSessionHtml, (c) => handleGetMfaEnrollWebauthn(c, db));
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
  app.post("/logout", htmlPostCsrf, async (c) =>
    handlePostLogout(c, db, await resolveOidcPublicBaseUrlOrNull(db, mailInjectedBaseUrl)),
  );
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
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path joined from trusted repo root or upload dir
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
      ".woff2": "font/woff2",
      ".woff": "font/woff",
      ".ttf": "font/ttf",
      ".otf": "font/otf",
    };
    // Public /uploads is for branding assets only. Export/import artifacts (csv/xlsx/pdf)
    // must go through authenticated admin download routes, not UUID obscurity.
    const ct = contentTypeMap[ext];
    if (!ct) {
      return c.notFound();
    }
    c.header("Content-Type", ct);
    c.header("Cache-Control", "public, max-age=86400");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Robots-Tag", "noindex, nofollow");
    return c.body(new Uint8Array(buf));
  });
  app.get("/vendor/tabler-icons/*", serveTablerIcons);
  app.get("/vendor/fontsource/*", serveFontsourceFonts);
  app.get("/admin", staffAdminGate, staffSpa.serveSpaIndex);
  app.get("/admin/*", staffAdminGate, staffSpa.serveSpaIndex);
  app.get("/account", requireSessionHtml, staffSpa.serveSpaIndex);
  app.get("/operator", requireSessionHtml, checkInPanelGuard, staffSpa.serveSpaIndex);
  app.get("/operator/*", requireSessionHtml, checkInPanelGuard, staffSpa.serveSpaIndex);

  app.use("/t/*", publicRateLimit);
  app.use("/q/*", publicRateLimit);
  app.use("/m/*", publicRateLimit);

  // Public static map PNG for tickets / mail {{event_map_url}} - event-scoped, no token
  // (venue coordinates are intended for attendees). Filename is "{eventId}.png".
  app.get("/m/:filename", async (c) => {
    const eventId = parseEventIdFromStaticMapFilename(c.req.param("filename"));
    if (!eventId) {
      return c.body(null, 404);
    }
    // Events list cards request a wider preview; tickets/mail omit the query (default +1).
    const context = c.req.query("context");
    const result = await eventStaticMapService.getForEvent(
      db,
      eventId,
      context === "list" ? { listPreview: true } : {},
    );
    if (!result.ok) {
      return c.body(null, staticMapFailureStatus(result.reason));
    }
    c.header("Content-Type", "image/png");
    // Placeholders use a short max-age so a tile CDN recovery is visible within minutes.
    c.header("Cache-Control", staticMapCacheControl(result.placeholder));
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Robots-Tag", "noindex, nofollow");
    return c.body(new Uint8Array(result.png), 200);
  });

  /**
   * Mode A ticket lookup shared by the ticket page and the on-demand wallet routes below - a
   * genuine database error becomes a logged 500 (Response), matching the Mode B agency route's
   * own error handling; an unresolved token still becomes plain `null` for the caller to turn
   * into a 404.
   */
  async function resolveTicketOrError(
    c: Context,
    token: string,
    route: string,
  ): Promise<Awaited<ReturnType<typeof resolveTicket>> | Response> {
    try {
      return await resolveTicket(token, db);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientInitializationError ||
        err instanceof Prisma.PrismaClientKnownRequestError ||
        err instanceof Prisma.PrismaClientUnknownRequestError
      ) {
        console.error("resolveTicket database error:", err);
        recordSystemLog({
          level: "error",
          source: "api",
          message: "ticket_resolution_failed",
          fields: { route, errorKind: "database" },
        });
      } else {
        console.error("resolveTicket unexpected error:", err);
        recordSystemLog({
          level: "error",
          source: "api",
          message: "ticket_resolution_failed",
          fields: { route, errorKind: "unexpected" },
        });
      }
      return renderPublicHtmlError(c, 500);
    }
  }

  // Mode B ticket page — must be registered before /t/:token
  app.get("/t/:eventSlug/a/:ref", async (c) => {
    const { eventSlug, ref } = c.req.param();
    let resolved;
    try {
      resolved = await findAttendeeForEventRoute(eventSlug, ref, db);
    } catch (err) {
      console.error("findAttendeeForEventRoute error:", err);
      recordSystemLog({
        level: "error",
        source: "api",
        message: "ticket_agency_lookup_failed",
        fields: { route: "/t/:eventSlug/a/:ref" },
      });
      return renderPublicHtmlError(c, 500);
    }
    if (resolved?.mode !== "agency") {
      return renderPublicHtmlError(c, 404);
    }
    return renderTicketPage(c, resolved, undefined, "/t/:eventSlug/a/:ref", ref);
  });

  // Mode A ticket page
  app.get("/t/:token", async (c) => {
    const token = c.req.param("token");
    const resolved = await resolveTicketOrError(c, token, "/t/:token");
    if (resolved instanceof Response) return resolved;
    if (!resolved) {
      return renderPublicHtmlError(c, 404);
    }
    return renderTicketPage(c, resolved, token);
  });

  // On-demand wallet pass — Mode A (own ticket page, script-src 'none' so this is a plain <a href> nav)
  for (const platform of ["apple", "google"] as const) {
    app.get(`/t/:token/wallet/${platform}`, async (c) => {
      const token = c.req.param("token");
      const resolved = await resolveTicketOrError(c, token, "/t/:token/wallet/:platform");
      if (resolved instanceof Response) return resolved;
      if (!resolved) return renderPublicHtmlError(c, 404);
      return handleWalletRedirect(c, resolved, platform, `/t/${token}`, token);
    });
  }

  // On-demand wallet pass — Mode B (agency ticket page)
  for (const platform of ["apple", "google"] as const) {
    app.get(`/t/:eventSlug/a/:ref/wallet/${platform}`, async (c) => {
      const { eventSlug, ref } = c.req.param();
      let resolved;
      try {
        resolved = await findAttendeeForEventRoute(eventSlug, ref, db);
      } catch (err) {
        console.error("findAttendeeForEventRoute error:", err);
        recordSystemLog({
          level: "error",
          source: "api",
          message: "ticket_agency_lookup_failed",
          fields: { route: "/t/:eventSlug/a/:ref/wallet/:platform" },
        });
        return renderPublicHtmlError(c, 500);
      }
      if (resolved?.mode !== "agency") return renderPublicHtmlError(c, 404);
      return handleWalletRedirect(c, resolved, platform, `/t/${eventSlug}/a/${ref}`);
    });
  }

  // PassCreator webhook deliveries (registration events: first_pushnotification_registered,
  // pushnotification_registered, pushnotification_unregistered) - never a browser navigation.
  app.post("/api/wallet/webhook/passcreator/:eventId", walletWebhookRateLimit, (c) =>
    handlePassCreatorWebhook(c, db, options.walletPassProvider),
  );
  // pass_voided gets its own target URL (subscribeWalletWebhooksBestEffort) since PassCreator's
  // payload never names which event fired - see handlePassCreatorWebhook's doc comment.
  app.post("/api/wallet/webhook/passcreator/:eventId/voided", walletWebhookRateLimit, (c) =>
    handlePassCreatorWebhook(c, db, options.walletPassProvider, true),
  );

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
      recordSystemLog({
        level: "error",
        source: "api",
        message: "ticket_agency_lookup_failed",
        fields: { route: "/q/:eventSlug/a/:filename" },
      });
      return c.body(null, 500);
    }
    if (resolved?.mode !== "agency") {
      return c.body(null, 404);
    }
    const agencyPayload = resolved.attendee.qr_payload ?? resolved.attendee.external_uuid;
    if (!agencyPayload) {
      return c.body(null, 404);
    }
    try {
      const png = await generateQrPng(buildQrPayload("agency", { agencyPayload }));
      c.header("Content-Type", "image/png");
      c.header("Cache-Control", "private, max-age=300");
      c.header("X-Robots-Tag", "noindex, nofollow");
      return c.body(new Uint8Array(png), 200);
    } catch {
      emitSystemLog("api", "error", "qr_png_generation_failed", {
        route: "/q/:eventSlug/a/:filename",
      });
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
      recordSystemLog({
        level: "error",
        source: "api",
        message: "ticket_qr_attendee_lookup_failed",
        fields: { route: "/q/:filename" },
      });
      return c.body(null, 500);
    }
    if (!attendee) {
      return c.body(null, 404);
    }
    try {
      const png = await generateQrPng(
        buildQrPayload("internal", { token }),
      );
      c.header("Content-Type", "image/png");
      c.header("Cache-Control", "private, max-age=300");
      c.header("X-Robots-Tag", "noindex, nofollow");
      return c.body(new Uint8Array(png), 200);
    } catch {
      emitSystemLog("api", "error", "qr_png_generation_failed", {
        route: "/q/:filename",
      });
      return c.body(null, 500);
    }
  });

  app.post(
    "/api/checkin/scan",
    createCheckinPreAuth(checkinAuthDeps),
    createCheckinSessionCsrfGuard(),
    checkinScanRateLimit,
    parseScanBodyMiddleware,
    createCheckinEventScope(checkinAuthDeps, eventIdFromScanBody),
    (c) => handleCheckinScan(c, db),
  );

  app.post(
    "/api/checkin/lookup",
    createCheckinPreAuth(checkinAuthDeps),
    createCheckinSessionCsrfGuard(),
    checkinScanRateLimit,
    parseScanBodyMiddleware,
    createCheckinEventScope(checkinAuthDeps, eventIdFromCheckinBody),
    (c) => handleCheckinLookup(c, db),
  );

  app.get(
    "/api/checkin/attendees/:attendeeId",
    createCheckinPreAuth(checkinAuthDeps),
    checkinHistoryRateLimit,
    createCheckinEventScope(checkinAuthDeps, (c) => c.req.query("eventId") || undefined),
    (c) => handleGetAttendeeCard(c, db),
  );

  app.post(
    "/api/checkin/admit",
    createCheckinPreAuth(checkinAuthDeps),
    createCheckinSessionCsrfGuard(),
    checkinScanRateLimit,
    parseScanBodyMiddleware,
    createCheckinEventScope(checkinAuthDeps, eventIdFromCheckinBody),
    (c) => handleCheckinAdmit(c, db),
  );

  app.post(
    "/api/checkin/items/:itemKey",
    createCheckinPreAuth(checkinAuthDeps),
    createCheckinSessionCsrfGuard(),
    checkinScanRateLimit,
    parseScanBodyMiddleware,
    createCheckinEventScope(checkinAuthDeps, eventIdFromCheckinBody),
    (c) => handleCheckinItemAction(c, db),
  );

  app.post(
    "/api/checkin/notes",
    createCheckinPreAuth(checkinAuthDeps),
    createCheckinSessionCsrfGuard(),
    checkinScanRateLimit,
    parseScanBodyMiddleware,
    createCheckinEventScope(checkinAuthDeps, eventIdFromCheckinBody),
    (c) => handleCheckinNote(c, db),
  );

  app.post(
    "/api/checkin/undo",
    createCheckinPreAuth(checkinAuthDeps),
    createCheckinSessionCsrfGuard(),
    checkinScanRateLimit,
    parseScanBodyMiddleware,
    createCheckinEventScope(checkinAuthDeps, eventIdFromCheckinBody),
    (c) => handleCheckinUndo(c, db),
  );

  app.get(
    "/api/checkin/ops-config",
    createCheckinPreAuth(checkinAuthDeps),
    checkinHistoryRateLimit,
    createCheckinEventScope(checkinAuthDeps, eventIdFromHistoryQuery),
    (c) => handleCheckinOpsConfig(c, db),
  );

  app.get(
    "/api/checkin/stats",
    createCheckinPreAuth(checkinAuthDeps),
    checkinHistoryRateLimit,
    createCheckinEventScope(checkinAuthDeps, eventIdFromHistoryQuery),
    (c) => handleCheckinStats(c, db),
  );

  app.get(
    "/api/checkin/ticket-types",
    createCheckinPreAuth(checkinAuthDeps),
    checkinHistoryRateLimit,
    createCheckinEventScope(checkinAuthDeps, eventIdFromHistoryQuery),
    (c) => handleCheckinTicketTypes(c, db),
  );

  app.get(
    "/api/checkin/events/:eventId/stream",
    createCheckinPreAuth(checkinAuthDeps),
    checkinStreamRateLimit,
    createCheckinEventScope(checkinAuthDeps, (c) => c.req.param("eventId")),
    createCheckinStreamConcurrencyLimit(),
    (c) => handleEventStream(c),
  );

  app.get(
    "/api/checkin/history",
    createCheckinPreAuth(checkinAuthDeps),
    checkinHistoryRateLimit,
    createCheckinEventScope(checkinAuthDeps, eventIdFromHistoryQuery),
    (c) => handleCheckinHistory(c, db),
  );

  // Global HTML 404 for unknown browser URLs. API stays JSON; map/QR/uploads/assets stay empty.
  // Do not load branding theme here: unmatched paths are unauthenticated and not rate-limited.
  app.notFound(async (c) => {
    const path = c.req.path;
    if (path === "/api" || path.startsWith("/api/")) {
      return c.json({ error: "not_found" }, 404);
    }
    if (
      path === "/m" ||
      path.startsWith("/m/") ||
      path === "/q" ||
      path.startsWith("/q/") ||
      path === "/uploads" ||
      path.startsWith("/uploads/") ||
      path === "/assets" ||
      path.startsWith("/assets/") ||
      path === "/vendor" ||
      path.startsWith("/vendor/") ||
      path === "/favicon.ico" ||
      path.startsWith("/favicon.")
    ) {
      return c.body(null, 404);
    }
    return renderPublicHtmlError(c, 404, { loadTheme: false });
  });

  return app;
}
