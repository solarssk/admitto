import { describe, expect, it } from "vitest";
import { RULES, RULE_HINTS, scanLoadingViolations, type Counts, type Rule } from "./loadingStandardScan.js";

/**
 * Drift guard for the admin SPA's loading, busy and failed-load states (AGENTS.md "Admin SPA loading and busy states").
 *
 * The admin source has no finding for any rule in `RULES`, and this test keeps it that way: a new violation fails it, with a
 * hint of what to use instead. The only findings it tolerates are the ones listed below, each with a reason.
 */
/**
 * Raw `<button>`s that name a busy flag in `disabled` without being the busy control. Each was read and checked:
 * the control the user pressed is a different one (or the menu it sits in has already closed), so it keeps its
 * focus and `disabled` is right for this one. A new entry needs a reason a reviewer can check. A button that starts the
 * busy action itself uses `<Button loading>`, `<IconButton loading>` or `<MoreActionsMenuItem loading>` instead.
 */
const DISABLED_WHILE_ANOTHER_ACTION_RUNS: Record<string, { count: number; reason: string }> = {
  "apps/admin/src/pages/AttendeeDetailPage.tsx": {
    count: 3,
    reason: "Wallet rows of a menu that closes on click; disabled while any wallet action runs (one shared flag).",
  },
  "apps/admin/src/pages/CheckInPage.tsx": {
    count: 2,
    reason: "The scan bar's Search button and the suggestion hits; the page puts focus back on the scan field when a check ends.",
  },
  "apps/admin/src/pages/ImportPage.tsx": {
    count: 1,
    reason: "The remove-file chip; the busy control is Validate or Commit, not the chip.",
  },
  "apps/admin/src/pages/users/UserEditModal.tsx": {
    count: 2,
    reason: "The remove chips; the busy control is Save, not the chips.",
  },
  "apps/admin/src/settings/LocationSettingsPanel.tsx": {
    count: 1,
    reason: "Opens the Fix link dialog and is disabled while the form saves; the busy control is Save.",
  },
};

/**
 * Retry or Reload buttons that are not `loading`, because nothing of the app is running when they are pressed. Each was read and
 * checked; a button that re-runs a request uses `<Button loading>` with `useRetryKeepingError` or `useRetry` instead.
 */
const RETRY_WITHOUT_ANYTHING_TO_SHOW: Record<string, { count: number; reason: string }> = {
  "apps/admin/src/components/ErrorBoundary.tsx": {
    count: 1,
    reason: "Reload page: the browser reloads the whole page, so no request of the app is under way to show as busy (and the app is the thing that crashed).",
  },
};

const EXCEPTIONS: Partial<Record<Rule, Record<string, { count: number; reason: string }>>> = {
  "raw-button-busy-disabled": DISABLED_WHILE_ANOTHER_ACTION_RUNS,
  "retry-not-busy": RETRY_WITHOUT_ANYTHING_TO_SHOW,
};

/** The findings a rule may have: none, except for the ones listed above (per file, with their count). */
function tolerated(rule: Rule): Counts {
  return Object.fromEntries(Object.entries(EXCEPTIONS[rule] ?? {}).map(([file, { count }]) => [file, count]));
}

describe("loading standard drift (apps/admin/src)", () => {
  const found = scanLoadingViolations();

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
  const listed = Object.entries(EXCEPTIONS).flatMap(([rule, files]) => Object.entries(files ?? {}).map(([file, entry]) => [`${rule}: ${file}`, entry] as const));

  it.each(listed)("%s names a reason a reviewer can check", (_name, { count, reason }) => {
    expect(count).toBeGreaterThan(0);
    expect(reason.length).toBeGreaterThanOrEqual(30);
  });
});

