// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { forcePreviewColorScheme } from "../../src/communication/forcePreviewColorScheme.js";

/** Mirrors the real logo-swap CSS MJML compiles from the ticket template's `<mj-style>` block
 * (see the "why does Safari show a different logo than Brave" report this was built for) -
 * a default rule outside any media query, plus a `@media (prefers-color-scheme: dark)` block
 * that overrides it. Minified the way MJML's own output is, since real whitespace is sparse. */
const SAMPLE_HTML = `<!doctype html><html><head><style>
.logo-dark{display:none!important}
@media (prefers-color-scheme:dark){.logo-fallback{display:none!important}.logo-dark{display:block!important}}
.unrelated{color:red}
</style></head><body>
<img class="logo-fallback" src="light.png">
<img class="logo-dark" src="dark.png" style="display:none">
</body></html>`;

describe("forcePreviewColorScheme", () => {
  it("strips the dark-mode block entirely when forcing light", () => {
    const result = forcePreviewColorScheme(SAMPLE_HTML, "light");
    expect(result).not.toContain("prefers-color-scheme");
    expect(result).not.toContain(".logo-fallback{display:none!important}");
    // The default (light) rule and unrelated rules survive untouched.
    expect(result).toContain(".logo-dark{display:none!important}");
    expect(result).toContain(".unrelated{color:red}");
  });

  it("unwraps the dark-mode block (rules always apply) when forcing dark", () => {
    const result = forcePreviewColorScheme(SAMPLE_HTML, "dark");
    expect(result).not.toContain("prefers-color-scheme");
    expect(result).not.toContain("@media");
    // Both the original default and the former dark-mode override are present, in source order -
    // the override comes second, so it wins the cascade despite equal specificity.
    const defaultIndex = result.indexOf(".logo-dark{display:none!important}");
    const overrideIndex = result.indexOf(".logo-dark{display:block!important}");
    expect(defaultIndex).toBeGreaterThanOrEqual(0);
    expect(overrideIndex).toBeGreaterThan(defaultIndex);
    expect(result).toContain(".logo-fallback{display:none!important}");
  });

  it("handles multiple style tags and leaves non-dark-mode media queries untouched", () => {
    const html = `<!doctype html><html><head>
<style>@media (prefers-color-scheme: dark) { .a { color: #fff; } }</style>
<style>@media (max-width: 479px) { .b { color: #000; } }</style>
</head><body></body></html>`;
    const light = forcePreviewColorScheme(html, "light");
    expect(light).not.toContain(".a { color: #fff; }");
    expect(light).toContain("@media (max-width: 479px)");

    const dark = forcePreviewColorScheme(html, "dark");
    expect(dark).toContain(".a { color: #fff; }");
    expect(dark).not.toContain("prefers-color-scheme");
    expect(dark).toContain("@media (max-width: 479px)");
  });

  it("counter-inverts images only when forcing dark, so they round-trip to their authored colors", () => {
    const light = forcePreviewColorScheme(SAMPLE_HTML, "light");
    expect(light).not.toContain("hue-rotate");

    const dark = forcePreviewColorScheme(SAMPLE_HTML, "dark");
    expect(dark).toContain("img,svg{filter:invert(1) hue-rotate(180deg) !important}");
  });
});
