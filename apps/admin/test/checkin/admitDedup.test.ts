import { describe, expect, it } from "vitest";
import {
  admitDedupKey,
  mergeCheckInHistory,
  pruneAdmitDedupMap,
  registerAdmitDedup,
} from "../../src/checkin/admitDedup.js";

describe("admitDedupKey", () => {
  it("does not collide when values contain hyphens", () => {
    expect(admitDedupKey("att-1", "2026")).not.toBe(admitDedupKey("att", "1-2026"));
  });
});

describe("pruneAdmitDedupMap", () => {
  it("drops entries older than the dedup TTL", () => {
    const map = new Map<string, number>([
      ["stale", 0],
      ["recent", 4000],
    ]);
    pruneAdmitDedupMap(map, 6000);
    expect(map.has("stale")).toBe(false);
    expect(map.has("recent")).toBe(true);
  });
});

describe("registerAdmitDedup", () => {
  it("prunes stale entries when recording a new admit", () => {
    const map = new Map<string, number>([["stale", 0]]);
    registerAdmitDedup(map, "att-1", "2026-06-01T10:00:00.000Z", 6000);
    expect(map.has("stale")).toBe(false);
    expect(map.size).toBe(1);
  });
});

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
