import { describe, expect, it } from "vitest";
import { customGuestOrigin, resolveGuestOrigin, type GuestDomain } from "../src/guestOrigin.js";

const INSTANCE = "https://admitto.example.com";
const VERIFIED = new Date("2026-11-11T10:00:00Z");

const settings = (domain: string | null, verifiedAt: Date | null): { registration_settings: GuestDomain } => ({
  registration_settings: { custom_domain: domain, custom_domain_verified_at: verifiedAt },
});

describe("resolveGuestOrigin", () => {
  it("is the event's own address once it is verified", () => {
    expect(resolveGuestOrigin(settings("summit.acme.example", VERIFIED), INSTANCE)).toBe("https://summit.acme.example");
  });

  it("is the instance when the address is set but not verified", () => {
    expect(resolveGuestOrigin(settings("summit.acme.example", null), INSTANCE)).toBe(INSTANCE);
  });

  it("is the instance when the event has no address of its own, or no settings at all", () => {
    expect(resolveGuestOrigin(settings(null, null), INSTANCE)).toBe(INSTANCE);
    expect(resolveGuestOrigin({ registration_settings: null }, INSTANCE)).toBe(INSTANCE);
  });

  it("drops the trailing slash of the instance, and never invents one for the event's address", () => {
    expect(resolveGuestOrigin(settings(null, null), `${INSTANCE}/`)).toBe(INSTANCE);
    expect(resolveGuestOrigin(settings("summit.acme.example", VERIFIED), `${INSTANCE}/`)).toBe("https://summit.acme.example");
  });

  it("does not follow an address that is not one a superadmin may set, even when it is marked verified", () => {
    // A value written by hand: the table's own CHECK keeps most of these out, and this is the second line.
    for (const bad of ["Summit.Acme.Example", "https://summit.acme.example", "summit.acme.example/path", "1.2.3.4", "localhost", "a b.example", ""]) {
      expect(resolveGuestOrigin(settings(bad, VERIFIED), INSTANCE), bad).toBe(INSTANCE);
    }
  });
});

describe("customGuestOrigin", () => {
  it("is null for every case that is not a verified address of the event's own", () => {
    expect(customGuestOrigin(null)).toBeNull();
    expect(customGuestOrigin({ custom_domain: null, custom_domain_verified_at: VERIFIED })).toBeNull();
    expect(customGuestOrigin({ custom_domain: "summit.acme.example", custom_domain_verified_at: null })).toBeNull();
    expect(customGuestOrigin({ custom_domain: "summit.acme.example", custom_domain_verified_at: VERIFIED })).toBe("https://summit.acme.example");
  });
});
