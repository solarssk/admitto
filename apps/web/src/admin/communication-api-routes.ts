import type { Context } from "hono";
import { Prisma, type PrismaClient, type EmailDeliveryStatus, type EmailDeliveryPurpose } from "@admitto/db";
import { EMAIL_DELIVERY_STATUS, EMAIL_DELIVERY_PURPOSE } from "@admitto/db/status";
import { z } from "zod";
import {
  ALLOWED_PLACEHOLDERS,
  REQUIRED_URL_PLACEHOLDERS,
  IMAGE_PLACEHOLDERS,
  DEFAULT_BODY_MJML,
  DEFAULT_SUBJECT_TEMPLATE,
  assertValidTemplate,
  assertRenderableCompiledHtml,
  compileTemplate,
  findMissingRequiredPlaceholders,
  buildBaseTemplateVars,
  renderTemplate,
  resolveBrandingFromEvent,
  resolveEventImageAssetVars,
  createMailTemplate,
  setMailTemplate,
  updateMailTemplateMetadata,
  validateTemplate,
  materializeStoredDeliveryMessageRedacted,
  UnknownPlaceholdersError,
  MjmlCompileError,
  friendlyMjmlErrorMessage,
  PlaceholderInHtmlCommentError,
  UnquotedAttributePlaceholderError,
  resolveTemplateById,
  TemplateNotFoundError,
  type TemplateFormat,
  type TemplateSource,
} from "@admitto/mail-templates";
import {
  listDeliveries,
  getDeliveryWithTimeline,
  getRenderedDelivery,
  sendTestEmail,
  toDeliveryDto,
  toDeliveryDetailDto,
  clientSafeDeliveryError,
  type DeliveryDto,
  type DeliveryDetailDto,
  type MailDeliveryDeps,
} from "@admitto/mail-delivery";
import { isSendSuccess } from "@admitto/mailer";
import { EXPORT_ROW_CAP, quoteCsvCell, sanitizeCsvCell, writeBulkActionLog } from "@admitto/tickets";
import {
  adminAuditFromContext,
  assertEventManageAccess,
  csvExportResponse,
  lockEventForScopedWrite,
  positiveIntQuery,
  requireEventId,
  resolveMailInstanceBaseUrl,
  resolveUserDisplayMap,
} from "./admin-helpers.js";
import { acquireEventImageAssetsLock } from "./event-image-assets-routes.js";

/** Max character length for `body_template` (schema); shared with wire byte cap below. */
export const TEMPLATE_BODY_CHAR_LIMIT = 200_000;

/** Max character length for `subject_template` (schema). */
export const TEMPLATE_SUBJECT_CHAR_LIMIT = 500;

/**
 * Max JSON body size for template save/preview routes.
 * Sized for `body_template` at {@link TEMPLATE_BODY_CHAR_LIMIT} with worst-case UTF-8 (4 B/char)
 * and JSON escaping overhead; still rejects multi-megabyte payloads before `c.req.json()`.
 */
export const MAX_TEMPLATE_BODY_BYTES =
  (TEMPLATE_BODY_CHAR_LIMIT + TEMPLATE_SUBJECT_CHAR_LIMIT) * 4 * 2 + 32_768;

/** Max JSON body for POST `/template/test-send` (`{ to }` only). */
export const MAX_TEMPLATE_TEST_SEND_BODY_BYTES = 4_096;

/** Max JSON body for PATCH `/templates/:templateId` (`{ label?, icon?, description? }` only). */
export const MAX_TEMPLATE_METADATA_BODY_BYTES = 4_096;

const templateBodySchema = z
  .object({
    subject_template: z.string().trim().min(1).max(TEMPLATE_SUBJECT_CHAR_LIMIT),
    body_template: z.string().min(1).max(TEMPLATE_BODY_CHAR_LIMIT),
    template_format: z.enum(["mjml", "html"]),
  })
  .strict();

/** The event or the requested template disappeared while this write waited for the same
 * advisory lock used by permanent event deletion. */
class EventTemplateGoneDuringWriteError extends Error {}

const testSendBodySchema = z
  .object({
    to: z
      .string()
      .trim()
      .email()
      .max(254)
      .refine((v) => !/[\r\n]/.test(v), "invalid email"),
  })
  .strict();

/** API response for GET /template — editable source plus placeholder metadata. */
export type EventTemplateDto = {
  subject_template: string;
  body_template: string;
  template_format: TemplateFormat;
  source: TemplateSource;
  allowed_placeholders: string[];
  required_url_placeholders: string[];
  /** Subset of `allowed_placeholders` that render as an image — the editor inserts a ready
   * `<img>`/`<mj-image>` element for these instead of a bare `{{name}}` token. */
  image_placeholders: string[];
  /** Resolved `{{logo_url}}` / `{{header_image_url}}` (event → organization → empty) - the same
   * values a real send would use, for the placeholder-chip hover preview. Empty string means
   * nothing is configured at either scope. */
  logo_url: string;
  header_image_url: string;
};

/** Paginated delivery log response for GET /deliveries. */
export type EventDeliveriesListDto = {
  items: DeliveryDto[];
  total: number;
  page: number;
  pageSize: number;
};

const ALLOWED_PLACEHOLDER_LIST = [...ALLOWED_PLACEHOLDERS].sort((a, b) => a.localeCompare(b));
const REQUIRED_URL_PLACEHOLDER_LIST = [...REQUIRED_URL_PLACEHOLDERS].sort((a, b) =>
  a.localeCompare(b),
);
const IMAGE_PLACEHOLDER_LIST = [...IMAGE_PLACEHOLDERS].sort((a, b) => a.localeCompare(b));
const ALLOWED_DELIVERY_STATUSES = new Set<string>(EMAIL_DELIVERY_STATUS);
const ALLOWED_DELIVERY_PURPOSES = new Set<string>(EMAIL_DELIVERY_PURPOSE);

