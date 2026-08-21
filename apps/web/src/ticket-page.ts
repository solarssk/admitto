import type { ResolvedTicket } from "@admitto/tickets";
import { formatDate, formatEventHour } from "@admitto/tickets";
import type { BrandingTheme } from "@admitto/auth";
import { getTimeZone } from "@admitto/shared/timezones";
import {
  buildEventStaticMapPath,
  formatDirectionsAddressFromComponents,
  isMapReady,
  resolveAppleMapsUrl,
  resolveGoogleMapsUrl,
} from "@admitto/location";
import { renderAdmittoFaviconLink } from "./favicon.js";
import { buildTicketPageStyles } from "./ticket-inline-styles.js";
import { weatherCodeInfo } from "./weather/weather-codes.js";
import type { WeatherSummaryDto } from "./weather/types.js";
import {
  OPENMETEO_ATTRIBUTION_TEXT,
} from "./weather/config.js";

function esc(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

/** Event-hours range with the two times joined by a spaced hyphen, or an open-ended "from"/"until"
 * when only one side is set - each bound in the event's regional convention (see
 * @admitto/tickets' region-date-format.ts), followed by the event's own timezone abbreviation
 * (e.g. "IST", "CET"). The abbreviation is the zone's standard-time label, not DST-adjusted -
 * consistent with formatEventHour, which formats the raw HH:MM wall-clock value as-is rather than
 * converting an anchored instant. */
function formatEventHoursRange(
  start: string | null,
  end: string | null,
  country: string | null | undefined,
  timezone: string,
): string | null {
  const zoneSuffix = getTimeZone(timezone)?.abbreviation;
  const suffix = zoneSuffix ? ` ${zoneSuffix}` : "";
  if (start && end) return `${formatEventHour(start, country)} - ${formatEventHour(end, country)}${suffix}`;
  if (start) return `from ${formatEventHour(start, country)}${suffix}`;
  if (end) return `until ${formatEventHour(end, country)}${suffix}`;
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
  /** Href for the on-demand "Add to Apple Wallet" route (this ticket's own /wallet/apple). */
  walletAppleHref?: string | null;
  /** Href for the on-demand "Add to Google Wallet" route (this ticket's own /wallet/google). */
  walletGoogleHref?: string | null;
  /** Set when a wallet pass creation attempt just failed - shows a retry notice. */
  walletError?: boolean;
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
    "X-Robots-Tag": "noindex, nofollow",
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

/** Shared brand header + event/attendee block (open `ticket__body`); caller closes the div. */
function renderTicketCardShellOpen(resolved: ResolvedTicket): string {
  const { attendee, event } = resolved;
  const eventHoursText = formatEventHoursRange(
    event.eventHoursStart,
    event.eventHoursEnd,
    event.addressComponents?.country,
    event.timezone,
  );
  return `<header class="ticket__top">
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
        <span class="ticket__meta-row"><span class="ticket__meta-icon">${CALENDAR_ICON}</span><span class="ticket__meta-text">${esc(formatDate(event.date, event.addressComponents?.country))}</span></span>
        ${eventHoursText ? `<span class="ticket__meta-row"><span class="ticket__meta-icon">${CLOCK_ICON}</span><span class="ticket__meta-text">${esc(eventHoursText)}</span></span>` : ""}
        ${event.location ? `<span class="ticket__meta-row"><span class="ticket__meta-icon">${PIN_ICON}</span><span class="ticket__meta-text">${esc(plainStaffText(event.location))}</span></span>` : ""}
      </div>
      <div class="ticket__attendee">
        <p class="ticket__attendee-name">${esc(attendee.name)}</p>
        ${attendee.ticket_type ? `<span class="ticket__type">${esc(attendee.ticket_type)}</span>` : ""}
      </div>`;
}

function ticketDocument(options: {
  title: string;
  styles: string;
  articleInner: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(options.title)}</title>
  ${renderAdmittoFaviconLink()}
  <style>${options.styles}</style>
</head>
<body class="ticket-page">
  <article class="ticket">
    ${options.articleInner}
  </article>
</body>
</html>`;
}

/** Wallet badges and help text, or an empty string when the event has no wallet pass. */
function renderWalletSection(options: TicketPageOptions): string {
  if (!options.walletAppleHref && !options.walletGoogleHref) return "";

  const errorHtml = options.walletError
    ? `<p class="ticket__wallet-error" role="alert">Could not add this ticket to your wallet just now. Please try again.</p>`
    : "";
  const appleBadgeHtml = options.walletAppleHref
    ? `<span class="wallet-badge-frame"><a href="${esc(options.walletAppleHref)}"><img class="wallet-badge wallet-badge--apple" src="/assets/apple-wallet-badge.svg" alt="Add to Apple Wallet"></a></span>`
    : "";
  const googleBadgeHtml = options.walletGoogleHref
    ? `<span class="wallet-badge-frame"><a href="${esc(options.walletGoogleHref)}"><img class="wallet-badge" src="/assets/google-wallet-badge.svg" alt="Add to Google Wallet"></a></span>`
    : "";

  return `${errorHtml}
    <div class="ticket__wallets">
      ${appleBadgeHtml}
      ${googleBadgeHtml}
    </div>
    <details class="ticket__wallet-help">
      <summary>How do I add this to my phone?</summary>
      <p>Tap Add to Apple Wallet or Add to Google Wallet above. You will find this ticket later in that app.</p>
    </details>`;
}

export function renderTicket(
  resolved: ResolvedTicket,
  qrDataUrl: string,
  theme?: BrandingTheme | null,
  options: TicketPageOptions = {},
): string {
  const { event } = resolved;
  const styles = buildTicketPageStyles(theme);
  const mapReady = isMapReady(event);
  const showStaticMap = mapReady && options.staticMapEnabled !== false;
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
  const walletHtml = renderWalletSection(options);
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

  const shellOpen = renderTicketCardShellOpen(resolved);
  const articleInner = `${shellOpen}
      <div class="ticket__qr"><img src="${qrDataUrl}" alt="QR code for ticket entry"></div>
      ${options.displayToken ? `<p class="ticket__token">${esc(options.displayToken)}</p>` : ""}
    </div>
    ${walletHtml ? `<div class="ticket__perf" role="presentation"></div>` : ""}
    ${walletHtml}
    ${gettingThereHtml}
    <footer class="ticket__foot">Present this QR code at the entrance.</footer>`;

  return ticketDocument({
    title: `Ticket - ${event.title}`,
    styles,
    articleInner,
  });
}

const PUBLIC_ERROR_404_ICON = `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M9 15l6 -6"/><path d="M11 6l.463 -.536a5 5 0 0 1 7.071 7.072l-.534 .464"/><path d="M13 18l-.397 .534a5.068 5.068 0 0 1 -7.127 0a4.972 4.972 0 0 1 0 -7.071l.524 -.463"/></svg>`;
const PUBLIC_ERROR_403_ICON = `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2z"/><path d="M11 16a1 1 0 1 0 2 0a1 1 0 0 0 -2 0"/><path d="M8 11v-4a4 4 0 1 1 8 0v4"/></svg>`;
const PUBLIC_ERROR_500_ICON = `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0z"/><path d="M12 16h.01"/></svg>`;
const PUBLIC_ERROR_ICONS = {
  404: PUBLIC_ERROR_404_ICON,
  403: PUBLIC_ERROR_403_ICON,
  500: PUBLIC_ERROR_500_ICON,
};

/** Shared branded shell for public HTML errors (404, 403, and 500 share the same layout). */
export function renderPublicErrorPage(options: {
  statusCode: 404 | 403 | 500;
  heading: string;
  message: string;
  theme?: BrandingTheme | null;
}): string {
  const styles = buildTicketPageStyles(options.theme);
  const icon = PUBLIC_ERROR_ICONS[options.statusCode];
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(options.heading)}</title>
  ${renderAdmittoFaviconLink()}
  <style>${styles}</style>
</head>
<body class="ticket-page">
  <article class="ticket">
    <header class="ticket__top">
      <div class="ticket__brand">
        <img class="ticket__brand-mark" src="/assets/admitto-mark.svg" width="30" height="30" alt=""><span>Admitto</span>
      </div>
    </header>
    <div class="ticket__body ticket__body--public-error">
      <div class="at-public-error" role="status">
        <span class="at-public-error__icon">${icon}</span>
        <p class="at-public-error__code">${options.statusCode}</p>
        <h1 class="at-public-error__heading">${esc(options.heading)}</h1>
        <p class="at-public-error__message">${esc(options.message)}</p>
      </div>
    </div>
  </article>
</body>
</html>`;
}

export function renderNotFound(theme?: BrandingTheme | null): string {
  return renderPublicErrorPage({
    statusCode: 404,
    heading: "Not found",
    message: "This link is invalid or the page no longer exists.",
    theme,
  });
}

export function renderServerError(theme?: BrandingTheme | null): string {
  return renderPublicErrorPage({
    statusCode: 500,
    heading: "Something went wrong",
    message: "Unable to load this page right now. Please try again later.",
    theme,
  });
}

/** `message` varies by caller (invalid Cloudflare Access assertion, no role, CSRF, ...) - the
 * detailed reason belongs in System logs, not on a page anyone hitting the URL can read. */
export function renderForbidden(message: string, theme?: BrandingTheme | null): string {
  return renderPublicErrorPage({
    statusCode: 403,
    heading: "Access denied",
    message,
    theme,
  });
}

/** Revoked/cancelled pass: same ticket card shell, notice instead of QR / wallets / map. */
export function renderRevoked(
  resolved: ResolvedTicket,
  theme?: BrandingTheme | null,
  reason: "revoked" | "cancelled" = "revoked",
): string {
  const heading = reason === "cancelled" ? "Ticket cancelled" : "Ticket revoked";
  const notice =
    "This ticket is no longer valid for entry. If you believe this is a mistake, please contact the organisers.";
  const styles = buildTicketPageStyles(theme);
  const articleInner = `${renderTicketCardShellOpen(resolved)}
      <div class="ticket__status-notice" role="status">
        <h2>${heading}</h2>
        <p>${esc(notice)}</p>
      </div>
    </div>`;

  return ticketDocument({
    title: heading,
    styles,
    articleInner,
  });
}
