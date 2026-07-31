// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GeoCell, geoLocationText } from "../../src/components/GeoCell.js";
import type { IpLocationDto } from "../../src/api/types.js";

afterEach(() => {
  cleanup();
});

describe("GeoCell", () => {
  it("renders a building icon and Internal network for an internal address", () => {
    const { container } = render(<GeoCell location={{ kind: "internal" }} />);
    expect(screen.getByText("Internal network")).toBeTruthy();
    expect(container.querySelector(".ti-building")).toBeTruthy();
  });

  it("renders a flag and country name for a resolved address", () => {
    render(<GeoCell location={{ kind: "resolved", countryCode: "us" }} />);
    expect(screen.getByText("🇺🇸")).toBeTruthy();
    expect(screen.getByText("United States")).toBeTruthy();
  });

  it("renders nothing for a resolved kind with no country code (defensive)", () => {
    const { container } = render(<GeoCell location={{ kind: "resolved" }} />);
    expect(container.textContent).toBe("");
  });

  it("renders nothing when the dataset has no entry for the address", () => {
    const { container } = render(<GeoCell location={{ kind: "unknown" }} />);
    expect(container.textContent).toBe("");
  });
});

describe("geoLocationText", () => {
  it("returns Internal network for an internal address", () => {
    expect(geoLocationText({ kind: "internal" })).toBe("Internal network");
  });

  it("returns the country name for a resolved address", () => {
    expect(geoLocationText({ kind: "resolved", countryCode: "de" })).toBe("Germany");
  });

  it("returns an empty string for a resolved kind with no country code", () => {
    expect(geoLocationText({ kind: "resolved" })).toBe("");
  });

  it("returns an empty string when the dataset has no entry for the address", () => {
    expect(geoLocationText({ kind: "unknown" })).toBe("");
  });

  it("falls back to the raw code if Intl.DisplayNames can't resolve it", () => {
    const malformed = { kind: "resolved", countryCode: "XXX-not-a-region" } as IpLocationDto;
    expect(geoLocationText(malformed)).toBe("XXX-not-a-region");
  });
});
