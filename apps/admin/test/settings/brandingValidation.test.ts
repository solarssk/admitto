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

  it("accepts a built-in font name alone with no saved custom families", () => {
    const nameOnly = validateBrandingDraft({ font_family_name: "Georgia" });
    expect(nameOnly.valid).toBe(true);
    expect(nameOnly.errors.custom_font_families).toBeUndefined();
  });

  it("rejects font family name with HTML/CSS metacharacters", () => {
    const result = validateBrandingDraft({ font_family_name: 'test</style><script>evil</script>' });
    expect(result.valid).toBe(false);
    expect(result.errors.font_family_name).toMatch(/letters, numbers/i);
  });

  it("accepts a saved custom family with a single valid HTTPS variant", () => {
    const result = validateBrandingDraft({
      font_family_name: "Brand Sans",
      custom_font_families: [
        { name: "Brand Sans", variants: [{ weight: 400, style: "normal", url: "https://cdn.example.com/font.woff2" }] },
      ],
    });
    expect(result.valid).toBe(true);
  });

  it("accepts multiple saved families and multiple weight/style variants under one family", () => {
    const result = validateBrandingDraft({
      font_family_name: "Brand Sans",
      custom_font_families: [
        {
          name: "Brand Sans",
          variants: [
            { weight: 400, style: "normal", url: "https://cdn.example.com/regular.woff2" },
            { weight: 700, style: "normal", url: "https://cdn.example.com/bold.woff2" },
          ],
        },
        { name: "Other Family", variants: [{ weight: 400, style: "normal", url: "https://cdn.example.com/other.woff2" }] },
      ],
    });
    expect(result.valid).toBe(true);
  });

  it("rejects a family with an invalid own name", () => {
    const result = validateBrandingDraft({
      custom_font_families: [
        { name: "bad</name>", variants: [{ weight: 400, style: "normal", url: "https://cdn.example.com/font.woff2" }] },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.custom_font_families).toBeTruthy();
  });

  it("rejects a family with zero variants", () => {
    const result = validateBrandingDraft({
      custom_font_families: [{ name: "Brand Sans", variants: [] }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.custom_font_families).toBeTruthy();
  });

  it("rejects a family containing a non-HTTPS variant URL", () => {
    const result = validateBrandingDraft({
      custom_font_families: [
        { name: "Brand Sans", variants: [{ weight: 400, style: "normal", url: "http://evil.com/font.woff2" }] },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.custom_font_families).toBeTruthy();
  });

  it("rejects a family containing a credentialed HTTPS variant URL", () => {
    const result = validateBrandingDraft({
      custom_font_families: [
        {
          name: "Brand Sans",
          variants: [{ weight: 400, style: "normal", url: "https://user:pass@example.com/font.woff2" }],
        },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.custom_font_families).toBeTruthy();
  });

  it("rejects a family containing an out-of-range font weight", () => {
    const result = validateBrandingDraft({
      custom_font_families: [
        { name: "Brand Sans", variants: [{ weight: 950, style: "normal", url: "https://cdn.example.com/font.woff2" }] },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.custom_font_families).toBeTruthy();
  });

  it("rejects a family with a variant path outside the theme upload namespace", () => {
    const result = validateBrandingDraft({
      custom_font_families: [
        {
          name: "Brand Sans",
          variants: [{ weight: 400, style: "normal", url: "/uploads/default/events/evt-1/abc123.woff2" }],
        },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.custom_font_families).toBeTruthy();
  });

  it("accepts a validated local theme upload path", () => {
    const result = validateBrandingDraft({
      font_family_name: "Brand Sans",
      custom_font_families: [
        { name: "Brand Sans", variants: [{ weight: 400, style: "normal", url: "/uploads/default/theme/abc123.woff2" }] },
      ],
    });
    expect(result.valid).toBe(true);
  });

  it("rejects a custom family named after a built-in font, case-insensitively", () => {
    const result = validateBrandingDraft({
      custom_font_families: [
        { name: "manrope", variants: [{ weight: 400, style: "normal", url: "https://cdn.example.com/font.woff2" }] },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.custom_font_families).toBeTruthy();
  });
});

describe("brandingDraftForSave", () => {
  it("omits an invalid primary but keeps a valid font name on its own", () => {
    expect(brandingDraftForSave({ primary: "bad", font_family_name: "Evil" })).toEqual({ font_family_name: "Evil" });
  });

  it("drops a family whose only variant has a credentialed HTTPS URL", () => {
    expect(
      brandingDraftForSave({
        font_family_name: "Brand Sans",
        custom_font_families: [
          {
            name: "Brand Sans",
            variants: [{ weight: 400, style: "normal", url: "https://user:pass@example.com/font.woff2" }],
          },
        ],
      }),
    ).toEqual({ font_family_name: "Brand Sans" });
  });

  it("drops only the invalid variants within a family, keeping the valid ones", () => {
    expect(
      brandingDraftForSave({
        font_family_name: "Brand Sans",
        custom_font_families: [
          {
            name: "Brand Sans",
            variants: [
              { weight: 400, style: "normal", url: "https://cdn.example.com/regular.woff2" },
              { weight: 700, style: "normal", url: "http://evil.com/bold.woff2" },
            ],
          },
        ],
      }),
    ).toEqual({
      font_family_name: "Brand Sans",
      custom_font_families: [
        { name: "Brand Sans", variants: [{ weight: 400, style: "normal", url: "https://cdn.example.com/regular.woff2" }] },
      ],
    });
  });

  it("drops a whole family that has zero valid variants left, keeping the others", () => {
    expect(
      brandingDraftForSave({
        font_family_name: "Good Family",
        custom_font_families: [
          { name: "Bad Family", variants: [{ weight: 400, style: "normal", url: "http://evil.com/font.woff2" }] },
          { name: "Good Family", variants: [{ weight: 400, style: "normal", url: "https://cdn.example.com/font.woff2" }] },
        ],
      }),
    ).toEqual({
      font_family_name: "Good Family",
      custom_font_families: [
        { name: "Good Family", variants: [{ weight: 400, style: "normal", url: "https://cdn.example.com/font.woff2" }] },
      ],
    });
  });

  it("omits font_family_name when it sanitizes to empty", () => {
    expect(brandingDraftForSave({ font_family_name: "</>" })).toEqual({});
  });

  it("keeps valid fields", () => {
    expect(
      brandingDraftForSave({
        primary: "#112233",
        font_family_name: "Brand Sans",
        custom_font_families: [
          { name: "Brand Sans", variants: [{ weight: 400, style: "normal", url: "https://cdn.example.com/font.woff2" }] },
        ],
      }),
    ).toEqual({
      primary: "#112233",
      font_family_name: "Brand Sans",
      custom_font_families: [
        { name: "Brand Sans", variants: [{ weight: 400, style: "normal", url: "https://cdn.example.com/font.woff2" }] },
      ],
    });
  });

  it("keeps a validated local theme upload path", () => {
    expect(
      brandingDraftForSave({
        font_family_name: "Brand Sans",
        custom_font_families: [
          { name: "Brand Sans", variants: [{ weight: 400, style: "normal", url: "/uploads/default/theme/abc123.woff2" }] },
        ],
      }),
    ).toEqual({
      font_family_name: "Brand Sans",
      custom_font_families: [
        { name: "Brand Sans", variants: [{ weight: 400, style: "normal", url: "/uploads/default/theme/abc123.woff2" }] },
      ],
    });
  });

  it("drops a whole family named after a built-in font, keeping the others", () => {
    expect(
      brandingDraftForSave({
        font_family_name: "Good Family",
        custom_font_families: [
          { name: "Space Grotesk", variants: [{ weight: 400, style: "normal", url: "https://cdn.example.com/a.woff2" }] },
          { name: "Good Family", variants: [{ weight: 400, style: "normal", url: "https://cdn.example.com/b.woff2" }] },
        ],
      }),
    ).toEqual({
      font_family_name: "Good Family",
      custom_font_families: [
        { name: "Good Family", variants: [{ weight: 400, style: "normal", url: "https://cdn.example.com/b.woff2" }] },
      ],
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
        font_family_name: "Evil",
        custom_font_families: [{ name: "Evil", variants: [{ weight: 400, style: "normal", url: "javascript:alert(1)" }] }],
      }),
    ).not.toThrow();
    const vars = resolveThemeVars({
      primary: "not-a-color",
      font_family_name: "Evil",
      custom_font_families: [{ name: "Evil", variants: [{ weight: 400, style: "normal", url: "javascript:alert(1)" }] }],
    });
    expect(vars["--primary"]).toBe("#066fd1");
    // The font name ("Evil") is valid on its own and applies as a web-safe font; only the
    // unsafe variant URL is dropped (no @font-face for it) — see theme.test.ts for coverage.
    expect(vars["--font-sans"]).toContain("Evil");
    expect(vars.fontFaceCss).toBeUndefined();
  });
});
