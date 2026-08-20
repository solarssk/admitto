// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AttendeeCardDto } from "../../src/api/types.js";

/** Stable stub for the note-timestamp assertion - Intl.resolvedOptions spies are flaky under
 * CI TZ=UTC (same pattern as MailTransportPanel.test.tsx / ck-recent-scans.test.tsx). */
const { getBrowserTimeZoneMock } = vi.hoisted(() => ({
  getBrowserTimeZoneMock: vi.fn((): string => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"),
}));

vi.mock("../../src/utils/event-dates.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/utils/event-dates.js")>();
  return { ...actual, getBrowserTimeZone: getBrowserTimeZoneMock };
});

import { AttendeeCard } from "../../src/checkin/AttendeeCard.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  getBrowserTimeZoneMock.mockReset();
  getBrowserTimeZoneMock.mockImplementation(
    (): string => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  );
});

const baseCard: AttendeeCardDto = {
  id: "att-1",
  name: "Anna Alpha",
  company: null,
  department: null,
  ticket_type: "vip",
  check_in_status: "admitted",
  admitted_at: "2026-09-01T09:44:00.000Z",
  items: [],
  notes: [],
  blocked: false,
};

describe("AttendeeCard notes — viewer timezone", () => {
  it("formats a note's timestamp in the viewer's own browser timezone, not the event's", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T10:00:00.000Z"));
    getBrowserTimeZoneMock.mockReturnValue("Asia/Kolkata");

    render(
      <AttendeeCard
        card={{
          ...baseCard,
          notes: [{ body: "Arrived early.", author_display: "Bob Operator", created_at: "2026-09-01T09:44:00.000Z" }],
        }}
        canAct={true}
      />,
    );

    expect(screen.getByText("Arrived early.")).toBeTruthy();
    // Asia/Kolkata is UTC+5:30 - 09:44 UTC reads as 03:14 PM there. A stray eventTimezone/UTC
    // read would show a different hour and offset, so this pins the render to the mocked
    // browser zone.
    expect(screen.getByText(/Today 03:14 PM UTC\+5:30/)).toBeTruthy();
  });
});