/** Collect template source validation errors for API 400 responses. Fetches the event's custom
 * image asset tokens (branding asset library) so a saved {{token}} isn't falsely flagged unknown. */
async function collectTemplateSourceErrors(
  db: PrismaClient,
  eventId: string,
  subject: string,
  body: string,
): Promise<string[]> {
  const errors: string[] = [];
  const { names: extraAllowed } = await resolveEventImageAssetVars(eventId, db);

  for (const unknown of validateTemplate({ subject, body }, extraAllowed)) {
    errors.push(`Unknown placeholder: ${unknown}`);
  }
  for (const missing of findMissingRequiredPlaceholders(subject, body)) {
    errors.push(`Missing required placeholder: ${missing}`);
  }

  try {
    assertValidTemplate({ subject, body }, extraAllowed);
  } catch (err) {
    if (err instanceof UnknownPlaceholdersError) {
      // already reported via validateTemplate
    } else if (err instanceof PlaceholderInHtmlCommentError) {
      for (const p of err.placeholders) {
        errors.push(`Placeholder in HTML comment: ${p}`);
      }
    } else if (err instanceof UnquotedAttributePlaceholderError) {
      for (const a of err.attributes) {
        errors.push(`Unquoted attribute placeholder: ${a}`);
      }
    } else {
      throw err;
    }
  }

  return errors;
}

/** Return 400 JSON when template source validation fails. */
function templateValidationResponse(c: Context, errors: string[]): Response {
  return c.json({ error: "template_validation_failed", errors }, 400);
}

/** Return 400 JSON when MJML compilation fails. Operator-facing text only - never the raw
 * compiler message (internal jargon, and formattedMessage embeds a server file path). */
function mjmlCompileErrorResponse(c: Context, err: MjmlCompileError): Response {
  const errors = err.errors.map((e) => friendlyMjmlErrorMessage(e));
  return c.json({ error: "template_validation_failed", errors }, 400);
}

/** Resolve editable template source for an event (event → org → builtin). */
async function resolveEventTemplateForEditor(
  db: PrismaClient,
  eventId: string,
): Promise<{
  subject_template: string;
  body_template: string;
  template_format: TemplateFormat;
  source: TemplateSource;
}> {
  const event = await db.event.findUniqueOrThrow({ where: { id: eventId } });

  const eventRow = await db.mailTemplate.findUnique({
    where: {
      scope_type_scope_id_name: { scope_type: "event", scope_id: eventId, name: "ticket" },
    },
  });
  if (eventRow) {
    return {
      subject_template: eventRow.subject_template,
      body_template: eventRow.body_template,
      template_format: eventRow.template_format as TemplateFormat,
      source: "event",
    };
  }

  const orgRow = await db.mailTemplate.findUnique({
    where: {
      scope_type_scope_id_name: {
        scope_type: "organization",
        scope_id: event.organization_id,
        name: "ticket",
      },
    },
  });
  if (orgRow) {
    return {
      subject_template: orgRow.subject_template,
      body_template: orgRow.body_template,
      template_format: orgRow.template_format as TemplateFormat,
      source: "organization",
    };
  }

  return {
    subject_template: DEFAULT_SUBJECT_TEMPLATE,
    body_template: DEFAULT_BODY_MJML,
    template_format: "mjml",
    source: "builtin",
  };
}

/** Render a draft template with sample event data (no DB save). */
async function renderDraftPreview(
  db: PrismaClient,
  eventId: string,
  subject: string,
  body: string,
  format: TemplateFormat,
  baseUrl: string,
) {
  const compiledHtml = await compileTemplate(body, format);
  if (format === "mjml") {
    assertRenderableCompiledHtml(compiledHtml);
  }

  const event = await db.event.findUniqueOrThrow({
    where: { id: eventId },
    include: { organization: true, location_details: true },
  });
  const branding = resolveBrandingFromEvent(event);
  const customAssets = await resolveEventImageAssetVars(eventId, db);

  const vars = {
    ...buildBaseTemplateVars(event, undefined, branding, baseUrl),
    ...customAssets.vars,
  };

  return renderTemplate(
    { subject, compiledHtml },
    vars,
    { baseUrl, customAssetPlaceholders: customAssets.names },
  );
}

/** GET /api/admin/events/:eventId/template */
export async function handleGetEventTemplate(c: Context, db: PrismaClient): Promise<Response> {
  const eventId = requireEventId(c);
  if (eventId instanceof Response) return eventId;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const template = await resolveEventTemplateForEditor(db, eventId);
  const { names: customAssetNames } = await resolveEventImageAssetVars(eventId, db);
  const brandingEvent = await db.event.findUniqueOrThrow({
    where: { id: eventId },
    select: {
      logo_url: true,
      header_image_url: true,
      organization: { select: { logo_url: true, header_image_url: true } },
    },
  });
  const branding = resolveBrandingFromEvent(brandingEvent);

  const dto: EventTemplateDto = {
    ...template,
    allowed_placeholders: [...ALLOWED_PLACEHOLDER_LIST, ...customAssetNames].sort((a, b) =>
      a.localeCompare(b),
    ),
    required_url_placeholders: REQUIRED_URL_PLACEHOLDER_LIST,
    image_placeholders: [...IMAGE_PLACEHOLDER_LIST, ...customAssetNames].sort((a, b) =>
      a.localeCompare(b),
    ),
    logo_url: branding.logo_url,
    header_image_url: branding.header_image_url,
  };

  return c.json(dto);
}

