import { describe, expect, it } from "vitest";
import { originLocationText, originRows, originTimeZoneText } from "../../src/registration/requestOrigin.js";
import { detail } from "./requestsData.js";

describe("originTimeZoneText", () => {
  it("names the zone and its short name at the time the request was sent: winter and summer time differ", () => {
    expect(originTimeZoneText("Europe/Warsaw", "2026-01-15T10:00:00.000Z")).toBe("Europe/Warsaw (CET)");
    expect(originTimeZoneText("Europe/Warsaw", "2026-07-15T10:00:00.000Z")).toBe("Europe/Warsaw (UTC+2)");
  });

  it("is the zone alone when the product has no short name for it", () => {
    expect(originTimeZoneText("Mars/Olympus", "2026-01-15T10:00:00.000Z")).toBe("Mars/Olympus");
  });
});

describe("originLocationText", () => {
  it("says the region and the country, and that it is approximate", () => {
    expect(originLocationText("PL", "Mazovia")).toBe("Mazovia, Poland (approximate)");
  });

  it("says the country alone when there is no region", () => {
    expect(originLocationText("PL", null)).toBe("Poland (approximate)");
  });
});

describe("originRows", () => {
  it("lists what the request has, in the order of the window, the address as code", () => {
    const rows = originRows(
      detail("r1", { created_at: "2026-01-15T10:00:00.000Z", locale: "pl-PL", origin: { ip: "203.0.113.7", time_zone: "Europe/Warsaw", country: "PL", region: "Mazovia" } }),
    );

    expect(rows).toEqual([
      { label: "Time zone", text: "Europe/Warsaw (CET)" },
      { label: "Location", text: "Mazovia, Poland (approximate)" },
      { label: "IP address", text: "203.0.113.7", mono: true },
      { label: "Language", text: "pl-PL" },
    ]);
  });

  it("leaves out each part that was not kept or is not known", () => {
    expect(originRows(detail("r1"))).toEqual([]);
    expect(originRows(detail("r1", { origin: { ip: "203.0.113.7", time_zone: null, country: null, region: null } }))).toEqual([
      { label: "IP address", text: "203.0.113.7", mono: true },
    ]);
  });
});
