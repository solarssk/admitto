import { describe, expect, it, vi } from "vitest";
import { NominatimProvider, GeocodingProviderError } from "../../src/maps/nominatim-provider.js";

const USER_AGENT = "Admitto/0.0.0-test (+https://example.com; ops@example.com)";
const buildUserAgent = async () => USER_AGENT;

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

/** Builds a minimal GeocodeJSON FeatureCollection body from a flat list of feature shorthand. */
function geocodeJsonBody(features: Array<{ name?: string; label?: string; coordinates?: unknown }>) {
  return {
    type: "FeatureCollection",
    features: features.map(({ name, label, coordinates }) => ({
      type: "Feature",
      properties: { geocoding: { ...(name !== undefined ? { name } : {}), ...(label !== undefined ? { label } : {}) } },
      geometry: { type: "Point", coordinates },
    })),
  };
}

describe("NominatimProvider", () => {
  it("maps GeocodeJSON features to GeocodingResult[], swapping [lon, lat] to latitude/longitude", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse(
        geocodeJsonBody([
          { name: "Tour Eiffel", label: "Tour Eiffel, Paris, France", coordinates: [2.2945006, 48.8582599] },
          { label: "Warsaw, IN, USA", coordinates: [-87.6828, 38.6217] },
        ]),
      ),
    );
    const provider = new NominatimProvider({
      baseUrl: "https://nominatim.example.org",
      timeoutMs: 5_000,
      buildUserAgent,
      fetchFn,
    });

    const results = await provider.search("Eiffel Tower");

    expect(results).toEqual([
      {
        name: "Tour Eiffel",
        formatted_address: "Tour Eiffel, Paris, France",
        latitude: 48.8582599,
        longitude: 2.2945006,
        provider: "nominatim",
      },
      {
        formatted_address: "Warsaw, IN, USA",
        latitude: 38.6217,
        longitude: -87.6828,
        provider: "nominatim",
      },
    ]);
  });

  it("omits `name` when the feature has no localized venue/POI name", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse(geocodeJsonBody([{ label: "Some Street, Some City", coordinates: [10, 20] }])),
    );
    const provider = new NominatimProvider({
      baseUrl: "https://nominatim.example.org",
      timeoutMs: 5_000,
      buildUserAgent,
      fetchFn,
    });

    const [result] = await provider.search("Some Street");
    expect(result?.name).toBeUndefined();
  });

  it("sends the query, geocodejson format, limit, and a dynamic User-Agent", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(geocodeJsonBody([])));
    const provider = new NominatimProvider({
      baseUrl: "https://nominatim.example.org",
      timeoutMs: 5_000,
      buildUserAgent,
      fetchFn,
    });

    await provider.search("Main St");

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, requestInit] = fetchFn.mock.calls[0] as [URL, RequestInit];
    expect(url.origin).toBe("https://nominatim.example.org");
    expect(url.pathname).toBe("/search");
    expect(url.searchParams.get("q")).toBe("Main St");
    expect(url.searchParams.get("format")).toBe("geocodejson");
    expect(url.searchParams.get("limit")).toBe("5");
    expect((requestInit.headers as Record<string, string>)["User-Agent"]).toBe(USER_AGENT);
  });

  it("caps results at 5 even when the provider returns more", async () => {
    const many = Array.from({ length: 7 }, (_, i) => ({
      label: `Place ${i}`,
      coordinates: [10 + i, 50 + i],
    }));
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(geocodeJsonBody(many)));
    const provider = new NominatimProvider({
      baseUrl: "https://nominatim.example.org",
      timeoutMs: 5_000,
      buildUserAgent,
      fetchFn,
    });

    const results = await provider.search("place");
    expect(results).toHaveLength(5);
  });

  it("skips malformed entries (missing/non-numeric coordinates or label) instead of throwing", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({
        type: "FeatureCollection",
        features: [
          { type: "Feature", properties: { geocoding: { label: "Good" } }, geometry: { coordinates: [10, 20] } },
          { type: "Feature", properties: { geocoding: {} }, geometry: { coordinates: [10, 20] } },
          {
            type: "Feature",
            properties: { geocoding: { label: "Bad coords" } },
            geometry: { coordinates: ["not-a-number", 20] },
          },
          { type: "Feature", properties: {}, geometry: { coordinates: [10, 20] } },
          "not even an object",
        ],
      }),
    );
    const provider = new NominatimProvider({
      baseUrl: "https://nominatim.example.org",
      timeoutMs: 5_000,
      buildUserAgent,
      fetchFn,
    });

    const results = await provider.search("mixed");
    expect(results).toEqual([{ formatted_address: "Good", latitude: 20, longitude: 10, provider: "nominatim" }]);
  });

  it("returns an empty array when the response has no features array", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ error: "unexpected shape" }));
    const provider = new NominatimProvider({
      baseUrl: "https://nominatim.example.org",
      timeoutMs: 5_000,
      buildUserAgent,
      fetchFn,
    });

    expect(await provider.search("whatever")).toEqual([]);
  });

  it("throws a timeout-flavored GeocodingProviderError when the request aborts on timeout", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new DOMException("The operation timed out", "TimeoutError"));
    const provider = new NominatimProvider({
      baseUrl: "https://nominatim.example.org",
      timeoutMs: 5_000,
      buildUserAgent,
      fetchFn,
    });

    const err = await provider.search("slow").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GeocodingProviderError);
    expect((err as GeocodingProviderError).kind).toBe("timeout");
  });

  it("throws an unavailable-flavored GeocodingProviderError on a network error", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("network down"));
    const provider = new NominatimProvider({
      baseUrl: "https://nominatim.example.org",
      timeoutMs: 5_000,
      buildUserAgent,
      fetchFn,
    });

    const err = await provider.search("slow").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GeocodingProviderError);
    expect((err as GeocodingProviderError).kind).toBe("unavailable");
  });

  it("throws an unavailable-flavored GeocodingProviderError on a non-OK HTTP status", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("boom", { status: 503 }));
    const provider = new NominatimProvider({
      baseUrl: "https://nominatim.example.org",
      timeoutMs: 5_000,
      buildUserAgent,
      fetchFn,
    });

    const err = await provider.search("slow").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GeocodingProviderError);
    expect((err as GeocodingProviderError).kind).toBe("unavailable");
  });

  it("throws an unavailable-flavored GeocodingProviderError on malformed JSON", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("not json", { status: 200 }));
    const provider = new NominatimProvider({
      baseUrl: "https://nominatim.example.org",
      timeoutMs: 5_000,
      buildUserAgent,
      fetchFn,
    });

    const err = await provider.search("slow").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GeocodingProviderError);
    expect((err as GeocodingProviderError).kind).toBe("unavailable");
  });

  it("rejects a response advertising a body larger than the safety cap", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse(geocodeJsonBody([]), { headers: { "content-length": String(2_000_000) } }),
    );
    const provider = new NominatimProvider({
      baseUrl: "https://nominatim.example.org",
      timeoutMs: 5_000,
      buildUserAgent,
      fetchFn,
    });

    const err = await provider.search("slow").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GeocodingProviderError);
    expect((err as GeocodingProviderError).kind).toBe("unavailable");
  });
});
