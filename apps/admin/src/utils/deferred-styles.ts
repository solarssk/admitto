import { LOAD_TIMEOUT_MS } from "./loading-timing.js";

/**
 * The admin build leaves its stylesheets switched off (`media="print"`, `data-deferred-css`) so they
 * do not block the first paint of the splash (see `build-html.ts`). This switches each one on, as
 * soon as it has loaded, and resolves when all are on, so the app can start styled.
 *
 * A stylesheet that fails to load is switched on anyway (the app then runs unstyled rather than the
 * splash staying up for good), and so is one that has not answered after `LOAD_TIMEOUT_MS`.
 */
export function enableDeferredStylesheets(doc: Document = document): Promise<void> {
  const links = Array.from(doc.querySelectorAll<HTMLLinkElement>("link[data-deferred-css]"));
  return Promise.all(links.map(enableWhenLoaded)).then(() => undefined);
}

function enableWhenLoaded(link: HTMLLinkElement): Promise<void> {
  return new Promise((resolve) => {
    const enable = () => {
      clearTimeout(timer);
      link.media = "all";
      resolve();
    };
    const timer = setTimeout(enable, LOAD_TIMEOUT_MS);
    // `sheet` exists once the stylesheet has loaded, even while its media does not match.
    if (link.sheet) {
      enable();
      return;
    }
    link.addEventListener("load", enable, { once: true });
    link.addEventListener("error", enable, { once: true });
  });
}
