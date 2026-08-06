import type { ResolvedTicket } from "@admitto/tickets";
import type { BrandingTheme } from "@admitto/auth";
import {
  buildEventStaticMapPath,
  formatDirectionsAddressFromComponents,
  isMapReady,
  resolveAppleMapsUrl,
  resolveGoogleMapsUrl,
} from "@admitto/location";
import { buildTicketPageStyles } from "./ticket-inline-styles.js";
import { weatherCodeInfo } from "./weather/weather-codes.js";
import type { WeatherSummaryDto } from "./weather/types.js";
import {
  OPENMETEO_ATTRIBUTION_TEXT,
} from "./weather/config.js";

function esc(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

/** "18:00–22:00" range, or an open-ended "from"/"until" when only one side is set. */
function formatEventHoursRange(start: string | null, end: string | null): string | null {
  if (start && end) return `${start}–${end}`;
  if (start) return `from ${start}`;
  if (end) return `until ${end}`;
  return null;
}

const CALENDAR_ICON = `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/></svg>`;
const CLOCK_ICON = `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>`;
const PIN_ICON = `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>`;
/** Signpost: clearer than a house glyph for "Directions". */
const DIRECTIONS_ICON = `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3v18"/><path d="M10 6h7l2 2-2 2h-7"/><path d="M10 14H5l-2 2 2 2h5"/></svg>`;
/** Wheelchair: more recognizable than a stick figure for Accessibility. */
const ACCESSIBILITY_ICON = `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="14" cy="4" r="2"/><path d="m18 9-4.5-1.5L11 13"/><path d="M6 10h7"/><circle cx="10" cy="18" r="3.5"/><path d="M13.5 17.5H18l2 3"/></svg>`;
/** Neutral map glyph: not Google/Apple brand marks (trademark-restricted). */
const MAP_LINK_ICON = `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 7 6-3 6 3 6-3v13l-6 3-6-3-6 3V7Z"/><path d="M9 4v13"/><path d="M15 7v13"/></svg>`;
const WEATHER_SUN_ICON = `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4m11.4-11.4 1.4-1.4"/></svg>`;
const WEATHER_CLOUD_ICON = `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19a4.5 4.5 0 1 0-.9-8.9A6 6 0 1 0 7 16.5"/></svg>`;
const WEATHER_RAIN_ICON = `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 16.5a6 6 0 1 1 10.6-4.4A4.5 4.5 0 1 1 17.5 19H7"/><path d="m8 19-1 2m5-2-1 2m5-2-1 2"/></svg>`;
const WEATHER_SNOW_ICON = `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 16.5a6 6 0 1 1 10.6-4.4A4.5 4.5 0 1 1 17.5 19H7"/><path d="M8 20h.01M12 20h.01M16 20h.01"/></svg>`;
const WEATHER_STORM_ICON = `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 16.5a6 6 0 1 1 10.6-4.4A4.5 4.5 0 1 1 17.5 19H7"/><path d="m13 12-3 5h4l-3 5"/></svg>`;
const WEATHER_FOG_ICON = `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14h16M5 18h14M6 10h12"/><path d="M17.5 8a4.5 4.5 0 1 0-.9-8.9A5.5 5.5 0 1 0 7.2 8"/></svg>`;
/** Tabler outline `cloud-question` (same glyph as admin `ti-cloud-question`). */
const WEATHER_QUESTION_ICON = `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 18.004h-7.843c-2.572 -.004 -4.657 -2.011 -4.657 -4.487c0 -2.475 2.085 -4.482 4.657 -4.482c.393 -1.762 1.794 -3.2 3.675 -3.773c1.88 -.572 3.956 -.193 5.444 1c1.488 1.19 2.162 3.007 1.77 4.769h.99"/><path d="M19 22v.01"/><path d="M19 19a2.003 2.003 0 0 0 .914 -3.782a1.98 1.98 0 0 0 -2.414 .483"/></svg>`;

function weatherIconSvg(weatherCode: number | null | undefined): string {
  const info = weatherCodeInfo(weatherCode);
  if (info.icon.includes("sun")) return WEATHER_SUN_ICON;
  if (info.icon.includes("storm")) return WEATHER_STORM_ICON;
  if (info.icon.includes("snow")) return WEATHER_SNOW_ICON;
  if (info.icon.includes("rain") || info.icon.includes("drizzle")) return WEATHER_RAIN_ICON;
  if (info.icon.includes("mist")) return WEATHER_FOG_ICON;
  return WEATHER_CLOUD_ICON;
}

export type TicketPageOptions = {
  displayToken?: string | null;
  /** When false, omit the static map (`LOCATION_MAPS_ENABLED=false`). Google/Apple links still render when coordinates exist. Defaults to true. */
  staticMapEnabled?: boolean;
  /** Event-day weather summary; omit or null to hide the weather block. */
  weather?: WeatherSummaryDto | null;
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
      `default-src 'none'; style-src 'unsafe-inline'; img-src ${imgSrc}; script-src 'none'; connect-src 'none'; font-src ${fontSrc}; object-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
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

/** Drop HTML tags from staff-entered copy before escaping for the public ticket. */
function plainStaffText(value: string): string {
  return value
    .replace(/<\/?[a-zA-Z][^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function formatForecastDayCount(n: number): string {
  return `${n} day${n === 1 ? "" : "s"}`;
}

/**
 * Event-day weather after map buttons: section label (like Getting there), condition
 * icon + copy, attribution bottom-right.
 */
function renderTicketWeatherHtml(weather: WeatherSummaryDto | null | undefined): string {
  if (!weather) return "";
  const attributionUrl = weather.attribution_url?.trim();
  const attrText = esc(weather.attribution || OPENMETEO_ATTRIBUTION_TEXT);
  const credit = attributionUrl
    ? `<a class="ticket__weather-credit" href="${esc(attributionUrl)}" rel="noopener noreferrer">${attrText}</a>`
    : `<span class="ticket__weather-credit">${attrText}</span>`;
  const heading = `<h2 class="ticket__weather-heading" id="weather-heading">Weather on the day</h2>`;

  if (weather.status === "ok" && weather.temp_c != null) {
    const info = weatherCodeInfo(weather.weather_code);
    const range =
      weather.temp_min_c != null
        ? `${weather.temp_min_c}-${weather.temp_c}°C`
        : `${weather.temp_c}°C`;
    return `<div class="ticket__weather-block" aria-labelledby="weather-heading">
      ${heading}
      <div class="ticket__weather-main">
        <span class="ticket__weather-icon" aria-hidden="true">${weatherIconSvg(weather.weather_code)}</span>
        <div class="ticket__weather-copy">
          <p class="ticket__weather-title">${esc(info.label)}</p>
          <p class="ticket__weather-temp">${esc(range)}</p>
        </div>
      </div>
      <p class="ticket__weather-credit-row">${credit}</p>
    </div>`;
  }

  if (weather.status === "too_far") {
    let title = "Forecast available soon";
    let subtitle = "before the event";
    if (weather.horizon_days != null && weather.horizon_days > 0) {
      title = `Forecast available ${formatForecastDayCount(weather.horizon_days)}`;
    } else if (weather.opens_in_days != null && weather.opens_in_days > 0) {
      title = `Forecast available in ${formatForecastDayCount(weather.opens_in_days)}`;
      subtitle = "Check back closer to the event";
    }
    return `<div class="ticket__weather-block" aria-labelledby="weather-heading">
      ${heading}
      <div class="ticket__weather-main">
        <span class="ticket__weather-icon" aria-hidden="true">${WEATHER_QUESTION_ICON}</span>
        <div class="ticket__weather-copy">
          <p class="ticket__weather-title">${esc(title)}</p>
          <p class="ticket__weather-temp">${esc(subtitle)}</p>
        </div>
      </div>
      <p class="ticket__weather-credit-row">${credit}</p>
    </div>`;
  }

  return "";
}

function renderGettingThereSection(parts: {
  hasGettingThere: boolean;
  weatherHtml: string;
  addressHtml: string;
  staticMapHtml: string;
  mapsLinks: string;
  directionsHtml: string;
  accessibilityHtml: string;
}): string {
  const {
    hasGettingThere,
    weatherHtml,
    addressHtml,
    staticMapHtml,
    mapsLinks,
    directionsHtml,
    accessibilityHtml,
  } = parts;
  if (hasGettingThere) {
    return `<section class="ticket__getting-there" aria-labelledby="getting-there-heading">
      <h2 id="getting-there-heading">Getting there</h2>
      ${addressHtml}
      ${staticMapHtml}
      ${mapsLinks}
      ${weatherHtml}
      ${directionsHtml}
      ${accessibilityHtml}
    </section>`;
  }
  if (weatherHtml) {
    return `<section class="ticket__getting-there" aria-label="Weather on the day">${weatherHtml}</section>`;
  }
  return "";
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
  const eventHoursText = formatEventHoursRange(event.eventHoursStart, event.eventHoursEnd);
  const venueLabel = plainStaffText(event.location || event.formattedAddress || "") || null;
  const directionsText = event.directionsText?.trim();
  const accessibilityText = event.accessibilityText?.trim();
  const directionsAddress = ticketDirectionsAddress(event);
  const hasGettingThere =
    mapReady || Boolean(directionsAddress || directionsText || accessibilityText);
  const mapsLinks =
    mapReady
      ? `<div class="ticket__map-links">
          <a class="ticket__map-link" href="${esc(resolveGoogleMapsUrl(event.latitude!, event.longitude!, venueLabel, event.googleMapsUrlOverride))}" rel="noreferrer">${MAP_LINK_ICON}<span>Google Maps</span></a>
          <a class="ticket__map-link" href="${esc(resolveAppleMapsUrl(event.latitude!, event.longitude!, venueLabel, event.appleMapsUrlOverride))}" rel="noreferrer">${MAP_LINK_ICON}<span>Apple Maps</span></a>
        </div>`
      : "";

  const addressHtml = renderDirectionsAddressHtml(event);
  let staticMapHtml = "";
  if (showStaticMap) {
    const mapPath = buildEventStaticMapPath(event.id, {
      latitude: event.latitude!,
      longitude: event.longitude!,
      zoom: event.mapZoom,
    });
    // <object> (not <img>): CSP script-src is 'none', so onerror cannot hide a broken image.
    // object-src 'self' allows the same-origin PNG; failed loads show the inline fallback.
    staticMapHtml = `<div class="ticket__map-frame">
      <object class="ticket__map" data="${esc(mapPath)}" type="image/png" aria-label="Map of event location">
        <p class="ticket__map-fallback">Map unavailable</p>
      </object>
    </div>`;
  }
  const directionsHtml = directionsText
    ? `<div class="ticket__travel-note"><h3>${DIRECTIONS_ICON}<span>Directions</span></h3><p>${esc(directionsText)}</p></div>`
    : "";
  const accessibilityHtml = accessibilityText
    ? `<div class="ticket__travel-note"><h3>${ACCESSIBILITY_ICON}<span>Accessibility</span></h3><p>${esc(accessibilityText)}</p></div>`
    : "";
  const weatherHtml = renderTicketWeatherHtml(options.weather);
  // Order: map → map buttons → weather (then directions / accessibility).
  const gettingThereHtml = renderGettingThereSection({
    hasGettingThere,
    weatherHtml,
    addressHtml,
    staticMapHtml,
    mapsLinks,
    directionsHtml,
    accessibilityHtml,
  });

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
        ${eventHoursText ? `<span>${CLOCK_ICON}<span class="ticket__meta-text">${esc(eventHoursText)}</span></span>` : ""}
        ${event.location ? `<span>${PIN_ICON}<span class="ticket__meta-text">${esc(plainStaffText(event.location))}</span></span>` : ""}
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
      <p>Apple Wallet and Google Wallet are coming soon. The badges above are placeholders and are not tappable yet.</p>
      <p>When wallet passes ship, you will add this ticket from those badges and find it later in Apple Wallet or Google Wallet.</p>
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
