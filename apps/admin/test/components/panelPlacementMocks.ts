import { vi } from "vitest";

export function mockVisualViewport(
  width: number,
  getHeight: () => number,
  getOffsetTop: () => number = () => 0,
  getOffsetLeft: () => number = () => 0,
): VisualViewport {
  const viewport = new EventTarget();
  Object.defineProperties(viewport, {
    width: { value: width },
    height: { get: getHeight },
    offsetTop: { get: getOffsetTop },
    offsetLeft: { get: getOffsetLeft },
  });
  vi.stubGlobal("visualViewport", viewport);
  return viewport as VisualViewport;
}

/** Stubs the layout reads a fixed-position, viewport-flip placement panel's effect uses - jsdom
 * has no real layout engine, so getBoundingClientRect/scrollHeight/offsetWidth/innerWidth/
 * innerHeight all default to 0. Shared by DatePicker.test.tsx and TimeInput.test.tsx, which both
 * use this placement pattern. */
export function mockPlacementLayout(opts: {
  rect: { top: number; bottom: number; left: number };
  panelHeight: number;
  panelWidth: number;
  innerWidth: number;
  innerHeight: number;
}) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(opts.rect as DOMRect);
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(opts.panelHeight);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(opts.panelWidth);
  vi.spyOn(window, "innerWidth", "get").mockReturnValue(opts.innerWidth);
  vi.spyOn(window, "innerHeight", "get").mockReturnValue(opts.innerHeight);
}
