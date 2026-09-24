// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { scanFieldInputMode } from "../../src/checkin/searchFieldAttrs.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("scanFieldInputMode", () => {
  it("returns text when the primary pointer is coarse (phone, tablet)", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(pointer: coarse)" }));
    expect(scanFieldInputMode()).toBe("text");
  });

  it("returns none when the primary pointer is fine (mouse, hardware scanner desk)", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    expect(scanFieldInputMode()).toBe("none");
  });

  it("fails open to text when matchMedia is unavailable", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(scanFieldInputMode()).toBe("text");
  });
});
