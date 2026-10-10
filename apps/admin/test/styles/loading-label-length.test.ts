import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Drift guard for AGENTS.md "Admin SPA loading and busy states": a `loadingLabel` may not be longer
 * than the label at rest. A Button reserves room for both labels, so a longer one widens it all the
 * time; a More actions row swaps its text and the menu is as wide as its widest row, so a longer one
 * widens the whole menu while the job runs. Only string literals are compared (a label that is an
 * expression cannot be measured here).
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), "../../src");
const REPO = join(SRC, "../../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

export interface Pair {
  kind: "Button" | "MoreActionsMenuItem";
  resting: string;
  busy: string;
}

const LITERAL = (prop: string) => new RegExp(`\\b${prop}="([^"]*)"`);

/** Every `<MoreActionsMenuItem label="…" loadingLabel="…" />` and `<Button loadingLabel="…">Resting</Button>` in a source file. */
export function findLabelPairs(source: string): Pair[] {
  const pairs: Pair[] = [];
  for (const chunk of source.split("<MoreActionsMenuItem").slice(1)) {
    const element = chunk.slice(0, chunk.indexOf("/>"));
    const busy = LITERAL("loadingLabel").exec(element)?.[1];
    const resting = /\blabel="([^"]*)"/.exec(element)?.[1];
    if (busy !== undefined && resting !== undefined) pairs.push({ kind: "MoreActionsMenuItem", resting, busy });
  }
  for (const chunk of source.split("<Button").slice(1)) {
    const end = chunk.indexOf("</Button>");
    if (end === -1) continue;
    const element = chunk.slice(0, end);
    const busy = LITERAL("loadingLabel").exec(element)?.[1];
    // The children: the text after the opening tag's closing `>` (the last `>` that is not an arrow).
    const resting = />\s*([^<>{}]+?)\s*$/.exec(element)?.[1];
    if (busy !== undefined && resting !== undefined && resting !== "") pairs.push({ kind: "Button", resting, busy });
  }
  return pairs;
}

describe("loadingLabel is never longer than the label at rest", () => {
  it("finds the pairs it is supposed to check", () => {
    const row = findLabelPairs('<MoreActionsMenuItem icon="send" label="Send tickets" loading={b} loadingLabel="Sending…" hint="x" />');
    expect(row).toEqual([{ kind: "MoreActionsMenuItem", resting: "Send tickets", busy: "Sending…" }]);
    const button = findLabelPairs('<Button variant="primary" loading={b} loadingLabel="Adding…" onClick={() => go()}>\n  Add attendee\n</Button>');
    expect(button).toEqual([{ kind: "Button", resting: "Add attendee", busy: "Adding…" }]);
  });

  it("ignores labels it cannot measure (expressions, no resting text)", () => {
    expect(findLabelPairs('<Button loadingLabel={busy ? "A…" : "B…"}>{label}</Button>')).toEqual([]);
    expect(findLabelPairs('<MoreActionsMenuItem label={x} loadingLabel="Sending…" />')).toEqual([]);
  });

  it("flags a busy label that is longer", () => {
    const [pair] = findLabelPairs('<MoreActionsMenuItem label="Push updates" loadingLabel="Pushing updates…" />');
    expect(pair && pair.busy.length > pair.resting.length).toBe(true);
  });

  it("finds no longer busy label in the admin source", () => {
    const found: Record<string, number> = {};
    for (const file of walk(SRC)) {
      const longer = findLabelPairs(readFileSync(file, "utf8")).filter((p) => p.busy.length > p.resting.length);
      if (longer.length > 0) found[relative(REPO, file).split(sep).join("/")] = longer.length;
    }
    expect(found, 'A loadingLabel is longer than the label at rest. Leave loadingLabel out (AGENTS.md "Admin SPA loading and busy states").').toEqual({});
  });
});
