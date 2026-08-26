import { CLIENT_ERROR_REPORT_PATH, reportClientError } from "./reportClientError.js";

/** A CSP violation's sourceFile/blockedURI can carry a query string or fragment
 * (e.g. the current page's own URL) - strip those before the value goes into a
 * server log, keeping only origin + path. Falls back to the raw value for the
 * non-URL strings CSP also reports here, like the literal "inline". */
function withoutQueryAndFragment(value: string): string {
  try {
    const parsed = new URL(value);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return value;
  }
}

/** Describes a failed resource load (a non-bubbling "error" event's target is the element
 * that failed) for reporting, e.g. "Failed to load script https://cdn.example.com/x.js". */
function describeFailedResourceLoad(target: EventTarget | null): string {
  let src: string | undefined;
  if (target instanceof HTMLScriptElement || target instanceof HTMLImageElement) {
    src = target.src;
  } else if (target instanceof HTMLLinkElement) {
    src = target.href;
  }
  const what = target instanceof Element ? target.tagName.toLowerCase() : "resource";
  if (!src) return `Failed to load ${what}`;
  return `Failed to load ${what} ${withoutQueryAndFragment(src)}`;
}

/**
 * Errors and CSP violations that never reach React (event-handler throws, third-party
 * script injection, uncaught rejections) are otherwise invisible in production - no
 * console access, no ErrorBoundary coverage (it only catches render-phase errors).
 * Route them through the same reporting pipeline so a silent crash - e.g. a browser
 * extension's inline script getting blocked by CSP mid-mutation - shows up server-side
 * instead of only in a user's local DevTools.
 */
export function installGlobalErrorReporting(): void {
  // capture: true so a failed resource load (e.g. an extension-injected <script src> that
  // 404s instead of getting CSP-blocked) is seen too - a resource "error" doesn't bubble, so
  // a non-capturing listener on window never sees it. That case arrives as a plain Event with
  // no message/error (those are ErrorEvent-only), so it's handled separately below.
  window.addEventListener(
    "error",
    (event) => {
      if (typeof event.message !== "string") {
        reportClientError(new Error(describeFailedResourceLoad(event.target)), { source: "resource-error" });
        return;
      }
      if (event.message.includes("ResizeObserver loop")) return;
      reportClientError(event.error ?? new Error(event.message), { source: "window-error" });
    },
    { capture: true },
  );

  window.addEventListener("unhandledrejection", (event) => {
    reportClientError(event.reason, { source: "unhandled-rejection" });
  });

  document.addEventListener("securitypolicyviolation", (event) => {
    const blockedURI = event.blockedURI ? withoutQueryAndFragment(event.blockedURI) : "(inline)";
    // A violation that blocks this very reporting call (e.g. a misconfigured connect-src) would
    // otherwise report itself right back into the same block, forever - drop it instead of
    // looping. `blockedURI` is always origin+pathname (or "(inline)") here, so a plain endsWith
    // is enough without re-parsing it as a URL.
    if (blockedURI.endsWith(CLIENT_ERROR_REPORT_PATH)) return;
    const sourceFile = event.sourceFile ? withoutQueryAndFragment(event.sourceFile) : "?";
    // Deliberately excludes event.sample: CSP only guarantees it is the blocked content, not
    // that the content is third-party - an inline script/style built from application or user
    // data could end up there, and directive/URL/line is enough to identify what was blocked.
    reportClientError(
      new Error(`${event.violatedDirective} blocked ${blockedURI} at ${sourceFile}:${event.lineNumber}`),
      { source: "csp-violation" },
    );
  });
}
