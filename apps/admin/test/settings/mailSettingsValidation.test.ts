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

    const errors = validateMailDraft(draft);

    expect(errors.port).toBe("SMTP port must be between 1 and 65535.");
  });

  it("accepts a valid integer port", () => {
    const draft = { ...emptyMailDraft(), provider: "smtp" as const, host: "smtp.example.com", port: "587" };

    const errors = validateMailDraft(draft);

    expect(errors.port).toBeUndefined();
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

    expect(result).toEqual({});
  });

  it("reports all SMTP sender and connection errors together, keyed by field", () => {
    const result = validateMailDraft({
      ...emptyMailDraft(),
      provider: "smtp",
      replyTo: "bad-reply-to",
      envelopeFrom: "bad-envelope",
      fromAddress: "bad-from",
      host: " ",
      port: "70000",
    });

    expect(result).toEqual({
      replyTo: "Reply-to must be a valid email.",
      envelopeFrom: "Envelope from must be a valid email.",
      fromAddress: "From address must be a valid email.",
      host: "SMTP host is required.",
      port: "SMTP port must be between 1 and 65535.",
    });
  });

  it("rejects an email address with a single-character TLD", () => {
    const result = validateMailDraft({
      ...emptyMailDraft(),
      provider: "smtp",
      host: "smtp.example.com",
      port: "587",
      fromAddress: "sender@example.c",
    });

    expect(result.fromAddress).toBe("From address must be a valid email.");
  });

  it("accepts an email address with a two-character TLD", () => {
    const result = validateMailDraft({
      ...emptyMailDraft(),
      provider: "smtp",
      host: "smtp.example.com",
      port: "587",
      fromAddress: "sender@example.co",
    });

    expect(result.fromAddress).toBeUndefined();
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
      mailbox: "service@other.org",
      allowedFromDomain: "example.com",
    });

    expect(matchingMailbox).toEqual({});
    expect(mismatchedMailbox.mailbox).toBe("Mailbox must use the allowed domain (example.com).");
  });

  it("requires Graph credentials and a valid mailbox or sender", () => {
    const result = validateMailDraft({
      ...emptyMailDraft(),
      provider: "graph",
      mailbox: "not-an-email",
    });

    expect(result).toEqual({
      tenantId: "Tenant ID is required.",
      clientId: "Client ID is required.",
      mailbox: "Mailbox must be a valid email.",
    });
  });

  it("requires one Graph sender when neither a mailbox nor a from address is supplied", () => {
    const result = validateMailDraft({
      ...emptyMailDraft(),
      provider: "graph",
      tenantId: "tenant-id",
      clientId: "client-id",
    });

    expect(result).toEqual({ mailbox: "Mailbox or from address is required." });
  });

  it("does not apply an allowed-domain check when the selected provider has no sender", () => {
    const result = validateMailDraft({
      ...emptyMailDraft(),
      provider: "smtp",
      host: "smtp.example.com",
      port: "587",
      allowedFromDomain: "example.com",
    });

    expect(result).toEqual({ fromAddress: "From address must be a valid email." });
  });

  it.each(["powerautomate", "export_only"] as const)("requires a sender for %s", (provider) => {
    const result = validateMailDraft({ ...emptyMailDraft(), provider });

    expect(result.fromAddress).toBe("From address must be a valid email.");
  });
});

