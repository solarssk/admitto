// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { forcePreviewColorScheme } from "../../src/communication/forcePreviewColorScheme.js";

/** Mirrors the real logo-swap CSS MJML compiles from the ticket template's `<mj-style>` block
 * (see the "why does Safari show a different logo than Brave" report this was built for) -
 * a default rule outside any media query, plus a `@media (prefers-color-scheme: dark)` block
 * that overrides it. Minified the way MJML's own output is, since real whitespace is sparse.
 * Deliberately has no background/color/border declaration in the dark block - a cosmetic-only
 * swap, so `hasAuthoredDarkPalette` should stay false and the fallback simulation should apply. */
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
    const { html, hasAuthoredDarkPalette } = forcePreviewColorScheme(SAMPLE_HTML, "light");
    expect(html).not.toContain("prefers-color-scheme");
    expect(html).not.toContain(".logo-fallback{display:none!important}");
    // The default (light) rule and unrelated rules survive untouched.
    expect(html).toContain(".logo-dark{display:none!important}");
    expect(html).toContain(".unrelated{color:red}");
    expect(hasAuthoredDarkPalette).toBe(false);
  });

  it("unwraps the dark-mode block (rules always apply) when forcing dark, and flags no authored palette", () => {
    const { html, hasAuthoredDarkPalette } = forcePreviewColorScheme(SAMPLE_HTML, "dark");
    expect(html).not.toContain("prefers-color-scheme");
    expect(html).not.toContain("@media");
    // Both the original default and the former dark-mode override are present, in source order -
    // the override comes second, so it wins the cascade despite equal specificity.
    const defaultIndex = html.indexOf(".logo-dark{display:none!important}");
    const overrideIndex = html.indexOf(".logo-dark{display:block!important}");
    expect(defaultIndex).toBeGreaterThanOrEqual(0);
    expect(overrideIndex).toBeGreaterThan(defaultIndex);
    expect(html).toContain(".logo-fallback{display:none!important}");
    expect(hasAuthoredDarkPalette).toBe(false);
  });

  it("handles multiple style tags and leaves non-dark-mode media queries untouched", () => {
    const html = `<!doctype html><html><head>
<style>@media (prefers-color-scheme: dark) { .a { display: block; } }</style>
<style>@media (max-width: 479px) { .b { display: none; } }</style>
</head><body></body></html>`;
    const light = forcePreviewColorScheme(html, "light");
    expect(light.html).not.toContain(".a { display: block; }");
    expect(light.html).toContain("@media (max-width: 479px)");

    const dark = forcePreviewColorScheme(html, "dark");
    expect(dark.html).toContain(".a { display: block; }");
    expect(dark.html).not.toContain("prefers-color-scheme");
    expect(dark.html).toContain("@media (max-width: 479px)");
  });

  it("resolves compound media conditions (type + feature, feature + width), not just a bare feature", () => {
    const html = `<!doctype html><html><head><style>
@media only screen and (prefers-color-scheme: dark) { .a { display: block; } }
@media (prefers-color-scheme: dark) and (min-width: 400px) { .b { display: block; } }
</style></head><body></body></html>`;
    const dark = forcePreviewColorScheme(html, "dark").html;
    expect(dark).toContain(".a { display: block; }");
    expect(dark).toContain(".b { display: block; }");
    expect(dark).not.toContain("prefers-color-scheme");

    const light = forcePreviewColorScheme(html, "light").html;
    expect(light).not.toContain(".a { display: block; }");
    expect(light).not.toContain(".b { display: block; }");
  });

  it("leaves a comma-separated condition mixing a dark alternative with an unrelated one untouched", () => {
    // A real OR: this block should also apply below 500px width regardless of color scheme.
    // Resolving it as if it were purely dark-reactive would incorrectly force or drop that.
    const html = `<!doctype html><html><head><style>
@media (prefers-color-scheme: dark), (max-width: 500px) { .a { display: block; } }
</style></head><body></body></html>`;
    const dark = forcePreviewColorScheme(html, "dark").html;
    const light = forcePreviewColorScheme(html, "light").html;
    expect(dark).toContain("prefers-color-scheme: dark), (max-width: 500px)");
    expect(light).toContain("prefers-color-scheme: dark), (max-width: 500px)");
  });

  it("flags hasAuthoredDarkPalette when the dark block sets real colors, not just display", () => {
    const html = `<!doctype html><html><head><style>
body{background-color:#ffffff;color:#222222}
@media (prefers-color-scheme: dark) { body { background-color: #111111; color: #eeeeee; } }
</style></head><body></body></html>`;
    const { html: out, hasAuthoredDarkPalette } = forcePreviewColorScheme(html, "dark");
    expect(hasAuthoredDarkPalette).toBe(true);
    // The template's own dark colors are resolved as authored, unmodified.
    expect(out).toContain("background-color: #111111");
    // No fallback simulation piled on top - no image counter-filter, no background pre-darkening.
    expect(out).not.toContain("hue-rotate");
    expect(out).toContain("background-color:#ffffff");
  });

  it("counter-inverts images with an exact self-inverse pair only when forcing dark without an authored palette", () => {
    const light = forcePreviewColorScheme(SAMPLE_HTML, "light");
    expect(light.html).not.toContain("hue-rotate");

    const dark = forcePreviewColorScheme(SAMPLE_HTML, "dark");
    expect(dark.html).toContain("img,svg{filter:invert(1) hue-rotate(180deg) !important}");
  });

  it("pre-darkens near-white backgrounds only for the fallback simulation, never touching mid-tone/brand colors", () => {
    const html = `<!doctype html><html><head><style>
.wrapper{background-color:#ffffff}
.card{background:#f4f4f4}
.accent{border-top:2px solid #fa000f}
</style></head><body><table><tr><td bgcolor="#ffffff">x</td></tr></table></body></html>`;
    const light = forcePreviewColorScheme(html, "light").html;
    expect(light).toContain("background-color:#ffffff");
    expect(light).toContain('bgcolor="#ffffff"');

    const dark = forcePreviewColorScheme(html, "dark").html;
    expect(dark).not.toContain("background-color:#ffffff");
    expect(dark).toContain("background-color:#dedede"); // 0xff * 0.87 ≈ 0xde, pre-invert source value
    expect(dark).not.toContain("background:#f4f4f4");
    expect(dark).not.toContain('bgcolor="#ffffff"');
    // A saturated brand color used as a border (not a light background) is left alone.
    expect(dark).toContain("#fa000f");
  });
});
