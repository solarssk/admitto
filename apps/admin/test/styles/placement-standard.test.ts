import { describe, expect, it } from "vitest";
import { RULES, RULE_HINTS, scanPlacementViolations, type Counts, type Rule } from "./placementStandardScan.js";

/**
 * Drift guard for how floating panels (menus, pickers, suggestion lists) are placed
 * (standards/admin-spa/ui-gotchas.md, "A floating panel is placed by useFloatingPlacement").
 *
 * Staff UI code (`apps/admin/src`, `packages/ui/src`) has no finding for any rule in `RULES`, and this
 * test keeps it that way: a new hand-rolled placement fails it, with a hint of what to use instead. The only
 * findings it tolerates are the ones listed below, each with a reason. It is a ratchet: an entry that no longer
 * matches the code has to be lowered or removed.
 */
const TOOLTIP = "packages/ui/src/components/Tooltip.tsx";
const TOOLTIP_REASON =
  "The Tooltip has its own placement (hover and focus bubble, no focus move, no click-outside) and lives in the " +
  "shared kit, which cannot import useFloatingPlacement from the admin app. Moving the hook into the kit is a " +
  "decision of its own; until then the Tooltip is the one hand-rolled placement.";

const EXCEPTIONS: Partial<Record<Rule, Record<string, { count: number; reason: string }>>> = {
  "inline-fixed-position": { [TOOLTIP]: { count: 3, reason: TOOLTIP_REASON } },
  "viewport-math-in-component": { [TOOLTIP]: { count: 1, reason: TOOLTIP_REASON } },
};

/** The findings a rule may have: none, except for the ones listed above (per file, with their count). */
function tolerated(rule: Rule): Counts {
  return Object.fromEntries(Object.entries(EXCEPTIONS[rule] ?? {}).map(([file, { count }]) => [file, count]));
}

describe("floating panel placement drift (apps/admin/src, packages/ui/src)", () => {
  const found = scanPlacementViolations();

  it.each(RULES)("%s: no violation beyond the documented exceptions", (rule) => {
    const actual = found[rule];
    const allowed = tolerated(rule);

    const extra = Object.entries(actual)
      .filter(([file, n]) => n > (allowed[file] ?? 0))
      .map(([file, n]) => `${file}: ${n} (allowed ${allowed[file] ?? 0})`);
    expect(extra, `"${rule}" violation. ${RULE_HINTS[rule]}`).toEqual([]);

    const stale = Object.entries(allowed)
      .filter(([file, n]) => (actual[file] ?? 0) < n)
      .map(([file, n]) => `${file}: ${actual[file] ?? 0} (listed ${n})`);
    expect(stale, `An exception listed in this file for "${rule}" no longer matches the code. Lower its count or remove it.`).toEqual([]);
  });
});

describe("the findings that are tolerated", () => {
  const listed = Object.entries(EXCEPTIONS).flatMap(([rule, files]) =>
    Object.entries(files ?? {}).map(([file, entry]) => [`${rule}: ${file}`, entry] as const),
  );

  it.each(listed)("%s names a reason a reviewer can check", (_name, { count, reason }) => {
    expect(count).toBeGreaterThan(0);
    expect(reason.length).toBeGreaterThanOrEqual(30);
  });
});
