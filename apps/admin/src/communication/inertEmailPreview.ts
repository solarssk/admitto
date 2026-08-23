/** `sandbox=""` on a preview iframe blocks top-level navigation and popups, but not the iframe
 * navigating *itself* - a plain `<a href="...">` click, or keyboard Tab+Enter on that same
 * anchor, still loads that URL inside the iframe. For a real sent-message preview that URL is
 * the recipient's actual ticket link, so it points back at this app's own origin, which sets
 * `frame-ancestors 'none'` and refuses to render nested - a broken "refused to connect" sub-frame,
 * not a harmless no-op.
 *
 * Stripping `href` (and pulling the element out of tab order) removes the activation itself, for
 * both pointer and keyboard input - the `pointer-events: none` style is kept only as a visual
 * fallback for links this DOM pass doesn't reach (e.g. malformed markup a real browser still
 * renders as clickable-looking but that querySelectorAll doesn't match). Inserted into `<head>`
 * rather than prepended to the raw string so a leading `<!doctype html>` (as MJML output always
 * has) stays first - prepending text unconditionally would push the doctype declaration past the
 * parser's doctype-sniffing point and drop the document into quirks mode. */
const INERT_LINKS_CSS = "a,area{pointer-events:none;cursor:default;}";

export function makeEmailPreviewInert(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");

  for (const link of doc.querySelectorAll("a[href], area[href]")) {
    link.removeAttribute("href");
    link.setAttribute("tabindex", "-1");
  }

  const style = doc.createElement("style");
  style.textContent = INERT_LINKS_CSS;
  doc.head.prepend(style);

  const doctype = doc.doctype ? `<!doctype ${doc.doctype.name}>` : "";
  return doctype + doc.documentElement.outerHTML;
}
