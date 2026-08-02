// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchEventLocation,
  fetchMapTileConfig,
  fetchTimezoneForCoordinates,
  reverseGeocoding,
  saveEventLocation,
  searchGeocoding,
} from "../../src/api/client.js";

describe("location / geocoding client helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetchEventLocation GETs the event location endpoint", async () => {
    const body = {
      venue_name: "Hall",
      formatted_address: null,
      latitude: null,
      longitude: null,
      map_zoom: 15,
      directions_text: null,
      accessibility_text: null,
      geocoding_provider: null,
      geocoded_at: null,
      address_components: null,
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchEventLocation("evt-1")).resolves.toEqual(body);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt-1/location",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("saveEventLocation PUTs the patch body", async () => {
    const body = {
      venue_name: "Hall",
      formatted_address: null,
      latitude: 1,
      longitude: 2,
      map_zoom: 15,
      directions_text: null,
      accessibility_text: null,
      geocoding_provider: "nominatim",
      geocoded_at: "2026-01-01T00:00:00.000Z",
      address_components: null,
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
    vi.stubGlobal("fetch", fetchMock);

    await expect(saveEventLocation("evt-1", { venue_name: "Hall" })).resolves.toEqual(body);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/admin/events/evt-1/location");
    expect(init).toMatchObject({ method: "PUT", body: JSON.stringify({ venue_name: "Hall" }) });
  });

  it("searchGeocoding POSTs the query", async () => {
    const body = { results: [], contact_configured: true };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchGeocoding("Warsaw")).resolves.toEqual(body);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/admin/geocoding/search");
    expect(init).toMatchObject({ method: "POST", body: JSON.stringify({ query: "Warsaw" }) });
  });

  it("reverseGeocoding POSTs coordinates", async () => {
    const body = { result: null, contact_configured: false };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
    vi.stubGlobal("fetch", fetchMock);

    await expect(reverseGeocoding(52.2, 21.0)).resolves.toEqual(body);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/admin/geocoding/reverse");
    expect(init).toMatchObject({
      method: "POST",
      body: JSON.stringify({ latitude: 52.2, longitude: 21.0 }),
    });
  });

  it("fetchTimezoneForCoordinates POSTs coordinates with an optional signal", async () => {
    const body = { timezone: "Europe/Warsaw" };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
    vi.stubGlobal("fetch", fetchMock);
    const signal = AbortSignal.abort();

    await expect(fetchTimezoneForCoordinates(52.2, 21.0, signal)).resolves.toEqual(body);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/admin/geocoding/timezone");
    expect(init).toMatchObject({
      method: "POST",
      signal,
      body: JSON.stringify({ latitude: 52.2, longitude: 21.0 }),
    });
  });

  it("fetchMapTileConfig GETs maps config", async () => {
    const body = {
      enabled: true,
      tile_url: "https://tile.example/{z}/{x}/{y}.png",
      attribution: "© OSM",
      max_zoom: 19,
      contact_configured: true,
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchMapTileConfig()).resolves.toEqual(body);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/maps/config",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });
});
