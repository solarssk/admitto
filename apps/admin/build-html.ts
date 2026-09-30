/**
 * Config-time only (imported by vite.config.ts, never shipped to the browser).
 *
 * Vite puts the app's stylesheets in `<head>`, and a browser paints nothing until the stylesheets
 * in `<head>` have arrived. The main one is ~400 kB, so on a slow connection the page stayed
 * white for seconds and the splash inside `#root` could not show. Every `<link rel="stylesheet">`
 * therefore gets `media="print"` and `data-deferred-css`: the browser still downloads it, but it
 * no longer blocks the first paint, so the splash shows as soon as the HTML is in. `main.tsx`
 * switches the stylesheets on (`enableDeferredStylesheets`) once they have loaded and only then
 * starts React, so the app never mounts unstyled.
 *
 * The links stay where Vite put them, in `<head>`, and that position matters. Stylesheets of
 * lazily loaded pages are appended to `<head>` later, and of two rules with the same specificity
 * the one later in the document wins, so the main stylesheet has to stay ahead of them. Moving it
 * to the end of `<body>` turned that order around: base styles started overriding page styles
 * (a form's fields shrank to half width).
 */

/** A `<link rel="stylesheet" ...>` tag (the whole tag, `<` to `>`). */
function isStylesheetLink(tag: string): boolean {
  return /^<link\s/.test(tag) && /\brel="stylesheet"/.test(tag);
}

/** The tag with `media="print" data-deferred-css` added; a tag that has a media query of its own, or is already deferred, is left alone. */
function deferred(tag: string): string {
  if (/\bdata-deferred-css\b/.test(tag) || /\bmedia=/.test(tag)) return tag;
  const selfClosing = tag.endsWith("/>");
  const open = tag.slice(0, selfClosing ? -2 : -1).trimEnd();
  return `${open} media="print" data-deferred-css${selfClosing ? " />" : ">"}`;
}

export function deferStylesheets(html: string): string {
  let out = "";
  let cursor = 0;
  let at = html.indexOf("<link");
  // A plain scan for `<link ...>` tags (no regex over the whole page, so no backtracking risk).
  while (at !== -1) {
    const close = html.indexOf(">", at);
    if (close === -1) break;
    const tag = html.slice(at, close + 1);
    if (isStylesheetLink(tag)) {
      out += html.slice(cursor, at) + deferred(tag);
      cursor = close + 1;
    }
    at = html.indexOf("<link", close + 1);
  }
  return out + html.slice(cursor);
}
