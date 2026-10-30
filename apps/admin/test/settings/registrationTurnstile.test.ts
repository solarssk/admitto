import { describe, expect, it } from "vitest";
import type { RegistrationTurnstileDto } from "../../src/api/types.js";
import {
  TURNSTILE_SECRET_KEY_EMPTY_ERROR,
  TURNSTILE_SECRET_KEY_ERROR,
  TURNSTILE_SITE_KEY_ERROR,
  buildTurnstileSaveBody,
  turnstileDirty,
  turnstileDraftFrom,
  turnstileValidationErrors,
  type TurnstileDraft,
} from "../../src/settings/registrationTurnstile.js";

const dto = (overrides: Partial<RegistrationTurnstileDto> = {}): RegistrationTurnstileDto => ({
  site_key: "0x4AAAAAAAsite",
  secret_set: true,
  status: "ready",
  ...overrides,
});

const draft = (overrides: Partial<TurnstileDraft> = {}): TurnstileDraft => ({
  siteKey: "0x4AAAAAAAsite",
  secret: { mode: "idle", value: "" },
  ...overrides,
});

describe("turnstileDraftFrom", () => {
  it("holds the site key and never a secret", () => {
    expect(turnstileDraftFrom(dto())).toEqual({ siteKey: "0x4AAAAAAAsite", secret: { mode: "idle", value: "" } });
  });

  it("starts empty when nothing is saved", () => {
    expect(turnstileDraftFrom(dto({ site_key: null, secret_set: false, status: "incomplete" }))).toEqual({
      siteKey: "",
      secret: { mode: "idle", value: "" },
    });
  });
});

describe("turnstileDirty", () => {
  const saved = draft();

  it("is false for an untouched draft, and for a site key that only gained spaces", () => {
    expect(turnstileDirty(draft(), saved)).toBe(false);
    expect(turnstileDirty(draft({ siteKey: "  0x4AAAAAAAsite " }), saved)).toBe(false);
  });

  it("is true for a changed site key", () => {
    expect(turnstileDirty(draft({ siteKey: "0x4AAAAAAAother" }), saved)).toBe(true);
    expect(turnstileDirty(draft({ siteKey: "" }), saved)).toBe(true);
  });

  it("is true while a secret is being replaced or cleared, and false again once cancelled", () => {
    expect(turnstileDirty(draft({ secret: { mode: "replace", value: "" } }), saved)).toBe(true);
    expect(turnstileDirty(draft({ secret: { mode: "clear", value: "" } }), saved)).toBe(true);
    expect(turnstileDirty(draft({ secret: { mode: "idle", value: "" } }), saved)).toBe(false);
  });
});

describe("turnstileValidationErrors", () => {
  it("accepts keys as Cloudflare issues them, and an empty site key", () => {
    expect(turnstileValidationErrors(draft())).toEqual([]);
    expect(turnstileValidationErrors(draft({ siteKey: "" }))).toEqual([]);
    expect(
      turnstileValidationErrors(draft({ secret: { mode: "replace", value: "1x0000000000000000000000000000000AA" } })),
    ).toEqual([]);
  });

  it("refuses a site key with anything but letters, digits, hyphens and underscores", () => {
    for (const siteKey of ["has space", "a\"b", "<script>", "ąę", "a".repeat(129)]) {
      expect(turnstileValidationErrors(draft({ siteKey }))).toEqual([TURNSTILE_SITE_KEY_ERROR]);
    }
  });

  it("refuses a secret that is empty or has spaces, but only while it is being replaced", () => {
    for (const value of ["", "   "]) {
      expect(turnstileValidationErrors(draft({ secret: { mode: "replace", value } }))).toEqual([
        TURNSTILE_SECRET_KEY_EMPTY_ERROR,
      ]);
    }
    for (const value of ["two words", "a".repeat(513)]) {
      expect(turnstileValidationErrors(draft({ secret: { mode: "replace", value } }))).toEqual([
        TURNSTILE_SECRET_KEY_ERROR,
      ]);
    }
    expect(turnstileValidationErrors(draft({ secret: { mode: "clear", value: "two words" } }))).toEqual([]);
    expect(turnstileValidationErrors(draft({ secret: { mode: "idle", value: "two words" } }))).toEqual([]);
  });

  it("reports both problems at once", () => {
    expect(
      turnstileValidationErrors(draft({ siteKey: "bad key", secret: { mode: "replace", value: "bad secret" } })),
    ).toEqual([TURNSTILE_SITE_KEY_ERROR, TURNSTILE_SECRET_KEY_ERROR]);
  });
});

describe("buildTurnstileSaveBody", () => {
  const saved = draft();

  it("sends nothing when nothing changed", () => {
    expect(buildTurnstileSaveBody(draft(), saved)).toBeNull();
    expect(buildTurnstileSaveBody(draft({ siteKey: " 0x4AAAAAAAsite " }), saved)).toBeNull();
  });

  it("sends only the site key when only it changed, trimmed", () => {
    expect(buildTurnstileSaveBody(draft({ siteKey: "  0x4AAAAAAAnew " }), saved)).toEqual({ site_key: "0x4AAAAAAAnew" });
  });

  it("clears a site key that was emptied", () => {
    expect(buildTurnstileSaveBody(draft({ siteKey: "   " }), saved)).toEqual({ site_key: null });
  });

  it("sends a replaced secret, trimmed, without touching the site key", () => {
    expect(buildTurnstileSaveBody(draft({ secret: { mode: "replace", value: " newSecret " } }), saved)).toEqual({
      secret_key: "newSecret",
    });
  });

  it("clears the secret with null", () => {
    expect(buildTurnstileSaveBody(draft({ secret: { mode: "clear", value: "" } }), saved)).toEqual({ secret_key: null });
  });

  it("sends both when both changed", () => {
    expect(
      buildTurnstileSaveBody(draft({ siteKey: "0x4AAAAAAAnew", secret: { mode: "replace", value: "s3cret" } }), saved),
    ).toEqual({ site_key: "0x4AAAAAAAnew", secret_key: "s3cret" });
  });

  it("sends a first site key when none was saved", () => {
    expect(buildTurnstileSaveBody(draft({ siteKey: "0x4AAAAAAAfirst" }), draft({ siteKey: "" }))).toEqual({
      site_key: "0x4AAAAAAAfirst",
    });
  });
});
