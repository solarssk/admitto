// Deliberately runs in the default "node" environment (no jsdom pragma):
// exercises the `typeof window === "undefined"` guards that keep the mute
// preference away from browser storage in windowless processes — the exact
// paths that used to touch Node's experimental localStorage global and spam
// ExperimentalWarning lines into test output.
import { beforeEach, describe, expect, it, vi } from "vitest";

async function importFresh() {
  vi.resetModules();
  return import("../../src/checkin/scanSoundFeedback.js");
}

describe("scanSoundFeedback without a window", () => {
  beforeEach(() => {
    expect(typeof window).toBe("undefined");
  });

  it("defaults to not muted instead of reading browser storage", async () => {
    const { isScanSoundMuted } = await importFresh();
    expect(isScanSoundMuted()).toBe(false);
  });

  it("toggles the in-memory mute state without writing to storage", async () => {
    const { isScanSoundMuted, setScanSoundMuted } = await importFresh();
    setScanSoundMuted(true);
    expect(isScanSoundMuted()).toBe(true);
    setScanSoundMuted(false);
    expect(isScanSoundMuted()).toBe(false);
  });
});
