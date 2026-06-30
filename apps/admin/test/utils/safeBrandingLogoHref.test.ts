import { describe, expect, it } from "vitest";
import { safeBrandingLogoHref } from "../../src/utils/safeBrandingLogoHref.js";

describe("safeBrandingLogoHref", () => {
  it("accepts local upload paths", () => {
    expect(safeBrandingLogoHref("/uploads/default/logo.png")).toBe("/uploads/default/logo.png");
    expect(safeBrandingLogoHref("/uploads/default/events/evt-1/logo.webp")).toBe(
      "/uploads/default/events/evt-1/logo.webp",
    );
  });

  it("accepts valid HTTPS URLs", () => {
    expect(safeBrandingLogoHref("https://cdn.example.com/logo.png")).toBe(
      "https://cdn.example.com/logo.png",
    );
  });

  it("rejects http and relative paths without /uploads/", () => {
    expect(safeBrandingLogoHref("http://example.com/logo.png")).toBeNull();
    expect(safeBrandingLogoHref("logo.png")).toBeNull();
    expect(safeBrandingLogoHref("https://user:pass@example.com/logo.png")).toBeNull();
    expect(safeBrandingLogoHref("/uploads/default/../evil.png")).toBeNull();
    expect(safeBrandingLogoHref("/uploads/default/not-an-image.svg")).toBeNull();
  });
});
