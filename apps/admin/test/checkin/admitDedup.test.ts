import { describe, expect, it } from "vitest";
import { mergeCheckInHistory } from "../../src/checkin/admitDedup.js";

describe("mergeCheckInHistory", () => {
  it("keeps live rows missing from a stale fetched snapshot", () => {
    const live = [
      {
        id: "sse-1",
        attendee_id: "att-live",
        checked_in_at: "2026-06-01T10:00:00.000Z",
      },
    ];
    const fetched = [
      {
        id: "hist-1",
        attendee_id: "att-old",
        checked_in_at: "2026-06-01T09:00:00.000Z",
      },
    ];

    const merged = mergeCheckInHistory(fetched, live, 8);
    expect(merged.map((row) => row.attendee_id)).toEqual(["att-live", "att-old"]);
  });

  it("prefers live copy when the same admit exists in both snapshots", () => {
    const live = [
      {
        id: "local-1",
        attendee_id: "att-1",
        checked_in_at: "2026-06-01T10:00:00.000Z",
      },
    ];
    const fetched = [
      {
        id: "hist-1",
        attendee_id: "att-1",
        checked_in_at: "2026-06-01T10:00:00.000Z",
      },
    ];

    const merged = mergeCheckInHistory(fetched, live, 8);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe("local-1");
  });
});
