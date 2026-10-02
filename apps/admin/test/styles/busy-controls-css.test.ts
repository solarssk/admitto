import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../src/staff.css"), "utf8");

/** The declarations of the first rule that starts with `selector` (jsdom does not load the stylesheet, so the source is read). */
function declarationsOf(selector: string): string {
  const start = css.indexOf(`\n${selector} {`);
  expect(start, `rule "${selector}" exists`).toBeGreaterThan(-1);
  return css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
}

describe("a link-style button that is busy (aria-disabled, still focusable)", () => {
  it("looks like a disabled one: dimmed, with the not-allowed cursor", () => {
    const rule = declarationsOf('.link-btn[aria-disabled="true"]');
    expect(rule).toMatch(/opacity:\s*0\.5/);
    expect(rule).toMatch(/cursor:\s*not-allowed/);
  });

  it("shows the progress cursor while its own action runs, and that rule comes after the dimmed one so it wins", () => {
    expect(declarationsOf('.link-btn[aria-busy="true"]')).toMatch(/cursor:\s*progress/);
    expect(css.indexOf('\n.link-btn[aria-busy="true"] {')).toBeGreaterThan(css.indexOf('\n.link-btn[aria-disabled="true"] {'));
  });
});

describe("the notification bell's header actions are IconButtons that keep their old look", () => {
  const rest = ".notif-bell__head-actions .notif-bell__icon-action";

  it("name the parent class, so they beat `.at-iconbtn` whatever order the stylesheets load in", () => {
    const rule = declarationsOf(rest);
    expect(rule).toMatch(/width:\s*28px/);
    expect(rule).toMatch(/height:\s*28px/);
    expect(rule).toMatch(/border:\s*none/);
  });

  it("give a busy one no hover colour", () => {
    expect(css).toContain(`${rest}:hover:not(:disabled, [aria-disabled="true"]) {`);
  });

  it("no longer carry a plain-class rule that the kit's IconButton would have to fight", () => {
    expect(css).not.toMatch(/\n\.notif-bell__icon-action[ ,:{]/);
  });
});
