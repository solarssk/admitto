// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CheckInHistoryEntry } from "../../src/api/types.js";
import { setPreferredLocale } from "../../src/utils/locale-store.js";
import { makeTicketType } from "../test-utils.js";

/** Stable stub for the "formats in the viewer's timezone" assertion - Intl.resolvedOptions
 * spies are flaky under CI TZ=UTC (same pattern as MailTransportPanel.test.tsx). */
const { getBrowserTimeZoneMock } = vi.hoisted(() => ({
  getBrowserTimeZoneMock: vi.fn((): string => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"),
}));

vi.mock("../../src/utils/event-dates.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/utils/event-dates.js")>();
  return { ...actual, getBrowserTimeZone: getBrowserTimeZoneMock };
});

import { CkRecentScans } from "../../src/checkin/CkRecentScans.js";
import {
  CK_RECENT_SCANS_SIDEBAR_LIMIT,
  ScanHistoryList,
} from "../../src/checkin/ScanHistoryList.js";

afterEach(() => {
  cleanup();
  setPreferredLocale(null);
  getBrowserTimeZoneMock.mockReset();
  getBrowserTimeZoneMock.mockImplementation(
    (): string => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  );
});

function makeEntry(
  id: string,
  name: string,
  status = "admitted",
  source: string | null = null,
  ticket_type: string | null = null,
): CheckInHistoryEntry {
  return {
    id,
    event_id: "evt-1",
    attendee_id: `att-${id}`,
    status,
    checked_in_at: "2026-06-24T12:00:00.000Z",
    checked_in_by: null,
    device_id: null,
    source,
    attendee: { name, ticket_type },
  };
}


describe("CkRecentScans", () => {
  it("caps sidebar rows at CK_RECENT_SCANS_SIDEBAR_LIMIT via ScanHistoryList", () => {
    const history = Array.from({ length: 12 }, (_, i) => makeEntry(String(i), `Guest ${i}`));
    const { container } = render(
      <ScanHistoryList
        admittedCount={0}
        totalCount={12}
        history={history}      />,
    );

    expect(container.querySelectorAll(".ck-recent__row")).toHaveLength(CK_RECENT_SCANS_SIDEBAR_LIMIT);
    expect(CK_RECENT_SCANS_SIDEBAR_LIMIT).toBe(8);
  });

  it("renders revoked scans with a distinct grey dot class", () => {
    const { container } = render(
      <CkRecentScans
        history={[makeEntry("1", "Revoked guest", "revoked")]}        limit={8}
      />,
    );

    expect(screen.getByText("Ticket rev.")).toBeTruthy();
    expect(container.querySelector(".rec-dot--revoked")).toBeTruthy();
    expect(container.querySelector(".rec-dot--invalid")).toBeNull();
  });

  it("labels an admin revoke distinctly from an operator self-undo (#449 review)", () => {
    const { container } = render(
      <CkRecentScans
        history={[
          makeEntry("1", "Revoked by admin", "UNDO", "admin_revoke"),
          makeEntry("2", "Undone by operator", "UNDO", "undo"),
        ]}        limit={8}
      />,
    );

    expect(screen.getByText("Revoked")).toBeTruthy();
    expect(screen.getByText("Undone")).toBeTruthy();
    // Distinct dot color too — admin revoke reads as "revoked" (same as a
    // revoked ticket), operator self-undo stays its own neutral color.
    expect(container.querySelectorAll(".rec-dot--revoked")).toHaveLength(1);
    expect(container.querySelectorAll(".rec-dot--undo")).toHaveLength(1);
  });

  it("formats checked_in_at in the viewer's own browser timezone", () => {
    setPreferredLocale("en-GB");
    getBrowserTimeZoneMock.mockReturnValue("Europe/Warsaw");
    render(<CkRecentScans history={[makeEntry("1", "Guest One")]} limit={8} />);
    expect(screen.getByText(/14:00/)).toBeTruthy();
  });

  it("makes each row a button that reopens the attendee when onSelectAttendee is set", () => {
    const onSelectAttendee = vi.fn();
    render(
      <CkRecentScans
        history={[makeEntry("1", "Guest One")]}        limit={8}
        onSelectAttendee={onSelectAttendee}
      />,
    );
    screen.getByRole("button", { name: "Guest One" }).click();
    expect(onSelectAttendee).toHaveBeenCalledWith("att-1");
  });

  it("renders plain, non-interactive rows when no onSelectAttendee is given", () => {
    const { container } = render(
      <CkRecentScans history={[makeEntry("1", "Guest One")]} limit={8} />,
    );
    expect(container.querySelector(".ck-recent__info-btn")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
    expect(screen.getByText("Guest One")).toBeTruthy();
  });

  it("resolves a row's raw ticket_type key to the catalog's current label instead of the key (batch 04 / #351)", () => {
    render(
      <CkRecentScans
        history={[makeEntry("1", "Guest One", "admitted", null, "vip")]}        limit={8}
        ticketTypes={[makeTicketType("vip", "VIP Guest")]}
      />,
    );
    expect(screen.getByText("VIP Guest")).toBeTruthy();
    expect(screen.queryByText("vip")).toBeNull();
  });

  it("falls back to a humanized status label for statuses without a dedicated mapping", () => {
    render(
      <CkRecentScans
        history={[makeEntry("1", "Guest One", "no_match")]}        limit={8}
      />,
    );
    expect(screen.getByText("no match")).toBeTruthy();
  });

  it("still shows an orphaned/unmatched ticket_type key rather than hiding it (fail-open)", () => {
    render(
      <CkRecentScans
        history={[makeEntry("1", "Guest One", "admitted", null, "staff_2")]}        limit={8}
        ticketTypes={[makeTicketType("vip", "VIP Guest")]}
      />,
    );
    expect(screen.getByText("staff_2")).toBeTruthy();
  });
});
