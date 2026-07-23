import { describe, expect, it } from "vitest";
import {
  buildSaveMailSettingsBody,
  emptyMailDraft,
  emptySecretEdits,
  isMailSettingsDirty,
  smtpProviderDraftDefaults,
  validateMailDraft,
} from "../../src/settings/mailSettingsValidation.js";

describe("validateMailDraft — SMTP port", () => {
  it("rejects a non-integer port string", () => {
    const draft = { ...emptyMailDraft(), provider: "smtp" as const, host: "smtp.example.com", port: "25.5" };

    const { valid, errors } = validateMailDraft(draft);

    expect(valid).toBe(false);
    expect(errors).toContain("SMTP port must be between 1 and 65535.");
  });

  it("accepts a valid integer port", () => {
    const draft = { ...emptyMailDraft(), provider: "smtp" as const, host: "smtp.example.com", port: "587" };

    const { errors } = validateMailDraft(draft);

    expect(errors).not.toContain("SMTP port must be between 1 and 65535.");
  });
});

describe("validateMailDraft — provider-specific requirements", () => {
  it("does not validate optional sender fields before a provider is selected", () => {
    const result = validateMailDraft({
      ...emptyMailDraft(),
      replyTo: "not-an-email",
      envelopeFrom: "also-not-an-email",
      fromAddress: "still-not-an-email",
    });

    expect(result).toEqual({ valid: true, errors: [] });
  });

  it("reports all SMTP sender and connection errors together", () => {
    const result = validateMailDraft({
      ...emptyMailDraft(),
      provider: "smtp",
      replyTo: "bad-reply-to",
      envelopeFrom: "bad-envelope",
      fromAddress: "bad-from",
      host: " ",
      port: "70000",
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "Reply-to must be a valid email.",
        "Envelope from must be a valid email.",
        "From address must be a valid email.",
        "SMTP host is required.",
        "SMTP port must be between 1 and 65535.",
      ]),
    );
  });

  it("uses the Graph mailbox as the effective sender for allowed-domain validation", () => {
    const matchingMailbox = validateMailDraft({
      ...emptyMailDraft(),
      provider: "graph",
      tenantId: "tenant-id",
      clientId: "client-id",
      mailbox: "service@EXAMPLE.com",
      allowedFromDomain: "@example.com",
    });
    const mismatchedMailbox = validateMailDraft({
      ...emptyMailDraft(),
      provider: "graph",
      tenantId: "tenant-id",
      clientId: "client-id",
      mailbox: "service@other.example",
      allowedFromDomain: "example.com",
    });

    expect(matchingMailbox).toEqual({ valid: true, errors: [] });
    expect(mismatchedMailbox.errors).toContain(
      "From address must use the allowed domain (example.com).",
    );
  });

  it("requires Graph credentials and a valid mailbox or sender", () => {
    const result = validateMailDraft({
      ...emptyMailDraft(),
      provider: "graph",
      mailbox: "not-an-email",
    });

    expect(result.errors).toEqual(
      expect.arrayContaining([
        "Tenant ID is required.",
        "Client ID is required.",
        "Mailbox must be a valid email.",
      ]),
    );
    expect(result.errors).not.toContain("Mailbox or from address is required.");
  });

  it("requires one Graph sender when neither a mailbox nor a from address is supplied", () => {
    const result = validateMailDraft({
      ...emptyMailDraft(),
      provider: "graph",
      tenantId: "tenant-id",
      clientId: "client-id",
    });

    expect(result.errors).toEqual(["Mailbox or from address is required."]);
  });

  it("does not apply an allowed-domain check when the selected provider has no sender", () => {
    const result = validateMailDraft({
      ...emptyMailDraft(),
      provider: "smtp",
      host: "smtp.example.com",
      port: "587",
      allowedFromDomain: "example.com",
    });

    expect(result.errors).toEqual(["From address must be a valid email."]);
  });

  it.each(["powerautomate", "export_only"] as const)("requires a sender for %s", (provider) => {
    const result = validateMailDraft({ ...emptyMailDraft(), provider });

    expect(result.errors).toContain("From address must be a valid email.");
  });
});

