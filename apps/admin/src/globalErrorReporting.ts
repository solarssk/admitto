import { reportClientError } from "./reportClientError.js";

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

/**
 * Errors and CSP violations that never reach React (event-handler throws, third-party
 * script injection, uncaught rejections) are otherwise invisible in production - no
 * console access, no ErrorBoundary coverage (it only catches render-phase errors).
 * Route them through the same reporting pipeline so a silent crash - e.g. a browser
 * extension's inline script getting blocked by CSP mid-mutation - shows up server-side
 * instead of only in a user's local DevTools.
 */
export function installGlobalErrorReporting(): void {
  window.addEventListener("error", (event) => {
    if (typeof event.message === "string" && event.message.includes("ResizeObserver loop")) return;
    reportClientError(event.error ?? new Error(event.message), { source: "window-error" });
  });

  window.addEventListener("unhandledrejection", (event) => {
    reportClientError(event.reason, { source: "unhandled-rejection" });
  });

  document.addEventListener("securitypolicyviolation", (event) => {
    const blockedURI = event.blockedURI ? withoutQueryAndFragment(event.blockedURI) : "(inline)";
    const sourceFile = event.sourceFile ? withoutQueryAndFragment(event.sourceFile) : "?";
    reportClientError(
      new Error(
        `${event.violatedDirective} blocked ${blockedURI} ` +
          `at ${sourceFile}:${event.lineNumber ?? "?"} sample="${(event.sample ?? "").slice(0, 150)}"`,
      ),
      { source: "csp-violation" },
    );
  });
}
