import { describe, expect, it } from "vitest";
import {
  isLocalBrandingFontPath,
  isSafeBrandingFontUrl,
  isValidBrandingFontFamilyName,
  isValidBrandingFontWeight,
  resolveThemeVars,
  themeVarsToStyleBlock,
} from "../src/theme.js";

describe("isValidBrandingFontFamilyName", () => {
  it("rejects forbidden characters after repeated calls (no global regex lastIndex drift)", () => {
    expect(isValidBrandingFontFamilyName("Brand Sans")).toBe(true);
    expect(isValidBrandingFontFamilyName("</style>evil")).toBe(false);
    expect(isValidBrandingFontFamilyName("Brand Sans")).toBe(true);
  });
});

describe("isValidBrandingFontWeight", () => {
  it("accepts the full 100-900 CSS numeric range", () => {
    expect(isValidBrandingFontWeight(100)).toBe(true);
    expect(isValidBrandingFontWeight(400)).toBe(true);
    expect(isValidBrandingFontWeight(900)).toBe(true);
  });

  it("rejects out-of-range or non-integer weights", () => {
    expect(isValidBrandingFontWeight(50)).toBe(false);
    expect(isValidBrandingFontWeight(950)).toBe(false);
    expect(isValidBrandingFontWeight(450.5)).toBe(false);
  });
});

describe("isLocalBrandingFontPath", () => {
  it("accepts a validated local theme upload path for each allowed extension", () => {
    for (const ext of ["woff2", "woff", "ttf", "otf"]) {
      expect(isLocalBrandingFontPath(`/uploads/default/theme/abc123.${ext}`)).toBe(true);
    }
  });

  it("rejects directory traversal", () => {
    expect(isLocalBrandingFontPath("/uploads/default/theme/../../etc/passwd.woff2")).toBe(false);
  });

  it("rejects an unsupported extension", () => {
    expect(isLocalBrandingFontPath("/uploads/default/theme/abc123.exe")).toBe(false);
  });

  it("rejects a path outside the theme upload namespace", () => {
    expect(isLocalBrandingFontPath("/uploads/default/abc123.woff2")).toBe(false);
    expect(isLocalBrandingFontPath("/uploads/default/events/evt-1/abc123.woff2")).toBe(false);
  });

  it("rejects a non-/uploads/ path", () => {
    expect(isLocalBrandingFontPath("/etc/passwd")).toBe(false);
  });
});

describe("isSafeBrandingFontUrl", () => {
  it("accepts a validated local theme upload path", () => {
    expect(isSafeBrandingFontUrl("/uploads/default/theme/abc123.woff2")).toBe(true);
  });

  it("accepts an external https URL", () => {
    expect(isSafeBrandingFontUrl("https://cdn.example.com/fonts/brand.woff2")).toBe(true);
  });

  it("rejects a plain http URL", () => {
    expect(isSafeBrandingFontUrl("http://cdn.example.com/fonts/brand.woff2")).toBe(false);
  });

  it("rejects an overlong URL", () => {
    expect(isSafeBrandingFontUrl(`https://cdn.example.com/${"a".repeat(2048)}.woff2`)).toBe(false);
  });

  it("rejects a garbage string", () => {
    expect(isSafeBrandingFontUrl("not a url")).toBe(false);
  });
});

