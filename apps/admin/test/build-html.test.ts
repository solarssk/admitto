import { describe, expect, it } from "vitest";
import { deferStylesheets } from "../build-html.ts";

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

const DEFERRED = ' media="print" data-deferred-css';

describe("deferStylesheets", () => {
  const out = deferStylesheets(page);
  const head = out.slice(0, out.indexOf("</head>"));
  const body = out.slice(out.indexOf("<body>"));

  it("switches every stylesheet off (media=print), so it cannot block the first paint", () => {
    expect(out).toContain(`<link rel="stylesheet" crossorigin href="/assets/ConfirmDialog-abc.css"${DEFERRED}>`);
    expect(out).toContain(`<link rel="stylesheet" crossorigin href="/assets/index-abc.css"${DEFERRED}>`);
  });

  it("leaves the stylesheets where they were, in <head> and in their order", () => {
    // Stylesheets of lazily loaded pages are appended to <head> later; the main one has to stay ahead
    // of them, or (same specificity) the base styles would override the page styles.
    expect(body).not.toContain('rel="stylesheet"');
    expect(head.indexOf("ConfirmDialog-abc.css")).toBeGreaterThan(head.indexOf("dist-abc.js"));
    expect(head.indexOf("index-abc.css")).toBeGreaterThan(head.indexOf("ConfirmDialog-abc.css"));
  });

  it("changes nothing else in the page", () => {
    expect(out.replaceAll(DEFERRED, "")).toBe(page);
  });

  it("is idempotent", () => {
    expect(deferStylesheets(out)).toBe(out);
  });

  it("matches a stylesheet whatever the attribute order, and keeps a self-closing tag closed", () => {
    const html = '<head><link href="/a.css" rel="stylesheet"><link rel="stylesheet" href="/b.css" /></head><body></body>';
    expect(deferStylesheets(html)).toBe(
      `<head><link href="/a.css" rel="stylesheet"${DEFERRED}><link rel="stylesheet" href="/b.css"${DEFERRED} /></head><body></body>`,
    );
  });

  it.each([
    ["a stylesheet that has a media query of its own", '<head><link rel="stylesheet" href="/wide.css" media="(min-width: 60rem)"></head>'],
    [
      "a page with nothing to defer (dev server)",
      '<head><script type="module" src="/src/main.tsx"></script></head><body></body>',
    ],
    [
      "a <link> without rel=stylesheet, and text that merely mentions one",
      '<head>\n  <link rel="preload" href="/a.css" as="style">\n  <!-- rel="stylesheet" -->\n</head><body></body>',
    ],
    ["an unterminated tag (and does not loop or throw)", '<head><link rel="stylesheet" href="/a.css"'],
  ])("leaves the page exactly as it was for %s", (_what, html) => {
    expect(deferStylesheets(html)).toBe(html);
  });

  it("stays fast on a large page (no backtracking blow-up)", () => {
    const filler = '<link rel="preload" href="/x.js" '.repeat(20000);
    const started = performance.now();
    deferStylesheets(`<head>${filler}</head><body></body>`);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
