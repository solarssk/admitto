import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LOADER_FIRST_DRAW_MS,
  bootHandoverEnabled,
  firstDrawRemainingMs,
  loaderElapsedMs,
  resetLoaderClockForTests,
  syncLoaderClockToSplash,
} from "../src/loader-clock.js";

/** A splash whose animation reports `currentTime` (jsdom has no Web Animations API of its own). */
function splashWithAnimationAt(currentTime: number | null): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = '<div class="at-splash"><svg></svg></div>';
  const svg = root.querySelector("svg")!;
  Object.assign(svg, { getAnimations: () => [{ currentTime }] });
  return root;
}

let now = 10_000;

beforeEach(() => {
  now = 10_000;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q }));
});

afterEach(() => {
  resetLoaderClockForTests();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("loader clock", () => {
  it("is off without a splash: nothing to hand over from, nothing to wait for", () => {
    syncLoaderClockToSplash(document.createElement("div"));
    expect(bootHandoverEnabled()).toBe(false);
    expect(firstDrawRemainingMs()).toBe(0);
  });

  it("starts counting from the splash animation's own time, not from the page load", () => {
    syncLoaderClockToSplash(splashWithAnimationAt(300));
    expect(bootHandoverEnabled()).toBe(true);
    expect(loaderElapsedMs()).toBe(300);
    now += 200;
    expect(loaderElapsedMs()).toBe(500);
  });

  it("asks to keep the loader up until the first draw-in has finished", () => {
    syncLoaderClockToSplash(splashWithAnimationAt(100));
    expect(firstDrawRemainingMs()).toBe(LOADER_FIRST_DRAW_MS - 100);
    now += 400;
    expect(firstDrawRemainingMs()).toBe(LOADER_FIRST_DRAW_MS - 500);
    now += 1000;
    expect(firstDrawRemainingMs()).toBe(0);
  });

  it("does not hold anything back for a user who asked for reduced motion (no draw-in to wait for)", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: true, media: q }));
    syncLoaderClockToSplash(splashWithAnimationAt(0));
    expect(bootHandoverEnabled()).toBe(true);
    expect(firstDrawRemainingMs()).toBe(0);
  });

  it("copes with a browser that has no Web Animations API (still a splash, clock stays at zero)", () => {
    const root = document.createElement("div");
    root.innerHTML = '<div class="at-splash"><svg></svg></div>';
    syncLoaderClockToSplash(root);
    expect(bootHandoverEnabled()).toBe(true);
    expect(loaderElapsedMs()).toBe(now);
  });

  it("only the first sync counts: a second call cannot move the clock (the splash exists once, at boot)", () => {
    syncLoaderClockToSplash(splashWithAnimationAt(300));
    now += 500;
    syncLoaderClockToSplash(splashWithAnimationAt(0));
    expect(loaderElapsedMs()).toBe(800);
  });

  it("treats a negative or missing animation time as just started", () => {
    syncLoaderClockToSplash(splashWithAnimationAt(-5000));
    expect(loaderElapsedMs()).toBe(0);
    expect(firstDrawRemainingMs()).toBe(LOADER_FIRST_DRAW_MS);

    resetLoaderClockForTests();
    syncLoaderClockToSplash(splashWithAnimationAt(null));
    expect(loaderElapsedMs()).toBe(0);
  });

  it("never asks for more than one first draw-in, whatever the animation reported", () => {
    syncLoaderClockToSplash(splashWithAnimationAt(-1e9));
    expect(firstDrawRemainingMs()).toBeLessThanOrEqual(LOADER_FIRST_DRAW_MS);
  });
});
