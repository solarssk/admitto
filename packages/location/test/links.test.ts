import { describe, expect, it } from "vitest";
import { buildAppleMapsUrl, buildGoogleMapsUrl, buildOsmUrl } from "../src/links.js";

const LAT = 50.061947;
const LNG = 19.936856;

describe("buildGoogleMapsUrl", () => {
  it("builds a query-based deep link with fixed precision", () => {
    expect(buildGoogleMapsUrl(LAT, LNG)).toBe(
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
