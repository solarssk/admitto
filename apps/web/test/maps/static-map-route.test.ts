import { describe, expect, it } from "vitest";
import {
  parseEventIdFromStaticMapFilename,
  staticMapCacheControl,
  staticMapFailureStatus,
} from "../../src/maps/static-map-route.js";

describe("parseEventIdFromStaticMapFilename", () => {
  it("parses a plain event id", () => {
    expect(parseEventIdFromStaticMapFilename("evt_abc.png")).toBe("evt_abc");
  });

  it("decodes a percent-encoded id", () => {
    expect(parseEventIdFromStaticMapFilename("evt%2Fnested.png")).toBe("evt/nested");
  });

  it("rejects non-png names and empty ids", () => {
    expect(parseEventIdFromStaticMapFilename("evt_abc.jpg")).toBeNull();
    expect(parseEventIdFromStaticMapFilename(".png")).toBeNull();
  });

  it("rejects malformed URI encoding", () => {
    expect(parseEventIdFromStaticMapFilename("%E0%A4%A.png")).toBeNull();
  });
});

describe("staticMapFailureStatus", () => {
  it("maps miss reasons to 404", () => {
    expect(staticMapFailureStatus("disabled")).toBe(404);
    expect(staticMapFailureStatus("not_found")).toBe(404);
    expect(staticMapFailureStatus("no_coordinates")).toBe(404);
  });
});

describe("staticMapCacheControl", () => {
  it("uses a short max-age for placeholders and a day for real maps", () => {
    expect(staticMapCacheControl(true)).toBe("public, max-age=120");
    expect(staticMapCacheControl(false)).toBe("public, max-age=86400");
    expect(staticMapCacheControl(undefined)).toBe("public, max-age=86400");
  });
});
