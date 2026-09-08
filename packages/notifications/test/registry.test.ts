import { describe, expect, it } from "vitest";
import { NOTIFICATION_TYPES, getNotificationTypeDef } from "../src/registry.js";

const EXPECTED_TYPES = [
  "auth.login.repeated_failures",
  "auth.mfa.break_glass",
  "auth.settings.changed",
  "auth.login.new_country",
];

describe("NOTIFICATION_TYPES", () => {
  it("registers exactly the 4 foundation org-staff types", () => {
    const compare = (a: string, b: string) => a.localeCompare(b);
    expect(Object.keys(NOTIFICATION_TYPES).sort(compare)).toEqual([...EXPECTED_TYPES].sort(compare));
  });

  it.each(EXPECTED_TYPES)("%s is org-staff-audience, fully configurable, all 3 channels", (type) => {
    const def = NOTIFICATION_TYPES[type]!;
    expect(def.audience).toBe("org-staff");
    expect(def.userConfigurable).toBe(true);
    expect(def.orgDisableable).toBe(true);
    expect(def.availableChannels.sort((a, b) => a.localeCompare(b))).toEqual([
      "email",
      "in_app",
      "webhook",
    ]);
    expect(["info", "warn", "error"]).toContain(def.defaultSeverity);
    expect(def.label.length).toBeGreaterThan(0);
  });

  it("getNotificationTypeDef returns undefined for an unregistered key", () => {
    expect(getNotificationTypeDef("not.a.real.type")).toBeUndefined();
  });
});
