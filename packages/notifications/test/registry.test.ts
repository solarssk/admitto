import { describe, expect, it } from "vitest";
import { NOTIFICATION_TYPES, getNotificationTypeDef } from "../src/registry.js";

const ORG_STAFF_TYPES = [
  "auth.login.repeated_failures",
  "auth.mfa.break_glass",
  "auth.settings.changed",
  "auth.login.new_country",
  "auth.role.elevated",
];

const SELF_TYPES = ["account.auth_factor.changed", "account.login.new_location"];

describe("NOTIFICATION_TYPES", () => {
  it("registers exactly the 5 org-staff types plus the 2 self-audience types", () => {
    const compare = (a: string, b: string) => a.localeCompare(b);
    const expected = [...ORG_STAFF_TYPES, ...SELF_TYPES];
    expect(Object.keys(NOTIFICATION_TYPES).toSorted(compare)).toEqual(expected.toSorted(compare));
  });

  it.each(ORG_STAFF_TYPES)("%s is org-staff-audience, fully configurable, all 3 channels", (type) => {
    const def = NOTIFICATION_TYPES[type]!;
    expect(def.audience).toBe("org-staff");
    expect(def.userConfigurable).toBe(true);
    expect(def.orgDisableable).toBe(true);
    expect(def.availableChannels.toSorted((a, b) => a.localeCompare(b))).toEqual([
      "email",
      "in_app",
      "webhook",
    ]);
    expect(["info", "warn", "error"]).toContain(def.defaultSeverity);
    expect(def.label.length).toBeGreaterThan(0);
  });

  it.each(SELF_TYPES)(
    "%s is self-audience, mandatory (not user/org configurable), no webhook",
    (type) => {
      const def = NOTIFICATION_TYPES[type]!;
      expect(def.audience).toBe("self");
      expect(def.userConfigurable).toBe(false);
      expect(def.orgDisableable).toBe(false);
      expect(def.availableChannels.toSorted((a, b) => a.localeCompare(b))).toEqual(["email", "in_app"]);
      expect(["info", "warn", "error"]).toContain(def.defaultSeverity);
      expect(def.label.length).toBeGreaterThan(0);
    },
  );

  it("account.auth_factor.changed is never throttled - every occurrence is its own distinct, independently reportable change a shared throttle window would otherwise collapse (bot review finding, PR #1304)", () => {
    expect(NOTIFICATION_TYPES["account.auth_factor.changed"]!.throttleWindowMinutes).toBe(0);
  });

  it("account.login.new_location uses the default throttle window - repeated logins from the same new country within it are legitimately the same signal, unlike account.auth_factor.changed's own distinct-occurrence reasoning", () => {
    expect(NOTIFICATION_TYPES["account.login.new_location"]!.throttleWindowMinutes).toBeUndefined();
  });

  it("auth.role.elevated is never throttled - two distinct grants to the same target (a revoke+re-grant, or several new organization scopes saved in sequence) are each independently reportable, not one incident (bot review finding, PR #1312)", () => {
    expect(NOTIFICATION_TYPES["auth.role.elevated"]!.throttleWindowMinutes).toBe(0);
  });

  it.each(ORG_STAFF_TYPES.filter((type) => type !== "auth.role.elevated"))(
    "%s uses the default (15-minute) throttle window from ORG_STAFF_DEFAULTS",
    (type) => {
      expect(NOTIFICATION_TYPES[type]!.throttleWindowMinutes).toBe(15);
    },
  );

  it("getNotificationTypeDef returns undefined for an unregistered key", () => {
    expect(getNotificationTypeDef("not.a.real.type")).toBeUndefined();
  });
});
