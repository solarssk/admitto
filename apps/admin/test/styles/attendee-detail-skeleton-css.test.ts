import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../../src");
const strip = (css: string) => css.replaceAll(/\/\*[\s\S]*?\*\//g, "");
const css = strip(readFileSync(join(SRC, "attendees/attendees.css"), "utf8"));
const shell = strip(readFileSync(join(SRC, "../../../packages/ui/src/styles/shell.css"), "utf8"));

function rule(source: string, selector: string): string {
  const escaped = selector.replaceAll(/[.*+?^${}()|[\]\\>]/g, String.raw`\$&`);
  const match = new RegExp(String.raw`(?:^|\})\s*${escaped}\s*\{([^}]*)\}`, "m").exec(source);
  expect(match, `no rule for ${selector}`).not.toBeNull();
  return match![1]!;
}

describe("the attendee page's skeleton: CSS that the tests in jsdom cannot see", () => {
  it("its status region takes back exactly the gap of the page's rows until the note is in it", () => {
    // The page is a `.screen`, a flex column with a gap; an empty item would add one gap of its own.
    const gap = /gap:\s*(\d+)px/.exec(rule(shell, ".screen"))![1];
    expect(rule(css, ".attendee-detail-skeleton__status")).toMatch(new RegExp(String.raw`margin-bottom:\s*-${gap}px`));
    expect(rule(css, ".attendee-detail-skeleton__status--note")).toMatch(/margin-bottom:\s*0/);
  });

  it("its tab strip is not clickable and is as tall as the real one", () => {
    expect(rule(css, ".attendee-detail-skeleton__tabs")).toMatch(/pointer-events:\s*none/);
    expect(rule(css, ".attendee-detail-skeleton__tabs .at-tab")).toMatch(/line-height:\s*normal/);
  });

  it("the columns of the Activity and Notes placeholders that hold bars may shrink, so a bar yields on a phone instead of sticking out of the card", () => {
    // A flex item does not go below the width of its widest content by default, and a bar has a width of its own.
    const shrink = /\.attendee-detail-skeleton \.at-tl-body,\s*\.attendee-detail-skeleton \.at-notes-list__author-group\s*\{([^}]*)\}/.exec(css);
    expect(shrink, "no rule that lets the body of a row and the author of a note shrink").not.toBeNull();
    expect(shrink![1]).toMatch(/min-width:\s*0\s*;/);
  });

  it("a line of text drawn as a bar is a flex row that centres the bar in the line's own height", () => {
    const line = rule(css, ".attendee-detail-skeleton__line");
    expect(line).toMatch(/display:\s*flex/);
    expect(line).toMatch(/align-items:\s*center/);
    // Its bar shrinks with it, instead of holding the line wide.
    expect(line).toMatch(/min-width:\s*0\s*;/);
  });

  it("the note field is two rows of the page's textarea, and the taller one that a touch screen has", () => {
    // Compound, so that it beats the 120px of `.at-skeleton--rect` whatever the order of the stylesheets.
    expect(rule(css, ".at-skeleton.attendee-detail-skeleton__textarea")).toMatch(/height:\s*57px/);
    const coarse = /@media \(pointer: coarse\)\s*\{\s*\.at-skeleton\.attendee-detail-skeleton__textarea\s*\{([^}]*)\}\s*\}/.exec(css);
    expect(coarse, "no touch-screen height for the note field").not.toBeNull();
    expect(coarse![1]).toMatch(/height:\s*66px/);
  });
});
