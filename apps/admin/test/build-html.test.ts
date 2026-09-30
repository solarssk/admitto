import { describe, expect, it } from "vitest";
import { moveStylesheetsToBodyEnd } from "../build-html.ts";

const page = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <title>Admitto</title>
    <style>.at-splash{display:grid}</style>
    <script type="module" crossorigin src="/assets/index-abc.js"></script>
    <link rel="modulepreload" crossorigin href="/assets/dist-abc.js">
    <link rel="stylesheet" crossorigin href="/assets/ConfirmDialog-abc.css">
    <link rel="stylesheet" crossorigin href="/assets/index-abc.css">
  </head>
  <body>
    <div id="root"><div class="at-splash"></div></div>
  </body>
</html>
`;

describe("moveStylesheetsToBodyEnd", () => {
  const out = moveStylesheetsToBodyEnd(page);
  const head = out.slice(0, out.indexOf("</head>"));
  const body = out.slice(out.indexOf("<body>"));

  it("takes every stylesheet out of <head>, where it would block the first paint", () => {
    expect(head).not.toContain('rel="stylesheet"');
  });

  it("puts them after the splash at the end of <body>, in their original order", () => {
    expect(body.indexOf('class="at-splash"')).toBeLessThan(body.indexOf("ConfirmDialog-abc.css"));
    expect(body.indexOf("ConfirmDialog-abc.css")).toBeLessThan(body.indexOf("index-abc.css"));
    expect(body.indexOf("index-abc.css")).toBeLessThan(body.indexOf("</body>"));
    expect(body).toContain('<link rel="stylesheet" crossorigin href="/assets/index-abc.css">');
  });

  it("leaves everything else in <head> alone (icons, the splash style, the module script, preloads)", () => {
    expect(head).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml" />');
    expect(head).toContain("<style>.at-splash{display:grid}</style>");
    expect(head).toContain('<script type="module" crossorigin src="/assets/index-abc.js"></script>');
    expect(head).toContain('<link rel="modulepreload" crossorigin href="/assets/dist-abc.js">');
  });

  it("does not lose or duplicate a stylesheet, and does not leave a blank line where they were", () => {
    expect(out.match(/rel="stylesheet"/g)).toHaveLength(2);
    expect(head).not.toMatch(/\n\s*\n\s*<\/head>/);
  });

  it("matches a stylesheet whatever the attribute order", () => {
    const html = '<head><link href="/a.css" rel="stylesheet"></head><body><div id="root"></div></body>';
    const moved = moveStylesheetsToBodyEnd(html);
    expect(moved.slice(0, moved.indexOf("</head>"))).not.toContain("stylesheet");
    expect(moved.slice(moved.indexOf("<body>"))).toContain('<link href="/a.css" rel="stylesheet">');
  });

  it("is a no-op when there is nothing to move (dev server, or a page without stylesheets)", () => {
    const dev = "<head><script type=\"module\" src=\"/src/main.tsx\"></script></head><body></body>";
    expect(moveStylesheetsToBodyEnd(dev)).toBe(dev);
  });

  it("is a no-op without a <body> to move them into, rather than dropping the stylesheets", () => {
    const fragment = '<head><link rel="stylesheet" href="/a.css"></head>';
    expect(moveStylesheetsToBodyEnd(fragment)).toBe(fragment);
  });

  it("is idempotent", () => {
    expect(moveStylesheetsToBodyEnd(out)).toBe(out);
  });
});
