import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LOADER_CYCLE_MS } from "../src/loader-clock.js";

const here = dirname(fileURLToPath(import.meta.url));
const loaderCss = readFileSync(join(here, "../src/styles/components/loader.css"), "utf8");
const shellCss = readFileSync(join(here, "../src/styles/shell.css"), "utf8");

/** The declarations of the top-level rule `selector { ... }` (it must start a line), as a property map. */
function decls(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(`\n${selector} {`);
  expect(start, `rule "${selector}" exists`).toBeGreaterThan(-1);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start)).replaceAll(/\/\*[\s\S]*?\*\//g, "");
  const out: Record<string, string> = {};
  for (const part of body.split(";")) {
    const colon = part.indexOf(":");
    if (colon > -1) out[part.slice(0, colon).trim()] = part.slice(colon + 1).trim();
  }
  return out;
}

// jsdom does not load the stylesheet, so a layout rule that goes missing changes nothing in the component
// tests. These read the source instead: they pin what the loaders' layout promises.
describe("loader layout CSS", () => {
  it("makes the stack the positioning context, so the text hangs from the mark or ring and not from the page", () => {
    // Without it the absolutely positioned text anchors to the viewport and lands below the screen.
    expect(decls(loaderCss, ".at-loader__stack").position).toBe("relative");
  });

  it("hangs the text 14px below the stack, out of flow, so nothing moves when the caption appears", () => {
    const text = decls(loaderCss, ".at-loader__text");
    expect(text.position).toBe("absolute");
    expect(text.top).toBe("100%");
    expect(text.left).toBe("50%");
    expect(text["margin-top"]).toBe("14px");
  });

  it("never lets the text grow wider than the screen", () => {
    expect(decls(loaderCss, ".at-loader__text")["max-width"]).toMatch(/100vw/);
  });

  it("sizes the mark at 88px (a whole screen) and the ring at 32px (a panel)", () => {
    const mark = decls(loaderCss, ".at-loader--page .at-loader__mark");
    expect([mark.width, mark.height]).toEqual(["88px", "88px"]);
    const ring = decls(loaderCss, ".at-loader__ring");
    expect([ring.width, ring.height]).toEqual(["32px", "32px"]);
  });

  it("turns the ring in a time that divides the shared cycle, so a ring keeps its angle when one loader replaces another", () => {
    const turn = /at-loader-spin\s+([\d.]+)s\s+linear\s+infinite/.exec(decls(loaderCss, ".at-loader__ring").animation ?? "");
    expect(turn, "ring animation").not.toBeNull();
    expect(LOADER_CYCLE_MS % (Number(turn![1]) * 1000)).toBe(0);
  });

  it("slows the ring for prefers-reduced-motion instead of stopping it", () => {
    const media = loaderCss.indexOf("@media (prefers-reduced-motion: reduce)");
    const slowed = loaderCss.search(/\.at-loader__ring\s*\{\s*animation-duration:\s*2\.5s/);
    expect(slowed).toBeGreaterThan(media);
    expect(loaderCss).not.toMatch(/\.at-loader__ring\s*\{\s*animation:\s*none/);
  });

  it("keeps room for the line inside a panel's reserved height, so it is not clipped in a small box", () => {
    const section = decls(loaderCss, ".at-loader--section");
    expect(section["box-sizing"]).toBe("border-box");
    // 14px gap plus one 16px line at 1.4 (22.4px).
    expect(parseInt(section["padding-bottom"] ?? "0", 10)).toBeGreaterThanOrEqual(37);
  });

  it("writes the caption in --text-secondary: muted grey is under 4.5:1 on the page background", () => {
    expect(decls(loaderCss, ".at-loader").color).toBe("var(--text-secondary)");
  });

  it("styles the line with the design system's own text tokens, like the title of an empty or error state", () => {
    const label = decls(loaderCss, ".at-loader__label");
    expect(label.color).toBe("var(--text-primary)");
    expect(label["font-size"]).toBe("var(--fs-h3)");
    expect(label["font-weight"]).toBe("var(--fw-medium)");
  });

  it("does not pick a font of its own: the line follows the page (Inter, or the organisation's font)", () => {
    expect(decls(loaderCss, ".at-loader__text")["font-family"]).toBeUndefined();
    expect(decls(loaderCss, ".at-loader__label")["font-family"]).toBeUndefined();
  });

  it("hides the line while the start loader fades out over the app, which may be waiting with another one", () => {
    expect(decls(shellCss, ".shell-loading--leaving .at-loader__text").visibility).toBe("hidden");
  });

  it("still defines the soft pulse the top progress bar uses for reduced motion", () => {
    expect(loaderCss).toContain("@keyframes at-loader-soft");
  });
});

// Windows High Contrast turns every border colour of the ring into one colour (measured in Chrome with forced
// colours on: all four sides computed to rgb(0, 0, 0)), which makes the turning head and the faint track one
// uniform circle.
describe("loader ring in forced-colors mode (Windows High Contrast)", () => {
  const forcedAt = loaderCss.indexOf("@media (forced-colors: active)");
  const forcedRing = () => {
    expect(forcedAt, "forced-colors block exists").toBeGreaterThan(-1);
    return decls(loaderCss.slice(forcedAt), "  .at-loader__ring");
  };

  it("opts the ring out of the single forced border colour", () => {
    expect(forcedRing()["forced-color-adjust"]).toBe("none");
  });

  it("draws the head and the track in two different system colours, so the turning head can be seen", () => {
    const ring = forcedRing();
    expect(ring["border-color"]).toBe("GrayText");
    expect(ring["border-top-color"]).toBe("Highlight");
    expect(ring["border-top-color"]).not.toBe(ring["border-color"]);
  });

  it("comes after the ring's own rule, so it wins on equal specificity", () => {
    expect(forcedAt).toBeGreaterThan(loaderCss.indexOf("\n.at-loader__ring {"));
  });

  it("leaves the turning alone: the rule changes colours only", () => {
    expect(forcedRing()).not.toHaveProperty("animation");
  });
});
