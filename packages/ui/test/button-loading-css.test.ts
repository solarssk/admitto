import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/styles/components.css"), "utf8");

/** The declarations of the first rule whose selector contains `selector`. */
function declarationsOf(selector: string): string {
  const start = css.indexOf(selector);
  expect(start, `rule "${selector}" exists`).toBeGreaterThan(-1);
  return css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
}

describe("Button loading CSS (jsdom does not load the stylesheet, so the source is checked)", () => {
  it("hides the label under the overlay spinner with opacity, so the busy button keeps its accessible name", () => {
    const rule = declarationsOf(".at-btn--loading-solo > span:not(.at-btn__spinner)");
    expect(rule).toMatch(/opacity:\s*0/);
    // visibility:hidden / display:none / clip would remove the only text from the accessibility tree.
    expect(rule).not.toMatch(/visibility|display\s*:\s*none|clip/);
  });

  it("keeps the aria-disabled-but-busy button fully opaque and shows a progress cursor", () => {
    const rule = declarationsOf('.at-btn[aria-busy="true"][aria-disabled="true"]');
    expect(rule).toMatch(/opacity:\s*1/);
    expect(rule).toMatch(/cursor:\s*progress/);
  });

  it("still dims an aria-disabled button that is not busy, with the not-allowed cursor, exactly like a disabled one (a pager's edge button)", () => {
    const rule = declarationsOf('.at-btn:disabled, .at-btn[aria-disabled="true"]');
    expect(rule).toMatch(/opacity:\s*0\.5/);
    expect(rule).toMatch(/cursor:\s*not-allowed/);
  });

  it("gives no hover or active colour to a button that is aria-disabled (busy), only to one that is neither disabled nor busy", () => {
    const rules = css.split("\n").filter((line) => /^\.at-btn--[a-z]+:(hover|active)/.test(line));
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) expect(rule, rule).toContain(':not(:disabled, [aria-disabled="true"])');
  });

  it("keeps the aria-disabled-but-busy icon button fully opaque and shows a progress cursor", () => {
    const rule = declarationsOf('.at-iconbtn[aria-busy="true"][aria-disabled="true"]');
    expect(rule).toMatch(/opacity:\s*1/);
    expect(rule).toMatch(/cursor:\s*progress/);
  });

  it("gives no hover colour to an icon button that is aria-disabled (busy)", () => {
    const rule = css.split("\n").find((line) => line.startsWith(".at-iconbtn:hover"));
    expect(rule).toBeDefined();
    expect(rule).toContain(':not(:disabled, [aria-disabled="true"])');
  });

  it("draws the icon button's spinner with the same ring rule as the button's, not a copy of it", () => {
    const header = css.slice(css.indexOf(".at-btn__spinner,"), css.indexOf("{", css.indexOf(".at-btn__spinner,")));
    expect(header).toContain(".at-iconbtn__spinner");
    expect(css.match(/\n\.at-iconbtn__spinner[,\s{]/g)?.length).toBe(1);
  });
});

