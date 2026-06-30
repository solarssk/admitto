import type { Context } from "hono";
import type { PrismaClient } from "@prisma/client";
import type { EmailDeliveryStatus, EmailDeliveryPurpose } from "@admitto/db";
import { EMAIL_DELIVERY_STATUS, EMAIL_DELIVERY_PURPOSE } from "@admitto/db/status";
import { z } from "zod";
import {
  ALLOWED_PLACEHOLDERS,
  REQUIRED_URL_PLACEHOLDERS,
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
  setMailTemplate,
  validateTemplate,
  UnknownPlaceholdersError,
  MjmlCompileError,
  PlaceholderInHtmlCommentError,
  UnquotedAttributePlaceholderError,
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
} from "./admin-helpers.js";
import { resolveBaseUrl } from "../config.js";

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
const ALLOWED_DELIVERY_STATUSES = new Set<string>(EMAIL_DELIVERY_STATUS);
const ALLOWED_DELIVERY_PURPOSES = new Set<string>(EMAIL_DELIVERY_PURPOSE);

/** Collect template source validation errors for API 400 responses. */
function collectTemplateSourceErrors(subject: string, body: string): string[] {
  const errors: string[] = [];

  for (const unknown of validateTemplate({ subject, body })) {
    errors.push(`Unknown placeholder: ${unknown}`);
  }
  for (const missing of findMissingRequiredPlaceholders(subject, body)) {
    errors.push(`Missing required placeholder: ${missing}`);
  }

  try {
    assertValidTemplate({ subject, body });
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
    where: { scope_type_scope_id: { scope_type: "event", scope_id: eventId } },
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
      scope_type_scope_id: {
        scope_type: "organization",
        scope_id: event.organization_id,
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

  const vars = {
    ...DEFAULT_SAMPLE_VARS,
    event_name: event.title,
    event_date: formatEventDate(event.date, "UTC"),
    event_location: event.location ?? "",
    logo_url: branding.logo_url,
    header_image_url: branding.header_image_url,
  };

  return renderTemplate({ subject, compiledHtml }, vars, { baseUrl });
}

/** GET /api/admin/events/:eventId/template */
export async function handleGetEventTemplate(c: Context, db: PrismaClient): Promise<Response> {
  const eventId = requireEventId(c);
  if (eventId instanceof Response) return eventId;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const template = await resolveEventTemplateForEditor(db, eventId);

  const dto: EventTemplateDto = {
    ...template,
    allowed_placeholders: ALLOWED_PLACEHOLDER_LIST,
    required_url_placeholders: REQUIRED_URL_PLACEHOLDER_LIST,
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

  const sourceErrors = collectTemplateSourceErrors(body.subject_template, body.body_template);
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
export async function handlePreviewEventTemplate(c: Context, db: PrismaClient): Promise<Response> {
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

  const sourceErrors = collectTemplateSourceErrors(body.subject_template, body.body_template);
  if (sourceErrors.length > 0) {
    return templateValidationResponse(c, sourceErrors);
  }

  try {
    const rendered = await renderDraftPreview(
      db,
      eventId,
      body.subject_template,
      body.body_template,
      body.template_format,
      resolveBaseUrl(process.env),
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

  let result;
  try {
    result = await sendTestEmail(
      { eventId, toAddress: body.to },
      db,
      process.env,
      mailDeliveryDeps,
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
