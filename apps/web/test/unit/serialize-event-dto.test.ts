import { afterEach, describe, expect, it } from "vitest";
import { eventListMapPreviewPath, serializeEventDto } from "../../src/admin/admin-api-routes.js";

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

afterEach(() => {
  delete process.env["LOCATION_MAPS_ENABLED"];
  delete process.env["MAP_TILE_ATTRIBUTION"];
});

describe("serializeEventDto — has_coordinates / map_preview_path", () => {
  it("passes through has_coordinates when true", () => {
    const dto = serializeEventDto({ ...baseRow, has_coordinates: true }, 3);
    expect(dto.has_coordinates).toBe(true);
    expect(dto.attendee_count).toBe(3);
  });

  it("defaults has_coordinates to false when omitted", () => {
    const dto = serializeEventDto(baseRow);
    expect(dto.has_coordinates).toBe(false);
    expect(dto.map_preview_path).toBeNull();
  });

  it("builds a cache-busting list preview path when maps are enabled and a pin exists", () => {
    process.env["LOCATION_MAPS_ENABLED"] = "true";
    const dto = serializeEventDto({
      ...baseRow,
      has_coordinates: true,
      map_latitude: 52.23,
      map_longitude: 21.01,
      map_zoom: 15,
    });
    expect(dto.map_preview_path).toBe(
      "/m/evt-1.png?v=9_52.230000_21.010000_z15&context=list",
    );
    expect(dto.map_attribution).toMatch(/OpenStreetMap/);
  });

  it("omits map_preview_path when LOCATION_MAPS_ENABLED=false despite a pin", () => {
    process.env["LOCATION_MAPS_ENABLED"] = "false";
    const dto = serializeEventDto({
      ...baseRow,
      has_coordinates: true,
      map_latitude: 52.23,
      map_longitude: 21.01,
      map_zoom: 15,
    });
    expect(dto.has_coordinates).toBe(true);
    expect(dto.map_preview_path).toBeNull();
    expect(dto.map_attribution).toBeNull();
  });

  it("uses MAP_TILE_ATTRIBUTION plain text on list cards when maps are enabled", () => {
    process.env["LOCATION_MAPS_ENABLED"] = "true";
    process.env["MAP_TILE_ATTRIBUTION"] =
      '&copy; <a href="https://carto.com/attributions">CARTO</a> &copy; OpenStreetMap';
    const dto = serializeEventDto({
      ...baseRow,
      has_coordinates: true,
      map_latitude: 52.23,
      map_longitude: 21.01,
      map_zoom: 15,
    });
    expect(dto.map_attribution).toBe("© CARTO © OpenStreetMap");
  });
});

describe("eventListMapPreviewPath", () => {
  it("returns null without coordinates", () => {
    expect(eventListMapPreviewPath({ id: "evt-1" })).toBeNull();
  });

  it("includes pin and zoom in the cache buster with context=list", () => {
    expect(
      eventListMapPreviewPath({
        id: "evt-1",
        map_latitude: 50.06,
        map_longitude: 19.94,
        map_zoom: 14,
      }),
    ).toBe("/m/evt-1.png?v=9_50.060000_19.940000_z14&context=list");
  });
});
