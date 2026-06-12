import { describe, expect, it } from "vitest";
import {
  formatInvalidUrlMessage,
  validateHttpUrl,
  InvalidHttpUrlError,
} from "../src/escape.js";

describe("formatInvalidUrlMessage", () => {
  it("uses admin-friendly labels in branding context", () => {
    expect(formatInvalidUrlMessage("logo_url", "branding")).toBe(
      "Logo URL must be a full http:// or https:// URL.",
    );
    expect(formatInvalidUrlMessage("header_image_url", "branding")).toBe(
      "Header image URL must be a full http:// or https:// URL.",
    );
  });

  it("uses template labels in render context", () => {
    expect(formatInvalidUrlMessage("ticket_url", "template")).toBe(
      "Ticket link must be a full http:// or https:// URL when rendering the email.",
    );
    expect(formatInvalidUrlMessage("qr_image_url", "template")).toBe(
      "QR image URL must be a full http:// or https:// URL when rendering the email.",
    );
  });
});

describe("validateHttpUrl", () => {
  it("throws branding-context message from setBranding path", () => {
    try {
      validateHttpUrl("logo_url", "ftp://bad.example/logo.png", "branding");
      expect.fail("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidHttpUrlError);
      expect((err as InvalidHttpUrlError).message).toBe(
        "Logo URL must be a full http:// or https:// URL.",
      );
      expect((err as InvalidHttpUrlError).context).toBe("branding");
    }
  });

  it("throws template-context message from render path", () => {
    try {
      validateHttpUrl("ticket_url", "not-a-url", "template");
      expect.fail("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidHttpUrlError);
      expect((err as InvalidHttpUrlError).message).toBe(
        "Ticket link must be a full http:// or https:// URL when rendering the email.",
      );
      expect((err as InvalidHttpUrlError).context).toBe("template");
    }
  });
});
