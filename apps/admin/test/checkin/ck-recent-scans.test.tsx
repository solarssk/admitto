// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { CheckInHistoryEntry } from "../../src/api/types.js";
import { CkRecentScans } from "../../src/checkin/CkRecentScans.js";
import {
  CK_RECENT_SCANS_SIDEBAR_LIMIT,
  ScanHistoryList,
} from "../../src/checkin/ScanHistoryList.js";

afterEach(cleanup);

function makeEntry(id: string, name: string, status = "admitted"): CheckInHistoryEntry {
  return {
    id,
    event_id: "evt-1",
    attendee_id: `att-${id}`,
    status,
    checked_in_at: "2026-06-24T12:00:00.000Z",
    checked_in_by: null,
    device_id: null,
    source: null,
    attendee: { name, ticket_type: null },
  };
}

describe("CkRecentScans", () => {
  it("caps sidebar rows at CK_RECENT_SCANS_SIDEBAR_LIMIT via ScanHistoryList", () => {
    const history = Array.from({ length: 12 }, (_, i) => makeEntry(String(i), `Guest ${i}`));
    const { container } = render(
      <ScanHistoryList admittedCount={0} totalCount={12} history={history} />,
    );

    expect(container.querySelectorAll(".ck-recent__row")).toHaveLength(CK_RECENT_SCANS_SIDEBAR_LIMIT);
    expect(CK_RECENT_SCANS_SIDEBAR_LIMIT).toBe(8);
  });

  it("renders revoked scans with a distinct grey dot class", () => {
    const { container } = render(
      <CkRecentScans history={[makeEntry("1", "Revoked guest", "revoked")]} limit={8} />,
    );

    expect(screen.getByText("Ticket rev.")).toBeTruthy();
    expect(container.querySelector(".rec-dot--revoked")).toBeTruthy();
    expect(container.querySelector(".rec-dot--invalid")).toBeNull();
  });
});
