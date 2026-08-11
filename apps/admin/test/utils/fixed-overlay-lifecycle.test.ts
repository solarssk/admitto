// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { attachFixedOverlayLifecycle, getFixedOverlayViewport } from "../../src/utils/fixed-overlay-lifecycle.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mockVisualViewport(width: number, height: number): VisualViewport {
  const viewport = new EventTarget();
  Object.defineProperties(viewport, {
    width: { value: width },
    height: { value: height },
  });
  vi.stubGlobal("visualViewport", viewport);
  return viewport as VisualViewport;
}

function dispatchWindowScroll(target: EventTarget) {
  const scrollEvent = new Event("scroll", { bubbles: true });
  Object.defineProperty(scrollEvent, "target", { value: target });
  window.dispatchEvent(scrollEvent);
}

describe("attachFixedOverlayLifecycle", () => {
  it("calls onResize when the window resizes", () => {
    const onResize = vi.fn();
    const cleanup = attachFixedOverlayLifecycle(null, onResize, () => {});

    window.dispatchEvent(new Event("resize"));
    expect(onResize).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it("uses the visual viewport and repositions on its resize or scroll", () => {
    const viewport = mockVisualViewport(390, 430);
    const onResize = vi.fn();
    const cleanup = attachFixedOverlayLifecycle(null, onResize, () => {});

    viewport.dispatchEvent(new Event("resize"));
    viewport.dispatchEvent(new Event("scroll"));
    expect(onResize).toHaveBeenCalledTimes(2);
    expect(getFixedOverlayViewport()).toEqual({ width: 390, height: 430 });

    cleanup();
    viewport.dispatchEvent(new Event("resize"));
    expect(onResize).toHaveBeenCalledTimes(2);
  });

  it("closes on scroll outside the panel", () => {
    const panel = document.createElement("div");
    const outside = document.createElement("div");
    document.body.append(panel, outside);
    const onOutsideScroll = vi.fn();
    const cleanup = attachFixedOverlayLifecycle(panel, () => {}, onOutsideScroll);

    dispatchWindowScroll(outside);
    expect(onOutsideScroll).toHaveBeenCalledTimes(1);

    cleanup();
    panel.remove();
    outside.remove();
  });

  it("ignores scrolls that originate inside the panel", () => {
    const panel = document.createElement("div");
    const inner = document.createElement("div");
    panel.appendChild(inner);
    document.body.appendChild(panel);
    const onOutsideScroll = vi.fn();
    const cleanup = attachFixedOverlayLifecycle(panel, () => {}, onOutsideScroll);

    dispatchWindowScroll(inner);
    expect(onOutsideScroll).not.toHaveBeenCalled();

    cleanup();
    panel.remove();
  });

  it("removes listeners on cleanup", () => {
    const onResize = vi.fn();
    const onOutsideScroll = vi.fn();
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    const cleanup = attachFixedOverlayLifecycle(null, onResize, onOutsideScroll);
    cleanup();

    window.dispatchEvent(new Event("resize"));
    dispatchWindowScroll(outside);
    expect(onResize).not.toHaveBeenCalled();
    expect(onOutsideScroll).not.toHaveBeenCalled();
    outside.remove();
  });
});
