import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Drift guard for the switches of the staff app (standards/admin-spa/ui-gotchas.md): a switch in a settings row or in a card header has no
 * "On" or "Off" next to it, because the title says what it is and the switch shows the state ("Off" is wider than "On", so the switches did
 * not stand on one line). A `label` on a `Switch` is its name, for a switch that stands in a form with no row ("Dry run"), never its state.
 * And every switch has a name for a screen reader: an `aria-label`, an `aria-labelledby`, or a `label` that names it.
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), "../../src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".tsx") ? [path] : [];
  });
}

/** The comments of a file blanked out (same length), so that a `<Switch` in a sentence is not read as a tag. */
function withoutComments(source: string): string {
  return source
    .replaceAll(/\/\*[\s\S]*?\*\//g, (comment) => comment.replaceAll(/[^\n]/g, " "))
    .replaceAll(/(^|[^:'"`])\/\/[^\n]*/g, (line, before: string) => before + " ".repeat(line.length - before.length));
}

/** The opening tags of the `<Switch` elements of a source, with the line they start on. */
export function switchTags(source: string): { line: number; tag: string }[] {
  const text = withoutComments(source);
  const tags: { line: number; tag: string }[] = [];
  for (const match of text.matchAll(/<Switch\b/g)) {
    let depth = 0;
    let quote = "";
    let end = match.index + match[0].length;
    for (; end < text.length; end++) {
      const char = text[end];
      if (quote) {
        if (char === quote && text[end - 1] !== "\\") quote = "";
      } else if (char === '"' || char === "'" || char === "`") quote = char;
      else if (char === "{") depth++;
      else if (char === "}") depth--;
      else if (char === ">" && depth === 0) break;
    }
    tags.push({ line: text.slice(0, match.index).split("\n").length, tag: text.slice(match.index, end + 1) });
  }
  return tags;
}

/** A `label` prop (not `aria-label`) whose text is a state: `label={on ? "On" : "Off"}`. */
const STATE_LABEL = /(?<![\w-])label=\{[^}]*"(?:On|Off|Enabled|Disabled)"/;
/** What gives a switch its name. */
const NAMED = /(?<![\w-])label=|aria-label=|aria-labelledby=/;

const allSwitches = sourceFiles(SRC).flatMap((file) => switchTags(readFileSync(file, "utf8")).map((entry) => ({ ...entry, where: `${relative(SRC, file)}:${entry.line}` })));

describe("the switches of the staff app (apps/admin/src)", () => {
  it("finds the switches it is meant to check", () => {
    expect(allSwitches.length).toBeGreaterThan(40);
  });

  it("none shows its state as text: the title says what it is, and the switch shows On or Off", () => {
    const offenders = allSwitches.filter(({ tag }) => STATE_LABEL.test(tag)).map(({ where }) => where);
    expect(
      offenders,
      'Leave the `label` off a switch in a settings row or a card header and give it an `aria-label` that says what it switches. A `label` names a switch that stands in a form with no row ("Dry run"); it is never "On" or "Off".',
    ).toEqual([]);
  });

  it("every one has a name for a screen reader", () => {
    const offenders = allSwitches.filter(({ tag }) => !NAMED.test(tag)).map(({ where }) => where);
    expect(offenders, "Give the switch an aria-label that says what it switches (the visible text is no longer the name).").toEqual([]);
  });
});

describe("the scan of the switches", () => {
  it("reads a tag to its end, past the arrow functions and the quotes of its props", () => {
    const [entry] = switchTags('<Switch id="a" aria-label="Is a > b" onChange={(e) => set(e.target.checked)} checked={x ? "On" : "Off"} />\n<p>after</p>');
    expect(entry?.tag).toBe('<Switch id="a" aria-label="Is a > b" onChange={(e) => set(e.target.checked)} checked={x ? "On" : "Off"} />');
    expect(entry?.line).toBe(1);
  });

  it("does not read a comment as a switch", () => {
    expect(switchTags("/** The `<Switch>` of the form. */\n// a <Switch label={x ? \"On\" : \"Off\"} /> in a line comment\nconst a = 1;")).toEqual([]);
  });

  it("flags a state text, whatever the variable, and not a name or an aria-label", () => {
    expect(STATE_LABEL.test('<Switch id="x" label={draft.enabled ? "On" : "Off"} checked />')).toBe(true);
    expect(STATE_LABEL.test('<Switch id="x" label={form.walletEnabled ? "Enabled" : "Disabled"} checked />')).toBe(true);
    expect(STATE_LABEL.test('<Switch id="x" aria-label={on ? "On" : "Off"} checked />')).toBe(false);
    expect(STATE_LABEL.test('<Switch id="x" label="Dry run (validate only, no writes)" checked />')).toBe(false);
  });

  it("flags a switch with no name, and takes a label, an aria-label or an aria-labelledby as a name", () => {
    expect(NAMED.test('<Switch id="x" checked onChange={set} />')).toBe(false);
    expect(NAMED.test('<Switch id="x" label="Dry run" checked />')).toBe(true);
    expect(NAMED.test('<Switch id="x" aria-label="Wallet" checked />')).toBe(true);
    expect(NAMED.test('<Switch id="x" aria-labelledby="title" checked />')).toBe(true);
  });
});
