import { describe, expect, it, vi } from "vitest";
import {
  NominatimProvider,
  GeocodingProviderError,
  MAX_RESPONSE_BYTES,
  readBodyCapped,
  awaitWithAbortSignal,
} from "../../src/maps/nominatim-provider.js";

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

function makeProvider(fetchFn: typeof fetch, overrides: Partial<ConstructorParameters<typeof NominatimProvider>[0]> = {}) {
  return new NominatimProvider({
    baseUrl: "https://nominatim.example.org",
    timeoutMs: 5_000,
    buildUserAgent,
    fetchFn,
    // Unit tests assert behaviour, not Nominatim Usage Policy timing.
    minIntervalMs: 0,
    ...overrides,
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
          city: "Good Place",
          region: null,
          country: "Somewhere",
        },
      },
    ]);
  });

  it("fills sparse POI components from the Nominatim label when GeocodeJSON omits street/city", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse(
        geocodeJsonBody([
          {
            name: "Złote Tarasy",
            label: "Złote Tarasy, 59, Złota, Śródmieście, Warszawa, województwo mazowieckie, Polska",
            coordinates: [21.0028, 52.2297],
          },
        ]),
      ),
    );
    const results = await makeProvider(fetchFn).search("zlote");
    expect(results[0]?.components).toEqual({
      object_name: "Złote Tarasy",
      street: "Złota 59",
      postcode: null,
      city: "Warszawa",
      region: "województwo mazowieckie",
      country: "Polska",
    });
  });

  it("uses locality as city when city is absent", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {
              geocoding: {
                name: "Hall",
                locality: "Kraków",
                country: "Polska",
                label: "Hall, Kraków, Polska",
              },
            },
            geometry: { type: "Point", coordinates: [19.9, 50.0] },
          },
        ],
      }),
    );
    const results = await makeProvider(fetchFn).search("hall");
    expect(results[0]?.components?.city).toBe("Kraków");
    expect(results[0]?.formatted_address).toBe("Polska, Kraków - Hall");
  });

  it.each([
    ["town", "Zakopane"],
    ["village", "Chochołów"],
  ])("uses %s as city when earlier settlement fields are absent", async (field, settlement) => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {
              geocoding: { [field]: settlement, country: "Polska", label: `${settlement}, Polska` },
            },
            geometry: { type: "Point", coordinates: [19.9, 50] },
          },
        ],
      }),
    );

    const [result] = await makeProvider(fetchFn).search(settlement);
    expect(result?.components?.city).toBe(settlement);
  });

  it("accepts a bare Feature response and merges sparse label components", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({
        type: "Feature",
        properties: {
          geocoding: {
            name: "Venue",
            label: "Venue, 10, Example Street, Example City, Example Region, Poland",
          },
        },
        geometry: { type: "Point", coordinates: [21, 52] },
      }),
    );

    const results = await makeProvider(fetchFn).search("venue");
    expect(results).toHaveLength(1);
    expect(results[0]?.components).toMatchObject({
      object_name: "Venue",
      street: "Example Street 10",
      city: "Example City",
      region: "Example Region",
      country: "Poland",
    });
  });

  it("skips non-finite and missing coordinate arrays", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse(
        geocodeJsonBody([
          { label: "Infinite, Poland", coordinates: [Infinity, 52] },
          { label: "Missing, Poland" },
          { label: "Valid, Poland", coordinates: [21, 52] },
        ]),
      ),
    );

    await expect(makeProvider(fetchFn).search("coordinates")).resolves.toMatchObject([
      { formatted_address: "Valid, Poland", latitude: 52, longitude: 21 },
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

  it("maps network failures and malformed JSON responses to unavailable", async () => {
    const networkFailure = vi.fn().mockRejectedValue(new Error("connection refused"));
    await expect(makeProvider(networkFailure).search("offline")).rejects.toMatchObject({
      kind: "unavailable",
    });

    const invalidJson = vi.fn().mockResolvedValue(new Response("{", { status: 200 }));
    await expect(makeProvider(invalidJson).search("broken body")).rejects.toMatchObject({
      kind: "unavailable",
    });
  });

  it("treats a non-feature response as an empty result set", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ type: "Unexpected", data: [] }));
    await expect(makeProvider(fetchFn).search("unexpected")).resolves.toEqual([]);
  });

  it("maps User-Agent construction failures to unavailable", async () => {
    const fetchFn = vi.fn();
    const provider = makeProvider(fetchFn, {
      buildUserAgent: async () => Promise.reject(new Error("contact lookup failed")),
    });
    await expect(provider.search("unavailable")).rejects.toMatchObject({ kind: "unavailable" });
    expect(fetchFn).not.toHaveBeenCalled();
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

  it("maps unavailable reverse requests to GeocodingProviderError", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("connection refused"));
    await expect(makeProvider(fetchFn).reverse(0, 0)).rejects.toMatchObject({
      kind: "unavailable",
    });
  });
});

