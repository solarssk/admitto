import { describe, expect, it } from "vitest";
import { rawMailFieldsFromEnv } from "../src/envFields.js";

describe("rawMailFieldsFromEnv — deploy/.env.example placeholders (#264)", () => {
  it("treats the shipped SMTP_HOST/MAIL_FROM_ADDRESS defaults as unset", () => {
    const fields = rawMailFieldsFromEnv({
      SMTP_HOST: "smtp.example.com",
      MAIL_FROM_ADDRESS: "events@example.com",
    } as NodeJS.ProcessEnv);
    expect(fields.host).toBeUndefined();
    expect(fields.fromAddress).toBeUndefined();
  });

  it("keeps a genuinely different host/fromAddress", () => {
    const fields = rawMailFieldsFromEnv({
      SMTP_HOST: "smtp.mycompany.net",
      MAIL_FROM_ADDRESS: "events@mycompany.net",
    } as NodeJS.ProcessEnv);
    expect(fields.host).toBe("smtp.mycompany.net");
    expect(fields.fromAddress).toBe("events@mycompany.net");
  });

  it("does not touch other example-looking defaults (from name, ports, booleans)", () => {
    const fields = rawMailFieldsFromEnv({
      MAIL_FROM_NAME: "Admitto Events",
      SMTP_PORT: "587",
      SMTP_SECURE: "false",
      SMTP_REQUIRE_TLS: "true",
    } as NodeJS.ProcessEnv);
    expect(fields.fromName).toBe("Admitto Events");
    expect(fields.port).toBe(587);
    expect(fields.secure).toBe(false);
    expect(fields.requireTls).toBe(true);
  });
});
