import { describe, expect, it } from "vitest";
import { buildSecurityPatchBody } from "../../src/settings/securitySettingsPatch.js";
import type { SystemSettingsDto } from "../../src/api/types.js";

const baseSettings: SystemSettingsDto = {
  session_ttl_ms: { value: 86_400_000, source: "default" },
  operator_session_ttl_ms: { value: 43_200_000, source: "default" },
  session_idle_timeout_ms: { value: 1_800_000, source: "default" },
  operator_session_idle_timeout_ms: { value: 7_200_000, source: "default" },
  trusted_device_days: { value: 30, source: "default" },
  mfa_required_roles: { value: ["superadmin"], source: "default" },
  instance_url: { value: null, source: "default" },
};

const baseDraft = {
  sessionTtlH: "24",
  opTtlH: "12",
  sessionIdleM: "30",
  opIdleM: "120",
  trustedDays: "30",
  mfaRoles: ["superadmin"],
};

function fieldLocked(source: "env" | "db" | "default") {
  return source === "env";
}

describe("buildSecurityPatchBody", () => {
  it("returns no changes when the draft matches persisted settings", () => {
    const result = buildSecurityPatchBody(baseSettings, baseDraft, fieldLocked);
    expect(result.hasChanges).toBe(false);
    expect(result.body).toEqual({});
  });

  it("includes only editable fields that changed", () => {
    const result = buildSecurityPatchBody(
      baseSettings,
      { ...baseDraft, sessionTtlH: "48", trustedDays: "14" },
      fieldLocked,
    );
    expect(result.hasChanges).toBe(true);
    expect(result.body).toEqual({
      session_ttl_ms: 48 * 3_600_000,
      trusted_device_days: 14,
    });
  });

  it("parses string draft fields when building the PATCH body", () => {
    const result = buildSecurityPatchBody(
      baseSettings,
      { ...baseDraft, sessionIdleM: "60" },
      fieldLocked,
    );
    expect(result.hasChanges).toBe(true);
    expect(result.body.session_idle_timeout_ms).toBe(60 * 60_000);
  });

  it("skips env-locked fields even when the draft differs", () => {
    const result = buildSecurityPatchBody(
      {
        ...baseSettings,
        session_ttl_ms: { value: 86_400_000, source: "env" },
        mfa_required_roles: { value: ["superadmin", "admin"], source: "env" },
      },
      { ...baseDraft, sessionTtlH: "48", mfaRoles: ["operator"] },
      fieldLocked,
    );
    expect(result.hasChanges).toBe(false);
    expect(result.body).toEqual({});
  });

  it("detects MFA role order changes without treating identical sets as edits", () => {
    const unchanged = buildSecurityPatchBody(
      {
        ...baseSettings,
        mfa_required_roles: { value: ["admin", "superadmin"], source: "default" },
      },
      { ...baseDraft, mfaRoles: ["superadmin", "admin"] },
      fieldLocked,
    );
    expect(unchanged.hasChanges).toBe(false);

    const changed = buildSecurityPatchBody(
      baseSettings,
      { ...baseDraft, mfaRoles: ["superadmin", "operator"] },
      fieldLocked,
    );
    expect(changed.hasChanges).toBe(true);
    expect(changed.body.mfa_required_roles).toEqual(["superadmin", "operator"]);
  });
});
