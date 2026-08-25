// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CheckInScanResponse } from "../../src/api/types.js";

/** Stable stub for the "Entered ..." assertions - Intl.resolvedOptions spies are flaky under
 * CI TZ=UTC (same pattern as AttendeeCard.notes-timezone.test.tsx). */
const { getBrowserTimeZoneMock } = vi.hoisted(() => ({
  getBrowserTimeZoneMock: vi.fn((): string => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"),
}));

vi.mock("../../src/utils/event-dates.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/utils/event-dates.js")>();
  return { ...actual, getBrowserTimeZone: getBrowserTimeZoneMock };
});

const { CheckInCameraResultPanel } = await import("../../src/checkin/CheckInCameraResultPanel.js");

const validScan: CheckInScanResponse = { status: "VALID", confirmed: true };

afterEach(() => {
  cleanup();
  getBrowserTimeZoneMock.mockReset();
  getBrowserTimeZoneMock.mockImplementation(
    (): string => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  );
});

describe("CheckInCameraResultPanel", () => {
  it("appends the given className to the result element's class list", () => {
    const { container } = render(
      <CheckInCameraResultPanel
        scanResult={validScan}
        card={null}
        pending={false}
        canAct={false}
        eventTimezone="UTC"
        onReset={vi.fn()}
        className="extra-class"
      />,
    );

    expect(container.querySelector(".ck-overlay__result.extra-class")).toBeTruthy();
  });

  it("omits the trailing space when no className is given", () => {
    const { container } = render(
      <CheckInCameraResultPanel
        scanResult={validScan}
        card={null}
        pending={false}
        canAct={false}
        eventTimezone="UTC"
        onReset={vi.fn()}
      />,
    );

    const result = container.querySelector(".ck-overlay__result");
    expect(result?.className.endsWith(" ")).toBe(false);
  });

  it("shows an already-checked-in attendee's entry time in the viewer's own browser timezone, not the event's", () => {
    getBrowserTimeZoneMock.mockReturnValue("Asia/Kolkata");

    render(
      <CheckInCameraResultPanel
        scanResult={{ status: "ALREADY_CHECKED_IN", confirmed: true, admittedAt: "2026-09-01T09:44:00.000Z" }}
        card={null}
        pending={false}
        canAct={false}
        // A mismatched eventTimezone proves the subtitle no longer reads this prop at all.
        eventTimezone="UTC"
        onReset={vi.fn()}
      />,
    );

    // Asia/Kolkata is UTC+5:30 - 09:44 UTC reads as 03:14 PM there, not the "UTC"/09:44 the
    // eventTimezone prop above would produce if it were still being used.
    expect(screen.getByText(/Entered .*03:14 PM UTC\+5:30/)).toBeTruthy();
  });

  it("falls back to the generic subtitle when admittedAt is missing", () => {
    render(
      <CheckInCameraResultPanel
        scanResult={{ status: "ALREADY_CHECKED_IN", confirmed: true }}
        card={null}
        pending={false}
        canAct={false}
        eventTimezone="UTC"
        onReset={vi.fn()}
      />,
    );

    expect(screen.getAllByText("Already checked in").length).toBeGreaterThan(0);
  });
});