/** PUT /api/admin/events/:eventId/template */
export async function handlePutEventTemplate(c: Context, db: PrismaClient): Promise<Response> {
  const eventId = requireEventId(c);
  if (eventId instanceof Response) return eventId;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  let body: z.infer<typeof templateBodySchema>;
  try {
    body = templateBodySchema.parse(await c.req.json());
  } catch {
    return c.json({ error: "validation_failed" }, 400);
  }

  const sourceErrors = await collectTemplateSourceErrors(db, eventId, body.subject_template, body.body_template);
  if (sourceErrors.length > 0) {
    return templateValidationResponse(c, sourceErrors);
  }

  try {
    await db.$transaction(async (tx) => {
      await lockEventForTemplateWrite(tx, eventId);
      // Serializes against event-image-assets-routes.ts's delete handler, which takes the same
      // lock before its asset_in_use recheck - without it, a delete could commit between that
      // handler's check and this save (Postgres default isolation is READ COMMITTED).
      await acquireEventImageAssetsLock(tx, eventId);
      await setMailTemplate(
        { scopeType: "event", scopeId: eventId },
        {
          subject: body.subject_template,
          body: body.body_template,
          format: body.template_format,
        },
        tx,
      );
      await writeBulkActionLog(tx, {
        event_id: eventId,
        action_type: "mail_template_updated",
        audit: adminAuditFromContext(c),
        metadata: { format: body.template_format },
      });
    });
  } catch (err) {
    if (err instanceof EventTemplateGoneDuringWriteError) return c.json({ error: "not_found" }, 404);
    if (err instanceof UnknownPlaceholdersError) {
      return templateValidationResponse(
        c,
        err.unknown.map((u) => `Unknown placeholder: ${u}`),
      );
    }
    if (err instanceof MjmlCompileError) {
      return mjmlCompileErrorResponse(c, err);
    }
    if (err instanceof PlaceholderInHtmlCommentError) {
      return templateValidationResponse(
        c,
        err.placeholders.map((p) => `Placeholder in HTML comment: ${p}`),
      );
    }
    if (err instanceof UnquotedAttributePlaceholderError) {
      return templateValidationResponse(
        c,
        err.attributes.map((a) => `Unquoted attribute placeholder: ${a}`),
      );
    }
    throw err;
  }

  return c.json({ ok: true });
}

/** POST /api/admin/events/:eventId/template/preview */
export async function handlePreviewEventTemplate(
  c: Context,
  db: PrismaClient,
  injectedBaseUrl?: string,
): Promise<Response> {
  const eventId = requireEventId(c);
  if (eventId instanceof Response) return eventId;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  let body: z.infer<typeof templateBodySchema>;
  try {
    body = templateBodySchema.parse(await c.req.json());
  } catch {
    return c.json({ error: "validation_failed" }, 400);
  }

  const sourceErrors = await collectTemplateSourceErrors(db, eventId, body.subject_template, body.body_template);
  if (sourceErrors.length > 0) {
    return templateValidationResponse(c, sourceErrors);
  }

  const baseUrlOrRes = await resolveMailInstanceBaseUrl(c, db, process.env, injectedBaseUrl);
  if (baseUrlOrRes instanceof Response) return baseUrlOrRes;
  const baseUrl = baseUrlOrRes;

  try {
    const rendered = await renderDraftPreview(
      db,
      eventId,
      body.subject_template,
      body.body_template,
      body.template_format,
      baseUrl,
    );
    return c.json({ subject: rendered.subject, html: rendered.html });
  } catch (err) {
    if (err instanceof MjmlCompileError) {
      return mjmlCompileErrorResponse(c, err);
    }
    if (err instanceof PlaceholderInHtmlCommentError) {
      return templateValidationResponse(
        c,
        err.placeholders.map((p) => `Placeholder in HTML comment: ${p}`),
      );
    }
    if (err instanceof UnquotedAttributePlaceholderError) {
      return templateValidationResponse(
        c,
        err.attributes.map((a) => `Unquoted attribute placeholder: ${a}`),
      );
    }
    throw err;
  }
}

/** POST /api/admin/events/:eventId/template/test-send */
export async function handleTestSendEventTemplate(
  c: Context,
  db: PrismaClient,
  mailDeliveryDeps: MailDeliveryDeps = {},
  injectedBaseUrl?: string,
): Promise<Response> {
  const eventId = requireEventId(c);
  if (eventId instanceof Response) return eventId;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  let body: z.infer<typeof testSendBodySchema>;
  try {
    body = testSendBodySchema.parse(await c.req.json());
  } catch {
    return c.json({ error: "validation_failed" }, 400);
  }

  const baseUrlOrRes = await resolveMailInstanceBaseUrl(c, db, process.env, injectedBaseUrl);
  if (baseUrlOrRes instanceof Response) return baseUrlOrRes;
  const baseUrl = baseUrlOrRes;

  let result;
  try {
    result = await sendTestEmail(
      { eventId, toAddress: body.to },
      db,
      process.env,
      mailDeliveryDeps,
      { baseUrl },
    );
  } catch (err) {
    console.error("[admin] template test-send failed", err);
    return c.json({
      status: "failed",
      error: clientSafeDeliveryError(err instanceof Error ? err.message : undefined),
    } satisfies { status: "failed"; error: string });
  }

  if (!isSendSuccess(result.status) || result.error) {
    return c.json({
      status: "failed",
      error: clientSafeDeliveryError(result.error),
    } satisfies { status: "failed"; error: string });
  }

  try {
    await db.$transaction(async (tx) => {
      await writeBulkActionLog(tx, {
        event_id: eventId,
        action_type: "mail_test_sent",
        audit: adminAuditFromContext(c),
      });
    });
  } catch (auditErr) {
    console.error("[audit] mail_test_sent log failed", auditErr);
  }

  return c.json({ status: "sent" } satisfies { status: "sent" });
}

