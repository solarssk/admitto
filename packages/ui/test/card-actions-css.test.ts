import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/styles/components.css"), "utf8").replaceAll(/\/\*[\s\S]*?\*\//g, "");

function rule(selector: string): string {
  const escaped = selector.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  const match = new RegExp(String.raw`(?:^|\})\s*${escaped}\s*\{([^}]*)\}`, "m").exec(css);
  expect(match, `no rule for ${selector}`).not.toBeNull();
  return match![1]!.replaceAll(/\s+/g, " ").trim();
}

describe("Card: the buttons of the header actions slot (CSS that the tests in jsdom cannot see)", () => {
  it("are as small as a Button with size sm, so that a call site does not repeat it", () => {
    expect(rule(".at-card__actions .at-btn:not(.at-btn--lg)")).toBe(rule(".at-btn--sm"));
  });

  it("leave the large button its own size, which a header asks for on purpose", () => {
    expect(css).toMatch(/\.at-card__actions \.at-btn:not\(\.at-btn--lg\)/);
    expect(css).not.toMatch(/\.at-card__actions \.at-btn \{/);
  });
});
