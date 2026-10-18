import type { ResolvedTemplate, TemplateFormat } from "./types.js";
import { compileTemplate } from "./compile.js";
import { DEFAULT_TEMPLATE_NAME, type SystemTemplateName } from "./systemTemplates.js";

/** Built-in default ticket email — MJML source (text-only header, no logo section). */
export const DEFAULT_SUBJECT_TEMPLATE = "Your ticket for {{event_name}}";

export const DEFAULT_BODY_MJML = `<mjml>
  <mj-head>
    <mj-attributes>
      <mj-all font-family="Arial, Helvetica, sans-serif" />
      <mj-text font-size="16px" line-height="24px" color="#333333" />
    </mj-attributes>
  </mj-head>
  <mj-body background-color="#f4f4f4" width="600px">
    <mj-section background-color="#ffffff" padding="24px">
      <mj-column>
        <mj-text align="center" font-size="22px" font-weight="bold" padding-bottom="8px">
          {{event_name}}
        </mj-text>
        <mj-text padding-bottom="16px">
          Hi {{first_name}},
        </mj-text>
        <mj-text padding-bottom="16px">
          Your event ticket is ready. Use the button below to view your ticket and QR code.
        </mj-text>
        <mj-button href="{{ticket_url}}" background-color="#206bc4" color="#ffffff" font-size="16px" inner-padding="12px 24px" border-radius="4px">
          View your ticket
        </mj-button>
        <mj-image src="{{qr_image_url}}" alt="Ticket QR code" width="200px" height="200px" padding-top="24px" padding-bottom="8px" />
        <mj-text align="center" font-size="14px" color="#666666" padding-top="16px">
          {{event_date}} · {{event_location}}
        </mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;

/** One registration mail in the shared skeleton: greeting, paragraphs, optional button, and the
 * contact line every guest mail carries (D-B12). Only the wording differs between the four. */
function registrationMjml(input: {
  paragraphs: readonly string[];
  button?: { href: string; label: string };
}): string {
  const paragraphs = input.paragraphs
    .map((text) => `        <mj-text padding-bottom="16px">\n          ${text}\n        </mj-text>`)
    .join("\n");
  const button = input.button
    ? `
        <mj-button href="${input.button.href}" background-color="#206bc4" color="#ffffff" font-size="16px" inner-padding="12px 24px" border-radius="4px">
          ${input.button.label}
        </mj-button>`
    : "";
  return `<mjml>
  <mj-head>
    <mj-attributes>
      <mj-all font-family="Arial, Helvetica, sans-serif" />
      <mj-text font-size="16px" line-height="24px" color="#333333" />
    </mj-attributes>
  </mj-head>
  <mj-body background-color="#f4f4f4" width="600px">
    <mj-section background-color="#ffffff" padding="24px">
      <mj-column>
        <mj-text align="center" font-size="22px" font-weight="bold" padding-bottom="8px">
          {{event_name}}
        </mj-text>
        <mj-text padding-bottom="16px">
          Hi {{first_name}},
        </mj-text>
${paragraphs}${button}
        <mj-text align="center" font-size="14px" color="#666666" padding-top="16px">
          {{event_date}} · {{event_location}}
        </mj-text>
        <mj-text align="center" font-size="14px" color="#666666">
          Questions? Contact {{contact_name}} at {{contact_email}}.
        </mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;
}

/** A built-in mail: source text plus the label a fresh override row starts with. */
export interface BuiltinTemplateSource {
  label: string;
  subject: string;
  body: string;
  format: TemplateFormat;
}

/** Every built-in default, by template name. A Map and not an object: a lookup by a name that
 * came from a row or a request must not reach `Object.prototype` (and `detect-object-injection`
 * is an error in this package). An unknown name throws instead of falling back to the ticket
 * mail, because that fallback would send an attendee's ticket in place of a registration notice. */
