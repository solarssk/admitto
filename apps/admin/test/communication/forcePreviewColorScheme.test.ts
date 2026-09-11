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

  it("handles multiple style tags and leaves non-color-scheme media queries untouched", () => {
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
</style></head><body></body></html>`;
    const dark = forcePreviewColorScheme(html, "dark").html;
    expect(dark).toContain(".a { display: block; }");
    expect(dark).not.toContain("prefers-color-scheme");

    const light = forcePreviewColorScheme(html, "light").html;
    expect(light).not.toContain(".a { display: block; }");
  });

  it("keeps a residual, non-color-scheme condition as a real media query instead of discarding it", () => {
    const html = `<!doctype html><html><head><style>
@media (prefers-color-scheme: dark) and (max-width: 400px) { .a { display: block; } }
</style></head><body></body></html>`;
    const dark = forcePreviewColorScheme(html, "dark").html;
    expect(dark).not.toContain("prefers-color-scheme");
    // The width condition must survive as a real, still-conditional media query - a mobile-only
    // rule shouldn't start applying at every preview width just because dark mode was forced.
    expect(dark).toMatch(/@media\s*\(max-width:\s*400px\)\s*\{\s*\.a\s*\{\s*display:\s*block;\s*\}\s*\}/);

    const light = forcePreviewColorScheme(html, "light").html;
    expect(light).not.toContain(".a { display: block; }");
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

  it("resolves an explicit prefers-color-scheme: light block symmetrically with dark", () => {
    const html = `<!doctype html><html><head><style>
.a{display:none}
@media (prefers-color-scheme: light) { .a { display: block; } }
@media (prefers-color-scheme: dark) { .b { display: block; } }
</style></head><body></body></html>`;
    const light = forcePreviewColorScheme(html, "light").html;
    expect(light).not.toContain("prefers-color-scheme");
    expect(light).toContain(".a { display: block; }"); // light block resolved active
    expect(light).not.toContain(".b { display: block; }"); // dark block dropped

    const dark = forcePreviewColorScheme(html, "dark").html;
    expect(dark).not.toContain("prefers-color-scheme");
    expect(dark).not.toContain(".a { display: block; }"); // light block dropped
    expect(dark).toContain(".b { display: block; }"); // dark block resolved active
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
    // No fallback simulation piled on top - no image filter, no background pre-darkening.
    expect(out).not.toContain("hue-rotate");
    expect(out).toContain("background-color:#ffffff");
  });

  it("does not mistake a custom property or a comment for an authored color declaration", () => {
    const html = `<!doctype html><html><head><style>
@media (prefers-color-scheme: dark) {
  /* switches background-color: to something darker, see design doc */
  .logo { --brand-color: #fff; display: block; }
}
</style></head><body></body></html>`;
    const { hasAuthoredDarkPalette } = forcePreviewColorScheme(html, "dark");
    expect(hasAuthoredDarkPalette).toBe(false);
  });

  it("composes the fallback image filter with a template's own authored filter instead of replacing it", () => {
    const html = `<!doctype html><html><head><style>
.logo-dark{filter:brightness(0) invert(1)}
</style></head><body>
<img class="logo-dark" src="logo.png">
<img src="inline.png" style="opacity:0.9;filter:grayscale(1)">
<img src="plain.png">
</body></html>`;
    const dark = forcePreviewColorScheme(html, "dark").html;
    // Class-based authored filter (matched via the resolved, mode-appropriate CSS) is preserved -
    // composed into a new `filter:` declaration appended after the class rule's own; the old
    // authored value stays readable in the composed one, so nothing about it is lost.
    expect(dark).toMatch(/class="logo-dark"[^>]*style="filter:brightness\(0\) invert\(1\) invert\(1\) hue-rotate\(180deg\) !important"/);
    // An inline authored filter takes priority over any class-based one and is also preserved -
    // the pre-existing `filter:grayscale(1)` stays in the string (redundant but harmless, since
    // CSS resolves same-attribute declarations last-wins) followed by the composed one that wins.
    expect(dark).toMatch(/opacity:0\.9;filter:grayscale\(1\);filter:grayscale\(1\) invert\(1\) hue-rotate\(180deg\) !important/);
    // An image with no authored filter still gets exactly the plain counter-filter.
    expect(dark).toMatch(/src="plain\.png" style="filter:invert\(1\) hue-rotate\(180deg\) !important"/);

    const light = forcePreviewColorScheme(html, "light").html;
    expect(light).not.toContain("hue-rotate");
    // Nothing touched in light mode - the authored class rule survives completely unmodified.
    expect(light).toContain(".logo-dark{filter:brightness(0) invert(1)}");
  });

  it("pre-darkens near-white backgrounds only for the fallback simulation, never touching mid-tone/brand colors or custom properties", () => {
    const html = `<!doctype html><html><head><style>
.wrapper{background-color:#ffffff}
.card{background:#f4f4f4}
.accent{border-top:2px solid #fa000f}
:root{--icon-color:#ffffff}
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
    // A custom property is never mistaken for a `background`/`background-color` declaration.
    expect(dark).toContain("--icon-color:#ffffff");
  });

  it("treats a comma-list mixing dark and light alternatives as unresolvable, leaving it untouched", () => {
    const html = `<!doctype html><html><head><style>
@media (prefers-color-scheme: dark), (prefers-color-scheme: light) { .a { display: block; } }
</style></head><body></body></html>`;
    const dark = forcePreviewColorScheme(html, "dark").html;
    const light = forcePreviewColorScheme(html, "light").html;
    expect(dark).toContain("prefers-color-scheme: dark), (prefers-color-scheme: light)");
    expect(light).toContain("prefers-color-scheme: dark), (prefers-color-scheme: light)");
  });

  it("gives up gracefully on a malformed (unclosed) media block instead of mis-parsing it", () => {
    const html = `<!doctype html><html><head><style>
@media (prefers-color-scheme: dark) { .a { display: block; } }
@media (prefers-color-scheme: dark) { .b { display: block; }
</style></head><body></body></html>`;
    const dark = forcePreviewColorScheme(html, "dark").html;
    // The well-formed first block resolves normally...
    expect(dark).toContain(".a { display: block; }");
    // ...but the second, unclosed one is left completely untouched rather than mis-parsed -
    // still literally containing "prefers-color-scheme" since it was never resolved.
    expect(dark).toContain("@media (prefers-color-scheme: dark) { .b { display: block; }");
  });

  it("does not crash scanning for authored image filters when an unrelated media block elsewhere is malformed", () => {
    const html = `<!doctype html><html><head><style>
.logo{display:block}
@media (min-width: 200px) { .b { color: blue; }
</style></head><body><img src="x.png"></body></html>`;
    const dark = forcePreviewColorScheme(html, "dark").html;
    // No crash, and the image still gets the fallback counter-filter despite the malformed,
    // unrelated media block elsewhere in the same stylesheet.
    expect(dark).toContain('src="x.png" style="filter:invert(1) hue-rotate(180deg) !important"');
  });

  it("leaves an already-dark/saturated background-color unchanged instead of darkening it further", () => {
    const html = `<!doctype html><html><head><style>
.banner{background-color:#fa000f}
</style></head><body></body></html>`;
    const dark = forcePreviewColorScheme(html, "dark").html;
    expect(dark).toContain("background-color:#fa000f"); // unchanged - already well under the "light" threshold
  });

  it("expands a 3-digit hex background before darkening it", () => {
    const html = `<!doctype html><html><head><style>
.wrapper{background-color:#fff}
</style></head><body></body></html>`;
    const dark = forcePreviewColorScheme(html, "dark").html;
    expect(dark).toContain("background-color:#dedede"); // same result as the 6-digit #ffffff case
  });

  it("does not crash extracting filter rules when a rule's opening brace is never closed at all", () => {
    const html = `<!doctype html><html><head><style>.logo{display:block</style></head><body><img src="x.png"></body></html>`;
    const dark = forcePreviewColorScheme(html, "dark").html;
    expect(dark).toContain('src="x.png" style="filter:invert(1) hue-rotate(180deg) !important"');
  });

  it("skips an empty <style> tag instead of trying to transform it", () => {
    const html = `<!doctype html><html><head><style></style><style>
@media (prefers-color-scheme: dark) { .a { display: block; } }
</style></head><body></body></html>`;
    const { html: out, hasAuthoredDarkPalette } = forcePreviewColorScheme(html, "dark");
    expect(out).toContain(".a { display: block; }");
    expect(hasAuthoredDarkPalette).toBe(false);
  });
});
