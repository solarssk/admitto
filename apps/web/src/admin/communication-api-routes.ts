import type { Context } from "hono";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { EmailDeliveryStatus, EmailDeliveryPurpose } from "@admitto/db";
import { EMAIL_DELIVERY_STATUS, EMAIL_DELIVERY_PURPOSE } from "@admitto/db/status";
import { z } from "zod";
import {
  ALLOWED_PLACEHOLDERS,
  REQUIRED_URL_PLACEHOLDERS,
  IMAGE_PLACEHOLDERS,
  DEFAULT_BODY_MJML,
  DEFAULT_SUBJECT_TEMPLATE,
  DEFAULT_SAMPLE_VARS,
  assertValidTemplate,
  assertRenderableCompiledHtml,
  compileTemplate,
  findMissingRequiredPlaceholders,
  formatEventDate,
  renderTemplate,
  resolveBrandingFromEvent,
  resolveEventImageAssetVars,
  createMailTemplate,
  setMailTemplate,
  validateTemplate,
  UnknownPlaceholdersError,
  MjmlCompileError,
  PlaceholderInHtmlCommentError,
  UnquotedAttributePlaceholderError,
  resolveTemplateById,
  TemplateNotFoundError,
  type TemplateFormat,
  type TemplateSource,
} from "@admitto/mail-templates";
import {
  listDeliveries,
  sendTestEmail,
  toDeliveryDto,
  clientSafeDeliveryError,
  type DeliveryDto,
  type MailDeliveryDeps,
} from "@admitto/mail-delivery";
import { isSendSuccess } from "@admitto/mailer";
import { writeBulkActionLog } from "@admitto/tickets";
import {
  adminAuditFromContext,
  assertEventManageAccess,
  positiveIntQuery,
  requireEventId,
  resolveMailInstanceBaseUrl,
} from "./admin-helpers.js";

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

const templateBodySchema = z
  .object({
    subject_template: z.string().trim().min(1).max(TEMPLATE_SUBJECT_CHAR_LIMIT),
    body_template: z.string().min(1).max(TEMPLATE_BODY_CHAR_LIMIT),
    template_format: z.enum(["mjml", "html"]),
  })
  .strict();

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
};

/** Paginated delivery log response for GET /deliveries. */
export type EventDeliveriesListDto = {
  items: DeliveryDto[];
  total: number;
  page: number;
  pageSize: number;
};

const ALLOWED_PLACEHOLDER_LIST = [...ALLOWED_PLACEHOLDERS].sort();
const REQUIRED_URL_PLACEHOLDER_LIST = [...REQUIRED_URL_PLACEHOLDERS].sort();
const IMAGE_PLACEHOLDER_LIST = [...IMAGE_PLACEHOLDERS].sort();
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

/** Return 400 JSON when MJML compilation fails. */
function mjmlCompileErrorResponse(c: Context, err: MjmlCompileError): Response {
  const errors = err.errors.map((e) => e.formattedMessage ?? e.message);
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
    include: { organization: true },
  });
  const branding = resolveBrandingFromEvent(event);
  const customAssets = await resolveEventImageAssetVars(eventId, db);

  const vars = {
    ...DEFAULT_SAMPLE_VARS,
    event_name: event.title,
    event_date: formatEventDate(event.date, "UTC"),
    event_location: event.location ?? "",
    logo_url: branding.logo_url,
    header_image_url: branding.header_image_url,
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

  const dto: EventTemplateDto = {
    ...template,
    allowed_placeholders: [...ALLOWED_PLACEHOLDER_LIST, ...customAssetNames].sort(),
    required_url_placeholders: REQUIRED_URL_PLACEHOLDER_LIST,
    image_placeholders: [...IMAGE_PLACEHOLDER_LIST, ...customAssetNames].sort(),
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
export async function handleListEventDeliveries(c: Context, db: PrismaClient): Promise<Response> {
  const eventId = requireEventId(c);
  if (eventId instanceof Response) return eventId;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const page = positiveIntQuery(c.req.query("page"), 1);
  const pageSize = positiveIntQuery(c.req.query("pageSize"), 25, 100);
  const statusRaw = c.req.query("status")?.trim();
  const purposeRaw = c.req.query("purpose")?.trim();

  const filters: { status?: EmailDeliveryStatus; purpose?: EmailDeliveryPurpose } = {};
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
    .replace(/^_+|_+$/g, "")
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

async function getEventTemplateRow(db: PrismaClient, eventId: string, templateId: string) {
  return db.mailTemplate.findFirst({
    where: { id: templateId, scope_type: "event", scope_id: eventId },
  });
}

export type EventTemplateListItemDto = {
  id: string;
  name: string;
  label: string;
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
      template_format: true,
      subject_template: true,
      updated_at: true,
    },
  });

  const items: EventTemplateListItemDto[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    label: row.label,
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
      await setMailTemplate(
        { scopeType: "event", scopeId: eventId, name: existing.name },
        {
          subject,
          body: templateBody,
          format,
          label: body.label ?? existing.label,
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
      const created = await db.$transaction(async (tx) => {
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
          { subject, body: templateBody, format, label: body.label },
          tx,
        );
      });

      return c.json(
        {
          id: created.id,
          name: created.name,
          label: created.label,
          template_format: created.template_format as TemplateFormat,
          subject_template: created.subject_template,
          body_template: created.body_template,
          compiled_html_template: created.compiled_html_template,
          updated_at: created.updated_at.toISOString(),
        } satisfies EventTemplateDetailDto,
        201,
      );
    } catch (err) {
      if (err instanceof TemplateLimitReachedError) {
        return c.json({ error: "template_limit_reached", limit: MAX_TEMPLATES_PER_EVENT }, 422);
      }
      if (isPrismaUniqueViolation(err) && attempt < CREATE_TEMPLATE_MAX_ATTEMPTS - 1) {
        continue;
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
      if (isPrismaUniqueViolation(err)) {
        return c.json({ error: "template_name_conflict" }, 409);
      }
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

  await db.mailTemplate.delete({ where: { id: templateId } });
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
