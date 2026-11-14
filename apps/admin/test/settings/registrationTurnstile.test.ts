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
  bot_protection: "required",
  ...overrides,
});

const draft = (overrides: Partial<TurnstileDraft> = {}): TurnstileDraft => ({
  botProtection: "required",
  siteKey: "0x4AAAAAAAsite",
  secret: { mode: "idle", value: "" },
  ...overrides,
});

describe("turnstileDraftFrom", () => {
  it("holds the site key and never a secret", () => {
    expect(turnstileDraftFrom(dto())).toEqual({ botProtection: "required", siteKey: "0x4AAAAAAAsite", secret: { mode: "idle", value: "" } });
    expect(turnstileDraftFrom(dto({ bot_protection: "not_used" })).botProtection).toBe("not_used");
  });

  it("starts empty when nothing is saved", () => {
    expect(turnstileDraftFrom(dto({ site_key: null, secret_set: false, status: "incomplete" }))).toEqual({
      botProtection: "required",
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

  it("is true for a changed mode, and false again once it is as saved", () => {
    expect(turnstileDirty(draft({ botProtection: "not_used" }), saved)).toBe(true);
    expect(turnstileDirty(draft({ botProtection: "required" }), saved)).toBe(false);
  });

  it("is true while a secret is being replaced or cleared, and false again once cancelled", () => {
    expect(turnstileDirty(draft({ secret: { mode: "replace", value: "" } }), saved)).toBe(true);
    expect(turnstileDirty(draft({ secret: { mode: "clear", value: "" } }), saved)).toBe(true);
    expect(turnstileDirty(draft({ secret: { mode: "idle", value: "" } }), saved)).toBe(false);
  });
});

describe("while the check is not used", () => {
  const saved = draft();
  const off = (overrides: Partial<TurnstileDraft> = {}) => draft({ botProtection: "not_used", ...overrides });

  it("treats the keys like any other field: an edit is a change, is checked, and is saved with the mode", () => {
    const savedOff = off();
    const edited = off({ siteKey: "0x4AAAAAAAother", secret: { mode: "replace", value: "x" } });
    expect(turnstileDirty(edited, savedOff)).toBe(true);
    expect(buildTurnstileSaveBody(edited, savedOff)).toEqual({ site_key: "0x4AAAAAAAother", secret_key: "x" });
    expect(turnstileValidationErrors(off({ siteKey: "has space" }))).toEqual([TURNSTILE_SITE_KEY_ERROR]);
    expect(buildTurnstileSaveBody(off({ siteKey: "0x4AAAAAAAother" }), saved)).toEqual({
      bot_protection: "not_used",
      site_key: "0x4AAAAAAAother",
    });
    expect(buildTurnstileSaveBody(off(), off())).toBeNull();
  });

  it("sends the mode with the keys when the check is turned back on in the same save", () => {
    const savedOff = off();
    expect(buildTurnstileSaveBody(draft({ siteKey: "0x4AAAAAAAother" }), savedOff)).toEqual({
      bot_protection: "required",
      site_key: "0x4AAAAAAAother",
    });
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
