import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../../src");
const read = (file: string) => readFileSync(join(SRC, file), "utf8");

/** The declarations of the first rule that starts with `selector` (jsdom does no layout and loads no stylesheet, so the source is checked). */
function rule(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `rule "${selector}" exists`).toBeGreaterThan(-1);
  return css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
}

describe("Registration, Requests: the notice and the card (#1881)", () => {
  it("keeps them 12px apart, the space the notice has under the tabs, not the 16px between two cards", () => {
    expect(rule(read("registration/registration-requests.css"), ".registration-requests")).toMatch(/gap:\s*var\(--space-3\)/);
  });
});

describe("Check-in header buttons (#1900)", () => {
  it("compacts them under 768px with a rule of their own, since they no longer ask for the small size in the markup", () => {
    expect(read("staff.css")).toMatch(
      /@media \(max-width: 767px\) \{\s*\.checkin-pageheader \.at-pageheader__actions \.at-btn \{[^}]*height:\s*var\(--control-h-sm\)/,
    );
  });
});
