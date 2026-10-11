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

/** Stubs the layout reads of a fixed-position panel placed by `useFloatingPlacement` - jsdom has no
 * layout engine, so every size defaults to 0. Floating UI reads the anchor's rect from
 * getBoundingClientRect and the panel's own size from offsetWidth/offsetHeight, and the content's
 * natural height from scrollHeight. The panel is the element with an inline `position: fixed` (what the
 * hook gives it from the first render); <html> and <body> sit at the origin; any other element is the
 * anchor or one of its ancestors and reports `rect`. A max-height the hook applies shortens the panel. */
export function mockPlacementLayout(opts: {
  rect: { top: number; bottom: number; left: number; width?: number };
  panelHeight: number;
  panelWidth: number;
  innerWidth: number;
  innerHeight: number;
}) {
  const isPanel = (el: HTMLElement) => el.style.position === "fixed";
  const panelBox = (el: HTMLElement) => ({
    width: opts.panelWidth,
    height: Math.min(opts.panelHeight, Number.parseFloat(el.style.maxHeight) || opts.panelHeight),
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this === document.documentElement || this === document.body) {
      return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {} };
    }
    if (isPanel(this)) {
      const { width, height } = panelBox(this);
      return { top: 0, bottom: height, left: 0, right: width, width, height, x: 0, y: 0, toJSON() {} };
    }
    const width = opts.rect.width ?? 0;
    const height = opts.rect.bottom - opts.rect.top;
    return { ...opts.rect, right: opts.rect.left + width, width, height, x: opts.rect.left, y: opts.rect.top, toJSON() {} };
  });
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) {
    return isPanel(this) ? opts.panelHeight : 0;
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
    return isPanel(this) ? panelBox(this).width : 0;
  });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
    return isPanel(this) ? panelBox(this).height : 0;
  });
  vi.spyOn(window, "innerWidth", "get").mockReturnValue(opts.innerWidth);
  vi.spyOn(window, "innerHeight", "get").mockReturnValue(opts.innerHeight);
}
