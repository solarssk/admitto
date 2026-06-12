import type { PrismaClient } from "@prisma/client";
import { resolveBranding } from "./branding.js";
import { resolveTemplate } from "./mailTemplate.js";
import { renderTemplate } from "./render.js";
import type { RenderedTemplate, TemplateVars } from "./types.js";

export const DEFAULT_SAMPLE_VARS: TemplateVars = {
  first_name: "Alex",
  last_name: "Example",
  full_name: "Alex Example",
  email: "alex@example.com",
  event_name: "Sample Event",
  event_date: "2026-09-01",
  event_location: "Warsaw",
  ticket_url: "https://tickets.example.com/t/sample-token",
  qr_image_url: "https://tickets.example.com/q/sample-token.png",
  logo_url: "",
  apple_wallet_url: "",
  google_wallet_url: "",
  download_page_url: "",
};

function formatEventDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Renders the resolved template with sample data — no mail send.
 */
export async function previewTemplate(
  eventId: string,
  prisma: PrismaClient,
  sampleVars?: Partial<TemplateVars>,
): Promise<RenderedTemplate> {
  const [resolved, branding, event] = await Promise.all([
    resolveTemplate(eventId, prisma),
    resolveBranding(eventId, prisma),
    prisma.event.findUniqueOrThrow({ where: { id: eventId } }),
  ]);

  const vars: TemplateVars = {
    ...DEFAULT_SAMPLE_VARS,
    event_name: event.title,
    event_date: formatEventDate(event.date),
    event_location: event.location ?? "",
    logo_url: branding.logo_url,
    ...sampleVars,
  };

  return renderTemplate(
    {
      subject: resolved.subjectTemplate,
      compiledHtml: resolved.compiledHtmlTemplate,
    },
    vars,
  );
}
