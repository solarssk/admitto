import { describe, expect, it } from "vitest";
import { RULES, RULE_HINTS, scanLoadingViolations, type Counts, type Rule } from "./loadingStandardScan.js";

/**
 * Drift guard for the admin SPA's loading, busy and failed-load states (AGENTS.md "Admin SPA loading and busy states").
 *
 * This is a ratchet: the table below is every place that still uses an old idiom when the
 * standard was introduced. A file may not gain a violation, and the count for a file may only go
 * down. When a migration PR removes an old idiom, lower (or delete) its entry in the same PR; this
 * test fails with "lower the allowlist" until you do, so the debt can only shrink. The final
 * migration PR leaves each table empty, and the tables can then be replaced by a plain
 * `expect(found).toEqual({})`.
 */
/**
 * Raw `<button>`s that name a busy flag in `disabled` without being the busy control. Each was read and checked:
 * the control the user pressed is a different one (or the menu it sits in has already closed), so it keeps its
 * focus and `disabled` is right for this one. This is not debt that shrinks; a new entry needs a reason a
 * reviewer can check. A button that starts the busy action itself uses `<Button loading>`, `<IconButton loading>`
 * or `<MoreActionsMenuItem loading>` instead.
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
  "apps/admin/src/pages/ReportsPage.tsx": {
    count: 1,
    reason: "An export row of a menu that closes on click, so the pressed row is gone while it is busy.",
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

const ALLOWED: Record<Rule, Counts> = {
  "hand-rolled-spinner-css": {
    "apps/admin/src/pages/setup-wizard.css": 2,
    "apps/admin/src/staff.css": 1,
  },
  "bare-loading-text": {
    "apps/admin/src/communication/DeliveryLogTable.tsx": 1,
    "apps/admin/src/pages/CustomFieldsReportsTab.tsx": 1,
    "apps/admin/src/pages/EventOverviewPage.tsx": 4,
    "apps/admin/src/pages/ImportPage.tsx": 1,
    "apps/admin/src/pages/MailReportsTab.tsx": 1,
    "apps/admin/src/pages/RequirementsPage.tsx": 1,
    "apps/admin/src/pages/WalletsReportsTab.tsx": 1,
    "apps/admin/src/pages/wizard/WizardStep2Mail.tsx": 1,
    "apps/admin/src/pages/wizard/WizardStep3Branding.tsx": 1,
    "apps/admin/src/requirements/EventCustomFieldsCard.tsx": 1,
  },
  "busy-label-swap": {
    "apps/admin/src/communication/DeliveryLogTable.tsx": 1,
    "apps/admin/src/events/CreateEventModal.tsx": 1,
    "apps/admin/src/pages/DeviceLabelStep.tsx": 1,
    "apps/admin/src/pages/EventOverviewPage.tsx": 3,
    "apps/admin/src/pages/ImportPage.tsx": 3,
    "apps/admin/src/pages/ReportsPage.tsx": 1,
    "apps/admin/src/pages/RequirementsPage.tsx": 1,
    "apps/admin/src/pages/SetupWizardPage.tsx": 3,
    "apps/admin/src/pages/wizard/WizardStep2Mail.tsx": 1,
    "apps/admin/src/requirements/EventItemDrawer.tsx": 1,
  },
  "error-state-not-an-alert": {},
  "retry-outside-an-alert": {},
  // A Retry drawn as a raw <button>, each to move to <Button loading> with the screen that owns it.
  "retry-in-a-raw-button": {},
  // Hand-made busy states on a raw <button>, each to move to <Button loading> with the screen that owns it.
  "raw-button-busy-disabled": Object.fromEntries(
    Object.entries(DISABLED_WHILE_ANOTHER_ACTION_RUNS).map(([file, { count }]) => [file, count]),
  ),
};

describe("loading standard drift (apps/admin/src)", () => {
  const found = scanLoadingViolations();

  it.each(RULES)("%s: no new violations, and the allowlist only shrinks", (rule) => {
    const actual = found[rule];
    const allowed = ALLOWED[rule];

    const grew = Object.entries(actual)
      .filter(([file, n]) => n > (allowed[file] ?? 0))
      .map(([file, n]) => `${file}: ${n} (allowed ${allowed[file] ?? 0})`);
    expect(grew, `New "${rule}" violation. ${RULE_HINTS[rule]}`).toEqual([]);

    const shrank = Object.entries(allowed)
      .filter(([file, n]) => (actual[file] ?? 0) < n)
      .map(([file, n]) => `${file}: ${actual[file] ?? 0} (allowlist says ${n})`);
    expect(shrank, `Nice: "${rule}" debt went down. Lower or remove these entries in ALLOWED.`).toEqual([]);
  });
});

describe("raw buttons disabled while another action runs", () => {
  it.each(Object.entries(DISABLED_WHILE_ANOTHER_ACTION_RUNS))("%s names a reason a reviewer can check", (_file, { count, reason }) => {
    expect(count).toBeGreaterThan(0);
    expect(reason.length).toBeGreaterThanOrEqual(30);
  });
});

