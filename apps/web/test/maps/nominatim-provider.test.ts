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

describe("NominatimProvider", () => {
  it("maps Nominatim jsonv2 results to GeocodingResult[]", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse([
        { display_name: "Warsaw, Poland", lat: "52.2296756", lon: "21.0122287" },
        { display_name: "Warsaw, IN, USA", lat: "38.6217", lon: "-87.6828" },
      ]),
    );
    const provider = new NominatimProvider({
      baseUrl: "https://nominatim.example.org",
      timeoutMs: 5_000,
      buildUserAgent,
      fetchFn,
    });

    const results = await provider.search("Warsaw");

    expect(results).toEqual([
      { formatted_address: "Warsaw, Poland", latitude: 52.2296756, longitude: 21.0122287, provider: "nominatim" },
      { formatted_address: "Warsaw, IN, USA", latitude: 38.6217, longitude: -87.6828, provider: "nominatim" },
    ]);
  });

  it("sends the query, format, limit, and a dynamic User-Agent", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse([]));
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
    expect(url.searchParams.get("format")).toBe("jsonv2");
    expect(url.searchParams.get("limit")).toBe("5");
    expect((requestInit.headers as Record<string, string>)["User-Agent"]).toBe(USER_AGENT);
  });

  it("caps results at 5 even when the provider returns more", async () => {
    const many = Array.from({ length: 7 }, (_, i) => ({
      display_name: `Place ${i}`,
      lat: String(50 + i),
      lon: String(10 + i),
    }));
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(many));
    const provider = new NominatimProvider({
      baseUrl: "https://nominatim.example.org",
      timeoutMs: 5_000,
      buildUserAgent,
      fetchFn,
    });

    const results = await provider.search("place");
    expect(results).toHaveLength(5);
  });

  it("skips malformed entries (missing/non-numeric lat or lon) instead of throwing", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse([
        { display_name: "Good", lat: "10", lon: "20" },
        { display_name: "Missing lat", lon: "20" },
        { display_name: "Bad lat", lat: "not-a-number", lon: "20" },
        { lat: "10", lon: "20" },
        "not even an object",
      ]),
    );
    const provider = new NominatimProvider({
      baseUrl: "https://nominatim.example.org",
      timeoutMs: 5_000,
      buildUserAgent,
      fetchFn,
    });

    const results = await provider.search("mixed");
    expect(results).toEqual([{ formatted_address: "Good", latitude: 10, longitude: 20, provider: "nominatim" }]);
  });

  it("returns an empty array when the response body is not an array", async () => {
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
      jsonResponse([], { headers: { "content-length": String(2_000_000) } }),
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
