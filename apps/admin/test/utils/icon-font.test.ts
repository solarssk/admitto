// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ICONS_READY_CLASS, revealIconsWhenLoaded } from "../../src/utils/icon-font.js";
import { LOAD_TIMEOUT_MS } from "../../src/utils/loading-timing.js";

const html = () => document.documentElement;

/** A minimal FontFaceSet whose `load` the test settles by hand. */
function fakeFonts() {
  let resolve!: (faces: unknown[]) => void;
  let reject!: (reason: unknown) => void;
  const load = vi.fn(
    () =>
      new Promise<unknown[]>((res, rej) => {
        resolve = res;
        reject = rej;
      }),
  );
  Object.defineProperty(document, "fonts", { value: { load }, configurable: true });
  return { load, resolve: (faces: unknown[] = []) => resolve(faces), reject: (reason: unknown) => reject(reason) };
}

afterEach(() => {
  html().classList.remove(ICONS_READY_CLASS);
  // jsdom has no `document.fonts`: remove what a test defined.
  Reflect.deleteProperty(document, "fonts");
  vi.useRealTimers();
});

describe("revealIconsWhenLoaded", () => {
  it("keeps the icons hidden until the icon font has loaded, then reveals them", async () => {
    const fonts = fakeFonts();
    revealIconsWhenLoaded();
    expect(fonts.load).toHaveBeenCalledWith('1em "tabler-icons"');
    expect(html().classList.contains(ICONS_READY_CLASS)).toBe(false);

    fonts.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(html().classList.contains(ICONS_READY_CLASS)).toBe(true);
  });

  it("reveals them anyway when the font fails to load", async () => {
    const fonts = fakeFonts();
    revealIconsWhenLoaded();
    fonts.reject(new Error("404"));
    await Promise.resolve();
    await Promise.resolve();
    expect(html().classList.contains(ICONS_READY_CLASS)).toBe(true);
  });

  it("reveals them anyway when the font has not answered within the load timeout", async () => {
    vi.useFakeTimers();
    fakeFonts();
    revealIconsWhenLoaded();
    await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS - 1);
    expect(html().classList.contains(ICONS_READY_CLASS)).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(html().classList.contains(ICONS_READY_CLASS)).toBe(true);
  });

  it("does not wait at all where there is no FontFaceSet", () => {
    revealIconsWhenLoaded();
    expect(html().classList.contains(ICONS_READY_CLASS)).toBe(true);
  });
});
