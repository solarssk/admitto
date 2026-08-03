import { describe, expect, it } from "vitest";
import { serializeEventDto } from "../../src/admin/admin-api-routes.js";

const baseRow = {
  id: "evt-1",
  title: "Demo",
  slug: "demo",
  date: new Date("2026-09-01T12:00:00.000Z"),
  timezone: "Europe/Warsaw",
  location: "Hall A",
  organization_id: "org-1",
  archived_at: null,
  created_at: new Date("2026-01-01T00:00:00.000Z"),
  created_by_user_id: null,
  created_by_timezone: null,
  archived_by_user_id: null,
  archived_by_timezone: null,
};

describe("serializeEventDto — has_coordinates", () => {
  it("passes through has_coordinates when true", () => {
    const dto = serializeEventDto({ ...baseRow, has_coordinates: true }, 3);
    expect(dto.has_coordinates).toBe(true);
    expect(dto.attendee_count).toBe(3);
  });

  it("defaults has_coordinates to false when omitted", () => {
    const dto = serializeEventDto(baseRow);
    expect(dto.has_coordinates).toBe(false);
  });
});
