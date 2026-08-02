import type { ResolvedTicket } from "@admitto/tickets";
import type { BrandingTheme } from "@admitto/auth";
import {
  buildAppleMapsUrl,
  buildEventStaticMapPath,
  buildGoogleMapsUrl,
  formatDirectionsAddressFromComponents,
  isMapReady,
} from "@admitto/location";
import { buildTicketPageStyles } from "./ticket-inline-styles.js";

function esc(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

const CALENDAR_ICON = `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/></svg>`;
const PIN_ICON = `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>`;
/** Signpost: clearer than a house glyph for "Directions". */
const DIRECTIONS_ICON = `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3v18"/><path d="M10 6h7l2 2-2 2h-7"/><path d="M10 14H5l-2 2 2 2h5"/></svg>`;
/** Wheelchair: more recognizable than a stick figure for Accessibility. */
const ACCESSIBILITY_ICON = `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="14" cy="4" r="2"/><path d="m18 9-4.5-1.5L11 13"/><path d="M6 10h7"/><circle cx="10" cy="18" r="3.5"/><path d="M13.5 17.5H18l2 3"/></svg>`;
/** Neutral map glyph: not Google/Apple brand marks (trademark-restricted). */
const MAP_LINK_ICON = `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 7 6-3 6 3 6-3v13l-6 3-6-3-6 3V7Z"/><path d="M9 4v13"/><path d="M15 7v13"/></svg>`;


export type TicketPageOptions = {
  displayToken?: string | null;
  mapAttribution?: string | null;
  /** When false, omit the static map `<img>` (`LOCATION_MAPS_ENABLED=false`). Google/Apple links still render when coordinates exist. Defaults to true. */
  staticMapEnabled?: boolean;
};

/** Mask an internal ticket token for display, or fall back to a Mode B public ref. */
export function resolveDisplayToken(
  internalToken?: string | null,
  agencyPublicRef?: string | null,
): string | null {
  if (internalToken) {
    return `${internalToken.slice(0, 8)}…${internalToken.slice(-4)}`;
  }
  return agencyPublicRef ?? null;
}

function renderMapAttribution(attribution?: string | null): string {
  const normalized = attribution?.replace(/\s+/g, " ").trim();
  if (
    normalized ===
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
  ) {
    return `© <a href="https://www.openstreetmap.org/copyright" rel="noreferrer">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions" rel="noreferrer">CARTO</a>`;
  }
  // Remove every `<` / `>` so incomplete multi-character tag stripping cannot leave `<script`.
  const plain =
    normalized?.replaceAll("<", "").replaceAll(">", "").trim() ||
    "Map data attribution unavailable";
  return esc(plain);
}

/** Origin of `url` when it's a safe (https, no embedded credentials) absolute URL - null for
 * anything empty, relative, unparseable, or unsafe. Shared by buildTicketFontSrc/buildTicketImgSrc
 * below (CodeRabbit review: same parse/protocol/credential check was duplicated in both). */
function safeHttpsOrigin(url?: string | null): string | null {
  const trimmed = url?.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "https:" && !parsed.username && !parsed.password) {
      return parsed.origin;
    }
  } catch {
    // ignore invalid URLs
  }
  return null;
}

/** Build CSP font-src allowlist for ticket page custom branding fonts - only the *active* saved
 * family's own variants are ever actually referenced (resolveThemeVars only emits @font-face for
 * whichever one matches font_family_name), each independently checked (a local /uploads/... path
 * needs nothing added here, already covered by 'self', same as buildTicketImgSrc's logo). */
export function buildTicketFontSrc(theme?: BrandingTheme | null): string {
  const parts = ["'self'"];
  const origins = new Set<string>();
  const ticketFontName = theme?.ticket_font_family_name ?? theme?.font_family_name;
  const activeFamily = theme?.custom_font_families?.find((f) => f.name === ticketFontName);
  for (const variant of activeFamily?.variants ?? []) {
    const origin = safeHttpsOrigin(variant.url);
    if (origin) origins.add(origin);
  }
  parts.push(...origins);
  return parts.join(" ");
}

/** Build CSP img-src allowlist for the QR code (data: URI) plus, when a logo is configured, its
 * host - a relative /uploads/... logo is already covered by 'self' and adds nothing here, so it's
 * excluded before reaching safeHttpsOrigin (which only ever recognizes absolute https origins
 * anyway, but never even attempting to parse a same-origin path keeps the intent explicit here). */
