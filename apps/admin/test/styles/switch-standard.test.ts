import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { openingTags, tsxFiles, withoutComments } from "./jsxScan.js";

/**
 * Drift guard for the switches of the staff app (standards/admin-spa/ui-gotchas.md): a switch in a settings row or in a card header has no
 * "On" or "Off" next to it, because the title says what it is and the switch shows the state ("Off" is wider than "On", so the switches did
 * not stand on one line). A `label` on a `Switch` is its name, for a switch that stands in a form with no row ("Dry run"), never its state.
 * And every switch has a name for a screen reader: an `aria-label`, an `aria-labelledby`, or a `label` that names it.
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), "../../src");

/** A `label` prop (not `aria-label`) whose text is a state: `label={on ? "On" : "Off"}`. */
const STATE_LABEL = /(?<![\w-])label=\{[^}]*"(?:On|Off|Enabled|Disabled)"/;
/** What gives a switch its name. */
const NAMED = /(?<![\w-])label=|aria-label=|aria-labelledby=/;

const allSwitches = tsxFiles(SRC).flatMap((file) => openingTags(withoutComments(readFileSync(file, "utf8")), "Switch").map((entry) => ({ ...entry, where: `${relative(SRC, file)}:${entry.line}` })));

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

describe("what the guard counts as a state text and as a name", () => {
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
