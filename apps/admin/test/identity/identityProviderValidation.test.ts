// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  emptyProviderDraft,
  isDraftDirty,
  validateProviderDraft,
  type EditorMode,
  type ProviderDraft,
} from "../../src/identity/identityProviderValidation.js";

function draftWith(overrides: Partial<ProviderDraft> = {}): ProviderDraft {
  return { ...emptyProviderDraft(), ...overrides };
}

describe("validateProviderDraft", () => {
  it("flags required Basics fields as missing in create mode", () => {
    const errors = validateProviderDraft(emptyProviderDraft(), "create" as EditorMode);
    expect(errors.display_name).toBeTruthy();
    expect(errors.issuer).toBeTruthy();
    expect(errors.client_id).toBeTruthy();
    expect(errors.client_secret).toBeTruthy();
  });

  it("passes a valid minimal create draft", () => {
    const errors = validateProviderDraft(
      draftWith({
        display_name: "Google",
        issuer: "https://accounts.google.com",
        client_id: "client-123",
        client_secret: "secret-abc",
      }),
      "create" as EditorMode,
    );
    expect(Object.keys(errors)).toHaveLength(0);
  });

  it("requires an http(s) issuer URL", () => {
    const errors = validateProviderDraft(
      draftWith({
        display_name: "X",
        issuer: "accounts.google.com",
        client_id: "c",
        client_secret: "s",
      }),
      "create" as EditorMode,
    );
    expect(errors.issuer).toMatch(/http/);
  });

  it("does not require client_secret on edit when untouched", () => {
    const errors = validateProviderDraft(
      draftWith({
        display_name: "Google",
        issuer: "https://accounts.google.com",
        client_id: "client-123",
        client_secret: "",
        client_secret_touched: false,
      }),
      "edit" as EditorMode,
    );
    expect(errors.client_secret).toBeUndefined();
  });

  it("requires client_secret on edit when the operator typed a new value", () => {
    const errors = validateProviderDraft(
      draftWith({
        display_name: "Google",
        issuer: "https://accounts.google.com",
        client_id: "client-123",
        client_secret: "  ",
        client_secret_touched: true,
      }),
      "edit" as EditorMode,
    );
    expect(errors.client_secret).toBeTruthy();
  });

  it("rejects overlong fields", () => {
    const errors = validateProviderDraft(
      draftWith({
        display_name: "x".repeat(201),
        issuer: "https://x.example.com",
        client_id: "c",
        client_secret: "s",
        claim_email: "e".repeat(201),
      }),
      "create" as EditorMode,
    );
    expect(errors.display_name).toMatch(/under/);
    expect(errors.claim_email).toMatch(/under/);
  });
});

describe("isDraftDirty", () => {
  it("is clean against an unchanged baseline", () => {
    const draft = draftWith({ display_name: "Google" });
    expect(isDraftDirty(draft, { ...draft })).toBe(false);
  });

  it("is dirty when a field changes", () => {
    const baseline = draftWith({ display_name: "Google" });
    const draft = { ...baseline, display_name: "Okta" };
    expect(isDraftDirty(draft, baseline)).toBe(true);
  });

  it("is dirty only when the secret was touched on edit", () => {
    const baseline = draftWith({ display_name: "Google", client_secret: "", client_secret_touched: false });
    const typed: ProviderDraft = { ...baseline, client_secret: "new-secret", client_secret_touched: true };
    const cleared: ProviderDraft = { ...baseline, client_secret: "", client_secret_touched: false };
    expect(isDraftDirty(typed, baseline)).toBe(true);
    expect(isDraftDirty(cleared, baseline)).toBe(false);
  });
});
