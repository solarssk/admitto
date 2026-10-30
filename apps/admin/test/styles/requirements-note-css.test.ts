import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The note under Event items on the Requirements page ("Attendee fields are on the Fields tab of the Registration page") sits on the
 * grey page background, not in a white card. axe-core in real Chrome measured the muted text colour there at 4.34:1, below the 4.5:1
 * that 13px text needs, so the note takes the secondary text colour, and its link is underlined so that it does not rest on its colour
 * alone. It is CSS, which the tests in jsdom cannot see, so the rules are pinned here.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const css = readFileSync(join(ROOT, "src/requirements/requirements.css"), "utf8").replaceAll(/\/\*[\s\S]*?\*\//g, "");
const page = readFileSync(join(ROOT, "src/pages/RequirementsPage.tsx"), "utf8");

const text = `\n${css}`;

/** The declarations of the one rule that starts a line with exactly this selector. */
function declarationsOf(selector: string): string {
  const head = `\n${selector} {`;
  const start = text.indexOf(head);
  if (start === -1) throw new Error(`no rule for ${selector}`);
  const body = start + head.length;
  return text.slice(body, text.indexOf("}", body));
}

describe("the note under Event items on the Requirements page", () => {
  it("is drawn with the class that gives it the secondary text colour, not the muted one that fails on the page background", () => {
    expect(page).toContain('className="requirements-section-hint requirements-section-hint--page"');
    expect(declarationsOf(".requirements-section-hint--page")).toMatch(/color:\s*var\(--text-secondary\)/);
    expect(declarationsOf(".requirements-section-hint")).toMatch(/color:\s*var\(--text-muted\)/);
  });

  it("underlines its link, so that it is told from the text by more than its colour", () => {
    expect(declarationsOf(".requirements-section-hint--page a")).toMatch(/text-decoration:\s*underline/);
  });
});