/** POST /api/admin/events/:eventId/templates/:templateId/test-send */
export async function handleTestSendEventTemplateById(
  c: Context,
  db: PrismaClient,
  mailDeliveryDeps: MailDeliveryDeps = {},
  injectedBaseUrl?: string,
): Promise<Response> {
  const eventId = requireEventId(c);
  if (eventId instanceof Response) return eventId;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const templateId = c.req.param("templateId") ?? "";
  try {
    await resolveTemplateById(templateId, eventId, db);
  } catch (err) {
    if (err instanceof TemplateNotFoundError) {
      return c.json({ error: "not_found" }, 404);
    }
    throw err;
  }

  const templateMeta = await db.mailTemplate.findUnique({
    where: { id: templateId },
    select: { name: true },
  });

  let body: z.infer<typeof testSendBodySchema>;
  try {
    body = testSendBodySchema.parse(await c.req.json());
  } catch {
    return c.json({ error: "validation_failed" }, 400);
  }

  const baseUrlOrRes = await resolveMailInstanceBaseUrl(c, db, process.env, injectedBaseUrl);
  if (baseUrlOrRes instanceof Response) return baseUrlOrRes;
  const baseUrl = baseUrlOrRes;

  let result;
  try {
    result = await sendTestEmail(
      { eventId, toAddress: body.to, templateId },
      db,
      process.env,
      mailDeliveryDeps,
      { baseUrl },
    );
  } catch (err) {
    console.error("[admin] template test-send failed", err);
    return c.json({
      status: "failed",
      error: clientSafeDeliveryError(err instanceof Error ? err.message : undefined),
    } satisfies { status: "failed"; error: string });
  }

  if (!isSendSuccess(result.status) || result.error) {
    return c.json({
      status: "failed",
      error: clientSafeDeliveryError(result.error),
    } satisfies { status: "failed"; error: string });
  }

  try {
    await db.$transaction(async (tx) => {
      await writeBulkActionLog(tx, {
        event_id: eventId,
        action_type: "mail_test_sent",
        audit: adminAuditFromContext(c),
        metadata: {
          template_id: templateId,
          template_name: templateMeta?.name ?? "unknown",
        },
      });
    });
  } catch (auditErr) {
    console.error("[audit] mail_test_sent log failed", auditErr);
  }

  return c.json({ status: "sent" } satisfies { status: "sent" });
}

/** GET /api/admin/events/:eventId/deliveries */
/** Delivery list/export filters shared by handleListEventDeliveries and
 * handleExportEventDeliveries — kept as one parser so the two routes can never silently drift
 * on what a given query string actually filters by. */
type DeliveryFilters = {
  status?: EmailDeliveryStatus;
  purpose?: EmailDeliveryPurpose;
  search?: string;
  /** `null` filters to the built-in default ticket template (no custom MailTemplate override). */
  templateId?: string | null;
};

/** Parse status/purpose/search/templateId query params. Returns a 400 Response on an unknown
 * status/purpose literal, otherwise the parsed filter object (empty when nothing was passed). */
function buildDeliveryFilters(c: Context): DeliveryFilters | Response {
  const statusRaw = c.req.query("status")?.trim();
  const purposeRaw = c.req.query("purpose")?.trim();
  const searchRaw = c.req.query("search")?.trim();
  const templateIdRaw = c.req.query("templateId")?.trim();

  const filters: DeliveryFilters = {};
  if (statusRaw && statusRaw !== "all") {
    if (!ALLOWED_DELIVERY_STATUSES.has(statusRaw)) {
      return c.json({ error: "validation_failed" }, 400);
    }
    filters.status = statusRaw as EmailDeliveryStatus;
  }
  if (purposeRaw && purposeRaw !== "all") {
    if (!ALLOWED_DELIVERY_PURPOSES.has(purposeRaw)) {
      return c.json({ error: "validation_failed" }, 400);
    }
    filters.purpose = purposeRaw as EmailDeliveryPurpose;
  }
  if (searchRaw) {
    filters.search = searchRaw;
  }
  if (templateIdRaw) {
    filters.templateId = templateIdRaw === "default" ? null : templateIdRaw;
  }
  return filters;
}

export async function handleListEventDeliveries(c: Context, db: PrismaClient): Promise<Response> {
  const eventId = requireEventId(c);
  if (eventId instanceof Response) return eventId;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const page = positiveIntQuery(c.req.query("page"), 1);
  const pageSize = positiveIntQuery(c.req.query("pageSize"), 25, 100);

  const filters = buildDeliveryFilters(c);
  if (filters instanceof Response) return filters;

  const { items, total } = await listDeliveries(
    {
      eventId,
      filters: Object.keys(filters).length > 0 ? filters : undefined,
      skip: (page - 1) * pageSize,
      take: pageSize,
    },
    db,
  );

  const dto: EventDeliveriesListDto = {
    items: items.map(toDeliveryDto),
    total,
    page,
    pageSize,
  };

  return c.json(dto);
}

/** GET /api/admin/events/:eventId/deliveries/:deliveryId — full detail plus the attendee's whole
 * delivery timeline (this row included, oldest first), for the "View delivery details" modal. */
export async function handleGetEventDelivery(c: Context, db: PrismaClient): Promise<Response> {
  const eventId = requireEventId(c);
  if (eventId instanceof Response) return eventId;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const deliveryId = c.req.param("deliveryId");
  if (!deliveryId) return c.json({ error: "deliveryId required" }, 400);

  const result = await getDeliveryWithTimeline({ eventId, id: deliveryId }, db);
  if (!result) return c.json({ error: "not_found" }, 404);

  const actorUserId = result.entry.actor_user_id;
  const actorMap = actorUserId ? await resolveUserDisplayMap(db, [actorUserId]) : {};
  const actorDisplay = actorUserId ? (actorMap[actorUserId]?.email ?? null) : null;

  const dto: DeliveryDetailDto = toDeliveryDetailDto(result.entry, actorDisplay, result.timeline);
  return c.json(dto);
}

/** GET /api/admin/events/:eventId/deliveries/:deliveryId/rendered — redacted rendered message
 * for the "View sent message" preview. The recipient's real QR code / ticket link are never
 * returned, by construction — see materializeStoredDeliveryMessageRedacted. Either field can
 * independently be null: the delivery wasn't found at all (whole response is null/404), or the
 * retention window already nulled the stored snapshot (see retention.ts nullifyDeliverySnapshots)
 * — callers must render an explicit "message content no longer available" state for the latter. */
