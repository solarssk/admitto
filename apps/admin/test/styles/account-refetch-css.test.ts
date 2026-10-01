import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../src/account/account-page.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

function rule(selector: string): string {
  const escaped = selector.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  const match = new RegExp(String.raw`(?:^|\})\s*${escaped}\s*\{([^}]*)\}`, "m").exec(css);
  expect(match, `account-page.css has no rule for ${selector}`).not.toBeNull();
  return match![1]!;
}

// jsdom does not load the stylesheet, so what a refreshing card looks like and does for the mouse is read from the source.
describe("a card that is refreshed after a change: CSS the tests in jsdom cannot see", () => {
  it("is the box the thin bar along its top is positioned in, and that anchor does not itself block or dim anything", () => {
    const anchor = rule(".account-refetch");
    expect(anchor).toMatch(/position:\s*relative/);
    expect(anchor).not.toMatch(/pointer-events/);
    expect(anchor).not.toMatch(/opacity/);
  });

  it("stops the pointer only while the refresh runs, not for the tail the bar keeps the anchor for", () => {
    expect(rule(".account-refetch--busy")).toMatch(/pointer-events:\s*none/);
  });

  it("dims once the wait is noticeable", () => {
    expect(Number(/opacity:\s*([\d.]+)/.exec(rule(".account-refetch--dim"))?.[1])).toBeLessThan(1);
  });
});
