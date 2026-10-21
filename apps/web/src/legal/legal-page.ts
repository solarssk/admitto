/**
 * The public page of a published legal text: `GET /legal/<event slug>/<ref>`.
 *
 * Anonymous and static. It is served with the zero-script headers of the ticket page
 * ({@link getLegalPageSecurityHeaders}): no script, no fetch, no form, no frame, no object, no
 * cookie, never cached. The HTML it prints was cleaned on save (sanitize-legal-html.ts); those
 * headers are the second layer, for the day a bug lets something through.
 *
 * A published text is served whatever the event's registration setting is, and for an archived
 * event too: a guest who registered must be able to read again what they were told and accepted.
 */
import type { Context } from "hono";
import type { PrismaClient } from "@admitto/db";
import type { BrandingTheme } from "@admitto/auth";
import { resolveTicketLogoUrl } from "@admitto/tickets";
import { renderAdmittoFaviconLink } from "../favicon.js";
import { isSecureRequest } from "../is-secure-request.js";
import { buildTicketPageStyles } from "../ticket-inline-styles.js";
import { esc, getTicketPageSecurityHeaders } from "../ticket-page.js";
import { parseLegalDocumentRef } from "./legal-documents.js";

/** Longest event slug (`Event.slug` is capped at 80); anything longer cannot name an event. */
const MAX_EVENT_SLUG_CHARS = 80;

/** A published text with what the page around it shows. */
export type PublishedLegalPage = {
  title: string;
  contentHtml: string;
  eventTitle: string;
  /** The event's logo, else the organisation's; null shows the Admitto mark. */
  logoUrl: string | null;
};

/**
 * The published text a URL names, or null for every other case: an event that does not exist, a text
 * that does not exist, a draft, a ref that is not one. The caller answers all of them the same way,
 * so nobody can tell from outside which of them it was.
 */
export async function loadPublishedLegalPage(
  db: PrismaClient,
  eventSlug: string,
  ref: string,
): Promise<PublishedLegalPage | null> {
  const doc = parseLegalDocumentRef(ref);
  if (!doc || eventSlug === "" || eventSlug.length > MAX_EVENT_SLUG_CHARS) return null;
  const row = await db.legalDocument.findFirst({
    where: { kind: doc.kind, key: doc.key, published_at: { not: null }, event: { slug: eventSlug } },
    select: {
      title: true,
      content_html: true,
      event: {
        select: {
          title: true,
          logo_url: true,
          header_image_url: true,
          organization: { select: { logo_url: true, header_image_url: true } },
        },
      },
    },
  });
  if (!row) return null;
  return {
    title: row.title,
    contentHtml: row.content_html,
    eventTitle: row.event.title,
    logoUrl: resolveTicketLogoUrl(row.event),
  };
}

/** The ticket page's look, with a column wide enough to read and the text left aligned. Only the
 * elements sanitize-legal-html.ts lets through are styled. */
const LEGAL_PAGE_CSS = `
.ticket--legal { width: min(760px, 100%); }
.ticket__body--legal { padding: 24px 32px 32px; text-align: left; }
.legal__event { margin: 0 0 4px; color: var(--text-muted, #64748b); font-size: 0.875rem; overflow-wrap: anywhere; }
.legal__title { margin: 0 0 24px; font-size: 1.5rem; font-weight: 700; line-height: 1.25; overflow-wrap: anywhere; }
.legal__content { font-size: 1rem; line-height: 1.6; overflow-wrap: anywhere; }
.legal__content > :first-child { margin-top: 0; }
.legal__content > :last-child { margin-bottom: 0; }
.legal__content p, .legal__content ul, .legal__content ol, .legal__content blockquote { margin: 0 0 1em; }
.legal__content h2 { margin: 1.75em 0 0.5em; font-size: 1.25rem; line-height: 1.3; }
.legal__content h3 { margin: 1.5em 0 0.5em; font-size: 1.125rem; line-height: 1.3; }
.legal__content h4 { margin: 1.25em 0 0.5em; font-size: 1rem; line-height: 1.3; }
.legal__content ul, .legal__content ol { padding-left: 1.5em; }
.legal__content li { margin: 0.25em 0; }
.legal__content li > ul, .legal__content li > ol { margin: 0.25em 0 0; }
.legal__content blockquote { padding-left: 1em; border-left: 3px solid var(--border, #e6e7e9); color: var(--text-secondary, #475569); }
.legal__content hr { margin: 2em 0; border: 0; border-top: 1px solid var(--border, #e6e7e9); }
.legal__content a { color: var(--primary, #066fd1); text-underline-offset: 2px; }
@media (max-width: 480px) {
  .ticket__body--legal { padding: 20px 16px 24px; }
}
@media print {
  .ticket--legal { width: 100%; }
  .ticket__body--legal { padding: 0; }
  .legal__content a { color: inherit; }
}
`;

/** The page, as a whole HTML document. `theme` is the instance branding, as on the ticket page. */
export function renderLegalDocumentPage(page: PublishedLegalPage, theme?: BrandingTheme | null): string {
  const brand = page.logoUrl
    ? `<img class="ticket__brand-logo" src="${esc(page.logoUrl)}" alt="${esc(page.eventTitle)}">`
    : `<img class="ticket__brand-mark" src="/assets/admitto-mark.svg" width="30" height="30" alt=""><span>Admitto</span>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(page.title)} - ${esc(page.eventTitle)}</title>
  ${renderAdmittoFaviconLink()}
  <style>${buildTicketPageStyles(theme)}${LEGAL_PAGE_CSS}</style>
</head>
<body class="ticket-page">
  <article class="ticket ticket--legal">
    <header class="ticket__top">
      <div class="ticket__brand">${brand}</div>
    </header>
    <div class="ticket__body ticket__body--legal">
      <p class="legal__event">${esc(page.eventTitle)}</p>
      <h1 class="legal__title">${esc(page.title)}</h1>
      <div class="legal__content">${page.contentHtml}</div>
    </div>
  </article>
</body>
</html>`;
}

/** The ticket page's zero-script headers, with one directive tightened: the ticket page embeds its
 * map as an `<object>`, and a legal text has no use for one. */
export function getLegalPageSecurityHeaders(
  theme?: BrandingTheme | null,
  logoUrl?: string | null,
  secure = false,
): Record<string, string> {
  const headers = getTicketPageSecurityHeaders(theme, logoUrl, secure);
  const policy = headers["Content-Security-Policy"] ?? "";
  return { ...headers, "Content-Security-Policy": policy.replace("object-src 'self'", "object-src 'none'") };
}

/** The answer for a published text. `theme` is the instance branding, or null when it could not be loaded. */
export function respondLegalPage(c: Context, page: PublishedLegalPage, theme: BrandingTheme | null): Response {
  const headers = getLegalPageSecurityHeaders(theme, page.logoUrl, isSecureRequest(c));
  for (const [name, value] of Object.entries(headers)) c.header(name, value);
  return c.html(renderLegalDocumentPage(page, theme), 200);
}