export async function handleGetRenderedEventDelivery(
  c: Context,
  db: PrismaClient,
): Promise<Response> {
  const eventId = requireEventId(c);
  if (eventId instanceof Response) return eventId;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const deliveryId = c.req.param("deliveryId");
  if (!deliveryId) return c.json({ error: "deliveryId required" }, 400);

  const rendered = await getRenderedDelivery({ eventId, id: deliveryId }, db);
  if (!rendered) return c.json({ error: "not_found" }, 404);

  if (rendered.rendered_subject == null && rendered.rendered_html == null) {
    return c.json({ subject: null, html: null });
  }

  const redacted = materializeStoredDeliveryMessageRedacted({
    subject: rendered.rendered_subject ?? "",
    html: rendered.rendered_html ?? "",
  });

  return c.json({
    subject: rendered.rendered_subject != null ? redacted.subject : null,
    html: rendered.rendered_html != null ? redacted.html : null,
  });
}

const DELIVERY_CSV_COLUMNS = [
  "Recipient name",
  "Recipient email",
  "Template",
  "Purpose",
  "Status",
  "Provider",
  "Provider message id",
  "Attempts",
  "Retryable",
  "Queued at",
  "Accepted at",
  "Sent at",
  "Failed at",
  "Error code",
  "Error",
] as const;

/** Build CSV text for the delivery log export (CRLF, quoted, formula-injection-safe fields). */
function retryableCsvValue(retryable: boolean | null): string {
  if (retryable === null) return "";
  return retryable ? "yes" : "no";
}

function buildDeliveryLogCsv(rows: DeliveryDto[]): string {
  const header = DELIVERY_CSV_COLUMNS.map((col) => quoteCsvCell(col)).join(",");
  const csvRows = rows.map((r) =>
    [
      r.attendee_name,
      r.recipient_email,
      r.template_name ?? "Default ticket email",
      r.purpose,
      r.status,
      r.provider,
      r.provider_message_id,
      String(r.attempts),
      retryableCsvValue(r.retryable),
      r.queued_at,
      r.accepted_at,
      r.sent_at,
      r.failed_at,
      r.error_code,
      r.error,
    ]
      .map((cell) => quoteCsvCell(sanitizeCsvCell(cell)))
      .join(","),
  );
  return [header, ...csvRows].join("\r\n");
}

/** GET /api/admin/events/:eventId/deliveries/export?format=csv — every delivery matching the
 * current filters (not just the current page), same filters as the list route. Event-scoped
 * (not superadmin-only), so this follows handleExportAttendees'/handleExportReports' convention
 * rather than the org-wide audit-log export's self-audit-log write. */
export async function handleExportEventDeliveries(c: Context, db: PrismaClient): Promise<Response> {
  const eventId = requireEventId(c);
  if (eventId instanceof Response) return eventId;

  if (c.req.query("format") !== "csv") {
    return c.json({ error: "format must be csv" }, 400);
  }

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const filters = buildDeliveryFilters(c);
  if (filters instanceof Response) return filters;

  const { items, total } = await listDeliveries(
    {
      eventId,
      filters: Object.keys(filters).length > 0 ? filters : undefined,
      take: EXPORT_ROW_CAP,
    },
    db,
  );
  if (total > EXPORT_ROW_CAP) {
    return c.json({ error: "export_too_large", count: total, cap: EXPORT_ROW_CAP }, 400);
  }

  const csv = buildDeliveryLogCsv(items.map(toDeliveryDto));
  return csvExportResponse(csv, "delivery-log");
}

const MAX_TEMPLATES_PER_EVENT = 10;
const CREATE_TEMPLATE_MAX_ATTEMPTS = 5;

/** Slug names reserved for system templates; custom create must not claim them. */
const RESERVED_CUSTOM_TEMPLATE_NAMES = new Set(["ticket"]);

class TemplateLimitReachedError extends Error {
  constructor() {
    super("template_limit_reached");
    this.name = "TemplateLimitReachedError";
  }
}

function isPrismaUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

const createTemplateBodySchema = z
  .object({
    label: z.string().trim().min(1).max(120),
    template_format: z.enum(["mjml", "html"]),
    subject_template: z.string().trim().min(1).max(TEMPLATE_SUBJECT_CHAR_LIMIT).optional(),
    body_template: z.string().min(1).max(TEMPLATE_BODY_CHAR_LIMIT).optional(),
  })
  .strict();

const updateTemplateBodySchema = z
  .object({
    label: z.string().trim().min(1).max(120).optional(),
    subject_template: z.string().trim().min(1).max(TEMPLATE_SUBJECT_CHAR_LIMIT).optional(),
    body_template: z.string().min(1).max(TEMPLATE_BODY_CHAR_LIMIT).optional(),
    template_format: z.enum(["mjml", "html"]).optional(),
  })
  .strict();

// eslint-disable-next-line security/detect-unsafe-regex -- bounded input; validated pattern
const tablerIconNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const templateIconSchema = z.string().trim().max(64).regex(tablerIconNamePattern, "invalid icon");

const updateTemplateMetadataBodySchema = z
  .object({
    label: z.string().trim().min(1).max(120).optional(),
    icon: z
      .union([templateIconSchema, z.literal(""), z.null()])
      .optional()
      .transform((v) => (v === undefined ? undefined : v || null)),
    description: z
      .union([z.string().trim().max(500), z.null()])
      .optional()
      .transform((v) => (v === undefined ? undefined : v || null)),
  })
  .strict();

