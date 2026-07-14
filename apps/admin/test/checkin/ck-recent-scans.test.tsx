// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CheckInHistoryEntry, TicketTypeDto } from "../../src/api/types.js";
import { CkRecentScans } from "../../src/checkin/CkRecentScans.js";
import {
  CK_RECENT_SCANS_SIDEBAR_LIMIT,
  ScanHistoryList,
} from "../../src/checkin/ScanHistoryList.js";
import { setPreferredLocale } from "../../src/utils/locale-store.js";

afterEach(() => {
  cleanup();
  setPreferredLocale(null);
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

function makeTicketType(key: string, label: string): TicketTypeDto {
  return {
    id: `tt-${key}`,
    key,
    label,
    color: "purple",
    sort_order: 0,
    attendee_count: 0,
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

describe("CkRecentScans", () => {
  it("caps sidebar rows at CK_RECENT_SCANS_SIDEBAR_LIMIT via ScanHistoryList", () => {
    const history = Array.from({ length: 12 }, (_, i) => makeEntry(String(i), `Guest ${i}`));
    const { container } = render(
      <ScanHistoryList
        admittedCount={0}
        totalCount={12}
        history={history}
        eventTimezone="UTC"
      />,
    );

    expect(container.querySelectorAll(".ck-recent__row")).toHaveLength(CK_RECENT_SCANS_SIDEBAR_LIMIT);
    expect(CK_RECENT_SCANS_SIDEBAR_LIMIT).toBe(8);
  });

  it("renders revoked scans with a distinct grey dot class", () => {
    const { container } = render(
      <CkRecentScans
        history={[makeEntry("1", "Revoked guest", "revoked")]}
        eventTimezone="UTC"
        limit={8}
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
        ]}
        eventTimezone="UTC"
        limit={8}
      />,
    );

    expect(screen.getByText("Revoked")).toBeTruthy();
    expect(screen.getByText("Undone")).toBeTruthy();
    // Distinct dot color too — admin revoke reads as "revoked" (same as a
    // revoked ticket), operator self-undo stays its own neutral color.
    expect(container.querySelectorAll(".rec-dot--revoked")).toHaveLength(1);
    expect(container.querySelectorAll(".rec-dot--undo")).toHaveLength(1);
  });

  it("formats checked_in_at in event timezone", () => {
    setPreferredLocale("en-GB");
    render(
      <CkRecentScans
        history={[makeEntry("1", "Guest One")]}
        eventTimezone="Europe/Warsaw"
        limit={8}
      />,
    );
    expect(screen.getByText(/14:00/)).toBeTruthy();
  });

  it("makes each row a button that reopens the attendee when onSelectAttendee is set", () => {
    const onSelectAttendee = vi.fn();
    render(
      <CkRecentScans
        history={[makeEntry("1", "Guest One")]}
        eventTimezone="UTC"
        limit={8}
        onSelectAttendee={onSelectAttendee}
      />,
    );
    screen.getByRole("button", { name: "Guest One" }).click();
    expect(onSelectAttendee).toHaveBeenCalledWith("att-1");
  });

  it("renders plain, non-interactive rows when no onSelectAttendee is given", () => {
    const { container } = render(
      <CkRecentScans history={[makeEntry("1", "Guest One")]} eventTimezone="UTC" limit={8} />,
    );
    expect(container.querySelector(".ck-recent__info-btn")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
    expect(screen.getByText("Guest One")).toBeTruthy();
  });

  it("resolves a row's raw ticket_type key to the catalog's current label instead of the key (batch 04 / #351)", () => {
    render(
      <CkRecentScans
        history={[makeEntry("1", "Guest One", "admitted", null, "vip")]}
        eventTimezone="UTC"
        limit={8}
        ticketTypes={[makeTicketType("vip", "VIP Guest")]}
      />,
    );
    expect(screen.getByText("VIP Guest")).toBeTruthy();
    expect(screen.queryByText("vip")).toBeNull();
  });

  it("still shows an orphaned/unmatched ticket_type key rather than hiding it (fail-open)", () => {
    render(
      <CkRecentScans
        history={[makeEntry("1", "Guest One", "admitted", null, "staff_2")]}
        eventTimezone="UTC"
        limit={8}
        ticketTypes={[makeTicketType("vip", "VIP Guest")]}
      />,
    );
    expect(screen.getByText("staff_2")).toBeTruthy();
  });
});
