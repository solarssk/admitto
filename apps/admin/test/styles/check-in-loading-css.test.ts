import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../../src");
const css = readFileSync(join(SRC, "staff.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

function rule(selector: string): string {
  const escaped = selector.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  const match = new RegExp(String.raw`(?:^|\})\s*${escaped}\s*\{([^}]*)\}`, "m").exec(css);
  expect(match, `staff.css has no rule for ${selector}`).not.toBeNull();
  return match![1]!;
}

describe("check-in loading states: CSS the tests in jsdom cannot see", () => {
  it("the scan bar's spinner takes the button's text colour, so it does not vanish as brand blue on the brand-blue button", () => {
    expect(rule(".ck-scan-bar__submit .at-spinner")).toMatch(/color:\s*inherit/);
  });

  it("the placeholder count in the camera overlay's bar sits on the label's line instead of stacking above it", () => {
    expect(rule(".ck-overlay__admitted .at-skeleton")).toMatch(/display:\s*inline-block/);
  });

  it("a placeholder row in the recent scans list reserves the height of a real row", () => {
    expect(rule(".ck-recent__row--skeleton")).toMatch(/min-height:\s*58px/);
    expect(rule(".ck-recent__row--skeleton:last-child")).toMatch(/min-height:\s*57px/);
  });
});
