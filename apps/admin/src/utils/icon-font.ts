import { LOAD_TIMEOUT_MS } from "./loading-timing.js";

/** Set on <html> once the icon font is usable. See the `.ti` rule in staff.css. */
export const ICONS_READY_CLASS = "icons-ready";

/**
 * Icons are glyphs of a ~460 kB font. Until it has loaded the browser draws their private-use code
 * points as empty boxes, which on a slow connection is seconds of boxes next to the (SVG) icons that
 * do show. Until this runs to completion `.ti` icons are invisible (still taking their room), and then
 * all appear at once.
 *
 * A font that fails to load, or does not answer within `LOAD_TIMEOUT_MS`, is revealed anyway: empty
 * boxes are better than icons that never come.
 */
export function revealIconsWhenLoaded(doc: Document = document): void {
  const reveal = () => {
    clearTimeout(timer);
    doc.documentElement.classList.add(ICONS_READY_CLASS);
  };
  const timer = setTimeout(reveal, LOAD_TIMEOUT_MS);
  // No FontFaceSet (very old browser, some test environments): nothing to wait for.
  if (!doc.fonts) {
    reveal();
    return;
  }
  // Starts the download if nothing has yet and resolves when it is in; resolves at once with no
  // faces if the family is not declared.
  doc.fonts.load('1em "tabler-icons"').then(reveal, reveal);
}
