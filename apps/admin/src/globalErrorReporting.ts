import { reportClientError } from "./reportClientError.js";

/** Errors and CSP violations that never reach React (event-handler throws, third-party
 * script injection, uncaught rejections) are otherwise invisible in production — no
 * console access, no ErrorBoundary coverage (it only catches render-phase errors).
 * Route them through the same reporting pipeline so a silent crash — e.g. a browser
 * extension's inline script getting blocked by CSP mid-mutation — shows up server-side
 * instead of only in a user's local DevTools. */
export function installGlobalErrorReporting(): void {
  window.addEventListener("error", (event) => {
    if (typeof event.message === "string" && event.message.includes("ResizeObserver loop")) return;
    reportClientError(event.error ?? new Error(event.message), { source: "window-error" });
  });

  window.addEventListener("unhandledrejection", (event) => {
    reportClientError(event.reason, { source: "unhandled-rejection" });
  });

  document.addEventListener("securitypolicyviolation", (event) => {
    reportClientError(
      new Error(
        `${event.violatedDirective} blocked ${event.blockedURI || "(inline)"} ` +
          `at ${event.sourceFile ?? "?"}:${event.lineNumber ?? "?"} sample="${(event.sample ?? "").slice(0, 150)}"`,
      ),
      { source: "csp-violation" },
    );
  });
}
