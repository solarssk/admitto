import { describe, expect, it } from "vitest";
import {
  isValidBrandingFontFamilyName,
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

  it("rejects unsafe font URL", () => {
    const vars = resolveThemeVars({
      font_family_url: "javascript:alert(1)",
      font_family_name: "Evil",
    });
    expect(vars["--font-sans"]).toBeUndefined();
    expect(vars.fontFaceCss).toBeUndefined();
  });

  it("rejects credentialed HTTPS font URL", () => {
    const vars = resolveThemeVars({
      font_family_url: "https://user:pass@example.com/fonts/brand.woff2",
      font_family_name: "Brand Sans",
    });
    expect(vars["--font-sans"]).toBeUndefined();
    expect(vars.fontFaceCss).toBeUndefined();
  });

  it("accepts valid HTTPS branding font URL", () => {
    const vars = resolveThemeVars({
      font_family_url: "https://cdn.example.com/fonts/brand.woff2",
      font_family_name: "Brand Sans",
    });
    expect(vars["--font-sans"]).toContain("Brand Sans");
    expect(vars["--font-sans"]).toContain("Inter");
    expect(vars.fontFaceCss).toContain("https://cdn.example.com/fonts/brand.woff2");
  });

  it("does not emit font-face CSS for injected font family names", () => {
    const payload = 'test</style><script>alert(1)</script><style>';
    const vars = resolveThemeVars({
      font_family_url: "https://cdn.example.com/fonts/brand.woff2",
      font_family_name: payload,
    });
    expect(vars.fontFaceCss).toBeDefined();
    expect(vars.fontFaceCss).not.toContain("</style>");
    expect(vars.fontFaceCss).not.toContain("<script");
    expect(vars.fontFaceCss).not.toContain("alert(1)");
  });

  it("omits font vars when font name sanitizes to empty", () => {
    const vars = resolveThemeVars({
      font_family_url: "https://cdn.example.com/fonts/brand.woff2",
      font_family_name: "</>",
    });
    expect(vars["--font-sans"]).toBeUndefined();
    expect(vars.fontFaceCss).toBeUndefined();
  });

  it("emits style block with root vars", () => {
    const css = themeVarsToStyleBlock(resolveThemeVars());
    expect(css).toContain(":root");
    expect(css).toContain("--primary:");
  });
});