export function buildTicketImgSrc(logoUrl?: string | null): string {
  const parts = ["'self'", "data:"];
  const url = logoUrl?.trim();
  if (url && !url.startsWith("/")) {
    const origin = safeHttpsOrigin(url);
    if (origin) parts.push(origin);
  }
  return parts.join(" ");
}

export function getTicketPageSecurityHeaders(
  theme?: BrandingTheme | null,
  logoUrl?: string | null,
): Record<string, string> {
  const fontSrc = buildTicketFontSrc(theme);
  const imgSrc = buildTicketImgSrc(logoUrl);
  return {
    "Cache-Control": "private, no-store, max-age=0",
    "Content-Security-Policy":
      `default-src 'none'; style-src 'unsafe-inline'; img-src ${imgSrc}; script-src 'none'; connect-src 'none'; font-src ${fontSrc}; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  };
}

function ticketDirectionsAddress(event: ResolvedTicket["event"]): string {
  const fromComponents = formatDirectionsAddressFromComponents(
    event.addressComponents,
    event.formattedAddress,
  );
  if (fromComponents) return fromComponents;
  return event.formattedAddress?.trim() || "";
}

/** Keep postcodes like `03-724` on one line (ASCII hyphen is a wrap opportunity). */
function withNonBreakingHyphens(value: string): string {
  return value.replaceAll("-", "\u2011");
}

function renderDirectionsAddressHtml(event: ResolvedTicket["event"]): string {
  const components = event.addressComponents;
  if (components?.street) {
    const locality = [components.postcode, components.city].filter(Boolean).join(" ");
    const tail = [locality, components.country].filter(Boolean).join(", ");
    const street = withNonBreakingHyphens(components.street);
    if (tail) {
      return `<p class="ticket__address"><span class="ticket__address-line">${esc(street)}</span><span class="ticket__address-line ticket__address-locality">${esc(withNonBreakingHyphens(tail))}</span></p>`;
    }
    return `<p class="ticket__address">${esc(street)}</p>`;
  }
  const fallback = ticketDirectionsAddress(event);
  return fallback
    ? `<p class="ticket__address">${esc(withNonBreakingHyphens(fallback))}</p>`
    : "";
}

export function renderTicket(
  resolved: ResolvedTicket,
  qrDataUrl: string,
  theme?: BrandingTheme | null,
  options: TicketPageOptions = {},
): string {
  const { attendee, event } = resolved;
  const styles = buildTicketPageStyles(theme);
  const mapReady = isMapReady(event);
  const showStaticMap = mapReady && options.staticMapEnabled !== false;
  const venueLabel = event.location || event.formattedAddress;
  const directionsText = event.directionsText?.trim();
  const accessibilityText = event.accessibilityText?.trim();
  const directionsAddress = ticketDirectionsAddress(event);
  const hasGettingThere =
    mapReady || Boolean(directionsAddress || directionsText || accessibilityText);
  const mapsLinks =
    mapReady
      ? `<div class="ticket__map-links">
          <a class="ticket__map-link" href="${esc(buildGoogleMapsUrl(event.latitude!, event.longitude!, venueLabel))}" rel="noreferrer">${MAP_LINK_ICON}<span>Google Maps</span></a>
          <a class="ticket__map-link" href="${esc(buildAppleMapsUrl(event.latitude!, event.longitude!, venueLabel))}" rel="noreferrer">${MAP_LINK_ICON}<span>Apple Maps</span></a>
        </div>`
      : "";

  const addressHtml = renderDirectionsAddressHtml(event);
  let staticMapHtml = "";
  if (showStaticMap) {
    staticMapHtml = `<div class="ticket__map-frame">
      <img class="ticket__map" src="${esc(buildEventStaticMapPath(event.id, { latitude: event.latitude!, longitude: event.longitude! }))}" alt="Map of event location" width="600" height="300">
    </div>
      <p class="ticket__map-attribution">${renderMapAttribution(options.mapAttribution)}</p>`;
  }
  const directionsHtml = directionsText
    ? `<div class="ticket__travel-note"><h3>${DIRECTIONS_ICON}<span>Directions</span></h3><p>${esc(directionsText)}</p></div>`
    : "";
  const accessibilityHtml = accessibilityText
    ? `<div class="ticket__travel-note"><h3>${ACCESSIBILITY_ICON}<span>Accessibility</span></h3><p>${esc(accessibilityText)}</p></div>`
    : "";
  const gettingThereHtml = hasGettingThere
    ? `<section class="ticket__getting-there" aria-labelledby="getting-there-heading">
      <h2 id="getting-there-heading">Getting there</h2>
      ${addressHtml}
      ${staticMapHtml}
      ${mapsLinks}
      ${directionsHtml}
      ${accessibilityHtml}
    </section>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Ticket - ${esc(event.title)}</title>
  <style>${styles}</style>
</head>
<body class="ticket-page">
  <article class="ticket">
    <header class="ticket__top">
      <div class="ticket__brand">
        ${
          event.logoUrl
            ? `<img class="ticket__brand-logo" src="${esc(event.logoUrl)}" alt="${esc(event.title)}">`
            : `<img class="ticket__brand-mark" src="/assets/admitto-mark.svg" width="30" height="30" alt=""><span>Admitto</span>`
        }
      </div>
      <small>Event ticket</small>
    </header>
    <div class="ticket__body">
      <h1 class="ticket__event-name">${esc(event.title)}</h1>
      <div class="ticket__meta">
        <span>${CALENDAR_ICON}<span class="ticket__meta-text">${esc(formatDate(event.date))}</span></span>
        ${event.location ? `<span>${PIN_ICON}<span class="ticket__meta-text">${esc(event.location)}</span></span>` : ""}
      </div>
      <div class="ticket__attendee">
        <p class="ticket__attendee-name">${esc(attendee.name)}</p>
        ${attendee.ticket_type ? `<span class="ticket__type">${esc(attendee.ticket_type)}</span>` : ""}
      </div>
      <div class="ticket__qr"><img src="${qrDataUrl}" alt="QR code for ticket entry"></div>
      ${options.displayToken ? `<p class="ticket__token">${esc(options.displayToken)}</p>` : ""}
    </div>
    <div class="ticket__perf" role="presentation"></div>
    <div class="ticket__wallets">
      <span class="wallet-badge-frame"><img class="wallet-badge wallet-badge--apple" src="/assets/apple-wallet-badge.svg" alt="Add to Apple Wallet (coming soon)" aria-disabled="true" role="img"></span>
      <span class="wallet-badge-frame"><img class="wallet-badge" src="/assets/google-wallet-badge.svg" alt="Add to Google Wallet (coming soon)" aria-disabled="true" role="img"></span>
    </div>
    <details class="ticket__wallet-help">
      <summary>How do I add this to my phone?</summary>
      <p><strong>iPhone:</strong> tap Add to Apple Wallet, then Add on the next screen. Find it later under Wallet.</p>
      <p><strong>Android:</strong> tap Add to Google Wallet and sign in if asked. Find it later under Google Wallet.</p>
    </details>
    ${gettingThereHtml}
    <footer class="ticket__foot">Present this QR code at the entrance.</footer>
  </article>
</body>
</html>`;
}

export function renderNotFound(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Ticket not found</title></head>
<body style="font-family:system-ui,sans-serif;max-width:480px;margin:2rem auto;padding:0 1rem">
  <h1>Ticket not found</h1>
  <p>This ticket link is invalid or has expired.</p>
</body>
</html>`;
}

export function renderServerError(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Server error</title></head>
<body style="font-family:system-ui,sans-serif;max-width:480px;margin:2rem auto;padding:0 1rem">
  <h1>Server error</h1>
  <p>Unable to render this ticket right now. Please contact support.</p>
</body>
</html>`;
}

export function renderRevoked(name: string, eventTitle: string, reason: "revoked" | "cancelled" = "revoked"): string {
  const heading = reason === "cancelled" ? "Ticket cancelled" : "Ticket revoked";
  const message =
    reason === "cancelled"
      ? `${esc(name)}'s ticket for <strong>${esc(eventTitle)}</strong> has been cancelled.`
      : `${esc(name)}'s ticket for <strong>${esc(eventTitle)}</strong> has been revoked.`;
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>${heading}</title></head>
<body style="font-family:system-ui,sans-serif;max-width:480px;margin:2rem auto;padding:0 1rem">
  <h1>${heading}</h1>
  <p>${message}</p>
</body>
</html>`;
}
