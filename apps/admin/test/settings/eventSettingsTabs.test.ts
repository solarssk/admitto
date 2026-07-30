import { describe, expect, it } from "vitest";
import { inPageTabFromSearch } from "../../src/settings/eventSettingsTabs.js";

function paramsWithTab(tab: string | null): URLSearchParams {
  const params = new URLSearchParams();
  if (tab !== null) params.set("tab", tab);
  return params;
}

describe("inPageTabFromSearch", () => {
  it("defaults to general when no tab param is present", () => {
    expect(inPageTabFromSearch(paramsWithTab(null), true)).toBe("general");
  });

  it("resolves a known tab id as-is", () => {
    expect(inPageTabFromSearch(paramsWithTab("images"), true)).toBe("images");
  });

  it("maps the old 'branding' tab id to 'images', so an existing bookmark still lands correctly", () => {
    expect(inPageTabFromSearch(paramsWithTab("branding"), true)).toBe("images");
  });

  it("falls back to general for an unknown tab id", () => {
    expect(inPageTabFromSearch(paramsWithTab("not-a-real-tab"), true)).toBe("general");
  });

  it("falls back to general for a superadmin-only tab when the caller isn't a superadmin", () => {
    expect(inPageTabFromSearch(paramsWithTab("mail"), false)).toBe("general");
    expect(inPageTabFromSearch(paramsWithTab("mail"), true)).toBe("mail");
  });
});
