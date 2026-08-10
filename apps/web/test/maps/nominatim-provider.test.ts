import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lookup } from "node:dns/promises";
import { fetch as undiciFetch } from "undici";
import {
  NominatimProvider,
  GeocodingProviderError,
  MAX_RESPONSE_BYTES,
  readBodyCapped,
  awaitWithAbortSignal,
} from "../../src/maps/nominatim-provider.js";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(),
}));

vi.mock("undici", () => {
  function MockAgent(this: { close: () => Promise<void> }) {
    this.close = vi.fn().mockResolvedValue(undefined);
  }
  return {
    Agent: vi.fn(MockAgent),
    fetch: vi.fn(),
  };
});

const mockedLookup = vi.mocked(lookup);
const mockedUndiciFetch = vi.mocked(undiciFetch);

const USER_AGENT = "Admitto/0.0.0-test (+https://example.com; ops@example.com)";
const buildUserAgent = async () => USER_AGENT;

beforeEach(() => {
  mockedLookup.mockClear();
  mockedUndiciFetch.mockClear();
  mockedLookup.mockResolvedValue([{ address: "1.2.3.4", family: 4 }] as unknown as Awaited<ReturnType<typeof lookup>>);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

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

    expect(fetchFn).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({ redirect: "error" }),
    );
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
    expect(url.searchParams.get("accept-language")).toBe("en");
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

  it("keeps GeocodeJSON components when the feature has no label", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {
              geocoding: {
                name: "Hall",
                street: "Main",
                housenumber: "1",
                city: "Warsaw",
                country: "Poland",
              },
            },
            geometry: { type: "Point", coordinates: [21.01, 52.23] },
          },
        ],
      }),
    );
    const results = await makeProvider(fetchFn).search("hall");
    expect(results[0]?.components).toEqual({
      object_name: "Hall",
      street: "Main 1",
      postcode: null,
      city: "Warsaw",
      region: null,
      country: "Poland",
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
    // JSON.stringify turns Infinity into null (caught by typeof !== "number"). Build a raw
    // body with 1e999 so JSON.parse yields real Infinity and hits Number.isFinite.
    const body = `{
      "type":"FeatureCollection",
      "features":[
        {"type":"Feature","properties":{"geocoding":{"label":"Huge longitude, Poland"}},"geometry":{"type":"Point","coordinates":[1e999,52]}},
        {"type":"Feature","properties":{"geocoding":{"label":"Huge latitude, Poland"}},"geometry":{"type":"Point","coordinates":[21,1e999]}},
        {"type":"Feature","properties":{"geocoding":{"label":"Missing, Poland"}},"geometry":{"type":"Point"}},
        {"type":"Feature","properties":{"geocoding":{"label":"Valid, Poland"}},"geometry":{"type":"Point","coordinates":[21,52]}}
      ]
    }`;
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(body, { status: 200, headers: { "content-type": "application/json" } }),
    );

    await expect(makeProvider(fetchFn).search("coordinates")).resolves.toMatchObject([
      { formatted_address: "Valid, Poland", latitude: 52, longitude: 21 },
    ]);
  });

  it("skips null and non-object features in a FeatureCollection", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({
        type: "FeatureCollection",
        features: [null, "nope", { type: "Feature", properties: { geocoding: { label: "Ok" } }, geometry: { type: "Point", coordinates: [21, 52] } }],
      }),
    );
    await expect(makeProvider(fetchFn).search("mixed")).resolves.toMatchObject([
      { formatted_address: expect.any(String), latitude: 52, longitude: 21 },
    ]);
  });

  it("maps a TimeoutError raised while parsing JSON to timeout", async () => {
    const parseSpy = vi.spyOn(JSON, "parse").mockImplementationOnce(() => {
      throw new DOMException("The operation timed out", "TimeoutError");
    });
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(geocodeJsonBody([])));
    await expect(makeProvider(fetchFn).search("parse-timeout")).rejects.toMatchObject({ kind: "timeout" });
    parseSpy.mockRestore();
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

  it("treats a null response body as an empty result set", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(null));
    await expect(makeProvider(fetchFn).search("unexpected")).resolves.toEqual([]);
  });

  it("re-resolves the host and pins the connection when no fetch function is injected", async () => {
    mockedUndiciFetch.mockResolvedValue(
      jsonResponse(geocodeJsonBody([])) as unknown as Awaited<ReturnType<typeof undiciFetch>>,
    );
    const globalFetch = vi.fn();
    vi.stubGlobal("fetch", globalFetch);
    const provider = new NominatimProvider({
      baseUrl: "https://nominatim.example.org",
      timeoutMs: 5_000,
      buildUserAgent,
    });

    await expect(provider.search("Warsaw")).resolves.toEqual([]);
    expect(mockedLookup).toHaveBeenCalledTimes(1);
    expect(mockedUndiciFetch).toHaveBeenCalledOnce();
    expect(globalFetch).not.toHaveBeenCalled();
  });

  it("maps a blocked/rebound geocoding host to unavailable", async () => {
    mockedLookup.mockResolvedValue([{ address: "169.254.169.254", family: 4 }] as unknown as Awaited<ReturnType<typeof lookup>>);
    const provider = new NominatimProvider({
      baseUrl: "https://nominatim.example.org",
      timeoutMs: 5_000,
      buildUserAgent,
    });

    await expect(provider.search("Warsaw")).rejects.toMatchObject({ kind: "unavailable" });
    expect(mockedUndiciFetch).not.toHaveBeenCalled();
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
    expect(url.searchParams.get("accept-language")).toBe("en");
  });

  it("returns null when Nominatim has no coverage", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(geocodeJsonBody([])));
    expect(await makeProvider(fetchFn).reverse(0, 0)).toBeNull();
  });

  it("re-resolves the host and pins the connection for reverse when no fetch function is injected", async () => {
    mockedUndiciFetch.mockResolvedValue(
      jsonResponse(geocodeJsonBody([])) as unknown as Awaited<ReturnType<typeof undiciFetch>>,
    );
    const globalFetch = vi.fn();
    vi.stubGlobal("fetch", globalFetch);
    const provider = new NominatimProvider({
      baseUrl: "https://nominatim.example.org",
      timeoutMs: 5_000,
      buildUserAgent,
      minIntervalMs: 0,
    });

    await expect(provider.reverse(0, 0)).resolves.toBeNull();
    expect(mockedLookup).toHaveBeenCalledTimes(1);
    expect(mockedUndiciFetch).toHaveBeenCalledOnce();
    expect(globalFetch).not.toHaveBeenCalled();
  });

  it("returns null when reverse only contains malformed features", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse(geocodeJsonBody([{ label: "Bad coordinates", coordinates: [] }])),
    );
    expect(await makeProvider(fetchFn).reverse(0, 0)).toBeNull();
  });

  it("accepts a bare Feature response from reverse", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({
        type: "Feature",
        properties: { geocoding: { label: "Warsaw, Poland" } },
        geometry: { type: "Point", coordinates: [21.01, 52.23] },
      }),
    );

    await expect(makeProvider(fetchFn).reverse(52.2297, 21.0122)).resolves.toMatchObject({
      formatted_address: "Warsaw, Poland",
      latitude: 52.2297,
      longitude: 21.0122,
    });
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

  it("rejects a negative Content-Length header", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json", "content-length": "-1" },
      }),
    );

    await expect(makeProvider(fetchFn).search("Warsaw")).rejects.toMatchObject({
      kind: "unavailable",
    });
  });

  it("accepts a valid zero Content-Length header", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json", "content-length": "0" },
      }),
    );

    await expect(makeProvider(fetchFn).search("Warsaw")).resolves.toEqual([]);
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

  it("readBodyCapped skips empty chunks", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array());
        controller.enqueue(new TextEncoder().encode("ok"));
        controller.close();
      },
    });

    await expect(readBodyCapped(new Response(stream), 10)).resolves.toEqual(
      new TextEncoder().encode("ok"),
    );
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

  it("maps a non-timeout stream interruption to unavailable", async () => {
    const interruptedStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("stream interrupted"));
      },
    });

    await expect(readBodyCapped(new Response(interruptedStream), 10)).rejects.toMatchObject({
      kind: "unavailable",
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

  it("awaitWithAbortSignal rejects when aborted after its listener is attached", async () => {
    const controller = new AbortController();
    const pending = awaitWithAbortSignal(new Promise<string>(() => {}), controller.signal);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
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

  it("queues parallel searches so only one upstream request runs at a time", async () => {
    let resolveFirst!: (response: Response) => void;
    const firstResponse = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    const fetchFn = vi
      .fn()
      .mockReturnValueOnce(firstResponse)
      .mockResolvedValueOnce(jsonResponse(geocodeJsonBody([])));
    const provider = makeProvider(fetchFn, { minIntervalMs: 0 });

    const first = provider.search("one");
    const second = provider.search("two");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchFn).toHaveBeenCalledTimes(1);

    resolveFirst(jsonResponse(geocodeJsonBody([])));
    await Promise.all([first, second]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