const EMPTY_TEMPLATE_SUBJECT = "Your message for {{event_name}}";
const EMPTY_TEMPLATE_BODY_MJML = `<mjml>
  <mj-body>
    <mj-section>
      <mj-column>
        <mj-text>Hi {{first_name}},</mj-text>
        <mj-text>Edit this template before sending.</mj-text>
        <mj-button href="{{ticket_url}}">View ticket</mj-button>
        <mj-image src="{{qr_image_url}}" alt="QR" width="200px" />
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;
const EMPTY_TEMPLATE_BODY_HTML =
  '<p>Hi {{first_name}},</p><p>Edit this template before sending.</p><p><a href="{{ticket_url}}">View ticket</a></p><img src="{{qr_image_url}}" alt="QR" />';

function slugifyTemplateLabel(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+/, "")
    .replace(/_+$/, "") // NOSONAR — single anchored quantifier, no alternation/nesting; cannot backtrack combinatorially regardless of input length
    .slice(0, 64);
  return slug || "template";
}

async function uniqueTemplateName(
  db: PrismaClient | Prisma.TransactionClient,
  eventId: string,
  baseName: string,
  options?: { reserveSemanticNames?: boolean },
): Promise<string> {
  let candidate = baseName;
  let n = 2;
  while (true) {
    const reserved =
      options?.reserveSemanticNames === true &&
      RESERVED_CUSTOM_TEMPLATE_NAMES.has(candidate);
    const exists =
      reserved ||
      !!(await db.mailTemplate.findUnique({
        where: {
          scope_type_scope_id_name: {
            scope_type: "event",
            scope_id: eventId,
            name: candidate,
          },
        },
        select: { id: true },
      }));
    if (!exists) return candidate;
    const suffix = `_${n}`;
    candidate = `${baseName.slice(0, Math.max(1, 64 - suffix.length))}${suffix}`;
    n += 1;
  }
}

async function getEventTemplateRow(
  db: PrismaClient | Prisma.TransactionClient,
  eventId: string,
  templateId: string,
) {
  return db.mailTemplate.findFirst({
    where: { id: templateId, scope_type: "event", scope_id: eventId },
  });
}

/** Acquire the deletion lock before touching an event-scoped template, then re-check the event.
 * MailTemplate's polymorphic scope has no foreign key, so this is what prevents an orphaned row
 * if permanent deletion committed while a request was waiting for the lock. */
async function lockEventForTemplateWrite(tx: Prisma.TransactionClient, eventId: string): Promise<void> {
  await lockEventForScopedWrite(tx, eventId);
  const event = await tx.event.findUnique({ where: { id: eventId }, select: { id: true } });
  if (!event) throw new EventTemplateGoneDuringWriteError();
}

export type EventTemplateListItemDto = {
  id: string;
  name: string;
  label: string;
  icon: string | null;
  description: string | null;
  template_format: TemplateFormat;
  subject_template: string;
  updated_at: string;
};

export type EventTemplateDetailDto = EventTemplateListItemDto & {
  body_template: string;
  compiled_html_template: string;
};

/** GET /api/admin/events/:eventId/templates */
export async function handleListEventTemplates(c: Context, db: PrismaClient): Promise<Response> {
  const eventId = requireEventId(c);
  if (eventId instanceof Response) return eventId;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const rows = await db.mailTemplate.findMany({
    where: { scope_type: "event", scope_id: eventId },
    orderBy: [{ name: "asc" }],
    select: {
      id: true,
      name: true,
      label: true,
      icon: true,
      description: true,
      template_format: true,
      subject_template: true,
      updated_at: true,
    },
  });

  const items: EventTemplateListItemDto[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    label: row.label,
    icon: row.icon,
    description: row.description,
    template_format: row.template_format as TemplateFormat,
    subject_template: row.subject_template,
    updated_at: row.updated_at.toISOString(),
  }));

  return c.json({ items });
}

/** GET /api/admin/events/:eventId/templates/:templateId */
export async function handleGetEventTemplateById(c: Context, db: PrismaClient): Promise<Response> {
  const eventId = requireEventId(c);
  if (eventId instanceof Response) return eventId;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const templateId = c.req.param("templateId") ?? "";
  const row = await getEventTemplateRow(db, eventId, templateId);
  if (!row) return c.json({ error: "not_found" }, 404);

  const dto: EventTemplateDetailDto = {
    id: row.id,
    name: row.name,
    label: row.label,
    icon: row.icon,
    description: row.description,
    template_format: row.template_format as TemplateFormat,
    subject_template: row.subject_template,
    body_template: row.body_template,
    compiled_html_template: row.compiled_html_template,
    updated_at: row.updated_at.toISOString(),
  };

  return c.json(dto);
}

/** PUT /api/admin/events/:eventId/templates/:templateId */
export async function handlePutEventTemplateById(
  c: Context,
  db: PrismaClient,
): Promise<Response> {
  const eventId = requireEventId(c);
  if (eventId instanceof Response) return eventId;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const templateId = c.req.param("templateId") ?? "";
  const existing = await getEventTemplateRow(db, eventId, templateId);
  if (!existing) return c.json({ error: "not_found" }, 404);

  let body: z.infer<typeof updateTemplateBodySchema>;
  try {
    body = updateTemplateBodySchema.parse(await c.req.json());
  } catch {
    return c.json({ error: "validation_failed" }, 400);
  }

  const subject = body.subject_template ?? existing.subject_template;
  const templateBody = body.body_template ?? existing.body_template;
  const format = (body.template_format ?? existing.template_format) as TemplateFormat;

  const sourceErrors = await collectTemplateSourceErrors(db, eventId, subject, templateBody);
  if (sourceErrors.length > 0) {
    return templateValidationResponse(c, sourceErrors);
  }

  try {
    await db.$transaction(async (tx) => {
      await lockEventForTemplateWrite(tx, eventId);
      // The row can also have disappeared while this request waited for the event lock.
      // Re-read it so this stale request cannot recreate a deleted custom template.
      const current = await getEventTemplateRow(tx, eventId, templateId);
      if (!current) throw new EventTemplateGoneDuringWriteError();
      // Serializes against event-image-assets-routes.ts's delete handler, which takes the same
      // lock before its asset_in_use recheck - without it, a delete could commit between that
      // handler's check and this save (Postgres default isolation is READ COMMITTED).
      await acquireEventImageAssetsLock(tx, eventId);
      await setMailTemplate(
        { scopeType: "event", scopeId: eventId, name: current.name },
        {
          subject,
          body: templateBody,
          format,
          // Omit label when the PUT body did not send one so a concurrent metadata PATCH
          // (rename) is not silently overwritten by the stale `existing.label` snapshot.
          ...(body.label !== undefined ? { label: body.label } : {}),
        },
        tx,
      );
      await writeBulkActionLog(tx, {
        event_id: eventId,
        action_type: "mail_template_updated",
        audit: adminAuditFromContext(c),
        metadata: { template_id: templateId, format },
      });
    });
  } catch (err) {
    if (err instanceof EventTemplateGoneDuringWriteError) return c.json({ error: "not_found" }, 404);
    if (err instanceof UnknownPlaceholdersError) {
      return templateValidationResponse(
        c,
        err.unknown.map((u) => `Unknown placeholder: ${u}`),
      );
    }
    if (err instanceof MjmlCompileError) {
      return mjmlCompileErrorResponse(c, err);
    }
    if (err instanceof PlaceholderInHtmlCommentError) {
      return templateValidationResponse(
        c,
        err.placeholders.map((p) => `Placeholder in HTML comment: ${p}`),
      );
    }
    if (err instanceof UnquotedAttributePlaceholderError) {
      return templateValidationResponse(
        c,
        err.attributes.map((a) => `Unquoted attribute placeholder: ${a}`),
      );
    }
    throw err;
  }

  return handleGetEventTemplateById(c, db);
}

/** PATCH /api/admin/events/:eventId/templates/:templateId - identity fields only
 * (label/icon/description); no MJML compilation, no placeholder validation, since none of
 * these fields ever appear in the rendered email. */
export async function handlePatchEventTemplateMetadata(
  c: Context,
  db: PrismaClient,
): Promise<Response> {
  const eventId = requireEventId(c);
  if (eventId instanceof Response) return eventId;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const templateId = c.req.param("templateId") ?? "";
  const existing = await getEventTemplateRow(db, eventId, templateId);
  if (!existing) return c.json({ error: "not_found" }, 404);

  let body: z.infer<typeof updateTemplateMetadataBodySchema>;
  try {
    body = updateTemplateMetadataBodySchema.parse(await c.req.json());
  } catch {
    return c.json({ error: "validation_failed" }, 400);
  }

  let updated: Awaited<ReturnType<typeof updateMailTemplateMetadata>>;
  try {
    updated = await db.$transaction(async (tx) => {
      await lockEventForTemplateWrite(tx, eventId);
      const current = await getEventTemplateRow(tx, eventId, templateId);
      if (!current) throw new EventTemplateGoneDuringWriteError();
      return updateMailTemplateMetadata(templateId, body, tx);
    });
  } catch (err) {
    if (err instanceof EventTemplateGoneDuringWriteError) return c.json({ error: "not_found" }, 404);
    throw err;
  }

  return c.json({
    id: updated.id,
    name: updated.name,
    label: updated.label,
    icon: updated.icon,
    description: updated.description,
    template_format: updated.template_format as TemplateFormat,
    subject_template: updated.subject_template,
    updated_at: updated.updated_at.toISOString(),
  } satisfies EventTemplateListItemDto);
}

/** Create the event's template row inside a transaction, serialized against permanent deletion
 * and the image-assets delete handler, and re-checking the per-event template cap under lock. */
async function createEventTemplateRow(
  db: PrismaClient,
  eventId: string,
  baseName: string,
  subject: string,
  templateBody: string,
  format: TemplateFormat,
  label: string,
) {
  return db.$transaction(async (tx) => {
    await lockEventForTemplateWrite(tx, eventId);
    // Serializes against event-image-assets-routes.ts's delete handler, which takes the
    // same lock before its asset_in_use recheck - without it, a delete could commit between
    // that handler's check and this create (Postgres default isolation is READ COMMITTED).
    await acquireEventImageAssetsLock(tx, eventId);

    const eventCount = await tx.mailTemplate.count({
      where: { scope_type: "event", scope_id: eventId },
    });
    if (eventCount >= MAX_TEMPLATES_PER_EVENT) {
      throw new TemplateLimitReachedError();
    }

    const name = await uniqueTemplateName(tx, eventId, baseName, {
      reserveSemanticNames: true,
    });

    return createMailTemplate(
      { scopeType: "event", scopeId: eventId, name },
      { subject, body: templateBody, format, label },
      tx,
    );
  });
}

/** Maps an error thrown while creating an event template to an HTTP response, or tells the
 * caller to retry the create loop (`"retry"`), or returns `undefined` to signal "rethrow" for
 * unrecognized errors. Preserves the exact precedence of the original inline handling. */
function createTemplateErrorResponse(
  c: Context,
  err: unknown,
  attempt: number,
): Response | "retry" | undefined {
  if (err instanceof EventTemplateGoneDuringWriteError) return c.json({ error: "not_found" }, 404);
  if (err instanceof TemplateLimitReachedError) {
    return c.json({ error: "template_limit_reached", limit: MAX_TEMPLATES_PER_EVENT }, 422);
  }
  if (isPrismaUniqueViolation(err)) {
    if (attempt < CREATE_TEMPLATE_MAX_ATTEMPTS - 1) return "retry";
    return c.json({ error: "template_name_conflict" }, 409);
  }
  if (err instanceof MjmlCompileError) {
    return mjmlCompileErrorResponse(c, err);
  }
  if (err instanceof UnknownPlaceholdersError) {
    return templateValidationResponse(
      c,
      err.unknown.map((u) => `Unknown placeholder: ${u}`),
    );
  }
  if (err instanceof PlaceholderInHtmlCommentError) {
    return templateValidationResponse(
      c,
      err.placeholders.map((p) => `Placeholder in HTML comment: ${p}`),
    );
  }
  if (err instanceof UnquotedAttributePlaceholderError) {
    return templateValidationResponse(
      c,
      err.attributes.map((a) => `Unquoted attribute placeholder: ${a}`),
    );
  }
  return undefined;
}

/** POST /api/admin/events/:eventId/templates */
export async function handleCreateEventTemplate(c: Context, db: PrismaClient): Promise<Response> {
  const eventId = requireEventId(c);
  if (eventId instanceof Response) return eventId;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  let body: z.infer<typeof createTemplateBodySchema>;
  try {
    body = createTemplateBodySchema.parse(await c.req.json());
  } catch {
    return c.json({ error: "validation_failed" }, 400);
  }

  const count = await db.mailTemplate.count({
    where: { scope_type: "event", scope_id: eventId },
  });
  if (count >= MAX_TEMPLATES_PER_EVENT) {
    return c.json({ error: "template_limit_reached", limit: MAX_TEMPLATES_PER_EVENT }, 422);
  }

  const baseName = slugifyTemplateLabel(body.label);
  const format = body.template_format;
  const subject = body.subject_template ?? EMPTY_TEMPLATE_SUBJECT;
  const templateBody =
    body.body_template ??
    (format === "mjml" ? EMPTY_TEMPLATE_BODY_MJML : EMPTY_TEMPLATE_BODY_HTML);

  const sourceErrors = await collectTemplateSourceErrors(db, eventId, subject, templateBody);
  if (sourceErrors.length > 0) {
    return templateValidationResponse(c, sourceErrors);
  }

  for (let attempt = 0; attempt < CREATE_TEMPLATE_MAX_ATTEMPTS; attempt++) {
    try {
      const created = await createEventTemplateRow(
        db,
        eventId,
        baseName,
        subject,
        templateBody,
        format,
        body.label,
      );

      return c.json(
        {
          id: created.id,
          name: created.name,
          label: created.label,
          icon: created.icon,
          description: created.description,
          template_format: created.template_format as TemplateFormat,
          subject_template: created.subject_template,
          body_template: created.body_template,
          compiled_html_template: created.compiled_html_template,
          updated_at: created.updated_at.toISOString(),
        } satisfies EventTemplateDetailDto,
        201,
      );
    } catch (err) {
      const mapped = createTemplateErrorResponse(c, err, attempt);
      if (mapped === "retry") continue;
      if (mapped !== undefined) return mapped;
      throw err;
    }
  }

  return c.json({ error: "template_name_conflict" }, 409);
}

/** DELETE /api/admin/events/:eventId/templates/:templateId */
export async function handleDeleteEventTemplate(c: Context, db: PrismaClient): Promise<Response> {
  const eventId = requireEventId(c);
  if (eventId instanceof Response) return eventId;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const templateId = c.req.param("templateId") ?? "";
  const row = await getEventTemplateRow(db, eventId, templateId);
  if (!row) return c.json({ error: "not_found" }, 404);

  if (row.name === "ticket") {
    return c.json({ error: "template_required" }, 422);
  }

  const result = await db.$transaction(async (tx) => {
    await lockEventForTemplateWrite(tx, eventId);
    const current = await getEventTemplateRow(tx, eventId, templateId);
    if (!current) throw new EventTemplateGoneDuringWriteError();
    if (current.name === "ticket") return "template_required" as const;
    await tx.mailTemplate.delete({ where: { id: templateId } });
    return "ok" as const;
  }).catch((err: unknown) => {
    if (err instanceof EventTemplateGoneDuringWriteError) return "not_found" as const;
    throw err;
  });
  if (result === "not_found") return c.json({ error: "not_found" }, 404);
  if (result === "template_required") return c.json({ error: "template_required" }, 422);
  return c.json({ ok: true });
}

/** POST /api/admin/events/:eventId/templates/:templateId/preview */
export async function handlePreviewEventTemplateById(
  c: Context,
  db: PrismaClient,
  injectedBaseUrl?: string,
): Promise<Response> {
  const eventId = requireEventId(c);
  if (eventId instanceof Response) return eventId;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const templateId = c.req.param("templateId") ?? "";
  const existing = await getEventTemplateRow(db, eventId, templateId);
  if (!existing) return c.json({ error: "not_found" }, 404);

  let body: z.infer<typeof updateTemplateBodySchema>;
  try {
    body = updateTemplateBodySchema.parse(await c.req.json());
  } catch {
    return c.json({ error: "validation_failed" }, 400);
  }

  const subject = body.subject_template ?? existing.subject_template;
  const templateBody = body.body_template ?? existing.body_template;
  const format = (body.template_format ?? existing.template_format) as TemplateFormat;

  const sourceErrors = await collectTemplateSourceErrors(db, eventId, subject, templateBody);
  if (sourceErrors.length > 0) {
    return templateValidationResponse(c, sourceErrors);
  }

  const baseUrlOrRes = await resolveMailInstanceBaseUrl(c, db, process.env, injectedBaseUrl);
  if (baseUrlOrRes instanceof Response) return baseUrlOrRes;
  const baseUrl = baseUrlOrRes;

  try {
    const rendered = await renderDraftPreview(db, eventId, subject, templateBody, format, baseUrl);
    return c.json({ subject: rendered.subject, html: rendered.html });
  } catch (err) {
    if (err instanceof MjmlCompileError) {
      return mjmlCompileErrorResponse(c, err);
    }
    if (err instanceof PlaceholderInHtmlCommentError) {
      return templateValidationResponse(
        c,
        err.placeholders.map((p) => `Placeholder in HTML comment: ${p}`),
      );
    }
    if (err instanceof UnquotedAttributePlaceholderError) {
      return templateValidationResponse(
        c,
        err.attributes.map((a) => `Unquoted attribute placeholder: ${a}`),
      );
    }
    throw err;
  }
}