const BUILTIN_SOURCES: ReadonlyMap<string, BuiltinTemplateSource> = new Map<
  string,
  BuiltinTemplateSource
>([
  [
    DEFAULT_TEMPLATE_NAME,
    {
      label: "Ticket email",
      subject: DEFAULT_SUBJECT_TEMPLATE,
      body: DEFAULT_BODY_MJML,
      format: "mjml",
    },
  ],
  [
    "registration-confirm" satisfies SystemTemplateName,
    {
      label: "Registration: confirm email",
      subject: "Confirm your email for {{event_name}}",
      body: registrationMjml({
        paragraphs: [
          "Thank you for registering for {{event_name}}. Please confirm your email address to finish your registration. The link works for 24 hours.",
        ],
        button: { href: "{{confirm_url}}", label: "Confirm email address" },
      }),
      format: "mjml",
    },
  ],
  [
    "registration-received" satisfies SystemTemplateName,
    {
      label: "Registration: received",
      subject: "We received your registration for {{event_name}}",
      body: registrationMjml({
        paragraphs: [
          "Thank you for registering for {{event_name}}. The organizers review every registration, and we will email you as soon as there is a decision.",
        ],
      }),
      format: "mjml",
    },
  ],
  [
    "registration-waitlist" satisfies SystemTemplateName,
    {
      label: "Registration: waiting list",
      subject: "You are on the waiting list for {{event_name}}",
      body: registrationMjml({
        paragraphs: [
          "{{event_name}} is full at the moment, so your registration is on the waiting list.",
          "If the organizers can offer you a place, we will email you.",
        ],
      }),
      format: "mjml",
    },
  ],
  [
    "registration-rejected" satisfies SystemTemplateName,
    {
      label: "Registration: declined",
      subject: "Your registration for {{event_name}}",
      body: registrationMjml({
        paragraphs: [
          "Thank you for your interest in {{event_name}}. We are sorry, but we are not able to offer you a place.",
        ],
      }),
      format: "mjml",
    },
  ],
]);

/** Thrown for a template name with no built-in default. */
export class UnknownBuiltinTemplateError extends Error {
  constructor(name: string) {
    super(`No built-in mail template named "${name}"`);
    this.name = "UnknownBuiltinTemplateError";
  }
}

/** Source (subject, MJML body, label) of a built-in default - what "Revert to default" and a
 * new override start from. @throws UnknownBuiltinTemplateError for a name with no default. */
export function getBuiltinTemplateSource(name: string): BuiltinTemplateSource {
  const source = BUILTIN_SOURCES.get(name);
  if (!source) throw new UnknownBuiltinTemplateError(name);
  return source;
}

/** Label a new row of this name starts with: the built-in's, else the name itself. */
export function defaultTemplateLabel(name: string): string {
  return BUILTIN_SOURCES.get(name)?.label ?? name;
}

const builtinCache = new Map<string, Promise<ResolvedTemplate>>();

/** Pre-compiled built-in default (compiled once per name, lazily). `ticket` unless a name is
 * given. @throws UnknownBuiltinTemplateError for a name with no default. */
export async function getBuiltinTemplate(
  name: string = DEFAULT_TEMPLATE_NAME,
): Promise<ResolvedTemplate> {
  const cached = builtinCache.get(name);
  if (cached) return cached;
  const source = getBuiltinTemplateSource(name);
  const compiling = (async (): Promise<ResolvedTemplate> => ({
    subjectTemplate: source.subject,
    compiledHtmlTemplate: await compileTemplate(source.body, source.format),
    templateFormat: source.format,
    source: "builtin",
  }))().catch((err: unknown) => {
    builtinCache.delete(name);
    throw err;
  });
  builtinCache.set(name, compiling);
  return compiling;
}

/**
 * Test-only: reset module cache between isolated import tests.
 * Not re-exported from package index — import from `./defaultTemplate.js` in tests.
 */
export function resetBuiltinTemplateCacheForTests(): void {
  builtinCache.clear();
}
