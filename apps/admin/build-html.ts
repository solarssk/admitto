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
  const withoutLinks = html.replaceAll(/[ \t]*<link\b(?=[^>]*\brel="stylesheet")[^>]*>[ \t]*\n?/g, (tag) => {
    links.push(tag.trim());
    return "";
  });
  const bodyEnd = withoutLinks.lastIndexOf("</body>");
  if (links.length === 0 || bodyEnd === -1) return html;
  const moved = links.map((link) => `    ${link}\n`).join("");
  return `${withoutLinks.slice(0, bodyEnd)}${moved}  ${withoutLinks.slice(bodyEnd)}`;
}