describe("validateMailDraft — field length and format guards", () => {
  it("caps free-text sender fields at the server's own length limits", () => {
    const result = validateMailDraft({
      ...emptyMailDraft(),
      provider: "smtp",
      host: "smtp.example.com",
      port: "587",
      fromAddress: "sender@example.com",
      fromName: "x".repeat(201),
      replyTo: `${"x".repeat(250)}@example.com`,
    });

    expect(result.fromName).toBe("Keep it under 200 characters.");
    expect(result.replyTo).toBe("Keep it under 254 characters.");
  });

  it("requires Allowed from domain to look like a bare domain", () => {
    const noDot = validateMailDraft({
      ...emptyMailDraft(),
      provider: "smtp",
      host: "smtp.example.com",
      port: "587",
      fromAddress: "sender@example.com",
      allowedFromDomain: "notadomain",
    });
    const withScheme = validateMailDraft({
      ...emptyMailDraft(),
      provider: "smtp",
      host: "smtp.example.com",
      port: "587",
      fromAddress: "sender@example.com",
      allowedFromDomain: "https://example.com",
    });
    const valid = validateMailDraft({
      ...emptyMailDraft(),
      provider: "smtp",
      host: "smtp.example.com",
      port: "587",
      fromAddress: "sender@example.com",
      allowedFromDomain: "example.com",
    });

    expect(noDot.allowedFromDomain).toBe("Enter a bare domain, e.g. example.com.");
    expect(withScheme.allowedFromDomain).toBe("Enter a bare domain, e.g. example.com.");
    expect(valid.allowedFromDomain).toBeUndefined();
  });

  it("rejects a scheme without the double slash, e.g. a pasted 'http:example.com'", () => {
    const result = validateMailDraft({
      ...emptyMailDraft(),
      provider: "smtp",
      host: "smtp.example.com",
      port: "587",
      fromAddress: "sender@example.com",
      allowedFromDomain: "http:example.com",
    });

    expect(result.allowedFromDomain).toBe("Enter a bare domain, e.g. example.com.");
  });

  it.each(["local", "test", "invalid", "example", "localhost", "internal", "lan", "corp", "con"])(
    "rejects Allowed from domain '.%s' - not a real IANA-delegated TLD",
    (fakeTld) => {
      const result = validateMailDraft({
        ...emptyMailDraft(),
        provider: "smtp",
        host: "smtp.example.com",
        port: "587",
        fromAddress: "sender@example.com",
        allowedFromDomain: `mail.${fakeTld}`,
      });

      expect(result.allowedFromDomain).toBe("Enter a bare domain, e.g. example.com.");
    },
  );

  it.each(["com", "co", "io", "org", "net", "pl", "xyz", "dev"])(
    "accepts Allowed from domain '.%s' - a real IANA-delegated TLD",
    (realTld) => {
      const result = validateMailDraft({
        ...emptyMailDraft(),
        provider: "smtp",
        host: "smtp.example.com",
        port: "587",
        fromAddress: `sender@example.${realTld}`,
        allowedFromDomain: `example.${realTld}`,
      });

      expect(result.allowedFromDomain).toBeUndefined();
    },
  );

  it("rejects a From address on a reserved, non-delegated TLD like .local", () => {
    const result = validateMailDraft({
      ...emptyMailDraft(),
      provider: "smtp",
      host: "smtp.example.com",
      port: "587",
      fromAddress: "admin@mailserver.local",
    });

    expect(result.fromAddress).toBe("From address must be a valid email.");
  });

  it("does not also run the domain-mismatch check when the domain field itself is malformed", () => {
    const result = validateMailDraft({
      ...emptyMailDraft(),
      provider: "smtp",
      host: "smtp.example.com",
      port: "587",
      fromAddress: "sender@example.com",
      allowedFromDomain: "not a domain",
    });

    expect(result.allowedFromDomain).toBe("Enter a bare domain, e.g. example.com.");
    expect(result.fromAddress).toBeUndefined();
  });

  it("rejects a HELO/EHLO name with spaces or over the length limit", () => {
    const withSpace = validateMailDraft({
      ...emptyMailDraft(),
      provider: "smtp",
      host: "smtp.example.com",
      port: "587",
      heloName: "mail server",
    });
    const tooLong = validateMailDraft({
      ...emptyMailDraft(),
      provider: "smtp",
      host: "smtp.example.com",
      port: "587",
      heloName: "x".repeat(254),
    });

    expect(withSpace.heloName).toBe("Must not contain spaces.");
    expect(tooLong.heloName).toBe("Keep it under 253 characters.");
  });

  it.each([
    ["rateLimitPerMinute", "Rate limit"],
    ["maxConnections", "Max connections"],
    ["maxMessages", "Max messages per connection"],
    ["connectionTimeout", "Connection timeout"],
    ["greetingTimeout", "Greeting timeout"],
    ["socketTimeout", "Socket timeout"],
  ] as const)("rejects a non-positive-integer %s", (field, label) => {
    const zero = validateMailDraft({
      ...emptyMailDraft(),
      provider: "smtp",
      host: "smtp.example.com",
      port: "587",
      [field]: "0",
    });
    const notNumeric = validateMailDraft({
      ...emptyMailDraft(),
      provider: "smtp",
      host: "smtp.example.com",
      port: "587",
      [field]: "abc",
    });
    const valid = validateMailDraft({
      ...emptyMailDraft(),
      provider: "smtp",
      host: "smtp.example.com",
      port: "587",
      [field]: "5",
    });

    expect(zero[field]).toBe(`${label} must be a positive whole number.`);
    expect(notNumeric[field]).toBe(`${label} must be a positive whole number.`);
    expect(valid[field]).toBeUndefined();
  });

  it("leaves advanced tuning fields unvalidated when blank or the provider isn't SMTP", () => {
    const blank = validateMailDraft({
      ...emptyMailDraft(),
      provider: "smtp",
      host: "smtp.example.com",
      port: "587",
    });
    const nonSmtp = validateMailDraft({
      ...emptyMailDraft(),
      provider: "graph",
      tenantId: "tenant-id",
      clientId: "client-id",
      mailbox: "shared@example.com",
      maxConnections: "-5",
    });

    expect(blank.maxConnections).toBeUndefined();
    expect(nonSmtp.maxConnections).toBeUndefined();
  });

  it("caps Graph tenant/client IDs and mailbox at the server's length limits", () => {
    const result = validateMailDraft({
      ...emptyMailDraft(),
      provider: "graph",
      tenantId: "x".repeat(65),
      clientId: "x".repeat(65),
      mailbox: `${"x".repeat(250)}@example.com`,
    });

    expect(result.tenantId).toBe("Keep it under 64 characters.");
    expect(result.clientId).toBe("Keep it under 64 characters.");
    expect(result.mailbox).toBe("Keep it under 254 characters.");
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
