import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const styles = join(dirname(fileURLToPath(import.meta.url)), "../src/styles");
const spinnerCss = readFileSync(join(styles, "components/spinner.css"), "utf8");
const componentsCss = readFileSync(join(styles, "components.css"), "utf8");

const FORCED_COLORS = "@media (forced-colors: active)";

/** The text between the braces of the first block that opens with `header`, nested blocks included. */
function blockOf(source: string, header: string): string {
  const start = source.indexOf(header);
  expect(start, `"${header}" exists`).toBeGreaterThan(-1);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const char = source.charAt(i);
    if (char === "{") depth++;
    if (char === "}" && --depth === 0) return source.slice(open + 1, i);
  }
  throw new Error(`"${header}" is never closed`);
}

/** The declarations of a rule body as a property map, comments left out. */
function declarations(body: string): Record<string, string> {
  const pairs = body
    .replaceAll(/\/\*[\s\S]*?\*\//g, "")
    .split(";")
    .map((part): [string, string] => {
      const colon = part.indexOf(":");
      return [part.slice(0, colon).trim(), part.slice(colon + 1).trim()];
    })
    .filter(([property]) => property !== "");
  return Object.fromEntries(pairs);
}

// jsdom does not load the stylesheet, so a rule that goes missing changes nothing in the component tests.
// This reads the source instead: Windows High Contrast turns every border colour of a ring into one colour
// (measured in Chrome with forced colours on: all four sides computed to rgb(0, 0, 0)), which makes the
// turning head and the faint track one uniform circle. A ring built from a border needs the rule where it is
// defined: `Spinner` in spinner.css, and the spinner inside a busy `Button` in components.css.
describe.each([
  { name: "Spinner ring", css: spinnerCss, selector: ".at-spinner__ring" },
  { name: "busy Button spinner", css: componentsCss, selector: ".at-btn__spinner" },
  { name: "busy IconButton spinner", css: componentsCss, selector: ".at-iconbtn__spinner" },
])("$name in forced-colors mode (Windows High Contrast)", ({ css, selector }) => {
  const forcedRing = () => declarations(blockOf(blockOf(css, FORCED_COLORS), selector));

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
    // The ring's own rule may list several selectors (`.at-btn__spinner,\n.at-iconbtn__spinner {`).
    const ownRule = css.search(new RegExp(`\\n${selector.replaceAll(".", "\\.")}\\s*[,{]`));
    expect(ownRule, `the ring's own rule for ${selector} exists`).toBeGreaterThan(-1);
    expect(css.indexOf(FORCED_COLORS)).toBeGreaterThan(ownRule);
  });

  it("leaves the turning alone: the rule changes colours only", () => {
    expect(forcedRing()).not.toHaveProperty("animation");
  });
});
