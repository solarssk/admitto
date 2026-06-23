import { describe, expect, it } from "vitest";
import { slugifyItemKey, uniqueItemKey } from "../../src/requirements/itemKey.js";

describe("slugifyItemKey", () => {
  it("lowercases and replaces spaces with underscores", () => {
    expect(slugifyItemKey("Gift Bag")).toBe("gift_bag");
    expect(slugifyItemKey("headset")).toBe("headset");
  });

  it("strips punctuation and collapses separators", () => {
    expect(slugifyItemKey("  VIP — Headset  ")).toBe("vip_headset");
  });

  it("returns empty for labels with no slug characters", () => {
    expect(slugifyItemKey("---")).toBe("");
  });
});

describe("uniqueItemKey", () => {
  it("appends numeric suffix on collision", () => {
    expect(uniqueItemKey("Socks", ["socks", "socks_2"])).toBe("socks_3");
  });
});
