import type { Prisma, PrismaClient } from "@prisma/client";
import { compileTemplate } from "./compile.js";
import { getBuiltinTemplate } from "./defaultTemplate.js";
import { assertRenderableCompiledHtml, assertValidTemplate } from "./validate.js";
import type {
  ResolvedTemplate,
  SetMailTemplateInput,
  TemplateFormat,
  TemplateScope,
} from "./types.js";
import { MjmlCompileError, UnknownPlaceholdersError } from "./errors.js";

export { UnknownPlaceholdersError, MjmlCompileError };

/**
 * Resolves effective template for a preloaded event row:
 * event MailTemplate → org MailTemplate → built-in default.
 */
export async function resolveTemplateForEvent(
  event: { id: string; organization_id: string },
  prisma: PrismaClient,
): Promise<ResolvedTemplate> {
  const eventRow = await prisma.mailTemplate.findUnique({
    where: { scope_type_scope_id: { scope_type: "event", scope_id: event.id } },
  });
  if (eventRow) {
    return rowToResolved(eventRow, "event");
  }

  const orgRow = await prisma.mailTemplate.findUnique({
    where: {
      scope_type_scope_id: {
        scope_type: "organization",
        scope_id: event.organization_id,
      },
    },
  });
  if (orgRow) {
    return rowToResolved(orgRow, "organization");
  }

  return await getBuiltinTemplate();
}

/**
 * Resolves effective template: event MailTemplate → org MailTemplate → built-in default.
 */
export async function resolveTemplate(
  eventId: string,
  prisma: PrismaClient,
): Promise<ResolvedTemplate> {
  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
  return resolveTemplateForEvent(event, prisma);
}

function parseTemplateFormat(value: string, source: ResolvedTemplate["source"]): TemplateFormat {
  if (value === "mjml" || value === "html") return value;
  throw new Error(`Invalid template_format "${value}" for ${source} MailTemplate`);
}

function rowToResolved(
  row: {
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
  };
}

/** Validate placeholders, compile MJML if needed, upsert MailTemplate row. */
export async function setMailTemplate(
  scope: TemplateScope,
  input: SetMailTemplateInput,
  prisma: PrismaClient | Prisma.TransactionClient,
): Promise<void> {
  assertValidTemplate({ subject: input.subject, body: input.body });

  const compiledHtml = await compileTemplate(input.body, input.format);
  if (input.format === "mjml") {
    assertRenderableCompiledHtml(compiledHtml);
  }

  await prisma.mailTemplate.upsert({
    where: {
      scope_type_scope_id: {
        scope_type: scope.scopeType,
        scope_id: scope.scopeId,
      },
    },
    create: {
      scope_type: scope.scopeType,
      scope_id: scope.scopeId,
      subject_template: input.subject,
      body_template: input.body,
      template_format: input.format,
      compiled_html_template: compiledHtml,
    },
    update: {
      subject_template: input.subject,
      body_template: input.body,
      template_format: input.format,
      compiled_html_template: compiledHtml,
    },
  });
}