describe("NominatimProvider response size / timeout hardening", () => {
  it("rejects a response whose Content-Length exceeds the cap before reading the body", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response("{}", {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-length": String(MAX_RESPONSE_BYTES + 1),
        },
      }),
    );

    await expect(makeProvider(fetchFn).search("Warsaw")).rejects.toMatchObject({
      kind: "unavailable",
    });
  });

  it("rejects a malformed Content-Length header", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response("{}", {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-length": "not-a-number",
        },
      }),
    );

    await expect(makeProvider(fetchFn).search("Warsaw")).rejects.toMatchObject({
      kind: "unavailable",
    });
  });

  it("aborts while streaming once the body exceeds the byte cap (chunked / no Content-Length)", async () => {
    const oversized = new Uint8Array(MAX_RESPONSE_BYTES + 64).fill(0x61);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // Two chunks so the reader must accumulate past the cap mid-stream.
        controller.enqueue(oversized.subarray(0, MAX_RESPONSE_BYTES - 10));
        controller.enqueue(oversized.subarray(MAX_RESPONSE_BYTES - 10));
        controller.close();
      },
    });
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(makeProvider(fetchFn).search("Warsaw")).rejects.toBeInstanceOf(
      GeocodingProviderError,
    );
  });

  it("readBodyCapped throws unavailable once the stream exceeds maxBytes", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(8).fill(1));
        controller.enqueue(new Uint8Array(8).fill(2));
        controller.close();
      },
    });
    const res = new Response(stream, { status: 200 });
    await expect(readBodyCapped(res, 10)).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("rejects empty, absent, and interrupted response bodies", async () => {
    const emptyBody = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    await expect(makeProvider(emptyBody).search("empty")).rejects.toMatchObject({
      kind: "unavailable",
    });

    const interruptedStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new DOMException("The operation timed out", "TimeoutError"));
      },
    });
    await expect(readBodyCapped(new Response(interruptedStream), 10)).rejects.toMatchObject({
      kind: "timeout",
    });
  });

  it("times out when User-Agent construction exceeds the geocoding timeout", async () => {
    const fetchFn = vi.fn();
    const provider = makeProvider(fetchFn, {
      timeoutMs: 30,
      buildUserAgent: () =>
        new Promise<string>((resolve) => {
          setTimeout(() => resolve(USER_AGENT), 200);
        }),
    });

    await expect(provider.search("Warsaw")).rejects.toMatchObject({ kind: "timeout" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("times out immediately when the shared deadline is already aborted", async () => {
    const fetchFn = vi.fn();
    const provider = makeProvider(fetchFn, {
      timeoutMs: 0,
      buildUserAgent: () =>
        new Promise<string>((resolve) => {
          setTimeout(() => resolve(USER_AGENT), 50);
        }),
    });

    await expect(provider.search("Warsaw")).rejects.toMatchObject({ kind: "timeout" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("awaitWithAbortSignal rejects when the signal is already aborted", async () => {
    await expect(
      awaitWithAbortSignal(Promise.resolve("ok"), AbortSignal.abort()),
    ).rejects.toMatchObject({ name: "TimeoutError" });
  });

  it("serializes upstream calls with the configured min interval", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(geocodeJsonBody([])))
      .mockResolvedValueOnce(jsonResponse(geocodeJsonBody([])));

    const provider = makeProvider(fetchFn, { minIntervalMs: 40 });
    const t0 = Date.now();
    await provider.search("one");
    await provider.search("two");
    expect(Date.now() - t0).toBeGreaterThanOrEqual(35);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
