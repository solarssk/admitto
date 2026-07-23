import { describe, expect, it } from "vitest";
import { emptyMailDraft, validateMailDraft } from "../../src/settings/mailSettingsValidation.js";

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
