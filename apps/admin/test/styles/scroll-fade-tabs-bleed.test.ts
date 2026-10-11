import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../../src");
const css = readFileSync(join(SRC, "components/scroll-fade-tabs.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Declarations of the first rule whose selector list is exactly `selector`. */
function rule(selector: string): string {
  const escaped = selector.replaceAll(/[.[\]:]/g, String.raw`\$&`);
  const m = new RegExp(String.raw`(?:^|\})\s*${escaped}\s*\{([^}]*)\}`).exec(css);
  expect(m, `no rule for ${selector} in scroll-fade-tabs.css`).not.toBeNull();
  return m![1]!;
}

/** jsdom does no layout, so the arrows' position cannot be measured in a behavioural test. The
 * scroll strip has padding and a negative margin (room for a tab's focus ring), which makes it
 * reach past `.scroll-fade-tabs`; an arrow or fade left at 0 then sits inside the strip's edge and
 * lets a slice of the clipped tab name show beside it. */
describe("Scroll-fade tabs: arrows and fades sit on the scroll strip's edge (scroll-fade-tabs.css)", () => {
  const bleed = /--scroll-fade-tabs-bleed:\s*-(\d+)px/.exec(rule(".scroll-fade-tabs"));

  it("declares how far the scroll strip reaches past its box", () => {
    expect(bleed).not.toBeNull();
  });

  it("matches the strip's own horizontal padding and negative margin", () => {
    const scroll = rule(".scroll-fade-tabs__scroll");
    const n = bleed![1]!;
    expect(scroll).toMatch(new RegExp(String.raw`padding:\s*${n}px ${n}px 0`));
    expect(scroll).toMatch(new RegExp(String.raw`margin:\s*-${n}px -${n}px 0`));
  });

  it("offsets both arrows and both fades by it, not by 0", () => {
    for (const [selector, side] of [
      [".scroll-fade-tabs::before", "left"],
      [".scroll-fade-tabs::after", "right"],
      [".scroll-fade-tabs__arrow--left", "left"],
      [".scroll-fade-tabs__arrow--right", "right"],
    ] as const) {
      expect(rule(selector), selector).toMatch(new RegExp(String.raw`${side}:\s*var\(--scroll-fade-tabs-bleed\)`));
    }
  });
});
