import { describe, expect, it } from "vitest";
import {
  parseEventIdFromStaticMapFilename,
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
  it("maps known miss reasons to 404 and render failure to 502", () => {
    expect(staticMapFailureStatus("disabled")).toBe(404);
    expect(staticMapFailureStatus("not_found")).toBe(404);
    expect(staticMapFailureStatus("no_coordinates")).toBe(404);
    expect(staticMapFailureStatus("render_failed")).toBe(502);
  });
});
