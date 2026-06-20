import { describe, expect, it } from "vitest";
import { mergeOrgMailSettingsRow } from "../src/mailSettings.js";
import { validateOrgMailSettingsUpdate } from "../src/validateOrgUpdate.js";

describe("validateOrgMailSettingsUpdate", () => {
  it("allows clearing provider without validating transport", () => {
    const current = mergeOrgMailSettingsRow(null, {
      provider: "smtp",
      host: "smtp.example.com",
      port: 587,
      user: "u@example.com",
      fromAddress: "u@example.com",
      smtpPassword: "secret",
    });
    const result = validateOrgMailSettingsUpdate(current, { provider: "" }, {});
    expect(result).toEqual({ ok: true });
  });

  it("rejects activating SMTP without required credentials", () => {
    const result = validateOrgMailSettingsUpdate(
      null,
      {
        provider: "smtp",
        host: "smtp.example.com",
        port: 587,
        fromAddress: "from@example.com",
      },
      {},
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/user/i);
    }
  });

  it("accepts complete SMTP activation", () => {
    const result = validateOrgMailSettingsUpdate(
      null,
      {
        provider: "smtp",
        host: "smtp.example.com",
        port: 587,
        user: "u@example.com",
        fromAddress: "u@example.com",
        smtpPassword: "secret",
      },
      {},
    );
    expect(result).toEqual({ ok: true });
  });

  it("skips validation for secret-only updates", () => {
    const current = mergeOrgMailSettingsRow(null, {
      provider: "smtp",
      host: "smtp.example.com",
      port: 587,
      user: "u@example.com",
      fromAddress: "u@example.com",
      smtpPassword: "secret",
    });
    const result = validateOrgMailSettingsUpdate(current, { smtpPassword: "" }, {});
    expect(result).toEqual({ ok: true });
  });

  it("returns ok false without throwing when env mail fields are malformed", () => {
    const result = validateOrgMailSettingsUpdate(
      null,
      {
        provider: "smtp",
        host: "smtp.example.com",
        port: 587,
        user: "u@example.com",
        fromAddress: "u@example.com",
        smtpPassword: "secret",
      },
      { SMTP_SECURE: "not-a-boolean" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/SMTP_SECURE/i);
    }
  });

  it("rejects allowed from domain mismatch on save", () => {
    const result = validateOrgMailSettingsUpdate(
      null,
      {
        provider: "smtp",
        host: "smtp.example.com",
        port: 587,
        user: "u@example.com",
        fromAddress: "u@other.com",
        allowedFromDomain: "example.com",
        smtpPassword: "secret",
      },
      {},
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/allowed from domain/i);
    }
  });
});
