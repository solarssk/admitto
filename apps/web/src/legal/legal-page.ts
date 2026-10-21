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
import { legalDocumentPath, parseLegalDocumentRef, type LegalDocumentRef } from "./legal-documents.js";

/** Longest event slug (`Event.slug` is capped at 80); anything longer cannot name an event. */
const MAX_EVENT_SLUG_CHARS = 80;

/** One tab of the page: a published text of the same event. */
export type LegalPageTab = {
  kind: LegalDocumentRef["kind"];
  title: string;
  path: string;
  current: boolean;
};

/** A published text with what the page around it shows. */
export type PublishedLegalPage = {
  title: string;
  contentHtml: string;
  eventTitle: string;
  /** The event's logo, else the organisation's; null shows the Admitto mark. */
  logoUrl: string | null;
  /** The event's published texts, in reading order, when there are two or more; else empty (no tabs). */
  tabs: readonly LegalPageTab[];
};

/** Reading order of the tabs: the notice, the terms, then the extra consents by key. */
const TAB_RANK: ReadonlyMap<string, number> = new Map([
  ["privacy_notice", 0],
  ["event_terms", 1],
  ["consent", 2],
]);

type SiblingRow = { kind: string; key: string; title: string };

/** The tabs for a page, or none when the event has only this one published text. Drafts are never in `rows`. */
function buildTabs(eventSlug: string, current: LegalDocumentRef, rows: readonly SiblingRow[]): LegalPageTab[] {
  const known = rows.filter((row) => TAB_RANK.has(row.kind));
  if (known.length < 2) return [];
  return known
    .sort(
      (a, b) =>
        (TAB_RANK.get(a.kind) ?? 0) - (TAB_RANK.get(b.kind) ?? 0) || a.key.localeCompare(b.key) || a.title.localeCompare(b.title),
    )
    .map((row) => {
      const doc = { kind: row.kind as LegalDocumentRef["kind"], key: row.key };
      return {
        kind: doc.kind,
        title: row.title,
        path: legalDocumentPath(eventSlug, doc),
        current: doc.kind === current.kind && doc.key === current.key,
      };
    });
}

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
          // The event's other published texts, for the tabs. Only published ones: a draft is not on the page.
          legal_documents: {
            where: { published_at: { not: null } },
            select: { kind: true, key: true, title: true },
          },
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
    tabs: buildTabs(eventSlug, doc, row.event.legal_documents),
  };
}

/** The ticket page's look, with a column wide enough to read and the text left aligned. Only the
 * elements sanitize-legal-html.ts lets through are styled. */
const LEGAL_PAGE_CSS = `
.ticket--legal { width: min(760px, 100%); }
.ticket__body--legal { padding: 24px 32px 32px; text-align: left; }
.legal__tabs { display: flex; flex-wrap: wrap; gap: 0 4px; padding: 0 16px; border-bottom: 1px solid var(--border, #e6e7e9); }
.legal__tab { display: inline-flex; align-items: center; gap: 6px; padding: 12px 10px; margin-bottom: -1px; border-bottom: 2px solid transparent; color: var(--text-secondary, #475569); font-size: 0.8125rem; font-weight: 500; text-decoration: none; }
.legal__tab:hover { color: var(--text-primary, #1d273b); }
.legal__tab[aria-current="page"] { color: var(--primary, #066fd1); border-bottom-color: var(--primary, #066fd1); }
.legal__tab:focus-visible { outline: 2px solid var(--primary, #066fd1); outline-offset: -2px; border-radius: 4px; }
.legal__tab-icon { width: 15px; height: 15px; flex: none; }
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
  .legal__tabs { padding: 0 8px; }
}
@media print {
  .legal__tabs { display: none; }
  .ticket--legal { width: 100%; }
  .ticket__body--legal { padding: 0; }
  .legal__content a { color: inherit; }
}
`;

/** Tabler-style line icons, fixed markup for each kind of text (nothing from the database goes in). */
const TAB_ICONS: ReadonlyMap<string, string> = new Map([
  ["privacy_notice", '<path d="M12 3l8 3v6c0 5-3.5 8-8 9c-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2l4-4"/>'],
  ["event_terms", '<path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z"/><path d="M9 13h6M9 17h6"/>'],
  ["consent", '<circle cx="12" cy="12" r="9"/><path d="M9 12l2 2l4-4"/>'],
]);

/** The tabs between an event's published texts; nothing when there is only one. */
function renderTabs(tabs: readonly LegalPageTab[]): string {
  if (tabs.length < 2) return "";
  const links = tabs
    .map((tab) => {
      const icon = `<svg class="legal__tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${TAB_ICONS.get(tab.kind) ?? ""}</svg>`;
      const current = tab.current ? ' aria-current="page"' : "";
      return `<a class="legal__tab" href="${esc(tab.path)}"${current}>${icon}<span>${esc(tab.title)}</span></a>`;
    })
    .join("");
  return `<nav class="legal__tabs" aria-label="Legal texts of this event">${links}</nav>`;
}

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
    ${renderTabs(page.tabs)}
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
