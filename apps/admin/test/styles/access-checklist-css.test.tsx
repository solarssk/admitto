// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { ReadinessRemedy } from "../../src/registration/AccessReadinessCard.js";

/**
 * The second line of a row of the Setup checklist, what to do next, is a plain sentence or a link. The sentence is a span that took the
 * dark colour of the page while the line above it was grey (#1894), so it takes the secondary text colour, as the line above does.
 * The colour is CSS, which jsdom cannot see, so the rule is pinned here together with the element it is meant for.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const css = `\n${readFileSync(join(ROOT, "src/registration/registration-access.css"), "utf8").replaceAll(/\/\*[\s\S]*?\*\//g, "")}`;
const staff = `\n${readFileSync(join(ROOT, "src/staff.css"), "utf8").replaceAll(/\/\*[\s\S]*?\*\//g, "")}`;

function declarationsOf(source: string, selector: string): string {
  const head = `\n${selector} {`;
  const start = source.indexOf(head);
  if (start === -1) throw new Error(`no rule for ${selector}`);
  const body = start + head.length;
  return source.slice(body, source.indexOf("}", body));
}

afterEach(cleanup);

describe("the second line of a row of the Setup checklist", () => {
  it("is a span when it is a sentence, so that the rule for a sentence reaches it, and a link when it has a place to go", () => {
    render(
      <MemoryRouter>
        <ReadinessRemedy eventId="e1" remedy={{ text: "Ask a superadmin." }} />
        <ReadinessRemedy eventId="e1" remedy={{ text: "Open the Legal tab.", link: "legal" }} />
      </MemoryRouter>,
    );
    expect(screen.getByText("Ask a superadmin.").tagName).toBe("SPAN");
    expect(screen.getByText("Ask a superadmin.").className).toBe("access-check__remedy");
    expect(screen.getByRole("link", { name: "Open the Legal tab." }).className).toBe("access-check__remedy");
  });

  it("takes the colour of the sentence above it, and a link is left in the link colour", () => {
    expect(declarationsOf(css, "span.access-check__remedy")).toMatch(/color:\s*var\(--text-secondary\)/);
    expect(declarationsOf(staff, ".overview-check__detail")).toMatch(/color:\s*var\(--text-secondary\)/);
    expect(declarationsOf(css, ".access-check__remedy")).not.toMatch(/color:/);
  });
});

describe("the lines of one row of the Checklist tab", () => {
  it("stack like wrapped text: no gap between the lines of a step, and only the name keeps room under it", () => {
    expect(declarationsOf(css, ".access-check--step .overview-check__body")).toMatch(/gap:\s*0;/);
    expect(declarationsOf(css, ".access-check__title")).toMatch(/margin-bottom:\s*var\(--space-1\)/);
    // The lines of the sentence and of what to do next share the font size, so they read as one statement.
    expect(declarationsOf(css, ".access-check__remedy")).toMatch(/font-size:\s*var\(--fs-xs\)/);
    expect(declarationsOf(staff, ".overview-check__detail")).toMatch(/font-size:\s*var\(--fs-xs\)/);
  });

  it("has the Done card as the disclosure of the app, with no rule above it", () => {
    expect(declarationsOf(css, ".access-done.disclosure")).toMatch(/border-top:\s*0/);
  });
});
