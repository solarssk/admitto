import { describe, expect, it } from "vitest";
import { buildTicketPageStyles } from "../src/ticket-inline-styles.js";

describe("buildTicketPageStyles", () => {
  it("includes @media print block with wallet hide and card print fallbacks", () => {
    const css = buildTicketPageStyles();
    expect(css).toContain("@media print");
    expect(css).toContain(".ticket__wallets");
    expect(css).toContain("display: none");
    expect(css).toContain("overflow: visible");
    expect(css).toMatch(/\.ticket[\s\S]*background: #fff/);
    expect(css).toContain(".ticket__top");
    expect(css).toContain("border-bottom: 1px solid #ccc");
    expect(css).toContain(".ticket__brand-mark");
    expect(css).toContain("background: #066fd1");
  });

  it("gives every custom property a literal fallback, since the ticket page loads no external stylesheet", () => {
    // resolveThemeVars() only ever emits --primary(-hover/-active/-tint) and optionally
    // --font-sans; surface/text/border tokens live in packages/ui's colors.css, which this
    // standalone page never loads. Any var(--x) without a fallback resolves to nothing.
    const css = buildTicketPageStyles();
    const bareVarRefs = [...css.matchAll(/var\((--[a-z-]+)\)/g)].map((m) => m[1]);
    expect(bareVarRefs).toEqual(["--primary"]);
  });

  it("self-hosts Inter's @font-face for the default (unset) font pick", () => {
    // The ticket page has no bundler and never loads packages/ui's fonts.css - without this, the
    // --font-sans fallback naming "Inter" would resolve to nothing and silently render system-ui.
    const css = buildTicketPageStyles();
    expect(css).toContain("@font-face");
    expect(css).toContain("font-family: 'Inter'");
    expect(css).toContain("url(/vendor/fontsource/inter/");
  });

  it("self-hosts the active built-in font's @font-face (e.g. Manrope)", () => {
    const css = buildTicketPageStyles({ font_family_name: "Manrope" });
    expect(css).toContain("font-family: 'Manrope'");
    expect(css).toContain("url(/vendor/fontsource/manrope/");
    // Only the active family is inlined, not all 4 built-ins.
    expect(css).not.toContain("font-family: 'Space Grotesk'");
    expect(css).not.toContain("font-family: 'IBM Plex Sans'");
  });

  it("does not duplicate a self-hosted built-in face when a custom uploaded family is active", () => {
    const fontUrl = "https://cdn.example.com/fonts/brand.woff2";
    const css = buildTicketPageStyles({
      font_family_name: "Brand Sans",
      custom_font_families: [{ name: "Brand Sans", variants: [{ weight: 400, style: "normal", url: fontUrl }] }],
    });
    expect(css).toContain("@font-face");
    expect(css).toContain(fontUrl);
    expect(css).not.toContain("/vendor/fontsource/");
  });

  it("uses ticket_font_family_name instead of font_family_name when set", () => {
    const css = buildTicketPageStyles({ font_family_name: "Manrope", ticket_font_family_name: "Space Grotesk" });
    expect(css).toContain("font-family: 'Space Grotesk'");
    expect(css).not.toContain("font-family: 'Manrope'");
  });

  it("falls back to font_family_name when ticket_font_family_name is unset", () => {
    const css = buildTicketPageStyles({ font_family_name: "IBM Plex Sans" });
    expect(css).toContain("font-family: 'IBM Plex Sans'");
  });

  it("falls back to self-hosted Inter when font_family_name matches neither a built-in nor a saved custom family", () => {
    // e.g. stale data left over from a deleted custom family - fonts.css imports Inter
    // unconditionally regardless of the active pick, so the admin SPA always has a real face to
    // fall back to; this mirrors that instead of silently rendering with no font-face at all.
    const css = buildTicketPageStyles({ font_family_name: "Some Deleted Family" });
    expect(css).toContain("font-family: 'Inter'");
    expect(css).toContain("url(/vendor/fontsource/inter/");
  });
});
