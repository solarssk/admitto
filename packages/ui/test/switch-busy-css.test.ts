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

describe("Switch off states CSS (jsdom does not load the stylesheet, so the source is checked)", () => {
  it("dims a switch that is off because its change is being saved (aria-disabled, kept focusable) like a disabled one", () => {
    const rule = declarationsOf('.at-switch:has(input:disabled), .at-switch:has(input[aria-disabled="true"])');
    expect(rule).toMatch(/opacity:\s*0\.5/);
    expect(rule).toMatch(/cursor:\s*not-allowed/);
  });

  it("shows the wait cursor on a switch whose change is on its way, which wins over not-allowed", () => {
    const busy = css.indexOf('.at-switch:has(input[aria-busy="true"])');
    const off = css.indexOf('.at-switch:has(input[aria-disabled="true"])');
    expect(busy).toBeGreaterThan(off);
    expect(declarationsOf('.at-switch:has(input[aria-busy="true"])')).toMatch(/cursor:\s*progress/);
  });
});

describe("Switch and checkbox: the hidden input stays inside its label (#1893)", () => {
  // Their input is position: absolute with no offsets. Without a positioned label it is placed against the page, at the spot it
  // has in the flow, far below the fold of a long page; focusing it (a click on the label does) then scrolls the whole shell
  // (overflow: hidden does not stop that) and leaves an empty strip at the bottom of the window.
  it.each([".at-switch", ".at-check"])("makes %s the containing block of its input", (selector) => {
    expect(declarationsOf(`${selector} {`)).toMatch(/position:\s*relative/);
  });
});
