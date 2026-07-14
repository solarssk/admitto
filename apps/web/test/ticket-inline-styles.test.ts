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
});
