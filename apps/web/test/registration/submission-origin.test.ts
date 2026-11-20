import type { Context } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RegistrantSubmission } from "@admitto/tickets";

const mocks = vi.hoisted(() => ({
  clientIp: vi.fn<(c: unknown) => string>(),
  location: vi.fn<(ip: string | null) => { kind: string; countryCode?: string; region?: string; city?: string }>(),
}));
vi.mock("../../src/rate-limit/client-ip.js", () => ({ resolveClientIp: mocks.clientIp }));
vi.mock("../../src/rate-limit/ip-location.js", () => ({ resolveIpLocation: mocks.location }));

const { localeOf, readSubmissionOrigin, timeZoneOf, withOrigin } = await import("../../src/registration/submission-origin.js");

const context = (acceptLanguage?: string) => ({ req: { header: (name: string) => (name === "accept-language" ? acceptLanguage : undefined) } }) as unknown as Context;
const REGISTRANT: RegistrantSubmission = { email: "guest@example.com", first_name: "Ada", last_name: "Example" };

beforeEach(() => {
  mocks.clientIp.mockReturnValue("203.0.113.7");
  mocks.location.mockReturnValue({ kind: "unknown" });
});

describe("timeZoneOf", () => {
  it("returns a zone the product knows in the product's spelling", () => {
    expect(timeZoneOf("Europe/Warsaw")).toBe("Europe/Warsaw");
    expect(timeZoneOf(" Europe/Warsaw ")).toBe("Europe/Warsaw");
  });

  it("returns null for what is not a zone: not a text, too long, unknown", () => {
    expect(timeZoneOf(undefined)).toBeNull();
    expect(timeZoneOf(42)).toBeNull();
    expect(timeZoneOf("x".repeat(500))).toBeNull();
    expect(timeZoneOf("Mars/Olympus")).toBeNull();
    expect(timeZoneOf("")).toBeNull();
  });
});

describe("localeOf", () => {
  it("returns the first language of the header as a canonical tag", () => {
    expect(localeOf("pl-PL,pl;q=0.9,en;q=0.8")).toBe("pl-PL");
    expect(localeOf("EN-us;q=0.5")).toBe("en-US");
    expect(localeOf(" de ")).toBe("de");
  });

  it("returns null for no header, an empty one, the wildcard, a tag that is not one and a tag that is too long", () => {
    expect(localeOf(undefined)).toBeNull();
    expect(localeOf("")).toBeNull();
    expect(localeOf("*")).toBeNull();
    expect(localeOf("not a tag")).toBeNull();
    // A valid tag, longer than any real one: kept out, so a header cannot fill the column.
    expect(Intl.getCanonicalLocales("en-x-aaaaaaaa-bbbbbbbb-cccccccc-dddddddd")).toHaveLength(1);
    expect(localeOf("en-x-aaaaaaaa-bbbbbbbb-cccccccc-dddddddd")).toBeNull();
  });
});

describe("readSubmissionOrigin", () => {
  it("returns the client address, the zone and the place of the address", () => {
    mocks.location.mockReturnValue({ kind: "resolved", countryCode: "PL", region: "Mazovia", city: "Warsaw" });

    expect(readSubmissionOrigin(context(), "Europe/Warsaw")).toEqual({ ip: "203.0.113.7", time_zone: "Europe/Warsaw", country: "PL", region: "Mazovia" });
    expect(mocks.location).toHaveBeenCalledWith("203.0.113.7");
  });

  it("never keeps a city, and has no region when the dataset carries none", () => {
    mocks.location.mockReturnValue({ kind: "resolved", countryCode: "PL", city: "Warsaw" });

    const origin = readSubmissionOrigin(context(), "Europe/Warsaw");

    expect(origin).toEqual({ ip: "203.0.113.7", time_zone: "Europe/Warsaw", country: "PL", region: null });
    expect(Object.values(origin)).not.toContain("Warsaw");
  });

  it("leaves the place empty without a database, and keeps the address", () => {
    expect(readSubmissionOrigin(context(), undefined)).toEqual({ ip: "203.0.113.7", time_zone: null, country: null, region: null });
  });

  it("keeps no address when the client address is not known", () => {
    mocks.clientIp.mockReturnValue("unknown");

    expect(readSubmissionOrigin(context(), "UTC")).toEqual({ ip: null, time_zone: "UTC", country: null, region: null });
    expect(mocks.location).toHaveBeenCalledWith(null);
  });
});

describe("withOrigin", () => {
  it("adds the language and the origin for an event that keeps it", () => {
    expect(withOrigin(context("pl-PL"), REGISTRANT, true, "Europe/Warsaw")).toEqual({
      ...REGISTRANT,
      locale: "pl-PL",
      origin: { ip: "203.0.113.7", time_zone: "Europe/Warsaw", country: null, region: null },
    });
  });

  it("adds only the language for an event that does not, and reads neither the address nor the place", () => {
    const registrant = withOrigin(context("pl-PL"), REGISTRANT, false, "Europe/Warsaw");

    expect(registrant).toEqual({ ...REGISTRANT, locale: "pl-PL" });
    expect(mocks.clientIp).not.toHaveBeenCalled();
    expect(mocks.location).not.toHaveBeenCalled();
  });
});
