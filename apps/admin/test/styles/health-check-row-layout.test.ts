import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../../src");
const css = readFileSync(join(SRC, "settings/health-check.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Declarations of the first rule whose selector list is exactly `selector`. */
function rule(selector: string): string {
  const escaped = selector.replaceAll(/[.[\]:]/g, String.raw`\$&`);
  const m = new RegExp(String.raw`(?:^|\})\s*${escaped}\s*\{([^}]*)\}`).exec(css);
  expect(m, `no rule for ${selector} in health-check.css`).not.toBeNull();
  return m![1]!;
}

/** jsdom does no layout or font resolution, so none of these can show up in a behavioural test:
 * the row is a <button>, which renders in the browser's default Arial 13.33px unless it opts in
 * to the page font, while the expanded body (a plain <div>) used Inter. */
describe("Health check row typography and alignment (health-check.css)", () => {
  it("makes the row button inherit the page font", () => {
    expect(rule(".health-check__row-btn")).toMatch(/font:\s*inherit/);
  });

  it("uses one size and line height for the row text and the expanded detail rows", () => {
    expect(rule(".health-check__row-text")).toMatch(/font-size:\s*var\(--fs-sm\)/);
    expect(rule(".health-check__row-text")).toMatch(/line-height:\s*var\(--lh-normal\)/);
    expect(rule(".health-check__detail")).toMatch(/font-size:\s*var\(--fs-sm\)/);
    expect(rule(".health-check__detail")).toMatch(/line-height:\s*var\(--lh-normal\)/);
  });

  it("shows detail values in the same typeface as the rest of the panel", () => {
    expect(css).not.toMatch(/font-family/);
    expect(css).not.toMatch(/--font-mono/);
  });

  it("centres the category icon and chevron on the status circle's 1.75rem band", () => {
    for (const selector of [".health-check__row-icon", ".health-check__chevron"]) {
      expect(rule(selector)).toMatch(/height:\s*1\.75rem/);
      expect(rule(selector)).toMatch(/align-items:\s*center/);
    }
  });

  it("lays guidance out in the same label-and-value grid as the technical details", () => {
    expect(css).toMatch(/\.health-check__guidance,\s*\.health-check__details\s*\{[^}]*display:\s*grid/);
  });

  it("declares the quiet guidance colour after the base dd colour, so it wins on order", () => {
    const base = css.indexOf(".health-check__detail dd {");
    const quiet = css.indexOf(".health-check__guidance--quiet .health-check__detail dd {");
    expect(base).toBeGreaterThan(-1);
    expect(quiet).toBeGreaterThan(base);
  });

  it("leaves the spacing around the verdict notice to the card body's gap", () => {
    expect(rule(".health-check__card .at-card__body")).toMatch(/display:\s*flex/);
    expect(rule(".health-check__card .at-card__body")).toMatch(/gap:\s*var\(--space-4\)/);
    // No margin of its own on the notice, and none pushing the intro away from it.
    expect(css).not.toMatch(/\.health-check__verdict/);
    expect(rule(".health-check__meta")).not.toMatch(/margin:[^;]*var\(--space-4\)/);
  });

  it("keeps the guidance link a plain link with no underline, even on hover", () => {
    expect(rule(".health-check__guidance-link:hover")).toMatch(/text-decoration:\s*none/);
    expect(rule(".health-check__guidance-link")).not.toMatch(/display:\s*inline-flex/);
  });
});