describe("resolveThemeVars", () => {
  it("uses default primary when invalid", () => {
    const vars = resolveThemeVars({ primary: "not-a-color" });
    expect(vars["--primary"]).toBe("#066fd1");
  });

  it("accepts valid hex primary", () => {
    const vars = resolveThemeVars({ primary: "#ff0000" });
    expect(vars["--primary"]).toBe("#ff0000");
    expect(vars["--primary-hover"]).toMatch(/^#/);
  });

  it("omits font vars entirely when the font name sanitizes to empty, regardless of saved families", () => {
    const vars = resolveThemeVars({
      custom_font_families: [
        { name: "", variants: [{ weight: 400, style: "normal", url: "https://cdn.example.com/fonts/brand.woff2" }] },
      ],
      font_family_name: "</>",
    });
    expect(vars["--font-sans"]).toBeUndefined();
    expect(vars.fontFaceCss).toBeUndefined();
  });

  it.each([
    ["unsafe variant URL (javascript:)", "javascript:alert(1)", "Evil"],
    ["credentialed HTTPS variant URL", "https://user:pass@example.com/fonts/brand.woff2", "Brand Sans"],
  ])(
    "applies a valid font name as a web-safe font but skips @font-face when the variant URL is a %s",
    (_label, variantUrl, fontFamilyName) => {
      const vars = resolveThemeVars({
        custom_font_families: [{ name: fontFamilyName, variants: [{ weight: 400, style: "normal", url: variantUrl }] }],
        font_family_name: fontFamilyName,
      });
      expect(vars["--font-sans"]).toContain(fontFamilyName);
      expect(vars.fontFaceCss).toBeUndefined();
    },
  );

  it("applies a web-safe font (name only, no saved families at all) with no @font-face", () => {
    const vars = resolveThemeVars({ font_family_name: "Georgia" });
    expect(vars["--font-sans"]).toBe('"Georgia", Inter, system-ui, sans-serif');
    expect(vars.fontFaceCss).toBeUndefined();
  });

  it("does not emit @font-face when the name doesn't match any saved family (built-in pick)", () => {
    const vars = resolveThemeVars({
      font_family_name: "Manrope",
      custom_font_families: [
        { name: "Brand Sans", variants: [{ weight: 400, style: "normal", url: "https://cdn.example.com/font.woff2" }] },
      ],
    });
    expect(vars["--font-sans"]).toContain("Manrope");
    expect(vars.fontFaceCss).toBeUndefined();
  });

  it("accepts a single valid HTTPS variant from the matching saved family", () => {
    const vars = resolveThemeVars({
      custom_font_families: [
        { name: "Brand Sans", variants: [{ weight: 400, style: "normal", url: "https://cdn.example.com/fonts/brand.woff2" }] },
      ],
      font_family_name: "Brand Sans",
    });
    expect(vars["--font-sans"]).toContain("Brand Sans");
    expect(vars["--font-sans"]).toContain("Inter");
    expect(vars.fontFaceCss).toContain("https://cdn.example.com/fonts/brand.woff2");
    expect(vars.fontFaceCss).toContain("font-weight:400");
    expect(vars.fontFaceCss).toContain("font-style:normal");
  });

  it("emits one @font-face rule per weight/style variant, all sharing the family name", () => {
    const vars = resolveThemeVars({
      font_family_name: "Brand Sans",
      custom_font_families: [
        {
          name: "Brand Sans",
          variants: [
            { weight: 400, style: "normal", url: "https://cdn.example.com/regular.woff2" },
            { weight: 700, style: "normal", url: "https://cdn.example.com/bold.woff2" },
            { weight: 400, style: "italic", url: "https://cdn.example.com/italic.woff2" },
          ],
        },
      ],
    });
    const matches = vars.fontFaceCss?.match(/@font-face/g) ?? [];
    expect(matches).toHaveLength(3);
    expect(vars.fontFaceCss).toContain("regular.woff2");
    expect(vars.fontFaceCss).toContain("bold.woff2");
    expect(vars.fontFaceCss).toContain("italic.woff2");
    expect(vars.fontFaceCss).toContain("font-weight:700");
    expect(vars.fontFaceCss).toContain("font-style:italic");
  });

  it("only allowlists the active family's own variants, ignoring other saved-but-unselected families", () => {
    const vars = resolveThemeVars({
      font_family_name: "Active Sans",
      custom_font_families: [
        { name: "Active Sans", variants: [{ weight: 400, style: "normal", url: "https://cdn.example.com/active.woff2" }] },
        { name: "Other Sans", variants: [{ weight: 400, style: "normal", url: "https://cdn.example.com/other.woff2" }] },
      ],
    });
    expect(vars.fontFaceCss).toContain("active.woff2");
    expect(vars.fontFaceCss).not.toContain("other.woff2");
  });

  it("drops only the invalid variants, keeping the valid ones", () => {
    const vars = resolveThemeVars({
      font_family_name: "Brand Sans",
      custom_font_families: [
        {
          name: "Brand Sans",
          variants: [
            { weight: 400, style: "normal", url: "https://cdn.example.com/regular.woff2" },
            { weight: 950, style: "normal", url: "https://cdn.example.com/bad-weight.woff2" },
            { weight: 700, style: "normal", url: "http://insecure.com/bold.woff2" },
          ],
        },
      ],
    });
    expect(vars.fontFaceCss).toContain("regular.woff2");
    expect(vars.fontFaceCss).not.toContain("bad-weight.woff2");
    expect(vars.fontFaceCss).not.toContain("insecure.com");
  });

  it("declares the correct format() per file extension", () => {
    const vars = resolveThemeVars({
      font_family_name: "Brand Sans",
      custom_font_families: [
        {
          name: "Brand Sans",
          variants: [
            { weight: 400, style: "normal", url: "https://cdn.example.com/a.ttf" },
            { weight: 700, style: "normal", url: "https://cdn.example.com/b.otf" },
          ],
        },
      ],
    });
    expect(vars.fontFaceCss).toContain('format("truetype")');
    expect(vars.fontFaceCss).toContain('format("opentype")');
  });

  it("accepts a local theme upload path without throwing (no base URL to resolve against)", () => {
    const vars = resolveThemeVars({
      custom_font_families: [
        { name: "Brand Sans", variants: [{ weight: 400, style: "normal", url: "/uploads/default/theme/abc123.woff2" }] },
      ],
      font_family_name: "Brand Sans",
    });
    expect(vars["--font-sans"]).toContain("Brand Sans");
    expect(vars.fontFaceCss).toContain('url("/uploads/default/theme/abc123.woff2")');
  });

  it("does not emit font-face CSS for injected font family names", () => {
    const payload = 'test</style><script>alert(1)</script><style>';
    // custom_font_families[].name is expected pre-sanitized by the time it reaches here (the
    // real pipeline always sanitizes on save/load, see packages/auth's sanitizeCustomFontFamilies)
    // - resolveThemeVars only sanitizes font_family_name itself before matching against it.
    const sanitizedName = "teststylescriptalert1scriptstyle";
    const vars = resolveThemeVars({
      custom_font_families: [
        { name: sanitizedName, variants: [{ weight: 400, style: "normal", url: "https://cdn.example.com/fonts/brand.woff2" }] },
      ],
      font_family_name: payload,
    });
    expect(vars.fontFaceCss).toBeDefined();
    expect(vars.fontFaceCss).not.toContain("</style>");
    expect(vars.fontFaceCss).not.toContain("<script");
    expect(vars.fontFaceCss).not.toContain("alert(1)");
  });

  it("emits style block with root vars", () => {
    const css = themeVarsToStyleBlock(resolveThemeVars());
    expect(css).toContain(":root");
    expect(css).toContain("--primary:");
  });
});
