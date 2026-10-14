const CLIENT_ERROR_SOURCES = [
  "admin-error-boundary",
  "window-error",
  "unhandled-rejection",
  "resource-error",
  "csp-violation",
] as const;

type ClientErrorContext = {
  source: (typeof CLIENT_ERROR_SOURCES)[number];
  componentStack?: string;
};

/** Path this module reports to - shared with {@link "./globalErrorReporting.js"} so a CSP
 *  violation about this endpoint itself is never reported here (would loop forever). */
export const CLIENT_ERROR_REPORT_PATH = "/api/admin/client-errors";

/** Report a client-side error: verbose in dev, structured server log in production. */
export function reportClientError(error: unknown, context: ClientErrorContext): void {
  if (import.meta.env.DEV) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(`[${context.source}]`, err, context.componentStack);
    return;
  }

  // Production reports contain only a fixed category. Do not inspect the error:
  // its text, name, stack and the current URL can all contain personal data.
  if (!CLIENT_ERROR_SOURCES.includes(context.source)) return;
  const payload = { source: context.source };

  // Same-origin POST; browser sets Origin for jsonPostCsrf. A 401 before
  // session bootstrap is expected and ignored, with no retries or error reports.
  void fetch(CLIENT_ERROR_REPORT_PATH, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => {
    /* fire-and-forget */
  });
}
