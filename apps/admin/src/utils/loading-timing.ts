/** How long a wait may run before the user is told, and before we stop waiting. AGENTS.md "Admin SPA loading and busy states". */
export const SLOW_NOTICE_MS = 8_000;
export const LOAD_TIMEOUT_MS = 30_000;

/** Visible only after `SLOW_NOTICE_MS`; it hangs under the loader's own line saying what is loading. */
export const SLOW_NOTICE_TEXT = "Taking longer than usual. Check your connection.";

/** Shown with a Retry once a request has been abandoned at `LOAD_TIMEOUT_MS`. */
export const LOAD_TIMEOUT_MESSAGE = "The server did not answer in time. Check your connection and try again.";

/** How long the boot loader takes to fade out over the freshly mounted app. Keep in step with `.shell-loading--leaving` in shell.css. */
export const BOOT_FADE_MS = 250;

/**
 * The loader is removed when its fade-out animation ends (`animationend`). This is only the safety
 * net for a browser that never fires it, and it must stay clearly later than `BOOT_FADE_MS`: taking
 * the element out while the animation is still running cancels it, which rejects `Animation.finished`
 * with an AbortError for anything (an end-to-end accessibility scan, for one) waiting on it.
 */
export const BOOT_FADE_FALLBACK_MS = BOOT_FADE_MS + 250;
