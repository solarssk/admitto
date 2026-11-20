/**
 * The HTML of a legal text as the staff app handles it: what the editor may put in a link, and the one form
 * in which a text is compared and sent. The server cleans the same HTML on save (apps/web/src/legal/
 * sanitize-legal-html.ts, never imported here: the admin bundle has no sanitiser), so this file keeps to what
 * that list lets through and writes it the way the server does, which is what keeps the text the editor
 * sends the text the server stores (the round trip test in test/registration/legalEditorRoundTrip.test.ts).
 *
 * No editor library is imported here: the list of texts uses it too, and must not load the editor.
 */

/** The only schemes of a link, as the server allows them. */
const ALLOWED_LINK_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:", "mailto:"]);

export const LINK_NOT_ALLOWED_MESSAGE = "Use a web address that starts with http:// or https://, or an email address.";

/** The link in the form the browser reads it (and the server stores it), or null when it must not be a link: not an
 * absolute http, https or mailto address, or one with a user name or password in it (it reads as a link to the first
 * host and goes to the second). */
export function safeLegalHref(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (!ALLOWED_LINK_PROTOCOLS.has(url.protocol)) return null;
  if (url.username !== "" || url.password !== "") return null;
  return url.href;
}

/** A word that starts a URL (`https:`, `mailto:`, `javascript:`): letters, digits, plus, dot and hyphen, then a colon. */
const SCHEME_AT_START = /^[a-z][a-z0-9+.-]*:/i;

/** One at sign, text on both sides, and a domain with at least two non-empty parts: enough to tell an email address from a
 * web address typed without its scheme. A loop, not one pattern, so no input can make it slow. */
function looksLikeEmail(text: string): boolean {
  if (/\s/u.test(text)) return false;
  const parts = text.split("@");
  if (parts.length !== 2 || parts[0] === "") return false;
  const labels = (parts[1] ?? "").split(".");
  return labels.length >= 2 && labels.every((label) => label !== "");
}

/**
 * What the person typed in the link field, as an address the text can carry: `https://example.com` as it is,
 * `example.com` as a web address, `name@example.com` as an email address. Anything that is not an allowed link
 * (a `javascript:` address, a `tel:` number) gives the message to show.
 */
export function legalLinkFromInput(raw: string): { href: string } | { error: string } {
  const text = raw.trim();
  if (text === "") return { error: "Enter a link address." };
  let address = text;
  if (!SCHEME_AT_START.test(text)) address = looksLikeEmail(text) ? `mailto:${text}` : `https://${text}`;
  const href = safeLegalHref(address);
  return href === null ? { error: LINK_NOT_ALLOWED_MESSAGE } : { href };
}

/**
 * The text in the one form it is compared and sent in. Read as a browser reads it (a parsed document, which runs
 * no script and loads no image), then written back: a link is written as the server stores it (`https://example.com`
 * becomes `https://example.com/`) or, when it is not an allowed link, loses the link and keeps its words, and a list
 * item that holds a single paragraph holds its words directly (`<li>one</li>`, the way the public page styles it,
 * where an editor writes `<li><p>one</p></li>`). Applying it to what it returned gives the same text.
 */
export function normalizeLegalHtml(html: string): string {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  for (const link of parsed.body.querySelectorAll("a")) {
    const href = safeLegalHref(link.getAttribute("href") ?? "");
    if (href === null) link.replaceWith(...link.childNodes);
    else link.setAttribute("href", href);
  }
  for (const item of parsed.body.querySelectorAll("li")) {
    const paragraphs = [...item.children].filter((child) => child.tagName === "P");
    const [only] = paragraphs;
    if (paragraphs.length === 1 && only) only.replaceWith(...only.childNodes);
  }
  return parsed.body.innerHTML;
}

/** The server's own test for text that says nothing a reader could read: nothing at all, or only spaces and invisible characters. */
export function legalTextIsBlank(text: string): boolean {
  return !/[^\p{White_Space}\p{Default_Ignorable_Code_Point}]/u.test(text);
}
