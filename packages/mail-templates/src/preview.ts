import type { PrismaClient } from "@admitto/db";
import { parseStoredAddressComponents } from "@admitto/location";
import { formatDate, formatEventHoursRangeText } from "@admitto/shared/region-date-format";
import { resolvePublicBaseUrl } from "./baseUrl.js";
import { resolveBrandingFromEvent, resolveEventImageAssetVars } from "./branding.js";
import { validateHttpUrl } from "./escape.js";
import {
  buildEventLocationTemplateVars,
  type EventLocationForTemplateVars,
} from "./locationVars.js";
import { resolveTemplateForEvent } from "./mailTemplate.js";
import { renderTemplate } from "./render.js";
import type { BrandingUrls, RenderedTemplate, TemplateVars } from "./types.js";

export interface PreviewTemplateOptions {
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

/** Neutral inline SVG shown in place of `SAMPLE_QR_IMAGE_URL` — that URL points at
 * `tickets.example.com`, a domain nothing hosts, so it renders as a broken image in a real
 * inbox. Same 200x200 box the default ticket template renders `{{qr_image_url}}` at (see
 * defaultTemplate.ts). Cosmetic only — a real, scannable sample QR pointing at an actual
 * synthetic ticket page is tracked as follow-up work; this just stops the test-send email from
 * looking broken in the meantime. */
const SAMPLE_QR_IMAGE_DATA_URI =
  "data:image/svg+xml;charset=UTF-8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">' +
      '<rect width="200" height="200" fill="#f1f3f5"/>' +
      '<rect x="0.5" y="0.5" width="199" height="199" fill="none" stroke="#ced4da"/>' +
      '<text x="100" y="94" text-anchor="middle" font-family="sans-serif" font-size="13" fill="#495057">Sample QR</text>' +
      '<text x="100" y="114" text-anchor="middle" font-family="sans-serif" font-size="13" fill="#495057">test only</text>' +
      "</svg>",
  );

/** Inert placeholder for `DEFAULT_SAMPLE_VARS.ticket_url` — not a real link. */
const SAMPLE_TICKET_HREF = "#";

/** Swaps the fixed `tickets.example.com` sample URLs for safe, always-rendering placeholders in
 * a fully-rendered template (subject/HTML with `{{ticket_url}}`/`{{qr_image_url}}` already
 * resolved to their literal sample values, not deferred tokens) — for test-send only. Same
 * substitution the admin's own in-browser template preview already does client-side
 * (apps/admin/src/pages/CommunicationPage.tsx `sanitizeSamplePreviewHtml`), applied here so the
 * actual email the operator receives isn't broken too. */
export function sanitizeSampleLinksForTestSend(rendered: RenderedTemplate): RenderedTemplate {
  return {
    subject: rendered.subject,
    html: rendered.html
      .split(SAMPLE_QR_IMAGE_URL)
      .join(SAMPLE_QR_IMAGE_DATA_URI)
      .split(SAMPLE_APPLE_WALLET_URL)
      .join(SAMPLE_TICKET_HREF)
      .split(SAMPLE_GOOGLE_WALLET_URL)
      .join(SAMPLE_TICKET_HREF)
      .split(SAMPLE_TICKET_URL)
      .join(SAMPLE_TICKET_HREF),
  };
}

/** Not a real host — nothing serves these. Fine for the admin's own in-browser preview (already
 * swapped client-side for a placeholder), but a real test-send email needs its own substitution;
 * see `sanitizeSampleLinksForTestSend` below, which references these same literals. */
const SAMPLE_TICKET_URL = "https://tickets.example.com/t/sample-token";
const SAMPLE_QR_IMAGE_URL = "https://tickets.example.com/q/sample-token.png";
const SAMPLE_APPLE_WALLET_URL = `${SAMPLE_TICKET_URL}/wallet/apple`;
const SAMPLE_GOOGLE_WALLET_URL = `${SAMPLE_TICKET_URL}/wallet/google`;

export const DEFAULT_SAMPLE_VARS: TemplateVars = {
  first_name: "Alex",
  last_name: "Example",
  full_name: "Alex Example",
  email: "alex@example.com",
  event_name: "Sample Event",
  event_date: "1 September 2026",
  event_location: "Warsaw",
  event_map_url: "",
  event_address: "",
  directions_text: "",
  accessibility_text: "",
  google_maps_url: "",
  apple_maps_url: "",
  ticket_url: SAMPLE_TICKET_URL,
  qr_image_url: SAMPLE_QR_IMAGE_URL,
  logo_url: "",
  header_image_url: "",
  apple_wallet_url: SAMPLE_APPLE_WALLET_URL,
  google_wallet_url: SAMPLE_GOOGLE_WALLET_URL,
  download_page_url: "",
  ticket_type: "General",
  event_hours: "10:00 - 17:00",
};

type EventForBaseTemplateVars = {
  id: string;
  title: string;
  date: Date;
  timezone: string;
  event_hours_start?: string | null;
  event_hours_end?: string | null;
  location_details?: EventLocationForTemplateVars;
};

/** Same region-aware convention the public ticket page uses (see @admitto/shared's
 * region-date-format.ts): day/month order and 12h-vs-24h follow the event's own country, and the
 * hours range carries the event's timezone abbreviation (e.g. "IST", "EDT") - so an attendee
 * reading the confirmation email sees the identical date/time text as their ticket. */
function buildDateTimeVars(event: EventForBaseTemplateVars): { event_date: string; event_hours: string } {
  const country = parseStoredAddressComponents(event.location_details?.address_components)?.country ?? null;
  return {
    event_date: formatDate(event.date, country),
    event_hours: formatEventHoursRangeText(
      event.event_hours_start ?? null,
      event.event_hours_end ?? null,
      country,
      event.timezone,
      event.date,
    ),
  };
}

/**
 * Shared base vars for preview + test-send so event/branding fields cannot drift
 * between the two call sites.
 */
export function buildBaseTemplateVars(
  event: EventForBaseTemplateVars,
  branding: BrandingUrls,
  baseUrl: string,
  env: Record<string, string | undefined> = process.env,
): TemplateVars {
  return {
    ...DEFAULT_SAMPLE_VARS,
    event_name: event.title,
    ...buildDateTimeVars(event),
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
    ...buildBaseTemplateVars(event, branding, baseUrl, options?.env),
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
