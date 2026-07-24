// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useOverscrollBounceGuard } from "../../src/hooks/useOverscrollBounceGuard.js";

afterEach(() => {
  cleanup();
});

function makeScrollable({ scrollTop = 0, clientHeight = 100, scrollHeight = 300 } = {}) {
  const el = document.createElement("div");
  Object.defineProperty(el, "scrollTop", { value: scrollTop, writable: true });
  Object.defineProperty(el, "clientHeight", { value: clientHeight, configurable: true });
  Object.defineProperty(el, "scrollHeight", { value: scrollHeight, configurable: true });
  document.body.appendChild(el);
  return el;
}

function dispatchWheel(el: HTMLElement, deltaY: number): boolean {
  const event = new WheelEvent("wheel", { deltaY, bubbles: true, cancelable: true });
  return el.dispatchEvent(event);
}

describe("useOverscrollBounceGuard", () => {
  it("prevents scrolling further up when already at the top", () => {
    const el = makeScrollable({ scrollTop: 0 });
    renderHook(() => useOverscrollBounceGuard({ current: el }));

    const notCancelled = dispatchWheel(el, -100);
    expect(notCancelled).toBe(false);
  });

  it("prevents scrolling further down when already at the bottom", () => {
    const el = makeScrollable({ scrollTop: 200, clientHeight: 100, scrollHeight: 300 });
    renderHook(() => useOverscrollBounceGuard({ current: el }));

    const notCancelled = dispatchWheel(el, 100);
    expect(notCancelled).toBe(false);
  });

  it("tolerates sub-pixel scroll positions at the bottom boundary", () => {
    // scrollTop + clientHeight lands 1.5px short of scrollHeight — still "at bottom".
    const el = makeScrollable({ scrollTop: 198.5, clientHeight: 100, scrollHeight: 300 });
    renderHook(() => useOverscrollBounceGuard({ current: el }));

    const notCancelled = dispatchWheel(el, 100);
    expect(notCancelled).toBe(false);
  });

  it("does not interfere with scrolling in the middle of the content", () => {
    const el = makeScrollable({ scrollTop: 100, clientHeight: 100, scrollHeight: 300 });
    renderHook(() => useOverscrollBounceGuard({ current: el }));

    expect(dispatchWheel(el, 100)).toBe(true);
    expect(dispatchWheel(el, -100)).toBe(true);
  });

  it("allows scrolling back up from the bottom and down from the top", () => {
    const el = makeScrollable({ scrollTop: 0 });
    renderHook(() => useOverscrollBounceGuard({ current: el }));
    expect(dispatchWheel(el, 100)).toBe(true);

    Object.defineProperty(el, "scrollTop", { value: 200, writable: true });
    expect(dispatchWheel(el, -100)).toBe(true);
  });

  it("does nothing when the ref has no element", () => {
    expect(() => renderHook(() => useOverscrollBounceGuard({ current: null }))).not.toThrow();
  });
});
