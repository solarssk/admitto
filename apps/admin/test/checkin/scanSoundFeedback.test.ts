// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as ScanSoundFeedback from "../../src/checkin/scanSoundFeedback.js";

/** In-memory localStorage stand-in — the real one throws in this Node/jsdom
 * combination (Node 22+'s experimental native localStorage needs
 * --localstorage-file), which is itself exactly the kind of failure
 * isScanSoundMuted/setScanSoundMuted must tolerate in real browsers too
 * (Safari private browsing throws SecurityError on storage access). */
function mockLocalStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
}

function mockMatchMedia(reducedMotion: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query.includes("prefers-reduced-motion") ? reducedMotion : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

class MockOscillator {
  frequency = { value: 0 };
  connect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}

class MockGainNode {
  gain = { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() };
  connect = vi.fn();
}

let lastAudioContextInstance: MockAudioContext | null = null;

class MockAudioContext {
  state: "suspended" | "running" = "suspended";
  currentTime = 0;
  destination = {};
  resume = vi.fn(async () => {
    // A real AudioContext.resume() is never synchronous — model that so the
    // "first call primes, doesn't necessarily beep" behavior is observable
    // (an async fn with no internal await would resolve its body
    // synchronously up to the return, which doesn't match real timing).
    await Promise.resolve();
    this.state = "running";
  });
  createOscillator = vi.fn(() => new MockOscillator());
  createGain = vi.fn(() => new MockGainNode());

  constructor() {
    lastAudioContextInstance = this;
  }
}

// The module keeps a lazily-created AudioContext singleton at module scope —
// vi.resetModules() + a fresh dynamic import gives each test its own copy,
// so one test's "already resumed" context can't leak into the next.
let mod: typeof ScanSoundFeedback;

beforeEach(async () => {
  vi.resetModules();
  lastAudioContextInstance = null;
  mockLocalStorage();
  mockMatchMedia(false);
  mod = await import("../../src/checkin/scanSoundFeedback.js");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("mute preference (localStorage)", () => {
  it("defaults to not muted", () => {
    expect(mod.isScanSoundMuted()).toBe(false);
  });

  it("round-trips through setScanSoundMuted", () => {
    mod.setScanSoundMuted(true);
    expect(mod.isScanSoundMuted()).toBe(true);
    mod.setScanSoundMuted(false);
    expect(mod.isScanSoundMuted()).toBe(false);
  });

  it("isScanSoundMuted defaults to false (not muted) instead of throwing when localStorage is unavailable", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("SecurityError");
      },
    });
    expect(() => mod.isScanSoundMuted()).not.toThrow();
    expect(mod.isScanSoundMuted()).toBe(false);
  });

  it("setScanSoundMuted does not throw when localStorage is unavailable", () => {
    vi.stubGlobal("localStorage", {
      setItem: () => {
        throw new Error("SecurityError");
      },
    });
    expect(() => mod.setScanSoundMuted(true)).not.toThrow();
  });
});

describe("useScanSoundMuted", () => {
  it("reads the initial value from localStorage and toggle flips + persists it", () => {
    const { result } = renderHook(() => mod.useScanSoundMuted());
    expect(result.current[0]).toBe(false);

    act(() => result.current[1]());
    expect(result.current[0]).toBe(true);
    expect(mod.isScanSoundMuted()).toBe(true);

    act(() => result.current[1]());
    expect(result.current[0]).toBe(false);
    expect(mod.isScanSoundMuted()).toBe(false);
  });
});

describe("playScanFeedback — graceful degradation when APIs are unavailable", () => {
  it("does not throw when neither AudioContext nor navigator.vibrate exist (feature detection)", () => {
    vi.stubGlobal("AudioContext", undefined);
    vi.stubGlobal("navigator", { userAgent: "test" });
    expect(() => mod.playScanFeedback("VALID")).not.toThrow();
    expect(() => mod.playScanFeedback("INVALID")).not.toThrow();
  });

  it("does not throw when the AudioContext constructor itself throws", () => {
    vi.stubGlobal(
      "AudioContext",
      class {
        constructor() {
          throw new Error("blocked");
        }
      },
    );
    expect(() => mod.playScanFeedback("VALID")).not.toThrow();
  });
});

describe("playScanFeedback — audio", () => {
  it("primes the AudioContext on the first call, then plays a tone once it has resumed to running", async () => {
    vi.stubGlobal("AudioContext", MockAudioContext);

    mod.playScanFeedback("VALID");
    expect(lastAudioContextInstance).not.toBeNull();
    // Still "suspended" — resume() is async and hasn't resolved yet, so no
    // oscillator plays on this very first call (matches real browsers: the
    // first scan of a session may be silent while the context wakes up).
    expect(lastAudioContextInstance!.createOscillator).not.toHaveBeenCalled();

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(lastAudioContextInstance!.state).toBe("running");

    mod.playScanFeedback("VALID");
    expect(lastAudioContextInstance!.createOscillator).toHaveBeenCalled();
  });

  it("does not play a tone when muted, but still attempts vibration", async () => {
    vi.stubGlobal("AudioContext", MockAudioContext);
    const vibrate = vi.fn();
    vi.stubGlobal("navigator", { vibrate });
    mod.setScanSoundMuted(true);

    mod.playScanFeedback("VALID");
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    mod.playScanFeedback("VALID");

    // Muted skips the audio branch entirely, so unlockAudio() never runs and
    // no AudioContext is even created — nothing to assert createOscillator
    // against; its absence (lastAudioContextInstance staying null) is itself
    // the proof no tone was played.
    expect(lastAudioContextInstance).toBeNull();
    expect(vibrate).toHaveBeenCalled();
  });
});

describe("playScanFeedback — vibration", () => {
  it("vibrates with a pattern when navigator.vibrate is supported and motion isn't reduced", () => {
    const vibrate = vi.fn();
    vi.stubGlobal("navigator", { vibrate });

    mod.playScanFeedback("VALID");
    expect(vibrate).toHaveBeenCalledWith(30);

    mod.playScanFeedback("ALREADY_CHECKED_IN");
    expect(vibrate).toHaveBeenCalledWith([30, 60, 30]);

    mod.playScanFeedback("INVALID");
    expect(vibrate).toHaveBeenCalledWith(120);
  });

  it("skips vibration when prefers-reduced-motion is set", () => {
    mockMatchMedia(true);
    const vibrate = vi.fn();
    vi.stubGlobal("navigator", { vibrate });

    mod.playScanFeedback("VALID");

    expect(vibrate).not.toHaveBeenCalled();
  });

  it("does not throw when navigator.vibrate does not exist (iOS Safari — no browser there supports it)", () => {
    vi.stubGlobal("navigator", { userAgent: "iOS" });
    expect(() => mod.playScanFeedback("VALID")).not.toThrow();
  });

  it("does not throw when navigator.vibrate itself throws", () => {
    vi.stubGlobal("navigator", {
      vibrate: () => {
        throw new Error("blocked");
      },
    });
    expect(() => mod.playScanFeedback("VALID")).not.toThrow();
  });
});
