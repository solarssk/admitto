import { describe, expect, it } from "vitest";
import { NOTIFICATION_TYPES, getNotificationTypeDef } from "../src/registry.js";

const ORG_STAFF_TYPES = [
  "auth.login.repeated_failures",
  "auth.mfa.break_glass",
  "auth.settings.changed",
  "auth.login.new_country",
];

const SELF_TYPES = ["account.auth_factor.changed"];

describe("NOTIFICATION_TYPES", () => {
  it("registers exactly the 4 org-staff types plus the 1 self-audience type", () => {
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
    "%s is self-audience, mandatory (not user/org configurable), no webhook, never throttled",
    (type) => {
      const def = NOTIFICATION_TYPES[type]!;
      expect(def.audience).toBe("self");
      expect(def.userConfigurable).toBe(false);
      expect(def.orgDisableable).toBe(false);
      expect(def.availableChannels.toSorted((a, b) => a.localeCompare(b))).toEqual(["email", "in_app"]);
      // Every call site shares one per-user dedupeKey, but each occurrence is its own distinct
      // event a shared throttle window would otherwise collapse (bot review finding, PR #1304).
      expect(def.throttleWindowMinutes).toBe(0);
      expect(["info", "warn", "error"]).toContain(def.defaultSeverity);
      expect(def.label.length).toBeGreaterThan(0);
    },
  );

  it("getNotificationTypeDef returns undefined for an unregistered key", () => {
    expect(getNotificationTypeDef("not.a.real.type")).toBeUndefined();
  });
});
