import { describe, expect, it } from "vitest";
import { resolveThemeVars, themeVarsToStyleBlock } from "../src/theme.js";

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

  it("emits style block with root vars", () => {
    const css = themeVarsToStyleBlock(resolveThemeVars());
    expect(css).toContain(":root");
    expect(css).toContain("--primary:");
  });
});
