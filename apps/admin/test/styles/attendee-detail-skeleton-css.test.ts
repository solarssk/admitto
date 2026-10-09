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
});
