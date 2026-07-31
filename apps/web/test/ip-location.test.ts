import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("ip-location-api", () => ({
  lookup: vi.fn(),
}));

import { lookup } from "ip-location-api";
import { resolveIpLocation } from "../src/rate-limit/ip-location.js";

const mockedLookup = vi.mocked(lookup);

beforeEach(() => {
  mockedLookup.mockReset();
});

describe("resolveIpLocation", () => {
  it("returns unknown for null, the socket fallback literal, and malformed input without calling lookup", () => {
    expect(resolveIpLocation(null)).toEqual({ kind: "unknown" });
    expect(resolveIpLocation("unknown")).toEqual({ kind: "unknown" });
    expect(resolveIpLocation("not-an-ip")).toEqual({ kind: "unknown" });
    expect(mockedLookup).not.toHaveBeenCalled();
  });

  it("returns internal for loopback, private, link-local, and metadata addresses without calling lookup", () => {
    for (const ip of ["127.0.0.1", "::1", "10.0.0.5", "172.16.0.1", "192.168.1.1", "169.254.169.254"]) {
      expect(resolveIpLocation(ip)).toEqual({ kind: "internal" });
    }
    expect(mockedLookup).not.toHaveBeenCalled();
  });

  it("returns resolved with the looked-up country code for a public IP", () => {
    mockedLookup.mockReturnValue({ country: "US" } as ReturnType<typeof lookup>);
    expect(resolveIpLocation("8.8.8.8")).toEqual({ kind: "resolved", countryCode: "US" });
  });

  it("returns unknown when the dataset has no entry for a public IP", () => {
    mockedLookup.mockReturnValue(null);
    expect(resolveIpLocation("203.0.113.5")).toEqual({ kind: "unknown" });
  });

  it("returns unknown instead of throwing when the lookup itself throws", () => {
    mockedLookup.mockImplementation(() => {
      throw new Error("boom");
    });
    expect(resolveIpLocation("203.0.113.5")).toEqual({ kind: "unknown" });
  });
});
