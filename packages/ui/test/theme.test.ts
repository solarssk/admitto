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

  it.each([
    ["rejects unsafe font URL", "javascript:alert(1)", "Evil"],
    [
      "rejects credentialed HTTPS font URL",
      "https://user:pass@example.com/fonts/brand.woff2",
      "Brand Sans",
    ],
    [
      "omits font vars when font name sanitizes to empty",
      "https://cdn.example.com/fonts/brand.woff2",
      "</>",
    ],
  ])("%s", (_label, fontFamilyUrl, fontFamilyName) => {
    const vars = resolveThemeVars({
      font_family_url: fontFamilyUrl,
      font_family_name: fontFamilyName,
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

  it("emits style block with root vars", () => {
    const css = themeVarsToStyleBlock(resolveThemeVars());
    expect(css).toContain(":root");
    expect(css).toContain("--primary:");
  });
});
