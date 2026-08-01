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

type FeatureShorthand = {
  name?: string;
  label?: string;
  housenumber?: string;
  street?: string;
  city?: string;
  country?: string;
  coordinates?: unknown;
};

/** Builds a minimal GeocodeJSON FeatureCollection body from a flat list of feature shorthand. */
function geocodeJsonBody(features: FeatureShorthand[]) {
  return {
    type: "FeatureCollection",
    features: features.map((f) => ({
      type: "Feature",
      properties: {
        geocoding: {
          ...(f.name !== undefined ? { name: f.name } : {}),
          ...(f.label !== undefined ? { label: f.label } : {}),
          ...(f.housenumber !== undefined ? { housenumber: f.housenumber } : {}),
          ...(f.street !== undefined ? { street: f.street } : {}),
          ...(f.city !== undefined ? { city: f.city } : {}),
          ...(f.country !== undefined ? { country: f.country } : {}),
        },
      },
      geometry: { type: "Point", coordinates: f.coordinates },
    })),
  };
}

function makeProvider(fetchFn: typeof fetch) {
  return new NominatimProvider({
    baseUrl: "https://nominatim.example.org",
    timeoutMs: 5_000,
    buildUserAgent,
    fetchFn,
  });
}

describe("NominatimProvider.search", () => {
  it("maps GeocodeJSON features to compact addresses and venue names", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse(
        geocodeJsonBody([
          {
            name: "Złote Tarasy",
            label: "Złote Tarasy, 59, Złota, Śródmieście, Warszawa, Polska",
            street: "Złota",
            housenumber: "59",
            city: "Warszawa",
            country: "Polska",
            coordinates: [21.0028, 52.2297],
          },
          {
            label: "62, Marywilska, Żerań, Warszawa, Polska",
            street: "Marywilska",
            housenumber: "62",
            city: "Warszawa",
            country: "Polska",
            coordinates: [21.05, 52.3],
          },
        ]),
      ),
    );
    const results = await makeProvider(fetchFn).search("Złote");

    expect(results).toEqual([
      {
        name: "Złote Tarasy",
        formatted_address: "Polska, Warszawa - Złote Tarasy",
        latitude: 52.2297,
        longitude: 21.0028,
        provider: "nominatim",
        components: {
          object_name: "Złote Tarasy",
          street: "Złota 59",
          postcode: null,
          city: "Warszawa",
          region: null,
          country: "Polska",
        },
      },
      {
        name: "Marywilska 62",
        formatted_address: "Polska, Warszawa - Marywilska 62",
        latitude: 52.3,
        longitude: 21.05,
        provider: "nominatim",
        components: {
          object_name: null,
          street: "Marywilska 62",
          postcode: null,
          city: "Warszawa",
          region: null,
          country: "Polska",
        },
      },
    ]);
  });

  it("sends addressdetails=1 with geocodejson format", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(geocodeJsonBody([])));
    await makeProvider(fetchFn).search("Main St");

    const [url, requestInit] = fetchFn.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe("/search");
    expect(url.searchParams.get("format")).toBe("geocodejson");
    expect(url.searchParams.get("addressdetails")).toBe("1");
    expect(url.searchParams.get("limit")).toBe("5");
    expect((requestInit.headers as Record<string, string>)["User-Agent"]).toBe(USER_AGENT);
  });

  it("caps results at 5 even when the provider returns more", async () => {
    const many = Array.from({ length: 7 }, (_, i) => ({
      label: `Place ${i}, City`,
      coordinates: [10 + i, 50 + i],
    }));
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(geocodeJsonBody(many)));
    expect(await makeProvider(fetchFn).search("place")).toHaveLength(5);
  });

  it("skips malformed entries instead of throwing", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { geocoding: { label: "Good Place, Somewhere" } },
            geometry: { coordinates: [10, 20] },
          },
          { type: "Feature", properties: { geocoding: {} }, geometry: { coordinates: [10, 20] } },
          {
            type: "Feature",
            properties: { geocoding: { label: "Bad coords" } },
            geometry: { coordinates: ["not-a-number", 20] },
          },
        ],
      }),
    );
    const results = await makeProvider(fetchFn).search("mixed");
    expect(results).toEqual([
      {
        formatted_address: "Good Place, Somewhere",
        latitude: 20,
        longitude: 10,
        provider: "nominatim",
        components: {
          object_name: null,
          street: null,
          postcode: null,
          city: null,
          region: null,
          country: null,
        },
      },
    ]);
  });

  it("throws a timeout-flavored GeocodingProviderError when the request aborts on timeout", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new DOMException("The operation timed out", "TimeoutError"));
    const err = await makeProvider(fetchFn).search("slow").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GeocodingProviderError);
    expect((err as GeocodingProviderError).kind).toBe("timeout");
  });

  it("throws unavailable on non-OK HTTP status", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("boom", { status: 503 }));
    const err = await makeProvider(fetchFn).search("slow").catch((e: unknown) => e);
    expect((err as GeocodingProviderError).kind).toBe("unavailable");
  });
});

describe("NominatimProvider.reverse", () => {
  it("returns a compact address and keeps the requested coordinates", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse(
        geocodeJsonBody([
          {
            name: "Złote Tarasy",
            street: "Złota",
            housenumber: "59",
            city: "Warszawa",
            country: "Polska",
            label: "Złote Tarasy, 59, Złota, Warszawa, Polska",
            // Centroid deliberately different from the clicked pin.
            coordinates: [21.0, 52.0],
          },
        ]),
      ),
    );

    const result = await makeProvider(fetchFn).reverse(52.2297, 21.0028);

    expect(result).toEqual({
      name: "Złote Tarasy",
      formatted_address: "Polska, Warszawa - Złote Tarasy",
      latitude: 52.2297,
      longitude: 21.0028,
      provider: "nominatim",
      components: {
        object_name: "Złote Tarasy",
        street: "Złota 59",
        postcode: null,
        city: "Warszawa",
        region: null,
        country: "Polska",
      },
    });

    const [url] = fetchFn.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe("/reverse");
    expect(url.searchParams.get("lat")).toBe("52.2297");
    expect(url.searchParams.get("lon")).toBe("21.0028");
    expect(url.searchParams.get("zoom")).toBe("18");
    expect(url.searchParams.get("addressdetails")).toBe("1");
  });

  it("returns null when Nominatim has no coverage", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(geocodeJsonBody([])));
    expect(await makeProvider(fetchFn).reverse(0, 0)).toBeNull();
  });
});
