// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { scanFieldInputMode } from "../../src/checkin/searchFieldAttrs.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("scanFieldInputMode", () => {
  it("returns text when a touch pointer is available (phone, tablet)", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(any-pointer: coarse)" }));
    expect(scanFieldInputMode()).toBe("text");
  });

  it("returns text on a touch device whose primary pointer is fine (tablet used with a mouse or stylus)", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(any-pointer: coarse)" }));
    // The primary pointer alone would say "fine"; only the any-pointer query reports the touchscreen.
    expect(window.matchMedia("(pointer: coarse)").matches).toBe(false);
    expect(scanFieldInputMode()).toBe("text");
  });

  it("returns none when no pointer is coarse (mouse only, hardware scanner desk)", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    expect(scanFieldInputMode()).toBe("none");
  });

  it("fails open to text when matchMedia is unavailable", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(scanFieldInputMode()).toBe("text");
  });
});
