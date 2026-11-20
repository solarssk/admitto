/**
 * The address of the guests' sign-in that the superadmin copies to the provider (118b): built by the same function as the
 * sign-in's own redirect, from the address of the instance, and null while the instance has none (the screen then says it
 * must be set). The integration test (../integration/registration-settings-routes.test.ts) reads it through the route.
 */
import { describe, expect, it } from "vitest";
import { readRedirectUri } from "../../src/admin/registration-settings-routes.js";
import { buildGuestSsoRedirectUri } from "../../src/registration/sso-routes.js";

describe("readRedirectUri", () => {
  it("is the address the sign-in builds for the same instance address, with or without a trailing slash", async () => {
    expect(await readRedirectUri(async () => "https://tickets.example.com")).toBe("https://tickets.example.com/sso/callback");
    expect(await readRedirectUri(async () => "https://tickets.example.com/")).toBe(buildGuestSsoRedirectUri("https://tickets.example.com"));
  });

  it("is null while the instance has no address, whatever the reason", async () => {
    expect(await readRedirectUri(() => Promise.reject(new Error("no instance url")))).toBeNull();
  });
});
