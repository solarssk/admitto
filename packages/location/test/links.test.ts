import { describe, expect, it } from "vitest";
import {
  buildAppleMapsUrl,
  buildEventStaticMapPath,
  buildEventStaticMapUrl,
  buildGoogleMapsUrl,
  buildOsmUrl,
} from "../src/links.js";

const LAT = 50.061947;
const LNG = 19.936856;

describe("buildGoogleMapsUrl", () => {
  it("builds a query-based deep link with fixed precision", () => {
    expect(buildGoogleMapsUrl(LAT, LNG)).toBe(
      "https://www.google.com/maps/search/?api=1&query=50.061947%2C19.936856",
    );
  });

  it("prefixes a trimmed label before @lat,lng when provided", () => {
    const url = buildGoogleMapsUrl(LAT, LNG, "  ICE Kraków  ");
    expect(url).toBe(
      "https://www.google.com/maps/search/?api=1&query=ICE%20Krak%C3%B3w%4050.061947%2C19.936856",
    );
  });

  it("omits the label when it is empty/whitespace-only", () => {
    expect(buildGoogleMapsUrl(LAT, LNG, "   ")).toBe(
      "https://www.google.com/maps/search/?api=1&query=50.061947%2C19.936856",
    );
  });
});

describe("buildAppleMapsUrl", () => {
  it("builds an ll-based link without a label", () => {
    expect(buildAppleMapsUrl(LAT, LNG)).toBe("https://maps.apple.com/?ll=50.061947%2C19.936856");
  });

  it("includes a trimmed label as the q parameter", () => {
    const url = buildAppleMapsUrl(LAT, LNG, "  ICE Kraków  ");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("q")).toBe("ICE Kraków");
    expect(parsed.searchParams.get("ll")).toBe("50.061947,19.936856");
  });

  it("omits q when label is empty/whitespace-only", () => {
    expect(buildAppleMapsUrl(LAT, LNG, "   ")).toBe(
      "https://maps.apple.com/?ll=50.061947%2C19.936856",
    );
  });
});

describe("buildOsmUrl", () => {
  it("builds a centered, zoomed deep link", () => {
    expect(buildOsmUrl(LAT, LNG, 17)).toBe(
      "https://www.openstreetmap.org/?mlat=50.061947&mlon=19.936856#map=17/50.061947/19.936856",
    );
  });
});

describe("buildEventStaticMapPath / Url", () => {
  it("builds a same-origin PNG path", () => {
    expect(buildEventStaticMapPath("evt_abc")).toBe("/m/evt_abc.png?v=5");
  });

  it("includes pin coordinates in the cache-busting query", () => {
    expect(buildEventStaticMapPath("evt_abc", { latitude: 50.06, longitude: 19.94 })).toBe(
      "/m/evt_abc.png?v=5_50.060000_19.940000",
    );
  });

  it("includes zoom in the cache-busting query when provided", () => {
    expect(
      buildEventStaticMapPath("evt_abc", { latitude: 50.06, longitude: 19.94, zoom: 16 }),
    ).toBe("/m/evt_abc.png?v=5_50.060000_19.940000_z16");
  });

  it("absolutizes against a base URL without a trailing slash", () => {
    expect(
      buildEventStaticMapUrl("https://tickets.example.com", "evt_abc", {
        latitude: 50.06,
        longitude: 19.94,
        zoom: 15,
      }),
    ).toBe("https://tickets.example.com/m/evt_abc.png?v=5_50.060000_19.940000_z15");
  });

  it("strips a trailing slash on the base URL", () => {
    expect(
      buildEventStaticMapUrl("https://tickets.example.com/", "evt_abc", {
        latitude: 50.06,
        longitude: 19.94,
      }),
    ).toBe("https://tickets.example.com/m/evt_abc.png?v=5_50.060000_19.940000");
  });
});
