import type { PrismaClient } from "@admitto/db";
import { resolvePublicBaseUrl } from "./baseUrl.js";
import { resolveBrandingFromEvent, resolveEventImageAssetVars } from "./branding.js";
import { validateHttpUrl } from "./escape.js";
import { formatEventDate, resolvePreviewEventTimeZone } from "./formatEventDate.js";
import {
  buildEventLocationTemplateVars,
  type EventLocationForTemplateVars,
} from "./locationVars.js";
import { resolveTemplateForEvent } from "./mailTemplate.js";
import { renderTemplate } from "./render.js";
import type { BrandingUrls, RenderedTemplate, TemplateVars } from "./types.js";

export interface PreviewTemplateOptions {
  /** IANA timezone for calendar `event_date` (e.g. Europe/Warsaw). Falls back to ADMITTO_DEFAULT_EVENT_TIMEZONE or UTC. */
  timeZone?: string;
  /** Public instance URL - absolutizes `/uploads/…` branding assets in rendered HTML. */
  baseUrl?: string;
  /** Env for resolving `BASE_URL` when `baseUrl` is omitted (defaults to `process.env`). */
  env?: Record<string, string | undefined>;
}

function resolvePreviewBaseUrl(options?: PreviewTemplateOptions): string {
  const explicit = options?.baseUrl?.trim();
  if (explicit) {
    return validateHttpUrl("BASE_URL", explicit.replace(/\/$/, ""));
  }
  return resolvePublicBaseUrl(options?.env);
}

export const DEFAULT_SAMPLE_VARS: TemplateVars = {
  first_name: "Alex",
  last_name: "Example",
  full_name: "Alex Example",
  email: "alex@example.com",
  event_name: "Sample Event",
  event_date: "2026-09-01",
  event_location: "Warsaw",
  event_map_url: "",
  event_address: "",
  directions_text: "",
  accessibility_text: "",
  google_maps_url: "",
  apple_maps_url: "",
  ticket_url: "https://tickets.example.com/t/sample-token",
  qr_image_url: "https://tickets.example.com/q/sample-token.png",
  logo_url: "",
  header_image_url: "",
  apple_wallet_url: "",
  google_wallet_url: "",
  download_page_url: "",
};

type EventForBaseTemplateVars = {
  id: string;
  title: string;
  date: Date;
  location_details?: EventLocationForTemplateVars;
};

/**
 * Shared base vars for preview + test-send so event/branding fields cannot drift
 * between the two call sites.
 */
export function buildBaseTemplateVars(
  event: EventForBaseTemplateVars,
  timeZone: string | undefined,
  branding: BrandingUrls,
  baseUrl: string,
  env: Record<string, string | undefined> = process.env,
): TemplateVars {
  return {
    ...DEFAULT_SAMPLE_VARS,
    event_name: event.title,
    event_date: formatEventDate(event.date, resolvePreviewEventTimeZone(timeZone)),
    ...buildEventLocationTemplateVars(event.id, event.location_details, baseUrl, env),
    logo_url: branding.logo_url,
    header_image_url: branding.header_image_url,
  };
}

/**
 * Renders the resolved template with sample data - no mail send.
 */
export async function previewTemplate(
  eventId: string,
  prisma: PrismaClient,
  sampleVars?: Partial<TemplateVars>,
  options?: PreviewTemplateOptions,
): Promise<RenderedTemplate> {
  const baseUrl = resolvePreviewBaseUrl(options);
  const event = await prisma.event.findUniqueOrThrow({
    where: { id: eventId },
    include: { organization: true, location_details: true },
  });
  const resolved = await resolveTemplateForEvent(event, prisma);
  const branding = resolveBrandingFromEvent(event);
  const customAssets = await resolveEventImageAssetVars(eventId, prisma);

  const vars: TemplateVars = {
    ...buildBaseTemplateVars(event, options?.timeZone, branding, baseUrl, options?.env),
    ...customAssets.vars,
    ...sampleVars,
  };

  return renderTemplate(
    {
      subject: resolved.subjectTemplate,
      compiledHtml: resolved.compiledHtmlTemplate,
    },
    vars,
    { baseUrl, customAssetPlaceholders: customAssets.names },
  );
}
