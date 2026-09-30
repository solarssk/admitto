import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/styles/components/loader.css"), "utf8");

/** The declarations of the first rule whose selector contains `selector`. */
function declarationsOf(selector: string): string {
  const start = css.indexOf(selector);
  expect(start, `rule "${selector}" exists`).toBeGreaterThan(-1);
  return css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
}

describe("content fade-in and held skeleton CSS (jsdom does not load the stylesheet, so the source is checked)", () => {
  it("fades content in over 150ms", () => {
    expect(declarationsOf(".at-fade-in {")).toMatch(/animation:\s*at-fade-in\s+0\.15s/);
  });

  it("does not animate under prefers-reduced-motion", () => {
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)", css.indexOf("@keyframes at-fade-in")));
    expect(reduced).toMatch(/\.at-fade-in\s*\{\s*animation:\s*none/);
  });

  it("holds a skeleton's space without painting it (and without exposing it to assistive tech)", () => {
    expect(declarationsOf(".at-loading-hold {")).toMatch(/visibility:\s*hidden/);
  });
});
