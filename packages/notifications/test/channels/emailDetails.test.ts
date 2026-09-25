import { describe, expect, it } from "vitest";
import { buildNotificationEmailDetails } from "../../src/channels/email.js";
import type { DispatchedNotification } from "../../src/types.js";

function detailsFor(
  type: string,
  metadata: Record<string, unknown> | undefined,
  organizationName?: string | null,
): string[] {
  const event: DispatchedNotification = {
    type,
    severity: "warn",
    organizationId: "org-1",
    title: "Title",
    body: "Body",
    metadata,
  };
  return buildNotificationEmailDetails(event, organizationName);
}

describe("buildNotificationEmailDetails", () => {
  describe("auth.login.repeated_failures", () => {
    it("shows the number of failed attempts", () => {
      expect(detailsFor("auth.login.repeated_failures", { streak: 7 })).toEqual(["Failed sign-in attempts: 7"]);
    });

    it.each([
      ["no metadata", undefined],
      ["a missing streak", {}],
      ["a non-numeric streak", { streak: "7" }],
      ["a non-finite streak", { streak: Number.POSITIVE_INFINITY }],
    ])("shows nothing for %s", (_label, metadata) => {
      expect(detailsFor("auth.login.repeated_failures", metadata)).toEqual([]);
    });
  });

  describe("auth.mfa.break_glass", () => {
    it.each([
      ["reset_mfa", "Two-factor authentication reset"],
      ["generate_emergency_recovery", "Emergency recovery code generated"],
    ])("labels the %s action", (action, label) => {
      expect(detailsFor("auth.mfa.break_glass", { action })).toEqual([`Action: ${label}`]);
    });

    it("shows nothing for an action without a designed label", () => {
      expect(detailsFor("auth.mfa.break_glass", { action: "something_new" })).toEqual([]);
    });
  });

  describe("auth.settings.changed", () => {
    it.each([
      ["create", "Created"],
      ["update", "Updated"],
      ["enable", "Enabled"],
      ["disable", "Disabled"],
      ["discover", "Configuration refreshed"],
    ])("labels the %s action on an identity provider", (action, label) => {
      expect(detailsFor("auth.settings.changed", { resource: "oidc_provider", action })).toEqual([
        "Changed: Single sign-on provider",
        `Action: ${label}`,
      ]);
    });

    it("labels Cloudflare Access, which has no provider name", () => {
      expect(detailsFor("auth.settings.changed", { resource: "cf_access", action: "update" })).toEqual([
        "Changed: Cloudflare Access",
        "Action: Updated",
      ]);
    });

    it("prints only what has a designed label, never a raw resource, action or id", () => {
      expect(
        detailsFor("auth.settings.changed", {
          resource: "saml",
          action: "rotate",
          target_id: "opaque-id",
          target_label: "Corporate SSO",
        }),
      ).toEqual(["Provider: Corporate SSO"]);
    });
  });

  describe("auth.role.elevated", () => {
    it("names the instance scope for a superadmin grant", () => {
      expect(
        detailsFor("auth.role.elevated", { role: "superadmin", scope_type: "instance", scope_id: null }),
      ).toEqual(["Role: Superadmin", "Scope: Entire Admitto instance"]);
    });

    it("names the organisation when it has a name", () => {
      expect(detailsFor("auth.role.elevated", { role: "admin", scope_type: "organization" }, "Puma")).toEqual([
        "Role: Administrator",
        "Scope: Puma",
      ]);
    });

    it.each([[undefined], [null], [""]])(
      "falls back to a generic scope when the organisation name is %j",
      (organizationName) => {
        expect(
          detailsFor("auth.role.elevated", { role: "admin", scope_type: "organization" }, organizationName),
        ).toEqual(["Role: Administrator", "Scope: This organisation"]);
      },
    );

    it("shows the role without a scope for an event-scoped grant", () => {
      expect(detailsFor("auth.role.elevated", { role: "admin", scope_type: "event", scope_id: "evt-1" })).toEqual([
        "Role: Administrator",
      ]);
    });

    it.each(["operator", "constructor", "toString"])("shows no role line for %s", (role) => {
      expect(detailsFor("auth.role.elevated", { role, scope_type: "instance" })).toEqual([
        "Scope: Entire Admitto instance",
      ]);
    });
  });

  describe.each(["auth.login.new_country", "account.login.new_location"])("%s", (type) => {
    it("shows the location, device, IP address and time in that order", () => {
      expect(
        detailsFor(type, {
          country: "Portugal",
          city: "Lisbon",
          device: "Firefox / Linux",
          ip: "2001:db8::1",
          time: "2026-09-25 12:00:00 UTC",
        }),
      ).toEqual([
        "Location: Lisbon, Portugal",
        "Device: Firefox / Linux",
        "IP address: 2001:db8::1",
        "Time: 2026-09-25 12:00:00 UTC",
      ]);
    });

    it("shows the country alone when there is no city", () => {
      expect(detailsFor(type, { country: "Portugal" })).toEqual(["Location: Portugal"]);
    });

    it("omits a city that arrives without a country, and ignores blank values", () => {
      expect(detailsFor(type, { city: "Lisbon", country: "  ", device: "", ip: "   ", time: "" })).toEqual([]);
    });

    it("shows nothing without metadata", () => {
      expect(detailsFor(type, undefined)).toEqual([]);
    });
  });
});
