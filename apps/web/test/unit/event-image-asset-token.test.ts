import { describe, expect, it } from "vitest";
import {
  allocateImageAssetToken,
  slugifyImageAssetToken,
} from "../../src/admin/event-image-assets-routes.js";

describe("slugifyImageAssetToken", () => {
  it("slugifies display names and trims non-letter prefixes / trailing underscores", () => {
    expect(slugifyImageAssetToken("Sponsor Logo")).toBe("sponsor_logo");
    expect(slugifyImageAssetToken("__Logo__")).toBe("logo");
    expect(slugifyImageAssetToken("123 Banner!!!")).toBe("banner");
    expect(slugifyImageAssetToken("!!!")).toBe("");
  });

  it("collapses underscore runs without a backtracking regex", () => {
    expect(slugifyImageAssetToken("a___b__c")).toBe("a_b_c");
  });

  it("caps the token at 40 characters", () => {
    expect(slugifyImageAssetToken(`a${"b".repeat(50)}`)).toHaveLength(40);
  });
});

describe("allocateImageAssetToken", () => {
  it("returns the base when free, otherwise a numeric suffix", () => {
    expect(allocateImageAssetToken("sponsor_logo", new Set())).toBe("sponsor_logo");
    expect(allocateImageAssetToken("sponsor_logo", new Set(["sponsor_logo"]))).toBe("sponsor_logo_2");
  });

  it("skips reserved mail placeholders", () => {
    expect(allocateImageAssetToken("event_name", new Set())).toMatch(/^event_name_/);
  });

  it("returns null when no valid candidate remains", () => {
    expect(allocateImageAssetToken("", new Set())).toBeNull();
  });
});
