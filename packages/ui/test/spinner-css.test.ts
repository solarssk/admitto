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
// defined: `Spinner` in spinner.css, and the spinner inside a busy `Button` in components.css. Only the head is
// drawn, in the system's own text colour (CanvasText on the page, ButtonText on a button's face): the pairs the
// system guarantees to be readable. Head and track in two system colours were measured on the rendered pixels
// in Chrome's forced palettes at 1.24:1 (light) and 1.54:1 (dark), because Highlight and GrayText have no
// guaranteed contrast with each other. The head is never `currentColor`: with `forced-color-adjust: none` that
// is the author's colour again (measured: the brand blue, white in a primary button).
describe.each([
  { name: "Spinner ring", css: spinnerCss, selector: ".at-spinner__ring", head: "CanvasText" },
  { name: "busy Button spinner", css: componentsCss, selector: ".at-btn__spinner", head: "ButtonText" },
  { name: "busy IconButton spinner", css: componentsCss, selector: ".at-iconbtn__spinner", head: "ButtonText" },
])("$name in forced-colors mode (Windows High Contrast)", ({ css, selector, head }) => {
  const forcedRing = () => declarations(blockOf(blockOf(css, FORCED_COLORS), selector));

  it("opts the ring out of the single forced border colour", () => {
    expect(forcedRing()["forced-color-adjust"]).toBe("none");
  });

  it(`draws only the head, in ${head}, so the turning arc can be seen`, () => {
    const ring = forcedRing();
    expect(ring["border-top-color"]).toBe(head);
    expect(ring["border-color"]).toBe("transparent");
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

// A `Spinner` is also placed on a button: as the icon of a busy `Button` (ConfirmDialog, the crop dialog), in the
// search button of check-in and in the rows of a More actions menu. A button's face is ButtonFace, and only
// ButtonText has a guaranteed contrast with it, so the head there must not stay CanvasText.
describe("Spinner on a button in forced-colors mode (Windows High Contrast)", () => {
  const onButton = () => declarations(blockOf(blockOf(spinnerCss, FORCED_COLORS), "button .at-spinner__ring"));

  it("draws the head in ButtonText, the colour the system guarantees on a button's face", () => {
    expect(onButton()["border-top-color"]).toBe("ButtonText");
  });

  it("changes only the head colour: opting out and the missing track come from the general rule", () => {
    expect(Object.keys(onButton())).toEqual(["border-top-color"]);
  });
});
