import type { ResolvedTicket } from "@admitto/tickets";
import { statusBadgeClass, statusLabel } from "@admitto/ui";
import type { BrandingTheme } from "@admitto/auth";
import { buildTicketPageStyles } from "./ticket-inline-styles.js";

function esc(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
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

/** Build CSP font-src allowlist for ticket page custom branding fonts. */
export function buildTicketFontSrc(theme?: BrandingTheme | null): string {
  const parts = ["'self'"];
  const origin = safeHttpsOrigin(theme?.font_family_url);
  if (origin) parts.push(origin);
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

export function renderTicket(
  resolved: ResolvedTicket,
  qrDataUrl: string,
  theme?: BrandingTheme | null,
): string {
  const { attendee, event } = resolved;
  const badgeClass = statusBadgeClass(attendee.status);
  const badgeText = statusLabel(attendee.status);
  const styles = buildTicketPageStyles(theme);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Ticket — ${esc(event.title)}</title>
  <style>${styles}</style>
</head>
<body class="ticket-page">
  <article class="ticket">
    <header class="ticket__top">
      <div class="ticket__brand">
        ${
          event.logoUrl
            ? `<img class="ticket__brand-logo" src="${esc(event.logoUrl)}" alt="${esc(event.title)}">`
            : `<span class="ticket__brand-mark" aria-hidden="true"></span><span>Admitto</span>`
        }
      </div>
      <small>Event ticket</small>
    </header>
    <div class="ticket__body">
      <h1 class="ticket__event-name">${esc(event.title)}</h1>
      <p class="ticket__meta">${esc(formatDate(event.date))}${event.location ? ` · ${esc(event.location)}` : ""}</p>
      <div class="ticket__attendee">
        <p class="ticket__attendee-name">${esc(attendee.name)}</p>
        ${attendee.ticket_type ? `<p class="ticket__meta">${esc(attendee.ticket_type)}</p>` : ""}
        <span class="${badgeClass}">${esc(badgeText)}</span>
      </div>
      <div class="ticket__qr"><img src="${qrDataUrl}" alt="QR code for ticket entry"></div>
    </div>
    <div class="ticket__perf" role="presentation"></div>
    <div class="ticket__wallets">
      <span class="wallet-cta" aria-disabled="true">Apple Wallet — coming soon</span>
      <span class="wallet-cta" aria-disabled="true">Google Wallet — coming soon</span>
    </div>
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
