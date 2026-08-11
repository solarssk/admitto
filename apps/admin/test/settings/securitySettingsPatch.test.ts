import { describe, expect, it } from "vitest";
import {
  buildSecurityPatchBody,
  cspTrustedOriginsErrors,
  draftFromSettings,
  parseDraftInt,
  previewDraftInt,
} from "../../src/settings/securitySettingsPatch.js";
import type { SystemSettingsDto } from "../../src/api/types.js";

const baseSettings: SystemSettingsDto = {
  session_ttl_ms: { value: 86_400_000, source: "default" },
  operator_session_ttl_ms: { value: 43_200_000, source: "default" },
  session_idle_timeout_ms: { value: 1_800_000, source: "default" },
  operator_session_idle_timeout_ms: { value: 7_200_000, source: "default" },
  trusted_device_days: { value: 30, source: "default" },
  mfa_required_roles: { value: ["superadmin"], source: "default" },
  instance_url: { value: null, source: "default" },
  csp_trusted_origins: { value: [], source: "default" },
};

const baseDraft = {
  sessionTtlH: "24",
  opTtlH: "12",
  sessionIdleM: "30",
  opIdleM: "120",
  trustedDays: "30",
  mfaRoles: ["superadmin"],
  cspTrustedOriginsRaw: "",
};

function fieldLocked(source: "env" | "db" | "default") {
  return source === "env";
}

describe("parseDraftInt", () => {
  it("falls back on empty or non-numeric input and clamps to bounds", () => {
    expect(parseDraftInt("", 1, 10, 5)).toBe(5);
    expect(parseDraftInt("  ", 1, 10, 5)).toBe(5);
    expect(parseDraftInt("xy", 1, 10, 5)).toBe(5);
    expect(parseDraftInt("0", 1, 10, 5)).toBe(1);
    expect(parseDraftInt("999", 1, 10, 5)).toBe(10);
  });
});

describe("previewDraftInt", () => {
  it("returns null for empty or non-numeric input", () => {
    expect(previewDraftInt("")).toBeNull();
    expect(previewDraftInt("  ")).toBeNull();
    expect(previewDraftInt("nope")).toBeNull();
  });

  it("parses integers without clamping", () => {
    expect(previewDraftInt("48")).toBe(48);
    expect(previewDraftInt(" 3 ")).toBe(3);
  });
});

describe("draftFromSettings", () => {
  it("maps persisted settings to editable string fields", () => {
    expect(draftFromSettings(baseSettings)).toEqual(baseDraft);
  });
});

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

  it("includes operator session TTL and idle fields when they change", () => {
    const result = buildSecurityPatchBody(
      baseSettings,
      { ...baseDraft, opTtlH: "24", opIdleM: "60" },
      fieldLocked,
    );
    expect(result.hasChanges).toBe(true);
    expect(result.body).toEqual({
      operator_session_ttl_ms: 24 * 3_600_000,
      operator_session_idle_timeout_ms: 60 * 60_000,
    });
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

  it("includes csp_trusted_origins when the draft text changes", () => {
    const result = buildSecurityPatchBody(
      baseSettings,
      { ...baseDraft, cspTrustedOriginsRaw: "https://static.cloudflareinsights.com" },
      fieldLocked,
    );
    expect(result.hasChanges).toBe(true);
    expect(result.body.csp_trusted_origins).toEqual(["https://static.cloudflareinsights.com"]);
  });

  it("treats a reordered/re-spaced csp_trusted_origins draft as unchanged", () => {
    const result = buildSecurityPatchBody(
      {
        ...baseSettings,
        csp_trusted_origins: {
          value: ["https://a.example.com", "https://b.example.com"],
          source: "default",
        },
      },
      { ...baseDraft, cspTrustedOriginsRaw: "https://b.example.com,  https://a.example.com" },
      fieldLocked,
    );
    expect(result.hasChanges).toBe(false);
    expect(result.body).toEqual({});
  });

  it("skips csp_trusted_origins when env-locked", () => {
    const result = buildSecurityPatchBody(
      { ...baseSettings, csp_trusted_origins: { value: [], source: "env" } },
      { ...baseDraft, cspTrustedOriginsRaw: "https://example.com" },
      fieldLocked,
    );
    expect(result.hasChanges).toBe(false);
    expect(result.body).toEqual({});
  });
});

describe("draftFromSettings (csp_trusted_origins)", () => {
  it("renders the persisted array back as comma-separated text", () => {
    const draft = draftFromSettings({
      ...baseSettings,
      csp_trusted_origins: {
        value: ["https://a.example.com", "https://b.example.com"],
        source: "db",
      },
    });
    expect(draft.cspTrustedOriginsRaw).toBe("https://a.example.com, https://b.example.com");
  });
});

describe("cspTrustedOriginsErrors", () => {
  it("returns no errors for an empty or valid list", () => {
    expect(cspTrustedOriginsErrors("")).toEqual([]);
    expect(cspTrustedOriginsErrors("https://static.cloudflareinsights.com")).toEqual([]);
  });

  it("flags an invalid origin", () => {
    const errors = cspTrustedOriginsErrors("'self'");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/not a valid https:\/\/ origin/);
  });

  it("flags more than 10 origins", () => {
    const many = Array.from({ length: 11 }, (_, i) => `https://example${i}.com`).join(",");
    const errors = cspTrustedOriginsErrors(many);
    expect(errors.some((e) => /at most/i.test(e))).toBe(true);
  });
});
