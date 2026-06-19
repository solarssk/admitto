import { describe, expect, it } from "vitest";
import { resolveThemeVars } from "@admitto/ui";
import {
  brandingDraftForSave,
  primaryForColorInput,
  validateBrandingDraft,
} from "../../src/settings/brandingValidation.js";

describe("validateBrandingDraft", () => {
  it("accepts valid hex primary", () => {
    const result = validateBrandingDraft({ primary: "#aabbcc" });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual({});
  });

  it("rejects invalid hex primary", () => {
    const result = validateBrandingDraft({ primary: "not-a-color" });
    expect(result.valid).toBe(false);
    expect(result.errors.primary).toBeTruthy();
  });

  it("accepts empty primary", () => {
    const result = validateBrandingDraft({});
    expect(result.valid).toBe(true);
  });

  it("requires font name and URL together", () => {
    const nameOnly = validateBrandingDraft({ font_family_name: "Brand Sans" });
    expect(nameOnly.valid).toBe(false);
    expect(nameOnly.errors.font_family_url).toBeTruthy();

    const urlOnly = validateBrandingDraft({
      font_family_url: "https://cdn.example.com/font.woff2",
    });
    expect(urlOnly.valid).toBe(false);
    expect(urlOnly.errors.font_family_name).toBeTruthy();
  });

  it("rejects non-HTTPS font URL", () => {
    const result = validateBrandingDraft({
      font_family_url: "http://evil.com/font.woff2",
      font_family_name: "Evil",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.font_family_url).toMatch(/HTTPS/i);
  });

  it("rejects malformed HTTPS font URL", () => {
    const result = validateBrandingDraft({
      font_family_url: "https://",
      font_family_name: "Brand Sans",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.font_family_url).toBeTruthy();
    expect(result.errors.font_family_name).toBeUndefined();
  });

  it("does not add pair error when URL already has its own validation error", () => {
    const result = validateBrandingDraft({
      font_family_url: "http://evil.com/font.woff2",
      font_family_name: "",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.font_family_url).toMatch(/HTTPS/i);
    expect(result.errors.font_family_name).toBeUndefined();
  });

  it("rejects credentialed HTTPS font URL", () => {
    const result = validateBrandingDraft({
      font_family_url: "https://user:pass@example.com/font.woff2",
      font_family_name: "Brand Sans",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.font_family_url).toMatch(/credentials/i);
    expect(result.errors.font_family_name).toBeUndefined();
  });

  it("rejects font family name with HTML/CSS metacharacters", () => {
    const result = validateBrandingDraft({
      font_family_url: "https://cdn.example.com/font.woff2",
      font_family_name: 'test</style><script>evil</script>',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.font_family_name).toMatch(/letters, numbers/i);
  });

  it("accepts valid HTTPS font pair", () => {
    const result = validateBrandingDraft({
      font_family_url: "https://cdn.example.com/font.woff2",
      font_family_name: "Brand Sans",
    });
    expect(result.valid).toBe(true);
  });
});

describe("brandingDraftForSave", () => {
  it("omits invalid fields", () => {
    expect(
      brandingDraftForSave({
        primary: "bad",
        font_family_url: "http://evil",
        font_family_name: "Evil",
      }),
    ).toEqual({});
    expect(
      brandingDraftForSave({
        font_family_url: "https://user:pass@example.com/font.woff2",
        font_family_name: "Brand Sans",
      }),
    ).toEqual({});
    expect(
      brandingDraftForSave({
        font_family_url: "https://",
        font_family_name: "Brand Sans",
      }),
    ).toEqual({});
  });

  it("keeps valid fields", () => {
    expect(
      brandingDraftForSave({
        primary: "#112233",
        font_family_url: "https://cdn.example.com/font.woff2",
        font_family_name: "Brand Sans",
      }),
    ).toEqual({
      primary: "#112233",
      font_family_url: "https://cdn.example.com/font.woff2",
      font_family_name: "Brand Sans",
    });
  });
});

describe("primaryForColorInput", () => {
  it("falls back to default for invalid primary", () => {
    expect(primaryForColorInput("red")).toBe("#066fd1");
    expect(primaryForColorInput()).toBe("#066fd1");
  });

  it("returns valid hex", () => {
    expect(primaryForColorInput("#ff0000")).toBe("#ff0000");
  });
});

describe("resolveThemeVars on invalid draft", () => {
  it("does not throw on invalid input", () => {
    expect(() =>
      resolveThemeVars({
        primary: "not-a-color",
        font_family_url: "javascript:alert(1)",
        font_family_name: "Evil",
      }),
    ).not.toThrow();
    const vars = resolveThemeVars({
      primary: "not-a-color",
      font_family_url: "javascript:alert(1)",
      font_family_name: "Evil",
    });
    expect(vars["--primary"]).toBe("#066fd1");
    expect(vars["--font-sans"]).toBeUndefined();
  });
});
