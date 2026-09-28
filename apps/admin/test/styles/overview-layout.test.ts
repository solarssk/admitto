import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../../src");
const css = readFileSync(join(SRC, "staff.css"), "utf8");
const page = readFileSync(join(SRC, "pages/EventOverviewPage.tsx"), "utf8");

/** jsdom does no layout, so nothing else notices when one of these rules goes missing: the page
 * still renders and every behavioural test still passes, but the Overview cards silently lose
 * their sizing (Recent activity's list goes back to setting the row's height, which stretched
 * Check-in progress with empty space). This pins the coupling between the class names in the page
 * and the rules in staff.css. */
describe("Overview card sizing (staff.css)", () => {
  it("lets Recent activity's list fill its card instead of setting the row's height", () => {
    expect(page).toContain("overview-card--timeline");
    expect(css).toMatch(/\.overview-card--timeline \.at-card__body\s*\{[^}]*position:\s*relative/);
    expect(css).toMatch(/\.overview-card--timeline \.overview-timeline\s*\{[^}]*position:\s*absolute/);
    // A fixed height on the list itself would put the coupling back.
    expect(css).not.toMatch(/\n\.overview-timeline\s*\{[^}]*\n\s*height:\s*\d+px/);
  });

  it("stretches the two card rows to one height each, without stretching the cards' content", () => {
    expect(css).toMatch(/\.overview-row--stretch\s*\{[^}]*align-items:\s*stretch/);
    expect(page.match(/overview-row overview-row--stretch/g)).toHaveLength(2);
    expect(css).not.toContain("overview-card--fill");
    expect(page).not.toContain("overview-card--fill");
  });
});
