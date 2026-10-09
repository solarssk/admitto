import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/styles/components/empty-state.css"), "utf8").replaceAll(/\/\*[\s\S]*?\*\//g, "");

function rule(selector: string): string {
  const escaped = selector.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  const match = new RegExp(String.raw`(?:^|\})\s*${escaped}\s*\{([^}]*)\}`, "m").exec(css);
  expect(match, `no rule for ${selector}`).not.toBeNull();
  return match![1]!;
}

describe("EmptyState: CSS that the tests in jsdom cannot see", () => {
  it("the glyph of a failed load takes the error colour of Notice's error", () => {
    expect(rule(".at-empty-state--error .at-empty-state__icon")).toMatch(/color:\s*var\(--status-error\)/);
  });
});
