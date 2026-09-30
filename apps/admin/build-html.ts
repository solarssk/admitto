/**
 * Config-time only (imported by vite.config.ts, never shipped to the browser).
 *
 * Vite puts the app's stylesheets in `<head>`, and a browser paints nothing until the stylesheets
 * in `<head>` have arrived. The main one is ~400 kB, so on a slow connection the page stayed
 * white for seconds and the splash inside `#root` could not show. Moving the `<link
 * rel="stylesheet">` tags to the end of `<body>` lets the browser paint the splash as soon as the
 * HTML is in, while the stylesheet downloads behind it.
 *
 * It is safe for the app: the deferred module script still waits for a pending parser-inserted
 * stylesheet before it runs, so React never mounts unstyled.
 */
export function moveStylesheetsToBodyEnd(html: string): string {
  const links: string[] = [];
  let kept = "";
  let cursor = 0;
  let at = html.indexOf("<link");
  // A plain scan for `<link ...>` tags (no regex over the whole page, so no backtracking risk).
  while (at !== -1) {
    const close = html.indexOf(">", at);
    if (close === -1) break;
    const tag = html.slice(at, close + 1);
    if (/^<link\s/.test(tag) && /\brel="stylesheet"/.test(tag)) {
      let from = at;
      while (from > cursor && (html[from - 1] === " " || html[from - 1] === "\t")) from--;
      let to = close + 1;
      while (html[to] === " " || html[to] === "\t") to++;
      if (html[to] === "\n") to++;
      kept += html.slice(cursor, from);
      links.push(tag);
      cursor = to;
      at = html.indexOf("<link", to);
    } else {
      at = html.indexOf("<link", close + 1);
    }
  }
  kept += html.slice(cursor);
  const bodyEnd = kept.lastIndexOf("</body>");
  if (links.length === 0 || bodyEnd === -1) return html;
  const moved = links.map((link) => `    ${link}\n`).join("");
  return `${kept.slice(0, bodyEnd)}${moved}  ${kept.slice(bodyEnd)}`;
}
