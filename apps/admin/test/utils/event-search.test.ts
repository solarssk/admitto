import { describe, expect, it } from "vitest";
import { filterEventsBySearch } from "../../src/utils/event-search.js";

describe("filterEventsBySearch", () => {
  const events = [
    { title: "Smoke Test 2026", location: "Warsaw" },
    { title: "Partner Summit", location: "Kraków" },
    { title: "Internal Offsite", location: null },
  ];

  it("returns all events when query is empty", () => {
    expect(filterEventsBySearch(events, "")).toHaveLength(3);
    expect(filterEventsBySearch(events, "   ")).toHaveLength(3);
  });

  it("filters by title case-insensitively", () => {
    expect(filterEventsBySearch(events, "smoke")).toEqual([events[0]]);
  });

  it("filters by location", () => {
    expect(filterEventsBySearch(events, "krak")).toEqual([events[1]]);
  });

  it("matches without diacritics in query or location", () => {
    expect(filterEventsBySearch(events, "krakow")).toEqual([events[1]]);
    expect(filterEventsBySearch([{ title: "Café Society", location: null }], "cafe")).toHaveLength(1);
  });
});
