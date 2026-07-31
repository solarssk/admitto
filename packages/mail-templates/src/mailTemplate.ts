import type { Prisma, PrismaClient } from "@admitto/db";
import { compileTemplate } from "./compile.js";
import { getBuiltinTemplate } from "./defaultTemplate.js";
import { assertRenderableCompiledHtml, assertValidTemplate } from "./validate.js";
import { resolveEventImageAssetVars } from "./branding.js";
import type {
  ResolvedTemplate,
  SetMailTemplateInput,
  TemplateFormat,
  TemplateScope,
} from "./types.js";
export { MjmlCompileError, UnknownPlaceholdersError } from "./errors.js";

const DEFAULT_TEMPLATE_NAME = "ticket";

/** Custom asset tokens are only meaningful for event-scoped templates (the image library is
 * per-event) — organization-scoped templates never get a widened placeholder whitelist. */
async function resolveScopeCustomPlaceholders(
  scope: TemplateScope,
  prisma: PrismaClient | Prisma.TransactionClient,
): Promise<ReadonlySet<string> | undefined> {
  if (scope.scopeType !== "event") return undefined;
  const { names } = await resolveEventImageAssetVars(scope.scopeId, prisma);
  return names;
}

function scopeNameKey(scope: TemplateScope): {
  scope_type: string;
  scope_id: string;
  name: string;
} {
  return {
    scope_type: scope.scopeType,
    scope_id: scope.scopeId,
    name: scope.name ?? DEFAULT_TEMPLATE_NAME,
  };
}

/**
 * Resolves effective ticket template for a preloaded event row:
 * event MailTemplate (name=ticket) → org MailTemplate (name=ticket) → built-in default.
 */
export async function resolveTemplateForEvent(
  event: { id: string; organization_id: string },
  prisma: PrismaClient,
): Promise<ResolvedTemplate> {
  const eventRow = await prisma.mailTemplate.findUnique({
    where: {
      scope_type_scope_id_name: {
        scope_type: "event",
        scope_id: event.id,
        name: DEFAULT_TEMPLATE_NAME,
      },
    },
  });
  if (eventRow) {
    return rowToResolved(eventRow, "event");
  }

  const orgRow = await prisma.mailTemplate.findUnique({
    where: {
      scope_type_scope_id_name: {
        scope_type: "organization",
        scope_id: event.organization_id,
        name: DEFAULT_TEMPLATE_NAME,
      },
    },
  });
  if (orgRow) {
    return rowToResolved(orgRow, "organization");
  }

  return await getBuiltinTemplate();
}

/**
 * Resolves effective ticket template: event → org → built-in default.
 */
export async function resolveTemplate(
  eventId: string,
  prisma: PrismaClient,
): Promise<ResolvedTemplate> {
  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
  return resolveTemplateForEvent(event, prisma);
}

/**
 * Resolve a MailTemplate by id for an event (event-scope row or org-scope for event's org).
 */
export async function resolveTemplateById(
  templateId: string,
  eventId: string,
  prisma: PrismaClient,
): Promise<ResolvedTemplate> {
  const event = await prisma.event.findUniqueOrThrow({
    where: { id: eventId },
    select: { id: true, organization_id: true },
  });

  const row = await prisma.mailTemplate.findUnique({ where: { id: templateId } });
  if (!row) {
    throw new TemplateNotFoundError(templateId);
  }

  const allowed =
    (row.scope_type === "event" && row.scope_id === event.id) ||
    (row.scope_type === "organization" && row.scope_id === event.organization_id);

  if (!allowed) {
    throw new TemplateNotFoundError(templateId);
  }

  return rowToResolved(row, row.scope_type as "event" | "organization");
}

export class TemplateNotFoundError extends Error {
  constructor(templateId: string) {
    super(`Mail template not found: ${templateId}`);
    this.name = "TemplateNotFoundError";
  }
}

function parseTemplateFormat(value: string, source: ResolvedTemplate["source"]): TemplateFormat {
  if (value === "mjml" || value === "html") return value;
  throw new Error(`Invalid template_format "${value}" for ${source} MailTemplate`);
}

function rowToResolved(
  row: {
    id: string;
    subject_template: string;
    compiled_html_template: string;
    template_format: string;
  },
  source: "event" | "organization",
): ResolvedTemplate {
  return {
    subjectTemplate: row.subject_template,
    compiledHtmlTemplate: row.compiled_html_template,
    templateFormat: parseTemplateFormat(row.template_format, source),
    source,
    templateId: row.id,
  };
}

export type CreatedMailTemplateRow = {
  id: string;
  name: string;
  label: string;
  template_format: string;
  subject_template: string;
  body_template: string;
  compiled_html_template: string;
  updated_at: Date;
};

/** Validate placeholders, compile MJML if needed, insert a new MailTemplate row. */
export async function createMailTemplate(
  scope: TemplateScope,
  input: SetMailTemplateInput,
  prisma: PrismaClient | Prisma.TransactionClient,
): Promise<CreatedMailTemplateRow> {
  const extraAllowed = await resolveScopeCustomPlaceholders(scope, prisma);
  assertValidTemplate({ subject: input.subject, body: input.body }, extraAllowed);

  const compiledHtml = await compileTemplate(input.body, input.format);
  if (input.format === "mjml") {
    assertRenderableCompiledHtml(compiledHtml);
  }

  const key = scopeNameKey(scope);

  return prisma.mailTemplate.create({
    data: {
      scope_type: key.scope_type,
      scope_id: key.scope_id,
      name: key.name,
      label: input.label ?? (key.name === DEFAULT_TEMPLATE_NAME ? "Ticket email" : key.name),
      subject_template: input.subject,
      body_template: input.body,
      template_format: input.format,
      compiled_html_template: compiledHtml,
    },
  });
}

/** Validate placeholders, compile MJML if needed, upsert MailTemplate row. */
export async function setMailTemplate(
  scope: TemplateScope,
  input: SetMailTemplateInput,
  prisma: PrismaClient | Prisma.TransactionClient,
): Promise<void> {
  const extraAllowed = await resolveScopeCustomPlaceholders(scope, prisma);
  assertValidTemplate({ subject: input.subject, body: input.body }, extraAllowed);

  const compiledHtml = await compileTemplate(input.body, input.format);
  if (input.format === "mjml") {
    assertRenderableCompiledHtml(compiledHtml);
  }

  const key = scopeNameKey(scope);

  await prisma.mailTemplate.upsert({
    where: { scope_type_scope_id_name: key },
    create: {
      scope_type: key.scope_type,
      scope_id: key.scope_id,
      name: key.name,
      label: input.label ?? (key.name === DEFAULT_TEMPLATE_NAME ? "Ticket email" : key.name),
      subject_template: input.subject,
      body_template: input.body,
      template_format: input.format,
      compiled_html_template: compiledHtml,
    },
    update: {
      ...(input.label !== undefined ? { label: input.label } : {}),
      subject_template: input.subject,
      body_template: input.body,
      template_format: input.format,
      compiled_html_template: compiledHtml,
    },
  });
}
