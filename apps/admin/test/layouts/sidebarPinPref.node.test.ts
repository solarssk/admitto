// Deliberately runs in the default "node" environment (no jsdom pragma):
// exercises the `typeof window === "undefined"` guards that keep the sidebar
// pin preference away from browser storage in windowless processes — the
// paths that used to touch Node's experimental localStorage global and spam
// ExperimentalWarning lines into test output.
import { describe, expect, it } from "vitest";
import { readSidebarPinned, writeSidebarPinned } from "../../src/layouts/sidebarPinPref.js";

describe("sidebarPinPref without a window", () => {
  it("defaults to pinned instead of reading browser storage", () => {
    expect(typeof window).toBe("undefined");
    expect(readSidebarPinned()).toBe(true);
  });

  it("treats writes as a no-op instead of touching browser storage", () => {
    expect(() => writeSidebarPinned(false)).not.toThrow();
    expect(readSidebarPinned()).toBe(true);
  });
});
