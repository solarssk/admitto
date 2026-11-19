import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** The table of Event items, the Fields tab and the Legal tab is one: its rules live in item-table.css, keyed by `item-table`. CSS, which jsdom cannot see. */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replaceAll(/\/\*[\s\S]*?\*\//g, "");

describe("the shared item table", () => {
  const shared = read("src/components/item-table.css");

  it("holds the table rules, and requirements.css no longer scopes any of them to its own section", () => {
    expect(shared).toContain(".item-table .attendees-table-wrap .table");
    expect(shared).toContain("table-layout: fixed");
    expect(shared).toContain("height: 3.75rem");
    expect(read("src/requirements/requirements.css")).not.toMatch(/\.requirements-section \.(table|attendees-table-wrap)/);
  });

  it("is a table in a box inside the padding of its card: a border, rounded corners, a grey header, hairlines and none under the last row", () => {
    expect(shared).toMatch(/\.item-table \.attendees-table-wrap \{[^}]*border: 1px solid var\(--border\);[^}]*border-radius: var\(--radius-md\);[^}]*overflow: hidden;/);
    expect(shared).toMatch(/\.item-table \.table thead th \{[^}]*background: var\(--surface-sunken\)/);
    expect(shared).toMatch(/\.item-table \.table tbody tr:last-child td \{[^}]*border-bottom: 0/);
    expect(shared).toMatch(/th:first-child,\s*\.item-table \.table td:first-child \{[^}]*padding-left: var\(--space-4\)/);
    expect(shared).toMatch(/th:last-child,\s*\.item-table \.table td:last-child \{[^}]*padding-right: var\(--space-3\)/);
    expect(shared).not.toMatch(/margin(-inline)?:\s*-/);
  });

  it.each([["src/pages/RequirementsPage.tsx"], ["src/requirements/EventCustomFieldsCard.tsx"], ["src/requirements/RequirementsSkeleton.tsx"]])(
    "%s draws its card padded, so the box is inset by the card",
    (path) => {
      expect(readFileSync(join(ROOT, path), "utf8")).not.toContain("padded={false}");
    },
  );

  it("takes the narrow column out with no width and no content, not display none, and shows the status under the name instead (a media query)", () => {
    expect(shared).toMatch(/@media \(max-width: 700px\)[\s\S]*width: 0;[\s\S]*padding: 0;/);
    expect(shared).not.toContain("@container");
    expect(shared).not.toMatch(/item-table__wide-only\s*\{[^}]*display:\s*none/);
  });

  it.each([
    ["src/pages/RequirementsPage.tsx"],
    ["src/requirements/EventCustomFieldsCard.tsx"],
    ["src/requirements/RequirementsSkeleton.tsx"],
    ["src/registration/LegalTextTable.tsx"],
  ])("is used by %s, which imports it itself", (path) => {
    const source = readFileSync(join(ROOT, path), "utf8");
    expect(source).toContain("item-table");
    expect(source).toContain('components/item-table.css"');
  });
});
