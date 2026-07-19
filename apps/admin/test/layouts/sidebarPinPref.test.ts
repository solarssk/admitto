// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readSidebarPinned, writeSidebarPinned } from "../../src/layouts/sidebarPinPref.js";

const SIDEBAR_PIN_KEY = "admitto_sidebar_pinned";

function stubThrowingStorage() {
  vi.stubGlobal("localStorage", {
    getItem: () => {
      throw new Error("SecurityError: storage disabled");
    },
    setItem: () => {
      throw new Error("SecurityError: storage disabled");
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  try {
    localStorage.removeItem(SIDEBAR_PIN_KEY);
  } catch {
    /* storage may be unavailable in some Node/jsdom combinations */
  }
});

describe("sidebarPinPref in a browser-like environment", () => {
  it("round-trips the preference through localStorage", () => {
    expect(readSidebarPinned()).toBe(true);
    writeSidebarPinned(false);
    expect(readSidebarPinned()).toBe(false);
    writeSidebarPinned(true);
    expect(readSidebarPinned()).toBe(true);
  });

  it("falls back to pinned when storage reads throw (Safari private browsing)", () => {
    stubThrowingStorage();
    expect(readSidebarPinned()).toBe(true);
  });

  it("swallows storage write failures", () => {
    stubThrowingStorage();
    expect(() => writeSidebarPinned(false)).not.toThrow();
  });
});