describe("buildSaveMailSettingsBody", () => {
  it("serializes SMTP settings, normalizes inputs, and carries intentional secret edits", () => {
    const draft = {
      ...emptyMailDraft(),
      provider: "smtp" as const,
      fromAddress: " sender@example.com ",
      fromName: " Admitto ",
      replyTo: " replies@example.com ",
      envelopeFrom: " envelope@example.com ",
      allowedFromDomain: " example.com ",
      host: " smtp.example.com ",
      port: " 587 ",
      secure: true,
      requireTls: false,
      tlsRejectUnauthorized: false,
      user: " smtp-user ",
      heloName: " mailer.example.com ",
      pool: false,
      maxConnections: " 3 ",
      maxMessages: " ",
      rateLimitPerMinute: "120",
      connectionTimeout: "1000",
      greetingTimeout: "2000",
      socketTimeout: "3000",
    };
    const secrets = {
      ...emptySecretEdits(),
      smtpPassword: { mode: "replace" as const, value: "new-password" },
      graphClientSecret: { mode: "clear" as const, value: "ignored" },
    };

    const body = buildSaveMailSettingsBody(draft, secrets);

    expect(body).toMatchObject({
      provider: "smtp",
      fromAddress: "sender@example.com",
      fromName: "Admitto",
      replyTo: "replies@example.com",
      envelopeFrom: "envelope@example.com",
      allowedFromDomain: "example.com",
      host: "smtp.example.com",
      port: 587,
      secure: true,
      requireTls: false,
      tlsRejectUnauthorized: false,
      user: "smtp-user",
      heloName: "mailer.example.com",
      pool: false,
      maxConnections: 3,
      maxMessages: null,
      rateLimitPerMinute: 120,
      connectionTimeout: 1000,
      greetingTimeout: 2000,
      socketTimeout: 3000,
      smtpPassword: "new-password",
      graphClientSecret: "",
    });
    expect(body).not.toHaveProperty("mailbox");
  });

  it("serializes Graph fields and omits fields locked by their source", () => {
    const draft = {
      ...emptyMailDraft(),
      provider: "graph" as const,
      fromAddress: "sender@example.com",
      mailbox: "mailbox@example.com",
      tenantId: " tenant-id ",
      clientId: " client-id ",
      saveToSentItems: false,
      host: "smtp.example.com",
    };
    const secrets = {
      ...emptySecretEdits(),
      graphClientSecret: { mode: "replace" as const, value: "graph-secret" },
      smtpPassword: { mode: "replace" as const, value: "must-not-send" },
    };

    // Locked environment-backed fields must not be sent back in the update. Secret
    // edits themselves are provider-agnostic, so this deliberately verifies the
    // lock rather than implying that Graph filters SMTP secrets by provider.
    const body = buildSaveMailSettingsBody(draft, secrets, new Set(["fromAddress", "smtpPassword"]));

    expect(body).toMatchObject({
      provider: "graph",
      mailbox: "mailbox@example.com",
      tenantId: "tenant-id",
      clientId: "client-id",
      saveToSentItems: false,
      graphClientSecret: "graph-secret",
    });
    expect(body).not.toHaveProperty("fromAddress");
    expect(body).not.toHaveProperty("smtpPassword");
    expect(body).not.toHaveProperty("host");
  });

  it("omits locked provider-specific fields and ignores an empty replacement secret", () => {
    const draft = {
      ...emptyMailDraft(),
      provider: "smtp" as const,
      host: "smtp.example.com",
      port: "not-a-number",
      user: "smtp-user",
      heloName: "helo.example.com",
      maxConnections: "3",
      maxMessages: "4",
      rateLimitPerMinute: "5",
      connectionTimeout: "6",
      greetingTimeout: "7",
      socketTimeout: "8",
    };
    const lockedKeys = new Set([
      "provider",
      "host",
      "port",
      "secure",
      "requireTls",
      "tlsRejectUnauthorized",
      "user",
      "heloName",
      "pool",
      "maxConnections",
      "maxMessages",
      "rateLimitPerMinute",
      "connectionTimeout",
      "greetingTimeout",
      "socketTimeout",
    ] as const);

    const body = buildSaveMailSettingsBody(
      draft,
      { ...emptySecretEdits(), smtpPassword: { mode: "replace", value: "" } },
      lockedKeys,
    );

    expect(body).not.toHaveProperty("provider");
    expect(body).not.toHaveProperty("host");
    expect(body).not.toHaveProperty("port");
    expect(body).not.toHaveProperty("smtpPassword");
  });

  it("clears blank Graph fields and omits Graph fields locked by their source", () => {
    const draft = {
      ...emptyMailDraft(),
      provider: "graph" as const,
      mailbox: " ",
      tenantId: " tenant-id ",
      clientId: " client-id ",
      saveToSentItems: false,
    };

    const body = buildSaveMailSettingsBody(
      draft,
      emptySecretEdits(),
      new Set(["tenantId", "clientId", "saveToSentItems"]),
    );

    expect(body).toMatchObject({ provider: "graph", mailbox: "" });
    expect(body).not.toHaveProperty("tenantId");
    expect(body).not.toHaveProperty("clientId");
    expect(body).not.toHaveProperty("saveToSentItems");
  });
});

describe("isMailSettingsDirty", () => {
  it("detects both draft changes and intentional secret edits", () => {
    const saved = emptyMailDraft();

    expect(isMailSettingsDirty(saved, saved, emptySecretEdits())).toBe(false);
    expect(isMailSettingsDirty({ ...saved, host: "smtp.example.com" }, saved, emptySecretEdits())).toBe(true);
    expect(
      isMailSettingsDirty(saved, saved, {
        ...emptySecretEdits(),
        smtpPassword: { mode: "clear", value: "" },
      }),
    ).toBe(true);
  });
});

describe("smtpProviderDraftDefaults", () => {
  it("uses the secure transport defaults expected by a new SMTP selection", () => {
    expect(smtpProviderDraftDefaults()).toEqual({
      pool: true,
      requireTls: true,
      tlsRejectUnauthorized: true,
      secure: false,
    });
  });
});
