import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The top bar has to fit a phone (shell.css, staff.css). `.main` is `overflow: hidden`, but a bar wider than the screen still lets
 * it scroll sideways, and in Chrome the click that opens the account menu does it: the scroll then closes the menu
 * (`useFloatingPlacement`), so a Superadmin or an Administrator on a phone could not reach Sign out. Measured in real Chrome, the bar
 * was 392px wide with the status at Alert, 423px at Degraded and 431px at Checking…, on a 390px screen. What decides the width is the
 * word beside the status dot, so on a phone the dot stands alone and the gaps are tighter, which fits 360px with every status.
 *
 * jsdom does no layout, so the fit itself cannot be measured here; these are the rules it rests on, pinned so that a later edit
 * cannot quietly undo them.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replaceAll(/\/\*[\s\S]*?\*\//g, "");
const shell = read("packages/ui/src/styles/shell.css");
const staff = read("apps/admin/src/staff.css");

const PHONE = "@media (max-width: 480px)";

/** What sits between the braces of every `@media` block with exactly this query (the blocks of these files do not nest). */
function mediaBlocks(css: string, query: string): string[] {
  const blocks: string[] = [];
  let from = css.indexOf(query);
  while (from !== -1) {
    const start = css.indexOf("{", from);
    let depth = 1;
    let end = start + 1;
    while (depth > 0 && end < css.length) {
      if (css[end] === "{") depth++;
      else if (css[end] === "}") depth--;
      end++;
    }
    blocks.push(css.slice(start + 1, end - 1));
    from = css.indexOf(query, end);
  }
  return blocks;
}

/** The declarations of the rule with exactly this selector list, inside a phone `@media` block. */
function phoneRule(css: string, selector: string): string {
  for (const block of mediaBlocks(css, PHONE)) {
    for (const rule of block.split("}")) {
      const [head, body] = rule.split("{");
      if (body !== undefined && head!.replaceAll(/\s+/g, " ").trim() === selector) return body.replaceAll(/\s+/g, " ").trim();
    }
  }
  throw new Error(`no rule for ${selector} in ${PHONE}`);
}

describe("the top bar on a phone (up to 480px)", () => {
  it("has smaller gaps, between the menu button, the brand and the right-hand triggers, and between those triggers", () => {
    expect(phoneRule(shell, ".topbar, .topbar__right")).toMatch(/(?:^|;)\s*gap:\s*var\(--space-2\)\s*;/);
  });

  it("shows the status as its dot and chevron, the word clipped away like .sr-only does", () => {
    const hidden = phoneRule(staff, ".sys-status__label--short");
    for (const declaration of ["position: absolute", "width: 1px", "height: 1px", "overflow: hidden", "clip-path: inset(50%)"]) {
      expect(hidden, declaration).toContain(declaration);
    }
  });

  it("leaves the word in the page: display: none would take it out of the button's name", () => {
    expect(phoneRule(staff, ".sys-status__label--short")).not.toMatch(/display\s*:/);
  });
});
