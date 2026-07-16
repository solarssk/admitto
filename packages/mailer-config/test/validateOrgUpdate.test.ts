import { describe, expect, it } from "vitest";
import { mergeMailSettingsRow } from "../src/mailSettings.js";
import { validateOrgMailSettingsUpdate, validateEventMailSettingsUpdate } from "../src/validateOrgUpdate.js";

describe("validateOrgMailSettingsUpdate", () => {
  it("allows clearing provider without validating transport", () => {
    const current = mergeMailSettingsRow(null, {
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

  it("rejects clearing the only SMTP password while SMTP remains active", () => {
    // A secret-only update is not exempt from validation — clearing the sole credential
    // on an already-active transport must fail loudly instead of silently disabling mail
    // (previously this returned ok:true and cleared smtp_password_enc with no warning).
    const current = mergeMailSettingsRow(null, {
      provider: "smtp",
      host: "smtp.example.com",
      port: 587,
      user: "u@example.com",
      fromAddress: "u@example.com",
      smtpPassword: "secret",
    });
    const result = validateOrgMailSettingsUpdate(current, { smtpPassword: "" }, {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/password/i);
    }
  });

  it("allows rotating a secret to a new non-empty value on an already-valid transport", () => {
    const current = mergeMailSettingsRow(null, {
      provider: "smtp",
      host: "smtp.example.com",
      port: 587,
      user: "u@example.com",
      fromAddress: "u@example.com",
      smtpPassword: "secret",
    });
    const result = validateOrgMailSettingsUpdate(current, { smtpPassword: "new-secret" }, {});
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

  it("allows switching to export_only when clearing stale allowed from domain", () => {
    const current = mergeMailSettingsRow(null, {
      provider: "smtp",
      host: "smtp.example.com",
      port: 587,
      user: "u@example.com",
      fromAddress: "u@example.com",
      allowedFromDomain: "example.com",
      smtpPassword: "secret",
    });
    const result = validateOrgMailSettingsUpdate(
      current,
      {
        provider: "export_only",
        fromAddress: "dev@other.com",
        allowedFromDomain: "",
      },
      {},
    );
    expect(result).toEqual({ ok: true });
  });
});

describe("validateEventMailSettingsUpdate", () => {
  const orgRow = mergeMailSettingsRow(null, {
    provider: "graph",
    mailbox: "org@example.com",
    tenantId: "11111111-1111-1111-1111-111111111111",
    clientId: "22222222-2222-2222-2222-222222222222",
    fromAddress: "org@example.com",
    graphClientSecret: "org-secret",
  });

  it("skips validation when the event has no provider of its own (inherits org)", () => {
    const result = validateEventMailSettingsUpdate(null, orgRow, { fromName: "Autumn Summit" }, {});
    expect(result).toEqual({ ok: true });
  });

  it("rejects a provider-less event fromAddress that conflicts with the org's allowed-from-domain", () => {
    // Event sets no provider of its own — it inherits the org's Graph transport, so a
    // fromAddress outside the org's allowed-from-domain must still be rejected here,
    // not silently accepted until send time.
    const orgWithDomain = mergeMailSettingsRow(orgRow, { allowedFromDomain: "example.com" });
    const result = validateEventMailSettingsUpdate(
      null,
      orgWithDomain,
      { fromAddress: "cobranded@other.com" },
      {},
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/allowed from domain/i);
    }
  });

  it("rejects an incomplete dedicated event transport even with a valid org fallback", () => {
    const result = validateEventMailSettingsUpdate(
      null,
      orgRow,
      {
        provider: "smtp",
        host: "smtp.event.example.com",
        port: 587,
        fromAddress: "event@example.com",
        // missing user/password — org's Graph credentials can't fill an SMTP gap
      },
      {},
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/user/i);
    }
  });

  it("accepts a complete dedicated event transport that doesn't need the org fallback", () => {
    const result = validateEventMailSettingsUpdate(
      null,
      orgRow,
      {
        provider: "smtp",
        host: "smtp.event.example.com",
        port: 587,
        user: "event-user",
        fromAddress: "event@example.com",
        smtpPassword: "event-secret",
      },
      {},
    );
    expect(result).toEqual({ ok: true });
  });

  it("rejects an event override that redirects the SMTP host while inheriting the org's password", () => {
    // Security: an event-scoped admin (lower privilege than the superadmin-only org Mail
    // Transport panel) must not be able to point the connection at a host they control
    // while the resolved config silently authenticates with the organization's real SMTP
    // password. Without this guard, `tryParseEventMailConfigFromRow` (called from here)
    // would consider the merged row complete and this would return ok:true.
    const orgSmtpRow = mergeMailSettingsRow(null, {
      provider: "smtp",
      host: "smtp.org.example.com",
      port: 587,
      user: "org-user",
      fromAddress: "org@example.com",
      smtpPassword: "org-real-secret",
    });
    const result = validateEventMailSettingsUpdate(
      null,
      orgSmtpRow,
      { host: "smtp.attacker.example.com" },
      {},
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/password/i);
    }
  });

  it("accepts an event override that redirects the Power Automate URL, but must not leak the org's key", () => {
    // Power Automate's `key` is a genuinely optional header (schema: z.string().optional()),
    // so a URL-only override is a *valid* config on its own — it just must not silently
    // carry the org's key to that URL. The leak itself is proven at the resolver level in
    // resolver.test.ts ("event cannot borrow the org secret while redirecting the endpoint").
    const orgPowerAutomateRow = mergeMailSettingsRow(null, {
      provider: "powerautomate",
      fromAddress: "org@example.com",
      powerAutomateUrl: "https://org.example.com/flow",
      powerAutomateKey: "org-real-key",
    });
    const result = validateEventMailSettingsUpdate(
      null,
      orgPowerAutomateRow,
      { powerAutomateUrl: "https://attacker.example.com/flow" },
      {},
    );
    expect(result).toEqual({ ok: true });
  });

  it("resolves a partial event update against the org row as fallback", () => {
    // Event sets its own from address only — provider/mailbox/tenant/client/secret
    // all come from the org row, mirroring resolveMailConfig's own precedence.
    const currentEventRow = mergeMailSettingsRow(null, { provider: "graph" });
    const result = validateEventMailSettingsUpdate(
      currentEventRow,
      orgRow,
      { fromAddress: "cobranded@example.com" },
      {},
    );
    expect(result).toEqual({ ok: true });
  });

  it("prefers the event's own allowed-from-domain over the org's when both are set", () => {
    const orgWithDomain = mergeMailSettingsRow(orgRow, { allowedFromDomain: "org.example.com" });
    const result = validateEventMailSettingsUpdate(
      null,
      orgWithDomain,
      {
        provider: "smtp",
        host: "smtp.event.example.com",
        port: 587,
        user: "event-user",
        fromAddress: "event@other.com",
        allowedFromDomain: "other.com",
        smtpPassword: "event-secret",
      },
      {},
    );
    expect(result).toEqual({ ok: true });
  });
});
