import { describe, expect, it } from "vitest";
import { RULES, RULE_HINTS, scanTimeZoneViolations, type Counts, type Rule } from "./timeZoneStandardScan.js";

/**
 * Drift guard for the zone a time is shown in (standards/admin-spa/time-display.md): a time on a screen is
 * the same text for every viewer, so the staff UI (`apps/admin/src`) does not read the viewer's own zone to
 * format one. The reads that remain are listed below, each with the reason a reviewer can check. A new one
 * fails this test with a hint of what to use instead. It is a ratchet: an entry that no longer matches the
 * code has to be lowered or removed.
 */
const SECONDARY_LINE =
  "The secondary \"Your local time\" line that sits under a UTC time, for a row whose actor zone is not stored. The time itself stays UTC.";
const LIVE_CHECK_IN =
  "A check-in screen is read live at the venue, by the operator who is scanning, so \"Today\" and the time of a scan are read against that person's own clock.";
const JUST_RAN_BY_VIEWER =
  "The result of something the viewer has just asked for and is looking at, so its time is read against their own clock, with the offset shown.";
const NEW_EVENT_DEFAULT = "The zone offered first for a new event is the creator's own. They can change it before saving.";

const EXCEPTIONS: Record<Rule, Record<string, { count: number; reason: string }>> = {
  "viewer-zone-read": {
    "apps/admin/src/checkin/AttendeeCard.tsx": { count: 1, reason: `${LIVE_CHECK_IN} Here it is the "Today HH:MM" next to a pinned note.` },
    "apps/admin/src/checkin/CheckInCameraResultPanel.tsx": { count: 1, reason: `${LIVE_CHECK_IN} Here it is "Entered HH:MM" on the scan result.` },
    "apps/admin/src/checkin/CkRecentScans.tsx": { count: 1, reason: `${LIVE_CHECK_IN} Here it is the Recent scans feed.` },
    "apps/admin/src/components/EventCard.tsx": {
      count: 1,
      reason: "Picks Fahrenheit or Celsius from the region of the viewer's zone. No time is shown.",
    },
    "apps/admin/src/events/CreateEventModal.tsx": { count: 1, reason: NEW_EVENT_DEFAULT },
    "apps/admin/src/pages/EventOverviewPage.tsx": {
      count: 2,
      reason:
        "One read stamps the zone of the browser that has just scanned on a live check-in row (the viewer is the actor). The other gives the Recent activity feed its \"Today\" and its day headings from the reader's own clock.",
    },
    "apps/admin/src/pages/wizard/WizardStep4Event.tsx": { count: 1, reason: NEW_EVENT_DEFAULT },
    "apps/admin/src/settings/AuditLogPanel.tsx": {
      count: 1,
      reason: "The text of the \"Your local time\" line under the UTC time of an Audit log or Security log row.",
    },
    "apps/admin/src/settings/HealthCheckPanel.tsx": {
      count: 1,
      reason: `${JUST_RAN_BY_VIEWER} Here it is a health snapshot, with its Generated time.`,
    },
    "apps/admin/src/settings/mailTransportFormParts.tsx": {
      count: 1,
      reason: `${JUST_RAN_BY_VIEWER} Here it is the test mail, with its Sent at time.`,
    },
  },
  "viewer-local-time": {
    "apps/admin/src/components/ActorOrViewerLocalTimeLine.tsx": { count: 1, reason: SECONDARY_LINE },
    "apps/admin/src/pages/users/RoleAssignmentsTab.tsx": { count: 2, reason: SECONDARY_LINE },
  },
};

/** The findings a rule may have: none, except for the ones listed above (per file, with their count). */
function tolerated(rule: Rule): Counts {
  return Object.fromEntries(Object.entries(EXCEPTIONS[rule]).map(([file, { count }]) => [file, count]));
}

describe("time zone drift (apps/admin/src)", () => {
  const found = scanTimeZoneViolations();

  it.each(RULES)("%s: no read beyond the documented exceptions", (rule) => {
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

describe("the reads that are tolerated", () => {
  const listed = Object.entries(EXCEPTIONS).flatMap(([rule, files]) =>
    Object.entries(files).map(([file, entry]) => [`${rule}: ${file}`, entry] as const),
  );

  it.each(listed)("%s names a reason a reviewer can check", (_name, { count, reason }) => {
    expect(count).toBeGreaterThan(0);
    expect(reason.length).toBeGreaterThanOrEqual(30);
  });
});
