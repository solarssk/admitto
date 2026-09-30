/** How long a wait may run before the user is told, and before we stop waiting. AGENTS.md "Admin SPA loading and busy states". */
export const SLOW_NOTICE_MS = 8_000;
export const LOAD_TIMEOUT_MS = 30_000;

/** Visible only after `SLOW_NOTICE_MS`; the one loading text besides a busy button's own label. */
export const SLOW_NOTICE_TEXT = "Taking longer than usual. Check your connection.";

/** Shown with a Retry once a request has been abandoned at `LOAD_TIMEOUT_MS`. */
export const LOAD_TIMEOUT_MESSAGE = "The server did not answer in time. Check your connection and try again.";
