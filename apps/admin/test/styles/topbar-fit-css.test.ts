import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The top bar has to fit a phone (shell.css, staff.css). The main area is clipped, but a bar wider than the screen still lets it
 * scroll sideways, and in Chrome the click that opens the account menu does it: the scroll then closes the menu
 * (`useFloatingPlacement`), so a Superadmin or an Administrator on a phone could not reach Sign out. Measured in real Chrome, the bar
 * was 392px wide with the status at Alert, 423px at Degraded and 431px at Checking…, on a 390px screen. What decides the width is the
 * status button: with its word it is 70px to 120px, depending on the verdict. On a phone it is one icon of the same width for every
 * verdict (a shape that differs by state, not only a colour, so that nothing hangs on colour alone), the gaps and the side padding
 * are smaller, and below 360px the Admitto name beside the logo goes, which fits 320px with every status.
 *
 * jsdom does no layout, so the fit itself cannot be measured here (the Playwright spec e2e/topbar-phone.spec.ts does it in a real
 * browser); these are the rules it rests on, pinned so that a later edit cannot quietly undo them.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replaceAll(/\/\*[\s\S]*?\*\//g, "");
const shell = read("packages/ui/src/styles/shell.css");
const staff = read("apps/admin/src/staff.css");

const PHONE = "@media (max-width: 480px)";
const NARROW_PHONE = "@media (max-width: 359px)";

/** Where the block that opens at `from` ends: the index after its closing brace (the blocks of these files nest one level deep). */
function endOfBlock(css: string, from: number): { open: number; end: number } {
  const open = css.indexOf("{", from);
  let depth = 1;
  let end = open + 1;
  while (depth > 0 && end < css.length) {
    if (css[end] === "{") depth++;
    else if (css[end] === "}") depth--;
    end++;
  }
  return { open, end };
}

/** What sits between the braces of every `@media` block with exactly this query. */
function mediaBlocks(css: string, query: string): string[] {
  const blocks: string[] = [];
  let from = css.indexOf(query);
  while (from !== -1) {
    const { open, end } = endOfBlock(css, from);
    blocks.push(css.slice(open + 1, end - 1));
    from = css.indexOf(query, end);
  }
  return blocks;
}

/** The stylesheet with every `@media` block cut out: what is left applies at every width. */
function withoutMedia(css: string): string {
  let rest = css;
  let from = rest.indexOf("@media");
  while (from !== -1) {
    const { end } = endOfBlock(rest, from);
    rest = rest.slice(0, from) + rest.slice(end);
    from = rest.indexOf("@media");
  }
  return rest;
}

/** The declarations of the rule with exactly this selector list in a piece of stylesheet text, or null. */
function declarations(text: string, selector: string): string | null {
  for (const rule of text.split("}")) {
    const [head, body] = rule.split("{");
    if (body !== undefined && head!.replaceAll(/\s+/g, " ").trim() === selector) return body.replaceAll(/\s+/g, " ").trim();
  }
  return null;
}

/** The declarations of the rule inside a `@media` block of the query. */
function inMedia(css: string, query: string, selector: string): string {
  for (const block of mediaBlocks(css, query)) {
    const found = declarations(block, selector);
    if (found !== null) return found;
  }
  throw new Error(`no rule for ${selector} in ${query}`);
}

describe("the top bar on a phone", () => {
  it("has smaller side padding and gaps up to 480px: round the menu button, the brand and the right-hand triggers", () => {
    expect(inMedia(shell, PHONE, ".topbar")).toMatch(/(?:^|;)\s*padding:\s*0 var\(--space-4\)\s*;/);
    expect(inMedia(shell, PHONE, ".topbar, .topbar__right")).toMatch(/(?:^|;)\s*gap:\s*var\(--space-2\)\s*;/);
  });

  it("keeps only the logo below 360px, where the bar with the Admitto name beside it no longer fits", () => {
    expect(inMedia(shell, NARROW_PHONE, ".topbar__brand .brand-link__wordmark")).toMatch(/(?:^|;)\s*display:\s*none\s*;/);
  });

  it("shows the verdict as an icon up to 480px, not as the dot: a shape that differs by state, not only a colour", () => {
    expect(inMedia(staff, PHONE, ".sys-status__dot")).toMatch(/(?:^|;)\s*display:\s*none\s*;/);
    expect(inMedia(staff, PHONE, ".sys-status__cue")).toMatch(/(?:^|;)\s*display:\s*inline-flex\s*;/);
  });

  it("leaves the dot and the word as they were from 481px up: the icon is off at every other width", () => {
    expect(declarations(withoutMedia(staff), ".sys-status__cue")).toMatch(/(?:^|;)\s*display:\s*none\s*;/);
    expect(declarations(withoutMedia(staff), ".sys-status__dot")).not.toMatch(/display\s*:/);
  });

  it("clips the word up to 480px the way .sr-only does, so that it is not shown but stays the button's name", () => {
    const clipped = inMedia(staff, PHONE, ".sys-status__label--short");
    for (const declaration of ["position: absolute", "width: 1px", "height: 1px", "overflow: hidden", "clip-path: inset(50%)"]) {
      expect(clipped, declaration).toContain(declaration);
    }
    // display: none would take the word out of the page, and the button would have no name
    expect(clipped).not.toMatch(/display\s*:/);
  });
});
