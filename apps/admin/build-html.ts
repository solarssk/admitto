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
/** A `<link rel="stylesheet" ...>` tag (the whole tag, `<` to `>`). */
function isStylesheetLink(tag: string): boolean {
  return /^<link\s/.test(tag) && /\brel="stylesheet"/.test(tag);
}

const isBlank = (char: string | undefined): boolean => char === " " || char === "\t";

/** Start of the run of spaces and tabs just before `at`, never going back past `floor`. */
function blankRunStart(html: string, at: number, floor: number): number {
  let from = at;
  while (from > floor && isBlank(html[from - 1])) from--;
  return from;
}

/** Just past `end` and any spaces or tabs after it, plus one line break, so a removed tag leaves no empty line. */
function afterTag(html: string, end: number): number {
  let to = end;
  while (isBlank(html[to])) to++;
  return html[to] === "\n" ? to + 1 : to;
}

/** Put `links` (indented, one per line) just before the last `</body>` of `html`; null if there is nothing to put or no `</body>`. */
function insertBeforeBodyEnd(html: string, links: string[]): string | null {
  const bodyEnd = html.lastIndexOf("</body>");
  if (links.length === 0 || bodyEnd === -1) return null;
  const moved = links.map((link) => `    ${link}\n`).join("");
  return `${html.slice(0, bodyEnd)}${moved}  ${html.slice(bodyEnd)}`;
}

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
    if (isStylesheetLink(tag)) {
      kept += html.slice(cursor, blankRunStart(html, at, cursor));
      links.push(tag);
      cursor = afterTag(html, close + 1);
      at = html.indexOf("<link", cursor);
    } else {
      at = html.indexOf("<link", close + 1);
    }
  }
  kept += html.slice(cursor);
  // The original page, untouched, when there is nothing to move or no `</body>` to move it to.
  return insertBeforeBodyEnd(kept, links) ?? html;
}
