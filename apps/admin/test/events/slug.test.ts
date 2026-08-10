import { describe, expect, it } from "vitest";
import { slugFromTitle } from "../../src/events/slug.js";

describe("slugFromTitle", () => {
  it("derives a lowercase dashed slug from ASCII titles", () => {
    expect(slugFromTitle("Autumn Summit 2026", 80)).toBe("autumn-summit-2026");
  });

  it("returns empty for blank titles so create stays disabled", () => {
    expect(slugFromTitle("   ")).toBe("");
    expect(slugFromTitle("")).toBe("");
  });

  it("falls back to a stable event-* slug when the title has no ASCII letters or digits", () => {
    const a = slugFromTitle("Осенний саммит", 80);
    const b = slugFromTitle("Осенний саммит", 80);
    expect(a).toMatch(/^event-[a-z0-9]+$/);
    expect(a).toBe(b);
    expect(a).not.toBe(slugFromTitle("Москва", 80));
  });
});
